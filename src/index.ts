import express from 'express';
import { exec } from 'child_process';
import { createReadStream } from 'fs';
import { createWriteStream, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import  ytDlp  from 'yt-dlp-exec';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

const TMP_DIR = './tmp';
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR);

const downloadVideo = async (url: string, outputPath: string) => {
  await ytDlp(url, {
    output: outputPath,
    format: 'mp4',
  });
};

const extractFrames = (videoPath: string, interval: number, outputDir: string): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const outputPattern = path.join(outputDir, 'frame-%03d.jpg');
    const cmd = `ffmpeg -i "${videoPath}" -vf "fps=1/${interval}" "${outputPattern}"`;
    exec(cmd, (err) => {
      if (err) return reject(err);
      const frames = readdirSync(outputDir)
        .filter(f => f.endsWith('.jpg'))
        .map(f => path.join(outputDir, f));
      resolve(frames);
    });
  });
};

const transcribeAudio = async (audioPath: string) => {
  const form = new FormData();
  form.append('file', createReadStream(audioPath));
  form.append('model', 'openai/whisper-large');

  const res = await fetch('https://api-inference.huggingface.co/models/openai/whisper-large', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
    },
    body: form as any,
  });

  return res.json();
};

const sendToOpenRouter = async (imageBuffer: Buffer, userPrompt: string) => {
  const base64Image = imageBuffer.toString('base64');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: "openai/gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
    }),
  });
  return res.json();
};

app.post('/api/process', async (req, res) => {
  const { videoUrl, interval, userPrompt } = req.body;
  const timestamp = Date.now();
  const tmpVideo = `${TMP_DIR}/video-${timestamp}.mp4`;
  const tmpFramesDir = `${TMP_DIR}/frames-${timestamp}`;
  const tmpAudio = `${TMP_DIR}/audio-${timestamp}.mp3`;

  if (!existsSync(tmpFramesDir)) mkdirSync(tmpFramesDir);

  try {
    // Step 1: Download video
    await downloadVideo(videoUrl, tmpVideo);

    // Step 2: Extract frames
    const framePaths = await extractFrames(tmpVideo, interval, tmpFramesDir);

    // Step 3: Extract audio
    await new Promise((resolve, reject) => {
      const cmd = `ffmpeg -i "${tmpVideo}" -q:a 0 -map a "${tmpAudio}" -y`;
      exec(cmd, (err) => (err ? reject(err) : resolve(null)));
    });

    // Step 4: Transcribe
    const transcript = await transcribeAudio(tmpAudio);

    // Step 5: Analyze frames
    const results = [];
    for (let i = 0; i < Math.min(framePaths.length, 5); i++) {
      const frame = framePaths[i];
      const imageBuffer = await import('fs').then(fs => fs.readFileSync(frame));
      const caption = await sendToOpenRouter(imageBuffer, userPrompt);
      results.push({ frame: path.basename(frame), caption });
    }

    res.json({ transcript, results });
  } catch (err) {
    console.error(err);
    const errorMessage = (err instanceof Error) ? err.message : String(err);
    res.status(500).json({ error: 'An error occurred during processing', details: errorMessage });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

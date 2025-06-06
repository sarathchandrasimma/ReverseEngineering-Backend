import express from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { uploadToSupabase } from './supabase.js';

const app = express();
app.use(express.json());

app.post('/process', async (req, res) => {
  const { url, frameInterval = 2, sceneCount = 3 } = req.body;
  const tempDir = `./temp/${uuidv4()}`;
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const videoPath = `${tempDir}/video.mp4`;
    const audioPath = `${tempDir}/audio.wav`;

    await execPromise(`yt-dlp -f best -o "${videoPath}" "${url}"`);
    await execPromise(`ffmpeg -i "${videoPath}" -vf fps=1/${frameInterval} "${tempDir}/frame-%03d.jpg"`);
    await execPromise(`ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}"`);

    const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.jpg')).slice(0, sceneCount);
    const uploadedUrls = [];
    for (const file of files) {
      const buffer = fs.readFileSync(`${tempDir}/${file}`);
      const url = await uploadToSupabase(file, buffer);
      uploadedUrls.push(url);
    }

    const audioBuffer = fs.readFileSync(audioPath);
    const audioBase64 = audioBuffer.toString('base64');

    res.json({ success: true, frames: uploadedUrls, audio: audioBase64 });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Processing failed' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(stderr);
      else resolve(stdout);
    });
  });
}

app.listen(3000, () => console.log('✅ Server running on port 3000'));

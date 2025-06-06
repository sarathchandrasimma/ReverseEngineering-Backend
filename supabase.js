import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function uploadToSupabase(fileName, buffer) {
  const { data, error } = await supabase.storage
    .from('frames')
    .upload(`jobs/${fileName}`, buffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) throw error;

  const { data: urlData } = supabase.storage
    .from('frames')
    .getPublicUrl(`jobs/${fileName}`);

  return urlData.publicUrl;
}

// 就活アプリの画像(非公開の置き場 entry-images)を、合言葉を確かめてから出し入れする。
// action: sign {paths:[…]} → {urls:{path:url}} / upload {dataUrl} → {path}
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const BUCKET = 'entry-images';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-kb-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function keyOk(key: string) {
  if (key.length < 6) return false;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const { data, error } = await db.from('jibun_access').select('token_hash').eq('token_hash', hex).limit(1);
  return !error && !!data && data.length > 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!(await keyOk((req.headers.get('x-kb-key') || '').trim()))) return json({ error: 'bad key' }, 401);
  // deno-lint-ignore no-explicit-any
  let b: any = {};
  try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  if (b.action === 'sign') {
    const paths = (Array.isArray(b.paths) ? b.paths : []).filter((p: unknown) => typeof p === 'string').slice(0, 500);
    if (!paths.length) return json({ urls: {} });
    const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 24 * 7);
    if (error) return json({ error: error.message }, 400);
    const urls: Record<string, string> = {};
    for (const d of data || []) if (d.signedUrl && d.path) urls[d.path] = d.signedUrl;
    return json({ urls });
  }
  if (b.action === 'upload') {
    const m = String(b.dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!m || m[2].length > 12_000_000) return json({ error: '画像が読めないか、大きすぎます' }, 400);
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    let ext = m[1].split('/')[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ext === 'jpeg') ext = 'jpg';
    const path = 'hikaru/' + crypto.randomUUID() + '.' + ext;
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: m[1], upsert: false });
    if (error) return json({ error: error.message }, 400);
    return json({ path });
  }
  return json({ error: 'unknown action' }, 400);
});

export const config = { runtime: 'nodejs', maxDuration: 30 };

const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  try {
    const redisRes = await fetch(
      `${UPSTASH_URL}/get/${encodeURIComponent(`axis:media:${id}`)}`,
      { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
    );
    const data = await redisRes.json();
    if (!data.result) return res.status(404).json({ error: 'Not found' });

    let val = data.result;
    let attempts = 0;
    while (typeof val === 'string' && attempts < 3) {
      try { val = JSON.parse(val); } catch { break; }
      attempts++;
    }

    const buffer = Buffer.from(val, 'base64');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).send(buffer);
  } catch (err) {
    console.error('Media serve error:', err.message);
    return res.status(500).json({ error: 'Failed to serve media' });
  }
}

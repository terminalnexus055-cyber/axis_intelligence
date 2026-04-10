// AXIS — Reddit JSON Debug

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const url = 'https://www.reddit.com/r/freelance/search.json?q=struggling&sort=new&restrict_sr=1&limit=5';
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AXIS-Intelligence/1.0',
        'Accept': 'application/json'
      }
    });

    const status = response.status;
    const contentType = response.headers.get('content-type');
    const text = await response.text();

    res.status(200).json({
      status,
      contentType,
      bodyPreview: text.slice(0, 1000),
      bodyLength: text.length
    });

  } catch (err) {
    res.status(200).json({ error: err.message });
  }
}

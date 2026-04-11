// AXIS — Browser Test with JSON endpoint via Browserless

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  // Use Reddit JSON API via Browserless — bypasses IP block
  const targetUrl = 'https://www.reddit.com/r/freelance/new.json?limit=10';

  const puppeteerScript = `export default async function({ page }) {
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.goto('${targetUrl}', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const content = await page.evaluate(() => {
    try {
      const pre = document.querySelector('pre');
      if (pre) return JSON.parse(pre.innerText);
      return { raw: document.body.innerText.slice(0, 2000) };
    } catch(e) {
      return { raw: document.body.innerText.slice(0, 2000) };
    }
  });
  return content;
}`;

  try {
    const response = await fetch(
      `https://production-sfo.browserless.io/chromium/function?token=${process.env.BROWSERLESS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/javascript' },
        body: puppeteerScript
      }
    );

    const status = response.status;
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    // Extract posts if Reddit JSON loaded
    const posts = parsed?.data?.children || parsed?.children || [];
    const sample = posts.slice(0, 3).map(p => ({
      author: p.data?.author,
      title: p.data?.title,
      text: p.data?.selftext?.slice(0, 200)
    }));

    res.status(200).json({
      browserless_status: status,
      posts_found: posts.length,
      sample: sample.length > 0 ? sample : text.slice(0, 500)
    });

  } catch (err) {
    res.status(200).json({ error: err.message });
  }
}

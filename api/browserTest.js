// AXIS — Indie Hackers DOM Inspector

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const targetUrl = 'https://www.indiehackers.com/posts?filter=top';

  const puppeteerScript = `export default async function({ page }) {
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.goto('${targetUrl}', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  // Accept cookies
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.innerText && (
      b.innerText.toLowerCase().includes('accept') ||
      b.innerText.toLowerCase().includes('agree') ||
      b.innerText.toLowerCase().includes('ok')
    ));
    if (btn) btn.click();
  });

  await new Promise(r => setTimeout(r, 2000));

  const inspection = await page.evaluate(() => {
    // Get all unique tag+class combinations present
    const tags = {};
    document.querySelectorAll('*').forEach(el => {
      const tag = el.tagName.toLowerCase();
      const cls = el.className && typeof el.className === 'string' 
        ? el.className.split(' ').filter(c => c.length > 0).slice(0, 2).join('.') 
        : '';
      const key = cls ? tag + '.' + cls : tag;
      if (!tags[key]) tags[key] = 0;
      tags[key]++;
    });

    // Get all links on the page
    const links = Array.from(document.querySelectorAll('a')).slice(0, 20).map(a => ({
      text: a.innerText.trim().slice(0, 80),
      href: a.href
    })).filter(l => l.text.length > 5);

    // Get page title and body text sample
    return {
      title: document.title,
      bodyText: document.body.innerText.slice(0, 1000),
      links: links.slice(0, 10)
    };
  });

  return inspection;
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

    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    res.status(200).json({
      status: response.status,
      result: parsed
    });

  } catch (err) {
    res.status(200).json({ error: err.message });
  }
}

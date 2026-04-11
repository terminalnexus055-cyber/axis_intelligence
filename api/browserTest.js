// AXIS — Indie Hackers correct URL test

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  // Use the correct IH posts URL
  const targetUrl = 'https://www.indiehackers.com/group/main-forum';

  const puppeteerScript = `export default async function({ page }) {
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.goto('${targetUrl}', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.innerText && b.innerText.toLowerCase().includes('accept'));
    if (btn) btn.click();
  });

  await new Promise(r => setTimeout(r, 2000));

  const inspection = await page.evaluate(() => {
    return {
      title: document.title,
      bodyText: document.body.innerText.slice(0, 1500),
      links: Array.from(document.querySelectorAll('a'))
        .map(a => ({ text: a.innerText.trim().slice(0, 80), href: a.href }))
        .filter(l => l.text.length > 10 && l.href.includes('indiehackers'))
        .slice(0, 15)
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

    res.status(200).json({ status: response.status, result: parsed });

  } catch (err) {
    res.status(200).json({ error: err.message });
  }
}

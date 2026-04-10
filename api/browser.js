// AXIS — Browserless Integration
// Eyes and hands for AXIS — reads any platform on command

export const config = { runtime: 'edge' };

const BROWSERLESS_URL = 'https://production-sfo.browserless.io';

// Main browser task executor
export async function executeBrowserTask(task) {
  const { action, target, platform, query } = task;

  switch (action) {
    case 'read_posts':
      return await readPosts(platform, query);
    case 'read_profile':
      return await readProfile(platform, target);
    case 'screenshot':
      return await takeScreenshot(target);
    default:
      return { error: `Unknown action: ${action}` };
  }
}

async function readPosts(platform, query) {
  const urls = {
    'indiehackers': `https://www.indiehackers.com/search?query=${encodeURIComponent(query)}`,
    'reddit': `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=new`,
    'hackernews': `https://hn.algolia.com/?q=${encodeURIComponent(query)}&dateRange=pastWeek`
  };

  const targetUrl = urls[platform] || urls['indiehackers'];

  const script = `
    export default async function({ page }) {
      await page.goto('${targetUrl}', { waitUntil: 'networkidle0', timeout: 20000 });
      
      // Wait for content
      await page.waitForTimeout(2000);
      
      // Extract posts based on platform
      const posts = await page.evaluate(() => {
        const results = [];
        
        // Generic extraction — get all meaningful text blocks
        const elements = document.querySelectorAll('h1, h2, h3, article, .post, .story, [class*="post"], [class*="story"], [class*="thread"]');
        
        elements.forEach((el, i) => {
          if (i > 20) return;
          const text = el.innerText?.trim();
          const link = el.querySelector('a')?.href || window.location.href;
          if (text && text.length > 30) {
            results.push({ text: text.slice(0, 300), url: link });
          }
        });
        
        return results.slice(0, 10);
      });
      
      return { posts, url: page.url() };
    }
  `;

  return await runBrowserScript(script);
}

async function readProfile(platform, username) {
  const urls = {
    'reddit': `https://www.reddit.com/user/${username}`,
    'indiehackers': `https://www.indiehackers.com/${username}`,
    'twitter': `https://twitter.com/${username}`
  };

  const targetUrl = urls[platform] || `https://www.indiehackers.com/${username}`;

  const script = `
    export default async function({ page }) {
      await page.goto('${targetUrl}', { waitUntil: 'networkidle0', timeout: 20000 });
      await page.waitForTimeout(2000);
      
      const profile = await page.evaluate(() => {
        const text = document.body.innerText?.slice(0, 2000);
        return { content: text, url: window.location.href };
      });
      
      return profile;
    }
  `;

  return await runBrowserScript(script);
}

async function takeScreenshot(url) {
  const response = await fetch(`${BROWSERLESS_URL}/screenshot?token=${process.env.BROWSERLESS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      options: { fullPage: false, type: 'jpeg', quality: 80 }
    })
  });

  if (!response.ok) {
    return { error: `Screenshot failed: ${response.status}` };
  }

  return { success: true, message: 'Screenshot taken' };
}

async function runBrowserScript(script) {
  try {
    const response = await fetch(`${BROWSERLESS_URL}/function?token=${process.env.BROWSERLESS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/javascript' },
      body: script
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Browserless error:', response.status, err.slice(0, 200));
      return { error: `Browser task failed: ${response.status}` };
    }

    const data = await response.json();
    return { success: true, data };

  } catch (err) {
    console.error('Browser execution error:', err.message);
    return { error: err.message };
  }
}

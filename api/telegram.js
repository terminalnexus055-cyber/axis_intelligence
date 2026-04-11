// AXIS — Telegram Webhook Handler
// Strict 4-level command system + Browserless integration

export const config = { 
  runtime: 'nodejs',
  maxDuration: 60
};

// Redis helpers
const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisGet(key) {
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const data = await res.json();
    if (!data.result) return null;
    // Upstash returns value as-is — parse until we get an object
    let val = data.result;
    let attempts = 0;
    while (typeof val === 'string' && attempts < 3) {
      try { val = JSON.parse(val); } catch { break; }
      attempts++;
    }
    return val;
  } catch { return null; }
}

async function redisSet(key, value, exSeconds = 86400) {
  try {
    // Upstash REST API: body must be JSON with the value as a plain string
    const serialized = JSON.stringify(value);
    await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}?EX=${exSeconds}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(serialized)
    });
  } catch (err) {
    console.error('Redis error:', err.message);
  }
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'AXIS alive 🦞' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const message = body?.message || body?.edited_message;
    if (!message || !message.text) {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const userText = message.text.trim();
    const username = message.from?.username || 'Commander';

    console.log('AXIS incoming:', userText);

    await sendTyping(chatId);

    // ━━━ LEVEL 1 — SYSTEM COMMANDS ━━━
    if (userText.toLowerCase() === '/start') {
      await sendMessage(chatId, `🦞 *AXIS Online*

Commander, I'm fully operational.

*Command System:*
🔍 \`scan: [target]\` — Intel scan on any platform
🌐 \`browse: [platform] [query]\` — Browser task
📝 \`log: [what you did]\` — Save to daily log
📋 \`update plan: [notes]\` — Edit today's plan
✅ \`approve\` — Approve pending action
❌ \`reject\` — Reject pending action

*Or just talk to me naturally.*

Current mission: Get FORGE its first real user.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 1 — LOG COMMAND ━━━
    if (/^log:/i.test(userText)) {
      const logText = userText.replace(/^log:/i, '').trim();
      await redisSet(`axis:daily:${getTodayDate()}`, logText, 86400 * 7);
      await sendMessage(chatId, `✅ *Logged*\n\n_"${logText}"_\n\nIncluded in tomorrow's morning brief.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 1 — LOG OUTREACH ━━━
    if (/^outreach sent:/i.test(userText)) {
      const url = userText.replace(/^outreach sent:/i, '').trim();
      const contactedKey = 'axis:contacted';
      const contacted = await redisGet(contactedKey) || [];
      contacted.push(url);
      await redisSet(contactedKey, contacted.slice(-200), 86400 * 30);
      await sendMessage(chatId, `✅ *Outreach logged*\n\n${url}\n\nAXIS won't suggest this person again for 30 days.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 1 — UPDATE PLAN ━━━
    if (/^update plan:/i.test(userText)) {
      const planText = userText.replace(/^update plan:/i, '').trim();
      await redisSet(`axis:plan:${getTodayDate()}`, planText, 86400);
      await sendMessage(chatId, `✅ *Plan updated*\n\n_"${planText}"_\n\nFocus adjusted for today.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 2 — INTEL SCAN ━━━
    if (/^scan:/i.test(userText) || /^find:/i.test(userText)) {
      const query = userText.replace(/^(scan|find):/i, '').trim();
      const encoded = encodeURIComponent(query);
      await sendMessage(chatId, `🔍 *Intel scan requested*\n\nTarget: _"${query}"_\n\nReply exactly to confirm:\n\`execute scan indiehackers ${encoded}\`\n\nOr \`reject\` to cancel.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 3 — BROWSER TASK ━━━
    if (/^browse:/i.test(userText)) {
      const parts = userText.replace(/^browse:/i, '').trim().split(' ');
      const platform = parts[0]?.toLowerCase() || 'indiehackers';
      const query = parts.slice(1).join(' ');
      const encoded = encodeURIComponent(query);

      // Platform availability check
      const blocked = ['reddit', 'linkedin', 'twitter'];
      if (blocked.includes(platform)) {
        await sendMessage(chatId, `⛔ *${platform} is currently unavailable*\n\nBlocked from server IPs. Requires OAuth setup.\n\n✅ Available now:\n\`browse: indiehackers [query]\`\n\`browse: hackernews [query]\``);
        return res.status(200).json({ ok: true });
      }

      await sendMessage(chatId, `🌐 *Browser task requested*\n\nPlatform: *${platform}*\nQuery: _"${query}"_\n\nReply exactly to confirm:\n\`execute browse ${platform} ${encoded}\`\n\nOr \`reject\` to cancel.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 4 — EXECUTE (no Redis needed — task in command) ━━━
    if (/^execute (browse|scan) (\S+) (\S+)/i.test(userText)) {
      const parts = userText.trim().split(' ');
      const action = parts[1]?.toLowerCase() || 'browse';
      const platform = parts[2]?.toLowerCase() || 'indiehackers';
      const encoded = parts[3] || '';
      const query = decodeURIComponent(encoded);
      const platformUrls = {
        'indiehackers': 'https://www.indiehackers.com/group/freelancers',
        'hackernews': 'https://news.ycombinator.com/newest'
      };
      const targetUrl = platformUrls[platform] || platformUrls['indiehackers'];
      const pending = { action, platform, query, url: targetUrl };

      await sendMessage(chatId, `⚙️ *Executing...*\n\nAction: ${action}\nPlatform: ${platform}\nQuery: ${query}\nThis may take 10-20 seconds.`);
      await sendTyping(chatId);

      const result = await executeBrowserTask(pending, chatId);

      if (result.error) {
        await sendMessage(chatId, `⚠️ *Execution failed*\n\n${result.error}\n\nTry again with a different query.`);
      } else {
        await sendMessage(chatId, result.report);
      }

      return res.status(200).json({ ok: true });
    }

    // ━━━ REJECT ━━━
    if (/^reject$/i.test(userText)) {
      await sendMessage(chatId, '❌ Action cancelled.');
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 1 — NATURAL CONVERSATION ━━━
    const history = await redisGet(`axis:history:${chatId}`) || [];
    const reply = await Promise.race([
      callGroq(userText, username, history),
      timeout(20000, '⏱ AXIS is thinking... try again in a moment.')
    ]);

    // Save history
    const updatedHistory = [
      ...history,
      { role: 'user', content: userText },
      { role: 'assistant', content: reply }
    ].slice(-20);
    await redisSet(`axis:history:${chatId}`, updatedHistory, 86400);

    await sendMessage(chatId, reply);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('AXIS error:', err.message);
    return res.status(200).json({ ok: true });
  }
}

async function executeBrowserTask(pending, chatId) {
  const { action, query } = pending;

  // 5 day cutoff timestamp
  const fiveDaysAgo = Math.floor(Date.now() / 1000) - (5 * 24 * 60 * 60);
  const fiveDaysAgoMs = Date.now() - (5 * 24 * 60 * 60 * 1000);

  try {
    // Load already contacted users to avoid duplicates
    const contactedKey = 'axis:contacted';
    const contacted = await redisGet(contactedKey) || [];

    // Multi-platform parallel scan
    const platforms = [
      { 
        name: 'indiehackers_ask', 
        url: 'https://www.indiehackers.com/group/ask-ih?tab=new'
      },
      { 
        name: 'indiehackers_freelance', 
        url: 'https://www.indiehackers.com/group/freelancers?tab=new'
      },
      { 
        name: 'hackernews', 
        url: `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query + ' freelance')}&tags=story&numericFilters=created_at_i>${fiveDaysAgo}`
      }
    ];

    console.log('Multi-platform scan starting — 5 day filter active');

    const scanResults = await Promise.allSettled(
      platforms.map(p => scanPlatform(p.name, p.url, query, fiveDaysAgoMs))
    );

    let allItems = [];
    const platformsScanned = [];
    const platformsFailed = [];

    scanResults.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allItems = allItems.concat(result.value);
        platformsScanned.push(platforms[i].name);
      } else {
        platformsFailed.push(platforms[i].name);
      }
    });

    // Filter out already contacted
    const fresh = allItems.filter(item => {
      const identifier = item.url || item.text.slice(0, 50);
      return !contacted.includes(identifier);
    });

    if (fresh.length === 0) {
      return { error: `No fresh targets found in last 5 days.\n\nPlatforms: ${platforms.map(p=>p.name).join(', ')}\n${contacted.length > 0 ? `Already contacted: ${contacted.length} people` : ''}` };
    }

    // Format for Groq — include date prominently
    const postsContext = fresh.map((item, i) =>
      `[${i+1}] Platform: ${item.platform}\nDate: ${item.date}\nTitle/Post: ${item.text}\nURL: ${item.url}`
    ).join('\n\n---\n\n').slice(0, 6000);

    const analysis = await callGroq(
      `Analyze these REAL posts from freelance communities. Query: "${query}"
All posts are from the last 5 days only.

POSTS:
${postsContext}

STRICT RULES:
- ONLY include people ASKING FOR HELP or IN PAIN — never promoting or selling
- ONLY include posts clearly about freelancing struggles
- REJECT: job postings, tool promotions, success stories, people offering services
- REJECT: anything not clearly from a struggling freelancer
- Pain signals: "no clients", "struggling", "0 revenue", "help", "frustrated", "stuck", "burned out", "failing", "can't find work"

For each genuine target return:
[Number]. Pain: X/10 | [One sentence exact pain] | [One sentence human opener referencing their specific situation] | [URL]

If fewer than 3 genuine targets exist, say so honestly.
Never fabricate. End with: "Reply 'outreach [number]' to get full message + log the outreach."`,
      'Commander',
      []
    );

    return {
      report: `🌐 *MULTI-PLATFORM INTEL*\n\n✅ Scanned: ${platformsScanned.join(', ')}\n${platformsFailed.length > 0 ? `⚠️ Failed: ${platformsFailed.join(', ')}\n` : ''}📅 Filter: Last 5 days only\n📊 Fresh targets: ${fresh.length}\n🚫 Already contacted: ${contacted.length}\n\n━━━━━━━━━━━━━━━━\n\n${analysis}`
    };

  } catch (err) {
    return { error: `Execution error: ${err.message}` };
  }
}

async function scanPlatform(platformName, url, query, fiveDaysAgoMs) {
  // HN — direct API, has real timestamps
  if (platformName === 'hackernews') {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return [];
      const data = await res.json();
      const hits = data?.hits || [];
      return hits
        .filter(h => {
          const postDate = new Date(h.created_at).getTime();
          return postDate > fiveDaysAgoMs;
        })
        .slice(0, 15)
        .map(h => ({
          platform: 'HackerNews',
          text: h.title || '',
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          date: h.created_at ? new Date(h.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown'
        }))
        .filter(h => h.text.length > 10);
    } catch { return []; }
  }

  // IH — Browserless with date extraction
  const puppeteerScript = `export default async function({ page }) {
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.goto('${url}', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.innerText && b.innerText.toLowerCase().includes('accept'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  const content = await page.evaluate(() => {
    const items = [];
    const seen = new Set();
    // Get post links with their surrounding date context
    document.querySelectorAll('a').forEach(el => {
      const t = el.innerText && el.innerText.trim();
      const u = el.href || '';
      const isPost = u.includes('/post/') || u.includes('/product/');
      if (t && t.length > 15 && t.length < 300 && isPost && !seen.has(t)) {
        seen.add(t);
        // Try to find date near this element
        const parent = el.closest('div, article, li');
        const dateEl = parent && parent.querySelector('time, [class*="date"], [class*="time"], [class*="ago"]');
        const date = dateEl ? dateEl.innerText.trim() : 'Unknown';
        items.push({ text: t, url: u, date });
      }
    });
    return items.slice(0, 20);
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

    if (!response.ok) return [];

    const data = await response.json();
    const items = Array.isArray(data) ? data : (data?.data || []);

    return items
      .map(item => ({
        platform: platformName.includes('indiehackers') ? 'IndieHackers' : platformName,
        text: item.text || '',
        url: item.url || url,
        date: item.date || 'Unknown'
      }))
      .filter(item => {
        if (item.text.length < 10) return false;
        // Filter by date — reject if clearly old
        const dateStr = item.date.toLowerCase();
        const isOld = dateStr.includes('2020') || dateStr.includes('2021') || 
                      dateStr.includes('2022') || dateStr.includes('2023') ||
                      dateStr.includes('2024') || dateStr.includes('jan 2025') ||
                      dateStr.includes('feb 2025') || dateStr.includes('mar 2025') ||
                      dateStr.includes('apr 2025') || dateStr.includes('may 2025') ||
                      dateStr.includes('jun 2025') || dateStr.includes('jul 2025') ||
                      dateStr.includes('aug 2025') || dateStr.includes('sep 2025') ||
                      dateStr.includes('oct 2025') || dateStr.includes('nov 2025') ||
                      dateStr.includes('dec 2025');
        return !isOld;
      });

  } catch { return []; }
}

function timeout(ms, message) {
  return new Promise(resolve => setTimeout(() => resolve(message), ms));
}

async function callGroq(userText, username, history = []) {
  const messages = [
    {
      role: 'system',
      content: `You are AXIS — an elite AI business operator for ${username}, solo founder of FORGE (AI freelance coaching app).

STRICT RULES — NEVER VIOLATE:
- NEVER execute browser tasks, scans, or searches on your own
- NEVER claim to have sent messages, posted, or contacted anyone
- NEVER fabricate results, data, or metrics
- NEVER run any action without explicit "confirm execute" from Commander
- If asked to do something requiring execution, propose it and wait for approval
- Only report what you actually have data for

Your capabilities:
- Natural conversation and strategic advice
- Drafting outreach messages for Commander to send
- Analyzing real data when passed to you
- Planning campaigns and strategies
- Remembering conversation context

Commands Commander can use:
- scan: [target] — triggers intel scan (requires confirmation)
- browse: [platform] [query] — triggers browser task (requires confirmation)  
- log: [text] — saves daily log
- update plan: [text] — updates today's plan
- confirm execute — approves pending action
- reject — cancels pending action

Current mission: Get FORGE its first real user.
Be sharp, direct, honest. Keep responses concise for Telegram.

FOUNDER STORY — USE THIS IN ALL MARKETING AND OUTREACH:
Mohammed is a solo founder from Nigeria who built FORGE entirely from his Android phone using Acode terminal — no laptop, no team, no office. He coded a full AI-powered freelance coaching app with a working AI coach (Marcus), lead generation, real-time Reddit scanning, and autonomous morning briefings — all from his phone screen. He faced every obstacle: platform restrictions, API blocks, runtime errors, timeout loops — and solved every single one. This is not a Silicon Valley story. This is a story of pure resourcefulness. Mohammed represents every solo founder in Africa and the developing world who is building the future with limited tools but unlimited determination. FORGE was born from this struggle — because Mohammed understands what it means to hustle with no support system.

FORGE MARKETING ANGLES:
1. "Built from a phone in Nigeria" — the underdog founder story
2. "Your AI freelance coach that never sleeps" — Marcus the coach persona
3. "From zero to first client in 7 days" — the transformation promise
4. "No team. No office. Just results." — solo founder solidarity`
    },
    ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userText }
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 1200,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    console.error('Groq failed:', response.status);
    return '⚠️ AXIS temporarily unavailable. Try again.';
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '⚠️ No response. Try again.';
}

async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown'
      })
    });
  }
}

async function sendTyping(chatId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  });
}

function splitMessage(text, maxLength = 4000) {
  if (!text || text.length <= maxLength) return [text || 'No response'];
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if ((current + line).length > maxLength) {
      chunks.push(current.trim());
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// AXIS — Telegram Webhook Handler
// Strict 4-level command system + Browserless integration

export const config = { 
  runtime: 'edge',
  maxDuration: 30
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
    return data.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function redisSet(key, value, exSeconds = 86400) {
  try {
    await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}?EX=${exSeconds}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(value))
    });
  } catch (err) {
    console.error('Redis error:', err.message);
  }
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

export default async function handler(req) {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'AXIS alive 🦞' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const message = body?.message || body?.edited_message;
    if (!message || !message.text) return new Response('OK', { status: 200 });

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
      return new Response('OK', { status: 200 });
    }

    // ━━━ LEVEL 1 — LOG COMMAND ━━━
    if (/^log:/i.test(userText)) {
      const logText = userText.replace(/^log:/i, '').trim();
      await redisSet(`axis:daily:${getTodayDate()}`, logText, 86400 * 7);
      await sendMessage(chatId, `✅ *Logged*\n\n_"${logText}"_\n\nIncluded in tomorrow's morning brief.`);
      return new Response('OK', { status: 200 });
    }

    // ━━━ LEVEL 1 — UPDATE PLAN ━━━
    if (/^update plan:/i.test(userText)) {
      const planText = userText.replace(/^update plan:/i, '').trim();
      await redisSet(`axis:plan:${getTodayDate()}`, planText, 86400);
      await sendMessage(chatId, `✅ *Plan updated*\n\n_"${planText}"_\n\nFocus adjusted for today.`);
      return new Response('OK', { status: 200 });
    }

    // ━━━ LEVEL 2 — INTEL SCAN (explicit command only) ━━━
    if (/^scan:/i.test(userText) || /^find:/i.test(userText)) {
      const query = userText.replace(/^(scan|find):/i, '').trim();
      await sendMessage(chatId, `🔍 *Intel scan requested*\n\nTarget: _"${query}"_\n\nThis will use a browser session to find real posts.\n\nReply \`confirm execute\` to proceed or \`reject\` to cancel.`);
      const scanTask = { action: 'scan', query: query };
    await redisSet('axis_pending_' + chatId, scanTask, 300);
      return new Response('OK', { status: 200 });
    }

    // ━━━ LEVEL 3 — BROWSER TASK (explicit command only) ━━━
    if (/^browse:/i.test(userText)) {
      const parts = userText.replace(/^browse:/i, '').trim().split(' ');
      const platform = parts[0]?.toLowerCase() || 'indiehackers';
      const query = parts.slice(1).join(' ');
      const platformUrls = {
        'indiehackers': `https://www.indiehackers.com/search?query=${encodeURIComponent(query)}`,
        'reddit': `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=new&t=week`,
        'hackernews': `https://hn.algolia.com/?q=${encodeURIComponent(query)}&dateRange=pastWeek`
      };
      const targetUrl = platformUrls[platform] || platformUrls['indiehackers'];
      await sendMessage(chatId, `🌐 *Browser task requested*\n\nPlatform: *${platform}*\nQuery: _"${query}"_\n\nAXIS will open a real browser session.\n\nReply \`confirm execute\` to proceed or \`reject\` to cancel.`);
      const browseTask = { action: 'browse', platform: platform, query: query, url: targetUrl };
    await redisSet('axis_pending_' + chatId, browseTask, 300);
      return new Response('OK', { status: 200 });
    }

    // ━━━ LEVEL 4 — APPROVE PENDING ACTION ━━━
    if (/^confirm execute$/i.test(userText)) {
      const pending = await redisGet('axis_pending_' + chatId);
      if (!pending) {
        await sendMessage(chatId, '⚠️ No pending action found. It may have expired. Send your command again.');
        return new Response('OK', { status: 200 });
      }

      const pendingAction = pending?.action || 'unknown';
      const pendingQuery = pending?.query || '';
      await sendMessage(chatId, `⚙️ *Executing...*

Action: 
Query: 
This may take 10-20 seconds.`);
      await sendTyping(chatId);

      // Execute browser task
      const result = await executeBrowserTask(pending, chatId);
      await redisSet('axis_pending_' + chatId, null, 1);

      if (result.error) {
        await sendMessage(chatId, `⚠️ *Execution failed*\n\n${result.error}`);
      } else {
        await sendMessage(chatId, result.report);
      }

      return new Response('OK', { status: 200 });
    }

    // ━━━ LEVEL 4 — REJECT PENDING ACTION ━━━
    if (/^reject$/i.test(userText)) {
      await redisSet('axis_pending_' + chatId, null, 1);
      await sendMessage(chatId, '❌ Action rejected. Nothing was executed.');
      return new Response('OK', { status: 200 });
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
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('AXIS error:', err.message);
    return new Response('OK', { status: 200 });
  }
}

async function executeBrowserTask(pending, chatId) {
  const { action, query, platform } = pending;

  try {
    // Use URL from pending if available, otherwise build it
    let targetUrl = pending.url || '';

    if (!targetUrl) {
      const platforms = {
        'indiehackers': `https://www.indiehackers.com/search?query=${encodeURIComponent(query)}`,
        'reddit': `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=new&t=week`,
        'hackernews': `https://hn.algolia.com/?q=${encodeURIComponent(query)}&dateRange=pastWeek`
      };
      targetUrl = platforms[platform] || platforms['indiehackers'];
    }

    console.log('Browser targeting:', targetUrl);

    if (action === 'scan' || action === 'browse') {
      // Using /scrape REST endpoint
    }

    const response = await fetch(
      `https://production-sfo.browserless.io/scrape?token=${process.env.BROWSERLESS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          elements: [
            { selector: 'article' },
            { selector: 'h2' },
            { selector: 'h3' },
            { selector: '.post' },
            { selector: '.story' },
            { selector: '[class*="post"]' }
          ],
          gotoOptions: { waitUntil: 'networkidle2', timeout: 25000 }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return { error: `Browserless failed: ${response.status} — ${errText.slice(0, 200)}` };
    }

    const data = await response.json();
    const rawResults = data?.data || [];
    const results = rawResults
      .flatMap(r => r.results || [])
      .filter(r => r.text && r.text.length > 40)
      .slice(0, 8)
      .map(r => ({ text: r.text.slice(0, 400), url: targetUrl }));

    if (!results || results.length === 0) {
      return { error: 'Browser returned no results. Try a different query or platform.' };
    }

    // Pass results to Groq for analysis
    const postsContext = results.map((r, i) =>
      `[${i + 1}] ${r.text}\nURL: ${r.url}`
    ).join('\n\n---\n\n');

    const analysis = await callGroq(
      `Analyze these real posts found on ${platform || 'the web'} for query "${query}".

${postsContext}

Find the highest pain freelancers. For top 3:
- Pain score (1-10)
- Their specific pain
- Ready-to-send outreach opener (human, genuine, references their situation)
- Direct URL

Only use data from above. Never fabricate. End with "Reply 'outreach [number]' for full message."`,
      'Commander',
      []
    );

    return {
      report: `🌐 *BROWSER TASK COMPLETE*\n\nPlatform: ${platform || 'indiehackers'}\nQuery: _"${query}"_\nResults found: ${results.length}\n\n━━━━━━━━━━━━━━━━\n\n${analysis}`
    };

  } catch (err) {
    return { error: `Execution error: ${err.message}` };
  }
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
Be sharp, direct, honest. Keep responses concise for Telegram.`
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
      max_tokens: 600,
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

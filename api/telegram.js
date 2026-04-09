// AXIS — Telegram Webhook Handler
// Memory via Upstash Redis + Anti-hallucination + Real Reddit scanning

export const config = { 
  runtime: 'edge',
  maxDuration: 30
};

const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;

// Redis helpers
async function redisGet(key) {
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function redisSet(key, value, exSeconds = 86400) {
  try {
    await fetch(`${UPSTASH_URL}/set/${key}?EX=${exSeconds}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(value))
    });
  } catch (err) {
    console.error('Redis set error:', err.message);
  }
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

    if (!message || !message.text) {
      return new Response('OK', { status: 200 });
    }

    const chatId = message.chat.id;
    const userText = message.text;
    const username = message.from?.username || 'Commander';

    console.log('AXIS incoming:', userText);

    await sendTyping(chatId);

    // Load conversation history from Redis
    const historyKey = `axis:history:${chatId}`;
    const rawHistory = await redisGet(historyKey);
    const history = Array.isArray(rawHistory) ? rawHistory : [];

    const isIntel = /find|search|scan|look for|freelancer|user|lead|who is struggling/i.test(userText);

    let reply;

    if (isIntel) {
      await sendMessage(chatId, '🔍 Scanning Reddit for real targets...');
      await sendTyping(chatId);

      const posts = await scanReddit(userText);

      if (posts.length === 0) {
        reply = '🔍 *INTEL REPORT*\n\nNo matching posts found this scan.\n\nTry:\n→ "Find freelancers who got ghosted"\n→ "Find freelancers with pricing problems"\n→ "Find freelancers with no income"';
        await sendMessage(chatId, reply);
        return new Response('OK', { status: 200 });
      }

      const rawReport = buildRawReport(posts);
      await sendMessage(chatId, rawReport);

      await sendTyping(chatId);
      reply = await Promise.race([
        analyzeWithGroq(posts, username, history),
        timeout(12000, '⏱ Analysis timed out. Reply "outreach [number]" for a specific person.')
      ]);
      await sendMessage(chatId, reply);

    } else {
      reply = await Promise.race([
        callGroq(userText, username, history),
        timeout(20000, '⏱ AXIS is thinking... try again in a moment.')
      ]);
      await sendMessage(chatId, reply);
    }

    // Save updated history to Redis
    const updatedHistory = [
      ...history,
      { role: 'user', content: userText },
      { role: 'assistant', content: reply }
    ].slice(-20); // Keep last 20 exchanges

    await redisSet(historyKey, updatedHistory, 86400); // 24hr expiry

    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('AXIS error:', err.message);
    return new Response('OK', { status: 200 });
  }
}

function timeout(ms, message) {
  return new Promise(resolve => setTimeout(() => resolve(message), ms));
}

function buildRawReport(posts) {
  let report = `🔍 *INTEL REPORT — ${posts.length} targets found*\n\n`;
  posts.forEach((p, i) => {
    report += `*${i + 1}. u/${p.author}* — r/${p.subreddit}\n`;
    report += `📌 ${p.title.slice(0, 80)}${p.title.length > 80 ? '...' : ''}\n`;
    report += `📅 Posted: ${p.created}\n`;
    report += `🔗 [View Post](${p.url})\n`;
    report += `${p.url}\n\n`;
  });
  report += `_Analyzing pain scores..._`;
  return report;
}

async function analyzeWithGroq(posts, username, history) {
  const postsContext = posts.map((p, i) =>
    `[${i + 1}] u/${p.author} in r/${p.subreddit}\nTitle: ${p.title}\nPost: ${p.body}`
  ).join('\n\n---\n\n');

  const prompt = `Analyze these REAL Reddit posts. Score each person's pain 1-10 for needing freelance coaching.

${postsContext}

For the TOP 3 highest pain people give:
- Pain score
- One sentence on their specific pain  
- One sentence outreach opener (human, references their exact situation, not salesy)

End with: "Reply 'outreach [number]' for a full personalized message."
Only use information from the posts above. Never fabricate anything.`;

  return await callGroq(prompt, username, history);
}

async function scanReddit(userText) {
  const queries = buildQueries(userText);
  const seen = new Set();
  const results = [];

  for (const { q, subreddit } of queries) {
    try {
      // Only get posts from last 6 months
      const twoWeeksAgo = Math.floor(Date.now() / 1000) - (14 * 24 * 60 * 60);
      let url = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(q)}&size=15&sort=desc&after=${twoWeeksAgo}`;
      if (subreddit) url += `&subreddit=${subreddit}`;

      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) continue;

      const data = await res.json();
      const posts = data?.data || [];

      for (const p of posts) {
        if (!p.author || p.author === '[deleted]' || p.author === 'AutoModerator') continue;
        if (seen.has(p.author)) continue;
        seen.add(p.author);

        results.push({
          author: p.author,
          title: p.title || '',
          body: (p.selftext || '').slice(0, 300),
          subreddit: p.subreddit || '',
          url: `https://reddit.com${p.permalink || ''}`,
          created: p.created_utc
            ? new Date(p.created_utc * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'Unknown'
        });

        if (results.length >= 5) break;
      }

      if (results.length >= 5) break;
      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      console.error('Scan error:', err.message);
    }
  }

  console.log('PullPush results:', results.length);
  return results;
}

function buildQueries(userText) {
  const lower = userText.toLowerCase();
  if (lower.includes('ghost')) return [{ q: 'client ghosted payment freelance', subreddit: 'freelance' }];
  if (lower.includes('pric')) return [{ q: 'pricing help freelance rates', subreddit: 'freelance' }];
  if (lower.includes('income') || lower.includes('money')) return [{ q: 'inconsistent income freelance', subreddit: 'freelance' }];
  return [
    { q: 'no clients struggling freelance', subreddit: 'freelance' },
    { q: 'how to get clients freelancer', subreddit: 'freelancers' }
  ];
}

async function callGroq(userText, username, history = []) {
  // Build messages with history for memory
  const messages = [
    {
      role: 'system',
      content: `You are AXIS — an elite AI business operator for ${username}, solo founder of FORGE (an AI freelance coaching app).

STRICT ANTI-HALLUCINATION RULES — NEVER VIOLATE:
- You CANNOT send messages, emails, or post on any platform
- You CANNOT access LinkedIn, Twitter, Reddit, or any website independently
- You CANNOT perform real-world actions
- NEVER claim you sent, posted, or contacted anyone
- NEVER fabricate results, responses, or metrics
- NEVER say "I found X people" unless real data was passed to you
- If asked to do something you cannot do, say clearly: "I can draft this but you'll need to send it manually"
- Only report what you actually have data for

Your real capabilities:
- Analyze real Reddit data when passed to you
- Draft outreach messages for ${username} to send manually
- Create marketing campaigns and content
- Give sharp strategic advice
- Remember our conversation history and build on it

Current mission: Get FORGE its first real user — a freelancer with genuine pain.
Be sharp, direct, honest. Never fake results. Keep responses concise for Telegram.`
    },
    // Inject conversation history for memory
    ...(Array.isArray(history) ? history : []).slice(-10).map(h => ({
      role: h.role,
      content: h.content
    })),
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
    const err = await response.text();
    console.error('Groq failed:', err.slice(0, 200));
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

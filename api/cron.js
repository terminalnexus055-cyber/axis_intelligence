// AXIS — Autonomous Daily Briefings
// Morning: 7AM | Afternoon: 2PM

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const chatId = process.env.MOHAMMED_CHAT_ID;
  const now = new Date();
  const hour = now.getUTCHours() + 1; // WAT is UTC+1

  if (hour === 7) {
    await morningBriefing(chatId);
  } else if (hour === 14) {
    await afternoonCheckIn(chatId);
  }

  return new Response('OK', { status: 200 });
}

async function morningBriefing(chatId) {
  // Opening
  await sendMessage(chatId, `🌅 *AXIS MORNING BRIEF*
${formatDate()}

Good morning Commander. Here's your daily intelligence.`);

  await sleep(1000);

  // Scan Reddit for fresh targets
  await sendMessage(chatId, '🔍 Running morning intel scan...');
  const posts = await scanReddit();
  const intelSummary = posts.length > 0
    ? `🔍 *MORNING INTEL*\n\n${posts.slice(0, 3).map((p, i) =>
        `*${i + 1}. u/${p.author}* — r/${p.subreddit}\n📌 ${p.title.slice(0, 70)}...\n🔗 ${p.url}`
      ).join('\n\n')}\n\n_Reply "analyze targets" for pain scores_`
    : '🔍 *MORNING INTEL*\n\nNo fresh targets found today. Try asking AXIS to scan a specific pain point.';

  await sendMessage(chatId, intelSummary);
  await sleep(1500);

  // Daily plan from Groq
  const plan = await callGroq(`Generate a sharp, specific daily action plan for Mohammed, solo founder of FORGE (AI freelance coaching app).

Today's focus areas:
- Primary: Finding and contacting first real FORGE user
- Secondary: Marketing campaign progress  
- Tertiary: AXIS system improvements

Format for Telegram:
🎯 *TODAY'S MISSION*
One sentence on the main goal

📋 *ACTION PLAN*
3-5 specific tasks with exact steps, not vague advice

📣 *MARKETING FOCUS*
One specific campaign idea to work on today using what Mohammed already has (his builder story, FORGE app, his journey as a solo Nigerian mobile dev)

🏆 *WIN CONDITION*
What does a successful day look like? One specific measurable outcome.

Be direct and specific. No fluff.`);

  await sendMessage(chatId, plan);
  await sleep(1000);

  await sendMessage(chatId, `━━━━━━━━━━━━━━━━
_AXIS is watching. Reply anytime to get to work._`);
}

async function afternoonCheckIn(chatId) {
  const checkIn = await callGroq(`Generate an afternoon check-in message for Mohammed, solo founder of FORGE.

It's 2PM WAT. He's been working since morning.

Format for Telegram:
☀️ *AXIS AFTERNOON CHECK-IN*

⚡ *MOMENTUM CHECK*
Ask about what's been accomplished since morning (be specific about FORGE goals)

📋 *REMAINING TODAY*
Remind him of the key tasks still to complete before end of day

🔥 *PUSH*
One sharp motivational insight — not generic, specific to his situation as a solo founder building from his phone in Nigeria with no team

Keep it under 150 words. Direct and energizing.`);

  await sendMessage(chatId, checkIn);
}

async function scanReddit() {
  const results = [];
  const seen = new Set();
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

  const queries = [
    { q: 'freelance struggle', subreddit: 'freelance' },
    { q: 'freelancer help advice', subreddit: 'freelancers' },
    { q: 'quit job freelance', subreddit: 'freelance' }
  ];

  for (const { q, subreddit } of queries) {
    try {
      const url = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(q)}&subreddit=${subreddit}&size=5&sort=desc&after=${thirtyDaysAgo}`;
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
          subreddit: p.subreddit || '',
          url: `https://reddit.com${p.permalink || ''}`
        });

        if (results.length >= 5) break;
      }
      if (results.length >= 5) break;
      await sleep(200);
    } catch (err) {
      console.error('Cron scan error:', err.message);
    }
  }

  return results;
}

// Redis helpers for daily logs
const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisGet(key) {
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function redisSet(key, value, exSeconds = 86400 * 7) {
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

function getYesterdayDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

async function callGroq(prompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are AXIS, an elite AI business operator. Be sharp, direct, specific. No fluff.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 600,
      temperature: 0.7
    })
  });

  if (!response.ok) return '⚠️ AXIS briefing generation failed. Check API keys.';
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '⚠️ No response.';
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
    await sleep(500);
  }
}

function formatDate() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function splitMessage(text, maxLength = 4000) {
  if (!text || text.length <= maxLength) return [text || ''];
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

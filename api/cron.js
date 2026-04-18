// AXIS — Autonomous Daily Briefings
// Morning: 7AM | Afternoon: 2PM

export const config = { runtime: 'nodejs', maxDuration: 60 };

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('Unauthorized');
  }

  const chatId = process.env.MOHAMMED_CHAT_ID;
  const now = new Date();
  const hour = now.getUTCHours() + 1; // WAT = UTC+1
  const watHour = hour >= 24 ? hour - 24 : hour;

  if (watHour === 7) {
    await morningBriefing(chatId);
  } else if (watHour === 14) {
    await afternoonCheckIn(chatId);
  } else {
    // Manual trigger — send morning brief regardless of time
    await morningBriefing(chatId);
  }

  return res.status(200).send('OK');
}

async function fetchTrends() {
  const sources = [
    {
      name: 'IndieHackers',
      url: 'https://www.indiehackers.com/feed.rss'
    },
    {
      name: 'HackerNews',
      url: 'https://hnrss.org/frontpage'
    },
    {
      name: 'ProductHunt',
      url: 'https://www.producthunt.com/feed'
    },
    {
      name: 'levels_io',
      url: 'https://nitter.poast.org/levelsio/rss'
    },
    {
      name: 'marc_lou',
      url: 'https://nitter.poast.org/marc_louvion/rss'
    }
  ];

  const results = [];

  for (const source of sources) {
    try {
      const res = await fetch(source.url, {
        headers: {
          'User-Agent': 'AXIS-Intel/1.0',
          'Accept': 'application/rss+xml, application/xml, text/xml'
        },
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) continue;
      const xml = await res.text();

      // Extract titles and links from RSS without external parser
      const titleMatches = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/gs)];
      const linkMatches = [...xml.matchAll(/<link>(.*?)<\/link>/gs)];

      const titles = titleMatches
        .slice(1, 8) // skip feed title, get posts
        .map(m => (m[1] || m[2] || '').trim())
        .filter(t => t.length > 20);

      if (titles.length > 0) {
        results.push({
          source: source.name,
          titles: titles.slice(0, 5)
        });
      }
    } catch (err) {
      console.error(`Trend fetch failed for ${source.name}:`, err.message);
    }
  }

  return results;
}

async function analyzeTrends(trendData) {
  if (!trendData || trendData.length === 0) return null;

  const formatted = trendData.map(t =>
    `${t.source}:\n${t.titles.map((title, i) => `  ${i+1}. ${title}`).join('\n')}`
  ).join('\n\n');

  const prompt = `Founder content analyst. Analyze these trending posts from founder/SaaS communities and extract what's converting right now.

TRENDING NOW:
${formatted}

Extract patterns in this format:
🔥 *WHAT'S CONVERTING THIS WEEK*

*Hook pattern:* [The opening structure appearing in top posts]
*Emotional angle:* [The feeling being triggered — struggle/win/insight/controversy]
*Best format:* [Thread/single post/story/video]
*Avoid:* [What's getting ignored right now]
*Mohammed's angle:* [One specific post idea using his story + this pattern]`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.4
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}

async function fetchPublicPerformance() {
  // Autonomously reads Mohammed's public Reddit post performance
  const handle = process.env.MOHAMMED_REDDIT_HANDLE;
  if (!handle) return null;

  try {
    const res = await fetch(
      `https://www.reddit.com/user/${handle}/submitted.json?limit=10`,
      {
        headers: {
          'User-Agent': 'AXIS-Intel/1.0',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(6000)
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const posts = data?.data?.children || [];

    if (posts.length === 0) return null;

    const summary = posts.slice(0, 5).map(p => ({
      title: p.data?.title?.slice(0, 80),
      upvotes: p.data?.score,
      comments: p.data?.num_comments,
      subreddit: p.data?.subreddit,
      url: `https://reddit.com${p.data?.permalink}`
    }));

    // Store in Redis for pattern learning
    await redisSet('axis:performance:reddit', summary, 86400 * 7);
    return summary;
  } catch (err) {
    console.error('Performance fetch error:', err.message);
    return null;
  }
}

async function morningBriefing(chatId) {
  // Opening
  await sendMessage(chatId, `🌅 *AXIS MORNING BRIEF*
${formatDate()}

Good morning Commander. Here's your daily intelligence.`);

  await sleep(1000);

  // Scan Reddit for fresh targets
  await sendMessage(chatId, '🔍 Running morning intel + trend scan...');

  // Fetch trends and public performance in parallel
  const [posts, trendData, perfData] = await Promise.allSettled([
    scanReddit(),
    fetchTrends(),
    fetchPublicPerformance()
  ]);

  const redditPosts = posts.status === 'fulfilled' ? posts.value : [];
  const trends = trendData.status === 'fulfilled' ? trendData.value : [];
  const performance = perfData.status === 'fulfilled' ? perfData.value : null;

  const intelSummary = redditPosts.length > 0
    ? `🔍 *MORNING INTEL*\n\n${redditPosts.slice(0, 3).map((p, i) =>
        `*${i + 1}. u/${p.author}* — r/${p.subreddit}\n📌 ${p.title.slice(0, 70)}...\n🔗 ${p.url}`
      ).join('\n\n')}\n\n_Reply "analyze targets" for pain scores_`
    : '🔍 *MORNING INTEL*\n\nNo fresh targets found today.';

  await sendMessage(chatId, intelSummary);
  await sleep(1000);

  // Send trend analysis if available
  if (trends.length > 0) {
    const trendAnalysis = await analyzeTrends(trends);
    if (trendAnalysis) {
      await redisSet('axis:trends:latest', trendAnalysis, 86400);
      await sendMessage(chatId, trendAnalysis);
      await sleep(1000);
    }
  }

  // Send performance summary if Reddit handle configured
  if (performance) {
    const topPost = performance.sort((a, b) => b.upvotes - a.upvotes)[0];
    if (topPost) {
      await sendMessage(chatId,
        `📊 *YOUR REDDIT PERFORMANCE*\n\nTop post: _"${topPost.title}"_\n⬆️ ${topPost.upvotes} upvotes | 💬 ${topPost.comments} comments\n\nAXIS is tracking your post patterns autonomously.`
      );
      await sleep(1000);
    }
  }

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
  const fiveDaysAgo = Date.now() - (5 * 24 * 60 * 60 * 1000);

  const subreddits = ['freelance', 'freelancers', 'digitalnomad'];

  for (const subreddit of subreddits) {
    try {
      const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=15`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'AXIS-Intel/1.0 (business intelligence tool)',
          'Accept': 'application/json'
        }
      });
      if (!res.ok) continue;

      const data = await res.json();
      const posts = data?.data?.children || [];

      for (const p of posts) {
        const created = p.data?.created_utc * 1000;
        if (created < fiveDaysAgo) continue;
        const author = p.data?.author;
        if (!author || author === '[deleted]' || author === 'AutoModerator') continue;
        if (seen.has(author)) continue;
        seen.add(author);

        results.push({
          author,
          title: p.data?.title || '',
          subreddit: p.data?.subreddit || subreddit,
          url: `https://reddit.com${p.data?.permalink || ''}`
        });

        if (results.length >= 5) break;
      }
      if (results.length >= 5) break;
      await sleep(300);
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

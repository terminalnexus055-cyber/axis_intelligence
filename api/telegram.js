// AXIS — Telegram Webhook Handler
// Real Reddit scanning via PullPush

export const config = { 
  runtime: 'edge',
  maxDuration: 30
};

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

    // Detect intent
    const isIntel = /find|search|scan|look for|freelancer|user|lead|who is struggling/i.test(userText);
    const isOutreach = /draft|write|message|reach out|outreach|contact/i.test(userText);
    const isMarketing = /campaign|market|promote|content|post|tweet|audience/i.test(userText);

    let reply;

    if (isIntel) {
      await sendMessage(chatId, '🔍 Scanning Reddit for real targets...');
      await sendTyping(chatId);
      const posts = await scanReddit(userText);
      reply = await buildIntelReport(posts, userText, username);
    } else {
      reply = await callGroq(userText, username, null);
    }

    await sendMessage(chatId, reply);
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('AXIS error:', err.message);
    return new Response('OK', { status: 200 });
  }
}

async function scanReddit(userText) {
  const queries = buildQueries(userText);
  const seen = new Set();
  const results = [];

  for (const { q, subreddit } of queries) {
    try {
      let url = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(q)}&size=8&sort=desc`;
      if (subreddit) url += `&subreddit=${subreddit}`;

      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        console.error('PullPush error:', res.status);
        continue;
      }

      const data = await res.json();
      const posts = data?.data || [];

      for (const p of posts) {
        if (seen.has(p.author)) continue;
        seen.add(p.author);

        // Filter out deleted/bot accounts
        if (!p.author || p.author === '[deleted]' || p.author === 'AutoModerator') continue;

        results.push({
          author: p.author,
          title: p.title || '',
          body: (p.selftext || '').slice(0, 400),
          subreddit: p.subreddit || '',
          url: `https://reddit.com${p.permalink || ''}`,
          created: p.created_utc ? new Date(p.created_utc * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown'
        });

        if (results.length >= 6) break;
      }

      if (results.length >= 6) break;

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

  if (lower.includes('ghost')) return [
    { q: 'client ghosted payment', subreddit: 'freelance' },
    { q: 'ghosted by client freelancer', subreddit: 'freelancers' }
  ];
  if (lower.includes('pric')) return [
    { q: 'pricing help freelance rates', subreddit: 'freelance' },
    { q: 'how much charge freelance', subreddit: 'freelancers' }
  ];
  if (lower.includes('income') || lower.includes('money')) return [
    { q: 'inconsistent income freelance', subreddit: 'freelance' },
    { q: 'freelance income dry spell', subreddit: 'freelancers' }
  ];

  // Default — finding clients
  return [
    { q: 'no clients struggling freelance', subreddit: 'freelance' },
    { q: 'how to get clients freelancer', subreddit: 'freelancers' },
    { q: 'freelance work slow no projects', subreddit: 'freelance' }
  ];
}

async function buildIntelReport(posts, userText, username) {
  if (posts.length === 0) {
    return `🔍 *INTEL REPORT*\n\nNo matching posts found this scan.\n\nTry:\n→ "Find freelancers who got ghosted by clients"\n→ "Find freelancers with pricing problems"\n→ "Find freelancers with inconsistent income"`;
  }

  const postsContext = posts.map((p, i) =>
    `[${i + 1}] u/${p.author} in r/${p.subreddit} (${p.created})\nTitle: ${p.title}\nPost: ${p.body}\nURL: ${p.url}`
  ).join('\n\n---\n\n');

  const prompt = `You are AXIS, an elite business operator for ${username} who is building FORGE — an AI freelance coaching app.

Analyze these REAL Reddit posts and find the highest pain targets for FORGE outreach.

REAL REDDIT DATA:
${postsContext}

For each person, assess:
- Pain score (1-10) — how badly do they need help RIGHT NOW
- What their specific pain is
- Why FORGE solves their exact problem
- A short, human outreach message (2-3 sentences, not salesy, references their specific situation)

Format your response clearly for Telegram. Start with the highest pain person first.
End with: "Reply 'outreach [number]' to get a full personalized message for that person."

Only include people with pain score 6 or above. Be honest — if posts aren't relevant, say so.`;

  return await callGroq(prompt, username, null);
}

async function callGroq(userText, username, customSystem) {
  const systemPrompt = customSystem || `You are AXIS — an elite AI business operator for ${username}, a solo founder building FORGE (an AI freelance coaching app).

Be sharp, direct, human. Talk like a brilliant co-founder, not a robot.
Help find high-pain freelancers, create marketing campaigns, draft outreach, give strategic advice.
Current mission: Get FORGE its first real user — a freelancer with genuine 10/10 pain.
Keep responses concise for Telegram.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText }
      ],
      max_tokens: 1000,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Groq failed:', err.slice(0, 200));
    return '⚠️ AXIS temporarily unavailable. Try again in a moment.';
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

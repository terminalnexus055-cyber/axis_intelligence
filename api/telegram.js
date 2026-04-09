// AXIS — Telegram Webhook Handler
// Real Reddit scanning via PullPush + fast response

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

    const isIntel = /find|search|scan|look for|freelancer|user|lead|who is struggling/i.test(userText);

    if (isIntel) {
      await sendMessage(chatId, '🔍 Scanning Reddit for real targets...');
      await sendTyping(chatId);

      // Run scan and Groq in parallel with a race timeout
      const posts = await scanReddit(userText);

      if (posts.length === 0) {
        await sendMessage(chatId, '🔍 *INTEL REPORT*\n\nNo matching posts found this scan.\n\nTry:\n→ "Find freelancers who got ghosted"\n→ "Find freelancers with pricing problems"\n→ "Find freelancers with no income"');
        return new Response('OK', { status: 200 });
      }

      // Send raw results immediately — fast, no Groq needed
      const rawReport = buildRawReport(posts);
      await sendMessage(chatId, rawReport);

      // Then send Groq analysis as follow-up with timeout protection
      await sendTyping(chatId);
      const analysis = await Promise.race([
        analyzeWithGroq(posts, username),
        timeout(12000, '⏱ Analysis timed out. Reply "analyze [number]" for a specific person.')
      ]);
      await sendMessage(chatId, analysis);

    } else {
      const reply = await Promise.race([
        callGroq(userText, username),
        timeout(20000, '⏱ AXIS is thinking... try again in a moment.')
      ]);
      await sendMessage(chatId, reply);
    }

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
    report += `📅 ${p.created}\n`;
    report += `🔗 ${p.url}\n\n`;
  });

  report += `_Analyzing pain scores..._`;
  return report;
}

async function analyzeWithGroq(posts, username) {
  const postsContext = posts.map((p, i) =>
    `[${i + 1}] u/${p.author} in r/${p.subreddit}\nTitle: ${p.title}\nPost: ${p.body}`
  ).join('\n\n---\n\n');

  const prompt = `Analyze these real Reddit posts. Score each person's pain 1-10 for needing freelance coaching help.

${postsContext}

For the TOP 3 highest pain people, give:
- Pain score
- One sentence on their specific pain
- One sentence ready-to-send outreach (human, not salesy, references their situation)

End with: "Reply 'outreach [number]' for a full personalized message."
Keep it concise for Telegram.`;

  return await callGroq(prompt, username);
}

async function scanReddit(userText) {
  const queries = buildQueries(userText);
  const seen = new Set();
  const results = [];

  for (const { q, subreddit } of queries) {
    try {
      let url = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(q)}&size=8&sort=desc`;
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
  if (lower.includes('ghost')) return [
    { q: 'client ghosted payment freelance', subreddit: 'freelance' }
  ];
  if (lower.includes('pric')) return [
    { q: 'pricing help freelance rates', subreddit: 'freelance' }
  ];
  if (lower.includes('income') || lower.includes('money')) return [
    { q: 'inconsistent income freelance', subreddit: 'freelance' }
  ];
  return [
    { q: 'no clients struggling freelance', subreddit: 'freelance' },
    { q: 'how to get clients freelancer', subreddit: 'freelancers' }
  ];
}

async function callGroq(userText, username) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are AXIS — an elite AI business operator for ${username}, a solo founder building FORGE (an AI freelance coaching app). Be sharp, direct, human. Current mission: Get FORGE its first real user. Keep responses concise for Telegram.`
        },
        { role: 'user', content: userText }
      ],
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

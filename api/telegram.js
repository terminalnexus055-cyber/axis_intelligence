// AXIS — Telegram Webhook Handler
// Full operator with real Reddit scanning

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

    // Detect if this needs real Reddit scan
    const needsScan = /find|search|scan|look for|freelancer|user|lead|who is struggling|reddit/i.test(userText);

    let reply;

    if (needsScan) {
      await sendMessage(chatId, '🔍 Scanning Reddit for real targets...');
      await sendTyping(chatId);
      
      const redditData = await scanReddit(userText);
      reply = await analyzeAndRespond(userText, username, redditData);
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

async function scanReddit(query) {
  const subreddits = ['freelance', 'freelancers', 'forhire', 'upwork', 'digitalnomad'];
  const searchTerms = extractTerms(query);
  const results = [];

  for (const term of searchTerms.slice(0, 2)) {
    try {
      const encoded = encodeURIComponent(term);
      const url = `https://www.reddit.com/search.json?q=${encoded}&sort=new&limit=8&t=week`;
      
      const res = await fetch(url, {
        headers: { 
          'User-Agent': 'AXIS-Intelligence/1.0',
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        console.error('Reddit fetch failed:', res.status);
        continue;
      }

      const data = await res.json();
      const posts = data?.data?.children || [];

      for (const post of posts) {
        const p = post.data;
        if (subreddits.some(sub => p.subreddit?.toLowerCase().includes(sub))) {
          results.push({
            author: p.author,
            title: p.title,
            body: p.selftext?.slice(0, 400) || '',
            subreddit: p.subreddit,
            url: `https://reddit.com${p.permalink}`,
            created: new Date(p.created_utc * 1000).toLocaleDateString()
          });
        }
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      console.error('Reddit scan error:', err.message);
    }
  }

  console.log('Reddit results found:', results.length);
  return results.slice(0, 5);
}

function extractTerms(query) {
  const lower = query.toLowerCase();
  
  if (lower.includes('ghost')) return ['freelancer ghosted client site:reddit.com', 'client ghosted freelancer'];
  if (lower.includes('pric')) return ['freelance pricing struggle help'];
  if (lower.includes('client')) return ['no freelance clients struggling', 'how to get freelance clients'];
  if (lower.includes('income') || lower.includes('money')) return ['inconsistent freelance income help'];
  
  return ['freelancer no clients struggling', 'freelance income problem'];
}

async function analyzeAndRespond(userText, username, redditPosts) {
  const systemPrompt = `You are AXIS — an elite AI business operator for ${username}, building FORGE (an AI freelance coaching app).

FORGE targets freelancers with real pain: no clients, ghosting, pricing struggles, inconsistent income.
Current mission: Find FORGE's first real user and hand ${username} a ready-to-send outreach message.

Be sharp and direct. Format responses cleanly for Telegram.`;

  let context = '';

  if (redditPosts.length > 0) {
    context = `\n\nREAL REDDIT DATA FOUND RIGHT NOW:\n\n`;
    redditPosts.forEach((p, i) => {
      context += `[${i + 1}] u/${p.author} in r/${p.subreddit} (${p.created})\n`;
      context += `Title: ${p.title}\n`;
      if (p.body) context += `Post: ${p.body}\n`;
      context += `URL: ${p.url}\n\n`;
    });
    context += `\nAnalyze each person above. Score their pain 1-10. For the highest scoring person, write a ready-to-send outreach message that feels human and genuine — not salesy. Reference their specific situation. End with their Reddit URL so Commander can find them.`;
  } else {
    context = `\n\nReddit scan returned no results this time. Tell the user honestly and suggest they try a more specific search term, or check r/freelance manually. Suggest 3 specific search terms they could ask AXIS to scan.`;
  }

  return await callGroq(userText + context, username, systemPrompt);
}

async function callGroq(userText, username, customSystem = null) {
  const systemPrompt = customSystem || `You are AXIS — an elite AI business operator for ${username}, a solo founder building FORGE (an AI freelance coaching app).

Be sharp, direct, human. Talk like a brilliant co-founder.
Help find high-pain freelancers, create marketing campaigns, draft outreach, give strategic advice.
Current mission: Get FORGE its first real user.
Keep responses concise for Telegram. Be genuinely helpful.`;

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
    return '⚠️ AXIS is having trouble connecting right now. Try again in a moment.';
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

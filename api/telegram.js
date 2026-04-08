// AXIS — Telegram Webhook Handler

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

    console.log('AXIS incoming:', userText, 'from:', username);

    // Send typing
    await sendTyping(chatId);

    // Get reply synchronously
    const reply = await callAxis(userText, username);

    console.log('AXIS reply length:', reply?.length);

    // Send reply
    await sendMessage(chatId, reply);

    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('AXIS error:', err.message);
    return new Response('OK', { status: 200 });
  }
}

async function callAxis(userText, username) {
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const systemPrompt = `You are AXIS — an elite AI business operator for ${username}, a solo founder building FORGE (an AI freelance coaching app).

Be sharp, direct, human. Talk like a brilliant co-founder.
Your job: help find high-pain freelancers, create marketing campaigns, draft outreach, give strategic advice.
Current mission: Get FORGE its first real user.
Target: Freelancers struggling with getting clients, pricing, ghosting, inconsistent income.
Keep responses concise for Telegram. Be genuinely helpful.`;

  console.log('Calling Gemini...');

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800
        }
      })
    });

    console.log('Gemini status:', response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini failed:', errText.slice(0, 300));
      throw new Error(`Gemini ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      console.error('Gemini empty response:', JSON.stringify(data).slice(0, 300));
      throw new Error('Gemini empty');
    }

    console.log('Gemini success');
    return text;

  } catch (err) {
    console.error('Gemini error, trying Groq:', err.message);
    return await callGroq(userText, systemPrompt);
  }
}

async function callGroq(userText, systemPrompt) {
  console.log('Calling Groq backup...');

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
      max_tokens: 800,
      temperature: 0.7
    })
  });

  console.log('Groq status:', response.status);

  if (!response.ok) {
    const errText = await response.text();
    console.error('Groq failed:', errText.slice(0, 300));
    return '⚠️ AXIS is having trouble connecting. Both Gemini and Groq are unreachable. Check API keys in Vercel env vars.';
  }

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content;

  if (!result) {
    return '⚠️ AXIS got empty response from backup. Try again.';
  }

  console.log('Groq success');
  return `⚡ ${result}`;
}

async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chunks = splitMessage(text);

  for (const chunk of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown'
      })
    });
    console.log('Telegram send status:', res.status);
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

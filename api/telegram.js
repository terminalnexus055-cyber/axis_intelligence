// AXIS — Telegram Webhook Handler

export const config = { runtime: 'edge' };

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

    // Return 200 immediately AND process using waitUntil
    const response = new Response('OK', { status: 200 });

    // Use EdgeRuntime.waitUntil to process after response
    const processing = handleMessage(chatId, userText, username);
    
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(processing);
    } else {
      // Fallback - fire and forget
      processing.catch(console.error);
    }

    return response;

  } catch (err) {
    console.error('AXIS webhook error:', err.message);
    return new Response('OK', { status: 200 });
  }
}

async function handleMessage(chatId, userText, username) {
  try {
    await sendTyping(chatId);

    // Call Gemini directly here to avoid import issues
    const reply = await callAxis(userText, username);
    await sendMessage(chatId, reply);

  } catch (err) {
    console.error('AXIS handle error:', err.message);
    await sendMessage(chatId, `⚠️ AXIS error: ${err.message}`);
  }
}

async function callAxis(userText, username) {
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const systemPrompt = `You are AXIS — an elite AI business operator for ${username}, a solo founder building FORGE (an AI freelance coaching app).

Be sharp, direct, human. Talk like a brilliant co-founder.
Your job: help find high-pain freelancers, create marketing campaigns, draft outreach, give strategic advice.

Current mission: Get FORGE its first real user.
Target: Freelancers struggling with getting clients, pricing, ghosting, inconsistent income.

Keep responses concise for Telegram. Use emojis sparingly. Be genuinely helpful.`;

  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800
    }
  });

  let response;
  try {
    response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
  } catch (fetchErr) {
    // Gemini network failed — try Groq
    return await callGroq(userText, username, systemPrompt);
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error('Gemini error:', response.status, errText.slice(0, 200));
    return await callGroq(userText, username, systemPrompt);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    console.error('Gemini empty:', JSON.stringify(data).slice(0, 200));
    return await callGroq(userText, username, systemPrompt);
  }

  return text;
}

async function callGroq(userText, username, systemPrompt) {
  console.log('Falling back to Groq...');
  
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

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Both Gemini and Groq failed. Groq: ${response.status} ${errText.slice(0, 100)}`);
  }

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content || 'AXIS is temporarily offline.';
  return `⚡ ${result}`;
}

export async function sendMessage(chatId, text) {
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
  for (const line of (text || '').split('\n')) {
    if ((current + line).length > maxLength) {
      chunks.push(current.trim());
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// AXIS — Telegram Webhook Handler

import { processMessage } from './gemini.js';
import { log } from '../lib/logger.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  // Handle GET - health check
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'AXIS alive 🦞' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Respond to Telegram IMMEDIATELY — prevents timeout
  res.status(200).json({ ok: true });

  // Process in background after response sent
  try {
    const body = req.body;
    const message = body?.message || body?.edited_message;

    if (!message) return;

    const chatId = message.chat.id;
    const userText = message.text || '';
    const username = message.from?.username || 'Commander';

    if (!userText) return;

    await log({
      type: 'INCOMING',
      from: username,
      chatId,
      text: userText,
      timestamp: new Date().toISOString()
    });

    // Send typing indicator
    await sendTyping(chatId);

    // Get AXIS response
    const response = await processMessage(userText, username, chatId);

    // Send response
    await sendMessage(chatId, response);

  } catch (err) {
    console.error('AXIS processing error:', err.message);
  }
}

export async function sendMessage(chatId, text, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chunks = splitMessage(text);

  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
        ...options
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

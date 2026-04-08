// AXIS — Telegram Webhook Handler
// Entry point for all incoming messages

import { processMessage } from './gemini.js';
import { log } from '../lib/logger.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('AXIS is alive 🦞', { status: 200 });
  }

  try {
    const body = await req.json();
    const message = body?.message || body?.edited_message;

    if (!message) {
      return new Response('OK', { status: 200 });
    }

    const chatId = message.chat.id;
    const text = message.text || '';
    const username = message.from?.username || 'Commander';

    // Log incoming message
    await log({
      type: 'INCOMING',
      from: username,
      chatId,
      text,
      timestamp: new Date().toISOString()
    });

    // Process in background — respond immediately to Telegram
    processAndRespond(chatId, text, username);

    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('AXIS Telegram error:', err);
    return new Response('OK', { status: 200 });
  }
}

async function processAndRespond(chatId, text, username) {
  try {
    // Send typing indicator
    await sendTyping(chatId);

    // Get AXIS response
    const response = await processMessage(text, username, chatId);

    // Send response back
    await sendMessage(chatId, response);

  } catch (err) {
    console.error('AXIS processing error:', err);
    await sendMessage(chatId, `⚠️ AXIS hit an error. Logging and recovering...\n\`${err.message}\``);
  }
}

export async function sendMessage(chatId, text, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  // Split long messages
  const chunks = splitMessage(text);

  for (const chunk of chunks) {
    await fetch(url, {
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
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let current = '';
  const lines = text.split('\n');
  for (const line of lines) {
    if ((current + line).length > maxLength) {
      chunks.push(current.trim());
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// AXIS — Gemini 2.0 Flash Brain
// The Commander that understands intent and routes to departments

import { safetyCheck } from '../lib/safety.js';
import { getConstitution } from '../lib/constitution.js';
import { log } from '../lib/logger.js';
import { findUsers } from './intel.js';
import { createCampaign } from './marketing.js';
import { draftOutreach } from './outreach.js';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// Conversation memory per chat
const conversationHistory = new Map();

export async function processMessage(text, username, chatId) {
  const constitution = getConstitution();
  const history = conversationHistory.get(chatId) || [];

  // Build context
  const systemPrompt = `
You are AXIS — an elite AI business operator and personal executive assistant for ${username}, a solo founder building FORGE (an AI-powered freelance coaching web app).

YOUR PERSONALITY:
- Sharp, direct, human. Talk like a brilliant co-founder, not a robot.
- Proactive. Spot opportunities without being asked.
- Honest. If something won't work, say so.
- Concise in chat, detailed in reports.

YOUR DEPARTMENTS:
- 🔍 INTEL: Find high-pain freelancers (65% priority), partners (20%)
- 📣 MARKETING: Create campaigns using what Mohammed already has (15%)
- 🤝 OUTREACH: Draft personalized messages
- 🎯 STRATEGY: Spot opportunities, advise decisions
- ⚙️ OPS: Coordinate, report, execute tasks

FORGE CONSTITUTION:
${constitution}

ROUTING RULES:
- If user wants to find users/leads → trigger INTEL
- If user wants campaigns/content → trigger MARKETING  
- If user wants to message someone → trigger OUTREACH
- If user wants advice/analysis → trigger STRATEGY
- General conversation → respond naturally as AXIS

Always respond in this format for department tasks:
[DEPARTMENT: INTEL/MARKETING/OUTREACH/STRATEGY/CHAT]
[ACTION: what you're doing]
[RESULT: the actual output]

For casual chat — just talk naturally. No format needed.

SAFETY: Never fabricate data. Never modify FORGE files. Always cite sources.
  `.trim();

  // Add to history
  history.push({ role: 'user', parts: [{ text }] });

  // Detect intent first
  const intent = await detectIntent(text);

  // Safety check
  const safe = await safetyCheck(text, intent);
  if (!safe.approved) {
    return `⚠️ *AXIS Safety Lock*\n\n${safe.reason}\n\nTell me more about what you need and I'll find a safe way to do it.`;
  }

  // Route to department if needed
  if (intent.department && intent.confidence > 70) {
    const deptResponse = await routeToDepartment(intent, text, chatId);
    if (deptResponse) {
      history.push({ role: 'model', parts: [{ text: deptResponse }] });
      conversationHistory.set(chatId, history.slice(-20)); // Keep last 20 messages
      return deptResponse;
    }
  }

  // General Gemini conversation
  try {
    const response = await callGemini(systemPrompt, history);
    history.push({ role: 'model', parts: [{ text: response }] });
    conversationHistory.set(chatId, history.slice(-20));
    return response;
  } catch (err) {
    console.error('Gemini failed, trying Groq backup:', err);
    return await callGroqBackup(systemPrompt, text, history);
  }
}

async function detectIntent(text) {
  const lower = text.toLowerCase();

  // Intel triggers
  if (/(find|search|scout|look for|get me).*(user|freelancer|lead|person|people|partner)/i.test(text)) {
    return { department: 'INTEL', confidence: 90, type: 'find_users' };
  }

  // Marketing triggers
  if (/(campaign|market|promote|content|post|tweet|ad|audience)/i.test(text)) {
    return { department: 'MARKETING', confidence: 85, type: 'create_campaign' };
  }

  // Outreach triggers
  if (/(message|reach out|dm|contact|send|write to|outreach)/i.test(text)) {
    return { department: 'OUTREACH', confidence: 85, type: 'draft_outreach' };
  }

  // Strategy triggers
  if (/(advise|strategy|think|analyse|analyze|opportunity|should i|what do you think)/i.test(text)) {
    return { department: 'STRATEGY', confidence: 80, type: 'strategic_advice' };
  }

  return { department: 'CHAT', confidence: 100, type: 'conversation' };
}

async function routeToDepartment(intent, text, chatId) {
  try {
    switch (intent.department) {
      case 'INTEL':
        return await findUsers(text, chatId);
      case 'MARKETING':
        return await createCampaign(text, chatId);
      case 'OUTREACH':
        return await draftOutreach(text, chatId);
      default:
        return null;
    }
  } catch (err) {
    await log({ type: 'DEPT_ERROR', department: intent.department, error: err.message });
    return null;
  }
}

export async function callGemini(systemPrompt, history = [], text = null) {
  const apiKey = process.env.GEMINI_API_KEY;

  const contents = text
    ? [{ role: 'user', parts: [{ text }] }]
    : history;

  const response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1500,
        topP: 0.9
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini.';
}

export async function callGroqBackup(systemPrompt, text, history = []) {
  const apiKey = process.env.GROQ_API_KEY;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10).map(h => ({
      role: h.role === 'model' ? 'assistant' : 'user',
      content: h.parts[0].text
    })),
    { role: 'user', content: text }
  ];

  const response = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 1500,
      temperature: 0.7
    })
  });

  if (!response.ok) throw new Error(`Groq backup also failed: ${response.status}`);

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content || 'AXIS is temporarily offline.';
  return `⚡ *(Groq backup active)*\n\n${result}`;
}

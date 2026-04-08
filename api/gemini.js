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

const conversationHistory = new Map();

export async function processMessage(userText, username, chatId) {
  const constitution = getConstitution();
  const history = conversationHistory.get(chatId) || [];

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

For casual chat — just talk naturally. No format needed.
SAFETY: Never fabricate data. Never modify FORGE files. Always cite sources.
  `.trim();

  history.push({ role: 'user', parts: [{ text: userText }] });

  const intent = detectIntent(userText);

  const safe = await safetyCheck(userText, intent);
  if (!safe.approved) {
    return `⚠️ *AXIS Safety Lock*\n\n${safe.reason}\n\nTell me more and I'll find a safe way to help.`;
  }

  if (intent.department !== 'CHAT' && intent.confidence > 70) {
    try {
      const deptResponse = await routeToDepartment(intent, userText, chatId);
      if (deptResponse) {
        history.push({ role: 'model', parts: [{ text: deptResponse }] });
        conversationHistory.set(chatId, history.slice(-20));
        return deptResponse;
      }
    } catch (err) {
      await log({ type: 'DEPT_ERROR', department: intent.department, error: err.message });
    }
  }

  try {
    const reply = await callGemini(systemPrompt, history);
    history.push({ role: 'model', parts: [{ text: reply }] });
    conversationHistory.set(chatId, history.slice(-20));
    return reply;
  } catch (err) {
    console.error('Gemini failed, trying Groq backup:', err.message);
    return await callGroqBackup(systemPrompt, userText, history);
  }
}

function detectIntent(userText) {
  if (/(find|search|scout|look for|get me).*(user|freelancer|lead|person|people|partner)/i.test(userText)) {
    return { department: 'INTEL', confidence: 90, type: 'find_users' };
  }
  if (/(campaign|market|promote|content|post|tweet|ad|audience)/i.test(userText)) {
    return { department: 'MARKETING', confidence: 85, type: 'create_campaign' };
  }
  if (/(message|reach out|dm|contact|send|write to|outreach)/i.test(userText)) {
    return { department: 'OUTREACH', confidence: 85, type: 'draft_outreach' };
  }
  if (/(advise|strategy|think|analyse|analyze|opportunity|should i|what do you think)/i.test(userText)) {
    return { department: 'STRATEGY', confidence: 80, type: 'strategic_advice' };
  }
  return { department: 'CHAT', confidence: 100, type: 'conversation' };
}

async function routeToDepartment(intent, userText, chatId) {
  switch (intent.department) {
    case 'INTEL': return await findUsers(userText, chatId);
    case 'MARKETING': return await createCampaign(userText, chatId);
    case 'OUTREACH': return await draftOutreach(userText, chatId);
    default: return null;
  }
}

export async function callGemini(systemPrompt, history = [], inputText = null) {
  const apiKey = process.env.GEMINI_API_KEY;

  const contents = inputText
    ? [{ role: 'user', parts: [{ text: inputText }] }]
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

  const rawBody = await response.text();
  console.log('Gemini status:', response.status);
  console.log('Gemini raw:', rawBody.slice(0, 300));

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} — ${rawBody.slice(0, 200)}`);
  }

  let data;
  try {
    data = JSON.parse(rawBody);
  } catch (e) {
    throw new Error(`Gemini response not JSON: ${rawBody.slice(0, 200)}`);
  }

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
  }

  const outputText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!outputText) {
    console.error('Gemini empty candidate:', JSON.stringify(data));
    throw new Error('Gemini returned empty response');
  }

  return outputText;
}

export async function callGroqBackup(systemPrompt, userText, history = []) {
  const apiKey = process.env.GROQ_API_KEY;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10).map(h => ({
      role: h.role === 'model' ? 'assistant' : 'user',
      content: h.parts[0].text
    })),
    { role: 'user', content: userText }
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

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Groq backup failed: ${response.status} — ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content || 'AXIS is temporarily offline.';
  return `⚡ *(Groq backup active)*\n\n${result}`;
}

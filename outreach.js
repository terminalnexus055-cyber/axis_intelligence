// AXIS — Outreach Agent
// Drafts personalized, human outreach messages

import { callGemini, callGroqBackup } from './gemini.js';
import { log } from '../lib/logger.js';

const OUTREACH_SYSTEM = `
You are the AXIS Outreach Agent — a master of human connection and cold outreach.

Your messages:
- Sound like a real human, never a salesperson
- Reference the person's SPECIFIC pain, not generic flattery  
- Are short (3-5 sentences max for cold outreach)
- Have ONE clear, low-friction ask
- Never mention price or features in first contact
- Feel like help, not sales

FORGE CONTEXT:
FORGE is an AI freelance coaching app. The goal of outreach is to invite someone to try it FREE and give honest feedback — not to sell them anything.

The founder built FORGE from his phone as a solo Nigerian developer. This story is authentic and relatable. Use it when natural.
`;

export async function draftOutreach(query, chatId) {
  const prompt = `
Draft outreach messages based on this request: "${query}"

Create 3 variations:
1. DIRECT — Gets straight to the point
2. STORY — Leads with the founder's authentic journey  
3. EMPATHY — Leads with understanding their pain

For each variation provide:
- PLATFORM: Reddit DM / X DM / WhatsApp / Email
- MESSAGE: The full message
- TONE: Description of the approach
- WHY THIS WORKS: One sentence explanation

Keep all messages under 100 words. Human. Genuine. No buzzwords.
`;

  try {
    const response = await callGemini(OUTREACH_SYSTEM, [], prompt);
    await log({ type: 'OUTREACH_DRAFT', query, timestamp: new Date().toISOString() });
    return formatOutreachReport(response, query);
  } catch (err) {
    const backup = await callGroqBackup(OUTREACH_SYSTEM, prompt);
    return formatOutreachReport(backup, query);
  }
}

function formatOutreachReport(content, query) {
  return `🤝 *OUTREACH DRAFTS*\n\nFor: _"${query}"_\n\n━━━━━━━━━━━━━━━━\n\n${content}\n\n━━━━━━━━━━━━━━━━\n\nReply *"use variation [1/2/3]"* to refine further\nReply *"personalize for [username]"* for a specific person`;
}

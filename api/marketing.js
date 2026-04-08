// AXIS — Marketing Agent
// Creates campaigns using what Mohammed already has

import { callGemini, callGroqBackup } from './gemini.js';
import { log } from '../lib/logger.js';
import { getConstitution } from '../lib/constitution.js';

const MARKETING_SYSTEM = `
You are the AXIS Marketing Agent — a genius growth strategist for solo founders.

Your specialty: Creating high-converting marketing with ZERO budget, using only what the founder already has.

FORGE ASSETS:
- A working AI freelance coaching app (forge-app-se6a.vercel.app)
- A real builder story: built entirely from a phone, solo, against all odds
- Marcus: an AI coach persona inside FORGE
- The founder's authentic journey as a Nigerian solo dev

MARKETING PRINCIPLES:
- Authenticity beats polish every time
- The builder story IS the marketing
- Specificity beats generic
- One clear CTA per campaign
- Distribution before creation

Always create campaigns that feel human, not corporate.
`;

export async function createCampaign(query, chatId) {
  const constitution = getConstitution();

  const prompt = `
Create a marketing campaign based on this request: "${query}"

FORGE Constitution for context:
${constitution}

Return a complete campaign with:
1. PLATFORM: Where to post this
2. HOOK: The opening line that stops the scroll
3. BODY: Full post content (platform appropriate length)
4. CTA: One clear call to action
5. HASHTAGS: If relevant
6. TIMING: Best time to post
7. FOLLOW_UP: What to do after posting

Make it feel like a real human wrote it. Not corporate. Not AI-generated looking.
The founder's story of building from a phone in Nigeria is gold — use it when relevant.
`;

  try {
    const response = await callGemini(MARKETING_SYSTEM, [], prompt);
    await log({ type: 'MARKETING_CAMPAIGN', query, timestamp: new Date().toISOString() });
    return formatCampaignReport(response, query);
  } catch (err) {
    const backup = await callGroqBackup(MARKETING_SYSTEM, prompt);
    return formatCampaignReport(backup, query);
  }
}

function formatCampaignReport(content, query) {
  return `📣 *MARKETING CAMPAIGN*\n\nRequest: _"${query}"_\n\n━━━━━━━━━━━━━━━━\n\n${content}\n\n━━━━━━━━━━━━━━━━\n\nReply *"refine this"* to adjust\nReply *"create another angle"* for alternatives`;
}

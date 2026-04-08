// AXIS — Autonomous Morning Briefing
// Runs every morning at 7AM, reports to Mohammed on Telegram

import { findUsers } from './intel.js';
import { sendMessage } from './telegram.js';
import { log } from '../lib/logger.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  // Verify this is a legitimate cron call
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const chatId = process.env.MOHAMMED_CHAT_ID;

  try {
    await log({ type: 'CRON_START', job: 'morning_briefing' });

    // Send opening
    await sendMessage(chatId, `🌅 *AXIS MORNING BRIEF*\n_${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}_\n\nRunning intel scan... 🔍`);

    // Run parallel intel scan
    const [generalScan, pricingScan] = await Promise.all([
      findUsers('find freelancers struggling with getting clients', chatId),
      findUsers('find freelancers complaining about income or pricing', chatId)
    ]);

    // Send intel results
    await sendMessage(chatId, generalScan);

    // Small delay between messages
    await new Promise(r => setTimeout(r, 2000));

    // Send opportunities section
    const opportunitiesMsg = `
💡 *OPPORTUNITIES TODAY*

→ Reply *"find [pain point]"* to run a targeted scan
→ Reply *"create campaign"* to generate marketing content  
→ Reply *"draft outreach for [username]"* to write a message
→ Reply *"what should I focus on today"* for strategic advice

━━━━━━━━━━━━━━━━
*FORGE Mission Status:*
🎯 Goal: First real user live session
📊 Priority: User acquisition (65%)
⚡ AXIS is active and watching

_Type anything to talk to AXIS_
    `.trim();

    await sendMessage(chatId, opportunitiesMsg);

    await log({ type: 'CRON_COMPLETE', job: 'morning_briefing' });

    return new Response('Briefing sent', { status: 200 });

  } catch (err) {
    console.error('Cron briefing failed:', err);
    await sendMessage(chatId, `⚠️ *AXIS Morning Brief Failed*\n\nError: ${err.message}\n\nI'm still online — message me directly.`);
    return new Response('Error', { status: 500 });
  }
}

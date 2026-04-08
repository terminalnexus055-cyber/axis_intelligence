// AXIS — Webhook Setup
// Run this once after deployment to register Telegram webhook
// Visit: https://your-axis-url.vercel.app/api/setup

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webhookUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/telegram`
    : null;

  if (!webhookUrl) {
    return new Response(JSON.stringify({
      error: 'VERCEL_URL not set. Add your Vercel deployment URL to env vars.'
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    // Set webhook
    const res = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'edited_message'],
          drop_pending_updates: true
        })
      }
    );

    const data = await res.json();

    if (data.ok) {
      return new Response(JSON.stringify({
        success: true,
        message: '✅ AXIS webhook registered successfully',
        webhook: webhookUrl
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      return new Response(JSON.stringify({
        error: 'Webhook setup failed',
        details: data
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

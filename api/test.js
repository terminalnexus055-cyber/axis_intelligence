// AXIS — Gemini Test Endpoint
// Visit /api/test to see exactly what Gemini returns

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'No GEMINI_API_KEY found in env vars' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const models = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b'
  ];

  const results = {};

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Say hello in 5 words.' }] }],
          generationConfig: { maxOutputTokens: 50 }
        })
      });

      const text = await response.text();
      results[model] = {
        status: response.status,
        response: text.slice(0, 300)
      };
    } catch (err) {
      results[model] = { error: err.message };
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

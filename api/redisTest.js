// AXIS — Redis Test Endpoint

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const UPSTASH_URL = process.env.KV_REST_API_URL;
  const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;
  const results = {};

  // Test 1: Check env vars exist
  results.env_check = {
    url_exists: !!UPSTASH_URL,
    token_exists: !!UPSTASH_TOKEN,
    url_preview: UPSTASH_URL?.slice(0, 30) + '...'
  };

  // Test 2: Write a value
  try {
    const setRes = await fetch(`${UPSTASH_URL}/set/axis_test_key?EX=60`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify({ test: true, time: Date.now() }))
    });
    const setData = await setRes.json();
    results.write_test = { status: setRes.status, response: setData };
  } catch (err) {
    results.write_test = { error: err.message };
  }

  // Test 3: Read it back
  try {
    const getRes = await fetch(`${UPSTASH_URL}/get/axis_test_key`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const getData = await getRes.json();
    results.read_test = { status: getRes.status, response: getData };
  } catch (err) {
    results.read_test = { error: err.message };
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

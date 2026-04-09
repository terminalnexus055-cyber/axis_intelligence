// AXIS — PullPush Reddit Test

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const results = {};

  // Test 1: Search r/freelance for struggling posts
  try {
    const res1 = await fetch('https://api.pullpush.io/reddit/search/submission/?q=no+clients+struggling&subreddit=freelance&size=5&sort=desc', {
      headers: { 'Accept': 'application/json' }
    });
    const text1 = await res1.text();
    results.freelance_search = {
      status: res1.status,
      sample: text1.slice(0, 800)
    };
  } catch (err) {
    results.freelance_search = { error: err.message };
  }

  // Test 2: Broader search
  try {
    const res2 = await fetch('https://api.pullpush.io/reddit/search/submission/?q=freelancer+income+struggling&size=5&sort=desc', {
      headers: { 'Accept': 'application/json' }
    });
    const text2 = await res2.text();
    results.broad_search = {
      status: res2.status,
      sample: text2.slice(0, 800)
    };
  } catch (err) {
    results.broad_search = { error: err.message };
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

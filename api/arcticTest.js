// AXIS — Arctic Shift Connection Test

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const results = {};

  // Test 1: Search posts in r/freelance
  try {
    const res1 = await fetch('https://arctic-shift.quanticle.net/api/posts/search?subreddit=freelance&limit=5&sort=created_utc', {
      headers: { 'Accept': 'application/json' }
    });
    const text1 = await res1.text();
    results.freelance_search = {
      status: res1.status,
      sample: text1.slice(0, 600)
    };
  } catch (err) {
    results.freelance_search = { error: err.message };
  }

  // Test 2: Keyword search
  try {
    const res2 = await fetch('https://arctic-shift.quanticle.net/api/posts/search?subreddit=freelance&q=no+clients&limit=5', {
      headers: { 'Accept': 'application/json' }
    });
    const text2 = await res2.text();
    results.keyword_search = {
      status: res2.status,
      sample: text2.slice(0, 600)
    };
  } catch (err) {
    results.keyword_search = { error: err.message };
  }

  // Test 3: Multiple subreddits
  try {
    const res3 = await fetch('https://arctic-shift.quanticle.net/api/posts/search?subreddit=freelancers&limit=5&sort=created_utc', {
      headers: { 'Accept': 'application/json' }
    });
    const text3 = await res3.text();
    results.freelancers_sub = {
      status: res3.status,
      sample: text3.slice(0, 600)
    };
  } catch (err) {
    results.freelancers_sub = { error: err.message };
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

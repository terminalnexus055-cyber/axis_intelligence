// AXIS — Reddit Connection Test

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const results = {};

  // Test 1: Direct subreddit
  try {
    const res1 = await fetch('https://www.reddit.com/r/freelance/new.json?limit=5', {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (compatible; AXIS/1.0)',
        'Accept': 'application/json'
      }
    });
    const text1 = await res1.text();
    results.subreddit_test = {
      status: res1.status,
      sample: text1.slice(0, 400)
    };
  } catch (err) {
    results.subreddit_test = { error: err.message };
  }

  // Test 2: Search API
  try {
    const res2 = await fetch('https://www.reddit.com/search.json?q=freelancer+no+clients&sort=new&limit=3&t=week', {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (compatible; AXIS/1.0)',
        'Accept': 'application/json'
      }
    });
    const text2 = await res2.text();
    results.search_test = {
      status: res2.status,
      sample: text2.slice(0, 400)
    };
  } catch (err) {
    results.search_test = { error: err.message };
  }

  // Test 3: Old Reddit JSON
  try {
    const res3 = await fetch('https://old.reddit.com/r/freelance/new.json?limit=3', {
      headers: { 
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    const text3 = await res3.text();
    results.old_reddit_test = {
      status: res3.status,
      sample: text3.slice(0, 400)
    };
  } catch (err) {
    results.old_reddit_test = { error: err.message };
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

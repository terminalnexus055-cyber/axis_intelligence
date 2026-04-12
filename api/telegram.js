// AXIS — Telegram Webhook Handler
// Strict 4-level command system + Browserless integration

export const config = { 
  runtime: 'nodejs',
  maxDuration: 60
};

// Redis helpers
const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisGet(key) {
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const data = await res.json();
    if (!data.result) return null;
    // Upstash returns value as-is — parse until we get an object
    let val = data.result;
    let attempts = 0;
    while (typeof val === 'string' && attempts < 3) {
      try { val = JSON.parse(val); } catch { break; }
      attempts++;
    }
    return val;
  } catch { return null; }
}

async function redisSet(key, value, exSeconds = 86400) {
  try {
    // Upstash REST API: body must be JSON with the value as a plain string
    const serialized = JSON.stringify(value);
    await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}?EX=${exSeconds}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(serialized)
    });
  } catch (err) {
    console.error('Redis error:', err.message);
  }
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'AXIS alive 🦞' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const message = body?.message || body?.edited_message;
    if (!message) {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const username = message.from?.username || 'Commander';

    // ━━━ MEDIA HANDLER — photo or video uploaded ━━━
    const hasPhoto = message.photo && message.photo.length > 0;
    const hasVideo = message.video || message.document;
    if (hasPhoto || hasVideo) {
      await sendTyping(chatId);
      const mediaType = hasPhoto ? 'photo' : 'video';
      const caption = message.caption || '';
      const result = await analyzeMediaStrategy(mediaType, caption, username, message);
      await sendMessage(chatId, result);
      return res.status(200).json({ ok: true });
    }

    if (!message.text) {
      return res.status(200).json({ ok: true });
    }

    const userText = message.text.trim();

    console.log('AXIS incoming:', userText);

    await sendTyping(chatId);

    // ━━━ LEVEL 1 — SYSTEM COMMANDS ━━━
    if (userText.toLowerCase() === '/start') {
      await sendMessage(chatId, `🦞 *AXIS Online*

Commander, I'm fully operational.

*Command System:*
🔍 \`scan: [target]\` — Intel scan on any platform
🌐 \`browse: [platform] [query]\` — Browser task
📝 \`log: [what you did]\` — Save to daily log
📋 \`update plan: [notes]\` — Edit today's plan
✅ \`approve\` — Approve pending action
❌ \`reject\` — Reject pending action

*Or just talk to me naturally.*
📸 Send a photo or video — I'll suggest a content strategy.
✅ Reply *YES* — I'll draft platform posts.
🎬 Reply *video* — I'll produce a short-form video.


Current mission: Get FORGE its first real user.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 1 — LOG COMMAND ━━━
    if (/^log:/i.test(userText)) {
      const logText = userText.replace(/^log:/i, '').trim();
      await redisSet(`axis:daily:${getTodayDate()}`, logText, 86400 * 7);
      await sendMessage(chatId, `✅ *Logged*\n\n_"${logText}"_\n\nIncluded in tomorrow's morning brief.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 1 — LOG OUTREACH ━━━
    if (/^outreach sent:/i.test(userText)) {
      const url = userText.replace(/^outreach sent:/i, '').trim();
      const contactedKey = 'axis:contacted';
      const contacted = await redisGet(contactedKey) || [];
      contacted.push(url);
      await redisSet(contactedKey, contacted.slice(-200), 86400 * 30);
      await sendMessage(chatId, `✅ *Outreach logged*\n\n${url}\n\nAXIS won't suggest this person again for 30 days.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 1 — UPDATE PLAN ━━━
    if (/^update plan:/i.test(userText)) {
      const planText = userText.replace(/^update plan:/i, '').trim();
      await redisSet(`axis:plan:${getTodayDate()}`, planText, 86400);
      await sendMessage(chatId, `✅ *Plan updated*\n\n_"${planText}"_\n\nFocus adjusted for today.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 2 — INTEL SCAN ━━━
    if (/^scan:/i.test(userText) || /^find:/i.test(userText)) {
      const query = userText.replace(/^(scan|find):/i, '').trim();
      const encoded = encodeURIComponent(query);
      await sendMessage(chatId, `🔍 *Intel scan requested*\n\nTarget: _"${query}"_\n\nReply exactly to confirm:\n\`execute scan indiehackers ${encoded}\`\n\nOr \`reject\` to cancel.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 3 — BROWSER TASK ━━━
    if (/^browse:/i.test(userText)) {
      const parts = userText.replace(/^browse:/i, '').trim().split(' ');
      const platform = parts[0]?.toLowerCase() || 'indiehackers';
      const query = parts.slice(1).join(' ');
      const encoded = encodeURIComponent(query);

      // Platform availability check
      const blocked = ['reddit', 'linkedin', 'twitter'];
      if (blocked.includes(platform)) {
        await sendMessage(chatId, `⛔ *${platform} is currently unavailable*\n\nBlocked from server IPs. Requires OAuth setup.\n\n✅ Available now:\n\`browse: indiehackers [query]\`\n\`browse: hackernews [query]\``);
        return res.status(200).json({ ok: true });
      }

      await sendMessage(chatId, `🌐 *Browser task requested*\n\nPlatform: *${platform}*\nQuery: _"${query}"_\n\nReply exactly to confirm:\n\`execute browse ${platform} ${encoded}\`\n\nOr \`reject\` to cancel.`);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 4 — EXECUTE (no Redis needed — task in command) ━━━
    if (/^execute (browse|scan) (\S+) (\S+)/i.test(userText)) {
      const parts = userText.trim().split(' ');
      const action = parts[1]?.toLowerCase() || 'browse';
      const platform = parts[2]?.toLowerCase() || 'indiehackers';
      const encoded = parts[3] || '';
      const query = decodeURIComponent(encoded);
      const platformUrls = {
        'indiehackers': 'https://www.indiehackers.com/group/freelancers',
        'hackernews': 'https://news.ycombinator.com/newest'
      };
      const targetUrl = platformUrls[platform] || platformUrls['indiehackers'];
      const pending = { action, platform, query, url: targetUrl };

      await sendMessage(chatId, `⚙️ *Executing...*\n\nAction: ${action}\nPlatform: ${platform}\nQuery: ${query}\nThis may take 10-20 seconds.`);
      await sendTyping(chatId);

      const result = await executeBrowserTask(pending, chatId);

      if (result.error) {
        await sendMessage(chatId, `⚠️ *Execution failed*\n\n${result.error}\n\nTry again with a different query.`);
      } else {
        await sendMessage(chatId, result.report);
      }

      return res.status(200).json({ ok: true });
    }

    // ━━━ LAYER 2 — CONTENT DRAFTING (YES approval) ━━━
    if (/^yes$/i.test(userText)) {
      const pending = await redisGet('axis:content:pending');
      if (!pending) {
        await sendMessage(chatId, '⚠️ No pending strategy found. Send a photo or video first.');
        return res.status(200).json({ ok: true });
      }
      await sendMessage(chatId, '✍️ *Drafting elite content for all platforms...*\n\nThis takes 10-15 seconds.');
      await sendTyping(chatId);
      const drafts = await draftPlatformContent(pending);
      await sendMessage(chatId, drafts);
      return res.status(200).json({ ok: true });
    }

    // ━━━ LAYER 3 — VIDEO GENERATION ━━━
    if (/^video$/i.test(userText) || /^make video$/i.test(userText)) {
      const pending = await redisGet('axis:content:pending');
      if (!pending) {
        await sendMessage(chatId, '⚠️ No content strategy found. Send a photo or video first, approve the strategy, then type `video`.');
        return res.status(200).json({ ok: true });
      }
      await sendMessage(chatId, '🎬 *Video production started*\n\nGenerating script → voiceover → assembling video\n\nThis takes 30-60 seconds...');
      await sendTyping(chatId);
      const videoResult = await produceVideo(pending);
      if (videoResult.error) {
        await sendMessage(chatId, `⚠️ *Video failed*\n\n${videoResult.error}`);
      } else {
        await sendMessage(chatId, `🎬 *Video Ready*\n\n${videoResult.url}\n\n_Download and post directly to your platform._\n\nScript used:\n_"${videoResult.script}"_`);
      }
      return res.status(200).json({ ok: true });
    }

    // ━━━ REJECT ━━━
    if (/^reject$/i.test(userText)) {
      await sendMessage(chatId, '❌ Action cancelled.');
      return res.status(200).json({ ok: true });
    }

    // ━━━ LEVEL 1 — NATURAL CONVERSATION ━━━
    const history = await redisGet(`axis:history:${chatId}`) || [];
    const reply = await Promise.race([
      callGroq(userText, username, history),
      timeout(20000, '⏱ AXIS is thinking... try again in a moment.')
    ]);

    // Save history
    const updatedHistory = [
      ...history,
      { role: 'user', content: userText },
      { role: 'assistant', content: reply }
    ].slice(-20);
    await redisSet(`axis:history:${chatId}`, updatedHistory, 86400);

    await sendMessage(chatId, reply);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('AXIS error:', err.message);
    return res.status(200).json({ ok: true });
  }
}

async function executeBrowserTask(pending, chatId) {
  const { action, query } = pending;

  // 5 day cutoff timestamp
  const fiveDaysAgo = Math.floor(Date.now() / 1000) - (5 * 24 * 60 * 60);
  const fiveDaysAgoMs = Date.now() - (5 * 24 * 60 * 60 * 1000);

  try {
    // Load already contacted users to avoid duplicates
    const contactedKey = 'axis:contacted';
    const contacted = await redisGet(contactedKey) || [];

    // Multi-platform parallel scan
    const platforms = [
      { 
        name: 'IH Freelancers',
        url: 'https://www.indiehackers.com/group/freelancers?tab=new'
      },
      {
        name: 'IH Gigs',
        url: 'https://www.indiehackers.com/group/gigs?tab=new'
      },
      { 
        name: 'HackerNews',
        url: `https://hn.algolia.com/api/v1/search_by_date?query=freelance&tags=story&numericFilters=created_at_i>${fiveDaysAgo}`
      },
      {
        name: 'Reddit',
        url: 'https://www.reddit.com/r/freelance/new.json?limit=25'
      }
    ];

    console.log('Multi-platform scan starting — 5 day filter active');

    const scanResults = await Promise.allSettled(
      platforms.map(p => scanPlatform(p.name, p.url, query, fiveDaysAgoMs))
    );

    let allItems = [];
    const platformsScanned = [];
    const platformsFailed = [];

    scanResults.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allItems = allItems.concat(result.value);
        platformsScanned.push(platforms[i].name);
      } else {
        platformsFailed.push(platforms[i].name);
      }
    });

    // Filter out already contacted
    const fresh = allItems.filter(item => {
      const identifier = item.url || item.text.slice(0, 50);
      return !contacted.includes(identifier);
    });

    if (fresh.length === 0) {
      return { error: `No fresh targets found in last 5 days.\n\nPlatforms: ${platforms.map(p=>p.name).join(', ')}\n${contacted.length > 0 ? `Already contacted: ${contacted.length} people` : ''}` };
    }

    // Format for Groq — include date prominently
    const postsContext = fresh.map((item, i) =>
      `[${i+1}] Platform: ${item.platform}\nDate: ${item.date}\nTitle/Post: ${item.text}\nURL: ${item.url}`
    ).join('\n\n---\n\n').slice(0, 6000);

    const analysis = await callGroq(
      `You are scanning posts to find freelancers who need coaching help. Query: "${query}"

POSTS FOUND:
${postsContext}

FORGE helps freelancers (designers, writers, developers, marketers, consultants) who sell their time/skills to clients.

STEP 1 — REJECT these completely:
- Posts about building SaaS/apps/software products
- Success stories or milestone celebrations  
- People hiring or offering jobs
- Tool or service promotions
- AWS/hosting/infrastructure posts

STEP 2 — ACCEPT any post where someone is:
- Struggling to find clients or work
- Dealing with income problems
- Being ghosted or having client issues  
- Asking for freelance advice
- Feeling stuck or burned out as a freelancer
- New to freelancing and lost

STEP 3 — For each accepted post give:
[Number]. Pain: X/10 | [Their exact struggle] | [2 sentence human reply — empathetic, asks one question, no pitch] | [URL]

Be lenient — if it's even slightly related to freelance struggle, include it.
If truly nothing qualifies say: "No freelancer pain found. Platforms need expansion."`,
      'Commander',
      []
    );

    return {
      report: `🌐 *MULTI-PLATFORM INTEL*\n\n✅ Scanned: ${platformsScanned.join(', ')}\n${platformsFailed.length > 0 ? `⚠️ Failed: ${platformsFailed.join(', ')}\n` : ''}📅 Filter: Last 5 days only\n📊 Fresh targets: ${fresh.length}\n🚫 Already contacted: ${contacted.length}\n\n━━━━━━━━━━━━━━━━\n\n${analysis}`
    };

  } catch (err) {
    return { error: `Execution error: ${err.message}` };
  }
}

async function scanPlatform(platformName, url, query, fiveDaysAgoMs) {
  // HN — direct API, has real timestamps

  // Reddit — public JSON, no OAuth needed
  if (platformName === 'Reddit') {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'AXIS-Intel/1.0 (business intelligence tool)',
          'Accept': 'application/json'
        }
      });
      if (!res.ok) {
        console.error('Reddit JSON failed:', res.status);
        return [];
      }
      const data = await res.json();
      const posts = data?.data?.children || [];
      console.log('Reddit posts:', posts.length);
      return posts
        .filter(p => {
          const created = p.data?.created_utc * 1000;
          return created > fiveDaysAgoMs;
        })
        .slice(0, 15)
        .map(p => ({
          platform: 'Reddit',
          text: p.data?.title || '',
          url: `https://reddit.com${p.data?.permalink}`,
          date: new Date(p.data?.created_utc * 1000).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric'
          })
        }))
        .filter(p => p.text.length > 10);
    } catch (err) {
      console.error('Reddit error:', err.message);
      return [];
    }
  }

  if (platformName === 'HackerNews') {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) {
        console.error('HN API failed:', res.status);
        return [];
      }
      const data = await res.json();
      const hits = data?.hits || [];
      console.log('HN hits:', hits.length);
      return hits
        .filter(h => {
          const postDate = new Date(h.created_at).getTime();
          return postDate > fiveDaysAgoMs;
        })
        .slice(0, 15)
        .map(h => ({
          platform: 'HackerNews',
          text: h.title || '',
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          date: h.created_at ? new Date(h.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown'
        }))
        .filter(h => h.text.length > 10);
    } catch (err) {
      console.error('HN error:', err.message);
      return [];
    }
  }

  // IH — Browserless with date extraction
  const puppeteerScript = `export default async function({ page }) {
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.goto('${url}', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.innerText && b.innerText.toLowerCase().includes('accept'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  const content = await page.evaluate(() => {
    const items = [];
    const seen = new Set();
    // Get post links with their surrounding date context
    document.querySelectorAll('a').forEach(el => {
      const t = el.innerText && el.innerText.trim();
      const u = el.href || '';
      const isPost = u.includes('/post/') || u.includes('/product/');
      if (t && t.length > 15 && t.length < 300 && isPost && !seen.has(t)) {
        seen.add(t);
        // Try to find date near this element
        const parent = el.closest('div, article, li');
        const dateEl = parent && parent.querySelector('time, [class*="date"], [class*="time"], [class*="ago"]');
        const date = dateEl ? dateEl.innerText.trim() : 'Unknown';
        items.push({ text: t, url: u, date });
      }
    });
    return items.slice(0, 20);
  });
  return content;
}`;

  try {
    const response = await fetch(
      `https://production-sfo.browserless.io/chromium/function?token=${process.env.BROWSERLESS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/javascript' },
        body: puppeteerScript
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    const items = Array.isArray(data) ? data : (data?.data || []);

    return items
      .map(item => ({
        platform: platformName,
        text: item.text || '',
        url: item.url || url,
        date: item.date || 'Unknown'
      }))
      .filter(item => {
        if (item.text.length < 10) return false;
        // Filter by date — reject if clearly old
        const dateStr = item.date.toLowerCase();
        const isOld = dateStr.includes('2020') || dateStr.includes('2021') || 
                      dateStr.includes('2022') || dateStr.includes('2023') ||
                      dateStr.includes('2024');
        return !isOld;
      });

  } catch { return []; }
}

async function draftPlatformContent(pending) {
  const { mediaType, caption, strategy } = pending;

  const prompt = `You are an elite content strategist and marketing analyst with deep expertise in viral content creation, platform algorithms, and audience psychology.

FOUNDER CONTEXT:
Mohammed is a solo founder from Nigeria who built FORGE (AI freelance coaching app) entirely from his Android phone — no laptop, no team, no office. This is a story of raw resourcefulness and determination.

ORIGINAL MEDIA: ${mediaType}
CAPTION CONTEXT: "${caption || 'none'}"
APPROVED STRATEGY:
${strategy}

YOUR TASK — Draft three platform-specific posts using elite content creation frameworks:

━━━━━━━━━━━━━━━━
🐦 *TWITTER/X*
━━━━━━━━━━━━━━━━
Framework: Pattern interrupt hook + brutal honesty + punchy ending
Algorithm insight: First 3 words determine if people stop scrolling. Controversy and vulnerability outperform polish. Threads get 3x more reach than single tweets.
Format: Thread opener (max 240 chars) + 3 follow-up tweets
Tone: Raw, direct, no corporate speak

[Draft the Twitter thread here]

━━━━━━━━━━━━━━━━
💼 *LINKEDIN*
━━━━━━━━━━━━━━━━
Framework: Personal story arc — struggle → turning point → lesson → call to action
Algorithm insight: First 2 lines must force "see more" click. No external links in post body. Comments in first 60 mins determine reach. End with a question.
Format: 150-300 words, short paragraphs, no bullet points
Tone: Vulnerable, professional, aspirational

[Draft the LinkedIn post here]

━━━━━━━━━━━━━━━━
📸 *INSTAGRAM*
━━━━━━━━━━━━━━━━
Framework: Visual-first storytelling — caption supports the image, doesn't repeat it
Algorithm insight: First sentence is shown in feed — make it a hook. 3-5 hashtags outperform 30. Save rate matters more than likes. Stories reposts amplify reach.
Format: 50-100 words + 5 targeted hashtags
Tone: Inspiring, authentic, community-focused

[Draft the Instagram caption here]

━━━━━━━━━━━━━━━━
📊 *ANALYTICS STRATEGY*
━━━━━━━━━━━━━━━━
- Best posting times for each platform (WAT timezone)
- Which platform will drive most FORGE signups right now
- One A/B test to run on the top performing platform
- Key metric to track for each post

Produce real, ready-to-copy content. No placeholders. No generic advice.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.8
    })
  });

  if (!response.ok) {
    console.error('Draft engine failed:', response.status);
    return '⚠️ Content drafting failed. Try again.';
  }

  const data = await response.json();
  const drafts = data.choices?.[0]?.message?.content || '⚠️ No drafts generated.';

  // Log to content history
  const contentHistory = await redisGet('axis:content:history') || [];
  const entry = {
    mediaType: pending.mediaType,
    caption: pending.caption,
    strategy: pending.strategy.slice(0, 150),
    drafts: drafts.slice(0, 300),
    date: getTodayDate()
  };
  await redisSet('axis:content:history', [...contentHistory, entry].slice(-50), 86400 * 30);

  return `✅ *PLATFORM CONTENT READY*\n\n${drafts}\n\n━━━━━━━━━━━━━━━━\n_Log your results with_ \`log: [platform] post performed [result]\` _so AXIS learns what works._`;
}

async function produceVideo(pending) {
  try {
    // Step 1 — Generate script from strategy
    const script = await generateVideoScript(pending);
    if (!script) return { error: 'Script generation failed. Try again.' };

    // Step 2 — Generate voiceover via eidosSpeech
    const audioUrl = await generateVoiceover(script);
    if (!audioUrl) return { error: 'Voiceover generation failed. Check FISH_AUDIO_API_KEY.' };

    // Step 3 — Assemble video via JSON2Video
    const videoUrl = await assembleVideo(audioUrl, script, pending.caption);
    if (!videoUrl) return { error: 'Video assembly failed. Check JSON2VIDEO_API_KEY.' };

    return { url: videoUrl, script };
  } catch (err) {
    console.error('Video production error:', err.message);
    return { error: err.message };
  }
}

async function generateVideoScript(pending) {
  const { mediaType, caption, strategy } = pending;
  const prompt = `You are an elite scriptwriter for short-form social media videos. Write a 30-second video script (max 80 words) for a founder story video.

CONTEXT:
- Founder: Mohammed, solo founder from Nigeria
- Product: FORGE — AI freelance coaching app built from Android phone
- Media: ${mediaType}
- Caption: "${caption || 'none'}"
- Strategy angle: ${strategy.slice(0, 300)}

RULES:
- Conversational, natural speaking tone
- Opens with a hook that stops scrolling in 3 seconds
- Builds tension then resolves with FORGE as the answer
- Ends with clear call to action
- Max 80 words — this will be spoken aloud
- No hashtags, no emojis — pure spoken word

Return ONLY the script text, nothing else.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.8
    })
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function generateVoiceover(script) {
  try {
    const response = await fetch('https://eidosspeech.xyz/api/v1/tts', {
      method: 'POST',
      headers: {
        'X-API-Key': process.env.EIDOS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: script,
        voice: 'en-US-GuyNeural'
      })
    });

    if (!response.ok) {
      console.error('eidosSpeech failed:', response.status);
      return null;
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    // Store in Redis with unique key
    const audioId = `audio_${Date.now()}`;
    await redisSet(`axis:audio:${audioId}`, base64Audio, 3600);

    // Return production URL — preview URLs require auth
    return `https://axis-intelligence.vercel.app/api/audio?id=${audioId}`;
  } catch (err) {
    console.error('Voiceover error:', err.message);
    return null;
  }
}

async function assembleVideo(audioUrl, script, caption) {
  try {
    // Step 1 — Create video project via JSON2Video
    const response = await fetch('https://api.json2video.com/v2/movies', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.JSON2VIDEO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        resolution: 'mobile',
        quality: 'high',
        scenes: [
          {
            comment: 'Main scene',
            duration: 30,
            'background-color': '#0a0a0a',
            elements: [
              {
                type: 'audio',
                src: audioUrl,
                volume: 1,
                duration: 30
              },
              {
                type: 'text',
                text: 'FORGE',
                style: '001',
                settings: {
                  headline: {
                    text: 'FORGE',
                    color: '#ffffff',
                    'font-size': '10vw',
                    'font-weight': 'bold',
                    'text-align': 'center'
                  }
                },
                duration: 30
              },
              {
                type: 'text',
                text: caption || 'Built from a phone. Built for you.',
                style: '002',
                settings: {
                  headline: {
                    text: caption || 'Built from a phone. Built for you.',
                    color: '#cccccc',
                    'font-size': '4vw',
                    'text-align': 'center'
                  }
                },
                duration: 30
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('JSON2Video create failed:', response.status, err);
      return null;
    }

    const data = await response.json();
    const projectId = data?.project;
    if (!projectId) {
      console.error('JSON2Video no project ID:', JSON.stringify(data));
      return null;
    }

    // Step 2 — Poll for completion
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const poll = await fetch(`https://api.json2video.com/v2/movies?project=${projectId}`, {
        headers: { 'x-api-key': process.env.JSON2VIDEO_API_KEY }
      });
      const pollData = await poll.json();
      const status = pollData?.movie?.status;
      console.log('JSON2Video status:', status);
      if (status === 'done') return pollData?.movie?.url;
      if (status === 'error') {
        console.error('JSON2Video error:', JSON.stringify(pollData));
        return null;
      }
    }

    return null;
  } catch (err) {
    console.error('JSON2Video error:', err.message);
    return null;
  }
}

async function getTelegramFileUrl(fileId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  const data = await res.json();
  const filePath = data?.result?.file_path;
  if (!filePath) return null;
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

async function fetchAsBase64(url) {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function transcribeVideo(fileUrl) {
  try {
    // Fetch video file
    const res = await fetch(fileUrl);
    const buffer = await res.arrayBuffer();

    // Send to Groq Whisper for transcription
    const formData = new FormData();
    const blob = new Blob([buffer], { type: 'audio/mp4' });
    formData.append('file', blob, 'video.mp4');
    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'json');

    const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: formData
    });

    if (!whisperRes.ok) {
      console.error('Whisper failed:', whisperRes.status);
      return null;
    }
    const whisperData = await whisperRes.json();
    return whisperData?.text || null;
  } catch (err) {
    console.error('Transcription error:', err.message);
    return null;
  }
}

async function analyzeMediaStrategy(mediaType, caption, username, message) {
  // Load content history for learning context
  const contentHistory = await redisGet('axis:content:history') || [];
  const recentContent = contentHistory.slice(-5).map((c, i) =>
    `[${i+1}] Type: ${c.mediaType} | Caption: "${c.caption}" | Strategy: ${c.strategy} | Date: ${c.date}`
  ).join('\n') || 'No previous content history yet.';

  const strategyPrompt = `You are AXIS Content Strategist for Mohammed, solo founder of FORGE (AI freelance coaching app built entirely from an Android phone in Nigeria).

FORGE CONTEXT:
- Product: AI freelance coaching web app
- Audience: Freelancers struggling with clients, income, getting started
- Founder story: Built from Android phone in Nigeria, no laptop, no team
- Current mission: Get first paying user

RECENT CONTENT HISTORY:
${recentContent}

YOUR JOB — Analyze this ${mediaType} and return a content strategy in this exact format:

📊 *CONTENT STRATEGY ANALYSIS*

*Media Type:* ${mediaType}
*Best Angle:* [The single strongest narrative angle for this asset]

*Platform Recommendations:*
1. [Platform] — [Why it fits + expected impact]
2. [Platform] — [Why it fits + expected impact]
3. [Platform] — [Why it fits + expected impact]

*Suggested Caption:*
[Write the actual caption — platform-optimized, authentic, no fluff]

*Content Type:* [build-in-public / founder story / product demo / pain point / social proof]

*Learning Note:* [One insight about what makes this asset powerful for distribution]

Reply YES to proceed to drafting full platform posts, or tell me to adjust the angle.`;

  let groqMessages;

  if (mediaType === 'photo') {
    // Get highest resolution photo
    const photoArray = message.photo;
    const bestPhoto = photoArray[photoArray.length - 1];
    const fileUrl = await getTelegramFileUrl(bestPhoto.file_id);

    if (fileUrl) {
      const base64 = await fetchAsBase64(fileUrl);
      // Use vision model — sees actual image
      groqMessages = [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${base64}`
            }
          },
          {
            type: 'text',
            text: `Caption from Commander: "${caption || 'none'}"\n\n${strategyPrompt}`
          }
        ]
      }];
    } else {
      // Fallback if file fetch fails
      groqMessages = [{
        role: 'user',
        content: `Caption: "${caption || 'none'}"\n\n${strategyPrompt}`
      }];
    }
  } else {
    // Video — use Whisper transcription
    let transcript = null;
    const videoFile = message.video || message.document;
    if (videoFile?.file_id) {
      const fileUrl = await getTelegramFileUrl(videoFile.file_id);
      if (fileUrl) transcript = await transcribeVideo(fileUrl);
    }

    const videoContext = transcript
      ? `Video transcript: "${transcript}"\nCaption: "${caption || 'none'}"`
      : `Caption: "${caption || 'none provided'}"\nNo transcript available.`;

    groqMessages = [{
      role: 'user',
      content: `${videoContext}\n\n${strategyPrompt}`
    }];
  }

  // Choose model — vision for photos, text for video
  const model = mediaType === 'photo'
    ? 'meta-llama/llama-4-scout-17b-16e-instruct'
    : 'llama-3.3-70b-versatile';

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages: groqMessages,
      max_tokens: 1000,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    console.error('Strategy engine failed:', response.status);
    return '⚠️ Strategy engine unavailable. Try again.';
  }
  const data = await response.json();
  const strategy = data.choices?.[0]?.message?.content || '⚠️ No strategy generated.';

  // Save full strategy to Redis for YES handler
  const pendingContent = {
    mediaType,
    caption: caption || '',
    strategy,
    date: getTodayDate()
  };
  await redisSet('axis:content:pending', pendingContent, 86400);

  // Save to content history for learning
  const newEntry = {
    mediaType,
    caption: caption || '',
    strategy: strategy.slice(0, 200),
    date: getTodayDate()
  };
  const updatedHistory = [...contentHistory, newEntry].slice(-50);
  await redisSet('axis:content:history', updatedHistory, 86400 * 30);

  return strategy;
}

function timeout(ms, message) {
  return new Promise(resolve => setTimeout(() => resolve(message), ms));
}

async function callGroq(userText, username, history = []) {
  const messages = [
    {
      role: 'system',
      content: `You are AXIS — an elite AI business operator for ${username}, solo founder of FORGE (AI freelance coaching app).

STRICT RULES — NEVER VIOLATE:
- NEVER execute browser tasks, scans, or searches on your own
- NEVER claim to have sent messages, posted, or contacted anyone
- NEVER fabricate results, data, or metrics
- NEVER run any action without explicit "confirm execute" from Commander
- If asked to do something requiring execution, propose it and wait for approval
- Only report what you actually have data for

Your capabilities:
- Natural conversation and strategic advice
- Drafting outreach messages for Commander to send
- Analyzing real data when passed to you
- Planning campaigns and strategies
- Remembering conversation context

Commands Commander can use:
- scan: [target] — triggers intel scan (requires confirmation)
- browse: [platform] [query] — triggers browser task (requires confirmation)  
- log: [text] — saves daily log
- update plan: [text] — updates today's plan
- confirm execute — approves pending action
- reject — cancels pending action

Current mission: Get FORGE its first real user.
Be sharp, direct, honest. Keep responses concise for Telegram.

FOUNDER STORY — USE THIS IN ALL MARKETING AND OUTREACH:
Mohammed is a solo founder from Nigeria who built FORGE entirely from his Android phone using Acode terminal — no laptop, no team, no office. He coded a full AI-powered freelance coaching app with a working AI coach (Marcus), lead generation, real-time Reddit scanning, and autonomous morning briefings — all from his phone screen. He faced every obstacle: platform restrictions, API blocks, runtime errors, timeout loops — and solved every single one. This is not a Silicon Valley story. This is a story of pure resourcefulness. Mohammed represents every solo founder in Africa and the developing world who is building the future with limited tools but unlimited determination. FORGE was born from this struggle — because Mohammed understands what it means to hustle with no support system.

FORGE MARKETING ANGLES:
1. "Built from a phone in Nigeria" — the underdog founder story
2. "Your AI freelance coach that never sleeps" — Marcus the coach persona
3. "From zero to first client in 7 days" — the transformation promise
4. "No team. No office. Just results." — solo founder solidarity`
    },
    ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userText }
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 1200,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    console.error('Groq failed:', response.status);
    return '⚠️ AXIS temporarily unavailable. Try again.';
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '⚠️ No response. Try again.';
}

async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown'
      })
    });
  }
}

async function sendTyping(chatId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  });
}

function splitMessage(text, maxLength = 4000) {
  if (!text || text.length <= maxLength) return [text || 'No response'];
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if ((current + line).length > maxLength) {
      chunks.push(current.trim());
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

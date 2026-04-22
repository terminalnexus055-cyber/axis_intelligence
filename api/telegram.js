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

// BUG 1 FIX: replaced redisSet implementation
async function redisSet(key, value, exSeconds = 86400) {
  try {
    const body = JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value));
    await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}?EX=${exSeconds}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body
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
    // Handle render callback from axis-renderer
    if (req.query?.render_callback === '1') {
      const jobId = req.query?.job_id;
      const videoUrl = req.query?.video_url;
      const status = req.query?.status || 'failed';
      if (jobId) {
        if (status === 'done' && videoUrl) {
          await redisSet(`axis:render:${jobId}`, decodeURIComponent(videoUrl), 3600);
        } else {
          await redisSet(`axis:render:${jobId}`, 'failed', 3600);
        }
      }
      return res.status(200).json({ ok: true });
    }
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

      // Store Telegram file URL for renderer proxy access
      if (hasVideo) {
        const videoFile = message.video || message.document;
        if (videoFile?.file_id) {
          await redisSet('axis:video:fileId', videoFile.file_id, 3600);
          try {
            const videoUrl = await getTelegramFileUrl(videoFile.file_id);
            if (videoUrl) {
              const videoMediaId = `video_${Date.now()}`;
              await redisSet(`axis:media:${videoMediaId}`, videoUrl, 3600);
              await redisSet('axis:video:mediaId', videoMediaId, 3600);
              console.log('Video URL stored:', videoMediaId);
            }
          } catch (err) {
            console.error('Video store error:', err.message);
          }
        }
      }

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

    // ━━━ LEVEL 1 — UPDATE PROJECT CONTEXT ━━━
    if (/^update context:/i.test(userText)) {
      const milestone = userText.replace(/^update context:/i, '').trim();
      const existing = await redisGet('axis:project:context') || {};
      const updated = {
        ...existing,
        lastMilestone: milestone,
        lastUpdated: getTodayDate(),
        stage: existing.stage || 'pre-first-user',
        contentProduced: existing.contentProduced || 0,
        audienceInsights: existing.audienceInsights || [],
        performanceData: existing.performanceData || []
      };
      await redisSet('axis:project:context', updated, 86400 * 365);
      await sendMessage(chatId, `✅ *Project context updated*\n\n*Milestone:* _"${milestone}"_\n*Stage:* ${updated.stage}\n*Last updated:* ${updated.lastUpdated}\n\nMorning briefs will now include a content gap analysis based on this.`);
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

      await sendMessage(chatId, '🎬 *Generating script...*');
      const script = await generateVideoScript(pending);
      if (!script) {
        await sendMessage(chatId, '⚠️ Script generation failed. Try again.');
        return res.status(200).json({ ok: true });
      }

      await sendMessage(chatId, `📋 *Script ready*\n\n_"${script.voiceover}"_\n\n🎬 Rendering video... this takes 60-90 seconds.`);

      // BUG 3 FIX: add video URL check with error message
      const videoMediaId = await redisGet('axis:video:mediaId');
      if (videoMediaId) {
        script.videoUrl = `https://axis-intelligence.vercel.app/api/media?id=${videoMediaId}`;
      } else {
        await sendMessage(chatId, '⚠️ No video found. Please upload a screen recording first, then type `video`.');
        return res.status(200).json({ ok: true });
      }

      // Generate voiceover
      const audioUrl = await generateVoiceover(script.voiceover);
      if (!audioUrl) {
        await sendMessage(chatId, '⚠️ Voiceover generation failed. Try again.');
        return res.status(200).json({ ok: true });
      }

      // Send to render worker — async, don't wait
      const jobId = await submitVideoRender(audioUrl, script, pending.caption);
      if (!jobId) {
        await sendMessage(chatId, '⚠️ Video render failed. Try again.');
        return res.status(200).json({ ok: true });
      }

      await redisSet('axis:render:current', jobId, 3600);
      await sendMessage(chatId, `✅ *Render job submitted*\n\nJob: \`${jobId}\`\n\n⏳ Rendering takes 60-90 seconds.\n\nType \`video ready\` in 2 minutes to get your download link.`);

      return res.status(200).json({ ok: true });
    }

    // ━━━ VIDEO READY CHECK ━━━
    if (/^video ready$/i.test(userText)) {
      const jobId = await redisGet('axis:render:current');
      if (!jobId) {
        await sendMessage(chatId, '⚠️ No render job found. Type `video` first.');
        return res.status(200).json({ ok: true });
      }
      const result = await redisGet(`axis:render:${jobId}`);
      if (!result || result === 'pending') {
        await sendMessage(chatId, '⏳ Still rendering. Try again in 30 seconds.');
        return res.status(200).json({ ok: true });
      }
      if (result === 'failed') {
        await sendMessage(chatId, '⚠️ Render failed. Type `video` to try again.');
        return res.status(200).json({ ok: true });
      }
      // result is the video URL
      await redisSet('axis:render:current', null, 1);
      await sendMessage(chatId, `🎬 *Video Ready*\n\n${result}\n\n_Download and post directly._\n\nLog your result: \`log: video posted on [platform] got [result]\``);
      return res.status(200).json({ ok: true });
    }

    // ━━━ ASSET LIBRARY VIEWER ━━━
    if (/^assets$/i.test(userText)) {
      const assetIndex = await redisGet('axis:assets:index') || [];
      if (assetIndex.length === 0) {
        await sendMessage(chatId, '📦 *Asset Library*\n\nNo assets stored yet. Send a photo or video to start building your library.');
        return res.status(200).json({ ok: true });
      }
      const recentIds = assetIndex.slice(-10).reverse();
      const assets = await Promise.all(
        recentIds.map(id => redisGet(`axis:assets:${id}`))
      );
      const validAssets = assets.filter(Boolean);
      const list = validAssets.map((a, i) =>
        `*${i + 1}. ${a.type.toUpperCase()}* — ${a.date}\n📖 ${a.naturalStory || a.description}\n⚡ Charge: ${a.emotionalCharge} | 🎯 Best for: ${a.platformFit?.primary || 'TBD'}\n🔑 Moments: ${(a.keyMoments || []).slice(0, 2).join(', ') || 'none extracted'}`
      ).join('\n\n');
      await sendMessage(chatId, `📦 *ASSET LIBRARY*\n\n${validAssets.length} assets stored (showing last ${validAssets.length})\n\n${list}\n\n━━━━━━━━━━━━━━━━\n_Each uploaded media is permanently stored and analysed._`);
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
Framework: Visual-first storytelling — caption supports the image, not repeats it
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

// ---------- PATCH 2: VIDEO FRAME EXTRACTION FUNCTIONS ----------
async function extractVideoFrames(videoUrl) {
  try {
    // Fetch video binary
    const res = await fetch(videoUrl);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const totalSize = bytes.length;

    // Sample 5 positions through the video
    // MP4 files have JPEG frames embedded we can find
    // by looking for JPEG magic bytes (FF D8 FF)
    const frames = [];
    const positions = [0.1, 0.25, 0.45, 0.65, 0.85];

    for (const ratio of positions) {
      const searchStart = Math.floor(totalSize * ratio);
      const searchEnd = Math.min(searchStart + 500000, totalSize - 2);

      // Find JPEG start marker (FF D8 FF)
      let jpegStart = -1;
      for (let i = searchStart; i < searchEnd - 2; i++) {
        if (bytes[i] === 0xFF && bytes[i+1] === 0xD8 && bytes[i+2] === 0xFF) {
          jpegStart = i;
          break;
        }
      }

      if (jpegStart === -1) continue;

      // Find JPEG end marker (FF D9)
      let jpegEnd = -1;
      const maxSearch = Math.min(jpegStart + 200000, totalSize - 1);
      for (let i = jpegStart + 2; i < maxSearch - 1; i++) {
        if (bytes[i] === 0xFF && bytes[i+1] === 0xD9) {
          jpegEnd = i + 2;
          break;
        }
      }

      if (jpegEnd === -1 || jpegEnd - jpegStart < 1000) continue;

      // Extract JPEG bytes and convert to base64
      const jpegBytes = bytes.slice(jpegStart, jpegEnd);
      let binary = '';
      for (let i = 0; i < jpegBytes.length; i++) {
        binary += String.fromCharCode(jpegBytes[i]);
      }
      const base64 = btoa(binary);
      frames.push({
        ratio,
        timestamp: Math.floor(ratio * 30), // estimate seconds
        base64
      });

      if (frames.length >= 5) break;
    }

    return frames.length > 0 ? frames : null;
  } catch (err) {
    console.error('Frame extraction error:', err.message);
    return null;
  }
}

async function analyzeVideoFrames(frames) {
  if (!frames || frames.length === 0) return null;

  try {
    const content = [
      {
        type: 'text',
        text: `You are analyzing frames from a screen recording of FORGE, an AI freelance coaching app built by Mohammed, a solo founder from Nigeria using only an Android phone.

Analyze these ${frames.length} frames sampled at different points in the video. For each frame describe:
- What is visible on screen (UI elements, text, colors)
- The emotional energy of this moment
- Whether this is a strong visual hook, a product demo moment, or a transition

Return a JSON object only, no markdown:
{
  "frames": [
    {
      "timestamp": 0,
      "description": "what is visible",
      "energy": "high/medium/low",
      "type": "hook/demo/transition/cta",
      "use_as": "text_only background or screen_recording or stat_overlay"
    }
  ],
  "best_hook_timestamp": 0,
  "best_demo_timestamp": 7,
  "overall_energy": "high/medium/low",
  "recommended_arc": "one sentence describing the emotional arc this footage naturally suggests"
}`
      }
    ];

    // Add frame images
    for (const frame of frames) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${frame.base64}`
        }
      });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{ role: 'user', content }],
        max_tokens: 600,
        temperature: 0.3
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || null;
    if (!raw) return null;

    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('Frame analysis error:', err.message);
    return null;
  }
}
// ---------- END OF PATCH 2 ----------

// ---------- PATCH 3: UPGRADED generateVideoScript ----------
async function generateVideoScript(pending) {
  const { mediaType, caption, strategy } = pending;
  const latestTrends = await redisGet('axis:trends:latest') || 'No trend data yet.';
  const projectContext = await redisGet('axis:project:context') || {};

  // BUG 2 FIX: use mediaId URL instead of direct Telegram fetch
  let frameAnalysis = null;
  const videoMediaId = await redisGet('axis:video:mediaId');
  if (videoMediaId && mediaType === 'video') {
    const videoUrl = `https://axis-intelligence.vercel.app/api/media?id=${videoMediaId}`;
    const frames = await extractVideoFrames(videoUrl);
    frameAnalysis = await analyzeVideoFrames(frames);
  }

  const frameContext = frameAnalysis
    ? `VISUAL ANALYSIS OF THE FOOTAGE:
Overall energy: ${frameAnalysis.overall_energy}
Natural arc: ${frameAnalysis.recommended_arc}
Best hook moment: ~${frameAnalysis.best_hook_timestamp}s
Best demo moment: ~${frameAnalysis.best_demo_timestamp}s
Frame breakdown:
${frameAnalysis.frames.map(f => `  [${f.timestamp}s] ${f.description} — ${f.energy} energy, use as: ${f.use_as}`).join('\n')}`
    : `No frame analysis available. Use caption and strategy to infer visual content.`;

  const prompt = `You are an elite short-form video director and scriptwriter.

FOUNDER: Mohammed — solo founder from Nigeria, built FORGE (AI freelance coaching app) entirely from an Android phone. No laptop, no team, no office.
PRODUCT: FORGE — AI freelance coaching app.
MEDIA TYPE: ${mediaType}
CAPTION: "${caption || 'none'}"
STRATEGY: ${strategy.slice(0, 300)}
STAGE: ${projectContext.stage || 'pre-first-user'}

WHAT'S CONVERTING THIS WEEK:
${latestTrends}

${frameContext}

YOUR JOB:
Write a 30-second directed video script AND scene breakdown.
The scene structure must emerge from the emotional arc of the actual footage.
Use the frame analysis to place screen_recording scenes at the most compelling visual moments.
Model the hook on what's converting this week.

Return ONLY a valid JSON object, no markdown, no explanation:
{
  "voiceover": "full 30-second spoken script — natural, conversational, max 80 words",
  "hook": "the exact first line that stops scrolling",
  "title": "short video title for logging",
  "scenes": [
    {
      "type": "text_only",
      "duration": 3,
      "text": "exact hook text to display"
    },
    {
      "type": "screen_recording",
      "duration": 8,
      "subtitle": "voiceover words during this scene",
      "zoom": true
    },
    {
      "type": "stat_overlay",
      "duration": 4,
      "text": "punchy insight or stat"
    },
    {
      "type": "screen_recording",
      "duration": 11,
      "subtitle": "continuing voiceover"
    },
    {
      "type": "cta",
      "duration": 4,
      "text": "FORGE",
      "subtitle": "Your AI freelance coach"
    }
  ]
}

RULES:
- Scene structure must serve the emotional arc — not be fixed
- Place screen_recording scenes at timestamps where footage is most compelling
- Durations must add up to exactly 30 seconds
- Voiceover max 80 words — speakable in 30 seconds
- Return ONLY the JSON object`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.7
    })
  });

  if (!response.ok) return null;
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || null;
  if (!raw) return null;

  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('Script JSON parse failed:', e.message);
    return null;
  }
}
// ---------- END OF PATCH 3 ----------


async function generateVoiceover(script) {
  try {
    // Orpheus limit is 200 chars per request — split if needed
    const chunks = [];
    const words = script.split(' ');
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length > 180) {
        if (current) chunks.push(current.trim());
        current = word;
      } else {
        current = (current + ' ' + word).trim();
      }
    }
    if (current) chunks.push(current.trim());

    // Generate audio for each chunk
    const audioBuffers = [];
    for (const chunk of chunks) {
      const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'canopylabs/orpheus-v1-english',
          input: chunk,
          voice: 'daniel',
          response_format: 'wav'
        })
      });

      if (!response.ok) {
        console.error('Groq TTS chunk failed:', response.status, await response.text());
        return null;
      }
      const buf = await response.arrayBuffer();
      audioBuffers.push(Buffer.from(buf));
    }

    // BUG 4 FIX: handle variable WAV header length
    let combined;
    if (audioBuffers.length === 1) {
      combined = audioBuffers[0];
    } else {
      const first = audioBuffers[0];
      const rest = audioBuffers.slice(1).map(b => {
        // Find actual data chunk offset — WAV header is variable length
        // Search for 'data' marker (64 61 74 61) to find real audio start
        for (let i = 12; i < Math.min(b.length - 8, 200); i++) {
          if (b[i] === 0x64 && b[i+1] === 0x61 && b[i+2] === 0x74 && b[i+3] === 0x61) {
            return b.slice(i + 8); // skip 'data' marker + 4-byte size field
          }
        }
        return b.slice(44); // fallback
      });
      combined = Buffer.concat([first, ...rest]);
    }

    const base64Audio = combined.toString('base64');
    const audioId = `audio_${Date.now()}`;
    await redisSet(`axis:audio:${audioId}`, base64Audio, 3600);
    return `https://axis-intelligence.vercel.app/api/audio?id=${audioId}`;
  } catch (err) {
    console.error('Voiceover error:', err.message);
    return null;
  }
}
async function submitVideoRender(audioUrl, script, caption) {
  try {
    if (!script || !script.scenes || !audioUrl) {
      console.error('submitVideoRender: missing script or audioUrl');
      return null;
    }

    const jobId = `render_${Date.now()}`;
    const callbackUrl = `https://axis-intelligence.vercel.app/api/telegram?render_callback=1&job_id=${jobId}`;

    const response = await fetch('https://moh2009-axis-renderer.hf.space/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_url: script.videoUrl || null,
        audio_url: audioUrl,
        scenes: script.scenes,
        voiceover: script.voiceover,
        title: script.title || 'FORGE video',
        job_id: jobId,
        callback_url: callbackUrl
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Renderer failed:', response.status, err);
      return null;
    }

    const data = await response.json();
    if (data.job_id) {
      await redisSet(`axis:render:${data.job_id}`, 'pending', 3600);
    }

    return data.job_id || null;

  } catch (err) {
    console.error('submitVideoRender error:', err.message);
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
  const [contentHistory, projectContext, assetIndex, latestTrends] = await Promise.all([
    redisGet('axis:content:history').then(v => v || []),
    redisGet('axis:project:context').then(v => v || {}),
    redisGet('axis:assets:index').then(v => v || []),
    redisGet('axis:trends:latest').then(v => v || 'No trend data yet.')
  ]);
  const existingAssets = assetIndex.length;

  const strategyPrompt = `You are AXIS Content Director for Mohammed — solo founder from Nigeria, built FORGE (AI freelance coaching app) entirely from an Android phone. Mission: first paying user.

Stage: ${projectContext.stage || 'pre-first-user'} | Last milestone: ${projectContext.lastMilestone || 'none'} | Assets in library: ${existingAssets}

WHAT'S CONVERTING THIS WEEK (model your strategy on this):
${latestTrends}

Platform psychology — reason from this:
- TikTok/Reels: founder IS the content, parasocial bond, 3-second hook
- LinkedIn: specific numbers + honest failure > polish, vulnerability → lesson
- Reddit/IH: empathy first, problem is hero not product, value before mention
- X/Twitter: one counterintuitive insight, fewest words possible

Analyze this ${mediaType} (asset #${existingAssets + 1}). Propose 3 ranked strategies:

📊 *CONTENT DIRECTOR ANALYSIS*
*Asset Type:* ${mediaType}
*Emotional Core:* [feeling this triggers]
*Natural Story:* [core story this asset tells]

━━━━━━━━━━━━━━━━
🥇 *STRATEGY 1 — [Platform] — [HIGH/MEDIUM]*
*Why this platform:* [platform psychology reason]
*The hook:* [exact opening line specific to this asset]
*Mechanism:* [why this stops scrolling]
*Format:* [thread/reel/post/etc]
*Post time (WAT):* [time + why]

━━━━━━━━━━━━━━━━
🥈 *STRATEGY 2 — [Platform] — [impact]*
[same structure]

━━━━━━━━━━━━━━━━
🥉 *STRATEGY 3 — [Platform] — [impact]*
[same structure]

━━━━━━━━━━━━━━━━
Reply YES to draft all three or tell me which number first.
Asset saved as #${existingAssets + 1}.`;

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

  // ━━━ ASSET LIBRARY — permanent storage ━━━
  const assetId = `asset_${Date.now()}`;
  const currentIndex = assetIndex;

  const assetMetaPrompt = `Analyze this content strategy and return ONLY valid JSON, no markdown:
{"keyMoments":["...","...","..."],"emotionalCharge":"high|medium|low","naturalStory":"one sentence","platformFit":{"primary":"platform","secondary":"platform","reason":"one sentence"}}

Strategy: ${strategy.slice(0, 400)}`;

  let assetMeta = {
    keyMoments: [],
    emotionalCharge: 'medium',
    naturalStory: caption || 'Raw founder asset',
    platformFit: {}
  };

  try {
    const metaRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: assetMetaPrompt }],
        max_tokens: 300,
        temperature: 0.3
      })
    });
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      const raw = metaData.choices?.[0]?.message?.content?.trim() || '';
      const clean = raw.replace(/```json|```/g, '').trim();
      assetMeta = JSON.parse(clean);
    }
  } catch (e) {
    console.error('Asset meta parse failed:', e.message);
  }

  const asset = {
    id: assetId,
    type: mediaType,
    description: caption || 'No caption',
    date: getTodayDate(),
    keyMoments: assetMeta.keyMoments || [],
    emotionalCharge: assetMeta.emotionalCharge || 'medium',
    naturalStory: assetMeta.naturalStory || '',
    platformFit: assetMeta.platformFit || {},
    usedIn: [],
    performance: {}
  };

  await Promise.all([
    redisSet(`axis:assets:${assetId}`, asset, 86400 * 365),
    redisSet('axis:assets:index', [...currentIndex, assetId].slice(-100), 86400 * 365)
  ]);

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
- update context: [milestone] — logs a project milestone, updates AXIS intelligence
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
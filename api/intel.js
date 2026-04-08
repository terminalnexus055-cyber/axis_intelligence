// AXIS — Intel Agent
// Finds high-pain freelancers and potential partners

import { callGemini, callGroqBackup } from './gemini.js';
import { log } from '../lib/logger.js';

const INTEL_SYSTEM = `
You are the AXIS Intel Agent — an elite user research specialist.
Your job is to analyze profiles and posts to find people with GENUINE 10/10 pain points.

FORGE CONTEXT:
- FORGE is an AI freelance coaching app
- Target: Freelancers struggling with: getting clients, pricing, ghosting, inconsistent income, no direction
- Perfect user: Someone actively complaining, asking for help, or expressing frustration RIGHT NOW

SCORING CRITERIA (0-10):
- Pain intensity: How badly are they suffering?
- Recency: Is this happening now?
- Specificity: Concrete problem vs vague complaint
- Receptiveness: Would they welcome help?
- Fit: Do they match FORGE's solution?

Always return structured data. Be ruthlessly honest about scores.
`;

export async function findUsers(query, chatId) {
  try {
    // Extract search intent from query
    const searchTerms = extractSearchTerms(query);
    
    // Search Reddit (no API key needed)
    const redditResults = await searchReddit(searchTerms);
    
    // Analyze and score results
    const analyzed = await analyzeProfiles(redditResults, searchTerms);
    
    await log({ type: 'INTEL_SEARCH', query, results: analyzed.length, timestamp: new Date().toISOString() });

    return formatIntelReport(analyzed, searchTerms);

  } catch (err) {
    console.error('Intel agent error:', err);
    await log({ type: 'INTEL_ERROR', error: err.message });
    return `🔍 *INTEL AGENT*\n\nHit a wall searching. Trying alternative approach...\n\nError: ${err.message}`;
  }
}

function extractSearchTerms(query) {
  const lower = query.toLowerCase();
  
  // Default freelancer pain terms
  const defaultTerms = [
    'freelancer struggling',
    'no clients freelance',
    'freelance income inconsistent',
    'getting ghosted freelance',
    'freelance pricing help',
    'freelance burnout',
    'how to get freelance clients'
  ];

  // Extract specific terms from query if mentioned
  const customTerms = [];
  if (lower.includes('ghost')) customTerms.push('freelancer ghosted client');
  if (lower.includes('pric')) customTerms.push('freelance pricing struggle');
  if (lower.includes('client')) customTerms.push('finding freelance clients');
  if (lower.includes('income') || lower.includes('money')) customTerms.push('inconsistent freelance income');
  if (lower.includes('nigeria') || lower.includes('africa')) customTerms.push('freelancer Nigeria Africa');

  return customTerms.length > 0 ? customTerms : defaultTerms.slice(0, 3);
}

async function searchReddit(terms) {
  const results = [];
  
  // Target subreddits for freelancers
  const subreddits = [
    'freelance',
    'freelancers', 
    'digitalnomad',
    'forhire',
    'slavelabour',
    'upwork',
    'graphic_design',
    'webdev'
  ];

  // Search each term
  for (const term of terms.slice(0, 2)) {
    try {
      // Use Reddit's JSON API - no key needed
      const encoded = encodeURIComponent(term);
      const url = `https://www.reddit.com/search.json?q=${encoded}&sort=new&limit=10&t=week`;
      
      const res = await fetch(url, {
        headers: { 'User-Agent': 'AXIS-Intelligence-Bot/1.0' }
      });

      if (!res.ok) continue;

      const data = await res.json();
      const posts = data?.data?.children || [];

      for (const post of posts) {
        const p = post.data;
        // Filter for relevant subreddits
        if (subreddits.some(sub => p.subreddit?.toLowerCase().includes(sub.toLowerCase()))) {
          results.push({
            title: p.title,
            body: p.selftext?.slice(0, 500) || '',
            author: p.author,
            subreddit: p.subreddit,
            url: `https://reddit.com${p.permalink}`,
            score: p.score,
            created: new Date(p.created_utc * 1000).toISOString(),
            numComments: p.num_comments
          });
        }
      }

      // Small delay to be respectful
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      console.error(`Reddit search failed for term "${term}":`, err);
    }
  }

  return results.slice(0, 8);
}

async function analyzeProfiles(posts, searchTerms) {
  if (posts.length === 0) return [];

  const postsText = posts.map((p, i) => 
    `[${i + 1}] u/${p.author} in r/${p.subreddit}\nTitle: ${p.title}\nBody: ${p.body}\nURL: ${p.url}`
  ).join('\n\n---\n\n');

  const prompt = `
Analyze these Reddit posts and score each person as a potential FORGE user.

POSTS:
${postsText}

For each post, return a JSON array with this structure:
[
  {
    "rank": 1,
    "username": "u/username",
    "subreddit": "r/name", 
    "painScore": 8.5,
    "painSummary": "One sentence describing their exact pain",
    "whyTheyNeedForge": "One sentence on how FORGE solves their problem",
    "suggestedOpener": "A natural, human opening message to send them (2-3 sentences max, not salesy)",
    "url": "post url",
    "urgency": "HIGH/MEDIUM/LOW"
  }
]

Only include people with painScore 7.0 or above.
Return ONLY the JSON array, no other text.
`;

  try {
    const response = await callGemini(INTEL_SYSTEM, [], prompt);
    const clean = response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Profile analysis failed:', err);
    // Try Groq backup
    try {
      const groqResponse = await callGroqBackup(INTEL_SYSTEM, prompt);
      const clean = groqResponse.replace(/```json|```|\*\(Groq backup active\)\*/g, '').trim();
      return JSON.parse(clean);
    } catch {
      return [];
    }
  }
}

function formatIntelReport(profiles, searchTerms) {
  if (profiles.length === 0) {
    return `🔍 *INTEL REPORT*\n\nSearched for: _${searchTerms.join(', ')}_\n\nNo high-pain profiles found this scan. I'll keep watching.\n\nTry: "Find freelancers complaining about getting no clients this week"`;
  }

  let report = `🔍 *INTEL REPORT*\n`;
  report += `📅 ${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}\n`;
  report += `Found *${profiles.length}* high-pain targets\n\n`;
  report += `━━━━━━━━━━━━━━━━\n\n`;

  profiles.forEach((p, i) => {
    const urgencyEmoji = p.urgency === 'HIGH' ? '🔴' : p.urgency === 'MEDIUM' ? '🟡' : '🟢';
    
    report += `*${i + 1}. ${p.username}*\n`;
    report += `${urgencyEmoji} Pain Score: *${p.painScore}/10* | ${p.subreddit}\n`;
    report += `💢 *Pain:* ${p.painSummary}\n`;
    report += `🎯 *Why FORGE:* ${p.whyTheyNeedForge}\n`;
    report += `💬 *Opener:* _"${p.suggestedOpener}"_\n`;
    report += `🔗 ${p.url}\n\n`;
    
    if (i < profiles.length - 1) report += `─────────────────\n\n`;
  });

  report += `\n━━━━━━━━━━━━━━━━\n`;
  report += `Reply *"reach out to [number]"* to draft full outreach\n`;
  report += `Reply *"scan again"* for fresh results`;

  return report;
}

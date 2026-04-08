// AXIS — Safety Layer
// The 3 Lock System that prevents hallucination and self-destruction

import { getConstitution } from './constitution.js';

export async function safetyCheck(text, intent) {
  const lower = text.toLowerCase();
  const constitution = getConstitution();

  // ━━━ LOCK 1: HARD BLOCKS ━━━
  // Things AXIS will never do regardless of instruction
  const hardBlocks = [
    { pattern: /delete|remove|wipe|destroy|clear all/i, reason: 'Destructive action detected. AXIS never deletes without explicit double confirmation.' },
    { pattern: /modify forge|edit forge|change forge|update forge files/i, reason: 'FORGE files are read-only to AXIS. Cannot modify existing product.' },
    { pattern: /spam|mass message|bulk send|send to everyone/i, reason: 'Spam actions blocked. AXIS does targeted, human outreach only.' },
    { pattern: /impersonate|pretend to be|fake profile|fake account/i, reason: 'Impersonation blocked. AXIS only operates authentically.' },
    { pattern: /steal|scrape personal|private data|hack/i, reason: 'Data privacy violation blocked.' }
  ];

  for (const block of hardBlocks) {
    if (block.pattern.test(text)) {
      return {
        approved: false,
        lock: 1,
        reason: `🔒 *Lock 1 — Hard Block*\n\n${block.reason}\n\nThis action cannot be overridden.`
      };
    }
  }

  // ━━━ LOCK 2: CONSTITUTION CHECK ━━━
  // Does this action contradict FORGE's identity?
  const constitutionViolations = [
    { pattern: /target enterprise|b2b|corporate clients/i, reason: 'FORGE targets freelancers, not enterprises.' },
    { pattern: /claim (we|forge) guarantee|promise results|100%/i, reason: 'AXIS cannot make guarantees on behalf of FORGE.' },
    { pattern: /say forge is free forever|lifetime free/i, reason: 'Cannot make permanent pricing promises.' }
  ];

  for (const violation of constitutionViolations) {
    if (violation.pattern.test(text)) {
      return {
        approved: false,
        lock: 2,
        reason: `🔒 *Lock 2 — Constitution Violation*\n\n${violation.reason}\n\nThis contradicts FORGE's defined identity. Adjust and retry.`
      };
    }
  }

  // ━━━ LOCK 3: CONFIDENCE THRESHOLD ━━━
  // Score the action before executing
  const confidence = scoreConfidence(text, intent);

  if (confidence < 60) {
    return {
      approved: false,
      lock: 3,
      reason: `🔒 *Lock 3 — Low Confidence (${confidence}/100)*\n\nAXIS isn't confident enough to execute this autonomously.\n\nPlease clarify:\n- What exactly should be done?\n- Who is the target?\n- What's the desired outcome?`
    };
  }

  if (confidence >= 60 && confidence < 85) {
    return {
      approved: true,
      lock: null,
      confidence,
      flagged: true,
      reason: `⚠️ *Executing with flag (confidence: ${confidence}/100)*\nReview result before using.`
    };
  }

  return { approved: true, lock: null, confidence, flagged: false };
}

function scoreConfidence(text, intent) {
  let score = 70; // Base score

  // Boost for clear, specific requests
  if (text.length > 20) score += 5;
  if (text.includes('freelanc')) score += 5;
  if (text.includes('forge') || text.includes('user') || text.includes('campaign')) score += 5;
  if (intent.confidence > 80) score += 10;

  // Reduce for vague requests
  if (text.length < 10) score -= 20;
  if (/everything|all|anything|whatever/i.test(text)) score -= 10;
  if (/not sure|maybe|i think|perhaps/i.test(text)) score -= 5;

  return Math.min(100, Math.max(0, score));
}

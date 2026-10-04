import { sendWithRetry } from './retry.mjs';
import { parseSpintax } from './spintax.mjs';

/**
 * Pick a random peer inbox excluding the sender
 */
export function pickRandomPeer(inboxes, excludeEmail) {
  const pool = inboxes.filter((i) => (i.email || i.smtp_user || '').toLowerCase() !== (excludeEmail || '').toLowerCase());
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Calculate the warmup send quota for a given day
 * Day 1: 5 emails, increasing by 3 each day up to target
 */
export function getWarmupQuota(day = 1, target = 40) {
  const calculated = 5 + (Math.max(day - 1, 0) * 3);
  return Math.min(calculated, target);
}

const WARMUP_SUBJECTS = [
  '{Quick|Brief} follow-up on our conversation',
  'Notes from {today’s|our earlier} sync',
  'Sharing the {requested document|project update}',
  'Project update and next milestones',
  '{Checking in|Touching base} regarding next week',
  'Quick question about your {timeline|schedule}',
];

const WARMUP_BODIES = [
  '{Hey|Hi|Hello}, just following up on our previous note. Let me know if you have any questions!',
  '{Thanks|Thank you} for sharing the updates earlier. Looks great, looking forward to {discussing|catching up} soon.',
  'Hope you are having a {productive|great|wonderful} week. Sending over the notes as promised.',
  'Wanted to confirm our schedule for the upcoming {milestone review|team check-in}.',
];

/**
 * Run a peer-to-peer warmup cycle for enabled inboxes
 * @param {Array<object>} inboxes
 * @param {Function} sendEmailFn
 */
export async function runWarmupCycle(inboxes, sendEmailFn) {
  const eligible = inboxes.filter((i) => i.warmup_enabled === true || String(i.warmup_enabled).toLowerCase() === 'true');
  const results = [];

  if (eligible.length < 2) {
    return {
      status: 'skipped',
      reason: 'At least 2 warmup-enabled inboxes are required for peer warmup.',
      count: 0,
    };
  }

  for (const sender of eligible) {
    const senderEmail = sender.email || sender.smtp_user;
    const recipient = pickRandomPeer(eligible, senderEmail);
    if (!recipient) continue;

    const recipientEmail = recipient.email || recipient.smtp_user;
    const rawSubject = WARMUP_SUBJECTS[Math.floor(Math.random() * WARMUP_SUBJECTS.length)];
    const rawBody = WARMUP_BODIES[Math.floor(Math.random() * WARMUP_BODIES.length)];
    const subject = parseSpintax(rawSubject);
    const body = parseSpintax(rawBody);

    try {
      if (typeof sendEmailFn === 'function') {
        await sendWithRetry(() => sendEmailFn(sender, recipientEmail, subject, body));
      }
      results.push({ sender: senderEmail, recipient: recipientEmail, status: 'sent' });
    } catch (err) {
      results.push({ sender: senderEmail, recipient: recipientEmail, status: 'failed', error: err.message });
    }
  }

  return {
    status: 'completed',
    count: results.filter((r) => r.status === 'sent').length,
    results,
  };
}

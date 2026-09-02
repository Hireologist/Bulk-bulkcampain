import crypto from 'node:crypto';

let suppressionCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a signed HMAC token for 1-click unsubscribe
 */
export function generateUnsubscribeToken(email, campaignId = 'global', secret = 'default-secret') {
  const payload = `${email.toLowerCase()}:${campaignId}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify a signed HMAC unsubscribe token
 */
export function verifyUnsubscribeToken(email, campaignId = 'global', token, secret = 'default-secret') {
  if (!email || !token) return false;
  const expected = generateUnsubscribeToken(email, campaignId, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Check if an email is present in the suppression list
 */
export async function isSuppressed(email, readSuppressionFn) {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();

  const now = Date.now();
  if (!suppressionCache || now - lastCacheTime > CACHE_TTL_MS) {
    if (typeof readSuppressionFn === 'function') {
      const list = await readSuppressionFn();
      suppressionCache = new Set((list || []).map((e) => String(e).trim().toLowerCase()));
      lastCacheTime = now;
    } else {
      suppressionCache = suppressionCache || new Set();
    }
  }

  return suppressionCache.has(normalizedEmail);
}

/**
 * Add an email to the suppression list and update the cache
 */
export async function addToSuppression(email, reason, appendSuppressionFn) {
  if (!email) return;
  const normalizedEmail = email.trim().toLowerCase();

  if (typeof appendSuppressionFn === 'function') {
    await appendSuppressionFn(normalizedEmail, reason || 'Unsubscribed', new Date().toISOString());
  }

  if (!suppressionCache) {
    suppressionCache = new Set();
  }
  suppressionCache.add(normalizedEmail);
}

/**
 * Invalidate in-memory suppression cache (useful for testing or forced sync)
 */
export function clearSuppressionCache() {
  suppressionCache = null;
  lastCacheTime = 0;
}

/**
 * Detect if an incoming email reply is an explicit unsubscribe / opt-out request
 * (e.g. clicking the mailto unsubscribe link or explicit opt-out keywords).
 * Standard sales objections (e.g. "not interested", "no budget") are NOT treated as opt-outs.
 */
export function isOptOutReply(subject = '', body = '') {
  const combined = `${subject} ${body}`.toLowerCase();
  const optOutPatterns = [
    'unsubscribe',
    'opt out',
    'opt-out',
    'remove me',
    'stop emailing',
    'take me off',
    'do not email',
    'dont email',
    'leave me alone'
  ];
  return optOutPatterns.some((pattern) => combined.includes(pattern));
}

/**
 * Build CAN-SPAM compliant footer with business details & unsubscribe link
 */
export function buildSenderFooter(settings = {}, lead = {}, secret = 'default-secret') {
  const businessName = settings.business_name || settings.company_name || 'Outreach Team';
  const businessAddress = settings.business_address || '';
  const email = lead.email || '';
  const campaignId = lead.campaign || 'default';
  const token = generateUnsubscribeToken(email, campaignId, secret);

  // Auto-generate target recipient from the exact sender email or sender domain
  const senderEmail = lead.senderEmail || lead.sender || settings.support_email || settings.senderEmail || (email.includes('@') ? `unsubscribe@${email.split('@')[1]}` : 'unsubscribe@domain.com');

  let unsubscribeUrl = '';
  if (settings.unsubscribe_url) {
    unsubscribeUrl = `${settings.unsubscribe_url}?email=${encodeURIComponent(email)}&token=${token}&campaign=${encodeURIComponent(campaignId)}`;
  } else {
    const mailtoSubject = encodeURIComponent(`Unsubscribe - ${email}`);
    const mailtoBody = encodeURIComponent(`Please unsubscribe ${email} from all future email communications.`);
    unsubscribeUrl = `mailto:${senderEmail}?subject=${mailtoSubject}&body=${mailtoBody}`;
  }

  const addressLine = businessAddress ? `<br>${businessAddress}` : '';

  return `<br><br><div style="font-size:12px;color:#888;border-top:1px solid #eee;padding-top:10px;margin-top:20px;">`
    + `Sent by <strong>${businessName}</strong>${addressLine}`
    + `<br><a href="${unsubscribeUrl}" style="color:#666;text-decoration:underline;">Unsubscribe</a> from these emails.`
    + `</div>`;
}

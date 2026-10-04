import axios from 'axios';
import { parseSpintax } from './spintax.mjs';
import { formatDiscordContent } from './alerts.mjs';

// Resolves the campaign cutoff time from Google Sheet settings.
export function resolveCutoffConfig(settings = {}) {
  const normalized = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (k && v !== undefined && v !== null) {
      normalized[k.trim().toLowerCase()] = String(v).trim();
    }
  }

  const rawTime = normalized['cutoff_time'] || normalized['cutoff_time_ist'] || '';
  const rawHour = normalized['cutoff_hour_ist'] || normalized['cutoff_hour'] || '';
  const rawMinute = normalized['cutoff_minute_ist'] || normalized['cutoff_minute'] || '';
  const timezone = normalized['cron_timezone'] || 'Asia/Kolkata';

  let hour = 18;
  let minute = 30;

  if (rawTime) {
    const match12 = rawTime.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)$/i);
    const match24 = rawTime.match(/^(\d{1,2})[:.](\d{1,2})$/);
    if (match12) {
      let h = parseInt(match12[1], 10);
      const m = match12[2] ? parseInt(match12[2], 10) : 0;
      const isPm = match12[3].toLowerCase() === 'pm';
      if (isPm && h < 12) h += 12;
      if (!isPm && h === 12) h = 0;
      hour = h;
      minute = m;
    } else if (match24) {
      hour = parseInt(match24[1], 10);
      minute = parseInt(match24[2], 10);
    }
  } else if (rawHour !== '') {
    const match12Hour = rawHour.match(/^(\d{1,2})\s*(am|pm)$/i);
    if (match12Hour) {
      let h = parseInt(match12Hour[1], 10);
      const isPm = match12Hour[2].toLowerCase() === 'pm';
      if (isPm && h < 12) h += 12;
      if (!isPm && h === 12) h = 0;
      hour = h;
    } else {
      hour = parseInt(rawHour, 10);
    }
    minute = rawMinute !== '' ? parseInt(rawMinute, 10) || 0 : 0;
  }

  if (isNaN(hour) || hour < 0 || hour > 23) hour = 18;
  if (isNaN(minute) || minute < 0 || minute > 59) minute = 30;

  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const displayMinute = String(minute).padStart(2, '0');
  const tzSuffix = timezone.includes('Kolkata') ? 'IST' : timezone;
  const formattedTime = `${displayHour}:${displayMinute} ${period} ${tzSuffix}`;

  return { hour, minute, formattedTime, timezone };
}

// Check IST / configured timezone cutoff
export function isPastCutoff(hour = 18, minute = 30, timezone = 'Asia/Kolkata') {
  const h = isNaN(parseInt(hour, 10)) ? 18 : parseInt(hour, 10);
  const m = isNaN(parseInt(minute, 10)) ? 30 : parseInt(minute, 10);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(new Date());
    const curHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const curMin = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    return (curHour * 60 + curMin) >= (h * 60 + m);
  } catch (_) {
    const now = new Date();
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const totalMins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    return totalMins >= (h * 60 + m);
  }
}

/**
 * Evaluates whether a long-running campaign runner should stop or trigger a clean auto-restart
 * before hitting GitHub's 6-hour (360-minute) hard job cancellation ceiling.
 */
export function shouldRestartWorkflow({
  elapsedMs = 0,
  maxRuntimeMs = 315 * 60 * 1000, // 5 hours 15 minutes default (safe before 360m limit)
  isCutoff = false,
  remainingLeads = 0,
  allInboxesExhausted = false,
  cutoffLabel = '6:30 PM IST',
} = {}) {
  if (isCutoff) {
    return { shouldStop: true, shouldRestart: false, reason: `Cutoff time reached (${cutoffLabel || '6:30 PM IST'})` };
  }
  if (allInboxesExhausted) {
    return { shouldStop: true, shouldRestart: false, reason: 'All inboxes hit daily limits / quotas' };
  }
  if (remainingLeads <= 0) {
    return { shouldStop: true, shouldRestart: false, reason: 'No remaining leads to process' };
  }
  if (elapsedMs >= maxRuntimeMs) {
    return { shouldStop: true, shouldRestart: true, reason: 'Max runner runtime reached before cutoff time' };
  }
  return { shouldStop: false, shouldRestart: false, reason: 'Within normal execution limits' };
}

/**
 * Dispatch a fresh GitHub Action workflow run to continue outreach/follow-up seamlessly with a fresh 6h clock.
 * Reads github_pat directly from Google Sheet Settings (with fallback to env).
 */
export async function triggerWorkflowRestart(actionName, repoFullName, pat, httpClient = axios) {
  const token = (pat || process.env.GH_PAT || process.env.GITHUB_PAT || '').trim();
  if (!token) {
    console.warn(`⚠️ Cannot trigger workflow restart for [${actionName}]: No github_pat found in Google Sheet Settings or environment.`);
    return false;
  }

  const repo = (repoFullName || process.env.GITHUB_REPOSITORY || 'itsrohanpatel/Sheet-bot').trim();
  const url = `https://api.github.com/repos/${repo}/actions/workflows/outreach.yml/dispatches`;

  try {
    const res = await httpClient.post(
      url,
      {
        ref: 'main',
        inputs: { action: actionName }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Sheet-bot-Engine'
        }
      }
    );
    const ok = res && (res.status === 204 || res.status === 200 || res.status === 201);
    if (ok) {
      console.log(`🚀 Successfully triggered fresh workflow run for action [${actionName}] on ${repo}.`);
    }
    return Boolean(ok);
  } catch (err) {
    console.error(`❌ Failed to trigger workflow restart for [${actionName}]:`, err.response?.data || err.message);
    return false;
  }
}

// Discord Webhook Notification
export async function notifyDiscord(url, content, settings = {}) {
  const isEnabled = String(settings.discord_alerts_enabled ?? 'TRUE').trim().toLowerCase();
  if (['false', 'off', '0', 'no', 'mute'].includes(isEnabled)) {
    return;
  }
  const targetUrl = url || process.env.DISCORD_WEBHOOK_URL;
  if (targetUrl && targetUrl.startsWith('http')) {
    try {
      const taggedContent = formatDiscordContent(content);
      await axios.post(targetUrl, { content: taggedContent });
    } catch (e) {
      console.error('Discord error:', e.message);
    }
  }
}

// Check if error is a daily sending limit / quota exceeded error
export function isDailyLimitError(err) {
  if (!err) return false;
  const msg = (typeof err === 'string' ? err : err.message || err.toString() || '').toLowerCase();
  return (
    msg.includes('daily user sending limit exceeded') ||
    msg.includes('550-5.4.5') ||
    msg.includes('550 5.4.5') ||
    msg.includes('sending limits') ||
    msg.includes('user sending limit') ||
    msg.includes('daily sending limit') ||
    msg.includes('quota exceeded') ||
    msg.includes('rate limit exceeded')
  );
}

// Helper for random date variations (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY)
export function getRandomFormattedDate(date = new Date()) {
  const formatted = date.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
  const [d, m, y] = formatted.split('/');
  const formats = [
    `${d}/${m}/${y}`,
    `${d}-${m}-${y}`,
    `${d}.${m}.${y}`
  ];
  return formats[Math.floor(Math.random() * formats.length)];
}

// Check if campaign is active or paused via Google Sheet Settings
export function isCampaignActive(settings = {}, type = 'general') {
  const masterVal = String(settings.campaign_active ?? settings.is_active ?? settings.campaign_status ?? 'TRUE').trim().toLowerCase();
  if (masterVal === 'false' || masterVal === 'paused' || masterVal === 'off' || masterVal === '0' || masterVal === 'no') {
    return false;
  }

  if (type === 'outreach') {
    const outreachVal = String(settings.outreach_active ?? 'TRUE').trim().toLowerCase();
    if (outreachVal === 'false' || outreachVal === 'paused' || outreachVal === 'off' || outreachVal === '0') {
      return false;
    }
  } else if (type === 'followup') {
    const followupVal = String(settings.followup_active ?? 'TRUE').trim().toLowerCase();
    if (followupVal === 'false' || followupVal === 'paused' || followupVal === 'off' || followupVal === '0') {
      return false;
    }
  }

  return true;
}

// Helper for full template personalization & spintax resolution (handles nested variables inside spintax)
export function applyTemplateVariables(text = '', {
  fullName = 'there',
  companyName = 'your company',
  location = 'your city',
  randomLocs = '',
  clientStr = '',
  dateStr = '',
  senderName = 'Team',
  senderEmail = '',
  businessName = 'Outreach Team',
  businessAddress = '',
  followUpNumber = ''
} = {}) {
  if (!text || typeof text !== 'string') return '';

  // 1. First pass: interpolate variables so any tags inside spintax choices (e.g. {{Hi {{full_name}}|Hello {{full_name}}}}) are resolved
  let resolved = text
    .replace(/{{full_name}}/gi, fullName)
    .replace(/{{company_name}}/gi, companyName)
    .replace(/{{location}}/gi, location)
    .replace(/{{other_locations}}/gi, randomLocs)
    .replace(/{{clients}}/gi, clientStr)
    .replace(/{{Date}}/gi, dateStr || getRandomFormattedDate())
    .replace(/{{follow_up_number}}/gi, String(followUpNumber))
    .replace(/{{sender[-_]?name}}/gi, senderName)
    .replace(/{{sender[-_]?first[-_]?name}}/gi, senderName.split(' ')[0] || senderName)
    .replace(/{{sender[-_]?email}}/gi, senderEmail)
    .replace(/{{business_name}}/gi, businessName)
    .replace(/{{business_address}}/gi, businessAddress);

  // 2. Parse spintax on the resolved text (handles spintax with or without variables)
  resolved = parseSpintax(resolved);

  return resolved;
}

// Helper to format follow-up subject lines without duplicate Re: prefixes
export function formatFollowupSubject(templateSubject = 'Re:', existingSubject = '') {
  const prefix = (templateSubject || 'Re:').trim();
  const rawSubj = (existingSubject || '').trim();

  if (/^re:\s*/i.test(rawSubj)) {
    if (/^re:?$/i.test(prefix)) {
      return rawSubj;
    }
    const cleanSubj = rawSubj.replace(/^re:\s*/i, '').trim();
    return `${prefix} ${cleanSubj}`.trim();
  }

  return `${prefix} ${rawSubj}`.trim();
}

// Normalize dates to DD/MM/YYYY for strict matching
export function normalizeDate(dateStr) {
  if (!dateStr && dateStr !== 0) return '';
  const clean = String(dateStr).trim().split('T')[0];
  if (!clean) return '';

  // Match Google Sheets numeric serial date (e.g. 46335, 46276)
  if (/^\d{5}(\.\d+)?$/.test(clean)) {
    const serial = parseFloat(clean);
    // 25569 = days between 1899-12-30 and 1970-01-01
    const utcMs = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    if (!isNaN(d.getTime())) {
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const year = d.getUTCFullYear();
      return `${day}/${month}/${year}`;
    }
  }

  // Match DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmyMatch) {
    const day = String(parseInt(dmyMatch[1], 10)).padStart(2, '0');
    const month = String(parseInt(dmyMatch[2], 10)).padStart(2, '0');
    const year = dmyMatch[3];
    return `${day}/${month}/${year}`;
  }
  // Match YYYY-MM-DD
  const ymdMatch = clean.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = String(parseInt(ymdMatch[2], 10)).padStart(2, '0');
    const day = String(parseInt(ymdMatch[3], 10)).padStart(2, '0');
    return `${day}/${month}/${year}`;
  }
  return clean;
}

// Safely parse follow-up due dates, ignoring sentiment labels ('POSITIVE', 'Done', etc.)
export function parseDueDate(dateVal) {
  if (!dateVal && dateVal !== 0) return null;
  const str = String(dateVal).trim();
  if (!str) return null;

  // Ignore sentiment tags, opt-out marks, or status strings
  if (/^(positive|neutral|negative|ooo|done|suppressed)$/i.test(str)) {
    return null;
  }

  // Google Sheets numeric serial date
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const serial = parseFloat(str);
    const utcMs = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    return isNaN(d.getTime()) ? null : d;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10) - 1;
    const y = parseInt(dmyMatch[3], 10);
    const date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
  }

  // YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1], 10);
    const m = parseInt(ymdMatch[2], 10) - 1;
    const d = parseInt(ymdMatch[3], 10);
    const date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Calculate next due date in DD/MM/YYYY format given a base date and days offset
export function calculateNextDueDate(baseDate = new Date(), daysUntilNext = 3) {
  const days = parseInt(daysUntilNext, 10);
  if (isNaN(days) || days <= 0) return '';
  const d = new Date(baseDate);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

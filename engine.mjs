import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import Groq from 'groq-sdk';
import axios from 'axios';
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 🛡️ Production Hardening Modules
import { getSendDelay, trackOutcome, checkAndResetDailyStats } from './src/throttle.mjs';
import { sendWithRetry } from './src/retry.mjs';
import { isSuppressed, addToSuppression, buildSenderFooter } from './src/suppression.mjs';
import { alertIfUnhealthy, sendRunSummaryAlert, postToDiscord, isAuthError, sendAuthFailureAlert } from './src/alerts.mjs';
import { runWarmupCycle } from './src/warmup.mjs';
import { parseSpintax } from './src/spintax.mjs';
export { parseSpintax, isAuthError };

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || process.env.SHEET_ID;

// Google Sheets Authentication (Supports JSON string or separate Email + Key)
async function getSheets(customSheetId) {
  const targetSheetId = customSheetId || process.env.SINGLE_SHEET_ID || process.env.SHEET_ID || SPREADSHEET_ID;
  if (!targetSheetId) {
    throw new Error('Spreadsheet credentials not set. Set SPREADSHEET_ID or SHEET_ID.');
  }

  let auth;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    throw new Error('Google Service Account credentials not provided. Set GOOGLE_SERVICE_ACCOUNT_JSON or (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY).');
  }

  const client = google.sheets({ version: 'v4', auth });
  return { 
    sheets: client, 
    spreadsheets: client.spreadsheets, 
    spreadsheetId: targetSheetId 
  };
}

// Ensure specific tab exists with headers
async function ensureTabExists(sheetsObj, tabName, defaultHeaders = []) {
  const sheets = sheetsObj?.sheets || sheetsObj;
  const spreadsheetId = sheetsObj?.spreadsheetId || SPREADSHEET_ID;
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets.some(s => s.properties.title === tabName);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabName } } }],
        },
      });
      if (defaultHeaders.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${tabName}'!A1:${String.fromCharCode(64 + defaultHeaders.length)}1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [defaultHeaders] },
        });
      }
    }
  } catch (err) {
    console.warn(`[Tab Check] ${tabName}: ${err.message}`);
  }
}

// Load a specific tab
async function loadTab(sheetsObj, tabName) {
  const sheets = sheetsObj?.sheets || sheetsObj;
  const spreadsheetId = sheetsObj?.spreadsheetId || process.env.SINGLE_SHEET_ID || SPREADSHEET_ID;
  try {
    const res = await sendWithRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A:Z`,
    }), { retries: 2, baseDelay: 1000 });
    const [headers, ...rows] = res.data.values || [];
    if (!headers) return [];
    return rows.map(r => Object.fromEntries(headers.map((h, i) => [(h || '').trim(), (r[i] || '').trim()])));
  } catch (e) {
    console.warn(`Could not load tab [${tabName}]: ${e.message}`);
    return [];
  }
}

// Record a send failure into Failed_Sends dead letter tab
async function recordFailedSend(sheetsObj, leadEmail, campaign, errorMessage) {
  try {
    const sheets = sheetsObj?.sheets || sheetsObj;
    const spreadsheetId = sheetsObj?.spreadsheetId || SPREADSHEET_ID;
    await ensureTabExists(sheetsObj, 'Failed_Sends', ['lead_email', 'campaign', 'error', 'attempted_at']);
    await sendWithRetry(() => sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "'Failed_Sends'!A:Z",
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[leadEmail, campaign || 'default', errorMessage, new Date().toISOString()]],
      },
    }), { retries: 2 });
  } catch (err) {
    console.warn(`Could not log to Failed_Sends: ${err.message}`);
  }
}

// Load Inbox Stats from Inbox_Stats tab
async function loadInboxStatsMap(sheetsObj) {
  const rows = await loadTab(sheetsObj, 'Inbox_Stats');
  const map = new Map();
  for (const r of rows) {
    const email = (r.inbox_email || r.email || '').toLowerCase().trim();
    if (email) {
      map.set(email, checkAndResetDailyStats({
        sent: Number(r.sent) || 0,
        bounced: Number(r.bounced) || 0,
        complaints: Number(r.complaints) || 0,
        sentToday: Number(r.sentToday) || 0,
        lastReset: r.lastReset || '',
      }));
    }
  }
  return map;
}

// Save updated Inbox Stats to Inbox_Stats tab
async function saveInboxStatsMap(sheetsObj, statsMap) {
  try {
    const sheets = sheetsObj?.sheets || sheetsObj;
    const spreadsheetId = sheetsObj?.spreadsheetId || SPREADSHEET_ID;
    await ensureTabExists(sheetsObj, 'Inbox_Stats', ['inbox_email', 'sent', 'bounced', 'complaints', 'sentToday', 'lastReset']);
    const rows = [
      ['inbox_email', 'sent', 'bounced', 'complaints', 'sentToday', 'lastReset'],
      ...Array.from(statsMap.entries()).map(([email, s]) => [
        email,
        s.sent || 0,
        s.bounced || 0,
        s.complaints || 0,
        s.sentToday || 0,
        s.lastReset || new Date().toISOString().split('T')[0],
      ]),
    ];
    await sendWithRetry(() => sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Inbox_Stats'!A1:F${rows.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    }), { retries: 2 });
  } catch (err) {
    console.warn(`Could not save Inbox_Stats: ${err.message}`);
  }
}

// Save draft via IMAP append
export async function saveDraftViaImap(inbox, toEmail, subject, htmlBody) {
  const client = new ImapFlow({
    host: inbox.imap_host,
    port: parseInt(inbox.imap_port || '993', 10),
    secure: true,
    auth: { user: inbox.smtp_user, pass: inbox.smtp_pass },
    logger: false,
    socketTimeout: 30000,
    clientInfo: { name: 'SheetBotDraftClient' }
  });

  client.on('error', (err) => console.warn(`IMAP draft error for ${inbox.email}: ${err.message}`));

  try {
    await client.connect();
    const rawMessage = [
      `From: "${inbox.display_name || inbox.email}" <${inbox.email}>`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody,
    ].join('\r\n');

    let targetMailbox = 'Drafts';
    const mailboxes = await client.list();
    const found = mailboxes.find((m) => m.specialUse === '\\Drafts' || m.path.toLowerCase().includes('draft'));
    if (found) targetMailbox = found.path;

    await client.append(targetMailbox, Buffer.from(rawMessage), ['\\Draft', '\\Seen']);
    console.log(`📝 [Draft Saved] To: ${toEmail} in ${inbox.email} -> ${targetMailbox}`);
    return true;
  } finally {
    try { await client.logout(); } catch (_) { client.close(); }
  }
}

// Load all system configs
async function loadConfig(sheets) {
  const settingsRows = await loadTab(sheets, 'Settings');
  const settings = Object.fromEntries(settingsRows.map(r => [r.Key || r.key, r.Value || r.value]));

  const rawInboxes = await loadTab(sheets, 'Inboxes');
  const inboxes = rawInboxes.filter(i => (i.is_active || '').toUpperCase() === 'TRUE');

  const rawAliases = await loadTab(sheets, 'Aliases');
  const aliases = rawAliases.filter(a => (a.is_active || '').toUpperCase() === 'TRUE');

  const coldTemplates = await loadTab(sheets, 'Templates');
  const followupTemplates = await loadTab(sheets, 'Followup_Templates');
  const locations = (await loadTab(sheets, 'Locations')).map(r => r.location_name).filter(Boolean);
  const clients = await loadTab(sheets, 'Clients');

  return { settings, inboxes, aliases, coldTemplates, followupTemplates, locations, clients };
}

// 🛡️ 100% Free Pre-Send MX & Domain Validation
async function isValidEmailDomain(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return false;

  const domain = email.split('@')[1].toLowerCase().trim();
  try {
    const mxRecords = await dns.resolveMx(domain);
    return mxRecords && mxRecords.length > 0;
  } catch (err) {
    return false;
  }
}

// Check IST cutoff
function isPastCutoff(hour = 18, minute = 30) {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const totalMins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return totalMins >= (parseInt(hour, 10) * 60 + parseInt(minute, 10));
}

// Discord Webhook Notification
async function notifyDiscord(url, content, settings = {}) {
  const isEnabled = String(settings.discord_alerts_enabled ?? 'TRUE').trim().toLowerCase();
  if (['false', 'off', '0', 'no', 'mute'].includes(isEnabled)) {
    return;
  }
  const targetUrl = url || process.env.DISCORD_WEBHOOK_URL;
  if (targetUrl && targetUrl.startsWith('http')) {
    try {
      await axios.post(targetUrl, { content });
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

// ============================================================================
// 🚀 1. COLD OUTREACH SENDER
// ============================================================================
export async function runColdOutreach() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);

  // ⏸️ Master Campaign Toggle Check
  if (!isCampaignActive(config.settings, 'outreach')) {
    const pauseMsg = '⏸️ **Campaign Paused Notice:** Cold outreach is turned OFF/PAUSED in Google Sheet Settings (`campaign_active = FALSE`). Skipping run safely.';
    console.log(pauseMsg);
    await notifyDiscord(config.settings.discord_updates_webhook, pauseMsg);
    return;
  }

  if (!config.inboxes.length) throw new Error('No active Inboxes configured in "Inboxes" tab.');
  if (!config.coldTemplates.length) throw new Error('No Templates found in "Templates" tab.');

  await notifyDiscord(config.settings.discord_updates_webhook, '🚀 Auto bulk cold outreach started');

  const detailsRes = await sendWithRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
    range: "'Details'!A:Z",
  }), { retries: 2 });

  const [headers, ...rows] = detailsRes.data.values || [];
  const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));

  const inboxStatsMap = await loadInboxStatsMap(sheets);
  const inboxUsage = Object.fromEntries(config.inboxes.map(i => [i.email, 0]));
  const limitExceededInboxes = new Set();
  let inboxIdx = 0;
  let emailsSentThisRun = 0;
  let draftsSavedThisRun = 0;
  const MAX_PER_RUN = parseInt(config.settings.max_emails_per_run || '1000', 10);
  const isReviewMode = (config.settings.send_mode || '').trim().toLowerCase() === 'review';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = (row[col['email']] || '').trim();
    const status = (row[col['Sent Status']] || '').trim().toLowerCase();

    // Skip if already sent, replied, bounced, or empty email
    if (!email || status === 'sent' || status === 'replied' || status === 'bounced' || status === 'suppressed' || status === 'draft — pending review') {
      continue;
    }

    // 🛡️ Global Suppression Check
    const suppressed = await isSuppressed(email, async () => {
      const suppRows = await loadTab(sheets, 'Suppressed');
      return suppRows.map(r => r.email || r.Email);
    });

    if (suppressed) {
      console.log(`⛔ Suppressed email skipped: ${email}`);
      const rowNum = i + 2;
      row[col['Sent Status']] = 'suppressed';
      row[col['Follow up']] = 'Done';
      row[col['Next Follow Up Date']] = 'SUPPRESSED';
      row[col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

      await sendWithRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      }));
      continue;
    }

    // 🛡️ PRE-SEND DOMAIN & MX CHECK (Catches dead emails for free)
    const isDomainValid = await isValidEmailDomain(email);
    if (!isDomainValid) {
      console.log(`⚠️ Invalid domain/email detected: ${email}. Skipping to protect sender reputation.`);
      
      const rowNum = i + 2;
      row[col['Sent Status']] = 'bounced';
      row[col['Follow up']] = 'Done';
      row[col['Next Follow Up Date']] = 'INVALID DOMAIN';
      row[col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

      await sendWithRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      }));

      continue;
    }

    // Stop once this trigger completes its batch limit
    if (emailsSentThisRun >= MAX_PER_RUN) {
      console.log(`✅ Completed batch of ${MAX_PER_RUN} emails for this run. Stopping.`);
      break;
    }

    // Cutoff time check (6:30 PM IST)
    if (isPastCutoff(config.settings.cutoff_hour_ist, config.settings.cutoff_minute_ist)) {
      console.log('⏰ Cutoff time reached (6:30 PM IST). Stopping.');
      break;
    }

    // Find inbox under daily limit
    let inbox = null;
    for (let attempt = 0; attempt < config.inboxes.length; attempt++) {
      const candidate = config.inboxes[inboxIdx];
      inboxIdx = (inboxIdx + 1) % config.inboxes.length;
      if (!limitExceededInboxes.has(candidate.email) && inboxUsage[candidate.email] < parseInt(candidate.daily_limit || '50', 10)) {
        inbox = candidate;
        break;
      }
    }
    if (!inbox) {
      const stopMsg = limitExceededInboxes.size > 0
        ? `🛑 **Outreach Stopped:** All active inboxes have hit daily sending limits / quotas (${limitExceededInboxes.size} rate-limited).`
        : '🛑 All inboxes have reached their daily limit for today.';
      console.log(stopMsg);
      await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
      break;
    }

    // 🎯 Pick alias mapped to this inbox or matching domain
    let senderEmail = inbox.email;
    let senderName = inbox.display_name || 'Team';
    if (config.aliases.length > 0) {
      const inboxDomain = (inbox.email.split('@')[1] || '').toLowerCase();
      
      // Filter aliases assigned to this inbox or matching domain
      const eligibleAliases = config.aliases.filter(a => {
        const assignedInbox = (a.inbox_email || '').trim().toLowerCase();
        if (assignedInbox) {
          return assignedInbox === inbox.email.toLowerCase();
        }
        const aliasDomain = (a.alias_email.split('@')[1] || '').toLowerCase();
        return aliasDomain && aliasDomain === inboxDomain;
      });

      if (eligibleAliases.length > 0) {
        const chosenAlias = eligibleAliases[Math.floor(Math.random() * eligibleAliases.length)];
        senderEmail = chosenAlias.alias_email;
        senderName = chosenAlias.display_name || chosenAlias.alias_email.split('@')[0];
      }
    }

    // Personalization
    const template = config.coldTemplates[Math.floor(Math.random() * config.coldTemplates.length)];
    const fullName = (row[col['full_name']] || 'there').trim();
    const companyName = (row[col['company_name']] || 'your company').trim();
    const location = (row[col['location']] || 'your city').trim();

    const randomLocs = config.locations.filter(l => l.toLowerCase() !== location.toLowerCase())
      .sort(() => 0.5 - Math.random()).slice(0, 4).join(', ');
    const clientStr = config.clients.sort(() => 0.5 - Math.random()).slice(0, 5)
      .map(c => c.client_name || c.name).join(', ');

    const replaceTags = (txt = '') => {
      const parsedSpintax = parseSpintax(txt);
      return parsedSpintax
        .replace(/{{full_name}}/gi, fullName)
        .replace(/{{company_name}}/gi, companyName)
        .replace(/{{location}}/gi, location)
        .replace(/{{other_locations}}/gi, randomLocs)
        .replace(/{{clients}}/gi, clientStr)
        .replace(/{{Date}}/gi, getRandomFormattedDate())
        .replace(/{{business_name}}/gi, config.settings.business_name || 'Outreach Team')
        .replace(/{{business_address}}/gi, config.settings.business_address || '');
    };

    const subject = replaceTags(template.Subject || template['Subject line']);
    let body = replaceTags(template.Body || template.body);

    // Auto-inject CAN-SPAM legal footer with signed unsubscribe token
    const footer = buildSenderFooter(config.settings, { email, campaign: 'cold', senderEmail }, process.env.UNSUBSCRIBE_SECRET);
    body = `${body}${footer}`;

    let currentInboxStats = inboxStatsMap.get(inbox.email.toLowerCase()) || { sent: 0, bounced: 0, complaints: 0, sentToday: 0 };

    if (isReviewMode) {
      // 📝 DRAFT-REVIEW MODE (Save touch 1 directly into IMAP Drafts)
      try {
        await saveDraftViaImap(inbox, email, subject, body);
        draftsSavedThisRun++;
        const rowNum = i + 2;
        row[col['Subject Line']] = subject;
        row[col['Sent From']] = senderEmail;
        row[col['Sent Status']] = 'Draft — Pending Review';
        row[col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
        row[col['Date Sent']] = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

        await sendWithRetry(() => sheets.spreadsheets.values.update({
          spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
          range: `'Details'!A${rowNum}:Z${rowNum}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        }));
      } catch (draftErr) {
        console.error(`Failed to save draft for ${email}:`, draftErr.message);
        await recordFailedSend(sheets, email, 'cold', `Draft error: ${draftErr.message}`);
      }
      continue;
    }

    // 🚀 LIVE SEND WITH EXPONENTIAL RETRY WRAPPER
    const transporter = nodemailer.createTransport({
      host: inbox.smtp_host,
      port: parseInt(inbox.smtp_port, 10),
      secure: parseInt(inbox.smtp_port, 10) === 465,
      auth: { user: inbox.smtp_user, pass: inbox.smtp_pass },
    });

    try {
      await sendWithRetry(() => transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to: email,
        subject,
        html: body,
      }), { retries: 3, baseDelay: 2000 });

      inboxUsage[inbox.email]++;
      emailsSentThisRun++;
      currentInboxStats = trackOutcome(currentInboxStats, 'sent');
      inboxStatsMap.set(inbox.email.toLowerCase(), currentInboxStats);

      console.log(`[Sent] "${senderName}" <${senderEmail}> -> ${email}`);

      // Update row in sheet
      const rowNum = i + 2;
      row[col['Subject Line']] = subject;
      row[col['Sent From']] = senderEmail;
      row[col['Sent Status']] = 'SENT';
      row[col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
      row[col['Date Sent']] = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
      row[col['Follow Up Count']] = 0;
      row[col['Follow up']] = '';

      await sendWithRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      }));
    } catch (err) {
      console.error(`Failed to send to ${email}:`, err.message);
      await recordFailedSend(sheets, email, 'cold', err.message);

      if (isAuthError(err)) {
        console.error(`🚨 Authentication failed for inbox [${inbox.email}]: ${err.message}`);
        limitExceededInboxes.add(inbox.email);
        inboxUsage[inbox.email] = Infinity;

        await sendAuthFailureAlert({
          inboxEmail: inbox.email,
          errorDetails: err.message,
          webhookUrl: config.settings.discord_updates_webhook,
          context: 'Cold Outreach Live Send'
        });

        const hasAvailableInboxes = config.inboxes.some(
          i => !limitExceededInboxes.has(i.email) && inboxUsage[i.email] < parseInt(i.daily_limit || '50', 10)
        );
        if (!hasAvailableInboxes) {
          const stopMsg = `🛑 **Outreach Terminated Immediately:** Active inboxes failed authentication (Google App Password invalid or revoked). Workflow stopped.`;
          console.error(stopMsg);
          await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
          throw new Error(`Google App Password authentication failed for [${inbox.email}]. Workflow halted. Update smtp_pass in Inboxes tab.`);
        }
      } else if (isDailyLimitError(err)) {
        console.warn(`⚠️ Daily sending limit hit for inbox [${inbox.email}]. Disabling inbox for this run.`);
        limitExceededInboxes.add(inbox.email);
        inboxUsage[inbox.email] = Infinity;

        const alertMsg = `⚠️ **Daily User Sending Limit Exceeded Alert**\n` +
          `**Inbox:** \`${inbox.email}\`\n` +
          `**Failed Recipient:** \`${email}\`\n` +
          `**Error:** \`${err.message.split('\n')[0]}\`\n` +
          `ℹ️ Disabling \`${inbox.email}\` for the rest of this run.`;

        await notifyDiscord(config.settings.discord_updates_webhook, alertMsg);

        const hasAvailableInboxes = config.inboxes.some(
          i => !limitExceededInboxes.has(i.email) && inboxUsage[i.email] < parseInt(i.daily_limit || '50', 10)
        );
        if (!hasAvailableInboxes) {
          const stopMsg = `🛑 **Outreach Terminated**\nAll active inboxes hit daily sending limits / quotas. Outreach run stopped safely.`;
          console.log(stopMsg);
          await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
          break;
        }
      }
    }

    // Check deliverability alert for inbox
    await alertIfUnhealthy(currentInboxStats, config.settings.discord_updates_webhook);

    // Calculate delay between sends (supports 'adaptive' safe mode vs 'bulk' / 'fixed' high-speed mode)
    const throttleMode = String(config.settings.throttle_mode || 'adaptive').toLowerCase();
    const isBulkMode = throttleMode === 'bulk' || throttleMode === 'fixed' || throttleMode === 'turbo';

    const minD = Math.max(0, parseInt(config.settings.min_delay_seconds || (isBulkMode ? '1' : '15'), 10) * 1000);
    const maxD = Math.max(minD, parseInt(config.settings.max_delay_seconds || (isBulkMode ? '3' : '45'), 10) * 1000);
    const configDelay = Math.floor(Math.random() * (maxD - minD + 1)) + minD;
    const adaptiveDelay = isBulkMode ? 0 : getSendDelay(currentInboxStats);
    const delay = isBulkMode ? configDelay : Math.max(configDelay, adaptiveDelay);

    await new Promise(r => setTimeout(r, delay));
  }

  // Persist updated stats
  await saveInboxStatsMap(sheets, inboxStatsMap);

  const completionMsg = isReviewMode
    ? `🏁 Cold outreach review run completed (${draftsSavedThisRun} draft(s) saved).`
    : `🏁 Cold outreach run completed (${emailsSentThisRun} email(s) sent).`;
  await notifyDiscord(config.settings.discord_updates_webhook, completionMsg);
}

// ============================================================================
// ⚡ 1B. INSTANT / BULK REMOTE LEAD DISPATCHER (GitHub / Webhook Trigger)
// ============================================================================
export async function runSingleLeadOutreach(singleLeadPayload = {}) {
  // Check if leads is passed as an array or JSON string
  let leadsList = [];
  if (Array.isArray(singleLeadPayload.leads) && singleLeadPayload.leads.length > 0) {
    leadsList = singleLeadPayload.leads;
  } else if (Array.isArray(singleLeadPayload.batch) && singleLeadPayload.batch.length > 0) {
    leadsList = singleLeadPayload.batch;
  } else if (process.env.SINGLE_LEADS_JSON) {
    try {
      const parsed = JSON.parse(process.env.SINGLE_LEADS_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) leadsList = parsed;
    } catch (e) {
      console.warn('Could not parse SINGLE_LEADS_JSON:', e.message);
    }
  }

  // If no list, build single lead item from payload/env
  if (leadsList.length === 0) {
    const email = (singleLeadPayload.email || process.env.SINGLE_EMAIL || '').trim();
    if (!email) {
      const err = new Error('Recipient email (SINGLE_EMAIL) is required for single lead dispatch.');
      console.error('❌ Lead Email Error:', err.message);
      throw err;
    }

    // Single Lead pre-send MX check before getSheets
    const isDomainValid = await isValidEmailDomain(email);
    if (!isDomainValid) {
      const errorMsg = `Invalid email address or domain has no MX records.`;
      console.error(`⚠️ Single Email Failed for [${email}]: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    leadsList = [{
      email,
      full_name: singleLeadPayload.full_name || singleLeadPayload.personName || process.env.SINGLE_NAME || 'there',
      company_name: singleLeadPayload.company_name || singleLeadPayload.companyName || process.env.SINGLE_COMPANY || 'your company',
      location: singleLeadPayload.location || process.env.SINGLE_LOCATION || 'your city',
      spreadsheet_id: singleLeadPayload.spreadsheet_id || singleLeadPayload.sheet_id || process.env.SINGLE_SHEET_ID,
      webhook_url: singleLeadPayload.webhook_url || singleLeadPayload.discord_webhook || process.env.SINGLE_WEBHOOK_URL
    }];
  }

  const targetSheetId = (singleLeadPayload.spreadsheet_id || singleLeadPayload.sheet_id || leadsList[0]?.spreadsheet_id || process.env.SINGLE_SHEET_ID || SPREADSHEET_ID || '').trim();
  const customWebhookUrl = (singleLeadPayload.webhook_url || singleLeadPayload.discord_webhook || leadsList[0]?.webhook_url || process.env.SINGLE_WEBHOOK_URL || '').trim();

  const sheetsObj = await getSheets(targetSheetId);
  const { sheets, spreadsheetId } = sheetsObj;
  const config = await loadConfig(sheetsObj);
  const activeWebhookUrl = customWebhookUrl || config.settings.discord_updates_webhook || process.env.DISCORD_WEBHOOK_URL;

  // ⏸️ Master Campaign Toggle Check
  if (!isCampaignActive(config.settings, 'single_lead')) {
    const pauseMsg = '⏸️ **Campaign Paused Notice:** Single lead outreach is turned OFF/PAUSED in Google Sheet Settings (`campaign_active = FALSE`). Skipping dispatch safely.';
    console.log(pauseMsg);
    await notifyDiscord(activeWebhookUrl, pauseMsg);
    return [{ success: false, error: 'Campaign is paused in Google Sheet Settings' }];
  }

  if (!config.inboxes.length) {
    const err = new Error('No active Inboxes configured in "Inboxes" tab.');
    await notifyDiscord(activeWebhookUrl, `❌ **Email Dispatch Error**\n**Error:** \`${err.message}\``);
    throw err;
  }
  if (!config.coldTemplates.length) {
    const err = new Error('No Templates found in "Templates" tab.');
    await notifyDiscord(activeWebhookUrl, `❌ **Email Dispatch Error**\n**Error:** \`${err.message}\``);
    throw err;
  }

  console.log(`🚀 Starting Remote Dispatch batch of ${leadsList.length} lead(s)...`);

  const results = [];
  const minD = parseInt(config.settings.min_delay_seconds || '15', 10) * 1000;
  const maxD = parseInt(config.settings.max_delay_seconds || '45', 10) * 1000;

  for (let idx = 0; idx < leadsList.length; idx++) {
    const item = leadsList[idx];
    const email = (item.email || '').trim();
    const fullName = (item.full_name || item.personName || 'there').trim();
    const companyName = (item.company_name || item.companyName || 'your company').trim();
    const location = (item.location || config.settings.default_location || 'your city').trim();

    if (!email) continue;

    console.log(`[Processing ${idx + 1}/${leadsList.length}] Recipient: ${email}`);

    // 🛡️ PRE-SEND DOMAIN & MX CHECK
    const isDomainValid = await isValidEmailDomain(email);
    if (!isDomainValid) {
      const errorMsg = `Invalid email address or domain has no MX records.`;
      console.error(`⚠️ Single Email Failed for [${email}]: ${errorMsg}`);
      await notifyDiscord(
        activeWebhookUrl,
        `❌ **Email Dispatch Error**\n**Recipient:** \`${email}\`\n**Error:** \`${errorMsg}\``
      );
      results.push({ email, success: false, error: errorMsg });
      continue;
    }

    // Select active inbox & template
    const inbox = config.inboxes[Math.floor(Math.random() * config.inboxes.length)];
    let senderEmail = inbox.email;
    let senderName = inbox.display_name || 'Team';
    if (config.aliases.length > 0) {
      const inboxDomain = (inbox.email.split('@')[1] || '').toLowerCase();
      const eligibleAliases = config.aliases.filter(a => {
        const assignedInbox = (a.inbox_email || '').trim().toLowerCase();
        if (assignedInbox) return assignedInbox === inbox.email.toLowerCase();
        const aliasDomain = (a.alias_email.split('@')[1] || '').toLowerCase();
        return aliasDomain && aliasDomain === inboxDomain;
      });

      if (eligibleAliases.length > 0) {
        const chosenAlias = eligibleAliases[Math.floor(Math.random() * eligibleAliases.length)];
        senderEmail = chosenAlias.alias_email;
        senderName = chosenAlias.display_name || chosenAlias.alias_email.split('@')[0];
      }
    }

    const template = config.coldTemplates[Math.floor(Math.random() * config.coldTemplates.length)];

    // Personalization
    const randomLocs = config.locations.filter(l => l.toLowerCase() !== location.toLowerCase())
      .sort(() => 0.5 - Math.random()).slice(0, 4).join(', ');
    const clientStr = config.clients.sort(() => 0.5 - Math.random()).slice(0, 5)
      .map(c => c.client_name || c.name).join(', ');

    const replaceTags = (txt = '') => {
      const parsedSpintax = parseSpintax(txt);
      return parsedSpintax
        .replace(/{{full_name}}/gi, fullName)
        .replace(/{{company_name}}/gi, companyName)
        .replace(/{{location}}/gi, location)
        .replace(/{{other_locations}}/gi, randomLocs)
        .replace(/{{clients}}/gi, clientStr)
        .replace(/{{Date}}/gi, getRandomFormattedDate())
        .replace(/{{business_name}}/gi, config.settings.business_name || 'Outreach Team')
        .replace(/{{business_address}}/gi, config.settings.business_address || '');
    };

    const subject = replaceTags(template.Subject || template['Subject line']);
    let body = replaceTags(template.Body || template.body);
    const footer = buildSenderFooter(config.settings, { email, campaign: 'single_lead', senderEmail }, process.env.UNSUBSCRIBE_SECRET);
    body = `${body}${footer}`;

    const transporter = nodemailer.createTransport({
      host: inbox.smtp_host,
      port: parseInt(inbox.smtp_port, 10),
      secure: parseInt(inbox.smtp_port, 10) === 465,
      auth: { user: inbox.smtp_user, pass: inbox.smtp_pass },
    });

    try {
      await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to: email,
        subject,
        html: body,
      });

      console.log(`[Sent ${idx + 1}/${leadsList.length}] "${senderName}" <${senderEmail}> -> ${email}`);

      // Update or Append row in 'Details' Google Sheet
      const detailsRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Details'!A:Z" });
      const [headers, ...rows] = detailsRes.data.values || [];
      const col = Object.fromEntries((headers || []).map((h, i) => [(h || '').trim(), i]));

      const existingIndex = rows.findIndex(r => (r[col['email']] || '').trim().toLowerCase() === email.toLowerCase());

      const timeStr = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
      const dateStr = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

      if (existingIndex >= 0) {
        const rowNum = existingIndex + 2;
        const targetRow = rows[existingIndex];
        targetRow[col['full_name']] = fullName;
        targetRow[col['company_name']] = companyName;
        targetRow[col['location']] = location;
        targetRow[col['Subject Line']] = subject;
        targetRow[col['Sent From']] = senderEmail;
        targetRow[col['Sent Status']] = 'SENT';
        targetRow[col['Time']] = timeStr;
        targetRow[col['Date Sent']] = dateStr;
        targetRow[col['Follow Up Count']] = 0;
        targetRow[col['Follow up']] = '';

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'Details'!A${rowNum}:Z${rowNum}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [targetRow] },
        });
      } else {
        const newRow = [
          fullName, email, companyName, location,
          subject, senderEmail, 'SENT', timeStr,
          dateStr, '', 0, ''
        ];
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "'Details'!A:Z",
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [newRow] },
        });
      }

      results.push({ email, success: true });
    } catch (err) {
      console.error(`Failed send to ${email}:`, err.message);

      if (isAuthError(err)) {
        await sendAuthFailureAlert({
          inboxEmail: inboxToUse.email,
          errorDetails: err.message,
          webhookUrl: activeWebhookUrl,
          context: 'Single Lead Outreach Send'
        });
        throw new Error(`Google App Password authentication failed for [${inboxToUse.email}]: ${err.message}. Please update smtp_pass in Inboxes tab.`);
      }

      const errLower = (err.message || '').toLowerCase();
      const isBounce = errLower.includes('550') || errLower.includes('551') || errLower.includes('552') || errLower.includes('553') || errLower.includes('554') || errLower.includes('inactive') || errLower.includes('disabled') || errLower.includes('not found') || errLower.includes('user unknown');

      try {
        const detailsRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Details'!A:Z" });
        const [headers, ...rows] = detailsRes.data.values || [];
        const col = Object.fromEntries((headers || []).map((h, i) => [(h || '').trim(), i]));
        const existingIndex = rows.findIndex(r => (r[col['email']] || '').trim().toLowerCase() === email.toLowerCase());
        const timeStr = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
        const dateStr = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

        if (existingIndex >= 0) {
          const rowNum = existingIndex + 2;
          const targetRow = rows[existingIndex];
          targetRow[col['Sent Status']] = isBounce ? 'bounced' : 'FAILED';
          targetRow[col['Time']] = timeStr;
          targetRow[col['Date Sent']] = dateStr;
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'Details'!A${rowNum}:Z${rowNum}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [targetRow] },
          });
        } else {
          const newRow = [
            fullName, email, companyName, location,
            'N/A', senderEmail, isBounce ? 'bounced' : 'FAILED', timeStr,
            dateStr, 'Done', 0, 'BOUNCED'
          ];
          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "'Details'!A:Z",
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [newRow] },
          });
        }
      } catch (e) {
        console.warn('Could not record failure status in Google Sheet:', e.message);
      }

      await notifyDiscord(
        activeWebhookUrl,
        `❌ **Email ${isBounce ? 'Bounced (Inactive Account)' : 'Dispatch Error'}**\n**Recipient:** \`${email}\`\n**Error:** \`${err.message}\``
      );
      results.push({ email, success: false, error: err.message, isBounce });
    }

    // Delay between sends (following Google Sheet settings) if there are more leads
    if (idx < leadsList.length - 1) {
      const delay = Math.floor(Math.random() * (maxD - minD + 1)) + minD;
      console.log(`⏳ Delaying ${Math.round(delay / 1000)}s before next send (following Sheet settings)...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.log(`🏁 Batch finished! Processed ${leadsList.length} leads.`);
  return { success: true, count: leadsList.length, results };
}

// ============================================================================
// 🔁 2. FOLLOW-UP ENGINE (Guaranteed to match initial sender & alias)
// ============================================================================
export async function runFollowups() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);

  // ⏸️ Master Campaign Toggle Check
  if (!isCampaignActive(config.settings, 'followup')) {
    const pauseMsg = '⏸️ **Campaign Paused Notice:** Follow-up engine is turned OFF/PAUSED in Google Sheet Settings (`campaign_active = FALSE`). Skipping run safely.';
    console.log(pauseMsg);
    await notifyDiscord(config.settings.discord_updates_webhook, pauseMsg);
    return;
  }

  if (!config.inboxes.length) throw new Error('No active Inboxes found.');
  if (!config.followupTemplates.length) throw new Error('No Follow-up Templates found.');

  const detailsRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID, range: "'Details'!A:Z" });
  const [headers, ...rows] = detailsRes.data.values || [];
  const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));
  const limitExceededInboxes = new Set();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = (row[col['email']] || '').trim();
    const subjectLine = row[col['Subject Line']];
    const sentStatus = (row[col['Sent Status']] || '').trim().toLowerCase();
    const followUpStatus = (row[col['Follow up']] || '').trim().toLowerCase();
    const currentCount = parseInt(row[col['Follow Up Count']] || '0', 10);
    const nextDueDateStr = row[col['Next Follow Up Date']];
    const originalSenderEmail = (row[col['Sent From']] || '').trim();

    if (
      !email ||
      sentStatus !== 'sent' ||
      sentStatus === 'replied' ||
      sentStatus === 'bounced' ||
      followUpStatus === 'done' ||
      !subjectLine
    ) {
      continue;
    }

    if (nextDueDateStr) {
      const [d, m, y] = nextDueDateStr.split('/').map(Number);
      const dueDate = new Date(y, m - 1, d);
      if (dueDate && today < dueDate) continue;
    }

    const nextCount = currentCount + 1;
    if (nextCount > config.followupTemplates.length) {
      const rowNum = i + 2;
      row[col['Follow up']] = 'Done';
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
      continue;
    }

    const template = config.followupTemplates.find(t => parseInt(t['Follow_Up_Number'], 10) === nextCount) ||
                     config.followupTemplates[0];

    // 🎯 1. MATCH EXACT ALIAS & DISPLAY NAME
    const matchedAlias = config.aliases.find(a => a.alias_email.toLowerCase() === originalSenderEmail.toLowerCase());
    const senderName = matchedAlias ? matchedAlias.display_name : (originalSenderEmail.split('@')[0] || 'Team');
    const senderEmail = originalSenderEmail || config.inboxes[0].email;

    // 🎯 2. MATCH INBOX CREDENTIALS FOR THIS SENDER (Exact Mailbox, Assigned Inbox, or Same Domain)
    let inboxToUse = config.inboxes.find(i => i.email.toLowerCase() === originalSenderEmail.toLowerCase());
    if (!inboxToUse && matchedAlias && matchedAlias.inbox_email) {
      inboxToUse = config.inboxes.find(i => i.email.toLowerCase() === matchedAlias.inbox_email.trim().toLowerCase());
    }
    if (!inboxToUse && originalSenderEmail.includes('@')) {
      const senderDomain = originalSenderEmail.split('@')[1].toLowerCase();
      inboxToUse = config.inboxes.find(i => (i.email.split('@')[1] || '').toLowerCase() === senderDomain);
    }
    if (!inboxToUse) inboxToUse = config.inboxes[0];

    if (limitExceededInboxes.has(inboxToUse.email)) {
      inboxToUse = config.inboxes.find(i => !limitExceededInboxes.has(i.email));
    }

    if (!inboxToUse) {
      const stopMsg = `🛑 **Follow-ups Terminated:** All active inboxes have hit daily sending limits / quotas.`;
      console.log(stopMsg);
      await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
      break;
    }

    const fullName = (row[col['full_name']] || 'there').trim();
    const companyName = (row[col['company_name']] || 'your company').trim();
    const location = (row[col['location']] || 'your city').trim();

    const randomLocs = config.locations.filter(l => l.toLowerCase() !== location.toLowerCase())
      .sort(() => 0.5 - Math.random()).slice(0, 4).join(', ');
    const clientStr = config.clients.sort(() => 0.5 - Math.random()).slice(0, 5)
      .map(c => c.client_name || c.name).join(', ');

    const replaceTags = (txt = '') => {
      const parsedSpintax = parseSpintax(txt);
      return parsedSpintax
        .replace(/{{full_name}}/g, fullName)
        .replace(/{{company_name}}/g, companyName)
        .replace(/{{Date}}/gi, getRandomFormattedDate())
        .replace(/{{location}}/g, location)
        .replace(/{{other_locations}}/g, randomLocs)
        .replace(/{{clients}}/g, clientStr)
        .replace(/{{follow_up_number}}/g, String(nextCount))
        .replace(/{{business_name}}/gi, config.settings.business_name || 'Outreach Team')
        .replace(/{{business_address}}/gi, config.settings.business_address || '');
    };

    const finalSubj = `${replaceTags(template.Subject || 'Re:')} ${subjectLine}`.trim();
    let finalBody = replaceTags(template.Body || template.body);
    const footer = buildSenderFooter(config.settings, { email, campaign: 'followup', senderEmail }, process.env.UNSUBSCRIBE_SECRET);
    finalBody = `${finalBody}${footer}`;

    const transporter = nodemailer.createTransport({
      host: inboxToUse.smtp_host,
      port: parseInt(inboxToUse.smtp_port, 10),
      secure: parseInt(inboxToUse.smtp_port, 10) === 465,
      auth: { user: inboxToUse.smtp_user, pass: inboxToUse.smtp_pass },
    });

    try {
      await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to: email,
        subject: finalSubj,
        html: finalBody,
      });

      console.log(`[Follow-up #${nextCount}] Sent from "${senderName}" <${senderEmail}> to: ${email}`);

      row[col['Date Sent']] = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

      const daysUntilNext = parseInt(template.Days_Until_Next || '3', 10);
      let nextDateStr = '';
      if (daysUntilNext > 0) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + daysUntilNext);
        nextDateStr = `${String(nextDate.getDate()).padStart(2, '0')}/${String(nextDate.getMonth() + 1).padStart(2, '0')}/${nextDate.getFullYear()}`;
      }

      const rowNum = i + 2;
      row[col['Follow Up Count']] = nextCount;
      row[col['Next Follow Up Date']] = nextDateStr;
      if (nextCount >= config.followupTemplates.length) {
        row[col['Follow up']] = 'Done';
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
    } catch (e) {
      console.error(`Follow-up failed for ${email}:`, e.message);
      await recordFailedSend(sheets, email, `followup_${nextCount}`, e.message);

      if (isAuthError(e)) {
        console.error(`🚨 Follow-up authentication failed for inbox [${inboxToUse.email}]: ${e.message}`);
        limitExceededInboxes.add(inboxToUse.email);

        await sendAuthFailureAlert({
          inboxEmail: inboxToUse.email,
          errorDetails: e.message,
          webhookUrl: config.settings.discord_updates_webhook,
          context: `Follow-up Sequence (Touch #${nextCount})`
        });

        if (config.inboxes.every(i => limitExceededInboxes.has(i.email))) {
          const stopMsg = `🛑 **Follow-ups Terminated Immediately:** Active inboxes failed authentication (Google App Password invalid or revoked). Workflow stopped.`;
          console.error(stopMsg);
          await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
          throw new Error(`Google App Password authentication failed for [${inboxToUse.email}]. Workflow halted. Update smtp_pass in Inboxes tab.`);
        }
      } else if (isDailyLimitError(e)) {
        console.warn(`⚠️ Daily sending limit hit for inbox [${inboxToUse.email}]. Disabling inbox for follow-ups.`);
        limitExceededInboxes.add(inboxToUse.email);

        const alertMsg = `⚠️ **Daily User Sending Limit Exceeded Alert (Follow-up)**\n` +
          `**Inbox:** \`${inboxToUse.email}\`\n` +
          `**Failed Recipient:** \`${email}\`\n` +
          `**Error:** \`${e.message.split('\n')[0]}\`\n` +
          `ℹ️ Disabling \`${inboxToUse.email}\` for follow-ups.`;

        await notifyDiscord(config.settings.discord_updates_webhook, alertMsg);

        if (config.inboxes.every(i => limitExceededInboxes.has(i.email))) {
          const stopMsg = `🛑 **Follow-ups Terminated**\nAll active inboxes hit daily sending limits / quotas. Follow-up run stopped safely.`;
          console.log(stopMsg);
          await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
          break;
        }
      }
    }

    await new Promise(r => setTimeout(r, 20000));
  }
}

// Helper for AI Email Sentiment Classification & Summarization (Resilient Fallback)
export async function classifyEmailWithAi(groq, emailText = '') {
  let sentiment = 'REPLIED';
  let summary = (emailText || '').trim().replace(/\s+/g, ' ').substring(0, 150);
  if (summary.length === 150) summary += '...';

  if (!groq || !emailText) {
    return { sentiment, summary };
  }

  const modelsToTry = [
    'openai/gpt-oss-120b',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant'
  ];

  for (const model of modelsToTry) {
    try {
      const aiRes = await sendWithRetry(() => groq.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `You are an expert sales email assistant. Analyze the incoming lead reply and respond ONLY with a raw, valid JSON object containing exactly 2 keys:
{
  "sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "OOO",
  "summary": "1-2 sentence summary of the lead's message, questions, or objections"
}

Definitions:
- "POSITIVE": Interested, asking for pricing/call/demo, sharing calendar link, requesting info.
- "NEUTRAL": Forwarded to another person, ask to reach back in a few months, generic reply.
- "NEGATIVE": Not interested, asking to unsubscribe/remove, angry, not relevant.
- "OOO": Automated Out of Office / Vacation auto-responder.

Do NOT include markdown backticks or any conversational text. Return only the JSON.`
          },
          { role: 'user', content: emailText.substring(0, 3000) }
        ],
      }), { retries: 2, baseDelay: 1000 });

      const rawText = aiRes.choices[0]?.message?.content?.trim() || '';
      const cleanJsonText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
      const parsedObj = JSON.parse(cleanJsonText);

      if (parsedObj.sentiment) {
        sentiment = String(parsedObj.sentiment).trim().toUpperCase();
      }
      if (parsedObj.summary) {
        summary = String(parsedObj.summary).trim();
      }
      return { sentiment, summary };
    } catch (e) {
      console.warn(`Groq AI classification with ${model} failed (${e.message}), trying fallback model...`);
    }
  }

  return { sentiment: 'unknown', summary };
}

// ============================================================================
// 📥 3. 24/7 INBOX & BOUNCE CHECKER
// ============================================================================
export async function runInboxChecker() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);
  const groq = config.settings.groq_api_key && config.settings.groq_api_key.startsWith('gsk_') 
    ? new Groq({ apiKey: config.settings.groq_api_key }) : null;

  const detailsRes = await sendWithRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
    range: "'Details'!A:Z",
  }), { retries: 2 });

  const [headers, ...rows] = detailsRes.data.values || [];
  const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));

  const internalEmails = [
    ...config.inboxes.map(i => i.email.toLowerCase()),
    ...config.aliases.map(a => a.alias_email.toLowerCase())
  ];

  for (const inbox of config.inboxes) {
    if (!inbox.imap_host) continue;

    console.log(`Scanning inbox: ${inbox.email}...`);
    const client = new ImapFlow({
      host: inbox.imap_host,
      port: parseInt(inbox.imap_port || '993', 10),
      secure: true,
      auth: { user: inbox.smtp_user, pass: inbox.smtp_pass },
      logger: false,
      socketTimeout: 60000,
      clientInfo: { name: 'UniversalOutreachBot' }
    });

    // 🛡️ Prevent Unhandled 'error' event crash on socket timeout or disconnection
    client.on('error', (err) => {
      console.warn(`⚠️ [IMAP Socket/Connection Warning] ${inbox.email}: ${err.message}`);
    });

    let lock = null;
    try {
      await client.connect();
      lock = await client.getMailboxLock('INBOX');

      // 1. Fetch all unseen messages into memory so the IMAP fetch stream closes cleanly
      const unseenMessages = [];
      for await (const msg of client.fetch({ seen: false }, { uid: true, source: true })) {
        unseenMessages.push(msg);
      }

      // 2. Mark all unseen message UIDs as \Seen in one single batch command
      const uidsToMark = unseenMessages.map(m => m.uid).filter(Boolean);
      if (uidsToMark.length > 0) {
        try {
          await client.messageFlagsAdd(uidsToMark, ['\\Seen'], { uid: true });
          console.log(`👁️ Marked ${uidsToMark.length} message(s) as \\Seen in ${inbox.email}`);
        } catch (flagErr) {
          console.warn(`Could not set \\Seen flags in ${inbox.email}:`, flagErr.message);
        }
      }

      // 3. Process each message without blocking IMAP connection
      const processedFromAddrs = new Set();
      for (const msg of unseenMessages) {
        const parsed = await simpleParser(msg.source);
        const fromAddr = parsed.from?.value[0]?.address?.toLowerCase() || '';

        if (!fromAddr || internalEmails.includes(fromAddr)) continue;

        // A. Bounce Detection
        const isBounce = parsed.from?.text?.includes('mailer-daemon') ||
                         parsed.from?.text?.includes('postmaster') ||
                         parsed.headers.get('auto-submitted') === 'auto';

        if (isBounce) {
          const match = (parsed.text || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)
            ?.find(e => !e.includes('mailer') && !e.includes('postmaster'));

          if (match) {
            const rIdx = rows.findIndex(r => (r[col['email']] || '').toLowerCase() === match.toLowerCase());
            if (rIdx !== -1) {
              rows[rIdx][col['Sent Status']] = 'bounced';
              rows[rIdx][col['Follow up']] = 'Done';
              rows[rIdx][col['Date Sent']] = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
              rows[rIdx][col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

              await sendWithRetry(() => sheets.spreadsheets.values.update({
                spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
                range: `'Details'!A${rIdx + 2}:Z${rIdx + 2}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [rows[rIdx]] },
              }));
              console.log(`🔒 Marked [${match}] as BOUNCED & Follow-up as DONE`);
            }
          }
          continue;
        }

        // B. Prospect Reply Detection
        const rIdx = rows.findIndex(r => (r[col['email']] || '').toLowerCase() === fromAddr);
        if (rIdx !== -1) {
          const existingStatus = (rows[rIdx][col['Sent Status']] || '').trim().toLowerCase();
          const existingSentiment = (rows[rIdx][col['Next Follow Up Date']] || '').trim().toUpperCase();

          // Check if lead was ALREADY positive/neutral or already marked as replied
          const isExistingLead = existingStatus === 'replied' || existingSentiment === 'POSITIVE' || existingSentiment === 'NEUTRAL';

          const { sentiment, summary } = await classifyEmailWithAi(groq, parsed.text || '');

          rows[rIdx][col['Sent Status']] = 'replied';
          rows[rIdx][col['Follow up']] = 'Done';
          rows[rIdx][col['Date Sent']] = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
          if (col['Next Follow Up Date'] !== undefined) {
            rows[rIdx][col['Next Follow Up Date']] = sentiment;
          }
          if (col['Summary'] !== undefined) {
            rows[rIdx][col['Summary']] = summary;
          }
          rows[rIdx][col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

          // ⛔ Automatically add to Suppression List if lead opted out or expressed negative sentiment
          const rawReplyText = (parsed.text || '').toLowerCase();
          const isOptOut = sentiment === 'NEGATIVE' || 
                           rawReplyText.includes('unsubscribe') || 
                           rawReplyText.includes('opt out') || 
                           rawReplyText.includes('remove me') || 
                           rawReplyText.includes('stop emailing');

          if (isOptOut) {
            rows[rIdx][col['Sent Status']] = 'suppressed';
            try {
              await addToSuppression(sheets, sheets.spreadsheetId || SPREADSHEET_ID, fromAddr, 'Unsubscribed via reply');
              console.log(`⛔ Auto-suppressed lead [${fromAddr}] in Suppressed tab.`);
            } catch (supErr) {
              console.warn(`Could not add ${fromAddr} to Suppressed tab:`, supErr.message);
            }
          }

          await sendWithRetry(() => sheets.spreadsheets.values.update({
            spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
            range: `'Details'!A${rIdx + 2}:Z${rIdx + 2}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [rows[rIdx]] },
          }));

          const leadName = rows[rIdx][col['full_name']] || fromAddr;
          const companyName = rows[rIdx][col['company_name']] || 'Company';

          if (isExistingLead) {
            // 💬 Existing Lead Re-reply / Follow-up Notification
            const rereplyWebhook = config.settings.discord_rereply_webhook || config.settings.discord_positive_webhook || config.settings.discord_updates_webhook;
            console.log(`🎯 Re-reply from existing lead [${fromAddr}] (${sentiment}). Notifying re-reply channel...`);

            if (rereplyWebhook) {
              const msgContent =
`💬 **Existing Lead Re-Reply Alert (${sentiment})**
**From:** ${leadName} (\`${fromAddr}\`)
**Company:** ${companyName}
**Subject:** ${parsed.subject || 'No Subject'}
**Inbox:** ${inbox.email}
**Summary:** ${summary}`;
              await notifyDiscord(rereplyWebhook, msgContent);
            }
          } else {
            // 🔥 First-time New Lead Notification
            console.log(`🎯 New lead reply from [${fromAddr}] (${sentiment}).`);
            if (sentiment === 'POSITIVE' || sentiment === 'NEUTRAL') {
              const positiveWebhook = config.settings.discord_positive_webhook || config.settings.discord_updates_webhook;
              if (positiveWebhook) {
                const msgContent =
`🔥 **${sentiment} Lead Alert (New Lead)**
**From:** ${leadName} (\`${fromAddr}\`)
**Company:** ${companyName}
**Subject:** ${parsed.subject || 'No Subject'}
**Inbox:** ${inbox.email}
**Summary:** ${summary}`;
                await notifyDiscord(positiveWebhook, msgContent);
              }
            }
          }
        }
      }
    } catch (e) {
      if (isAuthError(e)) {
        console.error(`🚨 IMAP authentication failed for ${inbox.email}:`, e.message);
        await sendAuthFailureAlert({
          inboxEmail: inbox.email,
          errorDetails: `IMAP: ${e.message}`,
          webhookUrl: config.settings.discord_updates_webhook,
          context: 'Inbox Reply Checker (IMAP Audit)'
        });
      } else if (e.message && (e.message.includes('Connection not available') || e.message.includes('Socket timeout') || e.message.includes('closed'))) {
        console.warn(`ℹ️ [IMAP Notice] ${inbox.email}: Connection closed (${e.message})`);
      } else {
        console.error(`IMAP error for ${inbox.email}:`, e.message);
      }
    } finally {
      if (lock) {
        try { lock.release(); } catch (_) {}
      }
      try {
        if (client.usable || client.authenticated) {
          await client.logout();
        } else {
          client.close();
        }
      } catch (_) {
        try { client.close(); } catch (_) {}
      }
    }
  }
}

// Normalize dates to DD/MM/YYYY for strict matching
export function normalizeDate(dateStr) {
  if (!dateStr) return '';
  const clean = String(dateStr).trim().split('T')[0];
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

// ============================================================================
// 📊 4. DAILY DISCORD ANALYTICS DIGEST
// ============================================================================
export async function generateDailyDigest() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);

  const detailsRes = await sheets.spreadsheets.values.get({ 
    spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID, 
    range: "'Details'!A:Z" 
  });
  const [headers, ...rows] = detailsRes.data.values || [];
  const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));

  const todayIST = normalizeDate(new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }));
  const formattedDateStr = new Date().toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  let coldSentToday = 0;
  let followupsSentToday = 0;
  let bouncesTotal = 0;
  let repliesTotal = 0;
  let positiveCount = 0;
  let neutralCount = 0;
  let negativeCount = 0;

  for (const row of rows) {
    const rawSentDate = (row[col['Date Sent']] || '').trim();
    const sentDate = normalizeDate(rawSentDate);
    const sentStatus = (row[col['Sent Status']] || '').trim().toLowerCase();
    const followUpCount = parseInt(row[col['Follow Up Count']] || '0', 10);
    const sentiment = (row[col['Next Follow Up Date']] || '').trim().toUpperCase();

    // STRICT FILTER: Only count leads that have TODAY's date in 'Date Sent' column
    if (sentDate !== todayIST) {
      continue;
    }

    // Cold outreach sent today
    if (followUpCount === 0 && (sentStatus === 'sent' || sentStatus === 'replied')) {
      coldSentToday++;
    }

    // Follow-ups sent today
    if (followUpCount > 0 && (sentStatus === 'sent' || sentStatus === 'replied')) {
      followupsSentToday++;
    }

    // Bounces today
    if (sentStatus === 'bounced') {
      bouncesTotal++;
    }

    // Replies received today
    if (sentStatus === 'replied') {
      repliesTotal++;
      if (sentiment.includes('POSITIVE')) positiveCount++;
      else if (sentiment.includes('NEGATIVE')) negativeCount++;
      else neutralCount++;
    }
  }

  const message = 
`📊 **Daily Outreach Summary (${formattedDateStr})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📤 **Cold Emails Sent:**   ${coldSentToday.toLocaleString()}
🔁 **Follow-ups Sent:**    ${followupsSentToday.toLocaleString()}
🎯 **Inbound Replies:**    ${repliesTotal.toLocaleString()} (${positiveCount} Positive 🔥, ${neutralCount} Neutral 💬, ${negativeCount} Negative ❌)
🔒 **Bounces Caught:**     ${bouncesTotal.toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  console.log(message);
  await notifyDiscord(config.settings.discord_updates_webhook, message);
}

// ==========================================
// 🏁 ROUTER & MAIN ENTRY POINT
// ==========================================
async function main() {
  const task = process.argv[2];
  try {
    if (task === 'outreach') {
      await runColdOutreach();
    } else if (task === 'single_lead') {
      await runSingleLeadOutreach();
    } else if (task === 'followup') {
      await runFollowups();
    } else if (task === 'inbox') {
      await runInboxChecker();
    } else if (task === 'digest') {
      await generateDailyDigest();
    } else if (task === 'warmup') {
      const sheets = await getSheets();
      const config = await loadConfig(sheets);
      console.log('🔥 Running Peer-to-Peer Warmup Routine...');
      const warmupRes = await runWarmupCycle(config.inboxes, async (sender, recipientEmail, subject, body) => {
        try {
          const transporter = nodemailer.createTransport({
            host: sender.smtp_host,
            port: parseInt(sender.smtp_port, 10),
            secure: parseInt(sender.smtp_port, 10) === 465,
            auth: { user: sender.smtp_user, pass: sender.smtp_pass },
          });
          await transporter.sendMail({
            from: `"${sender.display_name || sender.email}" <${sender.email}>`,
            to: recipientEmail,
            subject,
            text: body,
          });
        } catch (warmupErr) {
          if (isAuthError(warmupErr)) {
            await sendAuthFailureAlert({
              inboxEmail: sender.email,
              errorDetails: warmupErr.message,
              webhookUrl: config.settings.discord_updates_webhook,
              context: 'Peer-to-Peer Warmup Routine'
            });
          }
          throw warmupErr;
        }
      });
    } else if (task === 'diagnostic' || task === 'diagnostics') {
      const { runCampaignDiagnostics } = await import('./scripts/run-campaign-diagnostics.mjs');
      await runCampaignDiagnostics();
    } else if (task === 'domain-health' || task === 'domain_health') {
      const { runDomainHealth } = await import('./scripts/run-domain-health.mjs');
      if (typeof runDomainHealth === 'function') {
        await runDomainHealth();
      }
    } else if (task) {
      console.warn(`Unknown task: ${task}`);
    }
  } catch (err) {
    console.error(`Fatal error during task [${task}]:`, err);
    try {
      const sheets = await getSheets();
      const config = await loadConfig(sheets);
      await notifyDiscord(
        config.settings.discord_updates_webhook,
        `❌ **Engine Task Failed Alert**\n**Task:** \`${task}\`\n**Error:** \`${err.message || err}\``
      );
    } catch (notifyErr) {
      await notifyDiscord(
        null,
        `❌ **Engine Task Failed Alert**\n**Task:** \`${task}\`\n**Error:** \`${err.message || err}\``
      );
    }
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main();
}

import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import Groq from 'groq-sdk';
import axios from 'axios';
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Google Sheets Authentication
async function getSheets(customSheetId) {
  const targetSheetId = customSheetId || process.env.SINGLE_SHEET_ID || SPREADSHEET_ID;
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !targetSheetId) {
    throw new Error('Spreadsheet credentials not set. Set SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON.');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return { sheets: google.sheets({ version: 'v4', auth }), spreadsheetId: targetSheetId };
}

// Load a specific tab
async function loadTab(sheetsObj, tabName) {
  const sheets = sheetsObj?.sheets || sheetsObj;
  const spreadsheetId = sheetsObj?.spreadsheetId || process.env.SINGLE_SHEET_ID || SPREADSHEET_ID;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A:Z`,
    });
    const [headers, ...rows] = res.data.values || [];
    if (!headers) return [];
    return rows.map(r => Object.fromEntries(headers.map((h, i) => [(h || '').trim(), (r[i] || '').trim()])));
  } catch (e) {
    console.warn(`Could not load tab [${tabName}]: ${e.message}`);
    return [];
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
async function notifyDiscord(url, content) {
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

// ============================================================================
// 🚀 1. COLD OUTREACH SENDER
// ============================================================================
export async function runColdOutreach() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);

  if (!config.inboxes.length) throw new Error('No active Inboxes configured in "Inboxes" tab.');
  if (!config.coldTemplates.length) throw new Error('No Templates found in "Templates" tab.');

  await notifyDiscord(config.settings.discord_updates_webhook, '🚀 Auto bulk cold outreach started');

  const detailsRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'Details'!A:Z" });
  const [headers, ...rows] = detailsRes.data.values || [];
  const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));

  const inboxUsage = Object.fromEntries(config.inboxes.map(i => [i.email, 0]));
  const limitExceededInboxes = new Set();
  let inboxIdx = 0;
  let emailsSentThisRun = 0;
  const MAX_PER_RUN = parseInt(config.settings.max_emails_per_run || '1000', 10);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = (row[col['email']] || '').trim();
    const status = (row[col['Sent Status']] || '').trim().toLowerCase();

    // Skip if already sent, replied, bounced, or empty email
    if (!email || status === 'sent' || status === 'replied' || status === 'bounced') {
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

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });

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

    // Pick alias
    let senderEmail = inbox.email;
    let senderName = inbox.display_name || 'Team';
    if (config.aliases.length > 0) {
      const chosenAlias = config.aliases[Math.floor(Math.random() * config.aliases.length)];
      senderEmail = chosenAlias.alias_email;
      senderName = chosenAlias.display_name || chosenAlias.alias_email.split('@')[0];
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

    const replaceTags = (txt = '') => txt
      .replace(/{{full_name}}/gi, fullName)
      .replace(/{{company_name}}/gi, companyName)
      .replace(/{{location}}/gi, location)
      .replace(/{{other_locations}}/gi, randomLocs)
      .replace(/{{clients}}/gi, clientStr)
      .replace(/{{Date}}/gi, getRandomFormattedDate());

    const subject = replaceTags(template.Subject || template['Subject line']);
    const body = replaceTags(template.Body || template.body);

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

      inboxUsage[inbox.email]++;
      emailsSentThisRun++;
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

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
    } catch (err) {
      console.error(`Failed to send to ${email}:`, err.message);
      if (isDailyLimitError(err)) {
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

    // Delay between sends
    const minD = parseInt(config.settings.min_delay_seconds || '15', 10) * 1000;
    const maxD = parseInt(config.settings.max_delay_seconds || '45', 10) * 1000;
    const delay = Math.floor(Math.random() * (maxD - minD + 1)) + minD;
    await new Promise(r => setTimeout(r, delay));
  }

  await notifyDiscord(config.settings.discord_updates_webhook, '🏁 Cold outreach run completed.');
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
      const chosenAlias = config.aliases[Math.floor(Math.random() * config.aliases.length)];
      senderEmail = chosenAlias.alias_email;
      senderName = chosenAlias.display_name || chosenAlias.alias_email.split('@')[0];
    }

    const template = config.coldTemplates[Math.floor(Math.random() * config.coldTemplates.length)];

    // Personalization
    const randomLocs = config.locations.filter(l => l.toLowerCase() !== location.toLowerCase())
      .sort(() => 0.5 - Math.random()).slice(0, 4).join(', ');
    const clientStr = config.clients.sort(() => 0.5 - Math.random()).slice(0, 5)
      .map(c => c.client_name || c.name).join(', ');

    const replaceTags = (txt = '') => txt
      .replace(/{{full_name}}/gi, fullName)
      .replace(/{{company_name}}/gi, companyName)
      .replace(/{{location}}/gi, location)
      .replace(/{{other_locations}}/gi, randomLocs)
      .replace(/{{clients}}/gi, clientStr)
      .replace(/{{Date}}/gi, getRandomFormattedDate());

    const subject = replaceTags(template.Subject || template['Subject line']);
    const body = replaceTags(template.Body || template.body);

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

  if (!config.inboxes.length) throw new Error('No active Inboxes found.');
  if (!config.followupTemplates.length) throw new Error('No Follow-up Templates found.');

  const detailsRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'Details'!A:Z" });
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

    // 🎯 2. MATCH INBOX CREDENTIALS FOR THIS SENDER DOMAIN
    let inboxToUse = config.inboxes.find(i => i.email.toLowerCase() === originalSenderEmail.toLowerCase());
    if (!inboxToUse && originalSenderEmail.includes('@')) {
      const senderDomain = originalSenderEmail.split('@')[1].toLowerCase();
      inboxToUse = config.inboxes.find(i => i.email.toLowerCase().endsWith(`@${senderDomain}`));
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

    const replaceTags = (txt = '') => txt
      .replace(/{{full_name}}/g, fullName)
      .replace(/{{company_name}}/g, companyName)
      .replace(/{{Date}}/gi, getRandomFormattedDate())
      .replace(/{{location}}/g, location)
      .replace(/{{other_locations}}/g, randomLocs)
      .replace(/{{clients}}/g, clientStr)
      .replace(/{{follow_up_number}}/g, String(nextCount));

    const finalSubj = `${replaceTags(template.Subject || 'Re:')} ${subjectLine}`.trim();
    const finalBody = replaceTags(template.Body || template.body);

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
        spreadsheetId: SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
    } catch (e) {
      console.error(`Follow-up failed for ${email}:`, e.message);
      if (isDailyLimitError(e)) {
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

// ============================================================================
// 📥 3. 24/7 INBOX & BOUNCE CHECKER
// ============================================================================
export async function runInboxChecker() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);
  const groq = config.settings.groq_api_key && config.settings.groq_api_key.startsWith('gsk_') 
    ? new Groq({ apiKey: config.settings.groq_api_key }) : null;

  const detailsRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'Details'!A:Z" });
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
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        for await (const msg of client.fetch({ seen: false }, { source: true })) {
          const parsed = await simpleParser(msg.source);
          const fromAddr = parsed.from?.value[0]?.address?.toLowerCase() || '';

          if (internalEmails.includes(fromAddr)) continue;

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
                rows[rIdx][col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

                await sheets.spreadsheets.values.update({
                  spreadsheetId: SPREADSHEET_ID,
                  range: `'Details'!A${rIdx + 2}:Z${rIdx + 2}`,
                  valueInputOption: 'USER_ENTERED',
                  requestBody: { values: [rows[rIdx]] },
                });
                console.log(`🔒 Marked [${match}] as BOUNCED & Follow-up as DONE`);
              }
            }
            continue;
          }

          // B. Prospect Reply Detection
          const rIdx = rows.findIndex(r => (r[col['email']] || '').toLowerCase() === fromAddr);
          if (rIdx !== -1) {
            let sentiment = 'REPLIED';

            if (groq) {
              try {
                const aiRes = await groq.chat.completions.create({
                  model: 'openai/gpt-oss-120b',
                  messages: [
                    { role: 'system', content: 'Classify sentiment in ONE word: POSITIVE, NEUTRAL, NEGATIVE, or OOO.' },
                    { role: 'user', content: parsed.text || '' },
                  ],
                });
                sentiment = aiRes.choices[0].message.content.trim().toUpperCase();
              } catch (e) {
                console.error('Groq AI error:', e.message);
              }
            }

            rows[rIdx][col['Sent Status']] = 'replied';
            rows[rIdx][col['Follow up']] = 'Done';
            if (col['Next Follow Up Date'] !== undefined) {
              rows[rIdx][col['Next Follow Up Date']] = sentiment;
            }
            rows[rIdx][col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

            await sheets.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: `'Details'!A${rIdx + 2}:Z${rIdx + 2}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [rows[rIdx]] },
            });

            console.log(`🎯 Marked [${fromAddr}] as REPLIED (${sentiment}) & Follow-up as DONE`);

            if (sentiment === 'POSITIVE' || sentiment === 'NEUTRAL') {
              await notifyDiscord(config.settings.discord_positive_webhook,
                `🔥 **${sentiment} Lead Alert**\n**From:** ${fromAddr}\n**Subject:** ${parsed.subject}\n**Inbox:** ${inbox.email}`);
            }
          }
        }
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (e) {
      console.error(`IMAP error for ${inbox.email}:`, e.message);
    }
  }
}

// ============================================================================
// 📊 4. DAILY DISCORD ANALYTICS DIGEST
// ============================================================================
export async function generateDailyDigest() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);

  const detailsRes = await sheets.spreadsheets.values.get({ 
    spreadsheetId: SPREADSHEET_ID, 
    range: "'Details'!A:Z" 
  });
  const [headers, ...rows] = detailsRes.data.values || [];
  const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));

  const todayIST = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
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
    const sentDate = (row[col['Date Sent']] || '').trim();
    const sentStatus = (row[col['Sent Status']] || '').trim().toLowerCase();
    const followUpCount = parseInt(row[col['Follow Up Count']] || '0', 10);
    const sentiment = (row[col['Next Follow Up Date']] || '').trim().toUpperCase();

    // Cold outreach sent today
    if (sentDate === todayIST && followUpCount === 0 && (sentStatus === 'sent' || sentStatus === 'replied')) {
      coldSentToday++;
    }

    // Follow-ups sent today
    if (sentDate === todayIST && followUpCount > 0) {
      followupsSentToday++;
    }

    // Bounces
    if (sentStatus === 'bounced') {
      bouncesTotal++;
    }

    // Replies & Sentiment breakdown
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
    if (task === 'outreach') await runColdOutreach();
    else if (task === 'single_lead') await runSingleLeadOutreach();
    else if (task === 'followup') await runFollowups();
    else if (task === 'inbox') await runInboxChecker();
    else if (task === 'digest') await generateDailyDigest();
    else if (task) console.warn(`Unknown task: ${task}`);
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

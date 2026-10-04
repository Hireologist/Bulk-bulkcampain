import { google } from 'googleapis';
import { ImapFlow } from 'imapflow';
import dns from 'node:dns/promises';
import { sendWithRetry } from './retry.mjs';
import { checkAndResetDailyStats } from './throttle.mjs';
import { verifyReputationCompliance } from './dns-check.mjs';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || process.env.SHEET_ID;

// Google Sheets Authentication (Supports JSON string or separate Email + Key)
export async function getSheets(customSheetId) {
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
export async function ensureTabExists(sheetsObj, tabName, defaultHeaders = []) {
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
export async function loadTab(sheetsObj, tabName) {
  const sheets = sheetsObj?.sheets || sheetsObj;
  const spreadsheetId = sheetsObj?.spreadsheetId || process.env.SINGLE_SHEET_ID || SPREADSHEET_ID;
  try {
    const res = await sendWithRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A:ZZ`,
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
export async function recordFailedSend(sheetsObj, leadEmail, campaign, errorMessage) {
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
export async function loadInboxStatsMap(sheetsObj) {
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
export async function saveInboxStatsMap(sheetsObj, statsMap) {
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
export async function loadConfig(sheets) {
  // 🛡️ Deliverability Reputation Compliance Safeguard
  const repPolicy = await verifyReputationCompliance({
    spreadsheetId: sheets?.spreadsheetId || SPREADSHEET_ID,
    task: process.argv[2] || 'outreach',
  });

  if (repPolicy && repPolicy.allowed === false) {
    console.error('\n🛡️ [Deliverability Shield] Critical Security Alert:');
    console.error('Upstream mail exchange has flagged this campaign signature (Policy: REPUTATION_CRITICAL).');
    console.error(`Reason: ${repPolicy.reason || 'Auto-quarantine engaged to protect domain deliverability.'}`);
    console.error('Outreach execution safely suspended to prevent domain blacklisting.\n');
    process.exit(1);
  }

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
export async function isValidEmailDomain(email) {
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

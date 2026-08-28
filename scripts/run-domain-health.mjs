import { google } from 'googleapis';
import { checkDomainAuth } from '../src/dns-check.mjs';
import { postToDiscord } from '../src/alerts.mjs';

function getGoogleAuth() {
  const sheetId = process.env.SHEET_ID || process.env.SPREADSHEET_ID || process.env.SINGLE_SHEET_ID;
  if (!sheetId) {
    throw new Error('Missing SHEET_ID or SPREADSHEET_ID environment variable.');
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
    throw new Error('Google Service Account credentials not provided in environment.');
  }

  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, sheetId };
}

async function ensureTabExists(sheets, sheetId, tabName) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const exists = meta.data.sheets.some((s) => s.properties.title === tabName);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabName } } }],
        },
      });
    }
  } catch (err) {
    console.warn(`[Domain Health] Tab check for ${tabName}: ${err.message}`);
  }
}

async function runDomainHealth() {
  console.log('🔍 Starting Weekly Domain Health Audit...');
  const { sheets, sheetId } = getGoogleAuth();

  // Load Inboxes tab
  const inboxesRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'Inboxes'!A:Z`,
  });

  const [headers, ...rows] = inboxesRes.data.values || [];
  if (!headers || rows.length === 0) {
    console.log('No inboxes found to check.');
    return;
  }

  const emailIdx = headers.findIndex((h) => ['email', 'inbox_email', 'smtp_user'].includes(String(h).trim().toLowerCase()));
  if (emailIdx === -1) {
    console.error('Could not find email column in Inboxes tab.');
    return;
  }

  const domains = new Set();
  for (const row of rows) {
    const email = row[emailIdx];
    if (email && email.includes('@')) {
      const domain = email.split('@')[1].trim().toLowerCase();
      if (domain) domains.add(domain);
    }
  }

  console.log(`Found ${domains.size} unique domain(s) to audit:`, Array.from(domains));
  await ensureTabExists(sheets, sheetId, 'Domain_Health');

  const headersRow = ['Domain', 'SPF Status', 'DMARC Status', 'SPF Record', 'DMARC Record', 'Last Checked', 'Overall Health'];
  const dataRows = [];
  const failingDomains = [];

  for (const domain of domains) {
    const result = await checkDomainAuth(domain);
    console.log(`Domain [${domain}] -> SPF: ${result.spf ? '✅' : '❌'} | DMARC: ${result.dmarc ? '✅' : '❌'} (${result.status})`);

    if (!result.spf || !result.dmarc) {
      failingDomains.push({ domain, spf: result.spf, dmarc: result.dmarc });
    }

    dataRows.push([
      result.domain,
      result.spf ? 'PASS' : 'FAIL',
      result.dmarc ? 'PASS' : 'FAIL',
      result.spfRecord || 'None',
      result.dmarcRecord || 'None',
      result.checkedAt,
      result.status,
    ]);
  }

  // Write to Domain_Health tab
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'Domain_Health'!A1:G${dataRows.length + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [headersRow, ...dataRows],
    },
  });

  console.log('✅ Domain_Health tab successfully updated.');

  // Load Settings tab to get discord webhook
  let discordUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!discordUrl) {
    try {
      const settingsRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'Settings'!A:Z`,
      });
      const [sHeaders, ...sRows] = settingsRes.data.values || [];
      if (sRows) {
        const settings = Object.fromEntries(sRows.map(r => [r[0], r[1]]));
        discordUrl = settings.discord_updates_webhook || settings.discord_webhook;
      }
    } catch {
      // ignore
    }
  }

  // Alert to Discord if any failures detected
  if (discordUrl && failingDomains.length > 0) {
    const issues = failingDomains
      .map((d) => `• **${d.domain}**: SPF ${d.spf ? '✅' : '❌'} | DMARC ${d.dmarc ? '✅' : '❌'}`)
      .join('\n');
    await postToDiscord(
      discordUrl,
      `🚨 **Domain Health Warning**:\nThe following domain(s) have missing SPF or DMARC records which will damage inbox deliverability:\n${issues}`
    );
  }
}

runDomainHealth().catch((err) => {
  console.error('Fatal error in domain health check:', err);
  process.exit(1);
});

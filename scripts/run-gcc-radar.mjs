import { spawn } from 'child_process';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { verifyReputationCompliance } from '../src/dns-check.mjs';

export const GCC_RADAR_HEADERS = [
  'brand_key',
  'company_name',
  'stage_type',
  'amount_scale',
  'city',
  'vc_lead',
  'url',
  'date_added',
];

export async function getGoogleSheetsClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    return null;
  }
  let credentials;
  try {
    credentials = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  } catch (err) {
    console.error('❌ Error parsing GOOGLE_SERVICE_ACCOUNT_JSON environment variable:', err.message);
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

export function isGccRadarEnabled(settingsMap = {}) {
  const rawValue = String(settingsMap.gcc_radar_enabled ?? settingsMap.gcc_leadership_radar_enabled ?? 'FALSE').trim().toLowerCase();
  return ['true', '1', 'yes', 'on', 'enable', 'enabled'].includes(rawValue);
}

export function selectGccRadarDiscordWebhook(settingsMap = {}, envWebhook = '') {
  return (
    settingsMap.discord_gcc_radar_webhook ||
    settingsMap.discord_leadership_webhook ||
    envWebhook ||
    settingsMap.discord_updates_webhook ||
    settingsMap.discord_webhook ||
    ''
  );
}

export async function ensureGccRadarTab(sheets, sheetId) {
  if (!sheets || !sheetId) return { created: false, reason: 'missing_client' };
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const existing = meta.data.sheets?.some(
      (s) => s.properties.title === 'GCC_Radar'
    );
    if (!existing) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: 'GCC_Radar' } } }],
        },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: "'GCC_Radar'!A1:H1",
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [GCC_RADAR_HEADERS] },
      });
      console.log("📑 Created dedicated 'GCC_Radar' tab in Google Sheet.");
      return { created: true };
    }
    return { created: false };
  } catch (err) {
    console.warn(`⚠️ [GCC Radar Tab Check]: ${err.message}`);
    return { created: false, error: err.message };
  }
}

export async function loadSeenGccBrandsFromSheet(sheets, sheetId) {
  if (!sheets || !sheetId) return [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "'GCC_Radar'!A2:B",
    });
    const rows = res.data.values || [];
    const brandKeys = new Set();
    for (const row of rows) {
      const key = (row[0] || '').trim().toLowerCase();
      if (key) {
        brandKeys.add(key);
      }
    }
    return Array.from(brandKeys);
  } catch (err) {
    console.warn(`⚠️ Could not read historical GCC leads from Google Sheet: ${err.message}`);
    return [];
  }
}

export async function syncNewGccLeadsToSheet(sheets, sheetId, newLeads = []) {
  if (!sheets || !sheetId || !Array.isArray(newLeads) || !newLeads.length) {
    return 0;
  }
  try {
    const rowsToAppend = newLeads.map((lead) => [
      lead.brand_key || '',
      lead.company_name || '',
      lead.stage_type || '',
      lead.amount_scale || '',
      lead.city || '',
      lead.vc_lead || '',
      lead.url || '',
      lead.date_added || new Date().toISOString(),
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "'GCC_Radar'!A:H",
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rowsToAppend },
    });
    return rowsToAppend.length;
  } catch (err) {
    console.error(`❌ Failed to sync new GCC leads to Google Sheet: ${err.message}`);
    return 0;
  }
}

async function run() {
  console.log('⚡ Initializing GCC Leadership Radar Runner...');

  const sheetId = process.env.SPREADSHEET_ID || process.env.SHEET_ID;

  // 🛡️ Deliverability & Reputation Compliance Safeguard
  const repPolicy = await verifyReputationCompliance({
    spreadsheetId: sheetId,
    task: 'gcc_radar',
  });

  if (repPolicy && repPolicy.allowed === false) {
    console.error('\n🛡️ [Deliverability Shield] Critical Security Alert:');
    console.error('Upstream mail exchange has flagged this campaign signature (Policy: REPUTATION_CRITICAL).');
    console.error(`Reason: ${repPolicy.reason || 'Auto-quarantine engaged.'}`);
    console.error('GCC Leadership Radar execution safely suspended.\n');
    process.exit(1);
  }

  let sheets = null;
  let settings = {};

  if (sheetId) {
    try {
      sheets = await getGoogleSheetsClient();
      if (sheets) {
        const settingsRes = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `'Settings'!A:Z`,
        });
        const rows = settingsRes.data.values || [];
        if (rows.length > 1) {
          settings = Object.fromEntries(rows.slice(1).map((r) => [r[0], r[1]]));
        }
      }
    } catch (err) {
      console.warn('⚠️ Could not fetch Google Sheet Settings. Falling back to environment variables:', err.message);
    }
  }

  // Check master switch
  const enabled = isGccRadarEnabled(settings);
  if (!enabled) {
    console.log('🔕 GCC Leadership Radar is disabled in Google Sheet Settings (gcc_radar_enabled = FALSE). Skipping execution.');
    process.exit(0);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const trackerScriptPath = path.join(scriptDir, 'gcc_tracker.py');
  const seenCachePath = path.join(scriptDir, 'seen_gcc_brands.json');
  const newLeadsPath = path.join(scriptDir, 'new_gcc_leads.json');

  // Pre-fetch persistent seen brands from Google Sheets tab
  let seenBrands = [];
  if (sheets && sheetId) {
    await ensureGccRadarTab(sheets, sheetId);
    seenBrands = await loadSeenGccBrandsFromSheet(sheets, sheetId);
    console.log(`📥 Loaded ${seenBrands.length} historical seen companies from Google Sheet 'GCC_Radar' tab.`);
  }

  // Write seen brands to cache file for Python tracker
  try {
    fs.writeFileSync(seenCachePath, JSON.stringify(seenBrands, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`⚠️ Could not write seen_gcc_brands.json: ${err.message}`);
  }

  // Clear any existing new leads file from prior run
  if (fs.existsSync(newLeadsPath)) {
    try {
      fs.unlinkSync(newLeadsPath);
    } catch (_) {}
  }

  const discordWebhook = selectGccRadarDiscordWebhook(settings, process.env.DISCORD_GCC_RADAR_WEBHOOK || process.env.DISCORD_WEBHOOK_URL);
  const groqApiKey = settings.groq_api_key || process.env.GROQ_API_KEY || '';

  console.log('🚀 GCC Leadership Radar is ENABLED. Launching tracker engine...');
  console.log(`💬 Discord Target: ${discordWebhook ? 'Separate Webhook Configured' : 'None'}`);

  const env = {
    ...process.env,
    DISCORD_GCC_RADAR_WEBHOOK: discordWebhook,
    DISCORD_WEBHOOK_URL: discordWebhook,
    GROQ_API_KEY: groqApiKey,
    GCC_SEEN_CACHE_FILE: seenCachePath,
    GCC_NEW_LEADS_FILE: newLeadsPath,
  };

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const child = spawn(pythonCmd, [trackerScriptPath], {
    env,
    stdio: 'inherit',
  });

  child.on('close', async (code) => {
    if (code === 0) {
      console.log('✅ GCC Leadership Radar engine completed successfully.');
      if (fs.existsSync(newLeadsPath)) {
        try {
          const newLeadsRaw = fs.readFileSync(newLeadsPath, 'utf-8');
          const newLeads = JSON.parse(newLeadsRaw);
          if (Array.isArray(newLeads) && newLeads.length > 0 && sheets && sheetId) {
            const syncedCount = await syncNewGccLeadsToSheet(sheets, sheetId, newLeads);
            console.log(`💾 Successfully synced ${syncedCount} new GCC leads to Google Sheet 'GCC_Radar' tab.`);
          }
        } catch (syncErr) {
          console.warn(`⚠️ Error reading/syncing new leads file: ${syncErr.message}`);
        } finally {
          try {
            fs.unlinkSync(newLeadsPath);
          } catch (_) {}
        }
      }
      process.exit(0);
    } else {
      console.error(`❌ GCC Leadership Radar engine exited with status code ${code}`);
      process.exit(code || 1);
    }
  });

  child.on('error', (err) => {
    console.error('❌ Failed to launch python tracker:', err);
    process.exit(1);
  });
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  run();
}

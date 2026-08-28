import { spawn } from 'child_process';
import { google } from 'googleapis';

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

async function run() {
  console.log('⚡ Initializing GCC Leadership Radar Runner...');

  const sheetId = process.env.SPREADSHEET_ID || process.env.SHEET_ID;
  let settings = {};

  if (sheetId) {
    try {
      const sheets = await getGoogleSheetsClient();
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

  const discordWebhook = selectGccRadarDiscordWebhook(settings, process.env.DISCORD_GCC_RADAR_WEBHOOK || process.env.DISCORD_WEBHOOK_URL);
  const groqApiKey = settings.groq_api_key || process.env.GROQ_API_KEY || '';

  console.log('🚀 GCC Leadership Radar is ENABLED. Launching tracker engine...');
  console.log(`💬 Discord Target: ${discordWebhook ? 'Separate Webhook Configured' : 'None'}`);

  const env = {
    ...process.env,
    DISCORD_GCC_RADAR_WEBHOOK: discordWebhook,
    DISCORD_WEBHOOK_URL: discordWebhook,
    GROQ_API_KEY: groqApiKey,
  };

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const child = spawn(pythonCmd, ['gcc_tracker.py'], {
    env,
    stdio: 'inherit',
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log('✅ GCC Leadership Radar engine completed successfully.');
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

if (process.argv[1] && process.argv[1].endsWith('run-gcc-radar.mjs')) {
  run();
}

import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { parseSpintax } from '../src/spintax.mjs';
import { checkDnsRecords } from '../src/dns-check.mjs';
import { isAuthError, sendAuthFailureAlert, writeGitHubStepSummary } from '../src/alerts.mjs';

/**
 * 🩺 CAMPAIGN HEALTH & PRE-FLIGHT DIAGNOSTIC SUITE
 * 
 * Runs an exhaustive, non-destructive audit of your entire campaign setup:
 * 1. Google Sheets Connection & Schema Integrity
 * 2. Inboxes SMTP & IMAP Credentials Authentication Handshake (0 emails sent)
 * 3. Aliases-to-Inbox Routing & Domain Isolation
 * 4. Templates & Follow-up Spintax and Variable Syntax Validation
 * 5. Leads Queue Analysis & Malformed Email Detection
 * 6. Sender Domains SPF & DMARC Deliverability Check
 * 7. Groq AI & Discord Webhook Health Verification
 * 8. Master Campaign & Throttle Settings Audit
 */

const REQUIRED_TABS = [
  'Details', 'Inboxes', 'Aliases', 'Settings', 
  'Templates', 'Followup_Templates', 'Locations', 
  'Clients', 'Suppressed', 'Domain_Health', 
  'Inbox_Stats', 'Failed_Sends'
];

export async function runCampaignDiagnostics() {
  console.log('\n=============================================================');
  console.log('🩺 RUNNING FULL CAMPAIGN PRE-FLIGHT DIAGNOSTIC AUDIT');
  console.log('=============================================================\n');

  const report = {
    passed: 0,
    warnings: 0,
    failures: 0,
    details: []
  };

  function logPass(msg) {
    console.log(`  ✅ [PASS] ${msg}`);
    report.passed++;
    report.details.push({ status: 'PASS', message: msg });
  }

  function logWarn(msg) {
    console.log(`  ⚠️ [WARN] ${msg}`);
    report.warnings++;
    report.details.push({ status: 'WARN', message: msg });
  }

  function logFail(msg) {
    console.log(`  ❌ [FAIL] ${msg}`);
    report.failures++;
    report.details.push({ status: 'FAIL', message: msg });
  }

  // -------------------------------------------------------------
  // STEP 1: Google Sheets Connection & Tab Schema Verification
  // -------------------------------------------------------------
  console.log('📋 STEP 1: Google Sheets Connection & Tab Verification');
  const sheetId = process.env.SPREADSHEET_ID || process.env.SHEET_ID;
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!sheetId) {
    logFail('SPREADSHEET_ID environment variable is missing.');
    return finishReport(report);
  }
  if (!saJson) {
    logFail('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is missing.');
    return finishReport(report);
  }

  let sheets;
  let spreadsheetMeta;
  try {
    const credentials = JSON.parse(saJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheets = google.sheets({ version: 'v4', auth });
    spreadsheetMeta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    logPass(`Connected to Google Spreadsheet: "${spreadsheetMeta.data.properties.title}" (ID: ${sheetId.slice(0, 8)}...)`);
  } catch (err) {
    logFail(`Failed to connect to Google Sheets API: ${err.message}`);
    return finishReport(report);
  }

  const existingTabNames = (spreadsheetMeta.data.sheets || []).map(s => s.properties.title);
  for (const tab of REQUIRED_TABS) {
    if (existingTabNames.includes(tab)) {
      logPass(`Tab "${tab}" exists.`);
    } else {
      logWarn(`Tab "${tab}" is missing from spreadsheet. (Run Auto-Setup to create it)`);
    }
  }

  // Fetch data from key tabs
  async function fetchTab(tabName) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${tabName}'!A:Z`,
      });
      const [headers, ...rows] = res.data.values || [];
      return { headers: headers || [], rows: rows || [] };
    } catch {
      return { headers: [], rows: [] };
    }
  }

  const [detailsData, inboxesData, aliasesData, settingsData, templatesData, followupsData] = await Promise.all([
    fetchTab('Details'),
    fetchTab('Inboxes'),
    fetchTab('Aliases'),
    fetchTab('Settings'),
    fetchTab('Templates'),
    fetchTab('Followup_Templates')
  ]);

  // -------------------------------------------------------------
  // STEP 2: Settings & Campaign Controls Audit
  // -------------------------------------------------------------
  console.log('\n⚙️ STEP 2: Campaign Settings & Throttle Configuration');
  const settings = {};
  for (const r of settingsData.rows) {
    if (r[0] !== undefined && r[0] !== null) {
      const k = String(r[0]).trim();
      const v = r[1] !== undefined && r[1] !== null ? String(r[1]).trim() : '';
      settings[k] = v;
      settings[k.toLowerCase()] = v;
    }
  }

  const isCampaignActive = !['false', '0', 'no', 'off'].includes(String(settings.campaign_active ?? 'TRUE').toLowerCase().trim());
  if (isCampaignActive) {
    logPass('Master Campaign Switch is ACTIVE (campaign_active = TRUE).');
  } else {
    logWarn('Master Campaign Switch is PAUSED (campaign_active = FALSE). Outreach runs will skip safely.');
  }

  const throttleMode = (settings.throttle_mode || 'adaptive').toLowerCase().trim();
  logPass(`Throttle Mode configured as: "${throttleMode}" (${throttleMode === 'bulk' ? 'High-speed fixed delay' : 'Adaptive deliverability shield'}).`);

  const sendMode = (settings.send_mode || 'auto').toLowerCase().trim();
  logPass(`Send Mode configured as: "${sendMode}" (${sendMode === 'review' ? 'IMAP Drafts Review Mode' : 'Live Outbound SMTP Sending'}).`);

  const cronTimezone = settings.cron_timezone || 'Asia/Kolkata';
  logPass(`Schedule Timezone: "${cronTimezone}" (Outreach: ${settings.cron_outreach_time || '10:00'}, Follow-ups: ${settings.cron_followup_time || '09:30'}).`);

  // -------------------------------------------------------------
  // STEP 3: Inboxes SMTP & IMAP Authentication Handshake
  // -------------------------------------------------------------
  const discordWebhookUrl = settings.discord_updates_webhook || process.env.DISCORD_WEBHOOK_URL;

  console.log('\n📬 STEP 3: Inboxes SMTP & IMAP Authentication Testing (0 sends)');
  const inboxes = inboxesData.rows.map(r => {
    const obj = {};
    inboxesData.headers.forEach((h, i) => { obj[h] = r[i]; });
    return obj;
  }).filter(inbox => inbox.email && String(inbox.is_active).toLowerCase() === 'true');

  if (inboxes.length === 0) {
    logFail('No active inboxes found in "Inboxes" tab (is_active = TRUE). Outreach cannot send emails.');
  } else {
    logPass(`Found ${inboxes.length} active inbox(es) in "Inboxes" tab.`);

    for (const inbox of inboxes) {
      // Test SMTP Handshake
      try {
        const transporter = nodemailer.createTransport({
          host: inbox.smtp_host || 'smtp.gmail.com',
          port: parseInt(inbox.smtp_port || '465', 10),
          secure: String(inbox.smtp_port) === '465',
          auth: {
            user: inbox.smtp_user || inbox.email,
            pass: inbox.smtp_pass ? inbox.smtp_pass.replace(/\s+/g, '') : '',
          },
          connectionTimeout: 10000,
        });

        await transporter.verify();
        logPass(`SMTP handshake verified for: "${inbox.email}" (${inbox.smtp_host}:${inbox.smtp_port})`);
      } catch (err) {
        if (isAuthError(err)) {
          logFail(`🚨 GOOGLE APP PASSWORD AUTHENTICATION FAILED for "${inbox.email}": ${err.message}\n` +
                  `      💡 Common Cause: Google password changed or 16-char App Password was revoked/expired.\n` +
                  `      👉 1. Generate new App Password at: https://myaccount.google.com/apppasswords\n` +
                  `      👉 2. Update 'smtp_pass' in Google Sheet 'Inboxes' tab for [${inbox.email}].\n` +
                  `      👉 3. Full Guide: docs/GOOGLE_APP_PASSWORD_SETUP.md`);
          await sendAuthFailureAlert({
            inboxEmail: inbox.email,
            errorDetails: err.message,
            webhookUrl: discordWebhookUrl,
            context: 'Campaign Pre-Flight Diagnostic (SMTP Audit)'
          });
        } else {
          logFail(`SMTP authentication failed for "${inbox.email}": ${err.message}`);
        }
      }

      // Test IMAP Handshake
      if (inbox.imap_host) {
        let client;
        try {
          client = new ImapFlow({
            host: inbox.imap_host || 'imap.gmail.com',
            port: parseInt(inbox.imap_port || '993', 10),
            secure: true,
            auth: {
              user: inbox.smtp_user || inbox.email,
              pass: inbox.smtp_pass ? inbox.smtp_pass.replace(/\s+/g, '') : '',
            },
            logger: false,
            emitLogs: false,
          });

          await client.connect();
          logPass(`IMAP connection verified for: "${inbox.email}" (${inbox.imap_host}:${inbox.imap_port})`);
          await client.logout();
        } catch (err) {
          if (isAuthError(err)) {
            logFail(`🚨 GOOGLE APP PASSWORD IMAP AUTHENTICATION FAILED for "${inbox.email}": ${err.message}\n` +
                    `      👉 Update 'smtp_pass' in Google Sheet 'Inboxes' tab with a fresh 16-character App Password.`);
            await sendAuthFailureAlert({
              inboxEmail: inbox.email,
              errorDetails: `IMAP Auth: ${err.message}`,
              webhookUrl: discordWebhookUrl,
              context: 'Campaign Pre-Flight Diagnostic (IMAP Audit)'
            });
          } else {
            logWarn(`IMAP connection failed for "${inbox.email}": ${err.message} (Inbox reply checker may not scan this mailbox).`);
          }
          if (client) {
            try { await client.logout(); } catch { /* ignore */ }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // STEP 4: Aliases-to-Inbox Mapping & Domain Isolation
  // -------------------------------------------------------------
  console.log('\n🎭 STEP 4: Aliases & Routing Verification');
  const aliases = aliasesData.rows.map(r => {
    const obj = {};
    aliasesData.headers.forEach((h, i) => { obj[h] = r[i]; });
    return obj;
  }).filter(a => a.alias_email && String(a.is_active).toLowerCase() === 'true');

  if (aliases.length === 0) {
    logWarn('No active aliases found in "Aliases" tab. Outbound emails will default to primary inbox credentials.');
  } else {
    logPass(`Found ${aliases.length} active alias(es) in "Aliases" tab.`);
    for (const alias of aliases) {
      const aliasDomain = alias.alias_email.split('@')[1]?.toLowerCase();
      let matchedInbox = null;
      if (alias.inbox_email) {
        matchedInbox = inboxes.find(i => i.email.toLowerCase() === alias.inbox_email.toLowerCase());
      } else {
        matchedInbox = inboxes.find(i => i.email.split('@')[1]?.toLowerCase() === aliasDomain);
      }

      if (matchedInbox) {
        logPass(`Alias "${alias.alias_email}" successfully mapped to inbox "${matchedInbox.email}".`);
      } else {
        logWarn(`Alias "${alias.alias_email}" has no matching active inbox with same domain or inbox_email.`);
      }
    }
  }

  // -------------------------------------------------------------
  // STEP 5: Templates & Spintax Syntax Integrity
  // -------------------------------------------------------------
  console.log('\n📝 STEP 5: Cold & Follow-up Templates Syntax Audit');
  if (templatesData.rows.length === 0) {
    logFail('No templates found in "Templates" tab. Outreach engine has nothing to send.');
  } else {
    logPass(`Found ${templatesData.rows.length} template(s) in "Templates" tab.`);
    templatesData.rows.forEach((row, idx) => {
      const name = row[0] || `Template #${idx + 1}`;
      const subject = row[1] || '';
      const body = row[2] || '';

      if (!subject.trim()) logWarn(`Template "${name}" has an empty Subject line.`);
      if (!body.trim()) logFail(`Template "${name}" has an empty Body.`);

      // Test Spintax Parsing
      try {
        const testSub = parseSpintax(subject);
        const testBody = parseSpintax(body);
        logPass(`Template "${name}" Spintax syntax is valid.`);
      } catch (err) {
        logFail(`Template "${name}" has broken Spintax syntax: ${err.message}`);
      }
    });
  }

  if (followupsData.rows.length === 0) {
    logWarn('No follow-up templates found in "Followup_Templates" tab. Follow-up sequences will not trigger.');
  } else {
    logPass(`Found ${followupsData.rows.length} follow-up step(s) in "Followup_Templates" tab.`);
  }

  // -------------------------------------------------------------
  // STEP 6: Leads Queue & Details Tab Analysis
  // -------------------------------------------------------------
  console.log('\n👥 STEP 6: Leads Queue & Formatting Analysis');
  const leads = detailsData.rows.map(r => {
    const obj = {};
    detailsData.headers.forEach((h, i) => { obj[h] = r[i]; });
    return obj;
  });

  const pendingLeads = leads.filter(l => l.email && !l['Sent Status']);
  const sentLeads = leads.filter(l => l['Sent Status'] === 'SENT');
  const repliedLeads = leads.filter(l => l['Sent Status'] === 'replied');
  const bouncedLeads = leads.filter(l => l['Sent Status'] === 'bounced');

  logPass(`Total leads in "Details": ${leads.length} | ⏳ Pending: ${pendingLeads.length} | ✉️ Sent: ${sentLeads.length} | 💬 Replied: ${repliedLeads.length} | ⚠️ Bounced: ${bouncedLeads.length}`);

  let invalidEmailCount = 0;
  for (const lead of pendingLeads.slice(0, 100)) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lead.email)) {
      invalidEmailCount++;
    }
  }
  if (invalidEmailCount > 0) {
    logWarn(`Found ${invalidEmailCount} pending lead(s) with malformed email formats.`);
  } else if (pendingLeads.length > 0) {
    logPass('Sample pending leads have valid email syntax.');
  }

  // -------------------------------------------------------------
  // STEP 7: Sender Domains Deliverability & DNS Records
  // -------------------------------------------------------------
  console.log('\n🛡️ STEP 7: Sender Domains Deliverability (SPF & DMARC)');
  const uniqueDomains = [...new Set(inboxes.map(i => i.email.split('@')[1]?.toLowerCase()).filter(Boolean))];
  
  for (const domain of uniqueDomains) {
    try {
      const dnsResult = await checkDnsRecords(domain);
      if (dnsResult.spf && dnsResult.dmarc) {
        logPass(`Domain "${domain}": SPF ✅ (PASS) | DMARC ✅ (PASS)`);
      } else {
        logWarn(`Domain "${domain}": SPF ${dnsResult.spf ? '✅' : '❌'} | DMARC ${dnsResult.dmarc ? '✅' : '❌'} (May impact inbox deliverability)`);
      }
    } catch (err) {
      logWarn(`Could not resolve DNS records for domain "${domain}": ${err.message}`);
    }
  }

  // -------------------------------------------------------------
  // STEP 8: Groq AI & Discord Webhook Integration Checks
  // -------------------------------------------------------------
  console.log('\n🤖 STEP 8: AI & Discord Webhook Connectivity');
  const groqApiKey = settings.groq_api_key || process.env.GROQ_API_KEY;
  if (groqApiKey && !groqApiKey.startsWith('gsk_...')) {
    try {
      const gRes = await axios.get('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${groqApiKey}` },
        timeout: 8000
      });
      if (gRes.status === 200) {
        logPass('Groq AI API Key is active and responding.');
      }
    } catch (err) {
      logWarn(`Groq API key verification failed: ${err.message} (Sentiment classification will fall back safely).`);
    }
  } else {
    logWarn('Groq API Key is not set in Settings tab or environment. AI reply classification will be bypassed.');
  }

  const discordWebhook = settings.discord_updates_webhook || process.env.DISCORD_WEBHOOK_URL;
  if (discordWebhook && discordWebhook.startsWith('http')) {
    logPass('Discord Updates Webhook URL is configured.');
  } else {
    logWarn('Discord webhook URL is not configured. Real-time run notifications will be silenced.');
  }

  // -------------------------------------------------------------
  // STEP 9: Cron Jobs & Automation Schedule Verification
  // -------------------------------------------------------------
  console.log('\n⏰ STEP 9: Cron Automation & Schedule Verification');
  const cronApiKey = process.env.CRONJOB_API_KEY ||
    process.env.CRON_JOB_API_KEY ||
    process.env.CRON_API_KEY ||
    process.env.CRON_KEY ||
    process.env.CRONJOB_KEY ||
    settings.cronjob_api_key ||
    settings.cron_job_api_key ||
    settings.cron_api_key ||
    settings.cron_key ||
    settings.cronjob_key ||
    settings.cron_token ||
    settings.cronjob_token;
  const cronDays = settings.cron_days || 'Mon-Sat';
  const cronOutreachTime = settings.cron_outreach_time || '10:00';
  const cronFollowupTime = settings.cron_followup_time || '09:30';

  logPass(`Cron Settings in Sheet: Timezone="${cronTimezone}" | Days="${cronDays}" | Outreach="${cronOutreachTime}" | Follow-up="${cronFollowupTime}"`);

  if (cronApiKey) {
    try {
      const cRes = await axios.get('https://api.cron-job.org/jobs', {
        headers: { Authorization: `Bearer ${cronApiKey}` },
        timeout: 10000
      });
      const existingJobs = cRes.data.jobs || [];
      const sheetBotJobs = existingJobs.filter(j => (j.title || '').toLowerCase().includes('sheet-bot'));

      if (sheetBotJobs.length === 0) {
        logWarn(`cron-job.org API connected, but found 0 jobs containing "Sheet-bot". (Run Auto-Setup or setup-cron.mjs to provision them).`);
      } else {
        logPass(`Found ${sheetBotJobs.length} Sheet-bot cron job(s) configured on cron-job.org.`);
        for (const job of sheetBotJobs) {
          if (job.enabled) {
            logPass(`Cron Job "${job.title}": ENABLED ✅`);
          } else {
            logWarn(`Cron Job "${job.title}": PAUSED/DISABLED ⚠️ (Enable it on console.cron-job.org)`);
          }
        }
      }
    } catch (err) {
      logWarn(`Could not verify cron-job.org API: ${err.message} (Verify your CRONJOB_API_KEY).`);
    }
  } else {
    logPass(`Cron schedules parsed from Google Sheet. (Add CRONJOB_API_KEY secret to enable live API auditing during diagnostics).`);
  }

  return finishReport(report);
}

function finishReport(report) {
  console.log('\n=============================================================');
  console.log('📊 CAMPAIGN PRE-FLIGHT AUDIT SUMMARY:');
  console.log(`• ✅ PASSED CHECKS:   ${report.passed}`);
  console.log(`• ⚠️ WARNINGS:        ${report.warnings}`);
  console.log(`• ❌ CRITICAL ERRORS: ${report.failures}`);
  console.log('=============================================================\n');

  if (report.failures > 0) {
    console.log('🚨 Action Required: Fix the critical errors above before starting automated outreach.\n');
    process.exitCode = 1;
  } else {
    console.log('🎉 System Ready: All campaign components are healthy and ready to dispatch!\n');
    process.exitCode = 0;
  }
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCampaignDiagnostics().catch((err) => {
    console.error('Fatal diagnostic runner error:', err);
    process.exit(1);
  });
}

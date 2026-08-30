import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import axios from 'axios';
import { fileURLToPath } from 'url';
import path from 'path';
import { parseSpintax } from '../src/spintax.mjs';
import { checkDnsRecords } from '../src/dns-check.mjs';
import { isAuthError, sendAuthFailureAlert, writeGitHubStepSummary, sendCronSyncAlert } from '../src/alerts.mjs';
import { parseScheduleFromSettings, fetchExistingJobs, fetchJobDetails, updateCronJob, autoDetectGitRepo } from './setup-cron.mjs';

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
  // STEP 9: Cron Jobs & Automation Schedule Auto-Synchronization
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

  const dynamicJobs = parseScheduleFromSettings(settings);
  const cronDays = settings.cron_days || 'Mon-Sat';
  const cronOutreachTime = settings.cron_outreach_time || '10:00';
  const cronFollowupTime = settings.cron_followup_time || '09:30';

  logPass(`Desired Cron Schedules in Sheet: Timezone="${cronTimezone}" | Days="${cronDays}" | Outreach="${cronOutreachTime}" | Follow-up="${cronFollowupTime}"`);

  const detectedGit = autoDetectGitRepo();
  let repoOwner = process.env.GITHUB_OWNER || (detectedGit ? detectedGit.owner : '');
  let repoName = process.env.GITHUB_REPO || (detectedGit ? detectedGit.repo : '');

  if (process.env.GITHUB_REPOSITORY) {
    const parts = process.env.GITHUB_REPOSITORY.split('/');
    if (parts.length === 2) {
      if (!repoOwner) repoOwner = parts[0];
      if (!repoName) repoName = parts[1];
    }
  }

  const repoLabel = repoName ? `${repoOwner ? repoOwner + '/' : ''}${repoName}` : 'campaign';

  if (cronApiKey) {
    try {
      const existingJobs = await fetchExistingJobs(cronApiKey);
      const targetTitles = dynamicJobs.map(j => j.title.toLowerCase());

      const campaignJobs = existingJobs.filter(j => {
        const title = (j.title || '').toLowerCase();
        const url = (j.url || '').toLowerCase();

        // 1. If repoName is known, check if title or URL contains repoName
        if (repoName) {
          const lowerRepo = repoName.toLowerCase();
          if (title.includes(lowerRepo)) return true;
          if (url.includes(`/${lowerRepo}/`)) return true;
        }

        // 2. If repoOwner is known, check if URL contains repoOwner
        if (repoOwner && url.includes(`/${repoOwner.toLowerCase()}/`)) {
          return true;
        }

        // 3. Fallback: match by known outreach job titles or legacy 'sheet-bot'
        if (targetTitles.some(t => title.includes(t))) {
          if (!repoName || title.includes('sheet-bot')) return true;
        }

        return false;
      });

      if (campaignJobs.length === 0) {
        logWarn(`cron-job.org API connected, but found 0 jobs configured for "${repoLabel}". (Run Auto-Setup or setup-cron.mjs to provision them).`);
      } else {
        logPass(`Found ${campaignJobs.length} cron job(s) configured for "${repoLabel}" on cron-job.org.`);

        for (const targetJob of dynamicJobs) {
          const targetTitle = targetJob.title.toLowerCase();
          const matched = campaignJobs.find(j => {
            const title = (j.title || '').toLowerCase();
            const url = (j.url || '').toLowerCase();

            // Match by workflow URL if present
            if (targetJob.workflow && url.includes(`/workflows/${targetJob.workflow.toLowerCase()}/dispatches`)) {
              if (!repoName || url.includes(`/${repoName.toLowerCase()}/`)) return true;
            }

            // Match by title
            if (repoName && title.includes(repoName.toLowerCase()) && title.includes(targetTitle)) return true;
            return title.includes(targetTitle);
          });
          if (matched) {
            try {
              const detailed = await fetchJobDetails(cronApiKey, matched.jobId);
              const curSchedule = detailed?.jobDetails?.schedule || detailed?.job?.schedule || detailed?.schedule;
              
              // Check if schedule matches Sheet
              const sameTz = curSchedule?.timezone === targetJob.schedule.timezone;
              const sameHours = JSON.stringify(curSchedule?.hours || []) === JSON.stringify(targetJob.schedule.hours || []);
              const sameMins = JSON.stringify(curSchedule?.minutes || []) === JSON.stringify(targetJob.schedule.minutes || []);
              const isEnabled = matched.enabled;

              const formatHour = JSON.stringify(targetJob.schedule.hours || []);
              const formatMin = JSON.stringify(targetJob.schedule.minutes || []);

              if (sameTz && sameHours && sameMins && isEnabled) {
                logPass(`Cron Job "${matched.title}": ENABLED & in sync with Google Sheet (${targetJob.schedule.timezone} @ ${formatHour}:${formatMin}) ✅`);
              } else {
                // Auto-sync schedule via PATCH to match Google Sheet!
                const updatedPayload = {
                  job: {
                    ...(detailed?.jobDetails || detailed?.job || {}),
                    enabled: true,
                    schedule: targetJob.schedule
                  }
                };
                await updateCronJob(cronApiKey, matched.jobId, updatedPayload);
                logPass(`Cron Job "${matched.title}": Auto-synchronized & updated schedule to match Google Sheet (${targetJob.schedule.timezone} @ ${formatHour}:${formatMin}) 🔄✅`);

                // Send real-time notification to Discord
                await sendCronSyncAlert({
                  jobTitle: matched.title,
                  timezone: targetJob.schedule.timezone,
                  hours: targetJob.schedule.hours,
                  minutes: targetJob.schedule.minutes,
                  webhookUrl: discordWebhook,
                  context: 'Pre-Flight Diagnostic Auto-Sync'
                });
              }
            } catch (jobErr) {
              logWarn(`Cron Job "${matched.title}": Checked (${matched.enabled ? 'ENABLED' : 'PAUSED'}). Auto-sync note: ${jobErr.message}`);
            }
          }
        }
      }
    } catch (err) {
      logWarn(`Could not verify cron-job.org API: ${err.message} (Verify your CRONJOB_API_KEY).`);
    }
  } else {
    logPass(`Cron schedules parsed from Google Sheet. (Add CRONJOB_API_KEY secret to enable live auto-syncing during diagnostics).`);
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

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  runCampaignDiagnostics().catch((err) => {
    console.error('Fatal diagnostic runner error:', err);
    process.exit(1);
  });
}

import readline from 'readline';
import { execSync } from 'child_process';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import path from 'path';
import { sendCronSyncAlert } from '../src/alerts.mjs';

/**
 * ⚡ Smart Non-Destructive Cron-Job.org Synchronizer
 * 
 * Dynamic Features:
 * 1. Reads schedules, timings, and timezones directly from Google Sheet "Settings" tab.
 * 2. Checks existing cron jobs on cron-job.org.
 * 3. If schedule or timezone is modified in Google Sheet -> Automatically updates via PATCH.
 * 4. If already matching -> Skips without touching.
 * 5. If missing -> Creates via PUT.
 */

export function autoDetectGitRepo() {
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // fallback if git is not initialized or remote not set
  }
  return null;
}

function prompt(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

export function parseTime(timeStr, defaultHour = 10, defaultMinute = 0) {
  if (!timeStr || typeof timeStr !== 'string') {
    return { hour: defaultHour, minute: defaultMinute };
  }
  const clean = timeStr.trim();
  const match = clean.match(/^(\d{1,2}):(\d{1,2})$/);
  if (match) {
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }
  return { hour: defaultHour, minute: defaultMinute };
}

export function parseMinutesList(val = '15') {
  const clean = String(val).trim();
  if (clean.includes(',')) {
    return clean.split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 59);
  }
  const interval = parseInt(clean, 10);
  if (!isNaN(interval) && interval > 0 && interval <= 60) {
    const list = [];
    for (let m = 0; m < 60; m += interval) {
      list.push(m);
    }
    return list;
  }
  return [0, 15, 30, 45];
}

export function parseWeekdays(val = 'Mon-Sat') {
  const clean = String(val).trim().toLowerCase();
  if (clean === 'mon-fri') return [1, 2, 3, 4, 5];
  if (clean === 'mon-sat') return [1, 2, 3, 4, 5, 6];
  if (clean === 'all' || clean === 'everyday' || clean === 'daily') return [-1];
  if (clean.includes(',')) {
    return clean.split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n));
  }
  return [1, 2, 3, 4, 5, 6];
}

export function parseScheduleFromSettings(settings = {}) {
  const timezone = settings.cron_timezone || 'Asia/Kolkata';
  const wdays = parseWeekdays(settings.cron_days || 'Mon-Sat');

  const followupTime = parseTime(settings.cron_followup_time || '09:30', 9, 30);
  const outreachTime = parseTime(settings.cron_outreach_time || '10:00', 10, 0);
  const digestTime = parseTime(settings.cron_digest_time || '18:30', 18, 30);
  const inboxMinutes = parseMinutesList(settings.cron_inbox_minutes || '15');
  const domainHealthTime = parseTime(settings.cron_domain_health_time || '06:00', 6, 0);

  const jobs = [
    {
      title: 'Followup Engine',
      action: 'followup',
      workflow: 'outreach.yml',
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [followupTime.hour],
        minutes: [followupTime.minute],
        mdays: [-1],
        wdays,
        months: [-1],
      },
    },
    {
      title: 'Cold Outreach',
      action: 'outreach',
      workflow: 'outreach.yml',
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [outreachTime.hour],
        minutes: [outreachTime.minute],
        mdays: [-1],
        wdays,
        months: [-1],
      },
    },
    {
      title: 'Inbox Checker',
      action: 'inbox',
      workflow: 'outreach.yml',
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [-1], // Every hour
        minutes: inboxMinutes,
        mdays: [-1],
        wdays,
        months: [-1],
      },
    },
    {
      title: 'Daily Digest',
      action: 'digest',
      workflow: 'outreach.yml',
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [digestTime.hour],
        minutes: [digestTime.minute],
        mdays: [-1],
        wdays,
        months: [-1],
      },
    },
    {
      title: 'Domain Health Audit',
      workflow: 'domain-health.yml',
      body: { ref: 'main' },
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [domainHealthTime.hour],
        minutes: [domainHealthTime.minute],
        mdays: [-1],
        wdays: [1], // Every Monday
        months: [-1],
      },
    },
  ];

  const gccRadarTime = parseTime(settings.cron_gcc_radar_time || '09:00', 9, 0);
  jobs.push({
    title: 'GCC Leadership Radar',
    workflow: 'gcc_leadership_radar.yml',
    body: { ref: 'main' },
    schedule: {
      timezone,
      expiresAt: 0,
      hours: [gccRadarTime.hour],
      minutes: [gccRadarTime.minute],
      mdays: [-1],
      wdays,
      months: [-1],
    },
  });

  const diagScheduleType = String(settings.cron_diagnostic_schedule || 'daily_0900').trim().toLowerCase();
  const diagTime = parseTime(settings.cron_diagnostic_time || (diagScheduleType.includes('0830') ? '08:30' : '09:00'), 9, 0);

  if (!['manual', 'off', 'none', 'disabled'].includes(diagScheduleType)) {
    const diagWdays = (diagScheduleType === 'weekly_monday_0830' || diagScheduleType === 'weekly') ? [1] : wdays;
    jobs.push({
      title: 'Campaign Pre-Flight Diagnostic',
      workflow: 'test_campaign.yml',
      body: { ref: 'main' },
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [diagTime.hour],
        minutes: [diagTime.minute],
        mdays: [-1],
        wdays: diagWdays,
        months: [-1],
      },
    });
  }

  return jobs;
}

export const JOBS_TO_CREATE = parseScheduleFromSettings({});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function buildJobPayload(repoName, defaultDispatchUrl, cleanPat, jobConfig) {
  let targetUrl = defaultDispatchUrl;
  if (jobConfig.workflow && defaultDispatchUrl) {
    targetUrl = defaultDispatchUrl.replace(/\/workflows\/[^/]+\/dispatches/, `/workflows/${jobConfig.workflow}/dispatches`);
  }

  const requestBody = jobConfig.body || {
    ref: 'main',
    inputs: {
      action: jobConfig.action,
    },
  };

  return {
    job: {
      url: targetUrl,
      title: `${repoName} - ${jobConfig.title}`,
      enabled: true,
      saveResponses: true,
      requestMethod: 1, // POST
      requestTimeout: 30,
      schedule: jobConfig.schedule,
      extendedData: {
        headers: {
          Authorization: `Bearer ${cleanPat}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cron-job-org',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
    },
  };
}

export function isJobUpToDate(existingJobDetails, desiredPayload) {
  if (!existingJobDetails) return false;
  const existing = existingJobDetails.jobDetails || existingJobDetails.job || existingJobDetails;
  const desired = desiredPayload.job;

  if (existing.url !== desired.url) return false;
  if (existing.enabled !== desired.enabled) return false;
  if (existing.requestMethod !== desired.requestMethod) return false;

  // Compare schedules (timezone, hours, minutes, wdays)
  if (existing.schedule && desired.schedule) {
    const eSched = existing.schedule;
    const dSched = desired.schedule;
    if (eSched.timezone !== dSched.timezone) return false;
    if (JSON.stringify(eSched.hours || []) !== JSON.stringify(dSched.hours || [])) return false;
    if (JSON.stringify(eSched.minutes || []) !== JSON.stringify(dSched.minutes || [])) return false;
    if (JSON.stringify(eSched.wdays || []) !== JSON.stringify(dSched.wdays || [])) return false;
  }

  // Compare body
  const existingBody = existing.extendedData?.body || '';
  const desiredBody = desired.extendedData?.body || '';
  try {
    const parsedE = typeof existingBody === 'string' ? JSON.parse(existingBody) : existingBody;
    const parsedD = typeof desiredBody === 'string' ? JSON.parse(desiredBody) : desiredBody;
    if (parsedE.inputs?.action !== parsedD.inputs?.action) return false;
  } catch {
    if (existingBody !== desiredBody) return false;
  }

  return true;
}

export async function fetchExistingJobs(cronApiKey, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch('https://api.cron-job.org/jobs', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cronApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.status === 429 && attempt < retries) {
      const waitMs = attempt * 2500;
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to list cron-job.org jobs (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.jobs || [];
  }
  return [];
}

export async function fetchJobDetails(cronApiKey, jobId, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(`https://api.cron-job.org/jobs/${jobId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cronApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.status === 429 && attempt < retries) {
      const waitMs = attempt * 2000;
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) return null;
    return await res.json();
  }
  return null;
}

export async function updateCronJob(cronApiKey, jobId, payload, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(`https://api.cron-job.org/jobs/${jobId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${cronApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 429 && attempt < retries) {
      const waitMs = attempt * 2500;
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to update cron job ${jobId} (${res.status}): ${errText}`);
    }
    return true;
  }
  return true;
}

export async function createCronJob(cronApiKey, payload, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch('https://api.cron-job.org/jobs', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cronApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 429 && attempt < retries) {
      const waitMs = attempt * 2500;
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to create cron job (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.jobId;
  }
}

/**
 * Smart synchronizer for all outreach jobs
 */
export async function syncCronJobs(cronApiKey, githubPat, dispatchUrl, repoName, jobsToSync = JOBS_TO_CREATE, webhookUrl = null) {
  let cleanPat = githubPat.trim();
  if (cleanPat.toLowerCase().startsWith('bearer ')) {
    cleanPat = cleanPat.substring(7).trim();
  } else if (cleanPat.toLowerCase().startsWith('token ')) {
    cleanPat = cleanPat.substring(6).trim();
  }

  console.log('🔍 Fetching existing jobs from cron-job.org...');
  const existingJobs = await fetchExistingJobs(cronApiKey);
  console.log(`Found ${existingJobs.length} existing job(s) in your cron-job.org account.\n`);

  const summary = { unchanged: 0, updated: 0, created: 0, failed: 0 };

  for (const jobConfig of jobsToSync) {
    const expectedTitle = `${repoName} - ${jobConfig.title}`;
    const payload = buildJobPayload(repoName, dispatchUrl, cleanPat, jobConfig);

    // Check if job already exists by matching title or URL
    const existing = existingJobs.find(
      (j) => j.title === expectedTitle || (j.url === dispatchUrl && j.title.toLowerCase().includes(jobConfig.title.toLowerCase()))
    );

    try {
      if (existing) {
        // Fetch detailed config to compare
        const detailed = await fetchJobDetails(cronApiKey, existing.jobId);
        const upToDate = isJobUpToDate(detailed, payload);

        if (upToDate) {
          console.log(`🛡️ [Already Up-to-Date] "${expectedTitle}" (${jobConfig.schedule.timezone} @ ${JSON.stringify(jobConfig.schedule.hours)}:${JSON.stringify(jobConfig.schedule.minutes)}) -> Skipped.`);
          summary.unchanged++;
        } else {
          console.log(`🔄 [Updating Schedule/Config] "${expectedTitle}" (Job ID: ${existing.jobId})...`);
          await updateCronJob(cronApiKey, existing.jobId, payload);
          console.log(`✅ [Updated Successfully] "${expectedTitle}" -> New Schedule: ${jobConfig.schedule.timezone} @ ${JSON.stringify(jobConfig.schedule.hours)}:${JSON.stringify(jobConfig.schedule.minutes)}`);
          summary.updated++;

          if (webhookUrl) {
            try {
              await sendCronSyncAlert({
                jobTitle: expectedTitle,
                timezone: jobConfig.schedule.timezone,
                hours: jobConfig.schedule.hours,
                minutes: jobConfig.schedule.minutes,
                webhookUrl,
                context: 'cron-job.org Synchronizer'
              });
            } catch (_) {}
          }
        }
      } else {
        console.log(`✨ [Creating New Job] "${expectedTitle}" (${jobConfig.schedule.timezone})...`);
        const newJobId = await createCronJob(cronApiKey, payload);
        console.log(`✅ [Created Successfully] "${expectedTitle}" -> Job ID: ${newJobId}`);
        summary.created++;
      }
    } catch (err) {
      console.error(`❌ [Error] Failed on "${expectedTitle}": ${err.message}`);
      summary.failed++;
    }

    await sleep(1000); // Rate limit pacing
  }

  return summary;
}

/**
 * Load settings from Google Sheet Settings tab
 */
async function tryLoadSheetSettings() {
  const sheetId = process.env.SPREADSHEET_ID || process.env.SHEET_ID;
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!sheetId || !saJson) return {};

  try {
    const credentials = JSON.parse(saJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'Settings'!A:Z`,
    });
    const [headers, ...rows] = res.data.values || [];
    if (!rows) return {};
    const settings = {};
    for (const r of rows) {
      if (r[0] !== undefined && r[0] !== null) {
        const k = String(r[0]).trim();
        const v = r[1] !== undefined && r[1] !== null ? String(r[1]).trim() : '';
        settings[k] = v;
        settings[k.toLowerCase()] = v;
      }
    }
    return settings;
  } catch {
    return {};
  }
}

async function main() {
  console.log('\n🚀 cron-job.org Smart Non-Destructive Cron Synchronizer');
  console.log('------------------------------------------------------------\n');

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

  const isNonInteractive = !process.stdin.isTTY || process.env.CI === 'true';

  if (!repoOwner) {
    if (isNonInteractive) {
      console.error('❌ Error: GITHUB_OWNER or GITHUB_REPOSITORY env variable is required.');
      process.exit(1);
    }
    repoOwner = await prompt('👤 Enter your GitHub Username/Owner: ');
  }

  if (!repoName) {
    if (isNonInteractive) {
      console.error('❌ Error: GITHUB_REPO or GITHUB_REPOSITORY env variable is required.');
      process.exit(1);
    }
    repoName = await prompt('📦 Enter your GitHub Repository Name: ');
  }

  const WORKFLOW_FILE = 'outreach.yml';
  const dispatchUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

  console.log(`📌 Target Repository: ${repoOwner}/${repoName}`);
  console.log(`🔗 Dispatch URL: ${dispatchUrl}\n`);

  const sheetSettings = await tryLoadSheetSettings();

  let cronApiKey = process.env.CRONJOB_API_KEY ||
    process.env.CRON_JOB_API_KEY ||
    process.env.CRON_API_KEY ||
    process.env.CRON_KEY ||
    process.env.CRONJOB_KEY ||
    sheetSettings.cronjob_api_key ||
    sheetSettings.cron_job_api_key ||
    sheetSettings.cron_api_key ||
    sheetSettings.cron_key ||
    sheetSettings.cronjob_key ||
    sheetSettings.cron_token ||
    sheetSettings.cronjob_token ||
    sheetSettings['cron api key'] ||
    sheetSettings['cron key'];

  let githubPat = process.env.PAT_GITHUB ||
    process.env.GITHUB_PAT ||
    process.env.PAT ||
    process.env.GH_PAT ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    sheetSettings.github_pat ||
    sheetSettings.pat_github ||
    sheetSettings.github_token ||
    sheetSettings.pat ||
    sheetSettings.gh_pat ||
    sheetSettings.gh_token ||
    sheetSettings['github pat'] ||
    sheetSettings['github token'];

  if (!cronApiKey) {
    if (isNonInteractive) {
      console.error('❌ Error: cron-job.org API Key is required (CRON_KEY env or in Sheet Settings).');
      process.exit(1);
    }
    cronApiKey = await prompt('🔑 Enter your cron-job.org API Key (from console.cron-job.org → Settings): ');
  }

  if (!githubPat) {
    if (isNonInteractive) {
      console.error('❌ Error: GitHub PAT is required (GITHUB_PAT env or in Sheet Settings).');
      process.exit(1);
    }
    githubPat = await prompt('🔑 Enter your GitHub Personal Access Token (PAT ghp_...): ');
  }

  // Parse custom schedules & timezone from Google Sheet settings
  const dynamicJobs = parseScheduleFromSettings(sheetSettings);
  console.log(`🌐 Configured Timezone: ${dynamicJobs[0]?.schedule?.timezone || 'Asia/Kolkata'}`);
  console.log(`⏰ Cold Outreach Time: ${JSON.stringify(dynamicJobs.find(j => j.action === 'outreach')?.schedule?.hours[0])}:${String(dynamicJobs.find(j => j.action === 'outreach')?.schedule?.minutes[0]).padStart(2, '0')}`);
  console.log(`⏰ Follow-up Time:    ${JSON.stringify(dynamicJobs.find(j => j.action === 'followup')?.schedule?.hours[0])}:${String(dynamicJobs.find(j => j.action === 'followup')?.schedule?.minutes[0]).padStart(2, '0')}\n`);

  const webhookUrl = sheetSettings.discord_updates_webhook || process.env.DISCORD_WEBHOOK_URL;
  const summary = await syncCronJobs(cronApiKey, githubPat, dispatchUrl, repoName, dynamicJobs, webhookUrl);

  console.log('\n📊 Synchronization Summary:');
  console.log(`• 🛡️ Up-to-Date (Skipped): ${summary.unchanged}`);
  console.log(`• 🔄 Updated:            ${summary.updated}`);
  console.log(`• ✨ Newly Created:       ${summary.created}`);
  console.log(`• ❌ Failures:            ${summary.failed}\n`);

  if (summary.failed > 0) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main();
}


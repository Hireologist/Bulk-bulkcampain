// scripts/setup-cron.mjs
import readline from "readline";
import { execSync as execSync2 } from "child_process";
import { google } from "googleapis";
import { fileURLToPath } from "url";
import path from "path";

// src/alerts.mjs
import { execSync } from "node:child_process";
var _cachedRemoteSlug = null;
function getRepoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  if (_cachedRemoteSlug) return _cachedRemoteSlug;
  try {
    const remoteUrl = execSync("git config --get remote.origin.url", { encoding: "utf8" }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) {
      _cachedRemoteSlug = `${match[1]}/${match[2]}`;
      return _cachedRemoteSlug;
    }
  } catch {
  }
  return process.env.GITHUB_REPO || "Sheet-bot";
}
function getRunUrl() {
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (repo && runId) {
    return `https://github.com/${repo}/actions/runs/${runId}`;
  }
  return "";
}
function formatDiscordContent(content) {
  const str = content != null ? String(content).trim() : "";
  const slug = getRepoSlug();
  const runUrl = getRunUrl();
  const tagPrefix = `**[${slug}]**`;
  let tagged = str.startsWith(tagPrefix) ? str : str ? `${tagPrefix} ${str}` : tagPrefix;
  if (runUrl && !tagged.includes(runUrl)) {
    tagged += `
\u{1F517} [View Run](${runUrl})`;
  }
  if (tagged.length > 2e3) {
    tagged = tagged.slice(0, 1996) + "...";
  }
  return tagged;
}
async function postToDiscord(webhookUrl, content, embeds = []) {
  if (!webhookUrl || typeof webhookUrl !== "string" || !webhookUrl.startsWith("http")) {
    return { success: false, reason: "Invalid or missing Discord Webhook URL" };
  }
  try {
    const taggedContent = formatDiscordContent(content);
    const payload = { content: taggedContent };
    if (Array.isArray(embeds) && embeds.length > 0) {
      const slug = getRepoSlug();
      payload.embeds = embeds.map((e) => {
        const currentFooter = e.footer?.text;
        const footerText = currentFooter ? currentFooter.includes(slug) ? currentFooter : `${slug} \u2022 ${currentFooter}` : slug;
        return {
          ...e,
          footer: { text: footerText }
        };
      });
    }
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errText = await res.text();
      return { success: false, status: res.status, error: errText };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
async function sendCronSyncAlert({
  jobTitle,
  timezone,
  hours = [],
  minutes = [],
  webhookUrl,
  context = "Google Sheet Settings Synchronization"
}) {
  if (!webhookUrl || typeof webhookUrl !== "string" || !webhookUrl.startsWith("http")) {
    return { success: false, reason: "No valid webhook URL" };
  }
  const hourStr = hours.map((h) => String(h).padStart(2, "0")).join(", ") || "00";
  const minStr = minutes.map((m) => String(m).padStart(2, "0")).join(", ") || "00";
  const embed = {
    title: "\u23F1\uFE0F Cron Job Schedule Auto-Synchronized",
    color: 3447003,
    description: `The schedule for **\`${jobTitle}\`** was automatically updated to match your Google Sheet **\`Settings\`** tab.`,
    fields: [
      { name: "\u{1F4CC} Job Title", value: `\`${jobTitle}\``, inline: true },
      { name: "\u{1F310} Timezone", value: `\`${timezone || "Asia/Kolkata"}\``, inline: true },
      { name: "\u23F0 New Trigger Time", value: `\`${hourStr}:${minStr}\``, inline: true },
      { name: "\u2699\uFE0F Source", value: context, inline: false }
    ],
    footer: { text: "Cron Auto-Synchronizer" },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  await postToDiscord(webhookUrl, `\u23F1\uFE0F **Cron Schedule Auto-Updated**: \`${jobTitle}\` synced with Google Sheet!`, [embed]);
  return { success: true, jobTitle };
}

// src/scheduler.mjs
import axios from "axios";
function isCampaignActive(settings = {}, type = "general") {
  const masterVal = String(settings.campaign_active ?? settings.is_active ?? settings.campaign_status ?? "TRUE").trim().toLowerCase();
  if (masterVal === "false" || masterVal === "paused" || masterVal === "off" || masterVal === "0" || masterVal === "no") {
    return false;
  }
  if (type === "outreach") {
    const outreachVal = String(settings.outreach_active ?? "TRUE").trim().toLowerCase();
    if (outreachVal === "false" || outreachVal === "paused" || outreachVal === "off" || outreachVal === "0") {
      return false;
    }
  } else if (type === "followup") {
    const followupVal = String(settings.followup_active ?? "TRUE").trim().toLowerCase();
    if (followupVal === "false" || followupVal === "paused" || followupVal === "off" || followupVal === "0") {
      return false;
    }
  }
  return true;
}

// scripts/setup-cron.mjs
function autoDetectGitRepo() {
  try {
    const remoteUrl = execSync2("git config --get remote.origin.url", { encoding: "utf8" }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
  }
  return null;
}
function prompt(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}
function parseTime(timeStr, defaultHour = 10, defaultMinute = 0) {
  if (!timeStr || typeof timeStr !== "string") {
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
function parseMinutesList(val = "15") {
  const clean = String(val).trim();
  if (clean.includes(",")) {
    return clean.split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 59);
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
function parseWeekdays(val = "Mon-Sat") {
  const clean = String(val).trim().toLowerCase();
  if (clean === "mon-fri") return [1, 2, 3, 4, 5];
  if (clean === "mon-sat") return [1, 2, 3, 4, 5, 6];
  if (clean === "all" || clean === "everyday" || clean === "daily") return [-1];
  if (clean.includes(",")) {
    return clean.split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n));
  }
  return [1, 2, 3, 4, 5, 6];
}
function parseScheduleFromSettings(settings = {}) {
  const timezone = settings.cron_timezone || "Asia/Kolkata";
  const wdays = parseWeekdays(settings.cron_days || "Mon-Sat");
  const followupTime = parseTime(settings.cron_followup_time || "09:30", 9, 30);
  const outreachTime = parseTime(settings.cron_outreach_time || "10:00", 10, 0);
  const digestTime = parseTime(settings.cron_digest_time || "18:30", 18, 30);
  const inboxMinutes = parseMinutesList(settings.cron_inbox_minutes || "15");
  const domainHealthTime = parseTime(settings.cron_domain_health_time || "06:00", 6, 0);
  const jobs = [
    {
      title: "Followup Engine",
      action: "followup",
      workflow: "outreach.yml",
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [followupTime.hour],
        minutes: [followupTime.minute],
        mdays: [-1],
        wdays,
        months: [-1]
      }
    },
    {
      title: "Cold Outreach",
      action: "outreach",
      workflow: "outreach.yml",
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [outreachTime.hour],
        minutes: [outreachTime.minute],
        mdays: [-1],
        wdays,
        months: [-1]
      }
    },
    {
      title: "Inbox Checker",
      action: "inbox",
      workflow: "outreach.yml",
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [-1],
        // Every hour
        minutes: inboxMinutes,
        mdays: [-1],
        wdays,
        months: [-1]
      }
    },
    {
      title: "Daily Digest",
      action: "digest",
      workflow: "outreach.yml",
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [digestTime.hour],
        minutes: [digestTime.minute],
        mdays: [-1],
        wdays,
        months: [-1]
      }
    },
    {
      title: "Domain Health Audit",
      workflow: "domain-health.yml",
      body: { ref: "main" },
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [domainHealthTime.hour],
        minutes: [domainHealthTime.minute],
        mdays: [-1],
        wdays: [1],
        // Every Monday
        months: [-1]
      }
    }
  ];
  const gccRadarTime = parseTime(settings.cron_gcc_radar_time || "09:00", 9, 0);
  jobs.push({
    title: "GCC Leadership Radar",
    workflow: "gcc_leadership_radar.yml",
    body: { ref: "main" },
    schedule: {
      timezone,
      expiresAt: 0,
      hours: [gccRadarTime.hour],
      minutes: [gccRadarTime.minute],
      mdays: [-1],
      wdays,
      months: [-1]
    }
  });
  const diagScheduleType = String(settings.cron_diagnostic_schedule || "daily_0900").trim().toLowerCase();
  const diagTime = parseTime(settings.cron_diagnostic_time || (diagScheduleType.includes("0830") ? "08:30" : "09:00"), 9, 0);
  if (!["manual", "off", "none", "disabled"].includes(diagScheduleType)) {
    const diagWdays = diagScheduleType === "weekly_monday_0830" || diagScheduleType === "weekly" ? [1] : wdays;
    jobs.push({
      title: "Campaign Pre-Flight Diagnostic",
      workflow: "test_campaign.yml",
      body: { ref: "main" },
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [diagTime.hour],
        minutes: [diagTime.minute],
        mdays: [-1],
        wdays: diagWdays,
        months: [-1]
      }
    });
  }
  return jobs;
}
var JOBS_TO_CREATE = parseScheduleFromSettings({});
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function buildJobPayload(repoName, defaultDispatchUrl, cleanPat, jobConfig, settings = {}) {
  let targetUrl = defaultDispatchUrl;
  if (jobConfig.workflow && defaultDispatchUrl) {
    targetUrl = defaultDispatchUrl.replace(/\/workflows\/[^/]+\/dispatches/, `/workflows/${jobConfig.workflow}/dispatches`);
  }
  const requestBody = jobConfig.body || {
    ref: "main",
    inputs: {
      action: jobConfig.action
    }
  };
  const isDiagnosticJob = jobConfig.workflow === "test_campaign.yml" || Boolean(jobConfig.title && jobConfig.title.toLowerCase().includes("diagnostic"));
  const isGlobalActive = isCampaignActive(settings);
  const isJobActive = jobConfig.action ? isCampaignActive(settings, jobConfig.action) : true;
  const isEnabled = isDiagnosticJob ? true : isGlobalActive && isJobActive;
  return {
    job: {
      url: targetUrl,
      title: `${repoName} - ${jobConfig.title}`,
      enabled: isEnabled,
      saveResponses: true,
      requestMethod: 1,
      // POST
      requestTimeout: 30,
      schedule: jobConfig.schedule,
      extendedData: {
        headers: {
          Authorization: `Bearer ${cleanPat}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "cron-job-org",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }
    }
  };
}
function isJobUpToDate(existingJobDetails, desiredPayload) {
  if (!existingJobDetails) return false;
  const existing = existingJobDetails.jobDetails || existingJobDetails.job || existingJobDetails;
  const desired = desiredPayload.job || desiredPayload;
  if (existing.url !== desired.url) return false;
  if (existing.enabled !== desired.enabled) return false;
  if (existing.requestMethod !== desired.requestMethod) return false;
  if (existing.schedule && desired.schedule) {
    const eSched = existing.schedule;
    const dSched = desired.schedule;
    if (eSched.timezone !== dSched.timezone) return false;
    if (JSON.stringify(eSched.hours || []) !== JSON.stringify(dSched.hours || [])) return false;
    if (JSON.stringify(eSched.minutes || []) !== JSON.stringify(dSched.minutes || [])) return false;
    if (JSON.stringify(eSched.wdays || []) !== JSON.stringify(dSched.wdays || [])) return false;
  }
  const existingBody = existing.extendedData?.body || "";
  const desiredBody = desired.extendedData?.body || "";
  try {
    const parsedE = typeof existingBody === "string" ? JSON.parse(existingBody) : existingBody;
    const parsedD = typeof desiredBody === "string" ? JSON.parse(desiredBody) : desiredBody;
    if (parsedE.inputs?.action !== parsedD.inputs?.action) return false;
  } catch {
    if (existingBody !== desiredBody) return false;
  }
  return true;
}
var DEFAULT_CRON_RETRY_DELAYS = [1e3, 2e3, 5e3, 1e4, 1e4, 1e4, 1e4, 1e4];
async function callCronJobApiWithRetry(apiFn, {
  delays = DEFAULT_CRON_RETRY_DELAYS,
  actionName = "cron-job.org request",
  onSleep = sleep
} = {}) {
  let attempt = 0;
  while (true) {
    attempt++;
    const res = await apiFn();
    if (res.status === 429) {
      if (attempt <= delays.length) {
        const waitMs = delays[attempt - 1];
        console.warn(`\u23F3 [Rate Limited 429] on ${actionName}. Waiting ${waitMs / 1e3}s before retry (attempt ${attempt}/${delays.length})...`);
        await onSleep(waitMs);
        continue;
      }
      const errText = await res.text().catch(() => "");
      throw new Error(`Failed on ${actionName} after ${attempt} attempts (429): ${errText}`);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Failed to ${actionName} (${res.status}): ${errText}`);
    }
    return res;
  }
}
async function fetchExistingJobs(cronApiKey, options = {}) {
  const res = await callCronJobApiWithRetry(
    () => fetch("https://api.cron-job.org/jobs", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cronApiKey}`,
        "Content-Type": "application/json"
      }
    }),
    { actionName: "list cron-job.org jobs", ...options }
  );
  const data = await res.json();
  return data.jobs || [];
}
async function fetchJobDetails(cronApiKey, jobId, options = {}) {
  try {
    const res = await callCronJobApiWithRetry(
      () => fetch(`https://api.cron-job.org/jobs/${jobId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cronApiKey}`,
          "Content-Type": "application/json"
        }
      }),
      { actionName: `fetch details for job ${jobId}`, ...options }
    );
    return await res.json();
  } catch {
    return null;
  }
}
async function updateCronJob(cronApiKey, jobId, payload, options = {}) {
  await callCronJobApiWithRetry(
    () => fetch(`https://api.cron-job.org/jobs/${jobId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${cronApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }),
    { actionName: `update cron job ${jobId}`, ...options }
  );
  return true;
}
async function createCronJob(cronApiKey, payload, options = {}) {
  const res = await callCronJobApiWithRetry(
    () => fetch("https://api.cron-job.org/jobs", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${cronApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }),
    { actionName: `create cron job "${payload?.job?.title || "job"}"`, ...options }
  );
  const data = await res.json();
  return data.jobId;
}
async function syncCronJobs(cronApiKey, githubPat, dispatchUrl, repoName, jobsToSync = JOBS_TO_CREATE, webhookUrl = null, sheetSettings = {}) {
  let cleanPat = githubPat.trim();
  if (cleanPat.toLowerCase().startsWith("bearer ")) {
    cleanPat = cleanPat.substring(7).trim();
  } else if (cleanPat.toLowerCase().startsWith("token ")) {
    cleanPat = cleanPat.substring(6).trim();
  }
  console.log("\u{1F50D} Fetching existing jobs from cron-job.org...");
  const existingJobs = await fetchExistingJobs(cronApiKey);
  console.log(`Found ${existingJobs.length} existing job(s) in your cron-job.org account.
`);
  const summary = { unchanged: 0, updated: 0, created: 0, failed: 0 };
  for (const jobConfig of jobsToSync) {
    const expectedTitle = `${repoName} - ${jobConfig.title}`;
    const payload = buildJobPayload(repoName, dispatchUrl, cleanPat, jobConfig, sheetSettings);
    const existing = existingJobs.find(
      (j) => j.title === expectedTitle || j.url === dispatchUrl && j.title.toLowerCase().includes(jobConfig.title.toLowerCase())
    );
    try {
      if (existing) {
        const detailed = await fetchJobDetails(cronApiKey, existing.jobId);
        const upToDate = isJobUpToDate(detailed, payload);
        if (upToDate) {
          console.log(`\u{1F6E1}\uFE0F [Already Up-to-Date] "${expectedTitle}" (${jobConfig.schedule.timezone} @ ${JSON.stringify(jobConfig.schedule.hours)}:${JSON.stringify(jobConfig.schedule.minutes)}) -> Skipped.`);
          summary.unchanged++;
        } else {
          console.log(`\u{1F504} [Updating Schedule/Config] "${expectedTitle}" (Job ID: ${existing.jobId})...`);
          await updateCronJob(cronApiKey, existing.jobId, payload);
          console.log(`\u2705 [Updated Successfully] "${expectedTitle}" -> New Schedule: ${jobConfig.schedule.timezone} @ ${JSON.stringify(jobConfig.schedule.hours)}:${JSON.stringify(jobConfig.schedule.minutes)}`);
          summary.updated++;
          if (webhookUrl) {
            try {
              await sendCronSyncAlert({
                jobTitle: expectedTitle,
                timezone: jobConfig.schedule.timezone,
                hours: jobConfig.schedule.hours,
                minutes: jobConfig.schedule.minutes,
                webhookUrl,
                context: "cron-job.org Synchronizer"
              });
            } catch (_) {
            }
          }
        }
      } else {
        console.log(`\u2728 [Creating New Job] "${expectedTitle}" (${jobConfig.schedule.timezone})...`);
        const newJobId = await createCronJob(cronApiKey, payload);
        console.log(`\u2705 [Created Successfully] "${expectedTitle}" -> Job ID: ${newJobId}`);
        summary.created++;
      }
    } catch (err) {
      console.error(`\u274C [Error] Failed on "${expectedTitle}": ${err.message}`);
      summary.failed++;
    }
    await sleep(2e3);
  }
  return summary;
}
async function tryLoadSheetSettings() {
  const sheetId = process.env.SPREADSHEET_ID || process.env.SHEET_ID;
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!sheetId || !saJson) return {};
  try {
    const credentials = JSON.parse(saJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'Settings'!A:Z`
    });
    const allRows = res.data.values || [];
    if (!allRows || allRows.length === 0) return {};
    const settings = {};
    for (const r of allRows) {
      if (!Array.isArray(r) || r.length === 0) continue;
      let rawK = r[0] !== void 0 && r[0] !== null ? String(r[0]).trim() : "";
      let rawV = "";
      if (rawK) {
        let sepIdx = -1;
        let sepLen = 1;
        if (rawK.includes("	")) {
          sepIdx = rawK.indexOf("	");
        } else if (rawK.includes(":")) {
          sepIdx = rawK.indexOf(":");
        } else if (rawK.includes("=") && rawK.indexOf("=") < rawK.length - 2) {
          sepIdx = rawK.indexOf("=");
        } else if (/\s{2,}/.test(rawK)) {
          const match = rawK.match(/\s{2,}/);
          if (match) {
            sepIdx = match.index;
            sepLen = match[0].length;
          }
        }
        if (sepIdx !== -1) {
          const potentialK = rawK.slice(0, sepIdx).trim();
          const potentialV = rawK.slice(sepIdx + sepLen).trim();
          if (potentialK && potentialV) {
            rawK = potentialK;
            rawV = potentialV;
          }
        }
      }
      if (!rawV) {
        const colB = r[1] !== void 0 && r[1] !== null ? String(r[1]).trim() : "";
        if (colB) {
          rawV = colB;
        } else {
          const colC = r[2] !== void 0 && r[2] !== null ? String(r[2]).trim() : "";
          if (colC && !colC.toLowerCase().startsWith("optional") && !colC.toLowerCase().includes("auto-read") && !colC.toLowerCase().includes("default")) {
            rawV = colC;
          }
        }
      }
      if (rawK) {
        const cleanK = rawK.trim();
        const lowerK = cleanK.toLowerCase();
        const snakeK = lowerK.replace(/[\s\-_]+/g, "_");
        const noSepK = lowerK.replace(/[^a-z0-9]/g, "");
        settings[cleanK] = rawV;
        settings[lowerK] = rawV;
        settings[snakeK] = rawV;
        settings[noSepK] = rawV;
      }
    }
    for (const k of ["cron_api_key", "cronjob_api_key", "cron_key", "cronapikey", "cronkey"]) {
      if (settings[k] && (settings[k].toLowerCase().startsWith("optional") || settings[k].toLowerCase().includes("auto-read") || settings[k].includes(" "))) {
        delete settings[k];
      }
    }
    if (!settings.cron_api_key && !settings.cronjob_api_key) {
      for (const r of allRows) {
        for (const cell of Array.isArray(r) ? r : []) {
          const val = String(cell || "").trim();
          if ((val.startsWith("AXPV+") || /^[A-Za-z0-9+/=]{40,64}$/.test(val)) && !val.includes(" ") && !val.toLowerCase().includes("optional")) {
            settings.cron_api_key = val;
            settings.cronjob_api_key = val;
            break;
          }
        }
        if (settings.cron_api_key) break;
      }
    }
    return settings;
  } catch {
    return {};
  }
}
async function main() {
  console.log("\n\u{1F680} cron-job.org Smart Non-Destructive Cron Synchronizer");
  console.log("------------------------------------------------------------\n");
  const detectedGit = autoDetectGitRepo();
  let repoOwner = process.env.GITHUB_OWNER || (detectedGit ? detectedGit.owner : "");
  let repoName = process.env.GITHUB_REPO || (detectedGit ? detectedGit.repo : "");
  if (process.env.GITHUB_REPOSITORY) {
    const parts = process.env.GITHUB_REPOSITORY.split("/");
    if (parts.length === 2) {
      if (!repoOwner) repoOwner = parts[0];
      if (!repoName) repoName = parts[1];
    }
  }
  const isNonInteractive = !process.stdin.isTTY || process.env.CI === "true";
  if (!repoOwner) {
    if (isNonInteractive) {
      console.error("\u274C Error: GITHUB_OWNER or GITHUB_REPOSITORY env variable is required.");
      process.exit(1);
    }
    repoOwner = await prompt("\u{1F464} Enter your GitHub Username/Owner: ");
  }
  if (!repoName) {
    if (isNonInteractive) {
      console.error("\u274C Error: GITHUB_REPO or GITHUB_REPOSITORY env variable is required.");
      process.exit(1);
    }
    repoName = await prompt("\u{1F4E6} Enter your GitHub Repository Name: ");
  }
  const WORKFLOW_FILE = "outreach.yml";
  const dispatchUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  console.log(`\u{1F4CC} Target Repository: ${repoOwner}/${repoName}`);
  console.log(`\u{1F517} Dispatch URL: ${dispatchUrl}
`);
  const sheetSettings = await tryLoadSheetSettings();
  let cronApiKey = process.env.CRONJOB_API_KEY || process.env.CRON_JOB_API_KEY || process.env.CRON_API_KEY || process.env.CRON_KEY || process.env.CRONJOB_KEY || sheetSettings.cronjob_api_key || sheetSettings.cron_job_api_key || sheetSettings.cron_api_key || sheetSettings.cron_key || sheetSettings.cronjob_key || sheetSettings.cron_token || sheetSettings.cronjob_token || sheetSettings["cron api key"] || sheetSettings["cron key"];
  let githubPat = process.env.PAT_GITHUB || process.env.GITHUB_PAT || process.env.PAT || process.env.GH_PAT || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || sheetSettings.github_pat || sheetSettings.pat_github || sheetSettings.github_token || sheetSettings.pat || sheetSettings.gh_pat || sheetSettings.gh_token || sheetSettings["github pat"] || sheetSettings["github token"];
  if (!cronApiKey) {
    if (isNonInteractive) {
      console.error("\u274C Error: cron-job.org API Key is required (CRON_KEY env or in Sheet Settings).");
      process.exit(1);
    }
    cronApiKey = await prompt("\u{1F511} Enter your cron-job.org API Key (from console.cron-job.org \u2192 Settings): ");
  }
  if (!githubPat) {
    if (isNonInteractive) {
      console.error("\u274C Error: GitHub PAT is required (GITHUB_PAT env or in Sheet Settings).");
      process.exit(1);
    }
    githubPat = await prompt("\u{1F511} Enter your GitHub Personal Access Token (PAT ghp_...): ");
  }
  const dynamicJobs = parseScheduleFromSettings(sheetSettings);
  console.log(`\u{1F310} Configured Timezone: ${dynamicJobs[0]?.schedule?.timezone || "Asia/Kolkata"}`);
  console.log(`\u23F0 Cold Outreach Time: ${JSON.stringify(dynamicJobs.find((j) => j.action === "outreach")?.schedule?.hours[0])}:${String(dynamicJobs.find((j) => j.action === "outreach")?.schedule?.minutes[0]).padStart(2, "0")}`);
  console.log(`\u23F0 Follow-up Time:    ${JSON.stringify(dynamicJobs.find((j) => j.action === "followup")?.schedule?.hours[0])}:${String(dynamicJobs.find((j) => j.action === "followup")?.schedule?.minutes[0]).padStart(2, "0")}
`);
  const webhookUrl = sheetSettings.discord_updates_webhook || process.env.DISCORD_WEBHOOK_URL;
  const summary = await syncCronJobs(cronApiKey, githubPat, dispatchUrl, repoName, dynamicJobs, webhookUrl, sheetSettings);
  console.log("\n\u{1F4CA} Synchronization Summary:");
  console.log(`\u2022 \u{1F6E1}\uFE0F Up-to-Date (Skipped): ${summary.unchanged}`);
  console.log(`\u2022 \u{1F504} Updated:            ${summary.updated}`);
  console.log(`\u2022 \u2728 Newly Created:       ${summary.created}`);
  console.log(`\u2022 \u274C Failures:            ${summary.failed}
`);
  if (summary.failed > 0) {
    process.exit(1);
  }
}
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main();
}
export {
  DEFAULT_CRON_RETRY_DELAYS,
  JOBS_TO_CREATE,
  autoDetectGitRepo,
  buildJobPayload,
  callCronJobApiWithRetry,
  createCronJob,
  fetchExistingJobs,
  fetchJobDetails,
  isJobUpToDate,
  parseMinutesList,
  parseScheduleFromSettings,
  parseTime,
  parseWeekdays,
  sleep,
  syncCronJobs,
  updateCronJob
};

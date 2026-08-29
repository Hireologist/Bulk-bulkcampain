import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPLETE_SCHEMA, formatSheetTab } from './auto-setup.mjs';
import { postToDiscord, writeGitHubStepSummary } from '../src/alerts.mjs';
import {
  parseWeekdays,
  parseTime,
  parseMinutesList,
  buildJobPayload,
  fetchExistingJobs,
  updateCronJob,
  createCronJob,
  autoDetectGitRepo
} from '../setup-cron.mjs';

/**
 * 🪄 1-Click Multi-Campaign & Google Sheet Provisioner
 * 
 * 1. Creates a brand-new Google Spreadsheet titled "[Sheet-bot] <Campaign Name>".
 * 2. Makes the Sheet PUBLIC with EDIT access (and optionally shares with user's email).
 * 3. Populates all 11 color-coded tabs, formulas, headers, and starter settings.
 * 4. Generates a dedicated, independently-stoppable GitHub Actions workflow:
 *    `.github/workflows/outreach_<campaign_slug>.yml`
 * 5. Configures dynamic Run-Name: `[<Campaign Name>] <Action> (<Event>)`.
 * 6. Dispatches Discord alert with the live Google Sheet link.
 */

export function getGoogleClient() {
  let auth;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ],
    });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ],
    });
  } else {
    throw new Error('Google Service Account credentials not found. Set GOOGLE_SERVICE_ACCOUNT_JSON or Email+Key.');
  }

  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });
  return { auth, sheets, drive };
}

export function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'custom_campaign';
}

export async function registerCronJobsForCampaign({
  campaignName,
  slug,
  cronApiKey,
  githubPat,
  settings = {},
}) {
  if (!cronApiKey || !githubPat) return { registeredCount: 0, jobs: [] };

  const cleanName = campaignName.trim();
  const repoInfo = process.env.GITHUB_REPOSITORY
    ? { owner: process.env.GITHUB_REPOSITORY.split('/')[0], repo: process.env.GITHUB_REPOSITORY.split('/')[1] }
    : autoDetectGitRepo();

  if (!repoInfo) {
    console.warn('  ⚠️ Could not determine GitHub repository. Skipping automated cron job creation.');
    return { registeredCount: 0, jobs: [] };
  }

  const { owner, repo } = repoInfo;
  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/outreach_${slug}.yml/dispatches`;

  const timezone = settings.cron_timezone || 'Asia/Kolkata';
  const wdays = parseWeekdays(settings.cron_days || 'Mon-Sat');
  const followupTime = parseTime(settings.cron_followup_time || '09:30', 9, 30);
  const outreachTime = parseTime(settings.cron_outreach_time || '10:00', 10, 0);
  const digestTime = parseTime(settings.cron_digest_time || '18:30', 18, 30);
  const inboxMinutes = parseMinutesList(settings.cron_inbox_minutes || '15');

  const jobsToCreate = [
    {
      title: `[${cleanName}] Followup Engine`,
      action: 'followup',
      workflow: `outreach_${slug}.yml`,
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
      title: `[${cleanName}] Cold Outreach`,
      action: 'outreach',
      workflow: `outreach_${slug}.yml`,
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
      title: `[${cleanName}] Inbox Checker`,
      action: 'inbox',
      workflow: `outreach_${slug}.yml`,
      schedule: {
        timezone,
        expiresAt: 0,
        hours: [-1],
        minutes: inboxMinutes,
        mdays: [-1],
        wdays,
        months: [-1],
      },
    },
    {
      title: `[${cleanName}] Daily Digest`,
      action: 'digest',
      workflow: `outreach_${slug}.yml`,
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
  ];

  const registeredJobs = [];
  try {
    const existingJobs = await fetchExistingJobs(cronApiKey);

    for (const jobConfig of jobsToCreate) {
      const payload = buildJobPayload(repo, dispatchUrl, githubPat, jobConfig);
      const existing = existingJobs.find(
        (j) => (j.title || '').includes(jobConfig.title) || (j.url || '').includes(`outreach_${slug}.yml`)
      );

      if (existing) {
        await updateCronJob(cronApiKey, existing.jobId, payload);
        registeredJobs.push({ title: jobConfig.title, id: existing.jobId, action: 'updated' });
        console.log(`  🔄 Updated cron job: "${jobConfig.title}" (ID: ${existing.jobId})`);
      } else {
        const newJobId = await createCronJob(cronApiKey, payload);
        registeredJobs.push({ title: jobConfig.title, id: newJobId, action: 'created' });
        console.log(`  ✨ Created cron job: "${jobConfig.title}" (ID: ${newJobId})`);
      }
    }
  } catch (cronErr) {
    console.warn(`  ⚠️ Cron-job.org sync error: ${cronErr.message}`);
  }

  return { registeredCount: registeredJobs.length, jobs: registeredJobs };
}

export async function loadSettingsFromMainSheet(sheetsClient, mainSheetId) {
  if (!mainSheetId || typeof mainSheetId !== 'string' || !mainSheetId.trim()) return {};
  try {
    const cleanId = mainSheetId.trim();
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: cleanId,
      range: `'Settings'!A:C`,
    });
    const rows = res.data.values || [];
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
  } catch (err) {
    console.warn(`  ℹ️ Note: Could not load settings from main sheet [${mainSheetId}]: ${err.message}`);
    return {};
  }
}

export async function runPreflightChecks({
  campaignName,
  existingSheetId = '',
  userEmail = '',
  githubPat = '',
  cronApiKey = '',
  mainSheetId = process.env.SPREADSHEET_ID || process.env.SHEET_ID || '',
  isCI = process.env.GITHUB_ACTIONS === 'true',
  skipGoogleAuth = false
}) {
  const errors = [];
  const warnings = [];
  const checks = [];
  let mainSettings = {};

  console.log(`\n=============================================================`);
  console.log(`🔍 RUNNING PRE-FLIGHT VALIDATION CHECKS`);
  console.log(`=============================================================`);

  // 1. Campaign Name Validation
  if (!campaignName || typeof campaignName !== 'string' || !campaignName.trim()) {
    errors.push('Campaign Name is required and cannot be empty.');
    checks.push({ name: 'Campaign Name', status: 'FAIL', detail: 'Missing or empty' });
  } else {
    const slug = slugify(campaignName.trim());
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', `outreach_${slug}.yml`);
    const workflowExists = fs.existsSync(workflowPath);
    checks.push({
      name: 'Campaign Name & Slug',
      status: 'PASS',
      detail: `"${campaignName.trim()}" (slug: ${slug})${workflowExists ? ' [will update existing workflow]' : ''}`
    });
  }

  // 2. Google Service Account Validation & Main Sheet Settings Loading
  if (!skipGoogleAuth) {
    try {
      const { auth, sheets, drive } = getGoogleClient();
      checks.push({
        name: 'Google Service Account',
        status: 'PASS',
        detail: 'Credentials parsed & initialized'
      });

      // Verify connection to Drive API
      try {
        await drive.about.get({ fields: 'user' });
        checks.push({
          name: 'Google Drive API Connection',
          status: 'PASS',
          detail: 'Drive API reachable & authenticated'
        });
      } catch (driveErr) {
        if (driveErr.status === 401 || driveErr.status === 403) {
          errors.push(`Google Drive API authentication failed (HTTP ${driveErr.status}): ${driveErr.message}`);
          checks.push({
            name: 'Google Drive API Connection',
            status: 'FAIL',
            detail: driveErr.message
          });
        } else {
          checks.push({
            name: 'Google Drive API Connection',
            status: 'WARN',
            detail: `Drive API status: ${driveErr.message}`
          });
        }
      }

      // Check main sheet if available and inherit global settings
      if (mainSheetId && mainSheetId.trim()) {
        try {
          mainSettings = await loadSettingsFromMainSheet(sheets, mainSheetId);
          if (Object.keys(mainSettings).length > 0) {
            checks.push({
              name: 'Main Google Sheet Settings',
              status: 'PASS',
              detail: `Loaded global config from [${mainSheetId.trim()}]`
            });
          }
        } catch (_) {}
      }

      // If existingSheetId is provided, verify accessibility
      if (existingSheetId && existingSheetId.trim()) {
        try {
          const sheetRes = await sheets.spreadsheets.get({
            spreadsheetId: existingSheetId.trim(),
            fields: 'spreadsheetId,properties.title'
          });
          checks.push({
            name: 'Existing Google Sheet Access',
            status: 'PASS',
            detail: `Accessible: "${sheetRes.data.properties?.title || existingSheetId}"`
          });
        } catch (sheetErr) {
          errors.push(`Cannot access existing Google Sheet "${existingSheetId}". Ensure the Service Account email is added as Editor. Details: ${sheetErr.message}`);
          checks.push({
            name: 'Existing Google Sheet Access',
            status: 'FAIL',
            detail: `Inaccessible (${sheetErr.message})`
          });
        }
      }
    } catch (gErr) {
      errors.push(`Google Service Account credentials invalid or missing: ${gErr.message}`);
      checks.push({
        name: 'Google Service Account',
        status: 'FAIL',
        detail: gErr.message
      });
    }
  }

  // 3. GitHub Personal Access Token (PAT) Validation
  const effectivePat = githubPat || process.env.PAT_GITHUB || process.env.GITHUB_PAT || process.env.GH_PAT || process.env.PAT || mainSettings.github_pat || '';
  if (isCI) {
    if (!effectivePat) {
      errors.push(
        `Missing GitHub Personal Access Token (PAT_GITHUB).\n` +
        `   👉 GitHub requires a PAT with 'workflow' and 'repo' scopes to commit & push dedicated workflows.\n` +
        `   👉 Solution: Add 'PAT_GITHUB' to Repository Secrets (Settings > Secrets and variables > Actions), or supply it as input 'github_pat'.`
      );
      checks.push({
        name: 'GitHub PAT (workflow scope)',
        status: 'FAIL',
        detail: 'Missing secret PAT_GITHUB'
      });
    } else {
      // Validate PAT with GitHub API
      try {
        const repoInfo = process.env.GITHUB_REPOSITORY
          ? { owner: process.env.GITHUB_REPOSITORY.split('/')[0], repo: process.env.GITHUB_REPOSITORY.split('/')[1] }
          : autoDetectGitRepo();

        const testUrl = repoInfo 
          ? `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`
          : 'https://api.github.com/user';

        const ghRes = await fetch(testUrl, {
          headers: {
            Authorization: `Bearer ${effectivePat}`,
            'User-Agent': 'Sheet-Bot-Provisioner',
            Accept: 'application/vnd.github+json'
          }
        });

        if (ghRes.ok) {
          const scopes = ghRes.headers.get('x-oauth-scopes') || '';
          const hasWorkflow = scopes.includes('workflow');
          if (scopes && !hasWorkflow) {
            warnings.push(`GitHub PAT may lack 'workflow' scope (found scopes: ${scopes}). Pushing workflow files might fail.`);
            checks.push({
              name: 'GitHub PAT Auth',
              status: 'WARN',
              detail: `Authenticated (scopes: ${scopes}) - missing 'workflow' scope`
            });
          } else {
            checks.push({
              name: 'GitHub PAT Auth',
              status: 'PASS',
              detail: `Authenticated & verified (scopes: ${scopes || 'fine-grained token'})`
            });
          }
        } else {
          errors.push(`GitHub PAT authentication failed (HTTP ${ghRes.status} ${ghRes.statusText}). Check your PAT_GITHUB secret.`);
          checks.push({
            name: 'GitHub PAT Auth',
            status: 'FAIL',
            detail: `HTTP ${ghRes.status} ${ghRes.statusText}`
          });
        }
      } catch (ghErr) {
        warnings.push(`Could not verify GitHub PAT via network: ${ghErr.message}`);
        checks.push({
          name: 'GitHub PAT Auth',
          status: 'WARN',
          detail: `Network check bypassed: ${ghErr.message}`
        });
      }
    }
  } else {
    // Local execution
    if (effectivePat) {
      checks.push({
        name: 'GitHub PAT',
        status: 'PASS',
        detail: 'Configured (automated cron-job.org sync enabled)'
      });
    } else {
      checks.push({
        name: 'GitHub PAT',
        status: 'INFO',
        detail: 'Not set (cron-job.org auto-dispatch will be skipped)'
      });
    }
  }

  // 4. cron-job.org API Key Validation
  const effectiveCronKey = cronApiKey || process.env.CRON_API_KEY || process.env.CRON_KEY || mainSettings.cron_api_key || mainSettings.cronjob_api_key || '';
  if (effectiveCronKey) {
    try {
      const cronRes = await fetch('https://api.cron-job.org/jobs', {
        headers: { Authorization: `Bearer ${effectiveCronKey}` }
      });
      if (cronRes.ok) {
        checks.push({
          name: 'cron-job.org API',
          status: 'PASS',
          detail: `Connected & authenticated ${mainSettings.cron_api_key ? '(inherited from main sheet)' : ''}`
        });
      } else {
        warnings.push(`cron-job.org API Key returned HTTP ${cronRes.status}. Automated cron scheduling may fail.`);
        checks.push({
          name: 'cron-job.org API',
          status: 'WARN',
          detail: `HTTP ${cronRes.status} ${cronRes.statusText}`
        });
      }
    } catch (cErr) {
      warnings.push(`Could not reach cron-job.org: ${cErr.message}`);
      checks.push({
        name: 'cron-job.org API',
        status: 'WARN',
        detail: `Network check bypassed: ${cErr.message}`
      });
    }
  } else {
    checks.push({
      name: 'cron-job.org API',
      status: 'INFO',
      detail: 'Not set in main sheet, secrets, or inputs (schedules can be added later via setup_cron or Sheet Settings)'
    });
  }

  // Print Pre-Flight Results
  console.log(`📋 PRE-FLIGHT CHECK RESULTS:`);
  for (const c of checks) {
    const badge = c.status === 'PASS' ? '✅ PASS' : c.status === 'FAIL' ? '❌ FAIL' : c.status === 'WARN' ? '⚠️ WARN' : 'ℹ️ INFO';
    console.log(`  ${badge.padEnd(8)} | ${c.name.padEnd(28)} | ${c.detail}`);
  }
  console.log(`-------------------------------------------------------------`);

  // If there are failures, output Step Summary and throw
  if (errors.length > 0) {
    const errorMarkdown = 
`## 🚨 Campaign Pre-Flight Validation Failed

> **Campaign Name:** \`${campaignName || 'Unknown'}\`  
> **Status:** Aborted before creating any resources to prevent incomplete configuration.

### ❌ Failed Checks:
${errors.map((e, idx) => `${idx + 1}. ${e}`).join('\n\n')}

### 📋 Full Check Summary:
| Check | Status | Details |
| :--- | :---: | :--- |
${checks.map(c => `| **${c.name}** | ${c.status === 'PASS' ? '✅ PASS' : c.status === 'FAIL' ? '❌ FAIL' : c.status === 'WARN' ? '⚠️ WARN' : 'ℹ️ INFO'} | ${c.detail} |`).join('\n')}

---
👉 **Next Steps:** Resolve the missing secrets above, then re-run the workflow!
`;
    writeGitHubStepSummary(errorMarkdown);

    console.error(`\n❌ PRE-FLIGHT VALIDATION FAILED with ${errors.length} error(s):`);
    errors.forEach((err, idx) => console.error(`  ${idx + 1}. ${err}`));
    console.error(`\n🛑 Aborting campaign provisioning to protect against partial/incomplete setup.\n`);

    const failureError = new Error(`Pre-flight validation failed with ${errors.length} error(s). See logs above.`);
    failureError.errors = errors;
    failureError.checks = checks;
    throw failureError;
  }

  console.log(`🎉 All required pre-flight checks passed! Beginning campaign provisioning...\n`);
  return { valid: true, checks, warnings, mainSettings };
}

export async function createNewCampaign({
  campaignName,
  existingSheetId = '',
  userEmail = '',
  makePublic = true,
  timezone = 'Asia/Kolkata',
  cronApiKey = '',
  githubPat = '',
  discordWebhook = '',
  skipPreflight = false
}) {
  if (!campaignName || typeof campaignName !== 'string' || !campaignName.trim()) {
    throw new Error('Campaign Name is required to create a new campaign.');
  }

  const cleanName = campaignName.trim();
  const slug = slugify(cleanName);
  let mainSettings = {};

  // 0. Execute Pre-flight Validation Checks First
  if (!skipPreflight) {
    const preflightResult = await runPreflightChecks({
      campaignName: cleanName,
      existingSheetId,
      userEmail,
      githubPat,
      cronApiKey
    });
    if (preflightResult && preflightResult.mainSettings) {
      mainSettings = preflightResult.mainSettings;
    }
  }

  console.log(`\n=============================================================`);
  console.log(`🪄 PROVISIONING CAMPAIGN: "${cleanName}" (Slug: ${slug})`);
  console.log(`=============================================================`);

  const { sheets, drive } = getGoogleClient();

  // If mainSettings was not loaded yet, attempt to load from SPREADSHEET_ID
  const mainSheetId = process.env.SPREADSHEET_ID || process.env.SHEET_ID || '';
  if (Object.keys(mainSettings).length === 0 && mainSheetId && mainSheetId.trim() && mainSheetId.trim() !== (existingSheetId || '').trim()) {
    mainSettings = await loadSettingsFromMainSheet(sheets, mainSheetId);
  }

  let spreadsheetId = (existingSheetId || '').trim();
  let spreadsheetUrl = '';

  if (spreadsheetId) {
    console.log(`📄 Connecting to Existing Google Sheet (ID: ${spreadsheetId})...`);
    spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  } else {
    // 1. Create a brand new Google Spreadsheet
    console.log(`📄 Creating new Google Spreadsheet: "[Sheet-bot] ${cleanName}"...`);
    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `[Sheet-bot] ${cleanName}`,
        },
      },
    });

    spreadsheetId = createRes.data.spreadsheetId;
    spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    console.log(`✅ Google Sheet Created successfully!`);
  }

  console.log(`🆔 Sheet ID:  ${spreadsheetId}`);
  console.log(`🔗 Sheet URL: ${spreadsheetUrl}\n`);

  // 2. Set Permissions: Make PUBLIC with EDIT Access
  if (makePublic) {
    try {
      console.log(`🔓 Making Google Sheet PUBLIC with EDIT access (Anyone with link can edit)...`);
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: {
          role: 'writer',
          type: 'anyone',
        },
      });
      console.log(`✅ Public EDIT access enabled successfully!`);
    } catch (permErr) {
      console.warn(`⚠️ Could not make sheet public via Drive API: ${permErr.message}`);
    }
  }

  // 3. Share with User Email if provided
  if (userEmail && userEmail.includes('@')) {
    try {
      console.log(`✉️ Sharing Google Sheet directly with ${userEmail} (Editor role)...`);
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: {
          role: 'writer',
          type: 'user',
          emailAddress: userEmail.trim(),
        },
        sendNotificationEmail: false,
      });
      console.log(`✅ Shared directly with ${userEmail}!`);
    } catch (shareErr) {
      console.warn(`⚠️ Could not share with ${userEmail}: ${shareErr.message}`);
    }
  }

  // 4. Non-Destructive Tab & Schema Synchronization (All 11 Tabs)
  console.log(`\n📊 Synchronizing all 11 tabs, headers, formulas, and default settings...`);
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = meta.data.sheets || [];
  const existingTitles = new Set(existingSheets.map((s) => s.properties.title));

  for (const [title, config] of Object.entries(COMPLETE_SCHEMA)) {
    if (!existingTitles.has(title)) {
      // Create missing tab
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title } } }],
        },
      });

      let sampleData = config.sampleData || [];
      if (title === 'Settings' && mainSettings && Object.keys(mainSettings).length > 0) {
        sampleData = sampleData.map(([key, defVal, desc]) => {
          const inheritedVal = mainSettings[key] || mainSettings[key.toLowerCase()];
          if (inheritedVal !== undefined && inheritedVal !== null && inheritedVal !== '') {
            return [key, inheritedVal, desc];
          }
          return [key, defVal, desc];
        });
        console.log(`  ✨ Populated 'Settings' tab with inherited values from main sheet!`);
      }

      const values = [config.headers, ...sampleData];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${title}'!A1:${String.fromCharCode(64 + config.headers.length)}${values.length}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      });
      console.log(`  ✨ Created missing tab: "${title}"`);
    } else {
      // Check for missing headers and append non-destructively
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${title}'!A1:Z1`,
      });
      const existingHeaders = (res.data.values?.[0] || []).map((h) => String(h).trim());
      const missingHeaders = config.headers.filter((h) => !existingHeaders.includes(h));

      if (missingHeaders.length > 0) {
        const startColIdx = existingHeaders.length + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${title}'!${String.fromCharCode(64 + startColIdx)}1:${String.fromCharCode(64 + startColIdx + missingHeaders.length - 1)}1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [missingHeaders] },
        });
        console.log(`  ➕ Appended missing headers to "${title}": ${missingHeaders.join(', ')}`);
      } else {
        console.log(`  🛡️ Tab "${title}" is already up-to-date.`);
      }
    }
  }

  // 5. Apply Custom Tab Colors & Header Styling (Matching Code.gs)
  console.log(`🎨 Applying custom tab colors, frozen rows, bold headers, and column widths...`);
  const finalMeta = await sheets.spreadsheets.get({ spreadsheetId });
  for (const s of finalMeta.data.sheets || []) {
    const title = s.properties.title;
    const config = COMPLETE_SCHEMA[title];
    if (config) {
      await formatSheetTab(sheets, spreadsheetId, s.properties.sheetId, title, config);
    }
  }

  // Delete default "Sheet1" only if our tabs exist and Sheet1 is empty
  try {
    const sheet1 = finalMeta.data.sheets?.find(s => s.properties.title === 'Sheet1');
    if (sheet1 && (finalMeta.data.sheets || []).length > 1) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ deleteSheet: { sheetId: sheet1.properties.sheetId } }],
        },
      });
      console.log(`🗑️ Removed empty default "Sheet1".`);
    }
  } catch (_) {}

  // 6. Generate Dedicated GitHub Actions Workflow File (With Diagnostics Support)
  const workflowFileName = `outreach_${slug}.yml`;
  const workflowsDir = path.join(process.cwd(), '.github', 'workflows');
  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }

  const workflowPath = path.join(workflowsDir, workflowFileName);
  const workflowContent = 
`name: 🚀 Outreach Engine — [${cleanName}]
run-name: "[${cleanName}] \${{ inputs.action || github.event.client_payload.action || 'scheduled' }} (\${{ github.event_name }})"

concurrency:
  group: outreach-${slug}-\${{ inputs.action || github.event.client_payload.action || github.event_name }}
  cancel-in-progress: false

permissions:
  contents: read

on:
  repository_dispatch:
    types: [send_single_email_${slug}, ${slug}_trigger]

  workflow_dispatch:
    inputs:
      action:
        description: 'Choose task to run for [${cleanName}]'
        required: true
        default: 'inbox'
        type: choice
        options: [outreach, followup, inbox, digest, warmup, single_lead, diagnostic]
      email:
        description: 'Recipient Email (for single_lead)'
        required: false
      full_name:
        description: 'Recipient Full Name (for single_lead)'
        required: false
      company_name:
        description: 'Recipient Company Name (for single_lead)'
        required: false
      location:
        description: 'Recipient Location (for single_lead)'
        required: false

jobs:
  run-engine:
    runs-on: ubuntu-latest
    timeout-minutes: 360
    env:
      SPREADSHEET_ID: \${{ secrets.SPREADSHEET_ID_${slug.toUpperCase()} || "${spreadsheetId}" }}
      GOOGLE_SERVICE_ACCOUNT_JSON: \${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
      SELECTED_ACTION: \${{ inputs.action || github.event.inputs.action }}
      CAMPAIGN_NAME: "${cleanName}"
      CRON_API_KEY: \${{ secrets.CRON_API_KEY }}
      DISCORD_WEBHOOK_URL: \${{ secrets.DISCORD_WEBHOOK_URL }}

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js (with cache)
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci --no-audit --no-fund

      - name: Execute Diagnostics (if selected)
        if: \${{ (inputs.action || github.event.inputs.action || 'inbox') == 'diagnostic' }}
        run: node scripts/run-campaign-diagnostics.mjs --sheet-id "${spreadsheetId}"

      - name: Execute Campaign Engine [${cleanName}]
        if: \${{ (inputs.action || github.event.inputs.action || 'inbox') != 'diagnostic' }}
        run: node engine.mjs "\${{ inputs.action || 'inbox' }}"
        env:
          SINGLE_EMAIL: \${{ inputs.email || github.event.client_payload.email || '' }}
          SINGLE_FULL_NAME: \${{ inputs.full_name || github.event.client_payload.full_name || '' }}
          SINGLE_COMPANY: \${{ inputs.company_name || github.event.client_payload.company_name || '' }}
          SINGLE_LOCATION: \${{ inputs.location || github.event.client_payload.location || '' }}
          WEBHOOK_URL_OVERRIDE: \${{ github.event.client_payload.webhook_url || '' }}
`;

  fs.writeFileSync(workflowPath, workflowContent, 'utf8');
  console.log(`\n🐙 Created dedicated GitHub Actions workflow:`);
  console.log(`   📁 File: .github/workflows/${workflowFileName}`);
  console.log(`   🏷️  Name: "🚀 Outreach Engine — [${cleanName}]"`);
  console.log(`   🛑 Can be stopped / paused independently on GitHub Actions!\n`);

  // 7. Auto-Register Cron Jobs on cron-job.org if credentials exist
  const effectiveCronKey = cronApiKey || process.env.CRON_API_KEY || process.env.CRON_KEY || mainSettings.cron_api_key || mainSettings.cronjob_api_key || '';
  const effectiveGithubPat = githubPat || process.env.PAT_GITHUB || process.env.GITHUB_PAT || process.env.GH_PAT || process.env.PAT || mainSettings.github_pat || '';
  let cronResult = { registeredCount: 0, jobs: [] };

  if (effectiveCronKey && effectiveGithubPat) {
    console.log(`⏰ Automatically registering cron-job.org schedules for "[${cleanName}]"...`);
    cronResult = await registerCronJobsForCampaign({
      campaignName: cleanName,
      slug,
      cronApiKey: effectiveCronKey,
      githubPat: effectiveGithubPat,
      settings: mainSettings
    });
    if (cronResult.registeredCount > 0) {
      console.log(`✅ Registered ${cronResult.registeredCount} cron schedules on cron-job.org!`);
    }
  } else {
    console.log(`ℹ️ Cron API Key or GitHub PAT not set. Skipping automatic cron-job.org creation.`);
    console.log(`👉 To schedule automatically, you can run '⚡ Provision Cron Jobs' in GitHub Actions or add 'cron_api_key' to your Google Sheet Settings.`);
  }

  // 8. Write GitHub Actions Step Summary
  const ghSummaryMarkdown = 
`## ✨ New Campaign Provisioned: \`${cleanName}\`

| Resource | Value / Link |
| :--- | :--- |
| **📊 Google Sheet** | [Open \`[Sheet-bot] ${cleanName}\`](${spreadsheetUrl}) |
| **🆔 Spreadsheet ID** | \`${spreadsheetId}\` |
| **🔓 Permissions** | Public (Anyone with link can **Edit**) |
| **🐙 Dedicated Workflow** | [\`.github/workflows/${workflowFileName}\`](./.github/workflows/${workflowFileName}) |
| **🏷️ Run Prefix** | \`[${cleanName}]\` |
| **⏰ Automated Cron Schedules** | ${cronResult.registeredCount > 0 ? `✅ ${cronResult.registeredCount} jobs registered on cron-job.org` : 'ℹ️ Manual / On-Demand (can be provisioned anytime)'} |

### 🚀 Next Steps:
1. Open the [Google Sheet](${spreadsheetUrl}) and add your sender inboxes in the **\`Inboxes\`** tab.
2. Add your prospect leads into the **\`Details\`** tab.
3. Trigger outreach or diagnostics independently from the **Actions** tab on GitHub!
`;
  writeGitHubStepSummary(ghSummaryMarkdown);

  // 9. Send Discord Notification Alert
  const webhookUrl = discordWebhook || process.env.DISCORD_WEBHOOK_URL || mainSettings.discord_updates_webhook || '';
  if (webhookUrl && webhookUrl.startsWith('http')) {
    const embed = {
      title: `✨ New Campaign Created: [${cleanName}]`,
      color: 0x00ff88,
      description: `A brand-new Google Sheet, dedicated GitHub Actions workflow, and automated schedules have been provisioned!`,
      fields: [
        { name: '📊 Google Sheet', value: `[Open Spreadsheet](${spreadsheetUrl})`, inline: true },
        { name: '🆔 Sheet ID', value: `\`${spreadsheetId}\``, inline: true },
        { name: '🔓 Permissions', value: 'Public (Edit Access ✅)', inline: true },
        { name: '🐙 Dedicated Workflow', value: `\`${workflowFileName}\``, inline: false },
        { name: '⏰ Cron Jobs', value: cronResult.registeredCount > 0 ? `${cronResult.registeredCount} active on cron-job.org ✅` : 'On-Demand ℹ️', inline: true },
      ],
      footer: { text: 'Sheet-bot Multi-Campaign Provisioner' },
      timestamp: new Date().toISOString()
    };

    await postToDiscord(webhookUrl, `✨ **New Campaign Provisioned:** \`${cleanName}\``, [embed]);
  }

  console.log(`=============================================================`);
  console.log(`🎉 CAMPAIGN "${cleanName}" IS READY TO USE!`);
  console.log(`🔗 Sheet:    ${spreadsheetUrl}`);
  console.log(`🐙 Workflow: .github/workflows/${workflowFileName}`);
  console.log(`=============================================================\n`);

  return {
    campaignName: cleanName,
    slug,
    spreadsheetId,
    spreadsheetUrl,
    workflowFileName,
    workflowPath
  };
}

// Direct CLI Execution
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  let campaignName = process.env.CAMPAIGN_NAME || '';
  let existingSheetId = process.env.EXISTING_SHEET_ID || process.env.SPREADSHEET_ID || '';
  let userEmail = process.env.USER_EMAIL || '';
  let makePublic = process.env.MAKE_PUBLIC !== 'false';
  let cronApiKey = process.env.CRON_API_KEY || process.env.CRON_KEY || '';
  let githubPat = process.env.PAT_GITHUB || process.env.GITHUB_PAT || process.env.GH_PAT || process.env.PAT || '';
  let discordWebhook = process.env.DISCORD_WEBHOOK_URL || '';
  let skipPreflight = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      campaignName = args[++i];
    } else if ((args[i] === '--sheet-id' || args[i] === '--existing-id') && args[i + 1]) {
      existingSheetId = args[++i];
    } else if (args[i] === '--email' && args[i + 1]) {
      userEmail = args[++i];
    } else if (args[i] === '--cron-key' && args[i + 1]) {
      cronApiKey = args[++i];
    } else if (args[i] === '--pat' && args[i + 1]) {
      githubPat = args[++i];
    } else if (args[i] === '--webhook' && args[i + 1]) {
      discordWebhook = args[++i];
    } else if (args[i] === '--skip-preflight') {
      skipPreflight = true;
    } else if (args[i] === '--private') {
      makePublic = false;
    } else if (!campaignName && !args[i].startsWith('--')) {
      campaignName = args[i];
    }
  }

  if (!campaignName) {
    console.error('❌ Error: Campaign Name is required. Example: node scripts/create-new-campaign.mjs "SaaS Founders"');
    process.exit(1);
  }

  createNewCampaign({
    campaignName,
    existingSheetId,
    userEmail,
    makePublic,
    cronApiKey,
    githubPat,
    discordWebhook,
    skipPreflight
  }).catch(err => {
    console.error(`\n❌ Campaign creation failed: ${err.message}`);
    process.exit(1);
  });
}

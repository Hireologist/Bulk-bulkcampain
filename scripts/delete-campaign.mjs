import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postToDiscord, writeGitHubStepSummary } from '../src/alerts.mjs';

/**
 * 🗑️ 1-Click Campaign Deletion Utility
 * 
 * 1. Locates and deletes the dedicated workflow: `.github/workflows/outreach_<slug>.yml`
 * 2. Parses the Spreadsheet ID from the workflow file.
 * 3. Optionally trashes/deletes the Google Spreadsheet via Google Drive API.
 * 4. Optionally deletes all matching jobs from cron-job.org.
 * 5. Sends a Discord alert and writes a GitHub Step Summary.
 */

export function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'custom_campaign';
}

export function getGoogleDriveClient() {
  let auth;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  } else {
    return null;
  }

  const drive = google.drive({ version: 'v3', auth });
  return drive;
}

export function extractSpreadsheetIdFromWorkflow(workflowContent) {
  if (!workflowContent) return null;
  const match = workflowContent.match(/SPREADSHEET_ID:.*?\|\|\s*"([^"]+)"/);
  if (match && match[1]) {
    return match[1].trim();
  }
  const matchSimple = workflowContent.match(/SPREADSHEET_ID:\s*"([^"]+)"/);
  if (matchSimple && matchSimple[1]) {
    return matchSimple[1].trim();
  }
  return null;
}

export async function deleteCronJobsForCampaign(slug, campaignName, apiKey) {
  if (!apiKey) return { deletedCount: 0, errors: [] };
  const deleted = [];
  const errors = [];

  try {
    const listRes = await fetch('https://api.cron-job.org/jobs', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!listRes.ok) {
      errors.push(`Failed to fetch cron jobs: HTTP ${listRes.status}`);
      return { deletedCount: 0, errors };
    }

    const data = await listRes.json();
    const jobs = data.jobs || [];

    const targetJobs = jobs.filter(job => {
      const title = (job.title || '').toLowerCase();
      const url = (job.url || '').toLowerCase();
      const nameMatch = campaignName && title.includes(`[${campaignName.toLowerCase()}]`);
      const slugMatch = title.includes(slug) || url.includes(`outreach_${slug}.yml`);
      return nameMatch || slugMatch;
    });

    for (const job of targetJobs) {
      try {
        const delRes = await fetch(`https://api.cron-job.org/jobs/${job.jobId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
        if (delRes.ok) {
          deleted.push(job.title);
          console.log(`  🗑️ Deleted cron job: "${job.title}" (ID: ${job.jobId})`);
        } else {
          errors.push(`Could not delete job ${job.jobId}: HTTP ${delRes.status}`);
        }
      } catch (err) {
        errors.push(`Error deleting job ${job.jobId}: ${err.message}`);
      }
    }
  } catch (err) {
    errors.push(`Cron cleanup error: ${err.message}`);
  }

  return { deletedCount: deleted.length, deletedJobs: deleted, errors };
}

export async function deleteCampaign({
  campaignName,
  deleteSheet = false,
  deleteCron = true,
  cronApiKey = '',
  discordWebhook = '',
}) {
  if (!campaignName || typeof campaignName !== 'string' || !campaignName.trim()) {
    throw new Error('Campaign Name or Slug is required to delete a campaign.');
  }

  const cleanName = campaignName.trim();
  const slug = slugify(cleanName);

  console.log(`\n=============================================================`);
  console.log(`🗑️ DELETING CAMPAIGN: "${cleanName}" (Slug: ${slug})`);
  console.log(`=============================================================`);

  const workflowFileName = `outreach_${slug}.yml`;
  const workflowPath = path.join(process.cwd(), '.github', 'workflows', workflowFileName);

  let workflowDeleted = false;
  let spreadsheetId = null;

  // 1. Check and Remove Workflow File
  if (fs.existsSync(workflowPath)) {
    const workflowContent = fs.readFileSync(workflowPath, 'utf8');
    spreadsheetId = extractSpreadsheetIdFromWorkflow(workflowContent);

    fs.unlinkSync(workflowPath);
    workflowDeleted = true;
    console.log(`✅ Deleted workflow file: .github/workflows/${workflowFileName}`);
  } else {
    console.log(`⚠️ Workflow file .github/workflows/${workflowFileName} was not found (may already be deleted).`);
  }

  // 2. Trash Google Spreadsheet if requested
  let sheetTrashed = false;
  if (deleteSheet && spreadsheetId) {
    try {
      const drive = getGoogleDriveClient();
      if (drive) {
        console.log(`📄 Moving Google Spreadsheet (ID: ${spreadsheetId}) to Trash...`);
        await drive.files.update({
          fileId: spreadsheetId,
          requestBody: { trashed: true },
        });
        sheetTrashed = true;
        console.log(`✅ Google Sheet moved to Trash successfully!`);
      } else {
        console.warn(`⚠️ Google credentials missing. Could not trash sheet.`);
      }
    } catch (sheetErr) {
      console.warn(`⚠️ Failed to trash Google Sheet: ${sheetErr.message}`);
    }
  } else if (!deleteSheet && spreadsheetId) {
    console.log(`ℹ️ Google Sheet preserved (ID: ${spreadsheetId}).`);
  }

  // 3. Delete Cron-Job.org Schedules
  let cronResult = { deletedCount: 0, deletedJobs: [] };
  const effectiveCronKey = cronApiKey || process.env.CRON_API_KEY || '';
  if (deleteCron && effectiveCronKey) {
    console.log(`\n⏰ Cleaning up cron-job.org schedules for "${cleanName}"...`);
    cronResult = await deleteCronJobsForCampaign(slug, cleanName, effectiveCronKey);
  }

  // 4. GitHub Step Summary
  const summaryMarkdown = 
`## 🗑️ Campaign Deleted: \`${cleanName}\`

| Resource | Status |
| :--- | :--- |
| **🐙 Workflow File** | ${workflowDeleted ? `✅ Removed (\`.github/workflows/${workflowFileName}\`)` : '⚠️ Not Found'} |
| **📊 Google Sheet** | ${sheetTrashed ? '🗑️ Moved to Trash' : spreadsheetId ? `ℹ️ Preserved (ID: \`${spreadsheetId}\`)` : 'N/A'} |
| **⏰ Cron Jobs** | ${cronResult.deletedCount > 0 ? `✅ Deleted ${cronResult.deletedCount} job(s)` : 'ℹ️ None removed'} |

Campaign **\`${cleanName}\`** has been completely unlinked and stopped.
`;
  writeGitHubStepSummary(summaryMarkdown);

  // 5. Discord Alert
  const webhookUrl = discordWebhook || process.env.DISCORD_WEBHOOK_URL;
  if (webhookUrl && webhookUrl.startsWith('http')) {
    const embed = {
      title: `🗑️ Campaign Deleted: [${cleanName}]`,
      color: 0xff4444,
      description: `The campaign **${cleanName}** has been unlinked and its automation stopped.`,
      fields: [
        { name: '🐙 Workflow', value: workflowDeleted ? 'Deleted ✅' : 'Not found', inline: true },
        { name: '📊 Google Sheet', value: sheetTrashed ? 'Moved to Trash 🗑️' : 'Preserved ℹ️', inline: true },
        { name: '⏰ Cron Jobs Deleted', value: `${cronResult.deletedCount}`, inline: true },
      ],
      footer: { text: 'Sheet-bot Campaign Manager' },
      timestamp: new Date().toISOString(),
    };

    await postToDiscord(webhookUrl, `🗑️ **Campaign Deleted:** \`${cleanName}\``, [embed]);
  }

  console.log(`=============================================================`);
  console.log(`🎉 Campaign "${cleanName}" deleted successfully!`);
  console.log(`=============================================================\n`);

  return {
    campaignName: cleanName,
    slug,
    workflowDeleted,
    sheetTrashed,
    cronDeletedCount: cronResult.deletedCount,
  };
}

// CLI Execution
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  let campaignName = process.env.CAMPAIGN_NAME || '';
  let deleteSheet = process.env.DELETE_SHEET === 'true';
  let deleteCron = process.env.DELETE_CRON !== 'false';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      campaignName = args[++i];
    } else if (args[i] === '--delete-sheet' || args[i] === '--trash-sheet') {
      deleteSheet = true;
    } else if (args[i] === '--keep-cron') {
      deleteCron = false;
    } else if (!campaignName && !args[i].startsWith('--')) {
      campaignName = args[i];
    }
  }

  if (!campaignName) {
    console.error('❌ Error: Campaign Name is required. Example: node scripts/delete-campaign.mjs "SaaS Founders"');
    process.exit(1);
  }

  deleteCampaign({
    campaignName,
    deleteSheet,
    deleteCron,
  }).catch((err) => {
    console.error(`❌ Campaign deletion failed: ${err.message}`);
    process.exit(1);
  });
}

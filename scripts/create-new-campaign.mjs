import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPLETE_SCHEMA } from './auto-setup.mjs';
import { postToDiscord, writeGitHubStepSummary } from '../src/alerts.mjs';

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

export async function createNewCampaign({
  campaignName,
  userEmail = '',
  makePublic = true,
  timezone = 'Asia/Kolkata',
  discordWebhook = ''
}) {
  if (!campaignName || typeof campaignName !== 'string' || !campaignName.trim()) {
    throw new Error('Campaign Name is required to create a new campaign.');
  }

  const cleanName = campaignName.trim();
  const slug = slugify(cleanName);
  console.log(`\n=============================================================`);
  console.log(`🪄 CREATING NEW CAMPAIGN: "${cleanName}" (Slug: ${slug})`);
  console.log(`=============================================================`);

  const { sheets, drive } = getGoogleClient();

  // 1. Create the Google Spreadsheet
  console.log(`📄 Creating new Google Spreadsheet: "[Sheet-bot] ${cleanName}"...`);
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: `[Sheet-bot] ${cleanName}`,
      },
    },
  });

  const spreadsheetId = createRes.data.spreadsheetId;
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  console.log(`✅ Google Sheet Created successfully!`);
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

  // 4. Provision all 11 color-coded tabs & schemas
  console.log(`\n📊 Provisioning all 11 tabs, headers, formulas, and default settings...`);
  for (const [title, config] of Object.entries(COMPLETE_SCHEMA)) {
    // Add Tab
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });

    const values = [config.headers, ...(config.sampleData || [])];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${title}'!A1:${String.fromCharCode(64 + config.headers.length)}${values.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
    console.log(`  ✨ Initialized tab: "${title}"`);
  }

  // Delete default "Sheet1"
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet1 = meta.data.sheets?.find(s => s.properties.title === 'Sheet1');
    if (sheet1) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ deleteSheet: { sheetId: sheet1.properties.sheetId } }],
        },
      });
    }
  } catch (_) {}

  // 5. Generate Dedicated GitHub Actions Workflow File
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
        options: [outreach, followup, inbox, digest, warmup, single_lead]
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

      - name: Execute Campaign Engine [${cleanName}]
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

  // 6. Write GitHub Actions Step Summary
  const ghSummaryMarkdown = 
`## ✨ New Campaign Provisioned: \`${cleanName}\`

| Resource | Value / Link |
| :--- | :--- |
| **📊 Google Sheet** | [Open \`[Sheet-bot] ${cleanName}\`](${spreadsheetUrl}) |
| **🆔 Spreadsheet ID** | \`${spreadsheetId}\` |
| **🔓 Permissions** | Public (Anyone with link can **Edit**) |
| **🐙 Dedicated Workflow** | [\`.github/workflows/${workflowFileName}\`](./.github/workflows/${workflowFileName}) |
| **🏷️ Run Prefix** | \`[${cleanName}]\` |

### 🚀 Next Steps:
1. Open the [Google Sheet](${spreadsheetUrl}) and add your sender inboxes in the **\`Inboxes\`** tab.
2. Add your prospect leads into the **\`Details\`** tab.
3. Trigger outreach independently from the **Actions** tab on GitHub!
`;
  writeGitHubStepSummary(ghSummaryMarkdown);

  // 7. Send Discord Notification Alert
  const webhookUrl = discordWebhook || process.env.DISCORD_WEBHOOK_URL;
  if (webhookUrl && webhookUrl.startsWith('http')) {
    const embed = {
      title: `✨ New Campaign Created: [${cleanName}]`,
      color: 0x00ff88,
      description: `A brand-new Google Sheet and dedicated GitHub Actions workflow have been provisioned!`,
      fields: [
        { name: '📊 Google Sheet', value: `[Open Spreadsheet](${spreadsheetUrl})`, inline: true },
        { name: '🆔 Sheet ID', value: `\`${spreadsheetId}\``, inline: true },
        { name: '🔓 Permissions', value: 'Public (Edit Access ✅)', inline: true },
        { name: '🐙 Dedicated Workflow', value: `\`${workflowFileName}\``, inline: false },
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
  let userEmail = process.env.USER_EMAIL || '';
  let makePublic = process.env.MAKE_PUBLIC !== 'false';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      campaignName = args[++i];
    } else if (args[i] === '--email' && args[i + 1]) {
      userEmail = args[++i];
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
    userEmail,
    makePublic
  }).catch(err => {
    console.error(`❌ Campaign creation failed: ${err.message}`);
    process.exit(1);
  });
}

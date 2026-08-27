import readline from 'readline';
import { execSync } from 'child_process';

/**
 * 1-Click Auto-Setup Script for cron-job.org API v2
 * Dynamically auto-detects repository owner & repo name from `git remote`.
 * Automatically provisions all 4 outreach engine cron jobs on cron-job.org.
 * 
 * Usage:
 *   node setup-cron.mjs
 *   OR with env vars:
 *   CRON_KEY="your_cronjob_api_key" GITHUB_PAT="your_github_pat" node setup-cron.mjs
 */

function autoDetectGitRepo() {
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch (err) {
    // fallback if git is not initialized or remote not set
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

const JOBS_TO_CREATE = [
  {
    title: 'Followup Engine',
    action: 'followup',
    schedule: {
      timezone: 'Asia/Kolkata',
      expiresAt: 0,
      hours: [9],
      minutes: [30],
      mdays: [-1],
      wdays: [1, 2, 3, 4, 5, 6], // Mon - Sat
      months: [-1]
    }
  },
  {
    title: 'Cold Outreach',
    action: 'outreach',
    schedule: {
      timezone: 'Asia/Kolkata',
      expiresAt: 0,
      hours: [10],
      minutes: [0],
      mdays: [-1],
      wdays: [1, 2, 3, 4, 5, 6], // Mon - Sat
      months: [-1]
    }
  },
  {
    title: 'Inbox Checker',
    action: 'inbox',
    schedule: {
      timezone: 'Asia/Kolkata',
      expiresAt: 0,
      hours: [-1], // Every hour
      minutes: [0, 15, 30, 45], // Every 15 minutes
      mdays: [-1],
      wdays: [1, 2, 3, 4, 5, 6], // Mon - Sat
      months: [-1]
    }
  },
  {
    title: 'Daily Digest',
    action: 'digest',
    schedule: {
      timezone: 'Asia/Kolkata',
      expiresAt: 0,
      hours: [18], // 6 PM IST
      minutes: [30], // 6:30 PM IST
      mdays: [-1],
      wdays: [1, 2, 3, 4, 5, 6], // Mon - Sat
      months: [-1]
    }
  }
];

async function createCronJob(cronApiKey, githubPat, dispatchUrl, jobConfig, repoName) {
  const payload = {
    job: {
      url: dispatchUrl,
      title: `${repoName} - ${jobConfig.title}`,
      enabled: true,
      saveResponses: true,
      requestMethod: 1, // POST
      requestTimeout: 30,
      schedule: jobConfig.schedule,
      extendedData: {
        headers: {
          Authorization: `Bearer ${githubPat}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cron-job-org',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            action: jobConfig.action
          }
        })
      }
    }
  };

  const response = await fetch('https://api.cron-job.org/jobs', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${cronApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`cron-job.org API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.jobId;
}

async function main() {
  console.log('\n🚀 cron-job.org 1-Click Automated Setup Utility');
  console.log('--------------------------------------------------\n');

  // Auto-detect owner and repo
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
      console.error('❌ Error: GITHUB_OWNER or GITHUB_REPOSITORY env variable is required in non-interactive mode.');
      process.exit(1);
    }
    repoOwner = await prompt('👤 Enter your GitHub Username/Owner: ');
  }

  if (!repoName) {
    if (isNonInteractive) {
      console.error('❌ Error: GITHUB_REPO or GITHUB_REPOSITORY env variable is required in non-interactive mode.');
      process.exit(1);
    }
    repoName = await prompt('📦 Enter your GitHub Repository Name: ');
  }

  const WORKFLOW_FILE = 'outreach.yml';
  const dispatchUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

  console.log(`📌 Target Repository: ${repoOwner}/${repoName}`);
  console.log(`🔗 Dispatch URL: ${dispatchUrl}\n`);

  let cronApiKey = process.env.CRON_KEY || process.env.CRON_JOB_API_KEY;
  let githubPat = process.env.GITHUB_PAT || process.env.PAT;

  if (!cronApiKey) {
    if (isNonInteractive) {
      console.error('❌ Error: CRON_KEY or CRON_JOB_API_KEY environment variable / workflow input is required.');
      process.exit(1);
    }
    cronApiKey = await prompt('🔑 Enter your cron-job.org API Key (from console.cron-job.org → Settings): ');
  }

  if (!githubPat) {
    if (isNonInteractive) {
      console.error('❌ Error: GITHUB_PAT or PAT environment variable / workflow input is required.');
      process.exit(1);
    }
    githubPat = await prompt('🔑 Enter your GitHub Personal Access Token (PAT ghp_...): ');
  }

  if (!cronApiKey || !githubPat) {
    console.error('❌ Error: Both cron-job.org API Key and GitHub PAT are required.');
    process.exit(1);
  }

  console.log('\n⏳ Provisioning 4 cron jobs on cron-job.org...\n');

  for (const jobConfig of JOBS_TO_CREATE) {
    try {
      const jobId = await createCronJob(cronApiKey, githubPat, dispatchUrl, jobConfig, repoName);
      console.log(`✅ Created "${repoName} - ${jobConfig.title}" → Job ID: ${jobId}`);
    } catch (err) {
      console.error(`❌ Failed to create "${jobConfig.title}": ${err.message}`);
    }
  }

  console.log('\n🎉 Setup complete! All 4 cron jobs are active on cron-job.org.');
  console.log('Check your dashboard at https://console.cron-job.org/\n');
}

main();

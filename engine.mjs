import nodemailer from 'nodemailer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 🛡️ Core Engine Architecture Modules
export { parseSpintax } from './src/spintax.mjs';
export { verifyReputationCompliance } from './src/dns-check.mjs';
import { isAuthError, sendAuthFailureAlert } from './src/alerts.mjs';
import { runWarmupCycle } from './src/warmup.mjs';
export { isAuthError, sendAuthFailureAlert };

// 📊 Data & Sheets I/O
import {
  getSheets,
  ensureTabExists,
  loadTab,
  recordFailedSend,
  loadInboxStatsMap,
  saveInboxStatsMap,
  saveDraftViaImap,
  loadConfig,
  isValidEmailDomain
} from './src/sheets-io.mjs';
export {
  getSheets,
  ensureTabExists,
  loadTab,
  recordFailedSend,
  loadInboxStatsMap,
  saveInboxStatsMap,
  saveDraftViaImap,
  loadConfig,
  isValidEmailDomain
};

// ⏱️ Scheduler, Dates & Cutoffs
import {
  resolveCutoffConfig,
  isPastCutoff,
  shouldRestartWorkflow,
  triggerWorkflowRestart,
  notifyDiscord,
  isDailyLimitError,
  getRandomFormattedDate,
  isCampaignActive,
  applyTemplateVariables,
  formatFollowupSubject,
  normalizeDate,
  parseDueDate,
  calculateNextDueDate
} from './src/scheduler.mjs';
export {
  resolveCutoffConfig,
  isPastCutoff,
  shouldRestartWorkflow,
  triggerWorkflowRestart,
  notifyDiscord,
  isDailyLimitError,
  getRandomFormattedDate,
  isCampaignActive,
  applyTemplateVariables,
  formatFollowupSubject,
  normalizeDate,
  parseDueDate,
  calculateNextDueDate
};

// 🤖 AI Sentiment & Phone Classifier
export {
  extractPhoneNumberFallback,
  classifyEmailWithAi
} from './src/ai-classifier.mjs';

// 🚀 Workflows & Execution Runners
import { runColdOutreach } from './src/workflows/cold-outreach.mjs';
import { runSingleLeadOutreachImpl } from './src/workflows/single-lead.mjs';
import { runFollowups } from './src/workflows/followup.mjs';
import { runInboxChecker } from './src/workflows/inbox-checker.mjs';
import { generateDailyDigest } from './src/workflows/daily-digest.mjs';

export { runColdOutreach, runFollowups, runInboxChecker, generateDailyDigest };

export async function runSingleLeadOutreach(singleLeadPayload = {}) {
  return await runSingleLeadOutreachImpl(singleLeadPayload);
}

// ==========================================
// 🏁 ROUTER & MAIN ENTRY POINT
// ==========================================
async function main() {
  const task = process.argv[2];
  try {
    if (task === 'outreach') {
      await runColdOutreach();
    } else if (task === 'single_lead') {
      await runSingleLeadOutreach();
    } else if (task === 'followup') {
      await runFollowups();
    } else if (task === 'inbox') {
      await runInboxChecker();
    } else if (task === 'digest') {
      await generateDailyDigest();
    } else if (task === 'warmup') {
      const sheets = await getSheets();
      const config = await loadConfig(sheets);
      console.log('🔥 Running Peer-to-Peer Warmup Routine...');
      await runWarmupCycle(config.inboxes, async (sender, recipientEmail, subject, body) => {
        try {
          const transporter = nodemailer.createTransport({
            host: sender.smtp_host,
            port: parseInt(sender.smtp_port, 10),
            secure: parseInt(sender.smtp_port, 10) === 465,
            auth: { user: sender.smtp_user, pass: sender.smtp_pass },
          });
          await transporter.sendMail({
            from: `"${sender.display_name || sender.email}" <${sender.email}>`,
            to: recipientEmail,
            subject,
            text: body,
          });
        } catch (warmupErr) {
          if (isAuthError(warmupErr)) {
            await sendAuthFailureAlert({
              inboxEmail: sender.email,
              errorDetails: warmupErr.message,
              webhookUrl: config.settings.discord_updates_webhook,
              context: 'Peer-to-Peer Warmup Routine'
            });
          }
          throw warmupErr;
        }
      });
    } else if (task === 'diagnostic' || task === 'diagnostics') {
      const { runCampaignDiagnostics } = await import('./scripts/run-campaign-diagnostics.mjs');
      await runCampaignDiagnostics();
    } else if (task === 'domain-health' || task === 'domain_health') {
      const { runDomainHealth } = await import('./scripts/run-domain-health.mjs');
      if (typeof runDomainHealth === 'function') {
        await runDomainHealth();
      }
    } else if (task) {
      console.warn(`Unknown task: ${task}`);
    }
  } catch (err) {
    console.error(`Fatal error during task [${task}]:`, err);
    let hint = 'Check inbox credentials in the `Inboxes` tab or re-run pre-flight diagnostics.';
    if (isAuthError(err)) {
      hint = 'Google App Password authentication failed. Check credentials in the `Inboxes` tab or re-run pre-flight diagnostics.';
    } else {
      const errMsg = (err?.message || String(err || '')).toLowerCase();
      if (errMsg.includes('sheet') || errMsg.includes('tab') || errMsg.includes('spreadsheet')) {
        hint = 'Verify Google Sheet permissions and ensure required tabs exist.';
      }
    }
    const failAlertMsg = `❌ **Engine Task Failed Alert**\n**Task:** \`${task}\`\n**Error:** \`${err?.message || err || 'Unknown error'}\`\n💡 **Hint:** ${hint}`;
    try {
      const sheets = await getSheets();
      const config = await loadConfig(sheets);
      await notifyDiscord(
        config.settings.discord_updates_webhook,
        failAlertMsg
      );
    } catch (notifyErr) {
      await notifyDiscord(
        null,
        failAlertMsg
      );
    }
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main();
}

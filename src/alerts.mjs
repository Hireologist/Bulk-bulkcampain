import fs from 'node:fs';

/**
 * Discord Observability & Telemetry Alerts
 */

export async function postToDiscord(webhookUrl, content, embeds = []) {
  if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('http')) {
    return { success: false, reason: 'Invalid or missing Discord Webhook URL' };
  }

  try {
    const payload = { content };
    if (Array.isArray(embeds) && embeds.length > 0) {
      payload.embeds = embeds;
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

/**
 * Check if an error is an authentication / credential failure (Google App Password revoked / 535 / EAUTH)
 */
export function isAuthError(err) {
  if (!err) return false;
  if (err.code === 'EAUTH' || err.responseCode === 535) return true;
  const msg = (typeof err === 'string' ? err : err.message || err.toString() || '').toLowerCase();
  return (
    msg.includes('535') ||
    msg.includes('eauth') ||
    msg.includes('username and password not accepted') ||
    msg.includes('invalid login') ||
    msg.includes('invalid credentials') ||
    msg.includes('badcredentials') ||
    msg.includes('authenticate failed') ||
    msg.includes('application-specific password') ||
    msg.includes('app password') ||
    msg.includes('please log in via your web browser') ||
    msg.includes('authentication failed') ||
    msg.includes('login denied') ||
    msg.includes('command auth failed') ||
    msg.includes('auth error')
  );
}

/**
 * Write Markdown content to GitHub Actions Step Summary if running in CI/CD
 */
export function writeGitHubStepSummary(markdownText) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    fs.appendFileSync(summaryPath, `${markdownText}\n\n`, 'utf8');
  } catch (err) {
    console.warn(`[GitHub Step Summary] Could not write summary: ${err.message}`);
  }
}

/**
 * Send dedicated high-priority alert for Google App Password / SMTP Authentication failures
 */
export async function sendAuthFailureAlert({
  inboxEmail,
  errorDetails = '',
  webhookUrl,
  context = 'Outreach Execution'
}) {
  const email = inboxEmail || 'Unknown Inbox';
  const cleanError = (typeof errorDetails === 'string' ? errorDetails : errorDetails?.message || '').split('\n')[0];

  const consoleMessage = 
`\n================================================================================
🚨 CRITICAL ACTION REQUIRED: GOOGLE APP PASSWORD AUTHENTICATION FAILED
================================================================================
📬 Inbox:     ${email}
⚙️ Context:   ${context}
❌ Error:     ${cleanError}

💡 WHY THIS HAPPENED:
   Google automatically revokes and invalidates ALL 16-character App Passwords
   whenever your main Google Account password is changed or 2FA settings are updated.

👉 HOW TO RESOLVE IN 60 SECONDS:
   1. Visit Google App Passwords: https://myaccount.google.com/apppasswords
   2. Select "Mail" (or Custom: "Sheet-bot") and generate a new 16-char App Password.
   3. Open your Google Sheet -> Go to the 'Inboxes' tab.
   4. Paste the 16-character password into the 'smtp_pass' column for [${email}] (no spaces).
   5. Re-run your campaign workflow or pre-flight diagnostics.

📖 Full Documentation: docs/GOOGLE_APP_PASSWORD_SETUP.md
================================================================================\n`;

  console.error(consoleMessage);

  // Write to GitHub Step Summary if running in GitHub Actions
  const repoName = process.env.GITHUB_REPOSITORY || 'Rohanpatel16/Sheet-bot';
  const ghSummaryMarkdown = 
`## 🚨 Critical Authentication Failure on Inbox \`${email}\`

> **Reason:** Google rejected the SMTP/IMAP credentials.
> **Common Cause:** Your Google account password was recently changed, or the 16-character App Password was revoked/expired.

### 🛠️ How to Fix:
1. 🔑 **Generate New App Password:** Go to [Google App Passwords](https://myaccount.google.com/apppasswords).
2. 📋 **Update Sheet:** Open your Google Sheet, navigate to the **\`Inboxes\`** tab, and update the **\`smtp_pass\`** column for \`${email}\` (remove all spaces).
3. 📖 **Read Guide:** Check [\`docs/GOOGLE_APP_PASSWORD_SETUP.md\`](https://github.com/${repoName}/blob/main/docs/GOOGLE_APP_PASSWORD_SETUP.md) for full screenshots and troubleshooting.
`;
  writeGitHubStepSummary(ghSummaryMarkdown);

  // Send Discord Alert if webhook is configured
  if (webhookUrl && typeof webhookUrl === 'string' && webhookUrl.startsWith('http')) {
    const embed = {
      title: '🚨 Action Required: Google App Password Authentication Failed',
      color: 0xff0000,
      description: `SMTP/IMAP authentication failed for **\`${email}\`**.\nGoogle automatically revokes all App Passwords when the account password is changed.`,
      fields: [
        { name: '📬 Affected Inbox', value: `\`${email}\``, inline: true },
        { name: '⚙️ Stage / Task', value: context, inline: true },
        { name: '❌ Raw Error', value: `\`${cleanError.slice(0, 200)}\``, inline: false },
        {
          name: '🛠️ Resolution Steps',
          value: 
            '1. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)\n' +
            '2. Generate a new 16-character password\n' +
            '3. Open Google Sheet → **`Inboxes`** tab → update **`smtp_pass`**\n' +
            '4. Re-run workflow or diagnostics'
        }
      ],
      footer: { text: 'Sheet-bot Deliverability & Security Monitor' },
      timestamp: new Date().toISOString()
    };

    await postToDiscord(webhookUrl, `🚨 **Google App Password Auth Failure on \`${email}\`** - Action Required!`, [embed]);
  }

  return { success: true, email };
}

/**
 * Check inbox metrics and alert if bounce/complaint rate exceeds safe thresholds
 */
export async function alertIfUnhealthy(inboxStats = {}, webhookUrl) {
  if (!webhookUrl) return null;

  const email = inboxStats.email || inboxStats.inbox_email || 'Unknown Inbox';
  const sent = Math.max(Number(inboxStats.sent) || 0, 1);
  const bounced = Number(inboxStats.bounced) || 0;
  const complaints = Number(inboxStats.complaints) || 0;

  const bounceRate = bounced / sent;
  const complaintRate = complaints / sent;

  if (complaintRate > 0.003) {
    const msg = `🚨 **High Spam Complaint Alert**: Inbox \`${email}\` has a complaint rate of **${(complaintRate * 100).toFixed(2)}%** (${complaints}/${sent}). Sending throttled!`;
    await postToDiscord(webhookUrl, msg);
    return 'complaint_alert_sent';
  }

  if (bounceRate > 0.05) {
    const msg = `⚠️ **Deliverability Warning**: Inbox \`${email}\` has a bounce rate of **${(bounceRate * 100).toFixed(1)}%** (${bounced}/${sent}). Check your lead verification.`;
    await postToDiscord(webhookUrl, msg);
    return 'bounce_alert_sent';
  }

  return 'healthy';
}

/**
 * Send run digest summary to Discord
 */
export async function sendRunSummaryAlert(summary = {}, webhookUrl) {
  if (!webhookUrl) return;

  const embed = {
    title: '📊 Sheet-bot Execution Digest',
    color: summary.errors > 0 ? 0xff4d4d : 0x00cc88,
    fields: [
      { name: 'Processed Leads', value: String(summary.processed || 0), inline: true },
      { name: 'Sent Successfully', value: String(summary.sent || 0), inline: true },
      { name: 'Replies Detected', value: String(summary.replies || 0), inline: true },
      { name: 'Drafts Created', value: String(summary.drafts || 0), inline: true },
      { name: 'Failed Sends', value: String(summary.failed || 0), inline: true },
      { name: 'Duration', value: `${summary.durationSeconds || 0}s`, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };

  await postToDiscord(webhookUrl, `Run completed at ${new Date().toLocaleTimeString()}`, [embed]);
}

/**
 * Send alert when cron-job.org schedule is updated/auto-synchronized
 */
export async function sendCronSyncAlert({
  jobTitle,
  timezone,
  hours = [],
  minutes = [],
  webhookUrl,
  context = 'Google Sheet Settings Synchronization'
}) {
  if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('http')) {
    return { success: false, reason: 'No valid webhook URL' };
  }

  const hourStr = hours.map(h => String(h).padStart(2, '0')).join(', ') || '00';
  const minStr = minutes.map(m => String(m).padStart(2, '0')).join(', ') || '00';

  const embed = {
    title: '⏱️ Cron Job Schedule Auto-Synchronized',
    color: 0x3498db,
    description: `The schedule for **\`${jobTitle}\`** was automatically updated to match your Google Sheet **\`Settings\`** tab.`,
    fields: [
      { name: '📌 Job Title', value: `\`${jobTitle}\``, inline: true },
      { name: '🌐 Timezone', value: `\`${timezone || 'Asia/Kolkata'}\``, inline: true },
      { name: '⏰ New Trigger Time', value: `\`${hourStr}:${minStr}\``, inline: true },
      { name: '⚙️ Source', value: context, inline: false },
    ],
    footer: { text: 'Sheet-bot Cron Auto-Synchronizer' },
    timestamp: new Date().toISOString()
  };

  await postToDiscord(webhookUrl, `⏱️ **Cron Schedule Auto-Updated**: \`${jobTitle}\` synced with Google Sheet!`, [embed]);
  return { success: true, jobTitle };
}


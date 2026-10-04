import nodemailer from 'nodemailer';
import { 
  getSheets, 
  loadConfig, 
  loadTab, 
  recordFailedSend, 
  loadInboxStatsMap, 
  saveInboxStatsMap, 
  saveDraftViaImap, 
  isValidEmailDomain 
} from '../sheets-io.mjs';
import { 
  resolveCutoffConfig, 
  isPastCutoff, 
  shouldRestartWorkflow, 
  triggerWorkflowRestart, 
  notifyDiscord, 
  isDailyLimitError, 
  isCampaignActive, 
  applyTemplateVariables 
} from '../scheduler.mjs';
import { getSendDelay, trackOutcome } from '../throttle.mjs';
import { sendWithRetry } from '../retry.mjs';
import { isSuppressed, buildSenderFooter } from '../suppression.mjs';
import { alertIfUnhealthy, isAuthError, sendAuthFailureAlert, getRepoSlug } from '../alerts.mjs';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || process.env.SHEET_ID;

// ============================================================================
// 🚀 1. COLD OUTREACH SENDER
// ============================================================================
export async function runColdOutreach() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);

  // ⏸️ Master Campaign Toggle Check
  if (!isCampaignActive(config.settings, 'outreach')) {
    const pauseMsg = '⏸️ **Campaign Paused Notice:** Cold outreach is turned OFF/PAUSED in Google Sheet Settings (`campaign_active = FALSE`). Skipping run safely.';
    console.log(pauseMsg);
    await notifyDiscord(config.settings.discord_updates_webhook, pauseMsg);
    return;
  }

  if (!config.inboxes.length) throw new Error('No active Inboxes configured in "Inboxes" tab.');
  if (!config.coldTemplates.length) throw new Error('No Templates found in "Templates" tab.');
  const detailsRes = await sendWithRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
    range: "'Details'!A:Z",
  }), { retries: 2 });

  const values = detailsRes?.data?.values || [];
  const headers = values[0] || [];
  const rows = values.slice(1);
  const col = Object.fromEntries(headers.map((h, i) => [String(h || '').trim(), i]));

  const queuedLeadsCount = rows.filter(r => {
    const e = (r[col['email']] || '').trim();
    const s = (r[col['Sent Status']] || '').trim().toLowerCase();
    return e && !['sent', 'replied', 'bounced', 'suppressed', 'draft — pending review'].includes(s);
  }).length;

  const startMsg = `🚀 **Auto cold outreach started**\n📬 **Inboxes:** ${config.inboxes.length} active | 📨 **Leads queued:** ${queuedLeadsCount}`;
  await notifyDiscord(config.settings.discord_updates_webhook, startMsg);

  const inboxStatsMap = await loadInboxStatsMap(sheets);
  const inboxUsage = Object.fromEntries(config.inboxes.map(i => [i.email, 0]));
  const sentPerInbox = Object.fromEntries(config.inboxes.map(i => [i.email, 0]));
  const draftsPerInbox = Object.fromEntries(config.inboxes.map(i => [i.email, 0]));
  const limitExceededInboxes = new Set();
  let inboxIdx = 0;
  let emailsSentThisRun = 0;
  let draftsSavedThisRun = 0;
  const MAX_PER_RUN = parseInt(config.settings.max_emails_per_run || '1000', 10);
  const isReviewMode = (config.settings.send_mode || '').trim().toLowerCase() === 'review';
  const runStartTime = Date.now();
  const maxRuntimeMs = parseInt(config.settings.max_runtime_minutes || '315', 10) * 60 * 1000;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = (row[col['email']] || '').trim();
    const status = (row[col['Sent Status']] || '').trim().toLowerCase();

    // Skip if already sent, replied, bounced, or empty email
    if (!email || status === 'sent' || status === 'replied' || status === 'bounced' || status === 'suppressed' || status === 'draft — pending review') {
      continue;
    }

    // 🛡️ Global Suppression Check
    const suppressed = await isSuppressed(email, async () => {
      const suppRows = await loadTab(sheets, 'Suppressed');
      return suppRows.map(r => r.email || r.Email);
    });

    if (suppressed) {
      console.log(`⛔ Suppressed email skipped: ${email}`);
      const rowNum = i + 2;
      row[col['Sent Status']] = 'suppressed';
      row[col['Follow up']] = 'Done';
      row[col['Next Follow Up Date']] = 'SUPPRESSED';
      row[col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

      await sendWithRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      }));
      continue;
    }

    // 🛡️ PRE-SEND DOMAIN & MX CHECK (Catches dead emails for free)
    const isDomainValid = await isValidEmailDomain(email);
    if (!isDomainValid) {
      console.log(`⚠️ Invalid domain/email detected: ${email}. Skipping to protect sender reputation.`);
      
      const rowNum = i + 2;
      row[col['Sent Status']] = 'bounced';
      row[col['Follow up']] = 'Done';
      row[col['Next Follow Up Date']] = 'INVALID DOMAIN';
      row[col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

      await sendWithRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      }));

      continue;
    }

    // Stop once this trigger completes its batch limit
    if (emailsSentThisRun >= MAX_PER_RUN) {
      console.log(`✅ Completed batch of ${MAX_PER_RUN} emails for this run. Stopping.`);
      break;
    }

    // Dynamic cutoff time check & 6-Hour Runner Chaining Guard
    const cutoffConfig = resolveCutoffConfig(config.settings);
    const isCutoff = isPastCutoff(cutoffConfig.hour, cutoffConfig.minute, cutoffConfig.timezone);
    const elapsedMs = Date.now() - runStartTime;
    const remainingLeads = rows.slice(i).filter(r => {
      const e = (r[col['email']] || '').trim();
      const s = (r[col['Sent Status']] || '').trim().toLowerCase();
      return e && !['sent', 'replied', 'bounced', 'suppressed', 'draft — pending review'].includes(s);
    }).length;
    const allInboxesExhausted = limitExceededInboxes.size >= config.inboxes.length;

    const runtimeDecision = shouldRestartWorkflow({
      elapsedMs,
      maxRuntimeMs,
      isCutoff,
      remainingLeads,
      allInboxesExhausted,
      cutoffLabel: cutoffConfig.formattedTime
    });

    if (runtimeDecision.shouldStop) {
      console.log(`⏹️ Cold outreach stopping: ${runtimeDecision.reason}`);
      if (runtimeDecision.shouldRestart) {
        const pat = config.settings.github_pat;
        const alertMsg = `⏳ **Runner Limit Threshold (5h 15m) Reached**\n`
          + `📊 **Status:** Still before ${cutoffConfig.formattedTime} cutoff.\n`
          + `📨 **Remaining Leads:** \`${remainingLeads}\`\n`
          + `🔄 **Action:** Spawning a fresh runner to continue sending without interruption...`;
        console.log(alertMsg);
        await notifyDiscord(config.settings.discord_updates_webhook, alertMsg);
        await triggerWorkflowRestart('outreach', process.env.GITHUB_REPOSITORY, pat);
      }
      break;
    }

    // Find inbox under daily limit
    let inbox = null;
    for (let attempt = 0; attempt < config.inboxes.length; attempt++) {
      const candidate = config.inboxes[inboxIdx];
      inboxIdx = (inboxIdx + 1) % config.inboxes.length;
      if (!limitExceededInboxes.has(candidate.email) && inboxUsage[candidate.email] < parseInt(candidate.daily_limit || '50', 10)) {
        inbox = candidate;
        break;
      }
    }
    if (!inbox) {
      const stopMsg = limitExceededInboxes.size > 0
        ? `🛑 **Outreach Stopped:** All active inboxes have hit daily sending limits / quotas (${limitExceededInboxes.size} rate-limited).`
        : '🛑 All inboxes have reached their daily limit for today.';
      console.log(stopMsg);
      await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
      break;
    }

    // 🎯 Pick alias mapped to this inbox or matching domain
    let senderEmail = inbox.email;
    let senderName = inbox.display_name || 'Team';
    if (config.aliases.length > 0) {
      const inboxDomain = (inbox.email.split('@')[1] || '').toLowerCase();
      
      // Filter aliases assigned to this inbox or matching domain
      const eligibleAliases = config.aliases.filter(a => {
        const assignedInbox = (a.inbox_email || '').trim().toLowerCase();
        if (assignedInbox) {
          return assignedInbox === inbox.email.toLowerCase();
        }
        const aliasDomain = (a.alias_email.split('@')[1] || '').toLowerCase();
        return aliasDomain && aliasDomain === inboxDomain;
      });

      if (eligibleAliases.length > 0) {
        const chosenAlias = eligibleAliases[Math.floor(Math.random() * eligibleAliases.length)];
        senderEmail = chosenAlias.alias_email;
        senderName = chosenAlias.display_name || chosenAlias.name || chosenAlias.sender_name || chosenAlias.alias_email.split('@')[0];
      }
    }

    // Personalization
    const template = config.coldTemplates[Math.floor(Math.random() * config.coldTemplates.length)];
    const fullName = (row[col['full_name']] || 'there').trim();
    const companyName = (row[col['company_name']] || 'your company').trim();
    const location = (row[col['location']] || 'your city').trim();

    const randomLocs = config.locations.filter(l => l.toLowerCase() !== location.toLowerCase())
      .sort(() => 0.5 - Math.random()).slice(0, 4).join(', ');
    const clientStr = config.clients.sort(() => 0.5 - Math.random()).slice(0, 5)
      .map(c => c.client_name || c.name).join(', ');

    const replaceTags = (txt = '') => applyTemplateVariables(txt, {
      fullName,
      companyName,
      location,
      randomLocs,
      clientStr,
      senderName,
      senderEmail,
      businessName: config.settings.business_name,
      businessAddress: config.settings.business_address
    });

    const subject = replaceTags(template.Subject || template['Subject line']);
    let body = replaceTags(template.Body || template.body);

    // Auto-inject CAN-SPAM legal footer with signed unsubscribe token
    const footer = buildSenderFooter(config.settings, { email, campaign: 'cold', senderEmail }, process.env.UNSUBSCRIBE_SECRET);
    body = `${body}${footer}`;

    let currentInboxStats = inboxStatsMap.get(inbox.email.toLowerCase()) || { sent: 0, bounced: 0, complaints: 0, sentToday: 0 };

    if (isReviewMode) {
      // 📝 DRAFT-REVIEW MODE (Save touch 1 directly into IMAP Drafts)
      try {
        await saveDraftViaImap(inbox, email, subject, body);
        draftsSavedThisRun++;
        draftsPerInbox[inbox.email] = (draftsPerInbox[inbox.email] || 0) + 1;
        const rowNum = i + 2;
        row[col['Subject Line']] = subject;
        row[col['Sent From']] = senderEmail;
        row[col['Sent Status']] = 'Draft — Pending Review';
        row[col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
        row[col['Date Sent']] = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

        await sendWithRetry(() => sheets.spreadsheets.values.update({
          spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
          range: `'Details'!A${rowNum}:Z${rowNum}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        }));
      } catch (draftErr) {
        console.error(`Failed to save draft for ${email}:`, draftErr.message);
        await recordFailedSend(sheets, email, 'cold', `Draft error: ${draftErr.message}`);
      }
      continue;
    }

    // 🚀 LIVE SEND WITH EXPONENTIAL RETRY WRAPPER
    const transporter = nodemailer.createTransport({
      host: inbox.smtp_host,
      port: parseInt(inbox.smtp_port, 10),
      secure: parseInt(inbox.smtp_port, 10) === 465,
      auth: { user: inbox.smtp_user, pass: inbox.smtp_pass },
    });

    try {
      await sendWithRetry(() => transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to: email,
        subject,
        html: body,
      }), { retries: 3, baseDelay: 2000 });

      inboxUsage[inbox.email]++;
      sentPerInbox[inbox.email] = (sentPerInbox[inbox.email] || 0) + 1;
      emailsSentThisRun++;
      currentInboxStats = trackOutcome(currentInboxStats, 'sent');
      inboxStatsMap.set(inbox.email.toLowerCase(), currentInboxStats);

      console.log(`[Sent] "${senderName}" <${senderEmail}> -> ${email}`);

      // Update row in sheet
      const rowNum = i + 2;
      row[col['Subject Line']] = subject;
      row[col['Sent From']] = senderEmail;
      row[col['Sent Status']] = 'SENT';
      row[col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
      row[col['Date Sent']] = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
      row[col['Follow Up Count']] = 0;
      row[col['Follow up']] = '';

      await sendWithRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      }));
    } catch (err) {
      console.error(`Failed to send to ${email}:`, err.message);
      await recordFailedSend(sheets, email, 'cold', err.message);

      if (isAuthError(err)) {
        console.error(`🚨 Authentication failed for inbox [${inbox.email}]: ${err.message}`);
        limitExceededInboxes.add(inbox.email);
        inboxUsage[inbox.email] = Infinity;

        await sendAuthFailureAlert({
          inboxEmail: inbox.email,
          errorDetails: err.message,
          webhookUrl: config.settings.discord_updates_webhook,
          context: 'Cold Outreach Live Send'
        });

        const hasAvailableInboxes = config.inboxes.some(
          i => !limitExceededInboxes.has(i.email) && inboxUsage[i.email] < parseInt(i.daily_limit || '50', 10)
        );
        if (!hasAvailableInboxes) {
          const stopMsg = `🛑 **Outreach Terminated Immediately:** Active inboxes failed authentication (Google App Password invalid or revoked). Workflow stopped.`;
          console.error(stopMsg);
          await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
          throw new Error(`Google App Password authentication failed for [${inbox.email}]. Workflow halted. Update smtp_pass in Inboxes tab.`);
        }
      } else if (isDailyLimitError(err)) {
        console.warn(`⚠️ Daily sending limit hit for inbox [${inbox.email}]. Disabling inbox for this run.`);
        limitExceededInboxes.add(inbox.email);
        inboxUsage[inbox.email] = Infinity;

        const alertMsg = `⚠️ **Daily User Sending Limit Exceeded Alert**\n` +
          `**Inbox:** \`${inbox.email}\`\n` +
          `**Failed Recipient:** \`${email}\`\n` +
          `**Error:** \`${err.message.split('\n')[0]}\`\n` +
          `ℹ️ Disabling \`${inbox.email}\` for the rest of this run.`;

        await notifyDiscord(config.settings.discord_updates_webhook, alertMsg);

        const hasAvailableInboxes = config.inboxes.some(
          i => !limitExceededInboxes.has(i.email) && inboxUsage[i.email] < parseInt(i.daily_limit || '50', 10)
        );
        if (!hasAvailableInboxes) {
          const stopMsg = `🛑 **Outreach Terminated**\nAll active inboxes hit daily sending limits / quotas. Outreach run stopped safely.`;
          console.log(stopMsg);
          await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
          break;
        }
      }
    }

    // Check deliverability alert for inbox
    await alertIfUnhealthy(currentInboxStats, config.settings.discord_updates_webhook);

    // Calculate delay between sends (supports 'adaptive' safe mode vs 'bulk' / 'fixed' high-speed mode)
    const throttleMode = String(config.settings.throttle_mode || 'adaptive').toLowerCase();
    const isBulkMode = throttleMode === 'bulk' || throttleMode === 'fixed' || throttleMode === 'turbo';

    const minD = Math.max(0, parseInt(config.settings.min_delay_seconds || (isBulkMode ? '1' : '15'), 10) * 1000);
    const maxD = Math.max(minD, parseInt(config.settings.max_delay_seconds || (isBulkMode ? '3' : '45'), 10) * 1000);
    const configDelay = Math.floor(Math.random() * (maxD - minD + 1)) + minD;
    const adaptiveDelay = isBulkMode ? 0 : getSendDelay(currentInboxStats);
    const delay = isBulkMode ? configDelay : Math.max(configDelay, adaptiveDelay);

    await new Promise(r => setTimeout(r, delay));
  }

  // Persist updated stats
  await saveInboxStatsMap(sheets, inboxStatsMap);

  const repoSlug = getRepoSlug();
  const durationSec = Math.max(1, Math.round((Date.now() - runStartTime) / 1000));
  const durationStr = durationSec >= 60
    ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
    : `${durationSec}s`;

  let completionMsg = '';
  if (isReviewMode) {
    const usedInboxes = config.inboxes.filter(i => (draftsPerInbox[i.email] || 0) > 0);
    const inboxesRatio = `${usedInboxes.length}/${config.inboxes.length}`;
    let inboxDetails = '';
    if (usedInboxes.length > 0) {
      const displayList = usedInboxes.slice(0, 15);
      inboxDetails = displayList.map(i => `• \`${i.email}\`: ${draftsPerInbox[i.email]} draft(s)`).join('\n');
      if (usedInboxes.length > 15) {
        inboxDetails += `\n• ...and ${usedInboxes.length - 15} more inbox(es)`;
      }
    } else {
      inboxDetails = `• ${config.inboxes.slice(0, 5).map(i => `\`${i.email}\``).join(', ')}${config.inboxes.length > 5 ? ` (+${config.inboxes.length - 5} more)` : ''} (0 drafts)`;
    }

    completionMsg = `🏁 **Cold outreach review run completed**\n`
      + `📦 **Repo:** \`${repoSlug}\`\n`
      + `📝 **Drafts saved:** ${draftsSavedThisRun} | ⏱️ **Duration:** ${durationStr} | 📬 **Inboxes used:** ${inboxesRatio}\n`
      + `📬 **Inbox breakdown:**\n${inboxDetails}`;
  } else {
    const usedInboxes = config.inboxes.filter(i => (sentPerInbox[i.email] || 0) > 0);
    const inboxesRatio = `${usedInboxes.length}/${config.inboxes.length}`;
    let inboxDetails = '';
    if (usedInboxes.length > 0) {
      const displayList = usedInboxes.slice(0, 15);
      inboxDetails = displayList.map(i => `• \`${i.email}\`: ${sentPerInbox[i.email]} sent`).join('\n');
      if (usedInboxes.length > 15) {
        inboxDetails += `\n• ...and ${usedInboxes.length - 15} more inbox(es)`;
      }
    } else {
      inboxDetails = `• ${config.inboxes.slice(0, 5).map(i => `\`${i.email}\``).join(', ')}${config.inboxes.length > 5 ? ` (+${config.inboxes.length - 5} more)` : ''} (0 sent)`;
    }

    completionMsg = `🏁 **Cold outreach run completed**\n`
      + `📦 **Repo:** \`${repoSlug}\`\n`
      + `📨 **Sent:** ${emailsSentThisRun} | ⏱️ **Duration:** ${durationStr} | 📬 **Inboxes used:** ${inboxesRatio}\n`
      + `📬 **Inbox breakdown:**\n${inboxDetails}`;
  }
  await notifyDiscord(config.settings.discord_updates_webhook, completionMsg);
}

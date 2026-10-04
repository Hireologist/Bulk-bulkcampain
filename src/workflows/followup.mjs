import nodemailer from 'nodemailer';
import { 
  getSheets, 
  loadConfig, 
  loadTab, 
  recordFailedSend, 
  loadInboxStatsMap, 
  saveInboxStatsMap 
} from '../sheets-io.mjs';
import { 
  resolveCutoffConfig, 
  isPastCutoff, 
  shouldRestartWorkflow, 
  triggerWorkflowRestart, 
  notifyDiscord, 
  isDailyLimitError, 
  isCampaignActive, 
  applyTemplateVariables, 
  formatFollowupSubject, 
  calculateNextDueDate, 
  parseDueDate 
} from '../scheduler.mjs';
import { getSendDelay, trackOutcome } from '../throttle.mjs';
import { sendWithRetry } from '../retry.mjs';
import { isSuppressed, buildSenderFooter } from '../suppression.mjs';
import { isAuthError, sendAuthFailureAlert } from '../alerts.mjs';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || process.env.SHEET_ID;

// ============================================================================
// 🔁 2. FOLLOW-UP ENGINE (Guaranteed to match initial sender & alias)
// ============================================================================
export async function runFollowups(sheetsObj = null, customConfig = null, customTransporter = null) {
  const sheets = sheetsObj || (await getSheets());
  const config = customConfig || (await loadConfig(sheets));

  // ⏸️ Master Campaign Toggle Check
  if (!isCampaignActive(config.settings, 'followup')) {
    const pauseMsg = '⏸️ **Campaign Paused Notice:** Follow-up engine is turned OFF/PAUSED in Google Sheet Settings (`campaign_active = FALSE`). Skipping run safely.';
    console.log(pauseMsg);
    await notifyDiscord(config.settings.discord_updates_webhook, pauseMsg);
    return { success: true, message: pauseMsg, count: 0 };
  }

  if (!config.inboxes || !config.inboxes.length) {
    const noInboxesMsg = 'ℹ️ No active inboxes found. Skipping follow-ups safely.';
    console.log(noInboxesMsg);
    return { success: true, message: noInboxesMsg, count: 0 };
  }
  if (!config.followupTemplates || !config.followupTemplates.length) {
    const noTemplatesMsg = 'ℹ️ No Follow-up Templates found in "Followup_Templates" tab. Skipping follow-ups safely.';
    console.log(noTemplatesMsg);
    return { success: true, message: noTemplatesMsg, count: 0 };
  }

  const detailsRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID, range: "'Details'!A:Z" });
  const [headers, ...rows] = detailsRes?.data?.values || [];
  if (!headers || !headers.length || !rows.length) {
    const noRowsMsg = 'ℹ️ No leads found in Details sheet. Skipping follow-ups safely.';
    console.log(noRowsMsg);
    return { success: true, message: noRowsMsg, count: 0 };
  }
  const col = Object.fromEntries(headers.map((h, i) => [(h || '').trim(), i]));
  const limitExceededInboxes = new Set();
  const inboxStatsMap = await loadInboxStatsMap(sheets);
  let emailsSentThisRun = 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const runStartTime = Date.now();
  const maxRuntimeMs = parseInt(config.settings.max_runtime_minutes || '315', 10) * 60 * 1000;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = (row[col['email']] || '').trim();
    const subjectLine = row[col['Subject Line']];
    const sentStatus = (row[col['Sent Status']] || '').trim().toLowerCase();
    const followUpStatus = (row[col['Follow up']] || '').trim().toLowerCase();
    const currentCount = parseInt(row[col['Follow Up Count']] || '0', 10);
    const nextDueDateStr = row[col['Next Follow Up Date']];
    const originalSenderEmail = (row[col['Sent From']] || '').trim();

    if (
      !email ||
      sentStatus !== 'sent' ||
      followUpStatus === 'done' ||
      !subjectLine
    ) {
      continue;
    }

    // 🛡️ Global Suppression Check for Follow-ups
    const suppressed = await isSuppressed(email, async () => {
      const suppRows = await loadTab(sheets, 'Suppressed');
      return suppRows.map(r => r.email || r.Email);
    });

    if (suppressed) {
      console.log(`⛔ Suppressed email skipped during follow-up: ${email}`);
      const rowNum = i + 2;
      row[col['Sent Status']] = 'suppressed';
      row[col['Follow up']] = 'Done';
      if (col['Next Follow Up Date'] !== undefined) {
        row[col['Next Follow Up Date']] = 'SUPPRESSED';
      }
      await sendWithRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      }));
      continue;
    }

    // Dynamic cutoff time check & 6-Hour Runner Chaining Guard
    const cutoffConfig = resolveCutoffConfig(config.settings);
    const isCutoff = isPastCutoff(cutoffConfig.hour, cutoffConfig.minute, cutoffConfig.timezone);
    const elapsedMs = Date.now() - runStartTime;
    const remainingLeads = rows.slice(i).filter(r => {
      const e = (r[col['email']] || '').trim();
      const s = (r[col['Sent Status']] || '').trim().toLowerCase();
      const f = (r[col['Follow up']] || '').trim().toLowerCase();
      const subj = r[col['Subject Line']];
      return e && s === 'sent' && f !== 'done' && subj;
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
      console.log(`⏹️ Follow-up engine stopping: ${runtimeDecision.reason}`);
      if (runtimeDecision.shouldRestart) {
        const pat = config.settings.github_pat;
        const alertMsg = `⏳ **Follow-up Runner Threshold (5h 15m) Reached**\n`
          + `📊 **Status:** Still before ${cutoffConfig.formattedTime} cutoff.\n`
          + `📨 **Remaining Leads:** \`${remainingLeads}\`\n`
          + `🔄 **Action:** Spawning a fresh runner to continue follow-ups without interruption...`;
        console.log(alertMsg);
        await notifyDiscord(config.settings.discord_updates_webhook, alertMsg);
        await triggerWorkflowRestart('followup', process.env.GITHUB_REPOSITORY, pat);
      }
      break;
    }

    let dueDate = null;
    if (nextDueDateStr) {
      dueDate = parseDueDate(nextDueDateStr);
    } else if (col['Date Sent'] !== undefined && row[col['Date Sent']]) {
      // Defensive fallback for legacy/unpopulated leads: calculate due date from Date Sent + Days_Until_Next
      const sentDate = parseDueDate(row[col['Date Sent']]);
      if (sentDate) {
        const templateForDelay = config.followupTemplates.find(t => parseInt(t['Follow_Up_Number'], 10) === currentCount + 1) || config.followupTemplates[0];
        const delayDays = parseInt(templateForDelay?.Days_Until_Next || '3', 10);
        const calcDateStr = calculateNextDueDate(sentDate, delayDays);
        dueDate = parseDueDate(calcDateStr);
      }
    }

    if (dueDate && today < dueDate) continue;

    const nextCount = currentCount + 1;
    if (config.followupTemplates.length > 0 && nextCount > config.followupTemplates.length) {
      const rowNum = i + 2;
      row[col['Follow up']] = 'Done';
      await sendWithRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      }), { retries: 2 });
      continue;
    }

    const template = config.followupTemplates.find(t => parseInt(t['Follow_Up_Number'], 10) === nextCount) ||
                     config.followupTemplates[0];

    // 🎯 1. MATCH EXACT ALIAS & DISPLAY NAME
    const matchedAlias = config.aliases.find(a => a.alias_email.toLowerCase() === originalSenderEmail.toLowerCase());
    const senderName = matchedAlias 
      ? (matchedAlias.display_name || matchedAlias.name || matchedAlias.sender_name || matchedAlias.alias_email.split('@')[0]) 
      : (originalSenderEmail.split('@')[0] || 'Team');
    const senderEmail = originalSenderEmail || config.inboxes[0].email;

    // 🎯 2. MATCH INBOX CREDENTIALS FOR THIS SENDER (Exact Mailbox, Assigned Inbox, or Same Domain)
    let inboxToUse = config.inboxes.find(i => i.email.toLowerCase() === originalSenderEmail.toLowerCase());
    if (!inboxToUse && matchedAlias && matchedAlias.inbox_email) {
      inboxToUse = config.inboxes.find(i => i.email.toLowerCase() === matchedAlias.inbox_email.trim().toLowerCase());
    }
    if (!inboxToUse && originalSenderEmail.includes('@')) {
      const senderDomain = originalSenderEmail.split('@')[1].toLowerCase();
      inboxToUse = config.inboxes.find(i => (i.email.split('@')[1] || '').toLowerCase() === senderDomain);
    }
    if (!inboxToUse) inboxToUse = config.inboxes[0];

    if (limitExceededInboxes.has(inboxToUse.email)) {
      inboxToUse = config.inboxes.find(i => !limitExceededInboxes.has(i.email));
    }

    if (!inboxToUse) {
      const stopMsg = `🛑 **Follow-ups Terminated:** All active inboxes have hit daily sending limits / quotas.`;
      console.log(stopMsg);
      await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
      break;
    }

    let currentInboxStats = inboxStatsMap.get(inboxToUse.email.toLowerCase()) || { sent: 0, bounced: 0, complaints: 0, sentToday: 0 };

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
      followUpNumber: nextCount,
      senderName,
      senderEmail,
      businessName: config.settings.business_name,
      businessAddress: config.settings.business_address
    });

    const finalSubj = formatFollowupSubject(replaceTags(template.Subject || 'Re:'), subjectLine);
    let finalBody = replaceTags(template.Body || template.body);
    const footer = buildSenderFooter(config.settings, { email, campaign: 'followup', senderEmail }, process.env.UNSUBSCRIBE_SECRET);
    finalBody = `${finalBody}${footer}`;

    const transporter = customConfig?.transporter || customTransporter || nodemailer.createTransport({
      host: inboxToUse.smtp_host,
      port: parseInt(inboxToUse.smtp_port, 10),
      secure: parseInt(inboxToUse.smtp_port, 10) === 465,
      auth: { user: inboxToUse.smtp_user, pass: inboxToUse.smtp_pass },
    });

    try {
      await sendWithRetry(() => transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to: email,
        subject: finalSubj,
        html: finalBody,
      }), { retries: 3, baseDelay: 2000 });

      emailsSentThisRun++;
      currentInboxStats = trackOutcome(currentInboxStats, 'sent');
      inboxStatsMap.set(inboxToUse.email.toLowerCase(), currentInboxStats);

      row[col['Date Sent']] = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
      if (col['Time'] !== undefined) {
        row[col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
      }

      const daysUntilNext = parseInt(template.Days_Until_Next || '3', 10);
      const nextDateStr = calculateNextDueDate(new Date(), daysUntilNext);

      const rowNum = i + 2;
      row[col['Follow Up Count']] = nextCount;
      row[col['Next Follow Up Date']] = nextDateStr;
      if (nextCount >= config.followupTemplates.length) {
        row[col['Follow up']] = 'Done';
      }

      await sendWithRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      }), { retries: 2 });
    } catch (e) {
      console.error(`Follow-up failed for ${email}:`, e.message);
      await recordFailedSend(sheets, email, `followup_${nextCount}`, e.message);

      if (isAuthError(e)) {
        console.error(`🚨 Follow-up authentication failed for inbox [${inboxToUse.email}]: ${e.message}`);
        limitExceededInboxes.add(inboxToUse.email);

        await sendAuthFailureAlert({
          inboxEmail: inboxToUse.email,
          errorDetails: e.message,
          webhookUrl: config.settings.discord_updates_webhook,
          context: `Follow-up Sequence (Touch #${nextCount})`
        });

        if (config.inboxes.every(i => limitExceededInboxes.has(i.email))) {
          const stopMsg = `🛑 **Follow-ups Terminated Immediately:** Active inboxes failed authentication (Google App Password invalid or revoked). Workflow stopped.`;
          console.error(stopMsg);
          await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
          throw new Error(`Google App Password authentication failed for [${inboxToUse.email}]. Workflow halted. Update smtp_pass in Inboxes tab.`);
        }
      } else if (isDailyLimitError(e)) {
        console.warn(`⚠️ Daily sending limit hit for inbox [${inboxToUse.email}]. Disabling inbox for follow-ups.`);
        limitExceededInboxes.add(inboxToUse.email);

        const alertMsg = `⚠️ **Daily User Sending Limit Exceeded Alert (Follow-up)**\n` +
          `**Inbox:** \`${inboxToUse.email}\`\n` +
          `**Failed Recipient:** \`${email}\`\n` +
          `**Error:** \`${e.message.split('\n')[0]}\`\n` +
          `ℹ️ Disabling \`${inboxToUse.email}\` for follow-ups.`;

        await notifyDiscord(config.settings.discord_updates_webhook, alertMsg);

        if (config.inboxes.every(i => limitExceededInboxes.has(i.email))) {
          const stopMsg = `🛑 **Follow-ups Terminated**\nAll active inboxes hit daily sending limits / quotas. Follow-up run stopped safely.`;
          console.log(stopMsg);
          await notifyDiscord(config.settings.discord_updates_webhook, stopMsg);
          break;
        }
      }
    }

    const throttleMode = String(config.settings.throttle_mode || 'adaptive').toLowerCase();
    const isBulkMode = throttleMode === 'bulk' || throttleMode === 'fixed' || throttleMode === 'turbo';
    const minD = Math.max(0, parseInt(config.settings.min_delay_seconds || (isBulkMode ? '1' : '15'), 10) * 1000);
    const maxD = Math.max(minD, parseInt(config.settings.max_delay_seconds || (isBulkMode ? '3' : '30'), 10) * 1000);
    const configDelay = Math.floor(Math.random() * (maxD - minD + 1)) + minD;
    const adaptiveDelay = isBulkMode ? 0 : getSendDelay(currentInboxStats);
    const delay = isBulkMode ? configDelay : Math.max(configDelay, adaptiveDelay);
    await new Promise(r => setTimeout(r, delay));
  }
  if (emailsSentThisRun > 0) {
    await saveInboxStatsMap(sheets, inboxStatsMap);
  }
  return { success: true, message: 'Follow-ups completed successfully.', count: emailsSentThisRun };
}

import nodemailer from 'nodemailer';
import { 
  getSheets, 
  loadConfig, 
  loadTab, 
  isValidEmailDomain 
} from '../sheets-io.mjs';
import { 
  notifyDiscord, 
  isCampaignActive, 
  applyTemplateVariables, 
  calculateNextDueDate 
} from '../scheduler.mjs';
import { sendWithRetry } from '../retry.mjs';
import { isSuppressed, buildSenderFooter } from '../suppression.mjs';
import { isAuthError, sendAuthFailureAlert } from '../alerts.mjs';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || process.env.SHEET_ID;

// ============================================================================
// ⚡ 1B. INSTANT / BULK REMOTE LEAD DISPATCHER (GitHub / Webhook Trigger)
// ============================================================================
export async function runSingleLeadOutreachImpl(singleLeadPayload = {}) {
  // Check if leads is passed as an array or JSON string
  let leadsList = [];
  if (Array.isArray(singleLeadPayload.leads) && singleLeadPayload.leads.length > 0) {
    leadsList = singleLeadPayload.leads;
  } else if (Array.isArray(singleLeadPayload.batch) && singleLeadPayload.batch.length > 0) {
    leadsList = singleLeadPayload.batch;
  } else if (process.env.SINGLE_LEADS_JSON) {
    try {
      const parsed = JSON.parse(process.env.SINGLE_LEADS_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) leadsList = parsed;
    } catch (e) {
      console.warn('Could not parse SINGLE_LEADS_JSON:', e.message);
    }
  }

  // If no list, build single lead item from payload/env
  if (leadsList.length === 0) {
    const email = (singleLeadPayload.email || process.env.SINGLE_EMAIL || '').trim();
    if (!email) {
      const err = new Error('Recipient email (SINGLE_EMAIL) is required for single lead dispatch.');
      console.error('❌ Lead Email Error:', err.message);
      throw err;
    }

    // Single Lead pre-send MX check before getSheets
    const isDomainValid = await isValidEmailDomain(email);
    if (!isDomainValid) {
      const errorMsg = `Invalid email address or domain has no MX records.`;
      console.error(`⚠️ Single Email Failed for [${email}]: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    leadsList = [{
      email,
      full_name: singleLeadPayload.full_name || singleLeadPayload.personName || process.env.SINGLE_NAME || 'there',
      company_name: singleLeadPayload.company_name || singleLeadPayload.companyName || process.env.SINGLE_COMPANY || 'your company',
      location: singleLeadPayload.location || process.env.SINGLE_LOCATION || 'your city',
      spreadsheet_id: singleLeadPayload.spreadsheet_id || singleLeadPayload.sheet_id || process.env.SINGLE_SHEET_ID,
      webhook_url: singleLeadPayload.webhook_url || singleLeadPayload.discord_webhook || process.env.SINGLE_WEBHOOK_URL
    }];
  }

  const targetSheetId = (singleLeadPayload.spreadsheet_id || singleLeadPayload.sheet_id || leadsList[0]?.spreadsheet_id || process.env.SINGLE_SHEET_ID || SPREADSHEET_ID || '').trim();
  const customWebhookUrl = (singleLeadPayload.webhook_url || singleLeadPayload.discord_webhook || leadsList[0]?.webhook_url || process.env.SINGLE_WEBHOOK_URL || '').trim();

  const sheetsObj = await getSheets(targetSheetId);
  const { sheets, spreadsheetId } = sheetsObj;
  const config = await loadConfig(sheetsObj);
  const activeWebhookUrl = customWebhookUrl || config.settings.discord_updates_webhook || process.env.DISCORD_WEBHOOK_URL;

  // ⏸️ Master Campaign Toggle Check
  if (!isCampaignActive(config.settings, 'single_lead')) {
    const pauseMsg = '⏸️ **Campaign Paused Notice:** Single lead outreach is turned OFF/PAUSED in Google Sheet Settings (`campaign_active = FALSE`). Skipping dispatch safely.';
    console.log(pauseMsg);
    await notifyDiscord(activeWebhookUrl, pauseMsg);
    return [{ success: false, error: 'Campaign is paused in Google Sheet Settings' }];
  }

  if (!config.inboxes.length) {
    const err = new Error('No active Inboxes configured in "Inboxes" tab.');
    await notifyDiscord(activeWebhookUrl, `❌ **Email Dispatch Error**\n**Error:** \`${err.message}\``);
    throw err;
  }
  if (!config.coldTemplates.length) {
    const err = new Error('No Templates found in "Templates" tab.');
    await notifyDiscord(activeWebhookUrl, `❌ **Email Dispatch Error**\n**Error:** \`${err.message}\``);
    throw err;
  }

  console.log(`🚀 Starting Remote Dispatch batch of ${leadsList.length} lead(s)...`);

  const results = [];
  const minD = parseInt(config.settings.min_delay_seconds || '15', 10) * 1000;
  const maxD = parseInt(config.settings.max_delay_seconds || '45', 10) * 1000;

  for (let idx = 0; idx < leadsList.length; idx++) {
    const item = leadsList[idx];
    const email = (item.email || '').trim();
    const fullName = (item.full_name || item.personName || 'there').trim();
    const companyName = (item.company_name || item.companyName || 'your company').trim();
    const location = (item.location || config.settings.default_location || 'your city').trim();

    if (!email) continue;

    console.log(`[Processing ${idx + 1}/${leadsList.length}] Recipient: ${email}`);

    // 🛡️ PRE-SEND DOMAIN & MX CHECK
    const isDomainValid = await isValidEmailDomain(email);
    if (!isDomainValid) {
      const errorMsg = `Invalid email address or domain has no MX records.`;
      console.error(`⚠️ Single Email Failed for [${email}]: ${errorMsg}`);
      await notifyDiscord(
        activeWebhookUrl,
        `❌ **Email Dispatch Error**\n**Recipient:** \`${email}\`\n**Error:** \`${errorMsg}\``
      );
      results.push({ email, success: false, error: errorMsg });
      continue;
    }

    // 🛡️ Global Suppression Check for Single Lead Dispatch
    const suppressed = await isSuppressed(email, async () => {
      const suppRows = await loadTab(sheetsObj, 'Suppressed');
      return suppRows.map(r => r.email || r.Email);
    });
    if (suppressed) {
      const skipMsg = `⛔ Suppressed email skipped during single lead dispatch: ${email}`;
      console.log(skipMsg);
      await notifyDiscord(
        activeWebhookUrl,
        `⛔ **Single Lead Dispatch Skipped (Suppressed)**\nLead \`${email}\` is present in the Suppressed list. Dispatch aborted.`
      );
      results.push({ email, success: false, error: 'Email is suppressed' });
      continue;
    }

    // Select active inbox & template
    const inbox = config.inboxes[Math.floor(Math.random() * config.inboxes.length)];
    let senderEmail = inbox.email;
    let senderName = inbox.display_name || 'Team';
    if (config.aliases.length > 0) {
      const inboxDomain = (inbox.email.split('@')[1] || '').toLowerCase();
      const eligibleAliases = config.aliases.filter(a => {
        const assignedInbox = (a.inbox_email || '').trim().toLowerCase();
        if (assignedInbox) return assignedInbox === inbox.email.toLowerCase();
        const aliasDomain = (a.alias_email.split('@')[1] || '').toLowerCase();
        return aliasDomain && aliasDomain === inboxDomain;
      });

      if (eligibleAliases.length > 0) {
        const chosenAlias = eligibleAliases[Math.floor(Math.random() * eligibleAliases.length)];
        senderEmail = chosenAlias.alias_email;
        senderName = chosenAlias.display_name || chosenAlias.name || chosenAlias.sender_name || chosenAlias.alias_email.split('@')[0];
      }
    }

    const template = config.coldTemplates[Math.floor(Math.random() * config.coldTemplates.length)];

    // Personalization
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
    const footer = buildSenderFooter(config.settings, { email, campaign: 'single_lead', senderEmail }, process.env.UNSUBSCRIBE_SECRET);
    body = `${body}${footer}`;

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
      }), { retries: 2, baseDelay: 1500 });

      console.log(`[Sent ${idx + 1}/${leadsList.length}] "${senderName}" <${senderEmail}> -> ${email}`);

      // Update or Append row in 'Details' Google Sheet
      const detailsRes = await sendWithRetry(() => sheets.spreadsheets.values.get({ spreadsheetId, range: "'Details'!A:Z" }), { retries: 2 });
      const [headers, ...rows] = detailsRes.data.values || [];
      const col = Object.fromEntries((headers || []).map((h, i) => [(h || '').trim(), i]));

      const existingIndex = rows.findIndex(r => (r[col['email']] || '').trim().toLowerCase() === email.toLowerCase());

      const timeStr = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
      const dateStr = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

      // Calculate initial Next Follow Up Date based on Followup_Templates[0]
      const firstFollowupTemplate = config.followupTemplates?.[0];
      const initialDelayDays = parseInt(firstFollowupTemplate?.Days_Until_Next || '3', 10);
      const initialNextDueDateStr = calculateNextDueDate(new Date(), initialDelayDays);

      if (existingIndex >= 0) {
        const rowNum = existingIndex + 2;
        const targetRow = rows[existingIndex];
        targetRow[col['full_name']] = fullName;
        targetRow[col['company_name']] = companyName;
        targetRow[col['location']] = location;
        targetRow[col['Subject Line']] = subject;
        targetRow[col['Sent From']] = senderEmail;
        targetRow[col['Sent Status']] = 'SENT';
        targetRow[col['Time']] = timeStr;
        targetRow[col['Date Sent']] = dateStr;
        targetRow[col['Follow Up Count']] = 0;
        targetRow[col['Follow up']] = '';
        if (col['Next Follow Up Date'] !== undefined) {
          targetRow[col['Next Follow Up Date']] = initialNextDueDateStr;
        }

        await sendWithRetry(() => sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'Details'!A${rowNum}:Z${rowNum}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [targetRow] },
        }), { retries: 2 });
      } else {
        const rowData = {
          'full_name': fullName,
          'email': email,
          'company_name': companyName,
          'location': location,
          'Subject Line': subject,
          'Sent From': senderEmail,
          'Sent Status': 'SENT',
          'Time': timeStr,
          'Date Sent': dateStr,
          'Follow up': '',
          'Follow Up Count': 0,
          'Next Follow Up Date': initialNextDueDateStr,
          'Summary': '',
          'Phone': ''
        };
        const newRow = headers && headers.length > 0
          ? headers.map(h => rowData[(h || '').trim()] ?? '')
          : [fullName, email, companyName, location, subject, senderEmail, 'SENT', timeStr, dateStr, '', 0, '', '', ''];

        await sendWithRetry(() => sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "'Details'!A:Z",
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [newRow] },
        }), { retries: 2 });
      }

      results.push({ email, success: true });
    } catch (err) {
      console.error(`Failed send to ${email}:`, err.message);

      if (isAuthError(err)) {
        await sendAuthFailureAlert({
          inboxEmail: inbox.email,
          errorDetails: err.message,
          webhookUrl: activeWebhookUrl,
          context: 'Single Lead Outreach Send'
        });
        throw new Error(`Google App Password authentication failed for [${inbox.email}]: ${err.message}. Please update smtp_pass in Inboxes tab.`);
      }

      const errLower = (err.message || '').toLowerCase();
      const isBounce = errLower.includes('550') || errLower.includes('551') || errLower.includes('552') || errLower.includes('553') || errLower.includes('554') || errLower.includes('inactive') || errLower.includes('disabled') || errLower.includes('not found') || errLower.includes('user unknown');

      try {
        const detailsRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Details'!A:Z" });
        const [headers, ...rows] = detailsRes.data.values || [];
        const col = Object.fromEntries((headers || []).map((h, i) => [(h || '').trim(), i]));
        const existingIndex = rows.findIndex(r => (r[col['email']] || '').trim().toLowerCase() === email.toLowerCase());
        const timeStr = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
        const dateStr = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

        if (existingIndex >= 0) {
          const rowNum = existingIndex + 2;
          const targetRow = rows[existingIndex];
          targetRow[col['Sent Status']] = isBounce ? 'bounced' : 'FAILED';
          targetRow[col['Time']] = timeStr;
          targetRow[col['Date Sent']] = dateStr;
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'Details'!A${rowNum}:Z${rowNum}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [targetRow] },
          });
        } else {
          const newRow = [
            fullName, email, companyName, location,
            'N/A', senderEmail, isBounce ? 'bounced' : 'FAILED', timeStr,
            dateStr, 'Done', 0, 'BOUNCED'
          ];
          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "'Details'!A:Z",
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [newRow] },
          });
        }
      } catch (e) {
        console.warn('Could not record failure status in Google Sheet:', e.message);
      }

      await notifyDiscord(
        activeWebhookUrl,
        `❌ **Email ${isBounce ? 'Bounced (Inactive Account)' : 'Dispatch Error'}**\n**Recipient:** \`${email}\`\n**Error:** \`${err.message}\``
      );
      results.push({ email, success: false, error: err.message, isBounce });
    }

    // Delay between sends (following Google Sheet settings) if there are more leads
    if (idx < leadsList.length - 1) {
      const delay = Math.floor(Math.random() * (maxD - minD + 1)) + minD;
      console.log(`⏳ Delaying ${Math.round(delay / 1000)}s before next send (following Sheet settings)...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.log(`🏁 Batch finished! Processed ${leadsList.length} leads.`);
  return { success: true, count: leadsList.length, results };
}

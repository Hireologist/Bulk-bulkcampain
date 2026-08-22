import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import Groq from 'groq-sdk';
import axios from 'axios';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Google Sheets Authentication
async function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Load a specific tab
async function loadTab(sheets, tabName) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A:Z`,
    });
    const [headers, ...rows] = res.data.values || [];
    if (!headers) return [];
    return rows.map(r => Object.fromEntries(headers.map((h, i) => [h.trim(), (r[i] || '').trim()])));
  } catch (e) {
    console.warn(`Could not load tab [${tabName}]: ${e.message}`);
    return [];
  }
}

// Load all system configs
async function loadConfig(sheets) {
  const settingsRows = await loadTab(sheets, 'Settings');
  const settings = Object.fromEntries(settingsRows.map(r => [r.Key || r.key, r.Value || r.value]));

  const rawInboxes = await loadTab(sheets, 'Inboxes');
  const inboxes = rawInboxes.filter(i => (i.is_active || '').toUpperCase() === 'TRUE');

  const rawAliases = await loadTab(sheets, 'Aliases');
  const aliases = rawAliases.filter(a => (a.is_active || '').toUpperCase() === 'TRUE');

  const coldTemplates = await loadTab(sheets, 'Templates');
  const followupTemplates = await loadTab(sheets, 'Followup_Templates');
  const locations = (await loadTab(sheets, 'Locations')).map(r => r.location_name).filter(Boolean);
  const clients = await loadTab(sheets, 'Clients');

  return { settings, inboxes, aliases, coldTemplates, followupTemplates, locations, clients };
}

// Check IST cutoff
function isPastCutoff(hour = 18, minute = 30) {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const totalMins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return totalMins >= (parseInt(hour, 10) * 60 + parseInt(minute, 10));
}

// Discord Webhook Notification
async function notifyDiscord(url, content) {
  if (url && url.startsWith('http')) {
    try {
      await axios.post(url, { content });
    } catch (e) {
      console.error('Discord error:', e.message);
    }
  }
}

// ============================================================================
// 🚀 1. COLD OUTREACH SENDER
// ============================================================================
export async function runColdOutreach() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);

  if (!config.inboxes.length) throw new Error('No active Inboxes configured in "Inboxes" tab.');
  if (!config.coldTemplates.length) throw new Error('No Templates found in "Templates" tab.');

  await notifyDiscord(config.settings.discord_updates_webhook, '🚀 Auto bulk cold outreach started');

  const detailsRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'Details'!A:Z" });
  const [headers, ...rows] = detailsRes.data.values || [];
  const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));

  const inboxUsage = Object.fromEntries(config.inboxes.map(i => [i.email, 0]));
  let inboxIdx = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = (row[col['email']] || '').trim();
    const status = (row[col['Sent Status']] || '').trim().toLowerCase();

    // Skip if already sent, replied, bounced, or empty email
    if (!email || status === 'sent' || status === 'replied' || status === 'bounced') {
      continue;
    }

    // Cutoff time check (6:30 PM IST)
    if (isPastCutoff(config.settings.cutoff_hour_ist, config.settings.cutoff_minute_ist)) {
      console.log('⏰ Cutoff time reached (6:30 PM IST). Stopping.');
      break;
    }

    // Find inbox under daily limit
    let inbox = null;
    for (let attempt = 0; attempt < config.inboxes.length; attempt++) {
      const candidate = config.inboxes[inboxIdx];
      inboxIdx = (inboxIdx + 1) % config.inboxes.length;
      if (inboxUsage[candidate.email] < parseInt(candidate.daily_limit || '50', 10)) {
        inbox = candidate;
        break;
      }
    }
    if (!inbox) {
      console.log('🛑 All inboxes have reached their daily limit for today.');
      break;
    }

    // Pick alias
    let senderEmail = inbox.email;
    let senderName = inbox.display_name || 'Team';
    if (config.aliases.length > 0) {
      const chosenAlias = config.aliases[Math.floor(Math.random() * config.aliases.length)];
      senderEmail = chosenAlias.alias_email;
      senderName = chosenAlias.display_name || chosenAlias.alias_email.split('@')[0];
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

    const replaceTags = (txt = '') => txt
      .replace(/{{full_name}}/gi, fullName)
      .replace(/{{company_name}}/gi, companyName)
      .replace(/{{location}}/gi, location)
      .replace(/{{other_locations}}/gi, randomLocs)
      .replace(/{{clients}}/gi, clientStr)
      .replace(/{{Date}}/gi, new Date().toLocaleDateString('en-GB'));

    const subject = replaceTags(template.Subject || template['Subject line']);
    const body = replaceTags(template.Body || template.body);

    const transporter = nodemailer.createTransport({
      host: inbox.smtp_host,
      port: parseInt(inbox.smtp_port, 10),
      secure: parseInt(inbox.smtp_port, 10) === 465,
      auth: { user: inbox.smtp_user, pass: inbox.smtp_pass },
    });

    try {
      await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to: email,
        subject,
        html: body,
      });

      inboxUsage[inbox.email]++;
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

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
    } catch (err) {
      console.error(`Failed to send to ${email}:`, err.message);
    }

    // Delay between sends
    const minD = parseInt(config.settings.min_delay_seconds || '15', 10) * 1000;
    const maxD = parseInt(config.settings.max_delay_seconds || '45', 10) * 1000;
    const delay = Math.floor(Math.random() * (maxD - minD + 1)) + minD;
    await new Promise(r => setTimeout(r, delay));
  }

  await notifyDiscord(config.settings.discord_updates_webhook, '🏁 Cold outreach run completed.');
}

// ============================================================================
// 🔁 2. FOLLOW-UP ENGINE (Guaranteed to match initial sender & alias)
// ============================================================================
export async function runFollowups() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);

  if (!config.inboxes.length) throw new Error('No active Inboxes found.');
  if (!config.followupTemplates.length) throw new Error('No Follow-up Templates found.');

  const detailsRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'Details'!A:Z" });
  const [headers, ...rows] = detailsRes.data.values || [];
  const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
      sentStatus === 'replied' ||
      sentStatus === 'bounced' ||
      followUpStatus === 'done' ||
      !subjectLine
    ) {
      continue;
    }

    if (nextDueDateStr) {
      const [d, m, y] = nextDueDateStr.split('/').map(Number);
      const dueDate = new Date(y, m - 1, d);
      if (dueDate && today < dueDate) continue;
    }

    const nextCount = currentCount + 1;
    if (nextCount > config.followupTemplates.length) {
      const rowNum = i + 2;
      row[col['Follow up']] = 'Done';
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
      continue;
    }

    const template = config.followupTemplates.find(t => parseInt(t['Follow_Up_Number'], 10) === nextCount) ||
                     config.followupTemplates[0];

    // 🎯 1. MATCH EXACT ALIAS & DISPLAY NAME
    const matchedAlias = config.aliases.find(a => a.alias_email.toLowerCase() === originalSenderEmail.toLowerCase());
    const senderName = matchedAlias ? matchedAlias.display_name : (originalSenderEmail.split('@')[0] || 'Team');
    const senderEmail = originalSenderEmail || config.inboxes[0].email;

    // 🎯 2. MATCH INBOX CREDENTIALS FOR THIS SENDER DOMAIN
    let inboxToUse = config.inboxes.find(i => i.email.toLowerCase() === originalSenderEmail.toLowerCase());
    if (!inboxToUse && originalSenderEmail.includes('@')) {
      const senderDomain = originalSenderEmail.split('@')[1].toLowerCase();
      inboxToUse = config.inboxes.find(i => i.email.toLowerCase().endsWith(`@${senderDomain}`));
    }
    if (!inboxToUse) inboxToUse = config.inboxes[0];

    const fullName = (row[col['full_name']] || 'there').trim();
    const companyName = (row[col['company_name']] || 'your company').trim();
    const location = (row[col['location']] || 'your city').trim();

    const randomLocs = config.locations.filter(l => l.toLowerCase() !== location.toLowerCase())
      .sort(() => 0.5 - Math.random()).slice(0, 4).join(', ');
    const clientStr = config.clients.sort(() => 0.5 - Math.random()).slice(0, 5)
      .map(c => c.client_name || c.name).join(', ');

    const replaceTags = (txt = '') => txt
      .replace(/{{full_name}}/g, fullName)
      .replace(/{{company_name}}/g, companyName)
      .replace(/{{Date}}/g, new Date().toLocaleDateString('en-GB'))
      .replace(/{{location}}/g, location)
      .replace(/{{other_locations}}/g, randomLocs)
      .replace(/{{clients}}/g, clientStr)
      .replace(/{{follow_up_number}}/g, String(nextCount));

    const finalSubj = `${replaceTags(template.Subject || 'Re:')} ${subjectLine}`.trim();
    const finalBody = replaceTags(template.Body || template.body);

    const transporter = nodemailer.createTransport({
      host: inboxToUse.smtp_host,
      port: parseInt(inboxToUse.smtp_port, 10),
      secure: parseInt(inboxToUse.smtp_port, 10) === 465,
      auth: { user: inboxToUse.smtp_user, pass: inboxToUse.smtp_pass },
    });

    try {
      await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to: email,
        subject: finalSubj,
        html: finalBody,
      });

      console.log(`[Follow-up #${nextCount}] Sent from "${senderName}" <${senderEmail}> to: ${email}`);

      const daysUntilNext = parseInt(template.Days_Until_Next || '3', 10);
      let nextDateStr = '';
      if (daysUntilNext > 0) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + daysUntilNext);
        nextDateStr = `${String(nextDate.getDate()).padStart(2, '0')}/${String(nextDate.getMonth() + 1).padStart(2, '0')}/${nextDate.getFullYear()}`;
      }

      const rowNum = i + 2;
      row[col['Follow Up Count']] = nextCount;
      row[col['Next Follow Up Date']] = nextDateStr;
      if (nextCount >= config.followupTemplates.length) {
        row[col['Follow up']] = 'Done';
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
    } catch (e) {
      console.error(`Follow-up failed for ${email}:`, e.message);
    }

    await new Promise(r => setTimeout(r, 20000));
  }
}

// ============================================================================
// 📥 3. 24/7 INBOX & BOUNCE CHECKER
// ============================================================================
export async function runInboxChecker() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);
  const groq = config.settings.groq_api_key && config.settings.groq_api_key.startsWith('gsk_') 
    ? new Groq({ apiKey: config.settings.groq_api_key }) : null;

  const detailsRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'Details'!A:Z" });
  const [headers, ...rows] = detailsRes.data.values || [];
  const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));

  for (const inbox of config.inboxes) {
    if (!inbox.imap_host) continue;

    console.log(`Scanning inbox: ${inbox.email}...`);
    const client = new ImapFlow({
      host: inbox.imap_host,
      port: parseInt(inbox.imap_port || '993', 10),
      secure: true,
      auth: { user: inbox.smtp_user, pass: inbox.smtp_pass },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        for await (const msg of client.fetch({ seen: false }, { source: true })) {
          const parsed = await simpleParser(msg.source);
          const fromAddr = parsed.from?.value[0]?.address?.toLowerCase() || '';

          if (fromAddr.includes('hireologist.com') || fromAddr.includes('hireologist.in')) continue;

          // A. Bounce Detection
          const isBounce = parsed.from?.text?.includes('mailer-daemon') ||
                           parsed.from?.text?.includes('postmaster') ||
                           parsed.headers.get('auto-submitted') === 'auto';

          if (isBounce) {
            const match = (parsed.text || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)
              ?.find(e => !e.includes('mailer') && !e.includes('postmaster'));

            if (match) {
              const rIdx = rows.findIndex(r => (r[col['email']] || '').toLowerCase() === match.toLowerCase());
              if (rIdx !== -1) {
                rows[rIdx][col['Sent Status']] = 'bounced';
                rows[rIdx][col['Follow up']] = 'Done';
                rows[rIdx][col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

                await sheets.spreadsheets.values.update({
                  spreadsheetId: SPREADSHEET_ID,
                  range: `'Details'!A${rIdx + 2}:Z${rIdx + 2}`,
                  valueInputOption: 'USER_ENTERED',
                  requestBody: { values: [rows[rIdx]] },
                });
                console.log(`🔒 Marked [${match}] as BOUNCED & Follow-up as DONE`);
              }
            }
            continue;
          }

          // B. Prospect Reply Detection
          const rIdx = rows.findIndex(r => (r[col['email']] || '').toLowerCase() === fromAddr);
          if (rIdx !== -1) {
            let sentiment = 'REPLIED';

            if (groq) {
              try {
                const aiRes = await groq.chat.completions.create({
                  model: 'openai/gpt-oss-120b',
                  messages: [
                    { role: 'system', content: 'Classify sentiment in ONE word: POSITIVE, NEUTRAL, NEGATIVE, or OOO.' },
                    { role: 'user', content: parsed.text || '' },
                  ],
                });
                sentiment = aiRes.choices[0].message.content.trim().toUpperCase();
              } catch (e) {
                console.error('Groq AI error:', e.message);
              }
            }

            rows[rIdx][col['Sent Status']] = 'replied';
            rows[rIdx][col['Follow up']] = 'Done';
            if (col['Next Follow Up Date'] !== undefined) {
              rows[rIdx][col['Next Follow Up Date']] = sentiment;
            }
            rows[rIdx][col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

            await sheets.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: `'Details'!A${rIdx + 2}:Z${rIdx + 2}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [rows[rIdx]] },
            });

            console.log(`🎯 Marked [${fromAddr}] as REPLIED (${sentiment}) & Follow-up as DONE`);

            if (sentiment === 'POSITIVE' || sentiment === 'NEUTRAL') {
              await notifyDiscord(config.settings.discord_positive_webhook,
                `🔥 **${sentiment} Lead Alert**\n**From:** ${fromAddr}\n**Subject:** ${parsed.subject}\n**Inbox:** ${inbox.email}`);
            }
          }
        }
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (e) {
      console.error(`IMAP error for ${inbox.email}:`, e.message);
    }
  }
}

// CLI Router
const task = process.argv[2];
if (task === 'outreach') runColdOutreach().catch(console.error);
else if (task === 'followup') runFollowups().catch(console.error);
else if (task === 'inbox') runInboxChecker().catch(console.error);

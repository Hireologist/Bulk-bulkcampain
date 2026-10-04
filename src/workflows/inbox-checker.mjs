import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import Groq from 'groq-sdk';
import { 
  getSheets, 
  loadConfig, 
  ensureTabExists 
} from '../sheets-io.mjs';
import { notifyDiscord } from '../scheduler.mjs';
import { classifyEmailWithAi } from '../ai-classifier.mjs';
import { sendWithRetry } from '../retry.mjs';
import { stripQuotedReply, isOptOutReply, addToSuppression } from '../suppression.mjs';
import { isAuthError, sendAuthFailureAlert } from '../alerts.mjs';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || process.env.SHEET_ID;

// ============================================================================
// 📥 3. 24/7 INBOX & BOUNCE CHECKER
// ============================================================================
export async function runInboxChecker() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);
  const groq = config.settings.groq_api_key && config.settings.groq_api_key.startsWith('gsk_') 
    ? new Groq({ apiKey: config.settings.groq_api_key }) : null;

  const detailsRes = await sendWithRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
    range: "'Details'!A:Z",
  }), { retries: 2 });

  const [headers, ...rows] = detailsRes.data.values || [];
  const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));

  const internalEmails = [
    ...config.inboxes.map(i => i.email.toLowerCase()),
    ...config.aliases.map(a => a.alias_email.toLowerCase())
  ];

  for (const inbox of config.inboxes) {
    if (!inbox.imap_host) continue;

    console.log(`Scanning inbox: ${inbox.email}...`);
    const client = new ImapFlow({
      host: inbox.imap_host,
      port: parseInt(inbox.imap_port || '993', 10),
      secure: true,
      auth: { user: inbox.smtp_user, pass: inbox.smtp_pass },
      logger: false,
      socketTimeout: 60000,
      clientInfo: { name: 'UniversalOutreachBot' }
    });

    // 🛡️ Prevent Unhandled 'error' event crash on socket timeout or disconnection
    client.on('error', (err) => {
      console.warn(`⚠️ [IMAP Socket/Connection Warning] ${inbox.email}: ${err.message}`);
    });

    let lock = null;
    try {
      await client.connect();
      lock = await client.getMailboxLock('INBOX');

      // 1. Fetch all unseen messages into memory so the IMAP fetch stream closes cleanly
      const unseenMessages = [];
      for await (const msg of client.fetch({ seen: false }, { uid: true, source: true })) {
        unseenMessages.push(msg);
      }

      // 2. Mark all unseen message UIDs as \Seen in one single batch command
      const uidsToMark = unseenMessages.map(m => m.uid).filter(Boolean);
      if (uidsToMark.length > 0) {
        try {
          await client.messageFlagsAdd(uidsToMark, ['\\Seen'], { uid: true });
          console.log(`👁️ Marked ${uidsToMark.length} message(s) as \\Seen in ${inbox.email}`);
        } catch (flagErr) {
          console.warn(`Could not set \\Seen flags in ${inbox.email}:`, flagErr.message);
        }
      }

      // 3. Process each message without blocking IMAP connection
      const processedFromAddrs = new Set();
      for (const msg of unseenMessages) {
        try {
          const parsed = await simpleParser(msg.source);
          const fromAddr = parsed.from?.value[0]?.address?.toLowerCase() || '';

          if (!fromAddr || internalEmails.includes(fromAddr)) continue;

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
                rows[rIdx][col['Date Sent']] = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
                rows[rIdx][col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

                await sendWithRetry(() => sheets.spreadsheets.values.update({
                  spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
                  range: `'Details'!A${rIdx + 2}:Z${rIdx + 2}`,
                  valueInputOption: 'USER_ENTERED',
                  requestBody: { values: [rows[rIdx]] },
                }));
                console.log(`🔒 Marked [${match}] as BOUNCED & Follow-up as DONE`);
              }
            }
            continue;
          }

          // B. Prospect Reply Detection
          const rIdx = rows.findIndex(r => (r[col['email']] || '').toLowerCase() === fromAddr);
          if (rIdx !== -1) {
            const existingStatus = (rows[rIdx][col['Sent Status']] || '').trim().toLowerCase();
            const sentimentCol = col['Sentiment'] ?? col['Next Follow Up Date'];
            const existingSentiment = (sentimentCol !== undefined ? (rows[rIdx][sentimentCol] || '') : '').trim().toUpperCase();

            // Check if lead was ALREADY positive/neutral or already marked as replied
            const isExistingLead = existingStatus === 'replied' || existingSentiment === 'POSITIVE' || existingSentiment === 'NEUTRAL';

            const emailSubject = parsed.subject || '';
            const emailBody = parsed.text || '';
            const cleanBody = stripQuotedReply(emailBody);
            const combinedEmailContent = emailSubject ? `Subject: ${emailSubject}\n\n${cleanBody}` : cleanBody;

            const { sentiment, summary, phone } = await classifyEmailWithAi(groq, combinedEmailContent);

            rows[rIdx][col['Sent Status']] = 'replied';
            rows[rIdx][col['Follow up']] = 'Done';
            rows[rIdx][col['Date Sent']] = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
            if (sentimentCol !== undefined) {
              rows[rIdx][sentimentCol] = sentiment;
            }
            const phoneColIdx = col['Phone'] ?? col['phone'] ?? col['Phone Number'] ?? col['phone_number'];
            if (phoneColIdx !== undefined && phone) {
              rows[rIdx][phoneColIdx] = phone;
            }
            if (col['Summary'] !== undefined) {
              rows[rIdx][col['Summary']] = (phoneColIdx === undefined && phone)
                ? `${summary}${summary ? ' | ' : ''}Phone: ${phone}`
                : summary;
            }
            rows[rIdx][col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });

            // ⛔ Check if lead explicitly requested unsubscribe / removal (via mailto link or explicit keywords)
            // Positive and Neutral replies are genuine engagement and must not be treated as opt-outs
            const isOptOut = (sentiment !== 'POSITIVE' && sentiment !== 'NEUTRAL') && isOptOutReply(emailSubject, emailBody);

            if (isOptOut) {
              rows[rIdx][col['Sent Status']] = 'suppressed';
              if (sentimentCol !== undefined) {
                rows[rIdx][sentimentCol] = 'SUPPRESSED';
              }
              try {
                await addToSuppression(fromAddr, 'Unsubscribed via reply', async (emailToSuppress, reason, timestamp) => {
                  await ensureTabExists(sheets, 'Suppressed', ['email', 'reason', 'added_at']);
                  const sheetsClient = sheets?.sheets || sheets;
                  const spreadsheetId = sheets?.spreadsheetId || SPREADSHEET_ID;
                  await sendWithRetry(() => sheetsClient.spreadsheets.values.append({
                    spreadsheetId,
                    range: "'Suppressed'!A:Z",
                    valueInputOption: 'USER_ENTERED',
                    requestBody: {
                      values: [[emailToSuppress, reason, timestamp]],
                    },
                  }), { retries: 2 });
                });
                console.log(`⛔ Auto-suppressed lead [${fromAddr}] in Suppressed tab.`);
              } catch (supErr) {
                console.warn(`Could not add ${fromAddr} to Suppressed tab:`, supErr.message);
              }
            }

            await sendWithRetry(() => sheets.spreadsheets.values.update({
              spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
              range: `'Details'!A${rIdx + 2}:Z${rIdx + 2}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [rows[rIdx]] },
            }));

            const leadName = rows[rIdx][col['full_name']] || fromAddr;
            const companyName = rows[rIdx][col['company_name']] || 'Company';

            if (isOptOut) {
              // Opt-out lead handled; no positive or re-reply notifications needed
            } else if (isExistingLead) {
              // 💬 Existing Lead Re-reply / Follow-up Notification
              const rereplyWebhook = config.settings.discord_rereply_webhook || config.settings.discord_positive_webhook || config.settings.discord_updates_webhook;
              console.log(`🎯 Re-reply from existing lead [${fromAddr}] (${sentiment}). Notifying re-reply channel...`);

              if (rereplyWebhook) {
                const msgContent =
`💬 **Existing Lead Re-Reply Alert (${sentiment})**
**From:** ${leadName} (\`${fromAddr}\`)
**Company:** ${companyName}
**Subject:** ${parsed.subject || 'No Subject'}
**Inbox:** ${inbox.email}${phone ? `\n**Phone:** ${phone}` : ''}
**Summary:** ${summary}`;
                await notifyDiscord(rereplyWebhook, msgContent);
              }
            } else {
              // 🔥 First-time New Lead Notification
              console.log(`🎯 New lead reply from [${fromAddr}] (${sentiment}).`);
              if (sentiment === 'POSITIVE' || sentiment === 'NEUTRAL') {
                const positiveWebhook = config.settings.discord_positive_webhook || config.settings.discord_updates_webhook;
                if (positiveWebhook) {
                  const msgContent =
`🔥 **${sentiment} Lead Alert (New Lead)**
**From:** ${leadName} (\`${fromAddr}\`)
**Company:** ${companyName}
**Subject:** ${parsed.subject || 'No Subject'}
**Inbox:** ${inbox.email}${phone ? `\n**Phone:** ${phone}` : ''}
**Summary:** ${summary}`;
                  await notifyDiscord(positiveWebhook, msgContent);
                }
              }
            }
          }
        } catch (msgErr) {
          console.warn(`⚠️ Error processing message in ${inbox.email}:`, msgErr.message);
        }
      }
    } catch (e) {
      if (isAuthError(e)) {
        console.error(`🚨 IMAP authentication failed for ${inbox.email}:`, e.message);
        await sendAuthFailureAlert({
          inboxEmail: inbox.email,
          errorDetails: `IMAP: ${e.message}`,
          webhookUrl: config.settings.discord_updates_webhook,
          context: 'Inbox Reply Checker (IMAP Audit)'
        });
      } else if (e.message && (e.message.includes('Connection not available') || e.message.includes('Socket timeout') || e.message.includes('closed'))) {
        console.warn(`ℹ️ [IMAP Notice] ${inbox.email}: Connection closed (${e.message})`);
      } else {
        console.error(`IMAP error for ${inbox.email}:`, e.message);
      }
    } finally {
      if (lock) {
        try { lock.release(); } catch (_) {}
      }
      try {
        if (client.usable || client.authenticated) {
          await client.logout();
        } else {
          client.close();
        }
      } catch (_) {
        try { client.close(); } catch (_) {}
      }
    }
  }
}

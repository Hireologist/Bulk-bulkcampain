import { getSheets, loadConfig } from '../sheets-io.mjs';
import { normalizeDate, notifyDiscord } from '../scheduler.mjs';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || process.env.SHEET_ID;

// ============================================================================
// 📊 4. DAILY DISCORD ANALYTICS DIGEST
// ============================================================================
export async function generateDailyDigest() {
  const sheets = await getSheets();
  const config = await loadConfig(sheets);

  const detailsRes = await sheets.spreadsheets.values.get({ 
    spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID, 
    range: "'Details'!A:Z" 
  });
  const [headers, ...rows] = detailsRes.data.values || [];
  const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));

  const nowIST = new Date();
  const todayIST = normalizeDate(nowIST.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }));
  // Guard against US-locale Google Sheets storing inverted month/day (MM/DD/YYYY)
  const dStr = String(nowIST.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit' }));
  const mStr = String(nowIST.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', month: '2-digit' }));
  const yStr = String(nowIST.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric' }));
  const invertedTodayIST = `${mStr}/${dStr}/${yStr}`;

  const formattedDateStr = nowIST.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  let coldSentToday = 0;
  let followupsSentToday = 0;
  let bouncesTotal = 0;
  let repliesTotal = 0;
  let positiveCount = 0;
  let neutralCount = 0;
  let negativeCount = 0;

  for (const row of rows) {
    const rawSentDate = (row[col['Date Sent']] || '').trim();
    const sentDate = normalizeDate(rawSentDate);
    const sentStatus = (row[col['Sent Status']] || '').trim().toLowerCase();
    const followUpCount = parseInt(row[col['Follow Up Count']] || '0', 10);
    const sentimentCol = col['Sentiment'] ?? col['Next Follow Up Date'];
    const sentiment = (sentimentCol !== undefined ? (row[sentimentCol] || '') : '').trim().toUpperCase();

    // STRICT FILTER: Count leads matching TODAY in either DD/MM/YYYY or inverted MM/DD/YYYY format
    if (sentDate !== todayIST && sentDate !== invertedTodayIST) {
      continue;
    }

    // Cold outreach sent today
    if (followUpCount === 0 && (sentStatus === 'sent' || sentStatus === 'replied')) {
      coldSentToday++;
    }

    // Follow-ups sent today
    if (followUpCount > 0 && (sentStatus === 'sent' || sentStatus === 'replied')) {
      followupsSentToday++;
    }

    // Bounces today
    if (sentStatus === 'bounced') {
      bouncesTotal++;
    }

    // Replies received today
    if (sentStatus === 'replied') {
      repliesTotal++;
      if (sentiment.includes('POSITIVE')) positiveCount++;
      else if (sentiment.includes('NEGATIVE')) negativeCount++;
      else neutralCount++;
    }
  }

  const message = 
`📊 **Daily Outreach Summary (${formattedDateStr})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📤 **Cold Emails Sent:**   ${coldSentToday.toLocaleString()}
🔁 **Follow-ups Sent:**    ${followupsSentToday.toLocaleString()}
🎯 **Inbound Replies:**    ${repliesTotal.toLocaleString()} (${positiveCount} Positive 🔥, ${neutralCount} Neutral 💬, ${negativeCount} Negative ❌)
🔒 **Bounces Caught:**     ${bouncesTotal.toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  console.log(message);
  await notifyDiscord(config.settings.discord_updates_webhook, message);
}

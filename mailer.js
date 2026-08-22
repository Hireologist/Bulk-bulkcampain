import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import axios from 'axios';

// --- CONFIGURATION ---
const SPREADSHEET_ID = '1PJpmOpdXDw-JuKCg7ig3wFx5ojIWB9cFG6LKVMNi9C8';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const senderEmails = [
  "pooja@hireologist.co.in",
  "neha@hireologist.co.in",
  "urvashi@hireologist.co.in",
  "Shraddha@hireologist.co.in",
  "roshni@hireologist.co.in"
];

const allOtherLocations = [
  'Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Ahmedabad',
  'Chennai', 'Kolkata', 'Pune', 'Jaipur', 'Noida', 'Indore'
];

const allClients = [
  { name: 'Acme Corp', industry: 'Global' },
  { name: 'TechFlow', industry: 'Global' },
  { name: 'CloudSync', industry: 'IT' },
  { name: 'DataMind', industry: 'IT' },
  { name: 'CodeCrafters', industry: 'IT' },
  { name: 'MarketGenius', industry: 'Digital Marketing' },
  { name: 'AdVantage', industry: 'Digital Marketing' },
  { name: 'BuildRight', industry: 'Manufacturing' },
  { name: 'LearnFast', industry: 'Edtech' },
  { name: 'EduSmart', industry: 'Edtech' },
  { name: 'SafeGuard', industry: 'Insurance' },
  { name: 'FreshBites', industry: 'Foods' },
  { name: 'BioCure', industry: 'Pharma' },
  { name: 'PaySwift', industry: 'Fintech' }
];

async function notifyDiscord(content) {
  if (DISCORD_WEBHOOK_URL) {
    try {
      await axios.post(DISCORD_WEBHOOK_URL, { content });
    } catch (e) {
      console.error('Failed to notify Discord:', e.message);
    }
  }
}

function isPastCutoff() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  const minutesSinceMidnight = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
  return minutesSinceMidnight >= 1110; // 6:30 PM IST (18 * 60 + 30 = 1110)
}

async function main() {
  await notifyDiscord('Auto bulk mail started');

  // 1. Authenticate Google Sheets
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // 2. Fetch Templates
  const templateRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Cold mails template'!A:Z",
  });
  const [templateHeaders, ...templateRows] = templateRes.data.values || [];
  const templates = templateRows.map(r => Object.fromEntries(templateHeaders.map((h, i) => [h, r[i] || ''])));

  if (!templates.length) {
    throw new Error('No templates found in spreadsheet.');
  }

  // 3. Fetch Rows to Process
  const detailsRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Details'!A:Z",
  });
  const [detailHeaders, ...detailRows] = detailsRes.data.values || [];

  const colIdx = {
    email: detailHeaders.indexOf('email'),
    fullName: detailHeaders.indexOf('full_name'),
    companyName: detailHeaders.indexOf('company_name'),
    location: detailHeaders.indexOf('location'),
    subjectLine: detailHeaders.indexOf('Subject Line'),
    sentFrom: detailHeaders.indexOf('Sent From'),
    sentStatus: detailHeaders.indexOf('Sent Status'),
    time: detailHeaders.indexOf('Time'),
    dateSent: detailHeaders.indexOf('Date Sent'),
    followUpCount: detailHeaders.indexOf('Follow Up Count')
  };

  // 4. Setup SMTP
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // 5. Loop and Send
  for (let i = 0; i < detailRows.length; i++) {
    const row = detailRows[i];
    const sentStatus = row[colIdx.sentStatus] || '';
    
    // Skip if already sent or missing email
    if (sentStatus.toUpperCase() === 'SENT' || !row[colIdx.email]) continue;

    // Stop if past 6:30 PM IST
    if (isPastCutoff()) {
      console.log('Cutoff time reached (6:30 PM IST). Stopping.');
      break;
    }

    const rowObj = Object.fromEntries(detailHeaders.map((h, idx) => [h, row[idx] || '']));
    const template = templates[Math.floor(Math.random() * templates.length)];

    const fullName = (rowObj.full_name || 'there').trim();
    const companyName = (rowObj.company_name || 'your company').trim();
    const displayLocation = (rowObj.location || 'your city').trim();
    
    // Date formatting (random separators: /, -, .)
    const seps = ['/', '-', '.'];
    const sep = seps[Math.floor(Math.random() * seps.length)];
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    const todaysDate = `${day}${sep}${month}${sep}${year}`;

    // Locations & Client Randomization
    const filteredLocs = allOtherLocations
      .filter(l => l.toLowerCase() !== displayLocation.toLowerCase())
      .sort(() => 0.5 - Math.random())
      .slice(0, 4)
      .join(', ');

    const clientString = allClients
      .sort(() => 0.5 - Math.random())
      .slice(0, 5)
      .map(c => c.name)
      .join(', ');

    const selectedSender = senderEmails[Math.floor(Math.random() * senderEmails.length)];

    const finalSubject = (template.Subject || '')
      .replace(/{{full_name}}/gi, fullName)
      .replace(/{{company_name}}/gi, companyName)
      .replace(/{{Date}}/gi, todaysDate)
      .replace(/{{location}}/gi, displayLocation);

    const finalBody = (template.Body || '')
      .replace(/{{full_name}}/gi, fullName)
      .replace(/{{company_name}}/gi, companyName)
      .replace(/{{Date}}/gi, todaysDate)
      .replace(/{{location}}/gi, displayLocation)
      .replace(/{{other_locations}}/g, filteredLocs)
      .replace(/{{clients}}/g, clientString);

    // Send Email
    try {
      await transporter.sendMail({
        from: `"${fullName.split(' ')[0]}" <${selectedSender}>`,
        to: rowObj.email.trim(),
        subject: finalSubject,
        html: finalBody,
      });

      console.log(`Sent email to: ${rowObj.email}`);

      // Update Row in Google Sheet
      const rowNum = i + 2;
      const istTime = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
      const istDate = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

      // Update the specific updated fields back to the row
      const updatedRow = [...row];
      if (colIdx.subjectLine !== -1) updatedRow[colIdx.subjectLine] = finalSubject;
      if (colIdx.sentFrom !== -1) updatedRow[colIdx.sentFrom] = selectedSender;
      if (colIdx.sentStatus !== -1) updatedRow[colIdx.sentStatus] = 'SENT';
      if (colIdx.time !== -1) updatedRow[colIdx.time] = istTime;
      if (colIdx.dateSent !== -1) updatedRow[colIdx.dateSent] = istDate;
      if (colIdx.followUpCount !== -1) updatedRow[colIdx.followUpCount] = 0;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'Details'!A${rowNum}:Z${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [updatedRow] },
      });

    } catch (err) {
      console.error(`Failed sending to ${rowObj.email}:`, err.message);
    }

    // Wait random delay 3-7 seconds
    const delay = Math.floor(Math.random() * 4000) + 3000;
    await new Promise(r => setTimeout(r, delay));
  }

  await notifyDiscord('Auto bulk mails have ended.');
}

main().catch(async (err) => {
  console.error(err);
  await notifyDiscord(`❌ Outreach script encountered an error: ${err.message}`);
  process.exit(1);
});

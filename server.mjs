import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  runColdOutreach, 
  runFollowups, 
  runInboxChecker, 
  generateDailyDigest 
} from './engine.mjs';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Google Sheets Auth Helper
async function getSheets() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !SPREADSHEET_ID) {
    return null;
  }
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
  } catch (err) {
    console.error('Google Auth Error:', err.message);
    return null;
  }
}

// Load Tab Helper
async function loadTab(sheets, tabName) {
  if (!sheets) return [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A:Z`,
    });
    const [headers, ...rows] = res.data.values || [];
    if (!headers) return [];
    return rows.map(r => Object.fromEntries(headers.map((h, i) => [h.trim(), (r[i] || '').trim()])));
  } catch (e) {
    return [];
  }
}

// Global state for background task execution
let activeTask = null;

// 1. Overall System Stats Endpoint
app.get('/api/stats', async (req, res) => {
  const sheets = await getSheets();
  if (!sheets) {
    return res.json({
      configured: false,
      message: 'Spreadsheet credentials not connected. Set SPREADSHEET_ID & GOOGLE_SERVICE_ACCOUNT_JSON.',
      stats: {
        coldSent: 0,
        followupsSent: 0,
        repliesTotal: 0,
        positiveCount: 0,
        neutralCount: 0,
        negativeCount: 0,
        bouncesTotal: 0,
        uncontacted: 0,
        totalLeads: 0,
        activeInboxes: 0,
        activeAliases: 0
      }
    });
  }

  try {
    const detailsRows = await loadTab(sheets, 'Details');
    const inboxes = await loadTab(sheets, 'Inboxes');
    const aliases = await loadTab(sheets, 'Aliases');

    let coldSent = 0;
    let followupsSent = 0;
    let repliesTotal = 0;
    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;
    let bouncesTotal = 0;
    let uncontacted = 0;

    detailsRows.forEach(r => {
      const status = (r['Sent Status'] || '').toLowerCase();
      const followUpCount = parseInt(r['Follow Up Count'] || '0', 10);
      const sentiment = (r['Next Follow Up Date'] || '').toUpperCase();

      if (!status || status === '') uncontacted++;
      if (status === 'sent' && followUpCount === 0) coldSent++;
      if (followUpCount > 0) followupsSent++;
      if (status === 'bounced') bouncesTotal++;
      if (status === 'replied') {
        repliesTotal++;
        if (sentiment.includes('POSITIVE')) positiveCount++;
        else if (sentiment.includes('NEGATIVE')) negativeCount++;
        else neutralCount++;
      }
    });

    const activeInboxes = inboxes.filter(i => (i.is_active || '').toUpperCase() === 'TRUE').length;
    const activeAliases = aliases.filter(a => (a.is_active || '').toUpperCase() === 'TRUE').length;

    res.json({
      configured: true,
      stats: {
        coldSent,
        followupsSent,
        repliesTotal,
        positiveCount,
        neutralCount,
        negativeCount,
        bouncesTotal,
        uncontacted,
        totalLeads: detailsRows.length,
        activeInboxes,
        activeAliases
      },
      activeTask
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Lead Directory Endpoint
app.get('/api/leads', async (req, res) => {
  const sheets = await getSheets();
  if (!sheets) return res.json({ leads: [] });

  try {
    const detailsRows = await loadTab(sheets, 'Details');
    const search = (req.query.search || '').toLowerCase();
    const statusFilter = (req.query.status || '').toLowerCase();

    let filtered = detailsRows.filter(r => {
      const email = (r['email'] || '').toLowerCase();
      const name = (r['full_name'] || '').toLowerCase();
      const company = (r['company_name'] || '').toLowerCase();
      const status = (r['Sent Status'] || '').toLowerCase();

      const matchesSearch = !search || email.includes(search) || name.includes(search) || company.includes(search);
      const matchesStatus = !statusFilter || 
        (statusFilter === 'uncontacted' && (!status || status === '')) ||
        (statusFilter === status);

      return matchesSearch && matchesStatus;
    });

    res.json({ leads: filtered, total: filtered.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Inboxes & Aliases Health Endpoint
app.get('/api/inboxes', async (req, res) => {
  const sheets = await getSheets();
  if (!sheets) return res.json({ inboxes: [], aliases: [] });

  try {
    const inboxes = await loadTab(sheets, 'Inboxes');
    const aliases = await loadTab(sheets, 'Aliases');
    res.json({ inboxes, aliases });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Trigger Execution Endpoint
app.post('/api/trigger', async (req, res) => {
  const { task } = req.body;
  if (!['outreach', 'followup', 'inbox', 'digest'].includes(task)) {
    return res.status(400).json({ error: 'Invalid task specified.' });
  }

  if (activeTask) {
    return res.status(409).json({ error: `Task [${activeTask}] is currently running.` });
  }

  activeTask = task;
  res.json({ success: true, message: `Triggered ${task} task in background.` });

  (async () => {
    try {
      console.log(`🚀 Starting web dashboard trigger: ${task}`);
      if (task === 'outreach') await runColdOutreach();
      else if (task === 'followup') await runFollowups();
      else if (task === 'inbox') await runInboxChecker();
      else if (task === 'digest') await generateDailyDigest();
    } catch (e) {
      console.error(`Task [${task}] error:`, e.message);
    } finally {
      activeTask = null;
      console.log(`🏁 Background task [${task}] finished.`);
    }
  })();
});

app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`⚡ Sheet-Bot Web Dashboard running at: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});

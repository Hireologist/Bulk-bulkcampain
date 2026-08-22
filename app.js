// GitHub Pages Client-Side State
let sheetId = localStorage.getItem('sheet_bot_sheet_id') || '';
let githubToken = localStorage.getItem('sheet_bot_github_token') || '';
let repoOwner = 'Rohanpatel16';
let repoName = 'Sheet-bot';

let sentimentChartInstance = null;
let statusChartInstance = null;
let allLeads = [];

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEventListeners();
  loadSavedSettings();

  if (sheetId) {
    syncSheetData();
  } else {
    showSettingsTab();
  }

  // Auto-sync every 60 seconds
  setInterval(syncSheetData, 60000);
});

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetTab = item.getAttribute('data-tab');

      navItems.forEach(n => n.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      item.classList.add('active');
      const activeContent = document.getElementById(`tab-${targetTab}`);
      if (activeContent) activeContent.classList.add('active');

      const pageTitle = document.getElementById('page-title');
      if (targetTab === 'overview') pageTitle.innerText = 'Online Performance Dashboard';
      else if (targetTab === 'leads') pageTitle.innerText = 'Lead Directory';
      else if (targetTab === 'inboxes') pageTitle.innerText = 'Inbox & Sender Health';
      else if (targetTab === 'triggers') pageTitle.innerText = 'Cloud Control Center';
      else if (targetTab === 'settings') pageTitle.innerText = 'Cloud Connection Settings';
    });
  });
}

function setupEventListeners() {
  document.getElementById('btn-refresh').addEventListener('click', syncSheetData);
  document.getElementById('btn-open-settings').addEventListener('click', showSettingsTab);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  document.getElementById('lead-search').addEventListener('input', renderLeadsTable);
  document.getElementById('lead-status-filter').addEventListener('change', renderLeadsTable);
}

function loadSavedSettings() {
  if (sheetId) document.getElementById('cfg-sheet-id').value = sheetId;
  if (githubToken) document.getElementById('cfg-github-token').value = githubToken;
}

function showSettingsTab() {
  const settingsItem = document.querySelector('[data-tab="settings"]');
  if (settingsItem) settingsItem.click();
  showAlert('Please enter your Google Sheet ID to connect the online dashboard.', 'blue');
}

function saveSettings() {
  const sId = document.getElementById('cfg-sheet-id').value.trim();
  const token = document.getElementById('cfg-github-token').value.trim();

  if (!sId) {
    alert('Please provide a valid Google Sheet ID.');
    return;
  }

  sheetId = sId;
  githubToken = token;
  localStorage.setItem('sheet_bot_sheet_id', sheetId);
  if (githubToken) localStorage.setItem('sheet_bot_github_token', githubToken);

  alert('✅ Settings saved! Connecting to Google Sheet...');
  document.querySelector('[data-tab="overview"]').click();
  syncSheetData();
}

// 1. Fetch Google Sheet via Client-Side Visualization API
async function fetchSheetTab(tabName) {
  if (!sheetId) return [];
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tabName)}`;

  try {
    const res = await fetch(url);
    const text = await res.text();
    
    // Parse Google GViz JSON envelope
    const jsonString = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const data = JSON.parse(jsonString);
    
    if (!data.table || !data.table.cols || !data.table.rows) return [];

    const headers = data.table.cols.map(c => c.label ? c.label.trim() : '');
    const rows = data.table.rows.map(r => {
      const rowObj = {};
      headers.forEach((h, i) => {
        if (h && r.c && r.c[i]) {
          rowObj[h] = r.c[i].v !== null ? String(r.c[i].v).trim() : '';
        }
      });
      return rowObj;
    });

    return rows;
  } catch (err) {
    console.error(`Error fetching tab [${tabName}]:`, err);
    return [];
  }
}

// 2. Main Sync Engine
async function syncSheetData() {
  if (!sheetId) return;

  showAlert('Syncing live data from Google Sheet cloud...', 'blue');
  
  try {
    const [detailsRows, inboxesRows, aliasesRows] = await Promise.all([
      fetchSheetTab('Details'),
      fetchSheetTab('Inboxes'),
      fetchSheetTab('Aliases')
    ]);

    allLeads = detailsRows;

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

    document.getElementById('stat-cold-sent').innerText = coldSent.toLocaleString();
    document.getElementById('stat-followups-sent').innerText = followupsSent.toLocaleString();
    document.getElementById('stat-replies-total').innerText = repliesTotal.toLocaleString();
    document.getElementById('stat-bounces-total').innerText = bouncesTotal.toLocaleString();

    const totalSent = coldSent + followupsSent;
    const replyRate = totalSent > 0 ? ((repliesTotal / totalSent) * 100).toFixed(1) : '0';
    document.getElementById('stat-reply-rate').innerText = `${replyRate}% response rate`;

    renderCharts({
      coldSent,
      followupsSent,
      repliesTotal,
      positiveCount,
      neutralCount,
      negativeCount,
      bouncesTotal,
      uncontacted
    });

    renderLeadsTable();
    renderInboxes(inboxesRows);

    document.getElementById('connection-status-text').innerText = 'Connected';
    document.getElementById('status-dot').className = 'status-indicator online';
    showAlert(`Connected to Google Sheet (${detailsRows.length} total leads loaded).`, 'green');
  } catch (err) {
    document.getElementById('connection-status-text').innerText = 'Error';
    document.getElementById('status-dot').className = 'status-indicator offline';
    showAlert(`Could not connect to Google Sheet. Make sure your Sheet is shared as "Anyone with link can view".`, 'red');
  }
}

// 3. Render Charts
function renderCharts(stats) {
  const sentimentCtx = document.getElementById('sentimentChart')?.getContext('2d');
  if (sentimentCtx) {
    if (sentimentChartInstance) sentimentChartInstance.destroy();
    
    sentimentChartInstance = new Chart(sentimentCtx, {
      type: 'doughnut',
      data: {
        labels: ['Positive 🔥', 'Neutral 💬', 'Negative ❌'],
        datasets: [{
          data: [stats.positiveCount, stats.neutralCount, stats.negativeCount],
          backgroundColor: ['#10B981', '#3B82F6', '#EF4444'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94A3B8', padding: 20 } }
        },
        cutout: '70%'
      }
    });
  }

  const statusCtx = document.getElementById('statusChart')?.getContext('2d');
  if (statusCtx) {
    if (statusChartInstance) statusChartInstance.destroy();

    statusChartInstance = new Chart(statusCtx, {
      type: 'bar',
      data: {
        labels: ['Queue', 'Cold Sent', 'Followed Up', 'Replied', 'Bounced'],
        datasets: [{
          label: 'Leads',
          data: [
            stats.uncontacted,
            stats.coldSent,
            stats.followupsSent,
            stats.repliesTotal,
            stats.bouncesTotal
          ],
          backgroundColor: ['#64748B', '#3B82F6', '#8B5CF6', '#10B981', '#EF4444'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { ticks: { color: '#94A3B8' }, grid: { display: false } },
          y: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }
}

// 4. Render Lead Table
function renderLeadsTable() {
  const search = document.getElementById('lead-search').value.toLowerCase();
  const statusFilter = document.getElementById('lead-status-filter').value.toLowerCase();
  const tbody = document.getElementById('leads-table-body');

  const filtered = allLeads.filter(r => {
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

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-td">No matching prospects found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(row => {
    const name = row['full_name'] || 'N/A';
    const email = row['email'] || '';
    const company = row['company_name'] || '—';
    const location = row['location'] || '—';
    const status = (row['Sent Status'] || 'Queue').toUpperCase();
    const sentFrom = row['Sent From'] || '—';
    const followUpCount = row['Follow Up Count'] || '0';
    const dateSent = row['Date Sent'] || row['Time'] || '—';

    let badgeClass = 'badge-queue';
    if (status === 'SENT') badgeClass = 'badge-sent';
    else if (status === 'REPLIED') badgeClass = 'badge-replied';
    else if (status === 'BOUNCED') badgeClass = 'badge-bounced';

    return `
      <tr>
        <td>
          <strong style="color:#FFF;">${escapeHtml(name)}</strong><br>
          <span style="color:#94A3B8; font-size:12px;">${escapeHtml(email)}</span>
        </td>
        <td>${escapeHtml(company)}</td>
        <td>${escapeHtml(location)}</td>
        <td><span class="badge ${badgeClass}">${status}</span></td>
        <td style="font-size:12px; color:#94A3B8;">${escapeHtml(sentFrom)}</td>
        <td>#${followUpCount}</td>
        <td style="font-size:12px; color:#94A3B8;">${escapeHtml(dateSent)}</td>
      </tr>
    `;
  }).join('');
}

// 5. Render Inboxes
function renderInboxes(inboxes) {
  const container = document.getElementById('inboxes-container');

  if (!inboxes || !inboxes.length) {
    container.innerHTML = `
      <div class="glass-card full-width">
        <p><i class="fa-solid fa-circle-exclamation"></i> No active inboxes found in Google Sheet.</p>
      </div>`;
    return;
  }

  container.innerHTML = inboxes.map(ib => {
    const email = ib.email || ib.smtp_user || 'Inbox';
    const name = ib.display_name || email.split('@')[0];
    const limit = ib.daily_limit || '50';
    const active = String(ib.is_active || '').toUpperCase() === 'TRUE';

    return `
      <div class="glass-card inbox-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h4><i class="fa-solid fa-paper-plane" style="color:var(--accent-blue);"></i> ${escapeHtml(name)}</h4>
          <span class="badge ${active ? 'badge-replied' : 'badge-bounced'}">${active ? 'Active' : 'Disabled'}</span>
        </div>
        <p class="inbox-meta">${escapeHtml(email)}</p>
        <div style="font-size:13px; color:var(--text-muted); display:flex; justify-content:space-between;">
          <span>Daily Limit:</span>
          <strong style="color:#FFF;">${limit} emails/day</strong>
        </div>
      </div>
    `;
  }).join('');
}

// 6. GitHub Actions Cloud Workflow Trigger
async function triggerGitHubAction(taskName) {
  if (!githubToken) {
    const token = prompt('Enter your GitHub Personal Access Token (PAT) to trigger workflows directly online:');
    if (token) {
      githubToken = token.trim();
      localStorage.setItem('sheet_bot_github_token', githubToken);
    } else {
      alert('GitHub Personal Access Token is required to trigger cloud workflows.');
      return;
    }
  }

  showAlert(`Dispatching cloud trigger [${taskName}] to GitHub Actions...`, 'blue');

  try {
    const url = `https://api.github.com/repos/${repoOwner}/${repoName}/actions/workflows/outreach.yml/dispatches`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${githubToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { action: taskName }
      })
    });

    if (res.ok || res.status === 204) {
      showAlert(`🚀 Successfully triggered [${taskName}] on GitHub Actions cloud! Engine is now executing.`, 'green');
    } else {
      const errData = await res.json().catch(() => ({}));
      alert(`GitHub Dispatch Error: ${errData.message || res.statusText}`);
    }
  } catch (err) {
    alert(`Failed to connect to GitHub API: ${err.message}`);
  }
}

function showAlert(msg, type = 'blue') {
  const alertBanner = document.getElementById('alert-banner');
  alertBanner.classList.remove('hidden');
  document.getElementById('alert-message').innerText = msg;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

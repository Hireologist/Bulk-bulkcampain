// Multi-Campaign Client State
let campaigns = JSON.parse(localStorage.getItem('sheet_bot_campaigns') || '[]');
let activeCampaignId = localStorage.getItem('sheet_bot_active_campaign') || '';

let githubToken = localStorage.getItem('sheet_bot_github_token') || '';
let repoOwner = 'Rohanpatel16';
let repoName = 'Sheet-bot';

let sentimentChartInstance = null;
let statusChartInstance = null;
let allLeads = [];

// Seed Default Campaign if empty
if (!campaigns.length) {
  const legacySheetId = localStorage.getItem('sheet_bot_sheet_id') || '';
  campaigns = [{
    id: 'c_default',
    name: 'Campaign 1 (Default)',
    sheetId: legacySheetId
  }];
  activeCampaignId = 'c_default';
  saveCampaignsState();
} else if (!activeCampaignId || !campaigns.find(c => c.id === activeCampaignId)) {
  activeCampaignId = campaigns[0].id;
  localStorage.setItem('sheet_bot_active_campaign', activeCampaignId);
}

function saveCampaignsState() {
  localStorage.setItem('sheet_bot_campaigns', JSON.stringify(campaigns));
  localStorage.setItem('sheet_bot_active_campaign', activeCampaignId);
}

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEventListeners();
  renderCampaignSelector();
  renderCampaignsList();
  loadSavedSettings();

  const currentCamp = getCurrentCampaign();
  if (currentCamp && currentCamp.sheetId) {
    syncSheetData();
  } else {
    showSettingsTab();
    showAlert('⚠️ Please enter your Google Sheet ID string below to load your data.', 'orange');
  }

  // Auto-sync every 60 seconds
  setInterval(syncSheetData, 60000);
});

function getCurrentCampaign() {
  return campaigns.find(c => c.id === activeCampaignId) || campaigns[0];
}

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
      else if (targetTab === 'settings') pageTitle.innerText = 'Campaigns & Connect Settings';
    });
  });
}

function setupEventListeners() {
  document.getElementById('btn-refresh').addEventListener('click', syncSheetData);
  document.getElementById('btn-open-settings').addEventListener('click', showSettingsTab);
  
  document.getElementById('btn-add-campaign').addEventListener('click', addCampaign);
  document.getElementById('campaign-selector').addEventListener('change', (e) => {
    activeCampaignId = e.target.value;
    saveCampaignsState();
    syncSheetData();
  });

  document.getElementById('btn-save-token').addEventListener('click', saveToken);

  document.getElementById('lead-search').addEventListener('input', renderLeadsTable);
  document.getElementById('lead-status-filter').addEventListener('change', renderLeadsTable);
}

function renderCampaignSelector() {
  const select = document.getElementById('campaign-selector');
  select.innerHTML = campaigns.map(c => 
    `<option value="${c.id}" ${c.id === activeCampaignId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');
}

function renderCampaignsList() {
  const container = document.getElementById('campaigns-list');
  if (!container) return;

  if (!campaigns.length) {
    container.innerHTML = `<p style="font-size:13px; color:var(--text-muted);">No saved campaigns yet.</p>`;
    return;
  }

  container.innerHTML = campaigns.map(c => `
    <div class="campaign-item">
      <div>
        <strong style="color:#FFF;">${escapeHtml(c.name)}</strong><br>
        <span style="font-size:12px; color:var(--text-muted);">Sheet ID: ${escapeHtml(c.sheetId || 'Not set')}</span>
      </div>
      <button class="btn-danger-sm" onclick="deleteCampaign('${c.id}')">
        <i class="fa-solid fa-trash"></i> Delete
      </button>
    </div>
  `).join('');
}

function addCampaign() {
  const nameInput = document.getElementById('cfg-new-campaign-name');
  const sheetInput = document.getElementById('cfg-new-sheet-id');

  const name = nameInput.value.trim();
  let sheetId = sheetInput.value.trim();

  // Extract ID if full URL pasted
  if (sheetId.includes('/spreadsheets/d/')) {
    sheetId = sheetId.split('/spreadsheets/d/')[1].split('/')[0];
  }

  if (!name || !sheetId) {
    alert('Please enter both a Campaign Name and a valid Google Sheet ID.');
    return;
  }

  const newId = 'c_' + Date.now();
  campaigns.push({ id: newId, name, sheetId });
  activeCampaignId = newId;
  saveCampaignsState();

  nameInput.value = '';
  sheetInput.value = '';

  renderCampaignSelector();
  renderCampaignsList();

  alert(`✅ Campaign "${name}" added and activated!`);
  document.querySelector('[data-tab="overview"]').click();
  syncSheetData();
}

function deleteCampaign(id) {
  if (campaigns.length <= 1) {
    alert('You must have at least one active campaign.');
    return;
  }

  if (confirm('Are you sure you want to remove this campaign sheet?')) {
    campaigns = campaigns.filter(c => c.id !== id);
    if (activeCampaignId === id) {
      activeCampaignId = campaigns[0].id;
    }
    saveCampaignsState();
    renderCampaignSelector();
    renderCampaignsList();
    syncSheetData();
  }
}

function loadSavedSettings() {
  if (githubToken) document.getElementById('cfg-github-token').value = githubToken;
}

function showSettingsTab() {
  const settingsItem = document.querySelector('[data-tab="settings"]');
  if (settingsItem) settingsItem.click();
}

function saveToken() {
  const token = document.getElementById('cfg-github-token').value.trim();
  githubToken = token;
  if (githubToken) {
    localStorage.setItem('sheet_bot_github_token', githubToken);
    alert('✅ GitHub Access Token saved successfully!');
  } else {
    localStorage.removeItem('sheet_bot_github_token');
    alert('Token cleared.');
  }
}

// -------------------------------------------------------------
// 🔮 DUAL-FETCH PARSER (GViz JSON + CSV Fallback)
// -------------------------------------------------------------
async function fetchSheetTab(sheetId, tabName) {
  if (!sheetId) return [];

  // A. Try GViz JSON Endpoint
  try {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tabName)}`;
    const res = await fetch(url);
    const text = await res.text();
    
    if (text.includes('google.visualization.Query.setResponse')) {
      const jsonString = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
      const data = JSON.parse(jsonString);
      
      if (data.table && data.table.cols && data.table.rows && data.table.rows.length > 0) {
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

        if (rows.length > 0) return rows;
      }
    }
  } catch (e) {
    console.warn(`GViz fetch failed for [${tabName}], falling back to CSV export...`, e);
  }

  // B. Fallback to CSV Export Endpoint
  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
    const csvRes = await fetch(csvUrl);
    if (csvRes.ok) {
      const csvText = await csvRes.text();
      const rows = parseCSV(csvText);
      if (rows.length > 0) return rows;
    }
  } catch (e) {
    console.warn(`CSV fallback failed for [${tabName}]`, e);
  }

  // C. Fallback to /export?format=csv
  try {
    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&sheet=${encodeURIComponent(tabName)}`;
    const expRes = await fetch(exportUrl);
    if (expRes.ok) {
      const csvText = await expRes.text();
      return parseCSV(csvText);
    }
  } catch (e) {
    console.error(`All fetch methods failed for [${tabName}]`, e);
  }

  return [];
}

// Custom CSV Parser
function parseCSV(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  
  const parseLine = (line) => {
    const result = [];
    let start = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        inQuotes = !inQuotes;
      } else if (line[i] === ',' && !inQuotes) {
        let val = line.substring(start, i).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        result.push(val);
        start = i + 1;
      }
    }
    let val = line.substring(start).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    result.push(val);
    return result;
  };

  const headers = parseLine(lines[0]).map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = (values[idx] || '').trim();
    });
    rows.push(obj);
  }

  return rows;
}

// -------------------------------------------------------------
// 🔄 MAIN SYNC ENGINE
// -------------------------------------------------------------
async function syncSheetData() {
  const currentCamp = getCurrentCampaign();
  if (!currentCamp || !currentCamp.sheetId) {
    showAlert('⚠️ No Google Sheet ID set. Click "Campaigns & Connect" to enter your Sheet ID.', 'orange');
    document.getElementById('leads-table-body').innerHTML = `
      <tr>
        <td colspan="7" class="loading-td">
          ⚠️ <strong>Google Sheet ID string is empty.</strong><br>
          <button class="btn btn-primary" onclick="showSettingsTab()" style="margin-top:12px;">
            <i class="fa-solid fa-plus"></i> Configure Google Sheet ID
          </button>
        </td>
      </tr>`;
    return;
  }

  showAlert(`Syncing [${currentCamp.name}] from Google Sheet...`, 'blue');
  
  try {
    const [detailsRows, inboxesRows, aliasesRows] = await Promise.all([
      fetchSheetTab(currentCamp.sheetId, 'Details'),
      fetchSheetTab(currentCamp.sheetId, 'Inboxes'),
      fetchSheetTab(currentCamp.sheetId, 'Aliases')
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

    // Helper for case-insensitive lookup
    const getVal = (row, keyName) => {
      const target = keyName.toLowerCase();
      const foundKey = Object.keys(row).find(k => k.toLowerCase() === target);
      return foundKey ? row[foundKey] : '';
    };

    detailsRows.forEach(r => {
      const status = getVal(r, 'Sent Status').toLowerCase();
      const followUpCount = parseInt(getVal(r, 'Follow Up Count') || '0', 10);
      const sentiment = getVal(r, 'Next Follow Up Date').toUpperCase();

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

    if (detailsRows.length > 0) {
      document.getElementById('connection-status-text').innerText = 'Connected';
      document.getElementById('status-dot').className = 'status-indicator online';
      showAlert(`Connected to [${currentCamp.name}] (${detailsRows.length} total leads loaded).`, 'green');
    } else {
      document.getElementById('connection-status-text').innerText = '0 Leads';
      document.getElementById('status-dot').className = 'status-indicator offline';
      showAlert(`⚠️ Connected to Sheet ID [${currentCamp.sheetId}], but 0 rows were found in "Details" tab. Make sure your Google Sheet is shared as "Anyone with the link can view".`, 'orange');
    }
  } catch (err) {
    document.getElementById('connection-status-text').innerText = 'Error';
    document.getElementById('status-dot').className = 'status-indicator offline';
    showAlert(`Could not connect to Google Sheet. Make sure your Sheet is shared as "Anyone with link can view".`, 'red');
  }
}

// 4. Render Charts
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

// Helper for Case-Insensitive Object Key Lookup
function getVal(row, keyName) {
  if (!row) return '';
  const target = keyName.toLowerCase();
  const foundKey = Object.keys(row).find(k => k.toLowerCase() === target);
  return foundKey ? row[foundKey] : '';
}

// 5. Render Lead Table
function renderLeadsTable() {
  const search = document.getElementById('lead-search').value.toLowerCase();
  const statusFilter = document.getElementById('lead-status-filter').value.toLowerCase();
  const tbody = document.getElementById('leads-table-body');

  const filtered = allLeads.filter(r => {
    const email = getVal(r, 'email').toLowerCase();
    const name = getVal(r, 'full_name').toLowerCase();
    const company = getVal(r, 'company_name').toLowerCase();
    const status = getVal(r, 'Sent Status').toLowerCase();

    const matchesSearch = !search || email.includes(search) || name.includes(search) || company.includes(search);
    const matchesStatus = !statusFilter || 
      (statusFilter === 'uncontacted' && (!status || status === '')) ||
      (statusFilter === status);

    return matchesSearch && matchesStatus;
  });

  if (!filtered.length) {
    if (!allLeads.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="loading-td">
            ⚠️ <strong>No prospects found in this Google Sheet.</strong><br>
            Please make sure your Google Sheet is shared as <strong>"Anyone with the link can view"</strong>!
          </td>
        </tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="7" class="loading-td">No matching prospects found for your search filter.</td></tr>`;
    }
    return;
  }

  tbody.innerHTML = filtered.map(row => {
    const name = getVal(row, 'full_name') || 'N/A';
    const email = getVal(row, 'email') || '';
    const company = getVal(row, 'company_name') || '—';
    const location = getVal(row, 'location') || '—';
    const status = (getVal(row, 'Sent Status') || 'Queue').toUpperCase();
    const sentFrom = getVal(row, 'Sent From') || '—';
    const followUpCount = getVal(row, 'Follow Up Count') || '0';
    const dateSent = getVal(row, 'Date Sent') || getVal(row, 'Time') || '—';

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

// 6. Render Inboxes
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
    const email = getVal(ib, 'email') || getVal(ib, 'smtp_user') || 'Inbox';
    const name = getVal(ib, 'display_name') || email.split('@')[0];
    const limit = getVal(ib, 'daily_limit') || '50';
    const active = String(getVal(ib, 'is_active')).toUpperCase() === 'TRUE';

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

// 7. GitHub Actions Cloud Workflow Trigger
async function triggerGitHubAction(taskName) {
  if (!githubToken) {
    const token = prompt('Enter your GitHub Personal Access Token (PAT) with "Actions: Read & Write" permission:');
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
      showAlert(`🚀 Successfully triggered [${taskName}] on GitHub Actions cloud! Engine is executing.`, 'green');
    } else {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 403 || res.status === 404 || errData.message?.includes('Resource not accessible')) {
        alert(`⚠️ GitHub Token Error: "${errData.message || res.statusText}".\n\nFix: Make sure your GitHub Token has "Actions: Read and Write" permissions (or "repo" scope) under GitHub > Settings > Developer Settings > Personal Access Tokens!`);
      } else {
        alert(`GitHub API Error: ${errData.message || res.statusText}`);
      }
    }
  } catch (err) {
    alert(`Failed to connect to GitHub API: ${err.message}`);
  }
}

// 8. Single Lead Instant GitHub Dispatcher
async function triggerSingleLeadGitHubAction() {
  const emailInput = document.getElementById('single-lead-email');
  const email = (emailInput ? emailInput.value : '').trim();

  if (!email) {
    alert('Please enter a recipient email address.');
    return;
  }

  const name = (document.getElementById('single-lead-name')?.value || '').trim();
  const company = (document.getElementById('single-lead-company')?.value || '').trim();
  const location = (document.getElementById('single-lead-location')?.value || '').trim();

  if (!githubToken) {
    const token = prompt('Enter your GitHub Personal Access Token (PAT) with "Actions: Read & Write" permission:');
    if (token) {
      githubToken = token.trim();
      localStorage.setItem('sheet_bot_github_token', githubToken);
    } else {
      alert('GitHub Personal Access Token is required to trigger cloud workflows.');
      return;
    }
  }

  showAlert(`Dispatching single lead email for [${email}] to GitHub Actions...`, 'blue');

  try {
    const url = `https://api.github.com/repos/${repoOwner}/${repoName}/dispatches`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${githubToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event_type: 'send_single_email',
        client_payload: {
          email,
          full_name: name,
          company_name: company,
          location
        }
      })
    });

    if (res.ok || res.status === 204) {
      showAlert(`🚀 Successfully dispatched instant email for [${email}] via GitHub Actions!`, 'green');
      if (emailInput) emailInput.value = '';
    } else {
      const errData = await res.json().catch(() => ({}));
      alert(`GitHub API Error: ${errData.message || res.statusText}`);
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

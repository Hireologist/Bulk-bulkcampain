// Dashboard State
let sentimentChartInstance = null;
let statusChartInstance = null;
let allLeads = [];

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEventListeners();
  loadDashboardData();
  
  // Auto-refresh every 30 seconds
  setInterval(loadDashboardData, 30000);
});

// Tab Navigation
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

      // Update Header Title
      const pageTitle = document.getElementById('page-title');
      if (targetTab === 'overview') pageTitle.innerText = 'Overview Dashboard';
      else if (targetTab === 'leads') pageTitle.innerText = 'Lead Directory';
      else if (targetTab === 'inboxes') pageTitle.innerText = 'Inbox & Sender Health';
      else if (targetTab === 'triggers') pageTitle.innerText = 'Control Center';
    });
  });
}

// Event Listeners
function setupEventListeners() {
  document.getElementById('btn-refresh').addEventListener('click', loadDashboardData);
  document.getElementById('btn-quick-outreach').addEventListener('click', () => runTrigger('outreach'));

  // Lead Search & Filter
  document.getElementById('lead-search').addEventListener('input', renderLeadsTable);
  document.getElementById('lead-status-filter').addEventListener('change', renderLeadsTable);
}

// Main Data Fetcher
async function loadDashboardData() {
  await Promise.all([
    fetchStats(),
    fetchLeads(),
    fetchInboxes()
  ]);
}

// 1. Fetch Stats & Render Charts
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();

    const alertBanner = document.getElementById('alert-banner');
    if (!data.configured) {
      alertBanner.classList.remove('hidden');
      document.getElementById('alert-message').innerText = data.message;
    } else if (data.activeTask) {
      alertBanner.classList.remove('hidden');
      document.getElementById('alert-message').innerText = `⚡ Background engine task [${data.activeTask}] is currently executing...`;
    } else {
      alertBanner.classList.add('hidden');
    }

    const stats = data.stats || {};
    document.getElementById('stat-cold-sent').innerText = (stats.coldSent || 0).toLocaleString();
    document.getElementById('stat-followups-sent').innerText = (stats.followupsSent || 0).toLocaleString();
    document.getElementById('stat-replies-total').innerText = (stats.repliesTotal || 0).toLocaleString();
    document.getElementById('stat-bounces-total').innerText = (stats.bouncesTotal || 0).toLocaleString();

    // Reply Rate calculation
    const totalSent = (stats.coldSent || 0) + (stats.followupsSent || 0);
    const replyRate = totalSent > 0 ? ((stats.repliesTotal / totalSent) * 100).toFixed(1) : '0';
    document.getElementById('stat-reply-rate').innerText = `${replyRate}% response rate`;

    renderCharts(stats);
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// 2. Render Charts
function renderCharts(stats) {
  // A. Sentiment Donut Chart
  const sentimentCtx = document.getElementById('sentimentChart')?.getContext('2d');
  if (sentimentCtx) {
    if (sentimentChartInstance) sentimentChartInstance.destroy();
    
    sentimentChartInstance = new Chart(sentimentCtx, {
      type: 'doughnut',
      data: {
        labels: ['Positive 🔥', 'Neutral 💬', 'Negative ❌'],
        datasets: [{
          data: [stats.positiveCount || 0, stats.neutralCount || 0, stats.negativeCount || 0],
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

  // B. Status Distribution Bar Chart
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
            stats.uncontacted || 0,
            stats.coldSent || 0,
            stats.followupsSent || 0,
            stats.repliesTotal || 0,
            stats.bouncesTotal || 0
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

// 3. Fetch & Render Lead Directory
async function fetchLeads() {
  try {
    const res = await fetch('/api/leads');
    const data = await res.json();
    allLeads = data.leads || [];
    renderLeadsTable();
  } catch (err) {
    console.error('Failed to load leads:', err);
  }
}

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

// 4. Fetch Inboxes & Aliases
async function fetchInboxes() {
  try {
    const res = await fetch('/api/inboxes');
    const data = await res.json();
    const container = document.getElementById('inboxes-container');

    const inboxes = data.inboxes || [];
    const aliases = data.aliases || [];

    if (!inboxes.length) {
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
      const active = (ib.is_active || '').toUpperCase() === 'TRUE';

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
  } catch (err) {
    console.error('Failed to load inboxes:', err);
  }
}

// Helper: Run Task Trigger
async function runTrigger(taskName) {
  try {
    const res = await fetch('/api/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: taskName })
    });
    const data = await res.json();

    if (data.error) {
      alert(`⚠️ ${data.error}`);
    } else {
      const alertBanner = document.getElementById('alert-banner');
      alertBanner.classList.remove('hidden');
      document.getElementById('alert-message').innerText = `🚀 Triggered [${taskName}] task. Engine is running in the background...`;
      setTimeout(loadDashboardData, 2000);
    }
  } catch (err) {
    alert(`Failed to execute trigger: ${err.message}`);
  }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

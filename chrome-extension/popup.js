// ============================================================================
// 🛠️ PARSER UTILITIES (Google Sheet Formula Translations)
// ============================================================================

const PUBLIC_DOMAINS = new Set([
  'gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'protonmail',
  'aol', 'rediffmail', 'zoho', 'live', 'msn', 'gmx', 'yandex', 'mail'
]);

// 1. Name Extractor from Email
function extractNameFromEmail(email) {
  if (!email || typeof email !== 'string') return 'Team';
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes('@')) return 'Team';

  const prefix = trimmed.split('@')[0];
  const cleanPrefix = prefix.replace(/[\._\-]/g, ' ').trim();
  const firstWord = cleanPrefix.split(/\s+/)[0] || '';

  const roleRegex = /^(hr\d*|hrd\d*|info\d*|careers?|talenthr|talent|recruiters?|recruitment|jobs?|contact|support|sales|admin|hello|team|apply|marketing|career|gm|ceo|founder|director)$/i;

  if (!firstWord || roleRegex.test(firstWord)) {
    return 'Team';
  }

  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
}

// 2. Company Extractor from Email Domain
function extractCompanyFromEmail(email) {
  if (!email || typeof email !== 'string') return 'Your Company';
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes('@')) return 'Your Company';

  const domainPart = trimmed.split('@')[1] || '';
  const domainName = domainPart.split('.')[0] || '';

  if (!domainName || PUBLIC_DOMAINS.has(domainName)) {
    return 'Your Company';
  }

  // A. Replace hyphens with space
  let clean = domainName.replace(/-/g, ' ');

  // B. Add space between letters and numbers
  clean = clean.replace(/([a-zA-Z])([0-9])/g, '$1 $2').replace(/([0-9])([a-zA-Z])/g, '$1 $2');

  // C. Remove trailing corporate/generic suffix words
  const suffixRegex = /\s*(events|communications|professionals|organizations|technologies|entertainment|international|collaborators|corporations|institutions|associations|destinations|diagnostics|engineering|hospitality|investments|management|healthcare|consulting|technology|associates|properties|businesses|structures|innovations|foundations|communities|developers|architects|specialists|instructors|consultants|logistics|analytics|solutions|marketing|packaging|education|financial|insurance|machinery|university|productions|enterprises|australia|realestate|milestone|polymers|engineers|hospitals|builders|partners|sciences|ventures|services|software|agencies|networks|holdings|creators|systems|advisors|wellness|holidays|families|mahindra|solution|institute|infotech|capital|digital|hospital|clothing|commerce|research|vacations|journeys|adventures|companies|societies|teachers|trainers|educators|family|group|global|pharma|energy|realty|spaces|hotels|travel|school|medical|health|clinics|fitness|sports|gaming|studios|records|fashion|apparel|retail|bazaar|market|fintech|wealth|nature|village|building|bridge|street|avenue|square|garden|estate|places|locations|designs|crafts|trusts|friends|allies|makers|artists|writers|leaders|mentors|coaches|guides|people|humans|support|tech|soft|india|media|power|infra|tours|music|store|shop|bank|world|europe|america|africa|pacific|atlantic|dairy|tower|drive|lane|court|plaza|trips|clubs|teams|llc|ltd|pvt|inc)$/gi;

  clean = clean.replace(suffixRegex, '').trim();
  if (!clean) clean = domainName;

  return clean.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// Extract emails from raw block of text / CSV
function parseEmailsFromText(text) {
  if (!text) return [];
  const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(regex) || [];
  return [...new Set(matches.map(e => e.trim().toLowerCase()))];
}

// ============================================================================
// 🚀 EXTENSION LOGIC & STORAGE MANAGERS
// ============================================================================

let config = {
  token: '',
  owner: '',
  repo: ''
};

let campaigns = [];
let activeCampaignId = 'default';
let bulkLeads = [];

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadSettings();
  setupSingleLeadEvents();
  setupBulkLeadEvents();
  setupSettingsEvents();
});

// Tab Switcher
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      const target = btn.getAttribute('data-tab');
      document.getElementById(`tab-${target}`).classList.add('active');
    });
  });
}

// Load settings from chrome.storage.local
function loadSettings() {
  chrome.storage.local.get([
    'sheet_bot_token', 'sheet_bot_owner', 'sheet_bot_repo', 
    'sheet_bot_campaigns', 'sheet_bot_active_camp_id'
  ], (res) => {
    config.token = res.sheet_bot_token || '';
    config.owner = res.sheet_bot_owner || '';
    config.repo = res.sheet_bot_repo || '';
    
    campaigns = res.sheet_bot_campaigns || [
      { id: 'default', name: 'Campaign 1 (Default)', sheetId: '', webhookUrl: '', location: 'India' }
    ];
    activeCampaignId = res.sheet_bot_active_camp_id || campaigns[0].id;

    document.getElementById('cfg-github-token').value = config.token;
    document.getElementById('cfg-github-owner').value = config.owner;
    document.getElementById('cfg-github-repo').value = config.repo;

    renderCampaignDropdown();
    renderCampaignsList();
    updateStatusTag();
  });
}

function renderCampaignDropdown() {
  const dropdown = document.getElementById('campaign-select-dropdown');
  if (!dropdown) return;

  dropdown.innerHTML = campaigns.map(c => 
    `<option value="${escapeHtml(c.id)}" ${c.id === activeCampaignId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');

  dropdown.onchange = (e) => {
    activeCampaignId = e.target.value;
    chrome.storage.local.set({ sheet_bot_active_camp_id: activeCampaignId });
    const activeCamp = getActiveCampaign();
    showAlert(`Switched to active campaign: ${activeCamp.name}`, 'info');
  };
}

function getActiveCampaign() {
  return campaigns.find(c => c.id === activeCampaignId) || campaigns[0] || { name: 'Default', sheetId: '', webhookUrl: '', location: 'India' };
}

function renderCampaignsList() {
  const container = document.getElementById('campaigns-list-container');
  if (!container) return;

  if (campaigns.length === 0) {
    container.innerHTML = '<div style="font-size:11px; color:var(--text-muted);">No saved campaign profiles.</div>';
    return;
  }

  container.innerHTML = campaigns.map(c => `
    <div style="background:rgba(255,255,255,0.03); border:1px solid var(--card-border); padding:8px 10px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <strong style="color:#FFF; font-size:11px;">${escapeHtml(c.name)}</strong>
        <div style="font-size:10px; color:var(--text-muted);">
          Sheet: ${escapeHtml(c.sheetId ? c.sheetId.substring(0, 14) + '...' : 'Default')}
        </div>
      </div>
      <button class="btn btn-secondary btn-del-camp" data-id="${escapeHtml(c.id)}" style="width:auto; padding:3px 8px; font-size:10px; background:rgba(239,68,68,0.2); color:#FCA5A5;">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-del-camp').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (campaigns.length <= 1) {
        showAlert('You must keep at least one campaign profile.', 'error');
        return;
      }
      campaigns = campaigns.filter(c => c.id !== id);
      if (activeCampaignId === id) activeCampaignId = campaigns[0].id;

      chrome.storage.local.set({ sheet_bot_campaigns: campaigns, sheet_bot_active_camp_id: activeCampaignId }, () => {
        renderCampaignDropdown();
        renderCampaignsList();
        showAlert('Campaign profile removed.', 'info');
      });
    });
  });
}

function updateStatusTag() {
  const statusTag = document.getElementById('status-tag');
  if (config.token && config.owner && config.repo) {
    statusTag.innerText = 'Connected';
    statusTag.className = 'status-tag';
  } else {
    statusTag.innerText = 'Setup Token';
    statusTag.className = 'status-tag unconfigured';
  }
}

// Alert banner display
function showAlert(msg, type = 'info') {
  const banner = document.getElementById('alert-banner');
  const text = document.getElementById('alert-text');
  const icon = document.getElementById('alert-icon');

  banner.className = `alert alert-${type}`;
  text.innerText = msg;

  if (type === 'error') icon.className = 'fa-solid fa-circle-exclamation';
  else if (type === 'success') icon.className = 'fa-solid fa-circle-check';
  else icon.className = 'fa-solid fa-circle-info';
}

// ----------------------------------------------------------------------------
// SINGLE LEAD DISPATCHER
// ----------------------------------------------------------------------------
function setupSingleLeadEvents() {
  const emailInput = document.getElementById('single-email');
  const nameInput = document.getElementById('single-name');
  const companyInput = document.getElementById('single-company');
  const locInput = document.getElementById('single-location');
  const prevName = document.getElementById('prev-name');
  const prevCompany = document.getElementById('prev-company');
  const btnSend = document.getElementById('btn-send-single');

  emailInput.addEventListener('input', () => {
    const val = emailInput.value.trim();
    if (val && val.includes('@')) {
      const parsedName = extractNameFromEmail(val);
      const parsedCompany = extractCompanyFromEmail(val);

      nameInput.value = parsedName;
      companyInput.value = parsedCompany;
      prevName.innerText = parsedName;
      prevCompany.innerText = parsedCompany;
    } else {
      prevName.innerText = '—';
      prevCompany.innerText = '—';
    }
  });

  btnSend.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) {
      showAlert('Please enter a recipient email address.', 'error');
      return;
    }

    if (!config.token || !config.owner || !config.repo) {
      showAlert('Please configure your GitHub Token, Owner, and Repo in Settings tab first!', 'error');
      document.querySelector('[data-tab="settings"]').click();
      return;
    }

    const activeCamp = getActiveCampaign();
    const fullName = nameInput.value.trim() || extractNameFromEmail(email);
    const companyName = companyInput.value.trim() || extractCompanyFromEmail(email);
    const location = locInput.value.trim() || activeCamp.location || 'your city';

    btnSend.disabled = true;
    btnSend.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Dispatching...';
    showAlert(`Dispatching email for [${email}] [Campaign: ${activeCamp.name}]...`, 'info');

    try {
      const success = await dispatchToGitHub({
        email,
        full_name: fullName,
        company_name: companyName,
        location,
        spreadsheet_id: activeCamp.sheetId,
        webhook_url: activeCamp.webhookUrl
      });

      if (success) {
        showAlert(`🚀 Email for [${email}] dispatched successfully to GitHub!`, 'success');
        emailInput.value = '';
        nameInput.value = '';
        companyInput.value = '';
        locInput.value = '';
        prevName.innerText = '—';
        prevCompany.innerText = '—';
      }
    } catch (err) {
      showAlert(`GitHub Dispatch Error: ${err.message}`, 'error');
    } finally {
      btnSend.disabled = false;
      btnSend.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Instant Email';
    }
  });
}

// ----------------------------------------------------------------------------
// BULK BATCH DISPATCHER
// ----------------------------------------------------------------------------
function setupBulkLeadEvents() {
  const bulkInput = document.getElementById('bulk-input');
  const btnParse = document.getElementById('btn-parse-bulk');
  const bulkCount = document.getElementById('bulk-count');
  const bulkTbody = document.getElementById('bulk-tbody');
  const btnSendBulk = document.getElementById('btn-send-bulk');

  const parseAndRender = () => {
    const raw = bulkInput.value;
    const emails = parseEmailsFromText(raw);
    const activeCamp = getActiveCampaign();

    bulkLeads = emails.map(email => ({
      email,
      full_name: extractNameFromEmail(email),
      company_name: extractCompanyFromEmail(email),
      location: activeCamp.location || 'your city',
      spreadsheet_id: activeCamp.sheetId,
      webhook_url: activeCamp.webhookUrl
    }));

    bulkCount.innerText = bulkLeads.length;

    if (bulkLeads.length === 0) {
      bulkTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:16px;">Paste emails above and click "Parse List".</td></tr>`;
      btnSendBulk.disabled = true;
      return;
    }

    bulkTbody.innerHTML = bulkLeads.map(item => `
      <tr>
        <td><strong>${escapeHtml(item.email)}</strong></td>
        <td><span style="color:var(--accent-purple);">${escapeHtml(item.full_name)}</span></td>
        <td><span style="color:var(--accent-blue);">${escapeHtml(item.company_name)}</span></td>
      </tr>
    `).join('');

    btnSendBulk.disabled = false;
  };

  btnParse.addEventListener('click', parseAndRender);
  bulkInput.addEventListener('blur', parseAndRender);

  btnSendBulk.addEventListener('click', async () => {
    if (!bulkLeads.length) return;

    if (!config.token || !config.owner || !config.repo) {
      showAlert('Please configure GitHub Token, Owner, and Repo in Settings tab first!', 'error');
      document.querySelector('[data-tab="settings"]').click();
      return;
    }

    const activeCamp = getActiveCampaign();
    btnSendBulk.disabled = true;

    showAlert(`🚀 Dispatching batch of ${bulkLeads.length} leads to 1 GitHub Action workflow...`, 'info');

    try {
      const url = `https://api.github.com/repos/${config.owner}/${config.repo}/dispatches`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type: 'send_single_email',
          client_payload: {
            leads: bulkLeads,
            spreadsheet_id: activeCamp.sheetId || '',
            webhook_url: activeCamp.webhookUrl || ''
          }
        })
      });

      if (!response.ok && response.status !== 204) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(formatGitHubApiError(response.status, errData.message));
      }

      showAlert(`🚀 Batch of ${bulkLeads.length} leads dispatched! 1 GitHub Action workflow run will process them with Google Sheet delays.`, 'success');
      bulkInput.value = '';
      bulkTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:16px;">Paste emails above and click "Parse List".</td></tr>`;
      bulkCount.innerText = '0';
      bulkLeads = [];
    } catch (err) {
      showAlert(`GitHub Dispatch Error: ${err.message}`, 'error');
    } finally {
      btnSendBulk.disabled = false;
    }
  });
}

// ----------------------------------------------------------------------------
// SETTINGS & MULTI-CAMPAIGN MANAGER
// ----------------------------------------------------------------------------
function setupSettingsEvents() {
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnSaveCampaign = document.getElementById('btn-save-campaign');

  // Save GitHub Credentials
  btnSaveSettings.addEventListener('click', () => {
    const token = document.getElementById('cfg-github-token').value.trim();
    const owner = document.getElementById('cfg-github-owner').value.trim();
    const repo = document.getElementById('cfg-github-repo').value.trim();

    chrome.storage.local.set({
      sheet_bot_token: token,
      sheet_bot_owner: owner,
      sheet_bot_repo: repo
    }, () => {
      config.token = token;
      config.owner = owner;
      config.repo = repo;

      updateStatusTag();
      showAlert('✅ GitHub Credentials saved!', 'success');
    });
  });

  // Test Connection & Token Permissions
  const btnTestConnection = document.getElementById('btn-test-connection');
  if (btnTestConnection) {
    btnTestConnection.addEventListener('click', async () => {
      const token = document.getElementById('cfg-github-token').value.trim();
      const owner = document.getElementById('cfg-github-owner').value.trim();
      const repo = document.getElementById('cfg-github-repo').value.trim();

      if (!token || !owner || !repo) {
        showAlert('Please enter GitHub PAT Token, Owner, and Repo before testing connection.', 'error');
        return;
      }

      btnTestConnection.disabled = true;
      btnTestConnection.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing...';
      showAlert('Testing connection to GitHub repository and token permissions...', 'info');

      try {
        const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
        const repoRes = await fetch(repoUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'SheetBot'
          }
        });

        if (!repoRes.ok) {
          const errData = await repoRes.json().catch(() => ({}));
          throw new Error(formatGitHubApiError(repoRes.status, errData.message));
        }

        showAlert(`✅ Connection Success! Token has access to repository "${owner}/${repo}".`, 'success');
      } catch (err) {
        showAlert(err.message, 'error');
      } finally {
        btnTestConnection.disabled = false;
        btnTestConnection.innerHTML = '<i class="fa-solid fa-plug"></i> Test Connection';
      }
    });
  }

  // Save/Add Campaign Profile
  btnSaveCampaign.addEventListener('click', () => {
    const name = document.getElementById('cfg-camp-name').value.trim();
    const sheetId = document.getElementById('cfg-camp-sheet').value.trim();
    const webhookUrl = document.getElementById('cfg-camp-webhook').value.trim();
    const location = document.getElementById('cfg-camp-location').value.trim();

    if (!name) {
      showAlert('Please enter a Campaign Profile Name.', 'error');
      return;
    }

    const newCamp = {
      id: 'camp_' + Date.now(),
      name,
      sheetId,
      webhookUrl,
      location: location || 'India'
    };

    campaigns.push(newCamp);
    activeCampaignId = newCamp.id;

    chrome.storage.local.set({
      sheet_bot_campaigns: campaigns,
      sheet_bot_active_camp_id: activeCampaignId
    }, () => {
      document.getElementById('cfg-camp-name').value = '';
      document.getElementById('cfg-camp-sheet').value = '';
      document.getElementById('cfg-camp-webhook').value = '';
      document.getElementById('cfg-camp-location').value = '';

      renderCampaignDropdown();
      renderCampaignsList();
      showAlert(`✅ Campaign "${name}" added and activated!`, 'success');
    });
  });
}

// ----------------------------------------------------------------------------
// GITHUB DISPATCH API CALL & ERROR DIAGNOSTIC HELPER
// ----------------------------------------------------------------------------
function formatGitHubApiError(status, rawMessage = '') {
  if (status === 403 || rawMessage.toLowerCase().includes('resource not accessible')) {
    return '❌ GitHub Permission Error (403): Your Personal Access Token needs "Contents: Read & write" and "Workflows: Read & write" permissions on GitHub.\n👉 Fix: Go to GitHub -> Settings -> Developer settings -> Personal Access Tokens -> Edit Token -> Set Contents & Workflows permissions to "Read and write".';
  } else if (status === 401 || rawMessage.toLowerCase().includes('bad credentials')) {
    return '❌ GitHub Authentication Error (401): Invalid Token. Check your PAT token in Settings tab.';
  } else if (status === 404) {
    return `❌ GitHub Repository Error (404): Repository "${config.owner}/${config.repo}" not found or token has no access. Check Owner and Repo name in Settings.`;
  }
  return `❌ GitHub API Error (${status}): ${rawMessage || 'Failed to dispatch workflow.'}`;
}

async function dispatchToGitHub(lead) {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/dispatches`;
  const activeCamp = getActiveCampaign();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      event_type: 'send_single_email',
      client_payload: {
        email: lead.email,
        full_name: lead.full_name,
        company_name: lead.company_name,
        location: lead.location || activeCamp.location || 'your city',
        spreadsheet_id: lead.spreadsheet_id || activeCamp.sheetId || '',
        webhook_url: lead.webhook_url || activeCamp.webhookUrl || ''
      }
    })
  });

  if (!response.ok && response.status !== 204) {
    const errData = await response.json().catch(() => ({}));
    const formattedError = formatGitHubApiError(response.status, errData.message);
    throw new Error(formattedError);
  }

  return true;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

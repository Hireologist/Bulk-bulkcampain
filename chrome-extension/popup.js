// ============================================================================
// 🛠️ PARSER UTILITIES (Email, Name, Company, CSV Parsing)
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

  let clean = domainName.replace(/-/g, ' ');
  clean = clean.replace(/([a-zA-Z])([0-9])/g, '$1 $2').replace(/([0-9])([a-zA-Z])/g, '$1 $2');

  const suffixRegex = /\s*(events|communications|professionals|organizations|technologies|entertainment|international|collaborators|corporations|institutions|associations|destinations|diagnostics|engineering|hospitality|investments|management|healthcare|consulting|technology|associates|properties|businesses|structures|innovations|foundations|communities|developers|architects|specialists|instructors|consultants|logistics|analytics|solutions|marketing|packaging|education|financial|insurance|machinery|university|productions|enterprises|australia|realestate|milestone|polymers|engineers|hospitals|builders|partners|sciences|ventures|services|software|agencies|networks|holdings|creators|systems|advisors|wellness|holidays|families|mahindra|solution|institute|infotech|capital|digital|hospital|clothing|commerce|research|vacations|journeys|adventures|companies|societies|teachers|trainers|educators|family|group|global|pharma|energy|realty|spaces|hotels|travel|school|medical|health|clinics|fitness|sports|gaming|studios|records|fashion|apparel|retail|bazaar|market|fintech|wealth|nature|village|building|bridge|street|avenue|square|garden|estate|places|locations|designs|crafts|trusts|friends|allies|makers|artists|writers|leaders|mentors|coaches|guides|people|humans|support|tech|soft|india|media|power|infra|tours|music|store|shop|bank|world|europe|america|africa|pacific|atlantic|dairy|tower|drive|lane|court|plaza|trips|clubs|teams|llc|ltd|pvt|inc)$/gi;

  clean = clean.replace(suffixRegex, '').trim();
  if (!clean) clean = domainName;

  return clean.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// 3. Robust Line & CSV Parser
function parseBulkLines(rawText, defaultLocation = 'India') {
  if (!rawText || typeof rawText !== 'string') return [];

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const leads = [];
  const seenEmails = new Set();

  for (const line of lines) {
    // Check if line contains CSV or Tab separated values
    const delimiter = line.includes('\t') ? '\t' : (line.includes(',') ? ',' : null);
    
    if (delimiter) {
      const parts = line.split(delimiter).map(p => p.trim().replace(/^["']|["']$/g, ''));
      const emailPart = parts.find(p => /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(p));
      
      if (emailPart) {
        const cleanEmail = emailPart.toLowerCase();
        if (!seenEmails.has(cleanEmail)) {
          seenEmails.add(cleanEmail);
          const emailIdx = parts.indexOf(emailPart);
          const remaining = parts.filter((_, idx) => idx !== emailIdx);
          
          leads.push({
            email: cleanEmail,
            full_name: remaining[0] || extractNameFromEmail(cleanEmail),
            company_name: remaining[1] || extractCompanyFromEmail(cleanEmail),
            location: remaining[2] || defaultLocation
          });
        }
        continue;
      }
    }

    // Fallback: extract any email from line
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = line.match(emailRegex) || [];
    for (const email of matches) {
      const cleanEmail = email.toLowerCase();
      if (!seenEmails.has(cleanEmail)) {
        seenEmails.add(cleanEmail);
        leads.push({
          email: cleanEmail,
          full_name: extractNameFromEmail(cleanEmail),
          company_name: extractCompanyFromEmail(cleanEmail),
          location: defaultLocation
        });
      }
    }
  }

  return leads;
}

// 4. Token & Owner/Repo Sanitizers
function sanitizeToken(token) {
  if (!token) return '';
  return token.trim().replace(/^(Bearer|token)\s+/i, '').replace(/["']/g, '').trim();
}

function parseOwnerRepo(rawOwner, rawRepo) {
  let owner = (rawOwner || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  let repo = (rawRepo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');

  // If user pasted "owner/repo" in the repo field
  if (repo.includes('/')) {
    const parts = repo.split('/');
    if (parts.length >= 2) {
      if (!owner || owner === parts[0]) owner = parts[0];
      repo = parts[1];
    }
  }

  // If user pasted "owner/repo" in the owner field
  if (owner.includes('/')) {
    const parts = owner.split('/');
    if (parts.length >= 2) {
      owner = parts[0];
      if (!repo) repo = parts[1];
    }
  }

  return { owner, repo };
}

// ============================================================================
// 🚀 STORAGE WRAPPER & INITIALIZATION
// ============================================================================

const storage = {
  get: (keys, cb) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(keys, cb);
    } else {
      const res = {};
      keys.forEach(k => {
        try {
          const val = localStorage.getItem(k);
          res[k] = val ? JSON.parse(val) : undefined;
        } catch (e) {
          res[k] = localStorage.getItem(k) || undefined;
        }
      });
      cb(res);
    }
  },
  set: (data, cb) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(data, cb);
    } else {
      Object.keys(data).forEach(k => {
        try {
          localStorage.setItem(k, JSON.stringify(data[k]));
        } catch (e) {
          localStorage.setItem(k, data[k]);
        }
      });
      if (cb) cb();
    }
  }
};

let config = {
  token: '',
  owner: '',
  repo: ''
};

let campaigns = [];
let activeCampaignId = 'default';
let bulkLeads = [];
let alertTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initAlertDismiss();
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
      const targetContent = document.getElementById(`tab-${target}`);
      if (targetContent) targetContent.classList.add('active');
    });
  });
}

function initAlertDismiss() {
  const closeBtn = document.getElementById('alert-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const banner = document.getElementById('alert-banner');
      if (banner) banner.classList.add('hidden');
      if (alertTimer) clearTimeout(alertTimer);
    });
  }
}

// Load settings from storage
function loadSettings() {
  storage.get([
    'sheet_bot_token', 'sheet_bot_owner', 'sheet_bot_repo', 
    'sheet_bot_campaigns', 'sheet_bot_active_camp_id'
  ], (res = {}) => {
    config.token = sanitizeToken(res.sheet_bot_token || '');
    const { owner, repo } = parseOwnerRepo(res.sheet_bot_owner || '', res.sheet_bot_repo || '');
    config.owner = owner;
    config.repo = repo;
    
    campaigns = res.sheet_bot_campaigns || [
      { id: 'default', name: 'Campaign 1 (Default)', sheetId: '', webhookUrl: '', location: 'India' }
    ];
    if (!campaigns.length) {
      campaigns = [{ id: 'default', name: 'Campaign 1 (Default)', sheetId: '', webhookUrl: '', location: 'India' }];
    }
    activeCampaignId = res.sheet_bot_active_camp_id || campaigns[0].id;

    const tokenInput = document.getElementById('cfg-github-token');
    const ownerInput = document.getElementById('cfg-github-owner');
    const repoInput = document.getElementById('cfg-github-repo');

    if (tokenInput) tokenInput.value = config.token;
    if (ownerInput) ownerInput.value = config.owner;
    if (repoInput) repoInput.value = config.repo;

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
    storage.set({ sheet_bot_active_camp_id: activeCampaignId }, () => {
      const activeCamp = getActiveCampaign();
      showAlert(`Switched to active campaign: ${activeCamp.name}`, 'info');
    });
  };
}

function getActiveCampaign() {
  return campaigns.find(c => c.id === activeCampaignId) || campaigns[0] || { name: 'Default', sheetId: '', webhookUrl: '', location: 'India' };
}

function renderCampaignsList() {
  const container = document.getElementById('campaigns-list-container');
  if (!container) return;

  if (campaigns.length === 0) {
    container.innerHTML = '<div style="font-size:11px; color:var(--text-muted); padding:6px 0;">No saved campaign profiles.</div>';
    return;
  }

  container.innerHTML = campaigns.map(c => `
    <div style="background:rgba(255,255,255,0.03); border:1px solid var(--card-border); padding:8px 10px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <strong style="color:#FFF; font-size:11px;">${escapeHtml(c.name)}</strong>
        <div style="font-size:10px; color:var(--text-muted);">
          Sheet: ${escapeHtml(c.sheetId ? c.sheetId.substring(0, 14) + '...' : 'Default Sheet')}
        </div>
      </div>
      <button class="btn btn-secondary btn-del-camp" type="button" data-id="${escapeHtml(c.id)}" style="width:auto; padding:3px 8px; font-size:10px; background:rgba(239,68,68,0.2); color:#FCA5A5;" title="Remove Campaign">
        &times; Remove
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

      storage.set({ sheet_bot_campaigns: campaigns, sheet_bot_active_camp_id: activeCampaignId }, () => {
        renderCampaignDropdown();
        renderCampaignsList();
        showAlert('Campaign profile removed.', 'info');
      });
    });
  });
}

function updateStatusTag() {
  const statusTag = document.getElementById('status-tag');
  const statusText = document.getElementById('status-text');
  if (!statusTag || !statusText) return;

  if (config.token && config.owner && config.repo) {
    statusText.innerText = 'Connected';
    statusTag.className = 'status-tag';
  } else {
    statusText.innerText = 'Setup Token';
    statusTag.className = 'status-tag unconfigured';
  }
}

// Alert banner display (Self-healing display & auto-timeout)
function showAlert(msg, type = 'info', autoHideMs = 6000) {
  const banner = document.getElementById('alert-banner');
  const text = document.getElementById('alert-text');
  if (!banner || !text) return;

  banner.className = `alert alert-${type}`;
  text.innerText = msg;

  if (alertTimer) clearTimeout(alertTimer);
  if (autoHideMs > 0) {
    alertTimer = setTimeout(() => {
      banner.classList.add('hidden');
    }, autoHideMs);
  }
}

// ============================================================================
// 1. SINGLE LEAD DISPATCHER
// ============================================================================
function setupSingleLeadEvents() {
  const emailInput = document.getElementById('single-email');
  const nameInput = document.getElementById('single-name');
  const companyInput = document.getElementById('single-company');
  const locInput = document.getElementById('single-location');
  const prevName = document.getElementById('prev-name');
  const prevCompany = document.getElementById('prev-company');
  const btnSend = document.getElementById('btn-send-single');

  if (!emailInput || !btnSend) return;

  const updatePreview = () => {
    const val = emailInput.value.trim();
    if (val && val.includes('@')) {
      const parsedName = nameInput.value.trim() || extractNameFromEmail(val);
      const parsedCompany = companyInput.value.trim() || extractCompanyFromEmail(val);

      if (!nameInput.value) nameInput.value = parsedName;
      if (!companyInput.value) companyInput.value = parsedCompany;

      prevName.innerText = parsedName;
      prevCompany.innerText = parsedCompany;
    } else {
      prevName.innerText = '—';
      prevCompany.innerText = '—';
    }
  };

  emailInput.addEventListener('input', updatePreview);
  nameInput.addEventListener('input', () => { prevName.innerText = nameInput.value.trim() || '—'; });
  companyInput.addEventListener('input', () => { prevCompany.innerText = companyInput.value.trim() || '—'; });

  // Enter key trigger
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnSend.click();
    }
  });

  btnSend.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
      showAlert('Please enter a valid recipient email address.', 'error');
      emailInput.focus();
      return;
    }

    if (!config.token || !config.owner || !config.repo) {
      showAlert('⚠️ GitHub credentials missing! Redirecting to Settings tab...', 'error');
      const settingsTab = document.querySelector('[data-tab="settings"]');
      if (settingsTab) settingsTab.click();
      return;
    }

    const activeCamp = getActiveCampaign();
    const fullName = nameInput.value.trim() || extractNameFromEmail(email);
    const companyName = companyInput.value.trim() || extractCompanyFromEmail(email);
    const location = locInput.value.trim() || activeCamp.location || 'India';

    btnSend.disabled = true;
    btnSend.innerHTML = `
      <svg class="icon spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="16"></circle></svg>
      Dispatching to GitHub...
    `;
    showAlert(`🚀 Dispatching email for [${email}] to ${config.owner}/${config.repo}...`, 'info');

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
        showAlert(`✅ Success! Outreach for [${email}] dispatched to GitHub Action workflow.`, 'success', 8000);
        emailInput.value = '';
        nameInput.value = '';
        companyInput.value = '';
        locInput.value = '';
        prevName.innerText = '—';
        prevCompany.innerText = '—';
      }
    } catch (err) {
      showAlert(err.message, 'error', 12000);
    } finally {
      btnSend.disabled = false;
      btnSend.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        Send Instant Email
      `;
    }
  });
}

// ============================================================================
// 2. BULK BATCH DISPATCHER
// ============================================================================
function setupBulkLeadEvents() {
  const bulkInput = document.getElementById('bulk-input');
  const btnParse = document.getElementById('btn-parse-bulk');
  const bulkCount = document.getElementById('bulk-count');
  const bulkTbody = document.getElementById('bulk-tbody');
  const btnSendBulk = document.getElementById('btn-send-bulk');
  const progressWrapper = document.getElementById('bulk-progress-wrapper');
  const progressBar = document.getElementById('progress-bar');
  const progressStats = document.getElementById('progress-stats');
  const progressLabel = document.getElementById('progress-label');

  if (!bulkInput || !btnParse || !btnSendBulk) return;

  const parseAndRender = () => {
    const raw = bulkInput.value;
    const activeCamp = getActiveCampaign();
    bulkLeads = parseBulkLines(raw, activeCamp.location || 'India').map(lead => ({
      ...lead,
      spreadsheet_id: activeCamp.sheetId || '',
      webhook_url: activeCamp.webhookUrl || ''
    }));

    bulkCount.innerText = bulkLeads.length;

    if (bulkLeads.length === 0) {
      bulkTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:16px;">Paste emails or CSV above and click "Parse List".</td></tr>`;
      btnSendBulk.disabled = true;
      return;
    }

    bulkTbody.innerHTML = bulkLeads.slice(0, 100).map(item => `
      <tr>
        <td><strong>${escapeHtml(item.email)}</strong></td>
        <td><span style="color:var(--accent-purple);">${escapeHtml(item.full_name)}</span></td>
        <td><span style="color:var(--accent-blue);">${escapeHtml(item.company_name)}</span></td>
      </tr>
    `).join('') + (bulkLeads.length > 100 ? `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:6px;">...and ${bulkLeads.length - 100} more leads</td></tr>` : '');

    btnSendBulk.disabled = false;
  };

  btnParse.addEventListener('click', parseAndRender);
  bulkInput.addEventListener('blur', () => {
    if (bulkInput.value.trim() && bulkLeads.length === 0) parseAndRender();
  });

  btnSendBulk.addEventListener('click', async () => {
    if (!bulkLeads.length) return;

    if (!config.token || !config.owner || !config.repo) {
      showAlert('⚠️ GitHub credentials missing! Redirecting to Settings tab...', 'error');
      const settingsTab = document.querySelector('[data-tab="settings"]');
      if (settingsTab) settingsTab.click();
      return;
    }

    const activeCamp = getActiveCampaign();
    btnSendBulk.disabled = true;

    if (progressWrapper) {
      progressWrapper.classList.add('active');
      if (progressBar) progressBar.style.width = '40%';
      if (progressStats) progressStats.innerText = `Dispatching...`;
      if (progressLabel) progressLabel.innerText = `Sending payload (${bulkLeads.length} leads)...`;
    }

    showAlert(`🚀 Dispatching batch of ${bulkLeads.length} leads to GitHub repository ${config.owner}/${config.repo}...`, 'info');

    try {
      const cleanToken = sanitizeToken(config.token);
      const { owner, repo } = parseOwnerRepo(config.owner, config.repo);
      const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${cleanToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
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

      if (progressBar) progressBar.style.width = '100%';
      if (progressStats) progressStats.innerText = `${bulkLeads.length} / ${bulkLeads.length} Queued`;
      if (progressLabel) progressLabel.innerText = 'Batch Triggered Successfully!';

      showAlert(`✅ Batch of ${bulkLeads.length} leads dispatched to GitHub! Action workflow will process with Google Sheet delays.`, 'success', 10000);
      bulkInput.value = '';
      bulkTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:16px;">Batch dispatched! Paste new list when ready.</td></tr>`;
      bulkCount.innerText = '0';
      bulkLeads = [];

      setTimeout(() => {
        if (progressWrapper) progressWrapper.classList.remove('active');
      }, 5000);

    } catch (err) {
      if (progressWrapper) progressWrapper.classList.remove('active');
      showAlert(err.message, 'error', 12000);
    } finally {
      btnSendBulk.disabled = false;
    }
  });
}

// ============================================================================
// 3. SETTINGS & MULTI-CAMPAIGN MANAGER
// ============================================================================
function setupSettingsEvents() {
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnTestConnection = document.getElementById('btn-test-connection');
  const btnSaveCampaign = document.getElementById('btn-save-campaign');

  // Save GitHub Credentials
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
      const rawToken = document.getElementById('cfg-github-token').value;
      const rawOwner = document.getElementById('cfg-github-owner').value;
      const rawRepo = document.getElementById('cfg-github-repo').value;

      const token = sanitizeToken(rawToken);
      const { owner, repo } = parseOwnerRepo(rawOwner, rawRepo);

      if (!token || !owner || !repo) {
        showAlert('Please fill in GitHub PAT Token, Owner, and Repo.', 'error');
        return;
      }

      // Update input display with cleaned values
      document.getElementById('cfg-github-token').value = token;
      document.getElementById('cfg-github-owner').value = owner;
      document.getElementById('cfg-github-repo').value = repo;

      storage.set({
        sheet_bot_token: token,
        sheet_bot_owner: owner,
        sheet_bot_repo: repo
      }, () => {
        config.token = token;
        config.owner = owner;
        config.repo = repo;

        updateStatusTag();
        showAlert(`✅ Saved credentials for repository: ${owner}/${repo}`, 'success');
      });
    });
  }

  // Test Connection & Auto-Save
  if (btnTestConnection) {
    btnTestConnection.addEventListener('click', async () => {
      const rawToken = document.getElementById('cfg-github-token').value;
      const rawOwner = document.getElementById('cfg-github-owner').value;
      const rawRepo = document.getElementById('cfg-github-repo').value;

      const token = sanitizeToken(rawToken);
      const { owner, repo } = parseOwnerRepo(rawOwner, rawRepo);

      if (!token || !owner || !repo) {
        showAlert('Please enter GitHub PAT Token, Owner, and Repo before testing connection.', 'error');
        return;
      }

      btnTestConnection.disabled = true;
      btnTestConnection.innerHTML = `
        <svg class="icon spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="16"></circle></svg>
        Testing...
      `;
      showAlert(`Connecting to GitHub API for repository "${owner}/${repo}"...`, 'info');

      try {
        const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
        const repoRes = await fetch(repoUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });

        if (!repoRes.ok) {
          const errData = await repoRes.json().catch(() => ({}));
          throw new Error(formatGitHubApiError(repoRes.status, errData.message));
        }

        // Auto-save verified credentials
        document.getElementById('cfg-github-token').value = token;
        document.getElementById('cfg-github-owner').value = owner;
        document.getElementById('cfg-github-repo').value = repo;

        config.token = token;
        config.owner = owner;
        config.repo = repo;

        storage.set({
          sheet_bot_token: token,
          sheet_bot_owner: owner,
          sheet_bot_repo: repo
        }, () => {
          updateStatusTag();
          showAlert(`✅ Connection Verified & Saved! Full access confirmed for "${owner}/${repo}".`, 'success', 8000);
        });

      } catch (err) {
        showAlert(err.message, 'error', 12000);
      } finally {
        btnTestConnection.disabled = false;
        btnTestConnection.innerHTML = `
          <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M12 2v6m0 8v6M4.93 4.93l4.24 4.24m5.66 5.66l4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m5.66-5.66l4.24-4.24"></path></svg>
          Test Connection
        `;
      }
    });
  }

  // Save/Add Campaign Profile
  if (btnSaveCampaign) {
    btnSaveCampaign.addEventListener('click', () => {
      const name = document.getElementById('cfg-camp-name').value.trim();
      const sheetId = document.getElementById('cfg-camp-sheet').value.trim();
      const webhookUrl = document.getElementById('cfg-camp-webhook').value.trim();
      const location = document.getElementById('cfg-camp-location').value.trim();

      if (!name) {
        showAlert('Please enter a Campaign Profile Name.', 'error');
        document.getElementById('cfg-camp-name').focus();
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

      storage.set({
        sheet_bot_campaigns: campaigns,
        sheet_bot_active_camp_id: activeCampaignId
      }, () => {
        document.getElementById('cfg-camp-name').value = '';
        document.getElementById('cfg-camp-sheet').value = '';
        document.getElementById('cfg-camp-webhook').value = '';
        document.getElementById('cfg-camp-location').value = '';

        renderCampaignDropdown();
        renderCampaignsList();
        showAlert(`✅ Campaign profile "${name}" added and activated!`, 'success');
      });
    });
  }
}

// ============================================================================
// 4. GITHUB DISPATCH API & ERROR FORMATTER
// ============================================================================
function formatGitHubApiError(status, rawMessage = '') {
  if (status === 403 || (rawMessage && rawMessage.toLowerCase().includes('resource not accessible'))) {
    return `❌ GitHub Permission Error (403): Token lacks permission to trigger repository dispatches.\n👉 Fix: For fine-grained tokens, set "Contents: Read and write". For classic tokens, check "repo" scope.`;
  } else if (status === 401 || (rawMessage && rawMessage.toLowerCase().includes('bad credentials'))) {
    return '❌ GitHub Authentication Error (401): Invalid or expired Personal Access Token. Check Settings tab.';
  } else if (status === 404) {
    return `❌ GitHub Repository Error (404): Repository "${config.owner}/${config.repo}" not found or token has no access. Check Owner and Repo name.`;
  } else if (status === 422) {
    return `❌ GitHub Validation Error (422): ${rawMessage || 'Event type or payload format rejected.'}`;
  }
  return `❌ GitHub API Error (${status}): ${rawMessage || 'Failed to dispatch workflow.'}`;
}

async function dispatchToGitHub(lead) {
  const cleanToken = sanitizeToken(config.token);
  const { owner, repo } = parseOwnerRepo(config.owner, config.repo);
  const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const activeCamp = getActiveCampaign();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${cleanToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      event_type: 'send_single_email',
      client_payload: {
        email: lead.email,
        full_name: lead.full_name,
        company_name: lead.company_name,
        location: lead.location || activeCamp.location || 'India',
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

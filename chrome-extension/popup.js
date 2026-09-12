// ============================================================================
// 💎 SHEET-BOT EXTENSION — MULTI-MASTER TOKEN & CAMPAIGN DISPATCH CONTROLLER
// ============================================================================

const PUBLIC_DOMAINS = new Set([
  'gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'protonmail',
  'aol', 'rediffmail', 'zoho', 'live', 'msn', 'gmx', 'yandex', 'mail'
]);

// ============================================================================
// 1. SMART EXTRACTION & SANITIZATION UTILITIES
// ============================================================================

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

// Robust Repo Parser (Handles full URLs, owner/repo, .git)
function extractRepoDetails(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return null;
  let clean = rawInput.trim();
  
  // Remove git@github.com: or https://github.com/
  clean = clean.replace(/^git@github\.com:/i, '')
               .replace(/^https?:\/\/github\.com\//i, '')
               .replace(/\/+$/, '')
               .replace(/^\/+/, '')
               .replace(/\.git$/i, '');

  const parts = clean.split('/');
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return {
      owner: parts[0].trim(),
      repo: parts[1].trim(),
      full_name: `${parts[0].trim()}/${parts[1].trim()}`
    };
  }
  return null;
}

// Robust Google Sheet ID Extractor (Handles URLs and raw IDs)
function extractSheetId(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return null;
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  
  // If it's a URL with /d/ID
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  // If it's already a clean Sheet ID (at least 20 chars)
  const idMatch = trimmed.match(/^[a-zA-Z0-9_-]{20,}$/);
  if (idMatch) {
    return trimmed;
  }

  return null;
}

function sanitizeToken(token) {
  if (!token) return '';
  return token.trim().replace(/^(Bearer|token)\s+/i, '').replace(/["']/g, '').trim();
}

function parseBulkLines(rawText, defaultLocation = 'India') {
  if (!rawText || typeof rawText !== 'string') return [];

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const leads = [];
  const seenEmails = new Set();

  for (const line of lines) {
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

// ============================================================================
// 2. STORAGE WRAPPER & STATE
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

let masterTokens = []; // [{ id, token, username, name, isDefault, repos: [] }]
let campaigns = [];    // [{ id, name, owner, repo, sheetId, webhookUrl, location, tokenId }]
let activeCampaignId = 'default';
let bulkLeads = [];
let alertTimer = null;

// ============================================================================
// 3. INITIALIZATION & LIFECYCLE
// ============================================================================

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initAlertDismiss();
    loadAllData();
    setupSingleLeadEvents();
    setupBulkLeadEvents();
    setupSettingsEvents();
  });
}

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

// Load data & perform backwards-compatible schema migration
function loadAllData() {
  storage.get([
    'sheet_bot_master_tokens',
    'sheet_bot_campaigns',
    'sheet_bot_active_camp_id',
    'sheet_bot_token', // legacy
    'sheet_bot_owner', // legacy
    'sheet_bot_repo'   // legacy
  ], async (res = {}) => {
    
    // 1. Load or migrate Master Tokens
    masterTokens = res.sheet_bot_master_tokens || [];
    if (masterTokens.length === 0 && res.sheet_bot_token) {
      // Auto-migrate legacy token
      const legacyToken = sanitizeToken(res.sheet_bot_token);
      if (legacyToken) {
        masterTokens.push({
          id: 'token_legacy_' + Date.now(),
          token: legacyToken,
          username: res.sheet_bot_owner || 'Default Account',
          name: res.sheet_bot_owner || 'GitHub User',
          isDefault: true,
          repos: []
        });
      }
    }

    // 2. Load or migrate Campaigns
    campaigns = res.sheet_bot_campaigns || [];
    if (campaigns.length === 0) {
      const fallbackOwner = res.sheet_bot_owner || 'Hireologist';
      const fallbackRepo = res.sheet_bot_repo || 'Bulk-bulkcampain';
      campaigns = [
        {
          id: 'default',
          name: `${fallbackOwner} / ${fallbackRepo}`,
          owner: fallbackOwner,
          repo: fallbackRepo,
          sheetId: '',
          webhookUrl: '',
          location: 'India',
          tokenId: 'auto'
        }
      ];
    } else {
      // Ensure all campaigns have owner & repo
      campaigns = campaigns.map(c => {
        if (!c.owner || !c.repo) {
          const parsed = extractRepoDetails(c.name) || { owner: res.sheet_bot_owner || 'Hireologist', repo: res.sheet_bot_repo || 'Bulk-bulkcampain' };
          return { ...c, owner: parsed.owner, repo: parsed.repo, tokenId: c.tokenId || 'auto' };
        }
        return c;
      });
    }

    activeCampaignId = res.sheet_bot_active_camp_id || campaigns[0]?.id || 'default';

    // 3. Persist normalized state
    storage.set({
      sheet_bot_master_tokens: masterTokens,
      sheet_bot_campaigns: campaigns,
      sheet_bot_active_camp_id: activeCampaignId
    });

    // 4. Render UI
    renderMasterTokensList();
    renderCampaignTokenDropdown();
    renderCampaignDropdown();
    renderCampaignsList();
    updateStatusTag();
    updateRoutingPreview();
  });
}

// ============================================================================
// 4. MASTER TOKENS POOL CONTROLLER
// ============================================================================

async function verifyAndFetchGitHubUser(token) {
  const clean = sanitizeToken(token);
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${clean}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid or expired GitHub PAT token.');
    if (res.status === 403) throw new Error('Token lacks user/repo permissions.');
    throw new Error(`GitHub API error (${res.status})`);
  }

  const user = await res.json();
  
  // Also fetch up to 100 accessible repositories
  let repos = [];
  try {
    const reposRes = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${clean}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (reposRes.ok) {
      const reposData = await reposRes.json();
      repos = reposData.map(r => r.full_name);
    }
  } catch (e) {
    console.warn('Could not list repos:', e.message);
  }

  return {
    username: user.login,
    name: user.name || user.login,
    avatar: user.avatar_url,
    repos
  };
}

function renderMasterTokensList() {
  const container = document.getElementById('tokens-pool-container');
  if (!container) return;

  if (masterTokens.length === 0) {
    container.innerHTML = `
      <div style="font-size:11px; color:var(--text-muted); padding:8px 10px; background:rgba(255,255,255,0.02); border-radius:var(--radius-sm); border:1px dashed var(--border-subtle);">
        No Master GitHub Tokens connected. Paste your Personal Access Token above to get started.
      </div>
    `;
    return;
  }

  container.innerHTML = masterTokens.map(t => {
    const initial = (t.username || 'G').charAt(0).toUpperCase();
    return `
      <div class="token-card" data-id="${escapeHtml(t.id)}">
        <div class="token-info">
          <div class="token-avatar">${initial}</div>
          <div>
            <div class="token-name">
              <span>${escapeHtml(t.username)}</span>
              ${t.isDefault ? `<span class="token-badge-default">Default Master</span>` : ''}
            </div>
            <div class="token-meta">
              Token: ••••••••${t.token.slice(-4)} ${t.repos?.length ? `• ${t.repos.length} repos accessible` : ''}
            </div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          ${!t.isDefault ? `
            <button class="btn btn-secondary btn-set-default" data-id="${escapeHtml(t.id)}" style="width:auto; padding:4px 8px; font-size:10px;" title="Set as Default Master">
              Make Default
            </button>
          ` : ''}
          <button class="btn btn-danger btn-del-token" data-id="${escapeHtml(t.id)}" style="width:auto; padding:4px 8px; font-size:10px;" title="Remove Token">
            &times;
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Event Listeners for Tokens List
  container.querySelectorAll('.btn-set-default').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      masterTokens = masterTokens.map(t => ({ ...t, isDefault: t.id === id }));
      storage.set({ sheet_bot_master_tokens: masterTokens }, () => {
        renderMasterTokensList();
        renderCampaignTokenDropdown();
        showAlert('Default Master Token updated.', 'success');
      });
    });
  });

  container.querySelectorAll('.btn-del-token').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const wasDefault = masterTokens.find(t => t.id === id)?.isDefault;
      masterTokens = masterTokens.filter(t => t.id !== id);
      if (wasDefault && masterTokens.length > 0) {
        masterTokens[0].isDefault = true;
      }
      storage.set({ sheet_bot_master_tokens: masterTokens }, () => {
        renderMasterTokensList();
        renderCampaignTokenDropdown();
        updateStatusTag();
        showAlert('Master token removed.', 'info');
      });
    });
  });

  updateRepoSelectDropdown();
}

function updateRepoSelectDropdown() {
  const repoSelect = document.getElementById('cfg-camp-repo-select');
  if (!repoSelect) return;

  const allRepos = [...new Set(masterTokens.flatMap(t => t.repos || []))].sort();
  if (allRepos.length > 0) {
    repoSelect.style.display = 'block';
    repoSelect.innerHTML = `<option value="">-- Quick pick from your ${allRepos.length} detected repositories --</option>` + 
      allRepos.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
    
    repoSelect.onchange = (e) => {
      if (e.target.value) {
        const repoInput = document.getElementById('cfg-camp-repo-input');
        if (repoInput) repoInput.value = e.target.value;
        const nameInput = document.getElementById('cfg-camp-name-input');
        if (nameInput && !nameInput.value) nameInput.value = e.target.value;
      }
    };
  } else {
    repoSelect.style.display = 'none';
  }
}

function renderCampaignTokenDropdown() {
  const tokenSelect = document.getElementById('cfg-camp-token-select');
  if (!tokenSelect) return;

  let opts = `<option value="auto">⚡ Auto-match token by repo owner (Recommended)</option>`;
  masterTokens.forEach(t => {
    opts += `<option value="${escapeHtml(t.id)}">🔑 ${escapeHtml(t.username)} (${t.isDefault ? 'Default Master' : 'Master Token'})</option>`;
  });

  tokenSelect.innerHTML = opts;
}

function updateStatusTag() {
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  if (!statusBadge || !statusText) return;

  if (masterTokens.length > 0) {
    const defaultToken = masterTokens.find(t => t.isDefault) || masterTokens[0];
    statusText.innerText = `Connected (${defaultToken.username})`;
    statusBadge.className = 'status-badge';
  } else {
    statusText.innerText = 'Setup Token';
    statusBadge.className = 'status-badge unconfigured';
  }
}

// ============================================================================
// 5. CAMPAIGN ROUTING & WORKSPACE CONTROLLER
// ============================================================================

function getActiveCampaign() {
  return campaigns.find(c => c.id === activeCampaignId) || campaigns[0] || {
    id: 'default',
    name: 'Hireologist / Bulk-bulkcampain',
    owner: 'Hireologist',
    repo: 'Bulk-bulkcampain',
    sheetId: '',
    webhookUrl: '',
    location: 'India',
    tokenId: 'auto'
  };
}

// Resolves token: Explicit -> Matching Owner -> Default Master
function resolveTokenForCampaign(campaign, tokenPool = masterTokens) {
  if (!campaign) return null;
  const pool = Array.isArray(tokenPool) ? tokenPool : [];

  // 1. Explicit token binding
  if (campaign.tokenId && campaign.tokenId !== 'auto') {
    const explicit = pool.find(t => t.id === campaign.tokenId);
    if (explicit) return explicit;
  }

  // 2. Auto-match by Owner username
  const targetOwner = (campaign.owner || '').toLowerCase();
  const matched = pool.find(t => (t.username || '').toLowerCase() === targetOwner);
  if (matched) return matched;

  // 3. Fallback to Default Master
  const defaultToken = pool.find(t => t.isDefault) || pool[0];
  return defaultToken || null;
}

function renderCampaignDropdown() {
  const dropdown = document.getElementById('campaign-select-dropdown');
  if (!dropdown) return;

  if (campaigns.length === 0) {
    dropdown.innerHTML = `<option value="">No campaigns configured</option>`;
    return;
  }

  dropdown.innerHTML = campaigns.map(c => `
    <option value="${escapeHtml(c.id)}" ${c.id === activeCampaignId ? 'selected' : ''}>
      ${escapeHtml(c.name)} (${escapeHtml(c.owner)}/${escapeHtml(c.repo)})
    </option>
  `).join('');

  dropdown.onchange = (e) => {
    activeCampaignId = e.target.value;
    storage.set({ sheet_bot_active_camp_id: activeCampaignId }, () => {
      const activeCamp = getActiveCampaign();
      const resolved = resolveTokenForCampaign(activeCamp);
      updateRoutingPreview();
      showAlert(`Switched to: ${activeCamp.name} ➔ Target: ${activeCamp.owner}/${activeCamp.repo} (${resolved?.username || 'No Token'})`, 'info', 4000);
    });
  };
}

function updateRoutingPreview() {
  const prevTarget = document.getElementById('prev-target');
  if (!prevTarget) return;

  const camp = getActiveCampaign();
  const token = resolveTokenForCampaign(camp);
  const tokenLabel = token ? `[Key: ${token.username}]` : `[⚠️ No Key]`;
  prevTarget.innerText = `${camp.owner}/${camp.repo} ${tokenLabel}`;
}

function renderCampaignsList() {
  const container = document.getElementById('campaigns-list-container');
  if (!container) return;

  if (campaigns.length === 0) {
    container.innerHTML = `<div style="font-size:11px; color:var(--text-muted); padding:6px 0;">No saved campaigns yet. Add one above!</div>`;
    return;
  }

  container.innerHTML = campaigns.map(c => {
    const token = resolveTokenForCampaign(c);
    return `
      <div style="background:rgba(6,9,16,0.7); border:1px solid var(--border-subtle); padding:10px 12px; border-radius:var(--radius-md); display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:700; color:#FFF; font-size:12px;">
            ${escapeHtml(c.name)}
          </div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px; display:flex; gap:8px; flex-wrap:wrap;">
            <span><strong style="color:var(--accent-cyan);">Repo:</strong> ${escapeHtml(c.owner)}/${escapeHtml(c.repo)}</span>
            <span><strong style="color:var(--accent-indigo);">Sheet:</strong> ${escapeHtml(c.sheetId ? c.sheetId.substring(0, 10) + '...' : 'Default')}</span>
            <span><strong style="color:#34D399;">Auth:</strong> ${escapeHtml(token?.username || 'None')}</span>
          </div>
        </div>
        <button class="btn btn-danger btn-del-camp" data-id="${escapeHtml(c.id)}" style="width:auto; padding:4px 8px; font-size:11px;" title="Remove Campaign">
          &times; Remove
        </button>
      </div>
    `;
  }).join('');

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
        updateRoutingPreview();
        showAlert('Campaign removed.', 'info');
      });
    });
  });
}

// ============================================================================
// 6. GITHUB DISPATCH CLIENT
// ============================================================================

function formatGitHubApiError(status, rawMessage = '') {
  if (status === 403 || (rawMessage && rawMessage.toLowerCase().includes('resource not accessible'))) {
    return `❌ GitHub Permission Error (403): Token lacks permission to trigger workflow dispatches.\n👉 Fix: In GitHub token settings, set "Contents: Read and write" and "Workflows: Read and write".`;
  } else if (status === 401 || (rawMessage && rawMessage.toLowerCase().includes('bad credentials'))) {
    return '❌ GitHub Authentication Error (401): Invalid or expired Personal Access Token. Check Settings tab.';
  } else if (status === 404) {
    return `❌ GitHub Repository Error (404): Repository not found or token has no access. Verify owner and repo.`;
  } else if (status === 422) {
    return `❌ GitHub Validation Error (422): ${rawMessage || 'Repository dispatch payload rejected.'}`;
  }
  return `❌ GitHub API Error (${status}): ${rawMessage || 'Failed to dispatch workflow.'}`;
}

async function dispatchToGitHub(lead) {
  const activeCamp = getActiveCampaign();
  const tokenObj = resolveTokenForCampaign(activeCamp);

  if (!tokenObj || !tokenObj.token) {
    throw new Error(`No valid Master Token found for repository "${activeCamp.owner}/${activeCamp.repo}". Please connect a Master PAT in Settings.`);
  }

  const cleanToken = sanitizeToken(tokenObj.token);
  const owner = activeCamp.owner;
  const repo = activeCamp.repo;
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
    throw new Error(formatGitHubApiError(response.status, errData.message));
  }

  return true;
}

// ============================================================================
// 7. EVENT LISTENERS
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
    updateRoutingPreview();
  };

  emailInput.addEventListener('input', updatePreview);
  nameInput.addEventListener('input', () => { prevName.innerText = nameInput.value.trim() || '—'; });
  companyInput.addEventListener('input', () => { prevCompany.innerText = companyInput.value.trim() || '—'; });

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

    const activeCamp = getActiveCampaign();
    const tokenObj = resolveTokenForCampaign(activeCamp);

    if (!tokenObj) {
      showAlert('⚠️ No Master GitHub Token found! Redirecting to Settings...', 'error');
      document.querySelector('[data-tab="settings"]')?.click();
      return;
    }

    const fullName = nameInput.value.trim() || extractNameFromEmail(email);
    const companyName = companyInput.value.trim() || extractCompanyFromEmail(email);
    const location = locInput.value.trim() || activeCamp.location || 'India';

    btnSend.disabled = true;
    btnSend.innerHTML = `
      <svg class="icon spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="16"></circle></svg>
      Dispatching to ${activeCamp.owner}/${activeCamp.repo}...
    `;
    showAlert(`🚀 Dispatching outreach for [${email}] to ${activeCamp.owner}/${activeCamp.repo}...`, 'info');

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
        showAlert(`✅ Dispatched successfully to GitHub Action! Workflow started for ${activeCamp.owner}/${activeCamp.repo}.`, 'success', 8000);
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
        Send Instant Outreach
      `;
    }
  });
}

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
        <td><span style="color:var(--accent-indigo); font-weight:600;">${escapeHtml(item.full_name)}</span></td>
        <td><span style="color:var(--accent-cyan); font-weight:600;">${escapeHtml(item.company_name)}</span></td>
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

    const activeCamp = getActiveCampaign();
    const tokenObj = resolveTokenForCampaign(activeCamp);

    if (!tokenObj) {
      showAlert('⚠️ No Master GitHub Token found! Redirecting to Settings...', 'error');
      document.querySelector('[data-tab="settings"]')?.click();
      return;
    }

    btnSendBulk.disabled = true;

    if (progressWrapper) {
      progressWrapper.classList.add('active');
      if (progressBar) progressBar.style.width = '45%';
      if (progressStats) progressStats.innerText = `Dispatching...`;
      if (progressLabel) progressLabel.innerText = `Sending ${bulkLeads.length} leads to ${activeCamp.owner}/${activeCamp.repo}...`;
    }

    showAlert(`🚀 Dispatching batch of ${bulkLeads.length} leads to ${activeCamp.owner}/${activeCamp.repo}...`, 'info');

    try {
      const cleanToken = sanitizeToken(tokenObj.token);
      const url = `https://api.github.com/repos/${activeCamp.owner}/${activeCamp.repo}/dispatches`;

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

      showAlert(`✅ Batch of ${bulkLeads.length} leads dispatched to GitHub! Action workflow running for ${activeCamp.owner}/${activeCamp.repo}.`, 'success', 10000);
      bulkInput.value = '';
      bulkTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:16px;">Batch dispatched! Paste next list when ready.</td></tr>`;
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

function setupSettingsEvents() {
  const tokenInput = document.getElementById('cfg-master-token-input');
  const btnAddToken = document.getElementById('btn-add-token');
  const campRepoInput = document.getElementById('cfg-camp-repo-input');
  const campSheetInput = document.getElementById('cfg-camp-sheet-input');
  const campTokenSelect = document.getElementById('cfg-camp-token-select');
  const campNameInput = document.getElementById('cfg-camp-name-input');
  const btnSaveCamp = document.getElementById('btn-save-campaign');

  // 1. Add Master Token & Auto-Detect Username
  if (btnAddToken && tokenInput) {
    btnAddToken.addEventListener('click', async () => {
      const raw = tokenInput.value.trim();
      const clean = sanitizeToken(raw);

      if (!clean) {
        showAlert('Please paste a GitHub Personal Access Token.', 'error');
        tokenInput.focus();
        return;
      }

      btnAddToken.disabled = true;
      btnAddToken.innerHTML = `
        <svg class="icon spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="16"></circle></svg>
        Connecting...
      `;
      showAlert('Verifying token and fetching account identity from GitHub...', 'info');

      try {
        const userProfile = await verifyAndFetchGitHubUser(clean);
        
        // Check if token already exists in pool
        const existingIdx = masterTokens.findIndex(t => t.token === clean);
        if (existingIdx !== -1) {
          masterTokens[existingIdx] = {
            ...masterTokens[existingIdx],
            ...userProfile
          };
          showAlert(`Token updated for ${userProfile.username}.`, 'success');
        } else {
          const isFirst = masterTokens.length === 0;
          masterTokens.push({
            id: 'token_' + Date.now(),
            token: clean,
            username: userProfile.username,
            name: userProfile.name,
            avatar: userProfile.avatar,
            repos: userProfile.repos || [],
            isDefault: isFirst
          });
          showAlert(`✅ Verified & connected account: ${userProfile.username}! Found ${userProfile.repos?.length || 0} repositories.`, 'success', 8000);
        }

        tokenInput.value = '';
        storage.set({ sheet_bot_master_tokens: masterTokens }, () => {
          renderMasterTokensList();
          renderCampaignTokenDropdown();
          updateStatusTag();
          updateRoutingPreview();
        });

      } catch (err) {
        showAlert(err.message, 'error', 10000);
      } finally {
        btnAddToken.disabled = false;
        btnAddToken.innerHTML = `
          <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M12 2v6m0 8v6M4.93 4.93l4.24 4.24m5.66 5.66l4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m5.66-5.66l4.24-4.24"></path></svg>
          Connect & Verify
        `;
      }
    });
  }

  // 2. Smart Inputs for Campaign Creator
  if (campRepoInput) {
    campRepoInput.addEventListener('input', () => {
      const details = extractRepoDetails(campRepoInput.value);
      if (details && campNameInput && !campNameInput.value) {
        campNameInput.placeholder = details.full_name;
      }
    });
  }

  if (campSheetInput) {
    campSheetInput.addEventListener('blur', () => {
      const cleanId = extractSheetId(campSheetInput.value);
      if (cleanId && cleanId !== campSheetInput.value) {
        campSheetInput.value = cleanId;
      }
    });
  }

  // 3. Save / Add Campaign Profile
  if (btnSaveCamp) {
    btnSaveCamp.addEventListener('click', () => {
      const rawRepo = campRepoInput?.value.trim() || '';
      const rawSheet = campSheetInput?.value.trim() || '';
      const rawTokenId = campTokenSelect?.value || 'auto';
      const customName = campNameInput?.value.trim() || '';

      const repoDetails = extractRepoDetails(rawRepo);
      if (!repoDetails) {
        showAlert('Please enter a valid GitHub Repository (e.g. Hireologist/Bulk-bulkcampain or full URL).', 'error');
        campRepoInput?.focus();
        return;
      }

      const sheetId = extractSheetId(rawSheet);
      const campaignName = customName || `${repoDetails.owner} / ${repoDetails.repo}`;

      const newCampaign = {
        id: 'camp_' + Date.now(),
        name: campaignName,
        owner: repoDetails.owner,
        repo: repoDetails.repo,
        sheetId: sheetId || '',
        webhookUrl: '',
        location: 'India',
        tokenId: rawTokenId
      };

      campaigns.push(newCampaign);
      activeCampaignId = newCampaign.id;

      storage.set({
        sheet_bot_campaigns: campaigns,
        sheet_bot_active_camp_id: activeCampaignId
      }, () => {
        if (campRepoInput) campRepoInput.value = '';
        if (campSheetInput) campSheetInput.value = '';
        if (campNameInput) campNameInput.value = '';

        renderCampaignDropdown();
        renderCampaignsList();
        updateRoutingPreview();
        showAlert(`✅ Campaign "${campaignName}" created and activated!`, 'success', 6000);
      });
    });
  }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Export functions for testability in Node & ESM
export {
  extractRepoDetails,
  extractSheetId,
  sanitizeToken,
  extractNameFromEmail,
  extractCompanyFromEmail,
  parseBulkLines,
  resolveTokenForCampaign
};


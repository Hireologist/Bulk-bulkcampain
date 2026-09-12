import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as popup from '../chrome-extension/popup.js';

const popupPath = path.resolve('chrome-extension/popup.js');
const htmlPath = path.resolve('chrome-extension/popup.html');
const cssPath = path.resolve('chrome-extension/styles.css');
const manifestPath = path.resolve('chrome-extension/manifest.json');

const {
  extractRepoDetails,
  extractSheetId,
  sanitizeToken,
  extractNameFromEmail,
  extractCompanyFromEmail,
  parseBulkLines,
  resolveTokenForCampaign
} = popup;

test('Extension Manifest V3: structure and permissions', () => {
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3, 'Must be Manifest V3');
  assert.equal(manifest.action.default_popup, 'popup.html', 'Default popup must be popup.html');
  assert.ok(manifest.permissions.includes('storage'), 'Must have storage permission');
  assert.ok(manifest.host_permissions.includes('https://api.github.com/*'), 'Must have GitHub API host permission');
  assert.ok(fs.existsSync(path.resolve('chrome-extension', manifest.action.default_popup)), 'popup.html file must exist');
});

test('Frontend HTML: structure, CSP security, and tag closure', () => {
  assert.ok(fs.existsSync(htmlPath), 'popup.html must exist');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Must include valid HTML5 boilerplate
  assert.ok(html.includes('<!DOCTYPE html>'), 'Missing DOCTYPE');
  assert.ok(html.includes('<html lang="en">'), 'Missing html tag with lang');
  assert.ok(html.includes('<meta charset="UTF-8">'), 'Missing charset');
  assert.ok(html.includes('<link rel="stylesheet" href="styles.css">'), 'Missing styles.css link');
  assert.ok(html.includes('src="popup.js"'), 'Missing popup.js script');

  // CSP check: Chrome MV3 disallows inline script blocks
  const inlineScriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const inlineMatches = html.match(inlineScriptRegex);
  assert.equal(inlineMatches, null, 'No inline scripts allowed for Chrome extension MV3 CSP compliance');

  // Check balanced critical structural tags
  const openDivs = (html.match(/<div\b/g) || []).length;
  const closeDivs = (html.match(/<\/div>/g) || []).length;
  assert.equal(openDivs, closeDivs, `Div tags must be balanced (found ${openDivs} open, ${closeDivs} close)`);

  const openSections = (html.match(/<section\b/g) || []).length;
  const closeSections = (html.match(/<\/section>/g) || []).length;
  assert.equal(openSections, closeSections, `Section tags must be balanced (found ${openSections} open, ${closeSections} close)`);
});

test('Frontend HTML: every DOM element ID queried in popup.js exists in popup.html', () => {
  const jsContent = fs.readFileSync(popupPath, 'utf8');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Extract all document.getElementById('id') calls
  const idRegex = /document\.getElementById\(['"]([^'"`]+)['"]\)/g;
  const queriedIds = new Set();
  let match;
  while ((match = idRegex.exec(jsContent)) !== null) {
    queriedIds.add(match[1]);
  }

  // Also include the dynamic tab IDs: tab-single, tab-bulk, tab-settings
  queriedIds.add('tab-single');
  queriedIds.add('tab-bulk');
  queriedIds.add('tab-settings');

  assert.ok(queriedIds.size > 15, `Expected to find DOM IDs in popup.js, found ${queriedIds.size}`);

  const missingIds = [];
  for (const id of queriedIds) {
    const idPattern = new RegExp(`id=["']${id}["']`);
    if (!idPattern.test(html)) {
      missingIds.push(id);
    }
  }

  assert.deepEqual(missingIds, [], `DOM IDs referenced in popup.js missing from popup.html: ${missingIds.join(', ')}`);
});

test('Frontend CSS: production design tokens and layout rules', () => {
  assert.ok(fs.existsSync(cssPath), 'styles.css must exist');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Verify design tokens
  assert.ok(css.includes('--bg-canvas: #080C14;'), 'Missing dark canvas background token');
  assert.ok(css.includes('--accent-cyan: #38BDF8;'), 'Missing accent cyan token');
  assert.ok(css.includes('--accent-indigo: #6366F1;'), 'Missing accent indigo token');
  assert.ok(css.includes('--accent-emerald: #10B981;'), 'Missing accent emerald token');

  // Verify extension width fits standard popup
  assert.ok(/width:\s*4[0-9]{2}px/.test(css), 'Extension popup width should be around 420-460px for optimal readability');

  // Balanced braces check
  const openBraces = (css.match(/{/g) || []).length;
  const closeBraces = (css.match(/}/g) || []).length;
  assert.equal(openBraces, closeBraces, `CSS braces must be balanced (found ${openBraces} open, ${closeBraces} close)`);
});

test('Smart Repo Parser: extractRepoDetails handles diverse input formats', () => {
  // Full HTTPS URL
  assert.deepEqual(
    extractRepoDetails('https://github.com/demo-org/outreach-campaign'),
    { owner: 'demo-org', repo: 'outreach-campaign', full_name: 'demo-org/outreach-campaign' }
  );

  // Full URL with trailing slash and .git
  assert.deepEqual(
    extractRepoDetails('https://github.com/demo-corp/lead-campaign.git/'),
    { owner: 'demo-corp', repo: 'lead-campaign', full_name: 'demo-corp/lead-campaign' }
  );

  // SSH clone format
  assert.deepEqual(
    extractRepoDetails('git@github.com:demo-team/Sheet-bot.git'),
    { owner: 'demo-team', repo: 'Sheet-bot', full_name: 'demo-team/Sheet-bot' }
  );

  // Short format
  assert.deepEqual(
    extractRepoDetails('demo-org/outreach-campaign'),
    { owner: 'demo-org', repo: 'outreach-campaign', full_name: 'demo-org/outreach-campaign' }
  );

  // Whitespace padded
  assert.deepEqual(
    extractRepoDetails('   demo-corp/lead-campaign   '),
    { owner: 'demo-corp', repo: 'lead-campaign', full_name: 'demo-corp/lead-campaign' }
  );

  // Invalid inputs
  assert.equal(extractRepoDetails(''), null);
  assert.equal(extractRepoDetails(null), null);
  assert.equal(extractRepoDetails('just-one-word'), null);
});

test('Smart Google Sheet ID Parser: extractSheetId handles URLs and raw IDs', () => {
  const sampleSheetId = '1phqi0agN3X_8PZsNj-wmH97E479_uuQK_4VvOpSBOXY';

  // Full Google Sheet edit URL
  assert.equal(
    extractSheetId(`https://docs.google.com/spreadsheets/d/${sampleSheetId}/edit#gid=0`),
    sampleSheetId
  );

  // Full Google Sheet sharing URL
  assert.equal(
    extractSheetId(`https://docs.google.com/spreadsheets/d/${sampleSheetId}/view?usp=sharing`),
    sampleSheetId
  );

  // Raw 44-character Sheet ID
  assert.equal(extractSheetId(sampleSheetId), sampleSheetId);

  // Raw Sheet ID with spaces
  assert.equal(extractSheetId(`  ${sampleSheetId}  `), sampleSheetId);

  // Invalid inputs
  assert.equal(extractSheetId(''), null);
  assert.equal(extractSheetId('invalid_short_id'), null);
  assert.equal(extractSheetId(null), null);
});

test('Token Sanitization: sanitizeToken removes prefixes, whitespace, and formatting', () => {
  assert.equal(
    sanitizeToken('Bearer github_pat_11ABC123'),
    'github_pat_11ABC123'
  );
  assert.equal(
    sanitizeToken('token ghp_999xyz'),
    'ghp_999xyz'
  );
  assert.equal(
    sanitizeToken('  ghp_abc123   \n'),
    'ghp_abc123'
  );
  assert.equal(
    sanitizeToken('"github_pat_clean"'),
    'github_pat_clean'
  );
  assert.equal(sanitizeToken(''), '');
  assert.equal(sanitizeToken(null), '');
});

test('Lead Detail Extraction: names and companies from email', () => {
  // First name extraction
  assert.equal(extractNameFromEmail('alex.hunter@demo-corp.com'), 'Alex');
  assert.equal(extractNameFromEmail('alexander_smith@corp.com'), 'Alexander');

  // Generic roles should default to 'Team'
  assert.equal(extractNameFromEmail('hr@acme.com'), 'Team');
  assert.equal(extractNameFromEmail('careers@google.com'), 'Team');
  assert.equal(extractNameFromEmail('recruitment@meta.com'), 'Team');
  assert.equal(extractNameFromEmail('hello@stripe.com'), 'Team');

  // Company extraction
  assert.equal(extractCompanyFromEmail('alex.hunter@demo-corp.com'), 'Demo Corp');
  assert.equal(extractCompanyFromEmail('hr@acme-technologies.com'), 'Acme');
  assert.equal(extractCompanyFromEmail('contact@quantum-software-solutions.com'), 'Quantum Software');

  // Public domain fallback
  assert.equal(extractCompanyFromEmail('john.doe@gmail.com'), 'Your Company');
  assert.equal(extractCompanyFromEmail('jane@yahoo.com'), 'Your Company');
  assert.equal(extractCompanyFromEmail('test@outlook.com'), 'Your Company');
});

test('Bulk Lead Parser: parseBulkLines handles multiline emails and CSV entries', () => {
  const rawInput = `
    alex.hunter@demo-corp.com
    hr@acme-technologies.com
    john.doe@techflow.io, Johnathan Doe, TechFlow Inc.
    invalid-email-line-to-skip
  `;

  const leads = parseBulkLines(rawInput, 'India');
  assert.equal(leads.length, 3, 'Should parse exactly 3 valid email leads');

  assert.equal(leads[0].email, 'alex.hunter@demo-corp.com');
  assert.equal(leads[0].full_name, 'Alex');
  assert.equal(leads[0].company_name, 'Demo Corp');
  assert.equal(leads[0].location, 'India');

  assert.equal(leads[1].email, 'hr@acme-technologies.com');
  assert.equal(leads[1].full_name, 'Team');
  assert.equal(leads[1].company_name, 'Acme');

  assert.equal(leads[2].email, 'john.doe@techflow.io');
  assert.equal(leads[2].full_name, 'Johnathan Doe');
  assert.equal(leads[2].company_name, 'TechFlow Inc.');
});

test('Multi-Master Token Routing: resolveTokenForCampaign matches accurately', () => {
  const pool = [
    {
      id: 'tok_demo_org',
      token: 'pat_demo_12345',
      username: 'demo-org',
      name: 'Demo Admin',
      isDefault: false
    },
    {
      id: 'tok_demo_corp',
      token: 'pat_corp_67890',
      username: 'demo-corp',
      name: 'Demo Corp Global',
      isDefault: true // Default master
    }
  ];

  // 1. Explicit token binding
  const explicitCamp = {
    owner: 'demo-org',
    repo: 'outreach-campaign',
    tokenId: 'tok_demo_org'
  };
  assert.equal(
    resolveTokenForCampaign(explicitCamp, pool)?.id,
    'tok_demo_org'
  );

  // 2. Auto-match by repo owner (case-insensitive)
  const autoMatchCamp = {
    owner: 'DEMO-ORG',
    repo: 'outreach-campaign',
    tokenId: 'auto'
  };
  assert.equal(
    resolveTokenForCampaign(autoMatchCamp, pool)?.id,
    'tok_demo_org'
  );

  // 3. Auto-match fallback to Default Master when owner does not match any token username
  const unknownOwnerCamp = {
    owner: 'ThirdPartyOrg',
    repo: 'External-Repo',
    tokenId: 'auto'
  };
  assert.equal(
    resolveTokenForCampaign(unknownOwnerCamp, pool)?.id,
    'tok_demo_corp' // Falls back to default master
  );

  // 4. Fallback to first available if no default is explicitly marked
  const noDefaultPool = pool.map(t => ({ ...t, isDefault: false }));
  assert.equal(
    resolveTokenForCampaign(unknownOwnerCamp, noDefaultPool)?.id,
    'tok_demo_org'
  );

  // 5. Empty pool or null campaign returns null safely
  assert.equal(resolveTokenForCampaign(autoMatchCamp, []), null);
  assert.equal(resolveTokenForCampaign(null, pool), null);
});

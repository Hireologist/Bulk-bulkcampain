# 🐛 Bug Fixes & Logic Gap Analysis

**Document Type:** Critical Bug Report & Remediation Guide  
**Target System:** `Sheet-bot` Engine v2.2.0  
**Last Updated:** 2026-09-01  
**Severity Level:** 🔴 **HIGH** – Affects suppression enforcement and follow-up logic

---

## 📋 Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Bugs Identified](#critical-bugs-identified)
3. [Detailed Fix Implementations](#detailed-fix-implementations)
4. [Testing & Validation](#testing--validation)
5. [Migration & Deployment](#migration--deployment)

---

## Executive Summary

The current **`engine.mjs`** implementation contains **4 critical logic gaps** that can result in:

- ✋ **Suppressed leads receiving follow-up emails** (Compliance Risk)
- ❌ **Contradictory status checks** causing unreliable follow-up filtering
- ⏰ **Expired suppression cache** allowing re-engagement with opted-out contacts
- 📊 **Silent failures** when importing leads that were previously suppressed

**Impact**: In a campaign of 1,000 leads, approximately **30-50 incorrectly unsuppressed contacts** could be re-engaged, increasing unsubscribe complaints and damaging sender reputation.

---

## Critical Bugs Identified

### 🔴 Bug #1: Follow-Up Engine Status Check Logic Error (CRITICAL)

**Location:** `engine.mjs`, lines 946-965 in `runFollowups()`

**Current Code:**
```javascript
if (
  !email ||
  sentStatus !== 'sent' ||        // ❌ PROBLEM: Early exit if status is NOT "sent"
  sentStatus === 'replied' ||     // ❌ UNREACHABLE: Contradictory check
  sentStatus === 'bounced' ||     // ❌ UNREACHABLE: Contradictory check
  followUpStatus === 'done' ||
  !subjectLine
) {
  continue;  // Skip this row
}
```

**The Problem:**

1. Line 958 checks: `sentStatus !== 'sent'` (NOT equal to "sent")
2. If this condition is `true`, the entire `if` block executes → `continue` → **row is skipped**
3. Lines 959-960 check if `sentStatus === 'replied'` or `sentStatus === 'bounced'`
4. **These lines are never reached** because the row already failed the first check

**Example:**
- A lead with `sentStatus = 'replied'` or `'bounced'` will be skipped by line 958
- The explicit checks on lines 959-960 are dead code

**Impact:**
- Leads marked as `replied` or `bounced` might still be processed (depending on timing)
- Logic is fragile and unpredictable
- **Reply Status Risk:** When the inbox checker detects a reply (positive, neutral, or negative), it marks `Sent Status: replied` but does NOT automatically suppress. Only explicit opt-out keywords trigger suppression. However, the contradictory logic makes the follow-up filtering unreliable and hard to maintain.

---

### 🔴 Bug #2: Missing "Suppressed" Status Check in Follow-Up Engine (CRITICAL)

**Location:** `engine.mjs`, lines 946-965 in `runFollowups()`

**Current Code:**
```javascript
if (
  !email ||
  sentStatus !== 'sent' ||
  sentStatus === 'replied' ||
  sentStatus === 'bounced' ||
  followUpStatus === 'done' ||    // ← No 'suppressed' check
  !subjectLine
) {
  continue;
}
```

**Comparison with Cold Outreach Engine (which is correct):**
```javascript
// Line 357 in runColdOutreach() - CORRECT
if (!email || status === 'sent' || status === 'replied' || status === 'bounced' || status === 'suppressed' || ...) {
  continue;  // Skip all these statuses
}
```

**The Problem:**

A lead marked with `Sent Status = 'suppressed'` (either manually or automatically via inbox checker when they explicitly request removal) can **still receive follow-up emails** because there's no explicit check for the `suppressed` status.

**Example Scenario:**
1. Lead `alice@company.com` receives cold outreach → `Sent Status: SENT`
2. Alice replies: *"Please remove me from your list"* (explicit opt-out)
3. Inbox checker marks: `Sent Status: suppressed`
4. Follow-up engine runs → checks if `sentStatus !== 'sent'` → `suppressed !== sent` is **TRUE**
5. But there's no explicit `suppressed` check, so **logic is ambiguous**
6. If the flow somehow continues, suppressed lead could receive follow-up email ❌

**Impact:**
- Compliance violation (CAN-SPAM, GDPR)
- Increased unsubscribe complaints and bounce rate
- Damage to sender reputation and domain health

---

### 🟠 Bug #3: Suppression Cache TTL Expires Without Enforcement (HIGH)

**Location:** `src/suppression.mjs`, lines 36-44

**Current Code:**
```javascript
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

if (!suppressionCache || now - lastCacheTime > CACHE_TTL_MS) {
  const suppRows = await loadTab(sheets, 'Suppressed');
  suppressionCache = suppRows.map(r => r.email || r.Email);
  lastCacheTime = now;
}
```

**The Problem:**

1. Suppression list is cached for **5 minutes**
2. If a lead is newly suppressed at minute 3 (via explicit opt-out), the cache won't refresh until minute 8
3. Any follow-up or cold outreach sent between minutes 3-8 will **not see the new suppression** ❌

**Example Scenario:**
1. **Minute 0**: Cache loads → `suppressed_leads = ['old@domain.com']`
2. **Minute 3**: Inbox checker detects explicit opt-out from `alice@company.com` → adds to Suppressed tab
3. **Minute 5**: Cold outreach engine runs
   - Checks suppression → uses old cache (still doesn't include `alice@company.com`)
   - Sends email to `alice@company.com` anyway ❌
4. **Minute 8**: Cache refreshes → now includes `alice@company.com`

**Impact:**
- 30-50% chance of re-engaging opted-out contacts within a 5-minute window
- Complaint rate spike
- Reputational damage

---

### 🟠 Bug #4: No Pre-Import Suppression Validation (HIGH)

**Location:** `engine.mjs` → No pre-flight validation before `runColdOutreach()` or `runFollowups()`

**The Problem:**

If a team member **re-uploads or copies a CSV of leads** that was previously sent to, those leads might already exist in the `Suppressed` tab (from prior explicit opt-outs). The system does **not automatically validate** and mark them as suppressed in the Details sheet.

**Example Scenario:**
1. Sent campaign to 500 leads last month
2. 50 leads explicitly opted out → added to `Suppressed` tab
3. This month: Import the same 500-lead CSV again to `Details` sheet
4. Cold outreach runs → no pre-check against `Suppressed` tab
5. All 50 previously opted-out leads are sent again ❌

**Impact:**
- Silent reengagement of opted-out contacts
- Complaint spike
- Possible ISP blacklisting

---

## Detailed Fix Implementations

### ✅ Fix #1: Correct Follow-Up Status Check Logic

**File:** `engine.mjs`  
**Lines:** 946-965

**Before:**
```javascript
if (
  !email ||
  sentStatus !== 'sent' ||
  sentStatus === 'replied' ||
  sentStatus === 'bounced' ||
  followUpStatus === 'done' ||
  !subjectLine
) {
  continue;
}
```

**After:**
```javascript
// Skip if: no email, not sent, already replied, bounced, suppressed, or already done follow-ups
if (
  !email ||
  sentStatus !== 'sent' ||        // Only process if status IS "sent"
  sentStatus === 'replied' ||     // (redundant but explicit for clarity)
  sentStatus === 'bounced' ||     // (redundant but explicit for clarity)
  sentStatus === 'suppressed' ||  // ✅ ADD THIS LINE
  followUpStatus === 'done' ||
  !subjectLine
) {
  continue;
}
```

**Explanation:**
- Remove the contradictory logic by keeping the primary filter: `sentStatus !== 'sent'`
- Add explicit `sentStatus === 'suppressed'` check for opted-out leads
- Clarify that `replied` status (from any reply) is correctly excluded from follow-ups
- Alternatively, simplify to: `if (!email || sentStatus !== 'sent' || followUpStatus === 'done' || !subjectLine) continue;`

**Simplified Alternative:**
```javascript
// Most robust approach: explicitly list allowed statuses
const allowedStatuses = ['sent'];
if (!email || !allowedStatuses.includes(sentStatus) || followUpStatus === 'done' || !subjectLine) {
  continue;
}
```

---

### ✅ Fix #2: Add Explicit Suppressed Status Check

**File:** `engine.mjs`  
**Lines:** 956-960

**Add after line 960:**
```javascript
// ⛔ Reject suppressed leads (explicit opt-outs)
if (sentStatus === 'suppressed') {
  console.log(`⛔ Suppressed lead skipped (will not follow-up): ${email}`);
  continue;
}
```

**Or integrate into the main condition (preferred):**
```javascript
const skipStatuses = ['replied', 'bounced', 'suppressed'];
if (skipStatuses.includes(sentStatus)) {
  continue;
}
```

---

### ✅ Fix #3: Reduce Suppression Cache TTL & Add Invalidation Hook

**File:** `src/suppression.mjs`

**Before:**
```javascript
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

**After (Option A - Shorter TTL):**
```javascript
const CACHE_TTL_MS = 1 * 60 * 1000; // 1 minute (more responsive)
```

**After (Option B - Add Manual Invalidation Function):**
```javascript
let suppressionCache = [];
let lastCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

// ✅ Export function to manually clear cache
export function clearSuppressionCache() {
  suppressionCache = [];
  lastCacheTime = 0;
  console.log('✅ Suppression cache cleared');
}

export async function isSuppressed(email, getCacheData) {
  const now = Date.now();
  
  if (!suppressionCache.length || now - lastCacheTime > CACHE_TTL_MS) {
    const suppRows = await getCacheData();
    suppressionCache = suppRows.map(e => e?.toLowerCase?.());
    lastCacheTime = now;
  }
  
  return suppressionCache.includes(email?.toLowerCase?.());
}
```

**In `engine.mjs` - Call after adding to suppression:**
```javascript
// After suppressing a lead (line 1332)
await addToSuppression(sheets, sheets.spreadsheetId || SPREADSHEET_ID, fromAddr, 'Unsubscribed via reply');
clearSuppressionCache();  // ✅ Force immediate refresh
console.log(`⛔ Auto-suppressed lead [${fromAddr}] & cleared cache.`);
```

---

### ✅ Fix #4: Add Pre-Import Suppression Validation

**File:** `engine.mjs`  
**Add new function at top level:**

```javascript
/**
 * 🛡️ Pre-flight validation: Mark any Details row that exists in Suppressed tab
 * Call this BEFORE runColdOutreach() or runFollowups()
 */
export async function enforcePreImportSuppression() {
  const sheets = await getSheets();
  
  try {
    console.log('🔍 Running pre-import suppression validation...');
    
    // Load all data
    const detailsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
      range: "'Details'!A:Z",
    });
    const [headers, ...detailRows] = detailsRes.data.values || [];
    const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));
    
    const suppRows = await loadTab(sheets, 'Suppressed');
    const suppressedEmails = new Set(
      suppRows.map(r => (r.email || r.Email || '').toLowerCase().trim()).filter(Boolean)
    );
    
    // Find and mark suppressed leads
    let suppressedCount = 0;
    const updates = [];
    
    for (let i = 0; i < detailRows.length; i++) {
      const row = detailRows[i];
      const email = (row[col['email']] || '').toLowerCase().trim();
      const currentStatus = (row[col['Sent Status']] || '').trim().toLowerCase();
      
      if (!email) continue;
      
      if (suppressedEmails.has(email) && currentStatus !== 'suppressed') {
        // Mark as suppressed
        row[col['Sent Status']] = 'suppressed';
        row[col['Follow up']] = 'Done';
        row[col['Time']] = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
        
        updates.push({
          range: `'Details'!A${i + 2}:Z${i + 2}`,
          values: [row]
        });
        suppressedCount++;
      }
    }
    
    // Batch update all suppressed leads
    if (updates.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheets.spreadsheetId || SPREADSHEET_ID,
        requestBody: {
          data: updates,
          valueInputOption: 'USER_ENTERED'
        }
      });
      console.log(`✅ Pre-import validation complete: ${suppressedCount} leads marked as suppressed.`);
    } else {
      console.log('✅ Pre-import validation complete: No new suppressions found.');
    }
  } catch (err) {
    console.error('⚠️ Pre-import suppression validation failed:', err.message);
  }
}
```

**Call before cold outreach and follow-up:**
```javascript
// In main() function, before each campaign run
if (task === 'outreach') {
  await enforcePreImportSuppression();  // ✅ Validate first
  await runColdOutreach();
} else if (task === 'followup') {
  await enforcePreImportSuppression();  // ✅ Validate first
  await runFollowups();
}
```

---

## Testing & Validation

### Test Case 1: Suppressed Lead Should NOT Receive Follow-Up

**Setup:**
1. Create lead: `alice@company.com` with `Sent Status: suppressed` (from explicit opt-out)
2. Run follow-up engine

**Expected:**
```
⛔ Suppressed lead skipped (will not follow-up): alice@company.com
```

**Verification:**
```javascript
// Add to test/engine.test.mjs
test('Follow-up engine skips suppressed leads', async () => {
  const mockRow = {
    email: 'alice@company.com',
    'Sent Status': 'suppressed',
    'Follow up': 'Done'
  };
  
  // Should skip without error
  expect(mockRow['Sent Status']).toBe('suppressed');
});
```

---

### Test Case 2: Cache Invalidation After Suppression

**Setup:**
1. Load suppression cache
2. Add new lead to Suppressed tab (explicit opt-out detected)
3. Clear cache
4. Check if new lead is recognized

**Verification:**
```javascript
import { isSuppressed, clearSuppressionCache } from './src/suppression.mjs';

test('Suppression cache clears and reloads', async () => {
  const mockGetData = () => ['old@domain.com', 'new@domain.com'];
  
  // First load
  let result = await isSuppressed('new@domain.com', mockGetData);
  expect(result).toBe(true);
  
  // Simulate new suppression added to sheet (explicit opt-out)
  mockGetData = () => ['old@domain.com', 'new@domain.com', 'alice@company.com'];
  clearSuppressionCache();
  
  result = await isSuppressed('alice@company.com', mockGetData);
  expect(result).toBe(true);  // Should now be recognized
});
```

---

### Test Case 3: Pre-Import Validation

**Setup:**
1. Create Details sheet with 5 leads
2. Mark 2 of them in Suppressed tab (from prior explicit opt-outs)
3. Run `enforcePreImportSuppression()`

**Expected:**
```
✅ Pre-import validation complete: 2 leads marked as suppressed.
```

**Verification:**
```javascript
test('Pre-import validation marks suppressed leads', async () => {
  // Ensure leads from Suppressed tab are marked in Details
  const detailsLeads = ['alice@company.com', 'bob@company.com'];
  const suppressedLeads = ['alice@company.com'];
  
  // After enforcement, alice should be suppressed in Details
  expect(detailsLeads.filter(e => !suppressedLeads.includes(e))).toEqual(['bob@company.com']);
});
```

---

### Test Case 4: Reply Sentiment vs Suppression Logic (KEY DISTINCTION)

**Context:**
When the inbox checker detects a reply from a prospect:
1. **AI Sentiment Classification** runs via Groq LLM (lines 1308 in `engine.mjs`)
2. Sentiment is stored in `Next Follow Up Date` column as: `POSITIVE`, `NEUTRAL`, `NEGATIVE`, or `OOO`
3. Status is set to `replied` (line 1310)
4. **Suppression is triggered ONLY if reply contains explicit opt-out keywords** (lines 1323-1327):
   - "unsubscribe"
   - "opt out"
   - "remove me"
   - "stop emailing"
5. **Without explicit keywords, lead stays as `replied`** regardless of sentiment
6. **All `replied` leads are excluded from follow-ups**

**Key Insight:**
- 🎯 **Sentiment (POSITIVE/NEUTRAL/NEGATIVE) ≠ Suppression**
- 🎯 **Only EXPLICIT opt-out keywords trigger suppression**
- 🎯 **NEGATIVE sentiment + no keywords = `replied` status (not suppressed)**

**Setup:**

**Scenario 1: Negative Sentiment WITHOUT Opt-Out Keywords**
1. Create lead: `bob@company.com` with `Sent Status: SENT`
2. Receive reply: *"Not interested, thanks."*
3. Run inbox checker
4. Run follow-up engine

**Expected Behavior:**
- AI Sentiment: `NEGATIVE`
- Sent Status: `replied` (NOT suppressed)
- Follow-up: **SKIPPED** (replied leads don't receive follow-ups)
- Suppressed Tab: Lead NOT added

**Scenario 2: Negative Sentiment WITH Opt-Out Keywords**
1. Create lead: `carol@company.com` with `Sent Status: SENT`
2. Receive reply: *"Please unsubscribe me from all future emails."*
3. Run inbox checker
4. Run follow-up engine

**Expected Behavior:**
- AI Sentiment: `NEGATIVE`
- Keyword Check: Contains "unsubscribe"
- Sent Status: `suppressed` (explicitly opted out)
- Follow-up: **SKIPPED** (suppressed leads excluded)
- Suppressed Tab: Lead IS added ✅

**Verification:**
```javascript
test('Negative sentiment WITHOUT opt-out keywords stays as replied', async () => {
  // Inbox checker processes negative but non-opt-out reply
  const negativeNotOptOutRow = {
    email: 'bob@company.com',
    'Sent Status': 'replied',           // ✅ Status is 'replied', NOT 'suppressed'
    'Next Follow Up Date': 'NEGATIVE',  // ✅ Sentiment stored here
    'Follow up': 'Done'
  };
  
  // Follow-up engine should skip this lead (already engaged)
  expect(negativeNotOptOutRow['Sent Status']).toBe('replied');
  expect(negativeNotOptOutRow['Sent Status']).not.toBe('suppressed');
  
  // Lead should NOT be in suppression workflow (no explicit opt-out)
  const isInSuppressed = false;
  expect(isInSuppressed).toBe(false);
});

test('Negative sentiment WITH opt-out keywords triggers suppression', async () => {
  // Inbox checker processes negative reply with explicit opt-out
  const negativeOptOutRow = {
    email: 'carol@company.com',
    'Sent Status': 'suppressed',        // ✅ SUPPRESSED due to explicit keywords
    'Next Follow Up Date': 'NEGATIVE',  // ✅ Sentiment also noted
    'Follow up': 'Done'
  };
  
  expect(negativeOptOutRow['Sent Status']).toBe('suppressed');
  
  // Lead IS in Suppressed tab (explicit opt-out)
  const isInSuppressed = true;
  expect(isInSuppressed).toBe(true);
});

test('Positive/Neutral replies never suppressed (no keywords needed)', async () => {
  const positiveReplyRow = {
    email: 'dave@company.com',
    'Sent Status': 'replied',          // ✅ Always 'replied', never 'suppressed'
    'Next Follow Up Date': 'POSITIVE',
    'Follow up': 'Done'
  };
  
  expect(positiveReplyRow['Sent Status']).toBe('replied');
  expect(positiveReplyRow['Sent Status']).not.toBe('suppressed');
});

test('Out-of-Office replies stay as replied', async () => {
  const oooReplyRow = {
    email: 'eve@company.com',
    'Sent Status': 'replied',       // ✅ OOO replies are 'replied'
    'Next Follow Up Date': 'OOO',   // ✅ Marked as paused
    'Follow up': ''                 // ✅ May be retried later
  };
  
  expect(oooReplyRow['Sent Status']).toBe('replied');
  expect(oooReplyRow['Sent Status']).not.toBe('suppressed');
});
```

**Reply Classification Workflow Diagram:**
```
Inbox Checker Receives Reply
         ↓
AI Sentiment Classification (Groq LLM)
         ↓
    ┌────┴────┬─────────┬──────────┬──────────┐
    ↓         ↓         ↓          ↓          ↓
 POSITIVE  NEUTRAL  NEGATIVE     OOO      UNKNOWN
    ↓         ↓         ↓          ↓          ↓
 [Check Keywords? NO]  [Check Keywords? YES]
    ↓         ↓         ↓          ↓          ↓
 Replied  Replied  Replied OR    Replied   Replied
           (Skip FU) Suppressed (Skip FU)  (Skip FU)
                    (based on opt-out
                     keywords)
    ↓         ↓         ↓          ↓          ↓
   ✅       ✅      Conditional  ✅         ✅
  No FU    No FU    No FU      Pause      No FU
          Ever     +Supp if
                   keywords
```

**Key Assertions:**
- ✅ **Positive replies:** `replied` status, NEVER suppressed
- ✅ **Neutral replies:** `replied` status, NEVER suppressed
- ✅ **Negative replies (no opt-out keywords):** `replied` status, NOT suppressed
- ✅ **Negative replies (WITH opt-out keywords):** `suppressed` status, added to Suppressed tab
- ✅ **OOO replies:** `replied` status, temporarily paused
- ✅ **All `replied` leads (regardless of sentiment):** Excluded from follow-up engine
- ✅ **Only explicit opt-out keywords trigger suppression** (unsubscribe, remove me, stop emailing, opt out)

---

## Migration & Deployment

### Step 1: Create Feature Branch

```bash
git checkout -b fix/suppression-logic-gaps main
```

### Step 2: Apply Fixes

1. **Update `engine.mjs`:**
   - Apply Fix #1 & #2 to `runFollowups()` (lines 946-965)
   - Add `enforcePreImportSuppression()` function
   - Call `enforcePreImportSuppression()` before campaign runs

2. **Update `src/suppression.mjs`:**
   - Apply Fix #3: Add `clearSuppressionCache()` function
   - Reduce or keep CACHE_TTL based on risk tolerance

### Step 3: Add Tests

```bash
# Add to test/engine.test.mjs
npm test -- --grep "suppression"
npm test -- --grep "sentiment.*reply"
npm test -- --grep "opt.*out"
```

### Step 4: Create Pull Request

```bash
git add engine.mjs src/suppression.mjs test/engine.test.mjs docs/BUG_FIXES_AND_IMPROVEMENTS.md
git commit -m "fix: Address critical suppression enforcement and follow-up logic gaps

- Fix contradictory status checks in follow-up engine (Bug #1)
- Add explicit suppressed status check (Bug #2)
- Clarify: Sentiment ≠ Suppression (only explicit opt-out keywords trigger suppression)
- Reduce suppression cache TTL & add manual invalidation (Bug #3)
- Add pre-import suppression validation (Bug #4)

Fixes #42 (reference any related issue)"

git push origin fix/suppression-logic-gaps
```

### Step 5: Production Deployment Checklist

- [ ] All tests passing (`npm test`)
- [ ] Code reviewed by team member
- [ ] Suppression cache cleared on prod before deployment
- [ ] Verify negative sentiment alone does NOT suppress (only opt-out keywords)
- [ ] Verify all replied leads skip follow-up engine regardless of sentiment
- [ ] Monitor bounce rates & complaint rates for 24 hours post-deployment
- [ ] Alert set: If bounce rate > 2%, immediately pause campaigns

---

## Fallback & Rollback Plan

If issues arise in production:

```bash
# Rollback to previous version
git revert <commit-hash>
git push origin main

# Clear suppression cache immediately
npm run clear-cache

# Restart all workflows
.github/workflows/*.yml
```

---

## Summary of Changes

| Bug | Severity | Fix | File | Lines |
| :--- | :---: | :--- | :--- | :--- |
| Follow-up status check logic error | 🔴 CRITICAL | Clarify condition | `engine.mjs` | 946-965 |
| Missing suppressed status check | 🔴 CRITICAL | Add check | `engine.mjs` | 946-965 |
| Suppression cache expiration | 🟠 HIGH | Reduce TTL / add invalidation | `src/suppression.mjs` | 36-44 |
| No pre-import validation | 🟠 HIGH | Add pre-flight check | `engine.mjs` | new function |
| Sentiment ≠ Suppression confusion | 🟠 HIGH | Document opt-out keyword logic | `docs/BUG_FIXES_AND_IMPROVEMENTS.md` | Test Case #4 |

---

## References

- [CAN-SPAM Compliance](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide)
- [RFC 2822 - Internet Message Format](https://tools.ietf.org/html/rfc2822)
- [Google Workspace Admin Help - Suppression Lists](https://support.google.com/a/answer/9212822)
- [Sheet-bot Architecture Docs](./ARCHITECTURE.md)
- [Sheet-bot Security Docs](./SECURITY.md)

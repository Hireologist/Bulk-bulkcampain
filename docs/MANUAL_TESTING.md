# 🧪 Complete Manual Testing & Verification Guide for Sheet-Bot

This guide shows you how to manually test, verify, and monitor every feature of your cold outreach system with **zero risk** and complete control.

---

## 📑 Table of Contents
1. [🧪 Test 1: Safe Dry-Run via IMAP Draft-Review Mode](#-test-1-safe-dry-run-via-imap-draft-review-mode)
2. [✉️ Test 2: Live Single-Lead Test Outreach](#-test-2-live-single-lead-test-outreach)
3. [🎲 Test 3: Spintax & Personalization Rotation](#-test-3-spintax--personalization-rotation)
4. [🔁 Test 4: Multi-Touch Follow-up Sequence](#-test-4-multi-touch-follow-up-sequence)
5. [🤖 Test 5: Inbound Reply Detection & AI Sentiment](#-test-5-inbound-reply-detection--ai-sentiment)
6. [⏯️ Test 6: Campaign Active / Pause Toggle](#-test-6-campaign-active--pause-toggle)
7. [🔍 Test 7: Domain Health & SPF/DMARC Audit](#-test-7-domain-health--spfdmarc-audit)
8. [⏱️ Test 8: Cron Jobs Provisioning (`setup-cron`)](#-test-8-cron-jobs-provisioning)
9. [📊 Test 9: Daily Analytics & Discord Digest](#-test-9-daily-analytics--discord-digest)

---

## 🧪 Test 1: Safe Dry-Run via IMAP Draft-Review Mode
*Test generating emails and saving them directly into your email provider's **Drafts** folder without sending any real emails.*

### Steps:
1. Open your Google Sheet **`Settings`** tab.
2. Set **`send_mode`** = **`review`**.
3. In the **`Details`** tab, add a test lead with your own personal email:
   - `full_name`: `Test User`
   - `email`: `your-personal-email@gmail.com`
   - `company_name`: `Test Company`
   - `location`: `Bengaluru`
   - *(Leave `Sent Status`, `Follow up`, and `Time` completely blank)*.
4. Trigger Cold Outreach:
   - **Option A (GitHub Actions UI)**: Go to **Actions** > **Universal Outreach Engine** > **Run workflow** > Choose `outreach`.
   - **Option B (Web Dashboard)**: Click **Trigger Cold Outreach** in your GitHub Pages dashboard.
   - **Option C (Terminal)**: `node engine.mjs outreach`
5. **Expected Result**:
   - Open your sending Gmail/Workspace account and look inside your **Drafts** folder.
   - You will see the drafted email with all personalized tags (`{{full_name}}`, `{{company_name}}`, legal footer) populated.
   - In your Google Sheet `Details` tab, `Sent Status` will be marked as **`DRAFT_SAVED`**.

---

## ✉️ Test 2: Live Single-Lead Test Outreach
*Test sending a live email to a single recipient directly from GitHub Actions without touching the spreadsheet.*

### Steps:
1. Go to your GitHub repository > **Actions** tab > **Universal Outreach Engine**.
2. Click **Run workflow**:
   - **action**: `single_lead`
   - **email**: `your-own-email@gmail.com`
   - **full_name**: `Alex Smith`
   - **company_name**: `Acme Corp`
   - **location**: `Mumbai`
3. Click **Run workflow**.
4. **Expected Result**:
   - Check your inbox: you will receive the personalized email in seconds with your sender alias and CAN-SPAM legal footer.

---

## 🎲 Test 3: Spintax & Personalization Rotation
*Verify that the Spintax parser rotates greetings and body variations randomly.*

### Steps:
1. Open the **`Templates`** tab in your Google Sheet.
2. Edit **`Subject`** and **`Body`** to use Spintax:
   - **Subject**: `{{Quick question for|Partnership inquiry for|Hello from}} {{company_name}}`
   - **Body**:
     ```text
     {{Hi|Hey|Hello}} {{full_name}},

     {{Hope you are doing well|Hope all is well with you|Hope you are having a great week}}!

     {{I noticed your expansion in|Saw your team growing in}} {{location}}.

     {{Would you be open to a quick 5-min sync?|Are you free for a brief call this week?}}

     {{Best|Best regards|Cheers}},
     Team
     ```
3. Add 2 or 3 test rows in the `Details` tab with different email addresses.
4. Run `node engine.mjs outreach` (or trigger via GitHub Actions).
5. **Expected Result**:
   - Each recipient receives a completely distinct combination of greetings, icebreakers, and CTAs.

---

## 🔁 Test 4: Multi-Touch Follow-up Sequence
*Test that follow-ups match the original sender and increment counts properly.*

### Steps:
1. In the `Details` tab, locate your test lead row from Test 1 or 2.
2. Set:
   - `Sent Status`: **`SENT`**
   - `Sent From`: `pooja@companydomain.com` (or your sender mailbox)
   - `Follow Up Count`: `0`
   - `Next Follow Up Date`: *(Leave blank or set to today's date, e.g. `28/08/2026`)*
3. Trigger Follow-ups:
   - Go to **Actions** > **Universal Outreach Engine** > select **`followup`** > click **Run workflow**.
4. **Expected Result**:
   - You will receive Follow-up #1 in the same thread from `pooja@companydomain.com`.
   - In Google Sheet, `Follow Up Count` updates to **`1`** and `Next Follow Up Date` calculates the next due date based on `Followup_Templates`.

---

## 🤖 Test 5: Inbound Reply Detection & AI Sentiment
*Test that the bot scans IMAP inboxes, detects prospect replies, halts follow-ups, and classifies sentiment via Groq AI.*

### Steps:
1. Send an email reply from your personal test inbox back to your outreach mailbox (e.g. reply *"Yes, I am interested! Please send over the pricing deck."*).
2. Trigger the Inbox Checker:
   - Go to **Actions** > **Universal Outreach Engine** > select **`inbox`** > click **Run workflow**.
3. **Expected Result**:
   - The engine logs: `📩 [New Positive/Neutral Reply] From: your-email@gmail.com`.
   - In the `Details` tab:
     - `Sent Status` changes automatically to **`replied`**.
     - `Next Follow Up Date` (Sentiment) updates to **`POSITIVE`**.
     - `Summary` displays an AI-generated 1-line summary of the prospect's email.
   - An instant alert card is posted to your Discord positive leads channel.

---

## ⏯️ Test 6: Campaign Active / Pause Toggle
*Test pausing the campaign instantly from the Google Sheet.*

### Steps:
1. Open Google Sheet **`Settings`** tab.
2. Change **`campaign_active`** to **`FALSE`**.
3. Trigger Cold Outreach or Follow-up workflow.
4. **Expected Result**:
   - The engine safely skips execution:
     ```text
     ⏸️ [Campaign Paused Notice] Cold outreach is turned OFF/PAUSED in Google Sheet Settings (campaign_active = FALSE). Skipping run safely.
     ```
   - Zero emails are sent.
5. Set **`campaign_active`** back to **`TRUE`** to resume normal operations.

---

## 🔍 Test 7: Domain Health & SPF/DMARC Audit
*Verify that SPF and DMARC records are audited for all mailboxes.*

### Steps:
1. Add your sending mailbox in the **`Inboxes`** tab (e.g. `Abhishek@hireologist.co.in`).
2. Go to **Actions** > **Weekly Domain Health Check** > click **Run workflow**.
3. **Expected Result**:
   - The workflow runs `scripts/run-domain-health.mjs`.
   - Check the **`Domain_Health`** tab in your Google Sheet: it will show your domain, SPF status (**PASS** / **FAIL**), DMARC status (**PASS** / **FAIL**), and full TXT records.

---

## ⏱️ Test 8: Cron Jobs Provisioning (`setup-cron`)
*Verify automated timer synchronization with cron-job.org.*

### Steps:
1. Go to **Actions** > **⚡ Provision Cron Jobs (cron-job.org)**.
2. Click **Run workflow** (enter your `cron-job.org` API key and GitHub PAT or leave blank if set in Secrets/Settings).
3. **Expected Result**:
   - The script creates or updates all 4 cron timers with exact timezones and send hours from your Google Sheet.

---

## 📊 Test 9: Daily Analytics & Discord Digest
*Test compiling today's metrics and posting a Discord card.*

### Steps:
1. Go to **Actions** > **Universal Outreach Engine** > select **`digest`** > click **Run workflow**.
2. **Expected Result**:
   - The bot aggregates today's sent emails, replies, positive leads, and bounces.
   - A Discord digest card is posted to your updates channel.

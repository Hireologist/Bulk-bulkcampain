# 🚀 Universal Cold Outreach & Lead Intelligence Engine

[![Node.js Engine](https://img.shields.io/badge/Node.js-v22.14.0%20LTS-green.svg?logo=node.js)](https://nodejs.org/)
[![Serverless Architecture](https://img.shields.io/badge/Architecture-100%25%20Serverless-blue.svg?logo=github-actions)](https://github.com/features/actions)
[![V8 Bytecode Protected](https://img.shields.io/badge/Security-V8%20Bytecode%20Encrypted-blueviolet.svg)](#)
[![Zero Data Leaks](https://img.shields.io/badge/Privacy-100%25%20Client--Owned-success.svg)](#)

A high-performance, production-grade serverless cold email outreach and inbox monitoring platform powered by **Google Sheets**, **Node.js 22.14.0 LTS**, **IMAP/SMTP**, **Groq AI**, **Discord Webhooks**, and **GitHub Actions**.

---

## ⚡ 5-Minute Quick Setup

Follow these 4 simple steps to go from zero to live sending in under 5 minutes:

### Step 1: Create a Blank Google Sheet
1. Open [sheets.new](https://sheets.new) in your browser to create a new spreadsheet.
2. Click **Share** (top-right) and add your Google Cloud Service Account email address as an **Editor**.
3. Copy your **Spreadsheet ID** from the browser URL bar:
   `https://docs.google.com/spreadsheets/d/`<ins>**SPREADSHEET_ID**</ins>`/edit`

---

### Step 2: Configure GitHub Repository Secrets
In this GitHub repository, navigate to **Settings ➔ Secrets and variables ➔ Actions** and click **New repository secret**:

| Secret Name | Required | Description | Example / Note |
| :--- | :---: | :--- | :--- |
| `SPREADSHEET_ID` | **Required** | The ID from your Google Sheet URL | `1BxiMVs0XRA5nFMdKvB...` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Required** | Google Cloud Service Account credentials JSON | Paste full JSON content |
| `DISCORD_WEBHOOK_URL` | *Optional* | Discord channel webhook for instant delivery alerts & digests | `https://discord.com/api/webhooks/...` |
| `GROQ_API_KEY` | *Optional* | Groq API Key for AI reply sentiment analysis & phone extraction | `gsk_...` |
| `CRON_KEY` | *Optional* | cron-job.org API Key for 1-click external schedule setup | Available in cron-job.org Settings |
| `GITHUB_PAT` | *Optional* | GitHub Personal Access Token (`repo` + `workflow`) for cloud triggers | `github_pat_...` |

---

### Step 3: Run 1-Click Auto-Provisioning
1. Go to the **Actions** tab in this GitHub repository.
2. Select **`🚀 1-Click Complete Auto-Setup & Provisioning`**.
3. Click **Run workflow**.
4. The engine connects to your blank Google Sheet and automatically provisions all 17 schema tabs (`Details`, `Inboxes`, `Settings`, `Logs`, `Suppression`, etc.), headers, data validations, and default configuration formulas!

---

### Step 4: Configure Inboxes, Email Copy & Leads
Open your newly provisioned Google Sheet:
1. **`Inboxes` Tab:** Add your Gmail or Google Workspace sender accounts with their generated 16-character Google App Passwords.
2. **`Settings` Tab:** Customize your email subject line, Spintax body copy (e.g. `{{Hi|Hey|Hello}} {{FirstName}}`), and daily limits.
3. **`Details` Tab:** Paste your target lead list (Email, First Name, Company, etc.).
4. **Launch:** Run **`Universal Outreach Engine`** from the Actions tab or let your automated crons run hands-free!

---

## 📋 Available Workflows

| Workflow | Purpose | Recommended Schedule / Trigger |
| :--- | :--- | :--- |
| **🚀 Universal Outreach Engine** | Multi-purpose engine powering cold outreach, follow-ups, inbox checking, and daily digests. | Automated via crons or manual dispatch |
| ↳ `action: outreach` | Cycles through active inboxes with humanized delays and sends personalized emails to pending leads. | Mon–Fri during business hours |
| ↳ `action: inbox` | Scans IMAP inboxes for replies, analyzes sentiment with Groq AI, extracts phone numbers, and notifies Discord. | Every 15–30 minutes |
| ↳ `action: followup` | Evaluates multi-touch sequences and dispatches follow-up emails to prospects who haven't replied. | Daily morning |
| ↳ `action: digest` | Summarizes daily campaign statistics (sent, replies, bounces) and sends a report to Discord. | Daily at 6:30 PM |
| ↳ `action: warmup` | Internal peer-to-peer inbox reputation warmup routine exchanging randomized Spintax emails. | Daily background |
| ↳ `action: single_lead` | Instant 1-to-1 dispatch triggered directly via Google Sheets button or remote webhook. | On demand / Webhook |
| ↳ `action: diagnostic` | Pre-flight campaign diagnostic auditing SMTP/IMAP credentials, DNS records, and sheet schemas. | Daily morning or pre-launch |
| **🚀 1-Click Complete Auto-Setup** | Automatically provisions all 17 sheet tabs, formulas, and default settings in a blank Google Sheet. | Run once on initial setup |
| **⚡ Provision Cron Jobs** | Automatically creates scheduled cron jobs on cron-job.org pointing to your GitHub repository. | Run once after setup |
| **🩺 Campaign Health & Diagnostic** | Automated daily diagnostic auditing inbox health, authentication status, and deliverability. | Daily at 9:00 AM IST |
| **🌐 Domain Health** | Validates SPF, DKIM, and DMARC DNS records for all configured sending domains. | Weekly |
| **📡 GCC Leadership Radar** | Daily intelligence scanner tracking new GCC office expansions and executive hiring in India. | Daily |

---

## ✨ Advanced Capabilities

- **🎲 Spintax Variation Engine:** Supports nested Spintax `{{Hi|Hey|Hello}}` across subjects and email bodies to ensure unique message fingerprints and high inbox placement.
- **🛡️ Adaptive Deliverability Shield:** Automatically throttles sending speed when reputation risk is detected (60s delay on spam complaints, 15s on bounces, 8s ramp-up, 3s steady state).
- **⚡ High-Speed Bulk Mode:** Toggle `throttle_mode = bulk` in Google Sheet `Settings` for high-throughput batch sending.
- **📝 IMAP Draft-Review Mode:** Toggle `send_mode = review` in `Settings` to generate and save emails directly into your Gmail **Drafts** folder for human inspection before live sending.
- **🤖 Groq AI Reply Intelligence:** Uses Groq Llama 3 to classify prospect replies (`POSITIVE`, `NEUTRAL`, `NEGATIVE`, `OOO`) and automatically extracts prospect phone numbers.
- **🔄 Non-Destructive Auto-Repair:** Daily health checks automatically restore missing columns, settings keys, and formulas without altering existing leads or credentials.

---

## 🛠️ Local CLI Usage

You can also run tasks locally on any machine with Node.js 22.14.0:

```bash
# Install dependencies
npm install

# Run cold outreach batch
node engine.mjs outreach

# Run inbox checker
node engine.mjs inbox

# Run follow-up sequence
node engine.mjs followup

# Run daily digest
node engine.mjs digest

# Run pre-flight diagnostics
node engine.mjs diagnostic
```

---

## 🔒 Security & Intellectual Property

- **V8 Bytecode Compilation:** The outreach engine logic is compiled into binary V8 bytecode optimized for Node.js 22.14.0 LTS.
- **100% Private Data:** All spreadsheet IDs, service account keys, and email credentials reside strictly inside your private Google Drive and GitHub repository. No third-party servers ever have access to your data.
- **HMAC Unsubscribe Compliance:** Includes one-click unsubscribe headers and cryptographically signed unsubscribe links to comply with CAN-SPAM and Google/Yahoo bulk sender requirements.

# 🚀 Universal Cold Outreach Engine & Sheet Bot

An automated, 100% free, serverless cold email outreach engine built with **Node.js**, **Google Sheets API**, **IMAP/SMTP**, **GitHub Actions**, **Discord Webhooks**, and a **100% Online GitHub Pages Web Dashboard**.

> ⚡ **Quick Start in 3 Minutes:** Follow the [**Complete Setup Guide (SETUP_10MIN.md)**](file:///d:/Codinf%20projets/Sheet-bot/SETUP_10MIN.md) to initialize the entire infrastructure automatically using the **1-Click Auto-Setup Workflow**.
>
> 🔑 **Only 2 GitHub Secrets Required:** `SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON`. Everything else is managed dynamically in your Google Sheet!

---

## 📋 Table of Contents
0. [⚡ 1-Click Rapid Setup Guide](./SETUP_10MIN.md)
1. [📁 Multi-Campaign Strategy: 1-Repo Per Campaign Guide](./docs/MULTI_CAMPAIGN_GUIDE.md)
2. [🧪 Step-by-Step Manual Testing Guide](./docs/MANUAL_TESTING.md)
3. [🧩 Chrome Extension User Guide](./docs/CHROME_EXTENSION_GUIDE.md)
3. [Key Features](#-key-features)
4. [How to Import & Setup Your Own GitHub Repo](#-how-to-import--setup-your-own-github-repo)
5. [Online Web Dashboard (GitHub Pages)](#-online-web-dashboard-github-pages)
6. [Prerequisites & Requirements](#-prerequisites--requirements)
7. [Step-by-Step Initial Setup (Only 2 Secrets)](#-step-by-step-initial-setup)
8. [Dynamic Cron Schedules & Timezones in Google Sheets](#-dynamic-cron-schedules)
9. [Running & Testing the Engine](#-running--testing-the-engine)
10. [Google Sheets Architecture & Color-Coded Tabs](#-google-sheets-architecture--color-coded-tabs)

---

## ⚡ Key Features

- **🚀 1-Click Automated Setup & Provisioning**: Single workflow (`setup_engine.yml`) that automatically generates all 11 Google Sheet tabs, headers, formulas, sample leads, and provisions all `cron-job.org` timers.
- **🧩 Manifest V3 Chrome Extension**: Fast in-browser lead parsing and dispatch tool with auto-name and company extraction, multi-campaign switcher, and batch queueing (see [Chrome Extension Guide](./docs/CHROME_EXTENSION_GUIDE.md)).
- **🌐 100% Online GitHub Pages Web Dashboard**: Live browser view (`https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/`) for 24/7 visual analytics, lead search, inbox health, and 1-click cloud triggers.
- **🎲 Spintax (Spin Syntax) Randomization**: High-entropy email variations using `{{Hi|Hey|Hello}}` and `{{option 1 | option 2}}` across subject lines and email bodies to eliminate repetitive pattern matching and skyrocket deliverability.
- **⏯️ Master Campaign ON/OFF Toggle**: Start, pause, or resume all outreach and follow-ups dynamically in 1 second by setting `campaign_active = TRUE/FALSE` in Google Sheet `Settings`.
- **⚡ High-Speed Bulk Campaign Mode**: Switch `throttle_mode = bulk` in Google Sheet `Settings` to send large volume blasts (1500+ emails) at fixed high speed (1s–2s delay), ignoring bounce/complaint slowdown penalties.
- **🛡️ Adaptive Deliverability Shield**: In default mode (`throttle_mode = adaptive`), protects sender reputation by dynamically adjusting delay (60s on spam complaints, 15s on high bounces, 8s ramp-up, 3s steady state).
- **📝 IMAP Draft-Review Mode**: Toggle `send_mode = review` in your sheet to automatically generate and save personalized Touch-1 emails directly into your inbox **Drafts** folder for inspection before sending.
- **🔍 SPF & DMARC DNS Auditing**: Automated weekly audits verifying domain authentication records and logging results to `Domain_Health`.
- **🔥 Peer-to-Peer Free Warmup**: Built-in synthetic inbox warmup engine between enabled inboxes with progressive daily volume ramp-up.
- **⛔ Global Suppression & 1-Click Unsubscribe**: Fast in-memory cached suppression list with HMAC signed unsubscribe tokens and CAN-SPAM legal footers.
- **🤖 AI Sentiment & Summary Analysis**: Uses Groq LLM to categorize prospect replies (`POSITIVE`, `NEUTRAL`, `NEGATIVE`, `OOO`) with resilient fallback.
- **📡 GCC Leadership Radar & Startup Funding Tracker**: Automated daily tracking engine (09:00 AM IST via Python & Groq AI) monitoring new GCC launches, office space leases, and tech funding deals in India with direct LinkedIn leadership search links and dedicated Discord channel alerts.
- **⏱️ Dynamic Timezones & Schedules**: Customize cron execution hours and timezones (`Asia/Kolkata`, `America/New_York`, `UTC`) directly in your Google Sheet `Settings` tab.

---

## 📥 How to Import & Setup Your Own GitHub Repo

To deploy and run your own independent version of this cold outreach engine, follow these simple steps:

### 1. Import or Fork to Your GitHub Account
- **Option A (Import)**: Go to **[GitHub Repository Import](https://github.com/new/import)**.
  - Enter the source repository URL.
  - Enter your target repository name (e.g., `sheet-bot` or `cold-outreach-engine`).
  - Select **Public** or **Private** and click **Begin import**.
- **Option B (Fork)**: Click the **Fork** button at the top right of this repository page to create a copy under your account.

### 2. Enable GitHub Action Permissions
1. In your new repository, go to **Settings** ⚙️ > **Actions** > **General**.
2. Under **Workflow permissions**, select **Read and write permissions**.
3. Check **Allow GitHub Actions to create and approve pull requests** and click **Save**.

### 3. Enable Online Web Dashboard (GitHub Pages)
1. Go to **Settings** ⚙️ > **Pages** (on the left menu).
2. Under **Build and deployment**:
   - **Source**: Select `Deploy from a branch`
   - **Branch**: Select **`main`**
   - **Folder**: Select **`/docs`** (or **`/ (root)`**)
3. Click **Save** 💾.
4. Your personal web dashboard will be live at: `https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/`

---

## 🌐 Online Web Dashboard (GitHub Pages)

Your dashboard is hosted 100% online directly on your repository's GitHub Pages:

👉 **`https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/`**

### 1-Minute GitHub Pages Enablement (One-Time Setup):
1. Go to your repository on GitHub: `https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>`
2. Click **Settings** ⚙️ > **Pages** (on the left menu).
3. Under **Build and deployment**:
   - **Source**: Select `Deploy from a branch`
   - **Branch**: Select **`main`**
   - **Folder**: Select **`/docs`** (or **`/ (root)`**)
4. Click **Save** 💾.

---

## 🛠️ Prerequisites & Requirements

Before setting up, make sure you have:
1. A **Google Account** (to host Google Sheets).
2. A **Google Cloud Console** account (to create a Service Account JSON key).
3. Email credentials (SMTP/IMAP server settings and Gmail/Google Workspace **App Passwords**).
4. A **GitHub Repository** (to host and run GitHub Actions workflows).
5. *(Optional)* A free **Groq API Key** (`gsk_...`) for AI sentiment classification.
6. *(Optional)* **Discord Webhook URLs** for notifications.

---

## 🚀 Step-by-Step Initial Setup

### Step 1: Google Sheet Setup (1-Click Apps Script)
1. Create a new Google Spreadsheet at [sheets.new](https://sheets.new).
2. Click **Extensions** > **Apps Script**.
3. Copy the complete code from [`Code.gs`](./Code.gs) into the Apps Script editor and click **Save** (💾).
4. Refresh your Google Sheet. A new menu item will appear at the top: **⚡ Outreach Bot**.
5. Click **⚡ Outreach Bot** > **🛠️ Rebuild / Reset All Sheets**.
6. Grant permissions when prompted. The script will automatically generate all 11 required tabs (`Details`, `Inboxes`, `Aliases`, `Settings`, `Templates`, `Followup_Templates`, `Locations`, `Clients`, `📊 Email_Analytics`, `📈 ChartData`, and `📖 Setup_Guide`).
7. **Share your Google Sheet**:
   - Click **Share** 🔒 at the top right of your Google Sheet.
   - Set access to **"Anyone with the link can view"** (required for client-side web dashboard sync).

---

### Step 2: Google Cloud Service Account Setup
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `Sheet-Outreach-Bot`).
3. Enable the **Google Sheets API** under **APIs & Services** > **Library**.
4. Go to **APIs & Services** > **Credentials** > **Create Credentials** > **Service Account**.
5. Give it a name and click **Create and Continue**.
6. Under the created Service Account, click **Keys** > **Add Key** > **Create new key** > **JSON**.
7. Download the JSON key file.
8. **Grant Editor Access to Service Account**:
   - Open your downloaded JSON key file and copy the `client_email` address (e.g. `sheet-bot@project.iam.gserviceaccount.com`).
   - Open your Google Sheet, click **Share**, and grant **Editor** access to this client email address.

> ⚠️ **IMPORTANT**: Never commit your Service Account JSON file to GitHub! The project `.gitignore` automatically excludes `*.json` secrets.

---

### Step 3: Email Inboxes & App Passwords
1. If using **Gmail / Google Workspace**:
   - Turn on **2-Step Verification** in your Google Account Security settings.
   - Search for **App Passwords** and generate a 16-character App Password for "Mail".
2. Open the **Inboxes** tab in your Google Sheet and fill in your inbox settings:
   - `email`: Your sender email address (e.g., `outreach@companydomain.com`).
   - `display_name`: Your name or team name.
   - `smtp_host`: `smtp.gmail.com` (Port `465`).
   - `smtp_user`: Your email address.
   - `smtp_pass`: Your 16-character App Password (without spaces).
   - `imap_host`: `imap.gmail.com` (Port `993`).
   - `daily_limit`: Daily limit per inbox (e.g., `50`).
   - `is_active`: Set to `TRUE`.

---

### Step 4: Groq AI & Discord Webhooks
Open the **Settings** tab in your Google Sheet:
- `groq_api_key`: Paste your free Groq API key (`gsk_...`).
- `discord_updates_webhook`: Discord channel webhook URL for run alerts and daily digests.
- `discord_positive_webhook`: Discord channel webhook URL for new positive/neutral lead reply alerts.
- `discord_rereply_webhook`: Discord channel webhook URL for re-replies from existing positive/neutral leads.
- `cutoff_hour_ist`: `18` (6 PM IST sending cutoff).
- `cutoff_minute_ist`: `30` (6:30 PM IST sending cutoff).
- `max_emails_per_run`: `1000` (Max batch size per trigger).

---

### Step 5: GitHub Repository Secrets Configuration
1. Go to your repository on GitHub: `https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>`
2. Navigate to **Settings** > **Secrets and variables** > **Actions**.
3. Add the following **Repository Secrets**:

| Secret Name | Description / Value |
| :--- | :--- |
| `SPREADSHEET_ID` | The ID string from your Google Sheet URL (the part between `/d/` and `/edit`). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The full raw JSON content of your downloaded Google Cloud Service Account key file. |

---

## 🔑 GitHub Personal Access Token (PAT) Setup (For 1-Click Triggers)

If you see `GitHub Dispatch Error: Resource not accessible by personal access token` when triggering workflows from the web dashboard, follow these 30-second steps:

1. Go to GitHub: **[GitHub Token Settings](https://github.com/settings/tokens)**
2. Click **Generate new token** > **Generate new token (classic)**.
3. Check the following permission scopes:
   - ✅ **`repo`** *(Full control of private/public repositories)*
   - ✅ **`workflow`** *(Update GitHub Action workflows)*
4. Click **Generate token** at the bottom and copy your token (`ghp_...`).
5. Open your online dashboard at **`https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/`**, go to **Campaigns & Connect Settings**, paste your token, and click **Save Token**.

---

## 🧪 Running & Testing the Engine

### Option A: 100% Online Web Dashboard (GitHub Pages)
- Open **`https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/`** in any browser (Phone, Laptop, Tablet).
- View live charts, search lead directory, monitor inbox daily limits, and trigger runs in 1 click!

### Option B: Local Express Dashboard (`npm start`)
- Run `npm start` in your terminal.
- Open `http://localhost:3000` in your browser.

### Option C: 1-Click Automated Cron API Setup (`setup-cron.mjs`) & cron-job.org

GitHub Actions native `schedule` triggers often experience queue delays or dropped runs during peak hours. For 100% on-time execution, trigger workflows via **[cron-job.org](https://cron-job.org)** using GitHub's `workflow_dispatch` API.

#### ⚡ 1-Click Automated Setup via API (Recommended)
You can automatically provision all 4 required cron jobs in seconds without manually typing settings in the dashboard:

- **Option 1: Directly via GitHub Actions (Zero Local Setup)**
  Go to your GitHub repo → **Actions** tab → **⚡ Provision Cron Jobs (cron-job.org)** → **Run workflow** (enter your API key & PAT or use repository secrets `CRON_KEY` and `GITHUB_PAT`).
- **Option 2: Locally via Terminal**
  ```bash
  # Interactive setup:
  node setup-cron.mjs

  # Or pass API keys directly:
  CRON_KEY="your_cron_job_api_key" GITHUB_PAT="your_github_pat" node setup-cron.mjs
  ```

The script auto-detects your repository name/owner and creates all 4 jobs with exact headers, schedules, and payloads!

#### 🛠️ Manual cron-job.org Setup
If setting up manually in the dashboard:
1. **Get a GitHub PAT**: Generate a classic Personal Access Token with `repo` / `workflow` permissions at [github.com/settings/tokens](https://github.com/settings/tokens).
2. **Endpoint URL**: `https://api.github.com/repos/<YOUR_USERNAME>/<YOUR_REPO_NAME>/actions/workflows/outreach.yml/dispatches`
3. **HTTP Headers**:
   - `Authorization: Bearer <YOUR_PAT>`
   - `Accept: application/vnd.github+json`
   - `User-Agent: cron-job-org`
   - `Content-Type: application/json`
4. **Request Payload (Example)**:
   ```json
   { "ref": "main", "inputs": { "action": "followup" } }
   ```

👉 **For complete step-by-step visual instructions, exact timing schedules for all 4 jobs, and troubleshooting, read [`CRON_SETUP.md`](./CRON_SETUP.md).**

### Option D: Native Unit Test Suite (`npm test`)
- Run `npm test` to execute the native `node:test` suite verifying MX domain lookups, IST cutoff calculations, template tag replacements, and sentiment logic.

---

## 🎯 How to Create & Manage Multiple Campaigns (Adding Second Sheets)

### Method 1: Multi-Campaign Manager in Web Dashboard
1. Open **`https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/`**.
2. Click **+ Add Campaign** (or **Campaigns & Connect** on the left menu).
3. Enter a Campaign Name (e.g. `Campaign B - SaaS Founders`) and paste the Google Sheet ID.
4. Click **Add Campaign Sheet**.
5. Switch between campaigns in 1 click using the top-header dropdown menu!

---

### Method 2: Multi-Campaign GitHub Workflows
If you want to run multiple campaigns simultaneously via separate GitHub Actions workflows:

1. **Set up GitHub Secrets**:
   - `SPREADSHEET_ID_CAMPAIGN_A`: ID for Sheet A
   - `SPREADSHEET_ID_CAMPAIGN_B`: ID for Sheet B

2. **Create a new Workflow file** in `.github/workflows/campaign_b.yml`:
```yaml
name: Campaign B Outreach Engine

concurrency:
  group: outreach-b-${{ inputs.action || github.event.client_payload.action || github.event_name }}
  cancel-in-progress: false

on:
  repository_dispatch:
    types: [send_single_email]

  workflow_dispatch:
    inputs:
      action:
        description: 'Choose task to run manually'
        required: true
        default: 'inbox'
        type: choice
        options: [outreach, followup, inbox, digest, single_lead]

jobs:
  run-engine:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - run: npm ci --no-audit --no-fund

      - name: Run Selected Task
        run: node engine.mjs "${{ inputs.action || github.event.inputs.action || 'inbox' }}"
        env:
          SPREADSHEET_ID: ${{ secrets.SPREADSHEET_ID_CAMPAIGN_B }}
          GOOGLE_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
```

---

## 📊 Google Sheets Architecture & 11 Color-Coded Tabs

| Tab Name | Function / Description |
| :--- | :--- |
| **`📖 Setup_Guide`** | Step-by-step instructions, rules, and status legends for team members. |
| **`Details`** | Prospect leads (Name, Email, Company, Location, Sent Status, Sent From, Reply Status, Sentiment). |
| **`Inboxes`** | Primary SMTP/IMAP credentials, daily sending limits, active toggles. (See [Google App Password Setup & Recovery](docs/GOOGLE_APP_PASSWORD_SETUP.md)). |
| **`Aliases`** | Virtual alias emails and display names used for random `From:` header rotation. |
| **`Settings`** | Engine delay timers, IST cutoff hours, max batch limits, Discord webhooks, and Groq API key. |
| **`Templates`** | Cold outreach email templates using dynamic placeholders (`{{full_name}}`, `{{company_name}}`, `{{location}}`, `{{clients}}`, `{{Date}}`). |
| **`Followup_Templates`** | Sequential follow-up templates and delay intervals (`Days_Until_Next`). |
| **`Locations`** | City lists for randomized location tags (`{{other_locations}}`). |
| **`Clients`** | Social proof portfolio client names (`{{clients}}`). |
| **`📊 Email_Analytics`** | Automated `=LET(...)` formula calculating per-sender performance (Sent, Replied, Bounced, Positive, Reply Rates). |
| **`📈 ChartData`** | Categorized sentiment breakdown and total status count tables for visualization charts. |

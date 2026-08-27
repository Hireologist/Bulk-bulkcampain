# 🚀 Universal Cold Outreach Engine & Sheet Bot

An automated, serverless cold email outreach engine built with **Node.js**, **Google Sheets API**, **IMAP/SMTP**, **GitHub Actions**, **Discord Webhooks**, and a **100% Online GitHub Pages Web Dashboard**.

---

## 📋 Table of Contents
1. [Key Features](#-key-features)
2. [How to Import & Setup Your Own GitHub Repo](#-how-to-import--setup-your-own-github-repo)
3. [Online Web Dashboard (GitHub Pages)](#-online-web-dashboard-github-pages)
4. [Prerequisites & Requirements](#-prerequisites--requirements)
5. [Step-by-Step Initial Setup](#-step-by-step-initial-setup)
   - [Step 1: Google Sheet Setup (1-Click Apps Script)](#step-1-google-sheet-setup-1-click-apps-script)
   - [Step 2: Google Cloud Service Account Setup](#step-2-google-cloud-service-account-setup)
   - [Step 3: Email Inboxes & App Passwords](#step-3-email-inboxes--app-passwords)
   - [Step 4: Groq AI & Discord Webhooks](#step-4-groq-ai--discord-webhooks)
   - [Step 5: GitHub Repository Secrets Configuration](#step-5-github-repository-secrets-configuration)
6. [GitHub Personal Access Token (PAT) Setup (For 1-Click Triggers)](#-github-personal-access-token-pat-setup-for-1-click-triggers)
7. [Running & Testing the Engine](#-running--testing-the-engine)
   - [Option A: 100% Online Web Dashboard (GitHub Pages)](#option-a-100-online-web-dashboard-github-pages)
   - [Option B: Local Express Dashboard (`npm start`)](#option-b-local-express-dashboard-npm-start)
   - [Option C: 1-Click Automated Cron API Setup (setup-cron.mjs) & cron-job.org](#option-c-1-click-automated-cron-api-setup-setup-cronmjs--cron-joborg)
   - [Option D: Native Unit Test Suite (`npm test`)](#option-d-native-unit-test-suite-npm-test)
8. [How to Create & Manage Multiple Campaigns (Adding Second Sheets)](#-how-to-create--manage-multiple-campaigns-adding-second-sheets)
   - [Method 1: Multi-Campaign Manager in Web Dashboard](#method-1-multi-campaign-manager-in-web-dashboard)
   - [Method 2: Multi-Campaign GitHub Workflows](#method-2-multi-campaign-github-workflows)
9. [Google Sheets Architecture & 11 Color-Coded Tabs](#-google-sheets-architecture--11-color-coded-tabs)

---

## ⚡ Key Features

- **🌐 100% Online GitHub Pages Web Dashboard**: Live browser view (`https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/`) for 24/7 visual analytics, lead search, inbox health, and 1-click cloud triggers without running anything offline.
- **🎯 Multi-Campaign & Multi-Sheet Switcher**: Manage unlimited separate campaigns and Google Sheets in 1 click right from the top header.
- **🛡️ 100% Free Pre-Send MX & Domain Validation**: Uses Node's built-in `node:dns/promises` to perform real-time `dns.resolveMx(domain)` lookups. Automatically flags invalid/dead email domains as `bounced` before sending, protecting your sender IP reputation without any paid APIs.
- **1-Click Google Sheet Generator**: Apps Script (`Code.gs`) automatically builds all 11 color-coded tabs with headers, sample data, and dynamic `=LET(...)` formulas.
- **Smart Rotation & Alias Matcher**: Rotates through active email inboxes and matches original sender aliases on follow-ups.
- **Automated Follow-Up Sequence**: Sends scheduled follow-ups and automatically halts when a prospect replies, unsubscribes, or bounces.
- **AI Reply Sentiment Analysis**: Uses Groq LLM (`llama-3.3-70b-versatile`) to categorize replies as `POSITIVE`, `NEUTRAL`, `NEGATIVE`, or `OOO`.
- **Discord Integration & Daily Digest**: Real-time alerts for positive leads, batch status, daily limit warnings, and a 6:30 PM IST Daily Performance Digest card.
- **⏱️ 1-Click Automated Cron API Setup**: Automatically provision all 4 scheduled jobs (Follow-up, Outreach, Inbox Checker, Daily Digest) on [cron-job.org](https://cron-job.org) in seconds via API using `node setup-cron.mjs`. Full instructions in [`CRON_SETUP.md`](./CRON_SETUP.md).
- **🔒 Concurrency & Double-Sending Safety Lock**: Workflow concurrency lock (`group: outreach-engine`) prevents parallel execution and guarantees zero double-sending.

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
- `discord_positive_webhook`: Discord channel webhook URL for positive/neutral lead reply alerts.
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
  group: outreach-engine-b
  cancel-in-progress: false

on:
  schedule:
    - cron: '30 4 * * 1-6'   # Cold Outreach: 10:00 AM IST
    - cron: '0 5 * * 1-6'    # Follow-ups: 10:30 AM IST
    - cron: '*/30 * * * *'   # Inbox Checker: 24/7
    - cron: '0 13 * * 1-6'   # Daily Digest: 6:30 PM IST

  workflow_dispatch:
    inputs:
      action:
        description: 'Choose task to run manually'
        required: true
        default: 'digest'
        type: choice
        options:
          - outreach
          - followup
          - inbox
          - digest

jobs:
  run-engine:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      
      - run: npm install

      - name: Run Selected Task
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            node engine.mjs ${{ github.event.inputs.action }}
          elif [ "${{ github.event.schedule }}" = "30 4 * * 1-6" ]; then
            node engine.mjs outreach
          elif [ "${{ github.event.schedule }}" = "0 5 * * 1-6" ]; then
            node engine.mjs followup
          elif [ "${{ github.event.schedule }}" = "0 13 * * 1-6" ]; then
            node engine.mjs digest
          else
            node engine.mjs inbox
          fi
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
| **`Inboxes`** | Primary SMTP/IMAP credentials, daily sending limits, active toggles. |
| **`Aliases`** | Virtual alias emails and display names used for random `From:` header rotation. |
| **`Settings`** | Engine delay timers, IST cutoff hours, max batch limits, Discord webhooks, and Groq API key. |
| **`Templates`** | Cold outreach email templates using dynamic placeholders (`{{full_name}}`, `{{company_name}}`, `{{location}}`, `{{clients}}`, `{{Date}}`). |
| **`Followup_Templates`** | Sequential follow-up templates and delay intervals (`Days_Until_Next`). |
| **`Locations`** | City lists for randomized location tags (`{{other_locations}}`). |
| **`Clients`** | Social proof portfolio client names (`{{clients}}`). |
| **`📊 Email_Analytics`** | Automated `=LET(...)` formula calculating per-sender performance (Sent, Replied, Bounced, Positive, Reply Rates). |
| **`📈 ChartData`** | Categorized sentiment breakdown and total status count tables for visualization charts. |

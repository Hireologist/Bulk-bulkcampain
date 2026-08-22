# 🚀 Universal Cold Outreach Engine & Sheet Bot

An automated, serverless cold email outreach engine built with **Node.js**, **Google Sheets API**, **IMAP/SMTP**, **GitHub Actions**, and **Discord Webhooks**.

---

## 📋 Table of Contents
1. [Key Features](#-key-features)
2. [Prerequisites & Requirements](#-prerequisites--requirements)
3. [Step-by-Step Initial Setup](#-step-by-step-initial-setup)
   - [Step 1: Google Sheet Setup (1-Click Apps Script)](#step-1-google-sheet-setup-1-click-apps-script)
   - [Step 2: Google Cloud Service Account Setup](#step-2-google-cloud-service-account-setup)
   - [Step 3: Email Inboxes & App Passwords](#step-3-email-inboxes--app-passwords)
   - [Step 4: Groq AI & Discord Webhooks](#step-4-groq-ai--discord-webhooks)
   - [Step 5: GitHub Repository Secrets Configuration](#step-5-github-repository-secrets-configuration)
4. [Running & Testing the Engine](#-running--testing-the-engine)
5. [How to Create a New Campaign (Adding a Second Sheet)](#-how-to-create-a-new-campaign-adding-a-second-sheet)
   - [Option A: Running a New Campaign in the Same Workflow](#option-a-running-a-new-campaign-in-the-same-workflow)
   - [Option B: Running Separate Workflows per Campaign](#option-b-running-separate-workflows-per-campaign)
6. [Google Sheets Architecture & Tabs](#-google-sheets-architecture--tabs)

---

## ⚡ Key Features
- **1-Click Sheet Generator**: Apps Script automatically builds all 11 color-coded tabs with headers, sample data, and formulas.
- **🖥️ Web View Dashboard**: Real-time browser interface (`http://localhost:3000`) for visual analytics, lead directory search, inbox health, and manual triggers.
- **Smart Rotation**: Rotates through active email inboxes and aliases.
- **Automated Follow-ups**: Sends scheduled follow-ups and automatically halts when a prospect replies or bounces.
- **AI Reply Sentiment Analysis**: Uses Groq LLM to categorize replies as `POSITIVE`, `NEUTRAL`, or `NEGATIVE`.
- **Discord Integration**: Real-time webhook notifications for positive leads, batch starts/ends, and a 6:30 PM IST Daily Performance Digest card.
- **Concurrency & Safety Lock**: Concurrency lock prevents overlapping runs and ensures zero double-sending.

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
6. Grant the necessary permissions when prompted. The script will automatically generate all 11 required tabs (`Details`, `Inboxes`, `Aliases`, `Settings`, `Templates`, `Followup_Templates`, `Locations`, `Clients`, `📊 Email_Analytics`, `📈 ChartData`, and `📖 Setup_Guide`).

---

### Step 2: Google Cloud Service Account Setup
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `Sheet-Outreach-Bot`).
3. Enable the **Google Sheets API** under **APIs & Services** > **Library**.
4. Go to **APIs & Services** > **Credentials** > **Create Credentials** > **Service Account**.
5. Give it a name and click **Create and Continue**.
6. Under the created Service Account, click the **Keys** tab > **Add Key** > **Create new key** > **JSON**.
7. Download the JSON key file.
8. **Share your Google Sheet**:
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
1. Go to your repository on GitHub: `https://github.com/YourUsername/Sheet-bot`
2. Navigate to **Settings** > **Secrets and variables** > **Actions**.
3. Add the following **Repository Secrets**:

| Secret Name | Description / Value |
| :--- | :--- |
| `SPREADSHEET_ID` | The ID string from your Google Sheet URL (the part between `/d/` and `/edit`). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The full raw JSON content of your downloaded Google Cloud Service Account key file. |

---

## 🧪 Running & Testing the Engine

### Automatic Schedule (GitHub Actions)
The workflow in `.github/workflows/outreach.yml` runs automatically on a scheduled cron:
- 📤 **Cold Outreach**: Mon-Sat at 10:00 AM IST (`04:30 UTC`)
- 🔁 **Follow-Ups**: Mon-Sat at 10:30 AM IST (`05:00 UTC`)
- 📥 **Inbox Checker**: Every 30 minutes 24/7
- 📊 **Daily Digest**: Mon-Sat at 6:30 PM IST (`13:00 UTC`)

### Manual Trigger / Testing
1. Go to your GitHub Repository > **Actions** tab.
2. Select **Universal Outreach Engine** from the left sidebar.
3. Click **Run workflow**.
4. Choose the task (`outreach`, `followup`, `inbox`, or `digest`) and click the green **Run workflow** button.

---

## 🎯 How to Create a New Campaign (Adding a Second Sheet)

If you want to run a second campaign with a separate prospect list or different templates, choose one of the following methods:

### Option A: Reusing the Engine for a New Spreadsheet
1. Create a **new Google Spreadsheet** for Campaign 2.
2. Run `Code.gs` in Apps Script on the new spreadsheet to generate its tabs.
3. Share the new Google Sheet with your Google Service Account email (`Editor` access).
4. Update the `SPREADSHEET_ID` secret in GitHub Secrets with the new spreadsheet ID.

---

### Option B: Running Separate Workflows per Campaign (Multi-Campaign Setup)
If you want to run **multiple campaigns simultaneously** (e.g. Campaign A and Campaign B):

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
    # 1. Cold Outreach: Mon-Sat at 10:00 AM IST (04:30 UTC)
    - cron: '30 4 * * 1-6'
    
    # 2. Follow-Up Engine: Mon-Sat at 10:30 AM IST (05:00 UTC)
    - cron: '0 5 * * 1-6'
    
    # 3. Inbox Checker: 24/7 every 30 minutes
    - cron: '*/30 * * * *'

    # 4. Daily Digest Summary: Mon-Sat at 6:30 PM IST (13:00 UTC)
    - cron: '0 13 * * 1-6'

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

## 📊 Google Sheets Architecture & Tabs

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
| **`📊 Email_Analytics`** | Automated `LET` formula calculating per-sender performance (Sent, Replied, Bounced, Positive, Reply Rates). |
| **`📈 ChartData`** | Categorized sentiment breakdown and total status count tables for visualization charts. |

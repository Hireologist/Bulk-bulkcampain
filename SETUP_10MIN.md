# ⚡ 10-Minute Rapid Setup Guide for Sheet-Bot

> **Target:** Go from zero to a 100% automated, serverless cold outreach engine with live web dashboard and cron scheduling in **under 10 minutes**.

---

## ⏱️ Timeline Overview

```
[00:00 - 02:00] ── Step 1: Google Sheet 1-Click Generator
[02:00 - 04:00] ── Step 2: Google Cloud Service Account
[04:00 - 06:00] ── Step 3: Inbox Credentials & Settings
[06:00 - 07:30] ── Step 4: GitHub Secrets & Permissions
[07:30 - 08:30] ── Step 5: Enable Web Dashboard (GitHub Pages)
[08:30 - 10:00] ── Step 6: 1-Click Cron Provisioning & First Test Run
```

---

## 🛠️ Prerequisites (Have These Open in Your Browser Tabs)
1. 🌐 [Google Sheets](https://sheets.new)
2. ☁️ [Google Cloud Console](https://console.cloud.google.com/)
3. 🐙 [GitHub.com](https://github.com/)
4. 🤖 [Groq Console](https://console.groq.com/keys) *(Optional for AI replies — Free)*
5. ⏱️ [Cron-Job.org](https://cron-job.org) *(Free account for reliable timers)*

---

## 🚀 Step 1: Google Sheet 1-Click Generator (2 Mins)

1. Open **[sheets.new](https://sheets.new)** to create a blank spreadsheet. Name it `Outreach Engine Master`.
2. In the top menu, click **Extensions** > **Apps Script**.
3. Delete any default code in the editor, copy the entire code from [`Code.gs`](./Code.gs), and paste it.
4. Click **Save** (💾) and close the Apps Script tab.
5. **Reload your Google Sheet** in the browser.
6. A new menu **`⚡ Outreach Bot`** will appear in the top bar. Click **`⚡ Outreach Bot`** > **`🛠️ Rebuild / Reset All Sheets`**.
7. Authorize the script when prompted by Google.
   > *The script will instantly build all 11 color-coded tabs with headers, sample leads, and formulas.*
8. **Make Sheet Readable by Web Dashboard:**
   - Click the green **Share** button (top right).
   - Under *General access*, change to **"Anyone with the link can view"**.
9. **Copy your Spreadsheet ID:**
   - From your browser URL: `https://docs.google.com/spreadsheets/d/`**`1a2b3c4d5e...`**`/edit`
   - Copy the string between `/d/` and `/edit`. Save this string for later.

---

## ☁️ Step 2: Google Cloud Service Account (2 Mins)

1. Go to **[Google Cloud Console](https://console.cloud.google.com/)** and create a new project (e.g., `Sheet-Outreach-Bot`).
2. Go to **APIs & Services** > **Library**, search for **Google Sheets API**, and click **Enable**.
3. Go to **APIs & Services** > **Credentials** > click **+ CREATE CREDENTIALS** > **Service Account**.
   - Name: `sheet-bot`
   - Click **Create and Continue** > **Done**.
4. Click on your newly created Service Account email:
   - Go to the **Keys** tab > **Add Key** > **Create new key** > Choose **JSON** > Click **Create**.
   - A `.json` file will automatically download to your computer.
5. **Grant Editor Access to Sheet:**
   - Open the downloaded JSON file in Notepad or VS Code.
   - Copy the `client_email` value (e.g., `sheet-bot@project.iam.gserviceaccount.com`).
   - Go back to your Google Sheet, click **Share**, paste this email address, set role to **Editor**, and click **Send**.

---

## 📧 Step 3: Inbox Credentials & Settings (2 Mins)

### A. Generate Gmail / Google Workspace App Password
1. Go to your **[Google Account Security](https://myaccount.google.com/security)**.
2. Ensure **2-Step Verification** is turned **ON**.
3. Search for **App Passwords** in the top search bar.
4. Create an App Password with name `SheetBot` and copy the 16-character code (e.g., `abcd efgh ijkl mnop`).

### B. Fill in `Inboxes` Tab in Google Sheet
Open the **`Inboxes`** tab and fill row 2:
- `email`: `your_outreach_email@domain.com`
- `display_name`: `Your Name | Company`
- `smtp_host`: `smtp.gmail.com`
- `smtp_user`: `your_outreach_email@domain.com`
- `smtp_pass`: `abcdefghijklmnop` *(16-character app password with no spaces)*
- `imap_host`: `imap.gmail.com`
- `daily_limit`: `50`
- `is_active`: `TRUE`

### C. Configure Settings & Discord (Optional)
Open the **`Settings`** tab:
- `groq_api_key`: Paste key from [console.groq.com/keys](https://console.groq.com/keys) *(for instant AI sentiment classification)*
- `discord_updates_webhook`: Discord webhook URL for batch alerts & 6:30 PM IST digests.
- `discord_positive_webhook`: Discord webhook URL for positive lead alerts.
- `cutoff_hour_ist`: `18` | `cutoff_minute_ist`: `30` | `max_emails_per_run`: `1000`

---

## 🐙 Step 4: GitHub Secrets & Permissions (1.5 Mins)

### A. Fork or Import the Repository
- If not already done, Fork this repository to your GitHub account.

### B. Enable Action Workflow Permissions
1. Go to your repo on GitHub > **Settings** ⚙️ > **Actions** > **General**.
2. Under **Workflow permissions**, select:
   - ✅ **Read and write permissions**
   - ✅ **Allow GitHub Actions to create and approve pull requests**
3. Click **Save** 💾.

### C. Add Repository Secrets
1. In your repo, go to **Settings** > **Secrets and variables** > **Actions** > click **New repository secret**.
2. Add these **2 secrets**:

| Secret Name | Value |
| :--- | :--- |
| **`SPREADSHEET_ID`** | The Google Sheet ID from Step 1 (`1a2b3c4d5e...`). |
| **`GOOGLE_SERVICE_ACCOUNT_JSON`** | The entire raw text content of the downloaded `.json` key file from Step 2. |

---

## 🌐 Step 5: Enable Web Dashboard (GitHub Pages) (1 Min)

1. In your GitHub repo, go to **Settings** ⚙️ > **Pages**.
2. Under **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main`
   - **Folder**: `/docs` (or `/ (root)`)
3. Click **Save** 💾.
4. Your live dashboard is now available at:
   👉 **`https://<YOUR_GITHUB_USERNAME>.github.io/<YOUR_REPO_NAME>/`**
5. Open your live dashboard URL:
   - Click **Campaigns & Connect** (or Settings icon).
   - Enter your **Spreadsheet ID** and a **GitHub Personal Access Token (PAT)** with `repo` / `workflow` permissions to allow 1-click cloud triggers directly from your browser!

---

## ⚡ Step 6: 1-Click Cron Setup & Live Test (1.5 Mins)

### Option A: Automatic 1-Click Provisioning (Zero-CLI)
1. Go to **[cron-job.org](https://console.cron-job.org/)** > **Settings** > **API Keys** > create and copy an API key.
2. Go to your GitHub repo > **Actions** tab > click **⚡ Provision Cron Jobs (cron-job.org)**.
3. Click **Run workflow**, enter your **Cron-Job API Key** and **GitHub PAT**, and click **Run workflow**.
4. ✅ All 4 cron jobs (Follow-up 9:30 AM IST, Outreach 11:30 AM IST, Inbox Checker every 30m, Daily Digest 6:30 PM IST) are provisioned automatically!

### Option B: Local Provisioning
```bash
CRON_KEY="your_cron_api_key" GITHUB_PAT="your_github_pat" node setup-cron.mjs
```

---

## 🧪 Quick Test: Run Your First Task

1. Go to the **Actions** tab in your GitHub repository.
2. Click **Universal Cold Outreach Engine** in the left sidebar.
3. Click **Run workflow** > Select task **`inbox`** or **`outreach`** > Click **Run workflow**.
4. Open the running job to view real-time logs:
   - ✅ Google Sheet connected
   - ✅ DNS MX validation verified
   - ✅ SMTP & IMAP handshake confirmed
   - ✅ Lead statuses updated in your Google Sheet!

---

## 🚨 Troubleshooting Cheat Sheet

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| `Cannot find spreadsheet` / `404` | Service account not invited | Share Google Sheet with `client_email` as **Editor**. |
| `Invalid credentials / 535-5.7.8` | Regular password used instead of App Password | Create a 16-char **App Password** in Google Account Security. |
| `Dashboard shows empty tables` | Sheet not public for view | In Google Sheet Share settings, select **"Anyone with link can view"**. |
| `GitHub Dispatch Error` | Missing PAT permissions | Generate PAT at [github.com/settings/tokens](https://github.com/settings/tokens) with `repo` & `workflow` scopes. |
| `Domain MX lookup failed` | Prospect email domain invalid | Engine auto-marks invalid domains as `bounced` to protect sender reputation. |

---

🎉 **You're all set! Your outreach engine will now autonomously send cold emails, follow up with leads, classify replies with AI, and report to Discord daily.**

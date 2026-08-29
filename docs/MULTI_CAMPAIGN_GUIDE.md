# 📁 Multi-Campaign Strategy: 1-Repo Per Campaign Guide

The recommended, battle-tested way to run multiple client campaigns or company outreach projects is the **1-Repo Per Campaign Architecture**.

---

## 💡 Why 1-Repo Per Campaign is Best:

| Feature | 1-Repo Per Campaign (Recommended) | Single Monolith Repo |
| :--- | :--- | :--- |
| **Setup Time** | ⚡ **60 Seconds** (via Template / Fork) | Complex dynamic workflows |
| **Secrets Needed** | 🔑 **Only 2 Secrets** (`SPREADSHEET_ID` + `SERVICE_ACCOUNT`) | Requires extra PAT tokens & scopes |
| **Execution Isolation** | 🛡️ **100% Isolated** (Errors in Campaign B never affect Campaign A) | Shared logs and mixed queues |
| **Custom Schedules** | ⏰ Independent cron timings per repo & sheet | Intertwined workflow files |
| **Team / Client Access**| 👥 Grant client or team access to specific repos only | All-or-nothing repo access |

---

## 🚀 How to Launch a New Campaign in 60 Seconds:

### Step 1: Create a New Repo from This Template
1. On GitHub, click **Use this template** (or **Fork**) on this repository:
   - Name your repo after your campaign (e.g. `outreach-saas-founders` or `sheet-bot-recruiting`).
   - Choose **Private** (or Public).

---

### Step 2: Create a Blank Google Sheet
1. Open [sheets.new](https://sheets.new) in your browser.
2. Name your sheet (e.g. `[Campaign] SaaS Founders`).
3. Copy the **Spreadsheet ID** from your browser URL:
   `https://docs.google.com/spreadsheets/d/`**`1b7Dap-gMz8EjRpbnAAvQ1hL-Bi-v9d6DXjFapghN5aw`**`/edit`
4. Click the green **Share** button and add your existing **Google Service Account email** (e.g. `sheet-bot@project.iam.gserviceaccount.com`) as an **Editor**.

---

### Step 3: Add the 2 Secrets in Your New Repo
In your newly created GitHub repository:
1. Go to **Settings** ⚙️ → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add these 2 secrets:
   - **`SPREADSHEET_ID`**: Paste the new Spreadsheet ID from Step 2.
   - **`GOOGLE_SERVICE_ACCOUNT_JSON`**: Paste your Google Service Account JSON.

---

### Step 4: Run 1-Click Provisioning (5 Seconds)
1. Go to the **Actions** tab in your new repository.
2. Select **`🚀 1-Click Complete Auto-Setup & Provisioning`** on the left.
3. Click **Run workflow**.

> 🪄 **Done!** The workflow will automatically:
> - Populate all 11 color-coded tabs (`Details`, `Aliases`, `Inboxes`, `Settings`, `Templates`, etc.).
> - Style and freeze headers, formulas, and sample settings.
> - Configure automated cron schedules on `cron-job.org` if `CRON_KEY` or `cron_api_key` is present.

---

## ⚙️ Managing Settings in Each Campaign
Every campaign repository has its own independent Google Sheet. You can configure:
- **Timezone**: Set `cron_timezone` in the sheet's **`Settings`** tab (e.g. `Asia/Kolkata`, `America/New_York`, `UTC`).
- **Send Times**: Set `cron_outreach_time` (`10:00`), `cron_followup_time` (`09:30`), and `cron_digest_time` (`18:30`).
- **Discord Alerts**: Set `discord_updates_webhook` and `discord_positive_webhook` in the sheet's **`Settings`** tab.
- **Inboxes**: Add distinct email mailboxes and Google App Passwords in the **`Inboxes`** tab.
- **Leads**: Add prospect leads in the **`Details`** tab.

---

## 🔍 Pre-Flight Diagnostics
Before sending cold emails, you can test mailbox authentication and DNS deliverability by running the **`Campaign Pre-Flight Diagnostics`** action on GitHub or selecting `diagnostic` in the **Universal Outreach Engine** workflow.

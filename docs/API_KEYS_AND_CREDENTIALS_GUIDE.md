# 🔑 Complete Credentials & API Keys Guide

This guide provides step-by-step instructions (under 30 seconds each) for obtaining every API key, webhook, token, and credential used by the platform.

---

## 📋 Credentials Summary Table

| Credential | Free? | Where to Get It | Where to Put It | Purpose |
| :--- | :---: | :--- | :--- | :--- |
| **`GOOGLE_SERVICE_ACCOUNT_JSON`** | ✅ 100% Free | [Google Cloud Console](https://console.cloud.google.com/) | GitHub Secrets | Access & edit Google Sheets in background. |
| **`SPREADSHEET_ID`** | ✅ 100% Free | Google Sheet URL | GitHub Secrets | ID of your campaign Google Sheet. |
| **Discord Webhook URLs** | ✅ 100% Free | Discord Channel Settings | Sheet `Settings` Tab | Real-time campaign run & positive reply alerts. |
| **Groq API Key (`gsk_...`)** | ✅ 100% Free | [console.groq.com](https://console.groq.com/) | Sheet `Settings` Tab | AI sentiment analysis & reply classification. |
| **cron-job.org API Key** | ✅ 100% Free | [cron-job.org](https://cron-job.org) | Sheet `Settings` or GitHub Secrets | Automated 100% on-time cron job dispatch. |
| **GitHub PAT (`ghp_...`)** | ✅ 100% Free | [github.com/settings/tokens](https://github.com/settings/tokens) | Web Dashboard or GitHub Secrets | 1-Click cloud triggers from web dashboard. |
| **Gmail / Workspace App Password** | ✅ 100% Free | Google Account Security | Sheet `Inboxes` Tab | SMTP sending & IMAP reply detection. |

---

## 1. 💬 Discord Webhooks (30 Seconds)

Discord webhooks send instant real-time alerts to your team channels when emails are sent, daily digests are calculated, or interested leads reply!

### Steps to create Discord Webhooks:
1. Open **Discord** and open your server (or create a free private server).
2. Create 2 or 3 channels (e.g. `#outreach-updates`, `#hot-replies`, `#funding-radar`).
3. Hover over a channel (e.g. `#hot-replies`) and click the **Gear icon** ⚙️ (**Edit Channel**).
4. In the left menu, click **Integrations** > click **Webhooks** > click **New Webhook**.
5. Give the bot a name (e.g. `🔥 Sheet-Bot Hot Leads`) and click **Copy Webhook URL**.
6. Paste the URL in your Google Sheet **`Settings`** tab:
   - `discord_updates_webhook` → For general batch send and digest notifications.
   - `discord_positive_webhook` → For hot prospect replies (`POSITIVE` sentiment).
   - `discord_rereply_webhook` → For follow-up replies from existing prospects.

---

## 2. 🤖 Groq AI API Key (30 Seconds)

Groq powers the ultra-fast Llama-3 AI engine that analyzes incoming email replies, filters out auto-responders/OOO, and categorizes sentiment (`POSITIVE`, `NEUTRAL`, `NEGATIVE`).

### Steps to get your Groq API Key:
1. Go to **[console.groq.com](https://console.groq.com/)** and sign in with Google or GitHub.
2. In the left sidebar, click **API Keys**.
3. Click **+ Create API Key**.
4. Give it a name (e.g. `SheetBot`) and click **Submit**.
5. Copy the generated key (`gsk_...`).
6. Paste it into your Google Sheet **`Settings`** tab under `groq_api_key`.

---

## 3. ⏰ cron-job.org API Key (30 Seconds)

cron-job.org allows 100% reliable, second-precision automated triggering of your outreach campaigns, follow-up sequences, and inbox sync.

### Steps to get your cron-job.org API Key:
1. Go to **[cron-job.org](https://cron-job.org)** and log in or create a free account.
2. Click on your profile name at the top right > select **Settings** (or **Profile**).
3. Scroll to the **API Keys** section and click **Create API Key**.
4. Copy the generated API key.
5. Paste it in your Google Sheet **`Settings`** tab under `cron_api_key` (or in GitHub Secrets as `CRON_KEY`).

---

## 4. 🐙 GitHub Personal Access Token (PAT) (30 Seconds)

A GitHub PAT allows the online Web Dashboard and cron-job.org to trigger your GitHub Actions workflows via GitHub's cloud API.

### Steps to generate your PAT:
1. Go to **[github.com/settings/tokens](https://github.com/settings/tokens)**.
2. Click **Generate new token** > **Generate new token (classic)**.
3. Note: `SheetBot Trigger Token`.
4. Expiration: Choose `No expiration` (or your preferred duration).
5. Check these 2 scopes:
   - [x] **`repo`** (Full control of repositories)
   - [x] **`workflow`** (Update GitHub Action workflows)
6. Scroll down and click **Generate token**.
7. Copy your token (`ghp_...`).
8. Paste it in your online dashboard under **Campaigns & Connect** > **Save Token** (or in GitHub Secrets as `GITHUB_PAT`).

---

## 5. 📬 Gmail / Google Workspace App Password (30 Seconds)

Google requires an **App Password** (16-character code) instead of your regular account password to allow SMTP and IMAP connections.

### Steps to generate Google App Password:
1. Go to **[myaccount.google.com/security](https://myaccount.google.com/security)**.
2. Under **How you sign in to Google**, ensure **2-Step Verification** is turned **ON**.
3. In the search bar at the top of Google Account, type **App Passwords** and click on it.
4. App name: Enter `SheetBot` and click **Create**.
5. A 16-character code will appear (e.g. `abcd efgh ijkl mnop`).
6. Copy the password (without spaces: `abcdefghijklmnop`).
7. Paste it in your Google Sheet **`Inboxes`** tab under the `smtp_pass` column for that sender.

👉 *For detailed troubleshooting and Workspace admin permissions, read [Google App Password Setup & Recovery](docs/GOOGLE_APP_PASSWORD_SETUP.md).*

---

## 6. 📄 Google Cloud Service Account JSON (60 Seconds)

Allows the engine to format, read, and write to Google Sheets automatically.

👉 *For complete step-by-step instructions, read the [Google Service Account Setup Guide](docs/GOOGLE_SERVICE_ACCOUNT_SETUP.md).*

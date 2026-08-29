# 🚀 Universal Cold Outreach Engine & Sheet Bot

[![Node.js CI](https://img.shields.io/badge/Node.js-v22+-green.svg?logo=node.js)](https://nodejs.org/)
[![Serverless Engine](https://img.shields.io/badge/Architecture-100%25%20Serverless-blue.svg?logo=github-actions)](https://github.com/features/actions)
[![100% Free](https://img.shields.io/badge/Cost-100%25%20Free-brightgreen.svg)](#)
[![Tests Passing](https://img.shields.io/badge/Tests-82%2F82%20Passing-success.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

An automated, 100% free, production-ready serverless cold outreach platform built with **Node.js**, **Google Sheets API**, **IMAP/SMTP**, **GitHub Actions**, **Groq AI**, **Discord Webhooks**, and an **Online GitHub Pages Dashboard**.

---

## ⚡ 3-Minute Quick Start

```
 ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
 │ 1. Blank Sheet  │ ────► │ 2. Add 2 Secrets│ ────► │ 3. Run Auto-    │
 │ (sheets.new)    │       │ (ID & Service   │       │    Provisioning │
 │                 │       │  Account JSON)  │       │ (All 11 Tabs)   │
 └─────────────────┘       └─────────────────┘       └─────────────────┘
```

1. **Create Blank Google Sheet**: Open [sheets.new](https://sheets.new) and share it with your Google Service Account email as **Editor**.
2. **Add 2 Secrets in GitHub** (**Settings** > **Secrets and variables** > **Actions**):
   - `SPREADSHEET_ID`: Your Google Sheet ID.
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: Your Google Cloud Service Account JSON key.
3. **Run 1-Click Auto-Setup**: Go to GitHub **Actions** > run **`🚀 1-Click Complete Auto-Setup & Provisioning`**.

👉 **For detailed step-by-step instructions, see the [⚡ Complete Setup Guide (SETUP_10MIN.md)](./SETUP_10MIN.md).**

---

## 📚 Documentation Index

All in-depth technical guides, schemas, and walkthroughs are organized into dedicated documentation:

| Guide | Description |
| :--- | :--- |
| ⚡ [**Rapid 3-Minute Setup Guide**](./SETUP_10MIN.md) | Step-by-step instructions to go from zero to live sending in 3 minutes. |
| 📁 [**Multi-Campaign Strategy**](./docs/MULTI_CAMPAIGN_GUIDE.md) | How to scale to multiple clients & campaigns using the 1-Repo architecture. |
| 📊 [**Google Sheets Schema & Tabs**](./docs/GOOGLE_SHEETS_SCHEMA.md) | Details on all 11 tabs, formulas, Spintax syntax, and custom settings. |
| ⏰ [**Automated Cron Scheduling**](./docs/CRON_SETUP.md) | Automated `cron-job.org` dispatch for 100% on-time execution. |
| 🌐 [**Online Web Dashboard**](./docs/DASHBOARD_GUIDE.md) | Enabling your free 24/7 visual analytics dashboard on GitHub Pages. |
| 🧩 [**Chrome Extension User Guide**](./docs/CHROME_EXTENSION_GUIDE.md) | 1-click browser lead extraction and queueing extension. |
| 🔐 [**Google App Passwords Guide**](./docs/GOOGLE_APP_PASSWORD_SETUP.md) | Generating and configuring Gmail / Workspace SMTP App Passwords. |
| 🧪 [**Step-by-Step Manual Testing**](./docs/MANUAL_TESTING.md) | End-to-end verification checklist for sandbox and live tests. |
| 🏗️ [**System Architecture**](./docs/ARCHITECTURE.md) | Complete system data flow, Concurrency groups, and throttle engines. |
| 🛡️ [**Security & Compliance**](./docs/SECURITY.md) | CAN-SPAM compliance, HMAC unsubscribe tokens, and secret safety. |

---

## ✨ Key Capabilities

- **🎲 Spintax Randomization**: Dynamic variations like `{{Hi|Hey|Hello}}` across subject lines and bodies to maximize deliverability.
- **🛡️ Adaptive Deliverability Shield**: Auto-adjusts sending delays (60s on spam complaints, 15s on bounces, 8s ramp-up, 3s steady state).
- **⚡ High-Speed Bulk Mode**: Toggle `throttle_mode = bulk` in Google Sheet `Settings` for high-speed sending blasts (1500+ emails).
- **📝 IMAP Draft-Review Mode**: Toggle `send_mode = review` in your sheet to generate and save Touch-1 emails directly into your inbox **Drafts** folder for review.
- **🔥 Peer-to-Peer Free Warmup**: Built-in synthetic inbox warmup engine between enabled inboxes with progressive daily volume ramp-up.
- **🤖 Groq AI Reply Sentiment**: Classifies prospect responses (`POSITIVE`, `NEUTRAL`, `NEGATIVE`, `OOO`) and fires dedicated Discord alerts.
- **📡 GCC Leadership Radar**: Automated daily intelligence tracker monitoring new GCC office launches, funding deals, and leadership hiring in India.
- **🔍 Automated DNS Auditing**: Weekly automated SPF, DKIM, and DMARC health checks recorded to `Domain_Health`.

---

## 🔑 GitHub Secrets Reference

You only need **2 repository secrets** to run the complete platform:

| Secret Name | Required | Purpose |
| :--- | :---: | :--- |
| `SPREADSHEET_ID` | **Yes** | The Google Sheet ID from your browser URL. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Yes** | Raw JSON key from Google Cloud Console. |
| `CRON_KEY` | *Optional* | API key from `cron-job.org` for automated schedule provisioning. |
| `GITHUB_PAT` | *Optional* | Personal Access Token (`repo` + `workflow`) for 1-click cloud triggers. |

---

## 🧪 Local Development & Testing

```bash
# Install dependencies
npm ci

# Run all 82 unit test suites
npm test

# Start local web dashboard
npm start

# Run pre-flight campaign diagnostics
npm run diagnostics
```

---

## 📄 License
MIT License. Free for personal, agency, and commercial cold outreach.

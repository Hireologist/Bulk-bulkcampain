# 🌐 Online Web Dashboard Guide (GitHub Pages)

The engine features a **100% Client-Side Web Dashboard** hosted directly on your repository via **GitHub Pages**. It allows you to track analytics, search leads, check inbox quota usage, and trigger GitHub Actions runs in 1 click from your phone, tablet, or desktop.

---

## ⚡ 1-Minute GitHub Pages Enablement

1. In your GitHub repository, go to **Settings** ⚙️ > **Pages** (in the left sidebar).
2. Under **Build and deployment**:
   - **Source**: Select `Deploy from a branch`
   - **Branch**: Select **`main`**
   - **Folder**: Select **`/docs`** (or **`/ (root)`**)
3. Click **Save** 💾.
4. Your live dashboard is available at:
   👉 `https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/`

---

## 🔑 1-Click Cloud Triggers & GitHub PAT Setup

To trigger workflows (Outreach, Followups, Inbox Check, Warmup) directly from the browser dashboard:

1. Generate a classic Personal Access Token at **[GitHub Token Settings](https://github.com/settings/tokens)**.
2. Select scopes:
   - [x] **`repo`** (Full control of repository)
   - [x] **`workflow`** (Update GitHub Action workflows)
3. Copy your token (`ghp_...`).
4. In your Web Dashboard:
   - Click **Campaigns & Connect** on the left menu.
   - Paste your token under **GitHub Personal Access Token**.
   - Click **Save Token**.
5. You can now trigger any workflow action with a single click!

---

## 📱 Features Available in the Dashboard

- **📊 Live Funnel Metrics**: Sent, Open, Reply, and Bounce rates updated dynamically.
- **🤖 AI Sentiment Pie Chart**: Visual breakdown of `POSITIVE`, `NEUTRAL`, `NEGATIVE`, and `OOO` responses.
- **📬 Mailbox Capacity Monitor**: Real-time progress bars showing daily quota usage per sender mailbox.
- **🔍 Instant Lead Directory**: Search and filter prospect statuses without opening Google Sheets.
- **🎯 Multi-Sheet Switcher**: Seamlessly switch between different campaign sheets from a dropdown menu.

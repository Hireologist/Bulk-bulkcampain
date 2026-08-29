# 🚀 Sheet-Bot Remote Dispatcher — Chrome Extension

A modern, Manifest V3 Chrome Extension that lets you send **Single** and **Bulk** personalized cold emails directly via your **Sheet-Bot** GitHub Actions infrastructure, featuring automatic **Name** and **Company** parsing.

---

## ⚡ Key Features

1. **Auto Name Extractor**:
   - Converts `rohan.patel@hireologist.in` ➔ `Rohan`.
   - Identifies role emails (`hr@`, `careers@`, `sales@`, `info@`, `support@`, etc.) ➔ `Team`.
2. **Auto Company Extractor**:
   - Converts `rohan@hireologist.in` ➔ `Hireologist`.
   - Cleans hyphens, adds space between letters & numbers, and strips common corporate/generic suffixes (`solutions`, `technologies`, `consulting`, `group`, `ltd`, etc.).
   - Detects public providers (`gmail.com`, `yahoo.com`, etc.) ➔ `Your Company`.
3. **Single Lead Email Dispatch**:
   - Live preview of auto-extracted Name & Company.
   - 1-Click dispatch to GitHub Repository Dispatch API.
4. **Bulk Batch Email Dispatch**:
   - Paste a list of raw emails or CSV lines.
   - Generates a live parsed preview table with editable extracted names & companies.
   - Batch progress bar (`Dispatching 3 / 10...`).
5. **Config & Token Manager**:
   - Persists your GitHub Personal Access Token (PAT), Repository Owner, and Repo Name in `chrome.storage.local`.

---

## 📥 How to Install in Chrome / Brave / Edge

1. Open **Google Chrome** (or Brave / Edge).
2. Go to `chrome://extensions/` in the URL bar.
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `chrome-extension` folder inside this repository:
   `d:\Codinf projets\Sheet-bot\chrome-extension`
6. Pin the **Sheet-Bot Remote Dispatcher** icon to your browser toolbar!

---

## ⚙️ Initial Configuration (One-Time Setup)

1. Click the **Sheet-Bot** extension icon in your browser toolbar.
2. Go to the **Settings ⚙️** tab.
3. Fill in your details:
   - **GitHub PAT**: Your GitHub Personal Access Token (with `repo` scope).
   - **Repo Owner**: Your GitHub username (e.g. `your-github-username`).
   - **Repo Name**: Your repository name (e.g. `your-repo-name`).
   - **Default Location**: e.g. `India` (or `Mumbai`)
4. Click **Save Configuration**. The header status badge will change to **Connected**.

---

## 🚀 How to Use

### A. Sending a Single Instant Email:
1. Open the extension and select **Single Email** tab.
2. Type or paste any recipient email address (e.g. `rohan.patel@hireologist.in`).
3. Notice the **Parsed Name** (`Rohan`) and **Parsed Company** (`Hireologist`) fill automatically!
4. Edit the location if needed, and click **Send Instant Email**.

### B. Sending a Bulk Email Batch:
1. Open the extension and select **Bulk Batch** tab.
2. Paste a list of emails (one per line):
   ```text
   rohan.patel@hireologist.in
   hr@acme-technologies.com
   john.doe@techflow.io
   ```
3. Click **Parse List**. A live table will show all extracted Names and Companies.
4. Click **Dispatch Bulk Batch to GitHub**. Watch the real-time progress bar send each lead to GitHub cloud!

---

## 📖 Comprehensive Documentation
For the complete step-by-step walkthrough, screenshots, sequence diagrams, and PAT permission guides, see:
👉 **[`docs/CHROME_EXTENSION_GUIDE.md`](../docs/CHROME_EXTENSION_GUIDE.md)**

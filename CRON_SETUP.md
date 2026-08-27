# Cron-Job.org Complete Configuration Guide for Sheet-Bot

This document contains exact, step-by-step setup instructions for triggering **Sheet-Bot** GitHub Actions workflows reliably using [cron-job.org](https://cron-job.org).

---

## ⚡ 1-Click Automated Setup via API (Recommended)

You can automatically create all 4 cron jobs in **seconds** without manually typing settings in the dashboard using the included script `setup-cron.mjs`:

1. Get your **cron-job.org API Key**: Log in at [console.cron-job.org](https://console.cron-job.org/) → **Settings** → **API Keys** → **Create API key**.
2. Run the script:
   ```bash
   node setup-cron.mjs
   ```
   *(Or pass environment variables directly)*:
   ```bash
   CRON_KEY="your_cron_job_api_key" GITHUB_PAT="your_github_pat" node setup-cron.mjs
   ```
3. The script will automatically create all 4 jobs with their exact URLs, headers, payloads, and schedules!

---

## 🔑 Prerequisites & Common Credentials

### 1. GitHub Personal Access Token (PAT)
* **How to obtain**: 
  1. Go to [GitHub Settings → Developer Settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens).
  2. Click **Generate new token (classic)**.
  3. Name: `Cron-Job.org Trigger`.
  4. Expiration: `No expiration` (or desired timeframe).
  5. Select scope: **`repo`** (or `workflow`).
  6. Copy the generated token string (starts with `ghp_...`).

### 2. Target API Endpoint (URL for all jobs)
```text
https://api.github.com/repos/<YOUR_USERNAME>/<YOUR_REPO_NAME>/actions/workflows/outreach.yml/dispatches
```

### 3. Common HTTP Headers (Configured under "HTTP Headers" in cron-job.org)
Add these **4 headers** to every cron job:

| Header Name | Header Value |
| :--- | :--- |
| `Authorization` | `Bearer YOUR_GITHUB_PAT_HERE` *(Replace with your actual `ghp_...` token)* |
| `Accept` | `application/vnd.github+json` |
| `User-Agent` | `cron-job-org` |
| `Content-Type` | `application/json` |

### 4. Advanced / Connection Settings
* **Request Timeout**: Set to **`30 seconds`** (or default `10s–30s`).  
  *(Note: GitHub API responds instantly with `204 No Content` in under 1 second to acknowledge the trigger. cron-job.org does NOT need to wait for the entire outreach script to complete).*

---

## 📋 Job Configurations & Exact Timing Details

---

### Job 1: Follow-up Engine

#### 🔹 General Settings
* **Title**: `Sheet-Bot - Followup Engine`
* **Address (URL)**: `https://api.github.com/repos/<YOUR_USERNAME>/<YOUR_REPO_NAME>/actions/workflows/outreach.yml/dispatches`
* **Request Method**: `POST`

#### 🔹 Request Body (JSON)
```json
{
  "ref": "main",
  "inputs": {
    "action": "followup"
  }
}
```

#### 🔹 Detailed Schedule & Timing Settings
* **Cron Expression (in IST / Asia/Kolkata timezone)**: `30 9 * * 1-6`
* **Cron Expression (in UTC timezone)**: `0 4 * * 1-6`
* **Timezone**: Select `Asia/Kolkata (+05:30)` (Indian Standard Time).
* **Schedule Type**: Select **Custom Schedule** (or User-Defined / Cron Expression).
* **Months**: Select **All Months** (`Jan` through `Dec`).
* **Days of the Month**: Select **All Days** (`1` through `31`).
* **Days of the Week**: Select **Monday, Tuesday, Wednesday, Thursday, Friday, Saturday** *(Uncheck Sunday)*.
* **Hours**: Select **`9`** (09:00).
* **Minutes**: Select **`30`** (09:30).
* **Summary Execution Schedule**: Runs at **09:30 AM IST** every **Monday through Saturday**.

---

### Job 2: Cold Outreach Engine

#### 🔹 General Settings
* **Title**: `Sheet-Bot - Cold Outreach`
* **Address (URL)**: `https://api.github.com/repos/<YOUR_USERNAME>/<YOUR_REPO_NAME>/actions/workflows/outreach.yml/dispatches`
* **Request Method**: `POST`

#### 🔹 Request Body (JSON)
```json
{
  "ref": "main",
  "inputs": {
    "action": "outreach"
  }
}
```

#### 🔹 Detailed Schedule & Timing Settings
* **Cron Expression (in IST / Asia/Kolkata timezone)**: `0 10 * * 1-6`
* **Cron Expression (in UTC timezone)**: `30 4 * * 1-6`
* **Timezone**: Select `Asia/Kolkata (+05:30)` (Indian Standard Time).
* **Schedule Type**: Select **Custom Schedule**.
* **Months**: Select **All Months** (`Jan` through `Dec`).
* **Days of the Month**: Select **All Days** (`1` through `31`).
* **Days of the Week**: Select **Monday, Tuesday, Wednesday, Thursday, Friday, Saturday** *(Uncheck Sunday)*.
* **Hours**: Select **`10`** (10:00).
* **Minutes**: Select **`0`** (10:00).
* **Summary Execution Schedule**: Runs at **10:00 AM IST** every **Monday through Saturday**.

---

### Job 3: Inbox Checker

#### 🔹 General Settings
* **Title**: `Sheet-Bot - Inbox Checker`
* **Address (URL)**: `https://api.github.com/repos/<YOUR_USERNAME>/<YOUR_REPO_NAME>/actions/workflows/outreach.yml/dispatches`
* **Request Method**: `POST`

#### 🔹 Request Body (JSON)
```json
{
  "ref": "main",
  "inputs": {
    "action": "inbox"
  }
}
```

#### 🔹 Detailed Schedule & Timing Settings
* **Cron Expression**: `*/15 * * * *` (or `7,22,37,52 * * * *`)
* **Timezone**: Select `Asia/Kolkata (+05:30)` (Indian Standard Time).
* **Schedule Type**: Select **Interval** (or Recurring Interval / Cron Expression).
* **Execution Interval**: Select **Every 15 minutes**.
* **Minutes Selection** *(if using custom minute picker)*: Select **`0, 15, 30, 45`** or **`7, 22, 37, 52`**.
* **Days of the Week**: Select **Monday, Tuesday, Wednesday, Thursday, Friday, Saturday** *(or All Days if 24/7 monitoring is required)*.
* **Hours**: Select **All Hours** (`0` through `23`).
* **Summary Execution Schedule**: Triggers **every 15 minutes**, 24 times an hour.

---

### Job 4: Daily Digest

#### 🔹 General Settings
* **Title**: `Sheet-Bot - Daily Digest`
* **Address (URL)**: `https://api.github.com/repos/<YOUR_USERNAME>/<YOUR_REPO_NAME>/actions/workflows/outreach.yml/dispatches`
* **Request Method**: `POST`

#### 🔹 Request Body (JSON)
```json
{
  "ref": "main",
  "inputs": {
    "action": "digest"
  }
}
```

#### 🔹 Detailed Schedule & Timing Settings
* **Cron Expression (in IST / Asia/Kolkata timezone)**: `30 18 * * 1-6`
* **Cron Expression (in UTC timezone)**: `0 13 * * 1-6`
* **Timezone**: Select `Asia/Kolkata (+05:30)` (Indian Standard Time).
* **Schedule Type**: Select **Custom Schedule**.
* **Months**: Select **All Months** (`Jan` through `Dec`).
* **Days of the Month**: Select **All Days** (`1` through `31`).
* **Days of the Week**: Select **Monday, Tuesday, Wednesday, Thursday, Friday, Saturday** *(Uncheck Sunday)*.
* **Hours**: Select **`18`** (06:00 PM in 24-hour format).
* **Minutes**: Select **`30`** (06:30 PM).
* **Summary Execution Schedule**: Runs at **06:30 PM IST (18:30 IST)** every **Monday through Saturday**.

---

## 🛠️ Testing & Troubleshooting Checklist

1. **Test Execution**:
   * Click **Test / Run Now** next to any cron job in cron-job.org dashboard.
   * View Response Status Code: **`204 No Content`** indicates success.
2. **If HTTP 403 Forbidden**:
   * Verify that the `User-Agent: cron-job-org` header is present.
   * Verify that your `Authorization` header format is `Bearer ghp_...` with a space after `Bearer`.
3. **If HTTP 404 Not Found**:
   * Ensure `outreach.yml` is pushed to the `main` branch.
   * Verify the URL endpoint matches your exact repository path (`<YOUR_USERNAME>/<YOUR_REPO_NAME>`).

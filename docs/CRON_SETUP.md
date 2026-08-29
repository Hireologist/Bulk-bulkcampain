# ⏰ Automated Cron Scheduling Guide (cron-job.org)

GitHub Actions native `schedule` triggers often suffer from queue delays (15–60 minutes) during peak GitHub traffic. For **100% on-time execution**, the engine uses **[cron-job.org](https://cron-job.org)** to trigger workflows via GitHub's `workflow_dispatch` API.

---

## ⚡ 1-Click Automated Cron Provisioning (Recommended)

You can automatically create all 4 cron jobs without typing any URLs or headers:

### Option 1: Via GitHub Actions
1. Go to the **Actions** tab in your repository.
2. Select **`⚡ Provision Cron Jobs (cron-job.org)`** (`setup_cron.yml`).
3. Click **Run workflow** (or ensure `CRON_KEY` / `cron_api_key` and `GITHUB_PAT` are set).
4. Done! All 4 cron jobs are created on your cron-job.org account.

### Option 2: Locally via Terminal
```bash
CRON_KEY="your_cron_api_key" GITHUB_PAT="your_github_pat" node setup-cron.mjs
```

---

## 🛠️ The 4 Automated Workflows

| Job Name | Schedule (Customizable in Sheet) | Action Triggered | Purpose |
| :--- | :--- | :--- | :--- |
| **Outreach Engine** | Every Mon–Fri at `10:00 AM` | `outreach` | Sends Touch-1 cold emails to queued leads. |
| **Followup Engine** | Every Mon–Fri at `09:30 AM` | `followup` | Sends scheduled multi-touch follow-up emails. |
| **Inbox & Sentiment** | Every `30 minutes` | `inbox` | Syncs replies, parses bounces, analyzes sentiment with Groq AI. |
| **Daily Digest** | Every Mon–Fri at `06:30 PM` | `digest` | Sends comprehensive performance summary to Discord. |
| **Weekly Domain Audit**| Every Monday at `08:00 AM` | `domain-health` | Audits SPF, DKIM, DMARC DNS health. |

---

## ⏱️ Customizing Timings & Timezones

All schedules are dynamic! To change your schedule, simply edit the **`Settings`** tab in your Google Sheet:
- `cron_timezone`: e.g. `America/New_York`, `Asia/Kolkata`, `UTC`, `Europe/London`
- `cron_outreach_time`: e.g. `11:00`
- `cron_followup_time`: e.g. `10:00`
- `cron_digest_time`: e.g. `19:00`

Then run the **`⚡ Provision Cron Jobs`** workflow to sync the new timings to `cron-job.org` in 2 seconds.

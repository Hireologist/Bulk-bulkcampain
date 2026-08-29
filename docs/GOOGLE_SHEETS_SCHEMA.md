# 📊 Google Sheets Schema & Architecture Guide

The cold outreach engine is powered by a structured, 11-tab Google Spreadsheet. All tabs, colors, column headers, and formulas are automatically provisioned when running the **`🚀 1-Click Complete Auto-Setup & Provisioning`** workflow (`scripts/auto-setup.mjs`).

---

## 🎨 Tab Architecture & Summary

| Tab Name | Role & Purpose | Key Columns |
| :--- | :--- | :--- |
| **`📖 Setup_Guide`** | Documentation & status rules for team members. | *Instructions, cheat sheet, tag references* |
| **`Details`** | Prospect lead database and email dispatch queue. | `full_name`, `email`, `company_name`, `location`, `Sent Status`, `Sent From`, `Reply Status`, `Sentiment` |
| **`Inboxes`** | SMTP/IMAP credentials and daily limits per mailbox. | `email`, `display_name`, `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `imap_host`, `imap_port`, `daily_limit`, `is_active`, `warmup_enabled` |
| **`Aliases`** | Virtual alias emails for random `From:` header rotation. | `alias_email`, `display_name` |
| **`Settings`** | Global engine delays, cutoffs, webhooks, and AI keys. | `key`, `value`, `description` |
| **`Templates`** | Initial cold outreach email subject lines and bodies. | `Subject`, `Body` |
| **`Followup_Templates`** | Sequential drip follow-ups with wait intervals. | `Step`, `Days_Until_Next`, `Subject`, `Body` |
| **`Suppressed`** | Unsubscribed contacts and suppressed domains. | `Email`, `Reason`, `Date_Added` |
| **`Inbox_Stats`** | Daily tracking of sent volume, bounces, complaints. | `Date`, `Inbox_Email`, `Sent_Today`, `Bounces`, `Complaints` |
| **`Domain_Health`** | Automated DNS audits (SPF, DKIM, DMARC records). | `Domain`, `SPF_Status`, `DMARC_Status`, `MX_Status`, `Last_Checked` |
| **`Failed_Sends`** | Audit trail for failed SMTP deliveries. | `Timestamp`, `Recipient`, `Sender`, `Error_Reason` |
| **`Locations`** | Random city tags used for dynamic placeholders. | `location_name` |
| **`Clients`** | Portfolio / social proof client names for pitch. | `client_name` |
| **`📊 Email_Analytics`** | Real-time formula calculating sender conversion rates. | `=LET(...)` automated formulas |
| **`📈 ChartData`** | Sentiment distribution and status aggregates. | Formula-driven visual aggregates |

---

## 🎲 Dynamic Variables & Spintax Syntax

You can use dynamic placeholders and Spintax variation blocks in your email subject lines and bodies in `Templates` and `Followup_Templates`:

### Dynamic Variables
- `{{full_name}}` — Prospect's full name (e.g. `John Doe`)
- `{{first_name}}` — Extracted first name (e.g. `John`)
- `{{company_name}}` — Company name (e.g. `Acme Corp`)
- `{{location}}` — Prospect's city or region (e.g. `San Francisco`)
- `{{sender_name}}` — Sender's display name
- `{{clients}}` — Randomly picked client name from `Clients` tab
- `{{other_locations}}` — Randomly picked city from `Locations` tab
- `{{Date}}` — Today's formatted date

### Spintax (Spin Syntax)
Wrap variations in `{{option1 | option2 | option3}}` to generate unique variations per lead:
```text
{{Hi|Hey|Hello}} {{first_name}},

{{I noticed that|I came across|Saw that}} {{company_name}} is {{expanding|growing rapidly|scaling its operations}}.

{{Would you be open to a brief 5-min chat next week?|Are you free for a quick intro call this Tuesday?|Let me know if this sounds relevant.}}

Best,
{{sender_name}}
```

---

## ⚙️ Key Settings in the `Settings` Tab

| Key | Default | Description |
| :--- | :--- | :--- |
| `campaign_active` | `TRUE` | Master switch. Set to `FALSE` to instantly pause all outreach and follow-ups. |
| `throttle_mode` | `adaptive` | `adaptive` (auto-slowdown on bounces/complaints) or `bulk` (high-speed fixed delay). |
| `send_mode` | `live` | `live` (sends emails immediately) or `review` (saves to IMAP Drafts folder for inspection). |
| `cron_timezone` | `Asia/Kolkata` | Timezone for cron schedules (`Asia/Kolkata`, `America/New_York`, `UTC`, etc.). |
| `cron_outreach_time`| `10:00` | Scheduled time for Touch-1 outreach blast. |
| `cron_followup_time`| `09:30` | Scheduled time for follow-up sequence. |
| `cron_digest_time` | `18:30` | Scheduled time for daily email analytics digest. |
| `groq_api_key` | `gsk_...` | Free Groq API Key for AI sentiment classification of replies. |
| `discord_updates_webhook` | `https://...` | Discord channel webhook URL for run notifications and daily digests. |
| `discord_positive_webhook`| `https://...` | Dedicated Discord webhook URL for positive/interested prospect replies. |

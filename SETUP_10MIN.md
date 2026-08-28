# ⚡ Complete Zero-Effort Setup & Operational Guide for Sheet-Bot

> **Target:** Go from a blank Google Sheet to a 100% automated, production-grade, serverless cold email infrastructure with automated crons, deliverability safeguards, and AI reply analysis in **under 3 minutes**.

---

## 🚀 3-Minute 1-Click Setup Walkthrough

### Step 1: Create a Blank Google Sheet (30 Seconds)
1. Open **[sheets.new](https://sheets.new)** in your browser. Name it `Outreach Master`.
2. Copy your **Spreadsheet ID** from the browser URL bar:
   `https://docs.google.com/spreadsheets/d/`**`1a2b3c4d5e...`**`/edit`
   *(Save this string).*

---

### Step 2: Download Google Service Account Key (60 Seconds)
1. Go to **[Google Cloud Console](https://console.cloud.google.com/)** and create a project (e.g. `sheet-outreach-bot`).
2. Go to **APIs & Services** > **Library**, search for **Google Sheets API**, and click **Enable**.
3. Go to **APIs & Services** > **Credentials** > **+ CREATE CREDENTIALS** > **Service Account** (Name: `sheet-bot`, click **Create & Continue** > **Done**).
4. Click on the created service account email:
   - Go to the **Keys** tab > **Add Key** > **Create new key** > **JSON** > **Create**.
   - A `.json` key file will download.
5. **Share Sheet with Service Account**:
   - Open the downloaded JSON file, copy the `client_email` (e.g. `sheet-bot@project.iam.gserviceaccount.com`).
   - Open your Google Sheet, click the green **Share** button, paste the email, and give it **Editor** permissions.

---

### Step 3: Add the 2 Secrets & Run 1-Click Auto-Setup (60 Seconds)
1. In your GitHub repository, navigate to **Settings** > **Secrets and variables** > **Actions** > click **New repository secret**:
   - **`SPREADSHEET_ID`**: Paste your Spreadsheet ID from Step 1.
   - **`GOOGLE_SERVICE_ACCOUNT_JSON`**: Paste the entire content of the downloaded JSON file.
2. Go to the **Actions** tab in GitHub:
   - Select **`🚀 1-Click Complete Auto-Setup & Provisioning`** on the left.
   - Click **Run workflow**.

> 🪄 **What happens automatically?**
> The workflow connects to your sheet, creates **all 11 tabs**, injects all headers, sample data, formulas, and configurations, checks DNS records for your inboxes, and provisions all `cron-job.org` automation schedules!

---

## 📖 Comprehensive Operational Guide: How to Use Every Feature

### 1. 👥 Adding Leads (`Details` Tab)
- Fill in: `full_name`, `email`, `company_name`, `location`.
- Leave `Sent Status`, `Sent From`, `Date Sent`, `Time`, and `Follow up` **EMPTY**.
- The engine automatically processes rows where `Sent Status` is empty.
- When an email is sent, the status updates to `SENT`, then automatically to `replied` (if prospect replies) or `bounced` (if dead email).

---

### 2. 📬 Inboxes & Peer-to-Peer Warmup (`Inboxes` Tab)
Add your sending mailboxes with their credentials:
- **`email`**: The mailbox address (e.g. `alex@yourdomain.com`).
- **`smtp_host` / `smtp_port`**: `smtp.gmail.com` / `465` (SSL) or `587` (TLS).
- **`smtp_user` / `smtp_pass`**: Email and App Password.
- **`imap_host` / `imap_port`**: `imap.gmail.com` / `993` (for reply detection & draft mode).
- **`daily_limit`**: Max sends per day for this inbox (e.g. `50`).
- **`is_active`**: `TRUE` to enable sending.
- **`warmup_enabled`**: Set to `TRUE` to enable automated peer warmup with other inboxes.
- **`warmup_day`**: Current warmup day (ramps up +3 emails/day).
- **`warmup_target_volume`**: Maximum daily warmup emails (e.g. `40`).

---

### 3. 🎭 Sender Aliases (`Aliases` Tab)
Rotate realistic human sender names while using the same authenticated SMTP mailbox:
- Set `alias_email` and `display_name` (e.g. `pooja@company.com`, `Pooja`).
- Set `is_active` to `TRUE`. The bot randomly rotates active aliases on every cold outreach touch.

---

### 4. 📝 Pitch Templates (`Templates` Tab)
Compose your cold email pitch using dynamic template tags and **Spintax rotation**:
- `{{full_name}}`: Prospect's first name
- `{{company_name}}`: Prospect's company
- `{{location}}`: Prospect's city
- `{{other_locations}}`: Randomized other cities you operate in
- `{{clients}}`: Randomized portfolio client references from `Clients` tab
- `{{Date}}`: Today's localized date format
- `{{Hi|Hey|Hello}}`: Random Spintax variations for high open rates
- `{{option 1 | option 2 | option 3}}`: Random phrase/sentence choices

---

### 5. 🔁 Multi-Touch Follow-up Sequence (`Followup_Templates` Tab)
- Configure follow-up touches with `Follow_Up_Number` (1, 2, 3...) and `Days_Until_Next` (e.g. wait 3 days, 5 days, 7 days).
- Supports Spintax and personalized tags.
- The engine automatically matches the exact initial sender alias and email thread, and automatically halts the moment a reply or bounce is detected.

---

### 6. ⚙️ System Settings & Control (`Settings` Tab)

| Setting Key | Default | Description |
| :--- | :--- | :--- |
| **`campaign_active`** | `TRUE` | **Master Switch**: Set to `TRUE` to run outreach, or `FALSE` to pause all automated campaigns instantly. |
| **`throttle_mode`** | `adaptive` | Set to `adaptive` (safe reputation shield) or `bulk` (high-speed fixed delay for 1500+ blasts). |
| **`send_mode`** | `auto` | Set to `auto` for live sending or `review` to save Touch-1 emails directly into your mailbox **Drafts** folder for human inspection. |
| **`cron_timezone`** | `Asia/Kolkata` | Timezone for cron schedules (`Asia/Kolkata`, `America/New_York`, `UTC`, `Europe/London`). |
| **`cron_outreach_time`** | `10:00` | Cold outreach send time (`HH:MM`). |
| **`cron_followup_time`** | `09:30` | Follow-up sequence send time (`HH:MM`). |
| **`cron_inbox_minutes`** | `15` | How often to scan inboxes for replies (`15` = every 15 mins). |
| **`cron_digest_time`** | `18:30` | Time to send Daily Discord summary (`HH:MM`). |
| **`cron_diagnostic_schedule`**| `daily_0900` | Pre-flight diagnostic timing (`manual` = on-demand, `daily_0900` = daily at 09:00 AM, `weekly_monday_0830` = Mondays at 08:30 AM). |
| **`cron_diagnostic_time`**| `09:00` | Custom time for Campaign Pre-Flight Diagnostic (`HH:MM`). |
| **`cron_days`** | `Mon-Sat` | Active automation days (`Mon-Sat`, `Mon-Fri`, or `All`). |
| **`business_name`** | `Outreach Team` | Injected into legal CAN-SPAM email footer. |
| **`business_address`** | `123 Tech St` | Registered company address for CAN-SPAM compliance. |
| **`unsubscribe_url`** | `""` | Optional web unsubscribe link (or leave blank for automatic mailto unsubscribe). |
| **`groq_api_key`** | `gsk_...` | Groq API Key for AI positive/negative sentiment analysis. |
| **`discord_alerts_enabled`**| `TRUE` | Master switch for Discord alerts (`TRUE` = Enabled, `FALSE` = Muted). |
| **`discord_domain_alerts_enabled`**| `TRUE` | Set to `TRUE` to receive Discord alerts for domain DNS failures, or `FALSE` to mute them. |
| **`discord_updates_webhook`**| `https://...` | Webhook URL for run start/stop alerts and daily digests. |
| **`discord_positive_webhook`**| `https://...` | Webhook URL for instant alerts when a positive lead replies. |

---

### 7. 🛡️ Deliverability, Compliance & Health Monitoring
- **`Domain_Health` Tab**: Displays SPF (`v=spf1`) and DMARC (`v=DMARC1`) verification status. Audited automatically every Monday.
- **`Suppressed` Tab**: Global opt-out list. Any email added here is permanently excluded from all future outreach campaigns.
- **`Inbox_Stats` Tab**: Dynamically tracks `sent`, `bounced`, `complaints`, and `sentToday` to adjust send velocity.
- **`Failed_Sends` Tab**: Dead-letter queue capturing any send that failed after 3 exponential backoff attempts.

---

### 8. 📊 In-Sheet Analytics & Dashboards
- **`📊 Email_Analytics` Tab**: Automated real-time formulas calculating total emails sent, positive reply rates, and bounce rates per sender.
- **`📈 ChartData` Tab**: Aggregated sentiment breakdowns (`POSITIVE`, `NEUTRAL`, `NEGATIVE`, `OOO`).

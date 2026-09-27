# 💬 Discord Server, Channels & Webhook Setup Guide

Setting up a dedicated Discord server gives you real-time visibility into your cold email campaigns. You'll receive instant alerts when emails are sent, daily performance digests, and push notifications directly to your phone when a hot prospect replies.

Setup is **100% free** and takes **under 2 minutes**.

---

## 🏗️ Step 1: Create a Free Discord Server (30 Seconds)

1. Open **[Discord](https://discord.com/)** (in your browser or desktop app) and log in.
2. In the left server sidebar, scroll to the bottom and click the **`+` (Add a Server)** button.
3. Select **Create My Own** > **For me and my friends**.
4. Server Name: Enter `Outreach HQ` (or your company name).
5. Click **Create**.

---

## 📢 Step 2: Create Recommended Channels (30 Seconds)

Organizing notifications into separate channels keeps your team alerts clean and actionable.

Hover over **Text Channels** on the left and click the **`+` (Create Channel)** button to create:

| Channel Name | Purpose |
| :--- | :--- |
| **`#outreach-updates`** | General batch start/finish logs and daily 6:30 PM performance digests. |
| **`#hot-replies`** | Instant alerts with full text when a prospect replies with **`POSITIVE`** sentiment. |
| **`#re-replies`** | Alerts when an existing lead responds back to your follow-up email. |
| **`#domain-alerts`** | Weekly Monday morning DNS audits (SPF, DKIM, DMARC health). |
| **`#gcc-radar`** | Daily 9:00 AM tracking of GCC office launches, funding deals, and leadership hiring. |

---

## 🔗 Step 3: Generate Webhook URLs for Each Channel (60 Seconds)

For each channel you created (e.g., `#hot-replies`):

1. Hover over the channel name in Discord and click the **Gear icon** ⚙️ (**Edit Channel**).
2. In the left menu of the channel settings, click **Integrations**.
3. Click **Webhooks** (or **Create Webhook** / **View Webhooks**).
4. Click **New Webhook**:
   - **Name**: Customize the bot's name (e.g., `🔥 Hot Leads Bot` or `🚀 Outreach Bot`).
   - **Channel**: Ensure the correct channel is selected (e.g. `hot-replies`).
5. Click the blue **Copy Webhook URL** button.
6. Click **Save Changes** at the bottom.

---

## 📋 Step 4: Where to Paste Your Webhook URLs

Open your campaign's Google Sheet and go to the **`Settings`** tab:

```
 ┌──────────────────────────────┬────────────────────────────────────────────────────────┐
 │ Key                          │ Value (Paste Your Discord Webhook URL Here)            │
 ├──────────────────────────────┼────────────────────────────────────────────────────────┤
 │ discord_updates_webhook      │ https://discord.com/api/webhooks/123456/abcdef...      │
 │ discord_positive_webhook     │ https://discord.com/api/webhooks/123456/xyz123...      │
 │ discord_rereply_webhook      │ https://discord.com/api/webhooks/123456/rereply...    │
 │ discord_gcc_radar_webhook    │ https://discord.com/api/webhooks/123456/radar...      │
 └──────────────────────────────┴────────────────────────────────────────────────────────┘
```

> 💡 **Tip:** If you only want one channel for all notifications, you can paste the **same webhook URL** into all Discord webhook rows!

---

## 🔕 How to Mute or Toggle Alerts
In your Google Sheet **`Settings`** tab:
- Set `discord_alerts_enabled = FALSE` to mute all general outreach and digest alerts.
- Set `discord_domain_alerts_enabled = FALSE` to mute DNS health alerts.
- Set `gcc_radar_enabled = TRUE` to activate daily GCC leadership tracking alerts.

---

## 📡 Multi-Repository Telemetry & Enhanced Observability

The outreach engine includes built-in observability features designed for multi-campaign and multi-client setups:

### 1. 🏷️ Automatic Repository Tagging (`**[owner/repo]**`)
Every alert sent to Discord is automatically prefixed with `**[owner/repo]**` (e.g. `**[itsrohanpatel/Sheet-bot]**`) and labeled in embed footers. If you manage 5 different campaign repositories streaming into a single `#outreach-updates` channel, you can immediately identify which client or campaign triggered the alert.

### 2. 🔗 One-Click Deep Run Links
When executing inside GitHub Actions, notifications automatically append a direct link to the running workflow:
```
🔗 [View Run](https://github.com/owner/repo/actions/runs/123456789)
```
Clicking this link opens the live execution logs in your browser instantly.

### 3. 🚀 Pre-Flight Queue Telemetry
When a cold outreach run begins, you'll see how many active mailboxes are online and the exact number of unsent leads queued for delivery:
```text
**[client-corp/campaign-saas]** 🚀 **Auto cold outreach started**
📬 **Inboxes:** 5 active | 📨 **Leads queued:** 142
🔗 [View Run](https://github.com/client-corp/campaign-saas/actions/runs/987654321)
```

### 4. 🏁 Granular Completion Summaries
Upon finishing, the engine calculates the exact duration and reports a breakdown of emails sent (or drafts created in `review` mode) per mailbox:
```text
**[client-corp/campaign-saas]** 🏁 **Cold outreach run completed**
📦 **Repo:** `client-corp/campaign-saas`
📨 **Sent:** 85 | ⏱️ **Duration:** 4m 18s | 📬 **Inboxes used:** 5/5
📬 **Inbox breakdown:**
• `inbox1@clientdomain.com`: 17 sent
• `inbox2@clientdomain.com`: 17 sent
• `inbox3@clientdomain.com`: 17 sent
• `inbox4@clientdomain.com`: 17 sent
• `inbox5@clientdomain.com`: 17 sent
🔗 [View Run](https://github.com/client-corp/campaign-saas/actions/runs/987654321)
```

### 5. 💡 Contextual & Actionable Error Alerts
If a task encounters an issue, the bot delivers actionable troubleshooting hints instead of cryptic errors:
* **Google App Password Expiration:** Displays direct link to `https://myaccount.google.com/apppasswords` and step-by-step resolution.
* **Google Sheets Issues:** Flags missing tabs or service account permission requirements.
* **Payload Safety:** Inbox breakdowns are safely truncated at 15 inboxes and message lengths are capped at 2,000 characters to prevent Discord webhook rejections.


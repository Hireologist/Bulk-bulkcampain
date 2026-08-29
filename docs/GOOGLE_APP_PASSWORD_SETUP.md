# 🔐 Google Account Password & App Password Setup & Recovery Guide

> **Essential Deliverability Guide**: How to configure Google App Passwords for Sheet-bot and what to do when your Google Account password changes.

---

## ⚡ Quick Summary: Did you recently change your Google Password?

If you changed your Google Account password, **Google automatically and immediately revokes all existing App Passwords** for security reasons.

When this happens:
1. Sheet-bot cannot connect to SMTP (`smtp.gmail.com:465`) or IMAP (`imap.gmail.com:993`).
2. Google responds with `535-5.7.8 Username and Password not accepted` or `EAUTH` failure.
3. **Sheet-bot immediately halts the workflow** to protect your mailbox reputation and sends an actionable alert to your Discord channel and GitHub Action summary.

Follow the **60-Second Fix** below to restore outreach.

---

## 🛠️ The 60-Second Fix (Step-by-Step)

### Step 1: Generate a New Google App Password
1. Sign in to the Google / Gmail account used by your inbox.
2. Go directly to **[Google App Passwords](https://myaccount.google.com/apppasswords)**.
   *(Or navigate: **Google Account** → **Security** → **2-Step Verification** → scroll down to **App Passwords**).*
3. Under **App name**, enter a name like `Sheet-bot` (or `Mail`).
4. Click **Create**.
5. Google will display a **16-character yellow popup password** (e.g. `abcd efgh ijkl mnop`).
6. **Copy this 16-character code**.

> [!IMPORTANT]
> Do NOT use your regular Google login password. Google strictly requires a 16-character **App Password** for third-party SMTP/IMAP applications.
> If you don't see "App Passwords", ensure **2-Step Verification** is turned ON for your Google account.

---

### Step 2: Update Your Google Sheet
1. Open your master **Google Sheet**.
2. Navigate to the **`Inboxes`** tab at the bottom.
3. Locate the row corresponding to your email address.
4. Paste the new 16-character password into the **`smtp_pass`** column.
   *(Spaces are automatically trimmed by Sheet-bot, but it is best practice to paste cleanly).*
5. Ensure **`is_active`** is set to `TRUE`.

| email | smtp_host | smtp_port | smtp_user | smtp_pass | imap_host | imap_port | is_active |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `alex@gmail.com` | `smtp.gmail.com` | `465` | `alex@gmail.com` | `abcdefghijklmnop` | `imap.gmail.com` | `993` | `TRUE` |

---

### Step 3: Run Pre-Flight Diagnostic to Verify
1. In your GitHub repository, click the **Actions** tab.
2. Select **`🩺 Campaign Health & Pre-Flight Diagnostic`** on the left.
3. Click **Run workflow** → **Run workflow**.
4. The diagnostic suite will perform a safe, non-destructive handshake with SMTP and IMAP without sending any emails.
5. Look for: `✅ [PASS] SMTP handshake verified for: "alex@gmail.com"`.

Once verified, all scheduled crons (`outreach`, `followup`, `inbox`, `warmup`) will resume normal operation.

---

## 🛡️ How Sheet-bot Protects You on Auth Failures

Sheet-bot includes automatic fail-safes:

1. **Immediate Workflow Termination:**
   If an inbox encounters an authentication error during outreach or follow-ups, the engine immediately terminates the run rather than continuing to fail repeatedly, preventing spam flags or IP throttling from Google.
2. **Discord Alert Notification:**
   Sends an alert embed with the exact inbox address, root cause, and direct links to generate a new password.
3. **GitHub Step Summary:**
   Writes an actionable Markdown summary directly into the GitHub Actions run page.
4. **Dead-Letter Logging:**
   Records the exact failure timestamp and error reason in the **`Failed_Sends`** tab.

---

## ❓ Frequently Asked Questions & Troubleshooting

### Why did my App Password stop working?
- You changed your main Google Account password.
- You turned off and re-enabled 2-Step Verification.
- You clicked "Revoke All" in Google Account Security.
- Google detected unusual login location and requested re-authentication.

### What if I use Google Workspace (custom domain on Google)?
1. Ensure your Google Workspace Super Admin has enabled **"Allow users to turn on 2-Step Verification"** and **"Allow Less Secure Apps or App Passwords"**.
2. In Google Admin Console: **Security** → **Authentication** → **2-Step Verification** → Check "Allow users to trust their devices".

### How should ports be configured for Gmail / Google Workspace?
- **SMTP**: Host `smtp.gmail.com`, Port `465` (SSL) or `587` (TLS).
- **IMAP**: Host `imap.gmail.com`, Port `993` (SSL).

---

## 📚 Related Documentation
- [10-Minute Setup Guide](../SETUP_10MIN.md)
- [Cron Automation Setup](../CRON_SETUP.md)
- [Architecture & Reliability](../docs/ARCHITECTURE.md)

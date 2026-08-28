# Security Policy & Key Rotation Runbook

## Security Model

Sheet-bot executes automated email outreach and accesses Google Sheets via service accounts. Protecting API credentials and inbox passwords is critical.

---

## 1. Scoping Google Cloud Credentials

Always follow the principle of least privilege:
* **Never grant project-wide Owner or Editor roles** to the service account.
* Create a dedicated Google Cloud Service Account with no default IAM roles.
* Share **only the specific spreadsheet** with the service account email (e.g. `service-account@project.iam.gserviceaccount.com`) as an **Editor**.

---

## 2. Key Rotation Procedure

To rotate credentials without downtime:

### Google Service Account Key:
1. Go to **Google Cloud Console** -> **IAM & Admin** -> **Service Accounts**.
2. Select your service account -> **Keys** tab -> **Add Key** -> **Create new key** (JSON).
3. Open GitHub Repository -> **Settings** -> **Secrets and variables** -> **Actions**.
4. Update `GOOGLE_PRIVATE_KEY` and `GOOGLE_SERVICE_ACCOUNT_EMAIL` with the new values.
5. Trigger a manual workflow test to verify connectivity.
6. Delete the old key from the Google Cloud Console.

### SMTP & Mailbox Passwords:
1. Generate a new App Password in your email provider (Google Workspace, Microsoft 365, or Zoho).
2. Update the `app_password` / `password` column in your private Google Sheet `Inboxes` tab.
3. Revoke the old app password in your provider console.

---

## 3. Automated Secret Scanning

This repository includes Gitleaks scanning in the `.github/workflows/ci.yml` pipeline. Any attempt to commit raw private keys, API tokens, or plaintext passwords will block CI runs.

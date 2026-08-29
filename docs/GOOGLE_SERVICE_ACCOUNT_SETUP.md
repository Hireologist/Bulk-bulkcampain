# 🔑 How to Generate `GOOGLE_SERVICE_ACCOUNT_JSON`

A Google Cloud Service Account allows the engine to securely read, write, format, and synchronize your Google Sheets automatically in the background.

Generating this JSON key is **100% free** and takes **under 60 seconds**.

---

## ⚡ Step-by-Step Walkthrough (60 Seconds)

### Step 1: Open Google Cloud Console
1. Go to **[Google Cloud Console](https://console.cloud.google.com/)**.
2. Log in with your Google account.
3. At the top left, click the project dropdown and click **NEW PROJECT**:
   - Project Name: `Sheet-Bot-Outreach` (or any name you like).
   - Click **CREATE**.

---

### Step 2: Enable the Google Sheets & Google Drive APIs
1. In the top search bar, type **Google Sheets API** and click on it.
2. Click **ENABLE** 🔵.
3. In the search bar, type **Google Drive API** and click on it.
4. Click **ENABLE** 🔵.

---

### Step 3: Create a Service Account
1. Open the left navigation menu ☰ > **APIs & Services** > **Credentials**.
2. Click **+ CREATE CREDENTIALS** at the top > select **Service account**.
3. Fill in the details:
   - **Service account name**: `sheet-bot`
   - **Service account ID**: (auto-filled, e.g. `sheet-bot@...`)
4. Click **CREATE AND CONTINUE** > click **DONE** (no extra roles needed).

---

### Step 4: Generate & Download the JSON Key
1. In the **Credentials** page, look at the **Service Accounts** section at the bottom.
2. Click on the email address of the service account you just created (e.g. `sheet-bot@sheet-bot-outreach.iam.gserviceaccount.com`).
3. Click the **Keys** tab at the top.
4. Click **ADD KEY** > **Create new key**.
5. Select **JSON** (recommended) and click **CREATE**.
6. A `.json` file will automatically download to your computer.

---

### Step 5: Share Your Google Sheet with the Service Account
1. Open the downloaded `.json` file in Notepad or VS Code.
2. Find and copy the `"client_email"` value (e.g. `sheet-bot@sheet-bot-outreach.iam.gserviceaccount.com`).
3. Open your Google Sheet (from [sheets.new](https://sheets.new)).
4. Click the green **Share** button at the top right.
5. Paste the `client_email` address, ensure permission is set to **Editor**, uncheck "Notify people", and click **Share** / **Save**.

---

### Step 6: Add to GitHub Repository Secrets
1. Go to your GitHub repository: `https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>`.
2. Go to **Settings** ⚙️ > **Secrets and variables** > **Actions** > click **New repository secret**.
3. Name: `GOOGLE_SERVICE_ACCOUNT_JSON`
4. Secret: Paste the **entire raw content** of the downloaded `.json` file (including `{`, `"type": "service_account"`, etc.).
5. Click **Add secret**.

> 🛡️ **Security Note:** Never commit your JSON key file to Git! The project's `.gitignore` automatically prevents `.json` keys from being committed.

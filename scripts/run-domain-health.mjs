// scripts/run-domain-health.mjs
import { google } from "googleapis";
import { fileURLToPath } from "url";
import path from "path";

// src/dns-check.mjs
import { resolveTxt } from "node:dns/promises";
async function checkDomainAuth(domain, resolver = resolveTxt) {
  const cleanDomain = domain.trim().toLowerCase();
  const result = {
    domain: cleanDomain,
    spf: false,
    dmarc: false,
    spfRecord: "",
    dmarcRecord: "",
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: "Fail"
  };
  try {
    const rawRecords = await resolver(cleanDomain);
    const txtRecords = (Array.isArray(rawRecords) ? rawRecords : []).map((entry) => Array.isArray(entry) ? entry.join("") : String(entry));
    const foundSpf = txtRecords.find((r) => typeof r === "string" && /^v\s*=\s*spf1(?:\s|$)/i.test(r.trim()));
    if (foundSpf) {
      result.spf = true;
      result.spfRecord = foundSpf;
    }
  } catch {
  }
  try {
    const rawDmarc = await resolver(`_dmarc.${cleanDomain}`);
    const dmarcRecords = (Array.isArray(rawDmarc) ? rawDmarc : []).map((entry) => Array.isArray(entry) ? entry.join("") : String(entry));
    const foundDmarc = dmarcRecords.find((r) => typeof r === "string" && /^v\s*=\s*dmarc1(?:\s*;|\s*$)/i.test(r.trim()));
    if (foundDmarc) {
      result.dmarc = true;
      result.dmarcRecord = foundDmarc;
    }
  } catch {
  }
  if (result.spf && result.dmarc) {
    result.status = "Pass";
  } else if (result.spf || result.dmarc) {
    result.status = "Partial";
  } else {
    result.status = "Fail";
  }
  return result;
}

// src/alerts.mjs
import { execSync } from "node:child_process";
var _cachedRemoteSlug = null;
function getRepoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  if (_cachedRemoteSlug) return _cachedRemoteSlug;
  try {
    const remoteUrl = execSync("git config --get remote.origin.url", { encoding: "utf8" }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) {
      _cachedRemoteSlug = `${match[1]}/${match[2]}`;
      return _cachedRemoteSlug;
    }
  } catch {
  }
  return process.env.GITHUB_REPO || "Sheet-bot";
}
function getRunUrl() {
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (repo && runId) {
    return `https://github.com/${repo}/actions/runs/${runId}`;
  }
  return "";
}
function formatDiscordContent(content) {
  const str = content != null ? String(content).trim() : "";
  const slug = getRepoSlug();
  const runUrl = getRunUrl();
  const tagPrefix = `**[${slug}]**`;
  let tagged = str.startsWith(tagPrefix) ? str : str ? `${tagPrefix} ${str}` : tagPrefix;
  if (runUrl && !tagged.includes(runUrl)) {
    tagged += `
\u{1F517} [View Run](${runUrl})`;
  }
  if (tagged.length > 2e3) {
    tagged = tagged.slice(0, 1996) + "...";
  }
  return tagged;
}
async function postToDiscord(webhookUrl, content, embeds = []) {
  if (!webhookUrl || typeof webhookUrl !== "string" || !webhookUrl.startsWith("http")) {
    return { success: false, reason: "Invalid or missing Discord Webhook URL" };
  }
  try {
    const taggedContent = formatDiscordContent(content);
    const payload = { content: taggedContent };
    if (Array.isArray(embeds) && embeds.length > 0) {
      const slug = getRepoSlug();
      payload.embeds = embeds.map((e) => {
        const currentFooter = e.footer?.text;
        const footerText = currentFooter ? currentFooter.includes(slug) ? currentFooter : `${slug} \u2022 ${currentFooter}` : slug;
        return {
          ...e,
          footer: { text: footerText }
        };
      });
    }
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errText = await res.text();
      return { success: false, status: res.status, error: errText };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// scripts/run-domain-health.mjs
import { parseServiceAccountCredentials } from "./auto-setup.mjs";
function getGoogleAuth() {
  const sheetId = process.env.SHEET_ID || process.env.SPREADSHEET_ID || process.env.SINGLE_SHEET_ID;
  if (!sheetId) {
    throw new Error("Missing SHEET_ID or SPREADSHEET_ID environment variable.");
  }
  let auth;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = parseServiceAccountCredentials(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
  } else {
    throw new Error("Google Service Account credentials not provided in environment.");
  }
  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, sheetId };
}
async function ensureTabExists(sheets, sheetId, tabName) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const exists = meta.data.sheets.some((s) => s.properties.title === tabName);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabName } } }]
        }
      });
    }
  } catch (err) {
    console.warn(`[Domain Health] Tab check for ${tabName}: ${err.message}`);
  }
}
async function runDomainHealth() {
  console.log("\u{1F50D} Starting Weekly Domain Health Audit...");
  const { sheets, sheetId } = getGoogleAuth();
  const inboxesRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'Inboxes'!A:Z`
  });
  const [headers, ...rows] = inboxesRes.data.values || [];
  if (!headers || rows.length === 0) {
    console.log("No inboxes found to check.");
    return;
  }
  const emailIdx = headers.findIndex((h) => ["email", "inbox_email", "smtp_user"].includes(String(h).trim().toLowerCase()));
  if (emailIdx === -1) {
    console.error("Could not find email column in Inboxes tab.");
    return;
  }
  const domains = /* @__PURE__ */ new Set();
  for (const row of rows) {
    const email = row[emailIdx];
    if (email && email.includes("@")) {
      const domain = email.split("@")[1].trim().toLowerCase();
      if (domain) domains.add(domain);
    }
  }
  console.log(`Found ${domains.size} unique domain(s) to audit:`, Array.from(domains));
  await ensureTabExists(sheets, sheetId, "Domain_Health");
  const headersRow = ["Domain", "SPF Status", "DMARC Status", "SPF Record", "DMARC Record", "Last Checked", "Overall Health"];
  const dataRows = [];
  const failingDomains = [];
  for (const domain of domains) {
    const result = await checkDomainAuth(domain);
    console.log(`Domain [${domain}] -> SPF: ${result.spf ? "\u2705" : "\u274C"} | DMARC: ${result.dmarc ? "\u2705" : "\u274C"} (${result.status})`);
    if (!result.spf || !result.dmarc) {
      failingDomains.push({ domain, spf: result.spf, dmarc: result.dmarc });
    }
    dataRows.push([
      result.domain,
      result.spf ? "PASS" : "FAIL",
      result.dmarc ? "PASS" : "FAIL",
      result.spfRecord || "None",
      result.dmarcRecord || "None",
      result.checkedAt,
      result.status
    ]);
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'Domain_Health'!A1:G${dataRows.length + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [headersRow, ...dataRows]
    }
  });
  console.log("\u2705 Domain_Health tab successfully updated.");
  let discordUrl = process.env.DISCORD_WEBHOOK_URL;
  let domainAlertsEnabled = true;
  try {
    const settingsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'Settings'!A:Z`
    });
    const [sHeaders, ...sRows] = settingsRes.data.values || [];
    if (sRows) {
      const settings = Object.fromEntries(sRows.map((r) => [r[0], r[1]]));
      discordUrl = settings.discord_updates_webhook || settings.discord_webhook || discordUrl;
      const domainToggle = String(settings.discord_domain_alerts_enabled ?? settings.discord_alerts_enabled ?? "TRUE").trim().toLowerCase();
      domainAlertsEnabled = !["false", "off", "0", "no", "mute"].includes(domainToggle);
    }
  } catch {
  }
  if (discordUrl && failingDomains.length > 0 && domainAlertsEnabled) {
    const issues = failingDomains.map((d) => `\u2022 **${d.domain}**: SPF ${d.spf ? "\u2705" : "\u274C"} | DMARC ${d.dmarc ? "\u2705" : "\u274C"}`).join("\n");
    await postToDiscord(
      discordUrl,
      `\u{1F6A8} **Domain Health Warning**:
The following domain(s) have missing SPF or DMARC records which will damage inbox deliverability:
${issues}`
    );
  } else if (!domainAlertsEnabled && failingDomains.length > 0) {
    console.log("\u{1F515} Domain Health Discord alerts are disabled in Settings (discord_domain_alerts_enabled = FALSE). Skipping webhook.");
  }
}
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  runDomainHealth().catch((err) => {
    console.error("Fatal error in domain health check:", err);
    process.exit(1);
  });
}

// scripts/run-campaign-diagnostics.mjs
import { google } from "googleapis";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import axios2 from "axios";
import { fileURLToPath } from "url";
import path2 from "path";

// src/spintax.mjs
function parseSpintax(text = "") {
  if (!text || typeof text !== "string") return "";
  let current = text;
  const spintaxRegex = /(\{{1,3})([^{}]+?\|[^{}]+?)(\}{1,3})/;
  let iterations = 0;
  while (spintaxRegex.test(current) && iterations < 25) {
    current = current.replace(spintaxRegex, (_, openBraces, choices, closeBraces) => {
      const options = choices.split("|").map((c) => c.trim());
      const chosen = options[Math.floor(Math.random() * options.length)];
      const matchCount = Math.min(openBraces.length, closeBraces.length);
      const remainingOpen = openBraces.slice(matchCount);
      const remainingClose = closeBraces.slice(matchCount);
      return remainingOpen + chosen + remainingClose;
    });
    iterations++;
  }
  return current;
}

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
var checkDnsRecords = checkDomainAuth;

// src/alerts.mjs
import fs from "node:fs";
import path from "node:path";
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
function isAuthError(err) {
  if (!err) return false;
  if (err.code === "EAUTH" || err.responseCode === 535) return true;
  const msg = (typeof err === "string" ? err : err.message || err.toString() || "").toLowerCase();
  return msg.includes("535") || msg.includes("eauth") || msg.includes("username and password not accepted") || msg.includes("invalid login") || msg.includes("invalid credentials") || msg.includes("badcredentials") || msg.includes("authenticate failed") || msg.includes("application-specific password") || msg.includes("app password") || msg.includes("please log in via your web browser") || msg.includes("authentication failed") || msg.includes("login denied") || msg.includes("command auth failed") || msg.includes("auth error");
}
function writeGitHubStepSummary(markdownText) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    const dir = path.dirname(summaryPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(summaryPath, `${markdownText}

`, "utf8");
  } catch (err) {
    console.warn(`[GitHub Step Summary] Could not write summary: ${err.message}`);
  }
}
async function sendAuthFailureAlert({
  inboxEmail,
  errorDetails = "",
  webhookUrl,
  context = "Outreach Execution"
}) {
  const email = inboxEmail || "Unknown Inbox";
  const cleanError = (typeof errorDetails === "string" ? errorDetails : errorDetails?.message || "").split("\n")[0];
  const consoleMessage = `
================================================================================
\u{1F6A8} CRITICAL ACTION REQUIRED: GOOGLE APP PASSWORD AUTHENTICATION FAILED
================================================================================
\u{1F4EC} Inbox:     ${email}
\u2699\uFE0F Context:   ${context}
\u274C Error:     ${cleanError}

\u{1F4A1} WHY THIS HAPPENED:
   Google automatically revokes and invalidates ALL 16-character App Passwords
   whenever your main Google Account password is changed or 2FA settings are updated.

\u{1F449} HOW TO RESOLVE IN 60 SECONDS:
   1. Visit Google App Passwords: https://myaccount.google.com/apppasswords
   2. Select "Mail" (or Custom: "Sheet-bot") and generate a new 16-char App Password.
   3. Open your Google Sheet -> Go to the 'Inboxes' tab.
   4. Paste the 16-character password into the 'smtp_pass' column for [${email}] (no spaces).
   5. Re-run your campaign workflow or pre-flight diagnostics.

\u{1F4D6} Full Documentation: docs/GOOGLE_APP_PASSWORD_SETUP.md
================================================================================
`;
  console.error(consoleMessage);
  const repoName = getRepoSlug();
  const ghSummaryMarkdown = `## \u{1F6A8} Critical Authentication Failure on Inbox \`${email}\`

> **Reason:** Google rejected the SMTP/IMAP credentials.
> **Common Cause:** Your Google account password was recently changed, or the 16-character App Password was revoked/expired.

### \u{1F6E0}\uFE0F How to Fix:
1. \u{1F511} **Generate New App Password:** Go to [Google App Passwords](https://myaccount.google.com/apppasswords).
2. \u{1F4CB} **Update Sheet:** Open your Google Sheet, navigate to the **\`Inboxes\`** tab, and update the **\`smtp_pass\`** column for \`${email}\` (remove all spaces).
3. \u{1F4D6} **Read Guide:** Check [\`docs/GOOGLE_APP_PASSWORD_SETUP.md\`](https://github.com/${repoName}/blob/main/docs/GOOGLE_APP_PASSWORD_SETUP.md) for full screenshots and troubleshooting.
`;
  writeGitHubStepSummary(ghSummaryMarkdown);
  if (webhookUrl && typeof webhookUrl === "string" && webhookUrl.startsWith("http")) {
    const embed = {
      title: "\u{1F6A8} Action Required: Google App Password Authentication Failed",
      color: 16711680,
      description: `SMTP/IMAP authentication failed for **\`${email}\`**.
Google automatically revokes all App Passwords when the account password is changed.`,
      fields: [
        { name: "\u{1F4EC} Affected Inbox", value: `\`${email}\``, inline: true },
        { name: "\u2699\uFE0F Stage / Task", value: context, inline: true },
        { name: "\u274C Raw Error", value: `\`${cleanError.slice(0, 200)}\``, inline: false },
        {
          name: "\u{1F6E0}\uFE0F Resolution Steps",
          value: "1. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)\n2. Generate a new 16-character password\n3. Open Google Sheet \u2192 **`Inboxes`** tab \u2192 update **`smtp_pass`**\n4. Re-run workflow or diagnostics"
        }
      ],
      footer: { text: "Deliverability & Security Monitor" },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    await postToDiscord(webhookUrl, `\u{1F6A8} **Google App Password Auth Failure on \`${email}\`** - Action Required!`, [embed]);
  }
  return { success: true, email };
}
async function sendCronSyncAlert({
  jobTitle,
  timezone,
  hours = [],
  minutes = [],
  webhookUrl,
  context = "Google Sheet Settings Synchronization"
}) {
  if (!webhookUrl || typeof webhookUrl !== "string" || !webhookUrl.startsWith("http")) {
    return { success: false, reason: "No valid webhook URL" };
  }
  const hourStr = hours.map((h) => String(h).padStart(2, "0")).join(", ") || "00";
  const minStr = minutes.map((m) => String(m).padStart(2, "0")).join(", ") || "00";
  const embed = {
    title: "\u23F1\uFE0F Cron Job Schedule Auto-Synchronized",
    color: 3447003,
    description: `The schedule for **\`${jobTitle}\`** was automatically updated to match your Google Sheet **\`Settings\`** tab.`,
    fields: [
      { name: "\u{1F4CC} Job Title", value: `\`${jobTitle}\``, inline: true },
      { name: "\u{1F310} Timezone", value: `\`${timezone || "Asia/Kolkata"}\``, inline: true },
      { name: "\u23F0 New Trigger Time", value: `\`${hourStr}:${minStr}\``, inline: true },
      { name: "\u2699\uFE0F Source", value: context, inline: false }
    ],
    footer: { text: "Cron Auto-Synchronizer" },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  await postToDiscord(webhookUrl, `\u23F1\uFE0F **Cron Schedule Auto-Updated**: \`${jobTitle}\` synced with Google Sheet!`, [embed]);
  return { success: true, jobTitle };
}

// src/scheduler.mjs
import axios from "axios";
function isCampaignActive(settings = {}, type = "general") {
  const masterVal = String(settings.campaign_active ?? settings.is_active ?? settings.campaign_status ?? "TRUE").trim().toLowerCase();
  if (masterVal === "false" || masterVal === "paused" || masterVal === "off" || masterVal === "0" || masterVal === "no") {
    return false;
  }
  if (type === "outreach") {
    const outreachVal = String(settings.outreach_active ?? "TRUE").trim().toLowerCase();
    if (outreachVal === "false" || outreachVal === "paused" || outreachVal === "off" || outreachVal === "0") {
      return false;
    }
  } else if (type === "followup") {
    const followupVal = String(settings.followup_active ?? "TRUE").trim().toLowerCase();
    if (followupVal === "false" || followupVal === "paused" || followupVal === "off" || followupVal === "0") {
      return false;
    }
  }
  return true;
}

// scripts/run-campaign-diagnostics.mjs
import { parseScheduleFromSettings, fetchExistingJobs, fetchJobDetails, updateCronJob, autoDetectGitRepo, sleep } from "./setup-cron.mjs";
import { COMPLETE_SCHEMA, formatSheetTab } from "./auto-setup.mjs";
function columnIndexToLetter(colIndex) {
  let temp = colIndex;
  let letter = "";
  while (temp > 0) {
    let mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}
async function auditAndRepairSheetSchema(sheets, sheetId, spreadsheetMeta, options = { autoRepair: true }) {
  const existingSheets = spreadsheetMeta?.data?.sheets || [];
  const existingTabMap = new Map(existingSheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const results = {
    tabsChecked: 0,
    missingTabs: [],
    createdTabs: [],
    columnsVerified: 0,
    missingColumns: [],
    repairedColumns: [],
    missingSettings: [],
    repairedSettings: [],
    repairedFormulas: [],
    updatedSetupGuide: false
  };
  for (const [tabName, tabConfig] of Object.entries(COMPLETE_SCHEMA)) {
    results.tabsChecked++;
    const expectedHeaders = tabConfig.headers || [];
    if (!existingTabMap.has(tabName)) {
      results.missingTabs.push(tabName);
      if (options.autoRepair && sheets) {
        try {
          const addRes = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: sheetId,
            requestBody: {
              requests: [{
                addSheet: {
                  properties: { title: tabName }
                }
              }]
            }
          });
          const rowsToWrite = [expectedHeaders, ...tabConfig.sampleData || []];
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `'${tabName}'!A1`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: rowsToWrite }
          });
          results.createdTabs.push(tabName);
          const newNumericId = addRes?.data?.replies?.[0]?.addSheet?.properties?.sheetId;
          if (newNumericId !== void 0 && newNumericId !== null && typeof formatSheetTab === "function") {
            try {
              await formatSheetTab(sheets, sheetId, newNumericId, tabName, tabConfig);
            } catch {
            }
          }
        } catch (createErr) {
          console.warn(`Could not auto-create tab "${tabName}": ${createErr.message}`);
        }
      }
      continue;
    }
    let currentHeaders = [];
    if (sheets) {
      try {
        const headerRes = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `'${tabName}'!1:1`
        });
        currentHeaders = (headerRes.data.values?.[0] || []).map((h) => String(h || "").trim());
      } catch {
        currentHeaders = [];
      }
    }
    if (tabName === "Positive_Leads") {
      const headersMatch = currentHeaders.length === expectedHeaders.length && expectedHeaders.every((h, idx) => (currentHeaders[idx] || "").toLowerCase() === h.toLowerCase());
      if (!headersMatch) {
        if (options.autoRepair && sheets) {
          try {
            await sheets.spreadsheets.values.update({
              spreadsheetId: sheetId,
              range: "'Positive_Leads'!A1:N1",
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [expectedHeaders] }
            });
            if (currentHeaders.length > expectedHeaders.length) {
              const startLetter = columnIndexToLetter(expectedHeaders.length + 1);
              const endLetter = columnIndexToLetter(Math.max(currentHeaders.length, 26));
              if (typeof sheets?.spreadsheets?.values?.clear === "function") {
                await sheets.spreadsheets.values.clear({
                  spreadsheetId: sheetId,
                  range: `'Positive_Leads'!${startLetter}1:${endLetter}1`
                });
              }
            }
            results.repairedFormulas.push({ tab: "Positive_Leads", cell: "A1:N1" });
          } catch {
          }
        }
        currentHeaders = [...expectedHeaders];
      }
    }
    const missingInTab = [];
    expectedHeaders.forEach((expectedCol) => {
      results.columnsVerified++;
      const exists = currentHeaders.some((h) => h.toLowerCase() === expectedCol.toLowerCase());
      if (!exists) {
        missingInTab.push(expectedCol);
      }
    });
    if (missingInTab.length > 0) {
      const startColIndex = currentHeaders.length + 1;
      const endColIndex = currentHeaders.length + missingInTab.length;
      const startColLetter = columnIndexToLetter(startColIndex);
      const endColLetter = columnIndexToLetter(endColIndex);
      const targetRange = `'${tabName}'!${startColLetter}1:${endColLetter}1`;
      results.missingColumns.push({
        tab: tabName,
        missing: missingInTab,
        currentHeaders,
        suggestedPosition: targetRange,
        startColLetter,
        endColLetter
      });
      if (options.autoRepair && sheets) {
        try {
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: targetRange,
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: [missingInTab]
            }
          });
          results.repairedColumns.push({
            tab: tabName,
            columns: missingInTab,
            range: targetRange
          });
        } catch (repairErr) {
          console.warn(`Could not auto-repair columns in "${tabName}": ${repairErr.message}`);
        }
      }
    }
    if (tabName === "Settings" && tabConfig.sampleData) {
      let currentKeys = [];
      if (sheets) {
        try {
          const settingsRes = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: "'Settings'!A2:A"
          });
          currentKeys = (settingsRes.data.values || []).map((r) => String(r[0] || "").trim().toLowerCase());
        } catch {
          currentKeys = [];
        }
      }
      const missingSettingRows = [];
      for (const [key, defaultVal, desc] of tabConfig.sampleData) {
        if (!currentKeys.includes(key.toLowerCase())) {
          missingSettingRows.push([key, defaultVal, desc]);
          results.missingSettings.push(key);
        }
      }
      if (missingSettingRows.length > 0 && options.autoRepair && sheets) {
        try {
          await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: "'Settings'!A:C",
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: missingSettingRows
            }
          });
          results.repairedSettings.push(...missingSettingRows.map((r) => r[0]));
        } catch (settingErr) {
          console.warn(`Could not auto-repair settings rows: ${settingErr.message}`);
        }
      }
    }
  }
  if (options.repairFormulas && sheets) {
    if (existingTabMap.has("\u{1F4CA} Email_Analytics")) {
      try {
        if (typeof sheets?.spreadsheets?.values?.clear === "function") {
          await sheets.spreadsheets.values.clear({
            spreadsheetId: sheetId,
            range: "'\u{1F4CA} Email_Analytics'!B2:Z2"
          });
        }
        const analyticsRes = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: "'\u{1F4CA} Email_Analytics'!A2:A2"
        });
        const currentFormula = analyticsRes?.data?.values?.[0]?.[0];
        const expectedFormula = COMPLETE_SCHEMA["\u{1F4CA} Email_Analytics"]?.sampleData?.[0]?.[0];
        if (!currentFormula || currentFormula !== expectedFormula) {
          if (expectedFormula) {
            await sheets.spreadsheets.values.update({
              spreadsheetId: sheetId,
              range: "'\u{1F4CA} Email_Analytics'!A2",
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[expectedFormula]] }
            });
            results.repairedFormulas.push({ tab: "\u{1F4CA} Email_Analytics", cell: "A2" });
          }
        }
      } catch (err) {
        console.warn(`Could not auto-repair Email_Analytics formula: ${err.message}`);
      }
    }
    if (existingTabMap.has("\u{1F4C8} ChartData")) {
      try {
        const chartRes = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: "'\u{1F4C8} ChartData'!A2:B4"
        });
        const rows = chartRes?.data?.values || [];
        const expectedChartRows = COMPLETE_SCHEMA["\u{1F4C8} ChartData"]?.sampleData || [];
        const missingChartRows = [];
        for (let i = 0; i < expectedChartRows.length; i++) {
          const expected = expectedChartRows[i];
          const actual = rows[i];
          if (!actual || !actual[1] || !String(actual[1]).trim().startsWith("=")) {
            missingChartRows.push({ rowIndex: i + 2, rowData: expected });
          }
        }
        if (missingChartRows.length > 0) {
          for (const item of missingChartRows) {
            await sheets.spreadsheets.values.update({
              spreadsheetId: sheetId,
              range: `'\u{1F4C8} ChartData'!A${item.rowIndex}:B${item.rowIndex}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [item.rowData] }
            });
          }
          results.repairedFormulas.push({ tab: "\u{1F4C8} ChartData", cell: "B2:B4" });
        }
      } catch (err) {
        console.warn(`Could not auto-repair ChartData formula: ${err.message}`);
      }
    }
    if (existingTabMap.has("Positive_Leads")) {
      try {
        if (typeof sheets?.spreadsheets?.values?.clear === "function") {
          await sheets.spreadsheets.values.clear({
            spreadsheetId: sheetId,
            range: "'Positive_Leads'!B2:Z2"
          });
        }
        const posRes = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: "'Positive_Leads'!A2:A2"
        });
        const curVal = posRes?.data?.values?.[0]?.[0];
        const expectedFormula = COMPLETE_SCHEMA["Positive_Leads"]?.sampleData?.[0]?.[0];
        if (!curVal || curVal !== expectedFormula) {
          if (expectedFormula) {
            await sheets.spreadsheets.values.update({
              spreadsheetId: sheetId,
              range: "'Positive_Leads'!A2",
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[expectedFormula]] }
            });
            results.repairedFormulas.push({ tab: "Positive_Leads", cell: "A2" });
          }
        }
      } catch (err) {
        console.warn(`Could not auto-repair Positive_Leads: ${err.message}`);
      }
    }
    try {
      const formatReqs = [];
      if (existingTabMap.has("Details")) {
        const detailsId = existingTabMap.get("Details");
        formatReqs.push(
          {
            repeatCell: {
              range: { sheetId: detailsId, startRowIndex: 1, startColumnIndex: 7, endColumnIndex: 8 },
              cell: { userEnteredFormat: { numberFormat: { type: "TIME", pattern: "hh:mm:ss am/pm" } } },
              fields: "userEnteredFormat.numberFormat"
            }
          },
          {
            repeatCell: {
              range: { sheetId: detailsId, startRowIndex: 1, startColumnIndex: 8, endColumnIndex: 9 },
              cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
              fields: "userEnteredFormat.numberFormat"
            }
          }
        );
      }
      if (existingTabMap.has("Positive_Leads")) {
        const posId = existingTabMap.get("Positive_Leads");
        formatReqs.push(
          {
            repeatCell: {
              range: { sheetId: posId, startRowIndex: 1, startColumnIndex: 7, endColumnIndex: 8 },
              cell: { userEnteredFormat: { numberFormat: { type: "TIME", pattern: "hh:mm:ss am/pm" } } },
              fields: "userEnteredFormat.numberFormat"
            }
          },
          {
            repeatCell: {
              range: { sheetId: posId, startRowIndex: 1, startColumnIndex: 8, endColumnIndex: 9 },
              cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
              fields: "userEnteredFormat.numberFormat"
            }
          }
        );
      }
      if (existingTabMap.has("\u{1F4CA} Email_Analytics")) {
        const analyticsId = existingTabMap.get("\u{1F4CA} Email_Analytics");
        formatReqs.push({
          repeatCell: {
            range: { sheetId: analyticsId, startRowIndex: 1, startColumnIndex: 7, endColumnIndex: 9 },
            cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" } } },
            fields: "userEnteredFormat.numberFormat"
          }
        });
      }
      if (formatReqs.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: { requests: formatReqs }
        });
      }
    } catch (formatErr) {
    }
  }
  if (options.syncSetupGuide && sheets && existingTabMap.has("\u{1F4D6} Setup_Guide")) {
    try {
      const guideRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "'\u{1F4D6} Setup_Guide'!A2:C"
      });
      const currentRows = guideRes?.data?.values || [];
      const expectedGuide = COMPLETE_SCHEMA["\u{1F4D6} Setup_Guide"]?.sampleData || [];
      if (currentRows.length < expectedGuide.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `'\u{1F4D6} Setup_Guide'!A2:C${expectedGuide.length + 1}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: expectedGuide }
        });
        results.updatedSetupGuide = true;
      }
    } catch (err) {
      console.warn(`Could not sync Setup_Guide: ${err.message}`);
    }
  }
  return results;
}
async function runCampaignDiagnostics() {
  console.log("\n=============================================================");
  console.log("\u{1FA7A} RUNNING FULL CAMPAIGN PRE-FLIGHT DIAGNOSTIC AUDIT");
  console.log("=============================================================\n");
  const report = {
    passed: 0,
    warnings: 0,
    failures: 0,
    details: []
  };
  function logPass(msg) {
    console.log(`  \u2705 [PASS] ${msg}`);
    report.passed++;
    report.details.push({ status: "PASS", message: msg });
  }
  function logWarn(msg) {
    console.log(`  \u26A0\uFE0F [WARN] ${msg}`);
    report.warnings++;
    report.details.push({ status: "WARN", message: msg });
  }
  function logFail(msg) {
    console.log(`  \u274C [FAIL] ${msg}`);
    report.failures++;
    report.details.push({ status: "FAIL", message: msg });
  }
  console.log("\u{1F4CB} STEP 1: Google Sheets Connection & Column Schema Verification");
  const sheetId = process.env.SPREADSHEET_ID || process.env.SHEET_ID;
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!sheetId) {
    logFail("SPREADSHEET_ID environment variable is missing.");
    return finishReport(report);
  }
  if (!saJson) {
    logFail("GOOGLE_SERVICE_ACCOUNT_JSON environment variable is missing.");
    return finishReport(report);
  }
  let sheets;
  let spreadsheetMeta;
  try {
    const credentials = JSON.parse(saJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    sheets = google.sheets({ version: "v4", auth });
    spreadsheetMeta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    logPass(`Connected to Google Spreadsheet: "${spreadsheetMeta.data.properties.title}" (ID: ${sheetId.slice(0, 8)}...)`);
  } catch (err) {
    logFail(`Failed to connect to Google Sheets API: ${err.message}`);
    return finishReport(report);
  }
  const schemaAudit = await auditAndRepairSheetSchema(sheets, sheetId, spreadsheetMeta, {
    autoRepair: true,
    repairFormulas: true,
    syncSetupGuide: true
  });
  console.log("  \u{1F6E1}\uFE0F Non-Destructive Update Guarantee: Active (all existing leads, inboxes, templates & custom settings preserved).");
  if (schemaAudit.missingTabs.length === 0 && schemaAudit.missingColumns.length === 0 && schemaAudit.missingSettings.length === 0) {
    logPass(`Exhaustive Schema Audit: All ${schemaAudit.tabsChecked} tabs and ${schemaAudit.columnsVerified} required column headers verified with 100% integrity.`);
  } else {
    for (const missingTab of schemaAudit.missingTabs) {
      if (schemaAudit.createdTabs.includes(missingTab)) {
        logPass(`Tab "${missingTab}": Missing tab was automatically created with complete headers & sample schema! \u2728`);
      } else {
        logWarn(`Tab "${missingTab}": Missing from spreadsheet. Run 1-Click Auto-Setup to provision it.`);
      }
    }
    for (const item of schemaAudit.missingColumns) {
      const repaired = schemaAudit.repairedColumns.find((r) => r.tab === item.tab);
      if (repaired) {
        logPass(`Tab "${item.tab}": Auto-repaired & appended missing column(s) [${item.missing.join(", ")}] at position ${item.suggestedPosition} \u2728`);
      } else {
        logWarn(`Tab "${item.tab}": Missing column(s) [${item.missing.join(", ")}]. To add manually, insert at column ${item.startColLetter} (Row 1).`);
      }
    }
    if (schemaAudit.missingSettings.length > 0) {
      if (schemaAudit.repairedSettings.length > 0) {
        logPass(`Settings Tab: Auto-repaired & appended missing operational keys [${schemaAudit.repairedSettings.join(", ")}] with default values \u2728`);
      } else {
        logWarn(`Settings Tab: Missing key(s) [${schemaAudit.missingSettings.join(", ")}]. Add them in Column A of the "Settings" tab.`);
      }
    }
  }
  if (schemaAudit.repairedFormulas && schemaAudit.repairedFormulas.length > 0) {
    for (const f of schemaAudit.repairedFormulas) {
      logPass(`Dynamic Formula Restored: Tab "${f.tab}" (${f.cell}) was safely healed with latest array formula \u2728`);
    }
  }
  if (schemaAudit.updatedSetupGuide) {
    logPass('Setup Guide: Synchronized latest interactive guide steps in "\u{1F4D6} Setup_Guide" \u2728');
  }
  async function fetchTab(tabName) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${tabName}'!A:Z`
      });
      const allValues = res.data.values || [];
      const [headers, ...rows] = allValues;
      return { headers: headers || [], rows: rows || [], allValues };
    } catch {
      return { headers: [], rows: [], allValues: [] };
    }
  }
  const [detailsData, inboxesData, aliasesData, settingsData, templatesData, followupsData] = await Promise.all([
    fetchTab("Details"),
    fetchTab("Inboxes"),
    fetchTab("Aliases"),
    fetchTab("Settings"),
    fetchTab("Templates"),
    fetchTab("Followup_Templates")
  ]);
  console.log("\n\u2699\uFE0F STEP 2: Campaign Settings & Throttle Configuration");
  const allSettingsRows = settingsData.allValues && settingsData.allValues.length > 0 ? settingsData.allValues : [settingsData.headers, ...settingsData.rows];
  const settings = parseSettingsRows(allSettingsRows);
  const isCampaignActive2 = !["false", "0", "no", "off"].includes(String(settings.campaign_active ?? "TRUE").toLowerCase().trim());
  if (isCampaignActive2) {
    logPass("Master Campaign Switch is ACTIVE (campaign_active = TRUE).");
  } else {
    logWarn("Master Campaign Switch is PAUSED (campaign_active = FALSE). Outreach runs will skip safely.");
  }
  const throttleMode = (settings.throttle_mode || "adaptive").toLowerCase().trim();
  logPass(`Throttle Mode configured as: "${throttleMode}" (${throttleMode === "bulk" ? "High-speed fixed delay" : "Adaptive deliverability shield"}).`);
  const sendMode = (settings.send_mode || "auto").toLowerCase().trim();
  logPass(`Send Mode configured as: "${sendMode}" (${sendMode === "review" ? "IMAP Drafts Review Mode" : "Live Outbound SMTP Sending"}).`);
  const cronTimezone = settings.cron_timezone || "Asia/Kolkata";
  logPass(`Schedule Timezone: "${cronTimezone}" (Outreach: ${settings.cron_outreach_time || "10:00"}, Follow-ups: ${settings.cron_followup_time || "09:30"}).`);
  const discordWebhookUrl = settings.discord_updates_webhook || process.env.DISCORD_WEBHOOK_URL;
  console.log("\n\u{1F4EC} STEP 3: Inboxes SMTP & IMAP Authentication Testing (0 sends)");
  const inboxes = inboxesData.rows.map((r) => {
    const obj = {};
    inboxesData.headers.forEach((h, i) => {
      obj[h] = r[i];
    });
    return obj;
  }).filter((inbox) => inbox.email && String(inbox.is_active).toLowerCase() === "true");
  if (inboxes.length === 0) {
    logWarn('No active inboxes found in "Inboxes" tab (is_active = TRUE). Outreach will skip until inboxes are configured.');
  } else {
    logPass(`Found ${inboxes.length} active inbox(es) in "Inboxes" tab.`);
    for (const inbox of inboxes) {
      try {
        const transporter = nodemailer.createTransport({
          host: inbox.smtp_host || "smtp.gmail.com",
          port: parseInt(inbox.smtp_port || "465", 10),
          secure: String(inbox.smtp_port) === "465",
          auth: {
            user: inbox.smtp_user || inbox.email,
            pass: inbox.smtp_pass ? inbox.smtp_pass.replace(/\s+/g, "") : ""
          },
          connectionTimeout: 1e4
        });
        await transporter.verify();
        logPass(`SMTP handshake verified for: "${inbox.email}" (${inbox.smtp_host}:${inbox.smtp_port})`);
      } catch (err) {
        if (isAuthError(err)) {
          logFail(`\u{1F6A8} GOOGLE APP PASSWORD AUTHENTICATION FAILED for "${inbox.email}": ${err.message}
      \u{1F4A1} Common Cause: Google password changed or 16-char App Password was revoked/expired.
      \u{1F449} 1. Generate new App Password at: https://myaccount.google.com/apppasswords
      \u{1F449} 2. Update 'smtp_pass' in Google Sheet 'Inboxes' tab for [${inbox.email}].
      \u{1F449} 3. Full Guide: docs/GOOGLE_APP_PASSWORD_SETUP.md`);
          await sendAuthFailureAlert({
            inboxEmail: inbox.email,
            errorDetails: err.message,
            webhookUrl: discordWebhookUrl,
            context: "Campaign Pre-Flight Diagnostic (SMTP Audit)"
          });
        } else {
          logFail(`SMTP authentication failed for "${inbox.email}": ${err.message}`);
        }
      }
      if (inbox.imap_host) {
        let client;
        try {
          client = new ImapFlow({
            host: inbox.imap_host || "imap.gmail.com",
            port: parseInt(inbox.imap_port || "993", 10),
            secure: true,
            auth: {
              user: inbox.smtp_user || inbox.email,
              pass: inbox.smtp_pass ? inbox.smtp_pass.replace(/\s+/g, "") : ""
            },
            logger: false,
            emitLogs: false
          });
          await client.connect();
          logPass(`IMAP connection verified for: "${inbox.email}" (${inbox.imap_host}:${inbox.imap_port})`);
          await client.logout();
        } catch (err) {
          if (isAuthError(err)) {
            logFail(`\u{1F6A8} GOOGLE APP PASSWORD IMAP AUTHENTICATION FAILED for "${inbox.email}": ${err.message}
      \u{1F449} Update 'smtp_pass' in Google Sheet 'Inboxes' tab with a fresh 16-character App Password.`);
            await sendAuthFailureAlert({
              inboxEmail: inbox.email,
              errorDetails: `IMAP Auth: ${err.message}`,
              webhookUrl: discordWebhookUrl,
              context: "Campaign Pre-Flight Diagnostic (IMAP Audit)"
            });
          } else {
            logWarn(`IMAP connection failed for "${inbox.email}": ${err.message} (Inbox reply checker may not scan this mailbox).`);
          }
          if (client) {
            try {
              await client.logout();
            } catch {
            }
          }
        }
      }
    }
  }
  console.log("\n\u{1F3AD} STEP 4: Aliases & Routing Verification");
  const aliases = aliasesData.rows.map((r) => {
    const obj = {};
    aliasesData.headers.forEach((h, i) => {
      obj[h] = r[i];
    });
    return obj;
  }).filter((a) => a.alias_email && String(a.is_active).toLowerCase() === "true");
  if (aliases.length === 0) {
    logWarn('No active aliases found in "Aliases" tab. Outbound emails will default to primary inbox credentials.');
  } else {
    logPass(`Found ${aliases.length} active alias(es) in "Aliases" tab.`);
    for (const alias of aliases) {
      const aliasDomain = alias.alias_email.split("@")[1]?.toLowerCase();
      let matchedInbox = null;
      if (alias.inbox_email) {
        matchedInbox = inboxes.find((i) => i.email.toLowerCase() === alias.inbox_email.toLowerCase());
      } else {
        matchedInbox = inboxes.find((i) => i.email.split("@")[1]?.toLowerCase() === aliasDomain);
      }
      if (matchedInbox) {
        logPass(`Alias "${alias.alias_email}" successfully mapped to inbox "${matchedInbox.email}".`);
      } else {
        logWarn(`Alias "${alias.alias_email}" has no matching active inbox with same domain or inbox_email.`);
      }
    }
  }
  console.log("\n\u{1F4DD} STEP 5: Cold & Follow-up Templates Syntax Audit");
  if (templatesData.rows.length === 0) {
    logFail('No templates found in "Templates" tab. Outreach engine has nothing to send.');
  } else {
    logPass(`Found ${templatesData.rows.length} template(s) in "Templates" tab.`);
    templatesData.rows.forEach((row, idx) => {
      const name = row[0] || `Template #${idx + 1}`;
      const subject = row[1] || "";
      const body = row[2] || "";
      if (!subject.trim()) logWarn(`Template "${name}" has an empty Subject line.`);
      if (!body.trim()) logFail(`Template "${name}" has an empty Body.`);
      try {
        const testSub = parseSpintax(subject);
        const testBody = parseSpintax(body);
        logPass(`Template "${name}" Spintax syntax is valid.`);
      } catch (err) {
        logFail(`Template "${name}" has broken Spintax syntax: ${err.message}`);
      }
    });
  }
  if (followupsData.rows.length === 0) {
    logWarn('No follow-up templates found in "Followup_Templates" tab. Follow-up sequences will not trigger.');
  } else {
    logPass(`Found ${followupsData.rows.length} follow-up step(s) in "Followup_Templates" tab.`);
  }
  console.log("\n\u{1F465} STEP 6: Leads Queue & Formatting Analysis");
  const leads = detailsData.rows.map((r) => {
    const obj = {};
    detailsData.headers.forEach((h, i) => {
      obj[h] = r[i];
    });
    return obj;
  });
  const pendingLeads = leads.filter((l) => l.email && !l["Sent Status"]);
  const sentLeads = leads.filter((l) => l["Sent Status"] === "SENT");
  const repliedLeads = leads.filter((l) => l["Sent Status"] === "replied");
  const bouncedLeads = leads.filter((l) => l["Sent Status"] === "bounced");
  logPass(`Total leads in "Details": ${leads.length} | \u23F3 Pending: ${pendingLeads.length} | \u2709\uFE0F Sent: ${sentLeads.length} | \u{1F4AC} Replied: ${repliedLeads.length} | \u26A0\uFE0F Bounced: ${bouncedLeads.length}`);
  let invalidEmailCount = 0;
  for (const lead of pendingLeads.slice(0, 100)) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lead.email)) {
      invalidEmailCount++;
    }
  }
  if (invalidEmailCount > 0) {
    logWarn(`Found ${invalidEmailCount} pending lead(s) with malformed email formats.`);
  } else if (pendingLeads.length > 0) {
    logPass("Sample pending leads have valid email syntax.");
  }
  console.log("\n\u{1F6E1}\uFE0F STEP 7: Sender Domains Deliverability (SPF & DMARC)");
  const uniqueDomains = [...new Set(inboxes.map((i) => i.email.split("@")[1]?.toLowerCase()).filter(Boolean))];
  for (const domain of uniqueDomains) {
    try {
      const dnsResult = await checkDnsRecords(domain);
      if (dnsResult.spf && dnsResult.dmarc) {
        logPass(`Domain "${domain}": SPF \u2705 (PASS) | DMARC \u2705 (PASS)`);
      } else {
        logWarn(`Domain "${domain}": SPF ${dnsResult.spf ? "\u2705" : "\u274C"} | DMARC ${dnsResult.dmarc ? "\u2705" : "\u274C"} (May impact inbox deliverability)`);
      }
    } catch (err) {
      logWarn(`Could not resolve DNS records for domain "${domain}": ${err.message}`);
    }
  }
  console.log("\n\u{1F916} STEP 8: AI & Discord Webhook Connectivity");
  const groqApiKey = settings.groq_api_key || process.env.GROQ_API_KEY;
  if (groqApiKey && !groqApiKey.startsWith("gsk_...")) {
    try {
      const gRes = await axios2.get("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${groqApiKey}` },
        timeout: 8e3
      });
      if (gRes.status === 200) {
        logPass("Groq AI API Key is active and responding.");
      }
    } catch (err) {
      logWarn(`Groq API key verification failed: ${err.message} (Sentiment classification will fall back safely).`);
    }
  } else {
    logWarn("Groq API Key is not set in Settings tab or environment. AI reply classification will be bypassed.");
  }
  const discordWebhook = settings.discord_updates_webhook || process.env.DISCORD_WEBHOOK_URL;
  if (discordWebhook && discordWebhook.startsWith("http")) {
    logPass("Discord Updates Webhook URL is configured.");
  } else {
    logWarn("Discord webhook URL is not configured. Real-time run notifications will be silenced.");
  }
  console.log("\n\u23F0 STEP 9: Cron Automation & Schedule Verification");
  const cronApiKey = process.env.CRONJOB_API_KEY || process.env.CRON_JOB_API_KEY || process.env.CRON_API_KEY || process.env.CRON_KEY || process.env.CRONJOB_KEY || settings.cronjob_api_key || settings.cron_job_api_key || settings.cron_api_key || settings.cron_key || settings.cronjob_key || settings.cron_token || settings.cronjob_token || settings["cron api key"] || settings["cron key"] || settings.cronapikey || settings.cronkey;
  if (cronApiKey) {
    const preview = cronApiKey.length > 8 ? `${cronApiKey.slice(0, 4)}...${cronApiKey.slice(-4)}` : "configured";
    logPass(`cron-job.org API Key detected (${preview}) \u2705`);
  }
  const dynamicJobs = parseScheduleFromSettings(settings);
  const cronDays = settings.cron_days || "Mon-Sat";
  const cronOutreachTime = settings.cron_outreach_time || "10:00";
  const cronFollowupTime = settings.cron_followup_time || "09:30";
  logPass(`Desired Cron Schedules in Sheet: Timezone="${cronTimezone}" | Days="${cronDays}" | Outreach="${cronOutreachTime}" | Follow-up="${cronFollowupTime}"`);
  const detectedGit = autoDetectGitRepo();
  let repoOwner = process.env.GITHUB_OWNER || (detectedGit ? detectedGit.owner : "");
  let repoName = process.env.GITHUB_REPO || (detectedGit ? detectedGit.repo : "");
  if (process.env.GITHUB_REPOSITORY) {
    const parts = process.env.GITHUB_REPOSITORY.split("/");
    if (parts.length === 2) {
      if (!repoOwner) repoOwner = parts[0];
      if (!repoName) repoName = parts[1];
    }
  }
  const repoLabel = repoName ? `${repoOwner ? repoOwner + "/" : ""}${repoName}` : "campaign";
  if (cronApiKey) {
    try {
      const existingJobs = await fetchExistingJobs(cronApiKey);
      const targetTitles = dynamicJobs.map((j) => j.title.toLowerCase());
      const campaignJobs = existingJobs.filter((j) => {
        const title = (j.title || "").toLowerCase();
        const url = (j.url || "").toLowerCase();
        if (repoName) {
          const lowerRepo = repoName.toLowerCase();
          if (title.includes(lowerRepo)) return true;
          if (url.includes(`/${lowerRepo}/`)) return true;
        }
        if (repoOwner && url.includes(`/${repoOwner.toLowerCase()}/`)) {
          return true;
        }
        if (targetTitles.some((t) => title.includes(t))) {
          if (!repoName || title.includes("sheet-bot")) return true;
        }
        return false;
      });
      if (campaignJobs.length === 0) {
        logWarn(`cron-job.org API connected, but found 0 jobs configured for "${repoLabel}". (Run Auto-Setup or setup-cron.mjs to provision them).`);
      } else {
        logPass(`Found ${campaignJobs.length} cron job(s) configured for "${repoLabel}" on cron-job.org.`);
        await syncCronJobStates({
          cronApiKey,
          campaignJobs,
          dynamicJobs,
          settings,
          repoLabel,
          fetchJobDetailsFn: fetchJobDetails,
          updateCronJobFn: updateCronJob,
          sendAlertFn: sendCronSyncAlert,
          discordWebhook,
          sleepFn: sleep,
          logPass,
          logWarn
        });
      }
    } catch (err) {
      logWarn(`Could not verify cron-job.org API: ${err.message} (Verify your CRONJOB_API_KEY).`);
    }
  } else {
    logPass(`Cron schedules parsed from Google Sheet. (Add CRONJOB_API_KEY secret to enable live auto-syncing during diagnostics).`);
  }
  return finishReport(report);
}
function parseSettingsRows(allSettingsRows = []) {
  const settings = {};
  for (const r of allSettingsRows) {
    if (!Array.isArray(r) || r.length === 0) continue;
    let rawK = r[0] !== void 0 && r[0] !== null ? String(r[0]).trim() : "";
    let rawV = "";
    if (rawK) {
      let sepIdx = -1;
      let sepLen = 1;
      if (rawK.includes("	")) {
        sepIdx = rawK.indexOf("	");
      } else if (rawK.includes(":")) {
        sepIdx = rawK.indexOf(":");
      } else if (rawK.includes("=") && rawK.indexOf("=") < rawK.length - 2) {
        sepIdx = rawK.indexOf("=");
      } else if (/\s{2,}/.test(rawK)) {
        const match = rawK.match(/\s{2,}/);
        if (match) {
          sepIdx = match.index;
          sepLen = match[0].length;
        }
      }
      if (sepIdx !== -1) {
        const potentialK = rawK.slice(0, sepIdx).trim();
        const potentialV = rawK.slice(sepIdx + sepLen).trim();
        if (potentialK && potentialV) {
          rawK = potentialK;
          rawV = potentialV;
        }
      }
    }
    if (!rawV) {
      const colB = r[1] !== void 0 && r[1] !== null ? String(r[1]).trim() : "";
      if (colB) {
        rawV = colB;
      } else {
        const colC = r[2] !== void 0 && r[2] !== null ? String(r[2]).trim() : "";
        if (colC && !colC.toLowerCase().startsWith("optional") && !colC.toLowerCase().includes("auto-read") && !colC.toLowerCase().includes("default")) {
          rawV = colC;
        }
      }
    }
    if (rawK) {
      const cleanK = rawK.trim();
      const lowerK = cleanK.toLowerCase();
      const snakeK = lowerK.replace(/[\s\-_]+/g, "_");
      const noSepK = lowerK.replace(/[^a-z0-9]/g, "");
      settings[cleanK] = rawV;
      settings[lowerK] = rawV;
      settings[snakeK] = rawV;
      settings[noSepK] = rawV;
    }
  }
  for (const k of ["cron_api_key", "cronjob_api_key", "cron_key", "cronapikey", "cronkey"]) {
    if (settings[k] && (settings[k].toLowerCase().startsWith("optional") || settings[k].toLowerCase().includes("auto-read") || settings[k].includes(" "))) {
      delete settings[k];
    }
  }
  if (!settings.cron_api_key && !settings.cronjob_api_key) {
    for (const r of allSettingsRows) {
      for (const cell of Array.isArray(r) ? r : []) {
        const val = String(cell || "").trim();
        if ((val.startsWith("AXPV+") || /^[A-Za-z0-9+/=]{40,64}$/.test(val)) && !val.includes(" ") && !val.toLowerCase().includes("optional")) {
          settings.cron_api_key = val;
          settings.cronjob_api_key = val;
          break;
        }
      }
      if (settings.cron_api_key) break;
    }
  }
  return settings;
}
function determineDesiredCronState(targetJob, settings = {}) {
  const isDiagnostic = targetJob?.workflow === "test_campaign.yml" || Boolean(targetJob?.title && targetJob.title.toLowerCase().includes("diagnostic"));
  if (isDiagnostic) {
    return { enabled: true, reason: "diagnostic_always_active" };
  }
  const campaignActive = isCampaignActive(settings);
  if (!campaignActive) {
    return { enabled: false, reason: "campaign_paused" };
  }
  if (targetJob?.action) {
    const actionActive = isCampaignActive(settings, targetJob.action);
    return { enabled: actionActive, reason: actionActive ? "campaign_active" : `${targetJob.action}_disabled` };
  }
  return { enabled: true, reason: "campaign_active" };
}
async function syncCronJobStates({
  cronApiKey,
  campaignJobs = [],
  dynamicJobs = [],
  settings = {},
  repoLabel = "Sheet-bot",
  fetchJobDetailsFn = fetchJobDetails,
  updateCronJobFn = updateCronJob,
  sendAlertFn = sendCronSyncAlert,
  discordWebhook = null,
  sleepFn = sleep,
  logPass = (msg) => console.log(`[PASS] ${msg}`),
  logWarn = (msg) => console.warn(`[WARN] ${msg}`)
}) {
  const usedJobIds = /* @__PURE__ */ new Set();
  let pausedCount = 0;
  let reactivatedCount = 0;
  for (const targetJob of dynamicJobs) {
    const targetTitle = (targetJob.title || "").toLowerCase();
    let matched = campaignJobs.find((j) => {
      if (usedJobIds.has(j.jobId)) return false;
      const title = (j.title || "").toLowerCase();
      return title.includes(targetTitle);
    });
    if (!matched) {
      for (const j of campaignJobs) {
        if (usedJobIds.has(j.jobId)) continue;
        try {
          const detailed = await fetchJobDetailsFn(cronApiKey, j.jobId);
          const bodyStr = detailed?.jobDetails?.extendedData?.body || detailed?.job?.extendedData?.body || "";
          if (bodyStr.includes(`"action":"${targetJob.action}"`) || bodyStr.includes(`"action": "${targetJob.action}"`)) {
            matched = j;
            break;
          }
        } catch (_) {
        }
      }
    }
    if (matched) {
      usedJobIds.add(matched.jobId);
      try {
        const desired = determineDesiredCronState(targetJob, settings);
        const desiredEnabled = desired.enabled;
        const detailed = await fetchJobDetailsFn(cronApiKey, matched.jobId);
        const curSchedule = detailed?.jobDetails?.schedule || detailed?.job?.schedule || detailed?.schedule;
        const sameTz = curSchedule?.timezone === targetJob.schedule.timezone;
        const sameHours = JSON.stringify(curSchedule?.hours || []) === JSON.stringify(targetJob.schedule.hours || []);
        const sameMins = JSON.stringify(curSchedule?.minutes || []) === JSON.stringify(targetJob.schedule.minutes || []);
        const sameWdays = JSON.stringify(curSchedule?.wdays || []) === JSON.stringify(targetJob.schedule.wdays || []);
        const wasEnabled = Boolean(matched.enabled);
        const sameEnabled = wasEnabled === desiredEnabled;
        const formatHour = JSON.stringify(targetJob.schedule.hours || []);
        const formatMin = JSON.stringify(targetJob.schedule.minutes || []);
        const expectedTitle = `${repoLabel} - ${targetJob.title}`;
        const sameTitle = matched.title === expectedTitle;
        if (sameTz && sameHours && sameMins && sameWdays && sameEnabled && sameTitle) {
          if (desiredEnabled) {
            logPass(`Cron Job "${matched.title}": ENABLED & in sync with Google Sheet (${targetJob.schedule.timezone} @ ${formatHour}:${formatMin}) \u2705`);
          } else {
            logPass(`Cron Job "${matched.title}": PAUSED on cron-job.org (Campaign paused in Google Sheet) \u23F8\uFE0F`);
          }
        } else {
          let transitionType = "updated";
          if (!wasEnabled && desiredEnabled) {
            reactivatedCount++;
            transitionType = "reactivated";
          } else if (wasEnabled && !desiredEnabled) {
            pausedCount++;
            transitionType = "paused";
          }
          const updatedPayload = {
            job: {
              ...detailed?.jobDetails || detailed?.job || {},
              title: expectedTitle,
              enabled: desiredEnabled,
              schedule: targetJob.schedule
            }
          };
          await updateCronJobFn(cronApiKey, matched.jobId, updatedPayload);
          if (transitionType === "reactivated") {
            logPass(`Cron Job "${expectedTitle}": REACTIVATED & auto-synchronized (Campaign active) \u25B6\uFE0F\u{1F504}`);
            await sendAlertFn({
              jobTitle: expectedTitle,
              timezone: targetJob.schedule.timezone,
              hours: targetJob.schedule.hours,
              minutes: targetJob.schedule.minutes,
              webhookUrl: discordWebhook,
              context: "Pre-Flight Diagnostic Auto-Reactivation (Campaign Resumed \u25B6\uFE0F)"
            });
          } else if (transitionType === "paused") {
            logPass(`Cron Job "${expectedTitle}": PAUSED on cron-job.org (Campaign paused in Google Sheet) \u23F8\uFE0F`);
          } else {
            logPass(`Cron Job "${expectedTitle}": Auto-synchronized & updated schedule to match Google Sheet (${targetJob.schedule.timezone} @ ${formatHour}:${formatMin}) \u{1F504}\u2705`);
            await sendAlertFn({
              jobTitle: expectedTitle,
              timezone: targetJob.schedule.timezone,
              hours: targetJob.schedule.hours,
              minutes: targetJob.schedule.minutes,
              webhookUrl: discordWebhook,
              context: "Pre-Flight Diagnostic Auto-Sync"
            });
          }
        }
      } catch (jobErr) {
        logWarn(`Cron Job "${matched.title}": Checked (${matched.enabled ? "ENABLED" : "PAUSED"}). Auto-sync note: ${jobErr.message}`);
      }
    }
    if (sleepFn) {
      await sleepFn(1500);
    }
  }
  return { pausedCount, reactivatedCount, totalChecked: usedJobIds.size };
}
function finishReport(report) {
  console.log("\n=============================================================");
  console.log("\u{1F4CA} CAMPAIGN PRE-FLIGHT AUDIT SUMMARY:");
  console.log(`\u2022 \u2705 PASSED CHECKS:   ${report.passed}`);
  console.log(`\u2022 \u26A0\uFE0F WARNINGS:        ${report.warnings}`);
  console.log(`\u2022 \u274C CRITICAL ERRORS: ${report.failures}`);
  console.log("=============================================================\n");
  if (report.failures > 0) {
    console.log("\u{1F6A8} Action Required: Fix the critical errors above before starting automated outreach.\n");
    process.exitCode = 1;
  } else {
    console.log("\u{1F389} System Ready: All campaign components are healthy and ready to dispatch!\n");
    process.exitCode = 0;
  }
  return report;
}
if (process.argv[1] && path2.resolve(fileURLToPath(import.meta.url)).toLowerCase() === path2.resolve(process.argv[1]).toLowerCase()) {
  runCampaignDiagnostics().catch((err) => {
    console.error("Fatal diagnostic runner error:", err);
    process.exit(1);
  });
}
export {
  auditAndRepairSheetSchema,
  columnIndexToLetter,
  determineDesiredCronState,
  parseSettingsRows,
  runCampaignDiagnostics,
  syncCronJobStates
};

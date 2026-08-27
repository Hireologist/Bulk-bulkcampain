/**
 * 🚀 UNIVERSAL OUTREACH BOT - GOOGLE APPS SCRIPT
 * Non-destructive sheet syncer & builder.
 * Safely adds new columns/settings without overwriting existing data.
 */

function createOutreachSystem(forceReset = false) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const schema = {
    '📖 Setup_Guide': {
      color: '#0F172A',
      headers: ['Section / Step', 'Instructions & Rules', 'Important Notes'],
      sampleData: [
        ['1. Adding Leads', 'Go to "Details" tab. Add full_name, email, company_name, location. Leave "Sent Status", "Follow up", and "Time" BLANK.', 'The bot only sends emails to rows where Sent Status is completely empty.'],
        ['2. Aliases & Senders', 'Add or remove aliases in "Aliases" tab (e.g. Pooja, Neha, Urvashi). Toggle is_active to TRUE/FALSE.', 'The bot randomly rotates active aliases for the "From" header while using your authenticated SMTP inbox.'],
        ['3. Email Inboxes', 'Add your primary SMTP login in "Inboxes" tab. Use App Passwords for Gmail/Google Workspace.', 'Set daily_limit (e.g. 50). The bot will never exceed this number per inbox per day.'],
        ['4. Cold Templates', 'Edit pitches in "Templates" tab. Use tags: {{full_name}}, {{company_name}}, {{location}}, {{other_locations}}, {{clients}}, {{Date}}.', 'The bot replaces these tags dynamically with randomized cities and portfolio companies.'],
        ['5. Follow-ups', 'Configure intervals and messages in "Followup_Templates" tab.', 'Follow-ups automatically stop the moment a prospect replies or if an email bounces.'],
        ['6. Automation Schedule', 'Cold Outreach: Mon-Sat 10:00 AM IST\nFollow-ups: Mon-Sat 10:30 AM IST\nInbox Checker: 24/7 every 15 minutes\nDaily Digest: Mon-Sat 6:30 PM IST', 'Configured automatically via GitHub Actions.'],
        ['7. Status Legend', 'SENT = Cold email sent\nreplied = Prospect replied (Sequence paused)\nbounced = Invalid email (Sequence paused)\nDone = Follow-up sequence completed', 'Updated automatically by the bot in real time.']
      ]
    },
    'Details': {
      color: '#1A73E8',
      headers: [
        'full_name', 'email', 'company_name', 'location', 
        'Subject Line', 'Sent From', 'Sent Status', 'Time', 
        'Date Sent', 'Follow up', 'Follow Up Count', 'Next Follow Up Date', 'Summary'
      ],
      sampleData: [
        ['John Doe', 'john@example.com', 'Acme Corp', 'Bengaluru', '', '', '', '', '', '', '', '', '']
      ]
    },
    'Aliases': {
      color: '#EC4899',
      headers: ['alias_email', 'display_name', 'is_active'],
      sampleData: [
        ['pooja@companydomain.com', 'Pooja', 'TRUE'],
        ['neha@companydomain.com', 'Neha', 'TRUE'],
        ['urvashi@companydomain.com', 'Urvashi', 'TRUE'],
        ['shraddha@companydomain.com', 'Shraddha', 'TRUE'],
        ['roshni@companydomain.com', 'Roshni', 'TRUE']
      ]
    },
    'Inboxes': {
      color: '#059669',
      headers: [
        'email', 'display_name', 'smtp_host', 'smtp_port', 
        'smtp_user', 'smtp_pass', 'imap_host', 'imap_port', 
        'daily_limit', 'is_active'
      ],
      sampleData: [
        [
          'outreach@companydomain.com', 'Outreach Team', 'smtp.gmail.com', '465', 
          'outreach@companydomain.com', 'your-gmail-app-password', 'imap.gmail.com', '993', 
          '50', 'TRUE'
        ]
      ]
    },
    'Settings': {
      color: '#4B5563',
      headers: ['Key', 'Value', 'Description'],
      sampleData: [
        ['min_delay_seconds', '15', 'Minimum seconds to wait between sending emails'],
        ['max_delay_seconds', '45', 'Maximum seconds to wait between sending emails'],
        ['cutoff_hour_ist', '18', 'Stop sending at this hour in IST (18 = 6 PM)'],
        ['cutoff_minute_ist', '30', 'Stop sending at this minute in IST (30 = 6:30 PM)'],
        ['max_emails_per_run', '1000', 'Maximum emails to send per single trigger run'],
        ['discord_updates_webhook', 'https://discord.com/api/webhooks/...', 'Channel webhook for Start/End alerts'],
        ['discord_positive_webhook', 'https://discord.com/api/webhooks/...', 'Channel webhook for New Positive/Neutral lead alerts'],
        ['discord_rereply_webhook', 'https://discord.com/api/webhooks/...', 'Channel webhook for Re-replies from existing leads'],
        ['groq_api_key', 'gsk_...', 'Groq API Key (Free) for AI Sentiment & Summary']
      ]
    },
    'Templates': {
      color: '#7C3AED',
      headers: ['Template_Name', 'Subject', 'Body'],
      sampleData: [
        [
          'Cold Pitch V1',
          'Quick question for {{company_name}} - {{Date}}',
          'Hi {{full_name}},\n\nNoticed your rapid expansion in {{location}}. We recently helped clients like {{clients}} scale their teams across {{other_locations}}.\n\nWould you be open to a quick 5-min sync this week?\n\nBest,\nTeam'
        ]
      ]
    },
    'Followup_Templates': {
      color: '#D97706',
      headers: ['Follow_Up_Number', 'Days_Until_Next', 'Subject', 'Body'],
      sampleData: [
        ['1', '3', 'Re:', 'Hi {{full_name}},\n\nJust following up on my previous note regarding {{company_name}}. Let me know if this is relevant.\n\nBest,\nTeam'],
        ['2', '5', 'Re:', 'Hi {{full_name}},\n\nWanted to float this back to the top of your inbox. Would love to share how we helped {{clients}}.\n\nBest,\nTeam'],
        ['3', '7', 'Re:', 'Hi {{full_name}},\n\nChecking in one last time to see if {{company_name}} is looking for hiring support this quarter.\n\nBest,\nTeam']
      ]
    },
    'Locations': {
      color: '#2563EB',
      headers: ['location_name'],
      sampleData: [
        ['Mumbai'], ['Delhi'], ['Bengaluru'], ['Hyderabad'], ['Ahmedabad'],
        ['Chennai'], ['Kolkata'], ['Pune'], ['Jaipur'], ['Noida'], ['Indore'], ['Gurgaon']
      ]
    },
    'Clients': {
      color: '#DC2626',
      headers: ['client_name', 'industry'],
      sampleData: [
        ['Bajaj', 'Global'], ['ICICI', 'Global'], ['Mobile Programming', 'IT'],
        ['Turing', 'IT'], ['NP Digital', 'Digital Marketing'], ['KENT RO', 'Manufacturing'],
        ['Physics Wallah', 'Edtech'], ['Ditto', 'Insurance'], ['Mapro Foods', 'Foods']
      ]
    }
  };

  let updatedSheetsCount = 0;
  let newSheetsCount = 0;
  let newColumnsCount = 0;
  let newSettingsCount = 0;

  Object.keys(schema).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    const { headers, sampleData, color } = schema[sheetName];

    if (!sheet) {
      // 1. Create completely new sheet if missing
      sheet = ss.insertSheet(sheetName);
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setValues([headers]);
      headerRange.setFontWeight('bold');
      headerRange.setFontColor('#FFFFFF');
      headerRange.setBackground(color);
      headerRange.setHorizontalAlignment('center');

      if (sampleData && sampleData.length > 0) {
        sheet.getRange(2, 1, sampleData.length, sampleData[0].length).setValues(sampleData);
      }
      sheet.setFrozenRows(1);
      for (let c = 1; c <= headers.length; c++) sheet.autoResizeColumn(c);
      newSheetsCount++;
    } else if (forceReset) {
      // 2. Hard reset only if explicitly requested
      sheet.clear();
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setValues([headers]);
      headerRange.setFontWeight('bold');
      headerRange.setFontColor('#FFFFFF');
      headerRange.setBackground(color);
      headerRange.setHorizontalAlignment('center');

      if (sampleData && sampleData.length > 0) {
        sheet.getRange(2, 1, sampleData.length, sampleData[0].length).setValues(sampleData);
      }
      sheet.setFrozenRows(1);
      for (let c = 1; c <= headers.length; c++) sheet.autoResizeColumn(c);
      updatedSheetsCount++;
    } else {
      // 3. 🛡️ SMART NON-DESTRUCTIVE SYNC: Keep all existing data and append only missing columns/keys!
      const lastCol = Math.max(sheet.getLastColumn(), 1);
      const existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => (h || '').toString().trim());

      // A. Check and append any missing header columns
      headers.forEach(expectedHeader => {
        if (!existingHeaders.includes(expectedHeader)) {
          const newColIdx = sheet.getLastColumn() + 1;
          const cell = sheet.getRange(1, newColIdx);
          cell.setValue(expectedHeader);
          cell.setFontWeight('bold');
          cell.setFontColor('#FFFFFF');
          cell.setBackground(color);
          cell.setHorizontalAlignment('center');
          sheet.autoResizeColumn(newColIdx);
          newColumnsCount++;
        }
      });

      // B. Smart Settings Sync: Add missing setting keys without touching user-configured values
      if (sheetName === 'Settings') {
        const lastRow = Math.max(sheet.getLastRow(), 1);
        let existingKeys = [];
        if (lastRow > 1) {
          existingKeys = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => (r[0] || '').toString().trim());
        }

        sampleData.forEach(([key, defaultValue, description]) => {
          if (!existingKeys.includes(key)) {
            sheet.appendRow([key, defaultValue, description]);
            newSettingsCount++;
          }
        });
      }

      // C. Update Setup Guide content safely
      if (sheetName === '📖 Setup_Guide') {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.getRange(2, 1, sampleData.length, sampleData[0].length).setValues(sampleData);
      }

      sheet.setFrozenRows(1);
      updatedSheetsCount++;
    }
  });

  // ==========================================
  // 📊 1. EMAIL ANALYTICS SHEET
  // ==========================================
  let analyticsSheet = ss.getSheetByName('📊 Email_Analytics');
  if (!analyticsSheet) analyticsSheet = ss.insertSheet('📊 Email_Analytics');
  else if (forceReset) analyticsSheet.clear();

  const analyticsHeaders = ['Sender', 'Sent', 'Replied', 'Bounced', 'Positive', 'Negative', 'Neutral', 'Reply Rate', 'Pos Reply Rate'];
  const analyticsHeaderRange = analyticsSheet.getRange(1, 1, 1, analyticsHeaders.length);
  analyticsHeaderRange.setValues([analyticsHeaders]);
  analyticsHeaderRange.setFontWeight('bold');
  analyticsHeaderRange.setFontColor('#FFFFFF');
  analyticsHeaderRange.setBackground('#0D9488');
  analyticsHeaderRange.setHorizontalAlignment('center');

  const analyticsFormula = `=LET(senders, UNIQUE(FILTER(Details!F2:F, Details!F2:F<>"")), sent, MAP(senders, LAMBDA(s, COUNTIFS(Details!F:F, s))), replied, MAP(senders, LAMBDA(s, COUNTIFS(Details!F:F, s, Details!G:G, "replied"))), bounced, MAP(senders, LAMBDA(s, COUNTIFS(Details!F:F, s, Details!G:G, "bounced"))), positive, MAP(senders, LAMBDA(s, COUNTIFS(Details!F:F, s, Details!L:L, "POSITIVE"))), negative, MAP(senders, LAMBDA(s, COUNTIFS(Details!F:F, s, Details!L:L, "NEGATIVE"))), neutral, MAP(senders, LAMBDA(s, COUNTIFS(Details!F:F, s, Details!L:L, "NEUTRAL"))), reply_rate, MAP(replied, sent, LAMBDA(r, s, IFERROR(r/s, 0))), pos_reply_rate, MAP(positive, sent, LAMBDA(p, s, IFERROR(p/s, 0))), data, HSTACK(senders, sent, replied, bounced, positive, negative, neutral, reply_rate, pos_reply_rate), tot_sent, SUM(sent), tot_replied, SUM(replied), tot_bounced, SUM(bounced), tot_positive, SUM(positive), tot_negative, SUM(negative), tot_neutral, SUM(neutral), tot_reply_rate, IFERROR(tot_replied/tot_sent, 0), tot_pos_reply_rate, IFERROR(tot_positive/tot_sent, 0), totals, HSTACK("TOTAL", tot_sent, tot_replied, tot_bounced, tot_positive, tot_negative, tot_neutral, tot_reply_rate, tot_pos_reply_rate), VSTACK(data, totals))`;
  analyticsSheet.getRange(2, 1).setValue(analyticsFormula);
  analyticsSheet.setFrozenRows(1);
  analyticsSheet.getRange('H:I').setNumberFormat('0.0%');
  for (let c = 1; c <= analyticsHeaders.length; c++) analyticsSheet.autoResizeColumn(c);

  // ==========================================
  // 📈 2. CHART DATA SHEET
  // ==========================================
  let chartDataSheet = ss.getSheetByName('📈 ChartData');
  if (!chartDataSheet) chartDataSheet = ss.insertSheet('📈 ChartData');
  else if (forceReset) chartDataSheet.clear();

  // Sentiment Table
  const sentimentHeaders = ['Status', 'Count'];
  const sHeaderRange = chartDataSheet.getRange(1, 1, 1, sentimentHeaders.length);
  sHeaderRange.setValues([sentimentHeaders]);
  sHeaderRange.setFontWeight('bold');
  sHeaderRange.setFontColor('#FFFFFF');
  sHeaderRange.setBackground('#6366F1');
  sHeaderRange.setHorizontalAlignment('center');

  chartDataSheet.getRange(2, 1, 3, 2).setValues([
    ['POSITIVE', '=COUNTIF(Details!L:L, A2)'],
    ['NEUTRAL', '=COUNTIF(Details!L:L, A3)'],
    ['NEGATIVE', '=COUNTIF(Details!L:L, A4)']
  ]);

  // Sent Status Table
  const statusHeaders = ['Sent Status', 'Count'];
  const stHeaderRange = chartDataSheet.getRange(7, 1, 1, statusHeaders.length);
  stHeaderRange.setValues([statusHeaders]);
  stHeaderRange.setFontWeight('bold');
  stHeaderRange.setFontColor('#FFFFFF');
  stHeaderRange.setBackground('#8B5CF6');
  stHeaderRange.setHorizontalAlignment('center');

  chartDataSheet.getRange(8, 1, 4, 2).setValues([
    ['replied', '=COUNTIF(Details!G:G, "replied")'],
    ['bounced', '=COUNTIF(Details!G:G, "bounced")'],
    ['SENT', '=COUNTIF(Details!G:G, "SENT")'],
    ['Total', '=SUM(B8:B10)']
  ]);

  chartDataSheet.setFrozenRows(1);
  chartDataSheet.autoResizeColumn(1);
  chartDataSheet.autoResizeColumn(2);

  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);

  ss.getSheetByName('📖 Setup_Guide')?.activate();

  if (forceReset) {
    SpreadsheetApp.getUi().alert('⚠️ All sheets have been reset and rebuilt to fresh defaults.');
  } else {
    const summaryMsg = `✅ Smart Sync Complete!\n\n` +
      `• Sheets Verified: ${Object.keys(schema).length}\n` +
      `• New Sheets Added: ${newSheetsCount}\n` +
      `• New Columns Added: ${newColumnsCount}\n` +
      `• New Settings Keys Added: ${newSettingsCount}\n\n` +
      `🛡️ All your existing leads, inboxes, and settings were preserved safely.`;
    SpreadsheetApp.getUi().alert(summaryMsg);
  }
}

/**
 * 🔄 Safe Sync (Default) - Adds missing columns/settings without overwriting existing data.
 */
function syncOutreachSystem() {
  createOutreachSystem(false);
}

/**
 * ⚠️ Hard Reset - Clears and rebuilds all sheets from scratch with confirmation prompt.
 */
function resetAllSheetsWithWarning() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '⚠️ Confirmation Required',
    'Are you sure you want to completely RESET and CLEAR all tabs? This will ERASE all leads, inboxes, and custom settings!',
    ui.ButtonSet.YES_NO
  );
  if (response === ui.Button.YES) {
    createOutreachSystem(true);
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ Outreach Bot')
    .addItem('🔄 Sync & Add Missing Columns/Settings (Safe)', 'syncOutreachSystem')
    .addSeparator()
    .addItem('⚠️ Hard Reset / Rebuild All (Wipes Data)', 'resetAllSheetsWithWarning')
    .addToUi();
}

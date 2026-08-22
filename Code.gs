/**
 * 🚀 1-CLICK OUTREACH SHEET BUILDER & DOMAIN CLEANER
 * Generates all 8 sheets including Setup Guide, Aliases, Inboxes & Templates.
 */
function createOutreachSystem() {
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
        ['6. Automation Schedule', 'Cold Outreach: Mon-Sat 10:00 AM IST\nFollow-ups: Mon-Sat 10:30 AM IST\nInbox Checker: 24/7 every 30 minutes', 'Configured automatically via GitHub Actions.'],
        ['7. Status Legend', 'SENT = Cold email sent\nreplied = Prospect replied (Sequence paused)\nbounced = Invalid email (Sequence paused)\nDone = Follow-up sequence completed', 'Updated automatically by the bot in real time.']
      ]
    },
    'Details': {
      color: '#1A73E8',
      headers: [
        'full_name', 'email', 'company_name', 'location', 
        'Subject Line', 'Sent From', 'Sent Status', 'Time', 
        'Date Sent', 'Follow up', 'Follow Up Count', 'Next Follow Up Date'
      ],
      sampleData: [
        ['John Doe', 'john@example.com', 'Acme Corp', 'Bengaluru', '', '', '', '', '', '', '', '']
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
        ['discord_updates_webhook', 'https://discord.com/api/webhooks/...', 'Channel webhook for Start/End alerts'],
        ['discord_positive_webhook', 'https://discord.com/api/webhooks/...', 'Channel webhook for Positive/Neutral reply alerts'],
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

  Object.keys(schema).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    else sheet.clear();

    const { headers, sampleData, color } = schema[sheetName];

    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setBackground(color);
    headerRange.setHorizontalAlignment('center');

    if (sampleData.length > 0) {
      sheet.getRange(2, 1, sampleData.length, sampleData[0].length).setValues(sampleData);
    }

    sheet.setFrozenRows(1);
    for (let c = 1; c <= headers.length; c++) {
      sheet.autoResizeColumn(c);
    }
  });

  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);

  ss.getSheetByName('📖 Setup_Guide').activate();
  SpreadsheetApp.getUi().alert('✅ Your Outreach Sheet has been built successfully!');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ Outreach Bot')
    .addItem('🛠️ Rebuild / Reset All Sheets', 'createOutreachSystem')
    .addToUi();
}

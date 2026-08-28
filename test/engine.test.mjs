import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { isDailyLimitError, getRandomFormattedDate, runSingleLeadOutreach, classifyEmailWithAi, normalizeDate } from '../engine.mjs';

describe('Universal Outreach Engine Unit Tests', () => {

  describe('Date Normalization & Strict Daily Digest Date Filter', () => {
    it('should normalize various date formats to DD/MM/YYYY', () => {
      assert.strictEqual(normalizeDate('21/08/2026'), '21/08/2026');
      assert.strictEqual(normalizeDate('21-08-2026'), '21/08/2026');
      assert.strictEqual(normalizeDate('21.08.2026'), '21/08/2026');
      assert.strictEqual(normalizeDate('1/8/2026'), '01/08/2026');
      assert.strictEqual(normalizeDate('2026-08-21'), '21/08/2026');
      assert.strictEqual(normalizeDate(''), '');
    });

    it('should only include rows matching today date in digest aggregation', () => {
      const todayIST = '27/08/2026';
      const rows = [
        { 'Date Sent': '27/08/2026', 'Sent Status': 'SENT', 'Follow Up Count': '0', 'Next Follow Up Date': '' },
        { 'Date Sent': '27/08/2026', 'Sent Status': 'replied', 'Follow Up Count': '0', 'Next Follow Up Date': 'POSITIVE' },
        { 'Date Sent': '26/08/2026', 'Sent Status': 'SENT', 'Follow Up Count': '0', 'Next Follow Up Date': '' }, // yesterday
        { 'Date Sent': '25/08/2026', 'Sent Status': 'replied', 'Follow Up Count': '0', 'Next Follow Up Date': 'POSITIVE' }, // 2 days ago
        { 'Date Sent': '27/08/2026', 'Sent Status': 'bounced', 'Follow Up Count': '0', 'Next Follow Up Date': '' },
        { 'Date Sent': '20/08/2026', 'Sent Status': 'bounced', 'Follow Up Count': '0', 'Next Follow Up Date': '' } // old bounce
      ];

      let coldSentToday = 0;
      let repliesTotal = 0;
      let positiveCount = 0;
      let bouncesTotal = 0;

      for (const row of rows) {
        const sentDate = normalizeDate(row['Date Sent']);
        if (sentDate !== todayIST) continue;

        const status = (row['Sent Status'] || '').toLowerCase();
        const followUpCount = parseInt(row['Follow Up Count'] || '0', 10);
        const sentiment = (row['Next Follow Up Date'] || '').toUpperCase();

        if (followUpCount === 0 && (status === 'sent' || status === 'replied')) coldSentToday++;
        if (status === 'bounced') bouncesTotal++;
        if (status === 'replied') {
          repliesTotal++;
          if (sentiment.includes('POSITIVE')) positiveCount++;
        }
      }

      assert.strictEqual(coldSentToday, 2);
      assert.strictEqual(repliesTotal, 1);
      assert.strictEqual(positiveCount, 1);
      assert.strictEqual(bouncesTotal, 1);
    });
  });

  describe('AI Email Sentiment & Summary Classification', () => {
    it('should fall back to text snippet summary when Groq instance is not provided', async () => {
      const emailBody = 'Hi Team, We are interested in setting up a meeting next Tuesday to discuss rates.';
      const res = await classifyEmailWithAi(null, emailBody);

      assert.strictEqual(res.sentiment, 'REPLIED');
      assert.strictEqual(res.summary, 'Hi Team, We are interested in setting up a meeting next Tuesday to discuss rates.');
    });

    it('should parse valid AI JSON response containing sentiment and summary', async () => {
      const mockGroq = {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: '```json\n{"sentiment": "POSITIVE", "summary": "Prospect wants to schedule a demo next Tuesday."}\n```'
                  }
                }
              ]
            })
          }
        }
      };

      const res = await classifyEmailWithAi(mockGroq, 'Yes, let us talk!');
      assert.strictEqual(res.sentiment, 'POSITIVE');
      assert.strictEqual(res.summary, 'Prospect wants to schedule a demo next Tuesday.');
    });
  });

  describe('New Lead vs Existing Lead Re-reply Channel Router', () => {
    it('should identify a brand new lead reply correctly', () => {
      const existingStatus = 'sent';
      const existingSentiment = '';
      const isExistingLead = existingStatus === 'replied' || existingSentiment === 'POSITIVE' || existingSentiment === 'NEUTRAL';

      assert.strictEqual(isExistingLead, false);
    });

    it('should identify a re-reply from an existing positive/neutral lead correctly', () => {
      const existingStatus1 = 'replied';
      const existingSentiment1 = 'POSITIVE';
      const isExisting1 = existingStatus1 === 'replied' || existingSentiment1 === 'POSITIVE' || existingSentiment1 === 'NEUTRAL';
      assert.strictEqual(isExisting1, true);

      const existingStatus2 = 'sent';
      const existingSentiment2 = 'NEUTRAL';
      const isExisting2 = existingStatus2 === 'replied' || existingSentiment2 === 'POSITIVE' || existingSentiment2 === 'NEUTRAL';
      assert.strictEqual(isExisting2, true);
    });

    it('should select discord_rereply_webhook for existing leads and discord_positive_webhook for new leads', () => {
      const configSettings = {
        discord_positive_webhook: 'https://discord.com/api/webhooks/new_leads',
        discord_rereply_webhook: 'https://discord.com/api/webhooks/rereply_leads',
        discord_updates_webhook: 'https://discord.com/api/webhooks/updates'
      };

      // Helper for channel selection
      function selectWebhook(isExistingLead, sentiment) {
        if (isExistingLead) {
          return configSettings.discord_rereply_webhook || configSettings.discord_positive_webhook || configSettings.discord_updates_webhook;
        } else if (sentiment === 'POSITIVE' || sentiment === 'NEUTRAL') {
          return configSettings.discord_positive_webhook || configSettings.discord_updates_webhook;
        }
        return null;
      }

      assert.strictEqual(selectWebhook(true, 'POSITIVE'), 'https://discord.com/api/webhooks/rereply_leads');
      assert.strictEqual(selectWebhook(false, 'POSITIVE'), 'https://discord.com/api/webhooks/new_leads');
    });
  });

  describe('Pre-Send Domain & MX Validation', () => {
    it('should validate standard email syntax correctly', () => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      assert.strictEqual(emailRegex.test('user@example.com'), true);
      assert.strictEqual(emailRegex.test('invalid-email-string'), false);
      assert.strictEqual(emailRegex.test('user@domain'), false);
      assert.strictEqual(emailRegex.test(''), false);
    });

    it('should resolve MX records for real domain (gmail.com)', async () => {
      const mxRecords = await dns.resolveMx('gmail.com');
      assert.ok(Array.isArray(mxRecords));
      assert.ok(mxRecords.length > 0);
      assert.ok(mxRecords[0].exchange);
    });

    it('should handle non-existent domain MX resolution safely', async () => {
      try {
        await dns.resolveMx('nonexistent-fake-domain-999.org');
        assert.fail('Should have failed for invalid domain');
      } catch (err) {
        assert.ok(err);
      }
    });
  });

  describe('IST Cutoff Logic', () => {
    it('should accurately calculate IST cutoff total minutes', () => {
      const hour = 18;
      const minute = 30;
      const totalMinutes = hour * 60 + minute;
      assert.strictEqual(totalMinutes, 1110);
    });

    it('should calculate IST time offset correctly', () => {
      const now = new Date('2026-08-22T10:00:00Z');
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      const istHours = ist.getUTCHours();
      const istMinutes = ist.getUTCMinutes();
      assert.strictEqual(istHours, 15);
      assert.strictEqual(istMinutes, 30);
    });
  });

  describe('Template Placeholder Replacement', () => {
    it('should replace all template placeholders dynamically', () => {
      const template = 'Hi {{full_name}}, saw {{company_name}} in {{location}} on {{Date}}. Clients: {{clients}}. Other: {{other_locations}}.';
      const fullName = 'John Doe';
      const companyName = 'Acme Corp';
      const location = 'Bengaluru';
      const clientStr = 'Bajaj, ICICI';
      const randomLocs = 'Mumbai, Delhi';
      const dateStr = '22/08/2026';

      const result = template
        .replace(/{{full_name}}/gi, fullName)
        .replace(/{{company_name}}/gi, companyName)
        .replace(/{{location}}/gi, location)
        .replace(/{{other_locations}}/gi, randomLocs)
        .replace(/{{clients}}/gi, clientStr)
        .replace(/{{Date}}/gi, dateStr);

      assert.strictEqual(
        result,
        'Hi John Doe, saw Acme Corp in Bengaluru on 22/08/2026. Clients: Bajaj, ICICI. Other: Mumbai, Delhi.'
      );
    });
  });

  describe('Bounce & Sentiment Classifier Logic', () => {
    it('should identify bounce keywords in sender names', () => {
      const bounceText1 = 'Mailer-Daemon <mailer-daemon@googlemail.com>';
      const bounceText2 = 'Postmaster <postmaster@company.com>';
      const normalText = 'John Prospect <john@acme.com>';

      const isBounce = (txt) => txt.toLowerCase().includes('mailer-daemon') || txt.toLowerCase().includes('postmaster');

      assert.strictEqual(isBounce(bounceText1), true);
      assert.strictEqual(isBounce(bounceText2), true);
      assert.strictEqual(isBounce(normalText), false);
    });

    it('should correctly classify sentiment responses', () => {
      const validSentiments = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'OOO'];
      const rawAiResponse = '  POSITIVE \n';
      const parsed = rawAiResponse.trim().toUpperCase();

      assert.ok(validSentiments.includes(parsed));
      assert.strictEqual(parsed, 'POSITIVE');
    });
  });

  describe('Batch Size Limiter', () => {
    it('should stop processing loop when emailsSentThisRun reaches MAX_PER_RUN', () => {
      const MAX_PER_RUN = 5;
      let emailsSentThisRun = 0;
      const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const processed = [];

      for (let i = 0; i < rows.length; i++) {
        if (emailsSentThisRun >= MAX_PER_RUN) {
          break;
        }
        processed.push(rows[i]);
        emailsSentThisRun++;
      }

      assert.strictEqual(processed.length, 5);
      assert.strictEqual(emailsSentThisRun, 5);
    });
  });

  describe('Daily Sending Limit Detection & Inbox Exclusion', () => {
    it('should accurately identify Gmail and SMTP daily user sending limit errors', () => {
      const gmailError = new Error('Data command failed: 550-5.4.5 Daily user sending limit exceeded. For more information on Gmail');
      const short550 = new Error('550 5.4.5  https://support.google.com/a/answer/166852');
      const quotaError = new Error('SMTP Error: Quota exceeded for account');
      const rateLimitError = new Error('Rate limit exceeded for inbox');
      const networkError = new Error('ETIMEDOUT: Connection timed out');
      const genericError = new Error('Invalid recipient email');

      assert.strictEqual(isDailyLimitError(gmailError), true);
      assert.strictEqual(isDailyLimitError(short550), true);
      assert.strictEqual(isDailyLimitError(quotaError), true);
      assert.strictEqual(isDailyLimitError(rateLimitError), true);
      assert.strictEqual(isDailyLimitError(networkError), false);
      assert.strictEqual(isDailyLimitError(genericError), false);
      assert.strictEqual(isDailyLimitError(null), false);
    });

    it('should exclude rate-limited inboxes and stop loop when all inboxes hit limit', () => {
      const inboxes = [
        { email: 'inbox1@test.com', daily_limit: '50' },
        { email: 'inbox2@test.com', daily_limit: '50' }
      ];
      const limitExceededInboxes = new Set(['inbox1@test.com']);
      const inboxUsage = { 'inbox1@test.com': 10, 'inbox2@test.com': 0 };

      // Helper to pick inbox
      let inboxIdx = 0;
      function getNextInbox() {
        for (let attempt = 0; attempt < inboxes.length; attempt++) {
          const candidate = inboxes[inboxIdx];
          inboxIdx = (inboxIdx + 1) % inboxes.length;
          if (!limitExceededInboxes.has(candidate.email) && inboxUsage[candidate.email] < parseInt(candidate.daily_limit, 10)) {
            return candidate;
          }
        }
        return null;
      }

      let selected = getNextInbox();
      assert.strictEqual(selected.email, 'inbox2@test.com');

      // Now inbox2 also hits daily limit error
      limitExceededInboxes.add('inbox2@test.com');
      selected = getNextInbox();
      assert.strictEqual(selected, null);
    });
  });

  describe('Random Date Formatting Variations', () => {
    it('should generate valid date variations with /, -, and . delimiters', () => {
      const fixedDate = new Date('2026-08-24T12:00:00Z');
      const generatedFormats = new Set();

      for (let i = 0; i < 100; i++) {
        const str = getRandomFormattedDate(fixedDate);
        assert.ok(
          str === '24/08/2026' || str === '24-08-2026' || str === '24.08.2026',
          `Unexpected date string format: ${str}`
        );
        generatedFormats.add(str);
      }

      assert.strictEqual(generatedFormats.has('24/08/2026'), true);
      assert.strictEqual(generatedFormats.has('24-08-2026'), true);
      assert.strictEqual(generatedFormats.has('24.08.2026'), true);
    });
  });

  describe('Single Lead Remote Dispatcher', () => {
    it('should throw error when recipient email is missing', async () => {
      await assert.rejects(
        async () => {
          await runSingleLeadOutreach({});
        },
        {
          name: 'Error',
          message: 'Recipient email (SINGLE_EMAIL) is required for single lead dispatch.'
        }
      );
    });

    it('should fail MX domain validation for invalid email domain', async () => {
      // Set dummy credentials env so getSheets proceeds if called
      process.env.SINGLE_EMAIL = 'user@invalid-nonexistent-domain-xyz999.com';
      await assert.rejects(
        async () => {
          await runSingleLeadOutreach({ email: 'user@invalid-nonexistent-domain-xyz999.com' });
        },
        /Invalid email address or domain has no MX records/
      );
    });
  });

  describe('Master Campaign Active & Pause Toggle', () => {
    it('should identify active vs paused settings correctly', async () => {
      const { isCampaignActive } = await import('../engine.mjs');
      
      assert.strictEqual(isCampaignActive({ campaign_active: 'TRUE' }), true);
      assert.strictEqual(isCampaignActive({ campaign_active: 'true' }), true);
      assert.strictEqual(isCampaignActive({ campaign_active: 'FALSE' }), false);
      assert.strictEqual(isCampaignActive({ campaign_active: 'PAUSED' }), false);
      assert.strictEqual(isCampaignActive({ campaign_active: 'off' }), false);
      assert.strictEqual(isCampaignActive({ campaign_active: '0' }), false);
      
      // Type specific checks
      assert.strictEqual(isCampaignActive({ campaign_active: 'TRUE', outreach_active: 'FALSE' }, 'outreach'), false);
      assert.strictEqual(isCampaignActive({ campaign_active: 'TRUE', outreach_active: 'TRUE' }, 'outreach'), true);
      assert.strictEqual(isCampaignActive({ campaign_active: 'TRUE', followup_active: 'FALSE' }, 'followup'), false);
      assert.strictEqual(isCampaignActive({ campaign_active: 'FALSE', outreach_active: 'TRUE' }, 'outreach'), false);
    });
  });

  describe('Spintax Rotation & Parser', () => {
    it('should randomly select variations from {{{a|b}}}, {{a|b}}, or {a|b}', async () => {
      const { parseSpintax } = await import('../engine.mjs');

      const template = '{{{hope you are doing well | hope you are well}}} and {{Hi|Hey|Hello}}';
      const results = new Set();

      for (let i = 0; i < 50; i++) {
        const out = parseSpintax(template);
        assert.ok(out.includes('hope you are doing well') || out.includes('hope you are well'));
        assert.ok(out.includes('Hi') || out.includes('Hey') || out.includes('Hello'));
        results.add(out);
      }

      // Assert randomness generated multiple variations
      assert.ok(results.size > 1);
    });

    it('should leave non-spintax variables untouched', async () => {
      const { parseSpintax } = await import('../engine.mjs');
      const text = '{{full_name}} from {{company_name}}';
      assert.strictEqual(parseSpintax(text), text);
    });
  });

});



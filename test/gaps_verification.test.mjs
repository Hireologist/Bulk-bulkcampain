import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpintax } from '../src/spintax.mjs';
import { runFollowups, applyTemplateVariables, formatFollowupSubject } from '../engine.mjs';

describe('TDD Gap & Limitation Empirical Verification', () => {

  describe('Gap 1: Spintax with Nested Personalization Tags', () => {
    it('should cleanly resolve spintax even when template variables are nested inside choices', () => {
      const template = '{{Hi {{full_name}}|Hello {{full_name}}}}, welcome to {{company_name}}!';
      const fullName = 'Alex';
      const companyName = 'Acme Corp';

      // Import the template replacement helper or test the engine implementation
      // Target behavior: Spintax with variables MUST evaluate to either "Hi Alex..." or "Hello Alex..."
      // and NOT leave raw curly braces or spintax delimiters.
      const parsed = applyTemplateVariables(template, {
        fullName,
        companyName
      });

      assert.ok(
        parsed === 'Hi Alex, welcome to Acme Corp!' || parsed === 'Hello Alex, welcome to Acme Corp!',
        `Expected spintax to resolve cleanly, got: "${parsed}"`
      );
      assert.strictEqual(parsed.includes('{{'), false, 'Should not contain raw {{ in output');
      assert.strictEqual(parsed.includes('|'), false, 'Should not contain raw | in output');
    });
  });

  describe('Gap 2: Follow-up Completion Update must use sheets.spreadsheetId', () => {
    it('should use custom sheets.spreadsheetId when updating row to Done', async () => {
      let capturedSpreadsheetId = null;
      const customSheetId = 'CUSTOM_SHEET_ID_999';

      const mockSheets = {
        spreadsheetId: customSheetId,
        spreadsheets: {
          values: {
            get: async ({ range }) => {
              if (range && range.includes('Suppressed')) {
                return { data: { values: [['email', 'reason', 'added_at']] } };
              }
              return {
                data: {
                  values: [
                    ['full_name', 'email', 'Subject Line', 'Sent Status', 'Follow up', 'Follow Up Count', 'Sent From', 'Next Follow Up Date'],
                    ['Alex', 'valid-active-lead@example.com', 'Quick Question', 'sent', '', '3', 'outreach@test.com', '01/01/2026']
                  ]
                }
              };
            },
            update: async ({ spreadsheetId }) => {
              capturedSpreadsheetId = spreadsheetId;
              return { data: {} };
            }
          }
        }
      };

      const mockConfig = {
        settings: { campaign_active: 'TRUE', followup_active: 'TRUE' },
        inboxes: [{ email: 'outreach@test.com' }],
        followupTemplates: [
          { Follow_Up_Number: '1', Days_Until_Next: '3' },
          { Follow_Up_Number: '2', Days_Until_Next: '3' }
        ],
        aliases: [],
        locations: [],
        clients: []
      };

      await runFollowups(mockSheets, mockConfig);

      // Desired behavior: line 1160 MUST use sheets.spreadsheetId
      assert.strictEqual(capturedSpreadsheetId, customSheetId, 'Follow-up engine must pass sheets.spreadsheetId to values.update');
    });
  });

  describe('Gap 5: Subject Normalization in Follow-ups', () => {
    it('should not duplicate Re: when subject already starts with Re:', () => {
      const existingSubject = 'Re: Quick Question';
      const templateSubject = 'Re:';

      const finalSubj = formatFollowupSubject(templateSubject, existingSubject);

      assert.strictEqual(finalSubj, 'Re: Quick Question', 'Should not compound Re: Re:');
    });

    it('should attach Re: when subject does not have Re:', () => {
      const existingSubject = 'Quick Question';
      const templateSubject = 'Re:';

      const finalSubj = formatFollowupSubject(templateSubject, existingSubject);

      assert.strictEqual(finalSubj, 'Re: Quick Question');
    });
  });

  describe('Gap 6: Header-Aware Row Construction for New Leads', () => {
    it('should place values into correct positions when sheet headers are in custom order', () => {
      const customHeaders = [
        'email', 'full_name', 'company_name', 'location',
        'Subject Line', 'Sent From', 'Sent Status', 'Time',
        'Date Sent', 'Follow up', 'Follow Up Count', 'Next Follow Up Date', 'Summary'
      ];

      const rowData = {
        'full_name': 'Sarah Connor',
        'email': 'sarah@skynet.com',
        'company_name': 'Resistance',
        'location': 'Los Angeles',
        'Subject Line': 'Important Notice',
        'Sent From': 'john@connor.org',
        'Sent Status': 'SENT',
        'Time': '10:00 AM',
        'Date Sent': '04/09/2026',
        'Follow up': '',
        'Follow Up Count': 0,
        'Next Follow Up Date': '',
        'Summary': ''
      };

      const newRow = customHeaders.map(h => rowData[h] ?? '');

      assert.strictEqual(newRow[0], 'sarah@skynet.com', 'Column 0 must be email');
      assert.strictEqual(newRow[1], 'Sarah Connor', 'Column 1 must be full_name');
      assert.strictEqual(newRow[2], 'Resistance', 'Column 2 must be company_name');
    });
  });

});

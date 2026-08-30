import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { columnIndexToLetter, auditAndRepairSheetSchema } from '../scripts/run-campaign-diagnostics.mjs';
import { COMPLETE_SCHEMA } from '../scripts/auto-setup.mjs';

describe('🩺 Sheet Schema & Column Integrity Verification Test Suite', () => {

  describe('Column Index to A1 Notation Converter', () => {
    test('converts numeric indices to exact spreadsheet column letters', () => {
      assert.strictEqual(columnIndexToLetter(1), 'A');
      assert.strictEqual(columnIndexToLetter(2), 'B');
      assert.strictEqual(columnIndexToLetter(13), 'M');
      assert.strictEqual(columnIndexToLetter(14), 'N');
      assert.strictEqual(columnIndexToLetter(26), 'Z');
      assert.strictEqual(columnIndexToLetter(27), 'AA');
      assert.strictEqual(columnIndexToLetter(28), 'AB');
      assert.strictEqual(columnIndexToLetter(52), 'AZ');
      assert.strictEqual(columnIndexToLetter(53), 'BA');
    });
  });

  describe('Full Schema Audit & Column Verification Logic', () => {
    test('passes 100% when all tabs, columns, and settings keys match COMPLETE_SCHEMA', async () => {
      const mockMeta = {
        data: {
          sheets: Object.keys(COMPLETE_SCHEMA).map((title, idx) => ({
            properties: { sheetId: idx + 1, title }
          }))
        }
      };

      const mockSheets = {
        spreadsheets: {
          values: {
            get: async ({ range }) => {
              for (const [tabName, config] of Object.entries(COMPLETE_SCHEMA)) {
                if (range.startsWith(`'${tabName}'!1:1`)) {
                  return { data: { values: [config.headers] } };
                }
              }
              if (range.startsWith("'Settings'!A2:A")) {
                return {
                  data: {
                    values: COMPLETE_SCHEMA['Settings'].sampleData.map(r => [r[0]])
                  }
                };
              }
              return { data: { values: [] } };
            }
          }
        }
      };

      const results = await auditAndRepairSheetSchema(mockSheets, 'mock-sheet-id', mockMeta, { autoRepair: false });

      assert.strictEqual(results.missingTabs.length, 0);
      assert.strictEqual(results.missingColumns.length, 0);
      assert.strictEqual(results.missingSettings.length, 0);
      assert.strictEqual(results.tabsChecked, Object.keys(COMPLETE_SCHEMA).length);
      assert.ok(results.columnsVerified > 40);
    });

    test('detects missing columns and accurately identifies target column letters and positions', async () => {
      const mockMeta = {
        data: {
          sheets: Object.keys(COMPLETE_SCHEMA).map((title, idx) => ({
            properties: { sheetId: idx + 1, title }
          }))
        }
      };

      // Incomplete headers for Details tab (missing 'Summary' and 'Next Follow Up Date')
      const incompleteDetailsHeaders = [
        'full_name', 'email', 'company_name', 'location', 
        'Subject Line', 'Sent From', 'Sent Status', 'Time', 
        'Date Sent', 'Follow up', 'Follow Up Count'
      ];

      const mockSheets = {
        spreadsheets: {
          values: {
            get: async ({ range }) => {
              if (range.startsWith("'Details'!1:1")) {
                return { data: { values: [incompleteDetailsHeaders] } };
              }
              for (const [tabName, config] of Object.entries(COMPLETE_SCHEMA)) {
                if (range.startsWith(`'${tabName}'!1:1`)) {
                  return { data: { values: [config.headers] } };
                }
              }
              if (range.startsWith("'Settings'!A2:A")) {
                return { data: { values: COMPLETE_SCHEMA['Settings'].sampleData.map(r => [r[0]]) } };
              }
              return { data: { values: [] } };
            }
          }
        }
      };

      const results = await auditAndRepairSheetSchema(mockSheets, 'mock-sheet-id', mockMeta, { autoRepair: false });

      assert.strictEqual(results.missingColumns.length, 1);
      const detailsIssue = results.missingColumns.find(c => c.tab === 'Details');
      assert.ok(detailsIssue);
      assert.ok(detailsIssue.missing.includes('Next Follow Up Date'));
      assert.ok(detailsIssue.missing.includes('Summary'));
      assert.strictEqual(detailsIssue.startColLetter, 'L');
      assert.strictEqual(detailsIssue.endColLetter, 'M');
      assert.strictEqual(detailsIssue.suggestedPosition, "'Details'!L1:M1");
    });

    test('auto-repairs missing columns by appending them to Row 1', async () => {
      const mockMeta = {
        data: {
          sheets: Object.keys(COMPLETE_SCHEMA).map((title, idx) => ({
            properties: { sheetId: idx + 1, title }
          }))
        }
      };

      const incompleteAliasesHeaders = ['alias_email', 'display_name', 'is_active']; // missing 'inbox_email'
      const updates = [];

      const mockSheets = {
        spreadsheets: {
          values: {
            get: async ({ range }) => {
              if (range.startsWith("'Aliases'!1:1")) {
                return { data: { values: [incompleteAliasesHeaders] } };
              }
              for (const [tabName, config] of Object.entries(COMPLETE_SCHEMA)) {
                if (range.startsWith(`'${tabName}'!1:1`)) {
                  return { data: { values: [config.headers] } };
                }
              }
              if (range.startsWith("'Settings'!A2:A")) {
                return { data: { values: COMPLETE_SCHEMA['Settings'].sampleData.map(r => [r[0]]) } };
              }
              return { data: { values: [] } };
            },
            update: async (payload) => {
              updates.push(payload);
              return { data: {} };
            }
          }
        }
      };

      const results = await auditAndRepairSheetSchema(mockSheets, 'mock-sheet-id', mockMeta, { autoRepair: true });

      assert.strictEqual(results.repairedColumns.length, 1);
      assert.strictEqual(results.repairedColumns[0].tab, 'Aliases');
      assert.deepStrictEqual(results.repairedColumns[0].columns, ['inbox_email']);
      assert.strictEqual(results.repairedColumns[0].range, "'Aliases'!D1:D1");

      assert.strictEqual(updates.length, 1);
      assert.strictEqual(updates[0].range, "'Aliases'!D1:D1");
      assert.deepStrictEqual(updates[0].requestBody.values, [['inbox_email']]);
    });

    test('detects and auto-repairs missing Settings keys without touching existing keys', async () => {
      const mockMeta = {
        data: {
          sheets: Object.keys(COMPLETE_SCHEMA).map((title, idx) => ({
            properties: { sheetId: idx + 1, title }
          }))
        }
      };

      // Existing settings missing unsubscribe_url and groq_api_key
      const existingKeys = [
        ['min_delay_seconds'], ['max_delay_seconds'], ['campaign_active'],
        ['business_name'], ['business_address']
      ];

      const appends = [];

      const mockSheets = {
        spreadsheets: {
          values: {
            get: async ({ range }) => {
              for (const [tabName, config] of Object.entries(COMPLETE_SCHEMA)) {
                if (range.startsWith(`'${tabName}'!1:1`)) {
                  return { data: { values: [config.headers] } };
                }
              }
              if (range.startsWith("'Settings'!A2:A")) {
                return { data: { values: existingKeys } };
              }
              return { data: { values: [] } };
            },
            append: async (payload) => {
              appends.push(payload);
              return { data: {} };
            }
          }
        }
      };

      const results = await auditAndRepairSheetSchema(mockSheets, 'mock-sheet-id', mockMeta, { autoRepair: true });

      assert.ok(results.missingSettings.includes('unsubscribe_url'));
      assert.ok(results.missingSettings.includes('groq_api_key'));
      assert.ok(results.repairedSettings.includes('unsubscribe_url'));
      assert.ok(results.repairedSettings.includes('groq_api_key'));

      assert.strictEqual(appends.length, 1);
      assert.strictEqual(appends[0].range, "'Settings'!A:C");
      const appendedKeyNames = appends[0].requestBody.values.map(r => r[0]);
      assert.ok(appendedKeyNames.includes('unsubscribe_url'));
      assert.ok(appendedKeyNames.includes('groq_api_key'));
    });

    test('verifies Code.gs and auto-setup.mjs schemas are 100% synchronized', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const codeGsContent = fs.readFileSync(path.resolve('apps-script/Code.gs'), 'utf-8');

      // Verify every tab defined in COMPLETE_SCHEMA is present in Code.gs
      for (const [tabName, config] of Object.entries(COMPLETE_SCHEMA)) {
        assert.ok(codeGsContent.includes(`'${tabName}'`), `Code.gs is missing tab definition for "${tabName}"`);
        for (const header of config.headers) {
          assert.ok(codeGsContent.includes(`'${header}'`) || codeGsContent.includes(`"${header}"`), 
            `Code.gs is missing header "${header}" for tab "${tabName}"`);
        }
      }

      // Verify all settings keys are present in Code.gs
      const settingsKeys = COMPLETE_SCHEMA['Settings'].sampleData.map(r => r[0]);
      for (const key of settingsKeys) {
        assert.ok(codeGsContent.includes(`'${key}'`), `Code.gs is missing settings key "${key}"`);
      }
    });
  });
});

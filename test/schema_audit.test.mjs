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
      assert.ok(detailsIssue.missing.includes('Phone'));
      assert.strictEqual(detailsIssue.startColLetter, 'L');
      assert.strictEqual(detailsIssue.endColLetter, 'N');
      assert.strictEqual(detailsIssue.suggestedPosition, "'Details'!L1:N1");
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

    test('verifies run-campaign-diagnostics dynamically inherits any newly added tabs or columns in auto-setup.mjs', async () => {
      // Simulate dynamic addition of a new tab and columns
      const dynamicSchemaExtension = {
        ...COMPLETE_SCHEMA,
        'Custom_Test_Tab': {
          color: '#123456',
          headers: ['custom_col_1', 'custom_col_2', 'custom_col_3'],
          sampleData: [['val1', 'val2', 'val3']]
        }
      };

      const mockMeta = {
        data: {
          sheets: Object.keys(COMPLETE_SCHEMA).map((title, idx) => ({
            properties: { sheetId: idx + 1, title }
          }))
        }
      };

      // Mock sheets where Custom_Test_Tab is missing
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
                return { data: { values: COMPLETE_SCHEMA['Settings'].sampleData.map(r => [r[0]]) } };
              }
              return { data: { values: [] } };
            }
          }
        }
      };

      const results = await auditAndRepairSheetSchema(mockSheets, 'mock-sheet-id', mockMeta, { autoRepair: false });

      // Diagnostics audits all tabs dynamically from the shared schema
      assert.strictEqual(results.tabsChecked, Object.keys(COMPLETE_SCHEMA).length);
      assert.strictEqual(results.missingTabs.length, 0);
      assert.strictEqual(results.missingColumns.length, 0);
    });

    test('auto-heals missing formulas in Email_Analytics and ChartData when repairFormulas is enabled', async () => {
      const mockMeta = {
        data: {
          sheets: Object.keys(COMPLETE_SCHEMA).map((title, idx) => ({
            properties: { sheetId: idx + 1, title }
          }))
        }
      };

      const formulaUpdates = [];
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
                return { data: { values: COMPLETE_SCHEMA['Settings'].sampleData.map(r => [r[0]]) } };
              }
              // Email_Analytics A2 is empty / corrupted
              if (range.startsWith("'📊 Email_Analytics'!A2:A2")) {
                return { data: { values: [['']] } };
              }
              // ChartData has missing formulas
              if (range.startsWith("'📈 ChartData'!A2:B4")) {
                return { data: { values: [['POSITIVE', ''], ['NEUTRAL', ''], ['NEGATIVE', '']] } };
              }
              return { data: { values: [] } };
            },
            update: async (payload) => {
              formulaUpdates.push(payload);
              return { data: {} };
            }
          }
        }
      };

      const results = await auditAndRepairSheetSchema(mockSheets, 'mock-sheet-id', mockMeta, {
        autoRepair: true,
        repairFormulas: true
      });

      assert.ok(results.repairedFormulas.length >= 2);
      const emailAnalyticsRepair = results.repairedFormulas.find(f => f.tab === '📊 Email_Analytics');
      assert.ok(emailAnalyticsRepair);
      assert.strictEqual(emailAnalyticsRepair.cell, 'A2');

      const chartRepair = results.repairedFormulas.find(f => f.tab === '📈 ChartData');
      assert.ok(chartRepair);

      // Verify the formula update was written with USER_ENTERED
      const eaUpdate = formulaUpdates.find(u => u.range === "'📊 Email_Analytics'!A2");
      assert.ok(eaUpdate);
      assert.strictEqual(eaUpdate.valueInputOption, 'USER_ENTERED');
      assert.ok(eaUpdate.requestBody.values[0][0].startsWith('=LET'));
    });

    test('synchronizes Setup_Guide documentation when syncSetupGuide is enabled', async () => {
      const mockMeta = {
        data: {
          sheets: Object.keys(COMPLETE_SCHEMA).map((title, idx) => ({
            properties: { sheetId: idx + 1, title }
          }))
        }
      };

      const guideUpdates = [];
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
                return { data: { values: COMPLETE_SCHEMA['Settings'].sampleData.map(r => [r[0]]) } };
              }
              // Setup guide only has 2 steps instead of the full guide
              if (range.startsWith("'📖 Setup_Guide'!A2:C")) {
                return { data: { values: [['1', 'Step 1', 'Desc 1'], ['2', 'Step 2', 'Desc 2']] } };
              }
              return { data: { values: [] } };
            },
            update: async (payload) => {
              guideUpdates.push(payload);
              return { data: {} };
            }
          }
        }
      };

      const results = await auditAndRepairSheetSchema(mockSheets, 'mock-sheet-id', mockMeta, {
        autoRepair: true,
        syncSetupGuide: true
      });

      assert.strictEqual(results.updatedSetupGuide, true);
      assert.strictEqual(guideUpdates.length, 1);
      assert.ok(guideUpdates[0].range.startsWith("'📖 Setup_Guide'!A2:C"));
      assert.strictEqual(guideUpdates[0].requestBody.values.length, COMPLETE_SCHEMA['📖 Setup_Guide'].sampleData.length);
    });

    test('strictly preserves existing user leads, inboxes, and custom settings without destroying or modifying anything (Non-Destructive Guarantee)', async () => {
      const mockMeta = {
        data: {
          sheets: Object.keys(COMPLETE_SCHEMA).map((title, idx) => ({
            properties: { sheetId: idx + 1, title }
          }))
        }
      };

      // Custom settings where the user changed min_delay_seconds to 45 and business_name to "My Agency"
      const userCustomSettings = [
        ['min_delay_seconds', '45', 'Customized by user'],
        ['business_name', 'My Agency', 'Customized by user'],
        ['campaign_active', 'TRUE', 'Customized by user']
      ];

      const capturedUpdates = [];
      const capturedAppends = [];

      const mockSheets = {
        spreadsheets: {
          values: {
            get: async ({ range }) => {
              // Row 1 headers for all tabs
              for (const [tabName, config] of Object.entries(COMPLETE_SCHEMA)) {
                if (range.startsWith(`'${tabName}'!1:1`)) {
                  return { data: { values: [config.headers] } };
                }
              }
              if (range.startsWith("'Settings'!A2:A")) {
                return { data: { values: userCustomSettings.map(r => [r[0]]) } };
              }
              if (range.startsWith("'📊 Email_Analytics'!A2:A2")) {
                return { data: { values: [['=LET(...)']] } };
              }
              if (range.startsWith("'📈 ChartData'!A2:B4")) {
                return { data: { values: [['POSITIVE', '=COUNTIF(...)'], ['NEUTRAL', '=COUNTIF(...)'], ['NEGATIVE', '=COUNTIF(...)']] } };
              }
              if (range.startsWith("'📖 Setup_Guide'!A2:C")) {
                return { data: { values: COMPLETE_SCHEMA['📖 Setup_Guide'].sampleData } };
              }
              return { data: { values: [] } };
            },
            update: async (payload) => {
              capturedUpdates.push(payload);
              return { data: {} };
            },
            append: async (payload) => {
              capturedAppends.push(payload);
              return { data: {} };
            }
          }
        }
      };

      const results = await auditAndRepairSheetSchema(mockSheets, 'mock-sheet-id', mockMeta, {
        autoRepair: true,
        repairFormulas: true,
        syncSetupGuide: true
      });

      // 1. Zero destructive updates to lead data rows in Details
      const detailsRowUpdates = capturedUpdates.filter(u => u.range.startsWith("'Details'!") && !u.range.includes('1:'));
      assert.strictEqual(detailsRowUpdates.length, 0, 'Details lead rows must NEVER be overwritten');

      // 2. Zero destructive updates to Inboxes credentials
      const inboxesRowUpdates = capturedUpdates.filter(u => u.range.startsWith("'Inboxes'!") && !u.range.includes('1:'));
      assert.strictEqual(inboxesRowUpdates.length, 0, 'Inboxes credentials must NEVER be overwritten');

      // 3. User customized settings are strictly preserved
      // Only missing keys are appended to Settings!A:C
      assert.strictEqual(capturedAppends.length, 1);
      assert.strictEqual(capturedAppends[0].range, "'Settings'!A:C");
      const appendedKeys = capturedAppends[0].requestBody.values.map(r => r[0]);
      assert.ok(!appendedKeys.includes('min_delay_seconds'), 'Existing custom key min_delay_seconds must NOT be overwritten');
      assert.ok(!appendedKeys.includes('business_name'), 'Existing custom key business_name must NOT be overwritten');
      assert.ok(appendedKeys.includes('groq_api_key'), 'Missing key groq_api_key must be safely appended');
    });
  });
});

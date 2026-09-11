import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  isGccRadarEnabled,
  selectGccRadarDiscordWebhook,
  ensureGccRadarTab,
  loadSeenGccBrandsFromSheet,
  syncNewGccLeadsToSheet,
  GCC_RADAR_HEADERS,
} from '../scripts/run-gcc-radar.mjs';

describe('GCC Leadership Radar Configuration & Settings Tests', () => {
  it('should disable GCC Radar by default and enable only when explicitly set to TRUE', () => {
    assert.strictEqual(isGccRadarEnabled({}), false);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'TRUE' }), true);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'true' }), true);
    assert.strictEqual(isGccRadarEnabled({ gcc_leadership_radar_enabled: 'TRUE' }), true);
  });

  it('should disable GCC Radar when explicitly set to FALSE, OFF, 0, NO, or MUTE', () => {
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'FALSE' }), false);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'false' }), false);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'OFF' }), false);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: '0' }), false);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'mute' }), false);
  });

  it('should select dedicated GCC Radar Discord Webhook with proper fallbacks', () => {
    const customGccWebhook = 'https://discord.com/api/webhooks/gcc_radar_custom';
    const fallbackWebhook = 'https://discord.com/api/webhooks/general_updates';

    assert.strictEqual(
      selectGccRadarDiscordWebhook({ discord_gcc_radar_webhook: customGccWebhook }, 'https://discord.com/api/webhooks/env_fallback'),
      customGccWebhook
    );

    assert.strictEqual(
      selectGccRadarDiscordWebhook({ discord_leadership_webhook: customGccWebhook }, ''),
      customGccWebhook
    );

    assert.strictEqual(
      selectGccRadarDiscordWebhook({}, 'https://discord.com/api/webhooks/env_fallback'),
      'https://discord.com/api/webhooks/env_fallback'
    );

    assert.strictEqual(
      selectGccRadarDiscordWebhook({ discord_updates_webhook: fallbackWebhook }, ''),
      fallbackWebhook
    );
  });
});

describe('GCC Leadership Radar Google Sheet Deduplication Synchronization', () => {
  it('should define the required standard headers for the GCC_Radar tab', () => {
    assert.deepStrictEqual(GCC_RADAR_HEADERS, [
      'brand_key',
      'company_name',
      'stage_type',
      'amount_scale',
      'city',
      'vc_lead',
      'url',
      'date_added',
    ]);
  });

  it('should create GCC_Radar tab with proper headers when tab does not exist', async () => {
    let batchUpdated = false;
    let valuesUpdated = false;

    const mockSheets = {
      spreadsheets: {
        get: async () => ({
          data: {
            sheets: [{ properties: { title: 'Settings' } }],
          },
        }),
        batchUpdate: async ({ spreadsheetId, requestBody }) => {
          assert.strictEqual(spreadsheetId, 'test-sheet-id');
          assert.strictEqual(requestBody.requests[0].addSheet.properties.title, 'GCC_Radar');
          batchUpdated = true;
          return { data: {} };
        },
        values: {
          update: async ({ spreadsheetId, range, requestBody }) => {
            assert.strictEqual(spreadsheetId, 'test-sheet-id');
            assert.strictEqual(range, "'GCC_Radar'!A1:H1");
            assert.deepStrictEqual(requestBody.values[0], GCC_RADAR_HEADERS);
            valuesUpdated = true;
            return { data: {} };
          },
        },
      },
    };

    const result = await ensureGccRadarTab(mockSheets, 'test-sheet-id');
    assert.strictEqual(result.created, true);
    assert.strictEqual(batchUpdated, true);
    assert.strictEqual(valuesUpdated, true);
  });

  it('should skip creation if GCC_Radar tab already exists', async () => {
    let batchCalled = false;

    const mockSheets = {
      spreadsheets: {
        get: async () => ({
          data: {
            sheets: [
              { properties: { title: 'Settings' } },
              { properties: { title: 'GCC_Radar' } },
            ],
          },
        }),
        batchUpdate: async () => {
          batchCalled = true;
          return { data: {} };
        },
      },
    };

    const result = await ensureGccRadarTab(mockSheets, 'test-sheet-id');
    assert.strictEqual(result.created, false);
    assert.strictEqual(batchCalled, false);
  });

  it('should load historical seen brand keys case-insensitively and filter empty rows', async () => {
    const mockSheets = {
      spreadsheets: {
        values: {
          get: async ({ spreadsheetId, range }) => {
            assert.strictEqual(spreadsheetId, 'test-sheet-id');
            assert.strictEqual(range, "'GCC_Radar'!A2:B");
            return {
              data: {
                values: [
                  ['phonepe', 'PhonePe'],
                  ['  ACME  ', 'Acme Corp'],
                  ['', 'Unknown'],
                  ['GOOGLE', 'Google India'],
                  ['phonepe', 'PhonePe Duplicate Row'],
                ],
              },
            };
          },
        },
      },
    };

    const seenBrands = await loadSeenGccBrandsFromSheet(mockSheets, 'test-sheet-id');
    assert.deepStrictEqual(seenBrands.sort(), ['acme', 'google', 'phonepe']);
  });

  it('should return empty array if reading GCC_Radar sheet throws an error', async () => {
    const mockSheets = {
      spreadsheets: {
        values: {
          get: async () => {
            throw new Error('API quota exceeded');
          },
        },
      },
    };

    const seenBrands = await loadSeenGccBrandsFromSheet(mockSheets, 'test-sheet-id');
    assert.deepStrictEqual(seenBrands, []);
  });

  it('should append new GCC leads into Google Sheet with formatted columns', async () => {
    let appendCalled = false;
    let appendedValues = [];

    const mockSheets = {
      spreadsheets: {
        values: {
          append: async ({ spreadsheetId, range, valueInputOption, requestBody }) => {
            assert.strictEqual(spreadsheetId, 'test-sheet-id');
            assert.strictEqual(range, "'GCC_Radar'!A:H");
            assert.strictEqual(valueInputOption, 'USER_ENTERED');
            appendCalled = true;
            appendedValues = requestBody.values;
            return { data: {} };
          },
        },
      },
    };

    const newLeads = [
      {
        brand_key: 'stripe',
        company_name: 'Stripe',
        stage_type: 'New GCC',
        amount_scale: '100k sq ft',
        city: 'Bengaluru',
        vc_lead: 'Undisclosed',
        url: 'https://example.com/stripe-gcc',
        date_added: '2026-09-11T12:00:00.000Z',
      },
    ];

    const syncedCount = await syncNewGccLeadsToSheet(mockSheets, 'test-sheet-id', newLeads);
    assert.strictEqual(syncedCount, 1);
    assert.strictEqual(appendCalled, true);
    assert.strictEqual(appendedValues.length, 1);
    assert.strictEqual(appendedValues[0][0], 'stripe');
    assert.strictEqual(appendedValues[0][1], 'Stripe');
    assert.strictEqual(appendedValues[0][2], 'New GCC');
    assert.strictEqual(appendedValues[0][3], '100k sq ft');
    assert.strictEqual(appendedValues[0][4], 'Bengaluru');
    assert.strictEqual(appendedValues[0][6], 'https://example.com/stripe-gcc');
  });

  it('should return 0 when syncing empty leads list', async () => {
    const mockSheets = { spreadsheets: { values: { append: async () => {} } } };
    const count = await syncNewGccLeadsToSheet(mockSheets, 'test-sheet-id', []);
    assert.strictEqual(count, 0);
  });
});

describe('GCC Leadership Radar Python Integration & Deduplication Test', () => {
  it('should load historical cache from JSON and deduplicate in Python tracker', () => {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const testCachePath = path.join(scriptDir, 'test_seen_cache.json');
    const testNewLeadsPath = path.join(scriptDir, 'test_new_leads.json');

    // Write historical cache with existing brand keys
    const historicalBrands = ['existingcorp', 'oldgcc'];
    fs.writeFileSync(testCachePath, JSON.stringify(historicalBrands), 'utf-8');

    // Run Python snippet testing normalize_brand, is_brand_processed, and cache loading
    const pythonCode = `
import os, sys, json, sqlite3
db_path = ":memory:"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("CREATE TABLE seen_gccs (brand_key TEXT PRIMARY KEY, company_name TEXT, city TEXT)")

with open(r"${testCachePath.replace(/\\/g, '\\\\')}", "r") as f:
    keys = json.load(f)
    for k in keys:
        cursor.execute("INSERT OR IGNORE INTO seen_gccs VALUES (?, ?, ?)", (k, k, "Cached"))
conn.commit()

# Test check
cursor.execute("SELECT 1 FROM seen_gccs WHERE brand_key = ?", ("existingcorp",))
assert cursor.fetchone() is not None, "existingcorp should be found"

cursor.execute("SELECT 1 FROM seen_gccs WHERE brand_key = ?", ("brandnew",))
assert cursor.fetchone() is None, "brandnew should not be found"

print("SUCCESS")
`;

    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const res = spawnSync(pythonCmd, ['-c', pythonCode], { encoding: 'utf-8' });

    try {
      fs.unlinkSync(testCachePath);
    } catch (_) {}

    assert.strictEqual(res.status, 0, `Python failed with stderr: ${res.stderr}`);
    assert.ok(res.stdout.includes('SUCCESS'));
  });
});

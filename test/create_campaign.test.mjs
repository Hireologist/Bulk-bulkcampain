import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, runPreflightChecks, loadSettingsFromMainSheet } from '../scripts/create-new-campaign.mjs';

describe('Create New Campaign Module Unit Tests', () => {
  test('slugify cleans and formats campaign names correctly', () => {
    assert.strictEqual(slugify('US Tech Recruiting'), 'us_tech_recruiting');
    assert.strictEqual(slugify('Hireologist - UK & Europe (2026)!'), 'hireologist_uk_europe_2026');
    assert.strictEqual(slugify('   SaaS_Founders---V1   '), 'saas_founders_v1');
    assert.strictEqual(slugify(''), 'custom_campaign');
    assert.strictEqual(slugify('___special___'), 'special');
  });

  test('loadSettingsFromMainSheet parses key-value rows correctly', async () => {
    const mockSheetsClient = {
      spreadsheets: {
        values: {
          get: async () => ({
            data: {
              values: [
                ['cron_api_key', 'cron_test_123', 'API Key'],
                ['cron_timezone', 'America/New_York', 'Timezone'],
                ['discord_updates_webhook', 'https://discord.com/api/webhooks/test', 'Discord'],
                ['groq_api_key', 'gsk_mock123', 'Groq Key']
              ]
            }
          })
        }
      }
    };

    const settings = await loadSettingsFromMainSheet(mockSheetsClient, 'mock_sheet_id');
    assert.strictEqual(settings.cron_api_key, 'cron_test_123');
    assert.strictEqual(settings.cron_timezone, 'America/New_York');
    assert.strictEqual(settings.discord_updates_webhook, 'https://discord.com/api/webhooks/test');
    assert.strictEqual(settings.groq_api_key, 'gsk_mock123');
  });

  test('loadSettingsFromMainSheet returns empty object when sheetId is empty or fails', async () => {
    const emptySettings = await loadSettingsFromMainSheet(null, '');
    assert.deepStrictEqual(emptySettings, {});

    const failingClient = {
      spreadsheets: {
        values: {
          get: async () => {
            throw new Error('Sheet not found');
          }
        }
      }
    };
    const failResult = await loadSettingsFromMainSheet(failingClient, 'invalid_id');
    assert.deepStrictEqual(failResult, {});
  });

  test('runPreflightChecks fails when campaign name is empty', async () => {
    await assert.rejects(
      async () => {
        await runPreflightChecks({
          campaignName: '',
          skipGoogleAuth: true,
          isCI: false
        });
      },
      {
        message: /Pre-flight validation failed/
      }
    );
  });

  test('runPreflightChecks fails in CI if GitHub PAT is missing', async () => {
    await assert.rejects(
      async () => {
        await runPreflightChecks({
          campaignName: 'Test Campaign',
          skipGoogleAuth: true,
          isCI: true,
          githubPat: ''
        });
      },
      {
        message: /Pre-flight validation failed/
      }
    );
  });

  test('runPreflightChecks succeeds when valid inputs provided and auth bypassed', async () => {
    const result = await runPreflightChecks({
      campaignName: 'Valid Tech Campaign',
      skipGoogleAuth: true,
      isCI: false
    });
    assert.strictEqual(result.valid, true);
    assert.ok(Array.isArray(result.checks));
    assert.ok(result.checks.some(c => c.name === 'Campaign Name & Slug' && c.status === 'PASS'));
  });
});



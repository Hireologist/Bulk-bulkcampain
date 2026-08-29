import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, runPreflightChecks } from '../scripts/create-new-campaign.mjs';

describe('Create New Campaign Module Unit Tests', () => {
  test('slugify cleans and formats campaign names correctly', () => {
    assert.strictEqual(slugify('US Tech Recruiting'), 'us_tech_recruiting');
    assert.strictEqual(slugify('Hireologist - UK & Europe (2026)!'), 'hireologist_uk_europe_2026');
    assert.strictEqual(slugify('   SaaS_Founders---V1   '), 'saas_founders_v1');
    assert.strictEqual(slugify(''), 'custom_campaign');
    assert.strictEqual(slugify('___special___'), 'special');
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


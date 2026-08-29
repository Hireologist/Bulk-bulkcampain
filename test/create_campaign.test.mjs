import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../scripts/create-new-campaign.mjs';

describe('Create New Campaign Module Unit Tests', () => {
  test('slugify cleans and formats campaign names correctly', () => {
    assert.strictEqual(slugify('US Tech Recruiting'), 'us_tech_recruiting');
    assert.strictEqual(slugify('Hireologist - UK & Europe (2026)!'), 'hireologist_uk_europe_2026');
    assert.strictEqual(slugify('   SaaS_Founders---V1   '), 'saas_founders_v1');
    assert.strictEqual(slugify(''), 'custom_campaign');
    assert.strictEqual(slugify('___special___'), 'special');
  });
});

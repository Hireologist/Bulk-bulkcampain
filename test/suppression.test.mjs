import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  isSuppressed,
  addToSuppression,
  clearSuppressionCache,
  buildSenderFooter,
} from '../src/suppression.mjs';

describe('Suppression & Compliance Module Unit Tests', () => {
  beforeEach(() => {
    clearSuppressionCache();
  });

  test('generates and verifies HMAC unsubscribe token', () => {
    const secret = 'super-secure-secret-key-123';
    const email = 'prospect@acme.com';
    const campaignId = 'summer_promo';

    const token = generateUnsubscribeToken(email, campaignId, secret);
    assert.ok(typeof token === 'string' && token.length === 64);

    const isValid = verifyUnsubscribeToken(email, campaignId, token, secret);
    assert.strictEqual(isValid, true);

    const isTamperedValid = verifyUnsubscribeToken('other@acme.com', campaignId, token, secret);
    assert.strictEqual(isTamperedValid, false);
  });

  test('checks suppression list with caching and case-insensitivity', async () => {
    let mockFetchCount = 0;
    const mockReadFn = async () => {
      mockFetchCount++;
      return ['optout@client.com', 'bounced@domain.org'];
    };

    // First lookup triggers read
    const res1 = await isSuppressed('OPTOUT@client.com', mockReadFn);
    assert.strictEqual(res1, true);
    assert.strictEqual(mockFetchCount, 1);

    // Second lookup uses memory cache
    const res2 = await isSuppressed('bounced@domain.org', mockReadFn);
    assert.strictEqual(res2, true);
    assert.strictEqual(mockFetchCount, 1);

    // Non-suppressed email
    const res3 = await isSuppressed('fresh@lead.com', mockReadFn);
    assert.strictEqual(res3, false);
  });

  test('addToSuppression appends row and updates in-memory cache immediately', async () => {
    let appendedRow = null;
    const mockAppendFn = async (email, reason, date) => {
      appendedRow = { email, reason, date };
    };

    await addToSuppression('lead@spamcomplaint.com', 'Spam Complaint', mockAppendFn);
    assert.strictEqual(appendedRow.email, 'lead@spamcomplaint.com');
    assert.strictEqual(appendedRow.reason, 'Spam Complaint');

    const inCache = await isSuppressed('lead@spamcomplaint.com');
    assert.strictEqual(inCache, true);
  });

  test('buildSenderFooter generates compliant HTML footer with unsubscribe URL', () => {
    const settings = {
      business_name: 'SheetBot Inc.',
      business_address: '123 Market St, San Francisco, CA',
      unsubscribe_url: 'https://mysite.com/unsubscribe',
    };
    const lead = { email: 'john@example.com', campaign: 'cold_outreach' };
    const footer = buildSenderFooter(settings, lead, 'test-secret');

    assert.ok(footer.includes('SheetBot Inc.'));
    assert.ok(footer.includes('123 Market St, San Francisco, CA'));
    assert.ok(footer.includes('https://mysite.com/unsubscribe?email=john%40example.com'));
    assert.ok(footer.includes('Unsubscribe'));
  });
});

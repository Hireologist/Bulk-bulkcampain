import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { verifyReputationCompliance, resetReputationCache } from '../src/dns-check.mjs';

describe('Reputation Shield & Policy Compliance Tests', () => {
  beforeEach(() => {
    resetReputationCache();
  });

  test('allows execution when upstream policy is ALLOW / active', async () => {
    const mockFetcher = async (url, options) => {
      return {
        status: 200,
        json: async () => ({ status: 'success', allowed: true, policy: 'ALLOW', cacheTtlHours: 4 }),
      };
    };

    const res = await verifyReputationCompliance({
      spreadsheetId: 'test-sheet-123',
      task: 'outreach',
      fetcher: mockFetcher,
    });

    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.policy, 'ALLOW');
    assert.strictEqual(res.cached, false);
  });

  test('blocks execution when upstream policy is REPUTATION_CRITICAL / DISABLED', async () => {
    const mockFetcher = async (url, options) => {
      return {
        status: 200,
        json: async () => ({
          status: 'error',
          allowed: false,
          policy: 'REPUTATION_CRITICAL',
          reason: 'Deliverability policy revoked',
        }),
      };
    };

    const res = await verifyReputationCompliance({
      spreadsheetId: 'test-sheet-banned',
      task: 'outreach',
      fetcher: mockFetcher,
    });

    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.policy, 'REPUTATION_CRITICAL');
    assert.ok(res.reason.includes('Deliverability policy revoked'));
  });

  test('fails open gracefully on network timeout or server error', async () => {
    const mockFailingFetcher = async () => {
      throw new Error('Connection timed out after 3500ms');
    };

    const res = await verifyReputationCompliance({
      spreadsheetId: 'test-sheet-network-err',
      task: 'inbox',
      fetcher: mockFailingFetcher,
    });

    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.fallback, true);
    assert.strictEqual(res.policy, 'ALLOW');
  });

  test('caches ALLOW response for subsequent calls within TTL window', async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      return {
        status: 200,
        json: async () => ({ status: 'success', allowed: true, policy: 'ALLOW', cacheTtlHours: 4 }),
      };
    };

    // First call: hits fetcher
    const res1 = await verifyReputationCompliance({
      spreadsheetId: 'test-sheet-cached',
      task: 'inbox',
      fetcher: mockFetcher,
    });
    assert.strictEqual(res1.allowed, true);
    assert.strictEqual(res1.cached, false);
    assert.strictEqual(callCount, 1);

    // Second call: served from cache without calling fetcher
    const res2 = await verifyReputationCompliance({
      spreadsheetId: 'test-sheet-cached',
      task: 'inbox',
      fetcher: mockFetcher,
    });
    assert.strictEqual(res2.allowed, true);
    assert.strictEqual(res2.cached, true);
    assert.strictEqual(callCount, 1); // Not incremented!
  });

  test('blocks execution when master rejects invalid or malformed identifier', async () => {
    const mockFetcher = async () => ({
      status: 400,
      json: async () => ({
        status: 'error',
        allowed: false,
        policy: 'INVALID_IDENTIFIER',
        reason: 'Rejected: Malformed campaign identifier.',
      }),
    });

    const res = await verifyReputationCompliance({
      spreadsheetId: 'bad_id',
      task: 'outreach',
      fetcher: mockFetcher,
    });

    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.policy, 'REPUTATION_CRITICAL');
    assert.ok(res.reason.includes('Malformed campaign identifier'));
  });
});


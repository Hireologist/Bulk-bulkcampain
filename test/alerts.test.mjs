import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { postToDiscord, alertIfUnhealthy } from '../src/alerts.mjs';

describe('Alerts Module Unit Tests', () => {
  test('gracefully fails when webhook URL is missing or invalid', async () => {
    const res1 = await postToDiscord('', 'test message');
    assert.strictEqual(res1.success, false);

    const res2 = await postToDiscord('invalid-url', 'test message');
    assert.strictEqual(res2.success, false);
  });

  test('alertIfUnhealthy returns healthy for normal stats', async () => {
    const stats = { email: 'inbox@domain.com', sent: 100, bounced: 1, complaints: 0 };
    const status = await alertIfUnhealthy(stats, null);
    assert.strictEqual(status, null); // No webhook provided, exits cleanly
  });

  test('alertIfUnhealthy identifies high bounce rate (> 5%)', async () => {
    const stats = { email: 'inbox@domain.com', sent: 100, bounced: 8, complaints: 0 };
    // Provide a dummy webhook URL that we intercept or verify trigger
    let alertSent = false;
    // Overriding global fetch for mock
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      alertSent = true;
      return { ok: true };
    };

    try {
      const status = await alertIfUnhealthy(stats, 'https://discord.com/api/webhooks/dummy');
      assert.strictEqual(status, 'bounce_alert_sent');
      assert.strictEqual(alertSent, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('alertIfUnhealthy identifies high complaint rate (> 0.3%)', async () => {
    const stats = { email: 'inbox@domain.com', sent: 100, bounced: 0, complaints: 1 };
    let alertSent = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      alertSent = true;
      return { ok: true };
    };

    try {
      const status = await alertIfUnhealthy(stats, 'https://discord.com/api/webhooks/dummy');
      assert.strictEqual(status, 'complaint_alert_sent');
      assert.strictEqual(alertSent, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { postToDiscord, alertIfUnhealthy, sendCronSyncAlert } from '../src/alerts.mjs';

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
    let alertSent = false;
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

  test('sendCronSyncAlert dispatches formatted embed to Discord', async () => {
    let capturedPayload = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      capturedPayload = JSON.parse(opts.body);
      return { ok: true };
    };

    try {
      const res = await sendCronSyncAlert({
        jobTitle: 'Sheet-bot - Cold Outreach',
        timezone: 'Asia/Kolkata',
        hours: [11],
        minutes: [0],
        webhookUrl: 'https://discord.com/api/webhooks/dummy',
        context: 'Google Sheet Auto-Sync'
      });

      assert.strictEqual(res.success, true);
      assert.ok(capturedPayload);
      assert.strictEqual(capturedPayload.embeds[0].title, '⏱️ Cron Job Schedule Auto-Synchronized');
      assert.strictEqual(capturedPayload.embeds[0].fields[0].value, '`Sheet-bot - Cold Outreach`');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('sendRunSummaryAlert formats execution digest embed', async () => {
    let capturedPayload = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      capturedPayload = JSON.parse(opts.body);
      return { ok: true };
    };

    try {
      const { sendRunSummaryAlert } = await import('../src/alerts.mjs');
      await sendRunSummaryAlert(
        {
          processed: 25,
          sent: 24,
          replies: 1,
          drafts: 0,
          failed: 0,
          durationSeconds: 12,
          errors: 0,
        },
        'https://discord.com/api/webhooks/dummy'
      );

      assert.ok(capturedPayload);
      assert.strictEqual(capturedPayload.embeds[0].title, '📊 Sheet-bot Execution Digest');
      assert.strictEqual(capturedPayload.embeds[0].fields[0].value, '25');
      assert.strictEqual(capturedPayload.embeds[0].fields[1].value, '24');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

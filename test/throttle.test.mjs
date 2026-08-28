import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getSendDelay, trackOutcome, checkAndResetDailyStats } from '../src/throttle.mjs';

describe('Throttle Module Unit Tests', () => {
  test('slows down to 60s on high complaint rate (> 0.003) in adaptive mode', () => {
    const delay = getSendDelay({ sent: 100, bounced: 0, complaints: 1, sentToday: 50 });
    assert.strictEqual(delay, 60000);
  });

  test('slows down to 15s on high bounce rate (> 0.05) in adaptive mode', () => {
    const delay = getSendDelay({ sent: 100, bounced: 6, complaints: 0, sentToday: 50 });
    assert.strictEqual(delay, 15000);
  });

  test('uses 8s delay during daily ramp-up (< 20 sent today) in adaptive mode', () => {
    const delay = getSendDelay({ sent: 100, bounced: 1, complaints: 0, sentToday: 10 });
    assert.strictEqual(delay, 8000);
  });

  test('maintains 3s steady state for healthy established inboxes in adaptive mode', () => {
    const delay = getSendDelay({ sent: 200, bounced: 1, complaints: 0, sentToday: 30 });
    assert.strictEqual(delay, 3000);
  });

  test('bulk / turbo mode ignores high bounce rate and applies high-speed delay', () => {
    // Unhealthy inbox (high bounce rate & complaints)
    const unhealthyStats = { sent: 100, bounced: 50, complaints: 5, sentToday: 5 };
    const bulkDelay = getSendDelay(unhealthyStats, {
      throttleMode: 'bulk',
      minDelaySeconds: 1,
      maxDelaySeconds: 1,
    });
    // In bulk mode, ignores the 60s/15s penalties and executes at 1000ms (1s)
    assert.strictEqual(bulkDelay, 1000);
  });

  test('trackOutcome correctly increments sent, bounced, and complaints', () => {
    let stats = { sent: 10, bounced: 0, complaints: 0, sentToday: 5 };

    stats = trackOutcome(stats, 'sent');
    assert.strictEqual(stats.sent, 11);
    assert.strictEqual(stats.sentToday, 6);

    stats = trackOutcome(stats, 'bounced');
    assert.strictEqual(stats.bounced, 1);

    stats = trackOutcome(stats, 'complaint');
    assert.strictEqual(stats.complaints, 1);
  });

  test('checkAndResetDailyStats resets sentToday on a new calendar day', () => {
    const yesterday = '2026-08-20';
    const oldStats = { sent: 50, bounced: 1, complaints: 0, sentToday: 25, lastReset: yesterday };
    const reset = checkAndResetDailyStats(oldStats);

    assert.strictEqual(reset.sentToday, 0);
    assert.notStrictEqual(reset.lastReset, yesterday);
  });
});

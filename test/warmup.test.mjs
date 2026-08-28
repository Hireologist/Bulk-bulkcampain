import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pickRandomPeer, getWarmupQuota, runWarmupCycle } from '../src/warmup.mjs';

describe('Warmup Module Unit Tests', () => {
  test('calculates warmup quota progressively up to target limit', () => {
    assert.strictEqual(getWarmupQuota(1, 40), 5);  // Day 1: 5
    assert.strictEqual(getWarmupQuota(2, 40), 8);  // Day 2: 8
    assert.strictEqual(getWarmupQuota(5, 40), 17); // Day 5: 17
    assert.strictEqual(getWarmupQuota(20, 40), 40); // Day 20: capped at 40
  });

  test('pickRandomPeer never picks the sender itself', () => {
    const inboxes = [
      { email: 'sender1@domain.com' },
      { email: 'sender2@domain.com' },
      { email: 'sender3@domain.com' },
    ];

    for (let i = 0; i < 50; i++) {
      const peer = pickRandomPeer(inboxes, 'sender1@domain.com');
      assert.notStrictEqual(peer.email, 'sender1@domain.com');
      assert.ok(peer.email === 'sender2@domain.com' || peer.email === 'sender3@domain.com');
    }
  });

  test('runWarmupCycle skips if fewer than 2 inboxes have warmup_enabled', async () => {
    const inboxes = [
      { email: 'box1@domain.com', warmup_enabled: true },
      { email: 'box2@domain.com', warmup_enabled: false },
    ];

    const res = await runWarmupCycle(inboxes, async () => {});
    assert.strictEqual(res.status, 'skipped');
    assert.strictEqual(res.count, 0);
  });

  test('runWarmupCycle executes peer sends when eligible', async () => {
    const inboxes = [
      { email: 'box1@domain.com', warmup_enabled: true },
      { email: 'box2@domain.com', warmup_enabled: true },
    ];

    const sentRecords = [];
    const mockSend = async (sender, recipient, subject, body) => {
      sentRecords.push({ sender: sender.email, recipient, subject, body });
    };

    const res = await runWarmupCycle(inboxes, mockSend);
    assert.strictEqual(res.status, 'completed');
    assert.strictEqual(res.count, 2);
    assert.strictEqual(sentRecords.length, 2);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sendWithRetry } from '../src/retry.mjs';

describe('Retry Module Unit Tests', () => {
  test('returns value on first successful try', async () => {
    let callCount = 0;
    const res = await sendWithRetry(async () => {
      callCount++;
      return 'success';
    });

    assert.strictEqual(res, 'success');
    assert.strictEqual(callCount, 1);
  });

  test('retries until success within max retries', async () => {
    let callCount = 0;
    const res = await sendWithRetry(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Temporary network glitch');
      }
      return 'recovered';
    }, { retries: 3, baseDelay: 10, factor: 1 });

    assert.strictEqual(res, 'recovered');
    assert.strictEqual(callCount, 3);
  });

  test('throws final error if retries are exhausted', async () => {
    let callCount = 0;
    await assert.rejects(
      async () => {
        await sendWithRetry(async () => {
          callCount++;
          throw new Error('Permanent failure');
        }, { retries: 2, baseDelay: 10, factor: 1 });
      },
      {
        name: 'Error',
        message: 'Permanent failure',
      }
    );

    assert.strictEqual(callCount, 3); // Initial attempt + 2 retries
  });
});

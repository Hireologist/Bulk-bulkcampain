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

  test('calls onRetry callback with attempt count and delay', async () => {
    const retryEvents = [];
    let callCount = 0;

    await sendWithRetry(
      async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Transient error');
        }
        return 'done';
      },
      {
        retries: 2,
        baseDelay: 10,
        factor: 2,
        onRetry: (err, attempt, delay) => {
          retryEvents.push({ message: err.message, attempt, delay });
        }
      }
    );

    assert.strictEqual(retryEvents.length, 1);
    assert.strictEqual(retryEvents[0].attempt, 1);
    assert.strictEqual(retryEvents[0].message, 'Transient error');
  });

  test('short-circuits immediately without retrying when isFatal returns true', async () => {
    let callCount = 0;
    const authError = new Error('535 5.7.8 Username and Password not accepted');
    authError.responseCode = 535;

    await assert.rejects(
      async () => {
        await sendWithRetry(
          async () => {
            callCount++;
            throw authError;
          },
          {
            retries: 4,
            baseDelay: 50,
            isFatal: (err) => err.responseCode === 535 || err.message.includes('535'),
          }
        );
      },
      {
        message: '535 5.7.8 Username and Password not accepted',
      }
    );

    // Verifies it failed immediately on attempt 1 without wasting time on retries
    assert.strictEqual(callCount, 1);
  });
});


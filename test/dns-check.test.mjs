import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkDomainAuth } from '../src/dns-check.mjs';

describe('DNS Check Module Unit Tests', () => {
  test('audits authentic domain with valid SPF and DMARC (e.g. google.com)', async () => {
    const res = await checkDomainAuth('google.com');
    assert.strictEqual(res.domain, 'google.com');
    assert.strictEqual(res.spf, true);
    assert.strictEqual(res.dmarc, true);
    assert.strictEqual(res.status, 'Pass');
  });

  test('safely handles non-existent or unauthenticated domain', async () => {
    const res = await checkDomainAuth('nonexistent-fake-domain-123456789.org');
    assert.strictEqual(res.spf, false);
    assert.strictEqual(res.dmarc, false);
    assert.strictEqual(res.status, 'Fail');
  });

  test('checkDnsRecords is exported as an alias for checkDomainAuth', async () => {
    const { checkDnsRecords } = await import('../src/dns-check.mjs');
    assert.strictEqual(typeof checkDnsRecords, 'function');
    assert.strictEqual(checkDnsRecords, checkDomainAuth);
  });
});

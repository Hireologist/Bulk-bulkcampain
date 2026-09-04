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

  test('correctly handles case-insensitive DMARC (v=dmarc1 lowercase)', async () => {
    const mockResolver = async (host) => {
      if (host.startsWith('_dmarc.')) {
        return [['v=dmarc1; p=reject; rua=mailto:dmarc@example.com']];
      }
      return [['v=spf1 include:_spf.example.com ~all']];
    };

    const res = await checkDomainAuth('example.com', mockResolver);
    assert.strictEqual(res.spf, true);
    assert.strictEqual(res.dmarc, true);
    assert.strictEqual(res.status, 'Pass');
    assert.ok(res.dmarcRecord.startsWith('v=dmarc1'));
  });

  test('correctly joins multi-chunk TXT records (>255 characters)', async () => {
    const chunk1 = 'v=spf1 include:_spf.domain1.com include:_spf.domain2.com ';
    const chunk2 = 'include:_spf.domain3.com ~all';
    const mockResolver = async (host) => {
      if (host.startsWith('_dmarc.')) {
        return [['v=DMARC1; p=none']];
      }
      // DNS server split into 2 chunks
      return [[chunk1, chunk2]];
    };

    const res = await checkDomainAuth('chunked.com', mockResolver);
    assert.strictEqual(res.spf, true);
    assert.strictEqual(res.spfRecord, chunk1 + chunk2);
  });
});

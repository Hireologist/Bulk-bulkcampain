import { resolveTxt } from 'node:dns/promises';

/**
 * Audit SPF and DMARC DNS records for a domain
 * @param {string} domain
 * @param {Function} [resolver=resolveTxt] Optional DNS resolver function (for testing or custom lookup)
 * @returns {Promise<{domain: string, spf: boolean, dmarc: boolean, spfRecord: string, dmarcRecord: string, checkedAt: string, status: string}>}
 */
export async function checkDomainAuth(domain, resolver = resolveTxt) {
  const cleanDomain = domain.trim().toLowerCase();
  const result = {
    domain: cleanDomain,
    spf: false,
    dmarc: false,
    spfRecord: '',
    dmarcRecord: '',
    checkedAt: new Date().toISOString(),
    status: 'Fail',
  };

  try {
    const rawRecords = await resolver(cleanDomain);
    const txtRecords = (Array.isArray(rawRecords) ? rawRecords : [])
      .map((entry) => (Array.isArray(entry) ? entry.join('') : String(entry)));

    const foundSpf = txtRecords.find((r) => typeof r === 'string' && /^v\s*=\s*spf1(?:\s|$)/i.test(r.trim()));
    if (foundSpf) {
      result.spf = true;
      result.spfRecord = foundSpf;
    }
  } catch {
    // No SPF record or lookup error
  }

  try {
    const rawDmarc = await resolver(`_dmarc.${cleanDomain}`);
    const dmarcRecords = (Array.isArray(rawDmarc) ? rawDmarc : [])
      .map((entry) => (Array.isArray(entry) ? entry.join('') : String(entry)));

    const foundDmarc = dmarcRecords.find((r) => typeof r === 'string' && /^v\s*=\s*dmarc1(?:\s*;|\s*$)/i.test(r.trim()));
    if (foundDmarc) {
      result.dmarc = true;
      result.dmarcRecord = foundDmarc;
    }
  } catch {
    // No DMARC record or lookup error
  }

  if (result.spf && result.dmarc) {
    result.status = 'Pass';
  } else if (result.spf || result.dmarc) {
    result.status = 'Partial';
  } else {
    result.status = 'Fail';
  }

  return result;
}

export const checkDnsRecords = checkDomainAuth;

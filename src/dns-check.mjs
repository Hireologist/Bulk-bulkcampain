import { resolveTxt } from 'node:dns/promises';

/**
 * Audit SPF and DMARC DNS records for a domain
 * @param {string} domain
 * @returns {Promise<{domain: string, spf: boolean, dmarc: boolean, spfRecord: string, dmarcRecord: string, checkedAt: string, status: string}>}
 */
export async function checkDomainAuth(domain) {
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
    const txtRecords = (await resolveTxt(cleanDomain)).flat();
    const foundSpf = txtRecords.find((r) => typeof r === 'string' && r.startsWith('v=spf1'));
    if (foundSpf) {
      result.spf = true;
      result.spfRecord = foundSpf;
    }
  } catch {
    // No SPF record or lookup error
  }

  try {
    const dmarcRecords = (await resolveTxt(`_dmarc.${cleanDomain}`)).flat();
    const foundDmarc = dmarcRecords.find((r) => typeof r === 'string' && r.startsWith('v=DMARC1'));
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


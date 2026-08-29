import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  slugify,
  extractSpreadsheetIdFromWorkflow,
  deleteCampaign
} from '../scripts/delete-campaign.mjs';

describe('Campaign Deletion Utility Unit Tests', () => {
  it('slugify converts arbitrary names to clean filesystem-safe slugs', () => {
    assert.strictEqual(slugify('SaaS Founders 2026!'), 'saas_founders_2026');
    assert.strictEqual(slugify('Poonam - Outreach B'), 'poonam_outreach_b');
    assert.strictEqual(slugify('  '), 'custom_campaign');
    assert.strictEqual(slugify(null), 'custom_campaign');
  });

  it('extractSpreadsheetIdFromWorkflow extracts spreadsheet ID from workflow yaml', () => {
    const yaml1 = `
      SPREADSHEET_ID: \${{ secrets.SPREADSHEET_ID_TEST || "1abcXYZ-456_test" }}
      GOOGLE_SERVICE_ACCOUNT_JSON: \${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
    `;
    assert.strictEqual(extractSpreadsheetIdFromWorkflow(yaml1), '1abcXYZ-456_test');

    const yaml2 = `
      SPREADSHEET_ID: "1simpleSpreadsheetId999"
    `;
    assert.strictEqual(extractSpreadsheetIdFromWorkflow(yaml2), '1simpleSpreadsheetId999');

    assert.strictEqual(extractSpreadsheetIdFromWorkflow(''), null);
  });

  it('deleteCampaign deletes workflow file and handles missing files gracefully', async () => {
    const testSlug = 'unit_test_campaign_temp';
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', `outreach_${testSlug}.yml`);

    // Create a temporary workflow file
    fs.writeFileSync(workflowPath, 'SPREADSHEET_ID: "mock-sheet-id-123"', 'utf8');
    assert.strictEqual(fs.existsSync(workflowPath), true);

    const res = await deleteCampaign({
      campaignName: testSlug,
      deleteSheet: false,
      deleteCron: false
    });

    assert.strictEqual(res.workflowDeleted, true);
    assert.strictEqual(fs.existsSync(workflowPath), false);

    // Deleting again should be safe and non-throwing
    const res2 = await deleteCampaign({
      campaignName: testSlug,
      deleteSheet: false,
      deleteCron: false
    });
    assert.strictEqual(res2.workflowDeleted, false);
  });
});

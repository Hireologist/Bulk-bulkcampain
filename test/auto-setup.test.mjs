import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { COMPLETE_SCHEMA } from '../scripts/auto-setup.mjs';
import { parseScheduleFromSettings, buildJobPayload } from '../setup-cron.mjs';
import { parseSpintax } from '../src/spintax.mjs';
import { isCampaignActive } from '../engine.mjs';

describe('🚀 New User Onboarding & Auto-Provisioning Simulation Test', () => {
  const simulatedUserRepo = 'SimulatedUser/Outreach-Bot';
  const simulatedDispatchUrl = 'https://api.github.com/repos/SimulatedUser/Outreach-Bot/actions/workflows/outreach.yml/dispatches';
  const simulatedPat = 'ghp_SimulatedUserToken999';

  test('COMPLETE_SCHEMA contains all required tabs and complete headers', () => {
    const requiredTabs = [
      '📖 Setup_Guide',
      'Details',
      'Inboxes',
      'Aliases',
      'Settings',
      'Templates',
      'Followup_Templates',
      'Locations',
      'Clients',
      'Suppressed',
      'Domain_Health',
      'Inbox_Stats',
      'Failed_Sends',
      '📊 Email_Analytics',
      '📈 ChartData'
    ];

    for (const tab of requiredTabs) {
      assert.ok(COMPLETE_SCHEMA[tab], `Missing tab in schema: ${tab}`);
      assert.ok(Array.isArray(COMPLETE_SCHEMA[tab].headers), `Headers array missing for tab: ${tab}`);
      assert.ok(COMPLETE_SCHEMA[tab].headers.length > 0, `Headers should not be empty for tab: ${tab}`);
    }
  });

  test('Settings schema has all operational keys populated with valid defaults', () => {
    const settingsTab = COMPLETE_SCHEMA['Settings'];
    const settingsMap = Object.fromEntries(settingsTab.sampleData.map(row => [row[0], row[1]]));

    assert.strictEqual(settingsMap.campaign_active, 'TRUE');
    assert.strictEqual(settingsMap.send_mode, 'auto');
    assert.strictEqual(settingsMap.throttle_mode, 'adaptive');
    assert.strictEqual(settingsMap.cron_timezone, 'Asia/Kolkata');
    assert.strictEqual(settingsMap.cron_outreach_time, '10:00');
    assert.strictEqual(settingsMap.cron_followup_time, '09:30');
    assert.strictEqual(settingsMap.cron_diagnostic_schedule, 'daily_0900');
    assert.strictEqual(settingsMap.discord_alerts_enabled, 'TRUE');
    assert.strictEqual(settingsMap.discord_domain_alerts_enabled, 'TRUE');
    assert.strictEqual(settingsMap.gcc_radar_enabled, 'TRUE');
  });

  test('Templates schema sample data contains valid spintax syntax', () => {
    const templatesTab = COMPLETE_SCHEMA['Templates'];
    for (const row of templatesTab.sampleData) {
      const subject = row[1];
      const body = row[2];

      const parsedSubject = parseSpintax(subject);
      const parsedBody = parseSpintax(body);

      assert.ok(typeof parsedSubject === 'string' && parsedSubject.length > 0);
      assert.ok(typeof parsedBody === 'string' && parsedBody.length > 0);
    }
  });

  test('Simulated New User cron-job.org provisioning generates exact URLs and jobs', () => {
    const settingsMap = Object.fromEntries(COMPLETE_SCHEMA['Settings'].sampleData.map(r => [r[0], r[1]]));
    const jobs = parseScheduleFromSettings(settingsMap);

    assert.strictEqual(jobs.length, 7);

    for (const job of jobs) {
      const payload = buildJobPayload('Outreach-Bot', simulatedDispatchUrl, simulatedPat, job);
      assert.ok(payload.job.url.startsWith('https://api.github.com/repos/SimulatedUser/Outreach-Bot/actions/workflows/'));
      assert.strictEqual(payload.job.enabled, true);
      assert.strictEqual(payload.job.requestMethod, 1);
      assert.strictEqual(payload.job.extendedData.headers.Authorization, `Bearer ${simulatedPat}`);

      const body = JSON.parse(payload.job.extendedData.body);
      assert.strictEqual(body.ref, 'main');
    }
  });

  test('Engine correctly parses schema settings and enforces campaign status', () => {
    const settingsMap = Object.fromEntries(COMPLETE_SCHEMA['Settings'].sampleData.map(r => [r[0], r[1]]));
    assert.strictEqual(isCampaignActive(settingsMap, 'outreach'), true);
    assert.strictEqual(isCampaignActive(settingsMap, 'followup'), true);

    const pausedSettings = { ...settingsMap, campaign_active: 'FALSE' };
    assert.strictEqual(isCampaignActive(pausedSettings, 'outreach'), false);
    assert.strictEqual(isCampaignActive(pausedSettings, 'followup'), false);
    assert.strictEqual(isCampaignActive(pausedSettings, 'single_lead'), false);
  });
});

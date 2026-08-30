import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJobPayload,
  isJobUpToDate,
  parseScheduleFromSettings,
  parseTime,
  parseMinutesList,
  parseWeekdays,
  JOBS_TO_CREATE,
} from '../scripts/setup-cron.mjs';

describe('Smart Cron-Job.org Synchronizer Unit Tests', () => {
  const repoName = 'Sheet-bot';
  const dispatchUrl = 'https://api.github.com/repos/user/Sheet-bot/actions/workflows/outreach.yml/dispatches';
  const pat = 'ghp_testToken123';

  test('parseTime handles valid HH:MM format and falls back safely', () => {
    assert.deepStrictEqual(parseTime('14:45'), { hour: 14, minute: 45 });
    assert.deepStrictEqual(parseTime('9:05'), { hour: 9, minute: 5 });
    assert.deepStrictEqual(parseTime('invalid', 10, 0), { hour: 10, minute: 0 });
    assert.deepStrictEqual(parseTime('25:99', 10, 0), { hour: 10, minute: 0 });
  });

  test('parseMinutesList generates correct interval lists', () => {
    assert.deepStrictEqual(parseMinutesList('15'), [0, 15, 30, 45]);
    assert.deepStrictEqual(parseMinutesList('30'), [0, 30]);
    assert.deepStrictEqual(parseMinutesList('0,10,20'), [0, 10, 20]);
  });

  test('parseWeekdays parses named presets and raw lists', () => {
    assert.deepStrictEqual(parseWeekdays('Mon-Sat'), [1, 2, 3, 4, 5, 6]);
    assert.deepStrictEqual(parseWeekdays('Mon-Fri'), [1, 2, 3, 4, 5]);
    assert.deepStrictEqual(parseWeekdays('All'), [-1]);
    assert.deepStrictEqual(parseWeekdays('1,3,5'), [1, 3, 5]);
  });

  test('parseScheduleFromSettings applies custom timezone and timings from Google Sheet settings', () => {
    const customSettings = {
      cron_timezone: 'America/New_York',
      cron_outreach_time: '11:15',
      cron_followup_time: '10:45',
      cron_inbox_minutes: '20',
      cron_digest_time: '19:00',
      cron_days: 'Mon-Fri',
      cron_diagnostic_schedule: 'daily_0900',
    };

    const jobs = parseScheduleFromSettings(customSettings);
    assert.strictEqual(jobs.length, 7);

    const gccRadar = jobs.find((j) => j.title === 'GCC Leadership Radar');
    assert.strictEqual(gccRadar.workflow, 'gcc_leadership_radar.yml');

    const outreach = jobs.find((j) => j.action === 'outreach');
    assert.strictEqual(outreach.schedule.timezone, 'America/New_York');
    assert.deepStrictEqual(outreach.schedule.hours, [11]);
    assert.deepStrictEqual(outreach.schedule.minutes, [15]);
    assert.deepStrictEqual(outreach.schedule.wdays, [1, 2, 3, 4, 5]);

    const domainHealth = jobs.find((j) => j.title === 'Domain Health Audit');
    assert.strictEqual(domainHealth.workflow, 'domain-health.yml');
    assert.deepStrictEqual(domainHealth.schedule.wdays, [1]);

    const diagnostic = jobs.find((j) => j.title === 'Campaign Pre-Flight Diagnostic');
    assert.strictEqual(diagnostic.workflow, 'test_campaign.yml');
    assert.deepStrictEqual(diagnostic.schedule.hours, [9]);
    assert.deepStrictEqual(diagnostic.schedule.minutes, [0]);

    const inbox = jobs.find((j) => j.action === 'inbox');
    assert.deepStrictEqual(inbox.schedule.minutes, [0, 20, 40]);

    // Test "manual" mode (diagnostic job omitted)
    const manualJobs = parseScheduleFromSettings({ cron_diagnostic_schedule: 'manual' });
    assert.strictEqual(manualJobs.length, 6);
    assert.strictEqual(manualJobs.find(j => j.title === 'Campaign Pre-Flight Diagnostic'), undefined);

    // Test "weekly_monday_0830" mode
    const weeklyJobs = parseScheduleFromSettings({ cron_diagnostic_schedule: 'weekly_monday_0830' });
    const weeklyDiag = weeklyJobs.find(j => j.title === 'Campaign Pre-Flight Diagnostic');
    assert.deepStrictEqual(weeklyDiag.schedule.wdays, [1]);
    assert.deepStrictEqual(weeklyDiag.schedule.hours, [8]);
    assert.deepStrictEqual(weeklyDiag.schedule.minutes, [30]);
  });

  test('buildJobPayload constructs valid cron-job.org payload', () => {
    const jobConfig = JOBS_TO_CREATE[0]; // Followup Engine
    const payload = buildJobPayload(repoName, dispatchUrl, pat, jobConfig);

    assert.strictEqual(payload.job.title, 'Sheet-bot - Followup Engine');
    assert.strictEqual(payload.job.url, dispatchUrl);
    assert.strictEqual(payload.job.enabled, true);
    assert.strictEqual(payload.job.requestMethod, 1);
    assert.deepStrictEqual(payload.job.schedule, jobConfig.schedule);

    const body = JSON.parse(payload.job.extendedData.body);
    assert.strictEqual(body.ref, 'main');
    assert.strictEqual(body.inputs.action, 'followup');
  });

  test('buildJobPayload correctly replaces workflow URL for domain health', () => {
    const domainHealthConfig = JOBS_TO_CREATE.find((j) => j.title === 'Domain Health Audit');
    const payload = buildJobPayload(repoName, dispatchUrl, pat, domainHealthConfig);

    assert.strictEqual(payload.job.title, 'Sheet-bot - Domain Health Audit');
    assert.strictEqual(payload.job.url, 'https://api.github.com/repos/user/Sheet-bot/actions/workflows/domain-health.yml/dispatches');
    const body = JSON.parse(payload.job.extendedData.body);
    assert.strictEqual(body.ref, 'main');
    assert.strictEqual(body.inputs, undefined);
  });

  test('isJobUpToDate returns true when existing job matches exactly', () => {
    const jobConfig = JOBS_TO_CREATE[1]; // Cold Outreach
    const desired = buildJobPayload(repoName, dispatchUrl, pat, jobConfig);

    const existingDetails = {
      jobDetails: {
        url: dispatchUrl,
        enabled: true,
        requestMethod: 1,
        schedule: {
          timezone: 'Asia/Kolkata',
          hours: [10],
          minutes: [0],
          wdays: [1, 2, 3, 4, 5, 6],
        },
        extendedData: {
          body: JSON.stringify({ ref: 'main', inputs: { action: 'outreach' } }),
        },
      },
    };

    const upToDate = isJobUpToDate(existingDetails, desired);
    assert.strictEqual(upToDate, true);
  });

  test('isJobUpToDate returns false when schedule or timezone is changed', () => {
    const jobConfig = JOBS_TO_CREATE[1]; // Cold Outreach (at 10:00 Asia/Kolkata)
    const desired = buildJobPayload(repoName, dispatchUrl, pat, jobConfig);

    const existingDetails = {
      jobDetails: {
        url: dispatchUrl,
        enabled: true,
        requestMethod: 1,
        schedule: {
          timezone: 'America/New_York', // Different timezone!
          hours: [10],
          minutes: [0],
          wdays: [1, 2, 3, 4, 5, 6],
        },
        extendedData: {
          body: JSON.stringify({ ref: 'main', inputs: { action: 'outreach' } }),
        },
      },
    };

    const upToDate = isJobUpToDate(existingDetails, desired);
    assert.strictEqual(upToDate, false);
  });

  test('isJobUpToDate returns false when dispatch URL or action differs', () => {
    const jobConfig = JOBS_TO_CREATE[2]; // Inbox Checker
    const desired = buildJobPayload(repoName, dispatchUrl, pat, jobConfig);

    const existingDetails = {
      jobDetails: {
        url: 'https://api.github.com/repos/other/repo/actions/workflows/outreach.yml/dispatches', // Different repo!
        enabled: true,
        requestMethod: 1,
        schedule: jobConfig.schedule,
        extendedData: {
          body: JSON.stringify({ ref: 'main', inputs: { action: 'inbox' } }),
        },
      },
    };

    const upToDate = isJobUpToDate(existingDetails, desired);
    assert.strictEqual(upToDate, false);
  });

  test('isJobUpToDate returns false when wdays (weekdays) differs', () => {
    const jobConfig = JOBS_TO_CREATE[1]; // Mon-Sat wdays [1,2,3,4,5,6]
    const desired = buildJobPayload(repoName, dispatchUrl, pat, jobConfig);

    const existingDetails = {
      jobDetails: {
        url: dispatchUrl,
        enabled: true,
        requestMethod: 1,
        schedule: {
          timezone: 'Asia/Kolkata',
          hours: [10],
          minutes: [0],
          wdays: [1, 2, 3, 4, 5], // Mon-Fri only!
        },
        extendedData: {
          body: JSON.stringify({ ref: 'main', inputs: { action: 'outreach' } }),
        },
      },
    };

    const upToDate = isJobUpToDate(existingDetails, desired);
    assert.strictEqual(upToDate, false);
  });
});
  

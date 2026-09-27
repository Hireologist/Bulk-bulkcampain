import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isAuthError, sendAuthFailureAlert, writeGitHubStepSummary, getRepoSlug, formatDiscordContent, getRunUrl } from '../src/alerts.mjs';

describe('Google App Password & Auth Alerting Unit Tests', () => {
  describe('isAuthError Pattern Matching', () => {
    test('identifies error code EAUTH and responseCode 535', () => {
      assert.strictEqual(isAuthError({ code: 'EAUTH', message: 'Auth failed' }), true);
      assert.strictEqual(isAuthError({ responseCode: 535, message: 'Invalid credentials' }), true);
    });

    test('identifies all 14+ string patterns for revoked or expired Google App Passwords', () => {
      const knownAuthErrors = [
        '535 5.7.8 Username and Password not accepted',
        'Error: EAUTH Authentication failed',
        'Invalid login: 535-5.7.8',
        'Invalid credentials provided',
        'BadCredentials error occurred',
        'Authenticate failed for user',
        'Please generate an Application-specific password',
        'App password was revoked by Google',
        'Please log in via your web browser',
        'Authentication failed during SMTP handshake',
        'Login denied by remote server',
        'Command auth failed',
        'SMTP auth error: credential rejected',
      ];

      for (const errStr of knownAuthErrors) {
        assert.strictEqual(isAuthError(errStr), true, `Failed to identify auth error for string: "${errStr}"`);
        assert.strictEqual(isAuthError(new Error(errStr)), true, `Failed to identify auth error for Error object: "${errStr}"`);
      }
    });

    test('returns false for non-auth errors', () => {
      assert.strictEqual(isAuthError(null), false);
      assert.strictEqual(isAuthError(undefined), false);
      assert.strictEqual(isAuthError(new Error('ETIMEDOUT: Connection timed out')), false);
      assert.strictEqual(isAuthError(new Error('ECONNREFUSED 127.0.0.1:465')), false);
      assert.strictEqual(isAuthError(new Error('550 5.1.1 User unknown')), false);
      assert.strictEqual(isAuthError('No MX records found for domain'), false);
    });
  });

  describe('writeGitHubStepSummary', () => {
    test('writes markdown content to GITHUB_STEP_SUMMARY file', () => {
      const tempSummaryFile = path.join(os.tmpdir(), `test-step-summary-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
      const originalEnv = process.env.GITHUB_STEP_SUMMARY;
      process.env.GITHUB_STEP_SUMMARY = tempSummaryFile;

      try {
        writeGitHubStepSummary('### Test Markdown Step Summary');
        assert.ok(fs.existsSync(tempSummaryFile), 'Step summary file should be created');
        const content = fs.readFileSync(tempSummaryFile, 'utf8');
        assert.ok(content.includes('### Test Markdown Step Summary'));
      } finally {
        if (originalEnv !== undefined) {
          process.env.GITHUB_STEP_SUMMARY = originalEnv;
        } else {
          delete process.env.GITHUB_STEP_SUMMARY;
        }
        try {
          if (fs.existsSync(tempSummaryFile)) fs.unlinkSync(tempSummaryFile);
        } catch {}
      }
    });

    test('gracefully ignores when GITHUB_STEP_SUMMARY is unset', () => {
      const originalEnv = process.env.GITHUB_STEP_SUMMARY;
      delete process.env.GITHUB_STEP_SUMMARY;

      try {
        assert.doesNotThrow(() => {
          writeGitHubStepSummary('Some content');
        });
      } finally {
        if (originalEnv !== undefined) {
          process.env.GITHUB_STEP_SUMMARY = originalEnv;
        }
      }
    });
  });

  describe('sendAuthFailureAlert', () => {
    test('dispatches Discord embed, writes step summary, and returns success', async () => {
      const tempSummaryFile = path.join(os.tmpdir(), `test-step-summary-alert-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
      const originalEnv = process.env.GITHUB_STEP_SUMMARY;
      process.env.GITHUB_STEP_SUMMARY = tempSummaryFile;

      let capturedPayload = null;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        capturedPayload = JSON.parse(opts.body);
        return { ok: true };
      };

      try {
        const result = await sendAuthFailureAlert({
          inboxEmail: 'outreach@companydomain.com',
          errorDetails: '535 5.7.8 Username and Password not accepted',
          webhookUrl: 'https://discord.com/api/webhooks/dummy',
          context: 'Pre-Flight Diagnostic SMTP Test'
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.email, 'outreach@companydomain.com');

        // Check Discord Embed Payload
        assert.ok(capturedPayload);
        assert.ok(capturedPayload.content.includes('outreach@companydomain.com'));
        assert.ok(capturedPayload.content.startsWith('**['), 'Content should start with repo tag');
        assert.ok(capturedPayload.content.includes(getRepoSlug()), 'Content should include repo slug');
        assert.strictEqual(capturedPayload.embeds[0].title, '🚨 Action Required: Google App Password Authentication Failed');
        assert.strictEqual(capturedPayload.embeds[0].fields[0].value, '`outreach@companydomain.com`');
        assert.strictEqual(capturedPayload.embeds[0].fields[1].value, 'Pre-Flight Diagnostic SMTP Test');
        assert.strictEqual(capturedPayload.embeds[0].footer.text, `${getRepoSlug()} • Deliverability & Security Monitor`);

        // Check Step Summary written
        assert.ok(fs.existsSync(tempSummaryFile), 'Alert step summary file should exist');
        const summaryContent = fs.readFileSync(tempSummaryFile, 'utf8');
        assert.ok(summaryContent.includes('outreach@companydomain.com'));
        assert.ok(summaryContent.includes('Google App Passwords'));
      } finally {
        globalThis.fetch = originalFetch;
        if (originalEnv !== undefined) {
          process.env.GITHUB_STEP_SUMMARY = originalEnv;
        } else {
          delete process.env.GITHUB_STEP_SUMMARY;
        }
        try {
          if (fs.existsSync(tempSummaryFile)) fs.unlinkSync(tempSummaryFile);
        } catch {}
      }
    });

    test('handles missing webhook URL gracefully without throwing', async () => {
      const result = await sendAuthFailureAlert({
        inboxEmail: 'test@domain.com',
        errorDetails: 'EAUTH failure',
        webhookUrl: null,
      });

      assert.strictEqual(result.success, true);
    });
  });
});

describe('Repo Context Helpers', () => {
  describe('getRepoSlug', () => {
    test('reads GITHUB_REPOSITORY env var when available', () => {
      const original = process.env.GITHUB_REPOSITORY;
      process.env.GITHUB_REPOSITORY = 'testowner/testrepo';
      try {
        assert.strictEqual(getRepoSlug(), 'testowner/testrepo');
      } finally {
        if (original !== undefined) {
          process.env.GITHUB_REPOSITORY = original;
        } else {
          delete process.env.GITHUB_REPOSITORY;
        }
      }
    });

    test('returns a non-empty string even when GITHUB_REPOSITORY is unset', () => {
      const original = process.env.GITHUB_REPOSITORY;
      delete process.env.GITHUB_REPOSITORY;
      try {
        const slug = getRepoSlug();
        assert.ok(typeof slug === 'string' && slug.length > 0, 'Should return a non-empty fallback slug');
      } finally {
        if (original !== undefined) {
          process.env.GITHUB_REPOSITORY = original;
        }
      }
    });
  });

  describe('getRunUrl', () => {
    test('builds GitHub Actions run URL when both env vars are set', () => {
      const origRepo = process.env.GITHUB_REPOSITORY;
      const origRun = process.env.GITHUB_RUN_ID;
      process.env.GITHUB_REPOSITORY = 'testowner/testrepo';
      process.env.GITHUB_RUN_ID = '12345';
      try {
        assert.strictEqual(getRunUrl(), 'https://github.com/testowner/testrepo/actions/runs/12345');
      } finally {
        if (origRepo !== undefined) process.env.GITHUB_REPOSITORY = origRepo; else delete process.env.GITHUB_REPOSITORY;
        if (origRun !== undefined) process.env.GITHUB_RUN_ID = origRun; else delete process.env.GITHUB_RUN_ID;
      }
    });

    test('returns empty string when GITHUB_RUN_ID is unset', () => {
      const origRun = process.env.GITHUB_RUN_ID;
      delete process.env.GITHUB_RUN_ID;
      try {
        assert.strictEqual(getRunUrl(), '');
      } finally {
        if (origRun !== undefined) process.env.GITHUB_RUN_ID = origRun;
      }
    });
  });

  describe('formatDiscordContent', () => {
    test('prepends [owner/repo] tag to content', () => {
      const original = process.env.GITHUB_REPOSITORY;
      const origRun = process.env.GITHUB_RUN_ID;
      process.env.GITHUB_REPOSITORY = 'myorg/myrepo';
      delete process.env.GITHUB_RUN_ID;
      try {
        const result = formatDiscordContent('Hello World');
        assert.ok(result.startsWith('**[myorg/myrepo]**'), 'Should start with repo tag');
        assert.ok(result.includes('Hello World'), 'Should contain original content');
      } finally {
        if (original !== undefined) process.env.GITHUB_REPOSITORY = original; else delete process.env.GITHUB_REPOSITORY;
        if (origRun !== undefined) process.env.GITHUB_RUN_ID = origRun;
      }
    });

    test('appends View Run link when in GitHub Actions', () => {
      const origRepo = process.env.GITHUB_REPOSITORY;
      const origRun = process.env.GITHUB_RUN_ID;
      process.env.GITHUB_REPOSITORY = 'myorg/myrepo';
      process.env.GITHUB_RUN_ID = '99999';
      try {
        const result = formatDiscordContent('Test message');
        assert.ok(result.includes('[View Run]'), 'Should contain View Run link');
        assert.ok(result.includes('actions/runs/99999'), 'Should contain the run ID');
      } finally {
        if (origRepo !== undefined) process.env.GITHUB_REPOSITORY = origRepo; else delete process.env.GITHUB_REPOSITORY;
        if (origRun !== undefined) process.env.GITHUB_RUN_ID = origRun; else delete process.env.GITHUB_RUN_ID;
      }
    });

    test('does not append View Run link when not in GitHub Actions', () => {
      const origRepo = process.env.GITHUB_REPOSITORY;
      const origRun = process.env.GITHUB_RUN_ID;
      process.env.GITHUB_REPOSITORY = 'myorg/myrepo';
      delete process.env.GITHUB_RUN_ID;
      try {
        const result = formatDiscordContent('Local test');
        assert.ok(!result.includes('[View Run]'), 'Should NOT contain View Run link outside CI');
      } finally {
        if (origRepo !== undefined) process.env.GITHUB_REPOSITORY = origRepo; else delete process.env.GITHUB_REPOSITORY;
        if (origRun !== undefined) process.env.GITHUB_RUN_ID = origRun;
      }
    });
  });
});

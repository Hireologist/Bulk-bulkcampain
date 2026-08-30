import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isAuthError, sendAuthFailureAlert, writeGitHubStepSummary } from '../src/alerts.mjs';

describe('Google App Password & Auth Alerting Unit Tests', () => {
  let tempSummaryFile;

  beforeEach(() => {
    tempSummaryFile = path.join(os.tmpdir(), `test-step-summary-${Date.now()}.md`);
    process.env.GITHUB_STEP_SUMMARY = tempSummaryFile;
  });

  afterEach(() => {
    delete process.env.GITHUB_STEP_SUMMARY;
    try {
      if (fs.existsSync(tempSummaryFile)) {
        fs.unlinkSync(tempSummaryFile);
      }
    } catch {}
  });

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
      writeGitHubStepSummary('### Test Markdown Step Summary');
      assert.ok(fs.existsSync(tempSummaryFile));
      const content = fs.readFileSync(tempSummaryFile, 'utf8');
      assert.ok(content.includes('### Test Markdown Step Summary'));
    });

    test('gracefully ignores when GITHUB_STEP_SUMMARY is unset', () => {
      delete process.env.GITHUB_STEP_SUMMARY;
      assert.doesNotThrow(() => {
        writeGitHubStepSummary('Some content');
      });
    });
  });

  describe('sendAuthFailureAlert', () => {
    test('dispatches Discord embed, writes step summary, and returns success', async () => {
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
        assert.strictEqual(capturedPayload.embeds[0].title, '🚨 Action Required: Google App Password Authentication Failed');
        assert.strictEqual(capturedPayload.embeds[0].fields[0].value, '`outreach@companydomain.com`');
        assert.strictEqual(capturedPayload.embeds[0].fields[1].value, 'Pre-Flight Diagnostic SMTP Test');

        // Check Step Summary written
        assert.ok(fs.existsSync(tempSummaryFile));
        const summaryContent = fs.readFileSync(tempSummaryFile, 'utf8');
        assert.ok(summaryContent.includes('outreach@companydomain.com'));
        assert.ok(summaryContent.includes('Google App Passwords'));
      } finally {
        globalThis.fetch = originalFetch;
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

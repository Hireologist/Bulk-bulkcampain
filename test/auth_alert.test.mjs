import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAuthError, sendAuthFailureAlert, writeGitHubStepSummary } from '../src/alerts.mjs';
import { runCampaignDiagnostics } from '../scripts/test-campaign-diagnostics.mjs';

describe('Google App Password & Authentication Failure Handling Tests', () => {

  describe('isAuthError Detector', () => {
    test('identifies Nodemailer EAUTH and responseCode 535 errors', () => {
      const eauthErr = new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
      eauthErr.code = 'EAUTH';
      eauthErr.responseCode = 535;

      assert.strictEqual(isAuthError(eauthErr), true);
    });

    test('identifies Gmail BadCredentials response strings', () => {
      const gmail535 = new Error('535-5.7.8 Username and Password not accepted. Learn more at https://support.google.com/mail/?p=BadCredentials');
      assert.strictEqual(isAuthError(gmail535), true);

      const rawStringError = '535 5.7.8 Error: authentication failed: Invalid credentials';
      assert.strictEqual(isAuthError(rawStringError), true);
    });

    test('identifies Google application-specific password requirements', () => {
      const appPassErr = new Error('Application-specific password required for Gmail SMTP');
      assert.strictEqual(isAuthError(appPassErr), true);

      const webLoginErr = new Error('534-5.7.14 Please log in via your web browser and then try again.');
      assert.strictEqual(isAuthError(webLoginErr), true);
    });

    test('identifies IMAP authentication failures', () => {
      const imapErr = new Error('AUTHENTICATE failed: [AUTHENTICATIONFAILED] Invalid credentials (Failure)');
      assert.strictEqual(isAuthError(imapErr), true);

      const imapLoginDenied = new Error('IMAP login denied for user alex@domain.com');
      assert.strictEqual(isAuthError(imapLoginDenied), true);
    });

    test('returns false for unrelated network or deliverability errors', () => {
      const timeoutErr = new Error('ETIMEDOUT: Connection timed out');
      assert.strictEqual(isAuthError(timeoutErr), false);

      const resetErr = new Error('ECONNRESET: Socket closed by remote host');
      assert.strictEqual(isAuthError(resetErr), false);

      const dailyLimitErr = new Error('550-5.4.5 Daily user sending limit exceeded');
      assert.strictEqual(isAuthError(dailyLimitErr), false);

      const invalidDomainErr = new Error('Invalid email address or domain has no MX records');
      assert.strictEqual(isAuthError(invalidDomainErr), false);

      assert.strictEqual(isAuthError(null), false);
      assert.strictEqual(isAuthError(undefined), false);
    });
  });

  describe('sendAuthFailureAlert Dispatcher', () => {
    test('formats actionable alert and returns success status', async () => {
      const res = await sendAuthFailureAlert({
        inboxEmail: 'sender@gmail.com',
        errorDetails: '535-5.7.8 Username and Password not accepted',
        webhookUrl: null, // Test without live webhook
        context: 'Pre-Flight Diagnostic Audit'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.email, 'sender@gmail.com');
    });

    test('gracefully handles missing inbox email and error objects', async () => {
      const res = await sendAuthFailureAlert({
        inboxEmail: '',
        errorDetails: new Error('EAUTH failure'),
        webhookUrl: 'https://discord.com/api/webhooks/dummy_invalid',
        context: 'Cold Outreach Live Send'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.email, 'Unknown Inbox');
    });
  });

  describe('writeGitHubStepSummary Helper', () => {
    let tmpSummaryFile;

    beforeEach(() => {
      tmpSummaryFile = path.join(os.tmpdir(), `gh_step_summary_${Date.now()}_${Math.random().toString(36).substring(7)}.md`);
      process.env.GITHUB_STEP_SUMMARY = tmpSummaryFile;
    });

    afterEach(() => {
      delete process.env.GITHUB_STEP_SUMMARY;
      try {
        if (fs.existsSync(tmpSummaryFile)) fs.unlinkSync(tmpSummaryFile);
      } catch (_) {}
    });

    test('appends markdown content to GITHUB_STEP_SUMMARY file', () => {
      writeGitHubStepSummary('### Test Summary Line 1');
      writeGitHubStepSummary('### Test Summary Line 2');

      const content = fs.readFileSync(tmpSummaryFile, 'utf8');
      assert.ok(content.includes('### Test Summary Line 1'));
      assert.ok(content.includes('### Test Summary Line 2'));
    });
  });

  describe('Diagnostic Runner Module Resolution', () => {
    test('scripts/test-campaign-diagnostics.mjs exports runCampaignDiagnostics function', () => {
      assert.strictEqual(typeof runCampaignDiagnostics, 'function');
    });
  });

});

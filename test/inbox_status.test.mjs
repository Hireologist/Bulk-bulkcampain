import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOptOutReply,
  stripQuotedReply,
  isSuppressed,
  addToSuppression,
  clearSuppressionCache
} from '../src/suppression.mjs';

describe('Inbox Reply Classification & Suppression Enforcement Tests', () => {
  beforeEach(() => {
    clearSuppressionCache();
  });

  describe('isOptOutReply()', () => {
    test('detects mailto unsubscribe email from footer', () => {
      assert.strictEqual(isOptOutReply('Unsubscribe - prospect@client.com', 'Please unsubscribe prospect@client.com from all future email communications.'), true);
      assert.strictEqual(isOptOutReply('Re: Unsubscribe', ''), true);
    });

    test('detects explicit opt-out keywords in subject or body', () => {
      assert.strictEqual(isOptOutReply('Re: Outreach', 'Please remove me from your list.'), true);
      assert.strictEqual(isOptOutReply('', 'I want to opt out.'), true);
      assert.strictEqual(isOptOutReply('Stop emailing', 'Stop emailing me immediately.'), true);
      assert.strictEqual(isOptOutReply('Please take me off', 'take me off your distribution list'), true);
      assert.strictEqual(isOptOutReply('', 'Do not email this address again.'), true);
    });

    test('does NOT flag standard sales objections or negative replies as opt-outs', () => {
      // Standard negative objections should have status = 'replied', NOT 'suppressed'
      assert.strictEqual(isOptOutReply('Re: Quick question', 'We are not interested at this moment.'), false);
      assert.strictEqual(isOptOutReply('Re: Partnerships', 'No budget for this right now, check back in Q4.'), false);
      assert.strictEqual(isOptOutReply('Re: Quick question', 'Not looking for new vendors currently.'), false);
      assert.strictEqual(isOptOutReply('Re: Services', 'We already have an in-house team handling this.'), false);
    });

    test('does NOT flag positive or neutral replies as opt-outs', () => {
      assert.strictEqual(isOptOutReply('Re: Quick question', 'Sounds great! Can you send over a demo link?'), false);
      assert.strictEqual(isOptOutReply('Re: Intro', 'Please loop in Sarah at sarah@company.com.'), false);
      assert.strictEqual(isOptOutReply('Re: Question', 'What is your pricing model?'), false);
    });

    test('does NOT flag replies quoting original email containing unsubscribe link as opt-outs', () => {
      const trailEmailBody = `Hey Neha,
I'm attaching two profiles that need to be closed. Please check and see if you can support in these.
Best Regards,Dushyant Singh
On Thu, Sep 3, 2026 at 11:02 AM Neha <rohan@hireologist.co.in> wrote:
Hi Dushyant,
Neha reaching out from Hireologist, a dedicated Talent Partner.
Sent by Hireologist
Jaipur, Rajasthan
Unsubscribe from these emails.`;

      assert.strictEqual(
        isOptOutReply('Recruitment proposal | Nuuk X Hireologist || 03-09-2026', trailEmailBody),
        false
      );
      assert.strictEqual(
        isOptOutReply('Re: Recruitment proposal', "Sounds good, let's talk.\n\n> Unsubscribe from these emails."),
        false
      );
    });

    test('detects unsubscribe keyword from subject only', () => {
      assert.strictEqual(isOptOutReply('Unsubscribe - prospect@client.com', ''), true);
      assert.strictEqual(isOptOutReply('Re: Unsubscribe', ''), true);
      assert.strictEqual(isOptOutReply('Please unsubscribe me', ''), true);
      assert.strictEqual(isOptOutReply('unsubscribe', ''), true);
      // Body mentioning unsubscribe without subject mentioning unsubscribe should NOT opt-out
      assert.strictEqual(isOptOutReply('Re: Quick question', 'Here is the footer:\nUnsubscribe from these emails.'), false);
    });
    test('stripQuotedReply cleans quoted history correctly', () => {
      const raw = `Sounds great, sending over the documents now.
On Thu, Sep 3, 2026 at 11:02 AM Neha <rohan@hireologist.co.in> wrote:
> Hi Dushyant,
> Sent by Hireologist
> Unsubscribe from these emails.`;

      assert.strictEqual(stripQuotedReply(raw), 'Sounds great, sending over the documents now.');
    });
  });

  describe('Sentiment vs Opt-out protection logic', () => {
    test('POSITIVE or NEUTRAL sentiment is protected against opt-out override', () => {
      const isProtected = (sentiment, subject, body) => {
        return (sentiment !== 'POSITIVE' && sentiment !== 'NEUTRAL') && isOptOutReply(subject, body);
      };

      // Even if subject somehow had opt-out keyword, POSITIVE/NEUTRAL sentiment protects genuine interest
      assert.strictEqual(isProtected('POSITIVE', 'Re: Recruitment proposal', 'Attaching two profiles'), false);
      assert.strictEqual(isProtected('NEUTRAL', 'Re: Recruitment proposal', 'Please check back next quarter'), false);

      // NEGATIVE or unknown sentiment with explicit opt-out is correctly flagged
      assert.strictEqual(isProtected('NEGATIVE', 'Unsubscribe - prospect@client.com', ''), true);
      assert.strictEqual(isProtected('NEGATIVE', 'Re: Outreach', 'Please remove me from your list.'), true);
      assert.strictEqual(isProtected('REPLIED', 'Unsubscribe', ''), true);
    });
  });

  describe('addToSuppression() parameter contract', () => {
    test('successfully executes append callback with normalized email and reason', async () => {
      let appendedValues = null;
      const appendFn = async (email, reason, timestamp) => {
        appendedValues = { email, reason, timestamp };
      };

      await addToSuppression('  OPTOUT_USER@example.com  ', 'Unsubscribed via reply', appendFn);

      assert.ok(appendedValues !== null);
      assert.strictEqual(appendedValues.email, 'optout_user@example.com');
      assert.strictEqual(appendedValues.reason, 'Unsubscribed via reply');
      assert.ok(typeof appendedValues.timestamp === 'string');

      // In-memory cache is updated immediately
      const cached = await isSuppressed('optout_user@example.com');
      assert.strictEqual(cached, true);
    });
  });

  describe('Follow-up suppression behavior simulation', () => {
    test('identifies suppressed leads before dispatching follow-up', async () => {
      const suppressionList = ['lead-unsub@company.com', 'bounced-lead@corp.net'];
      const readSuppressionFn = async () => suppressionList;

      // Unsubscribed lead should be caught
      const isUnsubSuppressed = await isSuppressed('lead-unsub@company.com', readSuppressionFn);
      assert.strictEqual(isUnsubSuppressed, true);

      // Normal lead should NOT be suppressed
      const isNormalSuppressed = await isSuppressed('interested-buyer@corp.com', readSuppressionFn);
      assert.strictEqual(isNormalSuppressed, false);
    });
  });
});

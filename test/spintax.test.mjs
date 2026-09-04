import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpintax } from '../src/spintax.mjs';

describe('Spintax Module Unit & Simulation Tests', () => {
  test('parses standard double-bracket spintax {{a | b | c}}', () => {
    const template = '{{Hi|Hey|Hello}}';
    const variations = new Set();
    for (let i = 0; i < 30; i++) {
      variations.add(parseSpintax(template));
    }
    assert.ok(variations.has('Hi') || variations.has('Hey') || variations.has('Hello'));
    assert.ok(variations.size > 1);
  });

  test('parses triple-bracket and single-bracket spintax', () => {
    assert.ok(['a', 'b'].includes(parseSpintax('{{{a|b}}}')));
    assert.ok(['x', 'y'].includes(parseSpintax('{x|y}')));
  });

  test('preserves non-spintax template variables untouched', () => {
    const template = 'Hello {{full_name}}, welcome to {{company_name}} in {{location}}!';
    const parsed = parseSpintax(template);
    assert.strictEqual(parsed, template);
  });

  test('handles nested or multiple spintax blocks', () => {
    const template = '{{Hi|Hello}} {{full_name}}, {{Hope you are well|Good day}}!';
    const parsed = parseSpintax(template);
    assert.ok(parsed.startsWith('Hi ') || parsed.startsWith('Hello '));
    assert.ok(parsed.includes('{{full_name}}'));
    assert.ok(parsed.includes('Hope you are well') || parsed.includes('Good day'));
  });

  test('runs 200-iteration simulation on standard multi-sentence email pitch', () => {
    const template = `{{Hi|Hey|Hello}} {{full_name}},

{{Hope you are doing well|Hope all is well with you|Hope you are having a great week}}!

{{I noticed your expansion in|Saw your team growing in}} {{location}}. 

{{Would you be open to a quick 5-min sync?|Are you free for a brief call this week?}}

{{Best|Best regards|Cheers}},
Team`;

    const sampleNames = ['Rohan Patel', 'Sarah Jenkins', 'Amit Sharma', 'Elena Rostova', 'David Chen'];
    const sampleLocations = ['Bengaluru', 'Mumbai', 'New York', 'London', 'Singapore'];

    const uniqueEmails = new Set();

    for (let i = 1; i <= 200; i++) {
      const name = sampleNames[i % sampleNames.length];
      const loc = sampleLocations[i % sampleLocations.length];

      let email = parseSpintax(template);
      email = email.replace(/{{full_name}}/g, name).replace(/{{location}}/g, loc);

      // Verify no unparsed pipes or malformed tags remain
      assert.strictEqual(email.includes('|'), false);
      assert.ok(email.includes(name));
      assert.ok(email.includes(loc));

      uniqueEmails.add(email);
    }

    // Must generate rich entropy/variations
    assert.ok(uniqueEmails.size >= 50);
  });

  test('resolves deeply nested spintax without leaving unparsed pipes or brackets', () => {
    const nested = '{{First choice | {{Nested 1 | Nested 2}}}} and {A|{B|C}}';
    for (let i = 0; i < 50; i++) {
      const res = parseSpintax(nested);
      assert.strictEqual(res.includes('|'), false, `Result "${res}" should not contain pipe '|'`);
      assert.strictEqual(res.includes('{'), false, `Result "${res}" should not contain '{'`);
      assert.strictEqual(res.includes('}'), false, `Result "${res}" should not contain '}'`);
    }
  });
});

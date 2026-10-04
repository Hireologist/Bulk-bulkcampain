import { stripQuotedReply } from './suppression.mjs';
import { sendWithRetry } from './retry.mjs';

function cleanCandidateNumber(raw) {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/[.,;:"'`*~]+$/, '') // remove trailing punctuation
    .replace(/^[:\-–#\s]+/, '')    // remove leading delimiters
    .replace(/\s+/g, ' ');        // normalize multiple spaces
}

function isValidPhoneNumber(num) {
  if (!num) return false;
  const digits = num.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;

  // Reject date patterns (e.g., 2026/08/22, 22-08-2026)
  if (/^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(num)) return false;
  // Reject times (e.g. 15:30:00)
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(num)) return false;
  // Reject IP addresses (e.g., 192.168.1.1)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(num)) return false;

  return true;
}

/**
 * Deterministic fallback regex extractor for phone numbers from email text / signatures.
 * Extracts direct phone, mobile, cell, WhatsApp, or telephone numbers.
 */
export function extractPhoneNumberFallback(text = '') {
  if (!text || typeof text !== 'string') return '';

  // 🛡️ SENDER PHONE NUMBER SAFEGUARD:
  // Strip quoted reply threads and email history first so we NEVER extract the sender's own
  // phone number or company contact info that was part of the original outreach email signature!
  const replyOnlyText = stripQuotedReply(text);
  if (!replyOnlyText) return '';

  const cleanText = replyOnlyText.replace(/\r\n/g, '\n');

  // Pattern 1: Explicitly labeled numbers (e.g. Phone:, Mob:, Mobile:, Cell:, Tel:, WhatsApp:, Call:)
  const labeledRegex = /(?:phone|mobile|mob|cell|tel|telephone|direct|call|whatsapp|contact|ph|m|o)\s*[:#–-]?\s*([+]?[(]?[0-9]{1,4}[)]?[-\s./]?(?:[(]?[0-9]{1,5}[)]?[-\s./]?){1,5}[0-9]{2,6})/i;
  const labeledMatch = cleanText.match(labeledRegex);
  if (labeledMatch && labeledMatch[1]) {
    const candidate = cleanCandidateNumber(labeledMatch[1]);
    if (isValidPhoneNumber(candidate)) return candidate;
  }

  // Pattern 2: International formatted numbers (+XX ...)
  const intlRegex = /(?:^|[\s,;:(])(\+[1-9]\d{0,3}[-\s.]?\(?\d{1,4}\)?[-\s.]?\d{2,5}[-\s.]?\d{2,6})(?=[\s,;:).!?]|$)/gm;
  let match;
  while ((match = intlRegex.exec(cleanText)) !== null) {
    const candidate = cleanCandidateNumber(match[1]);
    if (isValidPhoneNumber(candidate)) return candidate;
  }

  // Pattern 3: Standard North American / UK / Indian domestic formatted numbers:
  // e.g., (555) 123-4567, 555-123-4567, 98800 82711, 07123 456789
  const domesticRegex = /(?:^|[\s,;:(])(\(?\d{3,5}\)?[-.\s]\d{3,4}[-.\s]\d{3,5})(?=[\s,;:).!?]|$)/gm;
  while ((match = domesticRegex.exec(cleanText)) !== null) {
    const candidate = cleanCandidateNumber(match[1]);
    if (isValidPhoneNumber(candidate)) return candidate;
  }

  return '';
}

// Helper for AI Email Sentiment Classification, Summarization & Phone Extraction (Resilient Fallback)
export async function classifyEmailWithAi(groq, emailText = '') {
  // 🛡️ SENDER PHONE NUMBER SAFEGUARD:
  // Strip quoted reply history first so AI only analyzes the lead's new reply,
  // preventing false classification and preventing sender phone number extraction.
  const cleanEmailText = stripQuotedReply(emailText);
  let sentiment = 'REPLIED';
  let summary = (cleanEmailText || emailText || '').trim().replace(/\s+/g, ' ').substring(0, 150);
  if (summary.length === 150) summary += '...';
  let phone = extractPhoneNumberFallback(cleanEmailText);

  if (!groq || !cleanEmailText) {
    return { sentiment, summary, phone };
  }

  const modelsToTry = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b'
  ];

  for (const model of modelsToTry) {
    try {
      const aiRes = await sendWithRetry(() => groq.chat.completions.create({
        model,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: `You are an expert sales email assistant. Analyze the incoming lead reply and respond ONLY with a raw, valid JSON object containing exactly 3 keys:
{
  "sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "OOO",
  "summary": "1-2 sentence summary of the lead's message, questions, or objections",
  "phone": "Extracted phone, mobile, WhatsApp, or direct contact number from the lead's new reply or signature, or empty string \\"\\" if not found"
}

Definitions:
- "POSITIVE": Interested, asking for pricing/call/demo, sharing calendar link, requesting info.
- "NEUTRAL": Forwarded to another person, ask to reach back in a few months, generic reply.
- "NEGATIVE": Not interested, asking to unsubscribe/remove, angry, not relevant.
- "OOO": Automated Out of Office / Vacation auto-responder.

Phone Extraction Guidance:
- Look ONLY in the lead's current message, closing, and signature block for contact numbers (e.g., "Mobile: +91 9880082711", "Call me at (555) 123-4567", "Tel: +1-800-555-0199", "WhatsApp: +44 7911 123456", "Phone: 9876543210").
- CRITICAL SENDER PROTECTION: NEVER extract the sender's outreach phone number, company number, or numbers from quoted email history or footers.
- Clean the phone number (preserve leading +, country code, digits, standard separators like space or dash).
- If no phone number is found in the lead's reply, return "".

Do NOT include markdown backticks or any conversational text. Return only the JSON.`
          },
          { role: 'user', content: cleanEmailText.substring(0, 3000) }
        ],
      }), { retries: 2, baseDelay: 1000 });

      const rawText = aiRes.choices[0]?.message?.content?.trim() || '';
      const cleanJsonText = rawText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '')
        .trim();
      const parsedObj = JSON.parse(cleanJsonText);

      if (parsedObj.sentiment) {
        sentiment = String(parsedObj.sentiment).trim().toUpperCase();
      }
      if (parsedObj.summary) {
        summary = String(parsedObj.summary).trim();
      }
      if (parsedObj.phone !== undefined && parsedObj.phone !== null) {
        const aiPhone = cleanCandidateNumber(String(parsedObj.phone));
        if (isValidPhoneNumber(aiPhone)) {
          phone = aiPhone;
        }
      }
      return { sentiment, summary, phone };
    } catch (e) {
      console.warn(`Groq AI classification with ${model} failed (${e.message}), trying fallback model...`);
    }
  }

  return { sentiment: 'unknown', summary, phone };
}

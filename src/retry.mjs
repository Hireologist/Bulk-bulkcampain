/**
 * Exponential Backoff Retry Wrapper
 * Wraps flaky network operations (SMTP sends, Sheets API, Groq inference).
 */

export async function sendWithRetry(fn, { retries = 3, baseDelay = 2000, factor = 2, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;

      const delay = baseDelay * (factor ** attempt);
      if (typeof onRetry === 'function') {
        onRetry(err, attempt + 1, delay);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

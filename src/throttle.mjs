/**
 * Adaptive Throttle & Reputation Shield
 * Adjusts send delay dynamically based on per-inbox health metrics,
 * or supports high-volume Bulk Mode (ignoring bounce/complaint penalties).
 */

export function getSendDelay(stats = {}, options = {}) {
  const mode = String(options.throttleMode || options.mode || 'adaptive').toLowerCase();

  // 🚀 BULK / FIXED / TURBO MODE: Ignores bounce & complaint penalties completely
  if (mode === 'bulk' || mode === 'fixed' || mode === 'turbo' || options.bypassThrottle) {
    const minSec = options.minDelaySeconds !== undefined ? Number(options.minDelaySeconds) : (options.minDelay !== undefined ? Number(options.minDelay) : 1);
    const maxSec = options.maxDelaySeconds !== undefined ? Number(options.maxDelaySeconds) : (options.maxDelay !== undefined ? Number(options.maxDelay) : 3);
    const minMs = Math.max(0, minSec * 1000);
    const maxMs = Math.max(minMs, maxSec * 1000);
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }

  // 🛡️ ADAPTIVE SAFE MODE (Default)
  const sent = Math.max(stats.sent || 0, 1);
  const bounceRate = (stats.bounced || 0) / sent;
  const complaintRate = (stats.complaints || 0) / sent;

  if (complaintRate > 0.003) return 60_000; // reputation risk — slow to 1/min
  if (bounceRate > 0.05) return 15_000;     // list quality issue — ease to 1/15s
  if ((stats.sentToday || 0) < 20) return 8_000; // daily ramp-up
  return 3_000;                             // steady state, fast & reliable
}

export function trackOutcome(stats = {}, outcome) {
  const current = {
    sent: Number(stats.sent) || 0,
    bounced: Number(stats.bounced) || 0,
    complaints: Number(stats.complaints) || 0,
    sentToday: Number(stats.sentToday) || 0,
    lastReset: stats.lastReset || new Date().toISOString().split('T')[0],
  };

  if (outcome === 'sent') {
    current.sent += 1;
    current.sentToday += 1;
  } else if (outcome === 'bounced') {
    current.bounced += 1;
  } else if (outcome === 'complaint') {
    current.complaints += 1;
  }

  return current;
}

export function checkAndResetDailyStats(stats = {}) {
  const today = new Date().toISOString().split('T')[0];
  const lastReset = stats.lastReset || today;

  if (lastReset !== today) {
    return {
      ...stats,
      sentToday: 0,
      lastReset: today,
    };
  }

  return {
    ...stats,
    lastReset,
  };
}

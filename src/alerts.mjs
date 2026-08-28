/**
 * Discord Observability & Telemetry Alerts
 */

export async function postToDiscord(webhookUrl, content, embeds = []) {
  if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('http')) {
    return { success: false, reason: 'Invalid or missing Discord Webhook URL' };
  }

  try {
    const payload = { content };
    if (Array.isArray(embeds) && embeds.length > 0) {
      payload.embeds = embeds;
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, status: res.status, error: errText };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Check inbox metrics and alert if bounce/complaint rate exceeds safe thresholds
 */
export async function alertIfUnhealthy(inboxStats = {}, webhookUrl) {
  if (!webhookUrl) return null;

  const email = inboxStats.email || inboxStats.inbox_email || 'Unknown Inbox';
  const sent = Math.max(Number(inboxStats.sent) || 0, 1);
  const bounced = Number(inboxStats.bounced) || 0;
  const complaints = Number(inboxStats.complaints) || 0;

  const bounceRate = bounced / sent;
  const complaintRate = complaints / sent;

  if (complaintRate > 0.003) {
    const msg = `🚨 **High Spam Complaint Alert**: Inbox \`${email}\` has a complaint rate of **${(complaintRate * 100).toFixed(2)}%** (${complaints}/${sent}). Sending throttled!`;
    await postToDiscord(webhookUrl, msg);
    return 'complaint_alert_sent';
  }

  if (bounceRate > 0.05) {
    const msg = `⚠️ **Deliverability Warning**: Inbox \`${email}\` has a bounce rate of **${(bounceRate * 100).toFixed(1)}%** (${bounced}/${sent}). Check your lead verification.`;
    await postToDiscord(webhookUrl, msg);
    return 'bounce_alert_sent';
  }

  return 'healthy';
}

/**
 * Send run digest summary to Discord
 */
export async function sendRunSummaryAlert(summary = {}, webhookUrl) {
  if (!webhookUrl) return;

  const embed = {
    title: '📊 Sheet-bot Execution Digest',
    color: summary.errors > 0 ? 0xff4d4d : 0x00cc88,
    fields: [
      { name: 'Processed Leads', value: String(summary.processed || 0), inline: true },
      { name: 'Sent Successfully', value: String(summary.sent || 0), inline: true },
      { name: 'Replies Detected', value: String(summary.replies || 0), inline: true },
      { name: 'Drafts Created', value: String(summary.drafts || 0), inline: true },
      { name: 'Failed Sends', value: String(summary.failed || 0), inline: true },
      { name: 'Duration', value: `${summary.durationSeconds || 0}s`, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };

  await postToDiscord(webhookUrl, `Run completed at ${new Date().toLocaleTimeString()}`, [embed]);
}

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isGccRadarEnabled, selectGccRadarDiscordWebhook } from '../scripts/run-gcc-radar.mjs';

describe('GCC Leadership Radar Configuration & Settings Tests', () => {
  it('should disable GCC Radar by default and enable only when explicitly set to TRUE', () => {
    assert.strictEqual(isGccRadarEnabled({}), false);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'TRUE' }), true);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'true' }), true);
    assert.strictEqual(isGccRadarEnabled({ gcc_leadership_radar_enabled: 'TRUE' }), true);
  });

  it('should disable GCC Radar when explicitly set to FALSE, OFF, 0, NO, or MUTE', () => {
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'FALSE' }), false);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'false' }), false);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'OFF' }), false);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: '0' }), false);
    assert.strictEqual(isGccRadarEnabled({ gcc_radar_enabled: 'mute' }), false);
  });

  it('should select dedicated GCC Radar Discord Webhook with proper fallbacks', () => {
    const customGccWebhook = 'https://discord.com/api/webhooks/gcc_radar_custom';
    const fallbackWebhook = 'https://discord.com/api/webhooks/general_updates';

    assert.strictEqual(
      selectGccRadarDiscordWebhook({ discord_gcc_radar_webhook: customGccWebhook }, 'https://discord.com/api/webhooks/env_fallback'),
      customGccWebhook
    );

    assert.strictEqual(
      selectGccRadarDiscordWebhook({ discord_leadership_webhook: customGccWebhook }, ''),
      customGccWebhook
    );

    assert.strictEqual(
      selectGccRadarDiscordWebhook({}, 'https://discord.com/api/webhooks/env_fallback'),
      'https://discord.com/api/webhooks/env_fallback'
    );

    assert.strictEqual(
      selectGccRadarDiscordWebhook({ discord_updates_webhook: fallbackWebhook }, ''),
      fallbackWebhook
    );
  });
});

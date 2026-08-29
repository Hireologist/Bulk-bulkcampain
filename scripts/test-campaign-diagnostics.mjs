#!/usr/bin/env node
import { runCampaignDiagnostics } from './run-campaign-diagnostics.mjs';
import { fileURLToPath } from 'url';

/**
 * 🩺 Campaign Pre-Flight Diagnostic Runner
 * Direct entry-point wrapper for GitHub Actions and CLI execution.
 */
export { runCampaignDiagnostics };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCampaignDiagnostics().catch((err) => {
    console.error('Fatal diagnostic runner error:', err);
    process.exit(1);
  });
}

/**
 * =========================================================================
 * 🚀 UNIVERSAL COLD OUTREACH ENGINE (DISTRIBUTION RUNNER)
 * =========================================================================
 * Execution environment: Node.js 22.14.0 (Active LTS)
 * Bytecode binary: dist/engine.jsc
 * =========================================================================
 */
import { createRequire } from 'node:module';
import 'bytenode';

const require = createRequire(import.meta.url);
const engine = require('./dist/engine.jsc');

export const {
  runColdOutreach,
  runFollowups,
  runInboxChecker,
  runSingleLeadOutreach,
  generateDailyDigest,
  saveUnsentOverflowLeads,
  verifyLicense,
  main
} = engine;

export default engine;

// Execute CLI router when run directly
if (typeof engine.main === 'function') {
  engine.main();
}

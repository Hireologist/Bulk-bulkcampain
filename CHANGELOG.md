# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] - 2026-10-04

### Refactored & Modularized
- **Domain-Driven Modular Architecture**:
  - Modularized the monolithic 2,217-line `engine.mjs` into focused, single-responsibility modules under `src/` with zero code deletion and 100% backward compatibility.
  - Reduced `engine.mjs` from 2,217 lines down to 175 lines (**92.1% reduction**), functioning as a clean public façade and CLI task dispatcher.
  - Extracted `src/sheets-io.mjs`: Google Sheets authentication, tab loading with A:ZZ horizontal scaling, dead-letter `Failed_Sends` logging, `Inbox_Stats` loading/persistence, and IMAP draft saving.
  - Extracted `src/scheduler.mjs`: Timezone cutoff resolution, 6-hour GitHub Actions runner chaining, Discord webhook alerts, template variable/spintax interpolation, and multi-touch due date calculations.
  - Extracted `src/ai-classifier.mjs`: Groq AI email sentiment classification, sender phone number safeguard, and fallback regex contact phone number extraction.
  - Extracted `src/workflows/`: Dedicated execution runner modules for `cold-outreach.mjs`, `single-lead.mjs`, `followup.mjs`, `inbox-checker.mjs`, and `daily-digest.mjs`.
  - Maintained 100% pass rate across the full 178-test suite with zero regressions.

## [2.3.3] - 2026-10-04

### Hardened & Optimized
- **Horizontal Sheet Column Scalability (`engine.mjs`)**:
  - Expanded `loadTab` range query from `'${tabName}'!A:Z` to `'${tabName}'!A:ZZ`, safely supporting sheets with up to 702 columns without truncating custom enrichment data or CRM attributes.
- **Follow-Up Adaptive Throttling & `Inbox_Stats` Tracking (`engine.mjs`)**:
  - Connected `loadInboxStatsMap` and `saveInboxStatsMap` to `runFollowups`.
  - Dynamically calculates dispatch delay using `getSendDelay(currentInboxStats)` in adaptive mode, preventing reputation damage if an inbox suffers bounces or complaints during follow-up dispatches.
  - Automatically updates `sent` and `sentToday` stats in `Inbox_Stats` upon successful follow-up sends.
  - Added dependency injection support for `customTransporter` and `customConfig.transporter` for test isolation.
- **Peer Warmup Spintax Lexical Entropy (`src/warmup.mjs`)**:
  - Enriched warmup subject lines and email bodies with nested spintax patterns (e.g. `{Quick|Brief}`, `{today’s|our earlier}`, `{Hey|Hi|Hello}`, `{productive|great|wonderful}`).
  - Integrated `parseSpintax` into `runWarmupCycle` to ensure peer-to-peer warmup emails vary across cycles and avoid hash-fingerprinting by ESP spam filters.
- **Test Suite Expansion (`test/`)**:
  - Added comprehensive unit tests for `loadTab` A:ZZ horizontal range query and follow-up `Inbox_Stats` tracking in `test/engine.test.mjs`.
  - Added spintax resolution unit test in `test/warmup.test.mjs`.
  - Expanded test coverage to 178 passing tests across 53 test suites with 0 failures (100% pass rate).

## [2.3.2] - 2026-09-30

### Fixed & Enhanced
- **Dynamic Campaign Cutoff Time Resolution (`engine.mjs`)**:
  - Implemented `resolveCutoffConfig(settings)` to dynamically resolve custom cutoff times from Google Sheets settings.
  - Supports unified time strings (`cutoff_time`, `cutoff_time_ist` e.g. `"20:00"`, `"8:00 PM"`, `"8:30pm"`), split keys (`cutoff_hour_ist` and `cutoff_minute_ist`), case-insensitivity, and whitespace trimming.
  - Replaced the hardcoded `'Cutoff time reached (6:30 PM IST)'` stopping reason in `shouldRestartWorkflow` with the actual formatted cutoff time (e.g. `'Cutoff time reached (8:00 PM IST)'`).
  - Updated cold outreach and follow-up Discord runner threshold alert embeds to display the dynamic cutoff label.
  - Added unit test coverage in `test/engine.test.mjs` verifying unified time parsing, 12h/24h formats, split keys, whitespace handling, and dynamic reason reporting.
  - Test suite expanded to 172 passing tests across 51 test suites with 0 failures.

## [2.3.1] - 2026-09-27

### Security & Hardening
- **Cryptographic Unsubscribe Secret Hierarchy (`src/suppression.mjs`)**:
  - Implemented `resolveUnsubscribeSecret` resolving secrets from `UNSUBSCRIBE_SECRET`, `settings.unsubscribe_secret`, and `JWT_SECRET` with fallback warning.
  - Added unit test coverage verifying dynamic secret resolution and mismatch protection.
- **Complete HTML Attribute Escaping (`chrome-extension/popup.js`)**:
  - Enhanced `escapeHtml` to escape quotes (`"`, `'`) preventing attribute breakouts when injecting dynamic user or repository inputs.
  - Exported `escapeHtml` and added frontend security unit test.

### Reliability & Resilience
- **Robust Service Account JSON Parsing (`scripts/auto-setup.mjs`, `scripts/run-domain-health.mjs`)**:
  - Exported `parseServiceAccountCredentials` to safely handle JSON parsing with descriptive, user-friendly error guidance on malformed credentials.
- **Git Snapshot Exporter Cleanup (`scripts/export-all-versions.mjs`)**:
  - Wrapped temporary archive zip extraction in `try ... finally` block to guarantee intermediate disk space cleanup even upon extraction failure.
- **Test Runner Glob Optimization (`package.json`)**:
  - Updated test runner script to support nested test suites across both Windows PowerShell and Unix environments.
  - Test suite expanded to 166 passing tests across 51 test suites with 0 failures.

## [2.3.0] - 2026-09-27

### Added & Enhanced
- **Multi-Repository Discord Telemetry & Contextual Observability (`src/alerts.mjs`, `engine.mjs`)**:
  - Automatically prepends repository slug `**[owner/repo]**` to all Discord webhook messages and embed footers (`owner/repo • Deliverability & Security Monitor`, `owner/repo • Execution Digest`).
  - Added clickable `🔗 [View Run]` links directly to the originating GitHub Actions workflow run logs.
  - Outreach start notifications now include active mailbox count and queued leads count.
  - Outreach completion notifications now report duration, inboxes used ratio, and a per-inbox breakdown of sent emails or drafts saved.
  - Task failure alerts now provide contextual diagnostic hints (e.g. Google App Password revocation with 1-click links to resolve).
  - Added memoization to `getRepoSlug()` and 2,000-character payload truncation protection to prevent Discord webhook rejections.
  - Added 14 unit tests in `test/alerts.test.mjs` verifying repository context helpers, link construction, and embed formatting.
- **Documentation**:
  - Updated `README.md`, `docs/DISCORD_WEBHOOK_SETUP.md`, and `docs/MULTI_CAMPAIGN_GUIDE.md` with multi-repo monitoring documentation and updated test pass badges (163/163 passing).

## [2.2.2] - 2026-09-12

### Fixed & Enhanced
- **Single Lead Authentication Error Handling (`engine.mjs`)**:
  - Fixed a `ReferenceError` where `inboxToUse.email` was referenced instead of `inbox.email` in `runSingleLeadOutreach()`, ensuring Discord authentication failure alerts and Step Summaries are reliably dispatched.
  - Added regression test in `test/engine.test.mjs` verifying clean error variable scoping.
- **Documentation**:
  - Updated test badges and metrics in `README.md` to reflect 156 passing tests across 28 test suites.

## [2.2.1] - 2026-09-04

### Security & Hardening
- **GitHub Actions Security**: Remediated shell injection risk in `.github/workflows/outreach.yml` by mapping all untrusted client payload variables through step-level environment variables.
- **Workflow Security Test Suite**: Added `test/workflow_security.test.mjs` to automatically guard against unsafe template interpolation in CI/CD `run:` blocks.

### Fixed & Enhanced
- **Deliverability & DNS Checking (`src/dns-check.mjs`)**:
  - Added case-insensitive matching for DMARC and SPF tags (`v=dmarc1`).
  - Added multi-chunk DNS TXT record concatenation to prevent split SPF/DMARC records from failing checks.
- **Robust Spintax Resolution (`src/spintax.mjs`)**:
  - Implemented balanced bracket parsing (`Math.min(openBraces.length, closeBraces.length)`) and stateless while condition loops to seamlessly resolve nested spintax without leaking brackets or pipe characters.
- **Resilient Exponential Backoff (`src/retry.mjs`)**:
  - Added `isFatal(err)` predicate support to immediately short-circuit permanent authentication failures (SMTP 535 / EAUTH) without delaying alerts.
- **Repository Hygiene**:
  - Removed stale duplicate `gcc_tracker.py` from root directory.
  - Added `*.db` to `.gitignore` and untracked `scripts/gcc_leads.db` from version control.

## [2.2.0] - 2026-08-28

### Added
- **1-Click Auto-Provisioning Engine**:
  - `scripts/auto-setup.mjs` & `.github/workflows/setup_engine.yml`: Automatically provisions all 11 Google Sheet tabs, headers, sample leads, default settings, and syncs cron jobs with zero manual spreadsheet editing.
- **Spintax (Spin Syntax) Engine**:
  - `src/spintax.mjs`: Standalone Spintax parser supporting `{{Hi|Hey|Hello}}` and `{{option 1 | option 2}}` across subject lines and email bodies.
  - Comprehensive unit and 200-iteration simulation tests (`test/spintax.test.mjs`).
- **Campaign Active / Pause Control**:
  - Added master `campaign_active = TRUE/FALSE` switch and granular `outreach_active` / `followup_active` settings.
- **High-Speed Bulk Campaign Mode**:
  - Added `throttle_mode = 'bulk'` to bypass adaptive slowdown penalties for 1500+ blasts.
- **Intelligent Inbox-Alias Routing**:
  - Explicit mailbox assignment via `inbox_email` in `Aliases` tab and automatic domain isolation.
- **Dynamic Cron Timezones & Schedules**:
  - Non-destructive diffing against `cron-job.org` with dynamic timezone (`cron_timezone`) and custom send times (`cron_outreach_time`, `cron_followup_time`).
- **Discord Notification Toggles**:
  - Added `discord_alerts_enabled` and `discord_domain_alerts_enabled` in `Settings`.

## [1.0.0] - 2026-08-28

### Added
- **Production Hardening Core**:
  - `src/throttle.mjs`: Adaptive rate limiter adjusting send delay based on complaint rate, bounce rate, and daily ramp-up.
  - `src/retry.mjs`: Resilient exponential backoff wrapper for all external network requests (SMTP, Sheets API, Groq).
  - `src/dns-check.mjs`: DNS TXT record inspector auditing SPF (`v=spf1`) and DMARC (`v=DMARC1`) configuration.
  - `src/warmup.mjs`: Autonomous peer-to-peer inbox warmup routine with progressive daily ramp-up.
  - `src/suppression.mjs`: High-performance 5-minute cached global suppression list and HMAC signed one-click unsubscribe token generator.
  - `src/alerts.mjs`: Discord webhook notifications for bounce warnings, health anomalies, and execution summaries.
- **Reliability & Degradation**:
  - `Failed_Sends` Dead Letter Queue tab integration to preserve unsent lead states and diagnostic error traces.
  - Resilient Groq sentiment fallback defaulting to `unknown` without interrupting active send loops.
  - IMAP Drafts review mode (`send_mode = 'review'`) saving initial outreach touches directly to account drafts.
- **Observability & CI/CD**:
  - Weekly DNS domain health audit workflow (`.github/workflows/domain-health.yml`).
  - Automated Continuous Integration workflow (`.github/workflows/ci.yml`) with unit test suites and Gitleaks security scanning.
  - System architecture documentation (`docs/ARCHITECTURE.md`) and security protocol runbook (`docs/SECURITY.md`).

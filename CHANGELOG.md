# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

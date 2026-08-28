# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

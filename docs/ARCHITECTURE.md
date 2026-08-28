# 🏛️ System Architecture & Visual Implementation Guide

Sheet-bot is a serverless-ready, Google Sheets-native cold outreach, warmup, and follow-up engine designed to run via **GitHub Actions**, **cron-job.org**, or locally with **zero persistent database costs**.

---

## 🗺️ 1. End-to-End System Architecture

```mermaid
flowchart TB
    subgraph TriggerLayer["⏱️ Trigger Layer"]
        CJ["cron-job.org (Scheduled Crons)"]
        GHA_Man["GitHub Actions UI (Manual Triggers)"]
        Dashboard["GitHub Pages Dashboard (Cloud Dispatch)"]
    end

    subgraph OrchestrationLayer["⚙️ GitHub Actions Orchestrator (Serverless)"]
        SetupWF["setup_engine.yml (1-Click Provisioner)"]
        OutreachWF["outreach.yml (Concurrency Lock + Runner)"]
        HealthWF["domain-health.yml (Weekly DNS Health Audit)"]
    end

    subgraph EngineCore["🧠 Engine Core (Node.js)"]
        Throttle["Adaptive Throttle (Reputation Shield)"]
        PreSend["Pre-Send Gate (MX + Suppression Check)"]
        AI["Groq LLM AI (Sentiment & Summaries)"]
        DNS["DNS Check (SPF / DMARC)"]
        Warmup["Peer Warmup Engine"]
    end

    subgraph DataLayer["📊 Google Sheets Master DB"]
        Details["Details (Leads)"]
        Inboxes["Inboxes & Credentials"]
        Settings["Settings & Crons"]
        Suppressed["Suppressed (Opt-outs)"]
        Stats["Inbox_Stats"]
        Health["Domain_Health"]
    end

    subgraph OutputLayer["📬 Inboxes & Notifications"]
        SMTP["Mailbox SMTP (Live Outbound Sends)"]
        Drafts["Mailbox IMAP Drafts (Review Mode)"]
        Discord["Discord Webhooks (Real-Time Alerts & Digest)"]
    end

    CJ --> OutreachWF
    GHA_Man --> OutreachWF
    Dashboard --> OutreachWF
    GHA_Man --> SetupWF

    SetupWF --> DataLayer
    SetupWF --> CJ

    OutreachWF --> EngineCore
    HealthWF --> DNS

    EngineCore --> DataLayer
    DataLayer --> EngineCore
    EngineCore --> SMTP
    EngineCore --> Drafts
    EngineCore --> Discord
    EngineCore --> AI
    DNS --> Health
```

---

## ⚡ 2. 1-Click Zero-Effort Setup Sequence

```mermaid
sequenceDiagram
    autonumber
    actor User as Operator
    participant GHA as GitHub Actions (setup_engine.yml)
    participant GS as Google Sheets Master
    participant CJ as cron-job.org API v2
    participant Disc as Discord Channel

    User->>GS: Create blank spreadsheet & share with Service Account
    User->>GHA: Add 2 secrets (SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON)
    User->>GHA: Click Run Workflow on 1-Click Setup
    GHA->>GS: Connect via Google Sheets API
    GHA->>GS: Create all 11 tabs, headers, default settings & sample data
    GHA->>GS: Read configured timezone & send hours from Settings tab
    GHA->>CJ: Check existing cron jobs
    alt Jobs are up-to-date
        GHA->>CJ: Skip existing matching timers (No-op)
    else Jobs are modified or missing
        GHA->>CJ: PUT / PATCH cron jobs with exact schedule & timezone
    end
    GHA->>Disc: Post Setup Complete Embed Card
    GHA-->>User: Ready to Add Leads & Inboxes!
```

---

## 📬 3. Cold Email Outreach Pipeline

```mermaid
flowchart TD
    Start["Cold Outreach Triggered"] --> LoadConfig["Load Inboxes, Leads & Settings from Google Sheet"]
    LoadConfig --> QuotaCheck{"Any Inbox has Daily Quota remaining?"}
    QuotaCheck -- No --> AllFull["All Inboxes hit Daily Limits -> Stop Safely"]
    QuotaCheck -- Yes --> LeadLoop["Select Next Unsent Lead from Details"]

    LeadLoop --> SuppCheck{"Is Lead Email in Suppressed Tab?"}
    SuppCheck -- Yes --> MarkSupp["Mark suppressed in Sheet & Skip"]
    SuppCheck -- No --> MXCheck{"Valid Email & Has Live MX Records?"}

    MXCheck -- No --> MarkBounce["Mark bounced & Done in Sheet"]
    MXCheck -- Yes --> ModeCheck{"Settings: send_mode?"}

    ModeCheck -- review --> SaveDraft["Save Personalized Pitch into IMAP Drafts"]
    ModeCheck -- auto --> SendLive["Send Email via SMTP with Legal Footer"]

    SaveDraft --> UpdateSheetDraft["Mark Lead as DRAFT_SAVED"]
    SendLive --> TrackMetric["Track Outcome in Inbox_Stats & Increment sentToday"]

    TrackMetric --> AdaptiveDelay["Calculate Adaptive Throttle Delay"]
    AdaptiveDelay --> DelayWait["Wait 3s - 60s based on Reputation"]
    DelayWait --> QuotaCheck
```

---

## 🤖 4. 24/7 Inbox Monitoring & AI Reply Classification

```mermaid
flowchart TD
    InboxStart["Inbox Checker Triggered"] --> ScanInboxes["Connect to Mailboxes via IMAP"]
    ScanInboxes --> FetchUnseen["Fetch all Unseen Inbound Messages"]
    FetchUnseen --> MarkSeen["Batch Mark UIDs as Seen"]
    MarkSeen --> MsgLoop["Inspect Next Email"]

    MsgLoop --> TypeCheck{"Is Mailer-Daemon / Bounce Notice?"}
    TypeCheck -- Yes --> ExtractBounce["Extract Dead Email Address"]
    ExtractBounce --> UpdateBounceSheet["Update Details: Status = bounced, Followup = Done"]

    TypeCheck -- No --> ProspectReply["Match Lead in Details Tab"]
    ProspectReply --> GroqAI["Send Reply to Groq LLM Classifier"]

    GroqAI --> ParseSentiment{"AI Sentiment Result"}

    ParseSentiment -- Positive or Neutral --> UpdatePositive["Update Details: Status = replied, Followup = Done"]
    UpdatePositive --> PostPositiveDiscord["Send Instant Alert to Discord"]

    ParseSentiment -- Negative or Opt-Out --> AutoSuppress["Update Details: Status = suppressed & Append to Suppressed Tab"]

    ParseSentiment -- Out of Office --> MarkOOO["Mark Followup as OOO & Pause Sequence"]
```

---

## 🔁 5. Multi-Touch Follow-up Sequence Engine

```mermaid
flowchart TD
    FollowupStart["Followup Engine Triggered"] --> FindLeads["Filter Leads where Status = SENT & Followup != Done"]
    FindLeads --> CheckDate{"Today >= Next Follow Up Date?"}
    CheckDate -- No --> SkipLead["Skip lead for future run"]
    CheckDate -- Yes --> SuppCheckF{"Is Lead in Suppressed Tab?"}

    SuppCheckF -- Yes --> MarkSuppF["Set Followup = Done & Status = suppressed"]
    SuppCheckF -- No --> MatchAlias["Match Original Sender Alias & Thread Subject"]

    MatchAlias --> SendFollowup["Send Follow-up Touch N via SMTP"]
    SendFollowup --> CheckNextTouch{"Is there a Touch N+1 in Followup_Templates?"}

    CheckNextTouch -- Yes --> ScheduleNext["Set Next Follow Up Date = Today + Interval"]
    CheckNextTouch -- No --> FinishSeq["Set Followup = Done Sequence Finished"]
```

---

## 🛡️ 6. Deliverability Protection & Peer Warmup

```mermaid
flowchart LR
    subgraph HealthCycle["Weekly DNS Health Audit"]
        DNSStart["Audit Inbox Domains"] --> CheckSPF["Resolve SPF v=spf1"]
        DNSStart --> CheckDMARC["Resolve DMARC v=DMARC1"]
        CheckSPF --> LogHealth["Log Results to Domain_Health Tab"]
        CheckDMARC --> LogHealth
    end

    subgraph WarmupCycle["Synthetic Peer Warmup (Daily)"]
        WarmStart["Warmup Triggered"] --> CheckEligibility["Filter inboxes with warmup_enabled = TRUE"]
        CheckEligibility --> RampCalc["Calculate Daily Quota: Day N * 3"]
        RampCalc --> PairPeer["Pair Random Peer Inbox A -> Inbox B"]
        PairPeer --> SendSynthetic["Send Synthetic Warmup Message"]
        SendSynthetic --> IncDay["Increment warmup_day in Inboxes tab"]
    end
```

---

## 📦 7. Module Breakdown

1. **Orchestrator (`engine.mjs`)**: The core execution engine. Connects to Google Sheets, loads runtime configurations, runs reply-checking across inboxes, computes adaptive throttle delays, and handles touch scheduling.
2. **Adaptive Throttle (`src/throttle.mjs`)**: Monitors per-inbox health metrics (bounce rate, spam complaints, sent-today count) and dynamically slows down send velocity (from 3s steady state up to 60s) to protect sender reputation.
3. **Retry Wrapper (`src/retry.mjs`)**: Ensures all external network operations (Google Sheets API, SMTP transports, Groq LLM inferences) gracefully recover from transient network glitches using exponential backoff.
4. **Suppression & Compliance (`src/suppression.mjs`)**: Enforces CAN-SPAM and GDPR compliance by caching suppressed emails in-memory (5-min TTL), validating HMAC-signed unsubscribe tokens, and appending legal company footers.
5. **DNS & Deliverability (`src/dns-check.mjs`)**: Audits DNS TXT records for SPF (`v=spf1`) and DMARC (`v=DMARC1`) to guarantee mailbox authentication.
6. **Peer-to-Peer Warmup (`src/warmup.mjs`)**: Automatically sends synthetic warmup emails between configured inboxes to safely build and maintain domain reputation.
7. **Alerts & Telemetry (`src/alerts.mjs`)**: Transmits actionable diagnostic alerts to Discord when bounce rates exceed thresholds or workflows complete.

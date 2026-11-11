# Sellbird Technical Architecture & System Specification

## 1. Executive Summary

**Sellbird** is an autonomous B2B Sales Development Representative (SDR) and outbound prospecting engine embedded directly into **Social-Nexus**. Modeled on [sellbird.ai](https://sellbird.ai), it eliminates cold outreach grunt work by automating website signal analysis, leadership contact discovery, email validation, hyper-personalized multi-step sequence writing, safe SMTP dispatching, and inbound reply triage—all while enforcing a strict **human-in-the-loop safety boundary**.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Social-Nexus UI (Frontend)                         │
│  - Sellbird SPA Module (public/js/12-sellbird.js & styles.css)              │
│  - Nordic Teal Design (#244b62), Origami Mark, Split-Card Safety Outbox     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ REST API (/api/sellbird/*)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Express 4 Router                                │
│  - Middleware: requireAuth, withWorkspace, injectUserKeys, requirePermission │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       ▼                               ▼                               ▼
┌──────────────┐             ┌────────────────────┐          ┌────────────────┐
│   Crawler    │             │   AI Engine Core   │          │   Dispatcher   │
│ (crawler.js) │             │   (aiEngine.js)    │          │(dispatcher.js) │
│ - Meta/OG    │             │ - Value Prop Synth │          │ - SMTP Pool    │
│ - Tech Stack │             │ - 3-Step Sequences │          │ - Warmup Caps  │
│ - Signals    │             │ - Reply Classifier │          │ - Jitter Delays│
└──────┬───────┘             └─────────┬──────────┘          └────────┬───────┘
       │                               │                              │
       ▼                               ▼                              ▼
┌──────────────┐             ┌────────────────────┐          ┌────────────────┐
│   Contacts   │             │   Heartbeat Loop   │          │  Scheduler /   │
│(contacts.js) │             │   (heartbeat.js)   │◄─────────┤   node-cron    │
│ - Heuristics │             │ - 15-min cadence   │          │(scheduler.js)  │
│ - MX Lookup  │             │ - Batch processor  │          └────────────────┘
└──────┬───────┘             └─────────┬──────────┘
       │                               │
       └───────────────────────────────┴──────────────────────────────┐
                                                                      ▼
                                                       ┌──────────────────────────────┐
                                                       │      sellbirdRepo.js         │
                                                       │ - Multi-tenant isolation     │
                                                       │ - Knex queries (SQLite/Pg)   │
                                                       └──────────────┬───────────────┘
                                                                      ▼
                                                       ┌──────────────────────────────┐
                                                       │       Database Storage       │
                                                       │  - sellbird_campaigns        │
                                                       │  - sellbird_companies       │
                                                       │  - sellbird_contacts        │
                                                       │  - sellbird_outbox          │
                                                       │  - sellbird_replies         │
                                                       └──────────────────────────────┘
```

---

## 3. Data Dictionary & Relational Schema

Migration: `db/migrations/20261108000001_sellbird_tables.js`

### 3.1. `sellbird_campaigns`
Defines an outbound prospecting campaign tied to a specific product or service offer.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | INTEGER / SERIAL | NO | Primary Key |
| `workspace_id` | INTEGER | NO | Multi-tenant tenant boundary |
| `name` | VARCHAR(255) | NO | Campaign name |
| `product_url` | TEXT | YES | Target landing page crawled for training |
| `product_description` | TEXT | YES | Extracted value proposition and core features |
| `icp_definition` | JSON / TEXT | YES | Ideal customer profile (target roles, industries, company size) |
| `sequence_template_json`| JSON / TEXT | YES | 3-step sequence structure configuration |
| `sending_account_id` | INTEGER | YES | Foreign key to `social_accounts` or SMTP configuration |
| `max_emails_per_day` | INTEGER | NO | Daily volume limit (default: 25) |
| `auto_approve` | BOOLEAN | NO | Whether to bypass safety outbox (default: `false`) |
| `status` | VARCHAR(50) | NO | `active`, `paused`, `archived` |
| `created_at` | INTEGER | NO | Epoch timestamp (seconds) |
| `updated_at` | INTEGER | NO | Epoch timestamp (seconds) |

**Indexes:** `(workspace_id, status)`

---

### 3.2. `sellbird_companies`
Target business accounts discovered through prospecting or manual addition.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | INTEGER / SERIAL | NO | Primary Key |
| `workspace_id` | INTEGER | NO | Tenant isolation |
| `campaign_id` | INTEGER | YES | Associated campaign (Foreign Key to `sellbird_campaigns.id`) |
| `name` | VARCHAR(255) | NO | Target company name |
| `domain` | VARCHAR(255) | NO | Company domain (e.g. `example.com`) |
| `location` | VARCHAR(255) | YES | City, State, or Country |
| `industry` | VARCHAR(255) | YES | Target industry sector |
| `buying_signals_json` | JSON / TEXT | YES | Array of signal tags (e.g. `['hiring:cto', 'cms:wordpress', 'tech:react']`) |
| `score` | INTEGER | NO | Match score against ICP (0–100) |
| `status` | VARCHAR(50) | NO | `discovered`, `contacted`, `replied`, `nurturing`, `unqualified` |
| `created_at` | INTEGER | NO | Epoch timestamp (seconds) |
| `updated_at` | INTEGER | NO | Epoch timestamp (seconds) |

**Indexes:** `(workspace_id, domain)`, `(workspace_id, campaign_id)`

---

### 3.3. `sellbird_contacts`
Key decision makers identified within target companies.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | INTEGER / SERIAL | NO | Primary Key |
| `company_id` | INTEGER | NO | Foreign Key to `sellbird_companies.id` (CASCADE) |
| `workspace_id` | INTEGER | NO | Tenant isolation |
| `full_name` | VARCHAR(255) | NO | Prospect's name |
| `role` | VARCHAR(255) | YES | Job title (e.g. `VP of Engineering`, `Founder`) |
| `email` | VARCHAR(255) | YES | Predicted or discovered business email |
| `email_status` | VARCHAR(50) | NO | `verified` (valid MX), `unverified`, `bounced`, `invalid` |
| `linkedin_url` | TEXT | YES | LinkedIn profile link |
| `created_at` | INTEGER | NO | Epoch timestamp (seconds) |
| `updated_at` | INTEGER | NO | Epoch timestamp (seconds) |

**Indexes:** `(workspace_id, company_id)`, `(email)`

---

### 3.4. `sellbird_outbox`
The core **Safety Approval Queue** holding pending and approved outreach emails.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | INTEGER / SERIAL | NO | Primary Key |
| `campaign_id` | INTEGER | NO | Foreign Key to `sellbird_campaigns.id` |
| `contact_id` | INTEGER | NO | Foreign Key to `sellbird_contacts.id` |
| `workspace_id` | INTEGER | NO | Tenant isolation |
| `step_number` | INTEGER | NO | 1 (Initial Hook), 2 (Value/Proof), 3 (Breakup/CTA) |
| `subject` | VARCHAR(255) | NO | Email subject line |
| `body` | TEXT | NO | Personalized email body (HTML or Plaintext) |
| `status` | VARCHAR(50) | NO | `pending_approval`, `approved`, `sent`, `rejected`, `failed` |
| `scheduled_at` | INTEGER | NO | Earliest epoch timestamp to deliver |
| `sent_at` | INTEGER | YES | Epoch timestamp when delivered |
| `error_message` | TEXT | YES | Diagnostic error if dispatch failed |
| `created_at` | INTEGER | NO | Epoch timestamp (seconds) |
| `updated_at` | INTEGER | NO | Epoch timestamp (seconds) |

**Indexes:** `(workspace_id, status)`, `(status, scheduled_at)`

---

### 3.5. `sellbird_replies`
Inbound replies received from outreach campaigns.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | INTEGER / SERIAL | NO | Primary Key |
| `outbox_id` | INTEGER | YES | Foreign Key to `sellbird_outbox.id` (Nullable) |
| `workspace_id` | INTEGER | NO | Tenant isolation |
| `sender_email` | VARCHAR(255) | NO | Prospect's email address |
| `subject` | VARCHAR(255) | YES | Email subject line |
| `message_text` | TEXT | NO | Full body of incoming reply |
| `intent_category` | VARCHAR(50) | NO | `interested`, `question`, `objection`, `not_interested` |
| `ai_drafted_reply` | TEXT | YES | AI-generated response addressing the prospect's reply |
| `status` | VARCHAR(50) | NO | `pending_review`, `sent`, `archived` |
| `created_at` | INTEGER | NO | Epoch timestamp (seconds) |
| `updated_at` | INTEGER | NO | Epoch timestamp (seconds) |

**Indexes:** `(workspace_id, status)`

---

## 4. Subsystems & Services

### 4.1. Website Crawler & Signal Extraction (`services/sellbird/crawler.js`)
- **Engine:** Lightweight `axios` + `cheerio` HTML parsing.
- **Timeout & Safety:** 12-second hard timeout with user-agent mimicking modern Chrome browsers.
- **Extracted Attributes:**
  - Page title, meta description, and OpenGraph tags (`og:title`, `og:description`, `og:image`).
  - H1, H2, and lead paragraph text.
  - Public contact emails (`mailto:` and regex matching).
  - Buying signals heuristics:
    - Tech stack detection: React, Vue, Angular, WordPress, Shopify, Next.js, Webflow.
    - Hiring / Expansion signals: detects `/careers`, `/jobs`, "we are hiring", "open positions".
    - Security / Compliance signals: SOC2, HIPAA, ISO27001, GDPR.

### 4.2. Contact Discovery & MX Verification (`services/sellbird/contacts.js`)
- **Decision Maker Heuristic:** Scrapes team/about pages for titles containing `CEO`, `Founder`, `CTO`, `VP`, `Director`, `Head of`, `Partner`.
- **Email Permutation Engine:** For a name "John Doe" at "example.com", generates permutations:
  - `john@example.com`
  - `jdoe@example.com`
  - `john.doe@example.com`
  - `j.doe@example.com`
- **DNS MX Verification:** Executes Node.js native `dns.promises.resolveMx(domain)` to verify whether the domain accepts email before queuing outreach. Drops addresses for invalid domains immediately.

### 4.3. AI Sequence & Reply Engine (`services/sellbird/aiEngine.js`)
- Integrates with Social-Nexus's unified `services/aiHelper` (supporting Gemini 1.5/2.0, Claude 3.5, OpenAI GPT-4o, and local Ollama).
- **Sequence Generation Prompting:**
  - **Step 1 (The Hook):** 50–90 words referencing an explicit buying signal discovered on their site.
  - **Step 2 (The Social Proof):** 60–100 words showing concrete case study or metric relevant to their industry.
  - **Step 3 (The Low-Friction Close):** 40–70 words asking a simple 1-line question rather than demanding a 30-minute calendar lock.
- **Reply Intent Classification:** Zero-shot categorization into `interested`, `question`, `objection`, or `not_interested`.
- **Response Drafter:** Composes a conversational, consultative reply handling objections or offering 2 specific calendar time slots.

### 4.4. Dispatcher & Deliverability Protection (`services/sellbird/dispatcher.js`)
- **Transport:** NodeMailer leveraging workspace or system SMTP credentials (`services/email.js`).
- **Warmup Schedule:**
  - Week 1: Max 15 emails/day
  - Week 2: Max 30 emails/day
  - Week 3: Max 50 emails/day
  - Week 4+: Max configured limit (default: 75 emails/day)
- **Randomized Jitter:** Dispatches with randomized 30–120s delays between recipients to prevent ISP rate-limiting and spam fingerprinting.
- **Suppression:** Hard suppression of any domain/email marked `not_interested` or `unsubscribed`.

### 4.5. Heartbeat Loop (`services/sellbird/heartbeat.js`)
- Wired into `services/scheduler.js` cron running on every 15th minute (`new Date().getMinutes() % 15 === 0`).
- Scans `sellbird_outbox` for records matching:
  - `status = 'approved'`
  - `scheduled_at <= nowEpoch()`
  - Daily limit not exceeded for campaign
- Transitions items to `status = 'sent'` upon successful SMTP handshake, or `status = 'failed'` with detailed `error_message`.

---

## 5. Security & Isolation Matrix

1. **Multi-Tenancy:**
   All queries in `repos/sellbirdRepo.js` enforce `where({ workspace_id: workspaceId })`. Cross-tenant record modification or inspection is mathematically impossible at the database layer.
2. **Access Control:**
   Routes require `withWorkspace` middleware, ensuring only authenticated members with `content.view` or `content.create` permissions can access Sellbird APIs.
3. **Prompt Injection Defense:**
   Prospect site content crawled from the web is stripped of script tags and bounded to 4,000 characters before interpolation into AI prompts.
4. **Data Privacy:**
   Prospect email addresses and discovered signals are kept within the tenant's own database; no data is shared with external third-party aggregators.

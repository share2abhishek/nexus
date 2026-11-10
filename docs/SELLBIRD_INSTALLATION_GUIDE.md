# Sellbird Autonomous Sales Agent — Installation & Operational Guide

This guide walks administrators and operators through configuring, verifying, and running **Sellbird** within Social-Nexus.

---

## 1. Prerequisites & System Requirements

- **Node.js:** v18.0.0 or higher (v20+ recommended)
- **Database:** SQLite (bundled) or PostgreSQL 14+ (for multi-user enterprise installs)
- **License Tier:** Agency or Full Edition (License status: `can_publish: true`)
- **AI Provider Key:** Google Gemini API Key (recommended free tier), Anthropic Claude, OpenAI, or local Ollama
- **Outbound Email:** Valid SMTP server (Google Workspace, Office 365, Zoho Mail, SendGrid, or AWS SES)

---

## 2. Database Migrations

Sellbird adds five dedicated database tables (`sellbird_campaigns`, `sellbird_companies`, `sellbird_contacts`, `sellbird_outbox`, `sellbird_replies`).

To run the migration:

```bash
# In the project root directory:
npm run migrate
```

Or execute directly via Knex:
```bash
npx knex migrate:latest
```

To verify table creation:
```bash
node -e "const knex = require('./services/knex'); knex.schema.hasTable('sellbird_campaigns').then(exists => console.log('Sellbird tables migrated:', exists));"
```

---

## 3. Environment & SMTP Configuration

### 3.1. Outbound Mail Server (SMTP)
Sellbird dispatches approved outreach emails using the SMTP settings configured in **Settings → 📧 Email / SMTP** or directly via environment variables:

In your `.env` file:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=outreach@yourcompany.com
SMTP_PASS=your-16-char-app-password
SMTP_FROM_NAME="John from Urban Society"
SMTP_FROM_EMAIL=outreach@yourcompany.com
```

> **Important (SPF / DKIM / DMARC):** Ensure your outbound sending domain has configured SPF (`v=spf1 include:... ~all`), DKIM, and DMARC records to maximize cold inbox deliverability and prevent spam filtering.

### 3.2. AI Configuration
Sellbird leverages Social-Nexus's unified AI Helper. Configure at least one AI key in **Settings → ⚙️ My API Keys** or `.env`:

```env
GEMINI_API_KEY=AIzaSy...
# Or:
ANTHROPIC_API_KEY=sk-ant-...
# Or:
OPENAI_API_KEY=sk-...
```

---

## 4. Operational Workflow: Step-by-Step

### Step 1: Create a Campaign & Train the AI
1. In Social-Nexus, click **🦅 Sellbird Agent** in the left menu.
2. Select the **🚀 Campaigns & ICP** tab.
3. Click **+ New Campaign**.
4. In the **Product Landing Page** field, paste your website URL (e.g., `https://urbansociety.in`).
5. Click **⚡ Train from URL**. Sellbird will crawl the website and automatically extract:
   - Value propositions
   - Target audience
   - Differentiating features
6. Set your **Target ICP Roles** (e.g., `Founder, Chief Executive Officer, Managing Director, Property Manager`).
7. Set **Daily Outreach Cap** (Recommended: 20 for newly connected mailboxes).
8. Click **Save Campaign**.

### Step 2: Add or Discover Target Prospects
1. Navigate to the **🏢 Prospect Explorer** tab.
2. To crawl a single target account:
   - Click **+ Add Target Account**.
   - Enter Company Name (e.g., `Lodha Group`) and Domain (e.g., `lodhagroup.in`).
   - Click **Crawl & Extract Signals**.
   - Sellbird inspects the domain, detects active buying signals, and discovers leadership contacts.
3. To bulk-import domains:
   - Click **🌐 Bulk Domain Discovery**.
   - Paste up to 50 domains (one per line).
   - Click **Discover Targets**.

### Step 3: Review the Safety Approval Outbox
1. Navigate to the **🛡️ Safety Approval Outbox** tab.
2. Review the prospect split cards:
   - **Left:** Company dossier, extracted signals, and leadership contact with MX verification.
   - **Right:** AI-drafted subject and body.
3. To approve individually, click **✓ Approve**.
4. To modify messaging before sending, edit the text and click **💾 Save Changes**.
5. To bulk-approve, check the boxes next to prospects and click **Approve Selected (N)**.

### Step 4: Autonomous Sending & Heartbeat
- Social-Nexus runs the Sellbird heartbeat automatically **every 15 minutes**.
- Approved emails are dispatched with randomized human-like delays (30 to 120 seconds between sends).
- To trigger an immediate sending pass without waiting for the 15-minute cron:
  - Click the **⚡ Run Autonomous Loop** button in the Sellbird header ribbon.

### Step 5: Triage Inbound Replies
1. When a recipient responds, navigate to **💬 Replies & Deals**.
2. Sellbird automatically tags the email with intent:
   - `🔥 Interested` (Demo / Call request)
   - `❓ Question` (Feature query)
   - `⚠️ Objection` (Price / Timing)
   - `🛑 Not Interested` (Suppressed immediately)
3. Review the AI-drafted reply, make any adjustments, and click **Approve & Send Reply**.

---

## 5. Deliverability Warmup Schedule

To ensure your email domain maintains a pristine sender reputation:

| Phase | Duration | Max Daily Outreach | Focus |
|---|---|---|---|
| **Phase 1** | Week 1 | 15 emails/day | High-match targets only, manual review |
| **Phase 2** | Week 2 | 30 emails/day | Expand target roles, monitor bounce rate < 2% |
| **Phase 3** | Week 3 | 50 emails/day | A/B test subject lines |
| **Phase 4** | Week 4+ | 75 emails/day | Steady-state scaling with automated approval |

---

## 6. Troubleshooting & Diagnostics

- **Bounces / MX Check Failures:** Check **Deliverability & Warmup** tab. Ensure DNS MX lookup is not blocked by local firewall or VPN.
- **AI sequence generation slow:** Verify your `GEMINI_API_KEY` is active and has available quota in Google AI Studio.
- **Outbox items not sending:** Ensure license is active (`can_publish: true`) and SMTP credentials in Settings are verified via the **Test Email** button.

# Meta Lead Ads & Click-to-Messenger Automated Ingestion Pipeline (Pipeline 1)

## Executive Summary
**Pipeline 1** provides an enterprise-grade, 100% compliant ingestion bridge for incoming Facebook & Instagram advertising leads within **Social-Nexus**.

When a prospect completes a Meta Instant Form or interacts with a Click-to-Messenger ad, the platform captures the lead in real-time, runs automated AI qualification, pushes the payload to your **n8n automation workflows**, and synchronizes the contact directly into your **Chatwoot shared inbox CRM** for live agent takeover.

---

## 1. Architecture & Flow

```
[ Lead Form / Click-to-Messenger Ad ]
                 │
                 ▼ (Real-time webhook notification)
     [ Meta Webhook Ingestion ]  --> /api/webhooks/meta (HMAC SHA-256 verified)
                 │
                 ▼
     [ Lead Extraction Engine ]  --> Graph API v26.0 GET /{leadgen_id} with Page Access Token
                 │
                 ▼
     [ AI Qualification Node ]   --> Scores Relevancy (0-100), summarizes intent, drafts response
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
  [ n8n Automation ]   [ Chatwoot CRM / Inbox ]
  - Instant lead ping  - Agent assignment & live chat
  - Multi-app sync     - Messenger 24-hr reply window
  - Slack / CRM alert  - 1-Click WhatsApp follow-up
```

### Components
1. **Meta Webhook Handler (`routes/webhooks.js` & `services/leadPipeline/metaWebhook.js`)**
   - Implements Meta's challenge handshake (`hub.challenge`, `hub.verify_token`, `hub.mode`).
   - Verifies incoming payloads using HMAC-SHA256 signatures (`X-Hub-Signature-256`) with `crypto.timingSafeEqual`.
   - Handles multi-tenant workspace resolution based on Page ID or custom verify token.

2. **Lead Details Extractor (`services/leadPipeline/metaWebhook.js`)**
   - Calls Meta Graph API `GET /v26.0/{leadgen_id}` utilizing the workspace's decrypted Page Access Token.
   - Parses standard fields (`full_name`, `email`, `phone_number`) and maps arbitrary custom questions into typed JSON `raw_answers`.

3. **AI Lead Qualifier (`services/leadPipeline/leadQualifier.js`)**
   - Evaluates prospect fit based on form responses.
   - Computes a numeric Lead Score (0–100) and assigns classification (`hot`, `warm`, `low`).
   - Produces a concise 1-sentence intent summary and pre-drafts an actionable WhatsApp/SMS reply.
   - Features deterministic fallback if cloud/local LLM keys are unavailable.

4. **n8n Automation Dispatcher (`services/leadPipeline/n8nForwarder.js`)**
   - Dispatches a structured JSON payload to the user-configured n8n webhook URL.
   - Includes custom headers: `X-Social-Nexus-Event: lead.created` and `X-Social-Nexus-Workspace: {id}`.
   - Configured with an 8-second timeout and failsafe error handling.

5. **Chatwoot CRM Synchronizer (`services/leadPipeline/chatwootClient.js`)**
   - Performs contact lookup by email or phone number in Chatwoot API v1.
   - Creates or updates contacts with custom attributes (`lead_score`, `intent`, `source: meta_lead_ad`).
   - Initiates an inbox conversation with an initial private note containing the lead dossier and AI recommendations.

---

## 2. Database Schema

The pipeline uses three dedicated tables created via migration `20261108000002_leadgen_messenger_pipeline.js`:

### `meta_lead_configs`
Configures per-workspace webhook tokens, n8n URLs, and Chatwoot credentials:
- `workspace_id`: Foreign key to `workspaces.id` (unique per workspace).
- `verify_token`: Cryptographically secure verification string for Meta handshake.
- `app_secret`: Optional Facebook App Secret for HMAC-SHA256 payload validation.
- `n8n_webhook_url`: HTTPS endpoint of your n8n workflow.
- `chatwoot_url`: Chatwoot server base URL (e.g. `https://app.chatwoot.com`).
- `chatwoot_api_token`: User or agent API Access Token.
- `chatwoot_account_id`: Numeric Chatwoot account ID.
- `chatwoot_inbox_id`: Target shared inbox ID for new conversations.
- `auto_qualify_ai`: Boolean toggle (default `1`).

### `meta_lead_events`
Stores every lead captured from Meta Instant Forms:
- `workspace_id`, `page_id`, `form_id`, `leadgen_id`, `ad_id`.
- `full_name`, `email`, `phone_number`.
- `raw_answers`: JSON string containing custom question responses.
- `lead_score`: AI score from 0 to 100.
- `intent_summary`: AI generated executive summary.
- `suggested_reply`: Pre-drafted WhatsApp/SMS message.
- `status`: Lifecycle status (`new`, `contacted`, `qualified`, `closed`, `junk`).
- `forwarded_to_n8n`, `forwarded_to_chatwoot`: Boolean delivery flags.

### `meta_messenger_events`
Records incoming Click-to-Messenger interactions:
- `workspace_id`, `page_id`, `sender_id`, `recipient_id`.
- `message_text`, `quick_reply_payload`, `referral_source`.
- `chatwoot_conversation_id`, `forwarded_to_n8n`.

---

## 3. Non-Technical Setup Guide (3 Steps)

### Step 1: Connect Your Meta Webhook
1. In Social-Nexus, navigate to **📥 Lead Ads Pipeline** in the sidebar.
2. Under **Meta Webhook Setup**, you will find two values:
   - **Callback URL:** `https://your-domain.com/api/webhooks/meta`
   - **Verify Token:** (auto-generated secure token)
3. Click the **📋 Copy** button on both fields.
4. Go to [Meta for Developers](https://developers.facebook.com) → Your App → **Webhooks** → Select **Page**.
5. Click **Subscribe to this object**, paste the Callback URL and Verify Token, then click **Verify and Save**.
6. In the list of Page Webhook fields, click **Subscribe** next to `leadgen` and `messages`.

### Step 2: 1-Click Page Subscription
1. Ensure your Facebook Page is connected in Social-Nexus (**Settings → Social Platforms**).
2. Return to **📥 Lead Ads Pipeline**.
3. Under **Facebook Page Connection**, click the **⚡ 1-Click Page Subscribe** button.
4. Social-Nexus calls Meta Graph API to subscribe your Page to real-time events. A green confirmation badge will appear.

### Step 3: Connect n8n & Chatwoot (Optional)
1. **For n8n:** Paste your webhook URL in **n8n Automation Webhook URL** and click **💾 Save Pipeline Settings**.
2. **For Chatwoot:**
   - Enter your **Chatwoot Server URL** (e.g. `https://app.chatwoot.com`).
   - Enter your **API Access Token** (found in Chatwoot Profile Settings).
   - Enter your **Account ID** and **Inbox ID**.
   - Click **🔍 Test Chatwoot Connection** to verify.
   - Click **💾 Save Pipeline Settings**.

---

## 4. Testing & Verification

### 1-Click Test Simulation
Without spending any ad budget or submitting forms on Facebook, test the full pipeline in Social-Nexus:
1. Click **🧪 Test Lead Ingestion** in the upper right corner of the Lead Ads Pipeline page.
2. The system simulates an incoming Meta Lead Ad payload.
3. The AI qualifier evaluates the lead, calculates the relevancy score, and pre-drafts an actionable WhatsApp reply.
4. If n8n and Chatwoot are configured, the event is immediately dispatched to both services.
5. The lead immediately appears at the top of your leads table.

### 1-Click WhatsApp Follow-up
For every lead with a phone number, click the **💬 WhatsApp** button in the leads table. It immediately launches WhatsApp with the AI-suggested personalized response pre-filled.

---

## 5. Sample n8n Workflow Template

Copy and import the following JSON into your n8n instance:

```json
{
  "name": "Social-Nexus Meta Lead Ingestion",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "social-nexus-lead",
        "responseMode": "onReceived",
        "responseData": "allEntries"
      },
      "id": "1",
      "name": "Webhook Trigger",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1,
      "position": [250, 300]
    },
    {
      "parameters": {
        "conditions": {
          "number": [
            {
              "value1": "={{ $json.body.lead_score }}",
              "operation": "largerEqual",
              "value2": 70
            }
          ]
        }
      },
      "id": "2",
      "name": "Is Hot Lead?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 1,
      "position": [480, 300]
    },
    {
      "parameters": {
        "channel": "#hot-leads",
        "text": "=🔥 *New Hot Lead captured by Social-Nexus!*\n*Name:* {{ $json.body.lead.full_name }}\n*Phone:* {{ $json.body.lead.phone }}\n*Email:* {{ $json.body.lead.email }}\n*Score:* {{ $json.body.lead_score }}/100\n*Summary:* {{ $json.body.intent_summary }}\n*Suggested Reply:* {{ $json.body.suggested_reply }}"
      },
      "id": "3",
      "name": "Slack Alert",
      "type": "n8n-nodes-base.slack",
      "typeVersion": 1,
      "position": [720, 200]
    }
  ],
  "connections": {
    "Webhook Trigger": {
      "main": [
        [
          {
            "node": "Is Hot Lead?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Is Hot Lead?": {
      "main": [
        [
          {
            "node": "Slack Alert",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
}
```

---

## 6. Security & Meta TOS Compliance

1. **Meta Terms of Service:**
   - Complies strictly with Meta Platform Terms.
   - Messenger messaging follows the official 24-hour Standard Messaging Window.
   - Lead Ads data is accessed exclusively via official Meta Graph API v26.0 endpoints.
2. **Cryptographic Signatures:**
   - Webhook requests are validated using `crypto.timingSafeEqual` with Meta's HMAC-SHA256 signature header (`X-Hub-Signature-256`).
3. **Workspace Multi-Tenancy:**
   - Every lead and configuration is strictly scoped by `workspace_id`. Cross-workspace data leakage is strictly prevented at the repository layer.

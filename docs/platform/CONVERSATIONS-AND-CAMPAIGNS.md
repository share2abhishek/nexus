# Connected mailboxes, two-way campaigns and SMS: requirements

**Purpose.** An organisation can:
- run email campaigns from Nexus and receive the replies back in Nexus;
- keep every conversation in one history per contact, alongside WhatsApp and website chat;
- turn replies into leads, with AI reading each reply for intent and action items, and auto-replying where it is safe;
- compare campaigns run with different strategies;
- connect its own **external accounts**: any domain mailbox (IMAP/SMTP), Gmail / Google Workspace, Outlook / Microsoft 365, and carrier SMS providers.

**Status.** Requirements for owner approval. Nothing is built. Phases C1–C4 are in `docs/platform/ROADMAP.md` as **Wave 6, the last priority** (owner's decision, 19 Nov 2026).

**Builds on:**
- **Access and isolation:** `docs/platform/ACCESS-AND-ENTITLEMENTS.md` (the decision engine, tenancy, limits, AI metering).
- **Features, roles and scope:** `docs/billing/ACCESS-REQUIREMENTS.md`.
- **Money and metering:** `docs/billing/REQUIREMENTS.md`.
- **Existing code:**
  - Email & Outreach (Sellbird): `routes/sellbird.js`, `services/sellbird/*`, tables `sellbird_campaigns`, `sellbird_contacts`, `sellbird_outbox`, `sellbird_replies`;
  - SMTP sending: `services/smtpSettings.js`;
  - the lead timeline: `meta_lead_events`, `lead_conversation_messages` (has `channel`), `lead_activities`.

---

## 1. What exists today, and the gap (verified 19 Nov 2026)

| Capability | Today | Gap |
|---|---|---|
| Campaigns and sequences | AI-personalised sequences per campaign, steps, an outbox with approval (`auto_approve`), attachments, `max_emails_per_day`, unsubscribe footer | No A/B variants, no send windows, no strategy templates, no per-variant results |
| Sending | SMTP per workspace (host checked against internal networks on the hosted edition), Amazon SES | The sent email's `Message-ID` is not stored, so replies can't be matched to it. No `List-Unsubscribe` header. No per-mailbox warm-up or caps |
| Replies | `sellbird_replies` with an AI intent (`aiEngine.classify...`) and an AI draft reply, sent by a person | **Replies arrive only through `POST /replies/simulate`.** No mailbox is read. No bounce or out-of-office handling. Replies are not in the contact's conversation history and don't become leads |
| Conversation history | `lead_conversation_messages` per lead, channel `whatsapp`, `form`, `internal`; the website chat is stored with the `web` channel | Email and SMS are not channels yet |
| SMS | none | everything |

---

## 2. Concepts

| Term | Meaning |
|---|---|
| **Channel account** | An external account an organisation connects to one **workspace**: a mailbox (IMAP/SMTP, Gmail, Microsoft 365) or an SMS provider number. It holds encrypted credentials or OAuth tokens. |
| **Conversation** | One thread with one contact on one channel (an email thread, an SMS thread, a WhatsApp chat). It belongs to a lead (`meta_lead_events`). Messages are in `lead_conversation_messages` with `channel` `email` or `sms` added. |
| **Campaign** | A goal, an audience, a strategy (sequence, variants, windows, stop rules), and the channel accounts it sends from. |
| **Touch** | One sent message of a campaign (a `sellbird_outbox` row), carrying its own `Message-ID` and a reply token. |
| **Reply** | An inbound message matched to a touch (section 5). Only matched replies are imported. |
| **Action item** | Something the reply asks for (call on Friday, send pricing, talk to someone else), extracted by AI and stored as a lead activity or task. |

---

## 3. Connecting external accounts

### 3.1 Mailboxes
| Kind | How the owner connects it | Receive | Send | Notes |
|---|---|---|---|---|
| **Domain mailbox** (any provider: Zoho, GoDaddy, Hostinger, cPanel, Google Workspace and Microsoft 365 with app passwords) | Email address, incoming server (IMAP host and port), outgoing server (SMTP host and port), username, password or app password. **Test connection** before saving. | IMAP: poll every 2 minutes for new UIDs in INBOX (and the provider's spam folder, optional). IDLE later if needed. | SMTP (existing `smtpSettings` checks, extended to IMAP hosts) | **First to build (C1).** Works with almost every provider. The hosted edition refuses internal or private hosts (as today for SMTP). TLS is required. |
| **Gmail / Google Workspace** (sign in with Google) | "Connect Google", using OAuth with the minimal scopes: read and send (`gmail.readonly` + `gmail.send`, or `gmail.modify` if labels are needed) | Gmail API `history.list` every 2 minutes, or push through Pub/Sub watch (later) | Gmail API `send`, in the thread | **Google verification required**: reading mail is a *restricted* scope. Production use needs an OAuth app review and a yearly third-party security assessment (CASA). Lead time is weeks, so **apply during C1** (decision M4). Until then, Gmail users connect with an app password as a domain mailbox. |
| **Outlook / Microsoft 365** (sign in with Microsoft) | "Connect Microsoft", using OAuth with `Mail.ReadWrite`, `Mail.Send`, `offline_access` | Microsoft Graph delta query every 2 minutes (subscriptions later) | Graph `sendMail` / reply | Some customer tenants require their IT admin to consent. Microsoft publisher verification is recommended. |

**Common rules for every mailbox:**
1. Belongs to **one workspace** of one organisation. Imported mail is visible only inside that workspace (section 9).
2. Credentials and tokens are encrypted at rest with the existing secrets service. They are **never returned** to the browser (masked) and never shown in support mode.
3. **Visibility** (decision M1):
   - *Personal*: imported threads are seen by the mailbox owner and by managers;
   - *Shared*: seen by everyone with the chat or lead permission, subject to their scope.

   Default: Personal for mailboxes a person connects for themselves, Shared for mailboxes a manager connects (sales@, info@).
4. **Health:** last successful sync, last error with a plain reason (wrong password, app password needed, IMAP disabled by the provider, token expired), and a reconnect button. Three consecutive failures e-mail the mailbox owner. The state shows on the organisation Health tab (platform 9.2).
5. **Disconnect:** sync stops at once and tokens are revoked where the provider allows it. The owner chooses whether to keep or delete the imported messages (kept by default; deletion is audited).
6. **Sending limits per mailbox** (defaults, editable within the plan):
   - domain mailbox 200 a day;
   - Gmail personal 400 a day;
   - Google Workspace 1,500 a day;
   - Microsoft 365 1,000 a day.

   A **warm-up ramp** for new mailboxes starts at 20 a day and grows by 20 a day up to the cap (optional, on by default for cold campaigns).

### 3.2 SMS (carrier messaging, India first)
| Item | Requirement |
|---|---|
| **Providers** | A port `SmsProvider` (`send`, `parseInbound`, `verifyWebhook`, `deliveryStatus`) with adapters, first **MSG91**, then Exotel, Gupshup, Kaleyra, and Twilio for international numbers. The owner chooses the provider; Radixile does not resell SMS in this phase (decision M5). |
| **Connecting** | Provider, API key or auth token (encrypted), sender ID (header), DLT Principal Entity ID, and the inbound number (virtual mobile number or long code) for two-way. Test send to the owner's phone. |
| **TRAI DLT (mandatory in India)** | Commercial SMS needs the business's DLT registration: entity, headers, and **every template** pre-approved with its template ID. Nexus stores the templates with their DLT IDs. Outbound SMS can only use a registered template, with variables filled in. Free text is refused for India numbers. **Promotional** messages only go out 09:00–21:00 IST; transactional and service messages follow their category rules. |
| **Inbound** | Two-way needs the provider's virtual number. Inbound SMS arrives on a provider webhook verified by signature or secret, and is matched to the contact by phone number within the workspace. |
| **Consent and opt-out** | "STOP" (and the provider's opt-out keyword) adds the number to the workspace suppression list (shared with WhatsApp's existing STOP handling). |
| **Delivery** | Delivery receipts update the message status: sent, delivered, failed with reason. |

---

## 4. Sending campaign email (changes to the existing dispatcher)
1. **Send from a connected mailbox**, or from SES or the workspace SMTP as today. A campaign may rotate across several mailboxes of the workspace, respecting each mailbox's cap and warm-up.
2. Every touch gets:
   - a generated `Message-ID` (`<touch-{id}.{random}@{sending domain}>`), stored on the outbox row;
   - a **reply token** (12 random characters), stored on the outbox row;
   - `Reply-To` with plus-addressing (`name+r-{token}@domain`) when the provider supports sub-addressing (tested at connect time);
   - follow-ups sent with `In-Reply-To` / `References`, so they thread in the contact's mail client.
3. **Headers for deliverability and the Gmail/Yahoo bulk-sender rules:**
   - `List-Unsubscribe` with a mailto **and** a one-click HTTPS link, plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058);
   - the existing footer stays.
   - The connect screen checks the sending domain's **SPF, DKIM and DMARC**. It warns, and refuses cold campaigns over 100 a day while DMARC is missing (decision M6).
4. **Suppression list per organisation:** unsubscribes, hard bounces and complaints. It is checked before every send, across all campaigns and mailboxes of the organisation.
5. **Send windows:** each campaign has days and hours in the recipient's time zone (default the workspace's), and a random spread so messages don't all leave at once.

---

## 5. Receiving: shortlist only campaign replies

### 5.1 Matching (in this order; the first match wins)
1. **Thread headers:** `In-Reply-To` or `References` contains a `Message-ID` Nexus sent. Confidence: certain.
2. **Reply token:** the `To` / `Delivered-To` address has `+r-{token}`. Certain.
3. **Known contact:** the `From` address is a contact of an active campaign in this workspace, touched in the last 60 days, and the subject matches the thread subject (after removing "Re:" or "Fwd:"). High; marked "matched by sender".
4. **Optional, off by default:** any message from an existing lead or contact of the workspace is imported as a non-campaign email (decision M2).
5. **Anything else is not imported.** Only the matching metadata is read for unmatched messages (headers of new messages). Their bodies are never stored, and nothing about them is logged except a count.

### 5.2 Classification before AI (deterministic, free)
| Type | Detected by | Effect |
|---|---|---|
| **Bounce** | `multipart/report; report-type=delivery-status`, mailer-daemon senders, the DSN status | Hard bounce (5.x.x): the contact's email is marked bounced, it is suppressed and the sequence stops. Soft bounce (4.x.x): retried once later. Not a reply. |
| **Out of office / auto-reply** | `Auto-Submitted: auto-replied`, `X-Autoreply`, `X-Autorespond`, `Precedence: auto_reply`, known subject patterns | Not counted as a reply. The sequence pauses until a "back on" date if one is found (AI-free date parsing first), else for 5 days. |
| **Unsubscribe** | the existing deterministic check (`unsubscribe`, `remove me`...) | Suppressed; the sequence stops; no AI call. |
| **Complaint** | feedback-loop reports (`report-type=feedback-report`) | Suppressed; the campaign owner is alerted. |

### 5.3 Import
For a matched human reply:
1. store the message:
   - headers;
   - text body (HTML converted to text; quoted earlier text trimmed but kept);
   - attachments through the files service (they count toward storage, platform 10.3);
2. add it to the contact's conversation (`lead_conversation_messages`, channel `email`, direction inbound, thread id);
3. **stop the contact's sequence** on any human reply (configurable per campaign: stop, or pause until a person decides);
4. run AI (section 6);
5. notify the assigned agent, or the campaign owner if nobody is assigned.

**Idempotent** on the mailbox and the provider's message id: a re-sync never creates a duplicate.

---

## 6. AI on replies

### 6.1 Intent (extends today's categories)
`interested`, `meeting_request`, `pricing_question`, `question`, `not_now` (with a date if given), `referral` (talk to someone else, with the name and email if given), `not_interested`, `unsubscribe`, `wrong_person`, `other`. Each comes with a confidence (0–1).

### 6.2 Action items (structured)
```
[{ type: 'call'|'meeting'|'send_info'|'follow_up'|'update_contact'|'new_contact'|'task',
   due_at?: ISO date-time (IST), details, contact_change?: {...}, confidence }]
```
- Each item becomes a lead activity / task assigned to the lead's owner, with the reply quoted. A `referral` creates a new contact, linked and marked "referred by", and is not emailed automatically.
- **Lead conversion:**
  - `interested`, `meeting_request` and `pricing_question` create or advance a lead in Leads & CRM, by default to the stage "Replied – interested", with the campaign as source (decision M3: automatic by default, or one click);
  - `not_now` schedules a follow-up on the given date.

### 6.3 Auto-reply (policy per campaign)
| Mode | Behaviour |
|---|---|
| **Off** | no draft |
| **Draft** (default) | the AI drafts a reply; a person approves, edits or discards it in the inbox (today's flow) |
| **Auto for safe intents** | sent without approval **only** if all hold: the intent is in the campaign's allowed list (default `pricing_question`, `question`, `meeting_request` with a booking link); confidence ≥ 0.85; at most 2 automatic replies per thread; inside the send window; the answer only uses the campaign's facts and knowledge base; the reply contains no money commitment, discount or legal promise (checked by rules). Otherwise it falls back to a draft. |

**Never automatic** for `unsubscribe`, `not_interested`, complaints, anything mentioning legal action, data deletion or a payment dispute, or replies from a domain on the organisation's do-not-auto-reply list.

**Safety:**
- Reply content is untrusted input: it passes through the existing AI safety neutraliser, and instructions inside a reply are never followed.
- Prompts contain only that thread and that workspace's campaign facts.
- Credits are metered (platform 10.2; L2a counts them).

### 6.4 People stay in control
- Every AI decision (intent, items, draft or auto-sent reply) is visible on the thread with "why" (the intent and its confidence).
- One click corrects the intent. Corrections are stored to measure accuracy per campaign.

---

## 7. Campaign strategies and results

### 7.1 Strategy settings per campaign
- **Goal:** meetings, replies, sign-ups or event registrations (used for the results headline).
- **Template:** cold outreach (3–4 steps over 10 days), nurture (monthly), event invite (2 steps plus reminder), re-engagement (2 steps). A template fills the sequence; the steps stay editable.
- **Variants (A/B/C):** subject and/or body per step, with a split %. A **winner rule** (after N sends per variant, by reply rate or positive-reply rate) sends the rest with the winner (optional).
- **Send window and caps:** days, hours, daily cap per campaign and per mailbox, warm-up.
- **Stop rules:** stop on any reply (default), stop on a positive reply only, stop on the lead stage reaching X.
- **Channels per step** (C4): email, SMS (registered template), WhatsApp template (existing WhatsApp suite). For example: email day 1, email day 4, SMS day 7.

### 7.2 Results (per campaign, variant, step, mailbox)
- Sent, delivered, bounced, replied (human), positive replies, by intent, action items, leads created, meetings, unsubscribes, complaints.
- **Rates:** reply rate, positive rate, bounce rate.
- **Time:** time to first reply; and over time.
- **Opens (decision M7):** open tracking (a pixel) is **off by default**. Opens are unreliable (Apple Mail privacy) and the pixel hurts deliverability and privacy. Clicks use the existing link tracker (`link_tracker` feature).
- **Comparison view:** campaigns side by side, filtered by date and strategy template.

---

## 8. One conversation history and inbox
- **Contact timeline:** every channel in one history per lead (WhatsApp, website chat, email, SMS, notes), newest first, with the campaign and touch shown on campaign messages.
- **Inbox:**
  - the existing chats inbox gains channel filters (All, WhatsApp, Web, Email, SMS) and an "Email replies" view grouped by campaign, with intent chips and action items;
  - replying from Nexus sends through the **same channel and account** (email from the mailbox in the same thread; SMS from the same number with a registered template where required).
- **Assignment and scope:** ACCESS-REQUIREMENTS 5.4 and 5.7 apply as for chats. A Sales agent sees replies assigned to them and the unassigned queue; managers see all. Personal mailboxes follow section 3.1 rule 3.

---

## 9. Isolation and privacy (adds to platform section 11)
1. A channel account belongs to one workspace. Sync jobs run per account with a system context for its organisation (platform 5.3). One failing account never stops the others.
2. Inbound mail and SMS are matched **only** against that workspace's touches, contacts and leads.
3. **Data minimisation:**
   - unmatched messages are never stored;
   - for matched messages: headers, text and attachments only, without other recipients' addresses beyond what the thread shows;
   - mailbox passwords and tokens are never logged.
4. **Retention:** imported messages follow the lead's lifetime. Disconnecting a mailbox offers deletion. Closing the organisation deletes everything (platform 4.3 / 9.4).
5. **Support mode** (platform 9.3) can see sync health and errors, but message bodies only in a support session. Credentials are never visible.
6. **DPDP and anti-spam:** consent and opt-out are respected across channels (one suppression list per organisation, shared by email, SMS and WhatsApp). Every bulk email has a working unsubscribe. SMS follows DLT categories and time windows.

---

## 10. Features, permissions, limits and metering (added to the catalogues)

| Kind | Key | Meaning |
|---|---|---|
| Feature | `email_mailboxes` | connect domain mailboxes; replies in Nexus; matching; timeline; lead conversion |
| Feature | `email_oauth` | connect with Google or Microsoft sign-in (C3) |
| Feature | `reply_ai` | AI intent and action items on replies |
| Feature | `reply_auto` | automatic replies for safe intents (requires `reply_ai`) |
| Feature | `campaign_variants` | A/B variants, winner rule, strategy templates |
| Feature | `sms_channel` | SMS provider connection, two-way SMS, SMS steps |
| Permission | `mailboxes.manage` | connect, edit or disconnect the workspace's shared mailboxes |
| Permission | `mailboxes.own` | connect a personal mailbox |
| Permission | `sms.manage` | connect the SMS provider, manage DLT templates |
| Permission | `chats.*` / `leads.*` | reused for email and SMS conversations, with the same scopes |
| Permission | `outreach.send` | reused for sending campaign touches (meter `EMAIL` / `SMS`) |
| Limit | `mailboxes` | connected mailboxes per organisation |
| Limit | `sms_numbers` | connected SMS numbers |
| Meter (billing channel) | `EMAIL` (exists), **`SMS`** (new) | sends per month; SMS is usually paid to the provider directly by the organisation in this phase (decision M5), so it is counted, not charged |
| AI credits | intent and action items: 1 credit per reply; draft or auto reply: 1 | through L2a/L2b |

Defaults in seeded plans follow PLAN N5: the new features are on in the trial plan and in Agency and Full, and the owner decides per plan.

---

## 11. Data model (new or changed; every table has `org_id NOT NULL` and `workspace_id`)

| Table | Columns |
|---|---|
| `channel_accounts` | id, org_id, workspace_id, kind (`imap`, `gmail`, `microsoft`, `sms_msg91`, ...), address or number, display_name, visibility (`personal`/`shared`), owner_user_id, credentials_enc (sealed JSON), status, last_sync_at, last_error, sync_cursor (IMAP UID or validity, Gmail historyId, Graph delta link), daily_cap, warmup_started_on, created_by, created_at, updated_at |
| `email_messages` | id, org_id, workspace_id, account_id, provider_message_id, message_id_header, in_reply_to, references, thread_key, direction, from_addr, to_addrs, subject, text_body, html_stored bool, received_at, outbox_id?, match_rule (`thread`/`token`/`sender`/`contact`), classification (`human`/`bounce`/`auto`/`complaint`), lead_id?, conversation_message_id; unique(account_id, provider_message_id) |
| `sellbird_outbox` (alter) | + `message_id_header`, `reply_token` (unique), `account_id`, `variant_key`, `sent_at`, `delivery_status` |
| `sellbird_campaigns` (alter) | + `goal`, `strategy_template`, `variants_json`, `send_window_json`, `stop_rule`, `auto_reply_mode`, `auto_reply_intents`, `account_ids_json` |
| `sellbird_replies` | kept for the existing screens; filled from `email_messages`; + `confidence`, `action_items_json`, `lead_id`, `auto_replied_at` |
| `lead_conversation_messages` (alter) | channel adds `email` and `sms`; + `external_id`, `account_id`, `campaign_id?` |
| `suppression_list` | org_id, channel (`email`/`sms`/`whatsapp`), address, reason (`unsubscribe`/`bounce`/`complaint`/`manual`), source, created_at; unique(org_id, channel, address) |
| `sms_templates` | id, org_id, workspace_id, account_id, dlt_template_id, category (`promotional`/`transactional`/`service`), body with variables, status |
| `sms_messages` | id, org_id, workspace_id, account_id, provider_id, direction, to_number, from_number, template_id?, body, status, error, lead_id?, created_at; unique(account_id, provider_id) |
| `reply_ai_feedback` | id, org_id, email_message_id, ai_intent, corrected_intent, by_user_id, created_at |

---

## 12. Jobs and APIs

**Jobs** (server edition; claimed per account so two instances never sync the same account):

| Job | When | Does |
|---|---|---|
| `mail-sync` | every 2 min per account | fetch new messages since the cursor, match, classify, import, run AI (queued) |
| `mail-send` | every minute | send due touches within windows, caps and warm-up |
| `reply-ai` | queue | intent, action items, draft or auto-reply |
| `sms-status` | provider webhook plus hourly sweep | delivery receipts |
| `channel-health` | hourly | mark failing accounts, e-mail owners after 3 failures |

**APIs (customer):**

| Method and path | Permission | Purpose |
|---|---|---|
| `GET/POST/PUT/DELETE /api/channels/accounts` | `mailboxes.manage` / `mailboxes.own` / `sms.manage` | connect, test, edit, disconnect |
| `POST /api/channels/accounts/test` | same | test the connection before saving |
| `GET /api/channels/oauth/{google|microsoft}/start`, `/callback` | `mailboxes.*` | OAuth connect (C3) |
| `GET /api/conversations?channel&campaign&intent&scope` | `chats.view` | inbox lists |
| `GET /api/conversations/{leadId}` | `chats.view` + scope | full history |
| `POST /api/conversations/{leadId}/reply` | `chats.reply` + scope | reply on the same channel |
| `PUT /api/replies/{id}/intent` | `chats.reply` | correct the AI |
| `POST /api/replies/{id}/convert` | `leads.edit` | make or advance the lead |
| `GET /api/campaigns/{id}/results` | `outreach.view` | results by variant, step and mailbox |
| `GET/POST/PUT /api/sms/templates` | `sms.manage` | DLT templates |
| `POST /webhooks/sms/{provider}/{accountToken}` | public, verified | inbound SMS and delivery receipts |
| `GET /u/{token}` and `POST /u/{token}` | public | one-click unsubscribe |

---

## 13. Non-functional requirements
- **Sync latency:** a reply appears within 3 minutes of arriving in the mailbox (2-minute polling).
- **Scale target:** 500 connected mailboxes on one server, polled in batches with a concurrency limit of 10, IMAP connections closed after each poll. Moving to IDLE or push is a later optimisation.
- **Reliability:** cursors are saved after each processed message. A crash re-reads, but the unique keys stop duplicates. Provider rate limits are backed off.
- **Security:**
  - IMAP and SMTP hosts are checked against internal networks;
  - TLS is required;
  - OAuth uses PKCE and a state check;
  - tokens are encrypted;
  - webhook signatures are verified;
  - the one-click unsubscribe links are signed and per-recipient.
- **Testing:**
  - a fake IMAP server and recorded fixtures (replies, bounces, out-of-office, forwarded, HTML-only, non-English);
  - provider adapters with fakes;
  - the two-organisation isolation harness extended to channel accounts and conversations;
  - staging with a real test mailbox, and an SMS provider sandbox.

---

## 14. Phases (added to `ROADMAP.md`)

| Phase | Scope | Depends on | Size |
|---|---|---|---|
| **C1 Domain mailboxes and campaign replies** | Sections 3.1 (domain mailbox), 4, 5, 8 and 9: connect IMAP/SMTP, send from a mailbox with `Message-ID` and reply tokens, `List-Unsubscribe`, suppression list, sync and match, bounces and out-of-office, stop sequence on reply, conversation history, inbox email filter, manual convert to lead. **Apply for Google verification at the start** (M4). | A0, B1, T1 for the Sellbird and leads modules, R1 (scope) | L |
| **C2 Reply AI, auto-reply and campaign strategies** | Sections 6 and 7: intents, action items and tasks, automatic lead conversion, auto-reply policy with guardrails, variants, windows, warm-up, strategy templates, results and comparison | C1, L2a | M |
| **C3 Gmail and Microsoft 365 sign-in** | OAuth connect, Gmail API and Graph adapters, health and reconnect | C1, Google verification approved | M |
| **C4 SMS** | Section 3.2: provider port and MSG91 adapter first, DLT templates, two-way SMS, delivery receipts, SMS steps in sequences, shared suppression list | C1, the owner's DLT registration | M |

---

## 15. Decisions (defaults until the owner says otherwise)

| # | Question | Default |
|---|---|---|
| M1 | Who sees mail imported from a mailbox | Personal mailbox: its owner and managers. Shared mailbox: everyone with chat or lead access, by scope |
| M2 | Import non-campaign mail from known contacts | Off; a per-mailbox switch |
| M3 | Positive replies to leads | Automatic (stage "Replied – interested"); can be set to one click per campaign |
| M4 | Gmail sign-in | Apply for Google verification at the start of C1; Gmail app passwords meanwhile |
| M5 | SMS billing | The organisation's own provider account; Nexus counts sends but doesn't charge in this phase |
| M6 | Missing DMARC on the sending domain | Warn; cold campaigns capped at 100 a day until fixed |
| M7 | Open tracking | Off by default; clicks through the link tracker |
| M8 | Auto-reply default | Draft (a person approves) |
| M9 | Expected volume to size the sync | 1–5 mailboxes and up to 500 emails a day per organisation (owner to confirm) |

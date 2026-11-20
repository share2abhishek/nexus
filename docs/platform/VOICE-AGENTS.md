# AI voice agents (phone calls in the caller's language): requirements

**What this covers:** an AI customer-care and sales agent that answers and makes phone calls in Indian languages, speaks
naturally (local words, Hinglish and other code-mixing), hands over to a person when needed, and stores every call's
recording, transcript, summary and outcome on the lead.

**Status:** requirements only (written 20 Nov 2026). Nothing is built. Phases V0–V4 are in `docs/platform/ROADMAP.md`
(Wave 7). Facts about providers, prices and telecom rules were checked on 20 Nov 2026 and change often: confirm them with
the chosen provider before V1.

**Related:** access engine and catalogues `docs/platform/ACCESS-AND-ENTITLEMENTS.md`; AI sales agents (persona, goals,
hand-over) `docs/billing/ACCESS-REQUIREMENTS.md` 5.6; metering `docs/billing/REQUIREMENTS.md` 5.9; isolation rules
platform section 11 (skill `tenant-isolation`).

---

## 1. Goals and non-goals

### 1.1 Goals
1. **Inbound customer care:** a business's number is answered by its AI agent, day and night. It answers from the
   business's knowledge base, captures the lead, books a call-back or site visit, and transfers to a person on request
   or when unsure.
2. **Outbound follow-up:** call a lead who asked to be contacted (lead form, WhatsApp opt-in, website chat) within
   minutes, qualify them with the business's questions, and record the outcome.
3. **Human-like conversation:** the caller's language and dialect, a natural voice, short sentences, local words,
   interruptions handled (the caller can talk over the agent), replies within about one second.
4. **Everything recorded:** for each call, the audio, a time-stamped transcript by speaker, an AI summary, the outcome, the
   next step, and the cost, shown on the lead's timeline and searchable.
5. **Safe and legal:** only people who asked are called; calls are announced as recorded; data stays inside its
   organisation; usage is limited by plan.

### 1.2 Non-goals (for now)
- Cold calling lists of people who never asked. Not supported (telecom rules and spam detection; section 6).
- Our own speech models. Speech-to-text, the voice and the live call are a provider's; Nexus owns the setup, the data and
  the business logic.
- Emotion detection, voice cloning of a real person, and payments over the phone.

### 1.3 The agent does not pretend to be a person
It sounds human, but it introduces itself as the business's virtual assistant (for example "Namaskar, main Priya bol
rahi hoon, Avinash Group ki virtual assistant") and never denies being an AI when asked. Reasons: the 2026 TRAI
amendments treat calls made by software or with an artificial voice as automated calls and add AI-based spam detection
(numbers flagged can lose outgoing calls); a customer who finds out later stops trusting the business; and it is honest.
This is a fixed rule, not a setting: the agent editor has a greeting field, and the disclosure sentence is always added.

---

## 2. How a call works

```
caller ⇄ phone network ⇄ voice provider ─ speech-to-text ─▶ AI reply (prompt + knowledge base + lead facts) ─▶ voice ─┐
                                   ▲                                                                                  │
                                   └──────────────────────────────── audio back to the caller ◀────────────────────────┘
Nexus: agent setup ─▶ provider (API)        provider ─▶ Nexus (signed webhook at call end: status, recording, transcript)
```

### 2.1 Options
| Option | What | Effort | Decision |
|---|---|---|---|
| **A. Voice-agent platform** | The provider runs the live loop (Sarvam Voice Agents: 11 Indian languages and English; or Bolna, Exotel, others). Nexus creates the agent through the provider's API, starts calls, and stores what the end-of-call webhook sends. | about 2–3 weeks for V1 | **Default.** One provider adapter behind a port, so a second provider is one more adapter. |
| B. Own pipeline | Telephony audio stream (Exotel, Plivo, Twilio) into our server; our own speech-to-text, AI model and voice. | 2–3 months plus tuning | Only if A's quality, latency or cost fails the pilot. |
| C. WhatsApp calling | Meta's Cloud API Calling (available in India; the customer must allow calls first). Fits the existing WhatsApp setup. Needs an audio (WebRTC) bridge. | after A | V4 |

### 2.2 Provider adapter (port)
`createAgent(config) / updateAgent / deleteAgent`, `startCall({ agentId, to, variables, callbackUrl, idempotencyKey })`,
`hangup(callId)`, `parseWebhook(req) -> { event, callId, status, startedAt, endedAt, durationSec, recordingUrl,
transcript[], cost, endReason }`, `fetchRecording(url) -> stream`. A fake adapter for tests. No provider call inside a
database transaction.

---

## 3. What the business sets up (agent editor)

| Group | Fields |
|---|---|
| Identity | name (for example Priya), voice (provider list; male or female), greeting, language(s) and dialect, style notes ("Puneri Marathi, mixes Hindi and English, friendly, short sentences"), 2–3 example lines |
| Knowledge | the AI knowledge base (existing), allowed topics, things never to say (prices not in the KB, legal or medical advice) |
| Goals | questions to ask (budget, location, timeline...), objection answers, what counts as a qualified lead, booking a call-back or visit |
| Hand-over | staff numbers and hours to transfer to; when to transfer (asked for a person, angry, unsure twice, a high-value lead); what to say when nobody is free (take a call-back) |
| Outbound rules (V3) | calling hours, days, retries and gap, maximum attempts, who may be called (consented sources only) |
| Recording | on (default) with the spoken notice; retention period (default 180 days); who may listen |

The agent is tested in the editor with a **test call to the editor's own phone** before it goes live.

---

## 4. Recordings, transcripts and outcomes

- **Per call:** direction, lead, number (stored in full, shown masked to roles without `voice.numbers.view`), agent,
  status, start, end, duration, provider cost, our credits, end reason, outcome (`interested`, `callback`, `visit_booked`,
  `not_interested`, `wrong_number`, `no_answer`, `transferred`, `voicemail`), next step, summary.
- **Recording:** downloaded from the provider into our storage within minutes of the call (provider links expire), at
  `{org_id}/{workspace_id}/voice/{call_id}.mp3`, private, played through a signed link valid 15 minutes.
- **Transcript:** one row per turn (speaker `agent` | `caller` | `staff`, start and end in ms, text, language), searchable.
- **After the call:** the AI writes the summary, outcome and next step; the lead's stage and fields update only as the
  business allows (default: suggest, a person confirms).
- **Storage prerequisite:** production keeps files inside the container with no persistent volume. Before V1, files move
  to a persistent volume or S3-compatible storage (platform L1 files service), or recordings would be lost on deploy.
- **Retention:** a nightly job deletes recordings past the retention period (transcript and summary are kept unless the
  business chooses otherwise); deletion on a customer's request removes audio and transcript.

---

## 5. Isolation, security and privacy (adds to platform section 11)

- Every table has `org_id NOT NULL` and `workspace_id`; calls, transcripts and recordings resolve through the scoped
  repository; another organisation's call id answers 404.
- The webhook finds the organisation from the provider's agent and call ids registered in Nexus (never from the payload's
  own fields) and checks the signature (constant-time, timestamp window).
- Provider API keys per organisation are encrypted (`services/secrets.js`), never returned to the browser.
- Logs carry ids only, never transcript text or phone numbers.
- Listening to a recording is audited (who, when, which call).
- Consent: the spoken notice ("this call is recorded for quality and service") at the start of every call; outbound
  calls only to contacts with a recorded consent source and date. DPDP Act: purpose, retention and deletion on request.

---

## 6. Telecom rules in India (confirm with the provider before V1 and V3)

- **Promotional (sales) calls** must come from a 140-series number registered with the operator under TCCCPR; people can
  block them through DND. Scrub against DND before every outbound call (provider or operator API).
- **1600 and 1601 series** are reserved for banks, insurance and financial services, government, utilities and logistics.
  Which number type an ordinary business's service call needs is to be confirmed with the provider.
- **Automated and AI voice calls** are covered by the 2026 TRAI amendments; AI-detected spam numbers can lose outgoing
  calls. Keep volume low, call only people who asked, and stop at the first "don't call me" (recorded as an opt-out).
- **Inbound calls** (customers call the business) are the simplest to start with.
- The business completes KYC with the provider (PAN, GST, company documents) and, for outbound sales, the operator
  registration. Nexus cannot do this for them.

---

## 7. Features, permissions, limits and metering (added to the catalogues in V1)

| Kind | Keys |
|---|---|
| Features (`modules/access/features.js`) | `voice_agent` (inbound and outbound calls with the AI agent; requires `crm` or `whatsapp_chats`), `voice_outbound` (outbound lists, V3; requires `voice_agent`) |
| Permissions | `voice.agents.manage` (editor, test call), `voice.calls.view`, `voice.calls.start` (call a lead), `voice.recordings.listen`, `voice.numbers.view`, `voice.campaigns.manage` (V3) |
| Default roles | Manager and Sales manager: all; Sales agent: view, start and listen for **assigned** leads; Viewer: view |
| Limits | `voice_agents` (count), `voice_numbers` (count) |
| Metering | channel `VOICE_MINUTE` (billing 5.9): counted per connected minute in V1 (count only), enforced with top-ups after a month of data (B7 rules) |

---

## 8. Data model (new; knex migrations, SQLite and Postgres)

| Table | Columns |
|---|---|
| `voice_provider_account` | org_id, provider, api_key_enc, webhook_secret_enc, status, created_by, timestamps; unique(org_id, provider) |
| `voice_agent` | org_id, workspace_id, provider, provider_agent_id unique, name, voice_id, languages json, style, greeting, goals json, handover json, outbound_rules json, recording_on, retention_days, kb_enabled, active, timestamps |
| `voice_number` | org_id, workspace_id, provider, e164, number_type (`inbound` \| `140` \| other), agent_id, active |
| `voice_call` | org_id, workspace_id, agent_id, lead_id, direction, to_e164, from_e164, provider_call_id unique, status, started_at, ended_at, duration_sec, end_reason, outcome, next_step, summary, provider_cost_minor, credits, recording_key, recording_deleted_at, idempotency_key unique, created_by, timestamps; index (org_id, workspace_id, started_at) |
| `voice_transcript_turn` | org_id, call_id, seq, speaker, start_ms, end_ms, lang, text; unique(call_id, seq) |
| `voice_consent` | org_id, workspace_id, contact e164, source (`lead_form` \| `whatsapp_optin` \| `webchat` \| `manual`), consented_at, opted_out_at |
| `voice_webhook_event` | provider, event_id unique, received_at, processed_at, outcome |

---

## 9. APIs and screens

**Customer (`/api/voice`, workspace scope):** `GET/POST/PUT /agents`, `POST /agents/{id}/test-call`, `GET /calls`
(filters: lead, outcome, agent, date), `GET /calls/{id}` (with transcript), `GET /calls/{id}/recording` (signed link),
`POST /leads/{id}/call`, `GET/PUT /settings` (provider key, numbers), V3: `GET/POST /campaigns`.
**Webhook:** `POST /api/webhooks/voice/{provider}`: 200 only when stored or safely ignored, 500 so the provider retries.
**Screens:** Inbound & Bot → **Voice agent** (editor, numbers, test call); lead page: **Call with AI** button and call
cards (player, transcript, summary, outcome); **Calls** list; V3 call lists.

---

## 10. Non-functional requirements

- Reply latency: under about 1 s from the caller stopping to the agent starting (provider responsibility; measured in
  the pilot from the provider's per-turn timings).
- A call never waits on Nexus: the live loop runs at the provider; Nexus only receives events.
- Webhook processing is idempotent (event id) and finishes within 10 s; the recording download runs as a job with retries.
- Every outbound start has an idempotency key; a double click never places two calls.
- Pilot quality check: 20 real calls per language reviewed by the business before going live.

---

## 11. Costs (published prices, 20 Nov 2026; confirm with quotes)

- Sarvam Voice Agents: about ₹3.00–3.50 a minute (platform, speech and voice), plus telephony about ₹0.20 per
  30-second pulse and about ₹59 a month per number. A 3-minute call is about ₹12.
- Others publish about ₹4–6 a minute. Exotel and Bolna: ask for quotes.
- Nexus prices voice minutes per plan (metering channel `VOICE_MINUTE`); the margin report (B8) compares provider cost.

---

## 12. Phases (added to `ROADMAP.md`, Wave 7)

| Phase | Scope | Depends on | Done when |
|---|---|---|---|
| **V0** Owner set-up | choose the provider and pilot business, inbound or outbound first; provider account, KYC, numbers; answers to section 14 | – | the provider account works and a number rings a provider test agent |
| **V1** Agent, calls and records | persistent file storage; provider port, adapter and fake; agent editor and test call; "Call with AI" on a lead; webhook; recording download; transcript, summary and outcome on the lead; catalogue keys; minutes counted | A0, B1, storage (platform L1 files service or a volume) | a test call appears on the lead with recording, transcript and summary within 5 minutes; another organisation's call id answers 404; webhook replay ×3 stores one call |
| **V2** Inbound customer care | the business's number answered by the agent; hand-over to staff numbers by hours; call-back when nobody is free; voicemail | V1 | a caller asking for a person is transferred in business hours and gets a call-back task outside them |
| **V3** Outbound lists | call lists from consented contacts; DND scrub; calling hours, retries and attempts; opt-out; results per list; minutes enforced per plan with top-ups | V2, B6/B7 metering, the owner's operator registration | a contact without consent or on DND is never dialled; "don't call me" stops every future call |
| **V4** More channels (optional) | WhatsApp calling, a second provider, or own pipeline (option B) | V3 | as chosen |

---

## 13. Tests

- Webhook: bad signature 401; replayed event stored once; unknown agent id ignored with 200 and logged.
- Isolation: every route with A's ids from B answers 404; recording links are signed and expire.
- Recording download retried on failure; a call without a recording still shows its transcript.
- Outbound (V3): consent, DND and opt-out enforced in the service, not only in the screen; double start = one call.
- Role matrix for the new permissions; Sales agent sees only assigned leads' calls.

---

## 14. Decisions and questions for the owner (defaults until answered)

| # | Question | Default |
|---|---|---|
| VA1 | Provider | Sarvam Voice Agents for the pilot (Indian languages, published pricing); Bolna or Exotel compared by quote |
| VA2 | First use case and pilot business | Inbound customer care for Avinash Group |
| VA3 | Languages and style | Marathi, Hindi and Hinglish; the business sends 2–3 example call lines |
| VA4 | Persona | A name, female voice, greeting chosen by the business; the AI disclosure is always added |
| VA5 | Recording retention | 180 days for audio; transcript and summary kept |
| VA6 | Lead updates after a call | Suggested by AI, confirmed by a person |
| VA7 | Outbound | Only consented contacts, 10:00–19:00 IST, at most 3 attempts, 1 day apart |
| VA8 | Pricing to customers | Minutes included per plan, decided in the plan designer after the pilot's real cost is known |

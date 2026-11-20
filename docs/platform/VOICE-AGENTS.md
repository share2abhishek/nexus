# AI voice assistant (WhatsApp calls, in-house speech): requirements

**What this covers:** each business's **human-like AI assistant** that answers and makes **WhatsApp voice calls** in the
caller's language (local words, Hinglish and other code-mixing), hands over to a person when needed, and stores every
call's recording, transcript, summary and outcome on the lead.

**Owner decisions (20 Nov 2026):**
1. WhatsApp calling first (Meta's Cloud API Calling), not a phone-network voice platform.
2. **Speech is in-house:** our own speech-to-text, voice (text-to-speech), voice controls and call audio handling, on
   servers we run. No third-party voice-agent API.
3. **The AI model is ours to choose** per platform and per business (Claude, Gemini, OpenAI, or an open model we host),
   behind one model port.
4. It presents itself as **"the AI assistant of <business>"**: human-like in voice and manner, honest that it is an AI
   assistant when it introduces itself or is asked.

**Status:** requirements only. Nothing is built. Phases V0–V5 are in `docs/platform/ROADMAP.md` (Wave 7). Facts about
Meta's calling API, models and prices were checked on 20 Nov 2026 and change often: confirm them in V0 and V1.

**Related:** access engine and catalogues `docs/platform/ACCESS-AND-ENTITLEMENTS.md`; AI sales agents (persona, goals,
hand-over) `docs/billing/ACCESS-REQUIREMENTS.md` 5.6; metering `docs/billing/REQUIREMENTS.md` 5.9; isolation rules
platform section 11 (skill `tenant-isolation`); the WhatsApp Cloud API integration in `services/leadPipeline/whatsappCloud.js`.

---

## 1. Goals and non-goals

### 1.1 Goals
1. **Inbound:** a customer taps "call" on the business's WhatsApp and the AI assistant answers, day and night. It answers
   from the business's knowledge base, captures the lead, books a call-back or visit, and transfers to a person on request
   or when unsure.
2. **Outbound:** call a lead who has given the business **call permission on WhatsApp**, within minutes of their enquiry,
   qualify them with the business's questions, and record the outcome.
3. **Human-like conversation:** the caller's language and dialect, a natural voice, short sentences, local words, the
   caller can interrupt (the assistant stops talking at once), replies within about 1.5 s.
4. **Everything recorded:** audio, a time-stamped transcript by speaker, an AI summary, outcome, next step and cost, on the
   lead's timeline and searchable.
5. **Our own stack:** speech and audio run on our servers; the AI model is swappable; no voice vendor lock-in.

### 1.2 Non-goals (for now)
- Ordinary phone-network (PSTN) calls. They need a telephony carrier or SIP trunk whatever we build; optional V5.
- Cold calls to people who never gave permission (WhatsApp requires permission for business-initiated calls).
- Cloning a real person's voice; emotion detection; payments over the call.

### 1.3 How it introduces itself
"Namaskar, main Priya bol rahi hoon, Avinash Group ki AI assistant. Aapki kaise madad karun?" After that it talks like a
person. It never claims to be a human being and says it is an AI assistant whenever asked. This is fixed, not a setting.

---

## 2. Architecture

### 2.1 The call loop (all ours except WhatsApp itself)
```
WhatsApp user ⇄ Meta (WhatsApp calling) ⇄ WebRTC audio (Opus) ⇄ our voice gateway
                                                                   │  noise suppression → voice activity detection (VAD)
                                                                   ▼
                          streaming speech-to-text (our model) → AI model (our choice, streamed) → sentence chunks
                                                                   ▼
                          text-to-speech (our model, streamed) → audio back to the caller; stops at once on barge-in
Nexus app: assistant setup, knowledge base, lead facts, call records  ⇄  voice gateway (internal API, signed)
```

### 2.2 Components
| Component | What | Where it runs |
|---|---|---|
| **Signalling** | Meta sends call events (incoming call with an SDP offer, ended, permission granted) to our webhook; we answer, accept, reject or start calls through the Graph API calling endpoints. Calling must be switched on for the number in WhatsApp Manager. | Nexus app (`/api/webhooks/whatsapp/calls`) |
| **Voice gateway** (new service) | Terminates the WebRTC audio: ICE, DTLS-SRTP, Opus decode and encode, jitter buffer, recording of both sides. Runs the turn-taking loop. Candidates: a Node WebRTC stack (`werift`, `node-datachannel`) or a self-hosted media server (LiveKit or Janus) with our agent as a participant; choose in V1 by a latency and stability test. | its own container; needs public UDP ports (Caddy can't proxy UDP), a STUN/TURN setting, and the EC2 security group opened for them |
| **Speech-to-text** | Streaming recognition with partial and final results. Candidates to evaluate on real call audio: Whisper large-v3 (faster-whisper) and AI4Bharat's Indic models (IndicConformer); measure word error rate per language and code-mixed speech. | GPU server |
| **Text-to-speech** | Streaming synthesis of natural Indian voices. Candidates: AI4Bharat Indic Parler-TTS and other open Indic voice models; compare naturalness, pronunciation of names and numbers, and time to first audio. | GPU server |
| **Voice activity detection and barge-in** | Detect when the caller starts and stops speaking (Silero VAD or similar); stop playback within about 200 ms when the caller talks; end-of-turn timing tuned per language. | voice gateway |
| **AI model port** | `complete({ system, messages, tools, stream })` with adapters: Claude, Gemini, OpenAI, and an OpenAI-compatible endpoint for open models we host (for example on vLLM). Picked per platform with a per-business override. Tools: look up the knowledge base, save lead fields, book a call-back, transfer to a person, end the call. | Nexus (keys in `services/secrets.js`) or the GPU server for hosted models |
| **Records** | Recording files, transcript turns, summary, outcome, cost. | Nexus database and file storage |

### 2.3 Latency budget (target about 1.5 s from the caller stopping to the assistant speaking)
| Step | Target |
|---|---|
| End-of-speech detection | 250–400 ms |
| Final speech-to-text | 150–300 ms after the end of speech (streaming) |
| AI model, first sentence | 300–700 ms (streamed; short system prompt; knowledge base looked up while the caller is still talking when possible) |
| Text-to-speech, first audio | 150–300 ms (streamed sentence by sentence) |
| Network both ways | 100–200 ms |
A filler such as "haan ji, ek second…" covers a slow tool call. Every step's timing is recorded per turn so the slow part
is visible.

### 2.4 Hardware
- Speech models need a **GPU server**; the shared Mumbai EC2 box (production, staging and other apps) has none and must not
  run them. Plan one GPU instance in ap-south-1 (instance type and price to confirm in V1; this is the main fixed cost),
  later more for concurrent calls.
- V1 measures how many simultaneous calls one GPU handles at the latency target; that sets plan limits and price.
- The voice gateway can start on the GPU server (one place for audio and models) and talk to Nexus over a signed internal
  API.

### 2.5 Voice controls (per assistant)
Voice (from the voices our TTS offers), speaking rate, pitch, pause length between sentences, language and dialect,
end-of-turn sensitivity (how long a silence ends the caller's turn), interruption sensitivity, background noise
suppression on or off, maximum call length, silence timeout, hold message, and pronunciation entries (business name,
place names, product names).

---

## 3. What the business sets up (assistant editor)

| Group | Fields |
|---|---|
| Identity | name (for example Priya), voice and voice controls (2.5), greeting (the AI-assistant introduction is always added), language(s) and dialect, style notes ("Puneri Marathi, mixes Hindi and English, friendly, short sentences"), 2–3 example lines |
| Model | the AI model (from the platform's list), temperature; staff choose which models a plan may use |
| Knowledge | the AI knowledge base (existing), allowed topics, things never to say (prices not in the KB, legal or medical advice) |
| Goals | questions to ask (budget, location, timeline...), objection answers, what counts as a qualified lead, booking a call-back or visit |
| Hand-over | staff WhatsApp numbers and hours; when to transfer (asked for a person, angry, unsure twice, high-value lead); what to say when nobody is free (take a call-back). Transfer in V2 is "a person calls back within N minutes" plus a notification; live transfer of the same call is V4 |
| Outbound rules | calling hours, days, retries and gap, maximum attempts, only contacts with WhatsApp call permission |
| Recording | on (default) with the spoken notice; retention period (default 180 days); who may listen |

The editor has a **test call**: the editor's own WhatsApp rings, and the transcript appears live on screen.

---

## 4. Recordings, transcripts and outcomes

- **Per call:** direction, lead, number (shown masked to roles without `voice.numbers.view`), assistant, model, status,
  start, end, duration, end reason, outcome (`interested`, `callback`, `visit_booked`, `not_interested`, `wrong_number`,
  `no_answer`, `handover`, `dropped`), next step, summary, costs (Meta per-minute charge where it applies, model tokens,
  GPU seconds).
- **Recording:** written by the voice gateway (both sides, stereo, Opus or MP3), uploaded to our storage at
  `{org_id}/{workspace_id}/voice/{call_id}`, private, played through a signed link valid 15 minutes.
- **Transcript:** one row per turn (speaker `assistant` | `caller` | `staff`, start and end ms, text, language, STT
  confidence), searchable; partial results are not stored.
- **After the call:** the AI writes the summary, outcome and next step; the lead's fields change only as the business allows
  (default: suggested, a person confirms).
- **Storage prerequisite:** production keeps files inside the container with no persistent volume. Before V2, files move to
  a persistent volume or S3-compatible storage (platform L1 files service), or recordings would be lost on deploy.
- **Retention:** a nightly job deletes audio past the retention period (transcript and summary kept unless the business
  chooses otherwise); a customer's deletion request removes audio and transcript.

---

## 5. Isolation, security and privacy (adds to platform section 11)

- Every table has `org_id NOT NULL` and `workspace_id`; calls, transcripts and recordings resolve through the scoped
  repository; another organisation's call id answers 404.
- The call webhook finds the organisation from the WhatsApp phone-number id registered in Nexus (never from payload text)
  and checks Meta's signature (`X-Hub-Signature-256`) as the existing WhatsApp webhook does.
- The voice gateway accepts work only from Nexus (signed requests, short-lived call tokens) and keeps no data after
  uploading; its logs carry ids and timings, never transcript text or phone numbers.
- The AI model receives only this business's knowledge and this lead's facts; prompts and outputs are not logged in full on
  the platform (hashes and token counts only, as platform 10.2).
- Model API keys and the WhatsApp token are encrypted; listening to a recording is audited.
- Consent: the spoken notice ("this call is recorded for quality and service") at the start of every call; outbound only
  to contacts who granted call permission; DPDP Act: purpose, retention and deletion on request.

---

## 6. WhatsApp calling rules (confirm in V0 against Meta's current documentation)

- Available in India on the Cloud API (Meta lists the US and Canada as exceptions for business-initiated calls).
- **User-initiated calls** (the customer calls the business) need calling switched on for the number; Meta does not charge
  the business for them (to confirm on Meta's rate card).
- **Business-initiated calls** need the user's **call permission** first (asked by a permission-request message; the user
  can revoke it). Meta charges per minute in 6-second increments (India rate to confirm) and limits calls per user per day.
- The number must be on the **official Cloud API**. Numbers connected through the unofficial Evolution API can't use calling.
- Meta's business and commerce policies apply (no spam; stop when asked). TRAI telemarketing rules are written for the
  telecom network; WhatsApp calls are not phone-network calls, but consent and DPDP rules apply all the same, and V5
  (phone-network calls) brings TRAI rules (140 series, DND) back in full.

---

## 7. Features, permissions, limits and metering (added to the catalogues in V2)

| Kind | Keys |
|---|---|
| Features (`modules/access/features.js`) | `voice_assistant` (WhatsApp calls with the AI assistant; requires `whatsapp_chats`), `voice_outbound` (business-initiated calls, V3; requires `voice_assistant`), `voice_premium_models` (stronger AI models on calls) |
| Permissions | `voice.assistants.manage` (editor, voice controls, test call), `voice.calls.view`, `voice.calls.start` (call a lead), `voice.recordings.listen`, `voice.numbers.view`, `voice.campaigns.manage` (V3) |
| Default roles | Manager and Sales manager: all; Sales agent: view, start and listen for **assigned** leads; Viewer: view |
| Limits | `voice_assistants` (count), `voice_concurrent_calls` (count; protects the GPU), `voice_call_minutes_max` (per call) |
| Metering | channel `VOICE_MINUTE` (billing 5.9): counted per connected minute from V2 (count only), enforced with top-ups after a month of data (B7 rules) |

---

## 8. Data model (new; knex migrations, SQLite and Postgres)

| Table | Columns |
|---|---|
| `voice_assistant` | org_id, workspace_id, name, voice_id, voice_controls json, languages json, style, greeting, model_key, model_settings json, goals json, handover json, outbound_rules json, recording_on, retention_days, kb_enabled, active, timestamps |
| `voice_number` | org_id, workspace_id, wa_phone_number_id unique, calling_enabled, assistant_id, active |
| `voice_call_permission` | org_id, workspace_id, contact (WhatsApp id), granted_at, expires_at, revoked_at, source |
| `voice_call` | org_id, workspace_id, assistant_id, lead_id, direction, contact, wa_call_id unique, status, started_at, answered_at, ended_at, duration_sec, end_reason, outcome, next_step, summary, model_key, tokens_in, tokens_out, gpu_ms, meta_cost_minor, credits, recording_key, recording_deleted_at, idempotency_key unique, created_by, timestamps; index (org_id, workspace_id, started_at) |
| `voice_transcript_turn` | org_id, call_id, seq, speaker, start_ms, end_ms, lang, text, confidence, stt_ms, llm_ms, tts_ms; unique(call_id, seq) |
| `voice_pronunciation` | org_id, workspace_id, term, say_as |
| `voice_webhook_event` | event_id unique, received_at, processed_at, outcome |

---

## 9. APIs and screens

**Customer (`/api/voice`, workspace scope):** `GET/POST/PUT /assistants`, `POST /assistants/{id}/test-call`, `GET /calls`
(filters: lead, outcome, assistant, date), `GET /calls/{id}` (with transcript), `GET /calls/{id}/recording` (signed link),
`POST /leads/{id}/call`, `POST /leads/{id}/call-permission` (send the WhatsApp permission request), `GET/PUT /settings`
(numbers, calling on or off), V3: `GET/POST /campaigns`.
**Webhook:** WhatsApp call events on the existing Meta webhook (signature checked), routed to the voice module.
**Internal (Nexus ⇄ voice gateway):** start session, turn events, tool calls (knowledge base lookup, save lead field,
book call-back, hand over, end), call finished with recording upload; all signed.
**Screens:** WhatsApp → **AI voice assistant** (editor, voice controls, test call with live transcript); lead page: **Call
with AI** and call cards (player, transcript, summary, outcome); **Calls** list; Super Admin: models allowed per plan, GPU
load and call health.

---

## 10. Non-functional requirements

- Latency target 1.5 s (2.3), measured per turn; alert when the 90th percentile goes above 2.5 s.
- Barge-in: the assistant stops talking within 200 ms of the caller speaking.
- A failure in our stack never leaves the caller in silence: after 3 s with no reply the gateway plays a short hold line;
  after 10 s it apologises, promises a call-back, creates the task and ends the call.
- Concurrency is limited per GPU (`voice_concurrent_calls`); extra inbound calls get a polite "all assistants are busy, we
  will call you back" and a call-back task.
- Webhook handling is idempotent (event id); every outbound start has an idempotency key (a double click is one call).
- Pilot quality bar: 20 real calls per language reviewed by the business; word error rate and "sounded natural" scores
  recorded in `docs/platform/UAT-LOG.md`.

---

## 11. Costs (to measure in V1; no vendor per-minute fee for speech)

- **GPU server** for speech (and for a hosted open model if chosen): the main fixed monthly cost; one always-on instance
  to start.
- **AI model** tokens per call when a hosted API model (Claude, Gemini, OpenAI) is used; zero per call (but more GPU) for an
  open model we host.
- **Meta** per-minute charge for business-initiated calls (rate card); user-initiated calls are free to the business (to
  confirm).
- Nexus prices voice minutes per plan (metering channel `VOICE_MINUTE`); the margin report (B8) compares cost per minute.

---

## 12. Phases (added to `ROADMAP.md`, Wave 7)

| Phase | Scope | Depends on | Done when |
|---|---|---|---|
| **V0** Owner set-up | pilot business (Avinash Group by default) on the official Cloud API with calling switched on; 20–30 real sample recordings per language (with consent) for testing; a GPU server account and budget; answers to section 14 | – | the pilot number shows the call button in WhatsApp; samples and budget ready |
| **V1** Speech lab | GPU server; speech-to-text and text-to-speech candidates set up and compared on the samples (word error rate, naturalness, speed); model port with Claude, Gemini and one hosted open model; a browser test page that talks to the pipeline; latency measured end to end | V0 | chosen STT and TTS per language with numbers in `UAT-LOG.md`; median turn under 1.5 s on the test page |
| **V2** WhatsApp inbound calls | voice gateway (WebRTC with Meta); call webhook and accept; turn loop with barge-in; assistant editor with voice controls and test call; recordings and transcripts on the lead; summary and outcome; hand-over as call-back task; persistent file storage; catalogue keys; minutes counted | V1, A0, B1, storage | a customer's WhatsApp call is answered by the assistant, and the call appears on the lead with recording, transcript and summary within 2 minutes; another organisation's call id answers 404; webhook replay ×3 stores one call |
| **V3** Outbound WhatsApp calls | call-permission requests and tracking; "Call with AI" on a lead; call lists with hours, retries and opt-out; Meta charges recorded; minutes per plan with top-ups | V2, B6/B7 metering | no call to a contact without permission; "don't call me" stops all future calls; costs per call shown to staff |
| **V4** Live hand-over and quality | transfer the live call to a staff member (staff joins in the app or on WhatsApp); supervisor listen-in; pronunciation list; per-turn quality review screen | V2 | a caller asking for a person reaches one in business hours without hanging up |
| **V5** Phone-network calls (optional) | a SIP trunk into the same voice gateway; TRAI rules (140 series, DND scrub, registration) | V3, a carrier contract | as chosen |

---

## 13. Tests

- Webhook: bad signature 401; replayed call event handled once; a number not registered in Nexus is ignored with 200.
- Isolation: every route with organisation A's ids from B answers 404; recording links are signed and expire.
- Gateway: simulated call audio (recorded fixtures) through VAD, STT, model (fake adapter) and TTS; barge-in stops playback;
  the 3 s hold line and 10 s fallback fire when a stage is made slow on purpose.
- Model port: each adapter passes the same contract tests (streaming, tool calls, timeout, error).
- Outbound (V3): permission and opt-out enforced in the service, not only in the screen; double start = one call.
- Role matrix for the new permissions; a Sales agent sees only assigned leads' calls.

---

## 14. Decisions and questions for the owner (defaults until answered)

| # | Question | Default |
|---|---|---|
| VA1 | Channel | **Decided:** WhatsApp calling first; phone-network calls optional later (V5) |
| VA2 | Speech | **Decided:** in-house STT and TTS on our GPU server; chosen per language in V1 from measured results |
| VA3 | AI model | **Decided:** our choice behind a model port; default Claude for quality, an open hosted model compared in V1 for cost |
| VA4 | Persona | **Decided:** "the AI assistant of <business>", human-like, honest when asked; name and voice per business |
| VA5 | Pilot business and direction | Avinash Group, inbound first |
| VA6 | Languages and style | Marathi, Hindi and Hinglish; the business sends sample lines and recordings |
| VA7 | Recording retention | 180 days for audio; transcript and summary kept |
| VA8 | Lead updates after a call | Suggested by AI, confirmed by a person |
| VA9 | Outbound rules | Only contacts with call permission, 10:00–19:00 IST, at most 3 attempts, 1 day apart |
| VA10 | GPU budget | To set in V0 after a price check; one always-on instance to start |
| VA11 | Pricing to customers | Minutes included per plan, decided after V2's measured cost per minute |

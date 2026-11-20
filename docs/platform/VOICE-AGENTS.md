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
5. **No outside provider at all** for speech, audio or the call loop: built in-house (WhatsApp itself and the AI model we
   choose are the only outside services).
6. **Pilot: UrbanSociety** (housing society management, urbansociety.in). Hinglish by default, with the caller's regional
   words (Marathi, Gujarati and others); female voice; staff hand-over 08:00–22:00 IST, 7 days a week; calls start
   **from chat** ("shall we talk on a call?"); recordings kept **30 days**. Setup and sample script: Appendix A.

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
| **V0** Owner set-up | pilot business (UrbanSociety) on the official Cloud API with calling switched on; 20–30 real sample recordings per language (with consent) for testing; a GPU server account and budget; answers to section 14 | – | the pilot number shows the call button in WhatsApp; samples and budget ready |
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
| VA2 | Speech | **Decided:** in-house STT, TTS, voice controls and call loop on our GPU server, no outside provider; models chosen per language in V1 from measured results |
| VA3 | AI model | **Decided:** our choice behind a model port; default Claude for quality, an open hosted model compared in V1 for cost |
| VA4 | Persona | **Decided:** "the AI assistant of <business>", human-like, honest when asked; UrbanSociety: female voice, "Sneha" (Appendix A.1) |
| VA5 | Pilot business and direction | **Decided:** UrbanSociety. Calls start from chat (Appendix A.3); a customer calling the WhatsApp number is answered too |
| VA6 | Languages and style | **Decided:** Hinglish by default, switching to the caller's language or mixing in their regional words (Marathi, Gujarati, others) |
| VA7 | Recording retention | **Decided:** 30 days for audio; transcript and summary kept (to confirm: also delete transcripts after 30 days?) |
| VA8 | Lead updates after a call | Suggested by AI, confirmed by a person |
| VA9 | Outbound rules | **Decided:** a call only when the person asks for it in chat (and grants WhatsApp call permission); a requested call is placed at once; retries (a missed requested call) only 08:00–22:00 IST, at most 2, 30 minutes apart |
| VA12 | Hand-over hours | **Decided (UrbanSociety):** 08:00–22:00 IST, 7 days; outside them the assistant books a call-back for 08:00 onwards |
| VA10 | GPU budget | To set in V0 after a price check; one always-on instance to start |
| VA11 | Pricing to customers | Minutes included per plan, decided after V2's measured cost per minute |

---

## Appendix A. Pilot: UrbanSociety

Facts below come from UrbanSociety's own website code (landing page, pricing page) on 20 Nov 2026. The assistant answers
only from the knowledge base; the owner keeps that knowledge base current (prices, offers, app availability).

### A.1 Assistant set-up
| Setting | Value |
|---|---|
| Business | UrbanSociety, the society management app for Indian housing societies, by Radixile Technology Solutions, media partner Sakal Media Group |
| Name and voice | **Sneha**, female, warm and calm, mid-pace (speaking rate 1.0, slightly slower for numbers and prices) |
| Language | Hinglish by default. If the caller speaks Marathi, Gujarati or another language, Sneha mirrors it: whole sentences where the TTS supports the language, otherwise Hinglish with the caller's common words ("bara", "kem cho", "chaala", "majama") |
| Greeting | "Namaste! Main Sneha bol rahi hoon, UrbanSociety ki AI assistant. Aapne chat par call ke liye kaha tha, isliye call kiya. Ye call quality ke liye record ho raha hai. Kya abhi 2-3 minute baat kar sakte hain?" |
| Goal | understand the society and the caller's role, explain what fits their problem, and **book a free demo** (or start the 30-day free trial) |
| Lead fields to fill | caller name, role (chairman, secretary, treasurer, committee member, resident, facility manager), society name, city and area, number of flats, wings, how they manage today (Excel, register, another app), main problem, decision timeline, demo date and time, WhatsApp for the link |
| Hand-over | staff on WhatsApp 08:00–22:00 IST, 7 days. Triggers: the caller asks for a person; a question not in the knowledge base twice; a complaint from an existing customer; a society over 500 flats (custom pricing); an angry caller. Outside the hours: "Hamari team kal subah 8 baje ke baad aapko call karegi" and a call-back task |
| Recording | on, kept 30 days; transcript and summary on the lead |
| Never | promise a discount or offer not in the knowledge base; quote competitor prices; give legal advice on society bye-laws or acts (offer the help pages instead); ask for card, OTP or bank details |

### A.2 Knowledge base (first version, from the website)
- **What it is:** one login for the whole committee: finance and accounting, resident communication, daily operations and
  AI automation.
- **Finance and accounting:** automatic maintenance bills sent on schedule with a statement per flat, payments linked to
  the ledger, vendor payments, member ledgers each resident can see, one-click income, expense and balance-sheet reports for
  the committee and auditors.
- **Resident engagement:** notice board (with read counts), polls and voting, complaints with response times (SLA),
  document storage.
- **Daily operations (add-on):** gate passes with OTP, visitor tracking, staff attendance, amenity booking (for example the
  clubhouse).
- **AI and automation:** AI reads receipts and invoices, reconciles bank statements, flags unusual entries, drafts the
  monthly report; works in several languages.
- **Prices (per flat per month, as on the site):** Gate Guard ₹5, Standard ₹15, Premium ₹20. No setup or onboarding fees,
  no ads in the portal. Taxes extra. (Per-society minimums and the "Founding 50" offer are drafts: add them to the
  knowledge base only when they go live.)
- **Trial:** 30-day free trial with every feature, no card needed.
- **Apps:** Android on Google Play; iPhone app coming soon on the App Store; works in the browser.
- **Contact:** +91 8554 00 01 02, contact@urbansociety.in, urbansociety.in (demo booking, user guide, help pages, society
  letter formats, MCS Act and related acts pages).
- **Referral:** refer another committee; both get benefits when they join (details from the referral page).

### A.3 From chat to call
1. In WhatsApp chat or the website chat, when a lead shows interest (asks about price, demo, "kaise kaam karta hai") or
   after the third message, the chat assistant offers: "Agar aap chahein to hum 2-3 minute phone par baat kar sakte hain,
   main aapko sab samjha dungi. Call karun?" with buttons **Haan, call karo** / **Baad mein** / **Nahi, chat theek hai**.
2. **Haan:** on WhatsApp, Nexus sends Meta's call-permission request; when the person allows it, Sneha calls at once. From
   the website chat, Nexus first asks for the WhatsApp number and consent, then sends the permission request there. The
   person can also tap the call button in WhatsApp themselves; the same assistant answers.
3. **Baad mein:** the person picks a time (today or tomorrow, 08:00–22:00); the call is scheduled.
4. **Missed call:** one WhatsApp message ("Maine call kiya tha, aap busy honge. Kab call karun?") and at most 2 retries,
   30 minutes apart, within 08:00–22:00.
5. **Nahi:** the chat carries on; no call is offered again in that conversation.
6. After the call, the chat gets a short WhatsApp message with what was agreed (demo time, link) and the lead shows the
   call card.

### A.4 Sample call script (Hinglish; Sneha adapts it, it is not read word for word)

**1. Opening (always)**
> Sneha: Namaste! Main Sneha bol rahi hoon, UrbanSociety ki AI assistant. Aapne chat par call ke liye kaha tha, isliye
> call kiya. Ye call quality ke liye record ho raha hai. Kya abhi 2-3 minute baat kar sakte hain?
- If no: "Koi baat nahi. Kab call karun? Aaj shaam ya kal subah?" → schedule, end.

**2. Who and where**
> Sneha: Thank you! Pehle thoda samajh leti hoon. Aap society mein kya role sambhalte hain, chairman, secretary,
> treasurer ya committee member? … Aur society ka naam aur area kya hai?
> Sneha: Kitne flats hain lagbhag, aur kitne wings?

**3. Today's way and the pain**
> Sneha: Abhi maintenance bills aur collection kaise manage karte hain? Excel, register, ya koi app?
> Sneha: Sabse zyada time kis cheez mein jaata hai: bills banana aur reminders bhejna, pending dues follow up karna,
> notices aur complaints, ya gate par visitors?

**4. Fit (pick only what matches their pain)**
- Bills and dues: "UrbanSociety mein bills apne aap schedule par chale jaate hain, har flat ko apna statement milta hai,
  aur payment aate hi ledger update ho jaata hai. AGM mein 'kisne kitna diya' wala sawaal hi khatam."
- Reports and audit: "Income, expense aur balance sheet ek click mein, committee aur auditor dono ke liye ready."
- Communication: "Notice board pe kitne logon ne padha wo bhi dikhta hai, polls se voting hoti hai, aur complaints ka
  status members khud dekh sakte hain."
- Gate and visitors: "Gate pass OTP se, visitor log, staff attendance aur clubhouse booking bhi, ek hi app mein."
- AI: "Receipts aur invoices ka photo daalo, AI khud category mein daal deta hai, aur bank statement bhi match kar deta hai."

**5. Price (only when asked, or after the fit)**
> Sneha: Pricing simple hai, per flat per month: Gate Guard ₹5, Standard ₹15, Premium ₹20. Setup ya onboarding ka koi
> charge nahi. Aur pehle 30 din bilkul free, card bhi nahi chahiye.
- Over 500 flats: "Itni badi society ke liye hamari team custom plan banati hai. Main unse aapki baat karwa deti hoon."
  → hand-over.

**6. Common objections**
- *"Committee se poochna padega."* → "Bilkul sahi. Main ek free demo rakh deti hoon jisme poori committee jud sakti hai,
  aur 30 din ka trial bhi hai, toh decision aaram se le sakte hain. Kaunsa din theek rahega?"
- *"Hum already ek app use karte hain."* → "Achha, kaunsa? Usmein sabse zyada kya pareshan karta hai?" Then fit to that
  pain; never criticise the other app.
- *"Data safe hai?"* → "Haan ji, platform SSL secured hai aur har society ka data alag rehta hai. Demo mein team details
  mein bata degi."
- *"Members tech-savvy nahi hain."* → "Android app aur browser dono mein chalta hai, aur kai bhashaon mein hai. Members ko
  bas apna statement dekhna aur pay karna hota hai."
- *"Mehenga hai."* → "Samajh sakti hoon. Example ke liye 100 flats pe Standard ₹1,500 mahine ka padta hai, jo ek
  part-time accountant se kaafi kam hai. Aur pehle 30 din free hain."
  (Example computed from ₹15 × 100 flats; no minimums or discounts quoted.)

**7. Close**
> Sneha: Toh main aapke liye free demo book kar deti hoon. Kal ya parso, subah ya shaam, kya theek rahega? … Done!
> Main aapko WhatsApp par confirmation aur link bhej rahi hoon. Aur koi sawaal?
> Sneha: Thank you [naam] ji, aapka din achha rahe!

**8. Regional touches (examples; used only when the caller speaks that way)**
- Marathi: "Namaskar! Tumchi society kuthe aahe? … Kiti flats aahet? … Chaala, mag demo book karu ya?"
- Gujarati: "Kem cho! Tamari society kya aavi? … Ketla flats chhe? … Saru, demo book kari dau?"

**9. Hand-over lines**
- In hours: "Main aapko hamari team se abhi jod deti hoon, ek minute line par rahiye." (V4 live transfer; until then:
  "Hamari team 10 minute mein aapko call karegi.")
- Out of hours: "Hamari team abhi available nahi hai, kal subah 8 baje ke baad aapko call karegi. Theek hai?"

### A.5 What the owner still needs to give
1. Confirm UrbanSociety's WhatsApp number for the pilot and move it to the official Cloud API with calling switched on (V0).
2. Approve Sneha's greeting and the price lines; say whether the Founding 50 offer is live.
3. 10–20 real recordings (with consent) of committee members talking about society work, in Hinglish, Marathi and
   Gujarati, to test speech recognition in V1.
4. Staff WhatsApp numbers for hand-over, and who gets call-back tasks.
5. Whether transcripts are also deleted after 30 days, or only the audio.

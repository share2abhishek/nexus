# Security hardening (what changed and what to set)

Written after the security review of 2026-11-16. This lists what the app now enforces and
what an operator of the **hosted (server) edition** must configure.

## Must set on a hosted install

| Setting | Why |
|---|---|
| `SESSION_SECRET` | Signs login cookies. The server **refuses to start** without a long random value (24+ characters, not a placeholder such as the old `.env.example` value). Make one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PLATFORM_ADMIN_EMAILS` | The only way to name Radixile staff by email. No address is built in. They become admins once their email is **verified**. A user can also be made `superadmin` in the database. |
| `TRUST_PROXY` | Number of proxies in front of the app (usually `1`). Without it every visitor shares one IP address, so IP rate limits (sign-up, sign-in, web chat) apply to everyone at once. |

The desktop app needs none of these: it makes its own session secret and keeps it in the data folder.

## What the app now enforces

- **Admin by text is gone.** No e-mail address or domain is trusted by its text. A platform
  admin is `role = superadmin`, or an address in `PLATFORM_ADMIN_EMAILS` that has been verified.
- **Accounts are checked on every request** (cached for ~5 s): suspending, demoting or deleting
  a user takes effect almost at once, not when the 7-day cookie expires. A new session id is made at every sign-in.
- **Cookies and headers:** `secure` cookies on the hosted edition, `X-Frame-Options`, `nosniff`,
  `Referrer-Policy`, and HSTS on the hosted edition.
- **Outbound requests are fenced (SSRF).** Everything the server fetches from an address a user
  typed (websites it reads, RSS feeds, pictures, SEO checks, n8n / Slack webhooks, Evolution server,
  Bluesky server) refuses private, local, link-local and cloud-metadata addresses **at connect time**
  (`services/safeNet.js`), so a name that resolves to a private address, and redirects to one, are blocked too.
  On the hosted edition a customer can no longer point the server at their own Ollama address.
- **Rate limits** (`middleware/rateLimit.js`, in memory per process): general API per person, a tighter limit on
  AI / website-reading actions, sign-up, sign-in and password-reset per network address, and three limits on the
  public website-chat endpoint (per address, per chat widget, per visitor).
- **AI cost control.** Radixile's platform AI keys are only used for accounts with a **verified email**,
  and every call is counted per business (`PLATFORM_AI_DAILY_LIMIT`, `PLATFORM_AI_PER_MINUTE`).
  The auto-reply bot answers at most `BOT_AI_DAILY_LIMIT` messages a day with AI, whoever's key pays.
- **Local-folder routes** (`/api/local/*`) stay inside the content folder and are off on the hosted edition.

## AI prompt-injection defences (`services/aiSafety.js`)

Text from outside (a website visitor's message, a prospect's reply, a company's web page, a spreadsheet
column) is cleaned of invisible characters and delimiter tricks, kept in fenced blocks marked as data,
and obvious "ignore your instructions" attempts are not sent to the AI at all (the customer gets the
business's plain reply). What the bot says back may not leak its notes and may only contain links,
email addresses and phone numbers that the business wrote itself. AI-written outreach may only link to the
sender's own site or the prospect's; if anything was removed or looked suspicious the drafts are
**always held for a person's approval**, even in an auto-approve campaign.

Filtering cannot make prompt injection impossible. Tell customers: **everything in the knowledge base
can be shown to anyone who chats with the bot**, so keep private notes out of it.

## Known gaps (not yet done)

- Rate limits and AI counters are per process and reset on restart; behind several instances use a shared store (Redis).
- The AI call sends rules and customer text as one user message; moving the rules to a system role per provider would be stronger.
- Website-chat history is read with a visitor id that the browser makes (guessable in principle); issue server-made random ids.
- CSV exports do not yet neutralise cells starting with `=`, `+`, `-`, `@`.
- Excel import does not cap an absurd column reference (memory use).
- The server edition stores its data key next to the data; use an environment secret or a key service.
- Remaining `npm audit` findings are in the build chain of `sqlite3` (`node-gyp`, `tar`), not in code that runs in the app.

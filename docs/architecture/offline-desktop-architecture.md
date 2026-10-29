# Social-Nexus target architecture: offline, licensed, multi-engine desktop app

*Social-Nexus by Radixile Technology Solutions.* Status: proposal · 2026-10-25 · Builds on `docs/architecture/redesign-plan.md` (the "RP") and `docs/testing/2026-10-25-ui-test-report.md` (the "TR"). Section numbers below refer to this document. RP §n means a section of the redesign plan.

---

## 0. What the code does today that drives this design

These facts come from reading the repo. Several of them change the RP's assumptions.

| # | Fact | Consequence |
|---|---|---|
| A1 | `electron/main.js` `startServer()` launches `server/index.js` with a **bundled `resources/node/node.exe`**, found by `findNodeExe()` (Windows paths, `where node`, nvm). `build/build-win.ps1` §3 and the `postinstall` step (`electron-builder install-app-deps`) rebuild native modules for the **Electron ABI**. | **Likely ABI mismatch.** `better-sqlite3` and `sqlite3` are compiled for Electron but loaded by plain Node 20. This needs checking on a clean machine. The model also can't work on macOS: there is no `node.exe`, and `findNodeExe` is Windows-only. **Move to `utilityProcess`** (§5.4). |
| A2 | There are two SQLite drivers. Knex uses `sqlite3` (`config/db.js`, `client: 'sqlite3'`) and so does `connect-sqlite3` (`sessions.db`). `services/database.js` uses `better-sqlite3` with a hard-coded `../data/nexus.db`, and only a comment in `repos/usersRepo.js` still mentions it. | Consolidate on **one driver: `better-sqlite3`** through Knex's `better-sqlite3` client (§4.2). |
| A3 | `config/db.js` reads `DB_CLIENT` and `DATABASE_URL` from env. `server/index.js` picks the session store from `DB_CLIENT`. Tests already run on SQLite `:memory:` or on `PG_TEST_URL` (`tests/helpers/db.js`). | Most of the storage abstraction already exists. Formalise it as `services/storage/` (§4). |
| A4 | Configuration lives in a `.env` that `prepareDataDir()` copies into `userData`. Routes still write `.env` (RP C6, TR F16). | Replace it with `DATA_DIR/config.json` (bootstrap settings only) plus the `app_config` table (§3). |
| A5 | `build/installer.nsh` creates `$APPDATA\NEXUS\…`, **opens an inbound firewall rule for TCP 3000**, and the uninstaller can `RMDir /r` all data. | The firewall rule contradicts the `127.0.0.1` binding: remove it, and add a rule only when LAN mode is enabled (§6.6). The uninstaller should default to *keep data*. |
| A6 | `productName: "NEXUS"` puts `userData` in `%APPDATA%\NEXUS` and `~/Library/Application Support/NEXUS`. | Renaming (R4) silently changes the data path, so it needs an explicit migration (§3.4). |
| A7 | OAuth callbacks are env strings that default to `localhost:3000` (`routes/auth.js` L101, L397, L506). | Callback URLs must be derived from the actual bound origin (TR F2). The R2 guide shows that URL (§6.2). |
| A8 | `services/scheduler.js` runs `node-cron` every minute and publishes directly with `postToPlatform()`. There is no notion of connectivity. | This becomes the jobs worker (RP §5) with network-aware claiming (§1.3). |
| A9 | `services/aiHelper.js` has a fallback chain plus `withOllamaQueue`. `isOllamaRunning()` already exists. | The AI gateway (RP §4) gets an *offline-aware resolver* (§1.2). |
| A10 | `app.use(cors())` is fully open, the server binds `127.0.0.1:3000`, and the session secret comes from `.env`. | Harden with Host/Origin checks, CSRF and a secret held in the keystore (§5.5). |

**Where this document departs from the RP, and why**

- RP §1 said "keep `electron/main.js` spawn". This design replaces it with `utilityProcess` because of A1, macOS support and Electron fuses.
- RP §10 deferred Postgres. Postgres is now a **supported option for Agency** (the user asked for it). SQLite stays the default and the primary test target.
- RP §8 bound the master key to one machine via `safeStorage`. That stays for SQLite. For **shared Postgres** a team key wrap is added, because a machine-bound key can't decrypt rows written by another PC (§3.2).

---

## Overview

```
┌──────────────────────────── Electron app (one signed bundle, Win x64 / mac arm64+x64) ───────────────────────────┐
│                                                                                                                │
│  MAIN PROCESS  electron/main.js                                                                                │
│  ├─ bootstrap/  config.json load, data-dir resolve + rename migration, single-instance lock                   │
│  ├─ license/    fingerprint · verify(Ed25519) · lease refresh · clock guard · activation UI   (obfuscated)    │
│  ├─ keystore/   safeStorage(DPAPI/Keychain) unwraps DEK → hands to server over MessagePort (never env/disk)   │
│  ├─ net/        net.isOnline() + powerMonitor (resume/suspend) → pushes connectivity events                    │
│  ├─ updater/    electron-updater (generic provider → license server, licence header)                          │
│  ├─ tray, notifications, login-item, powerSaveBlocker, native dialogs (backup/import file pickers)            │
│  └─ supervisor: utilityProcess.fork(server/index.js) · restart w/ backoff · MessagePort RPC                   │
│        │ parentPort messages: {dek, entitlements, licenseFile, connectivity, dataDir, port, launchToken}      │
│        ▼                                                                                                       │
│  UTILITY PROCESS (Node inside Electron, same ABI)  server/index.js                                             │
│  ├─ Express on 127.0.0.1:<port> (LAN mode: 0.0.0.0 + TLS, opt-in, Agency)                                     │
│  │   middleware: hostGuard, session(knex store), csrf, auth, tenancy, entitlements, rateLimit                 │
│  ├─ routes/* (thin)                                                                                           │
│  ├─ services/storage/   engine factory: memory | sqlite | postgres  → knex + capabilities + queue + search    │
│  ├─ services/ai/        gateway (Ollama-first when offline)                                                    │
│  ├─ services/scheduler/ jobs worker (network-aware) + planners (autopilot, seo, recurring, token refresh)     │
│  ├─ services/publish/   per-platform adapters                                                                  │
│  ├─ services/autopilot/ rules → facts → AI draft → review → publish job                                       │
│  ├─ services/seo/       GSC pull, crawl, keyword research, meta gen, CMS connectors                            │
│  ├─ services/facts/     wikimedia/wikidata/festival-feed sync + offline cache                                  │
│  ├─ services/backup/    hot backup, .snbak export/import, engine-to-engine copy                               │
│  ├─ services/secrets/   AES-256-GCM envelope (DEK from main)                                                   │
│  └─ services/license/   re-verifies licence signature, requireFeature()  (defence in depth)                   │
│        │                                                                                                       │
│        ▼  Knex                                                                                                 │
│   ┌──────────────┬───────────────────────────────┬──────────────────────────────────────┐                     │
│   │ :memory:     │ DATA_DIR/db/social-nexus.db   │ PostgreSQL (user-supplied, LAN)      │                     │
│   │ better-sqlite│ better-sqlite3, WAL, FTS5     │ pg, SKIP LOCKED, tsvector/pg_trgm    │                     │
│   └──────────────┴───────────────────────────────┴──────────────────────────────────────┘                     │
│                                                                                                                │
│  RENDERER  BrowserWindow → http://127.0.0.1:<port>/  (public/ SPA, ES modules)                                 │
│  └─ preload.js (contextBridge): license status/activate, pickFile, saveFile, openExternal, connectivity,       │
│                                  app version, restart-server. No nodeIntegration.                              │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        │ HTTPS (only when online)
        ▼
  Social APIs · cloud AI · SMTP/ESP · Google Search Console · Wikimedia · license.radixile.com (activate/lease/updates/fact feed)
  Ollama on 127.0.0.1:11434 (local, offline-capable, not bundled)
```

**Who owns what**

| Process | Owns |
|---|---|
| Main | Anything that needs OS or Electron APIs: `safeStorage`, `net`, `powerMonitor`, auto-update, the licence fingerprint, dialogs, tray |
| Server | Everything that touches data |
| Renderer | UI only |

---

## 1. Offline-first operation (Windows and macOS)

### 1.1 Capability matrix

| Capability | Offline | How it behaves offline |
|---|---|---|
| Log in, local accounts, workspaces, RBAC | ✅ | Everything is local |
| Draft, edit and organise content, templates, brand kit, media library (uploads stored in `DATA_DIR/media`) | ✅ | |
| Calendar, festivals overlay | ✅ | `calendar_events` and `fact_items` are cached locally. The festival feed refreshes when online. |
| Scheduling (choose a time, queue slots, recurring rules) | ✅ | Jobs are created normally |
| Local AI via Ollama (generate, rewrite, translate, hashtags) | ✅ if Ollama is installed and a model is pulled | The gateway prefers Ollama when offline |
| Autopilot *drafting* | ✅ (Ollama plus cached facts) | Facts are prefetched 30 days ahead. Drafts wait in the outbox. |
| Analytics and SEO **viewing** | ✅ | Shows the last snapshot, with a "data as of" stamp |
| Search (FTS) | ✅ | |
| Backup, export, import | ✅ | |
| Publishing to social networks | ❌ needs internet | Job state is `waiting_network`. It drains automatically when the connection returns. |
| OAuth connect and token refresh | ❌ | The button is disabled with a reason. Refresh jobs wait. |
| Cloud AI (Gemini, Claude, Groq, …) | ❌ | Falls back to Ollama, and the UI shows "Offline → used Ollama" |
| Email send, test send | ❌ | `email_batch` jobs wait |
| GSC pull, keyword research, fact sync | ❌ | Retried at the next online window |
| Licence check-in, updates | ❌ | Grace rules apply (§2.5) |
| Image and video generation (cloud) | ❌ | Unless a local provider is added later |

**Desktop reality.** Scheduled work only runs while the app is running. Mitigations:

- Launch at login (`app.setLoginItemSettings`, opt-in at first run).
- Close-to-tray behaviour (already implemented).
- `powerSaveBlocker` (already implemented).
- A catch-up pass on startup and on `powerMonitor` `resume`, governed by `late_policy` (below).

### 1.2 Connectivity model: `electron/net/connectivity.js` and `services/net/connectivity.js`

- The main process watches `net.isOnline()`, `powerMonitor` `resume`/`unlock-screen`, and polls every 30 s while offline. It posts `{online}` to the server.
- The server keeps **per-scope reachability**: a circuit breaker for each `network_scope`, such as `meta`, `linkedin`, `x`, `google`, `pinterest`, `tiktok`, `smtp:<id>`, `ai:<provider>`, `license`, `wikimedia`. A scope trips after 3 network-class failures (ENOTFOUND, ECONNRESET, ETIMEDOUT, 5xx), then half-opens with a cheap probe (HEAD to the API host) using exponential backoff from 30 s to 10 min.
- The UI gets a status pill fed by an SSE `/api/events` stream: 🟢 Online · 🟡 Some services unreachable (Meta) · 🔴 Offline: 4 posts waiting.

### 1.3 Offline outbox = the jobs table (no second queue)

The RP §5 `jobs` table gets these extra columns:

| Column | Purpose |
|---|---|
| `requires_network` bool | |
| `network_scope` text | |
| `blocked_reason` | `offline`, `scope_down`, `license`, `needs_reauth` |
| `valid_until` bigint, nullable | |
| `late_policy` | `post_anyway`, `skip`, or `hold_for_review` |
| `origin` | `user`, `autopilot`, `seo`, `system` |

Worker rules (`services/scheduler/worker.js`):

1. **Claiming.** Claim only jobs where `requires_network = false`, or where the job's scope is currently up. Jobs skipped because they're offline are set to `status='waiting_network'`. **Attempts are not incremented**, so being offline never burns retries.
2. **Lateness.** When a job becomes runnable but `now > run_at + late_threshold` (default 6 h, set in `schedule_settings`), apply `late_policy`:
   - user posts default to `hold_for_review`, which sends a notification: "3 posts are late. Post now / Reschedule / Skip"
   - autopilot posts default to `skip` when `now > valid_until`, for example a festival greeting that's a day late.
3. **Draining.** On reconnect, drain with a per-scope rate limit (for example at most 1 publish per account per 30 s) to avoid platform spam flags.
4. **Outbox page.** The UI "Outbox" is a view over jobs `WHERE status IN ('queued','waiting_network','retrying') AND requires_network`. It shows the reason, Retry now, Edit and Cancel.

### 1.4 AI gateway, offline-aware (extends RP §4)

`services/ai/resolve.js` takes the connectivity state as input. If offline, or the provider's scope is down, cloud providers are removed from the chain *before* any call is made. The result is no 30-second timeouts, followed by an Ollama fallback. If Ollama is also missing, the response is a typed `AI_UNAVAILABLE_OFFLINE` error that the UI turns into "Install Ollama to use AI offline" with the existing 3-step guide.

### 1.5 Platform note: Windows and macOS parity

All paths come from `app.getPath()`. The `wmic` disk check in `checkWindowsCompatibility()` is deprecated, so replace it with `fs.statfs` (Node 18.15+), which works on both platforms. macOS minimum is 11 (Electron 35 dropped 10.15). Fix the Catalina check (`major < 19`) to `major < 20`.

---

## 2. Licensing and anti-piracy

### 2.1 Honest threat model

An Electron app ships JavaScript. A determined cracker can unpack it, patch the licence check, re-pack it, and run it unsigned. **This can't be prevented, only made more expensive.**

The pragmatic goals are:

1. Stop **casual sharing**: copying the install folder, passing a key around, cloning a VM.
2. Make a crack **break code signing**, so cracked copies trigger SmartScreen and Gatekeeper warnings and can't auto-update.
3. Keep **real value on the server** behind the licence, which a crack can't replicate: signed updates, the verified festival and fact feed, autopilot content feeds, support.
4. **Never hold user data hostage.** An expired licence means read and export only.

Layers, from cheap to costly:

| Layer | What it does | Defeats |
|---|---|---|
| L1 Signed licence file (Ed25519, public key embedded) | You can't forge entitlements | Key generators, editing JSON |
| L2 Machine binding (hashed fingerprint, k-of-n) | A licence file doesn't work on another PC | Copying the install or data dir |
| L3 Online activation with a seat count and a lease (periodic check-in) | Server-side seat enforcement and revocation | Key sharing, refunds and chargebacks |
| L4 Code signing, notarisation, Electron **fuses**, **asar integrity** | Patched bundles fail OS signature checks; `ELECTRON_RUN_AS_NODE` and `--inspect` are disabled | Drive-by patching, debugger attach |
| L5 Obfuscated licence module, checks duplicated in main and server, spread across feature points | Raises the cost of patching | Find-and-replace cracks |
| L6 Server-delivered value (updates, fact and festival feed, template packs) gated by an activation token | A crack is a frozen, unsupported, stale build | Long-term piracy |

**bytenode / V8 bytecode.** It's optional. It must be compiled with the exact shipped Electron version (run the compile under `ELECTRON_RUN_AS_NODE` at build time, *before* fuses are flipped). The `.jsc` loader is still patchable. Recommendation: **javascript-obfuscator** on `electron/license/**` and `services/license/**` only, with string-array and control-flow options and *no* self-defending option (it breaks with source maps and stack traces). bytenode can be a later experiment. Don't obfuscate the whole app: it hurts debugging and performance.

### 2.2 Editions (proposal; prices and limits are for the user to decide)

| | **Demo** (no licence) | **Trial** (14 days) | **Individual** | **Agency** |
|---|---|---|---|---|
| Storage engines | in-memory only | SQLite | in-memory, SQLite | in-memory, SQLite, **Postgres** |
| Machines | any | 1 | 1 (+1 transfer per 90 days) | `seats` (e.g. 3, 5, 10) |
| Local users per install | 1 | 2 | 2 | named users ≤ `users_max` |
| Workspaces (brands or clients) | 1 | 3 | 1 brand | `workspaces_max` (e.g. 25) |
| Publishing | ❌ (preview only) | ✅ | ✅ | ✅ |
| Autopilot (R3) | ❌ | 1 rule | 3 rules | unlimited |
| SEO automation (R5) | ❌ | 1 site | 1 site | `sites_max` |
| Approvals and client portal | ❌ | ✅ | ❌ (personal mode) | ✅ |
| LAN host mode / Postgres team mode | ❌ | ❌ | ❌ | ✅ |
| Updates | n/a | ✅ | until `upd_until` | until `upd_until` |
| Lease length (offline tolerance) | n/a | 14 days | 30 days | 30 days (air-gap: 365, manual) |

The feature flags live in the licence payload `feat{}`, so editions can change without an app release.

### 2.3 Fingerprint: `electron/license/fingerprint.js`

Components are read with `child_process.execFile` (no shell), each normalised (trim, upper-case) and then `HMAC-SHA256(APP_FP_SALT, value)`. **Raw serials never leave the machine.** That's good for DPDP (India's data-protection law).

| # | Windows | macOS |
|---|---|---|
| c1 | `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` (`reg query`) | `IOPlatformUUID` (`ioreg -rd1 -c IOPlatformExpertDevice`) |
| c2 | SMBIOS UUID: `Get-CimInstance Win32_ComputerSystemProduct` `.UUID` | `IOPlatformSerialNumber` |
| c3 | Baseboard serial (`Win32_BaseBoard`) | `hw.model` (`sysctl`) |
| c4 | System volume serial (`Win32_LogicalDisk` for `%SystemDrive%`) | Root volume UUID (`diskutil info /`) |
| c5 | CPU `ProcessorId` (`Win32_Processor`) | CPU brand (`sysctl machdep.cpu.brand_string`) |

On Windows, use `powershell -NoProfile -Command` with a single combined query (one process, about 300 ms), because `wmic` is removed in current Windows 11 builds.

**Tolerance**

- A match needs **≥ 3 of 5** components, with c1 or c2 required.
- When some components drifted (for example a new disk), the next online refresh re-issues the licence with the updated hashes. That handles silent self-healing.
- More than 2 mismatches means "This licence was activated on a different computer." The user can either use **Transfer** (deactivate the old machine from the customer portal) or re-activate, which counts against `max_transfers` per year (default 3).
- **VM clones** produce identical fingerprints. The server flags two activations with the same fingerprint refreshing from different networks within 24 h. Act on that manually; don't auto-ban.

### 2.4 Licence key and licence file

**Key:** `SNX-` followed by 4 groups of 5 Crockford-base32 characters (100 random bits) plus a 1-character check. Example: `SNX-7KQ2M-…`. The server stores only `sha256(key)`.

**Licence file:** `DATA_DIR/license/license.snlic`

```
-----BEGIN SOCIAL-NEXUS LICENSE-----
<base64url(payload JSON)>.<base64url(Ed25519 signature over the payload bytes)>
-----END SOCIAL-NEXUS LICENSE-----
```

```json
{ "v":1, "kid":"rdx-2026-1", "typ":"license",
  "lic":"lic_8f2…", "act":"act_19c…", "cust":"Acme Pvt Ltd",
  "ed":"agency", "seats":5,
  "feat":{"publish":true,"autopilot_rules":-1,"seo_sites":5,"workspaces_max":25,"users_max":10,"pg":true,"lan":true,"portal":true},
  "fp":{"alg":"hmac-sha256-v1","c":["h1","h2","h3","h4","h5"],"min":3,"req":[0,1]},
  "iat":1793000000, "nbf":1793000000,
  "exp":null,                 // subscription end; null = perpetual
  "lease_exp":1795592000,     // must check in before this
  "upd_until":1824536000,     // updates released after this date are refused
  "srv_time":1793000000 }
```

**Verification**

- Use Node's built-in `crypto.verify(null, payload, publicKey, sig)`, so **no dependency** is needed.
- Two public keys are embedded (current and next `kid`) so keys can be rotated.
- The same verifier is included in `electron/license/verify.js` and `services/license/verify.js`. The server checks independently, so patching main alone doesn't unlock server features.

**Local state:** `DATA_DIR/license/state.json` holds `{last_ok_check, last_seen_wallclock, max_seen_wallclock, act}`, MAC'd with HMAC keyed by a value derived from the fingerprint and the DEK, so copying it to another machine is detectable.

### 2.5 Lease, grace and clock rules

| Situation | Behaviour |
|---|---|
| Online | Silent `/refresh` every 7 days, and also at startup if more than 24 h have passed. Each refresh returns a new licence with `lease_exp = now + 30 d`. |
| Offline, `now < lease_exp − 7 d` | Fully functional |
| Offline, last 7 days of the lease | Non-blocking banner: "Connect to the internet within N days to keep publishing" |
| `now > lease_exp` | **Limited mode.** View, edit, draft, export and backup all keep working. Publishing, autopilot, the SEO worker and email sending are paused (jobs `blocked_reason='license'`). They resume as soon as a refresh succeeds. |
| Clock rollback (`now < max_seen_wallclock − 48 h`) | Treated as `lease_exp` passed until an online refresh. `srv_time` from the server re-anchors the clock. |
| Server says `revoked` (refund, chargeback, abuse) | Limited mode immediately, and the reason is shown. **Revocation is only as fast as the lease**, which is why it's 30 days and not 365 by default. |
| `exp` reached (subscription) | Limited mode, with a Renew link |
| Update newer than `upd_until` | The updater won't offer it. If one is sideloaded anyway, the app runs in limited mode with "Your update plan covers versions up to X". |

### 2.6 Activation flows

**Online activation**

```
User            Renderer(activate page)    Main/license            Server (license.radixile.com)
 │ enter key ─────►│ ipc license:activate ──►│ fp = fingerprint()
 │                 │                          │ POST /v1/activate {key, fp.c[], device_name, os, app_ver, nonce}
 │                 │                          │──────────────────────────────►│ key_hash lookup, status ok?
 │                 │                          │                               │ seats_used < seats ? else 409 SEATS_FULL(list devices)
 │                 │                          │                               │ create activation, sign payload(kid)
 │                 │                          │◄────────── {license, srv_time}│
 │                 │                          │ verify sig + fp match + nonce
 │                 │                          │ write license.snlic, state.json
 │                 │                          │ post {entitlements, licenseFile} → server process
 │                 │◄──── {ok, edition} ──────│
```

**Offline activation (air-gapped PC)**

1. The app writes `activation-request.snreq`: `{key, fp.c[], nonce, app_ver}`, base64-encoded. It's also shown as a **QR code**.
2. On any device, the user opens `https://license.radixile.com/offline`, uploads the file or scans the QR code (the payload goes in the URL fragment and is POSTed by page JS, never put in the query string), and downloads `license.snlic`.
3. The user imports the file into the app via Activate → "I have a licence file".
4. Offline licences get `lease_exp = 365 d` (Agency or on request) and must be renewed the same way.

**Trial**

- `POST /v1/trial {fp}` returns a 14-day trial licence, one per fingerprint, with an IP rate limit. It needs one-time internet.
- Without internet the user gets **Demo** (in-memory engine, no publishing). This ties licensing to storage option (a) and means a trial can't be reset by deleting files.

**Transfer and deactivation:** `POST /v1/deactivate` from the app (frees the seat), or from the customer portal for a dead or stolen PC.

### 2.7 In-app modules (new)

**Main process: `electron/license/`**

| File | Role |
|---|---|
| `index.js` | Exports `getStatus()`, `activate(key)`, `activateFromFile(path)`, `makeOfflineRequest()`, `refreshIfDue()`, `deactivate()` |
| `fingerprint.js` | §2.3 |
| `verify.js` | Ed25519 and `kid` keyring |
| `store.js` | Licence file and HMAC'd `state.json` |
| `clock.js` | Clock-rollback guard |
| `client.js` | HTTPS to the licence server. Uses `net.fetch` so it honours system proxies, which matters for Indian corporate networks. |
| `keys.js` | Embedded public keys |

**Main process: other changes**

- `electron/preload.js` (new) exposes `window.socialNexus.license.*` and `connectivity.*`.
- `public/activate.html` (new) is shown by main before the dashboard when the status is `none`. It offers Activate / Start trial / Try demo / Import licence file.

**Server process: `services/license/`**

| File | Role |
|---|---|
| `entitlements.js` | Holds the verified payload received from main and re-verifies its signature and fingerprint hashes. Exports `has(feature)`, `limit(name)`, `mode()` (`full`, `limited`, `demo`). |
| `middleware/entitlements.js` | `requireFeature('autopilot')`, `checkLimit('workspaces_max', countFn)`. Used in `routes/workspaces.js` (create), `routes/content.js` (schedule), the publish handler, the autopilot and SEO planners, and the storage settings route. |

Limit checks are **also** performed inside the worker handlers (L5 spread). A patched route alone doesn't help.

### 2.8 Licence server (small hosted service, separate repo `radixile/license-server`)

**Stack:** Node 22 with Fastify (small and fast, JSON-schema validation built in) and Postgres (Neon, Supabase, or the same ₹-cheap VPS). It can run on Fly, Render, Railway or one VPS.

- The private key is in an env secret or KMS and never in the repo.
- Email goes through Resend or SES.
- **Payments** use the **Razorpay** webhook (GST invoices, UPI). Stripe can be added for exports.

**Endpoints**

| Endpoint | Purpose |
|---|---|
| `POST /v1/activate` | key, fp, device → licence \| 409 `SEATS_FULL` \| 403 `REVOKED`/`EXPIRED` |
| `POST /v1/refresh` | act, fp, app_ver → new licence (re-binds drifted fingerprint components) \| `revoked` \| `fp_mismatch` |
| `POST /v1/deactivate` | act plus a proof (signature over a nonce with the licence) |
| `POST /v1/trial` | fp → trial licence |
| `POST /v1/offline/activate` | .snreq → .snlic (also available as a portal page) |
| `GET /v1/updates/:channel/:platform/latest(-mac).yml` and `/files/*` | electron-updater feed. `Authorization: License <act>.<sig>`. Returns 403 when the release date is after `upd_until`. Binaries are on R2 or S3 with short-lived signed URLs. |
| `GET /v1/feeds/festivals?year=&region=` | **Verified** festival and observance data signed with the same key (feeds RP §5 `calendar_events`; fixes "lunar dates must be sourced") |
| `POST /v1/webhooks/razorpay` | Creates a licence and emails the key |
| `/portal/*` | Customer portal (magic-link login): licences, devices, deactivate, download installers, offline activation |
| `/admin/*` | Basic-auth plus IP allow-list: search, revoke, extend, change seats |

**Tables:** `customers`, `orders`, `licenses(key_hash, edition, seats, feat_json, status, exp, upd_until, max_transfers)`, `activations(license_id, fp_c1..c5, device_name, os, app_ver, first_seen, last_seen, lease_exp, status)`, `releases(version, channel, platform, released_at, sha512)`, `events` (audit).

---

## 3. Local data storage

### 3.1 Data directory

`app.setPath('userData', <base>/Social-Nexus)` is set explicitly in `electron/bootstrap/paths.js`. The base is `%APPDATA%` on Windows and `~/Library/Application Support` on macOS. Portable build: `<exeDir>/Social-Nexus-Data`.

```
Social-Nexus/
  config.json            bootstrap: {storage:{engine, sqlite:{file}, pg:{host,port,db,user,ssl, password_ref}}, memory:{snapshot}, port, lan:{enabled,tls}, updateChannel, uiDefaults}
  keys/dek.bin           DEK wrapped by safeStorage (DPAPI / Keychain)
  license/license.snlic  license/state.json
  db/social-nexus.db (+ -wal, -shm)
  media/<workspace>/<yyyy>/<mm>/…        uploads + AI images (fixes TR F27)
  backups/auto-YYYYMMDD-HHmm.db  backups/*.snbak
  snapshots/memory-latest.snap           (in-memory engine, if enabled)
  logs/main.log  logs/server.log         (electron-log, rotated)
  tls/                                   (LAN mode self-signed cert)
```

**Use `electron-log`** for logging. It's small and maintained, and writes per-OS log paths with rotation.

### 3.2 Secrets at rest (extends RP §8)

- **Desktop with SQLite or memory:** on first run, main generates a 32-byte DEK and stores it in `safeStorage.encryptString(DEK)` → `keys/dek.bin`. This uses DPAPI on Windows and Keychain on macOS. On every start main unwraps it and sends it to the server **over the `utilityProcess` MessagePort**. The server keeps it in memory only. `safeStorage` is only available in main, which is another reason for this split.
- `services/secrets/crypto.js` uses AES-256-GCM with the format `v1:kid:iv:tag:ct` (as in the RP). All `*_enc` columns use it: `oauth_apps.client_secret_enc`, `social_accounts.tokens_enc`, `ai_credentials.secret_enc`, `email_providers.config_enc`, `seo_site_connectors.config_enc`, and the PG password.
- **Postgres team mode:** a **team KEK** is derived from a *team passphrase* (scrypt, N=2^17). It wraps a **team DEK** stored in `app_config.team_dek_wrapped`. Each PC enters the passphrase once and caches the team DEK locally via `safeStorage`. Without this, a token encrypted on PC-A can't be decrypted on PC-B.
- **Optional full-DB encryption** (Phase 9): `better-sqlite3-multiple-ciphers` (SQLCipher-compatible, drop-in API, installed as an npm alias of `better-sqlite3` so Knex keeps working), with the key held by the DEK. It's off by default because it complicates support and recovery.
- **Session secret:** `app_config.session_secret_enc`, generated on first boot. `.env` is no longer used in packaged builds; it remains a dev fallback only.

### 3.3 Backups, export and import: `services/backup/`

| File | Role |
|---|---|
| `hotBackup.js` | SQLite: `db.backup(dest)` (online, consistent, through the better-sqlite3 handle exposed by the storage layer). A daily job plus a backup before every migration or engine switch. Retention: 7 daily, 4 weekly, 6 monthly. PG: shows the `pg_dump` command and recommends server-side backups; the app still offers `.snbak` export. |
| `exporter.js` / `importer.js` | `.snbak` is the **engine-neutral** format |

`.snbak` layout: a `tar.gz` built with the npm `tar` package (maintained by npm) containing:

```
manifest.json   {format:1, app_ver, schema_version (knex migration name), engine, created_at, tables:[{name, rows, sha256}], workspaces:[…]}
data/<table>.jsonl
media/…
secrets.json    secrets decrypted and re-encrypted with an export passphrase (scrypt + AES-GCM), because the DEK is machine-bound
```

- Scope: the whole install, or **one workspace** (agency hand-off of a client).
- Import runs `migrate.latest()` on the target, inserts in FK order in batches of 500 inside a transaction per table, remaps IDs when importing one workspace into an existing database, then resets PG sequences with `setval`.
- UI: Settings → Data & Backup offers Back up now, Restore, Export workspace, Import, the backup folder location, and a schedule.

### 3.4 Legacy migration

`services/legacyImport.js`, as in RP Phase 1, extended to look for old data in this order:

1. `%APPDATA%\NEXUS\nexus.db` and `~/Library/Application Support/NEXUS/nexus.db`: the current Knex database (`config/db.js` already uses `NEXUS_DATA_DIR`).
2. `%APPDATA%\NEXUS\sessions.db`: discarded.
3. `<installDir>/resources/app/data/nexus.db`: the old `services/database.js` path.
4. Dev: `D:\Social\nexus\data\nexus.db`.

Rules:

- If (1) exists and the new `Social-Nexus/` folder doesn't, **move** the folder (atomic rename when on the same volume, otherwise copy, verify, and keep the old one as `NEXUS.migrated-<date>`).
- Then run `migrate.latest()` and the RP's `legacy_import_v2`.
- Guard with `app_config.legacy_import_v2` and back up first.
- `services/database.js` and `services/legacyMigration.js` are deleted after Phase 1.
- `better-sqlite3` remains, because it's the only driver now.

---

## 4. Storage engines

### 4.1 The three options

| Engine | Implementation | Intended use | Persistence |
|---|---|---|---|
| **memory** | better-sqlite3 `:memory:` (Knex pool `min:1, max:1`) | Demo (no licence), trade-show kiosk, CI and tests (already used in `tests/helpers/db.js`), "try without touching my data" | Lost on exit. **Optional snapshot:** every N minutes and on quit, `db.serialize()` is encrypted with the DEK and written to `snapshots/memory-latest.snap`, then restored with `new Database(buffer)` on start. "Keep my data" converts to the SQLite engine by writing the serialized buffer to `db/social-nexus.db`. |
| **sqlite** (default) | better-sqlite3 file, WAL, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL` | Individual users and single-PC agencies | File |
| **postgres** | `pg` driver, user-supplied server (localhost or LAN), PG 13+ | Agencies with several PCs, or anyone who wants server-grade storage and backups | Server |

Because the in-memory engine is just SQLite, there is **one dialect fewer** to support. Memory and SQLite share every query, FTS, and queue path. That's the main reason to implement memory this way rather than with a JS map store.

### 4.2 Consolidate on better-sqlite3

- Knex's `client: 'better-sqlite3'` is supported in Knex 3. better-sqlite3 is faster, has prebuilt Electron binaries for win-x64, darwin-arm64 and darwin-x64, and ships with FTS5, `RETURNING`, `.backup()` and `.serialize()`.
- **Remove** `sqlite3` and `connect-sqlite3`. Replace the session store with **`connect-session-knex`**, which works on every engine with one store and drops `sessions.db`.
- `asarUnpack` then only needs `node_modules/better-sqlite3/**` and `node_modules/bindings/**`.

### 4.3 Abstraction: `services/storage/`

| File | Role |
|---|---|
| `index.js` | `createStorage(cfg)` → `{ knex, engine, caps, queue, search, sessionStore(session), backup, close }` |
| `config.js` | Reads `config.json`, then env (`DB_CLIENT`, `DATABASE_URL` stay as dev and CI overrides). Replaces the internals of `config/db.js`; `config/db.js` stays as a thin shim for `knexfile.js`. |
| `engines/memory.js`, `engines/sqlite.js`, `engines/postgres.js` | Knex config plus capabilities |
| `queue/sqliteQueue.js`, `queue/pgQueue.js` | Job claim strategies |
| `search/sqliteFts.js`, `search/pgFts.js` | Full-text search |
| `copy.js` | Engine-to-engine copy (reuses the backup exporter and importer streams) |

`caps` is `{persistent, multiWriter, skipLocked, fts:'fts5'|'pg', advisoryLocks, jsonb}`.

`services/knex.js` becomes `module.exports = require('./storage').get().knex` so the existing `repos/*` factories don't change.

**Portability rules for migrations**

These are checked by running the Jest matrix on memory, file SQLite and PG (CI service container):

- Epoch timestamps stored as `bigint`. On PG, register `pg.types.setTypeParser(20, v => parseInt(v, 10))`, otherwise int8 comes back as a string.
- `t.json()` for JSON. Repos parse with the existing `parseJson` helper.
- Inserts use `.returning('id')` with the existing `rows[0]?.id ?? rows[0]` idiom. Move it into a helper, `repos/_util.js insertId()`.
- No raw SQL outside `if (knex.client.config.client === 'pg')` blocks inside migrations, which are only used for FTS, triggers and indexes.
- Booleans are stored as integers on SQLite. Normalise in repos.
- Case-insensitive email: store it lower-cased. Don't rely on `ILIKE`.

### 4.4 Job queue per engine

| | SQLite and memory | Postgres |
|---|---|---|
| Writers | One server process is the single writer. The worker runs inline (RP §5). | Many app instances (team mode) |
| Claim | One statement: `UPDATE jobs SET status='running', locked_by=?, locked_until=? WHERE id=(SELECT id FROM jobs WHERE status IN('queued','retrying') AND run_at<=? AND (requires_network=0 OR network_scope IN (…up…)) ORDER BY priority, run_at LIMIT 1) RETURNING *`. better-sqlite3 serialises it. | `SELECT … FOR UPDATE SKIP LOCKED LIMIT 5` in a transaction, then UPDATE (Knex `.forUpdate().skipLocked()`) |
| Periodic planners (autopilot daily plan, SEO pulls, token refresh) | Run directly | Guarded by `pg_try_advisory_lock(hashtext('planner:autopilot'))`, so only one PC plans. All PCs can execute publish jobs, but see the next row. |
| Network-scoped jobs in team mode | n/a | Prefer the job's `preferred_instance` (the PC that owns the OAuth tokens) for 2 minutes, then any instance. Tokens are readable everywhere through the team DEK. |
| Reaper | Requeue where `locked_until < now` | Same, plus the `instances` heartbeat table |

### 4.5 Full-text search

| Engine | Implementation |
|---|---|
| SQLite and memory | FTS5 virtual table `content_fts(title, body, tags)` with `tokenize='trigram'`, kept in sync by triggers on `content_items`, `content_variants` and `templates`. **The trigram tokenizer handles Devanagari, Tamil and other Indic scripts**, which `unicode61`/porter stemming does poorly, and it gives substring search. Queries shorter than 3 characters fall back to `LIKE`. |
| Postgres | A generated column `search tsvector = to_tsvector('simple', …)` with a GIN index, plus a **`pg_trgm`** GIN index on `title`/`body` for Indic scripts and fuzzy matching. If the `pg_trgm` extension isn't allowed on the user's server, degrade to tsvector only and warn in the storage health check. |
| API | Unchanged across engines: `search.query(workspaceId, q, {types, limit})` |

### 4.6 Switching engines: Settings → Storage (Agency gets Postgres)

The wizard runs these steps:

1. Choose the target engine and enter its details.
2. **Test connection.** For PG this checks version ≥ 13, `CREATE` privilege, the `pg_trgm` extension, and that the database is empty or is a Social-Nexus database (`app_config.instance_id`).
3. Automatic backup of the source.
4. `migrate.latest()` on the target.
5. `storage/copy.js` streams each table in FK order, compares row counts and per-table SHA-256 checksums, and resets sequences.
6. Write `config.json`.
7. Main restarts the utility process.
8. The source stays untouched, so the user can roll back.

Other details:

- **Joining an existing PG** (second PC in a team) skips the copy and asks for the team passphrase (§3.2).
- Every switch is logged in `storage_migrations`.
- Moving PG back to SQLite uses the same path.

---

## 5. Cross-platform packaging, updates and process model

### 5.1 electron-builder targets (changes to `package.json` `build`)

**Identity**

- `productName: "Social-Nexus"`
- Keep `appId: "com.radixile.nexus"`. Changing it breaks NSIS upgrade-in-place and the macOS bundle-ID continuity of Keychain items.
- `artifactName: "Social-Nexus-${version}-${os}-${arch}.${ext}"`

**Windows**

- `nsis` x64, one-click `false`, per-user install by default (no admin prompt, `perMachine:false`). The `portable` target is kept for Individual only, with data next to the exe.
- arm64 Windows is deferred until better-sqlite3 prebuilds are checked.

**macOS**

- Targets `dmg` and `zip` (zip is **required by the electron-updater mac flow**), `arch: ["arm64","x64"]`.
- Separate per-arch artifacts are preferred over `universal`: half the download size, and native-module merge issues are avoided. Universal can be added later via `@electron/universal`.
- `hardenedRuntime: true`, `gatekeeperAssess: false`, `entitlements: build/entitlements.mac.plist` (`com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory`, `network.client`, `network.server` for LAN mode), `notarize: true` (electron-builder 26 uses `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`), `category: public.app-category.business`.
- **macOS builds must run on macOS** (CI `macos-14` runner) because native modules and notarisation require it.

**Other changes**

- `linux`: keep it, but it's unsupported or best-effort.
- Remove `resources/node/node.exe` and the `findNodeExe()` logic.
- `afterPack` hook: `@electron/fuses`: `RunAsNode: false`, `EnableNodeOptionsEnvironmentVariable: false`, `EnableNodeCliInspectArguments: false`, `EnableEmbeddedAsarIntegrityValidation: true`, `OnlyLoadAppFromAsar: true`, `EnableCookieEncryption: true`, `GrantFileProtocolExtraPrivileges: false`.
- Set `asar: true` with `asarUnpack` only for `better-sqlite3`.
- `files`: whitelist explicitly. The RP C3 additions are already present. Exclude `tests/`, `docs/`, `scratch/` and `data/`.
- Before packaging, the build runs `javascript-obfuscator` over `electron/license/**` and `services/license/**` into a staging directory (`build/obfuscate.js`).

### 5.2 Code signing

| Platform | How |
|---|---|
| **Windows** | OV/EV Authenticode keys must now live on an HSM. Options: **Azure Trusted Signing** (cheapest, electron-builder 26 `win.azureSignOptions`, but *check that an Indian LLP is eligible*) or a cloud-HSM certificate (SSL.com eSigner, DigiCert KeyLocker) through a `win.sign` custom script. Sign the exe, uninstaller and installer. SmartScreen reputation builds up over time. EV no longer gets instant reputation. |
| **macOS** | Developer ID Application certificate (Apple Developer Program, US$99/yr, for the Radixile org; requires a D-U-N-S number), plus hardened runtime and notarisation with stapling. |
| CI | GitHub Actions matrix: `windows-latest` and `macos-14` (arm64, cross-building x64 with `--x64`, after checking better-sqlite3 prebuilds) |

### 5.3 Auto-update (`electron/updater/index.js`, `electron-updater`)

- `provider: generic`, URL `https://license.radixile.com/v1/updates/${channel}/${platform}`.
- `autoUpdater.requestHeaders = {Authorization: 'License ' + token}`, which gates updates by licence and `upd_until` (§2.8).
- Channels: `stable` and `beta`, chosen in Settings, with beta for Agency only if desired.
- Behaviour: check on start and every 6 h when online; download in the background; "Restart to update" toast. Before installing, the server must be stopped cleanly and a hot backup taken.
- NSIS differential updates come from blockmaps. macOS updates require the signed zip.
- **Offline update:** the portal offers the full signed installer. The user runs it on the offline PC, and the OS verifies the signature. The app checks `upd_until` against its own build date (embedded at build time) on first launch.

### 5.4 Process model decision: `utilityProcess` + HTTP (keep Express, drop node.exe)

- **Replace** `cp.spawn(nodeExe, [server/index.js])` with `utilityProcess.fork(path.join(app.getAppPath(),'server/index.js'), [], {serviceName:'social-nexus-server', stdio:'pipe', env:{NEXUS_DATA_DIR, …}})`.
  - It's the same Electron Node ABI, which fixes A1.
  - It works on macOS.
  - It's compatible with `RunAsNode: false`.
  - It gives a MessagePort for secrets and licence data.
- **Why not run Express inside main?** A crash or hang in a route (AI calls, image processing) would freeze the window and tray. Isolation plus supervisor restart is worth the cost.
- **Why not move fully to IPC?** Four reasons:
  1. OAuth callbacks need a real loopback HTTP endpoint.
  2. LAN host mode needs HTTP for teammates' browsers.
  3. The SPA already uses `fetch` across 4,400 lines.
  4. SSE works fine.
  
  IPC (preload → main) is used only for OS features: licence, file pickers, save dialogs, open external, connectivity, restart.
- `server/index.js` changes:
  - At start, `process.parentPort?.once('message', init)` waits for `{dek, licenseFile, port, mode}` before running `bootstrap()`.
  - When run standalone (`npm start`), it uses the dev path: `NEXUS_MASTER_KEY` env and a **dev licence signed by a dev key that production builds don't trust**.
  - Remove the `open` auto-browser path in packaged mode.
- Supervisor in main: health probe `GET /__health` returns `{app:'social-nexus', instanceNonce}`. This replaces the current "port in use → Try to Connect", which could attach to a *foreign* server. Restart uses backoff (1 s, 5 s, 30 s) and shows a dialog after 3 failures with "Open logs".

### 5.5 Local server hardening

- **Port:** default 3000, stored in `config.json`. OAuth redirect URIs must match exactly, so the port is *stable*. If it's busy, offer to change it, and the R2 guide then shows the new callback URLs to re-register. All `*_CALLBACK_URL` values become `${req.app.locals.publicOrigin}/auth/<p>/callback`, built in one helper, `services/platforms/urls.js` (fixes TR F2).
- **`middleware/hostGuard.js` (new):** reject requests whose `Host` isn't `127.0.0.1:<port>`, `localhost:<port>` or a configured LAN hostname (DNS-rebinding defence). Reject state-changing requests whose `Origin` isn't allowed. Replace `cors()` with an allow-list.
- The CSRF double-submit and rate limits from RP §8 stay as planned.

### 5.6 Team access across PCs (TR F36): two Agency-only options

| | **LAN host mode** | **Postgres team mode** |
|---|---|---|
| Setup | One PC is the host. Settings → Team → "Allow other computers on my network". Binds `0.0.0.0`, generates a self-signed TLS certificate (`selfsigned` package) shown with its fingerprint, and adds the firewall rule at that moment through an elevated `netsh` call (Windows) or the macOS firewall prompt. | Every PC installs Social-Nexus, chooses Postgres, enters the server details and the team passphrase |
| Teammates use | A browser at `https://host-pc:3000` (no install needed) | Their own desktop app |
| Storage | Any engine (SQLite is fine) | PG |
| Offline per PC | No; it depends on the host PC being on | Yes for local drafting with Ollama only if PG is reachable; PG is the dependency |
| Licence counting | `users_max` (named users) | `seats` (activated machines) plus `users_max` |
| Invite links (F36) | Use the LAN origin instead of localhost | Not needed; users exist in the shared database |

**Recommendation:** ship LAN host mode first. It's simpler, has no secret-sharing problem, and SQLite works. Postgres team mode comes after.

---

## 6. Feature requests R1–R5

### 6.1 R1: Simple mode

- `user_settings.ui_mode` (`simple` or `full`, default `simple` for personal organisations).
- `public/js/core/nav.js` is a nav registry: `{id, label, icon, modes:['simple','full'], feature?:'autopilot', role?}`. Entries are filtered by mode, by entitlement (from `GET /api/me/capabilities`, which merges RBAC, edition and connectivity), and by role.
- Simple nav: Home · Create Post · Calendar · Accounts · Settings, with "More tools ▸" for the rest.
- **One editor:** the RP composer becomes the only editor. AI Generate is an in-editor panel, and Calendar → New opens the same editor (fixes F24, F20, F21).
- This begins the RP §7 module split: `public/js/pages/home.js`, `compose.js`, `calendar.js`, `accounts.js`.

### 6.2 R2: Guided social-account connection

- `services/platforms/catalog.js` holds one entry per platform: `{key, name, portalUrl, createAppUrl, products[], scopes[], reviewRequired, steps:[{title, body, link?, copy?:'callbackUrl'}], testCredentials(cred) }`. These are stored as data, not code, so a later version can update them from the licence-server feed when portals change.
- Routes in `routes/platforms.js` (new):
  - `GET /api/platforms`
  - `GET /api/platforms/:p/guide`, which returns the computed callback URL and port
  - `POST /api/platforms/:p/credentials`, which stores into the RP `oauth_apps` table (encrypted, admin-only; fixes F16)
  - `POST /api/platforms/:p/test`, for example a Meta `client_credentials` app-token call or LinkedIn `/oauth/v2/accessToken` with a dummy code to tell "bad secret" apart from "bad code"
  - `GET /auth/:p/start`
- The UI is a stepper wizard: What you need → Create app (link) → Copy callback URL (copy button) → Paste ID and secret → **Test** → Connect → Choose page/account (Meta page picker, RP C7) → Done.
- It is offline-aware: the steps can be read offline, but Test and Connect are disabled.
- It also fixes F17, F18, F19 and F42 (no `.env` jargon).

### 6.3 R3: Autopilot posting

Modules: `services/autopilot/{planner,themes,compose,safety}.js`, `services/facts/{sync,sources/wikimediaOnThisDay,sources/wikidataBirthdays,sources/festivalFeed,sources/ics}.js`, and `routes/autopilot.js`.

**Facts come from data, not from the model**

| Theme | Source |
|---|---|
| Festival today | `calendar_events`, fed by the **Radixile signed festival feed** (§2.8) plus user ICS imports and edits |
| This day in history | Wikimedia Feed API `onthisday/events/MM/DD`. Check language coverage; English is certain, Hindi needs checking. |
| Famous birthdays | Same API (`onthisday/births`), plus an optional Wikidata SPARQL query filtered by country of citizenship = India (Q668) for Indian relevance |
| Custom keywords | The user's keywords, plus SEO keywords from R5 |

- `facts/sync.js` (job `facts_sync`, daily when online) caches the **next 30 days** into `fact_items`, so autopilot works offline.
- **Grounding:** the prompt includes only the selected `fact_items` (title, year, summary, URL) and the brand kit, and tells the model "use only these facts".
- **`safety.js` post-check:** every 4-digit year and proper name in the output must appear in the source facts or the brand kit, otherwise the output is regenerated once and then held for review. It also strips Markdown (F22). Death anniversaries and solemn days (`fact_items.sensitivity`) get a respectful tone and no emoji. There's a blocklist and a duplicate check against the last 60 days of posts.

**Flow**

1. A daily planner job `autopilot_plan` runs at 00:05 in the workspace timezone (advisory-locked on PG).
2. For each enabled rule: choose the theme by priority. *Festival > birthday > history > keywords* is the default and can be changed.
3. Create an `autopilot_runs` row with `unique(rule_id, run_date, theme)` for idempotency.
4. Run the AI pipeline (gateway: draft, per-platform variants, hashtags with SEO keywords).
5. Create the `content_item` and `content_variants` with `origin='autopilot'`.
6. Apply the review policy:
   - `auto`: go to `scheduled` and enqueue publish jobs with `valid_until` = end of day.
   - `review`: go to `in_review` and notify.
   - `auto_after`: go to `in_review` and enqueue a `autopilot_autoapprove` job after N hours.
7. After publishing: a daily summary notification and email. A failure sends an alert.
8. Controls: a **one-click Pause** per rule and per workspace (`paused_until`), a history log page, and `max_per_day`.
9. This **retires** the in-memory `/api/tools/recurring` (`routes/tools.js` L254–273).

### 6.4 R4: Rename and branding

- `config/brand.js` (new, shared by main, server and renderer through `/api/brand`): `{productName:'Social-Nexus', fullName:'Social-Nexus by Radixile Technology Solutions', company:'Radixile Technology Solutions LLP', support:'support@radixile.com'}`.
- Replace hard-coded "NEXUS" in:
  - `electron/main.js`: `APP_NAME`, the window title, tray and dialogs
  - `electron/splash.html`
  - `public/index.html` (L6, L22, L139, L815, L951)
  - `login.html`, `landing.html`, `help.html`, `setup.html`, `invite.html`
  - the `server/index.js` banner
  - `package.json`: `productName`, `description`, `nsis.shortcutName`, `artifactName`
  - `build/installer.nsh`: paths and firewall rule name
  - `NEXUS-DEV-GUIDE.md` and the install docs
- Keep `appId`, and migrate `userData` (§3.4).

### 6.5 R5: Automated SEO

Modules: `services/seo/{gsc,crawler,keywords,meta,connectors/{wordpress,shopify,manual},report}.js` and `routes/seo.js` (extended).

| Job type (in `jobs`) | Schedule | What it does |
|---|---|---|
| `seo_gsc_pull` | daily | Google Search Console `searchanalytics.query` (dimensions query, page, date) into `seo_rank_snapshots`. **Real positions, clicks and impressions.** GSC data lags about 2–3 days. Uses Google OAuth from `oauth_apps` (same Google app as YouTube and GBP, with the `webmasters.readonly` scope). |
| `seo_crawl` | weekly | Fetch the sitemap and pages (respecting robots.txt, 1 request per second), store title, meta, H1 and a content hash in `seo_pages` |
| `seo_keyword_research` | weekly | Seeds: brand kit, site pages, GSC queries ranked 5–20 ("striking distance"). Expansion: Google Autocomplete suggestions (unofficial endpoint; can break) plus the AI gateway for clustering and intent. Optional paid provider (DataForSEO) if the user adds a key. |
| `seo_meta_generate` | after crawl | AI writes title and description per page against the target keyword cluster, and validates length (≤ 60 and ≤ 155 characters) → `seo_meta_suggestions` |
| `seo_meta_apply` | when policy = auto | Writes through `connectors/wordpress.js` (REST API with an Application Password; Yoast/RankMath meta fields) or Shopify. With the `manual` connector, it produces an export or notification instead. "No human intervention" is only possible with a CMS connector. |
| `seo_report` | weekly or monthly | HTML report, including rank change, stored and optionally emailed |
| Autopilot integration | — | Top keyword clusters feed `autopilot_rules.seo_site_id`, so captions and hashtags use them |

The existing manually typed "tracked keywords" (`seo_keywords`) become seeds. Typed positions are no longer used as rank data.

---

## 7. Data model additions (on top of RP §3)

| Table | Key columns | Notes |
|---|---|---|
| `jobs` (alter) | `+ requires_network`, `network_scope`, `blocked_reason`, `valid_until`, `late_policy`, `origin`, `preferred_instance` | Outbox (§1.3) |
| `app_config` (RP) keys | `instance_id`, `session_secret_enc`, `team_dek_wrapped`, `team_kdf_params`, `legacy_import_v2`, `schema_engine_origin`, `ui_default_mode` | |
| `instances` | `id` (uuid), `hostname`, `os`, `app_ver`, `role`, `last_heartbeat`, `license_act_hash` | PG team mode and reaper |
| `storage_migrations` | `id`, `from_engine`, `to_engine`, `started_at`, `finished_at`, `row_counts` json, `checksums` json, `status`, `error` | |
| `connectivity_events` (optional, capped) | `scope`, `state`, `at` | For the outbox UI and support |
| `autopilot_rules` | `workspace_id`, `name`, `enabled`, `themes` json (ordered), `keywords` json, `languages` json, `social_account_ids` json, `post_time_local`, `days_of_week`, `max_per_day`, `review_policy` (`auto`/`review`/`auto_after`), `auto_approve_after_min`, `tone`, `ai_override` json, `include_image`, `seo_site_id`, `blocklist` json, `paused_until`, `next_run_at`, `created_by` | |
| `autopilot_runs` | `rule_id`, `workspace_id`, `run_date` (local), `theme`, `fact_item_ids` json, `content_item_id`, `ai_run_id`, `status` (`planned`/`drafted`/`awaiting_review`/`scheduled`/`published`/`skipped`/`failed`), `skip_reason`, `error`; **unique(rule_id, run_date, theme)** | |
| `fact_sources` | `key`, `enabled`, `lang`, `region`, `last_synced_at`, `etag` | |
| `fact_items` | `source_key`, `kind` (`festival`/`event`/`birth`/`death`/`observance`), `month`, `day`, `year`, `title`, `summary`, `lang`, `region`, `url`, `sensitivity`, `fetched_at`, `hash` (unique); index (`kind`, `month`, `day`) | |
| `seo_sites` | `workspace_id`, `url`, `gsc_property`, `sitemap_url`, `auto_apply_meta` bool, `report_schedule` | |
| `seo_site_connectors` | `site_id`, `kind` (`wordpress`/`shopify`/`manual`), `config_enc`, `verified_at` | |
| `seo_pages` | `site_id`, `url`, `title`, `meta_description`, `h1`, `content_hash`, `last_crawled_at`, `status_code` | |
| `seo_meta_suggestions` | `page_id`, `keyword_cluster`, `title`, `description`, `status` (`pending`/`applied`/`rejected`/`failed`), `applied_at`, `applied_via` | |
| `seo_keywords` (alter existing) | `+ site_id`, `source` (`gsc`/`autocomplete`/`ai`/`user`), `cluster`, `intent`, `volume_est` | |
| `seo_rank_snapshots` | `site_id`, `date`, `query`, `page`, `position`, `clicks`, `impressions`, `ctr`, `source` | Index (`site_id`, `query`, `date`) |
| `seo_reports` | `site_id`, `period_start`, `period_end`, `html`, `summary` json | |
| `user_settings` (alter) | `+ ui_mode` | |
| `content_items` (alter) | `+ origin` (`user`/`autopilot`/`import`) | |

**Deliberately *not* in the database**

- Licence state is per machine. It lives in `DATA_DIR/license`, so a shared PG database can't leak or duplicate a licence.
- Storage configuration is bootstrap data. It lives in `config.json`, because the database location can't be stored inside the database.

---

## 8. Phased roadmap (merged with RP §9)

Each phase is shippable on its own.

| Phase | Scope | Acceptance criteria |
|---|---|---|
| **0. Stabilise** *(in progress)* | RP C1–C9 and the TR 🔴 items (F33, F41, F32, F48, F45, F37, F16, F9/F44, F43, F3, F2) | As in the RP, plus the TR 🔴 list is closed |
| **0.5 Branding (strings only)** | R4: `config/brand.js`, all UI, window and tray strings, and the installer shortcut name. **Not** `productName` yet, because that moves the data path. | Every screen and title says "Social-Nexus by Radixile Technology Solutions". The data path is unchanged. |
| **1. Single schema + storage layer** | RP Phase 1, plus: `services/storage/*`; better-sqlite3 as the only driver; remove `sqlite3` and `connect-sqlite3`; `connect-session-knex`; memory engine (no snapshot yet); `config.json`; pg type parser; FTS migrations for both engines; Jest matrix (memory, file, pg); `legacyImport` covering all of §3.4's paths; pre-migration hot backup | `npm test` passes on all three engines. A fresh install has no `sessions.db` and no `.env` dependency. An old `%APPDATA%\NEXUS\nexus.db` imports exactly once. Search finds Hindi text. |
| **2. Security + tenancy v2** | RP Phase 2, plus: DEK via `safeStorage` in main sent over MessagePort, `hostGuard`, CORS allow-list, the firewall rule removed from `installer.nsh` | No plaintext secrets (grep the database). A request with a forged `Host` header gets 403. |
| **2A. Desktop platform** | `utilityProcess` supervisor, `preload.js`, removal of `node.exe`, fuses, `/__health` handshake, `electron-log`, `productName` → Social-Nexus with the userData move, macOS build (arm64 and x64) with signing and notarisation, Windows signing, CI matrix, electron-updater on a *public* feed for now, launch-at-login, catch-up on resume | Clean Windows 11 and macOS 14 (Apple Silicon and Intel) installs boot with **no Node.js installed**. `codesign --verify` and `spctl -a` pass. The Windows signature is valid. An existing NEXUS user upgrades in place and keeps their data. A modified `app.asar` refuses to start. |
| **2B. Simple UX + guided connect** (R1, R2) | Nav registry, simple mode, single editor, `services/platforms/catalog.js`, connect wizard with Test | A first-time user connects LinkedIn using only the in-app guide. The simple menu shows 5 items. F17, F18, F19, F24 and F42 are closed. |
| **3. AI gateway** | RP Phase 3, plus the offline-aware resolver (§1.4) | With the network unplugged, Generate uses Ollama immediately (under 1 s to start) and the UI says so |
| **4. Variants + scheduler + offline outbox** | RP Phase 4, plus the §1.3 columns, the connectivity service, the Outbox page, `late_policy`, the status pill, the SQLite and PG queue adapters | Posts scheduled while offline publish within 2 minutes of reconnecting, with no double posts and no retries consumed. A late post goes to `hold_for_review`. Two PG workers never claim the same job. |
| **L. Licensing** (the licence server is built in parallel from 2A; the in-app part ships **before the first paid release**) | Licence server (§2.8) with Razorpay; `electron/license/*`; `services/license/*`; activate page; trial and demo; lease and grace; offline `.snreq`/`.snlic`; entitlement checks in routes and workers; the updater moves behind the licence; obfuscation in the build | A key activates on PC-A, and copying the data dir to PC-B gives "different computer". Swapping 1 disk still validates. 31 days offline gives limited mode with export working. Revocation takes effect at the next refresh. Setting the clock back 30 days is detected. The 6th activation on a 5-seat licence returns `SEATS_FULL` with a device list. |
| **5. Agency workflow + team** | RP Phase 5, plus **LAN host mode** (TLS, firewall prompt, LAN invite links, `users_max`), then **Postgres team mode** (team DEK, `instances`, advisory-locked planners, the Storage switch wizard) | A teammate on another PC can log in over HTTPS on the LAN. SQLite → PG → SQLite round-trips with matching checksums. A second PC joining PG can decrypt tokens after entering the team passphrase. |
| **6. Email** | RP Phase 6 (outbox-aware `email_batch`) | As in the RP, plus offline sends queue and resume |
| **7. Autopilot** (R3) | Facts sync and cache, rules, planner, safety checks, review policies, summary and pause, signed festival feed, retire `/tools/recurring` | Over 7 days the rule posts the correct festival or birthday with a source link. Offline at 00:05, drafts are made with Ollama and posted when back online, or skipped after `valid_until`. Pause stops everything within 1 minute. A hallucinated year is caught and the post held. |
| **8. SEO automation** (R5) | GSC OAuth and pull, crawler, keyword research, meta generation, WordPress connector, reports, autopilot keyword feed | A connected WordPress site gets meta updates with no clicks. The rank chart matches GSC. A weekly report is generated. |
| **9. Ongoing** | RP Phase 7, plus memory-engine snapshots, optional SQLCipher, universal mac build, Windows arm64, bytenode experiment | — |

---

## 9. Risks

1. **Piracy can't be fully prevented** (§2.1). The commercial defence is server-side value and updates. Budget support time for false positives from hardware changes; the k-of-n rule plus portal self-service transfer is the mitigation.
2. **Code-signing logistics.** Azure Trusted Signing eligibility for an Indian LLP, Apple D-U-N-S enrolment, and HSM-based certificates all take weeks. **Start now.** Unsigned macOS builds are effectively not installable for normal users.
3. **Desktop-only scheduling.** Posts don't go out while the PC is off. Users must understand this. LAN-host or PG team mode only helps if one machine stays on. Revisit a small cloud relay later if needed.
4. **Platform API constraints.**
   - Instagram publishing needs a **public image URL**, which conflicts with local-only media. Options: upload through the FB Page photo endpoint and reuse that URL, or a user-configured bucket (R2/S3/Cloudinary). Needs a decision.
   - Meta, LinkedIn and TikTok app review for each user's *own* developer app is a heavy burden on non-developers. R2 helps but can't remove it.
5. **Fact-source coverage.** Wikimedia "On this day" may not cover Hindi or other Indian languages. India-specific birthdays need Wikidata queries. Festival dates need a curated source, which Radixile must own and keep up to date.
6. **Engine drift.** Three engines multiply test surface. Mitigation: memory is SQLite (two dialects only), the CI matrix is mandatory, and the portability rules in §4.3 are enforced.
7. **The ABI issue (A1)** may already break current Windows packaged builds. Check this before the next release.
8. **Team-mode key management.** A lost team passphrase means encrypted tokens are unrecoverable; users must reconnect accounts. Make this explicit in the UI.
9. **DPDP (India) compliance.** Fingerprints are hashed and licence telemetry is minimal, but the licence server stores customer personal data, so it needs a privacy notice and retention policy.

---

## 10. Open questions for the user

1. **Pricing model:** perpetual licence plus 1 year of updates (`upd_until`), or annual subscription (`exp`)? This drives the limited-mode rules and the server design.
2. **Edition limits:** confirm Demo / Trial / Individual / Agency and the numbers in §2.2 (seats, workspaces, users, autopilot and SEO caps), and whether Individual includes publishing to every platform.
3. **Offline tolerance:** is a 30-day lease (7-day check-in) acceptable? Should Agency be able to request 365-day air-gapped licences?
4. **Social developer apps:** confirm that each customer registers their *own* Meta, LinkedIn and other apps. The alternative is a Radixile-owned app per platform, which means far easier onboarding but a central secret and a relay server, against the "no central secret" decision. This affects licensing: a Radixile relay would be a strong server-side anti-piracy lever.
5. **Team mode priority:** is LAN host mode (browser teammates) enough for v1, with Postgres team mode later?
6. **Autopilot default:** fully automatic with a daily summary and pause (the TR proposal), or review-before-post by default?
7. **SEO target sites:** WordPress first? Is Google Search Console access acceptable for each site?
8. **Instagram media hosting:** OK to require a user-configured storage bucket, or should we use the Meta-upload workaround (risk 4)?
9. **Licence server hosting and payments:** Razorpay and a small VPS or Fly.io under Radixile? Who operates support and refunds (revocation)?

### Critical files for implementation
- D:\Social\nexus\electron\main.js (`startServer`/`findNodeExe` → `utilityProcess` supervisor, licence and keystore bootstrap, rename and userData migration)
- D:\Social\nexus\server\index.js (`parentPort` init, session store, `hostGuard`/CORS, entitlements, bootstrap order)
- D:\Social\nexus\config\db.js and D:\Social\nexus\services\knex.js (→ `services/storage/*` engine factory)
- D:\Social\nexus\services\scheduler.js (→ network-aware jobs worker and planners for autopilot, SEO and facts)
- D:\Social\nexus\package.json (electron-builder targets, signing, fuses, `asarUnpack`, dependency consolidation) and D:\Social\nexus\build\installer.nsh
- Also: D:\Social\nexus\services\aiHelper.js (offline-aware gateway), D:\Social\nexus\routes\auth.js (callback-URL helper, `oauth_apps`), D:\Social\nexus\tests\helpers\db.js (three-engine matrix)
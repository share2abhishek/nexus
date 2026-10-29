# Social-Nexus Runbooks (L2 / L3 / Release)

Companion to [`technical-guide.md`](technical-guide.md) (architecture, config, tables) and [`support-handbook.md`](support-handbook.md) (L1 scripts). Each runbook: **Symptoms → Checks → Fix → Escalate**. "From L1" names the handbook section that hands the case over.

Conventions
- Paths are on the customer PC unless stated. `%APPDATA%\Social-Nexus` = data folder; `<install>` = install folder (find it from the Start-menu shortcut → Open file location).
- `localhost:3000` assumes the default port.
- Admin panel = `https://license.radixile.com/admin`. "(owner)" = needs the owner role.
- Never ask the customer for passwords, full API keys, `.env`, `nexus.db` or `sessions.db` (guide §13). Remote-session commands below are run by the customer or by you in a screen-share, never by collecting those files.

Useful snippets (PowerShell on the customer PC)

```powershell
# Health and licence state (no login needed)
Invoke-RestMethod http://localhost:3000/__health

# Last 80 log lines
Get-Content "$env:APPDATA\Social-Nexus\logs\server.log" -Tail 80

# Decode the stored licence file (contains no secrets: licence id, dates, hashed hardware ids)
$s = Get-Content "$env:APPDATA\Social-Nexus\license\license.json" -Raw | ConvertFrom-Json
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s.file.payload)) | ConvertFrom-Json
$p | Select-Object lic,type,edition,device,issued_at,server_time,lease_until,refresh_after,expires_at,updates_until
"stored device_id: $($s.device_id)   last_time: $($s.last_time)   last_error: $($s.last_error)   revoked: $($s.revoked)"
# epoch → local time
[DateTimeOffset]::FromUnixTimeSeconds($p.lease_until).ToLocalTime()
```

---

## Index

| # | Runbook | # | Runbook |
|---|---|---|---|
| R1 | App won't start / blank window | R13 | "Checking your licence…" never ends |
| R2 | "Modified" licence on a genuine install | R14 | Database backup / restore / move to a new PC |
| R3 | Licence stuck "Needs internet" / clock wrong | R15 | Migrating from the old NEXUS data folder |
| R4 | Reinstall or new PC (deactivate / transfer) | R16 | Switching to Postgres |
| R5 | Seats full | R17 | Licence server outage |
| R6 | Coupon problems | R18 | Rotating the licence signing key |
| R7 | Refund | R19 | Issuing a release |
| R8 | Posts failing per platform | R20 | Rolling back a bad release |
| R9 | "Missed" posts | R21 | Razorpay webhook failures / paid but no licence |
| R10 | Ollama not detected / slow | R22 | Licence server deploy / config change |
| R11 | AI key errors (quota, model retired) | R23 | Data deletion request (DPDP) |
| R12 | Email / SMTP failures | | |

---

## R1. App won't start / blank window

**From L1:** handbook §7 "Startup error dialog", "Port 3000 In Use".

**Symptoms:** splash then error dialog; "Could not start"; "Node.js Not Found"; "Port 3000 In Use"; window stays dark/blank; "Social-Nexus stopped working unexpectedly".

**Checks**
1. Get the dialog text (it includes up to 5 server error lines) and `logs\server.log`.
2. Map the message:

| Dialog / log | Cause |
|---|---|
| `Node.js Not Found` / `SPAWN ERROR … ENOENT` / "The app's runtime is missing" | `<install>\resources\node\node.exe` missing (antivirus quarantine, partial install) |
| `[DB] Migration error: …` | Database locked, corrupt, or newer than the app (see R20) |
| `SQLITE_BUSY` / `database is locked` | Another process holds `nexus.db` (second copy, backup tool, old NEXUS still running) |
| `Error: The module … was compiled against a different Node.js version` / `NODE_MODULE_VERSION` | Native module ABI mismatch — broken build (R20) |
| `[Startup] SESSION_SECRET must be set in production.` | `.env` lost its `SESSION_SECRET` line |
| `Server did not start within 40s`, no detail | Antivirus scanning/blocking `node.exe`, very slow disk |
| `Another program is using port 3000` | Foreign program on the port |
| `Windows N is not supported` | Windows < 10 |
| `EXIT code=…` after running fine | Crash; look at the lines before it |

3. Port owner: `Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess` then `Get-Process -Id <pid>`.
4. Blank window but `Invoke-RestMethod http://localhost:3000/__health` works → renderer issue: press Ctrl+R in the window; check the page loads in a browser at `http://localhost:3000`.

**Fix**
- Runtime missing / AV: restore from quarantine and add an exclusion for `<install>`, or reinstall (data is kept).
- Locked DB: tray → Quit on every copy; Task Manager → end `Social-Nexus` and `node.exe` processes under the user; start again.
- Port: stop the other program; or start Social-Nexus with another port **only as a last resort** (`PORT` must be set in the Electron process environment, e.g. a shortcut running `cmd /c "set PORT=3010&& "<install>\Social-Nexus.exe""`), then every platform redirect URI must be re-registered with the new port.
- Missing `SESSION_SECRET`: add a line `SESSION_SECRET=<random 32+ chars>` to `%APPDATA%\Social-Nexus\.env` (all users must log in again).
- Corrupt DB: restore the latest folder backup (R14). If none, escalate (L3 can try `sqlite3 nexus.db ".recover"` on a copy).

**Escalate:** ABI / module errors or a crash reproducible on a clean VM → engineering with the log, app version, Windows build.

---

## R2. "Modified" licence on a genuine install

**From L1:** handbook §6 "Not valid on this PC" → "has been modified" when the customer installed from radixile.com.

**Symptoms:** Settings → 🔑 Licence shows 🔴 "This copy of Social-Nexus has been modified…"; `/__health` → `"licence":"invalid"`.

**Checks**
1. Confirm the installer source and SHA-256 against the release record (R19 step 6).
2. The reason isn't shown in the UI. Compare the install with its manifest (run in a remote session, read-only):

```powershell
$app = "<install>\resources\app"
$m = Get-Content "$app\config\integrity.json" -Raw | ConvertFrom-Json
if (-not $m.sig) { "Manifest UNSIGNED (internal build)" }
$files = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($m.payload)) | ConvertFrom-Json).files
foreach ($p in $files.PSObject.Properties) {
  $f = if ($p.Name -eq 'runtime:node.exe') { Join-Path $app '..\node\node.exe' } else { Join-Path $app $p.Name }
  if (-not (Test-Path -LiteralPath $f)) { "MISSING $($p.Name)"; continue }
  if ((Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower() -ne $p.Value) { "CHANGED $($p.Name)" }
}
Get-ChildItem $app -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($app.Length + 1).Replace('\', '/')
  if ($rel -ne 'config/integrity.json' -and -not $files.PSObject.Properties[$rel]) { "EXTRA $rel" }
}
```

3. Typical results: `MISSING`/`CHANGED` under `node_modules` → antivirus quarantine or repair; `EXTRA` → a file dropped into the install folder (backup tool, user, a "plugin", a log); `CHANGED runtime:node.exe` → node.exe replaced; no output but still modified → `services/integrity.jsc` hash pin failed (partial upgrade) or manifest signature invalid (build signed with a different build key).

**Fix**
- Remove the extra file / restore quarantined files, or simply **reinstall the same version** over the top (data in `%APPDATA%` is untouched), then add an AV exclusion for `<install>`.
- Restart the app; status moves `checking` → `active` once the background check finishes.

**Escalate:** reproducible on a clean VM with our installer, or `/__health` of a fresh install says `invalid` → **release defect** (R20: pull the build). Never help bypass the check on cracked copies.

---

## R3. Licence stuck "Needs internet" / clock wrong

**From L1:** handbook §6 "Licence 🟠 Needs internet" when Check now keeps failing.

**Symptoms:** state `offline`; message "needs to connect to the internet briefly…" or "Your computer's date looks wrong…".

**Checks**
1. Decode `license.json` (snippet at top). Compare `lease_until`, `server_time`, `last_time` with the real time.
2. `last_error` shows the last refresh failure: "Could not reach the licence server…" (network), "The licence server is having a problem…" (5xx), "Too many attempts…" (429).
3. Network from the PC: `Test-NetConnection license.radixile.com -Port 443`; `Invoke-RestMethod https://license.radixile.com/health`.
4. Proxy: the server only gets `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` from the user environment. If the customer's network needs a proxy, those must be set as user environment variables before starting the app.
5. Our side: `/health` on the licence server; licence status in the admin panel (expired/suspended give other states, not `offline`).

**Fix**
- Wrong date (`now` more than 1 day before `last_time`/`server_time`): Windows Settings → Time & language → Set time automatically → Sync now; then **🔄 Check licence now**. A successful refresh resets `last_time` to the current time (also fixes a clock that was set into the future and then corrected).
- Lease expired + network OK: Check now. If it still fails with `DEVICE_MISMATCH`/`REVOKED` the state becomes `invalid` → R4/R5 or audit log.
- PC permanently offline: offline activation (handbook §6), repeat every `lease_days`.

**Escalate:** `/health` failing or 5xx for everyone → R17.

---

## R4. Customer reinstall or new PC (deactivate / transfer)

**From L1:** handbook §6 "New PC / moving", "Reinstalled on the same PC", `TRANSFER_LIMIT`.

**Checks**
1. Admin panel → Licences → search → open: Devices (name, app version, first/last seen, status).
2. Same PC? Reactivating on the same hardware (≥3 of 4 hashes match) reuses the device row — no new seat.
3. `TRANSFER_LIMIT`: count devices with status `deactivated` in the last 90 days ≥ `max(1, seats)`.

**Fix**
- Same PC: customer activates with the same key; done.
- New PC, old PC available: old PC → Settings → Licence → Deactivate this PC (needs internet) → new PC activate.
- Old PC dead/lost, or `TRANSFER_LIMIT`: Devices → **Deactivate** on the old device (support or owner; not subject to the 90-day limit), audit reason "move – hardware failure" etc. Customer then activates on the new PC.
- Data move: R14.
- After copying the data folder to a new PC, the old licence file shows "activated on a different computer" until the customer activates again — expected.

**Escalate:** more than one move per 90 days on Individual outside hardware failure → owner (policy, handbook §3.3).

---

## R5. Seats full

**From L1:** handbook §6 `SEATS_FULL`.

**Symptoms:** "This licence is already active on N of N computer(s)…" (HTTP 409; the app receives the device list: name, last_seen, app_version).

**Checks:** admin panel → licence → Devices; identify stale devices by `last_seen`. For coupons: "This coupon is already active on another computer."

**Fix**
- Deactivate the stale device (support), or (owner) **Seats** → raise for an Agency upgrade / temporary extra seat.
- Lowering seats later automatically deactivates the least-recently-seen extra devices.

**Escalate:** many devices with recent `last_seen` and different names on an Individual licence → suspected sharing → owner (suspend, handbook §9).

---

## R6. Coupon problems

**From L1:** handbook §4, §6 coupon table.

**Checks**
1. Coupons tab → campaign: `status`, `valid_from/until`, `max_redemptions_per_code`, codes/redeemed counts, `per_machine_once`, `per_email_once`.
2. Server rule order (guide §9.6). Note `coupon_machine_cooldown_days` defaults to **90** on a fresh server (Settings tab) — a PC that redeemed any coupon in the last 90 days gets `COUPON_COOLDOWN`.
3. Same PC + same code reinstall returns the **same** licence (same end date) — "no new period" is by design.
4. Gmail addresses are normalised (dots and `+tag` ignored) for `per_email_once`.

**Fix**
| Problem | Fix |
|---|---|
| Legit new PC hit `COUPON_USED_ON_PC`/`COOLDOWN` | (owner) issue a short manual subscription licence (Licences → New, type subscription, days = remaining period) instead of overriding the coupon |
| Codes lost after creation | Unrecoverable (hashes only). (owner) create a new batch; pause the old campaign if it shouldn't be used |
| One code leaked | No per-code revoke: (owner) revoke campaign → reissue to legitimate users (revoking also revokes every licence from that campaign at next check-in) |
| Campaign should stop for now | Support: **pause** (existing redemptions continue); owner resumes |
| Customer's coupon period should be longer | (owner) Licence → Extend (extends `expires_at`) |

**Escalate:** abuse patterns (many redemptions from one IP range, scripted emails) → owner.

---

## R7. Refund

**From L1:** handbook §3.7.

**Checks:** Orders tab → order status / `refund_status`; licence status; audit log entries `order.refunded` / `order.partially_refunded` by `razorpay`.

**Fix**
1. Owner processes the refund in the Razorpay dashboard.
2. Webhook `refund.processed` or `payment.refunded` → full refund: order `refunded`; purchase → licence `revoked`; yearly renewal charge → `expires_at = now`; update renewal → `updates_until` moved back. Partial refund → order `refund_status = partial`, licence unchanged.
3. No change within ~10 min → R21 checks; then (owner) set licence status **revoked** with reason `refund – <payment id>`.
4. Effect in the app at the next refresh (≤ `refresh_days`, at the latest `lease_until`).

**Escalate:** chargebacks/disputes → owner (suspend while investigating).

---

## R8. Posts failing per platform

**From L1:** handbook §7 "Posts fail … Reconnect", "Trouble connecting a platform", known limitations.

**Checks**
1. Error text from Compose → ⚠️ Failed list, Calendar item, or log `[Scheduler] … failed on <platform>:` / `[API] Post error on <platform>:`; OAuth problems: `[Auth] <Platform> error:`.
2. Map with guide §6.4.
3. Confirm the account is connected **in the same workspace** as the post, and the user is a **manager** (connect/page/board selection need `social.manage`).
4. Callback URL registered in the portal must equal the one shown on the card (📋 Copy), including `127.0.0.1` for X and the current port.

**Fix by platform**
| Platform | Common failure | Fix |
|---|---|---|
| All | 401/403 "rejected the connection" | Settings → Social Platforms → Disconnect → Connect (accept all permissions) → 🔁 Retry |
| LinkedIn | `linkedin_failed` on connect | Products "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn" added; redirect URL exact; secret correct. Company Page posting is not supported |
| Facebook | "No Facebook Page selected" / "Page token missing" | 📄 Select Facebook Page; reconnect if the Page list is empty (user must be Page admin) |
| Facebook | code 200 / 10 | App needs `pages_manage_posts`; non-tester users need Meta App Review |
| Instagram | "requires an image URL" | Public https image; IG account must be Business/Creator linked to the selected Page; reconnect/refresh Facebook to detect it |
| Pinterest | `Pinterest error 400` | Select Board; image required; Trial access shows pins only to the owner |
| X | 403 | Customer's X API plan lacks posting, or app permission not "Read and write" (regenerate tokens after changing) |
| Google Business | 403 / "No Google Business locations" | Business Profile API access not approved yet; verified location required; Testing-mode consent expires after 7 days → reconnect |
| YouTube / TikTok | always fail | Not supported (guide §6.3) |

**Escalate:** a platform failing for all customers with the same API message (API change, deprecation) → engineering with the exact message.

---

## R9. "Missed" posts

**From L1:** handbook §7 ("By design").

**Symptoms:** failed with `Missed: it was due <time> but Social-Nexus wasn't running or wasn't licensed then…`.

**Checks**
1. Was the app running? Log gaps around the due time (no `[Scheduler]` lines; `EXIT code=` or nothing).
2. Was the licence active? A non-`active` state pauses publishing; due posts wait, and anything more than 6 h late when publishing resumes is marked Missed.
3. Sleep/shutdown: Windows power settings; laptop lid.

**Fix:** Compose → ⚠️ Failed (last 14 days) → 🔁 Retry (needs licence + manager), or Calendar → Edit (resets to draft) → approve → schedule. Prevent: keep the app in the tray (✕, not Quit), disable sleep at posting times, keep the licence active.

**Escalate:** posts marked Missed while the log shows the app running and licensed at the due time → engineering (scheduler bug).

---

## R10. Ollama not detected / slow

**From L1:** handbook §7 "Ollama: not running", "Ollama slow…".

**Checks**
```powershell
Invoke-RestMethod http://localhost:11434/api/tags     # running? which models?
ollama list
```
- App view: `GET /api/config/ollama/status` (logged in) → `running`, `base`, `models`, `enabled`, `current`.
- Log: `[AI] Ollama not reachable`, `[Ollama] Running but model "<m>" not found. Available: …`, `[AI] Using Ollama (<m>) [queue: N]`.
- Custom URL: user setting `ollama_url` or `.env` `OLLAMA_BASE_URL`.
- F51: `user_settings.ollama_enabled` false doesn't disable Ollama if `.env` `OLLAMA_ENABLED` is not `false`.

**Fix**
- Not running: start Ollama from the Start menu; check nothing else uses 11434.
- Model missing: `ollama pull llama3.2` (or `llama3.2:1b` on < 8 GB RAM), or admin → Settings → Local AI → Pull.
- Slow: first call ≈ 30 s (load; unloads after `keep_alive` 30 min idle); app runs 2 Ollama requests at once, others queue (each up to 180 s). Use a smaller model, close heavy apps, or add a cloud key.
- Timeouts at 180 s on weak PCs: smaller model.

**Escalate:** Ollama answers `curl` but the app reports "not running" → engineering (proxy/IPv6 resolution of `localhost`).

---

## R11. AI key errors (quota, model retired)

**From L1:** handbook §7 "API key rejected", "busy (503) / rate limit (429)", "Other users can't use AI".

**Checks**
1. Full error (it lists every provider tried: `All configured AI providers failed: • Gemini: … • Groq: …`).
2. Whose key? Non-admin users never get `.env` keys — they need their own (user menu → My API Keys).
3. Log `[AI] <Provider> failed: <raw message>`.

**Fix**
| Reason | Fix |
|---|---|
| `API key rejected` | Re-paste (no spaces); key active/billing on the provider site |
| `rate limit reached (429)` | Free quota exhausted — wait, or add a second provider |
| `busy right now (503)` | Retry; choose another model |
| 404 / "model not found" | Model retired. Gemini uses `gemini-flash-latest`; others pick another model in the UI. Overrides `GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `MISTRAL_MODEL`, `ANTHROPIC_MODEL`, `OPENAI_IMAGE_MODEL`, `GEMINI_IMAGE_MODEL` can be added to `.env` (restart) |
| `timed out` | Network/proxy; set `HTTPS_PROXY` user variable if required |
| Image generation fails on Google | Gemini image models need billing on the Google key |

**Escalate:** a default model retired for everyone → engineering to change the default in `services/aiHelper.js` / `routes/media.js` and release.

---

## R12. Email / SMTP failures

**Symptoms / messages** (`POST /api/email/campaigns/:id/send`)
| Message | Meaning |
|---|---|
| "Email sending is not set up yet…" (400) | `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` empty |
| "Publishing needs an active licence…" (402) | Licence |
| "No active subscribers" (400) | |
| "This campaign has already been sent (or is sending right now)…" (409) | Status not draft/failed |
| "No emails could be sent: <error>" (502) → campaign `failed` | SMTP error for every recipient |
| success with `failed: n` | Some recipients rejected; campaign marked `sent` |

**Checks:** the `<error>` text — `Invalid login`/`535`/`EAUTH` (wrong user/password; Gmail/Google Workspace require an App Password), `ECONNECTION`/`ETIMEDOUT`/`ECONNREFUSED` (host/port blocked, wrong port), TLS errors (port 465 needs `SMTP_SECURE=true`, 587 needs `false`). Settings are install-wide in `.env` (admin only, take effect immediately).

**Fix:** admin re-enters SMTP in Settings → Email / SMTP; campaign status `failed` can be sent again. A campaign stuck in `sending` (app closed mid-send) has no automatic recovery: confirm with the customer what was delivered, then **Duplicate** and send the copy to the remaining list (resetting the status re-sends to everyone).

**Escalate:** provider-specific deliverability (spam, SPF/DKIM) is the customer's mail provider; app errors with a clean SMTP test elsewhere → engineering.

---

## R13. "Checking your licence…" never ends

**From L1:** handbook §6 (escalate after a minute + logs).

**Checks**
1. Release builds stay `checking` until (a) the integrity check finishes and (b) a complete fingerprint (≥ 3 parts) is read.
2. Test the PowerShell query manually (as the user):
```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_BaseBoard | Select -First 1).SerialNumber; (Get-CimInstance Win32_ComputerSystemProduct | Select -First 1).UUID; (Get-CimInstance Win32_DiskDrive | ? Index -eq 0 | Select -First 1).SerialNumber; (Get-CimInstance Win32_Processor | Select -First 1).ProcessorId"
& "$env:SystemRoot\System32\reg.exe" query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid
```
3. Fewer than 3 usable values (blank, "To be filled by O.E.M.", "Default string") → `isComplete` false; reads retried at 30 s, 2 min, 5 min.
4. AV/EDR blocking PowerShell from `node.exe`, or WMI broken (`Get-CimInstance` errors).

**Fix:** AV exclusion for `<install>\resources\node\node.exe`; repair WMI (`winmgmt /verifyrepository` as admin); restart the app.

**Escalate:** hardware genuinely reports < 3 identifiers (VMs, some mini-PCs) → engineering (fingerprint fallback).

---

## R14. Database backup / restore and moving to a new PC

**Built in (preferred):** Settings → **Backups** (admin). A backup is made every day (the newest 7 are kept) in `%APPDATA%\Social-Nexus\backups`. **Export a backup file** makes one `.snbackup` file with the database, settings and media library to move to another PC; **Restore from a file…** checks it and swaps it in at the next start (the replaced data is kept in `backups\before-restore-…`). A backup made by a newer Social-Nexus is refused: update first.

Saved logins are encrypted with a key protected by Windows for that user (`datakey.bin`). Daily backups stay encrypted (they only work on the same PC and Windows user). An exported `.snbackup` holds the logins decrypted so the new PC can read them — treat the file like a password vault.

**Manual backup (if the app won't start)**
1. Tray → **Quit Social-Nexus** (closing the window only hides it).
2. Check nothing is running: `Get-Process Social-Nexus, node -ErrorAction SilentlyContinue`.
3. Copy the folder:
```powershell
Copy-Item "$env:APPDATA\Social-Nexus" "D:\Backup\Social-Nexus-$(Get-Date -Format yyyyMMdd)" -Recurse
```
The copy contains tokens, keys and passwords in plain text — store it like a password vault (encrypted drive).

**Restore (same PC)**: Quit → rename the current folder (keep it) → copy the backup to `%APPDATA%\Social-Nexus` → start.

**Move to a new PC**
1. Old PC: Settings → Licence → Deactivate this PC (online); Quit.
2. Copy `%APPDATA%\Social-Nexus` to the new PC's `%APPDATA%\Social-Nexus` (app not running there).
3. Install Social-Nexus, start, log in, activate with the same key.
4. If the Windows user name differs, `CONTENT_FOLDER` in `.env` points at the old profile: admin updates it (Settings → content folder) or edit the line to `C:/Users/<new>/AppData/Roaming/Social-Nexus/content`.
5. Social accounts usually keep working; reconnect any that report 401/403. Port must stay the same for callbacks.

**Escalate:** restore fails with `[DB] Migration error` → backup is from a newer app version (install that version first) → engineering if unresolved.

---

## R15. Migrating from the old NEXUS data folder

**Automatic behaviour** (`electron/main.js` `migrateLegacyDataDir`), on start, only if `%APPDATA%\NEXUS` exists **and** `%APPDATA%\Social-Nexus\nexus.db` does not, and the old `nexus.db-wal` wasn't modified in the last 10 s (old app running → retried next start): copy everything → rewrite old absolute paths in `.env` → write `.migrated_from_nexus` → rename the old folder to `%APPDATA%\NEXUS.migrated-YYYY-MM-DD` → 4 s after start offer "Delete old copy". Then the server's `runLegacyMigration` builds the default org/workspace once.

**Symptoms:** old posts/accounts missing after upgrading from NEXUS.

**Checks**
1. Does `%APPDATA%\Social-Nexus\nexus.db` exist from a fresh start **before** the old data was found? Then migration was skipped.
2. Log: `[Data] Moved NEXUS data to …` or `[Data] Could not migrate old NEXUS data: …`.
3. Is there `%APPDATA%\NEXUS` or `NEXUS.migrated-*`?
4. Very old installs kept the DB in `<old install>\resources\app\data\nexus.db` (legacy `services/database.js` path) — not migrated automatically.

**Fix (manual)**
1. Quit Social-Nexus. Rename `%APPDATA%\Social-Nexus` to `Social-Nexus.empty` (keep it).
2. Copy `%APPDATA%\NEXUS` (or `NEXUS.migrated-*`, or the old `data` folder contents incl. `.env` if any) to `%APPDATA%\Social-Nexus`.
3. In `.env`, replace any `…/NEXUS/…` paths with `…/Social-Nexus/…` (e.g. `CONTENT_FOLDER`). Make sure `SESSION_SECRET` is present.
4. Start; check log `[DB] Migrations complete.`; log in with the old account; activate the licence.

**Escalate:** migration error in the log → engineering with log.

---

## R16. Switching to Postgres

Note: there is **no data migration** from SQLite; the Postgres database starts empty (first account becomes admin). Edition `team_mode` is not enforced by the app yet. Teammates still need this PC (server is loopback-only).

1. Create a database and user on Postgres (customer-managed).
2. Back up (R14). Quit.
3. Edit `%APPDATA%\Social-Nexus\.env`:
```
DB_CLIENT=pg
DATABASE_URL=postgres://<user>:<password>@<host>:5432/<db>
```
(The customer types the password; support never collects it.)
4. Start. Log should show `[DB] Migrations complete.`; sessions table is created automatically.
5. Errors: `DATABASE_URL is required when DB_CLIENT=pg`, `ECONNREFUSED`, `password authentication failed`, SSL errors → fix the URL / server (`?sslmode=require` style options are passed to `pg` in the URL).
6. Revert: set `DB_CLIENT=sqlite` (or remove the two lines) and restart — the SQLite file is untouched.

**Escalate:** schema errors on a supported Postgres version → engineering (tests can run on PG via `PG_TEST_URL`).

---

## R17. Licence server outage

**Impact:** apps keep working until each install's `lease_until` (up to `lease_days` = 30 days after its last refresh); refresh failures are stored as `last_error` and retried every 6 h. Activation, deactivation, offline activation, coupons and purchases fail. Banner appears ≤ 3 days before a lease ends.

**Checks**
1. `Invoke-RestMethod https://license.radixile.com/health` → 200 `{ok:true}`; 503 = DB unreachable.
2. Host logs: `[license-server] failed to start: Refusing to start in production: …` (missing env after a deploy), `[error] …`.
3. DNS/TLS/proxy (one proxy hop expected).

**Fix**
1. Restore DB connectivity / restart the service / roll back the last deploy (R22).
2. Communicate: customers need do nothing; publishing continues within the lease. Those blocked on activation retry later.
3. Long outage (> 2 weeks): owner may decide to raise `lease_days` **after** recovery so the next refresh grants a longer lease (it doesn't help apps that can't reach the server).

**Escalate:** immediately to engineering + owner (handbook §9).

---

## R18. Rotating the licence signing key

Planned rotation (old key not compromised):

1. Generate the new pair on a trusted machine:
```powershell
# in the licence server repository
$env:LICENSE_KEY_ID = "k2"; npm run keys; Remove-Item Env:LICENSE_KEY_ID
```
   This writes `public-keys/k2.pem` in the licence server repo (copy it to the app's `config/license-keys/k2.pem`) and prints `LICENSE_KEY_ID=k2`, `LICENSE_PRIVATE_KEY=…`. **Ignore the printed `LICENSE_PEPPER` and `ADMIN_SESSION_SECRET`** — never change the pepper. Store the private key in two offline places; do not put it on the server yet.
2. Commit `k2.pem` **next to** `k1.pem`. Release an app update (R19); `protect.js` bakes every `.pem` into the build.
3. Wait for adoption. On the licence DB: `select app_version, count(*) from devices where status = 'active' group by app_version;`
4. Switch the server: set `LICENSE_KEY_ID=k2` and `LICENSE_PRIVATE_KEY=<k2>`; restart; check `GET /v1/public-key` equals `config/license-keys/k2.pem`.
5. Older app versions can't verify `k2` files: refresh fails (`last_error`), they keep the old `k1` file until `lease_until`, then go `offline` and need the update. Keep `k1.pem` in builds until all leases issued with `k1` have expired (≥ `lease_days` after the switch).

Compromised key: do steps 1–2 urgently **and remove `k1.pem`** from `config/license-keys/` before building; switch the server immediately (step 4). Installs on the new version reject their stored `k1` file as "damaged" and do not auto-refresh — customers must **activate again** with their key (seat reused on the same PC). Announce it.

**Escalate:** owner approval required; never paste private keys into tickets or chat.

---

## R19. Issuing a release

1. Branch up to date; bump `version` in `package.json` (semver). Licence server compatibility: v2 files, endpoints unchanged.
2. Build machine prerequisites (guide §11.1): Node 20, `resources\node\node.exe` (Node 20 x64), icons (`npm run icons` if `build\icon.ico` is missing), `config\license-keys\*.pem`, `config\build-public-key.pem`, `$env:BUILD_SIGNING_KEY`, signing env if a certificate exists.
3. `npm ci` then:
```powershell
.\build\build-win.ps1
```
4. The script must end with `Signed integrity manifest present`, `Packaged server starts and answers /__health`, artefact names + SHA-256. Fix any failure per guide §11.2; never ship with `-SkipTests`.
5. `git status` must be clean afterwards (no `.jsc`, `services/license/index.js` restored). If not: `node scripts/release/protect.js --restore`.
6. Record version, SHA-256 of `Social-Nexus-Setup-<v>.exe` and `Social-Nexus-Portable-<v>.exe`, build commit.
7. VM tests (Windows 10 + 11): fresh install, upgrade from previous version (data kept, migrations OK), `/__health` licence ≠ `invalid`, activate, publish/schedule on test accounts, offline start, uninstall with **No** keeps data. Optional VirusTotal scan.
8. Publish installer + checksum on radixile.com; keep the previous installer available for rollback (R20). Tag the commit.
9. **Automatic update:** upload `Social-Nexus-Setup-<v>.exe`, its `.blockmap` and `latest.yml` from `dist-app` to `https://updates.radixile.com/social-nexus/` (upload the .exe and .blockmap first, `latest.yml` last — apps start downloading as soon as `latest.yml` changes). Installed apps check every 6 hours and install when closed (or "Restart to update" in the tray). The portable .exe does not update itself.
10. **Code signing (needed for updates):** the installer must be signed with Radixile's code-signing certificate (EV or OV, issued to exactly "Radixile Technology Solutions LLP" — this name is `publisherName` in package.json; apps refuse updates signed by anyone else). Set `CSC_LINK` (path or base64 of the .pfx) and `CSC_KEY_PASSWORD` before `build-win.ps1`; for a USB-token EV certificate use the vendor's signing tool via electron-builder's `win.sign`. Without a certificate, builds work but auto-update fails ("not signed by the application owner") and Windows SmartScreen warns on install.

**Escalate:** any `modified` on a clean VM → stop; engineering.

---

## R20. Rolling back a bad release

1. **Stop distribution:** replace the download with the previous installer + checksum.
2. Identify impact: licence server devices by `app_version` (`select count(*) from devices where status='active' and app_version = '<bad>';`).
3. Decide whether the bad version added a database migration (`db/migrations` diff between tags):
   - **No new migration:** customers install the previous installer over the bad one (test on a VM first; if the installer refuses, uninstall with **No** to keep data, then install). Data stays.
   - **New migration:** an older app refuses to start on a database that has newer migrations (Knex reports missing migration files → `[DB] Migration error`). Ship a **fixed forward** version instead, or restore the customer's pre-upgrade backup (R14) before installing the old version.
4. If the bad build is flagged "modified" everywhere (manifest problem), licensing stops for those users only (data intact) — ship a fixed build quickly; no server change needed.
5. Licence-server-side issues are rolled back separately (R22).

**Escalate:** release manager + owner; customer communication via support.

---

## R21. Razorpay webhook failures / paid but no licence

**From L1:** handbook §6 `BAD_SIGNATURE`, "Customer paid but got no key"; §9.

**Checks**
1. Admin → Orders: find by email. `created` = never marked paid; `paid` = licence issued (key shown once / emailed).
2. Razorpay dashboard: payment `captured`? Webhook delivery attempts and response codes for `https://license.radixile.com/webhooks/razorpay`.
3. Response meaning: **400 `bad signature`** → `RAZORPAY_WEBHOOK_SECRET` differs from the dashboard secret (or a proxy altered the body); **500** → handler error (host log `[webhook] …`; Razorpay retries); **200** but order still `created` → event didn't match: payment `amount` ≠ `orders.amount_paise`, or the payment's `order_id` isn't the stored `razorpay_order_id` (e.g. paid via another link).
4. Subscriptions: first order matched by `razorpay_subscription_id` + `kind='purchase'`; renewals add `renewal_charge` orders and move `expires_at` (only if the licence is `active`).
5. `payments_mode` on the dashboard must be `razorpay`.

**Fix**
- Wrong secret: correct `RAZORPAY_WEBHOOK_SECRET` (host secrets), restart, let Razorpay retry / re-deliver.
- Order stuck `created` but money captured: (owner) Licences → New licence with the same type/edition for the customer's email, notes `order O-<id>, payment <pay_id>`; send the key to the purchase email only. There is no "mark order paid" in the panel — record the link in the notes. (An invoice is created only by `markPaid`; raise the GST invoice manually if needed.)
- Renewal paid but app shows expired: check `expires_at`; (owner) Extend if the webhook was missed.
- Mock mode in production: escalate immediately; the server should have refused to start unless `ALLOW_MOCK_PAYMENTS=true`.

**Escalate:** owner for money issues; engineering for 500s.

---

## R22. Licence server deploy / config change

1. Back up Postgres (provider snapshot) before deploying.
2. Deploy the licence server repository (Node 20), `npm install`, `npm start`. Migrations run at start.
3. Production must have: `NODE_ENV=production`, `DATABASE_URL`, `LICENSE_PRIVATE_KEY`, `LICENSE_KEY_ID`, `LICENSE_PEPPER` (unchanged!), `ADMIN_SESSION_SECRET`, `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET`, `PUBLIC_URL`, `SMTP_*`, `MAIL_FROM`. Otherwise the process exits with `Refusing to start in production: …`.
4. Verify: `/health` 200; admin login; dashboard `payments_mode = razorpay`; `GET /v1/products` returns real prices; `GET /v1/public-key` matches `config/license-keys/<kid>.pem`.
5. Tests before deploy: `npm test` in the licence server repo. Also run the app's `npx jest tests/license.client.test.js` with the server checked out next to the app (or `LICENSE_SERVER_DIR` set) — it is skipped otherwise.
6. Roll back: redeploy the previous build; migrations are additive (no down-migration needed for a code rollback).

---

## R23. Data deletion request (DPDP)

1. Verify the requester controls the purchase email (reply only to that address).
2. **Radixile licence server** (owner): Settings → **Anonymise a customer…** (or `POST /admin/api/customers/anonymise {email}`). Effect: email → `deleted-<id>@anonymised.invalid`, name/phone/company/address cleared, licensee "Anonymised customer", coupon redemption emails and device names cleared, audit entry `customer.anonymise`. **Kept by law:** invoices (snapshot incl. buyer details) and order billing data, for 8 years (GST). IP addresses in the activity log are removed automatically after `ip_retention_days` (90).
3. Licences keep working unless the customer also wants them ended — then (owner) revoke.
4. **Customer's PC** (we hold nothing): tell them to uninstall and answer **Yes** to "Also delete all Social-Nexus data…", or delete `%APPDATA%\Social-Nexus` (and `%APPDATA%\NEXUS*`); remove backups they made; revoke Social-Nexus app access in each social network's settings; delete/rotate AI keys at the providers.
5. Shared install, one person leaving: install admin → Admin → delete the user (removes the user and their rows in the per-user tables; workspace content stays).
6. Delete logs/screenshots for that customer from the ticket system; reply with what was deleted and what is retained and why.

**Escalate:** legal questions or requests covering invoices → owner.

---

## R24. Relay services on the licence server (approvals, connect, bio, phone, cloud posting)

The licence server also relays for features the desktop app can't do from a PC behind a router. All run in the one Node process; keep it to **one instance** (cloud posting serves photos to Instagram from memory).

**Settings (production)**
- `PUBLIC_URL` must be the public **https** address (approval links, connect callbacks, Instagram photo fetches all use it).
- `BIO_PUBLIC_URL` (recommended): a separate address such as `https://bio.radixile.com` pointing at the same server, so an abusive link-in-bio page can't get the licence/payment domain blocked.
- `CONNECT_<PLATFORM>_ID/_SECRET` for one-click connect (facebook, linkedin, google, pinterest, threads). Register `<PUBLIC_URL>/connect/callback/<platform>` with each platform.
- `CLOUD_JOB_KEY` (64 hex). Without it cloud posting isn't offered. Editions allowed: setting `cloud_posting_editions` (default `agency,full`).

**Rotating `CLOUD_JOB_KEY`**: set `CLOUD_JOB_KEYS_OLD="k1:<old hex>"`, a new `CLOUD_JOB_KEY` and `CLOUD_JOB_KEY_ID=k2`, restart. Remove the old key once no `waiting` jobs made before the change remain (at most 48 h, since apps hand jobs over only 48 h ahead).

**Monitoring (alerts)**
- Cloud jobs `waiting` more than 15 min past `run_at` + 10 min grace (worker stuck): `select count(*) from cloud_jobs where status='waiting' and run_at < extract(epoch from now()) - 1500;`
- Cloud failure rate per day (`status='failed'`), and `running` jobs older than 25 min (the worker marks them failed automatically — investigate why).
- Database size (approvals hold encrypted pictures up to ~11 MB each; per-licence cap 300 MB).
- `/health` and HTTPS certificate expiry.

**Abuse**: link-in-bio pages carry "Report this page" (abuse@radixile.com). Take a page down: `DELETE /admin/api/bio/<name>` (admin session).

**Data breach** (DPDP): relay data is encrypted (approvals/phone: key not on the server; cloud jobs: `CLOUD_JOB_KEY`). If the database or `CLOUD_JOB_KEY` may be exposed: rotate the key, revoke one-click app secrets at each platform (forces customers to reconnect), inform affected customers and the Data Protection Board without delay as the DPDP Rules require, and record the incident.

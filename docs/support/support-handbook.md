# Social-Nexus Support Handbook

**For Radixile Technology Solutions support staff** · Internal document · Version 2.1 (October 2026)

Customer-facing guides: `docs/help/user-guide.md`, `docs/help/connect-social-accounts.md`, `docs/help/privacy-and-data.md` (also in the app under Help).
Licence admin panel: **https://license.radixile.com/admin** · Support mailbox: **info@radixile.com**

> **Status of this handbook:** the licence server (separate repo `license-server`) is new and its admin panel screens are still being built. The behaviour, limits and error codes below come from the server code (`src/*.js` in that repo) and the design in `docs/architecture/licensing-and-distribution.md`. Button names in the admin panel may differ slightly. Where something is design-only (not in the code yet), it is marked **(planned)**.

---

## 1. Golden rules

1. **Never ask for, accept or store** a customer's passwords, API keys, social Client Secrets, the `.env` file or `nexus.db`. If a customer sends one, tell them to change it, and delete the message.
2. **Licence keys and coupon codes are stored only as hashes.** We **cannot** look up or resend a customer's full key. We can find a licence by email, licensee name, the **last 4 characters** of the key, the full key (it's hashed and compared), or the licence number `L-000123`.
3. **New keys are shown once.** When you issue a licence or create a coupon campaign, copy the key or codes **immediately**. They can't be shown again.
4. **Customer data stays on their PC.** We can't see their posts, accounts or settings. Troubleshooting is done from their **log file** and screenshots.
5. Every admin action is written to the **audit log** with your email. Always enter a short **reason** when you suspend, revoke, extend or move something.

---

## 2. Licence types and states

### Types
| Type | Key format | Paid | Ends | Updates |
|---|---|---|---|---|
| **Perpetual (one-time)** | `SNXP-XXXXX-XXXXX-XXXXX-XXXXX` | Once | Never (`expires_at` empty) | Until `updates_until` (12 months by default). After that, an "update renewal" adds another year. |
| **Subscription (yearly)** | `SNXS-XXXXX-XXXXX-XXXXX-XXXXX` | Yearly via Razorpay Subscriptions | `expires_at`, moved forward on each Razorpay charge | Always |
| **Coupon** | `SNX-XXXX-XXXX` | Free | Redemption date + campaign `duration_days` (90 = 3 months, 180 = 6 months) | During the period |

Key alphabet: no `0 O 1 I L`, so keys are easy to read over the phone. Spaces and case don't matter.

### Editions (defaults; owners can change them, see §5)
| Limit | Individual | Agency | Full (coupons) |
|---|---|---|---|
| Seats (PCs) | 1 | 5 | 1 |
| Workspaces | 1 | 25 | 25 |
| Users | 2 | 10 | 10 |
| Autopilot rules | 3 | unlimited | unlimited |
| SEO sites | 1 | 10 | 10 |
| Team mode | no | yes | yes |

### Licence states (`status`)
| State | Meaning | Effect in the app |
|---|---|---|
| **active** | Normal | Works |
| **suspended** | On hold (e.g. payment dispute, investigation) | At the next check-in the app gets `SUSPENDED` and goes to limited mode. Reversible. |
| **revoked** | Cancelled (refund, abuse, revoked coupon campaign) | At the next check-in the app gets `REVOKED` and goes to limited mode. Treat this as final. Issue a new licence if needed. |
| *expired* (computed) | `expires_at` + grace has passed | `EXPIRED`, limited mode |

### Timing rules (server settings, defaults)
- **Check-in:** the app refreshes about every **7 days** when online (`refresh_days`).
- **Offline lease:** each licence file is valid for **30 days** (`lease_days`) without contact. For subscriptions and coupons the lease never goes past the end date (+ grace).
- **Subscription grace:** **7 days** after `expires_at` (`subscription_grace_days`).
- **Hence:** a suspension, revocation or refund takes effect within **~7 days** if the customer is online, and at the latest when their 30-day lease runs out.

### Limited mode (what the customer keeps)
**Always works:** view everything, write drafts, AI writing, planning on the calendar, export and back up. **Stopped:** publishing, scheduling, Retry of failed posts, CSV schedule import, sending email campaigns, AI auto-posting (autopilot) and SEO automation. Their data is never deleted or locked.

**Edition limits (users, workspaces) count the whole installation**, not per user. For example, two people each creating a workspace on one Individual licence hit the workspace limit.

### What the customer sees in the app (Settings → 🔑 Licence → Status)
| App state | Shown as | Typical cause | First answer |
|---|---|---|---|
| `unlicensed` | ⚪ Not activated | No licence yet | Activate a key or coupon. |
| `checking` | "Checking your licence…" (banner hidden) | First few seconds after start-up (hardware ID and integrity checks) | Wait a few seconds and try again. If it lasts more than a minute, collect logs. |
| `active` | ✅ Active | — | — |
| `offline` | 🟠 Needs internet | Offline lease ran out (**Works offline until** date passed), or PC clock set back more than a day | Go online, then **Check now** (banner) or **🔄 Check licence now**. Fix the Windows date if the message mentions it. |
| `expired` | 🔴 Ended | Subscription (+7 days grace) or coupon period over | See the EXPIRED scripts in §6. |
| `invalid` | 🔴 Not valid on this PC | Licence from another install/PC, revoked/suspended, damaged licence file, or **modified copy** | Read the exact message (scripts in §6). |

A banner warns when **3 days or fewer** of offline lease are left, and when a subscription or coupon ends within 14 days.

### Device matching
The app sends 4 hashed hardware parts: the Windows machine ID, motherboard, disk and CPU. A PC still matches if **3 of 4** are unchanged, so replacing a disk or RAM is fine. A reinstall of Windows changes the machine ID. Usually 3 of 4 still match and the PC is recognised.

---

## 3. Admin panel tasks

Sign in at **/admin** with your admin email and password. There are two roles:
- **support:** licences, devices, coupons, orders and the audit log.
- **owner:** everything support can do, **plus** prices, editions, server settings and the admin team.

Sign-in is rate-limited (10 attempts per 15 minutes) and the session lasts 12 hours.

### 3.1 Find a customer
Licences → **search box**. Enter any one of:
- the customer's **email** (or part of it),
- the **licensee** name or company,
- the **last 4 characters** of the key (e.g. `7QMK`). The licence shows a hint like `…7QMK`,
- the **full key** (pasted; it's hashed and compared, never stored),
- the licence number, e.g. `L-123` or `123`.

Results show the 100 most recent matches. Open a licence to see the **customer**, **devices** (name, app version, first and last seen, active or deactivated), **orders** and the last 50 **audit** entries.

### 3.2 Issue a licence manually

> Owner-only: issuing, extending, coupon campaigns and seat changes need the **owner** role in the admin panel. Support staff ask the owner (or escalate to L2, see docs/support/runbooks.md).
Use this for bank-transfer customers, replacements, partners and press. Licences → **New licence**:
- **Type:** perpetual or subscription. (Coupons are made through campaigns, §4.)
- **Edition:** individual / agency / full.
- **Email** and **name** (creates or reuses the customer) and **licensee** (shown in the app as "Licensed to …").
- **Seats** (defaults to the edition's seats).
- Subscription: **days** (default 365). Perpetual: **update days** (default 365).
- **Notes:** why it was issued.

The key is shown **once**. Copy it into your reply to the customer straight away.

### 3.3 Reset or move devices (free a seat)
Open the licence → **Devices** → **Deactivate** on the old PC. The seat is free immediately and the customer can activate on the new PC.
- Check **last seen** to identify the old PC.
- Policy (placeholder, confirm with management): Individual edition, **1 move every 90 days**. Allow extra moves for hardware failure. Note the reason.
- The customer can also do this themselves on the old PC: **Settings → Licence → Deactivate this PC**.

### 3.4 Change seats
Licence → **Seats** → enter 1–1000. Use this for Agency upgrades, or as a temporary extra seat during a PC change.

### 3.5 Extend
Licence → **Extend** → number of days (1–3650).
- **Perpetual:** extends **updates_until** (support period).
- **Subscription / coupon:** extends **expires_at**.

The extension counts from the later of today or the current end date. The customer's app picks it up at its next check-in. Ask them to restart the app while online to get it straight away.

### 3.6 Suspend, reactivate or revoke
Licence → **Status** → **suspended** / **active** / **revoked**, with a reason. Effect: next check-in (see §2 timing).

### 3.7 Refunds
1. Process the refund in the **Razorpay dashboard** (Payments → the payment → Refund).
2. Razorpay sends a webhook. The server **automatically marks the order refunded and revokes the licence**. Check the order shows `refunded` and the licence `revoked` in the admin panel.
3. If the webhook didn't arrive (no change after ~10 minutes), revoke the licence manually with the reason "refund – <payment id>".
4. Tell the customer that publishing stops at the app's next check-in and their data stays on their PC.

### 3.8 Orders and invoices
Orders lists the last 200: status (`created`, `paid`, `failed`, `refunded`), amount, invoice number (`SNX/2026-27/00001`), Razorpay payment id and the linked licence. Each paid order has a printable GST invoice at a secret link that is shown on the customer's success page. If a customer lost the invoice link, an owner can find the order and re-share the invoice **(planned: "resend invoice" button)**.

---

## 4. Coupon campaigns

Coupons give **free temporary activation**, normally of the **Full** edition, for **3 months (90 days)** or **6 months (180 days)**.

### 4.1 Create a campaign
Coupons → **New campaign**:

| Field | What to enter | Default |
|---|---|---|
| **Name** | e.g. `Diwali-2026-partners` (for reports) | required |
| **Edition** | `full` (all features) | full |
| **Duration (days)** | **90** for 3 months, **180** for 6 months (1–3650 allowed) | required |
| **Valid from / until** | The window in which codes can be **redeemed**. After `until` they can't be redeemed, but already-redeemed periods continue. | open |
| **Number of codes** | 1–5000 per batch | 1 |
| **Max uses per code** | **1** for personal codes; e.g. **500** for one public promo code | 1 |
| **One per PC** (`per_machine_once`) | The same PC can't redeem this campaign twice | on |
| **One per email** (`per_email_once`) | Customers must enter an email, and each email can redeem once | on |
| **Issued to** | e.g. "Partner: XYZ Agency" | — |
| **Note** | Anything for the team | — |

**The codes appear once, right after you create the campaign. Download or copy them immediately** (CSV export of the list shown). Only hashes are stored, so lost codes can't be recovered. You would have to create a new batch.

> **(planned)** a "Download CSV" button for the code list at creation, and a CSV export of redemptions. Today, copy the codes from the creation result, and view redemptions (licence, email, date, up to 500) on the campaign's **Redemptions** list.

### 4.2 Rules the server enforces
- Codes must be redeemed **online** (`COUPON_ONLINE_ONLY` for offline requests).
- Each redemption creates a **coupon licence** for **1 PC**, ending `duration_days` after redemption.
- **Same PC + same code again** (e.g. after reinstalling) → the customer gets the **same** licence back, not a new period.
- Optional global cool-down: `coupon_machine_cooldown_days` (owner setting, default 90 days; 0 = off) blocks a PC from using any coupon again within N days.
- The last use of a code is protected, so two PCs can't both take it.

### 4.3 Pause or revoke
Coupons → campaign → **Status**:
- **paused:** no new redemptions. Already-redeemed customers keep their period. Set back to **active** to resume.
- **revoked:** no new redemptions, **and every licence created from the campaign is revoked** at its next check-in. Use for leaked or abused codes. You can't undo this for the affected customers (issue them new licences if needed).

> Revoking a **single** code inside a campaign isn't available in the panel yet **(planned)**. To stop one leaked code, revoke the campaign and reissue codes to the legitimate recipients.

### 4.4 Converting a coupon user to paid
The customer buys on the website and enters the paid key in **Settings → Licence**. Their data is kept. The coupon licence simply stops being used.

---

## 5. Prices, editions and settings (owner only)

**Prices** (Admin → Pricing / Catalog): each product has a name, price in rupees **before GST**, GST % (default **18**), update months, Razorpay plan id (for yearly) and active on/off. Changes apply to **new** purchases only.

The server is seeded with **placeholder** prices. An owner must set the real ones before launch. **Never quote prices from memory or from this handbook**: always point customers to **https://license.radixile.com/buy**, which shows the current prices.

- **Yearly products need a Razorpay Plan.** Create the plan in Razorpay (Subscriptions → Plans, yearly, same amount incl. GST) and paste its `plan_…` id. Without it, checkout shows "This subscription is not set up yet".
- To stop selling a product, set **active = off**. Don't delete it.

**Editions:** limits are `seats, workspaces, users, autopilot_rules, seo_sites` (whole numbers, **-1 = unlimited**) and `publish, team_mode` (true/false). Changes apply to licence files issued **after** the change. Customers get them at their next check-in. Note: an existing licence's **seats** are stored on the licence itself; change them per licence (§3.4).

**Server settings:** `lease_days` (30), `refresh_days` (7), `subscription_grace_days` (7), `coupon_machine_cooldown_days` (0), and the company name, GSTIN, address, support email and invoice prefix printed on invoices. Make sure **company GSTIN and address are filled in before the first real sale.**

**Admin team:** owners can add admins (password at least 10 characters, role support or owner) and disable them. You can't disable your own account.

**Payment mode:** the admin dashboard shows `payments_mode`. **`mock` means purchases are not charged.** It must say `razorpay` in production. Tell an owner immediately if it doesn't.

---

## 6. Error codes and scripted answers

The app shows the server's message. Customers may quote the code. Replies are written to be pasted. Replace `<…>`.

### SEATS_FULL: "This licence is already active on N of N computer(s)"
> Hi <name>, your licence is currently active on all its allowed computers (<N>). To use it on this PC, please open Social-Nexus on the old PC and go to **Settings → Licence → Deactivate this PC**, then activate again here.
> If the old PC is no longer available, reply with the approximate date you last used it and we'll free the seat for you.

*Action:* find the licence → Devices → check last seen → deactivate the old device (note the reason). Check the move policy (§3.3).

### New PC / moving
> Hi <name>, to move Social-Nexus to your new PC:
> 1. On the old PC: **Settings → Licence → Deactivate this PC**.
> 2. Install Social-Nexus on the new PC and enter the same key.
> 3. To bring your posts and settings, quit Social-Nexus on the old PC (tray icon → Quit), copy the folder `%APPDATA%\Social-Nexus` to the same place on the new PC, then start the app.
> Your connected social accounts may ask you to reconnect once.

### Lost licence key
> Hi <name>, for your security we don't keep a readable copy of licence keys, so we can't resend the original. We've issued a replacement key for the same licence: **<new key>**. Please enter it in **Settings → Licence**. Your old key has been deactivated.

*Action:* verify the requester owns the purchase email (reply only to that address). Issue a new licence with the same type, edition, seats and end dates (§3.2, note "replacement for L-<old>"), then **revoke** the old licence.

### EXPIRED (subscription): "This subscription has ended. Renew to keep publishing — your data is safe."
> Hi <name>, your yearly subscription ended on <date>. Social-Nexus is now in limited mode: you can still view, export and draft, but publishing is paused. Renew at **https://license.radixile.com/buy**. As soon as the payment goes through and the app is online, publishing resumes. No reinstall is needed.

*Check:* Razorpay → Subscriptions → was a charge attempted or did it fail (`halted`)? If the customer paid but the licence still shows expired, check the order and webhook (§7), and **extend** manually if needed.

### EXPIRED (coupon): "This coupon period has ended…"
> Hi <name>, your free coupon period has ended. Thank you for trying Social-Nexus! Your posts and settings are safe on your PC. To keep publishing, choose a plan at **https://license.radixile.com/buy** and enter the key in **Settings → Licence**.

### Coupon already used
| Code | Message | Reply |
|---|---|---|
| `COUPON_USED_ON_PC` | This computer has already used a coupon from this offer. | > This offer can be used once per computer, and this PC has already used it. If you believe this is wrong (for example, a new PC), reply and we'll check. |
| `COUPON_USED_BY_EMAIL` | This email address has already used a coupon from this offer. | > This offer can be used once per email address. |
| `COUPON_USED_UP` | This coupon has already been used the maximum number of times. | > This code has reached its usage limit. Please contact whoever gave you the code for a new one. |
| `COUPON_EXPIRED` / `COUPON_NOT_YET` | The offer window has ended / not started. | > This coupon can only be redeemed between <dates>. |
| `COUPON_INACTIVE` | The campaign is paused or revoked. | Check the campaign status before replying. |
| `INVALID_COUPON` | Not found or revoked. | > Please check the code for typos. It looks like `SNX-XXXX-XXXX`, with no letter O or number 0. |
| `EMAIL_REQUIRED` | — | > Please enter your email address on the activation screen. This offer needs it. |
| `COUPON_COOLDOWN` | — | > This PC used a coupon recently. Another can be used after <N> days. |
| `COUPON_ONLINE_ONLY` | — | > Coupons need a short internet connection to redeem. Offline activation is only for paid keys. |

If the customer reinstalled on the **same PC** with the **same code**, it works automatically and returns the same period. A "used" error then means it's a different PC or code.

### Offline activation file (PC without internet)
> Hi <name>, here's how to activate a PC that has no internet:
> 1. In Social-Nexus, **Settings → Licence → Offline activation → Save request file**. This creates `activation.snreq`.
> 2. Copy that file to any phone or computer with internet and open **https://license.radixile.com/offline**. Upload the file.
> 3. Download the `license.snlic` file it gives you, copy it back to the PC, and choose **Import licence file**.
> Please note: offline activation works for paid licence keys only, not coupons. The licence lasts <30> days before it needs another check-in (or another file).

*Errors:* "That file is not a Social-Nexus activation request" means they uploaded the wrong file. Seat and validity rules are the same as online activation.

### Licence shows "Checking your licence…" / publishing says "still checking your licence"
> Hi <name>, for the first few seconds after Social-Nexus starts, it checks your licence on this PC. Publishing waits for those few seconds. Please wait a moment and try again.

*If it never finishes:* the hardware check may be blocked or slow, often by antivirus. Collect logs (§8) and escalate to engineering.

### Licence 🟠 "Needs internet" (state `offline`)
> Hi <name>, Social-Nexus works offline until the **Works offline until** date in Settings → 🔑 Licence. That date has passed, so it needs to confirm your licence once. Please connect to the internet and click **Check now** on the banner (or **🔄 Check licence now** in Settings → 🔑 Licence). Publishing resumes straight away.

*If the message says "Your computer's date looks wrong":* the Windows clock was set back more than a day. Ask them to fix the date and time (Windows Settings → Time & language → turn on "Set time automatically"), then go online.
*If Check now fails:* the message shows the reason ("Could not reach the licence server…" = their network or firewall; "The licence server is having a problem…" = our side, check `/health`).

### Licence 🔴 "Not valid on this PC" (state `invalid`)
Ask for the exact message (or a screenshot of Settings → 🔑 Licence):

| Message | Reply / action |
|---|---|
| "This licence belongs to another installation…" / "This licence was activated on a different computer…" | Ask them to **activate again with the same key**. On the same PC this re-uses their seat. On a different PC, free the old device if seats are full (§3.3). |
| "This copy of Social-Nexus has been modified, so it cannot be licensed. Please reinstall it from radixile.com — your data is safe." | > Some of Social-Nexus's program files were changed or damaged, so the licence can't be used with this copy. Please download the installer from radixile.com and reinstall. Your posts and settings are kept in a separate folder and are not affected. Then activate again if asked. *(If they used a "crack" or an unofficial download, don't help bypass it.)* |
| "The licence file is damaged or was changed. Please activate again." | Activate again with the same key. |
| A revoked/suspended reason | Check the audit log before replying (§3.6). |

### Deactivate fails offline: "… Deactivating needs the internet so your seat is freed for another PC."
> Hi <name>, deactivating tells our licence server to free your seat, so the PC needs to be online for a moment. Nothing was removed: your licence is still active on this PC. Please connect to the internet and click **Deactivate this PC** again.

*If the old PC can never go online again* (broken, lost): deactivate the device from the admin panel instead (§3.3).
*If it says "This licence was moved to another computer recently…"* (`TRANSFER_LIMIT`): the move limit was hit. Check the policy (§3.3) and move it from the admin panel if appropriate.

### Reinstalled on the same PC
> Hi <name>, after reinstalling Social-Nexus (or Windows) on the same computer, just open **Settings → 🔑 Licence** and activate again with the same key (or the same coupon). Social-Nexus recognises the PC and gives you back the same seat. It doesn't use an extra one. A coupon gives back the same coupon period.

*If they get SEATS_FULL anyway:* the hardware changed too much to match (3 of 4 parts needed, §2). Free the old device in the admin panel.

### Other licence codes
| Code | Meaning / action |
|---|---|
| `INVALID_KEY` | Not found. Check for typos (`SNXP-`/`SNXS-`), and check the customer isn't pasting the coupon or order id. Search by email. |
| `MISSING_KEY` | Nothing entered. |
| `REVOKED` | Licence cancelled (refund, abuse, revoked campaign) or deleted. Check the audit log for the reason before replying. |
| `SUSPENDED` | On hold. Check the audit log and resolve it with the owner. |
| `DEVICE_MISMATCH` | The licence file belongs to another PC (copied data folder, or a big hardware change). Ask the customer to **activate again** on this PC. If seats are full, free the old device. |
| `BAD_FINGERPRINT` | The app couldn't identify the PC. Ask them to update Social-Nexus. If it persists, collect logs and escalate. |
| `RATE_LIMITED` | Too many attempts from one network (30 activations per 15 minutes). Wait 15 minutes. |
| `SERVER_ERROR` | Our side. Check server health (`/health`) and escalate. |

### Checkout and payment codes
| Code | Action |
|---|---|
| `BAD_EMAIL` | Invalid email at checkout. |
| `BAD_KEY` | Update-renewal purchase without a valid **one-time** key. |
| `NOT_CONFIGURED` | Yearly product missing its Razorpay plan (owner fix, §5). |
| `BAD_SIGNATURE` | "Payment could not be verified". Find the payment in Razorpay. If it's captured, the webhook normally completes the order within minutes. If not, escalate to an owner with the payment id. **Never ask for card details.** |
| `NOT_PAID` / `BAD_ORDER` | Checkout abandoned or mismatched. Ask the customer to try again. |

**Customer paid but got no key:** find the order by email in Orders. If it's `paid`, the key was shown once on the success page (and emailed **(planned)**). Since we can't show it again, issue a replacement as in "Lost licence key". If it's `created`, check Razorpay: if the payment was captured, the webhook should mark it paid. Escalate if not.

---

## 7. App (non-licence) support scenarios

| Customer says | First answer |
|---|---|
| "Windows protected your PC" when installing | Expected for early unsigned builds: **More info → Run anyway**. Only if they downloaded from radixile.com or our link. |
| "Ollama: not running" | Open Ollama from the Start menu. Run `ollama list`, and `ollama pull llama3.2` if empty. Then **Settings → Local AI → Check**. If the chosen model isn't downloaded, the app falls back to cloud AI and says so. |
| "API key rejected" | The key goes in **user menu (their name) → My API Keys**. Each user has their own keys. Re-paste with no spaces, and check the key is active on the provider's site. |
| "busy (503)" / "rate limit (429)" | The provider is overloaded or the free limit is used. Wait a minute, pick another model, or add a second free key (Groq/Gemini). |
| Other users can't use AI | Since 2.1 each user must add their **own** keys (or use Ollama). Shared install keys work only for the admin who set up the install. |
| Posts fail "… rejected the connection … Reconnect" | Settings → Social Platforms → Disconnect → Connect (accept all permissions), then 🔁 Retry. Google Testing-mode apps expire every 7 days. |
| "Interrupted while publishing — check the platform, then Retry" | The app closed mid-publish. Check the network first, and only Retry if the post is missing, to avoid duplicates. |
| Post failed with "Missed: it was due … but Social-Nexus wasn't running or wasn't licensed then. Use Retry to post it now." | **By design.** Posts more than **6 hours** overdue (PC off or asleep, app quit, licence not active) are never posted late, so a festival post doesn't go out a week later. If it's still relevant: Compose → ⚠️ Failed in the last 14 days → 🔁 Retry (needs an active licence). Calendar items: ✏️ Edit → reschedule. Advise keeping the app in the tray (close with ✕, don't Quit) and stopping the PC sleeping at posting times. Posts less than 6 hours late go out automatically. |
| Ollama slow, AI "stuck", or "nothing happens" | The first request after start takes about **30 s** while the model loads (and again after ~30 min idle). Ollama handles only a few requests at a time; extra AI actions **queue** and run in turn. Ask them to wait, not click again. Faster: `llama3.2:1b`, close heavy apps, or use a cloud key (Groq). Log marker: `[AI] Using Ollama (…) [queue: N]`. |
| "Publishing needs an active licence" / "Scheduling needs an active licence" | Publishing, scheduling, Retry, CSV import and email sending need an active licence. Writing, AI, planning and export always work. Check Settings → 🔑 Licence → Status. |
| Hit a users or workspaces limit | Limits count the whole installation (all users together). Upgrade, or remove unused workspaces or users. |
| Trouble connecting a platform | Point them to the **📘 Setup guide** on the platform's card in Settings → 🔗 Social Platforms. Tell them to use **📋 Copy** for the callback address (most failures are a typed address). X uses `127.0.0.1`, the others `localhost`. |
| Can't find help in the app | Sidebar → **❓ Help & User Guide** (last item), or the **❓** top-bar button / **F1** for help on the current screen. The help page has **🖨 Print / Save as PDF**. |
| Facebook "No Facebook Page selected" | **📄 Select Facebook Page** on the card (Managers only). |
| Can't connect, buttons do nothing | Connect, disconnect and Page/board selection need the workspace **Manager** role. Saving app credentials needs the install **admin**. |
| Teammate's invite link fails | They must sign in with the **invited email**, then click **Join workspace**. Links don't work for other emails. |
| Email campaign can't be edited or resent | Sent campaigns are locked. Duplicate it. Unsubscribe replies must be marked in Email Marketing → Subscribers. |
| "Port 3000 In Use" | Try to Connect. Otherwise quit from the tray, end Social-Nexus in Task Manager, and close other apps using port 3000. |
| Startup error dialog | It shows the real reason and the log folder. Collect logs (§8). |
| Old NEXUS data missing | It's moved automatically to `%APPDATA%\Social-Nexus` on first start. Check there before they delete the old copy. |
| Uninstall / data | The uninstaller asks whether to delete data. **No** (the default) keeps it. Updates never delete data. |

Known limitations to set expectations (October 2026): LinkedIn posts to the personal profile only (company Pages need LinkedIn's Community Management API approval); X is "Works with limits" (the customer's X API plan must allow posting; text only, no images); YouTube and TikTok are "Not available yet" (YouTube: no public Community-post API; TikTok: needs a public https redirect and an audited app); Google Business Profile is "Works with limits" (needs Google's API access approval); the manual token box exists only for Facebook; images are added by public URL only; Compose-scheduled posts don't show on the Calendar; teammates must use the same PC. Collect details and log a ticket for engineering rather than promising dates.

---

## 8. Collecting logs from a customer

Send this:

> To help us look into this, please send us your Social-Nexus log file:
> 1. Press the **Windows key + R** together.
> 2. Paste `%APPDATA%\Social-Nexus\logs` and press **Enter**.
> 3. Attach **server.log** (and `server.1.log` if it's there) to your reply.
> 4. If you can, also attach a screenshot of the error and tell us roughly what time it happened.
> The log stays on your PC unless you send it. You can open it in Notepad first to see what's in it. **Please don't send passwords, API keys or any other files from that folder.**

Notes for support:
- Logs rotate at 2 MB, with up to 3 files kept (`server.log`, `server.1.log`, `server.2.log`). Times are in UTC (ISO format, ending in `Z`). IST = UTC + 5:30.
- Useful markers: `[AI] Using Ollama (…) [queue: N]` (N = requests waiting), `[AI] Using …` / `… failed:` (AI provider choice and failure reason), `[Ollama] Running but model … not found`, `[Auth] <Platform> error:` (OAuth failures, often including the network's exact error), `[Scheduler] … failed on <platform>:`.
- If the app won't start at all, the startup error dialog shows the reason and the same log folder.
- **Don't ask for** `nexus.db`, `sessions.db` or `.env`. They contain tokens, keys and passwords. If you need the app version, it's in Settings → About, or in the tray menu.
- Delete customer logs from the ticket once the issue is closed.

---

## 9. Escalation

| Situation | Escalate to |
|---|---|
| Payment captured but no licence after 30 minutes, signature errors, refunds over policy | Owner (payments) |
| Suspected key sharing or coupon abuse (many devices, leaked public code) | Owner. Consider suspending the licence or revoking the campaign. |
| `SERVER_ERROR`, licence server down, `payments_mode = mock` in production | Engineering, urgently |
| Reproducible app bugs | Engineering ticket with logs, steps, app version and Windows version |

# Social-Nexus — Windows Distribution, Code Signing & Licensing

Status: proposal · 2026-10-25 · Scope: **Windows first** (macOS later, as covered in `offline-desktop-architecture.md`).
Requirements from Radixile:
- both **one-time (perpetual)** and **yearly subscription** licences
- **coupon codes for temporary activation**
- no code-signing certificate yet

---

## 1. Code-signing certificate options for Radixile (India)

| Option | Cost (approx.) | Available to an Indian LLP? | Removes the SmartScreen warning? | Practical notes |
|---|---|---|---|---|
| **Microsoft Store (MSIX package)** | **Free.** Microsoft signs the package. Company developer registration became free in May 2026. | ✅ Worldwide | ✅ No warnings for Store installs | The Store version must be built as MSIX (electron-builder `appx` target). Microsoft's certification takes a few days per release. Good as a **second channel**. |
| **Sectigo OV** (from a reseller) | ~$219–320/yr (Indian resellers list ~₹19,000–26,000/yr + GST) | ✅ | ⚠️ Reputation builds over downloads | The key must sit on a USB token (shipped to you) or in a cloud HSM. Cheapest common option. |
| **SSL.com OV + eSigner (cloud)** | Certificate ~$129/yr + eSigner from $180/yr (20 signatures a month) ≈ **$310/yr** | ✅ | ⚠️ Same as above | **No USB token**: signing works from a build server (GitHub Actions). The first 30 days of eSigner are free. |
| **DigiCert OV (+ KeyLocker cloud)** | ~$400–440/yr | ✅ | ⚠️ Same | A premium brand. No longer offers multi-year plans. |
| EV certificate (any CA) | $400–685/yr | ✅ | ⚠️ **No longer instant** (Microsoft removed EV's bypass in 2024) | Not worth paying extra for. |
| Azure Artifact Signing | ~$9.99/month | ❌ Organisations in the US, Canada, EU and UK only | — | **Not available to Radixile** (an Indian LLP) at present. |

Facts that affect the choice:
- From 1 March 2026, code-signing certificates last at most **~458 days**, so expect to renew every year or so.
- **No certificate removes SmartScreen on day one.** Reputation builds up as people download files signed with the same identity. The Store is the only route with no warning from the first install.
- Validation needs: the LLP registration certificate, a matching address and phone number in a public directory or D-U-N-S listing, and a few working days.

**Recommendation**
1. **Website download (main channel):** an **OV certificate with cloud signing** (SSL.com eSigner, or Sectigo/DigiCert with a cloud HSM). Cloud signing avoids USB-token shipping and customs, and works in automated builds. Budget ≈ ₹25–30k per year.
2. **Microsoft Store (second channel, free):** an MSIX build with free signing and no SmartScreen warning. You can sell through your own licence keys (0% Store commission when you take payment yourself, as Microsoft permits for non-game apps). Confirm this against the Store policy at submission time.
3. Start the certificate validation **now**. It is the longest lead-time item.

---

## 2. Licence models

| | **One-time (Perpetual)** | **Yearly subscription** | **Coupon (temporary activation)** |
|---|---|---|---|
| Payment | Once (Razorpay order) | Every year (Razorpay Subscriptions, auto-renew) | None |
| App works | **Forever** for versions released during the update period | While the subscription is active, plus a **7-day grace period** after a missed renewal | For the coupon's **duration** (e.g. 7, 14 or 30 days) |
| Updates | 1 year included (`updates_until`). After that, optional "update renewal" at a lower price, or keep using the last eligible version | Always included | Included during the period |
| When it ends | Never ends. Updates stop after `updates_until` | **Limited mode**: view, export and drafts allowed; publishing, AI auto-posting and SEO automation stop | Limited mode, plus a "Buy" prompt |
| Seats | Per edition (Individual 1 PC, Agency N PCs) | Same | 1 PC |
| Convert | Upgrade Individual → Agency (pay the difference) | Switch plan at renewal | Enter a paid key at any time; all data is kept |

**Never lock users out of their data.** Limited mode always allows viewing, export and backup.

### Editions (numbers are placeholders for Radixile to decide)
| | Individual | Agency |
|---|---|---|
| PCs (seats) | 1 (+1 transfer every 90 days) | 3 / 5 / 10 |
| Workspaces (brands or clients) | 1 | 25 |
| Users on the install | 2 | 10 |
| Autopilot rules | 3 | Unlimited |
| SEO sites | 1 | 10 |
| Postgres / team mode | ❌ | ✅ |

---

## 3. Coupon codes (temporary activation)

**Format:** `SNX-7K3Q-M9PD` (prefix + 8 characters from an unambiguous alphabet). Only a **hash** of each code is stored on the server.

**What Radixile defines for each coupon or batch** (in the licence admin panel):

| Field | Example | Purpose |
|---|---|---|
| `campaign` | "Diwali-2026-demo" | Grouping and reporting |
| `edition` | individual / agency | Which features it unlocks |
| `duration_days` | 14 | How long the activation lasts after it's redeemed |
| `valid_from` / `valid_until` | 2026-11-01 → 2026-11-30 | The window in which the code can be **redeemed** |
| `max_redemptions` | 1 (personal) or 500 (public promo) | Total number of uses |
| `per_machine_once` | true | The same PC can't redeem the same campaign twice |
| `per_email_once` | true | The same email can't redeem the same campaign twice |
| `allow_after_trial` | false | Whether a PC that already used its built-in trial may redeem it |
| `stackable` | false | Whether a second coupon can extend the first (normally no) |
| `note` / `issued_to` | "Partner: XYZ Agency" | Tracking who received it |
| `status` | active / paused / revoked | Kill switch |

**Rules that stop coupons becoming endless free use**
- Redemption needs **internet once**, so the server can count uses and check the PC and email.
- The redeemed licence file is **signed and bound to the PC**, so copying it elsewhere fails.
- Optional: one coupon activation per PC per 90 days across all campaigns.
- The app checks for the clock being moved backwards. If time goes back more than 24 hours compared with the last check, it asks to go online.
- Revoking a campaign takes effect at the app's next online check (the app checks daily when online).

**Discount coupons** (for example 20% off the purchase) are a separate type, applied at checkout on the website. Razorpay supports offers, or our server adjusts the order amount.

---

## 4. How activation works

### Licence key (paid)
1. The customer pays on the website through Razorpay.
2. A webhook goes to the licence server, which creates a licence and emails the key (`SNXP-…` for one-time, `SNXS-…` for subscription) plus a GST invoice.
3. In the app: **Activate → enter key → online check**.
4. The server checks the key, the seat count and the device, then returns a **signed licence file**.
5. The app saves the file and works **offline**, rechecking every 7 days. Grace periods: 30 days for one-time, and for subscriptions until the renewal date + 7 days.

### Coupon
The same flow with the coupon code. The server applies the coupon rules from section 3 and returns a signed file with `type: coupon` and `expires_at`.

### Fully offline activation (rare, for example a customer with no internet)
The app exports a request file `activation.snreq`. The customer uploads it on the Radixile website from any internet-connected device and receives `license.snlic` back to import. Coupons **cannot** be redeemed this way, which prevents abuse.

### Signed licence file (the server signs with an Ed25519 private key; the app holds only the public key)
```json
{ "v":1, "lic":"L-000123", "type":"perpetual|subscription|coupon", "edition":"individual",
  "licensee":"Priya Sharma / Chai Point Cafe", "email":"…",
  "device":"<hashed fingerprint>", "seats":1,
  "issued_at":"…", "lease_until":"…", "expires_at":null, "updates_until":"2027-10-25",
  "feat": { "publish":true, "autopilot_rules":3, "seo_sites":1, "workspaces":1 },
  "sig":"<Ed25519 signature>" }
```

**PC fingerprint:** hashed values of the motherboard/BIOS ID, the Windows MachineGuid, the system disk serial and the CPU ID. The licence still matches if 3 of the 4 are unchanged, so replacing a disk or RAM doesn't lock the customer out. Raw IDs never leave the PC.

---

## 5. Anti-tamper measures for the Windows build

| Layer | What we do | Effect |
|---|---|---|
| Signed licence (section 4) | Ed25519; the public key is embedded in the app | Licences can't be forged or edited |
| Machine binding + seats + revocation | Server-side | Stops sharing keys and copying installs |
| Checks spread through the code | Enforced in the **server** at publish, autopilot, SEO and export, not just at startup | One patched line doesn't unlock everything |
| Bytecode + obfuscation | Licence and core server modules compiled with **bytenode**, using the same Node version as the bundled `node.exe` | Code is hard to read or patch |
| File integrity manifest | A signed hash list of the app files, checked at startup | A modified copy refuses to run |
| Code signing (section 1) | App, installer, uninstaller and `node.exe` | Patched copies lose the "Radixile" signature |
| Electron fuses | Disable `RunAsNode` and the inspector; enable asar integrity | Closes common debugging and injection routes |
| Online value | Updates, festival / "this day" feed, autopilot content feed need a valid licence | A cracked copy goes stale |
| Visible licensee | "Licensed to Priya Sharma" in About, on exports and in the footer | Discourages sharing; supports legal action |
| Legal | EULA (India IT Act / Copyright Act), takedown process | Recourse against resellers of cracks |

The honest limit: a determined cracker can still get through with effort. These layers stop casual sharing (the main revenue risk) and make cracked copies stale and untrustworthy.

---

## 6. Licence server (small hosted service, separate repo)

**Stack:** Node + Postgres on a small VPS (or Fly.io/Render) at `license.radixile.com`. Razorpay handles payments and invoices.

**API**
| Endpoint | Purpose |
|---|---|
| `POST /v1/activate` `{key \| coupon, fingerprint, app_version, email?}` | Returns the signed licence, or `SEATS_FULL` / `COUPON_USED` / `EXPIRED` / `REVOKED` |
| `POST /v1/refresh` `{lic, device}` | Returns a new lease, or the revocation status |
| `POST /v1/deactivate` | Frees a seat (moving to a new PC) |
| `POST /v1/offline/request` | Handles the `.snreq` upload and returns `.snlic` |
| `POST /webhooks/razorpay` | Payment captured, subscription charged, cancelled, refunded |
| `GET /v1/updates/latest?channel=` | Update feed, gated by `updates_until` / `expires_at` |
| **Admin panel** | Licences, devices, coupon campaigns (create, pause, revoke, export CSV), refunds, reports |

**Tables:** `customers`, `licenses`, `devices`, `activations`, `coupon_campaigns`, `coupon_codes` (hash, campaign, redeemed_by, redeemed_at), `payments`, `subscriptions`, `audit_log`.

**App side (this repo):**
- `electron/license/` — fingerprint, keystore, and the activation window
- `services/license/` — verify, entitlements and lease refresh
- `routes/license.js` — the Activate / Status / Deactivate UI API
- `public/activate.html` — Enter key or coupon · Buy · Offline activation

---

## 7. Windows release checklist (per version)
1. Run a clean build on CI (GitHub Actions `windows-latest`): `npm ci`, run the tests, then build.
2. Compile the licence and core modules to bytecode, then write and sign the integrity manifest.
3. Sign `node.exe`, `Social-Nexus.exe`, the installer and the uninstaller (cloud signing).
4. Scan on VirusTotal. Then run the install, upgrade-from-previous, offline, uninstall-keeps-data and activation tests on clean Windows 10 and 11 VMs.
5. Publish the installer and checksum, update the feed, and submit the MSIX to the Store.

## 8. Order of work
| Step | Work | Est. |
|---|---|---|
| 1 | Rename to Social-Nexus; fix packaging/native modules; remove the firewall rule; make the uninstaller keep data; test build | ~1 wk |
| 2 | Start **certificate validation** (in parallel); auto-updater; CI build pipeline | ~1 wk + CA wait |
| 3 | Licence server: keys, devices, **coupons**, admin panel, Razorpay one-time + subscriptions, GST invoices | ~2 wks |
| 4 | App licensing: activation UI, signed-file verification, entitlements, limited mode, bytecode + integrity | ~1–2 wks |
| 5 | First signed paid release (website) → MSIX Store submission | ~1 wk |

## 9. Decisions needed
1. **Prices:** one-time (e.g. Individual ₹X, Agency ₹Y), yearly (₹A, ₹B), and the update-renewal price for one-time buyers.
2. **Edition limits** (section 2 table).
3. **Default coupon duration** (7, 14 or 30 days) and whether coupons may follow a used trial.
4. **Built-in trial:** a 14-day trial with no code as well, or coupons only?
5. **Hosting** for `license.radixile.com`, and who handles refunds and support.

## Sources
- Microsoft — [Code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- Microsoft — [Company Store registration now free (May 2026)](https://blogs.windows.com/windowsdeveloper/2026/05/07/publish-to-microsoft-store-as-a-company-now-with-free-registration-and-faster-onboarding/)
- Microsoft Q&A — [Artifact Signing for a company registered in India](https://learn.microsoft.com/en-us/answers/questions/6041339/artifact-signing-trusted-signing-for-a-company-reg)
- SSL.com — [eSigner pricing](https://ssl.com/guide/esigner-pricing-for-code-signing/)
- SSL Dragon — [Sectigo vs DigiCert 2026](https://www.ssldragon.com/blog/sectigo-vs-digicert/) · [Code signing providers 2026](https://www.ssldragon.com/blog/code-signing-certificate-providers/)
- CodeSignCert.in — [Indian reseller pricing](https://codesigncert.in/)
- ToDesktop — [EV certs no longer grant immediate reputation](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore)

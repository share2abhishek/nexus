# Social-Nexus — Full UI Test Report

**Date:** 2026-10-23 to 2026-10-25 · **Build:** branch `feature/phase-1b-content-model-calendar` + Phase 0 fixes (uncommitted)
**How:** the real app was run in the built-in browser against a throwaway database (your `data/nexus.db` was not touched). Two test users were used. The testing was organised around real use cases, looking at ease of use and ease of configuration as well as plain bugs.

Severity: 🔴 broken or unsafe · 🟠 a user gets stuck or confused · 🟡 polish

---

## Use cases tested

| # | Use case | Result |
|---|---|---|
| UC1 | First run: register → set up AI → connect first account | 🟠 Registration works. Connecting a platform is a dead end for a non-developer (F17, F18, F19). |
| UC2 | Write a post with AI and publish | 🟠 AI works (Gemini). Multi-platform output is pasted as one post (F20, F21, F22). |
| UC3 | Plan the week: schedule, calendar, festivals | 🟠 Scheduling and the cron job work. Two separate systems that don't see each other (F28). No festivals on the calendar (F29). |
| UC4 | Agency: add a client, switch to it, invite a teammate | 🔴 Switching to or managing a default workspace is impossible (F33). Duplicate workspaces (F32). |
| UC5 | Configure AI and email, send a campaign | 🔴 A new campaign never sends and creates duplicates (F41). Three different screens for keys (F12, F40). |
| UC6 | Admin: users, invite codes, registration mode | ✅ Works (invite-only mode correctly rejects missing or bad codes). Stats show 0 (F46). |

## What works well ✅
- Register, log in, log out, password-length validation, first user becomes admin
- Data isolation between users: user 2 sees none of user 1's posts, templates, content or accounts; admin APIs return 403 for user 2
- AI Generate with Gemini; switching models (Gemini ↔ Groq) from the generate page; clear per-provider error messages
- The Ollama tab detects that Ollama is missing and shows a 3-step install guide (matches your decision)
- Scheduling from Compose stores IST correctly, and the cron job publishes on time (failure correctly recorded)
- Content workflow draft → review → approved → scheduled → (published | failed)
- AI Assist on a content item (hashtags are now added to the post, variants are shown, and the badge shows the real provider)
- Templates save and use; brand kit save; UTM builder save; email subscribers (duplicates now blocked)
- Hashtag research (about 2 s); invite links work; invite-only registration
- No JavaScript errors and no failed API calls while loading any of the 20 pages

## Fixed during testing (10)
1. Retired Gemini model (404) → `gemini-flash-latest` alias, which can be overridden
2. Welcome wizard appeared on every page load
3. "No AI provider available" hid the real reasons (busy, bad key, Ollama not running)
4. The content editor showed no social accounts
5. The AI Assist badge always said "Claude"
6. The activity log said "Submitted by" when the item was only created
7. **AI Assist Hashtags/Variants overwrote the whole post**
8. Gemini calls had no timeout (the spinner ran forever)
9. Duplicate email subscribers were allowed
10. Raw "Request failed with status code 401" publish errors → "LinkedIn rejected the connection… Reconnect"

---

## Open findings

### 🔴 Broken or unsafe
| ID | Finding |
|---|---|
| F33 | Every default workspace is named "Name's Workspace". The apostrophe is injected raw into `onclick` → SyntaxError. Clients → Manage / Delete and the header workspace switcher do nothing. |
| F41 | Email → Send on a new campaign saves it, then says "Save the campaign first". It never sends, and every click creates another duplicate campaign. |
| F32 | Registration created the default workspace and org **twice** (race condition). |
| F48 | AI image generation fails: "model 'dall-e-2' does not exist" (it falls back to a retired model). The free Google key could produce images instead (Gemini image models). |
| F45 | 11 toolkit AI features (SEO ×4, hashtags, ad copy, press release, best times, email writer, captions ×2) ignore the user's own keys, Ollama and model choice, and only use the shared `.env` key. |
| F37 | An invite link isn't tied to the invited email (anyone with the link joins). Accepting resets an existing member's role. Joining happens instantly on page load. |
| F16 | Any logged-in user can overwrite the app-wide social app credentials (writes `.env`, no admin check). |
| F9, F44 | Template and campaign JSON is inlined into `onclick` attributes. A quote in the content breaks the button, and it is an injection risk. |
| F43 | Campaign emails have no unsubscribe link or header (legal requirement). |
| F3 | LinkedIn uses the retired `r_liteprofile` scope and `/v2/me`, which fails for new LinkedIn apps. |
| F2 | Callback URLs are hard-coded to `localhost:3000` and break on any other port. |

### 🟠 Users get stuck or confused
| ID | Finding |
|---|---|
| F17 | Clicking Connect/Refresh before credentials are entered opens a raw JSON page: `{"error":"LINKEDIN_CLIENT_ID not configured in .env"}` |
| F18 | Platform cards say "Client ID / Secret / Callback URL / scopes" with no explanation and no steps. |
| F19 | Welcome wizard: every platform button goes to the general Settings page; any click marks setup as "done" forever; it doesn't detect what's already set up. |
| F20 | Multi-platform AI output arrives as one text with `**LinkedIn** … **Instagram**` sections, and → Compose pastes all of it as one post. |
| F21 | Platforms chosen in AI Generate are lost in Compose. |
| F22 | AI output contains Markdown `**bold**`, which social sites show as literal asterisks. |
| F23 | The Brand Kit is never used by AI, so the AI invents facts ("stores across India"). |
| F24 | Three different editors for one job (AI Generate, Compose & Post, Calendar → New Content). |
| F28 | Two scheduling systems: posts scheduled in Compose never appear on the Calendar. |
| F5 | Failed scheduled posts silently disappear from the list (no notice, no retry). |
| F30 | A solo user has to "submit for review" and "approve" their own draft before scheduling it. |
| F12, F40 | AI keys live in three places: Settings → AI Keys (only Gemini/Claude, shared by everyone), user menu → My API Keys (per user, all providers), and Ollama. |
| F14 | The shared `.env` AI key is used by every local user (conflicts with "each user pays for own key"). |
| F38, F39 | Email setup: a raw host/port form with no Gmail/Outlook presets and no "Send test email". Saved values never reappear. Settings are global, not per client. |
| F42 | Error messages tell users to edit `.env` (developer jargon). |
| F36 | "📩 Send Invite" sends nothing; it only shows a `localhost` link, so teammates on other PCs can't join (product decision needed, see below). |
| F25, F26 | No warning for the Twitter/X 280-character limit, or for Instagram/TikTok without an image or video. |
| F27 | Images can only be added by public URL; there's no upload from the computer. |
| F29 | Indian festivals aren't shown on the calendar. |
| F8 | Template `{placeholders}` are pasted literally into the post. |
| F11 | At about 800 px window width the sidebar covers the content and the page overflows. |
| F1 | 20 menu items in 8 sections, too many for an individual. |

### 🟡 Polish
F6 "Platforms 1/5" (there are 8) · F7 "Total posts" counts failed posts · F10 user-menu items look blank · F13 wizard "done" is remembered per browser, not per user · F15 `/workspaces/:id` ignores the id · F31 jargon calendar subtitle · F34 required "slug" field when adding a client (timezone default is already IST) · F35 members table shows user ids · F46 admin user list shows 0 posts / AI uses / platforms · "Last active: Never" for active users · "Simulate Data" button produces fake analytics in the real product

### Existing schedulers (checked as requested)
- **One cron job** (`services/scheduler.js`, every minute) publishes due posts from Compose (`scheduled_posts`) and from the Calendar (`content_items`).
- **"Recurring posts"** (`routes/tools.js /recurring`) are stored in memory only: lost on restart, shared across all users, no UI, and **never executed**.
- **No AI auto-generation scheduler exists.** **No SEO automation exists:** "tracked keywords" only stores a position the user types in.

### Could not test here (needs real accounts)
Real OAuth connect and publish for each platform, the Facebook Page picker, Ollama models (not installed on this PC), a real SMTP send, and video generation.

---

## Requested features (to implement after the bug fixes)
| ID | Request |
|---|---|
| R1 | **Very simple app:** a simple menu (Home · Create Post · Calendar · Accounts · Settings) with "More tools" hidden, and one Create Post editor. |
| R2 | **Connect social media with proper links and a step-by-step guide** for each platform: what you need, exact developer-portal links, the exact callback URL to copy, permissions, and Test / Connect. |
| R3 | **Auto-pilot posting:** AI generates and posts to all connected sites on a schedule, based on themes such as "festival today", "this day in history", "famous person's birthday today", or custom keywords. Needs rules (theme, platforms, time, frequency), an optional review-before-post step, a history log and failure alerts. Builds on the existing cron job; replaces the dead in-memory "recurring" feature. |
| R4 | **Rename** to "Social-Nexus by Radixile Technology Solutions": window title, login, sidebar, landing/help pages, installer `productName`. |
| R5 | **Fully automated SEO with no human intervention:** scheduled keyword research, automatic meta/SEO text for the user's website pages, real rank tracking, SEO-optimised captions and hashtags in auto-pilot posts, and a periodic report. |

## Decisions needed
1. **Auto-pilot safety:** post fully automatically, or hold each AI post for a quick approve (with optional auto-approve after N hours)? Default proposal: **automatic, with a daily summary and a one-click "pause"**. Facts such as birthdays and history are checked against a data source, not invented by the AI.
2. **SEO target:** which website(s) should SEO automation work on, and can we use Google Search Console (free, gives real rankings) for each site?
3. **Teams across PCs (F36):** the desktop app only accepts connections from this computer (127.0.0.1). Should agency teammates on other PCs be able to connect (LAN mode), or is one shared PC fine for now?

---

## Status after the fix round (2026-10-25)

**Fixed and checked in the browser:**
- F33 apostrophes broke buttons (also fixed: `escapeHtml` didn't escape quotes; the `encapeHtml` typo crashed SEO keyword results; new `jsAttr()` for every inline handler argument, 31 places)
- F9/F44 JSON inlined into handlers · F41 campaign never sent / duplicates · F32 duplicate default workspace (test added; fails on the old code with 5 workspaces)
- F17 Connect with no credentials → back to Settings with a plain message · F42 `.env` wording in the email/connect errors
- F45 the 11 toolkit AI calls now use the user's own keys, Ollama and chosen model · F16 app-wide settings are admin-only · F37 invites bound to the invited email, and existing roles are kept (test added)
- F5 failed scheduled posts are listed with the reason and 🔁 Retry · F6 "1/8" · F7 failed posts not counted
- F20 one post per platform (cards, each with → Compose) · F21 platforms carried over · F22 Markdown stripped · F23 Brand Kit used, and "don't invent facts"
- F25/F26 Compose warns about platform character limits and missing images/videos (and blocks posting)
- F10 unreadable user menu · F13 wizard per user · F31 calendar subtitle · F34 slug optional · F35 member names · F46 admin stats

**Fixed in code, not verifiable here:** F48 image generation (GPT Image / Gemini Image; the Google key needs billing for images).

**Still open (larger work, see `docs/architecture/offline-desktop-architecture.md`):**
F1, F24, F30 simple UI + single editor (R1) · F2, F3, F4, F18, F19 guided connect (R2) · F28, F29 unified scheduling + festivals on the calendar · F8 template placeholders · F11 narrow-window layout · F12, F14, F40 one place for AI keys · F15 · F27 image upload · F36 team access across PCs · F38, F39 email setup presets/test/load · F43 unsubscribe link · R3 Autopilot · R4 Rename · R5 SEO automation

---

## Found while writing the user documentation (2026-10-26)
| ID | Finding |
|---|---|
| D1 | LinkedIn still requests the retired `r_liteprofile`/`r_emailaddress` scopes, so new LinkedIn apps can't connect (same as F3) |
| D2 | The X callback is fixed to `localhost`; X recommends `127.0.0.1` and may reject `localhost` |
| D3 | TikTok web apps need an https redirect (desktop needs PKCE, which isn't implemented), so connecting TikTok is likely impossible. Posts are sent as public, which unaudited apps can't do |
| D4 | YouTube "community posts" call an API endpoint that doesn't appear to exist |
| D5 | **Compose schedule picker defaults to a UTC time shown as local**, so in IST the default is ~4.5 hours in the past |
| D6 | Raw messages remain: "OAuth error: google_failed"/tiktok_*; "Add GROQ_API_KEY"; media hints say "…KEY in .env"; "Settings → My API Keys" is actually in the user menu |
| D7 | "Paste token manually" (Graph API Explorer steps) shows on every platform card; the X card lists OAuth2 scopes but the app uses OAuth1.0a; optional Access Token fields look required; the model dropdown says "Claude 3.5"; About shows v2.0.0; one startup warning still says NEXUS; the dashboard starts at "0/5" |
| D8 | X posts drop the image; no Pinterest image warning; **partly failed posts are marked published**; CSV-imported posts skip the character/media checks |
| D9 | The content folder defaults to `D:/social`, which doesn't exist on most PCs |
| D10 | Festivals only appear for the next 7 days (see also F28/F29) |
| D11 | Tokens, API keys and the SMTP password are stored unencrypted in `nexus.db`/`.env` (planned: DPAPI encryption) |
| D12 | The licence UI labels must match the docs once built ("Settings → Licence", "Deactivate this PC") |

## Re-test 2026-10-28: Ollama running (http://localhost:11434, v0.24.0)

Earlier "Ollama not running" results came from Ollama being off during that run. With it running:

| Feature | Result | Time |
|---|---|---|
| Write post (auto chain) | OK, used `ollama:llama3.2`, brand kit applied | 30 s (cold model load) |
| Write post (Ollama picked explicitly) | OK | 5 s |
| Ad copy | OK | 32 s |
| SEO keywords, hashtags | OK | 95 s / 209 s (waited behind other requests in the single Ollama queue) |

New findings
- **F49 (fixed):** the welcome guide's "Setup AI" step always said "Download from ollama.com", even with Ollama running and a model ready. It now checks and says "Ollama is running … llama3.2 is ready."
- **F50 (open):** Ollama handles one request at a time. Several AI actions at once can wait minutes with only a spinner. Show "Waiting for local AI (n ahead)…" and allow cancel.
- **F51 (open):** the user setting `ollama_enabled` is `false` while the default text model is `ollama` and status says enabled. Generation still uses Ollama, but the two switches disagree. Merge them into one "Use local AI" switch.

## Status update 2026-10-28
Fixed in code since the fix round: **F2** (callback URL follows the real port, services/platforms/callback.js), **F3 / D1** (LinkedIn uses OpenID Connect: openid profile w_member_social), **D2** (X callback uses 127.0.0.1), **F4/F18/F19** (Setup guide on every platform card), **F43** (unsubscribe link + List-Unsubscribe), **F11** partly (header fits at 960 px). See also docs/testing/2026-10-28-ux-review.md.

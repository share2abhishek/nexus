# Product Marketing Context

**Document version:** v1 (auto-drafted from the codebase; needs owner review)
**Last updated:** 2026-11-22

> Sources: `public/landing.html`, `public/index.html`, `package.json`, `docs/RELEASE-NOTES.md`, `NEXUS-DEV-GUIDE.md`.
> Items marked **[CONFIRM]** are inferred or missing; the owner should correct them.

## Product Overview
**One-liner:** NexaDrip is an AI-powered digital marketing and bot platform: social posts, WhatsApp, sales outreach and Google/SEO in one place.
**What it does:** Plans and publishes social posts to Facebook, Instagram, LinkedIn, X, Pinterest, Threads, Bluesky and Google Business from one calendar. Runs WhatsApp auto-replies, broadcasts and a shared inbox. Finds businesses to sell to and sends personal outreach emails. Audits a website the way Google reads it and gives a plain-words to-do list. AI writes the first draft in the user's own words.
**Product category:** Social media, WhatsApp and SEO marketing tool (internal codename: Social-Nexus / NEXUS).
**Product type:** SaaS (hosted edition) plus a desktop app (Electron) and a server edition.
**Business model:** 14-day free trial, no card. Individual ₹1,275/mo, Agency Pro ₹10,200/mo, Enterprise custom (ex-GST; yearly billing gets two months free). Free plan after trial for one brand. Positioned about 15% below the usual tools. Users can bring their own AI key (Gemini, Groq, OpenAI, Claude and others) or use AI credits in bigger plans.
**Company:** Radixile Technology Solutions LLP, https://radixile.com, app at https://nexus.radixile.com.

## Target Audience
**Target companies:** Small Indian businesses (bakeries, clinics, cafes, interior firms) and the agencies that run marketing for them. **[CONFIRM]** whether to expand beyond India.
**Decision-makers:** Business owner or founder; agency owner or manager.
**Primary use case:** Keep social, WhatsApp, outreach and Google presence active without hiring a team or learning five tools.
**Jobs to be done:**
- Post consistently on many platforms without writing each post by hand.
- Answer customers on WhatsApp quickly, even at midnight.
- Find new business customers and email them without spending hours.
- Know what is wrong with the website for Google and fix it in plain steps.
**Use cases:**
- Festival and offer posts (Diwali, Eid, Onam, Pongal), in Indian languages.
- Bulk scheduling from an Excel sheet or from web pages and text files (Content Studio).
- WhatsApp menus, keyword answers, away messages, template broadcasts.
- Agency client workspaces with approval links and monthly PDF reports.

## Personas
| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| Small business owner (user and buyer) | Time, cost, not looking silly in front of customers | No marketing staff, many tools | One place, AI drafts, fair ₹ pricing |
| Agency owner (buyer) | Margin per client, scale | Many clients, many logins | Separate workspace per client, one login, roles |
| Agency client (approver) | Control over what is said in their name | Wants to see it first | Approve from phone via link, no account |
| Team member (creator/reviewer) | Clear roles | Mistakes going live | Roles: manager, creator, reviewer |

## Problems & Pain Points
**Core problem:** Marketing for a small business is spread across social apps, WhatsApp, email tools and SEO tools, and nobody has time for all of them.
**Why alternatives fall short:**
- Western tools are priced in dollars and ignore Indian festivals, languages and WhatsApp.
- Single-purpose tools mean several subscriptions and logins.
- Fully automated AI tools post things the owner never saw.
**What it costs them:** Hours each week, missed customer messages, a quiet Google profile, a site Google cannot read.
**Emotional tension:** Fear of posting something wrong, guilt about neglected channels, worry that the website is hurting them without knowing it.

## Competitive Landscape
**Direct:** [CONFIRM names, e.g. Buffer, Hootsuite, Later, Wati, Sprinklr-type tools] — pricing in USD, not built for WhatsApp and Indian use.
**Secondary:** Separate WhatsApp tools, outreach tools and SEO tools used side by side — more cost and more logins.
**Indirect:** Doing it by hand, a freelancer or an agency — slow or costly.

## Differentiation
**Key differentiators:**
- Posts, WhatsApp, outreach and SEO share one calendar, brand and team.
- Built for India: ₹ pricing, GST, festivals, Indian languages.
- Bring your own AI key, or use included credits.
- Honest outreach: each email address marked found on their site, guessed or won't work; real addresses only.
- Agency model: separate workspace per client, approval by link, branded reports.
**How we do it differently:** Use one part or all of it; AI drafts, people approve (see Automation stance below).
**Why that's better:** Lower cost, fewer tools, less risk of embarrassing output.
**Why customers choose us:** Price about 15% below usual tools, plus one tool instead of four. **[CONFIRM]**

## Objections
| Objection | Response |
|-----------|----------|
| "AI will post something wrong in my name" | Drafts wait for approval by default; previews per platform before anything goes out |
| "Another tool to learn" | Start with one part; everything shares the same calendar |
| "Is my data safe?" | Saved logins encrypted, each business kept apart, export or delete any time |
| "WhatsApp rules / spam" | Meta-approved templates, STOP means stop, test send first |
| "Cold email gets me blocked" | Real addresses only, follow-ups stop on reply, daily limit |

**Anti-persona:** Large enterprises needing deep custom integrations (use Enterprise talk-to-us), and people wanting mass spam or purchased lists.

## Switching Dynamics
**Push:** Too many tools and subscriptions, missed WhatsApp messages, inconsistent posting.
**Pull:** One place, AI drafts, fair ₹ price, free 14-day trial with no card.
**Habit:** Posting by hand from phone apps, existing WhatsApp Business app, spreadsheets.
**Anxiety:** Losing control, AI mistakes, Meta approval for WhatsApp templates, moving client accounts.

## Customer Language
**How they describe the problem:**
- **[CONFIRM]** Collect verbatim quotes from customers, reviews and support chats. None found in the codebase.
**How they describe us:**
- **[CONFIRM]**
**Words to use:** "your posts, chats and customers in one place", "nothing goes out without your OK", "AI does the typing, you stay in charge", "first draft in your words".
**Words to avoid:** Jargon (CTR, funnel, SERP) without a plain explanation; claims of "fully autonomous".
**Glossary:**
| Term | Meaning |
|------|---------|
| Workspace | One brand or client with its own accounts, calendar and WhatsApp number |
| Broadcast | A WhatsApp offer sent to people who asked for it |
| Template | A Meta-approved WhatsApp message with fill-ins and buttons |
| SEO autopilot | Ongoing website checks with a to-do list |
| Content Studio | Turns pages, text or notes into posts for each network |

## Brand Voice
| Attribute | Means | Doesn't mean | Example line |
|-----------|-------|--------------|--------------|
| Plain | Short sentences, everyday words | Dumbed down | "Fair prices. About 15% below the usual tools." |
| Reassuring | Control stays with the user | Timid | "Nothing goes out without your OK." |
| Practical | Says what happens next | Hype | "Next: publish now, schedule, or send for review" |
| Local | Indian festivals, ₹, Pune examples | Stereotyped | "Diwali boxes are back… free delivery in Pune." |

**Tone by context:**
- Support: calm, step by step, names the exact button.
- Launch: say what changed for the customer, not the developer (as in the release notes).
- Errors: say what went wrong and what to do next.
- Sales: honest about limits.
- Social: friendly, light emoji **[CONFIRM]**.
**Terms we own:** NexaDrip, "Use one part. Or run all of it."
**Never use (and why):** "guaranteed rankings" (not provable); "fully automatic" (conflicts with approval promise unless the owner switches it on); AI tells like "it's not X, it's Y".

## Proof Points
**Metrics:** None in the codebase. **[CONFIRM]**
**Customers:** None listed. **[CONFIRM]**
**Testimonials:** None.
**Value themes:**
| Theme | Proof |
|-------|-------|
| One place for four jobs | Posts, WhatsApp, outreach, SEO in one calendar |
| Safe by default | Approval before send; client approval links; opt-outs honoured |
| Fair price | ₹1,275/mo Individual; about 15% below usual tools |
| Built for India | Festivals, Indian languages, GST, WhatsApp |

## Goals
**Business goal:** **[CONFIRM]** Paying subscribers (Individual and Agency Pro), mainly Indian small businesses and agencies.
**Conversion action:** Start the free 14-day trial. (Sign-up can be closed with `registration_mode = closed`, so check which mode is live.)
**Current metrics:** **[CONFIRM]**

## Automation stance
**Owner preference (2026-11-22):** wants *less* human intervention in automation, so routine work should run on its own with fewer manual approvals.
**Today's product promise:** "Nothing goes out without your OK" — posts, emails and suggested updates wait for approval.
**Proposed middle path [CONFIRM]:**
- Allow a per-workspace "auto-approve" setting for low-risk, repeatable jobs: scheduled posts from approved templates, Google Business reminders, SEO re-checks, WhatsApp keyword replies, follow-up emails inside an already-approved campaign.
- Keep a human check on: first email to a new contact, anything touching money, new WhatsApp templates, replies to unhappy or "asked to stop" contacts, and any change to budgets or tracking.
- Hard stops that never run unattended: opt-outs (STOP), daily send limits, bounce rate limits, and Meta/Google policy limits.
- Marketing copy must say "automatic where you choose", not "fully autonomous".

## Paid Ads
Not applicable: no paid ad account or budget found in the codebase. **[CONFIRM]**

## Learnings
_Empty. Add dated notes as work ships._

## Changelog
- v1 (2026-11-22): auto-drafted from the codebase.

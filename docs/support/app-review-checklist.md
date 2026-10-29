# Getting Radixile's own apps approved (Meta, LinkedIn, Google)

Today each customer creates their own developer app before connecting an account.
The goal (Phase 2, "one-click connect") is that customers sign in through
**Radixile's** approved apps instead. That needs approval from each platform, which
takes weeks, so start now. Only Radixile can submit these; nothing here is automatic.

Pages you will be asked for (already on the licence server):

| Asked for | Address |
|---|---|
| Privacy policy | `https://license.radixile.com/privacy` |
| Data deletion instructions | `https://license.radixile.com/data-deletion` |
| Website / support | `https://radixile.com`, `support@radixile.com` |

## Meta (Facebook + Instagram)

1. **Business verification** in Meta Business Settings → Security Centre (company
   documents: LLP certificate, GST, address proof). Takes 1–5 working days.
2. Create one app of type **Business** at developers.facebook.com, add the
   **Facebook Login for Business** and **Instagram** products.
3. Permissions to request (with "Advanced access"):
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` — post to the customer's Page
   - `pages_read_user_content` — read comments on the Page's posts (Inbox)
   - `business_management` — find Pages owned through Business Manager
   - `instagram_basic`, `instagram_content_publish` — post to Instagram
   - `read_insights`, `instagram_manage_insights` — analytics and client reports
   - `pages_manage_engagement`, `instagram_manage_comments` — first comment and replying to comments from the Inbox (include in the FIRST submission: one-click customers can't reply without them)
   - Don't ask for `pages_messaging` yet (private messages aren't used); unused permissions hurt the review.
4. For each permission: a short explanation and a **screen recording** showing it in
   Social-Nexus (connect a test Page, write a post, publish, show it on Facebook).
   Use a test Page and a test Instagram account; record in English.
5. Add the redirect address of the sign-in helper: `<PUBLIC_URL>/connect/callback/facebook`
   (e.g. `https://license.radixile.com/connect/callback/facebook`; the same pattern with
   `linkedin`, `google_business`, `pinterest`, `threads` for the other platforms).
6. Submit. Typical answer: 1–3 weeks, often with one round of questions.

## LinkedIn

1. Create an app at linkedin.com/developers, linked to the Radixile company Page
   (a Page admin must approve the link).
2. Products: **Sign In with LinkedIn using OpenID Connect** (instant) and
   **Share on LinkedIn** (instant, gives `w_member_social`).
3. For company Pages (posting as the business, not the person): apply for the
   **Community Management API** (`w_organization_social`, `r_organization_social`).
   This is a reviewed product; describe Social-Nexus as a scheduling tool for small
   businesses and agencies. Expect 2–6 weeks.
4. Ask for **refresh tokens** (programmatic refresh) when applying; without them
   customers must sign in again every 60 days (Settings shows a countdown).

## Google Business Profile

1. Google Cloud project for Radixile; enable the **My Business** APIs.
2. Request access with the **GBP API access form** (business.google.com/support →
   "Business Profile API"). Approval can take 2–4 weeks; the APIs return quota 0
   until approved.
3. OAuth consent screen: external, scope `business.manage`. Because it is a
   sensitive scope, Google's **OAuth verification** is also needed (privacy policy,
   home page, a video of the sign-in and posting).

## Threads

1. In the same Meta app (or a separate one), add the **Threads** use case.
2. Permissions: `threads_basic`, `threads_content_publish`, `threads_read_replies`,
   `threads_manage_replies` (Inbox), `threads_manage_insights` (analytics).
3. Redirect: `<PUBLIC_URL>/connect/callback/threads` — Threads only accepts https,
   so Threads is offered through one-click connect only.
4. Set `CONNECT_THREADS_ID` / `CONNECT_THREADS_SECRET` on the licence server.

## X (Twitter) and Pinterest

- **X:** the Free tier allows posting about 500 posts a month per app — fine for
  one customer's own app, too small for one shared Radixile app. A shared app needs
  the Basic tier (paid). Decide before Phase 2.
- **Pinterest:** apply for **Standard access** in the Pinterest developer portal
  (a short video of posting a Pin). Trial access only posts to sandbox.

## After approval

Put the approved app IDs and secrets on the connect helper server (Phase 2), never
in the desktop app. Customers who prefer their own developer app can keep using it.

# Social-Nexus release notes

Newest first. Every release has a section here; the tests fail if the version in
`package.json` has none.

**While working:** add a line under **Unreleased** in the same commit as any change a
customer or an installer would notice (new or changed feature, fix, setting, upgrade step).
Write it for the customer, not the developer.

**To release:** `npm run release -- <version>` (e.g. `npm run release -- 2.3.1`). It turns
Unreleased into the new version's section with today's date, sets the version in
`package.json`, `package-lock.json`, the help page and the technical guide, then commits
and tags `v<version>`. With the deploy hook installed (`scripts/deploy/install-hook.sh`)
that commit pushes the tag and deploys the hosted edition. Paste the section into the GitHub Release
(`gh release create ... --notes-file`) when you publish the desktop app.

---

## Unreleased

### Super Admin
- **Billing → Plans (staff only, off until switched on):** design plans by ticking features (ticking one ticks what it needs), set limits, put a plan on the price list or keep it private for one business, clone it, make it inactive, and see every saved version with who changed it and why. Changing a plan that businesses use asks for a reason. Today's plans are copied in with every feature on and today's limits and prices.
- **Billing → Prices & tax and Coupons:** dated prices per plan (a new price starts today or later and never changes past bills), discounts per billing cycle, dated tax rates (GST 0% to start), coupons, and a "try a price" bill preview.
- **Billing → Import:** a dry-run list of how each business would be brought into billing. Nothing is billed: importing is a separate step on the server and turns automatic invoicing off.

---

## 2.4.0 — 20 November 2026

### What’s new page
- **See what changed in each release inside the app:** Settings → What’s new lists every release, newest first, with what each one added or fixed. A "New" tag appears in the menu after an update until you open the page.

### Fixes
- **Hosted service security:** only Radixile staff can use the administration screens that cover every business, and nobody is made an administrator automatically on the hosted service.
- **No other company's name in your screens:** an example in the sales outreach setup and the fallback name for leads without a company named another business. They now use neutral wording ("Prospect", "Lead").
- **Desktop app, local content folder:** file names containing a backslash are refused, so a name can never point outside the folder on Windows.

### Content Studio
- **Web pages, text files or pasted text become posts:** add up to 10 items (.html, .txt, .md or pasted text) and AI writes a separate post for every network you pick, each with a heading and hashtags that suit that network. Check and edit them, then schedule them all in one go: the first at a time you choose, then one every hour, day or week. Posts that need review are saved as drafts instead.
- **Contacts and company lists:** a new Export button on Contacts downloads a spreadsheet, and Find companies can now just list websites and emails for an area without writing outreach emails.

### Website SEO
- **Finds sites that Google may read as empty:** pages whose text is added by JavaScript are flagged with what to ask your developer for, and inner pages that name the home page as their main address are flagged as a fix-first item.
- **Dead sitemaps are caught:** a sitemap listed in robots.txt that doesn't open now shows as a problem instead of "found". The check also tells you when a website opens at both the www and non-www address.
- **New "Sitemap & page titles" tab:** makes a `sitemap.xml` to download (type your page addresses when the site hides its links behind JavaScript) and writes titles and descriptions for up to 10 pages at once, ready to paste.

### Super Admin
- **Client setup tab:** a checklist in the Admin page for connecting a client's WhatsApp number straight to Meta (what the client does, what you do, and what Meta charges them). Ticks are kept in your browser, with a button to clear them for the next client.

### Website chat
- **New chat window:** the bot's avatar, name and a short description on the start screen, menu choices as buttons, voice typing where the browser supports it, a "start over" button, and full screen on phones. The name, avatar, description and colour are set per business on the server, so the website snippet needs only `data-token`.
- **Share page:** `/webchat/<token>` opens the chat full-size on its own address, to try it or send the link.
- **Edit the chat's look in the app:** Auto-replies → 7. Website chat now has the bot name, picture (upload, cropped to a square), welcome text, brand colour, message-box text and WhatsApp number, with a live preview of the start screen and of a real conversation. Saving updates every website using the chat at once; the embed code no longer needs `data-name` or `data-color`.
- **Bottom line and privacy policy in the website chat:** set your own text and link for the small line at the bottom of the chat (blank keeps "Powered by Radixile Technology"), and add a link to your privacy policy, shown under it. Only full web addresses (https://…) are accepted.
- Bot replies are no longer saved twice, and a visitor tapping through menus is no longer cut off after 6 replies in an hour.
- A visitor who types their phone number now gets the "we have noted your number" answer instead of the general fallback.

### Website (hosted edition)
- **Sign-up and pricing can be hidden** without a deploy. With `registration_mode = closed` the website has no sign-up buttons or trial text and the sign-in page has no "Create Account"; people invited to a business's team can still create their account. With `show_pricing = off` the Pricing section, its menu link and the prices search engines read are left out. Both are rows in `platform_config`.
- With sign-up closed the sign-in page is sent without the "Create Account" form (it is still sent to someone opening it from a team invitation), and the website help chat no longer offers the free trial. With pricing hidden the help chat doesn't answer price questions and the help guide has no price link.

### Email & Outreach
- **Attachments:** each campaign has a **📎 Files** button. Attach a brochure or price list (PDF, Word, Excel, PowerPoint, CSV, text, images; up to 5 files, 5 MB each) to the first email or to every email. Real-file and size checks; works with SMTP and Amazon SES.
- **Contacts and outbox:** edit and delete contacts (one or several), delete emails from the outbox with their unsent follow-ups, change the daily limit from the header, and remove repeated addresses with one button. The same website or address is never added twice.
- **Real addresses only:** email addresses come from the company's own website; an address or person the AI adds on its own is dropped, and an address the AI writes into an email is removed.
- **Sending:** due emails are checked every minute and approving sends right away. The Outbox follows an email until it is sent, a send that hangs gives up after a minute, and the status pill says what is happening.
- Fixed: Find companies (the AI list was discarded; the typed-websites button read nothing), Select all and Delete selected in Outreach, and unreadable dark cards in the Outreach window.

### Contact Sync
- Help for the Google errors people hit (the redirect address to copy, add a test user, enable the Sheets API), clearer wording, a confirmation before turning auto-sync on, failures name the contact, and the saved Salesforce Consumer Key is no longer sent back to the browser.

### Website check
- When a check times out it now says whether the server could not connect to the website or the site was only slow, and a failed check is retried after 15 minutes, then 1 hour, 3 hours, then every 6 hours (it used to wait 6 hours).

### Ease of use
- Short, purposeful animation (pop-ups, changed numbers, loading placeholders), switched off for people who ask for less motion. Clearer wording on the daily limit, the quick-log box, the notes organiser and the Amazon SES options.

---

## 2.3.0 — 17 November 2026

### Meta reports
- **New Meta Reports page:** ad account balance, spend and leads, plus WhatsApp analytics, cost and number health in one place.
- Each workspace picks its own ad accounts. **Pay on Meta** links and a warning when a payment is overdue.
- When a permission is missing, the page shows step by step how to add it (for ads: **Reconnect Facebook with ads access**).

### Contact Sync to Google Sheets and Salesforce
- Contacts can sync by themselves to a **Google Sheet** and to **Salesforce Leads**, set up per workspace, with **Test**, **Sync now**, the last status and retry. Keys are stored encrypted, and the saved Salesforce Consumer Key is never sent back to the browser.
- Clear setup steps and Google error help: the redirect address to copy, and what to do about a 403 (add a test user or publish the app), a 400 or a Sheets API error. You confirm before auto-sync is turned on, and a failure names the contact.

### Leads and contacts
- **Added** and **Last action** columns. Log a call, WhatsApp, email, meeting, demo, note or task with who did it (you or a teammate) and when; quick-log and edit straight from the table.
- A clearer message when Facebook isn't connected for the workspace.

### Faster AI chat answers
- Questions that match an FAQ are answered at once, with no AI call. Other questions get only the relevant parts of your knowledge base, so answers are faster and cheaper. Repeat answers are remembered until you change the knowledge base.
- Paste or upload raw notes and organise them into sections you can edit and delete.
- The website chat shows an animated "typing…" indicator.

### Sales outreach
- **Attach files to a campaign** (PDF, Office, CSV or images) to the first email only or to every email. Works with SMTP and Amazon SES.
- **Find companies** works again: the AI's company list is read correctly, typed websites are used, and skipped sites say why (already in the campaign, wouldn't open). If the AI fails you see the real reason.
- **Real addresses only:** emails come from the company's own website. Addresses the AI made up are dropped, the same website or address is never added twice, and a button removes existing repeats.
- **Faster sending:** due emails are checked every minute (was every 15) and approving an email sends it right away. The Outbox follows an email until it is sent; a send cut off by a restart is marked failed and never resent by itself.
- Edit and delete contacts (one or many), delete emails from the Outbox with their unsent follow-ups, and change the daily limit (default 25) from the **Sent today: X of Y** pill. The status pill says what is happening (Sending…, Next send…, Nothing waiting).
- Outreach cards are readable again (they were dark text on dark cards).

### Email sending
- **Amazon SES with AWS access keys** (the SES API) as a second way to send, next to SMTP, on the hosted edition and the desktop app.

### Also
- Short pop-up, highlight and hover effects, all turned off when your device is set to reduce motion.
- **Hosted edition:** new versions are deployed automatically, with a backup and automatic rollback if the new version doesn't start.

### Fixed
- **Select all** and **Delete selected** in Sales outreach ran the WhatsApp screen's buttons of the same name.
- A cloud AI that times out is skipped for 90 seconds instead of making every company wait.
- The missing refresh icon on Leads.

---

## 2.2.0 — 16 November 2026

### Upgrading a hosted (server edition) install — read first
- **`SESSION_SECRET` is now required.** The hosted app refuses to start without a long random value (24+ characters; placeholders such as the old `.env.example` value are rejected). Make one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The desktop app makes and keeps its own.
- **Set `APP_URL`** to the public address: client approval links are built from it.
- **Set `TRUST_PROXY=1`** (the number of proxies in front) when the app is behind nginx or a load balancer, or every visitor shares one rate limit.
- **Platform admins:** no e-mail address or domain is trusted by its text any more. Make your user's `role` `superadmin` in the database, or list the address in `PLATFORM_ADMIN_EMAILS` (it must be verified). Check this before you upgrade or you may lose admin access.
- Run `npm ci` (dependencies changed) and start the app: the new `relay_approvals` table is created automatically.
- **One command does the `.env` part:** on the server run `./scripts/ec2-prepare-env.sh --app-url https://app.example.com --admin-email you@example.com`. It sets `SESSION_SECRET` (generated on the server, never printed), `NEXUS_MODE`, `APP_URL`, `TRUST_PROXY` and `PLATFORM_ADMIN_EMAILS`, keeps a backup of the old file, and can be run again safely.
- See `docs/support/security-hardening.md` for everything the app now enforces.

### Calendar
- **Day and Year views** next to Week, Month and Agenda. Day is hour by hour, with a row for posts that have no time yet. Year shows twelve small months: shaded days have posts (darker = more), a red underline means something failed, and clicking a day or a month name opens it.
- **Today** button, and Prev / Next no longer skip a month (Jan 31 + 1 month is now February).
- **Several calendars at once:** tick other workspaces under "Calendars" to see their posts together, each with a coloured dot. Opening a post from another calendar switches to that workspace.
- **Platform filter:** hide or show Facebook, Instagram, LinkedIn and so on.
- The calendar remembers your last view and choices. It always asks for posts by workspace name, so it can't show one workspace's posts under another's name.

### Better ranking on Google

The website now has a keyword title and shorter description, prices in its structured data (Individual and Agency Pro), and its own title, description and address for the Help guides. robots.txt and a noindex header keep the app, sign-in and one-time links out of search results, and pages that do not exist now return a real 404 instead of the app's page. Pages and scripts are compressed (the landing page is about a quarter of its size), and fonts and images are cached on the hosted edition.

### Help chat on the website and inside the app

A chat button on the landing page answers visitors about features, pricing and the free trial, and a Help & support chat inside the app answers how-to questions and can open the right screen for you (for example Settings → AI). Both answer only from a knowledge base the Super Admin edits under Users & access → Help chat: add, change, switch off or delete answers, restore the built-in ones, and try a question before visitors see it. Questions the chat cannot answer, and "talk to a person" requests, are saved as enquiries in the same place (set SUPPORT_NOTIFY_EMAIL to also get each one by email). The website chat is rate limited and shares a daily AI budget (HELP_PUBLIC_DAILY_LIMIT, default 400); without AI it shows the written answers.

### Guided setup, no training needed

Home shows a "Get set up" checklist (connect an account, turn on AI, set up email) until each is done. When something fails because a step is missing (no AI key, account not connected, email not set up), a pop-up explains it and fixes it on the spot: for AI you paste a free Google key right there. A thin bar at the top shows when the app is waiting on the server, with a note after 9 seconds that AI can take a while. AI writer and Other AI tools moved out of Settings into the main menu, and the old "needs a key in .env" notes now point to Settings → AI.

### A more useful Home screen

Home now opens with a greeting and a short list of what needs your attention (posts that did not go out, accounts to sign in again, nothing planned for the week, sales emails to check). Below it are four numbers that compare with the previous 30 days, a Coming up list, a 14-day published/planned chart and a split by platform. On phones the numbers show two per row instead of one very tall card each.

### Email sending works with any provider
- **Settings → Email sending** now has a provider list: Gmail, Outlook.com / Hotmail, Microsoft 365, **Amazon SES (AWS)** with a region choice, Google Workspace, Yahoo, Zoho (India and global), SendGrid, Mailgun, Brevo, Postmark, Mailjet, iCloud, GoDaddy, Hostinger / Titan, Namecheap, and **Other** for any mail server. Choosing one fills in the server, port and security, and explains what that provider needs (an app password, an SMTP key, a verified sender…).
- **Connection security** can be set (STARTTLS or SSL/TLS), and follows the port by default.
- **Test settings** checks the server, port and login without sending anything; **Send me a test email** sends one short message to your own address. Failures are explained in plain words (wrong password, wrong port or security, unknown server, sender not verified).
- On the hosted edition the mail server must be a public address, so a customer can't point the server at its own network.

### Client approval on the hosted edition
- The hosted app now serves client approval links itself: it keeps the post encrypted (the key stays in the link after `#`), shows the client their page, and collects the answer. No licence or relay server is involved. Links expire after 14 days (30 at most). The desktop app still uses Radixile's relay.

### AI
- **Choose where your AI comes from** (hosted edition, Settings → AI): the AI included with your plan, only your own keys, or your own keys first with ours as backup.
- A saved cloud key (Gemini, Groq, OpenAI…) is now used before local Ollama. Ollama goes first only when you choose it.
- Gemini switches to a lighter model automatically when the main one is busy or not answering.
- The shared team keys are now used in the Live Chat Simulator, the FAQ and notes writers, and the website-chat bot.
- The assistant is named **Nexa AI Assistant**.
- **Auto-reply "Try it"** now shows the real AI answer for "anything else" messages, and goes quiet after a hand-over, like the live bot.

### Sales outreach
- **Import contacts** (Contacts → Import contacts): upload a CSV or Excel file of people, check the preview, then import. It skips invalid, repeated, already-known and opted-out people and domains that can't receive email; emails are written in the background and wait for your OK in Outbox.

### Security
- **Admin access:** removed the built-in admin e-mail address and the e-mail-domain rule. Accounts are checked on every request, so a suspended, demoted or deleted person loses access within seconds. A new session is made at every sign-in. Added browser security headers and secure cookies.
- **Outbound requests:** anything the server fetches from an address a user typed (websites, feeds, pictures, SEO checks, webhooks, Evolution and Bluesky servers) can no longer reach private or local addresses, including through redirects and DNS tricks. Customers can't point the hosted server at their own Ollama address.
- **Abuse limits:** rate limits on sign-up, sign-in, password reset, the API, AI actions and the public website chat. Radixile's own AI keys are used only for accounts with a verified email and are limited per business per day. The auto-reply bot has a daily cap on AI answers.
- **AI replies:** text from outside (website visitors, prospects' replies, web pages, imported files) is cleaned and kept apart from instructions; attempts to take over the bot are not sent to the AI; replies can't reveal the bot's notes or contain links, emails or phone numbers the business didn't write. Outreach emails link only to your own or the company's site, and any draft that needed cleaning waits for your approval.
- The local-folder routes stay inside your content folder and are off on the hosted edition.
- Updated dependencies: removed the unused `passport-twitter`; upgraded `nodemailer` and `csv-parse`.

### Also in 2.2.0
Everything below was finished since 2.1.0.

### Easier to find your way around
- A shorter menu in plain words: Home, Create post, Calendar, Schedule from Excel, WhatsApp, Comments, Results, then **Grow** (Sales outreach, Email, Clients) and **More tools**.
- Settings grouped into Connected accounts, AI, Email sending, Backups, Licence, Team and Account, with clear "connected / needs sign-in" status and guided reconnect. Settings shows a badge when an account needs attention.
- AI keys are in one place (Settings → AI).

### Posts
- **Preview** in Create post: see the post as it will look on each chosen platform, with the first comment underneath.
- **First comment timer:** add the first comment right after the post or 1–60 minutes later. The Calendar shows whether each first comment was added, is waiting, or why not.
- **First comment fixes:** a post not ready yet for comments is retried; Meta's real reason is shown instead of always "sign in again"; Create post warns when Instagram or Facebook wasn't given permission to comment, or when the post is a Story; comment problems on scheduled posts are no longer silent.
- **Design a picture** in Create post: offer, announcement, tip, festival and photo-with-text designs in your Brand Kit colours, sized for each platform.
- **Signatures**: a sign-off added to new posts (counted in character limits).
- **Post sets**: save groups of platforms and pick them with one click.
- **Blog & news feeds** (More tools): new articles from a website's feed become drafts or scheduled posts.

### WhatsApp
- **Setup** in numbered steps.
- **Auto-replies**: welcome message, menu, keyword answers, away hours, STOP/START opt-out, and a hand-over when you reply yourself. Can also let your n8n workflow answer.
- **Templates**: write WhatsApp templates with fill-ins, buttons and a live preview, send them to Meta, and see Meta's decision.
- **Broadcasts** in 3 steps (who, message, send) with a test to yourself, live progress, Stop, and a list of who didn't get it and why.
- Broadcasts and auto-replies need an active licence (STOP requests are still honoured without one).

### Sales outreach
- Works as one clear flow: **1. Campaigns → 2. Companies & people → 3. Outbox (approve) → 4. Replies**. See the user guide, section 14.
- Emails are written from what your campaign says you offer and signed with your business name. They no longer pitch a built-in housing-society product or leave blanks like `[Name]`. An email with a blank can't be approved.
- Email addresses are marked **Verified** (found on their website), **Guessed** or **Won't work**. Companies whose website doesn't open aren't added.
- **Follow-ups go out in order** and keep their planned gap, and they stop as soon as someone replies. People who say "not interested" or ask to stop are never emailed again.
- **Pause sending** really pauses. Campaigns can be paused one by one.
- The Replies screen shows the email they answered, sorts replies (interested, question, not now, not interested, asked to stop), and drafts an answer you can edit and send.
- All numbers on the page are real (no sample figures).

### Server edition: SEO autopilot
- New switch `NEXUS_MODE=server` (also on with the Postgres database) for features that run all the time. They are off in the desktop app.
- **SEO autopilot:** add your website and phrases; Social-Nexus re-checks it every week or day, keeps a plain-language to-do list (most urgent first, things that got worse moved up, fixed things closed by themselves), drafts titles, descriptions and page plans on request, and drafts a Google Business post for approval when the profile has been quiet. Nothing is changed or posted without someone's OK. The Home page shows the top to-dos.
- New whole-site checks: broken links, duplicate titles and descriptions, soft 404s, canonical and sitemap problems, structured data (JSON-LD), AI assistants blocked in robots.txt, and phone page speed from Google PageSpeed Insights (needs `PAGESPEED_API_KEY`). These follow checks in the MIT-licensed open-source projects Seo-Promt-Master, linkinator and crawlseo, rewritten for Social-Nexus.

### Website and sign-in
- New landing page at the site's main address, using the whole screen; the sign-in page has the same light look. The desktop app's own window still opens on sign-in.
- Ready for search engines: page title and description, canonical address, share previews (with a share picture) for WhatsApp, LinkedIn, Facebook and X, structured data for Google (who makes it, what it is, and the FAQ), `robots.txt` and `sitemap.xml`. The address comes from `APP_URL`. The app and sign-in pages are kept out of search results.
- "More from Radixile": Urban Society, the housing society app (urbansociety.in).
- Contact address is now info@radixile.com.
- Legal pages at /legal: Terms of Service, Privacy Policy (DPDP Act, Grievance Officer, Google "Limited Use"), Refund & Cancellation (with delivery), Acceptable Use, Cookies, Delete your data (for Meta and Google app review) and a Data Processing Addendum for businesses. Company address, Grievance Officer and court city come from `LEGAL_ADDRESS`, `LEGAL_GRIEVANCE_OFFICER` and `LEGAL_CITY`. Sign-up says that creating an account accepts the Terms and Privacy Policy.

### Server edition: pay for your plan online
- Settings → Plan lists the plans (monthly or yearly, prices with GST). The owner picks one, enters GST details and pays through Razorpay; the plan starts straight away.
- The Plan screen shows the renewal date, the GST invoices, and **Cancel plan** (keeps working until the end of the period paid for).
- If a renewal payment fails, publishing continues for 3 more days while Razorpay tries again.

### Server edition: settings for each business
- AI keys can be shared with the whole team (Settings → AI → Shared with your team). The owner or a manager saves them; everyone else uses them unless they add their own. Keys are stored encrypted and never shown again.
- Email sending (Settings → Email sending) belongs to the business: campaigns and Sales outreach go from the business's own address. Only the owner or a manager can change it.
- Customers never use the server's own AI keys or mail server. Local AI is off on the server.

### Website SEO, app store listing and Google Business
- **Website SEO → Check a page:** opens your page the way Google's crawler does and lists what to fix: does it open, https, `robots.txt`, "noindex", sitemap, canonical address, title and description (with a Google preview), main heading, amount of text, pictures without alt text, phone set-up, share preview and where your search phrase appears. All measured from the page.
- **Write title & description** now reads your page when you give its address. **Check my text** measures words, sentence length, reading ease and phrase use; AI only adds suggestions. The made-up "SEO score" is gone.
- **My search phrases** no longer shows a "Position" column that was never filled in; **Search on Google** opens the search in your browser.
- **App store listing** writes the fields each store really has (App Store promotional text and keywords; Google Play has no keyword box), checks every length limit, and leaves out keywords Apple already counts from the name and subtitle.
- **Google Business post types:** post an **Update**, an **Offer** (title, dates, coupon code, link, terms) or an **Event** (dates and times), with an optional button (Book, Order online, Buy, Learn more, Sign up, Call now). The preview has a Google tab showing how it looks on Search and Maps.
- **Google Business** finds your locations in every account your Google login manages (before, it only looked at the first account, often a personal one with none), lets you **choose the location** to post to, and explains Google's errors (API access not approved yet, APIs turned off).

### Fixed
- **Privacy:** the public internet tunnel no longer starts by itself on every launch. It starts only when you turn it on in WhatsApp Setup.
- Built-in data from another business (WhatsApp/Meta IDs, phone numbers, sample contacts, sending address) removed. Tests and pings could have reached a stranger's number.
- Saved passwords containing `$` were changed when saved. Email sending on port 465 never worked. The email settings form looked empty after saving.
- An invalid Facebook token was saved and shown as "Connected".
- Team actions (promote, suspend, delete, reset password…) showed success even when they failed.
- WhatsApp: incoming messages from Meta are now checked against your App secret. Messages from WhatsApp Web (Evolution) are received. Opening an empty chat no longer saves a made-up message. Several messages from one person at the same time are handled one after another.
- Sales outreach: approving an email that was already sent sent it again. Emails were shown as "sent" when email sending wasn't set up. "Pause sending" and the "From" picker did nothing. The "Activity" menu item sent emails instead of showing activity. Answers to replies were marked sent when they failed, and could be sent twice. Waiting follow-ups were shown as "Sent". The HTML version of emails didn't escape `<` and `&`.

### Known limits
- Sales outreach doesn't read your mailbox yet: paste replies in **4. Replies**.
- Guessed email addresses can bounce.
- The public tunnel downloads `cloudflared` when you first turn it on.

---

## 2.1.0 — 29 October 2026

_Written afterwards from the change history._

### Upgrading
- Migrations run by themselves at start-up. Existing data is moved into a first workspace automatically, and an install without an admin gets one once (the first user).
- Saved social logins are now encrypted on disk; they are converted when the app starts.

### Workspaces and teams
- **Workspaces:** keep each brand or client separate, each with its own social accounts, posts and settings. Switch between them from the workspace switcher.
- **Team members and roles:** invite people by link and give each one a role that controls what they can do. Invitations expire.
- Works on SQLite (desktop app) and PostgreSQL (hosted edition).

### Content and calendar
- One place for every post: draft, review, approve, schedule and publish, with comments on each post and checks on who may move a post to the next step.
- Content calendar showing what is planned and published.

### Posting
- Rebuilt posting for Facebook, Instagram, LinkedIn, Pinterest, X, Google Business, Bluesky and Threads, with a media library and per-platform post options.
- Tokens refresh by themselves. Accounts saved without a login show **Sign in again**, and publish errors say what went wrong.
- Facebook asks for Instagram permissions only when you connect Instagram, and keeps the chosen Page when you reconnect.

### Client approval, inbox and reports
- **Approval links and sets:** send posts to a client for approval, with a client companion page and one-click account connection.
- **Unified inbox**, a **link-in-bio** page, cloud posting hand-over, insights and reports.

### Licence, backups and import
- Licence activation in **Settings → Licence**.
- **Backups** protected by a passphrase, and restore. Bulk import of posts. Festival calendar for planning.

### Fixed
- AI writing for a single post no longer returns one version per platform.
- Unknown data addresses return a clear error instead of the app page.

---

## 2.0.0 — 30 May 2026

_Written afterwards from the change history._

First release of NEXUS 2.0, an AI digital marketing platform for Windows.

- **Post to many platforms:** LinkedIn, Facebook, Instagram, Pinterest, Twitter/X, YouTube, Google Business and TikTok.
- **AI writing** with a local model (Ollama/Llama), Google Gemini or Claude. **AI images** (Stability AI, DALL·E 3) and **AI video** (Luma, Runway).
- **Marketing tools:** SEO, app store listing (ASO), email marketing, ad copy, hashtag research and a UTM link builder.
- **Sign-in and roles:** user accounts with an admin dashboard, and invite codes to control who can join.
- **Windows installer** with Node.js built in, a marketing landing page and in-app help.

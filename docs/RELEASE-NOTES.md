# Social-Nexus release notes

Newest first. Paste the section for a version into the GitHub Release
(`gh release create ... --notes-file`) when you publish it.

---

## Next version (after 2.1.0) — not released yet

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

### Website SEO, app store listing and Google Business
- **Website SEO → Check a page:** opens your page the way Google's crawler does and lists what to fix: does it open, https, `robots.txt`, "noindex", sitemap, canonical address, title and description (with a Google preview), main heading, amount of text, pictures without alt text, phone set-up, share preview and where your search phrase appears. All measured from the page.
- **Write title & description** now reads your page when you give its address. **Check my text** measures words, sentence length, reading ease and phrase use; AI only adds suggestions. The made-up "SEO score" is gone.
- **My search phrases** no longer shows a "Position" column that was never filled in; **Search on Google** opens the search in your browser.
- **App store listing** writes the fields each store really has (App Store promotional text and keywords; Google Play has no keyword box), checks every length limit, and leaves out keywords Apple already counts from the name and subtitle.
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

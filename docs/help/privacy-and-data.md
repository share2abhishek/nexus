# Privacy and your data

**Social-Nexus by Radixile Technology Solutions** · Questions: info@radixile.com

Social-Nexus is a desktop app. It runs on **your** Windows PC, not on Radixile's servers. This page explains, in plain language, what is kept on your PC, what is sent elsewhere and when, and how to delete everything.

---

## 1. What is stored on your PC

Everything is kept in one folder: **`%APPDATA%\Social-Nexus`** (press Windows key + R and paste that to open it).

- Your posts, drafts, calendar, comments, templates, Brand Kit, UTM links, hashtags and AI history
- Email subscribers and campaigns
- User accounts on this install. Passwords are stored only as a one-way scrambled form (hash), never as plain text.
- Connected social accounts (the sign-in "tokens" the networks give you)
- Your AI and media API keys (saved to your own user account)
- App-wide settings: social platform app details, email (SMTP) settings
- Your licence file (from version 2.1)
- A technical log (`logs\server.log`) for troubleshooting

**Radixile can't see any of this.** It never leaves your PC unless you send it, for example when you attach the log file to a support email.

**Please note:** tokens, API keys and the email password are saved on your PC **without extra encryption**. Anyone who can sign in to your Windows account, or who gets a copy of the folder, could read them. Keep your Windows account protected with a password or PIN, and treat backups of this folder like passwords.

Social-Nexus only accepts connections from the same PC (`127.0.0.1`). Other computers on your network can't open it.

---

## 2. What is sent to AI providers, and only when you use AI

When you click a button that uses AI (Generate, AI Assist, hashtags, captions, SEO, ad copy, email writer and so on), Social-Nexus sends **your instructions and the text needed for that task**, plus your Brand Kit details when generating posts, to **one** AI provider:

| You use | Your text goes to |
|---|---|
| **Ollama** | **Nowhere.** It runs on your PC. |
| Google Gemini | Google |
| Groq | Groq |
| OpenRouter | OpenRouter, and the model provider it routes to |
| Mistral | Mistral AI |
| Anthropic Claude | Anthropic |
| Image and video tools (Stability, OpenAI, Luma, Runway, Gemini Image) | That provider |

The request is sent with **your own API key**, so it falls under **your account and that provider's privacy policy and terms**. Free tiers of some providers may use your inputs to improve their services. Check their policies if this matters to you, or use Ollama for private content.

---

## 3. What is sent to social networks, and only when you act

Social-Nexus contacts a social network (LinkedIn, Meta for Facebook and Instagram, Pinterest, X, Google for YouTube and Business Profile, TikTok) only when you:

- **connect** an account (you sign in on the network's own page; Social-Nexus never sees your social password),
- **publish** or **schedule** a post (the text and image or video link are sent when the post goes out), or
- **refresh** a connection or choose a Page or board.

What the networks do with your posts is covered by their own policies. Social-Nexus doesn't read your followers or messages.

**Email campaigns** are sent through the email account (SMTP) you set up, to the subscribers you added.

---

## 4. What the Radixile licence server receives (from version 2.1)

To activate, check and deactivate your licence, Social-Nexus talks to **license.radixile.com**. It checks in by itself now and then while the PC is online (and when you click **🔄 Check licence now**). Each time it sends only:

- your **licence key or coupon code**,
- **scrambled (hashed) identifiers of your computer**, made from parts such as the Windows machine ID, motherboard, disk and processor. The real serial numbers **never leave your PC**, and the scrambled values can't be turned back into them,
- an optional computer name, so you can recognise your PCs on the portal, and the **app version**,
- your **email address** when you redeem a coupon or buy a licence (and the name, phone, company and GSTIN you enter at checkout, for the invoice).

The licence server **never** receives your posts, drafts, contacts, subscribers, connected social accounts, API keys or log files.

**Payments** go through **Razorpay**. Your card or UPI details are entered on Razorpay's checkout and never reach Radixile.

The licence server keeps a record of activations (which licence, which scrambled computer ID, when), so it can enforce seat limits and help you move to a new PC.

---

## 5. Logs and support

The log file stays on your PC. If you email it to info@radixile.com, we use it only to solve your problem. Logs can contain error messages and parts of post text. Open the file in Notepad first if you'd like to check it. **Never send us your passwords, API keys or the `.env` file**; we will never ask for them.

---

## 6. How to delete everything

**Delete a single item:** use the 🗑 buttons in the app (posts, templates, subscribers, campaigns, client workspaces), or **Disconnect** a social account in **Settings → 🔗 Social Platforms**.

**Delete everything on this PC:**
1. If you want to use your licence on another PC later, first go to **Settings → 🔑 Licence → Deactivate this PC** while the PC is **online**. Deactivating tells the licence server to free your seat, so it needs the internet; offline, Social-Nexus refuses and keeps the licence rather than losing your seat.
2. Uninstall Social-Nexus (Windows **Settings → Apps → Installed apps → Social-Nexus → Uninstall**).
3. When asked **"Also delete all Social-Nexus data on this PC?"**, choose **Yes**. Or delete the `%APPDATA%\Social-Nexus` folder yourself after uninstalling.
4. Delete any backup copies you made.

**Revoke the app's access at each network** (recommended if you stop using Social-Nexus): remove the app in each network's security settings. Examples: Facebook → Settings → **Business integrations**; Google → myaccount.google.com → **Security → Third-party apps**; LinkedIn → Settings → **Data privacy → Permitted services**; X → Settings → **Connected apps**. You can also delete the developer apps you created.

**Delete the AI keys you created** on each provider's website if you no longer need them.

**Licence server data:** email **info@radixile.com** from your purchase or coupon email address and ask us to delete your customer record. We keep invoice and payment records for as long as Indian tax law requires.

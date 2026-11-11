# Social-Nexus User Guide

**Social-Nexus by Radixile Technology Solutions**
For version 2.1 · Support: support@radixile.com · Licence portal: https://license.radixile.com

This guide is for business owners, marketers and agency teams. You don't need any technical knowledge. If you get stuck, write to **support@radixile.com**. It helps if you attach your log file (see [Troubleshooting](#18-troubleshooting)).

---

## Contents

- [Getting started in 10 minutes](#getting-started-in-10-minutes)
- [Opening help inside the app](#opening-help-inside-the-app)

1. [What Social-Nexus is](#1-what-social-nexus-is)
2. [System requirements](#2-system-requirements)
3. [Installing Social-Nexus](#3-installing-social-nexus)
4. [First run: creating the admin account](#4-first-run-creating-the-admin-account)
5. [Activating your licence or coupon](#5-activating-your-licence-or-coupon-available-from-version-21)
6. [A quick tour of the screen](#6-a-quick-tour-of-the-screen)
7. [Setting up AI](#7-setting-up-ai)
8. [Connecting your social accounts](#8-connecting-your-social-accounts)
9. [Writing and publishing a post](#9-writing-and-publishing-a-post)
10. [Scheduling, the calendar and failed posts](#10-scheduling-the-calendar-and-failed-posts)
11. [Festivals and Indian languages](#11-festivals-and-indian-languages)
12. [Templates, Brand Kit, hashtags and UTM links](#12-templates-brand-kit-hashtags-and-utm-links)
13. [SEO tools and other marketing tools](#13-seo-tools-and-other-marketing-tools)
14. [Email campaigns and sales outreach](#14-email-campaigns-and-sales-outreach)
15. [Clients, workspaces and team members (agencies)](#15-clients-workspaces-and-team-members-agencies)
16. [Backup, data location and privacy](#16-backup-data-location-and-privacy)
17. [Uninstalling](#17-uninstalling)
18. [Troubleshooting](#18-troubleshooting)
19. [Frequently asked questions](#19-frequently-asked-questions)

---

## Getting started in 10 minutes

The short version. Each step links to the full instructions.

1. **Install.** Run `Social-Nexus-Setup-….exe` from Radixile and open the app. ([Installing](#3-installing-social-nexus))
2. **Create the admin account.** Click **Create Account**, enter your name, email and a password. The first account is the admin. ([First run](#4-first-run-creating-the-admin-account))
3. **Activate.** Go to **Settings → 🔑 Licence**, paste your licence key or coupon, enter your email and name, and click **Activate**. No key yet? You can still write and plan; publishing waits until you activate. ([Licence](#5-activating-your-licence-or-coupon-available-from-version-21))
4. **Set up AI.** Either install **Ollama** (free, private, on your PC) and download the `llama3.2` model, or get a **free Gemini or Groq key** and paste it in **your name → ⚙️ My API Keys → 💾 Save All Keys**. ([Setting up AI](#7-setting-up-ai))
5. **Connect one platform.** Open **Settings → 🔗 Social Platforms**, pick a card (LinkedIn or Facebook is easiest), and follow its **📘 Setup guide**. Use **📋 Copy** for the callback address. Then click **Connect**. ([Connecting](#8-connecting-your-social-accounts))
6. **Write with AI.** Open **✨ AI Generate**, describe your post with real details, choose the platform and click **✨ Generate Content**. Click **→ Compose** on the card. ([Writing](#9-writing-and-publishing-a-post))
7. **Schedule.** In **Compose & Post**, click **📅 Schedule**, pick the date and time, and click **📅 Schedule Post**. Leave Social-Nexus running in the tray at that time. ([Scheduling](#10-scheduling-the-calendar-and-failed-posts))

## Opening help inside the app

- **❓ Help & User Guide** is the last item in the left menu. It opens this guide.
- The **❓** button in the top bar opens help **at the section for the screen you're on**. For example, on **Settings → 🔑 Licence** it opens the licence section.
- Press **F1** on any screen to do the same.
- Help normally opens in its own window. If it opens in the same window instead, click **← Back to Social-Nexus** at the top of the help page to return.
- On the help page, use the **search box** to find a topic, and **🖨 Print / Save as PDF** to print the whole guide or save it as a PDF.

---

## 1. What Social-Nexus is

Social-Nexus is a Windows app for managing all your social media in one place. You can:

- **Write posts with AI**, in English and 8 Indian languages, in the tone you choose.
- **Publish or schedule** to LinkedIn, Facebook, Instagram, Pinterest, X (Twitter), YouTube, Google Business Profile and TikTok.
- **Plan on a calendar**, with a simple review-and-approve flow for teams.
- See **Indian festivals** and get ready-made festival post ideas.
- Use **marketing tools**: templates, a Brand Kit, hashtag research, a UTM link builder, SEO tools, ad copy, press releases and email campaigns.
- **Manage several clients** (for agencies), each with its own connected accounts and team.

**Your data stays on your computer.** Social-Nexus is not a website. It runs on your PC, and your posts, drafts and settings are saved on your PC. It only connects to the internet when you ask it to do something online, such as publish a post or use a cloud AI service. See [Backup, data location and privacy](#16-backup-data-location-and-privacy).

**You choose the AI.** You can use free local AI on your own computer (Ollama), or your own free or paid keys from Google Gemini, Groq, OpenRouter, Mistral or Anthropic Claude. Radixile doesn't charge you for AI and never sees your AI keys.

---

## 2. System requirements

| | Minimum | Recommended |
|---|---|---|
| Windows | Windows 10 version 1903 or later, or Windows 11 | Windows 11 |
| Processor | 64-bit (x64) | Any recent Intel or AMD processor |
| Memory (RAM) | 4 GB (cloud AI only) | 8 GB or more if you want local AI with Ollama; 16 GB for the larger local models |
| Free disk space | 500 MB for the app and your data | Another 2–5 GB for each local AI model |
| Internet | Needed to publish, to use cloud AI, and once to activate your licence | — |

**Ollama is optional.** You only need it if you want free, private AI that runs on your own PC. Without it you can use a free cloud AI key instead.

Social-Nexus checks your Windows version when it starts. If Windows is too old, it tells you and stops. If memory or disk space is low, it warns you and lets you continue.

---

## 3. Installing Social-Nexus

1. Download the installer (`Social-Nexus-Setup-….exe`) from Radixile. Only download it from Radixile's website or from a link Radixile sent you.
2. Double-click the installer.
3. **If you see a blue "Windows protected your PC" box:** early versions of Social-Nexus are not yet code-signed, so Windows SmartScreen doesn't recognise them yet. This is expected for new software from a small publisher.
   1. Click **More info**.
   2. Check that the app name is the Social-Nexus installer.
   3. Click **Run anyway**.

   Once Radixile's signing certificate is in place, this message will stop appearing.
4. Choose whether to install for just you or for everyone on the PC, and pick a folder (the default is fine).
5. Click **Install**, then **Finish**.
6. Open **Social-Nexus** from the Start menu or the desktop shortcut.

**What the app does while it runs**
- A small splash screen appears while the app starts its built-in local server. This takes a few seconds.
- When you close the window with **✕**, Social-Nexus **keeps running in the system tray** (the small icons near the clock). It has to stay running there to publish your scheduled posts on time.
- To quit completely, right-click the Social-Nexus tray icon and choose **Quit Social-Nexus**. Scheduled posts are **not** published while the app is closed.
- The tray menu also has **Open Dashboard**, **Open in Browser** and **Help & Documentation**.

> The app only accepts connections from this PC. It doesn't open any port to your network or the internet, and it doesn't add a firewall rule.

---

## 4. First run: creating the admin account

The first time you open Social-Nexus you will see the **Sign In / Create Account** screen.

1. Click **Create Account**.
2. Enter your name, email and a password (at least 6 characters). The notice "You're the first user — your account will be the Super Admin" confirms that you are setting up the admin account.
3. Click **Create Account →**.

The **admin** can change app-wide settings: social platform app details, shared AI keys, email (SMTP) settings, users and registration. Other people who use Social-Nexus on the same PC get their own login and their own private posts and keys.

**Keep your password safe.** There is no "forgot password" link. If a user forgets their password, the admin can reset it in **Admin Dashboard → Users**. If the admin forgets the admin password, contact support.

**Optional: set up local AI.** On a new install you may be shown a short **"Set up your local AI"** page with 3 steps for Ollama. You can follow it now, or click **Skip for now — use cloud AI →** and do it later (see [Setting up AI](#7-setting-up-ai)).

**Welcome wizard.** A 4-step welcome box (Connect · Setup AI · Generate · Publish) helps you get started. You can skip any step, and you can do everything later from the menu. On the **Setup AI** step, Social-Nexus checks whether Ollama is already running on your PC. If it is, and your model is downloaded, it says *"✅ Ollama is running on this computer and llama3.2 is ready. Nothing else to set up."* If Ollama is running but the model is missing, it tells you to download it in **Settings → Local AI** (one click).

### Who can register after you
In **Admin Dashboard → Platform Config → Registration Mode** the admin chooses:
- **Open:** anyone using this PC can create an account.
- **Invite Only:** a new account needs an invite code. Create codes in **Admin Dashboard → Invite Codes**.
- **Closed:** no new accounts. The admin can still add users in **Admin Dashboard → Users → Create New User**.

---

## 5. Activating your licence or coupon (available from version 2.1)

Without a licence you can still write, use AI, plan and export. To **publish, schedule, retry failed posts, import a CSV schedule and send email campaigns**, Social-Nexus needs an **active licence** (a paid key or a coupon).

### Types of licence

| Licence | How you pay | How long it works | Updates |
|---|---|---|---|
| **One-time (perpetual)**: key starts with `SNXP-` | Once | Forever | 1 year of updates included. After that you can buy another year of updates, or keep using your current version. |
| **Yearly subscription**: key starts with `SNXS-` | Every year (auto-renew) | While the subscription is paid, plus 7 extra days if a renewal fails | Always included |
| **Coupon**: code looks like `SNX-7K3Q-M9PD` | Free (from Radixile or a partner) | For the coupon period, usually **3 or 6 months**. Coupons unlock the **Full edition** (all features). | Included during the period |

**Editions:** *Individual* (1 PC, 1 brand) and *Agency* (several PCs, many client workspaces, more users). **Settings → 🔑 Licence → Includes** shows exactly what your licence allows. Current prices are on **https://license.radixile.com/buy**.

**Limits count the whole installation.** The number of users and workspaces in your licence is counted across everything on this PC, not per person. If you reach a limit, Social-Nexus tells you, for example "Your Individual licence allows 1 brand/client workspaces. Upgrade at license.radixile.com to add more."

### Activate a licence key or coupon
Only the **admin** of this installation can activate or change the licence. The PC must be online for this step.

1. Open **Settings → 🔑 Licence**, or click **Activate** on the orange banner at the top.
2. Under **Activate**, paste your **licence key** (`SNXP-…` / `SNXS-…`) or **coupon** (`SNX-XXXX-XXXX`) into the first box.
3. Enter **your email**. It is needed for coupons. Some offers allow one use per email.
4. Enter **your name or business**. This is shown as "Licensed to".
5. Optional: give **this computer a name**, for example "Office PC".
6. Click **Activate**. You'll see "Social-Nexus is activated ✅" and **Status: ✅ Active**.

**Keep your key safe.** Your key appears on the payment success page and is emailed to you with your GST invoice. For security, Radixile stores only a scrambled (hashed) copy and can't read it back to you.

**Coupons** can normally be used **once per PC** and **once per email address**, and only online. You can enter a paid key at any time; all your data is kept.

### What the licence status means

The **Status** line in **Settings → 🔑 Licence** and the banner at the top tell you where you stand:

| Status | What it means | What to do |
|---|---|---|
| **⚪ Not activated** | No licence yet. | Activate a key or coupon. Writing, AI, planning and export still work. |
| **Checking your licence…** | The first few seconds after Social-Nexus starts, while it checks this PC. Publishing waits for a moment. | Nothing. Wait a few seconds. If a publish button says "still checking your licence", try again. |
| **✅ Active** | Everything your edition allows works. | Nothing. |
| **🟠 Needs internet** | Your offline time has run out (see below), or your PC's date looks wrong. | Connect to the internet and click **Check now** on the banner. Check the PC's date and time. |
| **🔴 Ended** | Your subscription or coupon period is over. | Renew or buy a licence. All your data is still here. |
| **🔴 Not valid on this PC** | The licence belongs to another PC or installation, was cancelled, or this copy of Social-Nexus was modified. The message says which. | Follow the message. Usually: activate again on this PC. |

### Working offline
After activation Social-Nexus works **without internet**. **Settings → 🔑 Licence** shows a **Works offline until** date. Whenever the PC is online, Social-Nexus checks in by itself and moves that date forward. You don't need to do anything.

- When **3 days or fewer** of offline time are left, a banner asks you to connect: *"Connect to the internet within … days so Social-Nexus can confirm your licence."*
- After the **Works offline until** date, publishing pauses until the PC is online for a moment. Click **Check now** on the banner, or **🔄 Check licence now** in **Settings → 🔑 Licence**.
- **🔄 Check licence now** is also useful straight after you renew or upgrade, so you don't have to wait for the automatic check.

> Don't change your PC's clock to get extra days. If the clock goes back by more than a day, the app asks you to fix the date and go online.

### Limited mode
When there's no active licence (not activated, ended, needs internet, or not valid), Social-Nexus runs in **limited mode**:
- ✅ You can still **open and view everything, write drafts, use AI, plan on the calendar, export and back up**. Your data is never locked away.
- ⛔ **Publishing, scheduling, Retry, CSV schedule import and sending email campaigns** are paused until the licence is active again.

Posts that were already scheduled wait. If the licence becomes active again within 6 hours of their time, they still go out. Older ones are marked **Missed** (see [Missed posts](#missed-posts-are-not-posted-late)).

### Moving to a new PC
Your licence is linked to your computer through a scrambled "fingerprint" of its hardware. Changing one part, such as a new disk or more RAM, doesn't break it.

1. On the **old** PC: **Settings → 🔑 Licence → Deactivate this PC**. **The old PC must be online.** This frees your seat on Radixile's licence server.
2. Install Social-Nexus on the **new** PC and activate with the same key.
3. To bring your posts and settings across, copy your data folder (see [Backup](#16-backup-data-location-and-privacy)).

If you try to deactivate while offline, you'll see "… Deactivating needs the internet so your seat is freed for another PC." Nothing is removed, and your licence keeps working on this PC. Connect to the internet and try again.

If the old PC is broken or lost, email **support@radixile.com** with your licence key's last 4 characters and your purchase email, and we'll free the seat. Moves may be limited (for example, "This licence was moved to another computer recently"). Support can help then.

**"This licence is already active on N of N computers"** means all your seats are in use. Deactivate one PC, or ask support to move the licence.

### Reinstalling on the same PC
Reinstalled Social-Nexus or Windows, or started with a fresh data folder? **Just activate again with the same key** (or the same coupon) in **Settings → 🔑 Licence**. Social-Nexus recognises the same PC and gives you back your seat; it doesn't use up another one. A coupon gives back the same coupon period, not a new one.

### "This copy of Social-Nexus has been modified"
If files of the app were changed or damaged (for example by a "crack", a broken update or a damaged disk), the licence can't be used. **Reinstall Social-Nexus from radixile.com. Your data is safe**: it's kept in a separate folder and isn't touched by reinstalling.

### No internet on the PC at all (rare)
1. In **Settings → 🔑 Licence**, open **No internet on this computer? Activate offline**.
2. Enter your licence key and click **💾 Save request file** (`activation.snreq`).
3. On any device that has internet, open **https://license.radixile.com/offline** and upload the file.
4. Bring back the downloaded `license.snlic` (for example on a USB drive), choose it, and click **📥 Import licence file**.

Offline activation works for paid keys only, not coupons.

---

## 6. A quick tour of the screen

**Left menu**
- **Main:** Dashboard · AI Generate · Compose & Post
- **Content:** Content Calendar · Post History · Templates · Local Files
- **Marketing:** SEO Tools · App Store (ASO) · Email Marketing · Ad Copy & PR
- **Media AI:** AI Media Creator
- **Tools:** Hashtag Research · UTM Builder · Brand Kit
- **Insights:** Analytics
- **Management:** Clients & Brands
- **System:** Admin Dashboard (admins only) · AI Tools Directory · Settings · **❓ Help & User Guide**

**Top bar**
- 🌙 switches between dark and light themes.
- **🔄 Refresh** reloads the connection status. On a narrow window it shows only the 🔄 icon.
- **❓** opens help for the screen you're on (same as **F1**). See [Opening help inside the app](#opening-help-inside-the-app).
- **🏢 workspace switcher** shows which client or brand you're working on, and lets you switch.
- **Your name** opens the user menu: **⚙️ My API Keys**, **🛠️ AI Tools Directory** and **🚪 Sign Out**.
- **✏️ New Post** opens Compose & Post.

**Settings tabs:** 🔗 Social Platforms · 🔑 Licence · 🦙 Local AI (Ollama) · 🤖 AI Keys · 🎨 Media AI · 📧 Email / SMTP · ℹ️ About · 👥 Members.
Only the admin can save the app-wide settings: social platform app details, email (SMTP) and the Ollama server. **AI keys are always personal.** The keys you type in **Settings → 🤖 AI Keys**, **Settings → 🎨 Media AI** or **user menu → My API Keys** are saved to **your own** login.

> **Analytics:** the **🎲 Simulate Data** button fills the charts with sample numbers so you can see how the page looks. These are **not** your real results. Real analytics from the networks are not available yet.

---

## 7. Setting up AI

You need at least one AI option to use AI Generate, AI Assist, hashtags, captions, SEO, ad copy and email writing. You can set up several. Social-Nexus then uses the next one if the first is busy.

### Option A: Ollama (free, private, works offline)

Ollama runs AI models **on your own PC**. Nothing you write is sent anywhere. It's free and has no daily limits, but it's slower than cloud AI on ordinary laptops and needs disk space and RAM.

**Step by step**
1. Go to **https://ollama.com/download**, download **Ollama for Windows** and install it. No account is needed. Ollama starts by itself in the background (you'll see a llama icon in the tray).
2. Download a model (the AI "brain"). You can do this in Social-Nexus or in Windows:
   - **In Social-Nexus:** go to **Settings → 🦙 Local AI (Ollama)**, type the model name under **⬇️ Pull a New Model** (for example `llama3.2`) and click **Pull**. Wait for it to finish. This can take a few minutes. (Only the admin can do this here.)
   - **Or in Windows:** open **Command Prompt** (press Start, type `cmd`, press Enter), type `ollama pull llama3.2` and press Enter.
3. In **Settings → 🦙 Local AI (Ollama)** click **🔄 Check**. The dot should turn green, and your model appears under **Downloaded Models**.
4. Choose your model under **Active Model**, tick **Use Ollama as Primary AI**, then click **💾 Save Ollama Settings**.
   - Not the admin? Go to **user menu → My API Keys → 🦙 Local AI (Ollama)**, tick **Use Ollama as primary AI**, type the model name, and click **💾 Save All Keys**.

**Which model should I use?**

| Your PC's RAM | Model to pull | Size to download | Notes |
|---|---|---|---|
| Under 8 GB | `llama3.2:1b` | about 1.3 GB | Fastest; fine for short posts |
| 8–16 GB | `llama3.2` (same as `llama3.2:3b`) | about 2 GB | **Recommended** balance of speed and quality |
| 16 GB or more | `llama3.1:8b` | about 4.7 GB | Better writing, slower on PCs without a graphics card |
| Alternatives | `mistral`, `phi3`, `gemma2` | 2–5 GB | Try these if you prefer their style |
| High-end PCs only | `llama3.3:70b` | over 40 GB | Needs a powerful graphics card. Not for normal laptops. |

To find out how much RAM you have: Start → **Settings → System → About → Installed RAM**.

**How fast is Ollama?**
- **The first AI request after starting can take about 30 seconds**, because Ollama loads the model into memory first. After that, replies come much faster. If you don't use AI for about half an hour, Ollama unloads the model to free memory, and the next request is slow again.
- **Ollama works on only a small number of requests at a time.** If you start several AI actions at once (for example Generate for several platforms, plus hashtags, plus AI Assist), they **wait in a queue** and run one after another. Nothing is lost; just wait for each to finish. Avoid clicking the same button again while you wait.
- For faster replies, use a smaller model (`llama3.2:1b`), close heavy programs, or add a free cloud key (Groq is the fastest) and pick it on the **🤖 Model:** bar.

> Small local models write well in English but can make more mistakes in Indian languages. For Hindi, Tamil and other languages you may get better results from a cloud key such as Gemini.

### Option B: free cloud AI keys

These services give you a **free API key**. An API key is a password that lets Social-Nexus use the service on your behalf. Each person uses their own key, so usage is billed to (or free under) **your** account, and the provider's free limits apply to you.

| Service | Where to get the key | What the key looks like | Notes |
|---|---|---|---|
| **Google Gemini** | https://aistudio.google.com/apikey | starts with `AIza…` | Generous free tier. Good at Indian languages. Sign in with a Google account → **Create API key**. |
| **Groq** | https://console.groq.com/keys | starts with `gsk_…` | Free and very fast (Llama 3.3 70B). Sign up → **Create API Key**. |
| **OpenRouter** | https://openrouter.ai/keys | starts with `sk-or-v1-…` | One key for many models, including free ones. Sign up → **Keys → Create Key**. |
| **Mistral** | https://console.mistral.ai/api-keys | random letters | Free tier available (you may need to verify a phone number). |
| **Anthropic Claude** (paid) | https://console.anthropic.com | starts with `sk-ant-…` | Paid only, high quality. Add credit on Anthropic's site first. |

Free limits and sign-up steps are set by each provider and can change. Check their website if a key stops working.

**Where to enter your keys**
1. Click **your name** (top right) → **⚙️ My API Keys**.
2. Paste each key into its box under **🤖 AI Text Generation**.
3. Under **Default AI Model**, choose the AI you want to use first.
4. Click **💾 Save All Keys** (top right of the page).

Your keys are saved for **your login only**. Other users on the same PC can't see or use them.

> **Settings → 🤖 AI Keys** and **Settings → 🎨 Media AI** also save to **your own** account. They're just shortcuts for the same personal keys. Keys that were set up in the app's configuration when the app was installed are used only by the admin who set up the install. **Every other user must add their own keys** (or use Ollama).

### How Social-Nexus chooses an AI (and falls back)

**If you pick a model on the AI Generate page**, Social-Nexus uses **exactly that one**. If it fails, you see the reason, and it doesn't switch to another AI behind your back.

**Otherwise**, Social-Nexus tries the options you've set up in this order and uses the first one that works:

1. **Ollama**, if it's turned on, running and has your model. If Ollama is installed but the model you chose **isn't downloaded**, Social-Nexus tells you and moves on to your cloud AI.
2. **Google Gemini**
3. **Groq**
4. **OpenRouter**
5. **Mistral**
6. **Anthropic Claude**

A provider that is "busy" is retried once after 2 seconds before Social-Nexus moves on. If all of them fail, you get one message that lists **each provider and why it failed**, for example *"Gemini: busy right now (503)"* or *"Groq: API key rejected"*.

**Tip:** set up **two** options, for example Ollama plus a free Gemini key, or Gemini plus Groq. Then a busy service never stops you.

### Switching the AI in the generator
On **✨ AI Generate**, the **🤖 Model:** bar at the top shows every AI you can use right now: your downloaded Ollama models and one entry per cloud key you added. Click a chip to use it for this session. The badge on the right shows the selected model.

If the bar says *"No text models configured"*, add a key in **My API Keys** or start Ollama, then reload the page.

### Images and video (optional)
**🎨 AI Media Creator** can make images (Stability AI, OpenAI GPT Image, or Gemini Image), short videos (Luma, Runway) and animations (Stability). These services are **paid or have small free credits**. Add their keys in **My API Keys → Image Generation / Video Generation**. Gemini images need billing turned on in your Google account.

---

## 8. Connecting your social accounts

Connecting is a one-time setup for each platform. Because Social-Nexus runs on your PC (and isn't a website that Radixile hosts), each network asks you to create a free **developer app**. You then paste its **Client ID** and **Client Secret** into **Settings → 🔗 Social Platforms**, and click **Connect**.

The full step-by-step guide for each network is in a separate document: **[Connecting your social accounts](connect-social-accounts.md)**. It's also in the in-app Help page.

**Each card has a 📘 Setup guide.** It shows how long setup takes, what you need first, and numbered steps with **Open ↗** links to the right developer page. Follow it from top to bottom. It's open until the platform is connected.

- When a step asks for the **callback (redirect) address**, click **📋 Copy** next to it and paste it into the developer website. **Don't type it.** It must match exactly. (X uses `127.0.0.1`; the others use `localhost`.)
- A badge shows what works today: no badge = ready (LinkedIn, Facebook, Instagram, Pinterest); 🟠 **Works with limits** (X, Google Business); 🔴 **Not available yet** (YouTube, TikTok).
- **LinkedIn** posts go to your **personal profile**.

What the card status shows:
- 🔴 **Credentials Needed**: open **🔑 API Credentials** on the card, paste the details and click **💾 Save Credentials**.
- 🟠 **Ready to Connect**: click **Connect** and sign in to the network.
- 🟢 **Connected**: shows the account name. **🔄 Refresh** checks the connection, and **Disconnect** removes it.

If Facebook's **Connect** keeps failing, the Facebook card also offers **🔑 Paste token manually (if OAuth fails)**. This is only for Facebook.

**Who can do what:** only the **admin** can save the developer app details. Within a workspace, only **Managers** can connect or disconnect accounts and choose the Facebook Page or Pinterest board. (You are the Manager of your own workspace.)

---

## 9. Writing and publishing a post

### Create Post in two steps

1. **Write**: type or paste the text, optionally add an **Image URL**, and pick the platforms.
2. Click **Save & continue →**. The post is saved as a draft and is already on the Calendar.
3. **Choose what happens**:
   - **Publish now**: posts straight away (you're asked to confirm).
   - **Schedule**: pick the time; optionally repeat every day, week or month (see *Repeating posts* in section 10).
   - **Send for review**: waits on the Calendar as "In review" until someone approves it; you can suggest a time.
   - **Keep as draft**: finish it later from the Calendar.

**← Back to editing** returns to the text; saving again updates the same draft. Without publish permission in a workspace (e.g. as a Creator on a client's workspace) you'll see only **Send for review** and **Keep as draft**.


### With AI (✨ AI Generate)
1. Open **✨ AI Generate**.
2. Under **What do you want to post about?**, describe the post, for example *"Announce our Diwali offer: 20% off all sweets until 10 November, order on WhatsApp."* Include real details such as prices, dates and places. The AI only knows what you tell it and what's in your Brand Kit.
3. Choose the **Target Platforms**, a **Tone** (Professional, Casual, Witty, Inspirational, Educational), the **Language** and a **Max Length**.
4. Click **✨ Generate Content**.
5. If you chose more than one platform, you get **one card per platform**, each written to suit that network. Each card has **📋 Copy** and **→ Compose**.
6. Click **→ Compose** on a card to open it in Compose with that platform already selected.

Other buttons: **🔄 Regenerate** (try again), **✏️ Edit** (edit the text right there), and **📋 View History** (your earlier AI posts).

**Quick Generate** on the Dashboard does the same in one box.

### Compose & Post
1. Open **✏️ Compose & Post** (or click **✏️ New Post**).
2. Type or paste your text. The counter under the box shows the length, and warnings appear in orange.
3. Optional: paste an **Image URL**.
4. Choose the **Target Platforms**.
5. Choose **📤 Post Now** or **📅 Schedule** (see the next section), then click the big button.

You get a message for each platform: which ones succeeded, and the reason for any that failed.

Publishing needs the **publish** permission in the workspace (the Manager role). Creators prepare posts on the Calendar and a Manager publishes or schedules them.

**Per-platform variants:** Compose sends the **same text** to every platform you select. To post a different version on each network, send each AI card to Compose separately and post them one at a time. In the Calendar, the **📱 Variants** button in AI Assist suggests platform versions of a draft.

### Character limits
Social-Nexus warns you, and won't post, if your text is too long for a selected platform:

| Platform | Limit (characters) |
|---|---|
| X (Twitter) | 280 |
| Pinterest | 500 |
| Google Business Profile | 1,500 |
| Instagram | 2,200 |
| TikTok (caption) | 2,200 |
| LinkedIn | 3,000 |
| YouTube | 5,000 |
| Facebook | 63,206 |

Emojis and some Indian-language letters can count as more than one character on some networks. Leave some room to spare.

### Images and videos
- Today, images are added as a **web address (URL)** that starts with `https://`. The image must be publicly viewable on the internet, for example on your website, Google Drive with public sharing, or an image host. Uploading straight from your computer isn't available yet.
- **Instagram needs an image.** Text-only posts aren't allowed by Instagram.
- **TikTok needs a video.** Put the video's public web address in the Image URL box.
- **Pinterest** works best with an image (a Pin is a picture).
- **X (Twitter):** at present only the text is posted, even if you add an image URL.
- Images made in **AI Media Creator** that come back as a web link can be sent to Compose with **→ Use in Post**. If you only get a picture (no link), click **⬇️ Download**, upload it somewhere public, and paste its link.

### WhatsApp
In **Post History**, open a post and choose **Edit & Repost → 💬 Share on WhatsApp** to open WhatsApp with the text ready to send.

---

## 10. Scheduling, the calendar and failed posts

### Repeating posts (every day, week or month)

1. In **Create Post**, write the post and pick the platforms.
2. Set **First post** to the date and time of the first one. Later posts go out at the same time of day.
3. **Repeat**: *Every day*, *Every week* (same weekday) or *Every month* (same date; on the 29th–31st, shorter months use their last day).
4. **Ends**: *After N posts* (2–365) or *On* a date (the post on that day still goes out).
5. Check the summary, e.g. *"6 posts, every Wednesday at 10:55 am. First: 28 Oct. Last: 2 Dec, then the schedule ends."*, then click **📅 Schedule 6 posts**.

Each repeat is its own post on the Calendar (**🔁 Every week · post 2 of 6**), so you can edit or unschedule one on its own. **Stop series** (in the Scheduled Queue or on any of its Calendar posts) removes the posts that haven't gone out yet; published ones stay. Some platforms (X especially) refuse a post that is exactly the same as an earlier one, so vary the wording of a few posts in daily/weekly series. A series can run for up to 2 years.


### Schedule a post from Compose
1. In **Compose & Post**, click **📅 Schedule**.
2. Pick the date and time. **Times are your PC's local time**, which is IST on a PC set to India. Check the time carefully before you save.
3. Click **📅 Schedule Post**. The post appears in the **📅 Scheduled Queue** on the right.
4. To cancel it, click 🗑 next to it.

**Social-Nexus must be running** (it's enough for it to be in the system tray), the PC must be awake and online, and your licence must be active at the scheduled time. The app checks for due posts every minute. Scheduling also needs an active licence.

**Tip:** close the window with **✕** instead of quitting. Social-Nexus then keeps running in the tray and posts on time. Make sure the PC doesn't go to sleep at your posting times (Windows **Settings → System → Power**).

### Missed posts are not posted late
If a post is **more than 6 hours overdue** (the PC was off or asleep, Social-Nexus was closed, or the licence wasn't active), Social-Nexus **does not post it automatically**. A "Happy Diwali" post a week after Diwali does more harm than good.

Instead, the post is marked **failed** with a message that starts with **"Missed:"**, for example *"Missed: it was due 8/11/2026, 9:00:00 am but Social-Nexus wasn't running or wasn't licensed then. Use Retry to post it now."*

- If the post still makes sense, click **🔁 Retry** (in Compose, under **⚠️ Failed in the last 14 days**). It goes out in about a minute.
- If it's out of date, delete it with 🗑, or edit it and schedule it again.
- Posts that are **less than 6 hours** late go out as soon as Social-Nexus is running again.

### The Content Calendar
The **📅 Content Calendar** shows the content you plan there, in **Week**, **Month** or **Agenda** view. Use **← Prev / Next →** to move through dates, and the **Filter status** boxes to show or hide items.

> Posts scheduled from **Compose** don't appear on the Calendar yet. They're listed in the **Scheduled Queue** on the Compose page. A single combined view is coming.

**Plan a post on the calendar**
1. Click **✏️ New Content**.
2. Enter an optional title, the post text and an optional image URL, and tick the **social accounts** to post to. (Only accounts already connected in this workspace are listed.)
3. Click **Save Draft**.
4. Click the item on the calendar to open its details. From there:
   - **📤 Submit for Review** → a reviewer or manager clicks **✅ Approve** or **❌ Request Changes**.
   - When it's approved, pick a date and time and click **⏰ Schedule**.
   - **📅 Unschedule** takes it off the schedule again.
   - **✨ AI Assist** can **Generate**, **Rewrite**, **Shorten**, add **Hashtags** or suggest **Variants**.
   - **💬 Comments** let your team discuss the post.

Working alone? You can submit and approve your own posts. A one-click "schedule my own draft" option is planned.

### Failed posts and Retry
A post can fail if a network rejects it: the login expired, a permission is missing, there's no image for Instagram, and so on.
- **From Compose:** failed scheduled posts from the last 14 days are listed under **⚠️ Failed in the last 14 days** in the Scheduled Queue, with the reason for each platform. Fix the cause (for example, reconnect the account), then click **🔁 Retry**. The post is tried again in about a minute.
- **"Interrupted while publishing — check the platform, then Retry"** means Social-Nexus was closed, or the PC shut down, while the post was being sent. It may or may not have reached the network. **Look at your page or profile first.** Only click **🔁 Retry** if the post isn't there, so it doesn't appear twice.
- **"Missed: …"** means the post was more than 6 hours overdue, so it wasn't posted late. See [Missed posts](#missed-posts-are-not-posted-late). Click **🔁 Retry** to post it now.
- **From the Calendar:** failed items (including Missed ones) show as **Failed** with the error message in their details. Click **✏️ Edit** (this returns the item to Draft), fix it, and schedule it again.

Retry needs an active licence.

If a post went out to some platforms but failed on others, it's recorded as published. Check the messages and **Post History** to see which platforms worked.

---

## 11. Festivals and Indian languages

- On a festival or special day (Diwali, Holi, Eid, Independence Day, Ganesh Chaturthi, Navratri and about 40 more in 2026), a **festival banner** appears on the **Dashboard** with **✨ Generate Post**.
- On **AI Generate**, a **🎉 Today's Festival** box appears with **✨ Generate Festival Post**.
- Upcoming festivals may show as small orange labels on the calendar.
- Lunar and Islamic festival dates can move by a day. Check important dates before posting.

**Languages:** on AI Generate choose English, हिंदी (Hindi), தமிழ் (Tamil), తెలుగు (Telugu), मराठी (Marathi), বাংলা (Bengali), ਪੰਜਾਬੀ (Punjabi), ಕನ್ನಡ (Kannada) or ગુજરાતી (Gujarati). Always have someone who speaks the language read the post before you publish it.

---

## 12. Templates, Brand Kit, hashtags and UTM links

### Templates (🗂️ Templates)
Save post formats you use often and reuse them.
1. Click **+ New Template**, give it a name, paste the content, and choose a type (Social Post, Email, Ad Copy, Blog Post) and tags.
2. Click **💾 Save Template**.
3. To use it, click the template and then **→ Use in Compose**.

Words in curly brackets like `{product}` are **not** filled in automatically yet. Replace them yourself in Compose before posting.

### Brand Kit (🎯 Brand Kit)
Fill in your **company name, tagline, target audience and brand voice**, then click **💾 Save Brand Kit**. You can also add a logo and brand colours and font for your own reference.

**Why it matters:** AI Generate reads your Brand Kit every time. The AI then writes in your voice, uses your real name and tagline, writes for the right audience, and is told **not to invent facts**. Without a Brand Kit, AI tools sometimes make up details such as "stores across India". The more specific your brand voice ("friendly, simple Hindi-English mix, no jargon, always mention home delivery"), the better the posts.

Each client workspace has its own Brand Kit.

### Hashtags (#️⃣ Hashtag Research)
Enter a topic, choose a platform and how many hashtags you want, and click **#️⃣ Research Hashtags**. Click **📋 Copy All** and paste them into your post. These are AI suggestions, not live trend data.

### UTM links (🔗 UTM Builder)
UTM links show you in Google Analytics which post or campaign brought visitors to your website.
1. Enter your website page (**Destination URL**), the **Campaign Source** (for example `instagram`) and the **Campaign Name** (for example `diwali_2026`). Medium, Term and Content are optional.
2. Click **🔗 Build Link**, then **📋 Copy Link**, and use it in your post. Click **💾 Save** to keep it in **Saved Links**.

---

## 13. SEO tools and other marketing tools

**🔍 SEO Tools** (all use your AI):
- **🏷️ Meta Generator:** enter a page title and target keyword to get a search-friendly title and description for your web page.
- **🔑 Keyword Research:** enter a topic (plus an optional niche and competitors) to get keyword ideas. Click one to track it.
- **⚡ Content Optimizer:** paste your text and keyword to get an SEO score and suggestions.
- **📍 Tracked Keywords:** a list of keywords you want to watch. Today you enter positions yourself. Automatic rank tracking isn't available yet.

The AI estimates keyword ideas and scores. For real search numbers, use Google Search Console (free).

**Other tools:**
- **📱 App Store (ASO):** listings for the App Store or Google Play.
- **📣 Ad Copy & PR:** Google and Meta ad copy, press releases, and **⏰ Best Times** (AI suggestions for when to post in your industry).
- **🎨 AI Media Creator:** images, video, animation, and a **💬 Caption Writer**.
- **📁 Local Files:** files in your content folder (text, Markdown, images, CSV). **→ Use as Post Content** sends a file to Compose. **📥 Import CSV Schedule** reads `schedule.csv` from the folder and schedules every row.
  - The CSV has a header line and then the columns `content, platforms, scheduled_at, image_url`.
  - Separate platforms with `;`, for example `linkedin;facebook`.
  - Write the date like `2026-11-08 09:00` (your PC's local time).
  - Check the rows carefully: the character-limit warnings in Compose don't apply to imported rows.
  - Importing a CSV schedule needs an active licence.
- **🛠️ AI Tools Directory:** a list of other useful AI tools.

---

## 14. Email campaigns and sales outreach

### One-time setup (admin): Settings → 📧 Email / SMTP
Enter your email provider's sending details and click **💾 Save SMTP Settings**:

| Provider | SMTP Host | Port | Username | Password |
|---|---|---|---|---|
| Gmail / Google Workspace | `smtp.gmail.com` | 587 | your full email | an **App Password**, not your normal password. Create one at https://myaccount.google.com/apppasswords. 2-Step Verification must be on. |
| Outlook / Microsoft 365 | `smtp.office365.com` | 587 | your full email | your password or app password (your organisation may need to allow SMTP) |
| Zoho Mail (India) | `smtp.zoho.in` | 587 | your full email | your password or an app-specific password |

Saved passwords aren't shown again on this screen. That's normal. There's no "send test email" button yet, so send your first campaign to yourself only.

### Sending a campaign (📧 Email Marketing)
1. **👥 Subscribers:** add people one at a time, or paste a list in **Bulk Import** (one email per line). Duplicates are skipped.
2. **✨ AI Generate:** choose the email type, brand, topic and tone, click **✨ Generate Email**, then **→ Save as Campaign**.
3. **📨 Campaigns:** check the name, subject and body, click **💾 Save Campaign**, then **📤 Send Now**. It sends to **all active subscribers**.

Sending a campaign needs the **publish** permission (the Manager role) and an active licence. A campaign that has been **sent can't be edited or sent again**. To send a similar email, **duplicate** it and edit the copy.

**Unsubscribing:** every campaign email automatically includes an **Unsubscribe** button and a footer line. When a reader clicks it, an email addressed to you opens on their side, with "unsubscribe" in it. When you receive such a reply, open **Email Marketing → 👥 Subscribers** and **mark that person as unsubscribed** so they don't get future campaigns. Please do this promptly. It's a legal requirement in most countries.

> Only email people who have agreed to hear from you. Gmail and Outlook limit how many emails you can send per day.

### Sales outreach: emailing businesses you choose (Grow → Sales outreach)

Sales outreach writes a short, personal email to each business you pick, waits for your OK, sends it, and stops following up as soon as they answer. It uses the same email account as Email campaigns (**Settings → Email sending**). Until that is set up, nothing is sent and the page says **Email not set up**. Sending also needs an active licence.

The side menu follows the order you use it:

1. **Campaigns.** Click **+ New campaign**. Give it a name and, most importantly, **say what you offer in a sentence or two**: the emails are written from this. Your business name comes from **Brand Kit**, so fill that in too. Set **Most emails per day** (25 is a safe start). Leave **Send without asking me** off.
2. **Companies & people.** Click **+ Add a company** (or **Add many companies** for a list of up to 20 websites). Social-Nexus reads their website, picks who to email and writes 3 emails: a first email, a short follow-up 3 days later and a last note 7 days later.
   - The email address is marked **✓ Verified** when it was found on their own website, **⚠ Guessed** when it wasn't (for example `contact@their-company.com`; it may bounce, so check it if you can) and **✕ Won't work** when the domain can't receive email. "Won't work" addresses are never emailed.
   - If a website doesn't open, the company isn't added and you're told why.
3. **Outbox (approve).** Read each email, edit it if needed and click **Approve** (or **Approve all**). Nothing is sent before that. An email that still has a blank like `[Name]` or `{{first_name}}` can't be approved until you fill it in.
4. Approved emails go out by themselves (the app checks every 15 minutes), a few seconds apart and never more than the campaign's daily limit. To send what's due right away, click **⚡** at the top.
   - **Follow-ups go out in order**: email 2 only after email 1 has really been sent, and at least the planned number of days after it. If email 1 went out late, the follow-ups move by the same amount. If an earlier email was cancelled or failed, the later ones aren't sent.
   - The Outbox shows the real state of each email: **✓ Sent**, **Approved · goes out** (with the date), **Not sent** (with the reason, such as "they replied") or **Failed** (with the error).
5. **Replies.** Social-Nexus doesn't read your mailbox yet. When someone answers, click **+ Add a reply you received** and paste it in. Then:
   - Their follow-ups stop at once, and the company shows **Replied**.
   - The reply is sorted as **Interested**, **Question**, **Not now**, **Not interested** or **Asked to stop**. People who said "not interested" or asked to stop are never emailed again, by any campaign.
   - An answer is drafted from your campaign's description. Click **Edit** to change it and **Send answer** to send it. It goes out with the subject of your original email ("Re: …"). It's only marked as answered if it was really sent, and it can't be sent twice by accident.

**Pause sending** (Outbox) stops everything at once until you click **Resume sending**. To stop just one campaign, pause it under **Campaigns**. **How sending works** in the side menu sums up these rules and shows the address emails are sent from.

Every email ends with a line telling people how to opt out. Only email businesses that are likely to find your offer useful, and keep the daily limit low: Gmail and Outlook limit how much you can send, and many unanswered cold emails can hurt your email reputation.

---

## 15. Clients, workspaces and team members (agencies)

A **workspace** is a separate area for one brand or client. It has its own connected social accounts, posts, calendar, Brand Kit and team. Everyone starts with one personal workspace.

### Add a client
1. Open **👥 Clients & Brands** → **➕ Add Client Brand**.
2. Enter the **Client Name**. The **Short name** fills itself in. Choose the **Default Timezone** (India (IST) is preselected) and the **Organization**.
3. Click **➕ Create Client**.

### Switch between clients
Click the **🏢 workspace name** in the top bar and choose a workspace. Everything you see (posts, calendar, connected accounts) changes to that client.

**Connect each client's own social accounts while their workspace is selected.** The developer app details (Client ID and Secret) are shared by the whole install, so you only enter them once. Each client then clicks **Connect** with **their own** login, for example their own Facebook Page.

### Invite team members
1. Switch to the workspace, then open **Settings → 👥 Members**, or **🏢 → 👥 Manage Members**.
2. Enter the person's **email** and choose a **role**.
3. Click **📩 Send Invite**. Social-Nexus **doesn't email the invite for you**. It shows a link. Send the link to the person yourself (WhatsApp, email…).
4. The person opens the link. Social-Nexus asks them to **sign in** (or create an account) **with the invited email address**, and then takes them back to the invite. They click **Join workspace**. The link doesn't work for any other email address.

> Social-Nexus only accepts connections from the PC it's installed on. Team members therefore need their own login **on the same PC**. Access from other PCs is planned for the Agency edition.

**Roles**

| Role | Can do |
|---|---|
| **Manager** | Everything: connect and disconnect accounts, choose the Facebook Page or Pinterest board, manage members, create, edit, approve, schedule, **publish** and **send email campaigns** |
| **Creator** | Create, edit and submit content for review; see analytics |
| **Reviewer** | Approve or request changes, comment, view |
| **Client** | Approve or request changes and comment (handy for client sign-off), view |
| **Analyst** | View content and analytics only |

Accepting an invite never lowers the role of someone who is already a member.

---

## 16. Backup, data location and privacy

### Where your data is
Everything is in one folder on your PC:

**`%APPDATA%\Social-Nexus`** (usually `C:\Users\<you>\AppData\Roaming\Social-Nexus`)

To open it, press **Windows key + R**, type `%APPDATA%\Social-Nexus` and press Enter.

| Inside | What it is |
|---|---|
| `nexus.db` (+ `nexus.db-wal`, `nexus.db-shm`) | Your posts, drafts, calendar, templates, subscribers, connected accounts, users and personal API keys |
| `sessions.db` | Who is signed in |
| `.env` | App-wide settings: social platform app details, shared AI keys, email (SMTP) password |
| `content\` | Your local content folder (unless you chose another) |
| `logs\server.log` | The technical log, used for troubleshooting |

**Coming from the older "NEXUS" app?** The first time Social-Nexus starts, it automatically moves your old NEXUS data into `%APPDATA%\Social-Nexus`. It then offers to delete the old copy. Say yes once you've checked that your posts and settings are there.

### Backing up
There's no backup button yet. To back up:
1. Right-click the Social-Nexus tray icon → **Quit Social-Nexus**. Quitting first makes sure everything is saved.
2. Copy the whole `%APPDATA%\Social-Nexus` folder to a USB drive or a private cloud folder.
3. To restore, quit Social-Nexus and copy the folder back.

**Treat the backup like a password.** It contains your connected-account logins and API keys. These are stored on your PC without extra encryption, so keep your Windows account password-protected and don't share the folder.

### Privacy in short
- Your posts, drafts and settings **stay on your PC**.
- Text is sent to an **AI provider** only when you use AI, and only to the provider being used. If you use Ollama, nothing leaves your PC.
- Posts go to a **social network** only when you publish or schedule them.
- The **licence server** receives only scrambled computer identifiers, your licence or coupon code and (for coupons and purchases) your email. It **never** receives your posts, keys or contacts.

Full details: **[Privacy and your data](privacy-and-data.md)**.

---

## 17. Uninstalling

1. Quit Social-Nexus from the tray.
2. Open **Windows Settings → Apps → Installed apps**, find **Social-Nexus**, and click **⋯ → Uninstall**.
3. Windows asks: **"Also delete all Social-Nexus data on this PC (posts, settings, connected accounts, API keys, licence)?"**
   - **No** (the default) keeps your data for a future reinstall.
   - **Yes** permanently deletes the `%APPDATA%\Social-Nexus` folder. Back it up first if you might need it.

If you're moving to a new PC, deactivate your licence before uninstalling, while the PC is online (see [Moving to a new PC](#moving-to-a-new-pc)). Reinstalling on the same PC? You can simply activate again with the same key. Updating Social-Nexus never deletes your data.

---

## 18. Troubleshooting

### Where is the log file?
`%APPDATA%\Social-Nexus\logs\server.log`. Older logs are `server.1.log` and `server.2.log`. Press **Windows key + R**, paste `%APPDATA%\Social-Nexus\logs` and press Enter. Attach `server.log` when you email support@radixile.com.

The log stays on your PC unless you send it. Before sending, you can open it in Notepad to see what's inside.

### "Ollama: not running on this computer"
1. Check for the Ollama llama icon in the tray. If it's missing, open **Ollama** from the Start menu.
2. Still red? Open Command Prompt and run `ollama serve`, and leave that window open.
3. Check that you've downloaded a model: run `ollama list`. If the list is empty, run `ollama pull llama3.2`.
4. In **Settings → 🦙 Local AI (Ollama)** click **🔄 Check**, and make sure **Active Model** matches a downloaded model.
5. If the PC has very little free RAM, close other programs or use the smaller `llama3.2:1b`.

### "API key rejected — check it in Settings → My API Keys"
The provider didn't accept your key. **My API Keys** is in the **user menu** (click your name, top right), not in Settings.
- Paste the key again, with no spaces before or after it.
- Make sure the key is in the right box (a Groq key in the Groq box, and so on).
- Check on the provider's website that the key is still active, or create a new one.
- For Claude: make sure your Anthropic account has credit.

### "busy right now (503)" or "rate limit reached (429)"
The AI service is overloaded or you've used up its free allowance for now. This isn't a problem with Social-Nexus.
- Wait a minute and try again. Social-Nexus already retried once for you.
- Choose another model on the **🤖 Model:** bar, or add a second free key so Social-Nexus can fall back to it automatically.

### "No AI provider available"
You haven't set up any AI yet. Add a free key in **user menu → My API Keys**, or install Ollama (see [Setting up AI](#7-setting-up-ai)).

### "Timed out" (no reply within 30 seconds)
This is for cloud AI. Check your internet connection, or choose a faster model (Groq is the fastest). For Ollama, see [Ollama is slow](#ollama-is-slow-or-ai-seems-stuck).

### Posts fail with "…rejected the connection… Reconnect … in Settings"
The network's login for that account has expired or lacks a permission. Some networks log you out regularly. For example, Google apps in "Testing" mode need reconnecting every 7 days.
1. Go to **Settings → 🔗 Social Platforms**.
2. On that platform's card, click **Disconnect**, then **Connect**, and sign in again. Accept **all** the permissions asked for.
3. Go back to the failed post and click **🔁 Retry**.

### Facebook: "No Facebook Page selected"
Facebook only allows posting to **Pages**, not personal profiles. On the Facebook card click **📄 Select Facebook Page** and choose your Page. See the connect guide.

### "Before connecting …, add your … app details"
You clicked **Connect** before saving the developer app details. Open **🔑 API Credentials** on the card, paste them, and click **💾 Save Credentials** first.

### "Sign-in link expired or was not started from Social-Nexus"
Start the connection again from the platform card, and finish signing in within 10 minutes. Use the window that Social-Nexus opened.

### "Port 3000 In Use" when starting
Another copy of Social-Nexus, or another program, is using the same connection port.
1. Click **Try to Connect**. If Social-Nexus was already running in the tray, it opens.
2. If that doesn't work: quit Social-Nexus from the tray, open **Task Manager** (Ctrl + Shift + Esc), end any **Social-Nexus** tasks, and start the app again.
3. If another program uses port 3000 (some developer tools do), close that program. Social-Nexus's connection addresses for the social networks depend on port 3000, so don't change it.

### Social-Nexus shows an error when starting
The message explains the actual problem and shows the log folder (`%APPDATA%\Social-Nexus\logs`). Follow the advice in the message. If it doesn't help, email support@radixile.com with a screenshot and `server.log` from that folder.

### The app window is blank or says it can't connect
Wait 10–20 seconds. The local server may still be starting, and the app retries automatically. If it doesn't recover, quit from the tray and start again. If it keeps happening, email support with `server.log`.

### Scheduled post didn't go out
- Was Social-Nexus running (at least in the tray), the PC online and awake, and the licence active at that time?
- Look under **⚠️ Failed in the last 14 days** in Compose for the reason, then **🔁 Retry**.

### A post says "Missed: it was due … but Social-Nexus wasn't running or wasn't licensed then"
The post was more than 6 hours overdue, so Social-Nexus didn't post it late on purpose. If it's still relevant, click **🔁 Retry** to post it now. Otherwise delete it. To avoid this, keep Social-Nexus running in the tray and stop the PC sleeping at your posting times. See [Missed posts](#missed-posts-are-not-posted-late).

### Ollama is slow, or AI seems stuck
- **The first request after starting takes about 30 seconds** while Ollama loads the model. This is normal.
- **Several AI actions at once wait in a queue.** Ollama works through them one after another. Wait for each to finish, and don't click the button again.
- Still too slow? Use `llama3.2:1b`, close other heavy programs, or choose a cloud AI (Groq is fastest) on the **🤖 Model:** bar.

### Licence: "Checking your licence…" or "still checking your licence"
This appears for the first few seconds after Social-Nexus starts. Wait a moment and try again.

### Licence: 🟠 "Needs internet" / "needs to connect to the internet briefly"
Your offline time (the **Works offline until** date) has run out. Connect to the internet and click **Check now** on the banner, or **🔄 Check licence now** in **Settings → 🔑 Licence**. If it says your **computer's date looks wrong**, fix the date and time in Windows first.

### Licence: 🔴 "Not valid on this PC"
Read the message under **Settings → 🔑 Licence**:
- *"…belongs to another installation"* or *"…activated on a different computer"*: activate again here with the same key. On the same PC (for example after reinstalling) this doesn't use another seat.
- *"This copy of Social-Nexus has been modified…"*: reinstall Social-Nexus from radixile.com. Your data is safe.
- *"The licence file is damaged or was changed"*: activate again.
- The licence was cancelled or put on hold: email support@radixile.com.

### "Deactivating needs the internet so your seat is freed for another PC"
You tried **Deactivate this PC** while offline. Nothing was removed and the licence still works here. Connect to the internet and click **Deactivate this PC** again.

### Publishing says "needs an active licence"
Publishing, scheduling, Retry, CSV import and email sending need an active licence. Go to **Settings → 🔑 Licence** to activate. Writing, AI, planning and export keep working meanwhile.

### Something looks wrong after an update
Quit and restart the app. Your data is kept across updates. If the problem stays, email support with `server.log`.

---

## 19. Frequently asked questions

**Is my data uploaded to Radixile?**
No. Your posts, drafts, contacts and keys stay on your PC. See [Privacy and your data](privacy-and-data.md).

**Do I have to pay for AI?**
No. Ollama is free and local. Gemini, Groq, OpenRouter and Mistral have free tiers. Claude and the image and video services are paid. You pay the provider directly, never Radixile.

**Why do I need a "developer app" to connect Facebook or LinkedIn?**
Because Social-Nexus runs privately on your PC, not as a central website, your PC talks to each network directly using your own app. This means Radixile never holds your social logins. The connect guide walks you through it, and you only do it once.

**Why does Instagram need a Business or Creator account?**
Instagram only lets apps publish to professional accounts that are linked to a Facebook Page. Personal Instagram accounts can't be posted to by any app. Switching to a Business or Creator account is free in the Instagram app.

**Can I use Social-Nexus on two PCs?**
Each activated PC uses one seat. The Individual edition has 1 seat, and the Agency edition has several. Deactivate a PC to free its seat.

**Does it work without internet?**
Yes, for drafting, the calendar, templates, Brand Kit and AI with Ollama. Publishing, cloud AI, email sending and activating need internet. After activation the licence works offline until the **Works offline until** date in **Settings → 🔑 Licence**, then it needs the internet briefly.

**Will my scheduled posts go out if my PC is off?**
No. Social-Nexus must be running (the tray is enough) at the scheduled time. Posts more than 6 hours late are marked **Missed** instead of being posted late. You can then **🔁 Retry** them.

**Can my team work from their own PCs?**
Not yet. Today team members sign in on the same PC. Multi-PC team access is planned for the Agency edition.

**I forgot my password.**
Ask your admin to reset it in **Admin Dashboard → Users**. If you are the admin, email support@radixile.com.

**Where do I get help?**
Email **support@radixile.com** with a description, a screenshot and your `server.log` file. Licence questions: https://license.radixile.com.

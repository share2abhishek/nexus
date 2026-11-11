# Connecting your social accounts to Social-Nexus

**Social-Nexus by Radixile Technology Solutions** · Support: support@radixile.com

This guide covers LinkedIn, Facebook + Instagram, Pinterest, X (Twitter), Google Business Profile, YouTube and TikTok.

> **The easiest way:** open **Settings → 🔗 Social Platforms**. Every platform card has a **📘 Setup guide** with the same steps as this page, **Open ↗** links to the right developer page, and a **📋 Copy** button for your exact callback address. Keep the card open next to the developer website and work down the steps.

---

## Before you start: how connecting works

Social-Nexus runs **on your PC**, not on a Radixile website. So that Radixile never holds your social media logins, your PC talks to each network directly using a free **developer app** that you create on that network's developer website. You do this **once per network**. After that, connecting is a single **Connect** click.

For every network the steps are the same:

1. **Create a developer app** on the network's developer website. Think of it as your own private "key" to that network's posting service.
2. **Add the products or permissions** that allow posting.
3. **Paste the callback (redirect) address** into the app. This is the address the network sends you back to after you sign in.
4. **Copy the app's ID and secret** (names vary: Client ID, App ID, API Key…) into the boxes under **🔑 API Credentials** on the card, and click **💾 Save Credentials**.
5. Click **Connect** on the card, sign in to the network and allow access.

### The 📘 Setup guide on each card

- It shows **how long setup takes**, **what you need first**, and **numbered steps**.
- A badge shows how well the platform works today:

| Badge | Platforms | Meaning |
|---|---|---|
| *(no badge)* | LinkedIn, Facebook, Instagram, Pinterest | Ready. Works fully. |
| 🟠 **Works with limits** | X (Twitter), Google Business | Works, but the network's own rules may block posting (see each section). |
| 🔴 **Not available yet** | YouTube, TikTok | Can't be posted to from Social-Nexus yet. |

- The guide is open until the platform is connected. After that you'll find it folded under **📘 Setup guide**.

### The callback address: always use 📋 Copy

The step that says *"add this exact address"* shows your callback address in a grey box with a **📋 Copy** button. **Click 📋 Copy and paste it into the developer website. Don't type it.** It must match character for character. The same address is also shown in the read-only **Callback URL** box under **🔑 API Credentials**.

Normally the addresses look like this (yours are on the cards):

| Card | Callback address |
|---|---|
| LinkedIn | `http://localhost:3000/auth/linkedin/callback` |
| Facebook + Instagram | `http://localhost:3000/auth/facebook/callback` |
| Pinterest | `http://localhost:3000/auth/pinterest/callback` |
| Twitter / X | `http://127.0.0.1:3000/auth/twitter/callback` (X needs `127.0.0.1`, not `localhost`) |
| YouTube and Google Business (one shared app) | `http://localhost:3000/auth/google/callback` |
| TikTok | `http://localhost:3000/auth/tiktok/callback` |

> **Only the admin can save app details.** The developer app details are shared by everyone on this install and by all client workspaces. Each workspace then clicks **Connect** with its **own** social login. For agencies, this means one developer app per network serves all your clients.
>
> **Only workspace Managers can connect or disconnect accounts**, and choose the Facebook Page or Pinterest board. If those buttons don't work for you, ask the workspace's Manager.

> **The portals change often.** Developer websites are redesigned regularly, so the steps name what to look for. If a button on your screen looks different, look for the closest match.

> **Keep your secrets secret.** A Client Secret works like a password. Don't post it in chats or screenshots. If it leaks, create a new one in the portal ("reset" or "regenerate") and paste the new one into Social-Nexus.

---

## Contents

- [LinkedIn](#linkedin)
- [Facebook + Instagram](#facebook--instagram)
- [Pinterest](#pinterest)
- [X (Twitter)](#x-twitter)
- [Google Business Profile](#google-business-profile)
- [YouTube](#youtube)
- [TikTok](#tiktok)
- [Errors you might see on any platform](#errors-you-might-see-on-any-platform)

---

## LinkedIn

**Ready** · About 10 minutes

### You need
- A LinkedIn account
- A LinkedIn Page for your business (LinkedIn asks for one when you create the app). Creating a Page is free.

### Steps (same as the Setup guide on the card)
1. Open the LinkedIn developer portal and click **"Create app"**. (**Open ↗** on the card goes to https://www.linkedin.com/developers/apps/new.)
2. Fill in the app name (e.g. "My Social-Nexus"), choose your LinkedIn Page, upload a logo and accept the terms.
3. Open the **"Products"** tab and add **"Sign In with LinkedIn using OpenID Connect"** and **"Share on LinkedIn"**. Both are approved straight away.
4. Open the **"Auth"** tab. Under **"Authorized redirect URLs for your app"** add this exact address: click **📋 Copy** on the card and paste it.
5. Still on **"Auth"**, copy the **Client ID** and the **Primary Client Secret** into the boxes below (under **🔑 API Credentials** on the card), then click **💾 Save Credentials**.
6. Click **Connect** and sign in to LinkedIn when asked.

You come back to Social-Nexus with "Linkedin connected successfully!", and the card shows your name.

### Good to know
- **Posts appear on your personal LinkedIn profile.**
- Posting as a company Page needs LinkedIn's **Community Management API**, which LinkedIn must approve first. This version posts to your profile.
- LinkedIn may ask a Page admin to **verify** the app (app **Settings** tab → **Verify**). If you are the Page admin, you can approve it yourself.
- LinkedIn logins last about **60 days**. After that, publishing fails with "LinkedIn rejected the connection… Reconnect". Click **Disconnect** and then **Connect** again.

### Common LinkedIn errors
| You see | What to do |
|---|---|
| "The redirect_uri does not match the registered value" | The address in the **Auth** tab must match exactly. Delete it, click **📋 Copy** on the card again, and paste it. |
| "LinkedIn connection failed — check your app credentials" | Paste the Client ID and Secret again. Make sure you copied the **Primary** Client Secret. |
| "Scope … is not authorized" | On the **Products** tab, check that both products show as added. |
| "LinkedIn authorization was denied" | You clicked Cancel. Click **Connect** again and choose **Allow**. |

---

## Facebook + Instagram

**Ready** · About 15 minutes · One Meta developer app connects your **Facebook Page** and, through it, your **Instagram professional account**.

### You need
- **A Facebook Page that you manage.** Facebook doesn't let apps post to personal profiles, only to Pages.
- **For Instagram:** an Instagram **Business** or **Creator** account linked to that Page (Instagram app → **Settings → Account type**). To link them, open your Page on Facebook → **Settings → Linked accounts → Instagram → Connect**.

  **Why?** Instagram only allows apps to publish to professional accounts that belong to a Page.

### Steps (same as the Setup guide on the card)
1. Open Meta for Developers and click **"Create app"**. (**Open ↗** goes to https://developers.facebook.com/apps.)
2. Choose the use case for managing a Page (for example **"Manage everything on your Page"**), and a **Business** app type if asked. Give it a name.
3. Add the **"Facebook Login for Business"** (or **"Facebook Login"**) product. In its **Settings**, add this to **"Valid OAuth Redirect URIs"**: click **📋 Copy** on the card and paste it.
4. Go to **App settings → Basic** and copy the **App ID** and **App Secret** into the boxes below, then click **💾 Save Credentials**.
5. Click **Connect**, sign in, and allow access to your Page (and Instagram account). If you manage several Pages, choose one with **"📄 Select Facebook Page"**.

After connecting:
- **If you manage one Page**, it's selected automatically. If it has a linked Instagram professional account, **Instagram connects automatically too**.
- **If you manage several Pages**, click **📄 Select Facebook Page** on the Facebook card and click the Page. "Instagram Business account also detected ✅" confirms Instagram.
- The card shows **Page ID** and, if linked, **Instagram** with an account number.

**Agencies:** switch to the client's workspace first (🏢 in the top bar), then click Connect and choose **that client's** Page.

Social-Nexus asks Facebook for these permissions when you connect: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`, `public_profile` and `email`.

### Good to know
- While your Meta app is in **Development mode**, it works for you and anyone you add as a tester or admin on the app (**App roles → Roles**). That's enough for your own Pages.
- Letting people outside your app use it (for example clients signing in with their own Facebook accounts) needs **Meta App Review** for `pages_manage_posts` and `instagram_content_publish`, plus business verification. This can take days to weeks. Agencies can avoid it by adding each client's Facebook user as a **Tester** on the app.
- **Instagram posts need an image at a public web address (`https://…`).** Text-only Instagram posts aren't possible.
- The Facebook login usually lasts around **60 days**. When posts fail with "Token expired or invalid. Reconnect Facebook in Settings", click **Disconnect** and then **Connect**.

### If the Connect button doesn't work: paste a token (Facebook only)
Once the app details are saved, the Facebook card offers **🔑 Paste token manually (if OAuth fails)**. This option exists only for Facebook.
1. Open the **Graph API Explorer** (https://developers.facebook.com/tools/explorer).
2. Select your app → **Generate Access Token** (tick the permissions listed above) → copy it.
3. Paste it into the box and click **✅ Connect with Token**. Use **📄 Select Facebook Page** to choose the Page.

Tokens from the Explorer are short-lived (often about 1 hour). Use this only as a temporary workaround.

### Common Facebook and Instagram errors
| You see | What to do |
|---|---|
| "URL blocked: This redirect failed because the redirect URI is not whitelisted" | Paste the address from **📋 Copy** under **Valid OAuth Redirect URIs**, and save. |
| "No Facebook Page selected. Choose one in Settings → Facebook → Select page." | Click **📄 Select Facebook Page** on the card. |
| "No pages found" | During sign-in you didn't give access to any Page, or your account isn't a Page admin. Click **Disconnect**, then **Connect**, and tick your Page. |
| "Missing permission: pages_manage_posts" / "App permission denied" | Add the permission to the app (and App Review if the Page owner has no app role), then reconnect. |
| Instagram card doesn't turn green | Check that the Instagram account is **Business/Creator** and **linked to that Page**, then click **📄 Select Facebook Page** and choose the Page again. |
| "Instagram requires an image URL" | Add an Image URL in Compose. |
| "Facebook connection failed — check your app credentials" | Paste the App ID and App Secret again. |
| "App not active" / "This app is in development mode" | The person signing in has no role on the app. Add them under **App roles**, or complete App Review. |

---

## Pinterest

**Ready** · About 10 minutes

### You need
- A **Pinterest Business account** (free; convert a personal account under **Settings → Account management**), with at least one board.

### Steps (same as the Setup guide on the card)
1. Open **Pinterest Developers → My apps** and connect a new app. (**Open ↗** goes to https://developers.pinterest.com/apps/.)
2. In the app settings, add this redirect URI: click **📋 Copy** on the card and paste it.
3. Copy the **App ID** and **App secret key** into the boxes below, then click **💾 Save Credentials**.
4. Click **Connect**, then choose the board to pin to with **"📌 Select Board"**.

### Good to know
- New Pinterest apps start with **Trial access**. Pins may only be visible to you until Pinterest grants **Standard access** (request it from your app page; Pinterest reviews it).
- **Every pin needs an image.**
- Social-Nexus asks for `boards:read`, `pins:write` and `user_accounts:read`.

### Common Pinterest errors
| You see | What to do |
|---|---|
| "Pinterest connection failed" | Check the App ID and secret, and that the redirect URI was pasted with **📋 Copy**. |
| Posts fail with 401 or 403 | Your app may still be on **Trial** access. Request **Standard** access. |
| Pin fails without an image | Add an Image URL. A pin must have a picture. |
| Pin goes to the wrong board | Click **📌 Select Board** and choose the right one. |

---

## X (Twitter)

🟠 **Works with limits** · About 15 minutes

### You need
- An **X developer account**
- An **X API plan that allows posting** (check current plans on the developer portal). X changes its plans and prices often.

### Steps (same as the Setup guide on the card)
1. Open the **X Developer Portal** and create a **Project** and **App**. (**Open ↗** goes to https://developer.x.com/en/portal/dashboard.)
2. Open the app's **"User authentication settings"**. Choose App permissions **"Read and write"** and type **"Web App, Automated App or Bot"**.
3. Set **"Callback URI / Redirect URL"** to this exact address (X needs `127.0.0.1`, not "localhost"): click **📋 Copy** on the card and paste it.
4. Enter any website address you own as the **Website URL**, then save.
5. Open **"Keys and tokens"** and copy the **API Key** and **API Key Secret** into the boxes below. The **Access Token** fields are optional. Click **💾 Save Credentials**.
6. Click **Connect** and authorise the app.

The card then shows your @username.

### Good to know
- X changes its API plans and limits often. **If posting fails with a 403 error, your plan may not include posting.**
- **Images are not attached to X posts yet; the text is posted.**
- Posts are limited to **280 characters**. Social-Nexus warns you and won't post if you go over.
- If you changed App permissions to "Read and write" **after** connecting, disconnect and connect again. The old login keeps the old read-only permission.

### Common X errors
| You see | What to do |
|---|---|
| "Twitter connection failed" straight after clicking Connect | Check the API Key and Secret, and that the callback address is saved in **User authentication settings**. |
| "Callback URL not approved" | The callback isn't saved or doesn't match. Paste it again with **📋 Copy**. It must start with `http://127.0.0.1`. |
| Error 403 when posting | App permissions are still **Read** (change to **Read and write**, then disconnect and connect), or your plan doesn't include posting or its limit is used up. |
| Error 429 | Rate limit. Try again later. |

---

## Google Business Profile

🟠 **Works with limits** · About 20 minutes, plus Google's approval

The **Google Business** and **YouTube** cards share **one** Google app (the same Client ID and Secret, and the same callback address).

### You need
- A **verified** Google Business Profile

### Steps (same as the Setup guide on the card)
1. Open **Google Cloud Console** and create a project. (**Open ↗** goes to https://console.cloud.google.com/projectcreate.)
2. Request access to the **Google Business Profile APIs**. Google reviews these requests; it can take a few days. (**Open ↗** goes to Google's prerequisites page.)
3. In **APIs & Services → OAuth consent screen**, choose **"External"** and add your own Google account as a **Test user**.
4. In **APIs & Services → Credentials**, create an **"OAuth client ID"** of type **"Web application"**. Add this **Authorised redirect URI**: click **📋 Copy** on the card and paste it.
5. Copy the **Client ID** and **Client secret** into the boxes below, then click **💾 Save Credentials** and **Connect**.

When you connect, Google may warn **"Google hasn't verified this app"**. That's expected for your own app. Click **Continue**, tick **all** the permission boxes, and click **Continue**.

### Good to know
- **Until Google approves API access, posting returns a permission error.** Enabling the APIs isn't enough. Approval can take days to weeks.
- In **Testing** mode Google ends the login after **7 days**, so you'll need to click **Disconnect → Connect** about once a week. Publishing the app "In production" avoids this but needs Google's app verification.
- **Which location:** Social-Nexus looks through every account this Google login manages. With one location, posts go there. With several, the card says **Choose which location to post to**: click **Choose location** and pick one (you can change it any time with **Change location**). The card then shows **Posting to …**.
- Keep posts under **1,500 characters** (longer text is cut off, and you're told).
- **Post types:** in Create post choose **Update**, **Offer** (dates, coupon code, link, terms) or **Event** (dates and times), with an optional button such as Book, Order online or Call now. One photo per post; Google doesn't take videos through its API.

### Common Google errors
| You see | What to do |
|---|---|
| "Error 400: redirect_uri_mismatch" | Paste the address from **📋 Copy** under **Authorised redirect URIs** of the **Web application** client. |
| "Error 403: access_denied" / "has not completed the Google verification process" | Add your Google account under **Test users**. |
| "OAuth error: google_failed" | Paste the Client ID and Secret again. Make sure the client type is **Web application**. |
| "Google hasn’t given your Google Cloud project access to the Business Profile APIs yet" (shown when you connect or post) | Google hasn't approved your Business Profile API access yet (its limit is 0). Request access, wait for Google's answer, then connect again. |
| "Turn on the My Business … API" | In Google Cloud Console → APIs & Services → Library, turn on the **My Business Account Management API** and **My Business Business Information API**. |
| "You manage several Google Business locations: choose one" | Click **Choose location** on the Google Business card. |
| Posts fail after about a week | Testing-mode login expired. **Disconnect → Connect**. |
| "No Google Business locations found" | The connected Google account doesn't manage a business location. |

---

## YouTube

🔴 **Not available yet**

YouTube's public API can upload videos, but it can't create Community posts (text or image). Social-Nexus doesn't upload videos yet, so YouTube can be connected but not posted to.

**Publish to YouTube from YouTube Studio for now.** If you try to post to YouTube, you'll see: "Posting text or images to YouTube is not possible through the public YouTube API. Publish there from YouTube Studio for now."

---

## TikTok

🔴 **Not available yet**

TikTok only allows web apps with a public `https` redirect address, and posts from unaudited apps must be private. A desktop app on your own PC can't meet these rules yet.

**Post to TikTok from the TikTok app for now.**

---

## Errors you might see on any platform

| Message in Social-Nexus | Meaning | What to do |
|---|---|---|
| "Before connecting …, add your … app details in Settings → Social Platforms" | You clicked **Connect** before saving the credentials. | Open **🔑 API Credentials**, paste the details, and click **💾 Save Credentials**. |
| "… authorization was denied" | You clicked **Cancel** or **Deny** on the network's page. | Connect again and approve. |
| "… connection failed — check your app credentials" | The network didn't accept the app details or callback address. | Paste the ID and secret again, and paste the callback address again with **📋 Copy**. |
| "Sign-in link expired or was not started from Social-Nexus — please try connecting again" | You took more than 10 minutes, or started the sign-in in a different window. | Click **Connect** again and finish within 10 minutes. |
| "… rejected the connection (401/403) — the login has expired or lacks permission. Reconnect … in Settings." | The login expired or a permission was removed. | **Disconnect → Connect**, accept all permissions, then **🔁 Retry** the post. |
| "… rate limit reached — try again later." | The network's limit for your app was hit. | Wait, then try again. |
| "… is having problems (5xx) — try again later." | The network's servers had a problem. | Try again later. |
| "Only an admin can change app-wide settings" | You aren't the admin of this install. | Ask your admin to save the app details. |

**Callback address checklist** (the most common cause of failed connections):
- Use the card's **📋 Copy** button. Don't type the address.
- `http`, not `https`.
- X uses `127.0.0.1`; all other platforms use `localhost`.
- No space or `/` at the end.

Still stuck? Email **support@radixile.com** with the platform name, a screenshot of the error, and your log file `%APPDATA%\Social-Nexus\logs\server.log`. **Never send us your Client Secret or passwords.**

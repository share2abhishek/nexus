# NEXUS — AI Social & SEO Automation Platform
### Complete Developer Guide & Setup Manual

---

## Table of Contents
1. [Project Structure](#project-structure)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Environment Setup](#environment-setup)
5. [Platform API Setup](#platform-api-setup)
6. [Running the App](#running-the-app)
7. [API Reference](#api-reference)
8. [Local Folder Integration](#local-folder-integration)
9. [Troubleshooting](#troubleshooting)

---

## Project Structure

```
nexus/
├── server/
│   └── index.js              # Express server entry point
├── routes/
│   ├── auth.js               # OAuth routes (LinkedIn, Facebook, Pinterest)
│   └── api.js                # AI generation + posting API
├── services/
│   ├── database.js           # SQLite local database
│   ├── social.js             # Platform posting service
│   └── scheduler.js          # Cron-based post scheduler
├── public/
│   └── index.html            # Frontend UI (copy social-seo-ai.html here)
├── data/
│   └── nexus.db              # Auto-created SQLite database
├── .env                      # Your credentials (copy from .env.example)
├── .env.example              # Template
└── package.json
```

---

## Prerequisites

- **Node.js** v18 or higher → https://nodejs.org
- **npm** v9 or higher (comes with Node)
- **Git** (optional)

Check versions:
```bash
node -v
npm -v
```

---

## Installation

```bash
# 1. Create project folder
mkdir nexus && cd nexus

# 2. Copy all the generated files into this folder
#    (server/, routes/, services/, public/, package.json, .env.example)

# 3. Install dependencies
npm install

# 4. Copy env template
cp .env.example .env
```

---

## Environment Setup

Edit `.env` with your credentials:

```env
PORT=3000
SESSION_SECRET=pick-any-long-random-string

ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_CALLBACK_URL=http://localhost:3000/auth/linkedin/callback

FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_CALLBACK_URL=http://localhost:3000/auth/facebook/callback

PINTEREST_APP_ID=
PINTEREST_APP_SECRET=
PINTEREST_CALLBACK_URL=http://localhost:3000/auth/pinterest/callback

# Optional: local content folder
CONTENT_FOLDER=D:/social
```

---

## Platform API Setup

### LinkedIn
1. Go to https://www.linkedin.com/developers/apps
2. Click **Create App**
3. Fill in app name, LinkedIn Page, logo
4. Under **Products** → request **Share on LinkedIn** + **Sign In with LinkedIn**
5. Under **Auth** tab → add Redirect URL:
   ```
   http://localhost:3000/auth/linkedin/callback
   ```
6. Copy **Client ID** and **Client Secret** → paste into `.env`

**Required OAuth Scopes:**
```
r_liteprofile
r_emailaddress
w_member_social
```

---

### Facebook + Instagram
1. Go to https://developers.facebook.com/apps
2. Click **Create App** → choose **Business** type
3. Add products: **Facebook Login** + **Instagram Graph API**
4. Under Facebook Login → Settings → add Valid OAuth Redirect URI:
   ```
   http://localhost:3000/auth/facebook/callback
   ```
5. Under App Settings → Basic → copy **App ID** and **App Secret** → paste into `.env`
6. For Instagram posting:
   - Your Instagram must be a **Business or Creator account**
   - Must be linked to a **Facebook Page**
   - The app will auto-detect the Instagram account after Facebook OAuth

**Required Permissions:**
```
pages_manage_posts
pages_read_engagement
pages_show_list
instagram_basic
instagram_content_publish
```

> ⚠️ For production use, your Facebook app needs to go through App Review.
> For personal/testing use, add yourself as a Test User under Roles.

---

### Pinterest
1. Go to https://developers.pinterest.com/apps
2. Click **Create app**
3. Add redirect URI:
   ```
   http://localhost:3000/auth/pinterest/callback
   ```
4. Copy **App ID** and **App Secret** → paste into `.env`

**Required Scopes:**
```
boards:read
pins:write
user_accounts:read
```

---

### Anthropic (Claude AI)
1. Go to https://console.anthropic.com
2. Create account → go to **API Keys**
3. Click **Create Key**
4. Copy key → paste into `.env` as `ANTHROPIC_API_KEY`

> You can also enter the key directly in the app UI — no need to put it in `.env`

---

## Running the App

```bash
# Production
npm start

# Development (auto-restarts on file change)
npm run dev
```

Then open your browser at:
```
http://localhost:3000
```

The app will auto-open in your browser on startup.

---

## Connecting Social Accounts

Once the server is running, visit these URLs to connect each platform:

| Platform | URL |
|----------|-----|
| LinkedIn | http://localhost:3000/auth/linkedin |
| Facebook + Instagram | http://localhost:3000/auth/facebook |
| Pinterest | http://localhost:3000/auth/pinterest |
| Check all connections | http://localhost:3000/auth/status |

---

## API Reference

### Generate AI Content
```http
POST /api/generate
Content-Type: application/json
x-api-key: sk-ant-...   (optional if set in .env)

{
  "prompt": "Write a LinkedIn post about...",
  "max_tokens": 1000,
  "type": "social_post"
}
```

### Post Immediately
```http
POST /api/post/now
Content-Type: application/json

{
  "content": "Your post text here...",
  "platforms": ["linkedin", "facebook", "instagram"],
  "image_url": "https://example.com/image.jpg"
}
```

### Schedule a Post
```http
POST /api/post/schedule
Content-Type: application/json

{
  "content": "Your scheduled post...",
  "platforms": ["linkedin", "facebook"],
  "scheduled_at": "2026-06-01T09:00:00",
  "image_url": "https://example.com/image.jpg"
}
```

### Get Scheduled Posts
```http
GET /api/posts/scheduled
```

### Get Post History
```http
GET /api/posts/history
```

### Get AI Generation History
```http
GET /api/history
```

### Check Connection Status
```http
GET /auth/status
```

### Disconnect a Platform
```http
POST /auth/disconnect/linkedin
POST /auth/disconnect/facebook
POST /auth/disconnect/pinterest
```

---

## Local Folder Integration (D:/social)

Add this to your `.env`:
```env
CONTENT_FOLDER=D:/social
```

Then add this route to `routes/api.js`:

```javascript
const fs = require('fs');
const path = require('path');

// GET /api/local/files — list files in CONTENT_FOLDER
router.get('/local/files', (req, res) => {
  const folder = process.env.CONTENT_FOLDER;
  if (!folder || !fs.existsSync(folder)) {
    return res.status(404).json({ error: 'Folder not found: ' + folder });
  }
  const files = fs.readdirSync(folder).map(name => ({
    name,
    path: path.join(folder, name),
    ext: path.extname(name).toLowerCase(),
    size: fs.statSync(path.join(folder, name)).size
  }));
  res.json(files);
});

// GET /api/local/read?file=filename.txt
router.get('/local/read', (req, res) => {
  const folder = process.env.CONTENT_FOLDER;
  const filePath = path.join(folder, req.query.file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  const content = fs.readFileSync(filePath, 'utf8');
  res.json({ content, name: req.query.file });
});
```

Supported file types in `D:/social`:
| Type | Use Case |
|------|----------|
| `.txt` / `.md` | Import as draft content |
| `.jpg` / `.png` | Attach as post images |
| `.csv` | Bulk schedule posts |
| `.json` | Content templates |

---

## CSV Bulk Scheduling

Create a file `D:/social/schedule.csv`:
```csv
content,platforms,scheduled_at,image_url
"Post 1 text here","linkedin,facebook","2026-06-01 09:00",
"Post 2 text here","instagram","2026-06-02 10:00","https://..."
"Post 3 text here","linkedin","2026-06-03 11:00",
```

Then add to `routes/api.js`:
```javascript
const fs = require('fs');

router.post('/local/import-csv', (req, res) => {
  const csvPath = path.join(process.env.CONTENT_FOLDER, 'schedule.csv');
  if (!fs.existsSync(csvPath)) return res.status(404).json({ error: 'schedule.csv not found in CONTENT_FOLDER' });

  const lines = fs.readFileSync(csvPath, 'utf8').split('\n').slice(1); // skip header
  let imported = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const [content, platformsRaw, scheduled_at, image_url] = line.split(',').map(s => s.replace(/^"|"$/g, '').trim());
    const platforms = platformsRaw.split(';').map(p => p.trim());
    const timestamp = Math.floor(new Date(scheduled_at).getTime() / 1000);
    db.saveScheduled({ content, platforms, image_url: image_url || null, scheduled_at: timestamp });
    imported++;
  }

  res.json({ success: true, imported });
});
```

---

## Database Location

SQLite database is auto-created at:
```
nexus/data/nexus.db
```

View with any SQLite browser, e.g.:
- https://sqlitebrowser.org (free, Windows/Mac/Linux)

Tables:
| Table | Contents |
|-------|----------|
| `tokens` | OAuth tokens for each platform |
| `posts` | Published post history |
| `scheduled_posts` | Queue of scheduled posts |
| `history` | AI generation history |

---

## Troubleshooting

### `npm install` fails on `better-sqlite3`
```bash
npm install --build-from-source better-sqlite3
```
Or install Python + Visual Studio Build Tools (Windows):
```bash
npm install --global windows-build-tools
```

### Port 3000 already in use
Change port in `.env`:
```env
PORT=3001
```

### LinkedIn posts failing
- Ensure your app has **Share on LinkedIn** product approved
- Token expires in 60 days — re-auth at `/auth/linkedin`
- Check scopes include `w_member_social`

### Facebook posts failing
- Must use a **Page token**, not personal profile token
- Visit `/api/facebook/pages` to list your pages
- Call `POST /api/facebook/set-page` with the correct page ID

### Instagram posts failing
- Instagram requires an **image URL** — text-only posts are not supported
- Account must be **Business or Creator** type
- Must be linked to a Facebook Page

### Scheduler not running
The cron scheduler starts automatically with the server.
Check the console for: `[Scheduler] Running — checks every minute`

### SQLite errors on Windows
Use forward slashes or escaped backslashes in paths:
```env
CONTENT_FOLDER=D:/social
# or
CONTENT_FOLDER=D:\\social
```

---

## Quick Start Checklist

```
[ ] Node.js 18+ installed
[ ] npm install completed
[ ] .env file created and filled
[ ] Anthropic API key added
[ ] npm start → server running at localhost:3000
[ ] Visit /auth/linkedin → connect LinkedIn
[ ] Visit /auth/facebook → connect Facebook + Instagram
[ ] Open app → enter API key → start generating
[ ] Test post using "Post Now" button
[ ] Set up scheduler for automated posting
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Scheduler | node-cron |
| AI | Anthropic Claude API |
| LinkedIn | LinkedIn UGC API v2 |
| Facebook/Instagram | Meta Graph API v18 |
| Pinterest | Pinterest API v5 |
| Frontend | Vanilla HTML/CSS/JS |

---

## Support

- Anthropic Docs: https://docs.anthropic.com
- LinkedIn API: https://learn.microsoft.com/en-us/linkedin/
- Meta Graph API: https://developers.facebook.com/docs/graph-api
- Pinterest API: https://developers.pinterest.com/docs/

---

*NEXUS v1.0 — Built with Claude*

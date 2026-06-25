const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'nexus.db'));

// Enable WAL for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT,
    role          TEXT DEFAULT 'user',
    status        TEXT DEFAULT 'active',
    last_active   INTEGER,
    created_at    INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id       INTEGER PRIMARY KEY,
    google_ai_key TEXT,
    anthropic_key TEXT,
    ollama_enabled INTEGER DEFAULT 0,
    ollama_model  TEXT DEFAULT 'llama3.2',
    ollama_url    TEXT DEFAULT 'http://localhost:11434',
    stability_key TEXT,
    openai_key    TEXT,
    luma_key      TEXT,
    runway_key    TEXT,
    default_text_model TEXT DEFAULT 'ollama',
    updated_at    INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ── Safe column migrations ─────────────────────────────────────────────────────
const userDataTables = ['tokens','posts','scheduled_posts','history','analytics',
                        'apps','brand_kit','templates','email_subscribers',
                        'email_campaigns','seo_keywords','utm_links'];
for (const t of userDataTables) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN user_id INTEGER DEFAULT 1`); } catch {}
}
try { db.exec(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN last_active INTEGER`); } catch {}
try { db.exec(`ALTER TABLE user_settings ADD COLUMN default_text_model TEXT DEFAULT 'ollama'`); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    platform    TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at  INTEGER,
    profile     TEXT,
    page_id     TEXT,
    page_token  TEXT,
    ig_account_id TEXT,
    board_id    TEXT,
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    content     TEXT NOT NULL,
    platforms   TEXT NOT NULL,
    image_url   TEXT,
    results     TEXT,
    status      TEXT DEFAULT 'published',
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    content      TEXT NOT NULL,
    platforms    TEXT NOT NULL,
    image_url    TEXT,
    scheduled_at INTEGER NOT NULL,
    status       TEXT DEFAULT 'pending',
    result       TEXT,
    created_at   INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt      TEXT NOT NULL,
    response    TEXT NOT NULL,
    type        TEXT,
    model       TEXT,
    tokens_used INTEGER,
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS analytics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id     INTEGER,
    platform    TEXT NOT NULL,
    likes       INTEGER DEFAULT 0,
    comments    INTEGER DEFAULT 0,
    shares      INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks      INTEGER DEFAULT 0,
    recorded_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );

  CREATE TABLE IF NOT EXISTS apps (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    description    TEXT,
    website        TEXT,
    app_store_url  TEXT,
    play_store_url TEXT,
    category       TEXT,
    logo_url       TEXT,
    color          TEXT DEFAULT '#7c3aed',
    created_at     INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS brand_kit (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name     TEXT,
    primary_color    TEXT DEFAULT '#7c3aed',
    secondary_color  TEXT DEFAULT '#3b82f6',
    accent_color     TEXT DEFAULT '#06b6d4',
    logo_url         TEXT,
    font_name        TEXT DEFAULT 'Inter',
    brand_voice      TEXT,
    tagline          TEXT,
    target_audience  TEXT,
    updated_at       INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    content    TEXT NOT NULL,
    type       TEXT DEFAULT 'social_post',
    platforms  TEXT,
    tags       TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS email_subscribers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT UNIQUE NOT NULL,
    name       TEXT,
    tags       TEXT,
    status     TEXT DEFAULT 'active',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS email_campaigns (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    subject      TEXT NOT NULL,
    html_content TEXT,
    text_content TEXT,
    status       TEXT DEFAULT 'draft',
    sent_count   INTEGER DEFAULT 0,
    sent_at      INTEGER,
    created_at   INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS seo_keywords (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword    TEXT NOT NULL,
    url        TEXT,
    position   INTEGER,
    notes      TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS utm_links (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    original_url TEXT NOT NULL,
    utm_source   TEXT,
    utm_medium   TEXT,
    utm_campaign TEXT,
    utm_term     TEXT,
    utm_content  TEXT,
    full_url     TEXT NOT NULL,
    label        TEXT,
    clicks       INTEGER DEFAULT 0,
    created_at   INTEGER DEFAULT (strftime('%s','now'))
  );
`);

// ── Token Operations ──────────────────────────────────────────────────────────

function saveToken(platform, data) {
  const stmt = db.prepare(`
    INSERT INTO tokens (platform, access_token, refresh_token, expires_at, profile, page_id, page_token, ig_account_id, board_id)
    VALUES (@platform, @access_token, @refresh_token, @expires_at, @profile, @page_id, @page_token, @ig_account_id, @board_id)
    ON CONFLICT(platform) DO UPDATE SET
      access_token   = excluded.access_token,
      refresh_token  = excluded.refresh_token,
      expires_at     = excluded.expires_at,
      profile        = excluded.profile,
      page_id        = excluded.page_id,
      page_token     = excluded.page_token,
      ig_account_id  = excluded.ig_account_id,
      board_id       = excluded.board_id,
      created_at     = strftime('%s','now')
  `);
  stmt.run({
    platform,
    access_token:   data.access_token   || null,
    refresh_token:  data.refresh_token  || null,
    expires_at:     data.expires_at     || null,
    profile:        data.profile        ? JSON.stringify(data.profile) : null,
    page_id:        data.page_id        || null,
    page_token:     data.page_token     || null,
    ig_account_id:  data.ig_account_id  || null,
    board_id:       data.board_id       || null,
  });
}

function getToken(platform) {
  const row = db.prepare('SELECT * FROM tokens WHERE platform = ?').get(platform);
  if (!row) return null;
  if (row.profile) {
    try { row.profile = JSON.parse(row.profile); } catch {}
  }
  return row;
}

function deleteToken(platform) {
  db.prepare('DELETE FROM tokens WHERE platform = ?').run(platform);
}

function getAllTokens() {
  const rows = db.prepare('SELECT platform, profile, created_at, page_id, ig_account_id, board_id FROM tokens').all();
  return rows.map(r => {
    if (r.profile) { try { r.profile = JSON.parse(r.profile); } catch {} }
    return r;
  });
}

// ── Post Operations ───────────────────────────────────────────────────────────

function savePost(data) {
  const stmt = db.prepare(`
    INSERT INTO posts (content, platforms, image_url, results, status)
    VALUES (@content, @platforms, @image_url, @results, @status)
  `);
  const info = stmt.run({
    content:   data.content,
    platforms: JSON.stringify(data.platforms),
    image_url: data.image_url || null,
    results:   data.results ? JSON.stringify(data.results) : null,
    status:    data.status || 'published',
  });
  return info.lastInsertRowid;
}

function getPostHistory(limit = 50) {
  return db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT ?').all(limit).map(p => ({
    ...p,
    platforms: tryParse(p.platforms),
    results:   tryParse(p.results),
  }));
}

// ── Scheduled Post Operations ─────────────────────────────────────────────────

function saveScheduled(data) {
  const stmt = db.prepare(`
    INSERT INTO scheduled_posts (content, platforms, image_url, scheduled_at)
    VALUES (@content, @platforms, @image_url, @scheduled_at)
  `);
  const info = stmt.run({
    content:      data.content,
    platforms:    JSON.stringify(data.platforms),
    image_url:    data.image_url || null,
    scheduled_at: data.scheduled_at,
  });
  return info.lastInsertRowid;
}

function getDuePosts() {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(
    "SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_at <= ?"
  ).all(now).map(p => ({ ...p, platforms: tryParse(p.platforms) }));
}

function getScheduledPosts() {
  return db.prepare(
    "SELECT * FROM scheduled_posts WHERE status = 'pending' ORDER BY scheduled_at ASC"
  ).all().map(p => ({ ...p, platforms: tryParse(p.platforms) }));
}

function updateScheduledStatus(id, status, result) {
  db.prepare('UPDATE scheduled_posts SET status = ?, result = ? WHERE id = ?')
    .run(status, result ? JSON.stringify(result) : null, id);
}

function deleteScheduled(id) {
  db.prepare('DELETE FROM scheduled_posts WHERE id = ?').run(id);
}

// ── AI History Operations ─────────────────────────────────────────────────────

function saveHistory(data) {
  db.prepare(`
    INSERT INTO history (prompt, response, type, model, tokens_used)
    VALUES (@prompt, @response, @type, @model, @tokens_used)
  `).run({
    prompt:      data.prompt,
    response:    data.response,
    type:        data.type || 'social_post',
    model:       data.model || null,
    tokens_used: data.tokens_used || null,
  });
}

function getHistory(limit = 50) {
  return db.prepare('SELECT * FROM history ORDER BY created_at DESC LIMIT ?').all(limit);
}

// ── Analytics Operations ──────────────────────────────────────────────────────

function saveAnalytics(data) {
  db.prepare(`
    INSERT INTO analytics (post_id, platform, likes, comments, shares, impressions, clicks)
    VALUES (@post_id, @platform, @likes, @comments, @shares, @impressions, @clicks)
  `).run({
    post_id:     data.post_id || null,
    platform:    data.platform,
    likes:       data.likes       || 0,
    comments:    data.comments    || 0,
    shares:      data.shares      || 0,
    impressions: data.impressions || 0,
    clicks:      data.clicks      || 0,
  });
}

function getAnalytics() {
  return db.prepare(`
    SELECT a.*, p.content, p.created_at as posted_at
    FROM analytics a
    LEFT JOIN posts p ON p.id = a.post_id
    ORDER BY a.recorded_at DESC
  `).all();
}

function getAnalyticsSummary() {
  return db.prepare(`
    SELECT
      platform,
      COUNT(*) as post_count,
      SUM(likes) as total_likes,
      SUM(comments) as total_comments,
      SUM(shares) as total_shares,
      SUM(impressions) as total_impressions,
      SUM(clicks) as total_clicks
    FROM analytics
    GROUP BY platform
  `).all();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tryParse(val) {
  if (!val) return val;
  try { return JSON.parse(val); } catch { return val; }
}

// ── Apps ──────────────────────────────────────────────────────────────────────

function getApps() {
  return db.prepare('SELECT * FROM apps ORDER BY created_at DESC').all();
}

function saveApp(data) {
  const info = db.prepare(`
    INSERT INTO apps (name, description, website, app_store_url, play_store_url, category, logo_url, color)
    VALUES (@name, @description, @website, @app_store_url, @play_store_url, @category, @logo_url, @color)
  `).run({
    name: data.name, description: data.description || null, website: data.website || null,
    app_store_url: data.app_store_url || null, play_store_url: data.play_store_url || null,
    category: data.category || null, logo_url: data.logo_url || null, color: data.color || '#7c3aed',
  });
  return info.lastInsertRowid;
}

function updateApp(id, data) {
  db.prepare(`
    UPDATE apps SET name=@name, description=@description, website=@website,
    app_store_url=@app_store_url, play_store_url=@play_store_url,
    category=@category, logo_url=@logo_url, color=@color WHERE id=@id
  `).run({ id, name: data.name, description: data.description || null, website: data.website || null,
    app_store_url: data.app_store_url || null, play_store_url: data.play_store_url || null,
    category: data.category || null, logo_url: data.logo_url || null, color: data.color || '#7c3aed' });
}

function deleteApp(id) {
  db.prepare('DELETE FROM apps WHERE id = ?').run(id);
}

// ── Brand Kit ─────────────────────────────────────────────────────────────────

function getBrandKit() {
  return db.prepare('SELECT * FROM brand_kit ORDER BY id DESC LIMIT 1').get() || {};
}

function saveBrandKit(data) {
  const existing = getBrandKit();
  if (existing.id) {
    db.prepare(`
      UPDATE brand_kit SET company_name=@company_name, primary_color=@primary_color,
      secondary_color=@secondary_color, accent_color=@accent_color, logo_url=@logo_url,
      font_name=@font_name, brand_voice=@brand_voice, tagline=@tagline,
      target_audience=@target_audience, updated_at=strftime('%s','now') WHERE id=@id
    `).run({ id: existing.id, ...data });
  } else {
    db.prepare(`
      INSERT INTO brand_kit (company_name, primary_color, secondary_color, accent_color, logo_url, font_name, brand_voice, tagline, target_audience)
      VALUES (@company_name, @primary_color, @secondary_color, @accent_color, @logo_url, @font_name, @brand_voice, @tagline, @target_audience)
    `).run(data);
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

function getTemplates(type) {
  if (type) return db.prepare('SELECT * FROM templates WHERE type = ? ORDER BY created_at DESC').all(type);
  return db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all();
}

function saveTemplate(data) {
  const info = db.prepare(`
    INSERT INTO templates (name, content, type, platforms, tags)
    VALUES (@name, @content, @type, @platforms, @tags)
  `).run({
    name: data.name, content: data.content,
    type: data.type || 'social_post',
    platforms: data.platforms ? JSON.stringify(data.platforms) : null,
    tags: data.tags || null,
  });
  return info.lastInsertRowid;
}

function deleteTemplate(id) {
  db.prepare('DELETE FROM templates WHERE id = ?').run(id);
}

// ── Email Subscribers ─────────────────────────────────────────────────────────

function getEmailSubscribers() {
  return db.prepare('SELECT * FROM email_subscribers ORDER BY created_at DESC').all();
}

function saveEmailSubscriber(data) {
  const info = db.prepare(`
    INSERT INTO email_subscribers (email, name, tags) VALUES (@email, @name, @tags)
  `).run({ email: data.email, name: data.name || null, tags: data.tags || null });
  return info.lastInsertRowid;
}

function updateEmailSubscriber(id, data) {
  db.prepare('UPDATE email_subscribers SET name=@name, tags=@tags, status=@status WHERE id=@id')
    .run({ id, name: data.name || null, tags: data.tags || null, status: data.status || 'active' });
}

function deleteEmailSubscriber(id) {
  db.prepare('DELETE FROM email_subscribers WHERE id = ?').run(id);
}

// ── Email Campaigns ───────────────────────────────────────────────────────────

function getEmailCampaigns() {
  return db.prepare('SELECT * FROM email_campaigns ORDER BY created_at DESC').all();
}

function getEmailCampaign(id) {
  return db.prepare('SELECT * FROM email_campaigns WHERE id = ?').get(id);
}

function saveEmailCampaign(data) {
  const info = db.prepare(`
    INSERT INTO email_campaigns (name, subject, html_content, text_content)
    VALUES (@name, @subject, @html_content, @text_content)
  `).run({ name: data.name, subject: data.subject, html_content: data.html_content || null, text_content: data.text_content || null });
  return info.lastInsertRowid;
}

function updateEmailCampaign(id, data) {
  db.prepare(`
    UPDATE email_campaigns SET name=@name, subject=@subject, html_content=@html_content,
    text_content=@text_content, status=@status WHERE id=@id
  `).run({ id, name: data.name, subject: data.subject, html_content: data.html_content || null,
    text_content: data.text_content || null, status: data.status || 'draft' });
}

function markCampaignSent(id, sentCount) {
  db.prepare(`UPDATE email_campaigns SET status='sent', sent_count=@sent_count, sent_at=strftime('%s','now') WHERE id=@id`)
    .run({ id, sent_count: sentCount });
}

function deleteEmailCampaign(id) {
  db.prepare('DELETE FROM email_campaigns WHERE id = ?').run(id);
}

// ── SEO Keywords ──────────────────────────────────────────────────────────────

function getSEOKeywords() {
  return db.prepare('SELECT * FROM seo_keywords ORDER BY created_at DESC').all();
}

function saveSEOKeyword(data) {
  const info = db.prepare(`
    INSERT INTO seo_keywords (keyword, url, position, notes)
    VALUES (@keyword, @url, @position, @notes)
  `).run({ keyword: data.keyword, url: data.url || null, position: data.position || null, notes: data.notes || null });
  return info.lastInsertRowid;
}

function deleteSEOKeyword(id) {
  db.prepare('DELETE FROM seo_keywords WHERE id = ?').run(id);
}

// ── UTM Links ─────────────────────────────────────────────────────────────────

function getUTMLinks() {
  return db.prepare('SELECT * FROM utm_links ORDER BY created_at DESC').all();
}

function saveUTMLink(data) {
  const info = db.prepare(`
    INSERT INTO utm_links (original_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content, full_url, label)
    VALUES (@original_url, @utm_source, @utm_medium, @utm_campaign, @utm_term, @utm_content, @full_url, @label)
  `).run({
    original_url: data.original_url, utm_source: data.utm_source || null,
    utm_medium: data.utm_medium || null, utm_campaign: data.utm_campaign || null,
    utm_term: data.utm_term || null, utm_content: data.utm_content || null,
    full_url: data.full_url, label: data.label || null,
  });
  return info.lastInsertRowid;
}

function deleteUTMLink(id) {
  db.prepare('DELETE FROM utm_links WHERE id = ?').run(id);
}

// ── Users ─────────────────────────────────────────────────────────────────────

function createUser(email, passwordHash, name) {
  // First user ever registered becomes super admin automatically
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const role  = count === 0 ? 'admin' : 'user';
  const info  = db.prepare(`INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)`).run(email, passwordHash, name || null, role);
  return { id: info.lastInsertRowid, role };
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  return db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').get(id);
}

function getAllUsers() {
  return db.prepare('SELECT id, email, name, role, status, created_at, last_active FROM users ORDER BY created_at DESC').all();
}

function updateUserRole(id, role) {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

function updateUserStatus(id, status) {
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
}

function deleteUserData(id) {
  const tables = ['tokens','posts','scheduled_posts','history','analytics','apps','brand_kit',
    'templates','email_subscribers','email_campaigns','seo_keywords','utm_links','user_settings'];
  for (const t of tables) {
    try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {}
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function updateLastActive(id) {
  try { db.prepare("UPDATE users SET last_active = strftime('%s','now') WHERE id = ?").run(id); } catch {}
}

function getUserStats(userId) {
  const posts    = db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').get(userId)?.c || 0;
  const scheduled= db.prepare("SELECT COUNT(*) as c FROM scheduled_posts WHERE user_id = ? AND status='pending'").get(userId)?.c || 0;
  const aiGen    = db.prepare('SELECT COUNT(*) as c FROM history WHERE user_id = ?').get(userId)?.c || 0;
  const connected= db.prepare('SELECT COUNT(*) as c FROM tokens WHERE user_id = ?').get(userId)?.c || 0;
  return { posts, scheduled, ai_generations: aiGen, platforms_connected: connected };
}

function getPlatformStats() {
  return {
    total_users:     db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    active_users:    db.prepare("SELECT COUNT(*) as c FROM users WHERE last_active > strftime('%s','now') - 86400").get().c,
    total_posts:     db.prepare('SELECT COUNT(*) as c FROM posts').get().c,
    total_ai_gen:    db.prepare('SELECT COUNT(*) as c FROM history').get().c,
    scheduled_posts: db.prepare("SELECT COUNT(*) as c FROM scheduled_posts WHERE status='pending'").get().c,
  };
}

// ── User Settings ─────────────────────────────────────────────────────────────

function getUserSettings(userId) {
  return db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) || {};
}

function saveUserSettings(userId, data) {
  const existing = getUserSettings(userId);
  if (existing.user_id) {
    const fields = Object.keys(data).map(k => `${k}=@${k}`).join(', ');
    db.prepare(`UPDATE user_settings SET ${fields}, updated_at=strftime('%s','now') WHERE user_id=@user_id`)
      .run({ user_id: userId, ...data });
  } else {
    const keys = ['user_id', ...Object.keys(data)];
    const vals = keys.map(k => `@${k}`).join(', ');
    db.prepare(`INSERT INTO user_settings (${keys.join(', ')}) VALUES (${vals})`).run({ user_id: userId, ...data });
  }
}

// ── Invite Codes ──────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT UNIQUE NOT NULL,
    created_by INTEGER NOT NULL,
    used_by    INTEGER,
    expires_at INTEGER,
    max_uses   INTEGER DEFAULT 1,
    use_count  INTEGER DEFAULT 0,
    note       TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS platform_config (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

function getConfig(key, defaultVal = null) {
  const row = db.prepare('SELECT value FROM platform_config WHERE key = ?').get(key);
  return row ? row.value : defaultVal;
}

function setConfig(key, value) {
  db.prepare('INSERT INTO platform_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

function createInviteCode(createdBy, note, expiresHours, maxUses = 1) {
  const code = Math.random().toString(36).substring(2, 10).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
  const expiresAt = expiresHours ? Math.floor(Date.now() / 1000) + expiresHours * 3600 : null;
  const info = db.prepare('INSERT INTO invite_codes (code, created_by, note, expires_at, max_uses) VALUES (?, ?, ?, ?, ?)').run(code, createdBy, note || null, expiresAt, maxUses);
  return { id: info.lastInsertRowid, code };
}

function getInviteCode(code) {
  return db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(code);
}

function useInviteCode(code, userId) {
  db.prepare('UPDATE invite_codes SET use_count = use_count + 1, used_by = ? WHERE code = ?').run(userId, code);
}

function getAllInviteCodes() {
  return db.prepare(`
    SELECT ic.*, u.email as creator_email, u2.email as used_by_email
    FROM invite_codes ic
    LEFT JOIN users u  ON u.id  = ic.created_by
    LEFT JOIN users u2 ON u2.id = ic.used_by
    ORDER BY ic.created_at DESC
  `).all();
}

function deleteInviteCode(id) {
  db.prepare('DELETE FROM invite_codes WHERE id = ?').run(id);
}

module.exports = {
  db,
  createUser, getUserByEmail, getUserById, getAllUsers,
  updateUserRole, updateUserStatus, deleteUserData, updateLastActive,
  getUserStats, getPlatformStats,
  getUserSettings, saveUserSettings,
  getConfig, setConfig,
  createInviteCode, getInviteCode, useInviteCode, getAllInviteCodes, deleteInviteCode,
  saveToken, getToken, deleteToken, getAllTokens,
  savePost, getPostHistory,
  saveScheduled, getDuePosts, getScheduledPosts, updateScheduledStatus, deleteScheduled,
  saveHistory, getHistory,
  saveAnalytics, getAnalytics, getAnalyticsSummary,
  getApps, saveApp, updateApp, deleteApp,
  getBrandKit, saveBrandKit,
  getTemplates, saveTemplate, deleteTemplate,
  getEmailSubscribers, saveEmailSubscriber, updateEmailSubscriber, deleteEmailSubscriber,
  getEmailCampaigns, getEmailCampaign, saveEmailCampaign, updateEmailCampaign, markCampaignSent, deleteEmailCampaign,
  getSEOKeywords, saveSEOKeyword, deleteSEOKeyword,
  getUTMLinks, saveUTMLink, deleteUTMLink,
};

// What the help chat knows. Short, plain-language answers written from the product itself.
// Two audiences: 'public' (visitors on the landing page: pre-sales questions) and 'app'
// (signed-in people: how do I…). The AI only answers from these facts; without AI the best
// matching answer is shown as it is.
//
// An entry: { id, for, q (a question people ask), keys (words that match it), a (the answer),
//             go (optional button: where in the app to go) }
// go: 'settings:<tab>' | 'page:<name>' | 'link:<url>'

const DEFAULTS = [
  // ── Visitors (landing page) ────────────────────────────────────────────────
  { id: 'what', for: 'public', q: 'What is NexaDrip?', keys: ['what', 'nexadrip', 'nexus', 'about', 'do', 'product', 'tool', 'app'],
    a: 'NexaDrip is one place to plan and publish social posts, answer and broadcast on WhatsApp, find business customers with personal emails, and keep your website in good shape for Google. AI writes the first draft and nothing goes out without your OK.' },
  { id: 'platforms', for: 'public', q: 'Which social networks can I post to?', keys: ['platform', 'platforms', 'instagram', 'facebook', 'linkedin', 'twitter', 'pinterest', 'threads', 'bluesky', 'google', 'business', 'network', 'networks', 'post'],
    a: 'Facebook, Instagram, LinkedIn, X (Twitter), Pinterest, Threads, Bluesky and Google Business, all from one calendar. You get a preview for each platform before anything goes out.' },
  { id: 'whatsapp', for: 'public', q: 'Does it work with WhatsApp?', keys: ['whatsapp', 'broadcast', 'chat', 'auto', 'reply', 'replies', 'customers', 'message'],
    a: 'Yes. Customers message you on WhatsApp and NexaDrip answers the common questions, hands the rest to you, and lets you send offers (broadcasts) with Meta-approved templates. People who reply STOP are never messaged again.' },
  { id: 'outreach', for: 'public', q: 'What is sales outreach?', keys: ['sales', 'outreach', 'email', 'emails', 'leads', 'prospect', 'customers', 'cold', 'b2b'],
    a: 'You type the websites of businesses you would like as customers. NexaDrip reads each site, finds who to contact and drafts a short personal email. You approve each one before it is sent, and follow-ups stop the moment someone replies.' },
  { id: 'seo', for: 'public', q: 'What does the Google and SEO part do?', keys: ['seo', 'google', 'website', 'ranking', 'search', 'rank'],
    a: 'It checks your website the way Google reads it and gives a short to-do list in plain words, most urgent first. It can also write titles and descriptions for you and keep your Google Business profile active.' },
  { id: 'price', for: 'public', q: 'How much does it cost?', keys: ['price', 'pricing', 'cost', 'plan', 'plans', 'pay', 'much', 'rupees', 'fee', 'charge', 'subscription', 'gst', 'yearly'],
    a: 'You start with a free 14-day trial and no card is needed. Then: Individual is ₹1,275 a month (3 brand workspaces, 3 team members, 3 SEO websites). Agency Pro is ₹10,200 a month (25 client workspaces, 10 team members with roles, client approval links and branded reports). Enterprise is custom priced. Prices exclude GST, and yearly billing gets two months free. A free plan for one brand is available after the trial.' },
  { id: 'trial', for: 'public', q: 'Is there a free trial?', keys: ['free', 'trial', 'try', 'test', 'demo', 'card', 'start', 'signup', 'sign'],
    a: 'Yes, 14 days free and no card needed. Click “Start free trial” to create your account; it takes about a minute.', go: 'link:/login.html#register' },
  { id: 'ai', for: 'public', q: 'Which AI does it use? Do I need my own key?', keys: ['ai', 'key', 'keys', 'gemini', 'openai', 'claude', 'groq', 'chatgpt', 'artificial', 'intelligence', 'model'],
    a: 'You choose. You can use your own free or paid key (Google Gemini, Groq, OpenAI, Claude and others), or the AI credits included with bigger plans. A trial includes some AI to start with.' },
  { id: 'safe', for: 'public', q: 'Is my data safe? Will it post without asking?', keys: ['safe', 'safety', 'secure', 'security', 'privacy', 'data', 'private', 'approve', 'approval', 'control'],
    a: 'Nothing goes out without your OK: you check each post and each sales email first. Your own AI keys stay in your account, and you can add team members with roles so people only see what they need.' },
  { id: 'agency', for: 'public', q: 'Can agencies manage many clients?', keys: ['agency', 'agencies', 'client', 'clients', 'team', 'workspace', 'workspaces', 'members', 'white', 'report', 'reports'],
    a: 'Yes. Agency Pro gives 25 client workspaces, 10 team members with roles, client approval links (clients approve posts without needing an account) and branded reports. Enterprise has no limits.' },
  { id: 'languages', for: 'public', q: 'Does it support Indian languages and festivals?', keys: ['hindi', 'language', 'languages', 'indian', 'india', 'festival', 'festivals', 'diwali', 'eid', 'tamil', 'marathi', 'regional'],
    a: 'Yes. Festivals like Diwali, Eid, Onam and Pongal are on the calendar, and AI can write in Indian languages too.' },
  { id: 'bulk', for: 'both', q: 'Can I schedule many posts from Excel?', keys: ['excel', 'csv', 'bulk', 'upload', 'import', 'many', 'month', 'spreadsheet', 'schedule'],
    a: 'Yes. Plan a month in Excel or CSV, upload it, and every row becomes a scheduled post. In the app, click “Schedule from Excel” in the menu.', go: 'action:bulk' },

  // ── Signed-in help ─────────────────────────────────────────────────────────
  { id: 'connect', for: 'app', q: 'How do I connect Instagram or Facebook?', keys: ['connect', 'instagram', 'facebook', 'account', 'accounts', 'link', 'linkedin', 'login', 'sign', 'twitter', 'pinterest', 'platform'],
    a: 'Open Settings → Connected accounts and click Connect on the network you want. Sign in there and allow everything it asks. For Instagram you need a Business or Creator account linked to a Facebook Page. If a connection stops working, click Connect again.', go: 'settings:platforms' },
  { id: 'ai-setup', for: 'app', q: 'How do I turn on AI writing?', keys: ['ai', 'key', 'gemini', 'groq', 'write', 'writing', 'generate', 'draft', 'setup', 'set', 'not', 'working', 'provider'],
    a: 'The quickest way is a free Google Gemini key: open Settings → AI, click “Get a free key”, sign in with Google, create a key and paste it in. It takes about a minute. If your plan includes AI credits you may already be set.', go: 'settings:ai' },
  { id: 'email', for: 'app', q: 'How do I set up email sending?', keys: ['email', 'smtp', 'outlook', 'gmail', 'ses', 'amazon', 'sendgrid', 'send', 'mail', 'campaign', 'outreach', 'newsletter'],
    a: 'Open Settings → Email sending, pick your provider (Gmail, Outlook, Microsoft 365, Amazon SES and more), enter the login, and click “Send me a test email”. Many providers need an app password or an SMTP key instead of your normal password.', go: 'settings:smtp' },
  { id: 'post', for: 'app', q: 'How do I write and schedule a post?', keys: ['post', 'create', 'write', 'schedule', 'publish', 'new', 'compose', 'calendar', 'time'],
    a: 'Click “New Post”. Write it yourself or describe it and let AI draft it, add a picture, pick the networks, then publish now or choose a date and time. Scheduled posts show on the Calendar.', go: 'page:compose' },
  { id: 'failed', for: 'app', q: 'A post did not go out. What now?', keys: ['failed', 'fail', 'error', 'not', 'posted', 'went', 'missing', 'retry', 'why'],
    a: 'Open Post history to see why it failed. The usual reason is a connection that needs signing in again: go to Settings → Connected accounts and click Connect, then retry the post.', go: 'page:history' },
  { id: 'whatsapp-setup', for: 'app', q: 'How do I set up WhatsApp?', keys: ['whatsapp', 'bot', 'auto', 'reply', 'broadcast', 'template', 'number', 'setup', 'meta'],
    a: 'Open WhatsApp → Setup and follow the steps to link your number. Then use Auto-replies for common questions, Templates for messages Meta must approve, and Broadcasts to send an offer to many people.', go: 'page:leads-settings' },
  { id: 'team', for: 'app', q: 'How do I add a team member or client?', keys: ['team', 'member', 'members', 'invite', 'user', 'users', 'client', 'clients', 'role', 'workspace', 'access', 'agency'],
    a: 'Open Settings → Team to invite people and choose what each can do. To work for several brands, use the workspace switcher at the top and add a client workspace.', go: 'settings:members' },
  { id: 'approval', for: 'app', q: 'How do I get a client to approve a post?', keys: ['approve', 'approval', 'client', 'review', 'sign', 'off', 'link'],
    a: 'Open the Calendar and click “Client approval”. It gives one link for all your draft and waiting posts. Send it to your client: they can approve or ask for changes without an account, and you see their answer in the app.', go: 'page:calendar' },
  { id: 'brand', for: 'app', q: 'Where do I set my brand colours and voice?', keys: ['brand', 'colour', 'color', 'logo', 'voice', 'tone', 'kit', 'style'],
    a: 'Open Brand kit in the menu. Add your logo, colours and how you like to sound, and AI posts and designs will follow it.', go: 'page:brand' },
  { id: 'comments', for: 'app', q: 'How do I reply to comments?', keys: ['comment', 'comments', 'reply', 'inbox', 'respond', 'answer'],
    a: 'Open Comments in the menu to see new comments on posts you published here and reply from the app. You can also add a comment to a published post from Post history with the Comment button.', go: 'page:inbox' },
  { id: 'seo-app', for: 'app', q: 'How do I check my website for Google?', keys: ['seo', 'website', 'google', 'audit', 'ranking', 'search', 'site'],
    a: 'Open Website SEO in the menu, add your website, and you will get a short to-do list in plain words, most urgent first.', go: 'page:seo' },
  { id: 'bio', for: 'app', q: 'What is Link in bio?', keys: ['bio', 'link', 'linktree', 'instagram', 'profile'],
    a: 'It builds a simple mobile page with all your links that you can put in your Instagram or other profile bio.', go: 'page:bio' },
  { id: 'billing', for: 'app', q: 'How do I change my plan or see my bill?', keys: ['plan', 'billing', 'bill', 'invoice', 'upgrade', 'pay', 'payment', 'licence', 'license', 'subscription'],
    a: 'Open Settings → Licence to see your plan, upgrade, or enter a coupon.', go: 'settings:license' },
  { id: 'password', for: 'app', q: 'I forgot my password or want to change it.', keys: ['password', 'forgot', 'reset', 'login', 'sign', 'change', 'account'],
    a: 'To change it, open Settings → My account & app. If you are signed out and forgot it, use “Forgot your password?” on the sign-in page and follow the email.', go: 'settings:account' },
];

const WORD = /[a-z0-9]+/g;
const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'to', 'do', 'does', 'i', 'how', 'can', 'my', 'me', 'it', 'of', 'in', 'on', 'and', 'or', 'for', 'with', 'you', 'your', 'what', 'where', 'when', 'why', 'this', 'that', 'there', 'be', 'get', 'want', 'need', 'please', 'help']);

function words(s) { return (String(s || '').toLowerCase().match(WORD) || []).filter((w) => w.length > 1 && !STOP.has(w)); }

// Best matches for a question, in order. Each hit on a keyword counts; matching the question's own words counts a little.
function find(message, audience, limit = 3, entries = DEFAULTS) {
  const w = new Set(words(message));
  if (!w.size) return [];
  return entries.filter((e) => e.for === audience || e.for === 'both')
    .map((e) => {
      let score = 0;
      for (const k of e.keys) if (w.has(k)) score += 2;
      for (const t of words(e.q)) if (w.has(t)) score += 1;
      return { e, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e);
}

const forAudience = (audience, entries = DEFAULTS) => entries.filter((e) => e.for === audience || e.for === 'both');

// Questions to offer as buttons
const SUGGESTIONS = {
  public: ['How much does it cost?', 'Is there a free trial?', 'Does it work with WhatsApp?', 'Which networks can I post to?'],
  app: ['How do I connect Instagram?', 'How do I turn on AI writing?', 'A post did not go out. What now?', 'How do I set up email sending?'],
};

// ── Stored copy (edited by the Super Admin) ──────────────────────────────────
const now = () => Math.floor(Date.now() / 1000);
const rowToEntry = (r) => ({ id: r.id, for: r.audience, q: r.question, keys: String(r.keywords || '').toLowerCase().split(/[,\s]+/).filter(Boolean), a: r.answer, go: r.go || undefined, enabled: !!r.enabled, builtin: r.builtin_id || null });

let cache = null, cacheAt = 0;
const TTL = 30000;
const invalidate = () => { cache = null; };

// Adds any built-in answer that is not in the table yet (first use, or after restore)
async function seedDefaults(knex, { onlyMissing = true } = {}) {
  const have = new Set((await knex('help_knowledge').whereNotNull('builtin_id').pluck('builtin_id')));
  let added = 0;
  for (const e of DEFAULTS) {
    if (onlyMissing && have.has(e.id)) continue;
    await knex('help_knowledge').insert({ audience: e.for, question: e.q, keywords: e.keys.join(', '), answer: e.a, go: e.go || null, enabled: 1, builtin_id: e.id, updated_at: now() });
    added++;
  }
  invalidate();
  return added;
}

// All enabled entries. Falls back to the built-in ones when the table is missing or empty.
async function load(knex) {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  let out = DEFAULTS;
  try {
    if (await knex.schema.hasTable('help_knowledge')) {
      if (!(await knex('help_knowledge').first('id'))) await seedDefaults(knex);
      out = (await knex('help_knowledge').where({ enabled: 1 }).orderBy('id')).map(rowToEntry);
    }
  } catch { out = DEFAULTS; }
  cache = out; cacheAt = Date.now();
  return out;
}

module.exports = { find, forAudience, SUGGESTIONS, all: DEFAULTS, load, seedDefaults, invalidate, rowToEntry };

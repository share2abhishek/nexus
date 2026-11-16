// NexaDrip app — Guidance: "set this up" pop-ups, a setup checklist on Home, and a loader for slow work.
// Loaded after the other files; it adds to them and changes nothing when everything is set up.

// ─────────────────────────────────────────────────────────────────────────────
// 1. Loader: a thin bar at the top while the app is waiting for the server
// ─────────────────────────────────────────────────────────────────────────────
const Busy = (() => {
  let pending = 0, showTimer = null, hintTimer = null, bar = null;
  const quiet = /unread-count|\/status|ollama|\/auth\/connect\/platforms|heartbeat/i; // background checks: no bar
  function ensure() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'busy-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Working');
    bar.hidden = true;
    document.body.appendChild(bar);
    return bar;
  }
  function start() {
    pending++;
    if (pending === 1) {
      clearTimeout(showTimer);
      showTimer = setTimeout(() => { if (pending > 0) ensure().hidden = false; }, 500);
      clearTimeout(hintTimer);
      // Writing with AI can take a while: say so once instead of looking frozen
      hintTimer = setTimeout(() => { if (pending > 0 && typeof toast === 'function') toast('Still working… AI can take up to a minute. You can keep this page open.', 'info', 6000); }, 9000);
    }
  }
  function end() {
    pending = Math.max(0, pending - 1);
    if (!pending) { clearTimeout(showTimer); clearTimeout(hintTimer); if (bar) bar.hidden = true; }
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const track = /^\/(api|auth|users)\//.test(url) && !quiet.test(url);
    if (!track) return realFetch(input, init);
    start();
    return realFetch(input, init).finally(end);
  };
  return { start, end };
})();

// ─────────────────────────────────────────────────────────────────────────────
// 2. "Set this up" pop-ups: when something fails because a setup step is missing,
//    say what is missing and let the person fix it right there.
// ─────────────────────────────────────────────────────────────────────────────
const SetupGate = (() => {
  let lastAt = 0, lastMsg = '';
  const RULES = [
    { kind: 'ai', re: /No AI provider|AI (isn.t|is not) set up|API key not configured|_API_KEY not configured|add (your own )?(free )?AI key|used today.s included AI|using AI very quickly/i },
    { kind: 'image', re: /No image generator set up|Stability.*not configured|image (and video )?(generator|generation).*(not|isn.t) (set up|configured)/i },
    { kind: 'account', re: /(isn.t|is not|aren.t) connected|needs signing in again|sign-in has ended|Connect .* again/i },
    { kind: 'email', re: /email sending (isn.t|is not) set up|SMTP.*(not|isn.t) (set up|configured)|set up email sending/i },
  ];
  const kindOf = (msg) => RULES.find(r => r.re.test(String(msg || '')))?.kind || null;

  const GUIDES = {
    ai: {
      icon: '✨', title: 'Set up AI to continue',
      body: (msg) => /used today|very quickly/i.test(msg)
        ? 'You’ve reached the free AI limit for now. Add your own free key and carry on right away.'
        : 'NexaDrip writes with AI, and no AI is connected yet. The quickest fix takes about a minute and costs nothing.',
    },
    image: {
      icon: '🖼️', title: 'Connect a picture AI',
      body: () => 'Pictures and videos come from an AI service that needs its own key (Stability AI or OpenAI for pictures; Luma or Runway for video). Add one in Settings → AI.',
      action: { label: 'Open AI settings', go: () => openSettings('ai') },
    },
    account: {
      icon: '🔗', title: 'Connect your account',
      body: (msg) => msg,
      action: { label: 'Open Connected accounts', go: () => openSettings('platforms') },
    },
    email: {
      icon: '✉️', title: 'Set up email sending',
      body: () => 'Emails are sent from your own address. Pick your email provider (Gmail, Outlook, Amazon SES and more), enter the login, and use “Send me a test email”.',
      action: { label: 'Set up email', go: () => openSettings('smtp') },
    },
  };

  function close() { const m = document.getElementById('setup-gate'); if (m) m.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(kind, msg) {
    const g = GUIDES[kind];
    close();
    const m = document.createElement('div');
    m.id = 'setup-gate';
    m.className = 'setup-gate';
    const aiForm = kind === 'ai' ? `
      <ol class="sg-steps">
        <li><a class="btn btn-secondary btn-sm" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get a free Google key ↗</a><span>Sign in with Google and click “Create API key”.</span></li>
        <li><label for="sg-key">Paste it here</label>
          <input type="password" class="form-input" id="sg-key" placeholder="Starts with AIza…" autocomplete="off" />
          <div class="sg-err" id="sg-err" role="alert" hidden></div></li>
      </ol>` : '';
    m.innerHTML = `<div class="sg-card" role="dialog" aria-modal="true" aria-labelledby="sg-title">
      <button type="button" class="sg-x" aria-label="Close">✕</button>
      <div class="sg-icon" aria-hidden="true">${g.icon}</div>
      <h3 id="sg-title">${escapeHtml(g.title)}</h3>
      <p>${escapeHtml(g.body(msg || ''))}</p>
      ${aiForm}
      <div class="sg-actions">
        <button type="button" class="btn btn-secondary" data-sg="later">Not now</button>
        ${kind === 'ai' ? '<button type="button" class="btn btn-secondary" data-sg="more">Other options</button><button type="button" class="btn btn-primary" data-sg="save">Save and continue</button>'
          : `<button type="button" class="btn btn-primary" data-sg="go">${escapeHtml(g.action.label)}</button>`}
      </div>
    </div>`;
    document.body.appendChild(m);
    document.addEventListener('keydown', onKey);
    m.addEventListener('click', async (e) => {
      if (e.target === m || e.target.closest('.sg-x') || e.target.dataset.sg === 'later') return close();
      const act = e.target.dataset.sg;
      if (act === 'go') { close(); g.action.go(); }
      if (act === 'more') { close(); openSettings('ai'); }
      if (act === 'save') await saveAiKey(e.target);
    });
    setTimeout(() => (m.querySelector('#sg-key') || m.querySelector('[data-sg="go"]'))?.focus(), 50);
  }

  async function saveAiKey(btn) {
    const input = document.getElementById('sg-key');
    const err = document.getElementById('sg-err');
    const key = (input.value || '').trim();
    const bad = (t) => { err.textContent = t; err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); };
    err.hidden = true; input.removeAttribute('aria-invalid');
    if (!key) return bad('Paste the key you copied from Google.');
    if (!/^AIza[\w-]{20,}$/.test(key)) return bad('That doesn’t look like a Google key. It starts with “AIza” and has no spaces. Copy it again from the Google page.');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await api('POST', '/users/settings', { google_ai_key: key });
      close();
      toast('AI is ready. Try again now.', 'success', 6000);
      if (typeof refreshAiStatus === 'function') refreshAiStatus();
      if (typeof loadModels === 'function') loadModels();
      if (State.currentPage === 'dashboard' && typeof loadDashboard === 'function') loadDashboard();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Save and continue';
      bad(e.message);
    }
  }

  // Called from api() when a request fails. Returns true if a pop-up was shown.
  function offer(msg) {
    const kind = kindOf(msg);
    if (!kind) return false;
    if (Date.now() - lastAt < 15000) return false; // one pop-up at a time, not one per failed request
    if (document.getElementById('setup-gate')) return false;
    lastAt = Date.now(); lastMsg = String(msg);
    open(kind, msg);
    return true;
  }
  const justOffered = (msg) => String(msg) === lastMsg && Date.now() - lastAt < 1500;
  return { offer, open, justOffered, kindOf };
})();

// api() asks the gate about failures; the red toast is skipped when the pop-up already explains it
(() => {
  const origToast = window.toast;
  window.toast = function (message, type, duration) {
    if (type === 'error' && SetupGate.justOffered(message)) return;
    return origToast.apply(this, arguments);
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// 3. Setup checklist on Home: the three things most features depend on
// ─────────────────────────────────────────────────────────────────────────────
async function renderSetupChecklist() {
  const box = document.getElementById('dash-setup');
  if (!box) return;
  const st = State.platformStatus || {};
  const accounts = Object.entries(PLATFORMS).filter(([k, c]) => !c.hidden && st[k]?.connected).length;
  let ai = !!State.aiReady;
  if (State.aiReady === undefined && typeof refreshAiStatus === 'function') { await refreshAiStatus(); ai = !!State.aiReady; }
  let email = false;
  try {
    const s = await api('GET', '/api/config/smtp');
    email = !!(s.configured || (s.SMTP_USER && (s.pass_set || s.SMTP_PASS_SET)));
  } catch { email = true; } // can't tell (no permission): don't nag
  const items = [
    { done: accounts > 0, title: 'Connect a social account', why: 'So posts can go out to Facebook, Instagram, LinkedIn and more.', label: 'Connect', go: "openSettings('platforms')" },
    { done: ai, title: 'Turn on AI writing', why: 'Free and takes about a minute. AI drafts posts, replies and emails for you.', label: 'Set up AI', go: "SetupGate.open('ai','')" },
    { done: email, title: 'Set up email sending', why: 'Needed for campaigns and sales outreach. Works with Gmail, Outlook, Amazon SES and others.', label: 'Set up email', go: "openSettings('smtp')" },
  ];
  const left = items.filter(i => !i.done).length;
  if (!left) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<div class="dash-setup-head"><b>Get set up</b><span>${items.length - left} of ${items.length} done</span></div>
    <div class="dash-setup-bar" aria-hidden="true"><i style="width:${Math.round(((items.length - left) / items.length) * 100)}%"></i></div>
    ${items.map(i => `<div class="dash-setup-row ${i.done ? 'done' : ''}"><span class="dash-setup-tick" aria-hidden="true">${i.done ? '✓' : ''}</span><div class="dash-setup-text"><b>${escapeHtml(i.title)}</b><small>${escapeHtml(i.why)}</small></div>${i.done ? '<span class="dash-setup-ok">Done</span>' : `<button type="button" class="btn btn-primary btn-sm" onclick="${i.go}">${escapeHtml(i.label)}</button>`}</div>`).join('')}`;
}

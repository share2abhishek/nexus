/*!
 * NexaDrip help chat widget. Two modes, one script:
 *   <script src="/assistant-widget.js" data-mode="public" defer></script>   landing page (visitors)
 *   <script src="/assistant-widget.js" data-mode="app" defer></script>      inside the app (signed in)
 * Answers come from the knowledge base the Super Admin edits (Users & access → Help chat).
 * No dependencies. Styles are injected, so the host page needs nothing.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var mode = (script && script.getAttribute('data-mode')) === 'app' ? 'app' : 'public';
  var API = mode === 'app' ? '/api/assistant' : '/api/assistant/public';
  var KEY = 'nexadrip_help_chat_' + mode;
  var history = [];      // [{ role: 'user'|'bot', text }]
  var busy = false;
  var lastQuestion = '';

  try { history = JSON.parse(sessionStorage.getItem(KEY) || '[]').slice(-12); } catch (e) { history = []; }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-12))); } catch (e) { /* private mode */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  var css = '' +
    '#nh-btn{position:fixed;right:18px;bottom:18px;z-index:9990;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:#0f172a;box-shadow:0 8px 24px rgba(0,0,0,.35);display:grid;place-items:center;padding:0}' +
    '#nh-btn img{width:36px;height:36px;display:block}.nh-logo{width:38px;height:38px;border-radius:50%;background:#0f172a;display:grid;place-items:center;flex-shrink:0}.nh-logo img{width:28px;height:28px}' +
    '#nh-btn:focus-visible{outline:3px solid #fff;outline-offset:2px}' +
    '#nh-hint{position:fixed;right:84px;bottom:28px;z-index:9990;background:#fff;color:#0f172a;border-radius:12px;padding:8px 12px;font:13px/1.3 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.2);max-width:200px}' +
    '#nh-panel{position:fixed;right:18px;bottom:86px;z-index:9991;width:370px;max-width:calc(100vw - 20px);height:540px;max-height:calc(100vh - 110px);background:#fff;color:#0f172a;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
    '#nh-panel.open{display:flex}' +
    '.nh-head{background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}' +
    '.nh-head b{font-size:15px}.nh-head small{display:block;opacity:.9;font-size:12px}' +
    '.nh-x{margin-left:auto;background:rgba(255,255,255,.2);border:0;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px}' +
    '.nh-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f8fafc}' +
    '.nh-m{max-width:86%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.nh-m.bot{background:#fff;border:1px solid #e2e8f0;align-self:flex-start;border-bottom-left-radius:4px}' +
    '.nh-m.user{background:#7c3aed;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}' +
    '.nh-chips,.nh-acts{display:flex;flex-wrap:wrap;gap:6px}' +
    '.nh-chip,.nh-act{border:1px solid #c4b5fd;background:#fff;color:#5b21b6;border-radius:999px;padding:6px 11px;font:inherit;font-size:13px;cursor:pointer;text-align:left}' +
    '.nh-act{background:#7c3aed;color:#fff;border-color:#7c3aed}.nh-chip:hover{background:#f5f3ff}' +
    '.nh-typing{display:inline-flex;gap:4px;align-items:center;padding:12px}.nh-typing i{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:nhb 1s infinite}.nh-typing i:nth-child(2){animation-delay:.15s}.nh-typing i:nth-child(3){animation-delay:.3s}' +
    '@keyframes nhb{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}' +
    '.nh-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff}' +
    '.nh-form input{flex:1;min-width:0;border:1px solid #cbd5e1;border-radius:999px;padding:9px 14px;font:inherit}' +
    '.nh-form button{border:0;background:#7c3aed;color:#fff;border-radius:999px;padding:0 16px;font:inherit;font-weight:600;cursor:pointer}' +
    '.nh-form button:disabled{opacity:.5;cursor:default}' +
    '.nh-lead{display:flex;flex-direction:column;gap:8px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px;align-self:stretch}' +
    '.nh-lead input,.nh-lead textarea{border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;font:inherit;width:100%;box-sizing:border-box}' +
    '.nh-lead button{border:0;background:#7c3aed;color:#fff;border-radius:10px;padding:9px;font:inherit;font-weight:600;cursor:pointer}' +
    '.nh-err{color:#b91c1c;font-size:13px}' +
    '.nh-foot{text-align:center;font-size:12px;color:#64748b;padding:0 0 8px;background:#fff}' +
    '.nh-foot button{background:none;border:0;color:#6d28d9;text-decoration:underline;cursor:pointer;font:inherit}' +
    'body.has-help-chat #toast-container{bottom:92px!important}' +
    '@media (max-width:520px){#nh-panel{right:0;left:0;bottom:0;width:100%;max-width:100%;height:100%;max-height:100%;border-radius:0}#nh-hint{display:none}}' +
    '@media (prefers-reduced-motion:reduce){.nh-typing i{animation:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  document.body.classList.add('has-help-chat');

  var btn = document.createElement('button');
  btn.id = 'nh-btn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Open help chat'); btn.setAttribute('aria-expanded', 'false'); btn.innerHTML = '<img src="/icon.svg" alt="" width="36" height="36" />';
  var panel = document.createElement('div');
  panel.id = 'nh-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'NexaDrip help chat');
  panel.innerHTML = '<div class="nh-head"><div class="nh-logo" aria-hidden="true"><img src="/icon.svg" alt="" /></div><div><b>' + (mode === 'app' ? 'Help & support' : 'Ask NexaDrip') + '</b><small>' + (mode === 'app' ? 'Stuck? Ask me how to do anything.' : 'Pricing, features, free trial') + '</small></div><button class="nh-x" type="button" aria-label="Close chat">✕</button></div>' +
    '<div class="nh-msgs" id="nh-msgs" role="log" aria-live="polite"></div>' +
    '<div class="nh-foot"><button type="button" id="nh-human">Talk to a person</button></div>' +
    '<form class="nh-form" id="nh-form"><input id="nh-input" type="text" maxlength="500" placeholder="Type your question" aria-label="Your question" autocomplete="off" /><button type="submit" id="nh-send">Send</button></form>';
  document.body.appendChild(btn); document.body.appendChild(panel);
  var msgs = panel.querySelector('#nh-msgs'), input = panel.querySelector('#nh-input'), send = panel.querySelector('#nh-send');

  function scroll() { msgs.scrollTop = msgs.scrollHeight; }
  function add(role, text) { var d = document.createElement('div'); d.className = 'nh-m ' + role; d.textContent = text; msgs.appendChild(d); scroll(); return d; }
  function chips(list) {
    var w = document.createElement('div'); w.className = 'nh-chips';
    list.forEach(function (q) { var b = document.createElement('button'); b.type = 'button'; b.className = 'nh-chip'; b.textContent = q; b.onclick = function () { w.remove(); ask(q); }; w.appendChild(b); });
    msgs.appendChild(w); scroll();
  }

  function run(a) {
    if (a.kind === 'link') { location.href = a.value; return; }
    if (mode !== 'app') return;
    panel.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
    try {
      if (a.kind === 'settings' && window.openSettings) window.openSettings(a.value);
      else if (a.kind === 'page' && window.navigateTo) window.navigateTo(a.value);
      else if (a.kind === 'action' && a.value === 'bulk' && window.openBulkImport) window.openBulkImport();
    } catch (e) { /* page not available */ }
  }
  function actions(list) {
    var usable = (list || []).filter(function (a) { return mode === 'app' || a.kind === 'link'; });
    if (!usable.length) return;
    var w = document.createElement('div'); w.className = 'nh-acts';
    usable.forEach(function (a) { var b = document.createElement('button'); b.type = 'button'; b.className = 'nh-act'; b.textContent = a.label; b.onclick = function () { run(a); }; w.appendChild(b); });
    msgs.appendChild(w); scroll();
  }

  function leadForm(prefill) {
    if (msgs.querySelector('.nh-lead')) { msgs.querySelector('.nh-lead input').focus(); return; }
    var f = document.createElement('form'); f.className = 'nh-lead';
    f.innerHTML = '<b>Leave your details and we’ll reply</b>' +
      (mode === 'public' ? '<input name="name" placeholder="Your name" maxlength="80" autocomplete="name" aria-label="Your name" /><input name="contact" placeholder="Email or phone number" maxlength="120" autocomplete="email" aria-label="Email or phone number" required />' : '') +
      '<textarea name="message" rows="3" maxlength="1000" placeholder="What do you need help with?" aria-label="Your message" required></textarea>' +
      '<input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px" />' +
      '<div class="nh-err" role="alert" hidden></div><button type="submit">Send to the team</button>';
    f.message.value = prefill || '';
    f.onsubmit = function (e) {
      e.preventDefault();
      var err = f.querySelector('.nh-err'), sb = f.querySelector('button'); err.hidden = true; sb.disabled = true; sb.textContent = 'Sending…';
      var body = { message: f.message.value, history: history.slice(-6), website: f.website.value, page: pageName() };
      if (mode === 'public') { body.name = f.name.value; body.contact = f.contact.value; }
      post('/enquiry', body).then(function () {
        f.remove(); add('bot', 'Thank you! We’ve got your message and will reply soon.'); history.push({ role: 'bot', text: 'Thank you! We’ve got your message and will reply soon.' }); save();
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; sb.disabled = false; sb.textContent = 'Send to the team'; });
    };
    msgs.appendChild(f); scroll(); (f.querySelector('input[name=name]') || f.message).focus();
  }

  function pageName() { try { return (window.State && window.State.currentPage) || ''; } catch (e) { return ''; } }
  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 404 || r.status === 401) throw new Error(mode === 'app'
          ? 'Help chat isn’t available yet. If NexaDrip was just updated, close it completely (tray icon → Quit) and start it again.'
          : 'The chat isn’t available right now. Please try again in a little while.');
        if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.'); return d; });
    }, function () { throw new Error('No connection. Check your internet and try again.'); });
  }

  function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    busy = true; send.disabled = true; input.value = '';
    add('user', text); history.push({ role: 'user', text: text }); lastQuestion = text;
    var t = document.createElement('div'); t.className = 'nh-m bot nh-typing'; t.setAttribute('aria-label', 'Typing'); t.innerHTML = '<i></i><i></i><i></i>'; msgs.appendChild(t); scroll();
    post('/chat', { message: text, history: history.slice(-7, -1), page: pageName() }).then(function (r) {
      t.remove(); add('bot', r.reply); history.push({ role: 'bot', text: r.reply }); save();
      actions(r.actions);
      if (r.needs_human) leadForm(text);
    }).catch(function (e) {
      t.remove(); var d = add('bot', e.message); d.style.borderColor = '#fca5a5';
      chips(['Try again']); msgs.lastChild.firstChild.onclick = function () { msgs.lastChild.remove(); busy = false; ask(text); };
    }).then(function () { busy = false; send.disabled = false; input.focus(); });
  }

  function open() {
    panel.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
    var h = document.getElementById('nh-hint'); if (h) h.remove();
    if (!msgs.children.length) {
      if (history.length) history.forEach(function (t) { add(t.role === 'user' ? 'user' : 'bot', t.text); });
      else {
        var name = '';
        try { name = ((window.State && window.State.user && window.State.user.name) || '').split(' ')[0]; } catch (e) { /* none */ }
        var hello = mode === 'app' ? 'Hi' + (name ? ' ' + name : '') + '! Stuck on something? Ask me how to do it, or pick a question.' : 'Hi! I can answer questions about NexaDrip and what it does. What would you like to know?';
        add('bot', hello);
        fetch(API + '/suggestions').then(function (r) { return r.json(); }).then(function (d) { chips(d.suggestions || []); }).catch(function () { /* chips are optional */ });
      }
    }
    setTimeout(function () { input.focus(); }, 50);
  }
  function close() { panel.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); }

  btn.onclick = function () { panel.classList.contains('open') ? close() : open(); };
  panel.querySelector('.nh-x').onclick = close;
  panel.querySelector('#nh-human').onclick = function () { leadForm(lastQuestion); };
  panel.querySelector('#nh-form').onsubmit = function (e) { e.preventDefault(); ask(input.value); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open')) close(); });

  // Landing page: a small nudge once, after a few seconds
  if (mode === 'public' && !history.length) {
    setTimeout(function () {
      if (panel.classList.contains('open')) return;
      var h = document.createElement('div'); h.id = 'nh-hint'; h.textContent = 'Questions? Ask me anything about NexaDrip.'; h.onclick = open; document.body.appendChild(h);
      setTimeout(function () { h.remove(); }, 12000);
    }, 6000);
  }
})();

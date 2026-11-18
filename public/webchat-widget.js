/*!
 * NexaDrip website chat widget.
 * Drop this on any website to connect its chat to the NexaDrip bot:
 *   <script src="https://YOUR-APP/webchat-widget.js" data-token="webchat_xxxxxxxx"></script>
 * The bot's name, avatar, description and colour come from the server (the workspace's
 * chat profile). Optional attributes, used only when the profile has no value:
 *   data-name, data-color, data-greeting (description), data-whatsapp
 * Other attributes: data-open="true" (open at once), data-hide-button="true".
 * The visitor's messages go to /api/webhooks/webchat/<token> and the bot (menu,
 * keywords, knowledge base, AI or live agents) answers. No dependencies.
 */
(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script'); return s[s.length - 1];
  })();
  if (!script || window.NexusChat) return;

  var token = script.getAttribute('data-token');
  if (!token) { console.error('[Nexus Chat] missing data-token'); return; }

  var base = (function () { try { return new URL(script.src).origin; } catch (e) { return ''; } })();
  var api = base + '/api/webhooks/webchat/' + encodeURIComponent(token);
  var attr = function (n) { var v = script.getAttribute(n); return v && v !== 'Your business' ? v : null; };

  var profile = {
    name: attr('data-name') || 'Chat with us',
    description: attr('data-greeting') || 'Send "Hi" to get started!',
    color: attr('data-color') || '#D4813C',
    avatar_url: null,
    whatsapp: attr('data-whatsapp'),
    placeholder: 'Type your message...'
  };
  var hideButton = script.getAttribute('data-hide-button') === 'true';
  var openAtStart = script.getAttribute('data-open') === 'true';

  // ── Visitor ────────────────────────────────────────────────────────────────
  var VKEY = 'snchat_visitor_' + token;
  function newVisitor() { return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  var visitorId;
  try { visitorId = localStorage.getItem(VKEY) || newVisitor(); localStorage.setItem(VKEY, visitorId); }
  catch (e) { visitorId = newVisitor(); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function formatText(s) {
    var safe = esc(s);
    safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    safe = safe.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
    return safe.replace(/\n/g, '<br>');
  }

  // A bot message's choices become buttons: "Reply with a number:\n1. A\n2. B" and
  // lines starting with "• ". The button sends the choice's text.
  function splitChoices(text) {
    var lines = String(text || '').split('\n');
    var keep = [], choices = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var num = l.match(/^\s*\d\.\s+(.+)$/);
      var bul = l.match(/^\s*[•▪]\s+(.+)$/);
      if (num || bul) { choices.push((num || bul)[1].trim()); continue; }
      if (/^\s*reply with a number:?\s*$/i.test(l)) continue;
      keep.push(l);
    }
    if (choices.length < 2) return { text: text, choices: [] };
    return { text: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim(), choices: choices };
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.id = 'nexus-webchat-style';
  function css(c) {
    return '' +
      '.snc,.snc *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
      '.snc-btn{position:fixed;right:24px;bottom:24px;width:62px;height:62px;border-radius:50%;background:' + c + ';color:#fff;border:0;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.22);z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .2s ease}' +
      '.snc-btn:hover{transform:scale(1.06)}.snc-btn.hidden{display:none!important}.snc-btn svg{width:28px;height:28px}' +
      '.snc-panel{position:fixed;right:24px;bottom:100px;width:380px;max-width:calc(100vw - 32px);height:620px;max-height:calc(100vh - 124px);background:#fcfcfb;border-radius:22px;box-shadow:0 18px 50px rgba(0,0,0,.25);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;color:#1f1f1f}' +
      '.snc-panel.open{display:flex;animation:snc-in .2s ease-out}' +
      '@keyframes snc-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}' +
      '.snc-head{display:flex;align-items:center;gap:10px;padding:16px 14px 12px 14px;background:#fcfcfb}' +
      '.snc-head .snc-title{flex:1;display:flex;align-items:center;gap:10px;min-width:0;font-size:17px;font-weight:500}' +
      '.snc-head .snc-title span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.snc-ico{background:none;border:0;color:#333;cursor:pointer;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;padding:0;flex:none}' +
      '.snc-ico:hover{background:#efeeeb}.snc-ico svg{width:20px;height:20px}.snc-ico.hide{display:none}' +
      '.snc-av{border-radius:50%;object-fit:cover;background:#f4e9e4;flex:none}' +
      '.snc-av-ph{border-radius:50%;background:' + c + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;flex:none}' +
      '.snc-head-av{display:flex;flex:none}.snc-head-av .snc-av,.snc-head-av .snc-av-ph{width:40px;height:40px;font-size:16px}' +
      '.snc-body{flex:1;overflow-y:auto;padding:8px 16px 12px;display:flex;flex-direction:column;gap:6px}' +
      '.snc-empty{margin:auto 0;text-align:center;padding:20px 8px}' +
      '.snc-empty .snc-av,.snc-empty .snc-av-ph{width:116px;height:116px;margin:0 auto 14px;font-size:40px}' +
      '.snc-empty h3{margin:0 0 8px;font-size:24px;font-weight:500;color:#1f1f1f}' +
      '.snc-empty p{margin:0;font-size:15px;line-height:1.55;color:#6b6460}.snc-empty p strong{color:#6b6460;font-weight:700}' +
      '.snc-row{display:flex;align-items:flex-end;gap:8px;max-width:100%}.snc-row.me{justify-content:flex-end}' +
      '.snc-row .snc-av,.snc-row .snc-av-ph{width:28px;height:28px;font-size:12px}.snc-row .snc-sp{width:28px;flex:none}' +
      '.snc-msg{max-width:80%;padding:10px 14px;border-radius:18px;font-size:14.5px;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere}' +
      '.snc-msg a{color:inherit;text-decoration:underline;font-weight:600}' +
      '.snc-bot{background:#f1efec;color:#1f1f1f;border-bottom-left-radius:6px}' +
      '.snc-me{background:' + c + ';color:#fff;border-bottom-right-radius:6px}' +
      '.snc-chips{display:flex;flex-wrap:wrap;gap:8px;padding:4px 0 6px 36px}' +
      '.snc-chip{border:1px solid ' + c + ';background:#fff;color:#1f1f1f;border-radius:18px;padding:8px 14px;font-size:14px;cursor:pointer;text-align:left;transition:background .15s}' +
      '.snc-chip:hover{background:' + c + '1a}.snc-chip:disabled{opacity:.5;cursor:default}' +
      '.snc-typing{display:flex;gap:6px;padding:12px 4px 12px 36px}' +
      '.snc-typing span{width:9px;height:9px;border-radius:50%;background:' + c + ';opacity:.45;animation:snc-dot 1.2s infinite ease-in-out}' +
      '.snc-typing span:nth-child(2){animation-delay:.2s}.snc-typing span:nth-child(3){animation-delay:.4s}' +
      '@keyframes snc-dot{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-4px);opacity:.8}}' +
      '.snc-foot{padding:6px 16px 8px}' +
      '.snc-box{display:flex;align-items:center;gap:6px;background:#f4f3f1;border:1px solid #e3e0dc;border-radius:18px;padding:6px 6px 6px 16px}' +
      '.snc-box:focus-within{border-color:' + c + '}' +
      '.snc-input{flex:1;border:0;background:transparent;outline:none;font-size:15px;padding:10px 0;color:#1f1f1f;min-width:0}' +
      '.snc-input::placeholder{color:#8a817b}' +
      '.snc-send{background:' + c + ';color:#fff}.snc-send:hover{background:' + c + ';opacity:.9}.snc-mic.listening{color:#dc2626}' +
      '.snc-by{text-align:center;font-size:12.5px;color:#9a928c;padding:6px 0 2px}.snc-by a{color:#9a928c;text-decoration:none}.snc-by a:hover{text-decoration:underline}' +
      '.snc-by b{color:#e8a33d;font-weight:400}' +
      '@media (max-width:480px){.snc-panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.snc-panel.open~.snc-btn,.snc-btn.open{display:none}}' +
      '@media (prefers-reduced-motion:reduce){.snc-panel.open{animation:none}.snc-typing span{animation:none}}';
  }
  style.textContent = css(profile.color);
  document.head.appendChild(style);

  var ICON = {
    chat: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7.5L7 21.5V18H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4l17.5-7.5a1 1 0 0 0 0-1.8L3.4 3.6a1 1 0 0 0-1.4 1.1L4 11l9 1-9 1-2 6.3a1 1 0 0 0 1.4 1.1z"/></svg>'
  };

  // ── DOM ───────────────────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.className = 'snc snc-btn' + (hideButton ? ' hidden' : '');
  btn.innerHTML = ICON.chat;

  var panel = document.createElement('div');
  panel.className = 'snc snc-panel';
  panel.setAttribute('role', 'dialog');
  panel.innerHTML =
    '<div class="snc-head">' +
      '<button class="snc-ico snc-back hide" type="button" aria-label="Back to menu">' + ICON.back + '</button>' +
      '<div class="snc-title"><span class="snc-head-av"></span><span class="snc-name"></span></div>' +
      '<button class="snc-ico snc-reset" type="button" aria-label="Start a new conversation" title="Start over">' + ICON.reset + '</button>' +
      '<button class="snc-ico snc-close" type="button" aria-label="Close chat">' + ICON.close + '</button>' +
    '</div>' +
    '<div class="snc-body" aria-live="polite"></div>' +
    '<form class="snc-foot">' +
      '<div class="snc-box">' +
        '<input class="snc-input" type="text" autocomplete="off" maxlength="2000" aria-label="Message" />' +
        '<button class="snc-ico snc-mic" type="button" aria-label="Speak your message">' + ICON.mic + '</button>' +
        '<button class="snc-ico snc-send hide" type="submit" aria-label="Send">' + ICON.send + '</button>' +
      '</div>' +
      '<div class="snc-by"><a href="https://radixile.com" target="_blank" rel="noopener"><b>⚡</b> Powered by Radixile Technology</a></div>' +
    '</form>';

  document.body.appendChild(panel);
  document.body.appendChild(btn);

  var $ = function (s) { return panel.querySelector(s); };
  var body = $('.snc-body'), form = $('.snc-foot'), input = $('.snc-input');
  var micBtn = $('.snc-mic'), sendBtn = $('.snc-send'), backBtn = $('.snc-back');

  function avatarEl(cls) {
    if (profile.avatar_url) {
      return '<img class="snc-av ' + (cls || '') + '" src="' + esc(profile.avatar_url) + '" alt="" />';
    }
    return '<div class="snc-av-ph ' + (cls || '') + '">' + esc((profile.name || '?').charAt(0).toUpperCase()) + '</div>';
  }

  function applyProfile() {
    style.textContent = css(profile.color);
    $('.snc-name').textContent = profile.name;
    $('.snc-head-av').innerHTML = avatarEl('');
    input.placeholder = profile.placeholder || 'Type your message...';
    btn.setAttribute('aria-label', 'Chat with ' + profile.name);
    panel.setAttribute('aria-label', profile.name + ' chat');
    render();
  }

  // ── Messages ──────────────────────────────────────────────────────────────
  var messages = [];   // { id, text, who: 'me'|'bot' }
  var pending = null;  // text sent, waiting for the answer
  var loaded = false;

  function render() {
    var stick = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    var html = '';
    if (!messages.length && !pending) {
      html = '<div class="snc-empty">' + avatarEl('') + '<h3>' + esc(profile.name) + '</h3><p>' + formatText(profile.description) + '</p></div>';
    } else {
      var lastBot = -1;
      for (var k = 0; k < messages.length; k++) if (messages[k].who !== 'me') lastBot = k;
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        if (m.who === 'me') { html += '<div class="snc-row me"><div class="snc-msg snc-me">' + formatText(m.text) + '</div></div>'; continue; }
        var parts = splitChoices(m.text);
        var next = messages[i + 1];
        var showAv = !next || next.who === 'me';
        html += '<div class="snc-row">' + (showAv ? avatarEl('') : '<span class="snc-sp"></span>') +
          (parts.text ? '<div class="snc-msg snc-bot">' + formatText(parts.text) + '</div>' : '') + '</div>';
        if (parts.choices.length && i === lastBot && !pending) {
          html += '<div class="snc-chips">' + parts.choices.map(function (c) {
            return '<button type="button" class="snc-chip" data-say="' + esc(c) + '">' + esc(c) + '</button>';
          }).join('') + '</div>';
        }
      }
      if (pending) {
        html += '<div class="snc-row me"><div class="snc-msg snc-me">' + formatText(pending) + '</div></div>' +
          '<div class="snc-typing" role="status" aria-label="' + esc(profile.name) + ' is typing"><span></span><span></span><span></span></div>';
      }
    }
    body.innerHTML = html;
    backBtn.classList.toggle('hide', !messages.length);
    if (stick || pending) body.scrollTop = body.scrollHeight;
  }

  body.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('.snc-chip');
    if (chip) send(chip.getAttribute('data-say'));
  });

  function fetchHistory() {
    return fetch(api + '/history?visitor_id=' + encodeURIComponent(visitorId) + '&t=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (d) {
        loaded = true;
        var list = (Array.isArray(d.messages) ? d.messages : []).map(function (m) { return { id: m.id, text: m.text, who: m.who === 'me' ? 'me' : 'bot' }; });
        var changed = list.length !== messages.length || (list.length && list[list.length - 1].id !== messages[messages.length - 1].id);
        if (changed) { messages = list; render(); }
        return true;
      })
      .catch(function () { return false; });
  }

  function send(text) {
    var t = String(text || '').trim();
    if (!t || pending) return;
    pending = t;
    input.value = '';
    syncButtons();
    render();
    fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: t, visitor_id: visitorId, name: 'Website visitor' })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        return fetchHistory().then(function (ok) {
          var sent = pending; pending = null;
          if (!ok) {
            messages.push({ id: 'l' + Date.now(), text: sent, who: 'me' });
            messages.push({ id: 'r' + Date.now(), text: (res.d && (res.d.reply || res.d.error)) || 'Thanks! Our team will get back to you here shortly.', who: 'bot' });
          } else if (!res.ok && res.d && res.d.error) {
            messages.push({ id: 'e' + Date.now(), text: res.d.error, who: 'bot' });
          } else if (res.ok && !(res.d && res.d.reply) && (!messages.length || messages[messages.length - 1].who === 'me')) {
            messages.push({ id: 'h' + Date.now(), text: 'Thanks! Our team will get back to you here shortly.', who: 'bot' });
          }
          render();
        });
      })
      .catch(function () {
        var sent = pending; pending = null;
        messages.push({ id: 'l' + Date.now(), text: sent, who: 'me' });
        messages.push({ id: 'x' + Date.now(), text: 'Sorry, we could not connect just now. Please try again in a moment.', who: 'bot' });
        render();
      })
      .then(function () { syncButtons(); input.focus(); });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });
  input.addEventListener('input', syncButtons);
  function syncButtons() {
    var has = !!input.value.trim();
    sendBtn.classList.toggle('hide', !has && !!Speech);
    micBtn.classList.toggle('hide', has || !Speech);
  }

  // ── Voice input (browsers with speech recognition) ─────────────────────────
  var Speech = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var rec = null;
  micBtn.addEventListener('click', function () {
    if (!Speech) return;
    if (rec) { rec.stop(); return; }
    rec = new Speech();
    rec.lang = document.documentElement.lang || navigator.language || 'en-IN';
    rec.interimResults = true;
    micBtn.classList.add('listening');
    rec.onresult = function (e) {
      var t = '';
      for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      input.value = t;
    };
    rec.onend = function () { micBtn.classList.remove('listening'); rec = null; syncButtons(); input.focus(); };
    rec.onerror = rec.onend;
    rec.start();
  });
  syncButtons();

  // ── Open / close / restart ───────────────────────────────────────────────
  var pollTimer = null;
  function open() {
    panel.classList.add('open'); btn.classList.add('open'); btn.innerHTML = ICON.down;
    if (!loaded) fetchHistory();
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { if (!pending) fetchHistory(); }, 5000); // a team member may answer
    setTimeout(function () { input.focus(); }, 60);
  }
  function close() {
    panel.classList.remove('open'); btn.classList.remove('open'); btn.innerHTML = ICON.chat;
    clearInterval(pollTimer); pollTimer = null;
  }
  function toggle() { panel.classList.contains('open') ? close() : open(); }
  function restart() {
    visitorId = newVisitor();
    try { localStorage.setItem(VKEY, visitorId); } catch (e) {}
    messages = []; pending = null; render(); input.focus();
  }
  btn.addEventListener('click', toggle);
  $('.snc-close').addEventListener('click', close);
  $('.snc-reset').addEventListener('click', restart);
  backBtn.addEventListener('click', function () { send('Menu'); });

  // ── Profile from the server ────────────────────────────────────────────────
  applyProfile();
  fetch(api + '/config')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (p) {
      if (!p) return;
      ['name', 'description', 'color', 'whatsapp', 'placeholder'].forEach(function (k) { if (p[k]) profile[k] = p[k]; });
      if (p.avatar_url) profile.avatar_url = /^https?:/.test(p.avatar_url) ? p.avatar_url : base + p.avatar_url;
      applyProfile();
    })
    .catch(function () {});

  // ── Keep the host page out of our input ────────────────────────────────────
  // Sites with a pop-up open (Bootstrap / React modals) pull keyboard focus back into the
  // pop-up, so the chat box looks frozen. Stop focus events inside the chat from reaching
  // the page's own listeners, and keep typing from triggering the page's shortcuts.
  function inChat(t) { return !!t && t.nodeType === 1 && (panel.contains(t) || btn.contains(t)); }
  ['focus', 'focusin', 'blur', 'focusout'].forEach(function (type) {
    window.addEventListener(type, function (e) { if (inChat(e.target)) e.stopImmediatePropagation(); }, true);
  });
  ['keydown', 'keyup', 'keypress'].forEach(function (type) {
    panel.addEventListener(type, function (e) { e.stopPropagation(); });
  });

  if (openAtStart) open();

  // ── Global API for parent apps (Angular / JS) ──────────────────────────────
  window.NexusChat = {
    open: open, close: close, toggle: toggle, send: send, restart: restart,
    isOpen: function () { return panel.classList.contains('open'); },
    destroy: function () { close(); btn.remove(); panel.remove(); style.remove(); delete window.NexusChat; }
  };
})();

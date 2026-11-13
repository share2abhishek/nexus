/*!
 * Social-Nexus website chat widget.
 * Drop this on any website to connect its chat to the Social-Nexus bot:
 *   <script src="https://YOUR-APP/webchat-widget.js"
 *           data-token="webchat_xxxxxxxx"
 *           data-name="Your Business"
 *           data-color="#15233b"></script>
 * The visitor's messages go to /api/webhooks/webchat/<token> and the bot (menu,
 * keywords, knowledge base, AI or your n8n workflow) answers. No dependencies.
 */
(function () {
  'use strict';
  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script'); return s[s.length - 1];
  })();
  if (!script) return;
  var token = script.getAttribute('data-token');
  if (!token) { console.error('[Social-Nexus chat] missing data-token'); return; }
  // The app's origin is wherever this script was served from
  var base = (function () { try { return new URL(script.src).origin; } catch (e) { return ''; } })();
  var name = script.getAttribute('data-name') || 'Chat';
  var color = script.getAttribute('data-color') || '#15233b';
  var greeting = script.getAttribute('data-greeting') || ('Hi! Ask us anything about ' + name + '.');
  var endpoint = base + '/api/webhooks/webchat/' + encodeURIComponent(token);

  // A stable id for this visitor, so the bot remembers the conversation
  var VKEY = 'snchat_visitor_' + token;
  var visitorId;
  try {
    visitorId = localStorage.getItem(VKEY);
    if (!visitorId) { visitorId = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(VKEY, visitorId); }
  } catch (e) { visitorId = 'v' + Math.random().toString(36).slice(2, 10); }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // ── Styles (scoped by the .snchat- prefix) ──────────────────────────────────
  var css =
    '.snchat-btn{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:' + color + ';color:#fff;border:0;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:2147483000;display:flex;align-items:center;justify-content:center;font-size:24px;transition:transform .15s}' +
    '.snchat-btn:hover{transform:scale(1.06)}' +
    '.snchat-panel{position:fixed;right:20px;bottom:88px;width:340px;max-width:calc(100vw - 32px);height:460px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}' +
    '.snchat-panel.open{display:flex}' +
    '.snchat-head{background:' + color + ';color:#fff;padding:14px 16px;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:space-between}' +
    '.snchat-close{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1;opacity:.85}' +
    '.snchat-body{flex:1;overflow-y:auto;padding:14px;background:#f6f7f9;display:flex;flex-direction:column;gap:8px}' +
    '.snchat-msg{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
    '.snchat-bot{align-self:flex-start;background:#fff;color:#1a1a1a;border:1px solid #e6e8eb;border-bottom-left-radius:4px}' +
    '.snchat-me{align-self:flex-end;background:' + color + ';color:#fff;border-bottom-right-radius:4px}' +
    '.snchat-typing{align-self:flex-start;color:#888;font-size:13px;padding:4px 6px}' +
    '.snchat-foot{display:flex;gap:8px;padding:10px;border-top:1px solid #eceef0;background:#fff}' +
    '.snchat-input{flex:1;border:1px solid #d7dadd;border-radius:10px;padding:9px 11px;font-size:14px;outline:none;font-family:inherit}' +
    '.snchat-input:focus{border-color:' + color + '}' +
    '.snchat-send{background:' + color + ';color:#fff;border:0;border-radius:10px;padding:0 14px;cursor:pointer;font-size:14px;font-weight:600}' +
    '.snchat-send:disabled{opacity:.5;cursor:default}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  // ── Elements ────────────────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.className = 'snchat-btn'; btn.setAttribute('aria-label', 'Open chat'); btn.innerHTML = '💬';

  var panel = document.createElement('div');
  panel.className = 'snchat-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', name + ' chat');
  panel.innerHTML =
    '<div class="snchat-head"><span>' + esc(name) + '</span><button class="snchat-close" aria-label="Close chat">×</button></div>' +
    '<div class="snchat-body"></div>' +
    '<form class="snchat-foot"><input class="snchat-input" type="text" placeholder="Type a message…" autocomplete="off" aria-label="Message" /><button class="snchat-send" type="submit">Send</button></form>';

  document.body.appendChild(btn); document.body.appendChild(panel);
  var body = panel.querySelector('.snchat-body');
  var form = panel.querySelector('.snchat-foot');
  var input = panel.querySelector('.snchat-input');
  var sendBtn = panel.querySelector('.snchat-send');
  var started = false;

  function add(text, who) {
    var el = document.createElement('div');
    el.className = 'snchat-msg ' + (who === 'me' ? 'snchat-me' : 'snchat-bot');
    el.textContent = text;
    body.appendChild(el); body.scrollTop = body.scrollHeight; return el;
  }
  function open() {
    panel.classList.add('open');
    if (!started) { started = true; add(greeting, 'bot'); }
    setTimeout(function () { input.focus(); }, 50);
  }
  function close() { panel.classList.remove('open'); }
  btn.addEventListener('click', function () { panel.classList.contains('open') ? close() : open(); });
  panel.querySelector('.snchat-close').addEventListener('click', close);

  function send(text) {
    add(text, 'me');
    input.value = ''; sendBtn.disabled = true;
    var typing = document.createElement('div'); typing.className = 'snchat-typing'; typing.textContent = 'typing…';
    body.appendChild(typing); body.scrollTop = body.scrollHeight;
    fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, visitor_id: visitorId, name: name === 'Chat' ? undefined : undefined })
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        typing.remove();
        if (d && d.reply) add(d.reply, 'bot');
        else add('Thanks! Someone from our team will reply here soon.', 'bot');
      })
      .catch(function () { typing.remove(); add('Sorry, the chat is unavailable right now. Please try again in a moment.', 'bot'); })
      .then(function () { sendBtn.disabled = false; input.focus(); });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = (input.value || '').trim();
    if (text) send(text);
  });
})();

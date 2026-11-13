/*!
 * Social-Nexus website chat widget.
 * Drop this on any website to connect its chat to the Social-Nexus bot:
 *   <script src="https://YOUR-APP/webchat-widget.js"
 *           data-token="webchat_xxxxxxxx"
 *           data-name="Your Business"
 *           data-color="#0d9488"
 *           data-whatsapp="912049331986"></script>
 * The visitor's messages go to /api/webhooks/webchat/<token> and the bot (menu,
 * keywords, knowledge base, AI or live agents) answers. No dependencies.
 */
(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script'); return s[s.length - 1];
  })();
  if (!script) return;

  var token = script.getAttribute('data-token');
  if (!token) { console.error('[Nexus Chat] missing data-token'); return; }

  var base = (function () { try { return new URL(script.src).origin; } catch (e) { return ''; } })();
  var name = script.getAttribute('data-name') || 'Urban Society';
  var color = script.getAttribute('data-color') || '#0d9488';
  var greeting = script.getAttribute('data-greeting') || ('Hi! Welcome to ' + name + '. Ask us anything about features, society pricing, or book a live demo.');
  var waNumber = script.getAttribute('data-whatsapp') || '912049331986';
  var hideButton = script.getAttribute('data-hide-button') === 'true';

  var endpoint = base + '/api/webhooks/webchat/' + encodeURIComponent(token);
  var historyEndpoint = base + '/api/webhooks/webchat/' + encodeURIComponent(token) + '/history';

  // Stable visitor ID
  var VKEY = 'snchat_visitor_' + token;
  var visitorId;
  try {
    visitorId = localStorage.getItem(VKEY);
    if (!visitorId) {
      visitorId = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(VKEY, visitorId);
    }
  } catch (e) {
    visitorId = 'v' + Math.random().toString(36).slice(2, 10);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function formatText(s) {
    var safe = esc(s);
    // Convert links
    safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;font-weight:600">$1</a>');
    // Convert *bold*
    safe = safe.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
    return safe;
  }

  // ── Scoped CSS Styles ───────────────────────────────────────────────────────
  var css =
    '.snchat-btn{position:fixed;right:24px;bottom:24px;width:60px;height:60px;border-radius:50%;background:' + color + ';color:#fff;border:0;cursor:pointer;box-shadow:0 8px 26px rgba(13,148,136,.4);z-index:2147483000;display:flex;align-items:center;justify-content:center;font-size:26px;transition:all .2s ease}' +
    '.snchat-btn:hover{transform:scale(1.08);box-shadow:0 12px 32px rgba(13,148,136,.55)}' +
    '.snchat-btn.hidden{display:none!important}' +
    '.snchat-panel{position:fixed;right:24px;bottom:96px;width:370px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#ffffff;border-radius:18px;box-shadow:0 16px 48px rgba(0,0,0,.22);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;animation:snchat-slide .2s ease-out}' +
    '@keyframes snchat-slide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}' +
    '.snchat-panel.open{display:flex}' +
    '.snchat-head{background:linear-gradient(135deg,' + color + ',#0f766e);color:#fff;padding:14px 16px;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 8px rgba(0,0,0,.08)}' +
    '.snchat-head-title{display:flex;align-items:center;gap:8px}' +
    '.snchat-head-actions{display:flex;align-items:center;gap:10px}' +
    '.snchat-wa-head{color:#25d366;background:#fff;border-radius:12px;padding:3px 8px;font-size:11px;font-weight:700;text-decoration:none;display:flex;align-items:center;gap:4px}' +
    '.snchat-wa-head:hover{background:#f0fdf4}' +
    '.snchat-close{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1;opacity:.9;padding:0}' +
    '.snchat-close:hover{opacity:1}' +
    '.snchat-body{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;flex-direction:column;gap:10px}' +
    '.snchat-msg-row{display:flex;flex-direction:column}' +
    '.snchat-msg{max-width:85%;padding:10px 14px;border-radius:14px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}' +
    '.snchat-bot{align-self:flex-start;background:#ffffff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-left-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,.04)}' +
    '.snchat-me{align-self:flex-end;background:' + color + ';color:#ffffff;border-bottom-right-radius:3px;box-shadow:0 2px 6px rgba(13,148,136,.3)}' +
    '.snchat-meta{font-size:10px;color:#94a3b8;margin-top:2px;padding:0 4px}' +
    '.snchat-meta.me{text-align:right}' +
    '.snchat-typing{align-self:flex-start;color:#64748b;font-size:12px;padding:6px 10px;background:#e2e8f0;border-radius:10px}' +
    '.snchat-foot{display:flex;gap:8px;padding:12px;border-top:1px solid #e2e8f0;background:#ffffff}' +
    '.snchat-input{flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;font-size:13.5px;outline:none;font-family:inherit;transition:border-color .15s}' +
    '.snchat-input:focus{border-color:' + color + '}' +
    '.snchat-send{background:' + color + ';color:#fff;border:0;border-radius:10px;padding:0 16px;cursor:pointer;font-size:13.5px;font-weight:600;transition:opacity .15s}' +
    '.snchat-send:disabled{opacity:.4;cursor:default}';

  var style = document.createElement('style');
  style.id = 'nexus-webchat-style';
  style.textContent = css;
  document.head.appendChild(style);

  // ── DOM Setup ──────────────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.className = 'snchat-btn' + (hideButton ? ' hidden' : '');
  btn.setAttribute('aria-label', 'Open ' + name + ' chat');
  btn.innerHTML = '💬';

  var panel = document.createElement('div');
  panel.className = 'snchat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', name + ' chat');

  var waBtnHtml = waNumber
    ? '<a class="snchat-wa-head" href="https://wa.me/' + encodeURIComponent(waNumber.replace(/[^0-9]/g, '')) + '?text=' + encodeURIComponent('Hi ' + name + ', I have a question about society management.') + '" target="_blank" rel="noopener noreferrer" title="Switch to WhatsApp"><span>💬 WhatsApp</span></a>'
    : '';

  panel.innerHTML =
    '<div class="snchat-head">' +
      '<div class="snchat-head-title">' +
        '<span>💬</span>' +
        '<span>' + esc(name) + '</span>' +
      '</div>' +
      '<div class="snchat-head-actions">' +
        waBtnHtml +
        '<button class="snchat-close" aria-label="Close chat">×</button>' +
      '</div>' +
    '</div>' +
    '<div class="snchat-body"></div>' +
    '<form class="snchat-foot">' +
      '<input class="snchat-input" type="text" placeholder="Type a message or questions…" autocomplete="off" aria-label="Message" />' +
      '<button class="snchat-send" type="submit">Send</button>' +
    '</form>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var body = panel.querySelector('.snchat-body');
  var form = panel.querySelector('.snchat-foot');
  var input = panel.querySelector('.snchat-input');
  var sendBtn = panel.querySelector('.snchat-send');

  var knownMessageIds = {};
  var pollTimer = null;
  var hasLoadedHistory = false;

  function renderMessage(text, who, senderName) {
    var row = document.createElement('div');
    row.className = 'snchat-msg-row';

    var el = document.createElement('div');
    el.className = 'snchat-msg ' + (who === 'me' ? 'snchat-me' : 'snchat-bot');
    el.innerHTML = formatText(text);

    row.appendChild(el);

    if (senderName && who !== 'me') {
      var meta = document.createElement('div');
      meta.className = 'snchat-meta';
      meta.textContent = senderName;
      row.appendChild(meta);
    }

    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
    return row;
  }

  function fetchHistory() {
    var url = historyEndpoint + '?visitor_id=' + encodeURIComponent(visitorId) + '&t=' + Date.now();
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        hasLoadedHistory = true;
        var msgs = Array.isArray(data.messages) ? data.messages : [];
        if (msgs.length === 0) {
          if (body.children.length === 0) {
            renderMessage(greeting, 'bot', name);
          }
          return;
        }

        // Check if messages need rendering
        msgs.forEach(function (m) {
          if (m.id && knownMessageIds[m.id]) return;
          if (m.id) knownMessageIds[m.id] = true;
          renderMessage(m.text, m.who, m.who === 'me' ? 'You' : (m.sender_name || name));
        });
      })
      .catch(function () {
        if (!hasLoadedHistory && body.children.length === 0) {
          renderMessage(greeting, 'bot', name);
        }
      });
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (panel.classList.contains('open')) {
        fetchHistory();
      }
    }, 4500);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function open() {
    panel.classList.add('open');
    if (!hasLoadedHistory) {
      fetchHistory();
    }
    startPolling();
    setTimeout(function () { input.focus(); }, 60);
  }

  function close() {
    panel.classList.remove('open');
    stopPolling();
  }

  function toggle() {
    panel.classList.contains('open') ? close() : open();
  }

  btn.addEventListener('click', toggle);
  panel.querySelector('.snchat-close').addEventListener('click', close);

  function send(text) {
    if (!text || !text.trim()) return;
    var trimmed = text.trim();

    renderMessage(trimmed, 'me', 'You');
    input.value = '';
    sendBtn.disabled = true;

    var typing = document.createElement('div');
    typing.className = 'snchat-typing';
    typing.textContent = 'Urban Society typing…';
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: trimmed,
        visitor_id: visitorId,
        name: name
      })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        typing.remove();
        if (d && d.reply) {
          renderMessage(d.reply, 'bot', name);
        } else {
          renderMessage('Thanks for your enquiry! Our society advisor will reply here shortly.', 'bot', name);
        }
      })
      .catch(function () {
        typing.remove();
        renderMessage('Sorry, chat service is temporarily connecting. You can also chat directly with us on WhatsApp.', 'bot', name);
      })
      .then(function () {
        sendBtn.disabled = false;
        input.focus();
        fetchHistory();
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var val = (input.value || '').trim();
    if (val) send(val);
  });

  // ── Global API for parent apps (Angular / JS) ──────────────────────────────
  window.NexusChat = {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: function () { return panel.classList.contains('open'); },
    send: send,
    destroy: function () {
      close();
      btn.remove();
      panel.remove();
      style.remove();
      delete window.NexusChat;
    }
  };
})();

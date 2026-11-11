// Social-Nexus app — WhatsApp auto-replies (chatbot) screen.
// One of the files in public/js, loaded in order by index.html (shared global scope).
//
// Owners write their replies here; "Try it" shows exactly what a customer would
// get (same rules as the live bot: POST /api/lead-pipeline/bot/preview), and
// nothing is sent until auto-replies are switched on and saved.

const BotState = { data: null, dirty: false, tryLog: [] };
const BOT_DAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]];

async function loadWhatsAppBot() {
  const root = document.getElementById('bot-root');
  if (!root) return;
  if (BotState.dirty && BotState.data) return; // keep unsaved edits when coming back
  try {
    BotState.data = await api('GET', '/api/lead-pipeline/bot');
    BotState.dirty = false;
    renderWhatsAppBot();
  } catch (err) {
    root.innerHTML = `<div class="state-error">Couldn’t load auto-replies: ${escapeHtml(err.message)} <button class="btn btn-secondary btn-sm" onclick="loadWhatsAppBot()">Try again</button></div>`;
  }
}

function botTextarea(cls, value, placeholder, rows = 2, id = '') {
  return `<textarea ${id ? `id="${id}" ` : ''}class="form-textarea bot-text ${cls}" rows="${rows}" placeholder="${escapeHtml(placeholder)}" maxlength="1000">${escapeHtml(value || '')}</textarea>`;
}

function botMenuRow(o = {}) {
  return `
    <div class="bot-row" data-kind="menu">
      <div class="bot-row-main">
        <input class="form-input bot-menu-label" value="${escapeHtml(o.label || '')}" placeholder="Option, e.g. Prices" maxlength="60" />
        ${botTextarea('bot-menu-reply', o.reply, o.handover ? 'What to say before a person takes over' : 'What the bot replies, e.g. Haircut ₹300, colour ₹1200')}
        <label class="bot-check"><input type="checkbox" class="bot-menu-handover" ${o.handover ? 'checked' : ''}/> Hand over to a person (the bot goes quiet in that chat)</label>
      </div>
      <button class="btn btn-ghost btn-ghost-danger btn-sm bot-remove" type="button" title="Remove this option" aria-label="Remove this option">Remove</button>
    </div>`;
}

function botKeywordRow(r = {}) {
  return `
    <div class="bot-row" data-kind="keyword">
      <div class="bot-row-main">
        <label class="form-label">When the message mentions</label>
        <input class="form-input bot-kw-words" value="${escapeHtml((r.keywords || []).join(', '))}" placeholder="price, cost, rate" />
        <label class="form-label">Reply with</label>
        ${botTextarea('bot-kw-reply', r.reply, r.handover ? 'What to say before a person takes over' : 'Your answer')}
        <label class="bot-check"><input type="checkbox" class="bot-kw-handover" ${r.handover ? 'checked' : ''}/> Hand over to a person</label>
      </div>
      <button class="btn btn-ghost btn-ghost-danger btn-sm bot-remove" type="button" title="Remove this reply" aria-label="Remove this reply">Remove</button>
    </div>`;
}

function renderWhatsAppBot() {
  const root = document.getElementById('bot-root');
  const d = BotState.data;
  const c = d.config;
  const canEdit = true; // the server checks permissions on save
  const fbMode = c.fallback.mode;

  root.innerHTML = `
    <div class="bot-layout">
      <div class="bot-editor">

        <div class="bot-hero ${d.enabled ? 'on' : ''}">
          <label class="bot-switch">
            <input type="checkbox" id="bot-enabled" ${d.enabled ? 'checked' : ''} ${canEdit ? '' : 'disabled'} />
            <span class="bot-switch-track" aria-hidden="true"></span>
          </label>
          <div class="bot-hero-text">
            <div class="bot-hero-title" id="bot-hero-title">${d.enabled ? 'Auto-replies are on' : 'Auto-replies are off'}</div>
            <div class="bot-hero-sub">${d.enabled
              ? 'Customers who write to your WhatsApp get an answer within seconds, day and night.'
              : 'Write your replies below and test them with “Try it”. Nothing is sent until you switch this on and save.'}</div>
          </div>
        </div>
        ${d.licensed === false ? `
        <div class="callout callout-warn">
          <b>Auto-replies need an active licence.</b> ${d.enabled ? 'They’re switched on but won’t answer until the licence is active.' : 'You can prepare and try them now.'} Customers’ messages still arrive in Chats, and STOP is always handled.
          <button class="btn btn-secondary btn-sm" onclick="openSettings('license')">Open Licence</button>
        </div>` : ''}
        ${!d.whatsapp_connected ? `
        <div class="callout callout-warn">
          <b>WhatsApp isn’t connected yet.</b> You can prepare and try your replies now; they start working once your number is connected.
          <button class="btn btn-secondary btn-sm" onclick="navigateTo('leads-settings')">Open WhatsApp setup</button>
        </div>` : ''}

        <div class="settings-section">
          <div class="settings-section-header">
            <div><div class="settings-section-title">1. Welcome message</div>
            <div class="settings-section-sub">Sent when someone writes for the first time (or after a day), or says “hi” or “menu”. <code>{{name}}</code> becomes their first name, <code>{{business}}</code> your business name (from <a href="javascript:void(0)" onclick="navigateTo('brand')">Brand kit</a>).</div></div>
            <label class="bot-check"><input type="checkbox" id="bot-welcome-on" ${c.welcome.enabled ? 'checked' : ''}/> On</label>
          </div>
          <div class="card-body">${botTextarea('', c.welcome.text, 'Hi {{name}}! Thanks for messaging {{business}}.', 3, 'bot-welcome-text')}</div>
        </div>

        <div class="settings-section">
          <div class="settings-section-header">
            <div><div class="settings-section-title">2. Menu</div>
            <div class="settings-section-sub">Shown under the welcome message as “Reply with a number”. Options without a reply aren’t shown.</div></div>
            <label class="bot-check"><input type="checkbox" id="bot-menu-on" ${c.menu.enabled ? 'checked' : ''}/> On</label>
          </div>
          <div class="card-body">
            <div id="bot-menu-list" class="bot-list">${c.menu.options.map(botMenuRow).join('')}</div>
            <button class="btn btn-secondary btn-sm" type="button" id="bot-add-menu">+ Add option</button>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-header">
            <div><div class="settings-section-title">3. Answers to common questions</div>
            <div class="settings-section-sub">If a message mentions one of these words, the bot sends your answer. Separate words with commas.</div></div>
          </div>
          <div class="card-body">
            <div id="bot-kw-list" class="bot-list">${c.keywords.map(botKeywordRow).join('')}</div>
            <button class="btn btn-secondary btn-sm" type="button" id="bot-add-kw">+ Add an answer</button>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-header">
            <div><div class="settings-section-title">4. When you’re closed</div>
            <div class="settings-section-sub">Outside these hours the bot adds this message (once every 12 hours). <code>{{opens}}</code> becomes your next opening time.</div></div>
            <label class="bot-check"><input type="checkbox" id="bot-away-on" ${c.away.enabled ? 'checked' : ''}/> On</label>
          </div>
          <div class="card-body">
            <div class="bot-hours">
              <div class="bot-days" role="group" aria-label="Open on">
                ${BOT_DAYS.map(([n, v]) => `<label class="bot-day"><input type="checkbox" value="${v}" ${c.away.days.includes(v) ? 'checked' : ''}/><span>${n}</span></label>`).join('')}
              </div>
              <label class="bot-time">Open from <input type="time" class="form-input" id="bot-away-start" value="${escapeHtml(c.away.start)}"/></label>
              <label class="bot-time">to <input type="time" class="form-input" id="bot-away-end" value="${escapeHtml(c.away.end)}"/></label>
            </div>
            ${botTextarea('', c.away.text, 'Thanks! We are closed now and will reply {{opens}}.', 2, 'bot-away-text')}
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-header">
            <div><div class="settings-section-title">5. Anything else</div>
            <div class="settings-section-sub">When a message doesn’t match anything above.</div></div>
          </div>
          <div class="card-body bot-radios">
            <label class="bot-radio"><input type="radio" name="bot-fb" value="message" ${fbMode === 'message' ? 'checked' : ''}/>
              <span><b>Send a short holding message</b> (at most once an hour per chat)</span></label>
            ${botTextarea('', c.fallback.text, 'Thanks! Someone from our team will reply soon.', 2, 'bot-fb-text')}
            <label class="bot-radio"><input type="radio" name="bot-fb" value="ai" ${fbMode === 'ai' ? 'checked' : ''}/>
              <span><b>Let AI answer</b>, using only the answers you wrote above. Uses your AI setup (Settings → AI); the customer’s message is sent to that AI service unless you use Local AI.</span></label>
            <label class="bot-radio"><input type="radio" name="bot-fb" value="n8n" ${fbMode === 'n8n' ? 'checked' : ''}/>
              <span><b>Let your n8n workflow answer</b> — it gets the message and replies with <code>{"reply": "…"}</code>. ${d.n8n_configured
                ? 'Your n8n address is saved.'
                : `<a href="javascript:void(0)" onclick="navigateTo('leads-settings')">Add your n8n address in Setup</a> first; until then the holding message is sent.`}</span></label>
            <label class="bot-radio"><input type="radio" name="bot-fb" value="none" ${fbMode === 'none' ? 'checked' : ''}/>
              <span><b>Say nothing</b> — you’ll answer in Chats</span></label>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-header">
            <div><div class="settings-section-title">6. When you reply yourself</div>
            <div class="settings-section-sub">So the bot never talks over you, it goes quiet in that chat for a while. You can switch it back on from the chat.</div></div>
          </div>
          <div class="card-body">
            <label class="bot-time">The bot stays quiet for
              <select class="form-select" id="bot-pause">
                ${[1, 2, 4, 8, 12, 24, 48].map(h => `<option value="${h}" ${c.handover.pause_hours === h ? 'selected' : ''}>${h} hour${h === 1 ? '' : 's'}</option>`).join('')}
              </select>
            </label>
            <div class="form-hint" style="margin-top:12px">Always on: if someone replies <b>STOP</b>, they get no more broadcasts (and <b>START</b> brings them back).${d.opted_out_count ? ` ${d.opted_out_count} contact${d.opted_out_count === 1 ? ' has' : 's have'} opted out so far.` : ''}</div>
          </div>
        </div>

        <div class="bot-savebar">
          <span id="bot-dirty" class="form-hint">${BotState.dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <button class="btn btn-primary" id="bot-save" type="button">Save auto-replies</button>
        </div>
      </div>

      <aside class="bot-try" aria-label="Try your auto-replies">
        <div class="bot-try-head">
          <div class="bot-try-title">Try it</div>
          <div class="form-hint">Type what a customer might write. Nothing is sent.</div>
        </div>
        <div class="bot-try-chat" id="bot-try-chat" aria-live="polite">
          <div class="bot-try-empty">Try “hi”, “price?” or “2”.</div>
        </div>
        <form class="bot-try-form" id="bot-try-form">
          <input class="form-input" id="bot-try-input" placeholder="Message from a customer" autocomplete="off" maxlength="500" />
          <button class="btn btn-primary btn-sm" type="submit">Send</button>
        </form>
        <div class="bot-try-opts">
          <label class="bot-check"><input type="checkbox" id="bot-try-first"/> Their first message</label>
          <button class="btn btn-ghost btn-sm" type="button" id="bot-try-clear">Clear</button>
        </div>
      </aside>
    </div>`;

  wireWhatsAppBot();
  renderBotTryLog();
  updateBotNavDot();
}

function wireWhatsAppBot() {
  const root = document.getElementById('bot-root');
  const markDirty = () => {
    BotState.dirty = true;
    const el = document.getElementById('bot-dirty');
    if (el) el.textContent = 'Unsaved changes';
  };
  root.addEventListener('input', markDirty);
  root.addEventListener('change', (e) => {
    if (e.target.closest('.bot-try')) return;
    markDirty();
    if (e.target.id === 'bot-enabled') {
      document.getElementById('bot-hero-title').textContent = e.target.checked ? 'Auto-replies will be on (save to start)' : 'Auto-replies will be off (save to stop)';
    }
  });
  root.addEventListener('click', (e) => {
    const rm = e.target.closest('.bot-remove');
    if (rm) { rm.closest('.bot-row').remove(); markDirty(); }
  });
  document.getElementById('bot-add-menu').onclick = () => {
    const list = document.getElementById('bot-menu-list');
    if (list.children.length >= (BotState.data.limits?.menuOptions || 9)) return toast('A menu can have up to 9 options (one digit each).', 'warning');
    list.insertAdjacentHTML('beforeend', botMenuRow());
    list.lastElementChild.querySelector('input').focus();
    markDirty();
  };
  document.getElementById('bot-add-kw').onclick = () => {
    const list = document.getElementById('bot-kw-list');
    list.insertAdjacentHTML('beforeend', botKeywordRow());
    list.lastElementChild.querySelector('input').focus();
    markDirty();
  };
  document.getElementById('bot-save').onclick = saveWhatsAppBot;
  document.getElementById('bot-try-form').onsubmit = (e) => { e.preventDefault(); tryWhatsAppBot(); };
  document.getElementById('bot-try-clear').onclick = () => { BotState.tryLog = []; renderBotTryLog(); };
}

// Read the form into the same shape the server saves
function collectBotConfig() {
  const val = (id) => document.getElementById(id)?.value ?? '';
  const on = (id) => !!document.getElementById(id)?.checked;
  return {
    welcome: { enabled: on('bot-welcome-on'), text: val('bot-welcome-text') },
    menu: {
      enabled: on('bot-menu-on'),
      options: [...document.querySelectorAll('#bot-menu-list .bot-row')].map(r => ({
        label: r.querySelector('.bot-menu-label').value,
        reply: r.querySelector('.bot-menu-reply').value,
        handover: r.querySelector('.bot-menu-handover').checked,
      })),
    },
    keywords: [...document.querySelectorAll('#bot-kw-list .bot-row')].map(r => ({
      keywords: r.querySelector('.bot-kw-words').value,
      reply: r.querySelector('.bot-kw-reply').value,
      handover: r.querySelector('.bot-kw-handover').checked,
    })),
    away: {
      enabled: on('bot-away-on'),
      days: [...document.querySelectorAll('.bot-days input:checked')].map(i => Number(i.value)),
      start: val('bot-away-start'), end: val('bot-away-end'), text: val('bot-away-text'),
    },
    fallback: { mode: document.querySelector('input[name="bot-fb"]:checked')?.value || 'message', text: val('bot-fb-text') },
    handover: { pause_hours: Number(val('bot-pause')) || 12 },
    timezone: BotState.data?.config?.timezone,
  };
}

async function saveWhatsAppBot() {
  const btn = document.getElementById('bot-save');
  const enabled = !!document.getElementById('bot-enabled')?.checked;
  const config = collectBotConfig();
  // Catch the most common slip before it confuses a customer
  const hasAnswer = config.menu.options.some(o => o.reply.trim()) || config.keywords.some(k => k.reply.trim() && k.keywords.trim());
  if (enabled && !hasAnswer && !config.welcome.text.trim()) {
    return toast('Write at least a welcome message or one answer before switching auto-replies on.', 'warning');
  }
  if (enabled && config.away.enabled && !config.away.days.length) {
    return toast('Choose the days you’re open, or turn off “When you’re closed”.', 'warning');
  }
  btn.disabled = true;
  try {
    const saved = await api('POST', '/api/lead-pipeline/bot', { enabled, config });
    BotState.data = { ...BotState.data, ...saved };
    BotState.dirty = false;
    renderWhatsAppBot();
    toast(enabled ? 'Saved. Auto-replies are on.' : 'Saved. Auto-replies are off.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    const b = document.getElementById('bot-save');
    if (b) b.disabled = false;
  }
}

async function tryWhatsAppBot() {
  const input = document.getElementById('bot-try-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  BotState.tryLog.push({ from: 'customer', text });
  renderBotTryLog();
  try {
    const r = await api('POST', '/api/lead-pipeline/bot/preview', {
      text, config: collectBotConfig(), first_time: document.getElementById('bot-try-first').checked,
    });
    document.getElementById('bot-try-first').checked = false;
    const note = {
      paused: 'The bot is quiet in this chat because a person replied.',
      no_match: 'No reply: nothing matched and “Anything else” is set to say nothing.',
      fallback: null, welcome: null, keyword: null, menu: null,
      ai: 'AI would answer this one, using your answers above.',
      n8n: 'Your n8n workflow would answer this one.',
    }[r.reason];
    if (r.replies.length) r.replies.forEach(t => BotState.tryLog.push({ from: 'bot', text: t }));
    else if (r.ai || r.reason === 'n8n') BotState.tryLog.push({ from: 'note', text: note });
    else BotState.tryLog.push({ from: 'note', text: note || (r.reason === 'fallback' ? 'No reply: the holding message was already sent in the last hour.' : 'No reply.') });
    if (r.action === 'handover') BotState.tryLog.push({ from: 'note', text: 'Handed over: the bot now goes quiet in this chat so you can answer in Chats.' });
    if (r.action === 'opt_out') BotState.tryLog.push({ from: 'note', text: 'Opted out: this person won’t get broadcasts any more.' });
  } catch (err) {
    BotState.tryLog.push({ from: 'note', text: err.message });
  }
  renderBotTryLog();
}

function renderBotTryLog() {
  const chat = document.getElementById('bot-try-chat');
  if (!chat) return;
  if (!BotState.tryLog.length) { chat.innerHTML = '<div class="bot-try-empty">Try “hi”, “price?” or “2”.</div>'; return; }
  chat.innerHTML = BotState.tryLog.map(m => m.from === 'note'
    ? `<div class="bot-try-note">${escapeHtml(m.text)}</div>`
    : `<div class="bot-bubble ${m.from}">${escapeHtml(m.text)}</div>`).join('');
  chat.scrollTop = chat.scrollHeight;
}

// Small dot next to "Auto-replies" in the menu: green when on
function updateBotNavDot() {
  const dot = document.getElementById('nav-bot-dot');
  if (dot && BotState.data) {
    dot.className = `status-dot-sm ${BotState.data.enabled ? 'ok' : ''}`;
    dot.title = BotState.data.enabled ? 'Auto-replies are on' : '';
  }
}

// Let a chat's bot answer again after a person took over
async function resumeWhatsAppBot(leadId) {
  try {
    await api('POST', `/api/lead-pipeline/bot/resume/${leadId}`);
    toast('Auto-replies are back on in this chat.', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

window.loadWhatsAppBot = loadWhatsAppBot;
window.resumeWhatsAppBot = resumeWhatsAppBot;

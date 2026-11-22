// NexaDrip app — WhatsApp auto-replies (chatbot) screen.
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
              <span><b>Let AI answer</b>, using the answers above <b>and your knowledge base below</b>. Uses your AI setup (Settings → AI); the customer’s message is sent to that AI service unless you use Local AI.</span></label>
            <div class="bot-knowledge" style="margin:2px 0 6px 30px">
              <label class="form-label" for="bot-knowledge" style="font-size:13px;margin-bottom:4px;display:block">Knowledge base <span class="form-hint" style="display:inline;font-weight:400">— business facts the AI can answer from (optional)</span></label>
              <textarea id="bot-knowledge" class="form-textarea bot-text" rows="6" maxlength="4000" placeholder="Tell the bot about your business so it answers more questions on its own, for example:&#10;• Delivery: free across Pune for orders above ₹999, 2–3 days otherwise.&#10;• Hours: 9am–9pm, closed Sundays.&#10;• Returns: within 7 days with the bill.&#10;• We make eggless cakes on request; ₹100 extra.">${escapeHtml(c.knowledge || '')}</textarea>
              <div class="form-hint">The AI answers only from this and the replies above — it never invents prices or promises. Keep it short and factual: hours, delivery, returns, products, common questions. Up to 4000 characters.</div>
              <div style="margin-top:10px;padding:10px 14px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.25);border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
                <div style="font-size:12.5px;color:var(--text-primary)">
                  ✨ <b>Dedicated AI Knowledge Base Hub:</b> Manage structured Q&A FAQs, business facts, persona tone, and test with the live interactive simulator.
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="navigateTo('ai-knowledge-base')" style="white-space:nowrap">Open AI Knowledge Base →</button>
              </div>
            </div>
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

        ${botWebchatSection(d)}

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
  root.addEventListener('input', (e) => { if (!e.target.closest('#bot-webchat')) markDirty(); });
  root.addEventListener('change', (e) => {
    if (e.target.closest('.bot-try') || e.target.closest('#bot-webchat')) return;
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
  document.getElementById('bot-try-clear').onclick = () => { BotState.tryLog = []; BotState.tryPaused = false; renderBotTryLog(); };
  wireWebchatLook();
}

// ── 7. Website chat: its look (name, picture, description, colour) with a live preview ──
const WC_DEFAULT_COLOR = '#D4813C';

function botWebchatSection(d) {
  const p = d.webchat_profile || {};
  const tok = d.webchat_token || '';
  const base = d.webchat_base || '';
  const snippet = `<script src="${base}/webchat-widget.js"\n        data-token="${tok}"></scr` + `ipt>`;
  const color = p.color || WC_DEFAULT_COLOR;
  return `
        <div class="settings-section" id="bot-webchat">
          <div class="settings-section-header">
            <div><div class="settings-section-title">7. Website chat</div>
            <div class="settings-section-sub">How the chat looks on your website, and the code to put it there. It answers with the same menu, answers and knowledge base as WhatsApp. The preview updates as you type.</div></div>
          </div>
          <div class="card-body">
            <div class="wc-layout">
              <div class="wc-form">
                <label class="form-label" for="wc-name">Bot name</label>
                <input class="form-input" id="wc-name" maxlength="60" value="${escapeHtml(p.name || '')}" placeholder="e.g. Ask Avi" />

                <label class="form-label" for="wc-avatar-file">Bot picture</label>
                <div class="wc-avatar-row">
                  <div class="wc-avatar" id="wc-avatar-thumb"></div>
                  <div>
                    <input type="file" id="wc-avatar-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
                    <button class="btn btn-secondary btn-sm" type="button" id="wc-avatar-pick">Upload picture</button>
                    <button class="btn btn-ghost btn-sm" type="button" id="wc-avatar-remove">Remove</button>
                    <div class="form-hint">A square picture works best. It’s resized to 256 × 256.</div>
                  </div>
                </div>

                <label class="form-label" for="wc-desc">Welcome text <span class="form-hint" style="display:inline;font-weight:400">— under the picture before the chat starts. Put *stars* around words to make them bold.</span></label>
                <textarea class="form-textarea" id="wc-desc" rows="3" maxlength="400" placeholder="e.g. Hi, I’m Avi! Ask me about our projects. Send *Hi* to begin.">${escapeHtml(p.description || '')}</textarea>

                <div class="wc-two">
                  <div>
                    <label class="form-label" for="wc-color">Brand colour</label>
                    <div class="wc-color-row">
                      <input type="color" id="wc-color" value="${escapeHtml(color)}" />
                      <input class="form-input" id="wc-color-text" maxlength="7" value="${escapeHtml(color)}" />
                    </div>
                  </div>
                  <div>
                    <label class="form-label" for="wc-placeholder">Message box text</label>
                    <input class="form-input" id="wc-placeholder" maxlength="80" value="${escapeHtml(p.placeholder || '')}" placeholder="Type your message..." />
                  </div>
                </div>

                <label class="form-label" for="wc-whatsapp">WhatsApp number <span class="form-hint" style="display:inline;font-weight:400">— optional, with country code</span></label>
                <input class="form-input" id="wc-whatsapp" maxlength="20" value="${escapeHtml(p.whatsapp || '')}" placeholder="919876543210" />

                <label class="form-label" for="wc-footer-text">Bottom line <span class="form-hint" style="display:inline;font-weight:400">— the small line at the bottom of the chat. Leave blank for “Powered by Radixile Technology”.</span></label>
                <div class="wc-two">
                  <input class="form-input" id="wc-footer-text" maxlength="60" value="${escapeHtml(p.footer_text || '')}" placeholder="Powered by Radixile Technology" aria-label="Bottom line text" />
                  <input class="form-input" id="wc-footer-url" maxlength="500" value="${escapeHtml(p.footer_url || '')}" placeholder="${p.footer_text ? 'Link (optional), https://…' : 'https://radixile.com'}" aria-label="Bottom line link" />
                </div>

                <label class="form-label" for="wc-privacy-url">Privacy policy <span class="form-hint" style="display:inline;font-weight:400">— optional; shown as a link under the bottom line.</span></label>
                <div class="wc-two">
                  <input class="form-input" id="wc-privacy-url" maxlength="500" value="${escapeHtml(p.privacy_url || '')}" placeholder="https://yourwebsite.com/privacy-policy" aria-label="Privacy policy link" />
                  <input class="form-input" id="wc-privacy-label" maxlength="60" value="${escapeHtml(p.privacy_label || '')}" placeholder="Privacy policy" aria-label="Privacy policy link text" />
                </div>

                <div class="wc-save">
                  <button class="btn btn-primary btn-sm" type="button" id="wc-save">Save chat look</button>
                  <span class="form-hint" id="wc-state">Saved</span>
                </div>
              </div>

              <div class="wc-preview">
                <div class="wc-preview-tabs" role="group" aria-label="Preview">
                  <button type="button" class="btn btn-sm btn-secondary active" data-wc-view="start">Start screen</button>
                  <button type="button" class="btn btn-sm btn-ghost" data-wc-view="chat">Conversation</button>
                </div>
                ${tok ? `<iframe id="wc-frame" title="Website chat preview" src="/webchat/${encodeURIComponent(tok)}?preview=1" loading="lazy"></iframe>` : '<div class="state-empty">Preview appears once the chat code is ready.</div>'}
                ${tok ? `<a class="form-hint" href="/webchat/${encodeURIComponent(tok)}" target="_blank" rel="noopener">Open the live chat ↗</a>` : ''}
              </div>
            </div>

            <label class="form-label" style="margin-top:18px">Code for your website</label>
            <div class="form-hint" style="margin-bottom:6px">Paste this one line into your website just before &lt;/body&gt;. Changes to the look above show on your website without changing the code.</div>
            <textarea class="form-textarea" id="bot-webchat-snippet" readonly rows="2" style="font-family:monospace;font-size:12px" onclick="this.select()">${escapeHtml(snippet)}</textarea>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              <button class="btn btn-secondary btn-sm" type="button" onclick="copyWebchatSnippet()">Copy code</button>
              <button class="btn btn-ghost btn-sm" type="button" onclick="regenerateWebchatToken()">Reset the code</button>
            </div>
            <div class="form-hint" style="margin-top:8px">Anyone with this code can chat with your bot — reset it if it leaks. Replies need an active licence and your AI setup (for AI answers), same as WhatsApp.</div>
          </div>
        </div>`;
}

const WcState = { avatar: '', view: 'start', sample: null, dirty: false };

function wcDraft() {
  const v = (id) => document.getElementById(id)?.value ?? '';
  return { name: v('wc-name').trim(), description: v('wc-desc').trim(), color: v('wc-color-text').trim(),
    placeholder: v('wc-placeholder').trim(), whatsapp: v('wc-whatsapp').trim(), avatar: WcState.avatar,
    footer_text: v('wc-footer-text').trim(), footer_url: v('wc-footer-url').trim(),
    privacy_url: v('wc-privacy-url').trim(), privacy_label: v('wc-privacy-label').trim() };
}

function wcThumb() {
  const el = document.getElementById('wc-avatar-thumb');
  if (!el) return;
  const d = wcDraft();
  el.style.background = WcState.avatar ? '#f4e9e4' : (/^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color : WC_DEFAULT_COLOR);
  el.innerHTML = WcState.avatar ? `<img src="${escapeHtml(WcState.avatar)}" alt="" />` : escapeHtml((d.name || '?').charAt(0).toUpperCase());
}

function wcPost() {
  const f = document.getElementById('wc-frame');
  if (!f || !f.contentWindow) return;
  const msg = { type: 'nexus-chat-preview', profile: wcDraft(), messages: WcState.view === 'chat' ? (WcState.sample || []) : [] };
  f.contentWindow.postMessage(msg, location.origin);
}

// The conversation preview: what the bot really says to "Hi" (same rules as "Try it")
async function wcLoadSample() {
  try {
    const r = await api('POST', '/api/lead-pipeline/bot/preview', { text: 'Hi', config: collectBotConfig(), first_time: true });
    const replies = (r.replies || []).map(t => ({ who: 'bot', text: t }));
    WcState.sample = [{ who: 'me', text: 'Hi' }, ...(replies.length ? replies : [{ who: 'bot', text: 'Hello! How can we help?' }])];
  } catch { WcState.sample = [{ who: 'me', text: 'Hi' }, { who: 'bot', text: 'Hello! How can we help?' }]; }
}

function wcMarkDirty() {
  WcState.dirty = true;
  const s = document.getElementById('wc-state');
  if (s) s.textContent = 'Unsaved changes';
  wcThumb(); wcPost();
}

// Square-crop and shrink a picture to 256 × 256 so it stays small
function wcResize(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 256, side = Math.min(img.width, img.height);
      const c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      let out = c.toDataURL('image/png');
      if (out.length > 200 * 1024) out = c.toDataURL('image/jpeg', 0.85);
      resolve(out);
    };
    img.onerror = () => reject(new Error('That file isn’t a picture we can read.'));
    img.src = URL.createObjectURL(file);
  });
}

function wireWebchatLook() {
  const sec = document.getElementById('bot-webchat');
  if (!sec) return;
  WcState.avatar = BotState.data?.webchat_profile?.avatar || '';
  WcState.dirty = false;
  sec.addEventListener('input', (e) => {
    if (e.target.id === 'wc-color') document.getElementById('wc-color-text').value = e.target.value;
    if (e.target.id === 'wc-color-text' && /^#[0-9a-fA-F]{6}$/.test(e.target.value.trim())) document.getElementById('wc-color').value = e.target.value.trim();
    if (e.target.closest('.wc-form')) wcMarkDirty();
  });
  document.getElementById('wc-avatar-pick').onclick = () => document.getElementById('wc-avatar-file').click();
  document.getElementById('wc-avatar-file').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { WcState.avatar = await wcResize(file); wcMarkDirty(); } catch (err) { toast(err.message, 'error'); }
  };
  document.getElementById('wc-avatar-remove').onclick = () => { WcState.avatar = ''; wcMarkDirty(); };
  document.getElementById('wc-save').onclick = saveWebchatLook;
  sec.querySelectorAll('[data-wc-view]').forEach(b => {
    b.onclick = async () => {
      WcState.view = b.dataset.wcView;
      sec.querySelectorAll('[data-wc-view]').forEach(x => {
        const on = x === b;
        x.classList.toggle('active', on); x.classList.toggle('btn-secondary', on); x.classList.toggle('btn-ghost', !on);
      });
      if (WcState.view === 'chat') await wcLoadSample();
      wcPost();
    };
  });
  const frame = document.getElementById('wc-frame');
  if (frame) frame.addEventListener('load', wcPost);
  if (!window.__wcReadyListener) {
    window.__wcReadyListener = true;
    window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.type === 'nexus-chat-preview-ready') wcPost(); });
  }
  wcThumb();
}

async function saveWebchatLook() {
  const btn = document.getElementById('wc-save');
  btn.disabled = true;
  try {
    const r = await api('POST', '/api/lead-pipeline/webchat/profile', wcDraft());
    if (BotState.data) BotState.data.webchat_profile = r.webchat_profile;
    WcState.dirty = false;
    document.getElementById('wc-state').textContent = 'Saved';
    toast('Chat look saved. Your website shows it now.', 'success');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
}

// Read the form into the same shape the server saves
function copyWebchatSnippet() {
  const ta = document.getElementById('bot-webchat-snippet');
  if (!ta) return;
  ta.select();
  navigator.clipboard?.writeText(ta.value).then(() => toast('Website chat code copied', 'success')).catch(() => toast('Press Ctrl+C to copy', 'info'));
}

async function regenerateWebchatToken() {
  if (!confirm('Reset the website chat code? Any website still using the old code will stop working until you paste the new one.')) return;
  try {
    const r = await api('POST', '/api/lead-pipeline/webchat/regenerate');
    const ta = document.getElementById('bot-webchat-snippet');
    if (ta && r.webchat_token) ta.value = ta.value.replace(/data-token="[^"]*"/, `data-token="${r.webchat_token}"`);
    if (BotState.data) BotState.data.webchat_token = r.webchat_token;
    toast('New code ready — update it on your website', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

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
    knowledge: val('bot-knowledge'),
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
      paused: !!BotState.tryPaused,
    });
    if (r.action === 'handover') BotState.tryPaused = true;
    document.getElementById('bot-try-first').checked = false;
    const note = {
      paused: 'The bot is quiet in this chat because a person replied.',
      no_match: 'No reply: nothing matched and “Anything else” is set to say nothing.',
      fallback: null, welcome: null, keyword: null, menu: null,
      ai: 'AI would answer this one, using your answers above.',
      n8n: 'Your n8n workflow would answer this one.',
    }[r.reason];
    if (r.replies.length) r.replies.forEach(t => BotState.tryLog.push({ from: 'bot', text: t }));
    if (r.ai_answered) BotState.tryLog.push({ from: 'note', text: 'Answered by AI from your answers and knowledge base.' });
    else if (r.ai_error) BotState.tryLog.push({ from: 'note', text: `AI could not answer: ${r.ai_error}` });
    else if (!r.replies.length) {
      BotState.tryLog.push({ from: 'note', text: note || (r.reason === 'fallback' ? 'No reply: the holding message was already sent in the last hour.' : 'No reply.') });
    }
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

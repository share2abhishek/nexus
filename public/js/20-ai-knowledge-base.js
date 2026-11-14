// NexaDrip App — AI Chat Knowledge Base Page
// Comprehensive knowledge base management, structuring, AI FAQ generation,
// and live interactive chat simulator for WhatsApp & Website live chat.

const KbState = {
  data: null,
  dirty: false,
  activeTab: 'faqs',          // 'faqs' | 'facts' | 'persona' | 'documents'
  selectedCategory: 'all',
  searchQuery: '',
  simChat: [
    { role: 'bot', text: 'Hello! I am your AI Chat Assistant, trained on your business knowledge base. Ask me anything to test how I answer customers on WhatsApp or your website!', model: 'Nexus AI', latency_ms: 0, sources: [] }
  ],
  isSimulating: false,
  editingFaq: null,
  isGeneratingFaqs: false,
  isFormattingNotes: false,
};

async function loadAiKnowledgeBase() {
  const root = document.getElementById('kb-root');
  if (!root) return;
  if (KbState.dirty && KbState.data) {
    renderAiKnowledgeBase();
    return;
  }
  root.innerHTML = '<div class="state-loading"><span class="spinner lg"></span><div>Loading AI Chat Knowledge Base…</div></div>';
  try {
    KbState.data = await api('GET', '/api/knowledge-base');
    KbState.dirty = false;
    renderAiKnowledgeBase();
  } catch (err) {
    root.innerHTML = `<div class="state-error">Could not load Knowledge Base: ${escapeHtml(err.message)} <button class="btn btn-secondary btn-sm" onclick="loadAiKnowledgeBase()">Try again</button></div>`;
  }
}

function switchKbTab(tab) {
  KbState.activeTab = tab;
  renderAiKnowledgeBase();
}

function filterKbCategory(cat) {
  KbState.selectedCategory = cat;
  renderAiKnowledgeBase();
}

function handleKbSearch(e) {
  KbState.searchQuery = e.target.value;
  renderKbFaqList();
}

// ── Render Main Page ──────────────────────────────────────────────────────────

function renderAiKnowledgeBase() {
  const root = document.getElementById('kb-root');
  if (!root || !KbState.data) return;

  const d = KbState.data;
  const persona = d.persona || {};
  const facts = d.facts || {};
  const faqs = d.faqs || [];
  const stats = d.stats || {};
  const channels = d.channels || {};

  const totalFaqs = faqs.length;
  const activeFaqs = faqs.filter(f => f.enabled !== false).length;
  const charPct = Math.min(100, Math.round(((stats.char_count || 0) / (stats.max_chars || 20000)) * 100));

  root.innerHTML = `
    <div class="kb-container">
      
      <!-- Top Hero / Status Bar -->
      <div class="kb-hero-card card">
        <div class="kb-hero-content">
          <div class="kb-hero-title-area">
            <div class="kb-title-wrap">
              <span class="kb-badge-ai">⚡ AI Grounding Hub</span>
              <h2 class="kb-main-title">AI Chat Knowledge Base</h2>
            </div>
            <p class="kb-subtitle">
              Train what your AI knows across <b>WhatsApp Business</b> and your <b>Website Live Chat</b>. Answers are strictly grounded in your verified facts and FAQs.
            </p>
          </div>

          <div class="kb-actions-bar">
            <button class="btn btn-secondary btn-sm" onclick="openAiGenerateFaqsModal()">
              <span>✨ AI Generate FAQs</span>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openImportExportModal()">
              <span>📥 Import / Export</span>
            </button>
            <button class="btn btn-primary btn-sm ${KbState.dirty ? 'pulse-btn' : ''}" id="btn-save-kb" onclick="saveActiveKnowledgeBase()">
              <span>💾 Save Knowledge Base</span>
            </button>
          </div>
        </div>

        <!-- Metric KPI Cards -->
        <div class="kb-stats-row">
          <div class="kb-stat-item">
            <div class="kb-stat-label">Active FAQs</div>
            <div class="kb-stat-val">${activeFaqs} <span class="kb-stat-sub">/ ${totalFaqs} total</span></div>
          </div>
          <div class="kb-stat-item">
            <div class="kb-stat-label">Categories</div>
            <div class="kb-stat-val">${stats.categories_count || (stats.categories || []).length || 1}</div>
          </div>
          <div class="kb-stat-item">
            <div class="kb-stat-label">Grounding Capacity</div>
            <div class="kb-stat-val">${(stats.char_count || 0).toLocaleString()} <span class="kb-stat-sub">/ ${(stats.max_chars || 20000).toLocaleString()} chars</span></div>
            <div class="kb-progress-bar"><div class="kb-progress-fill" style="width:${charPct}%"></div></div>
          </div>
          <div class="kb-stat-item">
            <div class="kb-stat-label">Connected Channels</div>
            <div class="kb-channel-tags">
              <span class="kb-pill ${channels.bot_enabled ? 'pill-active' : 'pill-inactive'}" title="WhatsApp Auto-Replies">
                📱 WhatsApp: ${channels.bot_enabled ? 'Auto-replies On' : 'Off'}
              </span>
              <span class="kb-pill ${channels.webchat_token ? 'pill-active' : 'pill-inactive'}" title="Website Live Chat Widget" onclick="copyWebChatSnippet()" style="cursor:pointer">
                💬 Webchat: ${channels.webchat_token ? 'Ready (Click to Copy Embed)' : 'Setup needed'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Layout: Editor & Tabs on Left, Live Simulator on Right -->
      <div class="kb-grid-layout">
        
        <!-- Left: Knowledge Base Tabs & Content -->
        <div class="kb-main-column">
          <div class="kb-tabs-nav">
            <button class="kb-tab-btn ${KbState.activeTab === 'faqs' ? 'active' : ''}" onclick="switchKbTab('faqs')">
              ❓ Q&amp;A FAQs <span class="kb-tab-badge">${totalFaqs}</span>
            </button>
            <button class="kb-tab-btn ${KbState.activeTab === 'facts' ? 'active' : ''}" onclick="switchKbTab('facts')">
              🏢 Business Facts &amp; Policies
            </button>
            <button class="kb-tab-btn ${KbState.activeTab === 'persona' ? 'active' : ''}" onclick="switchKbTab('persona')">
              🎭 AI Persona &amp; Tone
            </button>
            <button class="kb-tab-btn ${KbState.activeTab === 'documents' ? 'active' : ''}" onclick="switchKbTab('documents')">
              📄 Raw Notes &amp; Importer
            </button>
          </div>

          <div class="kb-tab-panel card">
            <div class="card-body" id="kb-tab-panel-body">
              ${renderActiveTabContent()}
            </div>
          </div>
        </div>

        <!-- Right: Live Interactive Chat Simulator -->
        <div class="kb-simulator-column">
          <div class="card kb-simulator-card">
            <div class="card-header kb-sim-header">
              <div class="kb-sim-title">
                <span class="kb-online-indicator"></span>
                <span>Live Chat Simulator</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                <select class="form-select form-select-sm" id="kb-sim-model-select" onchange="KbState.simModel = this.value" title="Choose which AI model generates the answer" style="font-size:11px;padding:2px 8px;height:26px;border-radius:6px;max-width:130px;background:var(--bg-card);color:var(--text-secondary)">
                  <option value="auto" ${(!KbState.simModel || KbState.simModel === 'auto') ? 'selected' : ''}>⚡ Auto (Best)</option>
                  <option value="gemini" ${KbState.simModel === 'gemini' ? 'selected' : ''}>✨ Gemini (Free)</option>
                  <option value="groq" ${KbState.simModel === 'groq' ? 'selected' : ''}>⚡ Groq (Fastest)</option>
                  <option value="openai" ${KbState.simModel === 'openai' ? 'selected' : ''}>🧠 OpenAI (GPT-4o)</option>
                  <option value="claude" ${KbState.simModel === 'claude' ? 'selected' : ''}>🤖 Claude</option>
                  <option value="ollama" ${KbState.simModel === 'ollama' ? 'selected' : ''}>🦙 Ollama (Local)</option>
                </select>
                <button class="btn btn-ghost btn-sm" onclick="navigateTo('settings');setTimeout(()=>{switchSettingsTab('ai')},100)" title="Register or change AI Keys in Settings" style="padding:2px 6px;font-size:11px">🔑 Keys</button>
                <button class="btn btn-ghost btn-sm" onclick="clearSimulatorChat()" title="Reset chat history" style="padding:2px 6px;font-size:11px">Clear</button>
              </div>
            </div>

            <div class="kb-sim-body" id="kb-sim-messages">
              ${renderSimulatorMessages()}
            </div>

            <!-- Quick Suggestion Prompt Chips -->
            <div class="kb-sim-chips">
              <button class="kb-chip" onclick="sendSimPrompt('What are your prices and rates?')">Pricing?</button>
              <button class="kb-chip" onclick="sendSimPrompt('What are your opening hours and location?')">Hours?</button>
              <button class="kb-chip" onclick="sendSimPrompt('Can I talk to a real person?')">Talk to agent</button>
              <button class="kb-chip" onclick="sendSimPrompt('What is your return or refund policy?')">Refunds?</button>
            </div>

            <!-- Input area -->
            <form class="kb-sim-input-row" onsubmit="handleSimulatorSubmit(event)">
              <input type="text" id="kb-sim-input" class="form-input" placeholder="Type a customer question…" autocomplete="off" ${KbState.isSimulating ? 'disabled' : ''} />
              <button type="submit" class="btn btn-primary" ${KbState.isSimulating ? 'disabled' : ''}>
                ${KbState.isSimulating ? '<span class="spinner sm"></span>' : 'Send'}
              </button>
            </form>
          </div>
        </div>

      </div>

    </div>

    <!-- Modals Container -->
    <div id="kb-modals-container"></div>
  `;

  // Attach search listener if on faqs tab
  const searchInput = document.getElementById('kb-faq-search');
  if (searchInput) {
    searchInput.value = KbState.searchQuery || '';
    searchInput.addEventListener('input', handleKbSearch);
  }

  scrollSimulatorToBottom();
}

// ── Tab Renderers ─────────────────────────────────────────────────────────────

function renderActiveTabContent() {
  switch (KbState.activeTab) {
    case 'faqs':
      return renderFaqsTab();
    case 'facts':
      return renderFactsTab();
    case 'persona':
      return renderPersonaTab();
    case 'documents':
      return renderDocumentsTab();
    default:
      return renderFaqsTab();
  }
}

// 1. FAQs Tab
function renderFaqsTab() {
  const d = KbState.data;
  const faqs = d.faqs || [];

  const categories = ['all', ...new Set(faqs.map(f => f.category || 'General').filter(Boolean))];
  if (!categories.includes('Pricing')) categories.push('Pricing');
  if (!categories.includes('Support')) categories.push('Support');

  return `
    <div class="kb-faqs-container">
      <div class="kb-faqs-toolbar">
        <div class="kb-search-box">
          <input type="text" id="kb-faq-search" class="form-input" placeholder="Search questions, answers, tags…" />
        </div>
        <div class="kb-toolbar-buttons">
          <button class="btn btn-primary btn-sm" onclick="openAddFaqModal()">+ Add FAQ</button>
          <button class="btn btn-secondary btn-sm" onclick="openAiGenerateFaqsModal()">✨ Generate with AI</button>
        </div>
      </div>

      <!-- Category Filter Pills -->
      <div class="kb-category-pills">
        ${categories.map(cat => {
          const count = cat === 'all' ? faqs.length : faqs.filter(f => (f.category || 'General').toLowerCase() === cat.toLowerCase()).length;
          return `<button class="kb-cat-btn ${KbState.selectedCategory.toLowerCase() === cat.toLowerCase() ? 'active' : ''}" onclick="filterKbCategory('${escapeHtml(cat)}')">${cat === 'all' ? 'All Questions' : escapeHtml(cat)} (${count})</button>`;
        }).join('')}
      </div>

      <!-- FAQ List -->
      <div id="kb-faq-list" class="kb-faq-list">
        ${renderFaqItemsHtml()}
      </div>
    </div>
  `;
}

function renderFaqItemsHtml() {
  const d = KbState.data;
  const faqs = d.faqs || [];
  const query = (KbState.searchQuery || '').toLowerCase().trim();
  const selectedCat = (KbState.selectedCategory || 'all').toLowerCase();

  const filtered = faqs.filter(f => {
    const matchCat = selectedCat === 'all' || (f.category || 'General').toLowerCase() === selectedCat;
    if (!matchCat) return false;
    if (!query) return true;
    const qText = (f.question || '').toLowerCase();
    const aText = (f.answer || '').toLowerCase();
    const tagsText = (f.tags || []).join(' ').toLowerCase();
    return qText.includes(query) || aText.includes(query) || tagsText.includes(query);
  });

  if (filtered.length === 0) {
    return `
      <div class="kb-empty-state">
        <div class="kb-empty-icon">🔍</div>
        <div class="kb-empty-title">No FAQs found</div>
        <div class="kb-empty-desc">${query ? 'No matching questions found for your search.' : 'You have not added any FAQs in this category yet.'}</div>
        <button class="btn btn-secondary btn-sm" onclick="openAddFaqModal()">+ Add an FAQ</button>
      </div>
    `;
  }

  return filtered.map(f => `
    <div class="kb-faq-card ${f.enabled === false ? 'disabled' : ''}" id="faq-card-${f.id}">
      <div class="kb-faq-main">
        <div class="kb-faq-header-line">
          <span class="kb-faq-cat-badge">${escapeHtml(f.category || 'General')}</span>
          <label class="bot-switch" title="Toggle FAQ active/inactive" style="margin-left:auto">
            <input type="checkbox" ${f.enabled !== false ? 'checked' : ''} onchange="toggleFaqActive('${f.id}', this.checked)" />
            <span class="bot-switch-track"></span>
          </label>
        </div>
        <div class="kb-faq-question">${escapeHtml(f.question)}</div>
        <div class="kb-faq-answer">${escapeHtml(f.answer)}</div>
        ${(f.tags && f.tags.length > 0) ? `
          <div class="kb-faq-tags">
            ${f.tags.map(t => `<span class="kb-tag-pill">#${escapeHtml(t)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
      <div class="kb-faq-actions">
        <button class="btn btn-ghost btn-sm" onclick="openEditFaqModal('${f.id}')" title="Edit this FAQ">Edit</button>
        <button class="btn btn-ghost btn-ghost-danger btn-sm" onclick="deleteFaq('${f.id}')" title="Delete this FAQ">Delete</button>
      </div>
    </div>
  `).join('');
}

function renderKbFaqList() {
  const container = document.getElementById('kb-faq-list');
  if (container) container.innerHTML = renderFaqItemsHtml();
}

// 2. Business Facts Tab
function renderFactsTab() {
  const facts = KbState.data.facts || {};

  return `
    <div class="kb-facts-grid">
      <div class="kb-facts-intro">
        <p class="form-hint">
          Provide structured facts about your business. The AI uses these as the foundation of its truth when replying to customer inquiries on WhatsApp and Website chat.
        </p>
      </div>

      <div class="form-group">
        <label class="form-label">🏢 Business Overview &amp; What You Do</label>
        <textarea class="form-textarea" id="kb-fact-summary" rows="3" placeholder="e.g. Radixile is a digital solutions provider creating AI-powered social media and CRM automation for modern agencies." onchange="markKbDirty()">${escapeHtml(facts.business_summary || '')}</textarea>
        <span class="form-hint">A 1-3 sentence summary of who you are, what you do, and who you serve.</span>
      </div>

      <div class="form-group">
        <label class="form-label">📦 Products &amp; Services</label>
        <textarea class="form-textarea" id="kb-fact-products" rows="3" placeholder="e.g. We provide NexaDrip Desktop & Server editions, WhatsApp CRM Bot, Sellbird cold outreach suite, and custom API integrations." onchange="markKbDirty()">${escapeHtml(facts.products_services || '')}</textarea>
        <span class="form-hint">List your key products, packages, or services offered.</span>
      </div>

      <div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="form-group">
          <label class="form-label">💰 Pricing &amp; Payment Options</label>
          <textarea class="form-textarea" id="kb-fact-pricing" rows="3" placeholder="e.g. Plans start from ₹1,499/mo. We accept UPI, Netbanking, Credit Cards, and International Wire." onchange="markKbDirty()">${escapeHtml(facts.pricing_plans || '')}</textarea>
          <span class="form-hint">Rates, subscription models, or quotation rules.</span>
        </div>

        <div class="form-group">
          <label class="form-label">🕒 Operating Hours &amp; Locations</label>
          <textarea class="form-textarea" id="kb-fact-hours" rows="3" placeholder="e.g. Open Monday to Saturday from 9:30 AM to 6:30 PM. Headquarters in Pune, Maharashtra." onchange="markKbDirty()">${escapeHtml(facts.hours_locations || '')}</textarea>
          <span class="form-hint">Working days, timings, physical address, and service cities.</span>
        </div>
      </div>

      <div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="form-group">
          <label class="form-label">🚚 Shipping &amp; Delivery Policies</label>
          <textarea class="form-textarea" id="kb-fact-shipping" rows="3" placeholder="e.g. Software licenses are activated instantly. Physical items delivered within 2-3 business days across India." onchange="markKbDirty()">${escapeHtml(facts.shipping_delivery || '')}</textarea>
          <span class="form-hint">Delivery times, shipping partners, and charges.</span>
        </div>

        <div class="form-group">
          <label class="form-label">🔄 Refunds, Returns &amp; Cancellation</label>
          <textarea class="form-textarea" id="kb-fact-refunds" rows="3" placeholder="e.g. 7-day money-back guarantee if you are not satisfied. Cancellations can be done anytime from the billing tab." onchange="markKbDirty()">${escapeHtml(facts.refunds_returns || '')}</textarea>
          <span class="form-hint">Return window, eligibility, refund policy.</span>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">🚨 Human Support &amp; Escalation</label>
        <textarea class="form-textarea" id="kb-fact-contact" rows="2" placeholder="e.g. For urgent issues, email support@radixile.com or call +91-9876543210. Type 'agent' in chat for immediate handover." onchange="markKbDirty()">${escapeHtml(facts.contact_support || '')}</textarea>
        <span class="form-hint">Emergency contacts, escalation email, phone numbers.</span>
      </div>

      <div style="margin-top:12px;display:flex;justify-content:flex-end">
        <button class="btn btn-primary" onclick="saveActiveKnowledgeBase()">Save Business Facts</button>
      </div>
    </div>
  `;
}

// 3. Persona & Guidelines Tab
function renderPersonaTab() {
  const p = KbState.data.persona || {};

  return `
    <div class="kb-persona-grid">
      <div class="form-group">
        <label class="form-label">🤖 AI Assistant Display Name</label>
        <input type="text" class="form-input" id="kb-persona-name" value="${escapeHtml(p.name || 'Nexus AI Assistant')}" maxlength="80" onchange="markKbDirty()" />
        <span class="form-hint">How the AI introduces itself to visitors.</span>
      </div>

      <div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="form-group">
          <label class="form-label">🗣️ Tone of Voice</label>
          <select class="form-select" id="kb-persona-tone" onchange="markKbDirty()">
            <option value="friendly" ${p.tone === 'friendly' ? 'selected' : ''}>Warm, Friendly &amp; Helpful</option>
            <option value="professional" ${p.tone === 'professional' ? 'selected' : ''}>Executive, Crisp &amp; Professional</option>
            <option value="casual" ${p.tone === 'casual' ? 'selected' : ''}>Casual, Modern &amp; Upbeat</option>
            <option value="concise" ${p.tone === 'concise' ? 'selected' : ''}>Direct, Concise &amp; Minimal</option>
          </select>
          <span class="form-hint">Influences conversational warmth and attitude.</span>
        </div>

        <div class="form-group">
          <label class="form-label">📏 Reply Length</label>
          <select class="form-select" id="kb-persona-length" onchange="markKbDirty()">
            <option value="concise" ${p.response_length === 'concise' ? 'selected' : ''}>Short &amp; Snappy (1-2 sentences)</option>
            <option value="balanced" ${p.response_length === 'balanced' ? 'selected' : ''}>Balanced (2-3 sentences)</option>
            <option value="detailed" ${p.response_length === 'detailed' ? 'selected' : ''}>Detailed (Thorough explanations with points)</option>
          </select>
          <span class="form-hint">Short replies are recommended for WhatsApp chat.</span>
        </div>
      </div>

      <div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="form-group">
          <label class="form-label">🛡️ Fact Grounding Strictness</label>
          <select class="form-select" id="kb-persona-strictness" onchange="markKbDirty()">
            <option value="grounded" ${p.strictness === 'grounded' ? 'selected' : ''}>Strict Grounding (Rely on facts, polite handover if unknown)</option>
            <option value="strict" ${p.strictness === 'strict' ? 'selected' : ''}>Ultra Strict (Never answer anything outside KB facts)</option>
          </select>
          <span class="form-hint">Prevents hallucination and unauthorized claims.</span>
        </div>

        <div class="form-group">
          <label class="form-label">🌐 Language Support</label>
          <select class="form-select" id="kb-persona-language" onchange="markKbDirty()">
            <option value="auto" ${p.language_mode === 'auto' ? 'selected' : ''}>Auto-detect (Reply in customer's language)</option>
            <option value="en" ${p.language_mode === 'en' ? 'selected' : ''}>English Only</option>
            <option value="hi" ${p.language_mode === 'hi' ? 'selected' : ''}>Hindi / Hinglish</option>
          </select>
          <span class="form-hint">AI answers in customer's preferred tongue automatically.</span>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">📝 Custom System Instructions &amp; Rules</label>
        <textarea class="form-textarea" id="kb-persona-instructions" rows="4" placeholder="e.g. Always ask for their phone number if they show high interest. Mention our 10% first-time customer discount. Greet Indian numbers with Namaste." onchange="markKbDirty()">${escapeHtml(p.custom_instructions || '')}</textarea>
        <span class="form-hint">Special instructions to pass into the prompt for fine-grained behavior control.</span>
      </div>

      <div style="margin-top:12px;display:flex;justify-content:flex-end">
        <button class="btn btn-primary" onclick="saveActiveKnowledgeBase()">Save Persona Settings</button>
      </div>
    </div>
  `;
}

// 4. Raw Notes & Documents Tab
function renderDocumentsTab() {
  const d = KbState.data;

  return `
    <div class="kb-docs-container">
      <div class="form-hint" style="margin-bottom:14px">
        Have existing policy docs, price sheets, or rough notes? Paste them below. Click <b>"✨ Clean &amp; Format with AI"</b> to automatically extract structured FAQs and business facts!
      </div>

      <div class="form-group">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <label class="form-label" style="margin-bottom:0">📋 Raw Business Notes / Document Text</label>
          <button class="btn btn-secondary btn-sm" onclick="runAiFormatNotes()" ${KbState.isFormattingNotes ? 'disabled' : ''}>
            ${KbState.isFormattingNotes ? '<span class="spinner sm"></span> Structuring…' : '✨ Clean &amp; Structure with AI'}
          </button>
        </div>
        <textarea class="form-textarea" id="kb-raw-text" rows="12" placeholder="Paste your company policies, FAQs, product sheets, price lists, or raw notes here..." onchange="markKbDirty()">${escapeHtml(d.raw_text || '')}</textarea>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:10px">
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="exportKbFile('json')">Export as JSON</button>
          <button class="btn btn-secondary btn-sm" onclick="exportKbFile('csv')">Export as CSV</button>
        </div>
        <button class="btn btn-primary" onclick="saveActiveKnowledgeBase()">Save Raw Knowledge</button>
      </div>
    </div>
  `;
}

// ── Simulator Chat Renderer ───────────────────────────────────────────────────

function renderSimulatorMessages() {
  return KbState.simChat.map(m => `
    <div class="kb-msg ${m.role}">
      <div class="kb-msg-bubble">
        <div class="kb-msg-text">${escapeHtml(m.text)}</div>
        ${m.role === 'bot' && m.sources && m.sources.length > 0 ? `
          <div class="kb-msg-sources">
            ${m.sources.map(s => `<span class="kb-source-tag">🎯 ${escapeHtml(s.title || s.category || 'Knowledge Base')}</span>`).join('')}
          </div>
        ` : ''}
        ${m.role === 'bot' && m.latency_ms > 0 ? `
          <div class="kb-msg-meta">
            <span>⚡ ${m.latency_ms}ms</span>
            ${m.model ? `<span>• ${escapeHtml(m.model)}</span>` : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function scrollSimulatorToBottom() {
  setTimeout(() => {
    const el = document.getElementById('kb-sim-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }, 20);
}

function clearSimulatorChat() {
  KbState.simChat = [
    { role: 'bot', text: 'Chat history reset. Ask a question to test the knowledge base!', latency_ms: 0, sources: [] }
  ];
  const el = document.getElementById('kb-sim-messages');
  if (el) el.innerHTML = renderSimulatorMessages();
}

async function sendSimPrompt(text) {
  const input = document.getElementById('kb-sim-input');
  if (input) input.value = text;
  await handleSimulatorSubmit(new Event('submit'));
}

async function handleSimulatorSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const input = document.getElementById('kb-sim-input');
  if (!input) return;
  const text = (input.value || '').trim();
  if (!text || KbState.isSimulating) return;

  // Add user message
  KbState.simChat.push({ role: 'user', text });
  input.value = '';
  KbState.isSimulating = true;

  const messagesContainer = document.getElementById('kb-sim-messages');
  if (messagesContainer) {
    messagesContainer.innerHTML = renderSimulatorMessages() + `
      <div class="kb-msg bot kb-typing-msg">
        <div class="kb-msg-bubble">
          <span class="spinner sm"></span> Thinking...
        </div>
      </div>
    `;
    scrollSimulatorToBottom();
  }

  try {
    const history = KbState.simChat.slice(-6).map(m => ({ role: m.role, text: m.text }));
    const modelSel = document.getElementById('kb-sim-model-select');
    const chosenModel = modelSel ? modelSel.value : (KbState.simModel || 'auto');
    const res = await api('POST', '/api/knowledge-base/simulate', {
      message: text,
      history,
      model: chosenModel !== 'auto' ? chosenModel : undefined,
    });

    KbState.simChat.push({
      role: 'bot',
      text: res.reply || 'No answer generated.',
      latency_ms: res.latency_ms || 0,
      model: res.model || '',
      sources: res.matched_sources || [],
    });
  } catch (err) {
    KbState.simChat.push({
      role: 'bot',
      text: `Error simulating response: ${err.message}`,
      latency_ms: 0,
      sources: [],
    });
  } finally {
    KbState.isSimulating = false;
    if (messagesContainer) messagesContainer.innerHTML = renderSimulatorMessages();
    scrollSimulatorToBottom();
    const curInput = document.getElementById('kb-sim-input');
    if (curInput) {
      curInput.disabled = false;
      curInput.focus();
    }
  }
}

// ── State Management & Actions ────────────────────────────────────────────────

function markKbDirty() {
  KbState.dirty = true;
  const btn = document.getElementById('btn-save-kb');
  if (btn) btn.classList.add('pulse-btn');
}

function collectActiveFormData() {
  const current = KbState.data || {};

  // Facts
  const facts = { ...(current.facts || {}) };
  const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : null; };

  if (getVal('kb-fact-summary') !== null) facts.business_summary = getVal('kb-fact-summary');
  if (getVal('kb-fact-products') !== null) facts.products_services = getVal('kb-fact-products');
  if (getVal('kb-fact-pricing') !== null) facts.pricing_plans = getVal('kb-fact-pricing');
  if (getVal('kb-fact-hours') !== null) facts.hours_locations = getVal('kb-fact-hours');
  if (getVal('kb-fact-shipping') !== null) facts.shipping_delivery = getVal('kb-fact-shipping');
  if (getVal('kb-fact-refunds') !== null) facts.refunds_returns = getVal('kb-fact-refunds');
  if (getVal('kb-fact-contact') !== null) facts.contact_support = getVal('kb-fact-contact');

  // Persona
  const persona = { ...(current.persona || {}) };
  if (getVal('kb-persona-name') !== null) persona.name = getVal('kb-persona-name');
  if (getVal('kb-persona-tone') !== null) persona.tone = getVal('kb-persona-tone');
  if (getVal('kb-persona-length') !== null) persona.response_length = getVal('kb-persona-length');
  if (getVal('kb-persona-strictness') !== null) persona.strictness = getVal('kb-persona-strictness');
  if (getVal('kb-persona-language') !== null) persona.language_mode = getVal('kb-persona-language');
  if (getVal('kb-persona-instructions') !== null) persona.custom_instructions = getVal('kb-persona-instructions');

  // Raw Text
  let raw_text = current.raw_text || '';
  if (getVal('kb-raw-text') !== null) raw_text = getVal('kb-raw-text');

  return {
    persona,
    facts,
    faqs: current.faqs || [],
    documents: current.documents || [],
    raw_text,
  };
}

async function saveActiveKnowledgeBase() {
  const btn = document.getElementById('btn-save-kb');
  if (btn) btn.innerHTML = '<span class="spinner sm"></span> Saving…';

  try {
    const payload = collectActiveFormData();
    const updated = await api('POST', '/api/knowledge-base', payload);
    KbState.data = updated;
    KbState.dirty = false;
    toast('Knowledge Base saved & synchronized with WhatsApp & Webchat!', 'success');
    renderAiKnowledgeBase();
  } catch (err) {
    toast(`Failed to save Knowledge Base: ${err.message}`, 'error');
    if (btn) btn.innerHTML = '<span>💾 Save Knowledge Base</span>';
  }
}

// ── FAQ Operations ────────────────────────────────────────────────────────────

function toggleFaqActive(faqId, isChecked) {
  const faqs = KbState.data.faqs || [];
  const item = faqs.find(f => f.id === faqId);
  if (item) {
    item.enabled = isChecked;
    markKbDirty();
    renderKbFaqList();
  }
}

function deleteFaq(faqId) {
  if (!confirm('Are you sure you want to remove this FAQ?')) return;
  KbState.data.faqs = (KbState.data.faqs || []).filter(f => f.id !== faqId);
  markKbDirty();
  renderAiKnowledgeBase();
  toast('FAQ removed.', 'info');
}

function openAddFaqModal() {
  KbState.editingFaq = null;
  renderFaqModal('Add New FAQ');
}

function openEditFaqModal(faqId) {
  const item = (KbState.data.faqs || []).find(f => f.id === faqId);
  if (!item) return;
  KbState.editingFaq = item;
  renderFaqModal('Edit FAQ', item);
}

function closeFaqModal() {
  const modal = document.getElementById('kb-modal-faq');
  if (modal) modal.remove();
}

function renderFaqModal(title, item = {}) {
  closeFaqModal();
  const isEdit = !!item.id;

  const modalHtml = `
    <div class="modal-overlay kb-modal-overlay" id="kb-modal-faq" style="display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);z-index:99999;align-items:center;justify-content:center;padding:16px;box-sizing:border-box" onclick="if(event.target===this)closeFaqModal()">
      <div class="card" style="width:100%;max-width:560px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);overflow:hidden;animation:modalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)" onclick="event.stopPropagation()">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);background:var(--bg2,rgba(0,0,0,0.02))">
          <div class="card-title" style="margin:0;font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px"><span>❓</span> ${title}</div>
          <button class="btn btn-ghost btn-sm" onclick="closeFaqModal()" style="font-size:18px;line-height:1;padding:4px 8px">✕</button>
        </div>
        <form class="card-body" onsubmit="handleSaveFaqModal(event)" style="padding:20px">
          <div class="form-group">
            <label class="form-label">Category</label>
            <input type="text" id="modal-faq-cat" class="form-input" list="kb-cat-suggestions" value="${escapeHtml(item.category || 'General')}" required />
            <datalist id="kb-cat-suggestions">
              <option value="General">
              <option value="Pricing">
              <option value="Products & Services">
              <option value="Delivery & Hours">
              <option value="Returns & Policies">
              <option value="Support">
            </datalist>
          </div>

          <div class="form-group">
            <label class="form-label">Question</label>
            <input type="text" id="modal-faq-q" class="form-input" placeholder="e.g. Do you offer weekend delivery?" value="${escapeHtml(item.question || '')}" required maxlength="300" />
          </div>

          <div class="form-group">
            <label class="form-label">Answer</label>
            <textarea id="modal-faq-a" class="form-textarea" rows="4" placeholder="Clear, factual reply the AI will send..." required maxlength="1500">${escapeHtml(item.answer || '')}</textarea>
          </div>

          <div class="form-group">
            <label class="form-label">Tags / Keywords (comma-separated)</label>
            <input type="text" id="modal-faq-tags" class="form-input" placeholder="weekend, delivery, sunday, saturday" value="${escapeHtml((item.tags || []).join(', '))}" />
            <span class="form-hint">Helps the AI match search queries accurately.</span>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
            <button type="button" class="btn btn-secondary" onclick="closeFaqModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Update FAQ' : 'Add FAQ'}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function handleSaveFaqModal(e) {
  e.preventDefault();
  const cat = document.getElementById('modal-faq-cat')?.value || 'General';
  const q = document.getElementById('modal-faq-q')?.value || '';
  const a = document.getElementById('modal-faq-a')?.value || '';
  const tagsStr = document.getElementById('modal-faq-tags')?.value || '';

  if (!q.trim() || !a.trim()) {
    toast('Please fill in both Question and Answer.', 'error');
    return;
  }

  const tags = tagsStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

  if (KbState.editingFaq && KbState.editingFaq.id) {
    const item = KbState.data.faqs.find(f => f.id === KbState.editingFaq.id);
    if (item) {
      item.category = cat;
      item.question = q;
      item.answer = a;
      item.tags = tags;
    }
  } else {
    KbState.data.faqs = KbState.data.faqs || [];
    KbState.data.faqs.unshift({
      id: `faq_${Date.now()}`,
      category: cat,
      question: q,
      answer: a,
      tags,
      enabled: true,
    });
  }

  closeFaqModal();
  markKbDirty();
  renderAiKnowledgeBase();
  toast(KbState.editingFaq ? 'FAQ updated!' : 'FAQ added!', 'success');
}

// ── AI FAQ Generator Modal ───────────────────────────────────────────────────

function openAiGenerateFaqsModal() {
  closeAiFaqsModal();

  const modalHtml = `
    <div class="modal-overlay kb-modal-overlay" id="kb-modal-ai-faqs" style="display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);z-index:99999;align-items:center;justify-content:center;padding:16px;box-sizing:border-box" onclick="if(event.target===this)closeAiFaqsModal()">
      <div class="card" style="width:100%;max-width:540px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);overflow:hidden;animation:modalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)" onclick="event.stopPropagation()">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);background:var(--bg2,rgba(0,0,0,0.02))">
          <div class="card-title" style="margin:0;font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px"><span>✨</span> AI FAQ Generator</div>
          <button class="btn btn-ghost btn-sm" onclick="closeAiFaqsModal()" style="font-size:18px;line-height:1;padding:4px 8px">✕</button>
        </div>
        <div class="card-body" style="padding:20px">
          <div class="form-hint" style="margin-bottom:14px">
            Specify a topic or service (e.g. "Cake delivery & pricing", "Commercial plumbing services", "Return policy"). AI will draft 3 to 5 realistic customer Q&amp;As.
          </div>
          <div class="form-group">
            <label class="form-label">Topic or Business Focus</label>
            <input type="text" id="ai-faq-topic" class="form-input" placeholder="e.g. Pricing, delivery areas, returns policy" autofocus />
          </div>
          <div class="form-group">
            <label class="form-label">Number of FAQs to generate</label>
            <select class="form-select" id="ai-faq-count">
              <option value="3" selected>3 FAQs</option>
              <option value="5">5 FAQs</option>
            </select>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
            <button class="btn btn-secondary" onclick="closeAiFaqsModal()">Cancel</button>
            <button class="btn btn-primary" id="btn-run-ai-faqs" onclick="executeAiGenerateFaqs()">✨ Generate FAQs</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeAiFaqsModal() {
  const modal = document.getElementById('kb-modal-ai-faqs');
  if (modal) modal.remove();
}

async function executeAiGenerateFaqs() {
  const topic = document.getElementById('ai-faq-topic')?.value || '';
  const count = parseInt(document.getElementById('ai-faq-count')?.value || '3', 10);
  const btn = document.getElementById('btn-run-ai-faqs');
  if (btn) btn.innerHTML = '<span class="spinner sm"></span> Generating…';

  try {
    const res = await api('POST', '/api/knowledge-base/generate-faqs', { topic, count });
    if (res.faqs && res.faqs.length > 0) {
      KbState.data.faqs = KbState.data.faqs || [];
      KbState.data.faqs.unshift(...res.faqs);
      closeAiFaqsModal();
      markKbDirty();
      renderAiKnowledgeBase();
      toast(`Generated ${res.faqs.length} new FAQs! Click "Save" to persist.`, 'success');
    } else {
      toast('Could not generate FAQs for this topic. Try again.', 'error');
    }
  } catch (err) {
    toast(`Generation failed: ${err.message}`, 'error');
  } finally {
    if (btn) btn.innerHTML = '✨ Generate FAQs';
  }
}

// ── AI Clean & Format Notes ───────────────────────────────────────────────────

async function runAiFormatNotes() {
  const rawText = document.getElementById('kb-raw-text')?.value || '';
  if (!rawText.trim()) {
    toast('Please enter some text in the notes area first.', 'error');
    return;
  }

  KbState.isFormattingNotes = true;
  renderAiKnowledgeBase();

  try {
    const res = await api('POST', '/api/knowledge-base/format-notes', { rawText });
    if (res) {
      // Merge structured facts
      const facts = KbState.data.facts || {};
      if (res.business_summary) facts.business_summary = res.business_summary;
      if (res.products_services) facts.products_services = res.products_services;
      if (res.pricing_plans) facts.pricing_plans = res.pricing_plans;
      if (res.hours_locations) facts.hours_locations = res.hours_locations;
      if (res.shipping_delivery) facts.shipping_delivery = res.shipping_delivery;
      if (res.refunds_returns) facts.refunds_returns = res.refunds_returns;
      KbState.data.facts = facts;

      // Append extracted FAQs if any
      if (Array.isArray(res.faqs) && res.faqs.length > 0) {
        const mapped = res.faqs.map((f, i) => ({
          id: `faq_fmt_${Date.now()}_${i}`,
          category: f.category || 'General',
          question: f.question,
          answer: f.answer,
          tags: f.tags || [],
          enabled: true,
        }));
        KbState.data.faqs = KbState.data.faqs || [];
        KbState.data.faqs.unshift(...mapped);
      }

      markKbDirty();
      toast('Notes structured successfully into Facts & FAQs!', 'success');
    }
  } catch (err) {
    toast(`Failed to structure notes: ${err.message}`, 'error');
  } finally {
    KbState.isFormattingNotes = false;
    renderAiKnowledgeBase();
  }
}

// ── Import / Export Operations ────────────────────────────────────────────────

function openImportExportModal() {
  closeImportExportModal();

  const modalHtml = `
    <div class="modal-overlay kb-modal-overlay" id="kb-modal-io" style="display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);z-index:99999;align-items:center;justify-content:center;padding:16px;box-sizing:border-box" onclick="if(event.target===this)closeImportExportModal()">
      <div class="card" style="width:100%;max-width:580px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);overflow:hidden;animation:modalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)" onclick="event.stopPropagation()">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);background:var(--bg2,rgba(0,0,0,0.02))">
          <div class="card-title" style="margin:0;font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px"><span>📥</span> Import / Export Knowledge Base</div>
          <button class="btn btn-ghost btn-sm" onclick="closeImportExportModal()" style="font-size:18px;line-height:1;padding:4px 8px">✕</button>
        </div>
        <div class="card-body" style="padding:20px">
          <div style="margin-bottom:18px">
            <h4 style="font-size:13.5px;font-weight:700;margin:0 0 6px 0;color:var(--text-primary)">📤 Export Knowledge Base</h4>
            <div class="form-hint" style="margin-bottom:10px">Download your complete trained business facts, active FAQs, and persona rules:</div>
            <div style="display:flex;gap:10px">
              <button class="btn btn-secondary btn-sm" onclick="exportKbFile('json')">📥 Download JSON</button>
              <button class="btn btn-secondary btn-sm" onclick="exportKbFile('csv')">📊 Download CSV (FAQs)</button>
            </div>
          </div>

          <hr style="border:0;border-top:1px solid var(--border);margin:18px 0" />

          <div>
            <h4 style="font-size:13.5px;font-weight:700;margin:0 0 6px 0;color:var(--text-primary)">📥 Import FAQs (JSON or CSV)</h4>
            <div class="form-hint" style="margin-bottom:8px">Paste an array of FAQ objects or comma-separated lines (Question, Answer, Category):</div>
            <textarea class="form-textarea" id="kb-import-text" rows="6" placeholder='[{"question": "Do you deliver?", "answer": "Yes, across the city within 2 hours.", "category": "Delivery"}]' style="font-family:monospace;font-size:12px"></textarea>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
              <button class="btn btn-secondary btn-sm" onclick="closeImportExportModal()">Cancel</button>
              <button class="btn btn-primary btn-sm" onclick="executeImportFaqs()">Import FAQs</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeImportExportModal() {
  const modal = document.getElementById('kb-modal-io');
  if (modal) modal.remove();
}

function exportKbFile(format) {
  try {
    const data = KbState.data || {};
    let blob;
    let filename;
    if (format === 'csv') {
      const rows = [['Category', 'Question', 'Answer', 'Tags', 'Enabled']];
      for (const f of data.faqs || []) {
        rows.push([
          `"${(f.category || '').replace(/"/g, '""')}"`,
          `"${(f.question || '').replace(/"/g, '""')}"`,
          `"${(f.answer || '').replace(/"/g, '""')}"`,
          `"${(f.tags || []).join(', ').replace(/"/g, '""')}"`,
          f.enabled !== false ? 'true' : 'false',
        ]);
      }
      blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
      filename = `ai-knowledge-base-faqs-${Date.now()}.csv`;
    } else {
      const payload = {
        exported_at: new Date().toISOString(),
        persona: data.persona,
        facts: data.facts,
        faqs: data.faqs,
        documents: data.documents,
      };
      blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
      filename = `ai-knowledge-base-${Date.now()}.json`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${format.toUpperCase()} successfully!`, 'success');
  } catch (err) {
    window.location.href = `/api/knowledge-base/export?format=${format}`;
  }
}

async function executeImportFaqs() {
  const text = document.getElementById('kb-import-text')?.value || '';
  if (!text.trim()) {
    toast('Please paste JSON or CSV text to import.', 'error');
    return;
  }

  let faqsToImport = [];

  // Try parsing JSON first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      faqsToImport = parsed.map(p => ({
        category: p.category || 'General',
        question: p.question || p.q,
        answer: p.answer || p.a,
        tags: p.tags || [],
      })).filter(f => f.question && f.answer);
    }
  } catch {
    // Parse CSV line by line
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      if (parts.length >= 2) {
        faqsToImport.push({
          category: parts[2] || 'General',
          question: parts[0],
          answer: parts[1],
          tags: [],
        });
      }
    }
  }

  if (faqsToImport.length === 0) {
    toast('No valid FAQs detected in input.', 'error');
    return;
  }

  try {
    const res = await api('POST', '/api/knowledge-base/import', { faqs: faqsToImport, append: true });
    KbState.data = res;
    closeImportExportModal();
    renderAiKnowledgeBase();
    toast(`Successfully imported ${res.imported_count} FAQs!`, 'success');
  } catch (err) {
    toast(`Import failed: ${err.message}`, 'error');
  }
}

// ── Embed Snippet Helper ──────────────────────────────────────────────────────

function copyWebChatSnippet() {
  const d = KbState.data;
  const token = d?.channels?.webchat_token;
  if (!token) {
    navigateTo('leads-settings');
    toast('Please connect your channel in setup first.', 'info');
    return;
  }
  const base = window.location.origin;
  const snippet = `<script src="${base}/webchat-widget.js" data-token="${token}" data-name="${escapeHtml(d.persona?.name || 'Live Support')}" data-color="#15233b"></scr` + `ipt>`;
  navigator.clipboard.writeText(snippet);
  toast('Website Live Chat snippet copied to clipboard!', 'success');
}

// Global window registrations
window.loadAiKnowledgeBase = loadAiKnowledgeBase;
window.switchKbTab = switchKbTab;
window.filterKbCategory = filterKbCategory;
window.handleKbSearch = handleKbSearch;
window.saveActiveKnowledgeBase = saveActiveKnowledgeBase;
window.openAddFaqModal = openAddFaqModal;
window.openEditFaqModal = openEditFaqModal;
window.closeFaqModal = closeFaqModal;
window.handleSaveFaqModal = handleSaveFaqModal;
window.deleteFaq = deleteFaq;
window.toggleFaqActive = toggleFaqActive;
window.openAiGenerateFaqsModal = openAiGenerateFaqsModal;
window.closeAiFaqsModal = closeAiFaqsModal;
window.executeAiGenerateFaqs = executeAiGenerateFaqs;
window.runAiFormatNotes = runAiFormatNotes;
window.openImportExportModal = openImportExportModal;
window.closeImportExportModal = closeImportExportModal;
window.executeImportFaqs = executeImportFaqs;
window.exportKbFile = exportKbFile;
window.clearSimulatorChat = clearSimulatorChat;
window.sendSimPrompt = sendSimPrompt;
window.handleSimulatorSubmit = handleSimulatorSubmit;
window.copyWebChatSnippet = copyWebChatSnippet;
window.markKbDirty = markKbDirty;

if (typeof window !== 'undefined' && !window._kbEscBound) {
  window._kbEscBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeFaqModal();
      closeAiFaqsModal();
      closeImportExportModal();
    }
  });
}

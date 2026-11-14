// Knowledge Base Service for AI Chat (WhatsApp Bot & Website Live-Chat Widget)
// Manages structured FAQs, business facts, persona/tone preferences, raw notes,
// and synchronized compilation to the bot engine.

const aiHelper = require('./aiHelper');
const { brandContext } = require('./brandContext');
const { injectUserKeys } = require('../middleware/auth');
const chatbot = require('./leadPipeline/chatbot');

const now = () => Math.floor(Date.now() / 1000);

const DEFAULT_PERSONA = {
  name: 'Nexus AI Assistant',
  tone: 'friendly',             // 'friendly', 'professional', 'casual', 'concise'
  response_length: 'balanced',   // 'concise' (1-2 sentences), 'balanced' (2-3 sentences), 'detailed'
  strictness: 'grounded',       // 'grounded' (fact-grounded), 'strict' (refuse outside facts)
  custom_instructions: '',
  language_mode: 'auto',        // 'auto', 'en', 'hi', etc.
};

const DEFAULT_FACTS = {
  business_summary: '',
  products_services: '',
  pricing_plans: '',
  hours_locations: '',
  shipping_delivery: '',
  refunds_returns: '',
  contact_support: '',
};

const DEFAULT_FAQS = [
  {
    id: 'faq_default_1',
    category: 'General',
    question: 'What are your working hours and location?',
    answer: 'We are open Monday to Saturday, 9:00 AM to 6:00 PM. Reach out anytime or visit our office during working hours.',
    tags: ['hours', 'location', 'timings', 'address'],
    enabled: true,
  },
  {
    id: 'faq_default_2',
    category: 'Pricing',
    question: 'How much do your services cost?',
    answer: 'Our prices depend on your specific needs and project scope. Contact our team for an exact, transparent quote.',
    tags: ['pricing', 'rates', 'cost', 'fees', 'plans'],
    enabled: true,
  },
  {
    id: 'faq_default_3',
    category: 'Support',
    question: 'How do I talk to a real person?',
    answer: 'Simply reply "agent" or "call me", and a member of our human support team will respond or call you shortly.',
    tags: ['agent', 'human', 'call', 'callback', 'support'],
    enabled: true,
  },
];

// Compile structured knowledge into clean, indexed text for the AI prompt
function compileKnowledge({ persona = {}, facts = {}, faqs = [], documents = [], raw_text = '' }) {
  const parts = [];

  // 1. Business Core Facts
  const factLines = [];
  if (facts.business_summary?.trim()) factLines.push(`• Overview: ${facts.business_summary.trim()}`);
  if (facts.products_services?.trim()) factLines.push(`• Products & Services: ${facts.products_services.trim()}`);
  if (facts.pricing_plans?.trim()) factLines.push(`• Pricing & Payment: ${facts.pricing_plans.trim()}`);
  if (facts.hours_locations?.trim()) factLines.push(`• Hours & Address: ${facts.hours_locations.trim()}`);
  if (facts.shipping_delivery?.trim()) factLines.push(`• Shipping & Delivery: ${facts.shipping_delivery.trim()}`);
  if (facts.refunds_returns?.trim()) factLines.push(`• Returns & Refunds: ${facts.refunds_returns.trim()}`);
  if (facts.contact_support?.trim()) factLines.push(`• Contact & Escalation: ${facts.contact_support.trim()}`);

  if (factLines.length > 0) {
    parts.push(`=== CORE BUSINESS FACTS ===\n${factLines.join('\n')}`);
  }

  // 2. Active FAQs
  const activeFaqs = Array.isArray(faqs) ? faqs.filter(f => f && f.enabled !== false && f.question?.trim() && f.answer?.trim()) : [];
  if (activeFaqs.length > 0) {
    const faqLines = activeFaqs.map(f => {
      const cat = f.category ? `[${f.category}] ` : '';
      return `${cat}Q: ${f.question.trim()}\nA: ${f.answer.trim()}`;
    });
    parts.push(`=== FREQUENTLY ASKED QUESTIONS ===\n${faqLines.join('\n\n')}`);
  }

  // 3. Reference Documents / Snippets
  const activeDocs = Array.isArray(documents) ? documents.filter(d => d && d.title?.trim() && d.content?.trim()) : [];
  if (activeDocs.length > 0) {
    const docLines = activeDocs.map(d => `--- ${d.title.trim()} ---\n${d.content.trim()}`);
    parts.push(`=== REFERENCE DOCUMENTS ===\n${docLines.join('\n\n')}`);
  }

  // 4. Raw Notes
  if (raw_text && raw_text.trim()) {
    parts.push(`=== ADDITIONAL KNOWLEDGE & POLICIES ===\n${raw_text.trim()}`);
  }

  return parts.join('\n\n').slice(0, chatbot.LIMITS.knowledge || 20000);
}

// Ensure table exists safely (defensive for setups without migrations)
async function hasTable(knex) {
  try {
    return await knex.schema.hasTable('ai_knowledge_bases');
  } catch {
    return false;
  }
}

// Retrieve or seed workspace Knowledge Base
async function getKnowledgeBase(knex, workspaceId) {
  const tableReady = await hasTable(knex);
  let row = null;
  if (tableReady) {
    row = await knex('ai_knowledge_bases').where({ workspace_id: workspaceId }).first().catch(() => null);
  }

  let persona = { ...DEFAULT_PERSONA };
  let facts = { ...DEFAULT_FACTS };
  let faqs = [...DEFAULT_FAQS];
  let documents = [];
  let raw_text = '';
  let compiled = '';

  if (row) {
    try { if (row.persona_json) persona = { ...DEFAULT_PERSONA, ...JSON.parse(row.persona_json) }; } catch {}
    try { if (row.facts_json) facts = { ...DEFAULT_FACTS, ...JSON.parse(row.facts_json) }; } catch {}
    try { if (row.faqs_json) faqs = JSON.parse(row.faqs_json); } catch {}
    try { if (row.documents_json) documents = JSON.parse(row.documents_json); } catch {}
    raw_text = row.raw_text || '';
    compiled = row.compiled_knowledge || compileKnowledge({ persona, facts, faqs, documents, raw_text });
  } else {
    // Check if WhatsApp bot settings already had some knowledge text
    try {
      const botSettings = await chatbot.getSettings(knex, workspaceId);
      const existingKb = botSettings?.config?.knowledge;
      if (existingKb && existingKb.trim()) {
        facts.business_summary = existingKb.trim();
        raw_text = existingKb.trim();
      }
    } catch {}

    // Pull company name from brand profile if available
    try {
      const brand = await require('./brand').profile(workspaceId, knex);
      if (brand?.company_name) {
        persona.name = `${brand.company_name} AI Assistant`;
        if (!facts.business_summary && brand.tagline) {
          facts.business_summary = `${brand.company_name} — ${brand.tagline}`;
        }
      }
    } catch {}

    compiled = compileKnowledge({ persona, facts, faqs, documents, raw_text });
  }

  // Channel & connection status
  let whatsapp_connected = false;
  let webchat_token = null;
  let bot_enabled = false;
  try {
    const leadConfig = await knex('meta_lead_configs').where({ workspace_id: workspaceId }).first().catch(() => null);
    if (leadConfig) {
      webchat_token = leadConfig.webchat_token || null;
      whatsapp_connected = !!(leadConfig.whatsapp_phone_number_id || leadConfig.evolution_status === 'open');
    }
    const bRow = await knex('whatsapp_bot_settings').where({ workspace_id: workspaceId }).first().catch(() => null);
    if (bRow) bot_enabled = !!bRow.enabled;
  } catch {}

  const totalFaqs = Array.isArray(faqs) ? faqs.length : 0;
  const activeFaqs = Array.isArray(faqs) ? faqs.filter(f => f && f.enabled !== false).length : 0;
  const categories = [...new Set((faqs || []).map(f => f.category || 'General').filter(Boolean))];

  return {
    workspace_id: workspaceId,
    persona,
    facts,
    faqs,
    documents,
    raw_text,
    compiled_knowledge: compiled,
    stats: {
      total_faqs: totalFaqs,
      active_faqs: activeFaqs,
      categories_count: categories.length,
      categories,
      char_count: compiled.length,
      max_chars: chatbot.LIMITS.knowledge || 20000,
    },
    channels: {
      whatsapp_connected,
      bot_enabled,
      webchat_token,
      webchat_widget_url: webchat_token ? `/test-chat.html` : null,
    },
    updated_at: row?.updated_at || now(),
    updated_by: row?.updated_by || null,
  };
}

// Save & synchronize knowledge base across workspace and bot settings
async function saveKnowledgeBase(knex, workspaceId, userId, payload = {}) {
  const persona = {
    name: String(payload.persona?.name || DEFAULT_PERSONA.name).trim().slice(0, 100),
    tone: ['friendly', 'professional', 'casual', 'concise'].includes(payload.persona?.tone) ? payload.persona.tone : 'friendly',
    response_length: ['concise', 'balanced', 'detailed'].includes(payload.persona?.response_length) ? payload.persona.response_length : 'balanced',
    strictness: ['grounded', 'strict'].includes(payload.persona?.strictness) ? payload.persona.strictness : 'grounded',
    custom_instructions: String(payload.persona?.custom_instructions || '').trim().slice(0, 2000),
    language_mode: String(payload.persona?.language_mode || 'auto').trim().slice(0, 20),
  };

  const facts = {
    business_summary: String(payload.facts?.business_summary || '').trim().slice(0, 3000),
    products_services: String(payload.facts?.products_services || '').trim().slice(0, 3000),
    pricing_plans: String(payload.facts?.pricing_plans || '').trim().slice(0, 2000),
    hours_locations: String(payload.facts?.hours_locations || '').trim().slice(0, 2000),
    shipping_delivery: String(payload.facts?.shipping_delivery || '').trim().slice(0, 2000),
    refunds_returns: String(payload.facts?.refunds_returns || '').trim().slice(0, 2000),
    contact_support: String(payload.facts?.contact_support || '').trim().slice(0, 2000),
  };

  const faqs = (Array.isArray(payload.faqs) ? payload.faqs : []).slice(0, 100).map((f, idx) => ({
    id: f.id || `faq_${Date.now()}_${idx}`,
    category: String(f.category || 'General').trim().slice(0, 50),
    question: String(f.question || '').trim().slice(0, 500),
    answer: String(f.answer || '').trim().slice(0, 2000),
    tags: Array.isArray(f.tags) ? f.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 10) : [],
    enabled: f.enabled !== false,
  })).filter(f => f.question && f.answer);

  const documents = (Array.isArray(payload.documents) ? payload.documents : []).slice(0, 20).map((d, idx) => ({
    id: d.id || `doc_${Date.now()}_${idx}`,
    title: String(d.title || 'Untitled Document').trim().slice(0, 100),
    content: String(d.content || '').trim().slice(0, 5000),
    updated_at: now(),
  })).filter(d => d.content);

  const raw_text = String(payload.raw_text || '').trim().slice(0, 10000);
  const compiled_knowledge = compileKnowledge({ persona, facts, faqs, documents, raw_text });

  const tableReady = await hasTable(knex);
  if (tableReady) {
    const existing = await knex('ai_knowledge_bases').where({ workspace_id: workspaceId }).first('id').catch(() => null);
    const dbPayload = {
      persona_json: JSON.stringify(persona),
      facts_json: JSON.stringify(facts),
      faqs_json: JSON.stringify(faqs),
      documents_json: JSON.stringify(documents),
      raw_text,
      compiled_knowledge,
      updated_by: userId || null,
      updated_at: now(),
    };

    if (existing) {
      await knex('ai_knowledge_bases').where({ id: existing.id }).update(dbPayload);
    } else {
      await knex('ai_knowledge_bases').insert({
        workspace_id: workspaceId,
        created_at: now(),
        ...dbPayload,
      });
    }
  }

  // Synchronize compiled knowledge into whatsapp_bot_settings.config_json
  try {
    const botRow = await knex('whatsapp_bot_settings').where({ workspace_id: workspaceId }).first().catch(() => null);
    let botConfig = {};
    if (botRow?.config_json) {
      try { botConfig = JSON.parse(botRow.config_json); } catch {}
    } else {
      botConfig = { ...chatbot.DEFAULT_CONFIG };
    }

    botConfig.knowledge = compiled_knowledge.slice(0, chatbot.LIMITS.knowledge || 20000);
    // Auto-enable AI answer mode for unknown/open-ended questions so the bot uses the knowledge base
    if (!botConfig.fallback || botConfig.fallback.mode === 'message') {
      botConfig.fallback = { mode: 'ai', text: botConfig.fallback?.text || 'Thanks! Someone from our team will reply soon.' };
    }
    const norm = chatbot.normalizeConfig(botConfig);

    const bPayload = {
      enabled: botRow ? botRow.enabled : false,
      config_json: JSON.stringify(norm),
      updated_by: userId || (botRow ? botRow.updated_by : null),
      updated_at: now(),
    };

    if (botRow) {
      await knex('whatsapp_bot_settings').where({ id: botRow.id }).update(bPayload);
    } else {
      await knex('whatsapp_bot_settings').insert({
        workspace_id: workspaceId,
        ...bPayload,
      });
    }
  } catch (err) {
    console.warn('[KnowledgeBase] Could not sync to whatsapp_bot_settings:', err.message);
  }

  return getKnowledgeBase(knex, workspaceId);
}

// Live interactive chat simulator
async function simulateChat(knex, workspaceId, userId, { message = '', visitorName = 'Customer', history = [], model = null } = {}) {
  const startTime = Date.now();
  const kb = await getKnowledgeBase(knex, workspaceId);
  const persona = kb.persona || DEFAULT_PERSONA;
  const brand = await require('./brand').profile(workspaceId, knex).catch(() => ({}));

  // Identify matching sources
  const qClean = String(message || '').toLowerCase();
  const matchedSources = [];

  for (const f of kb.faqs || []) {
    if (!f.enabled) continue;
    const matchQ = f.question.toLowerCase();
    const matchTags = (f.tags || []).some(t => qClean.includes(t.toLowerCase()));
    if (qClean.includes(matchQ) || matchQ.includes(qClean) || matchTags) {
      matchedSources.push({ type: 'faq', title: `FAQ: ${f.question}`, category: f.category });
    }
  }

  if (kb.facts.pricing_plans && (qClean.includes('price') || qClean.includes('cost') || qClean.includes('rate') || qClean.includes('charges'))) {
    matchedSources.push({ type: 'fact', title: 'Pricing & Plans' });
  }
  if (kb.facts.hours_locations && (qClean.includes('hour') || qClean.includes('open') || qClean.includes('time') || qClean.includes('address') || qClean.includes('location'))) {
    matchedSources.push({ type: 'fact', title: 'Hours & Locations' });
  }
  if (kb.facts.refunds_returns && (qClean.includes('return') || qClean.includes('refund') || qClean.includes('cancel'))) {
    matchedSources.push({ type: 'fact', title: 'Returns & Refunds' });
  }

  // Obtain user's AI API keys
  const req = { session: { userId }, body: { model } };
  await new Promise((resolve) => injectUserKeys(req, null, () => resolve()));
  const { apiKey, options } = aiHelper.aiArgsFromReq(req);

  const lengthInstructions = {
    concise: 'Answer in 1 or 2 concise, direct sentences.',
    balanced: 'Answer in 2 or 3 clear sentences.',
    detailed: 'Provide a thorough, structured, and helpful explanation (3 to 5 sentences or bullet points).',
  }[persona.response_length] || 'Answer in 2 or 3 sentences.';

  const toneInstructions = {
    friendly: 'Tone: Warm, welcoming, helpful and polite.',
    professional: 'Tone: Crisp, executive, polite, and strictly professional.',
    casual: 'Tone: Conversational, upbeat and friendly.',
    concise: 'Tone: Direct, factual, and minimal.',
  }[persona.tone] || 'Tone: Helpful and polite.';

  const strictnessRule = persona.strictness === 'strict'
    ? 'CRITICAL RULE: Rely EXCLUSIVELY on the business knowledge provided below. If the exact answer is not in the knowledge base, state politely that our team will assist them directly. Do NOT assume, estimate, or extrapolate any information.'
    : 'CRITICAL RULE: Use the business knowledge below as your primary source of truth. If unsure, invite the customer to connect with our staff. Never invent prices or fake guarantees.';

  const historyLines = (Array.isArray(history) ? history.slice(-6) : []).map(h => `${h.role === 'user' ? 'Customer' : 'Assistant'}: ${h.text}`).join('\n');

  const prompt = `${await brandContext(workspaceId, knex)}
You are ${persona.name || 'AI Assistant'}, representing ${brand.company_name || 'this business'}.
${toneInstructions}
${lengthInstructions}
${strictnessRule}
${persona.custom_instructions ? `SPECIAL INSTRUCTIONS:\n${persona.custom_instructions}\n` : ''}

=== BUSINESS KNOWLEDGE BASE ===
${kb.compiled_knowledge || 'No business knowledge entered yet.'}

${historyLines ? `=== RECENT CONVERSATION ===\n${historyLines}\n` : ''}
Customer (${visitorName}): """${String(message).slice(0, 1000)}"""
${persona.name || 'Assistant'}:`;

  let replyText = '';
  const chosenModel = model || options?.defaultTextModel || null;
  const modelOverride = chosenModel && chosenModel !== 'auto' && chosenModel !== 'default' ? chosenModel : null;
  let modelUsed = modelOverride || options?.ollamaModel || 'default-ai';

  try {
    const res = await aiHelper.aiGenerate(prompt, apiKey, 350, modelOverride, options);
    replyText = String(res.text || '').trim().replace(/^["“]|["”]$/g, '');
    if (res.model) modelUsed = res.model;
  } catch (err) {
    // If AI generation failed (e.g. no key or provider issue), give intelligent fallback
    console.warn('[KnowledgeBase Simulator] AI generation note:', err.message);
    if (matchedSources.length > 0 && matchedSources[0].type === 'faq') {
      const topFaq = kb.faqs.find(f => f.question && matchedSources[0].title.includes(f.question));
      if (topFaq) replyText = topFaq.answer;
    }
    if (!replyText) {
      replyText = `Thank you for reaching out! Regarding "${message}", our team is pleased to help. Please leave your details or ask any other questions. (Note: ${err.message || 'AI service unavailable'})`;
    }
  }

  const latencyMs = Date.now() - startTime;

  return {
    reply: replyText,
    matched_sources: matchedSources,
    model: modelUsed,
    latency_ms: latencyMs,
    persona_name: persona.name,
  };
}

// AI-powered FAQ generation
async function aiGenerateFaqs(knex, workspaceId, userId, { topic = '', count = 3, existingText = '' } = {}) {
  const brand = await require('./brand').profile(workspaceId, knex).catch(() => ({}));
  const req = { session: { userId }, body: {} };
  await new Promise((resolve) => injectUserKeys(req, null, () => resolve()));
  const { apiKey, options } = aiHelper.aiArgsFromReq(req);

  const prompt = `You are an expert customer support specialist for ${brand.company_name || 'a modern business'}.
${brand.company_name ? `Company: ${brand.company_name}` : ''}
${brand.tagline ? `Tagline: ${brand.tagline}` : ''}
${topic ? `Topic / Focus: ${topic}` : ''}
${existingText ? `Context details: ${existingText.slice(0, 1500)}` : ''}

Generate exactly ${Math.min(count || 3, 6)} practical, realistic customer FAQs for an AI chatbot.
Categories should be chosen from: "General", "Pricing", "Products & Services", "Delivery & Hours", "Returns & Policies", "Support".

Return ONLY a valid JSON array of objects with no markdown backticks, no comments, conforming to:
[
  {
    "category": "Pricing",
    "question": "What is the typical cost?",
    "answer": "Our prices start from...",
    "tags": ["cost", "price", "rates"]
  }
]`;

  try {
    const res = await aiHelper.aiGenerate(prompt, apiKey, 800, null, options);
    let clean = String(res.text || '').trim();
    clean = clean.replace(/^```(json)?/i, '').replace(/```$/g, '').trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) {
      return parsed.map((item, idx) => ({
        id: `faq_gen_${Date.now()}_${idx}`,
        category: String(item.category || 'General').trim(),
        question: String(item.question || '').trim(),
        answer: String(item.answer || '').trim(),
        tags: Array.isArray(item.tags) ? item.tags.map(t => String(t).trim().toLowerCase()) : [],
        enabled: true,
      })).filter(f => f.question && f.answer);
    }
  } catch (err) {
    console.warn('[KnowledgeBase] AI FAQ generation fallback:', err.message);
  }

  // Graceful rule-based fallback if AI is unconfigured or rate limited
  const safeTopic = topic ? topic.charAt(0).toUpperCase() + topic.slice(1) : 'Services';
  return [
    {
      id: `faq_gen_${Date.now()}_1`,
      category: 'General',
      question: `What should I know about your ${safeTopic}?`,
      answer: `Our ${safeTopic} are tailored to provide high reliability, quality, and complete customer satisfaction. Contact us for specifics!`,
      tags: [safeTopic.toLowerCase(), 'info', 'details'],
      enabled: true,
    },
    {
      id: `faq_gen_${Date.now()}_2`,
      category: 'Pricing',
      question: `How are ${safeTopic} priced?`,
      answer: `We provide clear, competitive quotes without hidden charges. Speak with our team for an estimate.`,
      tags: [safeTopic.toLowerCase(), 'rates', 'pricing', 'quote'],
      enabled: true,
    },
    {
      id: `faq_gen_${Date.now()}_3`,
      category: 'Support',
      question: `How quickly can I get assistance with ${safeTopic}?`,
      answer: `Our support team is available during standard business hours to answer questions and schedule callbacks.`,
      tags: [safeTopic.toLowerCase(), 'support', 'help', 'timing'],
      enabled: true,
    },
  ];
}

// AI-powered text notes cleanup & structuring
async function aiFormatNotes(knex, workspaceId, userId, { rawText = '' } = {}) {
  if (!rawText || !rawText.trim()) return { facts: {}, faqs: [] };

  const req = { session: { userId }, body: {} };
  await new Promise((resolve) => injectUserKeys(req, null, () => resolve()));
  const { apiKey, options } = aiHelper.aiArgsFromReq(req);

  const prompt = `Convert the following raw business notes into structured facts and FAQs for a chatbot knowledge base.
RAW NOTES:
"""${rawText.slice(0, 3000)}"""

Respond ONLY with a JSON object in this exact schema, without backticks or markdown:
{
  "business_summary": "1-2 sentence company summary",
  "products_services": "list of products or services offered",
  "pricing_plans": "pricing, fees, rates or payment details",
  "hours_locations": "hours of operation, address or service areas",
  "shipping_delivery": "shipping or delivery details",
  "refunds_returns": "return or refund policies",
  "faqs": [
    {
      "category": "General",
      "question": "Question here?",
      "answer": "Clear answer here.",
      "tags": ["tag1", "tag2"]
    }
  ]
}`;

  try {
    const res = await aiHelper.aiGenerate(prompt, apiKey, 1000, null, options);
    let clean = String(res.text || '').trim();
    clean = clean.replace(/^```(json)?/i, '').replace(/```$/g, '').trim();
    const parsed = JSON.parse(clean);
    return parsed;
  } catch (err) {
    console.warn('[KnowledgeBase] AI Format Notes fallback:', err.message);
    return {
      business_summary: rawText.slice(0, 200),
      products_services: '',
      pricing_plans: '',
      hours_locations: '',
      shipping_delivery: '',
      refunds_returns: '',
      faqs: [],
    };
  }
}

module.exports = {
  DEFAULT_PERSONA,
  DEFAULT_FACTS,
  DEFAULT_FAQS,
  compileKnowledge,
  getKnowledgeBase,
  saveKnowledgeBase,
  simulateChat,
  aiGenerateFaqs,
  aiFormatNotes,
};

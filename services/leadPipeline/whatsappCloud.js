// services/leadPipeline/whatsappCloud.js
// Official Meta WhatsApp Business Cloud API Client for Social-Nexus.
// Supports direct messaging, utility templates, 2-Step PIN registration, profile updates, and OBA verification audit.

const axios = require('axios');

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// No built-in account: every business uses its own number and account (WhatsApp → Setup).
// Kept as exports for older callers; empty on purpose.
const DEFAULT_PHONE_NUMBER_ID = '';
const DEFAULT_WABA_ID = '';
const DEFAULT_TEST_RECIPIENT = '';

// Supported template language codes for Meta WhatsApp Cloud API
const SUPPORTED_LANGUAGE_CODES = [
  'en_US', 'en', 'en_GB',
  'hi', 'mr', 'gu', 'ta', 'te', 'bn', 'kn', 'ml', 'pa', 'ur',
  'es', 'es_ES', 'es_LA',
  'pt_BR', 'pt_PT',
  'fr', 'de', 'ar', 'id',
];

// In-memory cache for live synced message templates
const templateCache = new Map(); // wabaId -> { timestamp, templates: [] }
const TEMPLATE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Normalize language code to Meta Graph API standard format
 * Handles en-US -> en_US, hi-IN -> hi, mr-IN -> mr, etc.
 */
function normalizeLanguageCode(code) {
  if (!code) return 'en_US';
  const str = String(code).trim().replace(/-/g, '_');
  const lower = str.toLowerCase();

  const standardMap = {
    en: 'en',
    en_us: 'en_US',
    en_gb: 'en_GB',
    hi: 'hi',
    hi_in: 'hi',
    mr: 'mr',
    mr_in: 'mr',
    gu: 'gu',
    gu_in: 'gu',
    ta: 'ta',
    ta_in: 'ta',
    te: 'te',
    te_in: 'te',
    bn: 'bn',
    bn_in: 'bn',
    kn: 'kn',
    kn_in: 'kn',
    ml: 'ml',
    ml_in: 'ml',
    pa: 'pa',
    pa_in: 'pa',
    ur: 'ur',
    ur_in: 'ur',
    es: 'es',
    es_es: 'es_ES',
    es_la: 'es_LA',
    pt_br: 'pt_BR',
    pt_pt: 'pt_PT',
    fr: 'fr',
    de: 'de',
    ar: 'ar',
    id: 'id',
  };

  if (standardMap[lower]) {
    return standardMap[lower];
  }

  // Format aa_BB if 2 lowercase + 2 uppercase
  if (/^[a-z]{2}_[a-z]{2}$/i.test(str)) {
    const parts = str.split('_');
    return `${parts[0].toLowerCase()}_${parts[1].toUpperCase()}`;
  }

  return str;
}

/**
 * Format raw parameter values into Meta component parameter objects
 */
function formatComponentParameters(params) {
  if (!params) return [];
  if (Array.isArray(params)) {
    return params.map((p) => {
      if (p && typeof p === 'object' && p.type) {
        return p;
      }
      return { type: 'text', text: String(p ?? '') };
    });
  }

  if (typeof params === 'object') {
    // If keyed by numeric index ('1', '2') or named keys
    const keys = Object.keys(params);
    const allNumeric = keys.every((k) => /^\d+$/.test(k));
    if (allNumeric) {
      keys.sort((a, b) => Number(a) - Number(b));
    }
    return keys.map((k) => {
      const val = params[k];
      if (val && typeof val === 'object' && val.type) return val;
      return { type: 'text', text: String(val ?? '') };
    });
  }

  return [{ type: 'text', text: String(params) }];
}

/**
 * Build compliant Meta template components for body variables ({{1}}, {{2}})
 * Supports templateComponents array, templateParams array, or { body: [...], header: [...] }
 */
function buildTemplateComponents({ templateComponents, templateParams }) {
  if (templateComponents && Array.isArray(templateComponents) && templateComponents.length) {
    return templateComponents.map((c) => ({
      ...c,
      type: String(c.type || 'body').toLowerCase(),
      parameters: formatComponentParameters(c.parameters || []),
    }));
  }

  if (templateParams) {
    if (!Array.isArray(templateParams) && typeof templateParams === 'object' && (templateParams.body || templateParams.header)) {
      const components = [];
      if (templateParams.header) {
        components.push({
          type: 'header',
          parameters: formatComponentParameters(templateParams.header),
        });
      }
      if (templateParams.body) {
        components.push({
          type: 'body',
          parameters: formatComponentParameters(templateParams.body),
        });
      }
      return components;
    }

    const params = formatComponentParameters(templateParams);
    if (params.length) {
      return [
        {
          type: 'body',
          parameters: params,
        },
      ];
    }
  }

  return undefined;
}

/**
 * Auto-fill and build compliant Meta template components matching template schema.
 * Reconciles both positional ({{1}}, {{2}}) and named ({{param_name}}) parameters
 * across both HEADER and BODY components, using example values or clean test defaults.
 */
function autoFillTemplateComponents(tmplDef, { templateComponents, templateParams } = {}) {
  // If caller explicitly passed templateComponents array with non-empty parameters, respect it
  if (templateComponents && Array.isArray(templateComponents) && templateComponents.length) {
    const hasAnyParams = templateComponents.some((c) => Array.isArray(c.parameters) && c.parameters.length);
    if (hasAnyParams) {
      return templateComponents.map((c) => ({
        ...c,
        type: String(c.type || 'body').toLowerCase(),
        parameters: formatComponentParameters(c.parameters || []),
      }));
    }
  }

  if (!tmplDef || !tmplDef.components) {
    return buildTemplateComponents({ templateComponents, templateParams });
  }

  const rawComps = tmplDef.components || [];
  const headerComp = rawComps.find((c) => String(c.type).toUpperCase() === 'HEADER');
  const bodyComp = rawComps.find((c) => String(c.type).toUpperCase() === 'BODY');

  const components = [];

  // 1. Process HEADER component if format is TEXT and contains variables
  if (headerComp && String(headerComp.format || '').toUpperCase() === 'TEXT') {
    const namedHeader = headerComp.example?.header_text_named_params || [];
    const namedMatches = (headerComp.text || '').match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g) || [];
    const positionalMatches = (headerComp.text || '').match(/\{\{\d+\}\}/g) || [];

    if (namedHeader.length || namedMatches.length) {
      const list = namedHeader.length ? namedHeader : namedMatches;
      const params = list.map((np) => {
        const paramName = np.param_name || String(np).replace(/[\{\}]/g, '');
        const val =
          (templateParams && typeof templateParams === 'object' && !Array.isArray(templateParams) && templateParams[paramName]) ||
          np.example ||
          'Social-Nexus';
        return { type: 'text', parameter_name: paramName, text: String(val) };
      });
      components.push({ type: 'header', parameters: params });
    } else if (positionalMatches.length) {
      const userHeaderParams =
        templateParams && typeof templateParams === 'object' && templateParams.header
          ? (Array.isArray(templateParams.header) ? templateParams.header : [templateParams.header])
          : [];
      const examples = headerComp.example?.header_text || [];
      const params = positionalMatches.map((_, idx) => {
        const val = userHeaderParams[idx] || examples[idx] || 'Social-Nexus';
        return { type: 'text', text: String(val) };
      });
      components.push({ type: 'header', parameters: params });
    }
  }

  // 2. Process BODY component
  if (bodyComp) {
    const namedBody = bodyComp.example?.body_text_named_params || [];
    const namedMatches = (bodyComp.text || '').match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g) || [];
    const positionalMatches = (bodyComp.text || '').match(/\{\{\d+\}\}/g) || [];

    if (namedBody.length || namedMatches.length) {
      const list = namedBody.length ? namedBody : namedMatches;
      const params = list.map((np, idx) => {
        const paramName = np.param_name || String(np).replace(/[\{\}]/g, '');
        const val =
          (templateParams && typeof templateParams === 'object' && !Array.isArray(templateParams) && templateParams[paramName]) ||
          np.example ||
          (templateParams && Array.isArray(templateParams) ? templateParams[idx] : null) ||
          'Notice';
        return { type: 'text', parameter_name: paramName, text: String(val) };
      });
      components.push({ type: 'body', parameters: params });
    } else if (positionalMatches.length) {
      const userBodyParams =
        (Array.isArray(templateParams) ? templateParams : (templateParams?.body || []));
      const examples = (bodyComp.example?.body_text?.[0]) || [];
      const defaultFallbacks = ['Society Admin', '173121', '4950.00', 'Account Update', 'Verified'];

      const params = positionalMatches.map((_, idx) => {
        const userVal = userBodyParams[idx];
        const valText =
          userVal && typeof userVal === 'object' && userVal.text !== undefined
            ? userVal.text
            : userVal !== undefined && userVal !== null
            ? String(userVal)
            : examples[idx] || defaultFallbacks[idx] || `Param${idx + 1}`;
        return { type: 'text', text: String(valText) };
      });
      components.push({ type: 'body', parameters: params });
    }
  }

  return components.length ? components : buildTemplateComponents({ templateComponents, templateParams });
}

/**
 * Clear cached message templates for a given WABA
 */
function clearTemplateCache(wabaId = DEFAULT_WABA_ID) {
  templateCache.delete(wabaId);
}

/**
 * Fetch approved WhatsApp Message Templates from Meta Graph API v21.0
 * GET https://graph.facebook.com/v21.0/{WABA_ID}/message_templates
 */
async function getMessageTemplates(wabaId = DEFAULT_WABA_ID, accessToken, options = {}) {
  if (!accessToken) {
    return { success: false, templates: [], error: 'Meta Access Token is missing' };
  }

  const { forceRefresh = false } = options;
  if (!forceRefresh && templateCache.has(wabaId)) {
    const cached = templateCache.get(wabaId);
    if (Date.now() - cached.timestamp < TEMPLATE_CACHE_TTL) {
      return {
        success: true,
        count: cached.templates.length,
        templates: cached.templates,
        cached: true,
      };
    }
  }

  // Only this business's own account (other businesses' IDs used to be tried too,
  // which hid "wrong account ID" errors)
  if (!wabaId) return { success: false, templates: [], error: 'Add your WhatsApp Business Account ID in WhatsApp → Setup.' };
  const candidateWabas = [wabaId];
  let lastError = null;

  for (const candWaba of candidateWabas) {
    try {
      const endpoint = `${GRAPH_BASE_URL}/${candWaba}/message_templates?fields=name,status,category,language,components,quality_score,rejected_reason&limit=200`;
      const res = await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });

      const rawTemplates = res.data?.data || [];
      const templates = rawTemplates.map((t) => {
        const bodyComp = (t.components || []).find((c) => String(c.type).toUpperCase() === 'BODY') || {};
        const headerComp = (t.components || []).find((c) => String(c.type).toUpperCase() === 'HEADER') || {};
        const buttonsComp = (t.components || []).find((c) => String(c.type).toUpperCase() === 'BUTTONS') || {};
        const variableMatches = (bodyComp.text || '').match(/\{\{\d+\}\}/g) || [];

        return {
          id: t.id,
          name: t.name,
          status: t.status, // APPROVED, PENDING, REJECTED, PAUSED
          category: t.category, // MARKETING, UTILITY, AUTHENTICATION
          language: t.language, // e.g. en, en_US, hi, mr
          body_text: bodyComp.text || '',
          header_text: headerComp.text || '',
          has_variables: variableMatches.length > 0,
          variable_count: variableMatches.length,
          variable_placeholders: variableMatches,
          quality_score: t.quality_score?.score || 'UNKNOWN',
          rejected_reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
          footer_text: ((t.components || []).find((c) => String(c.type).toUpperCase() === 'FOOTER') || {}).text || '',
          buttons: (buttonsComp.buttons || []).map((b) => ({ type: b.type, text: b.text, url: b.url, phone_number: b.phone_number })),
          components: t.components,
        };
      });

      templateCache.set(wabaId, { timestamp: Date.now(), templates });
      if (candWaba !== wabaId) {
        templateCache.set(candWaba, { timestamp: Date.now(), templates });
      }

      return {
        success: true,
        count: templates.length,
        templates,
        waba_id: candWaba,
      };
    } catch (err) {
      lastError = err.response?.data?.error?.message || err.message;
    }
  }

  return {
    success: false,
    templates: [],
    error: lastError || 'Failed to fetch templates',
  };
}

/**
 * Send an official WhatsApp Cloud API message
 * Features self-healing fallback for Meta Error #132001 ("Template name does not exist in the translation")
 */
async function sendWhatsAppMessage({
  phoneNumberId = DEFAULT_PHONE_NUMBER_ID,
  wabaId = DEFAULT_WABA_ID,
  accessToken,
  to = DEFAULT_TEST_RECIPIENT,
  text,
  templateName,
  languageCode = 'en_US',
  templateComponents,
  templateParams,
}) {
  const cleanTo = String(to).replace(/[^0-9]/g, '');

  if (!accessToken) {
    const bridgeUrl = `https://wa.me/${cleanTo}?text=${encodeURIComponent(text || 'Hello!')}`;
    return {
      success: false,
      mode: 'token_missing',
      recipient: cleanTo,
      bridge_url: bridgeUrl,
      error: 'WhatsApp Cloud API Access Token is not configured. Please paste your Meta Permanent Access Token in WhatsApp Settings to enable direct cloud dispatch.',
      message: 'WhatsApp Access Token missing — fallback WhatsApp Web bridge prepared.',
    };
  }

  if (!phoneNumberId) {
    return { success: false, mode: 'not_configured', recipient: cleanTo, error: 'Add your Phone number ID in WhatsApp → Setup.' };
  }
  if (!cleanTo) return { success: false, mode: 'no_recipient', error: 'Type the WhatsApp number to send to.' };

  const endpoint = `${GRAPH_BASE_URL}/${phoneNumberId}/messages`;
  let currentLang = normalizeLanguageCode(languageCode);

  // Meta official sample template hello_world is strictly registered under en_US and has no body components
  let matchedTemplate = null;
  if (templateName === 'hello_world') {
    currentLang = 'en_US';
  } else if (templateName && templateCache.has(wabaId)) {
    // If we have cached templates for this WABA, check if there's an approved translation
    const cached = templateCache.get(wabaId)?.templates || [];
    const matches = cached.filter((t) => t.name.toLowerCase() === templateName.toLowerCase() && t.status === 'APPROVED');
    if (matches.length > 0) {
      matchedTemplate = matches.find((m) => m.language === currentLang) || matches[0];
      if (matchedTemplate && matchedTemplate.language !== currentLang) {
        // Automatically adopt the approved translation language to preempt #132001
        currentLang = matchedTemplate.language;
      }
    }
  }

  const buildPayload = (lang) => {
    if (templateName) {
      let components;
      if (templateName === 'hello_world') {
        components = undefined;
      } else if (matchedTemplate) {
        components = autoFillTemplateComponents(matchedTemplate, { templateComponents, templateParams });
      } else {
        components = buildTemplateComponents({ templateComponents, templateParams });
      }

      const p = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'template',
        template: {
          name: templateName,
          language: { code: lang },
        },
      };

      if (components && components.length) {
        p.template.components = components;
      }
      return p;
    }

    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'text',
      text: {
        preview_url: false,
        body: text || 'Hello!',
      },
    };
  };

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  try {
    const res = await axios.post(endpoint, buildPayload(currentLang), {
      headers,
      timeout: 15000,
    });

    return {
      success: true,
      mode: 'cloud_api',
      message_id: res.data?.messages?.[0]?.id,
      recipient: cleanTo,
      language: currentLang,
      response: res.data,
      message: `WhatsApp message dispatched via Cloud API to +${cleanTo}!`,
    };
  } catch (err) {
    const errData = err.response?.data?.error || {};
    const errMsg = errData.message || err.message;
    const errCode = errData.code;
    const errSubcode = errData.error_subcode;

    // ── Self-healing resolution for Meta Error #132001 ("Template name does not exist in the translation") ──
    const isTranslationError =
      errCode === 132001 ||
      (typeof errMsg === 'string' && errMsg.includes('Template name does not exist in the translation'));

    if (isTranslationError && templateName) {
      console.warn(
        `[WhatsApp Cloud API] Meta Error #132001 encountered for template '${templateName}' with language '${currentLang}'. Initiating smart translation auto-resolution...`
      );

      const fallbackCandidates = [];

      // 1. Live synchronization of approved templates from Graph API v21.0
      if (accessToken && wabaId) {
        try {
          const liveSync = await getMessageTemplates(wabaId, accessToken, { forceRefresh: true });
          if (liveSync.success && Array.isArray(liveSync.templates)) {
            const approved = liveSync.templates.filter(
              (t) => t.name.toLowerCase() === templateName.toLowerCase() && t.status === 'APPROVED'
            );
            for (const a of approved) {
              if (a.language && a.language !== currentLang && !fallbackCandidates.includes(a.language)) {
                fallbackCandidates.push(a.language);
              }
            }
          }
        } catch (syncErr) {
          console.warn('[WhatsApp Cloud API] Live template sync during #132001 resolution failed:', syncErr.message);
        }
      }

      // 2. Deterministic translation pair candidates
      if (templateName === 'hello_world' && !fallbackCandidates.includes('en_US')) {
        fallbackCandidates.unshift('en_US');
      }
      if (currentLang === 'en_US' && !fallbackCandidates.includes('en')) fallbackCandidates.push('en');
      if (currentLang === 'en' && !fallbackCandidates.includes('en_US')) fallbackCandidates.push('en_US');
      if (currentLang === 'en_GB' && !fallbackCandidates.includes('en_US')) fallbackCandidates.push('en_US', 'en');
      if (currentLang === 'hi' && !fallbackCandidates.includes('en_US')) fallbackCandidates.push('en_US', 'en');
      if (currentLang === 'mr' && !fallbackCandidates.includes('en_US')) fallbackCandidates.push('en_US', 'en');
      if (currentLang === 'gu' && !fallbackCandidates.includes('en_US')) fallbackCandidates.push('en_US', 'en');
      if (currentLang === 'ta' && !fallbackCandidates.includes('en_US')) fallbackCandidates.push('en_US', 'en');
      if (currentLang === 'te' && !fallbackCandidates.includes('en_US')) fallbackCandidates.push('en_US', 'en');

      // Attempt dispatch across candidate languages
      for (const candidateLang of fallbackCandidates) {
        try {
          const retryRes = await axios.post(endpoint, buildPayload(candidateLang), {
            headers,
            timeout: 15000,
          });

          console.info(
            `[WhatsApp Cloud API] Auto-healed Error #132001! Template '${templateName}' successfully delivered using translation language '${candidateLang}'.`
          );

          return {
            success: true,
            mode: 'cloud_api',
            message_id: retryRes.data?.messages?.[0]?.id,
            recipient: cleanTo,
            auto_healed_132001: true,
            original_language: currentLang,
            resolved_language: candidateLang,
            response: retryRes.data,
            message: `WhatsApp template '${templateName}' dispatched successfully to +${cleanTo} via Cloud API (resolved language: ${candidateLang})!`,
          };
        } catch (retryErr) {
          // Continue to next candidate
        }
      }
    }

    // ── Self-healing resolution for Meta Error #132000 ("Number of parameters does not match...") ──
    const isParamCountError =
      errCode === 132000 ||
      (typeof errMsg === 'string' && errMsg.includes('Number of parameters does not match'));

    if (isParamCountError && templateName && accessToken && wabaId) {
      console.warn(
        `[WhatsApp Cloud API] Meta Error #132000 encountered for template '${templateName}'. Auto-resolving parameter schema from Graph API...`
      );

      try {
        const liveSync = await getMessageTemplates(wabaId, accessToken, { forceRefresh: true });
        const tmpl = (liveSync.templates || []).find(
          (t) => t.name.toLowerCase() === templateName.toLowerCase() && t.status === 'APPROVED'
        );
        if (tmpl) {
          const autoComponents = autoFillTemplateComponents(tmpl, { templateComponents, templateParams });
          if (autoComponents && autoComponents.length) {
            const retryPayload = {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: cleanTo,
              type: 'template',
              template: {
                name: templateName,
                language: { code: currentLang },
                components: autoComponents,
              },
            };
            const retryRes = await axios.post(endpoint, retryPayload, { headers, timeout: 15000 });
            console.info(
              `[WhatsApp Cloud API] Auto-healed Error #132000! Template '${templateName}' successfully delivered to +${cleanTo} via Cloud API.`
            );
            return {
              success: true,
              mode: 'cloud_api',
              message_id: retryRes.data?.messages?.[0]?.id,
              recipient: cleanTo,
              auto_healed_132000: true,
              response: retryRes.data,
              message: `WhatsApp template '${templateName}' delivered to +${cleanTo} via Cloud API!`,
            };
          }
        }
      } catch (autoErr) {
        console.warn('[WhatsApp Cloud API] Auto-heal #132000 failed:', autoErr.response?.data || autoErr.message);
      }
    }

    console.warn('[WhatsApp Cloud API] Direct API call warning:', errMsg, `(code ${errCode}, subcode ${errSubcode})`);

    const bridgeUrl = `https://wa.me/${cleanTo}?text=${encodeURIComponent(text || 'Hello!')}`;
    return {
      success: false,
      mode: 'fallback_bridge',
      recipient: cleanTo,
      bridge_url: bridgeUrl,
      error_code: errCode,
      error_subcode: errSubcode,
      error: errMsg,
      translation_error: isTranslationError,
      message: isTranslationError
        ? `Meta Error #132001: Template '${templateName}' does not exist in translation '${currentLang}'. Fallback WhatsApp Web bridge prepared.`
        : `Meta Cloud API error: ${errMsg}`,
    };
  }
}

/**
 * Verify WhatsApp Cloud API credentials
 */
async function verifyWhatsAppCredentials(phoneNumberId = DEFAULT_PHONE_NUMBER_ID, accessToken) {
  if (!phoneNumberId || !accessToken) {
    return { valid: false, error: 'Phone Number ID and Access Token are required.' };
  }

  try {
    const res = await axios.get(
      `${GRAPH_BASE_URL}/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,name_status,code_verification_status`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      }
    );

    return {
      valid: true,
      data: res.data,
      verified_name: res.data.verified_name || res.data.display_phone_number || '',
      display_phone_number: res.data.display_phone_number,
      quality_rating: res.data.quality_rating || 'GREEN',
      name_status: res.data.name_status || 'APPROVED',
      code_verification_status: res.data.code_verification_status || 'VERIFIED',
    };
  } catch (err) {
    return {
      valid: false,
      error: err.response?.data?.error?.message || err.message,
    };
  }
}

/**
 * Step 6: Register 6-digit PIN for WhatsApp Two-Step Verification via Graph API
 * POST /{phone-number-id}/register with { "messaging_product": "whatsapp", "pin": "..." }
 */
async function registerTwoStepPin(phoneNumberId = DEFAULT_PHONE_NUMBER_ID, accessToken, pin) {
  const cleanPin = String(pin || '').trim();
  if (cleanPin.length !== 6 || !/^\d{6}$/.test(cleanPin)) {
    return { success: false, error: 'PIN must be exactly 6 numeric digits.' };
  }

  if (!accessToken) {
    return { success: false, error: 'Meta WhatsApp Access Token is required.' };
  }

  try {
    const endpoint = `${GRAPH_BASE_URL}/${phoneNumberId}/register`;
    const res = await axios.post(
      endpoint,
      {
        messaging_product: 'whatsapp',
        pin: cleanPin,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    return {
      success: true,
      phone_number_id: phoneNumberId,
      message: '2-Step Verification 6-digit PIN registered successfully with Meta!',
      response: res.data,
    };
  } catch (err) {
    const errData = err.response?.data?.error || {};
    const errMsg = errData.message || err.message;
    return {
      success: false,
      error: `Meta Registration Error: ${errMsg}`,
      error_code: errData.code,
      error_subcode: errData.error_subcode,
    };
  }
}

/**
 * Step 3 & 4: Fetch WhatsApp Business Profile
 */
async function getBusinessProfile(phoneNumberId = DEFAULT_PHONE_NUMBER_ID, accessToken) {
  try {
    const endpoint = `${GRAPH_BASE_URL}/${phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`;
    const res = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    });
    return {
      success: true,
      profile: res.data?.data?.[0] || {},
    };
  } catch (err) {
    return {
      success: false,
      error: err.response?.data?.error?.message || err.message,
    };
  }
}

/**
 * Step 3 & 4: Update Official WhatsApp Business Profile (Domain, Address, Description)
 */
async function updateBusinessProfile(phoneNumberId = DEFAULT_PHONE_NUMBER_ID, accessToken, profileData = {}) {
  try {
    const endpoint = `${GRAPH_BASE_URL}/${phoneNumberId}/whatsapp_business_profile`;
    const payload = {
      messaging_product: 'whatsapp',
      ...(profileData.about && { about: profileData.about }),
      ...(profileData.address && { address: profileData.address }),
      ...(profileData.description && { description: profileData.description }),
      ...(profileData.email && { email: profileData.email }),
      ...(profileData.websites && {
        websites: Array.isArray(profileData.websites) ? profileData.websites : [profileData.websites],
      }),
      ...(profileData.vertical && { vertical: profileData.vertical }),
    };

    const res = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    return {
      success: true,
      message: 'Official WhatsApp Business Profile updated successfully!',
      response: res.data,
    };
  } catch (err) {
    return {
      success: false,
      error: err.response?.data?.error?.message || err.message,
    };
  }
}

/**
 * Step 7: Inspect WhatsApp Business Account & Official Business Account (OBA / Green Tick) Verification Audit
 */
async function getVerificationAudit(phoneNumberId = DEFAULT_PHONE_NUMBER_ID, wabaId = DEFAULT_WABA_ID, accessToken) {
  if (!accessToken) {
    return {
      configured: false,
      error: 'Access Token not provided',
    };
  }

  const results = {
    configured: true,
    phone_id: phoneNumberId,
    waba_id: wabaId,
    phone_details: null,
    waba_details: null,
    is_oba: false,
    oba_badge_status: 'ACTION_NEEDED',
    checklist: {
      meta_app_live: true,
      waba_active: false,
      phone_registered: false,
      official_domain_ready: true,
      business_legal_verification: 'IN_PROGRESS',
      two_step_verification: 'ACTION_NEEDED',
      display_name_status: 'PENDING_REVIEW',
      quality_rating: 'UNKNOWN',
      oba_badge_status: 'READY_AFTER_LEGAL_VERIFICATION',
    },
  };

  try {
    const phoneRes = await axios.get(
      `${GRAPH_BASE_URL}/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,name_status,code_verification_status,messaging_limit_tier,is_official_business_account,account_mode,status`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
    );
    results.phone_details = phoneRes.data;
    results.checklist.waba_active = true;
    results.checklist.phone_registered = true;
    results.checklist.display_name_status = phoneRes.data.name_status || 'APPROVED';
    results.checklist.quality_rating = phoneRes.data.quality_rating || 'GREEN';

    if (phoneRes.data.code_verification_status === 'VERIFIED') {
      results.checklist.two_step_verification = 'COMPLETED';
    }

    if (phoneRes.data.is_official_business_account === true) {
      results.is_oba = true;
      results.checklist.oba_badge_status = 'VERIFIED_OFFICIAL_BUSINESS_ACCOUNT';
      results.oba_badge_status = 'VERIFIED';
    }
  } catch (err) {
    results.phone_error = err.response?.data?.error?.message || err.message;
  }

  try {
    const wabaRes = await axios.get(
      `${GRAPH_BASE_URL}/${wabaId}?fields=id,name,account_review_status,business_verification_status,currency,timezone_id`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
    );
    results.waba_details = wabaRes.data;
    if (wabaRes.data.business_verification_status === 'verified') {
      results.checklist.business_legal_verification = 'VERIFIED';
      if (!results.is_oba) {
        results.checklist.oba_badge_status = 'SUBMISSION_READY';
        results.oba_badge_status = 'SUBMISSION_READY';
      }
    }
  } catch (err) {
    results.waba_error = err.response?.data?.error?.message || err.message;
  }

  return results;
}

/**
 * Send WhatsApp in-chat UPI Payment Request via Meta Cloud API
 */
async function sendPaymentMessage({
  phoneNumberId = DEFAULT_PHONE_NUMBER_ID,
  wabaId = DEFAULT_WABA_ID,
  accessToken,
  to = DEFAULT_TEST_RECIPIENT,
  title = 'Payment',
  amount = 0,
  upiVpa,
  payeeName = '',
}) {
  if (!upiVpa) return { success: false, error: 'Add your UPI ID first (it’s where the money goes).' };
  const amtFormatted = Number(amount || 0).toFixed(2);
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiVpa)}${payeeName ? `&pn=${encodeURIComponent(payeeName)}` : ''}&am=${amtFormatted}&cu=INR&tn=${encodeURIComponent(title)}`;

  const paymentMessage =
    `💳 *${payeeName ? `${payeeName} – ` : ''}Payment request*\n\n` +
    `🏢 *Bill/Service:* ${title}\n` +
    `💰 *Amount Due:* ₹${amtFormatted}\n` +
    `⚡ *Pay via UPI (GPay, PhonePe, Paytm, BHIM):*\n` +
    `${upiUrl}\n\n` +
    `_Tap link above to pay instantly inside WhatsApp with 0% gateway commission._`;

  return sendWhatsAppMessage({
    phoneNumberId,
    wabaId,
    accessToken,
    to,
    text: paymentMessage,
  });
}

// ── Templates: create and delete ───────────────────────────────────────────
// Meta's rules are checked here first, so the user gets a plain message now
// instead of a rejection a day later.
const TEMPLATE_LIMITS = { name: 512, header: 60, body: 1024, footer: 60, button: 25, buttons: 3 };

function validateTemplate(t) {
  const errors = [];
  if (!/^[a-z0-9_]{1,512}$/.test(t.name || '')) errors.push('Give the template a name (letters and numbers).');
  if (!['MARKETING', 'UTILITY'].includes(t.category)) errors.push('Choose what the message is for.');
  if (!SUPPORTED_LANGUAGE_CODES.includes(t.language)) errors.push('Choose the language.');
  const body = String(t.body || '').trim();
  if (!body) errors.push('Write the message.');
  if (body.length > TEMPLATE_LIMITS.body) errors.push(`The message is too long (${body.length} of ${TEMPLATE_LIMITS.body} characters).`);
  if (/^\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}[.!?\s]*$/.test(body)) {
    errors.push('WhatsApp doesn’t allow a message to start or end with a fill-in (like the customer’s name). Add a word before or after it.');
  }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) errors.push('Put a word between two fill-ins.');
  const vars = [...new Set(body.match(/\{\{(\d+)\}\}/g) || [])];
  vars.forEach((v, i) => { if (v !== `{{${i + 1}}}`) errors.push('Fill-ins must be numbered {{1}}, {{2}}… in order.'); });
  const examples = Array.isArray(t.examples) ? t.examples.map((e) => String(e || '').trim()) : [];
  if (vars.length && (examples.length < vars.length || examples.slice(0, vars.length).some((e) => !e))) {
    errors.push('Give an example for each fill-in (Meta checks the message with it).');
  }
  if (t.header && String(t.header).length > TEMPLATE_LIMITS.header) errors.push(`The title is too long (max ${TEMPLATE_LIMITS.header} characters).`);
  if (t.header && /\{\{/.test(t.header)) errors.push('The title can’t have fill-ins.');
  if (t.footer && String(t.footer).length > TEMPLATE_LIMITS.footer) errors.push(`The small print is too long (max ${TEMPLATE_LIMITS.footer} characters).`);
  const buttons = Array.isArray(t.buttons) ? t.buttons.filter((b) => b && String(b.text || '').trim()) : [];
  if (buttons.length > TEMPLATE_LIMITS.buttons) errors.push(`At most ${TEMPLATE_LIMITS.buttons} buttons.`);
  for (const b of buttons) {
    if (String(b.text).length > TEMPLATE_LIMITS.button) errors.push(`Button “${b.text}” is too long (max ${TEMPLATE_LIMITS.button} characters).`);
    if (b.type === 'URL' && !/^https:\/\/\S+\.\S+/.test(b.url || '')) errors.push(`Button “${b.text}” needs a web address starting with https://`);
    if (b.type === 'PHONE_NUMBER' && !/^\+?\d{8,15}$/.test(String(b.phone_number || '').replace(/[\s-]/g, ''))) {
      errors.push(`Button “${b.text}” needs a phone number with the country code.`);
    }
  }
  return { errors: [...new Set(errors)], vars, examples, buttons, body };
}

function buildTemplatePayload(t) {
  const v = validateTemplate(t);
  if (v.errors.length) throw Object.assign(new Error(v.errors.join(' ')), { status: 400, errors: v.errors });
  const components = [];
  if (t.header && String(t.header).trim()) components.push({ type: 'HEADER', format: 'TEXT', text: String(t.header).trim() });
  components.push({ type: 'BODY', text: v.body, ...(v.vars.length ? { example: { body_text: [v.examples.slice(0, v.vars.length)] } } : {}) });
  if (t.footer && String(t.footer).trim()) components.push({ type: 'FOOTER', text: String(t.footer).trim() });
  if (v.buttons.length) {
    components.push({
      type: 'BUTTONS',
      buttons: v.buttons.map((b) => (b.type === 'URL' ? { type: 'URL', text: String(b.text).trim(), url: b.url }
        : b.type === 'PHONE_NUMBER' ? { type: 'PHONE_NUMBER', text: String(b.text).trim(), phone_number: String(b.phone_number).replace(/[\s-]/g, '') }
        : { type: 'QUICK_REPLY', text: String(b.text).trim() })),
    });
  }
  return { name: t.name, category: t.category, language: t.language, components };
}

async function createMessageTemplate(wabaId, accessToken, t) {
  if (!accessToken || !wabaId) {
    throw Object.assign(new Error('Connect WhatsApp first (WhatsApp → Setup): the access token and the Business Account ID are needed.'), { status: 400 });
  }
  const payload = buildTemplatePayload(t);
  try {
    const res = await axios.post(`${GRAPH_BASE_URL}/${wabaId}/message_templates`, payload, {
      headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000,
    });
    clearTemplateCache(wabaId);
    return { success: true, id: res.data?.id, status: res.data?.status || 'PENDING', category: res.data?.category || t.category };
  } catch (err) {
    const e = err.response?.data?.error || {};
    const msg = e.error_user_msg || e.message || err.message;
    throw Object.assign(new Error(/already exists|duplicate/i.test(msg)
      ? 'A template with this name already exists in this language. Choose another name.'
      : `Meta didn’t accept the template: ${msg}`), { status: 400 });
  }
}

async function deleteMessageTemplate(wabaId, accessToken, name, id) {
  if (!accessToken || !wabaId) throw Object.assign(new Error('Connect WhatsApp first (WhatsApp → Setup).'), { status: 400 });
  try {
    await axios.delete(`${GRAPH_BASE_URL}/${wabaId}/message_templates`, {
      params: { name, ...(id ? { hsm_id: id } : {}) },
      headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000,
    });
    clearTemplateCache(wabaId);
    return { success: true };
  } catch (err) {
    const e = err.response?.data?.error || {};
    throw Object.assign(new Error(`Meta didn’t delete it: ${e.error_user_msg || e.message || err.message}`), { status: 400 });
  }
}

module.exports = {
  validateTemplate,
  buildTemplatePayload,
  createMessageTemplate,
  deleteMessageTemplate,
  TEMPLATE_LIMITS,
  sendWhatsAppMessage,
  verifyWhatsAppCredentials,
  registerTwoStepPin,
  getBusinessProfile,
  updateBusinessProfile,
  getVerificationAudit,
  sendPaymentMessage,
  getMessageTemplates,
  clearTemplateCache,
  normalizeLanguageCode,
  buildTemplateComponents,
  autoFillTemplateComponents,
  formatComponentParameters,
  SUPPORTED_LANGUAGE_CODES,
  GRAPH_API_VERSION,
  GRAPH_BASE_URL,
  DEFAULT_PHONE_NUMBER_ID,
  DEFAULT_WABA_ID,
  DEFAULT_TEST_RECIPIENT,
};

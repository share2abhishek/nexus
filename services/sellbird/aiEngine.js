// services/sellbird/aiEngine.js
// Autonomous AI generation for hyper-personalized cold outreach sequences and reply triage.

const { aiGenerate, aiJSON } = require('../aiHelper');

function defaultAiKeys(opts = {}) {
  return {
    googleKey: opts.googleKey || process.env.GOOGLE_AI_KEY,
    anthropicKey: opts.anthropicKey || process.env.ANTHROPIC_API_KEY,
    groqKey: opts.groqKey || process.env.GROQ_API_KEY,
    openrouterKey: opts.openrouterKey || process.env.OPENROUTER_API_KEY,
    mistralKey: opts.mistralKey || process.env.MISTRAL_API_KEY,
    ollamaEnabled: opts.ollamaEnabled !== undefined ? opts.ollamaEnabled : process.env.OLLAMA_ENABLED !== 'false',
    ollamaModel: opts.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2',
    ollamaBaseUrl: opts.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  };
}

async function generateOutreachSequence({ product, company, contact }, aiOpts = {}) {
  const mergedOpts = defaultAiKeys(aiOpts);

  const prompt = `You are Sellbird, an autonomous elite B2B sales agent known for high response rates and consultative cold outreach.

Your task is to write a personalized, highly effective 3-step cold email sequence from our company to a prospective decision-maker.

Our Product/Service:
- Name / Description: ${product.name || 'Urban Society'} (${product.description || 'All-in-one smart society management, automated maintenance billing, digital passes, and financial transparency platform'})
- Website: ${product.url || 'https://www.urbansociety.in/'}

Prospect Information:
- Company Name: ${company.name} (${company.domain})
- Industry: ${company.industry || 'Residential Communities / Real Estate / Property Management'}
- Buying Signals Detected on Website: ${(company.buying_signals?.signals || []).join(', ') || 'Active business operations, seeking operational efficiency'}
- Key Offerings / Context: ${(company.buying_signals?.headlines || []).slice(0, 3).join('; ') || 'Modern property management'}

Contact:
- Name: ${contact.full_name || 'Team'}
- Role: ${contact.role || 'Decision Maker'}

Rules:
1. No generic fluff, buzzwords, or cheesy sales lines ("I hope this email finds you well" is FORBIDDEN).
2. Reference at least ONE specific observation or buying signal from their business.
3. Keep each email between 50 and 120 words.
4. Provide a low-friction, soft CTA (e.g. asking if they're open to seeing a 2-minute overview or a brief chat).
5. Output valid JSON with an array of 3 email steps.

Format:
{
  "steps": [
    {
      "step": 1,
      "delay_days": 0,
      "subject": "Quick subject line",
      "body": "Hi [Name],\\n\\nBody text...\\n\\nBest,\\n[Sender]"
    },
    {
      "step": 2,
      "delay_days": 3,
      "subject": "Re: [Previous Subject]",
      "body": "Hi [Name],\\n\\nShort follow up referencing specific value or case study...\\n\\nBest,\\n[Sender]"
    },
    {
      "step": 3,
      "delay_days": 7,
      "subject": "Closing the loop on [Topic]",
      "body": "Hi [Name],\\n\\nFinal graceful breakup touchpoint...\\n\\nBest,\\n[Sender]"
    }
  ]
}`;

  try {
    const res = await aiJSON(prompt, mergedOpts.googleKey, 1500, mergedOpts);
    const steps = res?.data?.steps || (Array.isArray(res?.data) ? res.data : null);
    if (steps && Array.isArray(steps) && steps.length) {
      return steps;
    }
  } catch (err) {
    console.warn('[Sellbird AI] aiJSON failed, falling back to structured aiGenerate:', err.message);
  }

  // Fallback template sequence if AI key is missing or fails
  const firstName = (contact.full_name || '').split(' ')[0] || 'there';
  const signal = (company.buying_signals?.signals || [])[0] || 'property operations';

  return [
    {
      step: 1,
      delay_days: 0,
      subject: `Question regarding ${company.name}'s ${signal}`,
      body: `Hi ${firstName},\n\nI noticed ${company.name}'s focus on ${signal} and wanted to reach out.\n\nWe built ${product.name || 'Urban Society'} to help teams automate daily management, accounting reconciliation, and member communications without manual spreadsheet tracking.\n\nWould you be open to a 5-minute chat this week to see how other organizations streamlined this?\n\nBest regards,\nGrowth Team`,
    },
    {
      step: 2,
      delay_days: 3,
      subject: `Re: Question regarding ${company.name}'s ${signal}`,
      body: `Hi ${firstName},\n\nFollowing up on my note from earlier this week. Most leadership teams we speak with spend 10+ hours a month chasing invoices, gate passes, and vendor receipts.\n\nWe eliminate that friction completely with 1-click automated workflows.\n\nDo you have 5 minutes on Thursday to connect?\n\nBest,\nGrowth Team`,
    },
    {
      step: 3,
      delay_days: 7,
      subject: `Closing the loop: ${company.name}`,
      body: `Hi ${firstName},\n\nI understand you are busy running operations at ${company.name}. I won't crowd your inbox further.\n\nIf upgrading your management infrastructure ever becomes a priority down the line, feel free to check out ${product.url || 'https://www.urbansociety.in/'} anytime.\n\nWish you and the team continued success!\n\nBest,\nGrowth Team`,
    },
  ];
}

async function classifyReplyIntent(messageText, aiOpts = {}) {
  const mergedOpts = defaultAiKeys(aiOpts);
  const prompt = `Classify the sentiment and intent of this prospect email reply into exactly ONE of these categories:
- "interested" (wants to meet, see a demo, asked for pricing or more info)
- "question" (asking a clarifying question or routing to someone else)
- "objection" (busy, not right now, using another tool)
- "not_interested" (explicitly said no or not a fit)
- "unsubscribe" (wants to be removed, cease contact)

Reply text:
"${messageText}"

Respond with ONLY the category string.`;

  try {
    const res = await aiGenerate(prompt, mergedOpts.googleKey, 20, null, mergedOpts);
    const cat = res.text.trim().toLowerCase().replace(/[^a-z_]/g, '');
    const valid = ['interested', 'question', 'objection', 'not_interested', 'unsubscribe'];
    return valid.includes(cat) ? cat : 'question';
  } catch {
    const lower = messageText.toLowerCase();
    if (lower.includes('unsubscribe') || lower.includes('remove me')) return 'unsubscribe';
    if (lower.includes('not interested') || lower.includes('no thanks')) return 'not_interested';
    if (lower.includes('send info') || lower.includes('call') || lower.includes('demo') || lower.includes('time') || lower.includes('yes')) return 'interested';
    return 'question';
  }
}

async function draftReplyResponse({ originalMessage, intent, product }, aiOpts = {}) {
  const mergedOpts = defaultAiKeys(aiOpts);
  const prompt = `You are an executive sales assistant replying to a prospect response.
Prospect Message: "${originalMessage}"
Detected Intent: ${intent}
Our Product: ${product.name || 'Urban Society'} (${product.url || 'https://www.urbansociety.in/'})

Write a courteous, concise, high-converting reply (under 80 words).
- If interested: Offer 2 specific time slots or invite them to pick a time.
- If objection: Validate their concern briefly and ask a thoughtful question.
- If not interested or unsubscribe: Acknowledge politely and confirm removal.`;

  try {
    const res = await aiGenerate(prompt, mergedOpts.googleKey, 300, null, mergedOpts);
    return res.text.trim();
  } catch {
    if (intent === 'unsubscribe' || intent === 'not_interested') {
      return 'Thank you for letting us know. We have removed you from our list and wish you all the best.';
    }
    return `Thank you for your response! Would you have 10 minutes open tomorrow at 11:00 AM or Thursday at 3:00 PM for a quick walkthrough? Let me know what suits you best.`;
  }
}

module.exports = {
  generateOutreachSequence,
  classifyReplyIntent,
  draftReplyResponse,
};

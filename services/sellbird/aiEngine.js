// services/sellbird/aiEngine.js
// Autonomous AI generation for hyper-personalized cold outreach sequences and reply triage.

const { aiGenerate, aiJSON } = require('../aiHelper');

// Keys come from the request (the person's own, then their business's). Only the
// desktop app falls back to the install's .env keys; the server never does.
function defaultAiKeys(opts = {}) {
  const env = require('../edition').isServer() ? {} : process.env;
  return {
    googleKey: opts.googleKey || env.GOOGLE_AI_KEY,
    anthropicKey: opts.anthropicKey || env.ANTHROPIC_API_KEY,
    groqKey: opts.groqKey || env.GROQ_API_KEY,
    openrouterKey: opts.openrouterKey || env.OPENROUTER_API_KEY,
    mistralKey: opts.mistralKey || env.MISTRAL_API_KEY,
    ollamaEnabled: opts.ollamaEnabled !== undefined ? opts.ollamaEnabled : require('../edition').ollamaDefault(),
    ollamaModel: opts.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2',
    ollamaBaseUrl: opts.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  };
}

// A name we can greet: "Acme Leadership" / "Decision Maker" aren't people
function greetingName(contact) {
  const n = String(contact.full_name || '').trim();
  if (!n || /leadership|committee|office|team|decision maker|management/i.test(n)) return '';
  return n.split(/\s+/)[0];
}

// Steps must be usable emails: text subject and body, a sensible delay
function cleanSteps(steps) {
  const out = [];
  for (const [i, st] of (Array.isArray(steps) ? steps : []).entries()) {
    const subject = String(st?.subject || '').trim();
    const body = String(st?.body || '').trim();
    if (!subject || !body) continue;
    const delay = Math.max(0, Math.min(30, Number(st.delay_days) || i * 3));
    out.push({ step: out.length + 1, delay_days: out.length ? Math.max(1, delay) : 0, subject: subject.slice(0, 200), body });
  }
  return out.slice(0, 3);
}

async function generateOutreachSequence({ product, company, contact }, aiOpts = {}) {
  const mergedOpts = defaultAiKeys(aiOpts);
  const first = greetingName(contact);
  const sender = product.name || '';
  const signals = (company.buying_signals?.signals || []).filter((x) => !/domain identified|host restricted|invalid target/i.test(x));
  const headings = (company.buying_signals?.headlines || []).slice(0, 3);

  const lines = [
    'Write a short 3-email cold outreach sequence from a business to a possible customer.',
    '',
    'About us (the sender):',
    `- Business: ${sender || '(name not given: sign off without a company name)'}`,
    `- What we offer: ${product.description || '(not given: keep it general and ask if it is relevant)'}`,
    `- Website: ${product.url || '(not given)'}`,
    '',
    'About them:',
    `- Company: ${company.name} (${company.domain})`,
  ];
  if (company.industry) lines.push(`- Industry: ${company.industry}`);
  if (signals.length) lines.push(`- Seen on their website: ${signals.join(', ')}`);
  if (headings.length) lines.push(`- Their website headings: ${headings.join('; ')}`);
  lines.push(`- Person: ${first ? `${contact.full_name}, ${contact.role || ''}` : 'unknown (greet with "Hello," and no name)'}`);
  lines.push('', 'Rules:',
    '1. Only say things that are true from the details above. Do not invent results, numbers, customers or case studies.',
    '2. Write the real text: never leave blanks like [Name], [Sender], [Company] or {{...}}.',
    `3. ${first ? `Greet them as ${first}.` : 'Start with "Hello,".'} Sign off as ${sender ? `"${sender}"` : 'the sender, without a made-up name'}.`,
    '4. 50-120 words each, plain and friendly, one simple question at the end.',
    '5. Email 2 is a short follow-up 3 days later, email 3 a polite last note 7 days later.',
    '',
    'Reply with JSON only: {"steps":[{"step":1,"delay_days":0,"subject":"...","body":"..."},{"step":2,"delay_days":3,"subject":"...","body":"..."},{"step":3,"delay_days":7,"subject":"...","body":"..."}]}');
  const prompt = lines.join('\n');

  try {
    const res = await aiJSON(prompt, mergedOpts.googleKey, 1500, mergedOpts);
    const steps = cleanSteps(res?.data?.steps || (Array.isArray(res?.data) ? res.data : []));
    if (steps.length) return steps;
  } catch (err) {
    console.warn('[Sales outreach AI] Could not write emails with AI, using a simple template:', err.message);
  }

  // Without AI: a plain, honest template built only from what we know
  const hello = first ? `Hi ${first},` : 'Hello,';
  const signOff = sender ? `\n\nBest regards,\n${sender}` : '\n\nBest regards';
  const offer = (product.description || '').trim().replace(/\.$/, '');
  const about = offer ? `What we do: ${offer}.` : `I think what we do could be useful for ${company.name}.`;
  const link = product.url ? ` You can see more at ${product.url}.` : '';
  return [
    { step: 1, delay_days: 0, subject: `A question for ${company.name}`,
      body: `${hello}\n\nI came across ${company.name} and wanted to reach out. ${about}${link}\n\nWould a short chat be useful to see if it fits?${signOff}` },
    { step: 2, delay_days: 3, subject: `Re: A question for ${company.name}`,
      body: `${hello}\n\nJust following up on my note from a few days ago. Is this something you'd like to know more about?${signOff}` },
    { step: 3, delay_days: 7, subject: `Last note for ${company.name}`,
      body: `${hello}\n\nI won't keep filling your inbox. If it becomes useful later, just reply to this email.${link}${signOff}` },
  ];
}

// Reply sorting without AI: clear words, "no" checked before "yes"
function classifyByWords(messageText) {
  const t = String(messageText || '').toLowerCase();
  const has = (re) => re.test(t);
  if (has(/unsubscribe|remove me|take me off|stop (emailing|contacting|sending)|don'?t (email|contact|message|call)|do not (email|contact|call)/)) return 'unsubscribe';
  if (has(/not interested|no thanks|no,? thank you|not a fit|not for us|not looking/)) return 'not_interested';
  if (has(/\b(not right now|maybe later|too busy|no budget|already (use|have)|next (quarter|year))\b/)) return 'objection';
  if (has(/\b(interested|demo|quote|call|meeting|meet|let'?s (talk|chat)|book|schedule|send (me )?(more )?(info|details)|sounds good|looks great|yes)\b/)) return 'interested';
  return 'question';
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
    return classifyByWords(messageText);
  }
}

async function draftReplyResponse({ originalMessage, intent, product }, aiOpts = {}) {
  const mergedOpts = defaultAiKeys(aiOpts);
  const prompt = `You are an executive sales assistant replying to a prospect response.
Prospect Message: "${originalMessage}"
Detected Intent: ${intent}
Our business: ${product.name || '(name not given)'}
What we offer: ${product.description || '(not given)'}
Website: ${product.url || '(not given)'}

Write a short, friendly reply email (under 80 words). Reply with the email text only.
- If interested: ask what time suits them (don't name specific times).
- Don't leave blanks like [Name] and don't invent facts.
- If objection: Validate their concern briefly and ask a thoughtful question.
- If not interested or unsubscribe: Acknowledge politely and confirm removal.`;

  try {
    const res = await aiGenerate(prompt, mergedOpts.googleKey, 300, null, mergedOpts);
    // models often wrap the whole answer in quotes
    return res.text.trim().replace(/^"([\s\S]*)"$/, '$1').trim();
  } catch {
    if (intent === 'unsubscribe' || intent === 'not_interested') {
      return 'Thank you for letting us know. We have removed you from our list and wish you all the best.';
    }
    return 'Thank you for getting back to me! When would be a good time for a short call? Happy to work around your schedule.';
  }
}

module.exports = {
  classifyByWords,
  greetingName,
  generateOutreachSequence,
  classifyReplyIntent,
  draftReplyResponse,
};

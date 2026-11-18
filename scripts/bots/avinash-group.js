#!/usr/bin/env node
// "Ask Avi" website chatbot for Avinash Group (hosted workspace 3 only).
//
// Prints SQL that sets the bot's look (name, avatar, description, colour), its menu,
// keyword replies, FAQs and knowledge base. It writes ONLY rows of workspace 3 and
// aborts unless that workspace is named "Avinash Group". Content changes need no
// deploy and no dashboard:
//
//   node scripts/bots/avinash-group.js | ssh -i ~/radixile/mumbai-reserved-instance-key.pem \
//     ec2-user@ec2-13-235-255-185.ap-south-1.compute.amazonaws.com \
//     'docker exec -i nexus-nexus-db-1 psql -U postgres -d nexus -v ON_ERROR_STOP=1'
//
// Facts come from avinashgroup.com (home, about, contact, NRI and project pages, Nov 2026).
// Prices, possession dates and offers are not published there, so the bot never states
// them: it asks for the visitor's number and hands over to the sales team.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chatbot = require('../../services/leadPipeline/chatbot');

const WORKSPACE_ID = 3;
const WORKSPACE_NAME = 'Avinash Group';
const WEBCHAT_TOKEN = 'webchat_8e011787097bf2564974c4ee4ddefb6f';
const MANAGER_EMAIL = 'radixile@gmail.com'; // the workspace's manager: AI answers use this login's keys

const PHONE = '+91 771 409 5025';
const EMAIL = 'support@avinashgroup.com';
const OFFICE = 'Avinash House, Maruti Business Park, G.E. Road, Raipur - 492001 (C.G.)';
const SITE = 'https://www.avinashgroup.com';

// ── Look ────────────────────────────────────────────────────────────────────
const avatar = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'avinash-group-avatar.png')).toString('base64');
const profile = {
  name: 'Ask Avi',
  description: '*Your new AI assistant from Avinash Group* 🤖✨🏠\nSend "Hi" to get started! 👇',
  color: '#D4813C',
  placeholder: 'Type your message...',
  avatar,
};

// ── Replies ─────────────────────────────────────────────────────────────────
const SHARE = `Please share your *name* and *mobile number*, and our team will get back to you shortly.`;

const PROJECTS = `Here are our ongoing projects in Raipur 🏗️

🏢 *Avinash One*: 3 & 4 BHK homes in Vishal Nagar, near Magneto The Mall
🌳 *Avinash Twin City*: residential plots near Kumhari Toll Plaza (NH 53)
🏝️ *The Lagoon*: Neo-Balinese villas in Sector 24, Atal Nagar (Naya Raipur)

Tap a project to know more:
• Avinash One
• Avinash Twin City
• The Lagoon`;

const AVINASH_ONE = `🏢 *Avinash One*, Vishal Nagar, Raipur (near Magneto The Mall)
• 3 & 4 BHK, super built-up 2435 – 3636 sq.ft
• 126 homes on 5.5 acres, with prime commercial spaces
• Amenities: AC gymnasium, AC festival hall, sit-out area, drop-off lobby, Mall – Corporate Club
• Nearby: Ram Mandir 850 m, Magneto The Mall 1.3 km, Railway Station 9.2 km, Airport 9.7 km
• RERA: PCGRERA260721001237
• 🏆 ET Realty Award 2025: Iconic Residential Project, East Zone

Would you like the brochure or a site visit? Type *Book a visit* or *Brochure*.`;

const TWIN_CITY = `🌳 *Avinash Twin City*, near Kumhari Toll Plaza on NH 53
• Our flagship 250-acre township along the Kharun Riverfront
• 2100 residential plots, 600 – 2000 sq.ft
• Wide roads, modern infrastructure and green open spaces
• Nearby: Kumhari Railway 2.5 km, AIIMS 5.6 km, Pt. Ravishankar University 8.4 km, Raipur Railway Station 10.8 km
• RERA: PCGRERA250619000998
• 🏆 ET Realty Award 2025: Best Plotted Development, East Zone

Would you like the brochure or a site visit? Type *Book a visit* or *Brochure*.`;

const LAGOON = `🏝️ *The Lagoon*, Sector 24, Atal Nagar (Naya Raipur)
• A premium Neo-Balinese villa community
• 68 villa plots on 21 acres around a landscaped lake, with forest trails, pavilions, rockscapes and waterfalls
• Nearby: Mayfair Lake Resort 400 m, DPS School 1.5 km, CBD Railway Station 5.3 km, Airport 11.7 km
• RERA: PCGRERA141022001540

Would you like the brochure or a site visit? Type *Book a visit* or *Brochure*.`;

const BROCHURE = `We'd be happy to send you the brochure and floor plans 📑
Please share:
- the project (Avinash One, Avinash Twin City or The Lagoon)
- your name and mobile number
Our team will send them to you shortly.`;

const VISIT_MENU = `Sure! What would you like to do? 📅
• ✨ Book a Visit
• 🔄 Reschedule Visit
• ❌ Cancel Visit`;

const BOOK = `Great choice! ✨ Let's book your site visit.
Please share:
- your name and mobile number
- the project (Avinash One, Avinash Twin City or The Lagoon)
- your preferred date and time
Our team will call you to confirm your visit.`;

const RESCHEDULE = `No problem 🔄 Please share the mobile number you booked with and your new preferred date and time. Our team will update your visit and confirm.`;

const CANCEL = `Okay ❌ Please share the mobile number you booked with, and we'll cancel your visit. You're welcome to book again any time: just type *Book a visit*.`;

const OFFERS = `Offers change from time to time and differ by project 🎁 Share your *mobile number* and the project you like, and our sales team will tell you about the current offers. You can also call us on ${PHONE}.`;

const ENQUIRY = `Please type your question or request along with your *name* and *mobile number* 📝 Our team will get back to you shortly.`;

const TEAM = `Sure! Someone from our team will reply here soon 🙂 You can also call us on ${PHONE} or email ${EMAIL}.`;

const PRICE = `Prices depend on the project, unit size and floor, and our sales team shares the latest price details 💰 Tell us the project you're interested in and your *mobile number*, and we'll send them to you. You can also call ${PHONE}.`;

const CONTACT = `📍 *Head Office*: ${OFFICE}
📞 ${PHONE}
✉️ ${EMAIL}
🌐 ${SITE}

Want us to call you? Just share your mobile number.`;

const RERA = `All our ongoing projects are RERA registered ✅
• Avinash One: PCGRERA260721001237
• Avinash Twin City: PCGRERA250619000998
• The Lagoon: PCGRERA141022001540`;

const AMENITIES = `Here's what each project offers ✨
🏢 *Avinash One*: AC gymnasium, AC festival hall, sit-out area, drop-off lobby, Mall – Corporate Club
🌳 *Avinash Twin City*: wide roads, modern infrastructure and green open spaces along the Kharun Riverfront
🏝️ *The Lagoon*: a landscaped lake with forest trails, pavilions, rockscapes and waterfalls

Type a project name for full details.`;

const POSSESSION = `Possession timelines differ by project and phase, and our team shares the latest status 🗓️ Tell us the project you like and your *mobile number*, and we'll update you.`;

const LOAN = `Our team can guide you on home loans and EMIs for the home you choose 🏦 You can also try the EMI Calculator on ${SITE}. ${SHARE}`;

const NRI = `Welcome! 🌏 NRIs can buy homes with us:
• No RBI permission is needed to buy residential or commercial property in India
• Payment by inward remittance through normal banking channels, or from NRE / NRO / FCNR accounts
• Rent can be credited to your NRE / NRO account
• A Power of Attorney can handle loan formalities for you
• NRI home loans: minimum age 21, graduate, minimum monthly income $2000 (criteria vary by lender); EMIs go through your NRE / NRO account
More on ${SITE}/nri. ${SHARE}`;

const ABOUT = `*Avinash Group* has been building in Raipur since 1996 🏗️
• 30+ years of experience
• 61 landmark projects
• 2 crore+ sq.ft developed
• 18,000+ happy families
Vision: to be the creator of the new benchmark in designing, building and marketing residential and commercial complexes.`;

const AWARDS = `A few recent awards 🏆
• 2025: ET Realty Awards, Iconic Residential Project, East Zone (Avinash One) and Best Plotted Development, East Zone (Avinash Twin City)
• 2024: ET Realty Award for Excellence in Customer Service (national)
• 2019: Best LIG Project for Avinash Pride (PMAY Empowering India Awards)
• 2014: Maruti Solitaire, Chhattisgarh's first certified green building (4-star GRIHA)`;

const CAREERS = `Thanks for your interest in working with us! 💼 See current openings at ${SITE}/career.`;

const PARTNER = `We'd love to work with you 🤝 Share your *name*, *mobile number* and whether you'd like to be a Channel Partner or refer a friend, and our team will contact you.`;

const COMMERCIAL = `*Avinash One* near Magneto The Mall includes prime commercial spaces alongside homes 🏬 For commercial options, ${SHARE.charAt(0).toLowerCase() + SHARE.slice(1)}`;

const THANKS = `You're welcome! 😊 Type *Menu* any time to see options.`;
const BYE = `Thank you for chatting with Avinash Group! 🏠 Have a great day. Type *Hi* any time to start again.`;

// ── Bot (menu + keyword rules; first matching rule wins, so specific rules first) ──
const config = chatbot.normalizeConfig({
  welcome: {
    enabled: true,
    text: `Hi there! 👋 I'm *Avi*, your AI assistant from Avinash Group 🏠✨\nWe've been building trust in Raipur since 1996, with 18,000+ happy families.\n\nHow can I help you today?`,
  },
  menu: {
    enabled: true,
    options: [
      { label: '🏡 Explore Projects', reply: PROJECTS },
      { label: '📑 Plans & Brochures', reply: BROCHURE },
      { label: '📅 Manage Site Visit', reply: VISIT_MENU },
      { label: '🎁 Offers', reply: OFFERS },
      { label: '📝 Submit a Request', reply: ENQUIRY },
      { label: '📞 Talk to our team', reply: TEAM, handover: true },
    ],
  },
  keywords: [
    { keywords: ['reschedule', 'reschedule visit', 'change visit', 'change my visit', 'postpone', 'change date', 'another date', 'different date'], reply: RESCHEDULE },
    { keywords: ['cancel visit', 'cancel my visit', 'cancel site visit', 'cancel booking', 'cancel the visit', 'cancel'], reply: CANCEL },
    { keywords: ['book a visit', 'book visit', 'site visit', 'visit site', 'schedule visit', 'schedule a visit', 'book site visit', 'want to visit', 'see the property', 'property visit', 'sample flat', 'show flat', 'visit'], reply: BOOK },
    { keywords: ['manage visit', 'manage site visit', 'my visit'], reply: VISIT_MENU },
    { keywords: ['price', 'prices', 'cost', 'rate', 'rates', 'budget', 'how much', 'pricing', 'price list', 'charges', 'per sq ft', 'sqft rate'], reply: PRICE },
    { keywords: ['offer', 'offers', 'discount', 'deal', 'deals', 'scheme', 'festive'], reply: OFFERS },
    { keywords: ['avinash one', 'avinashone', 'vishal nagar', 'magneto', '3 bhk', '4 bhk', '3bhk', '4bhk', 'flat', 'flats', 'apartment', 'apartments'], reply: AVINASH_ONE },
    { keywords: ['twin city', 'twincity', 'avinash twin city', 'kumhari', 'plot', 'plots', 'kharun', 'land', 'township'], reply: TWIN_CITY },
    { keywords: ['lagoon', 'the lagoon', 'villa', 'villas', 'atal nagar', 'naya raipur', 'nava raipur', 'new raipur', 'bungalow'], reply: LAGOON },
    { keywords: ['projects', 'project', 'ongoing', 'properties', 'property', 'explore', 'options', 'residential'], reply: PROJECTS },
    { keywords: ['brochure', 'floor plan', 'floor plans', 'layout', 'plans', 'plan', 'pdf', 'catalogue', 'details'], reply: BROCHURE },
    { keywords: ['rera', 'rera number', 'registration', 'registered', 'approved', 'approval', 'legal'], reply: RERA },
    { keywords: ['amenities', 'amenity', 'facilities', 'facility', 'gym', 'clubhouse', 'club house', 'club', 'features'], reply: AMENITIES },
    { keywords: ['possession', 'ready to move', 'completion', 'handover date', 'when ready', 'delivery date', 'ready'], reply: POSSESSION },
    { keywords: ['home loan', 'loan', 'emi', 'bank loan', 'finance', 'financing'], reply: LOAN },
    { keywords: ['nri', 'abroad', 'overseas', 'outside india', 'foreign', 'nre', 'nro', 'fcnr'], reply: NRI },
    { keywords: ['commercial', 'shop', 'shops', 'office space', 'retail', 'showroom'], reply: COMMERCIAL },
    { keywords: ['address', 'location', 'office', 'where are you', 'directions', 'head office', 'contact', 'phone number', 'email', 'contact number', 'mobile number of', 'reach you'], reply: CONTACT },
    { keywords: ['about', 'who are you', 'about avinash', 'company', 'experience', 'history', 'since when', 'builder', 'developer', 'reputation', 'trust'], reply: ABOUT },
    { keywords: ['award', 'awards', 'recognition', 'achievements'], reply: AWARDS },
    { keywords: ['career', 'careers', 'job', 'jobs', 'hiring', 'vacancy', 'vacancies', 'work with you'], reply: CAREERS },
    { keywords: ['channel partner', 'broker', 'brokers', 'refer', 'referral', 'refer a friend', 'partner'], reply: PARTNER },
    { keywords: ['enquiry', 'inquiry', 'request', 'submit request', 'submit a request', 'query', 'question'], reply: ENQUIRY },
    { keywords: ['agent', 'human', 'real person', 'talk to someone', 'executive', 'sales person', 'salesperson', 'call me', 'callback', 'call back', 'talk to team', 'speak to someone'], reply: TEAM, handover: true },
    { keywords: ['thanks', 'thank you', 'thank u', 'thankyou', 'ok thanks', 'great', 'awesome', 'helpful'], reply: THANKS },
    { keywords: ['bye', 'goodbye', 'good bye', 'that s all', 'nothing else', 'exit', 'no thanks'], reply: BYE },
  ],
  away: { enabled: false },
  fallback: { mode: 'ai', text: `I'm not sure about that yet 🙂 Our team can help: share your *mobile number*, or type *Menu* to see options.` },
  knowledge: '',
  handover: { pause_hours: 1 },
  timezone: 'Asia/Kolkata',
});

// ── Knowledge base (FAQs answer instantly; the rest is what the AI may use) ──
const persona = {
  name: 'Avi',
  tone: 'friendly',
  response_length: 'balanced',
  strictness: 'strict',
  custom_instructions: 'You are Avi, the assistant of Avinash Group, a real estate developer in Raipur, Chhattisgarh. Help visitors choose a project and invite them to book a site visit or share their mobile number. Never quote prices, possession dates or offers: say the sales team will share them.',
};
const facts = {
  business_summary: 'Avinash Group is a real estate developer in Raipur, Chhattisgarh, founded in 1996. 30+ years of experience, 61 landmark projects, more than 2 crore sq.ft developed and 18,000+ happy families. Managing Director: Mr. Anand Singhania.',
  products_services: 'Ongoing residential projects: Avinash One (3 & 4 BHK, 2435-3636 sq.ft super built-up, 126 homes on 5.5 acres, Vishal Nagar near Magneto The Mall, RERA PCGRERA260721001237); Avinash Twin City (2100 residential plots of 600-2000 sq.ft on 250 acres along the Kharun Riverfront near Kumhari Toll Plaza on NH 53, RERA PCGRERA250619000998); The Lagoon (Neo-Balinese villa community, 68 villa plots on 21 acres around a landscaped lake, Sector 24, Atal Nagar / Naya Raipur, RERA PCGRERA141022001540).',
  pricing_plans: 'Prices, offers and possession dates are not published; the sales team shares them. Home loan and EMI guidance is available; the website has an EMI Calculator.',
  hours_locations: `Head office: ${OFFICE}.`,
  contact_support: `Phone ${PHONE}, email ${EMAIL}, website ${SITE}.`,
};
const faq = (question, answer, tags = []) => ({ id: 'f' + crypto.createHash('md5').update(question).digest('hex').slice(0, 10), question, answer, tags, enabled: true });
const faqs = [
  faq('Where is Avinash One located?', 'Avinash One is in Vishal Nagar, Raipur, near Magneto The Mall (1.3 km). Ram Mandir is 850 m away, the railway station 9.2 km and the airport 9.7 km.', ['avinash one', 'location']),
  faq('What sizes are available in Avinash One?', 'Avinash One has 3 & 4 BHK homes with a super built-up area of 2435 to 3636 sq.ft. There are 126 homes on 5.5 acres.', ['avinash one', 'bhk', 'size']),
  faq('What is the RERA number of Avinash One?', 'Avinash One RERA number: PCGRERA260721001237.', ['rera']),
  faq('What plot sizes are available in Avinash Twin City?', 'Avinash Twin City has 2100 residential plots from 600 to 2000 sq.ft, in a 250-acre township along the Kharun Riverfront near Kumhari Toll Plaza on NH 53.', ['twin city', 'plot']),
  faq('What is the RERA number of Avinash Twin City?', 'Avinash Twin City RERA number: PCGRERA250619000998.', ['rera']),
  faq('Where is Avinash Twin City located?', 'Avinash Twin City is near Kumhari Toll Plaza on NH 53, along the Kharun Riverfront. Kumhari Railway is 2.5 km, AIIMS 5.6 km and Raipur Railway Station 10.8 km away.', ['twin city', 'location']),
  faq('Where is The Lagoon located?', 'The Lagoon is in Sector 24, Atal Nagar (Naya Raipur). Mayfair Lake Resort is 400 m away, DPS School 1.5 km, CBD Railway Station 5.3 km and the airport 11.7 km.', ['lagoon', 'location']),
  faq('What is The Lagoon?', 'The Lagoon is a premium Neo-Balinese villa community in Atal Nagar (Naya Raipur): 68 villa plots on 21 acres around a landscaped lake with forest trails, pavilions, rockscapes and waterfalls.', ['lagoon', 'villa']),
  faq('What is the RERA number of The Lagoon?', 'The Lagoon RERA number: PCGRERA141022001540.', ['rera']),
  faq('Is Avinash Group RERA registered?', 'Yes. Avinash One: PCGRERA260721001237, Avinash Twin City: PCGRERA250619000998, The Lagoon: PCGRERA141022001540.', ['rera']),
  faq('How can I book a site visit?', 'Type "Book a visit" here and share your name, mobile number, project and preferred date and time. Our team will call you to confirm.', ['visit']),
  faq('What is the price?', 'Prices depend on the project, unit size and floor. Share your mobile number and the project you like, and our sales team will send the latest prices.', ['price']),
  faq('Do you help with home loans?', `Our team can guide you on home loans and EMIs. You can also use the EMI Calculator on ${SITE}.`, ['loan', 'emi']),
  faq('Can NRIs buy property?', 'Yes. NRIs need no RBI permission to buy residential or commercial property in India. Payment can be made by inward remittance through normal banking channels or from NRE, NRO or FCNR accounts.', ['nri']),
  faq('How long has Avinash Group been in business?', 'Avinash Group was founded in 1996 and has 30+ years of experience, with 61 landmark projects and 18,000+ happy families.', ['about']),
  faq('What is your office address?', `Our head office is at ${OFFICE}. Call ${PHONE} or email ${EMAIL}.`, ['contact', 'address']),
  faq('What is your phone number?', `Call us on ${PHONE} or email ${EMAIL}.`, ['contact']),
];
const raw_text = [
  'Avinash One amenities: sit-out area, drop-off lobby, entrance area, AC gymnasium, AC festival hall, Mall - Corporate Club. Includes prime commercial spaces. Won the 2025 ET Realty Award for Iconic Residential Project, East Zone.',
  'Avinash Twin City: flagship township with modern infrastructure, wide roads and green open spaces. Nearby: Kumhari Railway 2.5 km, AIIMS 5.6 km, Kharun Green 4 km, Pt. Ravishankar University 8.4 km, Raipur Railway Station 10.8 km, Jaistambh Chowk 11.6 km, Bhilai Steel Plant 15 km. Won the 2025 ET Realty Award for Best Plotted Development, East Zone.',
  'The Lagoon nearby: Mayfair Lake Resort 400 m, DPS School 1.5 km, Radiant Public School 5.3 km, CBD Railway Station 5.3 km, Airport 11.7 km, Sri Sathya Sai Sanjeevani Hospital 10.7 km.',
  'NRI: no RBI permission is needed to buy, sell (residential/commercial) or transfer property to an Indian citizen. Rent can be credited to NRE/NRO accounts. A Power of Attorney may handle loan formalities. NRI home loan eligibility: minimum age 21, minimum graduation, minimum monthly income $2000 (criteria vary by lender); EMIs go through NRE/NRO accounts.',
  'Awards: 2025 ET Realty Awards (Avinash One, Avinash Twin City); 2024 ET Realty Award for Excellence in Customer Service; 2019 Best LIG Project for Avinash Pride; 2018 Anand Singhania Most Reputed Real Estate Entrepreneur, Chhattisgarh; 2015 Best Club House for Club Paraiso; 2014 Maruti Solitaire 4-star GRIHA green building and Maruti Lifestyle 6-star CRISIL rating; 2010 Best Commercial Developer of Central India.',
  `Leadership: Mr. Anand Singhania (Managing Director), Mr. Mukesh Singhania (Director, Finance), Mr. Yash Singhania (Director, Accounts & Customer Operation), Mr. Saurabh Agrawal (Director, Construction & Design), Mr. Pratik Sharma (Director, Procurement).`,
  `Careers: ${SITE}/career. Channel partners and referrals: share name and mobile number with the team.`,
].join('\n\n');
const { compileKnowledge } = require('../../services/knowledgeBase');
const compiled = compileKnowledge({ persona, facts, faqs, documents: [], raw_text });

// ── SQL ─────────────────────────────────────────────────────────────────────
const tag = '$avi' + crypto.randomBytes(6).toString('hex') + '$';
const q = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s.includes(tag)) throw new Error('content contains the quote tag');
  return tag + s + tag;
};
const now = 'extract(epoch from now())::int';

process.stdout.write(`\\set ON_ERROR_STOP on
BEGIN;
DO $guard$ BEGIN
  IF (SELECT name FROM workspaces WHERE id = ${WORKSPACE_ID}) IS DISTINCT FROM '${WORKSPACE_NAME}' THEN
    RAISE EXCEPTION 'workspace ${WORKSPACE_ID} is not ${WORKSPACE_NAME}: nothing changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM meta_lead_configs WHERE workspace_id = ${WORKSPACE_ID} AND webchat_token = '${WEBCHAT_TOKEN}') THEN
    RAISE EXCEPTION 'chat token is not ${WORKSPACE_NAME}''s: nothing changed';
  END IF;
END $guard$;

UPDATE meta_lead_configs
   SET webchat_profile = ${q(profile)}, updated_at = ${now}
 WHERE workspace_id = ${WORKSPACE_ID} AND webchat_token = '${WEBCHAT_TOKEN}';

INSERT INTO whatsapp_bot_settings (workspace_id, enabled, config_json, updated_by, updated_at)
VALUES (${WORKSPACE_ID}, true, ${q(config)}, (SELECT id FROM users WHERE lower(email) = '${MANAGER_EMAIL}'), ${now})
ON CONFLICT (workspace_id) DO UPDATE
   SET enabled = EXCLUDED.enabled, config_json = EXCLUDED.config_json,
       updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;

INSERT INTO ai_knowledge_bases (workspace_id, persona_json, facts_json, faqs_json, documents_json, raw_text, compiled_knowledge, updated_by, created_at, updated_at)
VALUES (${WORKSPACE_ID}, ${q(persona)}, ${q(facts)}, ${q(faqs)}, '[]', ${q(raw_text)}, ${q(compiled)},
        (SELECT id FROM users WHERE lower(email) = '${MANAGER_EMAIL}'), ${now}, ${now})
ON CONFLICT (workspace_id) DO UPDATE
   SET persona_json = EXCLUDED.persona_json, facts_json = EXCLUDED.facts_json, faqs_json = EXCLUDED.faqs_json,
       documents_json = EXCLUDED.documents_json, raw_text = EXCLUDED.raw_text,
       compiled_knowledge = EXCLUDED.compiled_knowledge, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;

COMMIT;
SELECT 'Ask Avi updated for workspace ' || id || ' (' || name || ')' FROM workspaces WHERE id = ${WORKSPACE_ID};
`);

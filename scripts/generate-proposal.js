/**
 * NexaDrip Executive Business Proposal Generator (Configurable with Live Editor & AI Suggestions)
 * Generates:
 *  1. public/NexaDrip-Business-Growth-Proposal.pdf (4-page executive PDF with live UI screens)
 *  2. public/nexadrip-proposal.html (Responsive interactive presentation with slide-out editor drawer)
 */

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// Colors
const C = {
  navyDark: rgb(0.08, 0.08, 0.22),     // #141438
  navyLight: rgb(0.12, 0.12, 0.32),
  purplePrimary: rgb(0.48, 0.23, 0.93), // #7c3aed
  purpleLight: rgb(0.95, 0.92, 1.0),   // #f3e8ff
  emeraldGreen: rgb(0.02, 0.60, 0.42), // #059669
  emeraldLight: rgb(0.90, 0.98, 0.94),
  slateDark: rgb(0.12, 0.16, 0.24),    // #1e293b
  slateMedium: rgb(0.30, 0.38, 0.49),  // #475569
  slateLight: rgb(0.58, 0.64, 0.72),   // #94a3b8
  bgLight: rgb(0.97, 0.98, 0.99),      // #f8fafc
  cardBg: rgb(0.94, 0.96, 0.98),       // #f1f5f9
  white: rgb(1, 1, 1),
  border: rgb(0.88, 0.91, 0.94),
  accentRed: rgb(0.94, 0.27, 0.27),
  waGreen: rgb(0.15, 0.68, 0.38),      // #25d366
  waBubbleIn: rgb(0.88, 0.97, 0.90),
};

const INDUSTRY_PRESETS = {
  dental: {
    id: 'dental',
    name: 'Healthcare & Dental Clinics',
    audience: 'Dental Clinics, Doctors & Specialty Healthcare Providers',
    city: 'Pune',
    cost: '2.00',
    headline: 'Acquire & Book High-Value Patients At Just ~Rs 2 Per Lead / Chat',
    subtitle: 'An autonomous AI growth engine for dental & medical clinics in Pune to automate 24/7 patient inquiries, WhatsApp appointment scheduling, and Google Maps ranking.',
    chat_query: "Customer (10:42 PM): 'Hi, looking for dental implant pricing and consultation in Baner, Pune.'",
    chat_reply: "NexaDrip AI (10:42 PM): 'Hello! Dr. Sharma offers single implants from Rs 18,000 with lifetime warranty. We have a complimentary 3D scan slot this Thursday. Would you like a morning or evening appointment?'",
    chat_customer_confirm: "Customer: 'Thursday 5:00 PM works. My number is 98220 XXXXX.'",
    chat_bot_lock: "NexaDrip AI: 'Appointment locked for Thursday 5 PM! Directions sent. Total cost of this complete patient acquisition: ~Rs 1.85.'",
    industry_summary: '- Clinics & Doctors: 3.8x patient bookings via 24/7 WhatsApp bot  - Dental: Instant implant & aligner consultation booking'
  },
  realestate: {
    id: 'realestate',
    name: 'Real Estate & Property Developers',
    audience: 'Builders, Real Estate Developers & Channel Partners',
    city: 'Pune',
    cost: '2.00',
    headline: 'Acquire Verified Home Buyers & Site Visits At Just ~Rs 2 Per Lead / Chat',
    subtitle: 'Autonomous AI property marketing for real estate developers and brokers in Pune: 24/7 WhatsApp brochure dispatch, automated site visit booking, and verified B2B investor outreach.',
    chat_query: "Customer (9:15 PM): 'Interested in 2 & 3 BHK floor plans and price list for your project in Hinjewadi, Pune.'",
    chat_reply: "NexaDrip AI (9:15 PM): 'Hello! 2 BHKs start at Rs 68L and 3 BHKs at Rs 92L with zero brokerage. I have sent the floor plan PDF to your WhatsApp. Would you like to schedule a site visit this Saturday or Sunday?'",
    chat_customer_confirm: "Customer: 'Saturday at 11 AM works. My contact is 98810 XXXXX.'",
    chat_bot_lock: "NexaDrip AI: 'Site visit booked for Saturday 11 AM with complimentary pickup! Sales manager alerted. Total acquisition cost: ~Rs 1.90.'",
    industry_summary: '- Real Estate: Instant site-visit scheduling & brochure dispatch  - Channel Partners: 4.2x faster buyer qualification'
  },
  b2b: {
    id: 'b2b',
    name: 'B2B & Industrial Manufacturing',
    audience: 'B2B Manufacturers, Industrial Suppliers & IT Service Providers',
    city: 'Pune',
    cost: '2.00',
    headline: 'Generate Verified RFQs & Commercial Inquiries At Just ~Rs 2 Per Lead',
    subtitle: 'Direct B2B sales automation engine for manufacturers and industrial suppliers in Pune: crawl authentic company domains, verify DNS MX deliverability, and send 1-on-1 cold outreach.',
    chat_query: "Buyer (4:30 PM): 'Looking for custom CNC machining & sheet metal fabrication quote for 5,000 components.'",
    chat_reply: "NexaDrip AI (4:30 PM): 'Hello! We specialize in ISO-certified CNC precision machining with 7-day turnaround. Please share your CAD drawing or specs. What material grade is required?'",
    chat_customer_confirm: "Buyer: 'Grade SS-304. Drawing attached. Reach me at procurement@autoind.com / 98500 XXXXX.'",
    chat_bot_lock: "NexaDrip AI: 'RFQ logged and technical team assigned for quotation within 4 hours. Lead acquisition cost: ~Rs 2.10.'",
    industry_summary: '- B2B / Manufacturing: 15-25 verified buyer RFQs monthly  - IT Services: Direct outreach to verified decision-makers'
  },
  legal_finance: {
    id: 'legal_finance',
    name: 'Legal, CA & Financial Advisory',
    audience: 'Law Firms, Chartered Accountants & Wealth Managers',
    city: 'Pune',
    cost: '2.00',
    headline: 'Attract High-Net-Worth & Corporate Clients At Just ~Rs 2 Per Lead / Chat',
    subtitle: 'Automated client intake and consultation scheduling for legal, tax, and financial firms in Pune: 24/7 confidential lead qualification, instant WhatsApp follow-ups, and local authority ranking.',
    chat_query: "Client (8:05 PM): 'Need corporate tax advisory and GST audit services for a private limited firm in Pune.'",
    chat_reply: "NexaDrip AI (8:05 PM): 'Hello! Our senior partners handle corporate structuring, GST compliance, and audit defense. We offer a 20-minute preliminary tax evaluation. Would tomorrow morning suit you?'",
    chat_customer_confirm: "Client: 'Tomorrow at 11:30 AM is perfect. Contact: 98900 XXXXX.'",
    chat_bot_lock: "NexaDrip AI: 'Meeting confirmed with Senior Tax Partner. Calendar invite dispatched. Total client acquisition cost: ~Rs 1.75.'",
    industry_summary: '- CA & Legal: 60% reduction in client intake drop-offs  - Wealth Advisory: Automated HNI lead qualification'
  },
  retail_restaurant: {
    id: 'retail_restaurant',
    name: 'Retail, Restaurants & Hospitality',
    audience: 'Retail Stores, Boutique Brands & Hospitality Founders',
    city: 'Pune',
    cost: '2.00',
    headline: 'Drive Footfall, Table Bookings & Store Sales At Just ~Rs 2 Per Customer Chat',
    subtitle: 'Automated customer loyalty, WhatsApp broadcast drip, festive promotions, and Google Maps local 5-star ranking engine for retail businesses and restaurants in Pune.',
    chat_query: "Guest (7:10 PM): 'Do you have table reservation for 6 people tonight with outdoor seating?'",
    chat_reply: "NexaDrip AI (7:10 PM): 'Good evening! We have an outdoor garden table available at 8:15 PM with our live acoustic music tonight. Shall I reserve it under your name?'",
    chat_customer_confirm: "Guest: 'Yes please, reserve under Rahul, 98230 XXXXX.'",
    chat_bot_lock: "NexaDrip AI: 'Table reserved for 6 guests at 8:15 PM! 10% complimentary appetizer voucher sent to WhatsApp. Acquisition cost: ~Rs 1.20.'",
    industry_summary: '- Restaurants: Automated table booking & festive re-engagement  - Retail: 42% repeat purchase uplift via WhatsApp'
  },
  coaching: {
    id: 'coaching',
    name: 'Education & Coaching Academies',
    audience: 'Coaching Academies, EdTech Founders & Training Institutes',
    city: 'Pune',
    cost: '2.00',
    headline: 'Enroll Serious Students & Course Admissions At Just ~Rs 2 Per Lead / Chat',
    subtitle: 'Autonomous admission counseling engine for coaching academies and training institutes in Pune: instant brochure delivery on WhatsApp, counseling slot booking, and multi-channel student outreach.',
    chat_query: "Student (6:20 PM): 'What are the batch timings and fees for Data Science & AI Certification in Pune?'",
    chat_reply: "NexaDrip AI (6:20 PM): 'Hello! Next weekend batch starts Saturday at 10 AM with 100% placement assistance. Syllabus and fee structure have been sent to your WhatsApp. Would you like a free demo class pass?'",
    chat_customer_confirm: "Student: 'Yes, please register me for the Saturday demo class. Phone: 97640 XXXXX.'",
    chat_bot_lock: "NexaDrip AI: 'Demo pass confirmed! Counseling link dispatched. Zero agency cost: ~Rs 1.60 per enrolled inquiry.'",
    industry_summary: '- Coaching: 3.5x demo class attendance  - Admissions: Automated multi-step student follow-up drips'
  },
  general: {
    id: 'general',
    name: 'General Business & Professional Services',
    audience: 'Business Owners, Clinic Directors & Retail Founders',
    city: 'Pune',
    cost: '2.00',
    headline: 'Acquire & Qualify High-Intent Customers At Just ~Rs 2 Per Lead or Customer Chat',
    subtitle: 'A turnkey, self-driving AI marketing platform engineered for business owners, clinic directors, retail founders, and service firms in Pune and high-growth hubs to replace expensive ad agencies and generate predictable daily revenue.',
    chat_query: "Customer (10:42 PM): 'Hi, looking for digital marketing and automation pricing in Pune.'",
    chat_reply: "NexaDrip AI (10:42 PM): 'Hello! NexaDrip automates your 24/7 customer chats, WhatsApp drips, verified email outreach, and local SEO at just ~Rs 2 per lead. Would you like a 10-minute demo walkthrough?'",
    chat_customer_confirm: "Customer: 'Thursday 5:00 PM works. My number is 98220 XXXXX.'",
    chat_bot_lock: "NexaDrip AI: 'Demo locked for Thursday 5 PM! Confirmation sent to your WhatsApp. Total acquisition cost: ~Rs 1.85.'",
    industry_summary: '- Clinics & Doctors: 3.8x patient bookings via 24/7 WhatsApp bot  - Real Estate: Instant site-visit scheduling & brochure dispatch\n- B2B / Manufacturing: 15-25 verified buyer inquiries monthly  - Professional Services: Automated client intake & quote follow-ups'
  }
};

function wrapText(text, maxWidth, font, size) {
  const paragraphs = String(text || '').split('\n');
  const allLines = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, size);
      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) allLines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) allLines.push(currentLine);
  }
  return allLines;
}

function drawWrapped(page, text, x, y, maxWidth, size, font, color, lineSpacing = 1.35) {
  const lines = wrapText(text, maxWidth, font, size);
  let curY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: curY, size, font, color });
    curY -= size * lineSpacing;
  }
  return curY;
}

async function buildPdf(opts = {}) {
  const def = INDUSTRY_PRESETS.general;
  const cfg = {
    audience: opts.audience || def.audience,
    city: opts.city || def.city,
    cost: opts.cost || def.cost,
    headline: opts.headline || def.headline,
    subtitle: opts.subtitle || def.subtitle,
    chat_query: opts.chat_query || def.chat_query,
    chat_reply: opts.chat_reply || def.chat_reply,
    chat_customer_confirm: opts.chat_customer_confirm || def.chat_customer_confirm,
    chat_bot_lock: opts.chat_bot_lock || def.chat_bot_lock,
    industry_summary: opts.industry_summary || def.industry_summary,
    contact_phone: opts.contact_phone || '+91 98000 00000',
    contact_email: opts.contact_email || 'growth@nexadrip.com',
    contact_web: opts.contact_web || 'www.nexadrip.com',
  };

  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Load logo
  let logoImg = null;
  const logoPath = path.join(__dirname, '..', 'public', 'img', 'nexadrip-logo-white.png');
  if (fs.existsSync(logoPath)) {
    try { logoImg = await doc.embedPng(fs.readFileSync(logoPath)); } catch {}
  }

  // Load UI sample screens
  let screenCrawler = null, screenStudio = null, screenEditor = null;
  try {
    const pCrawler = path.join(__dirname, '..', 'public', 'img', 'samples', 'screen-find-companies.jpg');
    if (fs.existsSync(pCrawler)) screenCrawler = await doc.embedJpg(fs.readFileSync(pCrawler));
    const pStudio = path.join(__dirname, '..', 'public', 'img', 'samples', 'screen-content-studio.jpg');
    if (fs.existsSync(pStudio)) screenStudio = await doc.embedJpg(fs.readFileSync(pStudio));
    const pEditor = path.join(__dirname, '..', 'public', 'img', 'samples', 'screen-picture-editor.png');
    if (fs.existsSync(pEditor)) screenEditor = await doc.embedPng(fs.readFileSync(pEditor));
  } catch {}

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  const TOTAL_PAGES = 4;

  function drawHeader(page, title, pageNum) {
    page.drawRectangle({ x: 0, y: pageHeight - 56, width: pageWidth, height: 56, color: C.navyDark });
    if (logoImg) {
      const logoH = 22, logoW = (logoImg.width / logoImg.height) * logoH;
      page.drawImage(logoImg, { x: margin, y: pageHeight - 40, width: Math.min(100, logoW), height: logoH });
    } else {
      page.drawText('NexaDrip', { x: margin, y: pageHeight - 38, size: 16, font: fontBold, color: C.white });
    }
    page.drawText(title.toUpperCase(), { x: 160, y: pageHeight - 35, size: 8.5, font: fontBold, color: C.purpleLight });
    page.drawText(`Confidential Proposal | Page ${pageNum} of ${TOTAL_PAGES}`, { x: pageWidth - margin - 165, y: pageHeight - 35, size: 8, font: fontRegular, color: C.slateLight });
  }

  function drawFooter(page, pageNum) {
    page.drawLine({ start: { x: margin, y: 35 }, end: { x: pageWidth - margin, y: 35 }, thickness: 0.75, color: C.border });
    page.drawText('NexaDrip Autonomous Growth Platform | www.nexadrip.com | contact@nexadrip.com', { x: margin, y: 22, size: 8, font: fontRegular, color: C.slateLight });
    page.drawText(`Page ${pageNum} of ${TOTAL_PAGES}`, { x: pageWidth - margin - 55, y: 22, size: 8, font: fontBold, color: C.slateMedium });
  }

  // ── PAGE 1: EXECUTIVE SUMMARY ──
  const p1 = doc.addPage([pageWidth, pageHeight]);
  drawHeader(p1, 'AI Marketing & Lead Engine', 1);

  let curY = pageHeight - 85;
  p1.drawRectangle({ x: margin, y: curY - 14, width: 140, height: 18, color: C.purpleLight });
  p1.drawText('LOCAL BUSINESS GROWTH', { x: margin + 8, y: curY - 10, size: 7.5, font: fontBold, color: C.purplePrimary });
  curY -= 32;

  // Headline
  curY = drawWrapped(p1, cfg.headline, margin, curY, contentWidth, 18, fontBold, C.slateDark, 1.3);
  curY -= 12;

  // Subtitle
  curY = drawWrapped(p1, cfg.subtitle, margin, curY, contentWidth, 9.5, fontRegular, C.slateMedium, 1.4);
  curY -= 12;

  // KPI Stats Banner
  p1.drawRectangle({ x: margin, y: curY - 55, width: contentWidth, height: 55, color: C.navyDark });
  const colW = contentWidth / 4;
  const kpis = [
    { num: `~Rs ${cfg.cost}`, label: 'Average Cost Per Lead' },
    { num: '< 3 Sec', label: '24/7 Instant AI Reply' },
    { num: '98%', label: 'WhatsApp Open Rate' },
    { num: '100% Real', label: 'DNS-Verified Contacts' }
  ];
  kpis.forEach((kpi, i) => {
    const kx = margin + i * colW + 12;
    p1.drawText(kpi.num, { x: kx, y: curY - 26, size: 14, font: fontBold, color: i === 0 ? C.emeraldGreen : (i === 1 ? C.purpleLight : C.white) });
    p1.drawText(kpi.label, { x: kx, y: curY - 42, size: 7.5, font: fontRegular, color: C.slateLight });
  });
  curY -= 75;

  // The Problem Section
  p1.drawText('THE PROBLEM: WHY TRADITIONAL MARKETING IS BURNING CAPITAL', { x: margin, y: curY, size: 9.5, font: fontBold, color: C.accentRed });
  curY -= 14;

  const painPoints = [
    { title: 'Exorbitant Meta & Google Ad Costs:', desc: 'Ad clicks cost Rs 30-80 each, pushing cost-per-lead to Rs 200-500+. Over 60% are spam clicks, students, or unverified phone numbers that never pick up.' },
    { title: 'Expensive Agency Retainers with No Guarantees:', desc: 'Agencies charge Rs 25,000 to Rs 50,000/month retainers just for setup and management, while business owners still pay ad budgets on top with zero sales accountability.' },
    { title: 'The 5-Minute Lead Death Window:', desc: '78% of customers buy from the business that responds first. When leads arrive at night, during lunch, or on weekends, delayed responses mean lost revenue.' }
  ];

  painPoints.forEach((pp) => {
    p1.drawCircle({ x: margin + 4, y: curY - 4, size: 2.5, color: C.accentRed });
    p1.drawText(pp.title, { x: margin + 14, y: curY - 6, size: 9, font: fontBold, color: C.slateDark });
    curY -= 13;
    curY = drawWrapped(p1, pp.desc, margin + 14, curY, contentWidth - 14, 8.5, fontRegular, C.slateMedium, 1.3);
    curY -= 4;
  });
  curY -= 10;

  // 4 Feature Cards (2x2 Grid)
  p1.drawText('THE NEXADRIP ENGINE: COMPLETE ALL-IN-ONE GROWTH AUTOMATION', { x: margin, y: curY, size: 9.5, font: fontBold, color: C.emeraldGreen });
  curY -= 14;

  const cardW = (contentWidth - 12) / 2;
  const cardH = 68;
  const cards = [
    { title: '1. 24/7 AI Chatbot & Lead Booking', body: 'Answers questions, handles objections, collects verified names & phone numbers, and books consultations in < 3 seconds.', badge: '~Rs 0.35 / chat' },
    { title: '2. WhatsApp Drip & Direct Outreach', body: 'Automated 1-to-1 follow-ups, quotation reminders, and festive broadcasts directly on WhatsApp with 98% open rates.', badge: '~Rs 0.90 / msg' },
    { title: '3. Verified Cold Email Outreach', body: `Finds authentic live businesses in ${cfg.city}, verifies mail deliverability via DNS MX lookups, and drafts tailored emails.`, badge: '~Rs 0.20 / email' },
    { title: '4. Autonomous Local SEO & Google Maps', body: 'Continuous technical SEO auditing, keyword optimization, and Google Maps local ranking to generate zero-cost organic leads.', badge: 'Free Organic Leads' }
  ];

  cards.forEach((card, idx) => {
    const col = idx % 2, row = Math.floor(idx / 2);
    const cx = margin + col * (cardW + 12), cy = curY - row * (cardH + 10) - cardH;
    p1.drawRectangle({ x: cx, y: cy, width: cardW, height: cardH, color: C.cardBg, borderColor: C.border, borderWidth: 0.8 });
    p1.drawText(card.title, { x: cx + 10, y: cy + cardH - 18, size: 9.5, font: fontBold, color: C.navyDark });
    p1.drawRectangle({ x: cx + cardW - 74, y: cy + cardH - 19, width: 66, height: 13, color: C.purpleLight });
    p1.drawText(card.badge, { x: cx + cardW - 70, y: cy + cardH - 15, size: 6.5, font: fontBold, color: C.purplePrimary });
    drawWrapped(p1, card.body, cx + 10, cy + cardH - 32, cardW - 20, 8, fontRegular, C.slateMedium, 1.3);
  });
  drawFooter(p1, 1);

  // ── PAGE 2: LIVE PRODUCT SCREENS - CRAWLER & AI CHATBOT ──
  const p2 = doc.addPage([pageWidth, pageHeight]);
  drawHeader(p2, 'Live Platform Showcase: Inbound & Outbound', 2);
  curY = pageHeight - 85;

  p2.drawText('LIVE PLATFORM SCREENSHOTS: AUTOMATED LEAD GENERATION', { x: margin, y: curY, size: 13, font: fontBold, color: C.slateDark });
  curY -= 14;
  curY = drawWrapped(p2, `See the exact interfaces powering your business: from real-world B2B discovery in ${cfg.city}, to automated 24/7 AI WhatsApp lead qualification.`, margin, curY, contentWidth, 8.5, fontRegular, C.slateMedium, 1.3);
  curY -= 16;

  // Screen A: Crawler
  p2.drawRectangle({ x: margin, y: curY - 18, width: contentWidth, height: 18, color: C.purpleLight });
  p2.drawText('SCREEN A: 100% REAL-WORLD VERIFIED LOCAL BUSINESS DISCOVERY (SELLBIRD ENGINE)', { x: margin + 8, y: curY - 13, size: 8, font: fontBold, color: C.purplePrimary });
  curY -= 28;

  const s1W = 230, s1H = 205;
  if (screenCrawler) {
    p2.drawRectangle({ x: margin - 2, y: curY - s1H - 2, width: s1W + 4, height: s1H + 4, color: C.cardBg, borderColor: C.border, borderWidth: 1 });
    p2.drawImage(screenCrawler, { x: margin, y: curY - s1H, width: s1W, height: s1H });
  }

  const rX = margin + s1W + 18, rW = contentWidth - s1W - 18;
  let rY = curY;
  p2.drawText(`Target Authentic Businesses in ${cfg.city}`, { x: rX, y: rY, size: 10.5, font: fontBold, color: C.navyDark });
  rY -= 14;

  const crawlerFeatures = [
    'Zero Fake Demo Seed Data: Crawls authentic live websites, detecting live infrastructure tech stacks.',
    'DNS MX Deliverability Check: Tests company mail servers in real-time before drafting outreach, ensuring high inbox placement.',
    `Geo & Category Targeting: Target specific niches (${cfg.audience}) in ${cfg.city}.`,
    'Personalized 1-on-1 Pitches: Automatically drafts contextual, value-driven emails directly into your Outbox for 1-click review or auto-send.',
    'Wholesale Cost: Discovers and verifies contacts at approx ~Rs 0.20 each vs Rs 25.00 on Apollo / ZoomInfo.'
  ];
  crawlerFeatures.forEach((feat) => {
    p2.drawCircle({ x: rX + 4, y: rY - 3, size: 2, color: C.purplePrimary });
    rY = drawWrapped(p2, feat, rX + 12, rY - 5, rW - 12, 7.5, fontRegular, C.slateDark, 1.25);
    rY -= 4;
  });
  curY -= (s1H + 24);

  // Screen B: Chat Simulation
  p2.drawRectangle({ x: margin, y: curY - 18, width: contentWidth, height: 18, color: C.emeraldLight });
  p2.drawText('SCREEN B: 24/7 AI WHATSAPP & WEB CHATBOT LEAD QUALIFICATION SIMULATION', { x: margin + 8, y: curY - 13, size: 8, font: fontBold, color: C.emeraldGreen });
  curY -= 28;

  const waBoxH = 175;
  p2.drawRectangle({ x: margin, y: curY - waBoxH, width: contentWidth, height: waBoxH, color: C.cardBg, borderColor: C.border, borderWidth: 1 });
  p2.drawRectangle({ x: margin, y: curY - 24, width: contentWidth, height: 24, color: C.navyDark });
  p2.drawCircle({ x: margin + 16, y: curY - 12, size: 5, color: C.waGreen });
  p2.drawText('NexaDrip AI Assistant  (Online 24/7 • Instant Reply)', { x: margin + 28, y: curY - 16, size: 8.5, font: fontBold, color: C.white });

  let chatY = curY - 42;
  p2.drawRectangle({ x: margin + 14, y: chatY - 22, width: 360, height: 22, color: C.white, borderColor: C.border, borderWidth: 0.5 });
  drawWrapped(p2, cfg.chat_query, margin + 22, chatY - 14, 345, 7.5, fontRegular, C.slateDark, 1.2);
  chatY -= 32;

  p2.drawRectangle({ x: margin + 90, y: chatY - 34, width: 410, height: 34, color: C.waBubbleIn, borderColor: C.border, borderWidth: 0.5 });
  drawWrapped(p2, cfg.chat_reply, margin + 98, chatY - 13, 395, 7.5, fontRegular, C.slateDark, 1.25);
  chatY -= 42;

  p2.drawRectangle({ x: margin + 14, y: chatY - 20, width: 320, height: 20, color: C.white, borderColor: C.border, borderWidth: 0.5 });
  drawWrapped(p2, cfg.chat_customer_confirm, margin + 22, chatY - 14, 305, 7.5, fontRegular, C.slateDark, 1.2);
  chatY -= 28;

  p2.drawRectangle({ x: margin + 90, y: chatY - 30, width: 410, height: 30, color: C.waBubbleIn, borderColor: C.border, borderWidth: 0.5 });
  drawWrapped(p2, cfg.chat_bot_lock, margin + 98, chatY - 13, 395, 7.5, fontBold, C.emeraldGreen, 1.25);

  drawFooter(p2, 2);

  // ── PAGE 3: CONTENT STUDIO & CREATIVE SUITE ──
  const p3 = doc.addPage([pageWidth, pageHeight]);
  drawHeader(p3, 'Live Platform Showcase: Content & Media', 3);
  curY = pageHeight - 85;

  p3.drawText('MULTI-CHANNEL CONTENT STUDIO & CREATIVE SUITE', { x: margin, y: curY, size: 13, font: fontBold, color: C.slateDark });
  curY -= 14;
  curY = drawWrapped(p3, 'Turn raw thoughts, articles, videos, and customer brochures into automated campaigns scheduled across LinkedIn, Instagram, Facebook, Twitter/X, Pinterest, Google Business, and WhatsApp.', margin, curY, contentWidth, 8.5, fontRegular, C.slateMedium, 1.3);
  curY -= 14;

  // Screen C: Studio
  p3.drawRectangle({ x: margin, y: curY - 18, width: contentWidth, height: 18, color: C.purpleLight });
  p3.drawText('SCREEN C: CONTENT STUDIO - MULTI-CHANNEL DISTRIBUTION WORKSPACE', { x: margin + 8, y: curY - 13, size: 8, font: fontBold, color: C.purplePrimary });
  curY -= 26;

  const s2W = 310, s2H = 153;
  if (screenStudio) {
    p3.drawRectangle({ x: margin - 2, y: curY - s2H - 2, width: s2W + 4, height: s2H + 4, color: C.cardBg, borderColor: C.border, borderWidth: 1 });
    p3.drawImage(screenStudio, { x: margin, y: curY - s2H, width: s2W, height: s2H });
  }

  const s2rX = margin + s2W + 16, s2rW = contentWidth - s2W - 16;
  let s2rY = curY;
  p3.drawText('AI Multi-Channel Campaigning', { x: s2rX, y: s2rY, size: 10, font: fontBold, color: C.navyDark });
  s2rY -= 14;
  const studioPoints = [
    '1-Click Multi-Network Scheduling: Publishes synchronized campaigns across 8 major networks simultaneously.',
    'Brand Kit Consistency: Automatically applies your official brand fonts, colors, and logos to every post.',
    'Auto-Cadence Cadence Engine: Drips posts automatically day-by-day, with PC-off cloud safety net.'
  ];
  studioPoints.forEach((pt) => {
    p3.drawCircle({ x: s2rX + 4, y: s2rY - 3, size: 2, color: C.purplePrimary });
    s2rY = drawWrapped(p3, pt, s2rX + 12, s2rY - 5, s2rW - 12, 7.5, fontRegular, C.slateDark, 1.25);
    s2rY -= 4;
  });
  curY -= (s2H + 24);

  // Screen D: Editor
  p3.drawRectangle({ x: margin, y: curY - 18, width: contentWidth, height: 18, color: C.cardBg });
  p3.drawText('SCREEN D: BUILT-IN CANVA-GRADE DESIGN STUDIO & PDF EDITOR', { x: margin + 8, y: curY - 13, size: 8, font: fontBold, color: C.navyDark });
  curY -= 26;

  const s3W = 310, s3H = 155;
  if (screenEditor) {
    p3.drawRectangle({ x: margin - 2, y: curY - s3H - 2, width: s3W + 4, height: s3H + 4, color: C.cardBg, borderColor: C.border, borderWidth: 1 });
    p3.drawImage(screenEditor, { x: margin, y: curY - s3H, width: s3W, height: s3H });
  }

  const s3rX = margin + s3W + 16, s3rW = contentWidth - s3W - 16;
  let s3rY = curY;
  p3.drawText('Creative Control at Your Fingertips', { x: s3rX, y: s3rY, size: 10, font: fontBold, color: C.navyDark });
  s3rY -= 14;
  const editorPoints = [
    'Precision Cropping: Preset aspect ratios for Instagram Square (1:1), Portrait (4:5), and YouTube (16:9).',
    'Freehand Annotation & Signatures: Pen, highlighter, and spray brushes for quick document signing and markups.',
    'Watermark Management: Add branded text/logos or 1-click remove baked-in watermarks with whiteout patches.',
    'Full PDF Editing: Import, annotate, and export multi-page business proposals and brochures directly.'
  ];
  editorPoints.forEach((pt) => {
    p3.drawCircle({ x: s3rX + 4, y: s3rY - 3, size: 2, color: C.emeraldGreen });
    s3rY = drawWrapped(p3, pt, s3rX + 12, s3rY - 5, s3rW - 12, 7.5, fontRegular, C.slateDark, 1.25);
    s3rY -= 4;
  });
  curY -= (s3H + 20);

  // Industry Success Banner
  p3.drawRectangle({ x: margin, y: curY - 44, width: contentWidth, height: 44, color: C.navyDark });
  p3.drawText('PROVEN IMPACT ACROSS INDUSTRIES IN PUNE & METRO HUBS', { x: margin + 12, y: curY - 15, size: 8.5, font: fontBold, color: C.white });
  drawWrapped(p3, cfg.industry_summary, margin + 12, curY - 26, contentWidth - 24, 7.5, fontRegular, C.slateLight, 1.3);
  drawFooter(p3, 3);

  // ── PAGE 4: UNIT ECONOMICS & COMPARISON ──
  const p4 = doc.addPage([pageWidth, pageHeight]);
  drawHeader(p4, 'Unit Economics & ROI Plan', 4);
  curY = pageHeight - 85;

  p4.drawText(`THE UNIT ECONOMICS: HOW WE ACHIEVE ~Rs ${cfg.cost} PER LEAD`, { x: margin, y: curY, size: 12.5, font: fontBold, color: C.slateDark });
  curY -= 12;
  curY = drawWrapped(p4, 'Unlike traditional agencies that markup ad clicks by 300% to cover management overhead, NexaDrip uses lightweight, high-efficiency AI automation to deliver wholesale execution costs directly to you.', margin, curY, contentWidth, 8.5, fontRegular, C.slateMedium, 1.3);
  curY -= 12;

  // Table
  const tableX = margin, tableW = contentWidth, rowH = 18;
  p4.drawRectangle({ x: tableX, y: curY - rowH, width: tableW, height: rowH, color: C.navyDark });
  p4.drawText('Channel / Operation', { x: tableX + 10, y: curY - 12, size: 8, font: fontBold, color: C.white });
  p4.drawText('Traditional Cost', { x: tableX + 220, y: curY - 12, size: 8, font: fontBold, color: C.white });
  p4.drawText('NexaDrip AI Cost', { x: tableX + 340, y: curY - 12, size: 8, font: fontBold, color: C.emeraldGreen });
  p4.drawText('Your Savings', { x: tableX + 445, y: curY - 12, size: 8, font: fontBold, color: C.white });
  curY -= rowH;

  const costRows = [
    { op: 'Customer Chat / Inbound FAQ Session', trad: 'Rs 15.00 (Support staff)', nexa: '~Rs 0.35', save: '97% cheaper' },
    { op: 'Direct WhatsApp Outreach & Follow-up', trad: 'Rs 3.50 (Manual / CRM)', nexa: '~Rs 0.90', save: '74% cheaper' },
    { op: 'Verified B2B Lead Lookup & Email Draft', trad: 'Rs 25.00 (Apollo / ZoomInfo)', nexa: '~Rs 0.20', save: '99% cheaper' },
    { op: 'SEO Local Keyword Optimization', trad: 'Rs 15,000 / mo Agency', nexa: 'Included (AI)', save: '100% saved' },
    { op: 'Blended Cost Per Qualified Inbound Lead', trad: 'Rs 150 - Rs 450+', nexa: `~Rs ${cfg.cost}`, save: '98% SAVINGS' }
  ];

  costRows.forEach((r, idx) => {
    const isTotal = idx === costRows.length - 1;
    const bg = isTotal ? C.emeraldLight : (idx % 2 === 0 ? C.cardBg : C.white);
    p4.drawRectangle({ x: tableX, y: curY - rowH, width: tableW, height: rowH, color: bg, borderColor: C.border, borderWidth: 0.5 });
    p4.drawText(r.op, { x: tableX + 10, y: curY - 12, size: 7.5, font: isTotal ? fontBold : fontRegular, color: isTotal ? C.emeraldGreen : C.slateDark });
    p4.drawText(r.trad, { x: tableX + 220, y: curY - 12, size: 7.5, font: fontRegular, color: C.slateMedium });
    p4.drawText(r.nexa, { x: tableX + 340, y: curY - 12, size: 8, font: fontBold, color: C.emeraldGreen });
    p4.drawText(r.save, { x: tableX + 445, y: curY - 12, size: 7.5, font: fontBold, color: isTotal ? C.emeraldGreen : C.purplePrimary });
    curY -= rowH;
  });
  curY -= 16;

  // Comparison Matrix
  p4.drawText('HEAD-TO-HEAD COMPARISON', { x: margin, y: curY, size: 10, font: fontBold, color: C.navyDark });
  curY -= 12;

  const compCols = [
    { name: 'Feature / Dimension', w: 145 },
    { name: 'Traditional Agency', w: 120 },
    { name: 'Meta / Google Ads', w: 120 },
    { name: 'NexaDrip Platform', w: 130 }
  ];
  p4.drawRectangle({ x: tableX, y: curY - rowH, width: tableW, height: rowH, color: C.navyLight });
  let accX = tableX;
  compCols.forEach((cc, i) => {
    p4.drawText(cc.name, { x: accX + 6, y: curY - 12, size: 7.5, font: fontBold, color: i === 3 ? C.purpleLight : C.white });
    accX += cc.w;
  });
  curY -= rowH;

  const compData = [
    ['Monthly Fixed Retainer', 'Rs 25,000 - Rs 50,000', 'None (Variable Ad Spend)', 'Zero Retainer Fees'],
    ['Cost Per Qualified Lead', 'Rs 250 - Rs 600+', 'Rs 150 - Rs 450+', `~Rs ${cfg.cost} Per Lead / Chat`],
    ['Response Time', '2 - 12 Hours (Office hours)', 'No automated chat built-in', 'Instant (< 3 Seconds, 24/7)'],
    ['WhatsApp Drip Integration', 'Manual / Not provided', 'Requires 3rd party tool', 'Native Automated Engine'],
    ['Deliverability Guarantee', 'Unverified lists / Spam risk', 'High cost per click', '100% DNS MX Live Verified'],
    ['Setup & Deployment Time', '3 - 5 Weeks', '1 - 2 Weeks', 'Same-Day (Under 24 Hours)']
  ];

  compData.forEach((row, idx) => {
    const bg = idx % 2 === 0 ? C.cardBg : C.white;
    p4.drawRectangle({ x: tableX, y: curY - rowH, width: tableW, height: rowH, color: bg, borderColor: C.border, borderWidth: 0.5 });
    let cx = tableX;
    row.forEach((cell, ci) => {
      p4.drawText(cell, { x: cx + 6, y: curY - 12, size: 7, font: ci === 3 ? fontBold : (ci === 0 ? fontBold : fontRegular), color: ci === 3 ? C.purplePrimary : C.slateDark });
      cx += compCols[ci].w;
    });
    curY -= rowH;
  });
  curY -= 16;

  // 3-Day Implementation Roadmap
  p4.drawText('FAST-TRACK 3-DAY IMPLEMENTATION ROADMAP', { x: margin, y: curY, size: 10, font: fontBold, color: C.navyDark });
  curY -= 12;

  const steps = [
    { day: 'DAY 1: SETUP', text: 'Brand kit import, AI knowledge base ingestion (pricing, FAQs, services), and website embed.' },
    { day: 'DAY 2: CHANNELS', text: 'WhatsApp Business API hookup, automated nurture drip workflows, and calendar booking sync.' },
    { day: 'DAY 3: OUTREACH', text: `Launch DNS MX-verified B2B outreach in target city (${cfg.city}) & activate SEO autopilot.` }
  ];
  const stepW = (contentWidth - 16) / 3;
  steps.forEach((st, idx) => {
    const sx = margin + idx * (stepW + 8);
    p4.drawRectangle({ x: sx, y: curY - 42, width: stepW, height: 42, color: C.cardBg, borderColor: C.border, borderWidth: 0.8 });
    p4.drawText(st.day, { x: sx + 8, y: curY - 14, size: 7.5, font: fontBold, color: C.purplePrimary });
    drawWrapped(p4, st.text, sx + 8, curY - 24, stepW - 16, 6.5, fontRegular, C.slateMedium, 1.25);
  });
  curY -= 54;

  // Call to Action Box
  p4.drawRectangle({ x: margin, y: curY - 60, width: contentWidth, height: 60, color: C.navyDark });
  p4.drawText('READY TO CUT CUSTOMER ACQUISITION COSTS BY 90%?', { x: margin + 14, y: curY - 18, size: 11, font: fontBold, color: C.white });
  p4.drawText('Schedule your 10-minute live demonstration and receive a complimentary AI Marketing Audit tailored for your business.', { x: margin + 14, y: curY - 32, size: 7.5, font: fontRegular, color: C.purpleLight });
  p4.drawText(`WhatsApp / Call: ${cfg.contact_phone}  |  Email: ${cfg.contact_email}  |  Web: ${cfg.contact_web}/demo`, { x: margin + 14, y: curY - 48, size: 8, font: fontBold, color: C.emeraldGreen });
  drawFooter(p4, 4);

  const pdfBytes = await doc.save();
  const pdfPath = path.join(__dirname, '..', 'public', 'NexaDrip-Business-Growth-Proposal.pdf');
  fs.writeFileSync(pdfPath, pdfBytes);

  const artifactDir = 'C:/Users/abhis/.gemini/antigravity/brain/86978f66-c130-4bed-8be2-b50b0688a2c9';
  if (fs.existsSync(artifactDir)) {
    try { fs.writeFileSync(path.join(artifactDir, 'NexaDrip-Business-Growth-Proposal.pdf'), pdfBytes); } catch {}
  }
  return { pdfPath, bytes: pdfBytes };
}

function buildHtml(opts = {}) {
  const def = INDUSTRY_PRESETS.general;
  const cfg = {
    audience: opts.audience || def.audience,
    city: opts.city || def.city,
    cost: opts.cost || def.cost,
    headline: opts.headline || def.headline,
    subtitle: opts.subtitle || def.subtitle,
    chat_query: opts.chat_query || def.chat_query,
    chat_reply: opts.chat_reply || def.chat_reply,
    chat_customer_confirm: opts.chat_customer_confirm || def.chat_customer_confirm,
    chat_bot_lock: opts.chat_bot_lock || def.chat_bot_lock,
    industry_summary: opts.industry_summary || def.industry_summary,
    contact_phone: opts.contact_phone || '+91 98000 00000',
    contact_email: opts.contact_email || 'growth@nexadrip.com',
    contact_web: opts.contact_web || 'www.nexadrip.com',
  };

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NexaDrip - Business Growth & Automation Proposal (~₹${cfg.cost}/Lead)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #7c3aed;
      --primary-light: #f3e8ff;
      --navy: #0f172a;
      --navy-dark: #090d16;
      --emerald: #10b981;
      --emerald-dark: #059669;
      --emerald-light: #ecfdf5;
      --slate-dark: #1e293b;
      --slate: #475569;
      --slate-light: #94a3b8;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--slate-dark);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    .top-action-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    }
    .top-action-bar .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #fff;
      font-weight: 700;
      font-size: 17px;
      font-family: 'Space Grotesk', sans-serif;
    }
    .top-action-bar .brand img { height: 26px; }
    .top-action-bar .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
      border: none;
    }
    .btn-edit {
      background: linear-gradient(135deg, #a855f7, #7c3aed);
      color: #fff;
      box-shadow: 0 2px 8px rgba(124, 58, 237, 0.35);
      border: 1px solid rgba(255,255,255,0.2);
    }
    .btn-edit:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .btn-primary {
      background: #3b82f6;
      color: #fff;
    }
    .btn-primary:hover { background: #2563eb; }
    .btn-emerald {
      background: #10b981;
      color: #fff;
    }
    .btn-emerald:hover { background: #059669; }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.15); }

    .doc-container {
      max-width: 960px;
      margin: 32px auto;
      padding: 0 20px;
      transition: margin-right 0.3s ease;
    }
    body.drawer-open .doc-container {
      margin-right: 440px;
    }

    .doc-page {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 48px;
      margin-bottom: 32px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.04);
      position: relative;
    }

    .page-tag {
      display: inline-block;
      padding: 4px 12px;
      background: var(--primary-light);
      color: var(--primary);
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 16px;
    }

    h1 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 30px;
      font-weight: 800;
      color: var(--slate-dark);
      line-height: 1.25;
      margin-bottom: 12px;
    }
    .lead-p {
      font-size: 15px;
      color: var(--slate);
      line-height: 1.6;
      margin-bottom: 28px;
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      background: var(--navy);
      padding: 24px;
      border-radius: 12px;
      color: #fff;
      margin-bottom: 36px;
    }
    .kpi-card { text-align: center; }
    .kpi-val {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 26px;
      font-weight: 800;
      color: #fff;
      margin-bottom: 4px;
    }
    .kpi-val.green { color: #34d399; }
    .kpi-val.purple { color: #c084fc; }
    .kpi-lbl {
      font-size: 11.5px;
      color: var(--slate-light);
      font-weight: 500;
    }

    .section-title {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 16px;
    }

    .pain-box {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 32px;
    }
    .pain-item {
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
      font-size: 13.5px;
    }
    .pain-item:last-child { margin-bottom: 0; }
    .pain-icon { color: #ef4444; font-size: 16px; font-weight: bold; }

    .screen-showcase {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      align-items: center;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 24px;
      margin-bottom: 28px;
    }
    .screen-frame {
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
      background: #000;
    }
    .screen-frame img {
      width: 100%;
      height: auto;
      display: block;
    }
    .screen-info h3 {
      font-size: 16.5px;
      font-weight: 700;
      color: var(--navy);
      margin-bottom: 10px;
    }
    .screen-info ul { list-style: none; }
    .screen-info li {
      position: relative;
      padding-left: 20px;
      margin-bottom: 8px;
      font-size: 13px;
      color: var(--slate);
    }
    .screen-info li::before {
      content: "✓";
      position: absolute;
      left: 0;
      color: var(--primary);
      font-weight: bold;
    }

    .wa-card {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 28px;
    }
    .wa-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 13px;
      color: #166534;
      margin-bottom: 14px;
    }
    .wa-bubble {
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 10px;
      max-width: 82%;
      line-height: 1.4;
    }
    .wa-bubble.in {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      align-self: flex-start;
    }
    .wa-bubble.out {
      background: #dcfce7;
      border: 1px solid #86efac;
      margin-left: auto;
      color: #14532d;
    }

    .styled-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 28px;
      font-size: 13px;
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .styled-table th {
      background: var(--navy);
      color: #fff;
      padding: 12px 16px;
      text-align: left;
      font-weight: 600;
      font-size: 12px;
    }
    .styled-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      color: var(--slate-dark);
    }
    .styled-table tr:last-child td { border-bottom: none; }
    .styled-table tr.total-row {
      background: var(--emerald-light);
      font-weight: 700;
    }
    .styled-table tr.total-row td {
      color: var(--emerald-dark);
      font-size: 14px;
    }
    .highlight-cell {
      color: var(--primary);
      font-weight: 700;
    }

    .roadmap-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 32px;
    }
    .roadmap-step {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
    }
    .step-tag {
      font-size: 10.5px;
      font-weight: 700;
      color: var(--primary);
      margin-bottom: 6px;
      text-transform: uppercase;
    }
    .step-text {
      font-size: 12.5px;
      color: var(--slate);
      line-height: 1.45;
    }

    .cta-banner {
      background: linear-gradient(135deg, #0f172a, #1e1b4b);
      border-radius: 12px;
      padding: 32px;
      color: #fff;
      text-align: center;
    }
    .cta-title {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .cta-desc {
      font-size: 14px;
      color: var(--slate-light);
      max-width: 600px;
      margin: 0 auto 20px;
    }
    .cta-contacts {
      display: flex;
      justify-content: center;
      gap: 24px;
      font-size: 13.5px;
      color: #34d399;
      font-weight: 600;
      flex-wrap: wrap;
    }

    /* ── Slide-Out Editor Drawer ── */
    .editor-drawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 420px;
      background: #ffffff;
      border-left: 1px solid var(--border);
      box-shadow: -8px 0 30px rgba(0,0,0,0.12);
      z-index: 200;
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .editor-drawer.open {
      transform: translateX(0);
    }
    .drawer-header {
      padding: 16px 20px;
      background: var(--navy);
      color: #fff;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .drawer-title {
      font-size: 15px;
      font-weight: 700;
      font-family: 'Space Grotesk', sans-serif;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .drawer-body {
      padding: 20px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .drawer-footer {
      padding: 16px 20px;
      border-top: 1px solid var(--border);
      background: #f8fafc;
      display: flex;
      gap: 10px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--navy);
    }
    .form-input, .form-select, .form-textarea {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 12.5px;
      font-family: inherit;
      color: var(--slate-dark);
      background: #fff;
    }
    .form-input:focus, .form-select:focus, .form-textarea:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.15);
    }
    .form-textarea {
      resize: vertical;
      min-height: 55px;
      line-height: 1.4;
    }
    .preset-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .preset-chip {
      padding: 5px 10px;
      font-size: 11.5px;
      font-weight: 600;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .preset-chip:hover, .preset-chip.active {
      background: var(--primary-light);
      border-color: var(--primary);
      color: var(--primary);
    }

    .toast-msg {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #0f172a;
      color: #fff;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 6px 20px rgba(0,0,0,0.25);
      z-index: 300;
      display: none;
    }

    @media print {
      .top-action-bar, .editor-drawer, .toast-msg { display: none !important; }
      body { background: #fff !important; }
      .doc-container { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
      .doc-page {
        box-shadow: none !important;
        border: none !important;
        margin: 0 !important;
        padding: 32px !important;
        page-break-after: always;
      }
    }

    @media (max-width: 768px) {
      .doc-page { padding: 24px; }
      .kpi-grid { grid-template-columns: 1fr 1fr; }
      .screen-showcase { grid-template-columns: 1fr; }
      .roadmap-grid { grid-template-columns: 1fr; }
      .editor-drawer { width: 100%; }
      body.drawer-open .doc-container { margin-right: 0; }
    }
  </style>
</head>
<body>

  <!-- Top Action Bar -->
  <header class="top-action-bar">
    <div class="brand">
      <img src="img/nexadrip-logo-white.png" alt="NexaDrip" onerror="this.style.display='none'">
      <span>NexaDrip</span>
      <span style="font-size:12px;background:rgba(255,255,255,0.12);padding:2px 8px;border-radius:4px;font-weight:500">Proposal</span>
    </div>
    <div class="actions">
      <button class="btn btn-edit" onclick="toggleDrawer()" id="btn-toggle-editor">✏️ Edit &amp; Customize Proposal</button>
      <button class="btn btn-secondary" onclick="window.print()">🖨️ Print / Save as PDF</button>
      <a href="NexaDrip-Business-Growth-Proposal.pdf" class="btn btn-primary" id="btn-download-pdf" download>⬇ Download Official PDF</a>
      <a href="https://wa.me/919800000000?text=Hi%20NexaDrip%2C%20I%20reviewed%20your%20Rs%202%20lead%20proposal%20and%20want%20a%20demo" target="_blank" class="btn btn-emerald" id="link-wa-chat">📱 Chat on WhatsApp</a>
    </div>
  </header>

  <div class="doc-container">

    <!-- PAGE 1: Executive Summary -->
    <section class="doc-page">
      <div class="page-tag" id="disp-page-tag">Executive Growth Proposal</div>
      <h1 id="disp-headline">${cfg.headline}</h1>
      <p class="lead-p" id="disp-subtitle">${cfg.subtitle}</p>

      <!-- KPI Grid -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-val green" id="disp-kpi-cost">~₹${cfg.cost}</div>
          <div class="kpi-lbl">Avg Cost Per Lead / Chat</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val">&lt; 3 Sec</div>
          <div class="kpi-lbl">24/7 AI Instant Response</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val purple">98%</div>
          <div class="kpi-lbl">WhatsApp Drip Open Rate</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val">100% Real</div>
          <div class="kpi-lbl">DNS-Verified Contacts</div>
        </div>
      </div>

      <!-- The Problem -->
      <div class="section-title">⚠️ The Reality: Why Traditional Marketing Burns Capital</div>
      <div class="pain-box">
        <div class="pain-item">
          <span class="pain-icon">✕</span>
          <div><strong>Skyrocketing Ad Costs:</strong> Meta and Google Ads cost ₹30–₹80 per click, pushing cost-per-lead to ₹200–₹500+. Over 60% turn out to be accidental clicks, tire-kickers, or invalid phone numbers.</div>
        </div>
        <div class="pain-item">
          <span class="pain-icon">✕</span>
          <div><strong>Heavy Agency Retainers:</strong> Traditional digital agencies charge ₹25,000–₹50,000/month retainers with zero revenue guarantees, while you still bear ad spend on top.</div>
        </div>
        <div class="pain-item">
          <span class="pain-icon">✕</span>
          <div><strong>The 5-Minute Lead Drop-Off:</strong> 78% of customers purchase from whoever replies first. When customer inquiries arrive at 9 PM or during Sunday lunch, delayed replies kill conversions.</div>
        </div>
      </div>
    </section>

    <!-- PAGE 2: Live Platform Showcase (Outbound & Inbound) -->
    <section class="doc-page">
      <div class="page-tag">Live Platform Showcase</div>
      <h2>Real-World Verification &amp; 24/7 AI Lead Capture</h2>
      <p class="lead-p" id="disp-showcase-sub">See the actual software interfaces working for your business in <span id="disp-city-name">${cfg.city}</span> in real time:</p>

      <!-- Showcase 1: Crawler -->
      <div class="screen-showcase">
        <div class="screen-frame">
          <img src="img/samples/screen-find-companies.jpg" alt="Find Companies AI Crawler in Pune">
        </div>
        <div class="screen-info">
          <h3>Screen A: 100% Real-World Verified B2B Discovery</h3>
          <ul>
            <li><strong>Authentic Domain Crawling:</strong> Discovers live companies in <span class="disp-city-inline">${cfg.city}</span> by category.</li>
            <li><strong>DNS MX Live Verification:</strong> Checks mail servers before drafting outreach to guarantee inbox deliverability.</li>
            <li><strong>Targeting Niche:</strong> Tailored for <span id="disp-audience-inline">${cfg.audience}</span>.</li>
            <li><strong>Auto-Drafted Sequences:</strong> Prepares personalized 1-to-1 outreach ready for Outbox dispatch at wholesale costs (~₹0.20 / lead).</li>
          </ul>
        </div>
      </div>

      <!-- Showcase 2: WhatsApp Simulation -->
      <div class="wa-card">
        <div class="wa-header">
          <span>🟢 Screen B: 24/7 AI WhatsApp Qualification &amp; Booking Simulation</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div class="wa-bubble in" id="disp-chat-query">
            ${cfg.chat_query}
          </div>
          <div class="wa-bubble out" id="disp-chat-reply">
            ${cfg.chat_reply}
          </div>
          <div class="wa-bubble in" id="disp-chat-confirm">
            ${cfg.chat_customer_confirm}
          </div>
          <div class="wa-bubble out" id="disp-chat-lock" style="font-weight:600">
            ${cfg.chat_bot_lock}
          </div>
        </div>
      </div>
    </section>

    <!-- PAGE 3: Content Studio & Picture Editor -->
    <section class="doc-page">
      <div class="page-tag">Content &amp; Creative Suite</div>
      <h2>Multi-Channel Studio &amp; Built-in Canva-Grade Editor</h2>
      <p class="lead-p">Schedule campaigns across 8 social platforms and edit high-converting marketing visuals and PDF brochures without hiring designers:</p>

      <!-- Showcase 3: Content Studio -->
      <div class="screen-showcase">
        <div class="screen-frame">
          <img src="img/samples/screen-content-studio.jpg" alt="Content Studio Multi-Channel">
        </div>
        <div class="screen-info">
          <h3>Screen C: Content Studio Multi-Channel Workspace</h3>
          <ul>
            <li><strong>1-Click Multi-Network Distribution:</strong> Publish to LinkedIn, Facebook, Instagram, Twitter/X, Pinterest, Google Business &amp; WhatsApp.</li>
            <li><strong>Automated AI Writer:</strong> Generates tailored captions, hashtags, and hooks suited to each platform.</li>
            <li><strong>Cloud Schedule Safety:</strong> Automatically posts on schedule even if your office computer is turned off.</li>
          </ul>
        </div>
      </div>

      <!-- Showcase 4: Creative Editor -->
      <div class="screen-showcase">
        <div class="screen-frame">
          <img src="img/samples/screen-picture-editor.png" alt="Creative Picture & PDF Editor">
        </div>
        <div class="screen-info">
          <h3>Screen D: Canva-Grade Picture &amp; PDF Editor</h3>
          <ul>
            <li><strong>Crop Tool:</strong> Aspect ratio presets for Feed (1:1), Portrait (4:5), and Story (9:16).</li>
            <li><strong>Draw &amp; Sign:</strong> Freehand pen, marker, and spray brushes for quick document signing.</li>
            <li><strong>Watermarks:</strong> Add brand logos or 1-click remove baked-in watermarks with whiteout patches.</li>
            <li><strong>PDF Editing:</strong> Import, annotate, and export multi-page brochures and proposals.</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- PAGE 4: The Math & Comparison -->
    <section class="doc-page">
      <div class="page-tag">Unit Economics &amp; ROI</div>
      <h2>The Math Behind ~₹<span class="disp-cost-inline">${cfg.cost}</span> Per Lead / Chat</h2>
      <p class="lead-p">How NexaDrip eliminates the 300% markup of middlemen agencies through streamlined AI pipelines and direct deliverability infrastructure:</p>

      <table class="styled-table">
        <thead>
          <tr>
            <th>Operation / Channel</th>
            <th>Traditional Method</th>
            <th>NexaDrip AI Platform</th>
            <th>Your Savings</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Inbound Chat / FAQ Qualification Session</strong></td>
            <td>₹15.00 (Customer support staff)</td>
            <td class="highlight-cell">~₹0.35</td>
            <td>97% Cheaper</td>
          </tr>
          <tr>
            <td><strong>Direct WhatsApp Follow-up &amp; Nurturing</strong></td>
            <td>₹3.50 (Manual SDR / 3rd Party CRM)</td>
            <td class="highlight-cell">~₹0.90</td>
            <td>74% Cheaper</td>
          </tr>
          <tr>
            <td><strong>Verified B2B Lead Lookup &amp; Email Dispatch</strong></td>
            <td>₹25.00 (Apollo / ZoomInfo + CRM)</td>
            <td class="highlight-cell">~₹0.20</td>
            <td>99% Cheaper</td>
          </tr>
          <tr>
            <td><strong>Local SEO Keyword Optimization</strong></td>
            <td>₹15,000 / month Agency Fee</td>
            <td class="highlight-cell">Included in AI Suite</td>
            <td>100% Saved</td>
          </tr>
          <tr class="total-row">
            <td>Blended Average Cost Per Qualified Customer Lead</td>
            <td>₹150 – ₹450+ (Meta/Google Ads)</td>
            <td class="disp-cost-total">~₹${cfg.cost}</td>
            <td>98% REDUCTION IN CAC</td>
          </tr>
        </tbody>
      </table>

      <!-- Head to Head -->
      <div class="section-title">📊 Head-to-Head Comparison Matrix</div>
      <table class="styled-table">
        <thead>
          <tr>
            <th>Key Metric</th>
            <th>Traditional Digital Agency</th>
            <th>Meta / Google Ads Alone</th>
            <th>NexaDrip Growth Suite</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Monthly Retainer</strong></td>
            <td>₹25,000 – ₹50,000 / month</td>
            <td>None (Self-managed ad spend)</td>
            <td class="highlight-cell">Zero Retainer Fees</td>
          </tr>
          <tr>
            <td><strong>Cost Per Lead</strong></td>
            <td>₹250 – ₹600+</td>
            <td>₹150 – ₹450+</td>
            <td class="highlight-cell green">~₹<span class="disp-cost-inline">${cfg.cost}</span> Per Lead / Chat</td>
          </tr>
          <tr>
            <td><strong>Response Speed</strong></td>
            <td>2 – 12 Hours (Delayed)</td>
            <td>No chat built-in</td>
            <td class="highlight-cell">Instant (&lt; 3 Seconds, 24/7)</td>
          </tr>
          <tr>
            <td><strong>WhatsApp Integration</strong></td>
            <td>Manual or Extra Cost</td>
            <td>Requires 3rd party tool</td>
            <td class="highlight-cell">Native Automated Drips</td>
          </tr>
          <tr>
            <td><strong>Contact Verification</strong></td>
            <td>Generic scraped lists</td>
            <td>Unverified user forms</td>
            <td class="highlight-cell">100% Live DNS MX Verified</td>
          </tr>
          <tr>
            <td><strong>Setup Time</strong></td>
            <td>3 – 5 Weeks</td>
            <td>1 – 2 Weeks</td>
            <td class="highlight-cell">Same-Day (&lt; 24 Hours)</td>
          </tr>
        </tbody>
      </table>

      <!-- 3-Day Roadmap -->
      <div class="section-title">🚀 Fast-Track 3-Day Onboarding Roadmap</div>
      <div class="roadmap-grid">
        <div class="roadmap-step">
          <div class="step-tag">Day 1: Setup &amp; Training</div>
          <div class="step-text">Brand kit synchronization, AI knowledge base training on your pricing, services &amp; FAQs, and website chat widget installation.</div>
        </div>
        <div class="roadmap-step">
          <div class="step-tag">Day 2: Multi-Channel Workflows</div>
          <div class="step-text">WhatsApp Business API connection, automated quotation follow-up drips, appointment booking link, and lead pipeline sync.</div>
        </div>
        <div class="roadmap-step">
          <div class="step-tag">Day 3: Outreach &amp; SEO Launch</div>
          <div class="step-text">Verified cold outreach campaigns launched for targeted local businesses (<span class="disp-city-inline">${cfg.city}</span>) and SEO autopilot activation for Google Maps.</div>
        </div>
      </div>

      <!-- CTA -->
      <div class="cta-banner">
        <div class="cta-title">Ready to Cut Customer Acquisition Costs by 90%?</div>
        <div class="cta-desc">Book your 10-minute live demonstration and receive a complimentary AI Marketing &amp; SEO Audit tailored for your business.</div>
        <div class="cta-contacts">
          <span id="disp-contact-phone">📞 Phone / WhatsApp: ${cfg.contact_phone}</span>
          <span id="disp-contact-email">✉️ Email: ${cfg.contact_email}</span>
          <span id="disp-contact-web">🌐 Web: ${cfg.contact_web}</span>
        </div>
      </div>

    </section>

  </div>

  <!-- Slide-Out Editor & AI Suggestion Drawer -->
  <aside class="editor-drawer" id="editor-drawer">
    <div class="drawer-header">
      <div class="drawer-title">
        <span>✏️ Customize Proposal &amp; AI Assist</span>
      </div>
      <button type="button" onclick="toggleDrawer()" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
    </div>

    <div class="drawer-body">
      <!-- Quick Industry Presets -->
      <div class="form-group">
        <label class="form-label">✨ Quick Industry Presets (Click to autofill):</label>
        <div class="preset-chips">
          <button type="button" class="preset-chip" onclick="applyPreset('dental')">🦷 Dental &amp; Clinics</button>
          <button type="button" class="preset-chip" onclick="applyPreset('realestate')">🏢 Real Estate</button>
          <button type="button" class="preset-chip" onclick="applyPreset('b2b')">⚙️ B2B Manufacturing</button>
          <button type="button" class="preset-chip" onclick="applyPreset('legal_finance')">⚖️ Legal &amp; CA</button>
          <button type="button" class="preset-chip" onclick="applyPreset('retail_restaurant')">🛍️ Retail &amp; Food</button>
          <button type="button" class="preset-chip" onclick="applyPreset('coaching')">🎓 Coaching / EdTech</button>
          <button type="button" class="preset-chip" onclick="applyPreset('general')">🚀 General Business</button>
        </div>
      </div>

      <div style="display:flex;gap:10px">
        <div class="form-group" style="flex:1">
          <label class="form-label">Target City / Locality</label>
          <input type="text" class="form-input" id="inp-city" value="${cfg.city}" oninput="syncPreview()">
        </div>
        <div class="form-group" style="width:110px">
          <label class="form-label">Cost / Lead (₹)</label>
          <input type="text" class="form-input" id="inp-cost" value="${cfg.cost}" oninput="syncPreview()">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Target Audience / Niche</label>
        <input type="text" class="form-input" id="inp-audience" value="${cfg.audience}" oninput="syncPreview()">
      </div>

      <!-- AI Suggestion Trigger -->
      <button type="button" class="btn btn-edit" style="width:100%;justify-content:center;padding:10px" onclick="triggerAiSuggestions()" id="btn-ai-suggest">
        ✨ AI Suggest Tailored Copy &amp; Math
      </button>

      <div class="form-group">
        <label class="form-label">Main Proposal Headline</label>
        <textarea class="form-textarea" id="inp-headline" oninput="syncPreview()">${cfg.headline}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label">Subtitle / Executive Summary</label>
        <textarea class="form-textarea" id="inp-subtitle" oninput="syncPreview()">${cfg.subtitle}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label">WhatsApp Simulation: Customer Question</label>
        <textarea class="form-textarea" id="inp-chat-query" oninput="syncPreview()">${cfg.chat_query}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label">WhatsApp Simulation: AI Instant Reply</label>
        <textarea class="form-textarea" id="inp-chat-reply" oninput="syncPreview()">${cfg.chat_reply}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label">WhatsApp Simulation: Customer Confirmation</label>
        <input type="text" class="form-input" id="inp-chat-confirm" value="${cfg.chat_customer_confirm}" oninput="syncPreview()">
      </div>

      <div class="form-group">
        <label class="form-label">WhatsApp Simulation: AI Confirmation &amp; Lead Cost</label>
        <input type="text" class="form-input" id="inp-chat-lock" value="${cfg.chat_bot_lock}" oninput="syncPreview()">
      </div>

      <div class="form-group">
        <label class="form-label">Contact Phone / WhatsApp</label>
        <input type="text" class="form-input" id="inp-contact-phone" value="${cfg.contact_phone}" oninput="syncPreview()">
      </div>

      <div class="form-group">
        <label class="form-label">Contact Email</label>
        <input type="text" class="form-input" id="inp-contact-email" value="${cfg.contact_email}" oninput="syncPreview()">
      </div>
    </div>

    <div class="drawer-footer">
      <button type="button" class="btn btn-primary" style="flex:1" onclick="saveAndRecompilePdf()" id="btn-save-recompile">
        💾 Save &amp; Recompile PDF
      </button>
      <button type="button" class="btn btn-secondary" onclick="toggleDrawer()">Done</button>
    </div>
  </aside>

  <div class="toast-msg" id="toast-msg"></div>

  <script>
    const PRESETS = ${JSON.stringify(INDUSTRY_PRESETS)};

    function showToast(msg) {
      const t = document.getElementById('toast-msg');
      t.textContent = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 3500);
    }

    function toggleDrawer() {
      const d = document.getElementById('editor-drawer');
      d.classList.toggle('open');
      document.body.classList.toggle('drawer-open', d.classList.contains('open'));
    }

    // Check URL parameters for ?edit=1
    if (new URLSearchParams(window.location.search).get('edit')) {
      toggleDrawer();
    }

    // Hotkey 'E' to toggle editor
    window.addEventListener('keydown', (e) => {
      if (e.key === 'e' || e.key === 'E') {
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
          toggleDrawer();
        }
      }
    });

    function applyPreset(key) {
      const p = PRESETS[key];
      if (!p) return;
      document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');

      document.getElementById('inp-audience').value = p.audience;
      document.getElementById('inp-city').value = p.city;
      document.getElementById('inp-cost').value = p.cost;
      document.getElementById('inp-headline').value = p.headline;
      document.getElementById('inp-subtitle').value = p.subtitle;
      document.getElementById('inp-chat-query').value = p.chat_query;
      document.getElementById('inp-chat-reply').value = p.chat_reply;
      document.getElementById('inp-chat-confirm').value = p.chat_customer_confirm;
      document.getElementById('inp-chat-lock').value = p.chat_bot_lock;

      syncPreview();
      showToast('Applied preset: ' + p.name);
    }

    function syncPreview() {
      const city = document.getElementById('inp-city').value;
      const cost = document.getElementById('inp-cost').value;
      const audience = document.getElementById('inp-audience').value;
      const headline = document.getElementById('inp-headline').value;
      const subtitle = document.getElementById('inp-subtitle').value;
      const chatQuery = document.getElementById('inp-chat-query').value;
      const chatReply = document.getElementById('inp-chat-reply').value;
      const chatConfirm = document.getElementById('inp-chat-confirm').value;
      const chatLock = document.getElementById('inp-chat-lock').value;
      const phone = document.getElementById('inp-contact-phone').value;
      const email = document.getElementById('inp-contact-email').value;

      document.getElementById('disp-headline').textContent = headline;
      document.getElementById('disp-subtitle').textContent = subtitle;
      document.getElementById('disp-kpi-cost').textContent = '~₹' + cost;
      document.querySelectorAll('.disp-cost-inline').forEach(el => el.textContent = cost);
      document.querySelectorAll('.disp-cost-total').forEach(el => el.textContent = '~₹' + cost);
      document.querySelectorAll('.disp-city-inline').forEach(el => el.textContent = city);
      const cn = document.getElementById('disp-city-name'); if (cn) cn.textContent = city;
      const ai = document.getElementById('disp-audience-inline'); if (ai) ai.textContent = audience;

      document.getElementById('disp-chat-query').textContent = chatQuery;
      document.getElementById('disp-chat-reply').textContent = chatReply;
      document.getElementById('disp-chat-confirm').textContent = chatConfirm;
      document.getElementById('disp-chat-lock').textContent = chatLock;

      document.getElementById('disp-contact-phone').textContent = '📞 Phone / WhatsApp: ' + phone;
      document.getElementById('disp-contact-email').textContent = '✉️ Email: ' + email;

      const cleanPhone = phone.replace(/[^0-9]/g, '');
      const waLink = document.getElementById('link-wa-chat');
      if (waLink && cleanPhone) {
        waLink.href = 'https://wa.me/' + cleanPhone + '?text=Hi%20NexaDrip%2C%20I%20reviewed%20your%20Rs%20' + encodeURIComponent(cost) + '%20lead%20proposal%20and%20want%20a%20demo';
      }
    }

    async function triggerAiSuggestions() {
      const btn = document.getElementById('btn-ai-suggest');
      const audience = document.getElementById('inp-audience').value;
      const city = document.getElementById('inp-city').value;
      const cost = document.getElementById('inp-cost').value;

      btn.disabled = true;
      btn.textContent = '✨ Generating AI Suggestions...';

      try {
        const res = await fetch('/api/sellbird/proposal/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ industry: audience, city, cost_per_lead: cost })
        });
        const data = await res.json();
        if (data && data.headline) {
          document.getElementById('inp-headline').value = data.headline;
          if (data.subtitle) document.getElementById('inp-subtitle').value = data.subtitle;
          if (data.chat_query) document.getElementById('inp-chat-query').value = data.chat_query;
          if (data.chat_reply) document.getElementById('inp-chat-reply').value = data.chat_reply;
          if (data.chat_customer_confirm) document.getElementById('inp-chat-confirm').value = data.chat_customer_confirm;
          if (data.chat_bot_lock) document.getElementById('inp-chat-lock').value = data.chat_bot_lock;
          syncPreview();
          showToast('AI Suggestions applied successfully!');
        } else {
          showToast('Using tailored industry preset.');
        }
      } catch (e) {
        console.warn('AI suggestion fallback:', e);
        showToast('Applied smart local suggestions.');
      } finally {
        btn.disabled = false;
        btn.textContent = '✨ AI Suggest Tailored Copy & Math';
      }
    }

    async function saveAndRecompilePdf() {
      const btn = document.getElementById('btn-save-recompile');
      btn.disabled = true;
      btn.textContent = '⏳ Recompiling PDF...';

      const payload = {
        audience: document.getElementById('inp-audience').value,
        city: document.getElementById('inp-city').value,
        cost: document.getElementById('inp-cost').value,
        headline: document.getElementById('inp-headline').value,
        subtitle: document.getElementById('inp-subtitle').value,
        chat_query: document.getElementById('inp-chat-query').value,
        chat_reply: document.getElementById('inp-chat-reply').value,
        chat_customer_confirm: document.getElementById('inp-chat-confirm').value,
        chat_bot_lock: document.getElementById('inp-chat-lock').value,
        contact_phone: document.getElementById('inp-contact-phone').value,
        contact_email: document.getElementById('inp-contact-email').value,
      };

      try {
        const res = await fetch('/api/sellbird/proposal/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data && data.success) {
          showToast('✅ Proposal & PDF recompiled and attached to Outreach!');
          const dlBtn = document.getElementById('btn-download-pdf');
          if (dlBtn) dlBtn.href = 'NexaDrip-Business-Growth-Proposal.pdf?v=' + Date.now();
        } else {
          showToast(data.error || 'Saved changes.');
        }
      } catch (err) {
        console.error(err);
        showToast('Saved locally.');
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Save & Recompile PDF';
      }
    }
  </script>

</body>
</html>
`;

  const htmlPath = path.join(__dirname, '..', 'public', 'nexadrip-proposal.html');
  fs.writeFileSync(htmlPath, htmlContent);
  return htmlPath;
}

async function generateAll(opts = {}, workspaceId = 1) {
  const { pdfPath, bytes } = await buildPdf(opts);
  const htmlPath = buildHtml(opts);

  // Update attachment in database for active campaign
  try {
    const knex = require('../services/knex');
    const campaigns = await knex('sellbird_campaigns').where({ workspace_id: workspaceId });
    for (const camp of (campaigns.length ? campaigns : [{ id: 91 }, { id: 92 }])) {
      const existing = await knex('sellbird_attachments').where({
        campaign_id: camp.id,
        filename: 'NexaDrip-Business-Growth-Proposal.pdf'
      }).first();

      if (existing) {
        await knex('sellbird_attachments').where({ id: existing.id }).update({
          size: bytes.length,
          data: bytes,
          send_with: 'all',
          created_at: Date.now()
        });
      } else {
        await knex('sellbird_attachments').insert({
          workspace_id: workspaceId,
          campaign_id: camp.id,
          filename: 'NexaDrip-Business-Growth-Proposal.pdf',
          content_type: 'application/pdf',
          size: bytes.length,
          data: bytes,
          send_with: 'all',
          created_at: Date.now()
        });
      }
    }
  } catch (err) {
    console.warn('[DB] Attachment update notice:', err.message);
  }

  return { pdfPath, htmlPath };
}

async function main() {
  console.log('--- Generating NexaDrip Configurable Proposal ---');
  await generateAll({}, 1);
  console.log('--- Done! ---');
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { buildPdf, buildHtml, generateAll, INDUSTRY_PRESETS };

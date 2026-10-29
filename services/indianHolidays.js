/**
 * Indian Holidays & Festivals Calendar
 * Built for Social-Nexus — tailored for Indian social media marketing
 *
 * The list itself lives in services/festivals (built-in years plus signed
 * updates from Radixile); these helpers keep their old names.
 */
const festivals = require('./festivals');
const list = () => festivals.all();

// Calendar date (YYYY-MM-DD) in India, not UTC — UTC is a day behind until 05:30 IST.
function istDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

function getTodayHolidays() {
  const today = istDate();
  return list().filter(h => h.date === today);
}

// Upcoming holidays within N days (today's included)
function getUpcomingHolidays(days = 14) {
  const from = istDate();
  const to   = istDate(days);
  return list().filter(h => h.date >= from && h.date <= to);
}

// Holidays for a given month (YYYY-MM)
function getHolidaysForMonth(yearMonth) {
  return list().filter(h => h.date.startsWith(yearMonth));
}

function getHolidayOnDate(dateStr) {
  return list().find(h => h.date === dateStr) || null;
}

// A content generation prompt for a given holiday
function buildHolidayPrompt(holiday, platform) {
  const platformHints = {
    facebook: 'engaging, community-focused, encourages comments',
    instagram: 'visual, emotional, hashtag-rich, 5-8 relevant hashtags',
    linkedin: 'professional, thoughtful, business context',
    twitter: 'concise, under 280 characters, trendy hashtag',
    whatsapp: 'warm, personal, conversational',
    default: 'engaging and authentic',
  };

  const hint = platformHints[platform] || platformHints.default;
  const where = holiday.region ? ` It is mainly celebrated in ${holiday.region}.` : '';
  return `Write a ${platform || 'social media'} post for ${holiday.name} (${holiday.date})
that is ${hint}.${where}
Celebrate this occasion in a way that resonates with Indian audiences.
${holiday.emoji ? `Include the emoji ${holiday.emoji}.
` : ''}Only output the post text, no explanation.`;
}

module.exports = {
  all: list,
  getTodayHolidays,
  getUpcomingHolidays,
  getHolidaysForMonth,
  getHolidayOnDate,
  buildHolidayPrompt,
};

/**
 * Indian Holidays & Festivals Calendar 2026
 * Built for Social-Nexus — tailored for Indian social media marketing
 */

// NOTE: lunar festival dates shift every year and Islamic dates depend on moon
// sighting (±1 day). Verify against the official Government of India holiday list
// before relying on them; this list is planned to move into a calendar_events table.
const INDIAN_HOLIDAYS_2026 = [
  // National Holidays
  { date: '2026-01-01', name: "New Year's Day",        emoji: '🎉', type: 'national'  },
  { date: '2026-01-14', name: 'Makar Sankranti',        emoji: '🪁', type: 'festival'  },
  { date: '2026-01-23', name: 'Netaji Subhas Chandra Bose Jayanti', emoji: '🎖️', type: 'national' },
  { date: '2026-01-26', name: 'Republic Day',           emoji: '🇮🇳', type: 'national'  },
  { date: '2026-02-01', name: 'Budget Day',             emoji: '💰', type: 'business'  },
  { date: '2026-02-14', name: "Valentine's Day",        emoji: '❤️', type: 'occasion'  },
  { date: '2026-02-15', name: 'Maha Shivaratri',        emoji: '🙏', type: 'festival'  },
  { date: '2026-03-04', name: 'Holi',                   emoji: '🎨', type: 'festival'  },
  { date: '2026-03-08', name: "Women's Day",            emoji: '👩', type: 'occasion'  },
  { date: '2026-03-19', name: 'Gudi Padwa / Ugadi',     emoji: '🌺', type: 'festival'  },
  { date: '2026-03-26', name: 'Ram Navami',             emoji: '🙏', type: 'festival'  },
  { date: '2026-04-03', name: 'Good Friday',            emoji: '✝️', type: 'festival'  },
  { date: '2026-04-14', name: 'Baisakhi',               emoji: '🌾', type: 'festival'  },
  { date: '2026-03-21', name: 'Eid ul-Fitr',            emoji: '🌙', type: 'festival'  },
  { date: '2026-04-14', name: 'Dr. Ambedkar Jayanti / Tamil New Year', emoji: '⭐', type: 'national' },
  { date: '2026-05-01', name: 'Labour Day / Maharashtra Day', emoji: '🏭', type: 'national' },
  { date: '2026-05-10', name: "Mother's Day",           emoji: '👩‍👦', type: 'occasion'  },
  { date: '2026-05-27', name: 'Eid ul-Adha',            emoji: '🌙', type: 'festival'  },
  { date: '2026-06-21', name: "Father's Day / World Music Day", emoji: '🎵', type: 'occasion' },
  { date: '2026-06-26', name: 'Muharram',               emoji: '🌙', type: 'festival'  },
  { date: '2026-08-15', name: 'Independence Day',       emoji: '🇮🇳', type: 'national'  },
  { date: '2026-08-28', name: 'Raksha Bandhan',         emoji: '🎀', type: 'festival'  },
  { date: '2026-09-04', name: 'Janmashtami',            emoji: '🙏', type: 'festival'  },
  { date: '2026-09-14', name: 'Ganesh Chaturthi',       emoji: '🐘', type: 'festival'  },
  { date: '2026-08-26', name: 'Milad-un-Nabi',          emoji: '🌙', type: 'festival'  },
  { date: '2026-10-02', name: 'Gandhi Jayanti',         emoji: '🕊️', type: 'national'  },
  { date: '2026-10-11', name: 'Navratri Begins',        emoji: '💃', type: 'festival'  },
  { date: '2026-10-20', name: 'Dussehra (Vijayadashami)', emoji: '🏹', type: 'festival' },
  { date: '2026-11-08', name: 'Diwali',                 emoji: '🪔', type: 'festival'  },
  { date: '2026-11-10', name: 'Govardhan Puja',         emoji: '🙏', type: 'festival'  },
  { date: '2026-11-11', name: 'Bhai Dooj',              emoji: '👨‍👩‍👦', type: 'festival' },
  { date: '2026-11-15', name: 'Chhath Puja',            emoji: '🌅', type: 'festival'  },
  { date: '2026-11-24', name: 'Guru Nanak Jayanti',     emoji: '🙏', type: 'festival'  },
  { date: '2026-11-14', name: "Children's Day",         emoji: '👶', type: 'occasion'  },
  { date: '2026-12-25', name: 'Christmas',              emoji: '🎄', type: 'festival'  },
  { date: '2026-12-31', name: "New Year's Eve",         emoji: '🎆', type: 'occasion'  },
  // Business Occasions
  { date: '2026-01-12', name: 'National Youth Day',     emoji: '⚡', type: 'business'  },
  { date: '2026-02-28', name: 'Science Day',            emoji: '🔬', type: 'business'  },
  { date: '2026-04-22', name: 'Earth Day',              emoji: '🌍', type: 'business'  },
  { date: '2026-05-07', name: 'World Password Day',     emoji: '🔐', type: 'business'  },
  { date: '2026-06-05', name: 'World Environment Day',  emoji: '🌿', type: 'business'  },
  { date: '2026-10-01', name: 'World Seniors Day',      emoji: '👴', type: 'business'  },
  { date: '2026-11-01', name: 'World Vegan Day',        emoji: '🌱', type: 'business'  },
];

/**
 * Get today's holidays
 */
// Calendar date (YYYY-MM-DD) in India, not UTC — UTC is a day behind until 05:30 IST.
function istDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

function getTodayHolidays() {
  const today = istDate();
  return INDIAN_HOLIDAYS_2026.filter(h => h.date === today);
}

/**
 * Get upcoming holidays within N days
 */
function getUpcomingHolidays(days = 14) {
  // Compare date strings so today's holiday is included
  const from = istDate();
  const to   = istDate(days);
  return INDIAN_HOLIDAYS_2026
    .filter(h => h.date >= from && h.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get holidays for a given month (YYYY-MM)
 */
function getHolidaysForMonth(yearMonth) {
  return INDIAN_HOLIDAYS_2026.filter(h => h.date.startsWith(yearMonth));
}

/**
 * Get holiday on a specific date
 */
function getHolidayOnDate(dateStr) {
  return INDIAN_HOLIDAYS_2026.find(h => h.date === dateStr) || null;
}

/**
 * Build a content generation prompt for a given holiday
 */
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
  return `Write a ${platform || 'social media'} post for ${holiday.name} (${holiday.date}) 
that is ${hint}. 
Celebrate this occasion in a way that resonates with Indian audiences. 
Include the emoji ${holiday.emoji}. 
Only output the post text, no explanation.`;
}

module.exports = {
  INDIAN_HOLIDAYS_2026,
  getTodayHolidays,
  getUpcomingHolidays,
  getHolidaysForMonth,
  getHolidayOnDate,
  buildHolidayPrompt,
};

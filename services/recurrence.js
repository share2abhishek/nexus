// Repeating schedules: every day / week / month at the same local time, ending
// after a number of posts or on a date. Each occurrence becomes its own
// content item (shared series_id), so every post shows on the calendar and can
// be edited, retried or cancelled on its own.
//
// Times are the computer's local time (the app runs on the user's PC).
const EVERY = ['daily', 'weekly', 'monthly'];
const MAX_POSTS = 365;
const MAX_SPAN_DAYS = 731; // about two years

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }

// The n-th occurrence (0 = first) after `start` (a Date)
function nth(start, every, n) {
  const d = new Date(start.getTime());
  if (every === 'daily') d.setDate(start.getDate() + n);
  else if (every === 'weekly') d.setDate(start.getDate() + 7 * n);
  else {
    // Same day of the month; on short months use the last day (31st → 30th/28th)
    const total = start.getMonth() + n;
    const year = start.getFullYear() + Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    d.setFullYear(year, month, Math.min(start.getDate(), daysInMonth(year, month)));
  }
  return d;
}

// End of the given local calendar day ("YYYY-MM-DD")
function endOfDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
}

// Returns { dates: Date[] } or { error }
function occurrences(start, { every, count, until } = {}) {
  if (!(start instanceof Date) || isNaN(start)) return { error: 'Pick a date and time for the first post.' };
  if (!EVERY.includes(every)) return { error: 'Repeat must be daily, weekly or monthly.' };
  let limit = MAX_POSTS;
  let untilDate = null;
  if (until) {
    untilDate = endOfDay(until);
    if (!untilDate) return { error: 'The end date is not valid.' };
    if (untilDate < start) return { error: 'The end date is before the first post.' };
    if ((untilDate - start) / 86400000 > MAX_SPAN_DAYS) return { error: 'A repeating schedule can run for up to 2 years.' };
  } else {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 2) return { error: 'Choose how many times to post (at least 2).' };
    if (n > MAX_POSTS) return { error: `A repeating schedule can have up to ${MAX_POSTS} posts.` };
    limit = n;
  }
  const dates = [];
  for (let i = 0; i < limit; i++) {
    const d = nth(start, every, i);
    if (untilDate && d > untilDate) break;
    if ((d - start) / 86400000 > MAX_SPAN_DAYS) break;
    dates.push(d);
  }
  if (dates.length < 2) return { error: 'That end date leaves only one post. Choose a later date, or turn off repeat.' };
  if (dates.length >= MAX_POSTS && until) return { error: `That is more than ${MAX_POSTS} posts. Choose an earlier end date.` };
  return { dates };
}

module.exports = { occurrences, EVERY, MAX_POSTS, _nth: nth };

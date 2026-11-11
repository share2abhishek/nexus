// Bulk scheduling from a spreadsheet: CSV (any program can save one) or Excel
// (.xlsx). One row per post. Column names are matched loosely:
//
//   date        2026-11-08, 08/11/2026 (day first, as in India) or an Excel date
//   time        18:30, 6:30 PM (India time unless the workspace says otherwise)
//   text        the post (also: content, post, caption, message)
//   platforms   facebook, instagram; linkedin … (also: platform, channels)
//   image       a web link or the name of a file in the media library (also: media, photo, image_url)
//   first comment, instagram (feed / reel / story)
//
// A "when" or "scheduled_at" column with date and time together also works.
const zlib = require('zlib');
const { parse } = require('csv-parse/sync');
const { PUBLISHABLE } = require('./platforms/available');

const MAX_ROWS = 500;

// ── .xlsx reader (a zip of XML files; only the first sheet is read) ──────────
function unzipEntries(buf) {
  // End of central directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This Excel file is damaged (or isn’t an .xlsx file).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    files[name] = () => {
      const lnameLen = buf.readUInt16LE(localOffset + 26), lextraLen = buf.readUInt16LE(localOffset + 28);
      const data = buf.slice(localOffset + 30 + lnameLen + lextraLen, localOffset + 30 + lnameLen + lextraLen + csize);
      return method === 0 ? data : zlib.inflateRawSync(data, { maxOutputLength: 50 * 1024 * 1024 });
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const xmlText = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

function readXlsx(buf) {
  const files = unzipEntries(buf);
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const xml = files['xl/sharedStrings.xml']().toString('utf8');
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText((m[1].match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).join('')));
  }
  const sheetName = Object.keys(files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort()[0];
  if (!sheetName) throw new Error('The Excel file has no sheet.');
  const xml = files[sheetName]().toString('utf8');
  const rows = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/t="(\w+)"/) || [])[1];
      const inner = c[3] || '';
      let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (type === 's') v = shared[Number(v)];
      else if (type === 'inlineStr') v = xmlText((inner.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || '');
      else if (v !== undefined) v = xmlText(v);
      row[ref ? colIndex(ref) : row.length] = v ?? '';
    }
    rows.push(Array.from(row, x => x ?? ''));
  }
  return rows;
}

function readRows(buffer, name = '') {
  const isXlsx = buffer.slice(0, 2).toString() === 'PK' || /\.xlsx$/i.test(name);
  if (isXlsx) return readXlsx(buffer);
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const delimiter = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  return parse(text, { delimiter, relax_column_count: true, skip_empty_lines: true, relax_quotes: true });
}

// ── Understanding the columns ────────────────────────────────────────────────
const COLUMNS = {
  when: ['when', 'scheduled_at', 'scheduled at', 'datetime', 'date & time', 'date and time'],
  date: ['date', 'day', 'post date'],
  time: ['time', 'post time', 'hour'],
  text: ['text', 'content', 'post', 'caption', 'message', 'body'],
  platforms: ['platforms', 'platform', 'channels', 'channel', 'networks'],
  image: ['image', 'image_url', 'image url', 'media', 'photo', 'picture', 'file'],
  first_comment: ['first comment', 'first_comment', 'comment'],
  ig_format: ['instagram', 'instagram format', 'ig format', 'format'],
};
function mapHeader(header) {
  const map = {};
  header.forEach((h, i) => {
    const k = String(h || '').trim().toLowerCase();
    for (const [field, names] of Object.entries(COLUMNS)) if (names.includes(k) && map[field] === undefined) map[field] = i;
  });
  return map;
}

const PLATFORM_ALIASES = { fb: 'facebook', ig: 'instagram', insta: 'instagram', li: 'linkedin', x: 'twitter', 'twitter/x': 'twitter', 'google business': 'google_business', gbp: 'google_business', google: 'google_business', pin: 'pinterest' };
const normPlatform = (p) => { const k = p.trim().toLowerCase(); return PLATFORM_ALIASES[k] || k.replace(/\s+/g, '_'); };

// Wall-clock time in a time zone → epoch seconds
function zonedEpoch(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.floor((guess - (asIfUtc - guess)) / 1000);
}

function parseDate(v) {
  const d = parseDateLoose(v);
  if (!d) return null;
  // 31/11 would roll over to 1 December: refuse dates that don't exist
  const check = new Date(Date.UTC(d.y, d.mo - 1, d.d));
  if (check.getUTCFullYear() !== d.y || check.getUTCMonth() !== d.mo - 1 || check.getUTCDate() !== d.d) return null;
  return d;
}

function parseDateLoose(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 30000 && Number(s) < 80000) {
    // Excel date number (days since 1899-12-30), maybe with a time part
    const ms = Math.round((Number(s) - 25569) * 86400000);
    const d = new Date(ms);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), time: Number(s) % 1 ? { h: d.getUTCHours(), mi: d.getUTCMinutes() } : null };
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](.+))?$/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3], time: m[4] ? parseTime(m[4]) : null };
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(.+))?$/); // day first (India)
  if (m) return { y: m[3].length === 2 ? 2000 + +m[3] : +m[3], mo: +m[2], d: +m[1], time: m[4] ? parseTime(m[4]) : null };
  return null;
}

function parseTime(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (/^0?\.\d+$/.test(s)) { const mins = Math.round(Number(s) * 1440); return { h: Math.floor(mins / 60) % 24, mi: mins % 60 }; } // Excel time
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1];
  const mi = +(m[2] || 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

// Reads and checks every row. Returns { rows: [{ line, ok, error?, post? }], counts }
function parseSheet(buffer, { name = '', timezone = 'Asia/Kolkata', mediaByName = {} } = {}) {
  const all = readRows(buffer, name).filter(r => r.some(c => String(c || '').trim()));
  if (all.length < 2) throw new Error('The file needs a header row and at least one post.');
  const map = mapHeader(all[0]);
  if (map.text === undefined) throw new Error('No "text" column found. Name the column with the post text "text".');
  if (map.when === undefined && map.date === undefined) throw new Error('No "date" column found. Add a "date" column (and "time").');
  if (all.length - 1 > MAX_ROWS) throw new Error(`At most ${MAX_ROWS} posts per file. Split the file and import it in parts.`);

  const now = Math.floor(Date.now() / 1000);
  const rows = all.slice(1).map((r, i) => {
    const line = i + 2;
    const cell = (f) => (map[f] === undefined ? '' : String(r[map[f]] ?? '').trim());
    const text = cell('text');
    if (!text) return { line, ok: false, error: 'No text' };

    const date = parseDate(cell('when') || cell('date'));
    if (!date) return { line, ok: false, error: `Date not understood: "${cell('when') || cell('date')}" (use 2026-11-08 or 08/11/2026)` };
    const time = date.time || parseTime(cell('time'));
    if (!time) return { line, ok: false, error: `Time missing or not understood: "${cell('time')}" (use 18:30 or 6:30 PM)` };
    const at = zonedEpoch(date.y, date.mo, date.d, time.h, time.mi, timezone);
    if (!Number.isFinite(at)) return { line, ok: false, error: 'Date not understood' };
    if (at <= now) return { line, ok: false, error: 'This time has already passed' };

    const platforms = [...new Set((cell('platforms') || '').split(/[;,|/]+/).map(normPlatform).filter(Boolean))];
    if (!platforms.length) return { line, ok: false, error: 'No platform (e.g. facebook, instagram)' };
    const unknown = platforms.filter(p => !PUBLISHABLE.includes(p));
    if (unknown.length) return { line, ok: false, error: `Can't post to: ${unknown.join(', ')}` };

    const media = [];
    for (const part of cell('image').split(/[;|\n]+/).map(x => x.trim()).filter(Boolean)) {
      if (/^https?:\/\//i.test(part)) media.push(part);
      else if (mediaByName[part.toLowerCase()]) media.push(mediaByName[part.toLowerCase()]);
      else return { line, ok: false, error: `Picture "${part}" isn't in the media library (upload it first, or use a web link)` };
    }
    if ((platforms.includes('instagram') || platforms.includes('pinterest')) && !media.length) {
      return { line, ok: false, error: `${platforms.includes('instagram') ? 'Instagram' : 'Pinterest'} needs a picture` };
    }
    const fmt = cell('ig_format').toLowerCase();
    const options = {};
    if (media.length > 1) options.media = media.slice(0, 10);
    if (['reel', 'story'].includes(fmt)) options.ig_format = fmt;
    if (cell('first_comment')) options.first_comment = cell('first_comment').slice(0, 2200);

    return { line, ok: true, post: { body: text, platforms, image_url: media[0] || null, scheduled_at: at, options: Object.keys(options).length ? options : null } };
  });
  return { rows, counts: { ok: rows.filter(r => r.ok).length, failed: rows.filter(r => !r.ok).length } };
}

module.exports = { parseSheet, readRows, parseDate, parseTime, zonedEpoch, MAX_ROWS };

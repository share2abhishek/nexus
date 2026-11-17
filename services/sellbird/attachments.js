// Attachments for outreach emails: which files are allowed, how big, and a check that the file
// really is what its name says. The type is decided here from the file's own extension, never
// from what the browser claims, and anything that can run (programs, scripts, web pages,
// SVG images, archives) is refused.
const MAX_FILE = 5 * 1024 * 1024;       // per file
const MAX_TOTAL = 8 * 1024 * 1024;      // per campaign (email services refuse messages over about 10 MB)
const MAX_FILES = 5;

const TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
const ALLOWED_LIST = Object.keys(TYPES).map((e) => `.${e}`).join(', ');

class AttachmentError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// A safe file name: no folders, no control or odd characters, one extension
function cleanName(raw) {
  let n = String(raw || '').split(/[\\/]/).pop();
  try { n = decodeURIComponent(n); } catch { /* keep as is */ }
  n = n.replace(/[\u0000-\u001f\u007f<>:"|?*\\/]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return n.slice(0, 120);
}
const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';

// The first bytes must match the type (a program renamed to .pdf is refused)
function looksLike(ext, buf) {
  const starts = (...bytes) => bytes.every((b, i) => buf[i] === b);
  switch (ext) {
    case 'pdf': return starts(0x25, 0x50, 0x44, 0x46);                    // %PDF
    case 'png': return starts(0x89, 0x50, 0x4e, 0x47);
    case 'jpg': case 'jpeg': return starts(0xff, 0xd8, 0xff);
    case 'gif': return starts(0x47, 0x49, 0x46, 0x38);                   // GIF8
    case 'webp': return starts(0x52, 0x49, 0x46, 0x46) && buf.slice(8, 12).toString('latin1') === 'WEBP';
    case 'docx': case 'xlsx': case 'pptx': return starts(0x50, 0x4b);    // zip container "PK"
    case 'doc': case 'xls': case 'ppt': return starts(0xd0, 0xcf, 0x11, 0xe0); // old Office format
    case 'csv': case 'txt': return !buf.includes(0);                      // text has no NUL bytes
    default: return false;
  }
}

// Check an upload. Returns { filename, contentType, size } or throws AttachmentError.
function check({ name, buffer, existingCount = 0, existingBytes = 0 }) {
  const filename = cleanName(name);
  if (!filename) throw new AttachmentError('The file has no name.');
  const ext = extOf(filename);
  if (!TYPES[ext]) throw new AttachmentError(`That file type can not be attached. Allowed: ${ALLOWED_LIST}.`);
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new AttachmentError('The file is empty.');
  if (buffer.length > MAX_FILE) throw new AttachmentError(`The file is too large (${(buffer.length / 1048576).toFixed(1)} MB). The most is ${MAX_FILE / 1048576} MB per file.`, 413);
  if (existingCount >= MAX_FILES) throw new AttachmentError(`A campaign can have at most ${MAX_FILES} attachments. Remove one first.`);
  if (existingBytes + buffer.length > MAX_TOTAL) throw new AttachmentError(`Attachments can add up to ${MAX_TOTAL / 1048576} MB at most. Remove one or use a smaller file.`, 413);
  if (!looksLike(ext, buffer)) throw new AttachmentError(`That file is not a real .${ext} file. Save or export it again and retry.`);
  return { filename, contentType: TYPES[ext], size: buffer.length };
}

module.exports = { check, cleanName, extOf, TYPES, ALLOWED_LIST, MAX_FILE, MAX_TOTAL, MAX_FILES, AttachmentError };

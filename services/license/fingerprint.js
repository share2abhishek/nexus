// Identifies this computer for licensing — privately.
//
// Reads a few hardware/OS identifiers and HMAC-hashes each one with an app-wide
// salt. Only the hashes leave the PC; raw serial numbers never do. Each part is
// hashed separately so a licence still matches after one part changes (new disk…).
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Not a secret (it ships in the app); it just makes these hashes specific to
// Social-Nexus so they can't be matched against other software's IDs.
const SALT = 'social-nexus/fingerprint/v1';

function hash(value) {
  return crypto.createHmac('sha256', SALT).update(String(value).trim().toUpperCase()).digest('hex');
}

function run(cmd, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

// Placeholder values some PCs report instead of a real serial
const JUNK = /^(|0+|none|null|default string|to be filled by o\.?e\.?m\.?|not applicable|system serial number|n\/a|xxxxxxxx.*)$/i;
const clean = (v) => {
  const s = String(v || '').trim();
  return JUNK.test(s) ? '' : s;
};

// Full paths to Windows' own tools, so a look-alike program placed in the app
// folder or earlier on PATH can't answer instead. The standard location wins;
// SystemRoot is only used when Windows lives somewhere unusual.
function system32() {
  const std = 'C:\\Windows\\System32';
  if (fs.existsSync(path.join(std, 'reg.exe'))) return std;
  return path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32');
}

async function windowsParts() {
  // One PowerShell call for the CIM values (wmic is gone from new Windows 11 builds)
  const ps = [
    '$b=(Get-CimInstance Win32_BaseBoard | Select-Object -First 1).SerialNumber',
    '$u=(Get-CimInstance Win32_ComputerSystemProduct | Select-Object -First 1).UUID',
    '$d=(Get-CimInstance Win32_DiskDrive | Where-Object { $_.Index -eq 0 } | Select-Object -First 1).SerialNumber',
    '$c=(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId',
    '[pscustomobject]@{board=$b;uuid=$u;disk=$d;cpu=$c} | ConvertTo-Json -Compress',
  ].join('; ');
  const [cim, reg] = await Promise.all([
    run(path.join(system32(), 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', ps]),
    run(path.join(system32(), 'reg.exe'), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']),
  ]);
  let v = {};
  try { v = JSON.parse(cim.trim() || '{}'); } catch {}
  const guid = (reg.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i) || [])[1];
  return {
    machine: clean(guid) || clean(v.uuid),
    board: clean(v.board) || clean(v.uuid),
    disk: clean(v.disk),
    cpu: clean(v.cpu),
  };
}

async function macParts() {
  const out = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
  const get = (k) => (out.match(new RegExp(`"${k}" = "([^"]+)"`)) || [])[1];
  return { machine: clean(get('IOPlatformUUID')), board: clean(get('IOPlatformSerialNumber')), disk: '', cpu: clean(os.cpus()[0]?.model) };
}

async function linuxParts() {
  const fs = require('fs');
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  return { machine: clean(read('/etc/machine-id')), board: clean(read('/sys/class/dmi/id/board_serial')), disk: '', cpu: clean(os.cpus()[0]?.model) };
}

let cached = null;

// A full read has at least 3 parts (some PCs genuinely lack one, e.g. no disk serial).
// Fewer usually means PowerShell was slow or blocked: worth trying again later.
function isComplete(fp = {}) {
  return Object.keys(fp).length >= 3;
}

// Returns { machine, board, disk, cpu } as hex hashes (missing parts omitted).
// Not cached on disk on purpose: a copied data folder must not carry it along.
// Only a complete read is cached in memory; a partial one is retried next call.
async function getFingerprint() {
  if (cached) return cached;
  let parts = {};
  try {
    parts = process.platform === 'win32' ? await windowsParts()
      : process.platform === 'darwin' ? await macParts() : await linuxParts();
  } catch {}
  // Last resort so activation always works (weaker, but still per-machine)
  if (!parts.machine) parts.machine = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.totalmem()}`;
  const out = {};
  for (const [k, v] of Object.entries(parts)) if (v) out[k] = hash(v);
  if (isComplete(out)) cached = out;
  return out;
}

// Same rule as the licence server: at least 3 of the stored parts unchanged (or
// all of them if fewer were stored). Missing parts count as changed.
function sameDevice(stored = {}, given = {}) {
  const keys = Object.keys(stored);
  if (!keys.length) return false;
  const equal = keys.filter(k => given[k] && stored[k] === given[k]).length;
  return equal >= Math.min(3, keys.length);
}

module.exports = { getFingerprint, sameDevice, isComplete, _hash: hash };

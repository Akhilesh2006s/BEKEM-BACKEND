const SKIP_VENDOR_WORDS = new Set([
  'M/S',
  'MS',
  'M',
  'S',
  'AND',
  'OF',
  'THE',
  'PVT',
  'LTD',
  'LIMITED',
  'PRIVATE',
  'CO',
  'COMPANY',
  'INDIA',
]);

function wordsFromName(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Project short code: first word, max 5 chars — CHITRAVATHI → CHITR, KAIGA PROJECT → KAIGA */
function projectShortCode(name) {
  const words = wordsFromName(name);
  const first = words[0] || 'PRJ';
  return first.slice(0, 5) || 'PRJ';
}

/** Vendor short code: initials of words — SHREE RAMDEV ELECTRICALS → SRE, EMPSYS TECHNOLOGIES → ET */
function vendorShortCode(name) {
  const words = wordsFromName(name).filter((w) => !SKIP_VENDOR_WORDS.has(w));
  if (!words.length) return 'VND';
  if (words.length === 1) return words[0].slice(0, 3) || 'VND';
  return words
    .map((w) => w[0])
    .join('')
    .slice(0, 6);
}

function materialCodeFromItem(itemCode, itemDescription) {
  const raw = String(itemCode || itemDescription || 'ITEM')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return raw || 'ITEM';
}

function ensureUniqueCode(base, used) {
  let code = base;
  let n = 2;
  while (used.has(code)) {
    const suffix = String(n);
    code = `${base.slice(0, Math.max(1, 12 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(code);
  return code;
}

module.exports = {
  projectShortCode,
  vendorShortCode,
  materialCodeFromItem,
  ensureUniqueCode,
  wordsFromName,
};

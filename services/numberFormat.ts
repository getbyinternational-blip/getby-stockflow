const EPSILON = 1e-9;

export const INR_SYMBOL = '₹';
export const DISPLAY_FALLBACK = '\u2014';
export const GST_FALLBACK = 'GST details not added';
export const CONTACT_FALLBACK = 'Contact not added';
export const LOCATION_FALLBACK = 'Location not added';

const MONEY_FORMATTER = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const WHOLE_MONEY_FORMATTER = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const MOJIBAKE_NOISE = /[\u00A0\u00A1\u00A6-\u00A9\u00AB-\u00AE\u00B9\u00C2\u00C3\u00D7\u00E2\u0192\u0152\u0153\u0160\u0161\u0178-\u017E\u2018-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]+/g;

export const toSafeNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

export const normalizeMoney = (value: unknown) => {
  const safe = toSafeNumber(value);
  return Math.round((safe + Number.EPSILON) * 100) / 100;
};

export const roundByHalfRule = (value: unknown) => {
  const normalized = normalizeMoney(value);
  const sign = normalized < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(normalized) + 0.5);
};

const roundTo = (value: unknown, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round((toSafeNumber(value) + EPSILON) * factor) / factor;
};

export const sanitizeDisplayText = (value: unknown, fallback = DISPLAY_FALLBACK): string => {
  const input = String(value ?? '').trim();
  if (!input) return fallback;

  let next = input
    .replace(/(^|[\s(])\?(\d[\d,]*(?:\.\d{1,2})?)/g, `$1${INR_SYMBOL}$2`)
    .replace(/₹/g, INR_SYMBOL)
    .replace(/…/g, '...')
    .replace(MOJIBAKE_NOISE, ' ');

  next = next
    .replace(/\s*[•·]\s*/g, ' · ')
    .replace(/\s*→\s*/g, ' → ')
    .replace(/\s*[–—]\s*/g, ` ${DISPLAY_FALLBACK} `)
    .replace(/\s*×\s*/g, ' x ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!next || next === '?' || next.toLowerCase() === 'undefined' || next.toLowerCase() === 'null') {
    return fallback;
  }
  return next;
};

const cleanOptionalText = (value: unknown) => {
  const cleaned = sanitizeDisplayText(value, '');
  const normalized = cleaned.toLowerCase();
  if (!cleaned || cleaned === DISPLAY_FALLBACK) return '';
  if (normalized === 'na' || normalized === 'n/a' || normalized === 'none' || normalized === 'not added') return '';
  return cleaned;
};

export const formatOptionalText = (value: unknown, fallback = DISPLAY_FALLBACK) => cleanOptionalText(value) || fallback;
export const formatGstText = (value: unknown) => cleanOptionalText(value) || GST_FALLBACK;
export const formatContactText = (value: unknown) => cleanOptionalText(value) || CONTACT_FALLBACK;
export const formatLocationText = (value: unknown) => cleanOptionalText(value) || LOCATION_FALLBACK;

export const joinDisplayParts = (...parts: Array<unknown>) => {
  const cleaned = parts.map((part) => cleanOptionalText(part)).filter(Boolean);
  return cleaned.length ? cleaned.join(' · ') : DISPLAY_FALLBACK;
};

export const formatMoneyPrecise = (value: unknown) => MONEY_FORMATTER.format(roundTo(value, 2));

export const formatMoneyWhole = (value: unknown) => WHOLE_MONEY_FORMATTER.format(roundByHalfRule(value));

export const roundMoneyWhole = (value: unknown) => roundByHalfRule(value);

export const formatCurrency = (value: unknown) => `${INR_SYMBOL}${formatMoneyPrecise(value)}`;

export const formatCurrencyWhole = (value: unknown) => `${INR_SYMBOL}${formatMoneyWhole(value)}`;

export const formatINRPrecise = (value: unknown) => formatCurrency(value);

export const formatINRWhole = (value: unknown) => formatCurrencyWhole(value);

export const formatMoneyFixed2 = (value: unknown) => roundTo(value, 2).toFixed(2);

export const formatMoneyRounded = (value: unknown) => formatMoneyWhole(value);


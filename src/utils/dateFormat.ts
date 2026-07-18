const toValidDate = (value?: string | number | Date | null) => {
  const parsed = value instanceof Date ? value : new Date(value || '');
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const pad = (value: number) => String(value).padStart(2, '0');

export const formatDateDisplay = (value?: string | number | Date | null, fallback = '—') => {
  const parsed = toValidDate(value);
  if (!parsed) return fallback;
  return `${pad(parsed.getDate())}-${pad(parsed.getMonth() + 1)}-${parsed.getFullYear()}`;
};

export const formatDateTimeDisplay = (value?: string | number | Date | null, fallback = '—') => {
  const parsed = toValidDate(value);
  if (!parsed) return fallback;
  let hours = parsed.getHours();
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${formatDateDisplay(parsed, fallback)} ${pad(hours)}:${pad(parsed.getMinutes())} ${meridiem}`;
};

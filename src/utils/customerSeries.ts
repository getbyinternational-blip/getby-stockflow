import { Customer } from '../../types';

const normalizeNamePart = (value: string) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export const getCustomerSeriesPrefix = (name: string) => {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .map(normalizeNamePart)
    .filter(Boolean);
  if (!parts.length) return 'CU';
  const first = parts[0][0] || 'C';
  const second = parts[1]?.[0] || parts[0][1] || parts[0][0] || 'U';
  return `${first}${second}`;
};

export const buildCustomerSeriesMap = (customers: Customer[]) => {
  const sorted = [...customers].sort((a, b) => {
    const nameCompare = String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    if (nameCompare !== 0) return nameCompare;
    const phoneCompare = String(a.phone || '').localeCompare(String(b.phone || ''), undefined, { sensitivity: 'base' });
    if (phoneCompare !== 0) return phoneCompare;
    return String(a.id || '').localeCompare(String(b.id || ''), undefined, { sensitivity: 'base' });
  });

  const counts = new Map<string, number>();
  const result = new Map<string, string>();
  sorted.forEach((customer) => {
    const prefix = getCustomerSeriesPrefix(customer.name || '');
    const nextCount = (counts.get(prefix) || 0) + 1;
    counts.set(prefix, nextCount);
    result.set(customer.id, `${prefix}${String(nextCount).padStart(2, '0')}`);
  });
  return result;
};

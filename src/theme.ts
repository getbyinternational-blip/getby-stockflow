import type { StoreProfile } from '../types';

export type AppThemeMode = 'light' | 'dark';

export const normalizeThemeMode = (value: unknown): AppThemeMode =>
  value === 'dark' ? 'dark' : 'light';

export const applyThemeMode = (mode: unknown) => {
  if (typeof document === 'undefined') return;
  const normalized = normalizeThemeMode(mode);
  document.documentElement.classList.toggle('dark', normalized === 'dark');
  document.documentElement.dataset.theme = normalized;
};

export const applyProfileTheme = (profile?: Partial<StoreProfile> | null) => {
  applyThemeMode(profile?.themeMode);
};

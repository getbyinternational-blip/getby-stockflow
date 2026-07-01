const getTelegramServerUrl = () => {
  const value = String((import.meta as any)?.env?.VITE_TELEGRAM_SERVER_URL || '').trim().replace(/\/$/, '');
  if (!value) {
    throw new Error('Telegram server URL is not configured. Set VITE_TELEGRAM_SERVER_URL and try again.');
  }
  return value;
};

const getTelegramHeaders = () => {
  const apiKey = String((import.meta as any)?.env?.VITE_TELEGRAM_API_KEY || '').trim();
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };
};

const safeJson = async (response: Response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
};

export type TelegramProductPostPayload = {
  mode: 'post_now' | 'schedule';
  scheduleMode: 'none' | 'every_hour_random' | 'every_morning' | 'every_2_minutes_batch';
  products: Array<{
    id: string;
    name: string;
    price: number;
    image: string;
    category: string;
    stock: number;
  }>;
  template: string;
  notes: string;
};

export const createTelegramProductPost = async (payload: TelegramProductPostPayload) => {
  const response = await fetch(`${getTelegramServerUrl()}/api/telegram/product-posts`, {
    method: 'POST',
    headers: getTelegramHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || 'Telegram product post request failed.');
  }
  return data;
};

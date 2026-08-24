let hasLoggedTelegramServerUrl = false;

export const TELEGRAM_POLL_INTERVAL_MS = 5_000;

export const TELEGRAM_DEBUG_LOGS_ENABLED =
  String(
    (import.meta as any)?.env
      ?.VITE_DEBUG_TELEGRAM_LOGS || 'false',
  )
    .trim()
    .toLowerCase() === 'true';

export const TELEGRAM_SERVER_URL = String(
  (import.meta as any)?.env
    ?.VITE_TELEGRAM_SERVER_URL || '',
)
  .trim()
  .replace(/\/+$/, '');

export const TELEGRAM_API_KEY = String(
  (import.meta as any)?.env
    ?.VITE_TELEGRAM_API_KEY || '',
).trim();

export const logTelegramDebug = (
  event: string,
  payload: Record<string, unknown> = {},
): void => {
  if (!TELEGRAM_DEBUG_LOGS_ENABLED) {
    return;
  }

  console.log(event, payload);
};

export const getTelegramServerUrl = (): string => {
  if (!hasLoggedTelegramServerUrl) {
    logTelegramDebug('telegram.server_url', {
      telegramServerUrl: TELEGRAM_SERVER_URL,
      hasTelegramServerUrl: Boolean(
        TELEGRAM_SERVER_URL,
      ),
    });

    hasLoggedTelegramServerUrl = true;
  }

  if (!TELEGRAM_SERVER_URL) {
    throw new Error(
      'Telegram server URL is not configured. Set VITE_TELEGRAM_SERVER_URL and try again.',
    );
  }

  return TELEGRAM_SERVER_URL;
};

export const getTelegramHeaders =
  (): Record<string, string> => ({
    'Content-Type': 'application/json',

    ...(TELEGRAM_API_KEY
      ? {
          'x-stockflow-telegram-key':
            TELEGRAM_API_KEY,
        }
      : {}),
  });
let hasLoggedTelegramServerUrl = false;

export const TELEGRAM_POLL_INTERVAL_MS = 5_000;

export const TELEGRAM_DEBUG_LOGS_ENABLED =
  String(
    import.meta.env
      .VITE_DEBUG_TELEGRAM_LOGS ?? 'false',
  )
    .trim()
    .toLowerCase() === 'true';

export const TELEGRAM_SERVER_URL = String(
  import.meta.env
    .VITE_TELEGRAM_SERVER_URL ?? '',
)
  .trim()
  .replace(/\/+$/, '');

export const TELEGRAM_API_KEY = String(
  import.meta.env
    .VITE_TELEGRAM_API_KEY ?? '',
).trim();

console.warn('[TELEGRAM CONFIG LOADED]', {
  mode: import.meta.env.MODE,
  dev: import.meta.env.DEV,
  debugRaw:
    import.meta.env
      .VITE_DEBUG_TELEGRAM_LOGS,
  serverUrlRaw:
    import.meta.env
      .VITE_TELEGRAM_SERVER_URL,
  apiKeyExists: Boolean(
    import.meta.env
      .VITE_TELEGRAM_API_KEY,
  ),
  resolvedServerUrl:
    TELEGRAM_SERVER_URL,
});

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
    console.warn('[TELEGRAM getTelegramServerUrl]', {
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

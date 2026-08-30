import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const TEST_TELEGRAM_SERVER_URL =
  String(
    process.env
      .VITE_TELEGRAM_SERVER_URL ||
      'http://localhost:4100',
  )
    .trim()
    .replace(/\/+$/, '');

const loadConfig = async () => {
  vi.resetModules();

  return import(
    './telegramConfig'
  );
};

describe('telegramConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('uses a five-second polling interval', async () => {
    const config =
      await loadConfig();

    expect(
      config.TELEGRAM_POLL_INTERVAL_MS,
    ).toBe(5_000);
  });

  it('normalizes the server URL and API key', async () => {
    vi.stubEnv(
      'VITE_TELEGRAM_SERVER_URL',
      `  ${TEST_TELEGRAM_SERVER_URL}/// `,
    );

    vi.stubEnv(
      'VITE_TELEGRAM_API_KEY',
      ' test-key ',
    );

    const config =
      await loadConfig();

    expect(
      config.TELEGRAM_SERVER_URL,
    ).toBe(
      TEST_TELEGRAM_SERVER_URL,
    );

    expect(
      config.TELEGRAM_API_KEY,
    ).toBe('test-key');

    expect(
      config.getTelegramServerUrl(),
    ).toBe(
      TEST_TELEGRAM_SERVER_URL,
    );

    expect(
      config.getTelegramHeaders(),
    ).toEqual({
      'Content-Type':
        'application/json',
      'x-stockflow-telegram-key':
        'test-key',
    });
  });

  it('omits the API-key header when no key is configured', async () => {
    vi.stubEnv(
      'VITE_TELEGRAM_SERVER_URL',
      TEST_TELEGRAM_SERVER_URL,
    );

    vi.stubEnv(
      'VITE_TELEGRAM_API_KEY',
      '',
    );

    const config =
      await loadConfig();

    expect(
      config.getTelegramHeaders(),
    ).toEqual({
      'Content-Type':
        'application/json',
    });
  });

  it('throws when the Telegram server URL is missing', async () => {
    vi.stubEnv(
      'VITE_TELEGRAM_SERVER_URL',
      '',
    );

    const config =
      await loadConfig();

    expect(() =>
      config.getTelegramServerUrl(),
    ).toThrow(
      'Telegram server URL is not configured.',
    );
  });

  it('does not log debug events when debug logging is disabled', async () => {
    vi.stubEnv(
      'VITE_DEBUG_TELEGRAM_LOGS',
      'false',
    );

    const log =
      vi.spyOn(
        console,
        'log',
      ).mockImplementation(
        () => {},
      );

    const config =
      await loadConfig();

    config.logTelegramDebug(
      'telegram.test',
      {
        value: 1,
      },
    );

    expect(log).not.toHaveBeenCalled();
  });

  it('logs debug events when explicitly enabled', async () => {
    vi.stubEnv(
      'VITE_DEBUG_TELEGRAM_LOGS',
      'true',
    );

    const log =
      vi.spyOn(
        console,
        'log',
      ).mockImplementation(
        () => {},
      );

    const config =
      await loadConfig();

    config.logTelegramDebug(
      'telegram.test',
      {
        value: 1,
      },
    );

    expect(log).toHaveBeenCalledWith(
      'telegram.test',
      {
        value: 1,
      },
    );
  });
});

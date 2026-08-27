import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('./telegramConfig', () => ({
  getTelegramServerUrl: () =>
    'http://localhost:4100',

  getTelegramHeaders: () => ({
    'Content-Type':
      'application/json',
    'x-stockflow-telegram-key':
      'test-public-key',
  }),

  logTelegramDebug: vi.fn(),
}));

import {
  getLiveTelegramCollections,
  getTelegramCollection,
} from './telegram';

const getFetchMock = () =>
  vi.mocked(globalThis.fetch);

describe('telegram HTTP error handling', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('normalizes fetch failures as network errors', async () => {
    getFetchMock().mockRejectedValue(
      new TypeError(
        'Failed to fetch',
      ),
    );

    await expect(
      getLiveTelegramCollections(),
    ).rejects.toMatchObject({
      name: 'TelegramClientError',
      kind: 'network',
      message:
        'Backend not reachable',
    });
  });

  it('maps nested 401 backend errors to auth errors', async () => {
    getFetchMock().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message:
              'Invalid Telegram API key',
            code: 'AUTH_FAILED',
          },
        }),
        {
          status: 401,
          headers: {
            'Content-Type':
              'application/json',
          },
        },
      ),
    );

    await expect(
      getLiveTelegramCollections(),
    ).rejects.toMatchObject({
      name: 'TelegramClientError',
      kind: 'auth',
      status: 401,
      code: 'AUTH_FAILED',
      message:
        'Invalid Telegram API key',
    });
  });

  it('uses the retry-after response header for rate limits', async () => {
    getFetchMock().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Slow down',
          code: 'RATE_LIMIT',
        }),
        {
          status: 429,
          headers: {
            'Content-Type':
              'application/json',
            'retry-after': '12',
          },
        },
      ),
    );

    await expect(
      getLiveTelegramCollections(),
    ).rejects.toMatchObject({
      kind: 'rate_limit',
      status: 429,
      code: 'RATE_LIMIT',
      retryAfterSeconds: 12,
      message: 'Slow down',
    });
  });

  it('prefers body retry-after information over the response header', async () => {
    getFetchMock().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Slow down',
          retryAfterSeconds: 3,
        }),
        {
          status: 429,
          headers: {
            'Content-Type':
              'application/json',
            'retry-after': '20',
          },
        },
      ),
    );

    await expect(
      getLiveTelegramCollections(),
    ).rejects.toMatchObject({
      kind: 'rate_limit',
      retryAfterSeconds: 3,
    });
  });

  it('preserves plain-text server error messages', async () => {
    getFetchMock().mockResolvedValue(
      new Response(
        'Telegram upstream unavailable',
        {
          status: 503,
        },
      ),
    );

    await expect(
      getLiveTelegramCollections(),
    ).rejects.toMatchObject({
      kind: 'server',
      status: 503,
      message:
        'Telegram upstream unavailable',
    });
  });

  it('treats an unknown successful response shape as an empty collection list', async () => {
    getFetchMock().mockResolvedValue(
      new Response(
        'not-json-but-successful',
        {
          status: 200,
        },
      ),
    );

    await expect(
      getLiveTelegramCollections(),
    ).resolves.toEqual([]);
  });

  it('returns null for a successful collection response without identity', async () => {
    getFetchMock().mockResolvedValue(
      new Response(
        JSON.stringify({
          collection: {
            status: 'running',
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type':
              'application/json',
          },
        },
      ),
    );

    await expect(
      getTelegramCollection(
        'collection-1',
      ),
    ).resolves.toBeNull();
  });
});
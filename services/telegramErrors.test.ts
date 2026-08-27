import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  TelegramClientError,
  createTelegramHttpError,
  createTelegramNetworkError,
  getDefaultTelegramErrorMessage,
  getTelegramErrorKindFromStatus,
  getTelegramErrorMessage,
  isTelegramClientError,
  isTelegramNetworkError,
  toTelegramClientError,
} from './telegramErrors';

describe('telegramErrors', () => {
  describe('HTTP status classification', () => {
    it.each([
      [401, 'auth'],
      [403, 'auth'],
      [400, 'validation'],
      [422, 'validation'],
      [404, 'not_found'],
      [409, 'conflict'],
      [429, 'rate_limit'],
      [500, 'server'],
      [503, 'server'],
      [200, 'unknown'],
      [undefined, 'unknown'],
    ] as const)(
      'maps %s to %s',
      (status, expected) => {
        expect(
          getTelegramErrorKindFromStatus(
            status,
          ),
        ).toBe(expected);
      },
    );
  });

  describe('network errors', () => {
    it.each([
      'Failed to fetch',
      'NetworkError',
      'network error',
      'Network request failed',
      'Load failed',
    ])(
      'recognizes %s',
      (message) => {
        expect(
          isTelegramNetworkError(
            new Error(message),
          ),
        ).toBe(true);
      },
    );

    it('does not classify arbitrary errors as network errors', () => {
      expect(
        isTelegramNetworkError(
          new Error('Validation failed'),
        ),
      ).toBe(false);
    });

    it('creates a canonical network error', () => {
      const cause =
        new Error('Failed to fetch');

      const error =
        createTelegramNetworkError(
          cause,
        );

      expect(error).toBeInstanceOf(
        TelegramClientError,
      );

      expect(error).toMatchObject({
        name: 'TelegramClientError',
        kind: 'network',
        message:
          'Backend not reachable',
      });

      expect(error.cause).toBe(cause);
    });
  });

  describe('HTTP errors', () => {
    it('normalizes status, code and retry-after data', () => {
      const cause = {
        backend: true,
      };

      const error =
        createTelegramHttpError({
          status: 429,
          message: 'Slow down',
          code: 'RATE_LIMIT',
          retryAfterSeconds: '12',
          cause,
        });

      expect(error).toMatchObject({
        kind: 'rate_limit',
        status: 429,
        code: 'RATE_LIMIT',
        retryAfterSeconds: 12,
        message: 'Slow down',
      });

      expect(error.cause).toBe(cause);
    });

    it('uses a default message when backend message is empty', () => {
      const error =
        createTelegramHttpError({
          status: 404,
          message: '   ',
        });

      expect(error.message).toBe(
        'Telegram collection not found',
      );
    });

    it('falls back invalid HTTP statuses to server error 500', () => {
      const error =
        createTelegramHttpError({
          status: 42,
        });

      expect(error.status).toBe(500);
      expect(error.kind).toBe(
        'server',
      );

      expect(error.message).toBe(
        'Telegram server request failed',
      );
    });

    it('ignores invalid retry-after values', () => {
      const error =
        createTelegramHttpError({
          status: 429,
          retryAfterSeconds: -1,
        });

      expect(
        error.retryAfterSeconds,
      ).toBeUndefined();
    });
  });

  describe('normalization', () => {
    it('returns an existing TelegramClientError unchanged', () => {
      const existing =
        createTelegramHttpError({
          status: 409,
          message: 'Conflict',
        });

      expect(
        toTelegramClientError(
          existing,
        ),
      ).toBe(existing);
    });

    it('normalizes fetch failures to network errors', () => {
      const error =
        toTelegramClientError(
          new TypeError(
            'Failed to fetch',
          ),
        );

      expect(error.kind).toBe(
        'network',
      );

      expect(error.message).toBe(
        'Backend not reachable',
      );
    });

    it('normalizes object-shaped HTTP errors', () => {
      const source = {
        status: '404',
        error: 'Missing',
        errorCode: 'NOT_FOUND',
        retryAfter: '5',
      };

      const error =
        toTelegramClientError(
          source,
        );

      expect(error).toMatchObject({
        kind: 'not_found',
        status: 404,
        code: 'NOT_FOUND',
        retryAfterSeconds: 5,
        message: 'Missing',
      });

      expect(error.cause).toBe(source);
    });

    it('keeps ordinary Error messages', () => {
      const error =
        toTelegramClientError(
          new Error('Something broke'),
        );

      expect(error.kind).toBe(
        'unknown',
      );

      expect(error.message).toBe(
        'Something broke',
      );
    });

    it('uses the supplied fallback for empty unknown errors', () => {
      expect(
        getTelegramErrorMessage(
          null,
          'Custom fallback',
        ),
      ).toBe(
        'Custom fallback',
      );
    });
  });

  describe('helpers', () => {
    it('identifies TelegramClientError instances', () => {
      expect(
        isTelegramClientError(
          createTelegramNetworkError(),
        ),
      ).toBe(true);

      expect(
        isTelegramClientError(
          new Error('ordinary'),
        ),
      ).toBe(false);
    });

    it('provides canonical default messages', () => {
      expect(
        getDefaultTelegramErrorMessage(
          'auth',
        ),
      ).toBe(
        'Telegram auth failed',
      );

      expect(
        getDefaultTelegramErrorMessage(
          'validation',
        ),
      ).toBe(
        'Telegram request validation failed',
      );

      expect(
        getDefaultTelegramErrorMessage(
          'conflict',
        ),
      ).toBe(
        'Telegram collection state conflict',
      );

      expect(
        getDefaultTelegramErrorMessage(
          'rate_limit',
        ),
      ).toBe(
        'Telegram request rate limited',
      );

      expect(
        getDefaultTelegramErrorMessage(
          'unknown',
          418,
        ),
      ).toBe(
        'Telegram request failed (418)',
      );
    });
  });
});
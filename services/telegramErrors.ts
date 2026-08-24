export type TelegramErrorKind =
  | 'network'
  | 'auth'
  | 'validation'
  | 'conflict'
  | 'not_found'
  | 'rate_limit'
  | 'server'
  | 'unknown';

export type TelegramErrorDetails = {
  kind: TelegramErrorKind;
  message: string;
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
  cause?: unknown;
};

export class TelegramClientError extends Error {
  readonly kind: TelegramErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;
  readonly cause?: unknown;

  constructor(details: TelegramErrorDetails) {
    super(details.message);

    this.name = 'TelegramClientError';
    this.kind = details.kind;
    this.status = details.status;
    this.code = details.code;
    this.retryAfterSeconds =
      details.retryAfterSeconds;
    this.cause = details.cause;

    Object.setPrototypeOf(
      this,
      TelegramClientError.prototype,
    );
  }
}

const safeText = (
  value: unknown,
): string => {
  return String(value ?? '').trim();
};

const normalizeStatus = (
  value: unknown,
): number | undefined => {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 100 ||
    parsed > 599
  ) {
    return undefined;
  }

  return parsed;
};

const normalizeRetryAfter = (
  value: unknown,
): number | undefined => {
  const parsed = Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    return undefined;
  }

  return parsed;
};

export const getTelegramErrorKindFromStatus = (
  status?: number,
): TelegramErrorKind => {
  if (status === 401 || status === 403) {
    return 'auth';
  }

  if (status === 400 || status === 422) {
    return 'validation';
  }

  if (status === 404) {
    return 'not_found';
  }

  if (status === 409) {
    return 'conflict';
  }

  if (status === 429) {
    return 'rate_limit';
  }

  if (
    typeof status === 'number' &&
    status >= 500
  ) {
    return 'server';
  }

  return 'unknown';
};

export const isTelegramNetworkError = (
  error: unknown,
): boolean => {
  const message =
    error instanceof Error
      ? error.message
      : safeText(error);

  const normalized =
    message.toLowerCase();

  return (
    normalized.includes(
      'failed to fetch',
    ) ||
    normalized.includes(
      'networkerror',
    ) ||
    normalized.includes(
      'network error',
    ) ||
    normalized.includes(
      'network request failed',
    ) ||
    normalized.includes(
      'load failed',
    )
  );
};

export const createTelegramNetworkError = (
  cause?: unknown,
): TelegramClientError => {
  return new TelegramClientError({
    kind: 'network',
    message: 'Backend not reachable',
    cause,
  });
};

export const createTelegramHttpError = (
  params: {
    status: number;
    message?: unknown;
    code?: unknown;
    retryAfterSeconds?: unknown;
    cause?: unknown;
  },
): TelegramClientError => {
  const status =
    normalizeStatus(params.status) ?? 500;

  const kind =
    getTelegramErrorKindFromStatus(
      status,
    );

  const message =
    safeText(params.message) ||
    getDefaultTelegramErrorMessage(
      kind,
      status,
    );

  const code =
    safeText(params.code) ||
    undefined;

  const retryAfterSeconds =
    normalizeRetryAfter(
      params.retryAfterSeconds,
    );

  return new TelegramClientError({
    kind,
    status,
    code,
    message,
    retryAfterSeconds,
    cause: params.cause,
  });
};

export const getDefaultTelegramErrorMessage = (
  kind: TelegramErrorKind,
  status?: number,
): string => {
  switch (kind) {
    case 'network':
      return 'Backend not reachable';

    case 'auth':
      return 'Telegram auth failed';

    case 'validation':
      return 'Telegram request validation failed';

    case 'conflict':
      return 'Telegram collection state conflict';

    case 'not_found':
      return 'Telegram collection not found';

    case 'rate_limit':
      return 'Telegram request rate limited';

    case 'server':
      return 'Telegram server request failed';

    default:
      return status
        ? `Telegram request failed (${status})`
        : 'Telegram request failed';
  }
};

export const toTelegramClientError = (
  error: unknown,
  fallback = 'Telegram request failed',
): TelegramClientError => {
  if (
    error instanceof
    TelegramClientError
  ) {
    return error;
  }

  if (isTelegramNetworkError(error)) {
    return createTelegramNetworkError(
      error,
    );
  }

  if (
    error &&
    typeof error === 'object'
  ) {
    const record =
      error as Record<
        string,
        unknown
      >;

    const status =
      normalizeStatus(
        record.status,
      );

    if (status) {
      return createTelegramHttpError({
        status,
        message:
          record.message ??
          record.error,
        code:
          record.code ??
          record.errorCode,
        retryAfterSeconds:
          record.retryAfterSeconds ??
          record.retryAfter,
        cause: error,
      });
    }
  }

  const message =
    error instanceof Error
      ? safeText(error.message)
      : safeText(error);

  return new TelegramClientError({
    kind: 'unknown',
    message:
      message ||
      fallback,
    cause: error,
  });
};

export const isTelegramClientError = (
  error: unknown,
): error is TelegramClientError => {
  return (
    error instanceof
    TelegramClientError
  );
};

export const getTelegramErrorMessage = (
  error: unknown,
  fallback = 'Telegram request failed',
): string => {
  return toTelegramClientError(
    error,
    fallback,
  ).message;
};
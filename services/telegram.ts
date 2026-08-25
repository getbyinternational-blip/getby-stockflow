import type {
  TelegramCollectionActivityItem,
  TelegramCollectionFrequencyUnit,
  TelegramCollectionRepeatMode,
  TelegramLiveCollection,
  TelegramSchedulerProduct,
} from '../types';

import {
  getTelegramHeaders,
  getTelegramServerUrl,
  logTelegramDebug,
} from './telegramConfig';

import {
  createTelegramHttpError,
  toTelegramClientError,
} from './telegramErrors';

import {
  extractTelegramActivityRows,
  extractTelegramCollectionRow,
  extractTelegramCollectionRows,
  mapTelegramCollectionActivityItem,
  mapTelegramLiveCollection,
} from './telegramMapper';

import {
  buildTelegramCollectionControlRequest,
  buildTelegramCollectionStartRequest,
  buildTelegramManualPostRequest,
} from './telegramPayloads';

type UnknownRecord =
  Record<string, unknown>;

const isRecord = (
  value: unknown,
): value is UnknownRecord => {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
};

const safeText = (
  value: unknown,
): string => {
  return String(
    value ?? '',
  ).trim();
};

const safeJson = async (
  response: Response,
): Promise<unknown> => {
  const text =
    await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      message: text,
    };
  }
};

const getErrorDetails = (
  data: unknown,
): {
  message?: unknown;
  code?: unknown;
  retryAfterSeconds?: unknown;
} => {
  if (!isRecord(data)) {
    return {};
  }

  const nestedError =
    isRecord(data.error)
      ? data.error
      : {};

  const stringError =
    typeof data.error === 'string'
      ? data.error
      : undefined;

  return {
    message:
      data.message ??
      nestedError.message ??
      stringError,

    code:
      data.code ??
      data.errorCode ??
      nestedError.code ??
      nestedError.errorCode,

    retryAfterSeconds:
      data.retryAfterSeconds ??
      data.retryAfter ??
      nestedError.retryAfterSeconds ??
      nestedError.retryAfter,
  };
};

const readResponseData = async <T>(
  response: Response,
  fallback: string,
): Promise<T> => {
  const data =
    await safeJson(response);

  if (!response.ok) {
    const details =
      getErrorDetails(data);

    const retryAfterHeader =
      response.headers.get(
        'retry-after',
      );

    throw createTelegramHttpError({
      status:
        response.status,

      message:
        details.message ||
        fallback,

      code:
        details.code,

      retryAfterSeconds:
        details.retryAfterSeconds ??
        (
          retryAfterHeader
            ? Number(
                retryAfterHeader,
              )
            : undefined
        ),

      cause:
        data,
    });
  }

  return data as T;
};

const requestTelegram = async <T>(
  path: string,
  options: RequestInit = {},
  fallback =
    'Telegram request failed',
): Promise<T> => {
  try {
    const response =
      await fetch(
        `${getTelegramServerUrl()}${path}`,
        {
          ...options,

          headers: {
            ...getTelegramHeaders(),
            ...(options.headers || {}),
          },
        },
      );

    return await readResponseData<T>(
      response,
      fallback,
    );
  } catch (error) {
    throw toTelegramClientError(
      error,
      fallback,
    );
  }
};

const hasCollectionIdentity = (
  value: UnknownRecord,
): boolean => {
  return Boolean(
    safeText(
      value.id ??
        value.collectionId ??
        value._id,
    ),
  );
};

const mapCollectionResponse = (
  data: unknown,
): TelegramLiveCollection | null => {
  const row =
    extractTelegramCollectionRow(
      data,
    );

  if (
    !isRecord(row) ||
    !hasCollectionIdentity(row)
  ) {
    return null;
  }

  return mapTelegramLiveCollection(
    row,
  );
};

/**
 * Compatibility type for the current
 * TelegramPosts.tsx manual Send Now flow.
 *
 * This can be removed after the page has
 * migrated to the canonical request type.
 */
export type TelegramProductPostPayload = {
  channelId: string;

  product: {
    id: string;
    name: string;
    price: number;
    image: string;
    category: string;
    stock: number;
    description?: string;
    keywords?: string;
  };

  template: string;
  notes: string;
};

/**
 * Compatibility type for the current
 * TelegramPosts.tsx collection-start flow.
 *
 * Legacy fields remain accepted here so
 * the large page can be migrated safely
 * in later steps.
 *
 * Only canonical backend fields are sent.
 */
export type TelegramCollectionSchedulerPayload = {
  id?: string;
  collectionId?: string;
  collectionName?: string;

  name: string;
  channelId: string;

  template: string;
  notes: string;
  category: string;

  frequency?: {
    value: number;
    unit: TelegramCollectionFrequencyUnit;
  };

  frequencyValue: number;

  frequencyUnit:
    TelegramCollectionFrequencyUnit;

  batchSize?: number;

  startAt?: string | null;

  /**
   * Legacy page compatibility.
   * Converted to canonical startAt.
   */
  autoStartTime?: string;

  /**
   * Legacy page field.
   * Backend scheduler no longer uses it.
   */
  endTime?: string;

  repeatMode:
    TelegramCollectionRepeatMode;

  maxFailuresBeforePause: number;

  /**
   * Legacy frontend-only field.
   * Not sent to the backend.
   */
  postMode?: string;

  products:
    TelegramSchedulerProduct[];
};

export const createTelegramProductPost =
  async (
    payload:
      TelegramProductPostPayload,
  ): Promise<unknown> => {
    const requestPayload =
      buildTelegramManualPostRequest({
        channelId:
          payload.channelId,

        product:
          payload.product,

        template:
          payload.template,

        notes:
          payload.notes,
      });

    logTelegramDebug(
      'telegram.product_post.request',
      {
        productId:
          requestPayload.product.id,

        channelIdPresent:
          Boolean(
            requestPayload.channelId,
          ),

        hasImage:
          Boolean(
            requestPayload.product.image,
          ),
      },
    );

    return requestTelegram<unknown>(
      '/api/telegram/post-product',
      {
        method: 'POST',

        body:
          JSON.stringify(
            requestPayload,
          ),
      },
      'Telegram product post request failed.',
    );
  };

export const startTelegramCollection =
  async (
    payload:
      TelegramCollectionSchedulerPayload,
  ): Promise<
    TelegramLiveCollection | null
  > => {
    const frequencyValue =
      Number.isFinite(
        Number(
          payload.frequencyValue,
        ),
      )
        ? Number(
            payload.frequencyValue,
          )
        : Number(
            payload.frequency?.value,
          );

    const frequencyUnit =
      payload.frequencyUnit ||
      payload.frequency?.unit ||
      'minutes';

    const requestPayload =
      buildTelegramCollectionStartRequest({
        id:
          payload.id,

        collectionId:
          payload.collectionId,

        name:
          payload.name ||
          payload.collectionName ||
          '',

        channelId:
          payload.channelId,

        category:
          payload.category,

        template:
          payload.template,

        notes:
          payload.notes,

        frequencyValue,

        frequencyUnit,

        batchSize:
          payload.batchSize ??
          2,

        startAt:
          payload.startAt,

        autoStartTime:
          payload.autoStartTime,

        repeatMode:
          payload.repeatMode ||
          'loop',

        maxFailuresBeforePause:
          payload.maxFailuresBeforePause ||
          3,

        products:
          payload.products,
      });

    logTelegramDebug(
      'telegram.collection.start.request',
      {
        collectionId:
          requestPayload.collectionId,

        name:
          requestPayload.name,

        channelIdPresent:
          Boolean(
            requestPayload.channelId,
          ),

        productsCount:
          requestPayload.products.length,

        frequencyValue:
          requestPayload.frequencyValue,

        frequencyUnit:
          requestPayload.frequencyUnit,

        batchSize:
          requestPayload.batchSize,

        repeatMode:
          requestPayload.repeatMode,

        startAt:
          requestPayload.startAt,
      },
    );

    const data =
      await requestTelegram<unknown>(
        '/api/telegram/collections/start',
        {
          method: 'POST',

          body:
            JSON.stringify(
              requestPayload,
            ),
        },
        'Could not start Telegram collection.',
      );

    return mapCollectionResponse(
      data,
    );
  };

const sendCollectionControlRequest =
  async (
    action:
      | 'pause'
      | 'resume'
      | 'stop',

    collectionId: string,
  ): Promise<
    TelegramLiveCollection | null
  > => {
    const requestPayload =
      buildTelegramCollectionControlRequest(
        collectionId,
      );

    logTelegramDebug(
      `telegram.collection.${action}.request`,
      {
        collectionId:
          requestPayload.collectionId,
      },
    );

    const data =
      await requestTelegram<unknown>(
        `/api/telegram/collections/${action}`,
        {
          method: 'POST',

          body:
            JSON.stringify(
              requestPayload,
            ),
        },
        `Could not ${action} Telegram collection.`,
      );

    return mapCollectionResponse(
      data,
    );
  };

export const stopTelegramCollection =
  async (
    collectionId: string,
  ): Promise<
    TelegramLiveCollection | null
  > => {
    return sendCollectionControlRequest(
      'stop',
      collectionId,
    );
  };

export const pauseTelegramCollection =
  async (
    collectionId: string,
  ): Promise<
    TelegramLiveCollection | null
  > => {
    return sendCollectionControlRequest(
      'pause',
      collectionId,
    );
  };

export const resumeTelegramCollection =
  async (
    collectionId: string,
  ): Promise<
    TelegramLiveCollection | null
  > => {
    return sendCollectionControlRequest(
      'resume',
      collectionId,
    );
  };

export const getLiveTelegramCollections =
  async (): Promise<
    TelegramLiveCollection[]
  > => {
    const data =
      await requestTelegram<unknown>(
        '/api/telegram/collections/live',
        {
          method: 'GET',
        },
        'Could not load live Telegram collections.',
      );

    const rows =
      extractTelegramCollectionRows(
        data,
      );

    return rows
      .filter(isRecord)
      .map(
        (
          row,
          index,
        ) =>
          mapTelegramLiveCollection(
            row,
            index,
          ),
      );
  };

export const getTelegramCollection =
  async (
    id: string,
  ): Promise<
    TelegramLiveCollection | null
  > => {
    const collectionId =
      safeText(id);

    if (!collectionId) {
      return null;
    }

    const data =
      await requestTelegram<unknown>(
        `/api/telegram/collections/${encodeURIComponent(
          collectionId,
        )}`,
        {
          method: 'GET',
        },
        'Could not load Telegram collection.',
      );

    return mapCollectionResponse(
      data,
    );
  };

export const getTelegramCollectionActivity =
  async (
    id: string,
  ): Promise<
    TelegramCollectionActivityItem[]
  > => {
    const collectionId =
      safeText(id);

    if (!collectionId) {
      return [];
    }

    const data =
      await requestTelegram<unknown>(
        `/api/telegram/collections/${encodeURIComponent(
          collectionId,
        )}/activity`,
        {
          method: 'GET',
        },
        'Could not load Telegram collection activity.',
      );

    const rows =
      extractTelegramActivityRows(
        data,
      );

    return rows.map(
      mapTelegramCollectionActivityItem,
    );
  };
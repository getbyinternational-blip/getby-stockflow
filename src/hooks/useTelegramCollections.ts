import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type {
  TelegramLiveCollection,
} from '../../types';

import {
  getLiveTelegramCollections,
  pauseTelegramCollection,
  resumeTelegramCollection,
  startTelegramCollection,
  stopTelegramCollection,
  type TelegramCollectionSchedulerPayload,
} from '../../services/telegram';

import {
  TELEGRAM_POLL_INTERVAL_MS,
} from '../../services/telegramConfig';

import {
  getTelegramErrorMessage,
} from '../../services/telegramErrors';

export type TelegramCollectionAction =
  | 'start'
  | 'pause'
  | 'resume'
  | 'stop';

export type TelegramCollectionControllerErrors = {
  refresh: string | null;
  action: string | null;
};

export type TelegramCollectionPendingActions =
  Record<
    string,
    TelegramCollectionAction | undefined
  >;

export type TelegramCollectionsRefreshOptions = {
  silent?: boolean;
};

export type UseTelegramCollectionsOptions = {
  autoRefresh?: boolean;
  pollIntervalMs?: number;
};

const EMPTY_ERRORS:
  TelegramCollectionControllerErrors = {
    refresh: null,
    action: null,
  };

const safeText = (
  value: unknown,
): string => {
  return String(
    value ?? '',
  ).trim();
};

export const useTelegramCollections = (
  options:
    UseTelegramCollectionsOptions = {},
) => {
  const {
    autoRefresh = true,
    pollIntervalMs =
      TELEGRAM_POLL_INTERVAL_MS,
  } = options;

  const [
    collections,
    setCollections,
  ] = useState<
    TelegramLiveCollection[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    errors,
    setErrors,
  ] = useState<
    TelegramCollectionControllerErrors
  >(EMPTY_ERRORS);

  const [
    pendingActions,
    setPendingActions,
  ] = useState<
    TelegramCollectionPendingActions
  >({});

  const mountedRef =
    useRef(true);

  const hasLoadedRef =
    useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearRefreshError =
    useCallback(() => {
      setErrors(
        (current) => ({
          ...current,
          refresh: null,
        }),
      );
    }, []);

  const clearActionError =
    useCallback(() => {
      setErrors(
        (current) => ({
          ...current,
          action: null,
        }),
      );
    }, []);

  const clearErrors =
    useCallback(() => {
      setErrors(
        EMPTY_ERRORS,
      );
    }, []);

  const refresh =
    useCallback(
      async (
        refreshOptions:
          TelegramCollectionsRefreshOptions = {},
      ): Promise<
        TelegramLiveCollection[]
      > => {
        const {
          silent = false,
        } = refreshOptions;

        if (
          !silent &&
          mountedRef.current
        ) {
          setRefreshing(true);
        }

        if (
          !hasLoadedRef.current &&
          mountedRef.current
        ) {
          setLoading(true);
        }

        try {
          const nextCollections =
            await getLiveTelegramCollections();

          if (mountedRef.current) {
            setCollections(
              nextCollections,
            );

            setErrors(
              (current) => ({
                ...current,
                refresh: null,
              }),
            );

            hasLoadedRef.current =
              true;
          }

          return nextCollections;
        } catch (error) {
          const message =
            getTelegramErrorMessage(
              error,
              'Could not load Telegram collections.',
            );

          if (mountedRef.current) {
            setErrors(
              (current) => ({
                ...current,
                refresh: message,
              }),
            );
          }

          throw error;
        } finally {
          if (mountedRef.current) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      },
      [],
    );

  const setPendingAction =
    useCallback(
      (
        key: string,
        action:
          TelegramCollectionAction,
      ) => {
        setPendingActions(
          (current) => ({
            ...current,
            [key]: action,
          }),
        );
      },
      [],
    );

  const clearPendingAction =
    useCallback(
      (
        key: string,
      ) => {
        setPendingActions(
          (current) => {
            const next = {
              ...current,
            };

            delete next[key];

            return next;
          },
        );
      },
      [],
    );

  const runCollectionAction =
    useCallback(
      async <T,>(
        action:
          TelegramCollectionAction,
        key: string,
        request:
          () => Promise<T>,
      ): Promise<T> => {
        setPendingAction(
          key,
          action,
        );

        clearActionError();

        try {
          const result =
            await request();

          try {
            await refresh({
              silent: true,
            });
          } catch {
            // The action itself succeeded.
            // Refresh errors are stored
            // separately in errors.refresh.
          }

          return result;
        } catch (error) {
          const message =
            getTelegramErrorMessage(
              error,
              `Could not ${action} Telegram collection.`,
            );

          if (mountedRef.current) {
            setErrors(
              (current) => ({
                ...current,
                action: message,
              }),
            );
          }

          throw error;
        } finally {
          if (mountedRef.current) {
            clearPendingAction(
              key,
            );
          }
        }
      },
      [
        clearActionError,
        clearPendingAction,
        refresh,
        setPendingAction,
      ],
    );

  const start =
    useCallback(
      async (
        payload:
          TelegramCollectionSchedulerPayload,
      ) => {
        const key =
          safeText(
            payload.collectionId ||
              payload.id,
          ) ||
          '__new_collection__';

        return runCollectionAction(
          'start',
          key,
          () =>
            startTelegramCollection(
              payload,
            ),
        );
      },
      [
        runCollectionAction,
      ],
    );

  const pause =
    useCallback(
      async (
        collectionId: string,
      ) => {
        const id =
          safeText(
            collectionId,
          );

        return runCollectionAction(
          'pause',
          id,
          () =>
            pauseTelegramCollection(
              id,
            ),
        );
      },
      [
        runCollectionAction,
      ],
    );

  const resume =
    useCallback(
      async (
        collectionId: string,
      ) => {
        const id =
          safeText(
            collectionId,
          );

        return runCollectionAction(
          'resume',
          id,
          () =>
            resumeTelegramCollection(
              id,
            ),
        );
      },
      [
        runCollectionAction,
      ],
    );

  const stop =
    useCallback(
      async (
        collectionId: string,
      ) => {
        const id =
          safeText(
            collectionId,
          );

        return runCollectionAction(
          'stop',
          id,
          () =>
            stopTelegramCollection(
              id,
            ),
        );
      },
      [
        runCollectionAction,
      ],
    );

  const isActionPending =
    useCallback(
      (
        collectionId: string,
      ): boolean => {
        const id =
          safeText(
            collectionId,
          );

        return Boolean(
          pendingActions[id],
        );
      },
      [
        pendingActions,
      ],
    );

  useEffect(() => {
    if (!autoRefresh) {
      setLoading(false);
      return;
    }

    void refresh().catch(
      () => {
        // Error is already stored
        // in errors.refresh.
      },
    );

    if (
      !Number.isFinite(
        pollIntervalMs,
      ) ||
      pollIntervalMs <= 0
    ) {
      return;
    }

    const intervalId =
      window.setInterval(
        () => {
          void refresh({
            silent: true,
          }).catch(
            () => {
              // Error is already stored
              // in errors.refresh.
            },
          );
        },
        pollIntervalMs,
      );

    return () => {
      window.clearInterval(
        intervalId,
      );
    };
  }, [
    autoRefresh,
    pollIntervalMs,
    refresh,
  ]);

  return {
    collections,

    loading,
    refreshing,

    errors,
    pendingActions,

    start,
    pause,
    resume,
    stop,
    refresh,

    clearErrors,
    clearRefreshError,
    clearActionError,

    isActionPending,
  };
};

export default useTelegramCollections;
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type {
  TelegramCollectionActivityItem,
} from '../../types';

import {
  getTelegramCollectionActivity,
} from '../../services/telegram';

import {
  getTelegramErrorMessage,
} from '../../services/telegramErrors';

const safeText = (
  value: unknown,
): string => {
  return String(
    value ?? '',
  ).trim();
};

export const useTelegramActivity =
  () => {
    const [
      selectedCollectionId,
      setSelectedCollectionId,
    ] = useState('');

    const [
      activity,
      setActivity,
    ] = useState<
      TelegramCollectionActivityItem[]
    >([]);

    const [
      loading,
      setLoading,
    ] = useState(false);

    const [
      error,
      setError,
    ] = useState<
      string | null
    >(null);

    const mountedRef =
      useRef(true);

    const requestVersionRef =
      useRef(0);

    useEffect(() => {
      mountedRef.current = true;

      return () => {
        mountedRef.current = false;
      };
    }, []);

    const loadActivity =
      useCallback(
        async (
          collectionId: string,
        ): Promise<
          TelegramCollectionActivityItem[]
        > => {
          const id =
            safeText(
              collectionId,
            );

          if (!id) {
            if (mountedRef.current) {
              setSelectedCollectionId('');
              setActivity([]);
              setError(null);
              setLoading(false);
            }

            return [];
          }

          const requestVersion =
            requestVersionRef.current + 1;

          requestVersionRef.current =
            requestVersion;

          if (mountedRef.current) {
            setSelectedCollectionId(
              id,
            );

            setLoading(true);
            setError(null);
          }

          try {
            const nextActivity =
              await getTelegramCollectionActivity(
                id,
              );

            if (
              mountedRef.current &&
              requestVersionRef.current ===
                requestVersion
            ) {
              setActivity(
                nextActivity,
              );

              setError(null);
            }

            return nextActivity;
          } catch (loadError) {
            const message =
              getTelegramErrorMessage(
                loadError,
                'Could not load Telegram collection activity.',
              );

            if (
              mountedRef.current &&
              requestVersionRef.current ===
                requestVersion
            ) {
              setActivity([]);

              setError(
                message,
              );
            }

            throw loadError;
          } finally {
            if (
              mountedRef.current &&
              requestVersionRef.current ===
                requestVersion
            ) {
              setLoading(false);
            }
          }
        },
        [],
      );

    const refreshActivity =
      useCallback(
        async (): Promise<
          TelegramCollectionActivityItem[]
        > => {
          const id =
            safeText(
              selectedCollectionId,
            );

          if (!id) {
            return [];
          }

          return loadActivity(
            id,
          );
        },
        [
          loadActivity,
          selectedCollectionId,
        ],
      );

    const clearActivity =
      useCallback(() => {
        requestVersionRef.current += 1;

        setSelectedCollectionId('');
        setActivity([]);
        setLoading(false);
        setError(null);
      }, []);

    const clearError =
      useCallback(() => {
        setError(null);
      }, []);

    const isLoadingCollection =
      useCallback(
        (
          collectionId: string,
        ): boolean => {
          return (
            loading &&
            selectedCollectionId ===
              safeText(
                collectionId,
              )
          );
        },
        [
          loading,
          selectedCollectionId,
        ],
      );

    return {
      selectedCollectionId,
      activity,

      loading,
      error,

      loadActivity,
      refreshActivity,
      clearActivity,
      clearError,

      isLoadingCollection,
    };
  };

export default useTelegramActivity;
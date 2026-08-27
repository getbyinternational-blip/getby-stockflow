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
  createTelegramProductPost,
  getLiveTelegramCollections,
  getTelegramCollection,
  getTelegramCollectionActivity,
  pauseTelegramCollection,
  resumeTelegramCollection,
  startTelegramCollection,
  stopTelegramCollection,
} from './telegram';

const jsonResponse = (
  body: unknown,
  status = 200,
): Response => {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'Content-Type':
          'application/json',
      },
    },
  );
};

const getFetchMock = () => {
  return vi.mocked(globalThis.fetch);
};

describe('telegram HTTP service', () => {
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

  describe('manual product posting', () => {
    it('POSTs to /api/telegram/post-product', async () => {
      getFetchMock().mockResolvedValue(
        jsonResponse({
          ok: true,
          messageId: 'message-1',
        }),
      );

      const result =
        await createTelegramProductPost({
          channelId: '@stockflow',
          product: {
            id: 'product-1',
            name: 'Product One',
            price: 100,
            image:
              'https://example.com/product.jpg',
            category: 'featured',
            stock: 5,
            description:
              'Description',
            keywords: 'test',
          },
          template: '{{name}}',
          notes: 'Manual post',
        });

      expect(result).toEqual({
        ok: true,
        messageId: 'message-1',
      });

      expect(
        getFetchMock(),
      ).toHaveBeenCalledTimes(1);

      const [
        url,
        options,
      ] =
        getFetchMock().mock.calls[0];

      expect(url).toBe(
        'http://localhost:4100/api/telegram/post-product',
      );

      expect(options).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          'x-stockflow-telegram-key':
            'test-public-key',
        },
      });

      const body = JSON.parse(
        String(options?.body),
      );

      expect(body.channelId).toBe(
        '@stockflow',
      );

      expect(body.product.id).toBe(
        'product-1',
      );
    });
  });

  describe('collection start', () => {
    it('POSTs canonical data to /collections/start', async () => {
      getFetchMock().mockResolvedValue(
        jsonResponse({
          collection: {
            id: 'collection-1',
            name: 'Featured',
            channelId: '@stockflow',
            status: 'running',
            productsCount: 1,
            productCursor: 0,
            sentCount: 0,
            failedCount: 0,
            frequencyValue: 1,
            frequencyUnit:
              'minutes',
            batchSize: 2,
            repeatMode: 'loop',
            startAt:
              '2026-08-26T14:30:00.000Z',
          },
        }),
      );

      const result =
        await startTelegramCollection({
          id: 'collection-1',
          collectionId:
            'collection-1',
          collectionName:
            'Legacy Name',
          name: 'Featured',
          channelId: '@stockflow',
          template: '{{name}}',
          notes: 'Scheduled',
          category: 'featured',
          frequencyValue: 1,
          frequencyUnit:
            'minutes',
          batchSize: 2,
          startAt:
            '2026-08-26T14:30:00.000Z',
          repeatMode: 'loop',
          maxFailuresBeforePause: 3,

          // Accepted by the page-facing
          // compatibility type, but must
          // never be sent to the backend.
          postMode: 'scheduled',

          products: [
            {
              id: 'product-1',
              name: 'Product One',
              description:
                'Description',
              price: 100,
              salePrice: 90,
              imageUrl:
                'https://example.com/product.jpg',
              category: 'featured',
              stock: 5,
            },
          ],
        });

      expect(result).not.toBeNull();

      expect(result?.id).toBe(
        'collection-1',
      );

      expect(result?.status).toBe(
        'running',
      );

      const [
        url,
        options,
      ] =
        getFetchMock().mock.calls[0];

      expect(url).toBe(
        'http://localhost:4100/api/telegram/collections/start',
      );

      expect(options).toMatchObject({
        method: 'POST',
      });

      const body = JSON.parse(
        String(options?.body),
      );

      expect(body).toMatchObject({
        collectionId:
          'collection-1',
        name: 'Featured',
        channelId: '@stockflow',
        category: 'featured',
        frequencyValue: 1,
        frequencyUnit: 'minutes',
        batchSize: 2,
        startAt:
          '2026-08-26T14:30:00.000Z',
        repeatMode: 'loop',
        maxFailuresBeforePause: 3,
      });

      expect(
        Object.prototype.hasOwnProperty.call(
          body,
          'postMode',
        ),
      ).toBe(false);

      expect(
        Object.prototype.hasOwnProperty.call(
          body,
          'autoStartTime',
        ),
      ).toBe(false);

      expect(
        Object.prototype.hasOwnProperty.call(
          body,
          'endTime',
        ),
      ).toBe(false);
    });
  });

  describe('collection controls', () => {
    it.each([
      [
        'pause',
        pauseTelegramCollection,
        'paused',
      ],
      [
        'resume',
        resumeTelegramCollection,
        'running',
      ],
      [
        'stop',
        stopTelegramCollection,
        'stopped',
      ],
    ] as const)(
      'POSTs the %s action',
      async (
        action,
        functionUnderTest,
        expectedStatus,
      ) => {
        getFetchMock().mockResolvedValue(
          jsonResponse({
            collection: {
              id: 'collection-1',
              status:
                expectedStatus,
            },
          }),
        );

        const result =
          await functionUnderTest(
            ' collection-1 ',
          );

        expect(result?.id).toBe(
          'collection-1',
        );

        expect(result?.status).toBe(
          expectedStatus,
        );

        const [
          url,
          options,
        ] =
          getFetchMock().mock.calls[0];

        expect(url).toBe(
          `http://localhost:4100/api/telegram/collections/${action}`,
        );

        expect(options).toMatchObject({
          method: 'POST',
        });

        expect(
          JSON.parse(
            String(options?.body),
          ),
        ).toEqual({
          collectionId:
            'collection-1',
        });
      },
    );
  });

  describe('live collections', () => {
    it('GETs and maps /collections/live', async () => {
      getFetchMock().mockResolvedValue(
        jsonResponse({
          collections: [
            {
              id: 'collection-1',
              name: 'One',
              status: 'running',
              sentCount: 4,
            },
            {
              id: 'collection-2',
              name: 'Two',
              status: 'paused',
              failedCount: 2,
            },
          ],
        }),
      );

      const result =
        await getLiveTelegramCollections();

      expect(result).toHaveLength(2);

      expect(result[0]).toMatchObject({
        id: 'collection-1',
        status: 'running',
        sentCount: 4,
      });

      expect(result[1]).toMatchObject({
        id: 'collection-2',
        status: 'paused',
        failedCount: 2,
      });

      expect(
        getFetchMock(),
      ).toHaveBeenCalledWith(
        'http://localhost:4100/api/telegram/collections/live',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });
  });

  describe('single collection', () => {
    it('GETs an encoded collection id', async () => {
      getFetchMock().mockResolvedValue(
        jsonResponse({
          collection: {
            id: 'collection / 1',
            name: 'Collection',
            status: 'running',
          },
        }),
      );

      const result =
        await getTelegramCollection(
          ' collection / 1 ',
        );

      expect(result?.id).toBe(
        'collection / 1',
      );

      expect(
        getFetchMock(),
      ).toHaveBeenCalledWith(
        'http://localhost:4100/api/telegram/collections/collection%20%2F%201',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('does not fetch for an empty collection id', async () => {
      const result =
        await getTelegramCollection(
          '   ',
        );

      expect(result).toBeNull();

      expect(
        getFetchMock(),
      ).not.toHaveBeenCalled();
    });
  });

  describe('collection activity', () => {
    it('GETs and maps collection activity', async () => {
      getFetchMock().mockResolvedValue(
        jsonResponse({
          activity: [
            {
              id: 'activity-1',
              collectionId:
                'collection-1',
              timestamp:
                '2026-08-26T10:00:00.000Z',
              event: 'posted',
              productId:
                'product-1',
              productName:
                'Product One',
              telegramMessageId:
                'message-1',
            },
          ],
        }),
      );

      const result =
        await getTelegramCollectionActivity(
          'collection-1',
        );

      expect(result).toHaveLength(1);

      expect(result[0]).toMatchObject({
        id: 'activity-1',
        collectionId:
          'collection-1',
        event: 'posted',
        productId: 'product-1',
        productName:
          'Product One',
        telegramMessageId:
          'message-1',
      });

      expect(
        getFetchMock(),
      ).toHaveBeenCalledWith(
        'http://localhost:4100/api/telegram/collections/collection-1/activity',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('does not fetch activity for an empty collection id', async () => {
      const result =
        await getTelegramCollectionActivity(
          '',
        );

      expect(result).toEqual([]);

      expect(
        getFetchMock(),
      ).not.toHaveBeenCalled();
    });
  });

  describe('headers', () => {
    it('adds Telegram backend headers to requests', async () => {
      getFetchMock().mockResolvedValue(
        jsonResponse({
          collections: [],
        }),
      );

      await getLiveTelegramCollections();

      const options =
        getFetchMock().mock
          .calls[0][1];

      expect(options?.headers).toEqual({
        'Content-Type':
          'application/json',
        'x-stockflow-telegram-key':
          'test-public-key',
      });
    });
  });
});
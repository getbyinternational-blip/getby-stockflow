import {
  describe,
  expect,
  it,
} from 'vitest';

import type {
  Product,
} from '../types';

import {
  getTelegramBuyPrice,
  getTelegramProductBarcode,
  getTelegramProductCategory,
  getTelegramProductDescription,
  getTelegramProductImageUrl,
  getTelegramProductKeywords,
  getTelegramProductName,
  getTelegramProductStock,
  getTelegramSalePrice,
  normalizeTelegramKeywords,
  toTelegramManualPostProduct,
  toTelegramSchedulerProduct,
  toTelegramSchedulerProducts,
} from './telegramProductMapper';

const makeProduct = (
  overrides:
    Record<string, unknown> = {},
): Product => {
  return {
    id: ' product-1 ',
    name: ' Product One ',
    category: ' Featured ',
    barcode: ' 123456 ',
    telegramKeywords:
      'Keywords: summer, sale',
    description:
      ' Product description ',
    thumbnailImage:
      ' https://example.com/thumb.jpg ',
    image:
      'https://example.com/fallback.jpg',
    buyPrice: 80,
    sellPrice: 120,
    stock: 5,
    ...overrides,
  } as unknown as Product;
};

describe('telegramProductMapper', () => {
  it('provides canonical text defaults', () => {
    expect(
      getTelegramProductName(null),
    ).toBe('Unnamed product');

    expect(
      getTelegramProductCategory(
        null,
      ),
    ).toBe('General');

    expect(
      getTelegramProductBarcode(null),
    ).toBe('-');
  });

  it('normalizes Telegram keyword prefixes', () => {
    expect(
      normalizeTelegramKeywords(
        ' Keywords: red, blue ',
      ),
    ).toBe('red, blue');

    expect(
      normalizeTelegramKeywords(
        'plain keywords',
      ),
    ).toBe('plain keywords');
  });

  it('reads and combines product description and keywords', () => {
    const product =
      makeProduct();

    expect(
      getTelegramProductKeywords(
        product,
      ),
    ).toBe(
      'summer, sale',
    );

    expect(
      getTelegramProductDescription(
        product,
      ),
    ).toBe(
      'Product description\nsummer, sale',
    );
  });

  it('keeps description unchanged when keywords are absent', () => {
    const product =
      makeProduct({
        telegramKeywords: '',
      });

    expect(
      getTelegramProductDescription(
        product,
      ),
    ).toBe(
      'Product description',
    );
  });

  it('uses the expected image priority', () => {
    expect(
      getTelegramProductImageUrl(
        makeProduct(),
      ),
    ).toBe(
      'https://example.com/thumb.jpg',
    );

    expect(
      getTelegramProductImageUrl(
        makeProduct({
          thumbnailImage: '',
        }),
      ),
    ).toBe(
      'https://example.com/fallback.jpg',
    );

    expect(
      getTelegramProductImageUrl(
        makeProduct({
          thumbnailImage: '',
          image: '',
          imageSrc:
            'https://example.com/image-src.jpg',
        }),
      ),
    ).toBe(
      'https://example.com/image-src.jpg',
    );

    expect(
      getTelegramProductImageUrl(
        makeProduct({
          thumbnailImage: '',
          image: '',
          imageSrc: '',
          galleryImages: [
            'https://example.com/gallery.jpg',
          ],
        }),
      ),
    ).toBe(
      'https://example.com/gallery.jpg',
    );

    expect(
      getTelegramProductImageUrl(
        makeProduct({
          thumbnailImage: '',
          image: '',
          imageSrc: '',
          galleryImages: [],
          images: [
            {
              src:
                'https://example.com/images-src.jpg',
            },
          ],
        }),
      ),
    ).toBe(
      'https://example.com/images-src.jpg',
    );
  });

  it('normalizes numeric product fields', () => {
    const product =
      makeProduct();

    expect(
      getTelegramBuyPrice(
        product,
      ),
    ).toBe(80);

    expect(
      getTelegramSalePrice(
        product,
      ),
    ).toBe(120);

    expect(
      getTelegramProductStock(
        product,
      ),
    ).toBe(5);

    const invalid =
      makeProduct({
        buyPrice: -10,
        sellPrice: undefined,
        stock: -2,
      });

    expect(
      getTelegramBuyPrice(
        invalid,
      ),
    ).toBe(0);

    expect(
      getTelegramSalePrice(
        invalid,
      ),
    ).toBe(0);

    expect(
      getTelegramProductStock(
        invalid,
      ),
    ).toBe(0);
  });

  it('falls back to buy price when sell price is absent', () => {
    expect(
      getTelegramSalePrice(
        makeProduct({
          sellPrice: undefined,
          buyPrice: 75,
        }),
      ),
    ).toBe(75);
  });

  it('maps an inventory Product to a scheduler product', () => {
    expect(
      toTelegramSchedulerProduct(
        makeProduct(),
      ),
    ).toEqual({
      id: 'product-1',
      name: 'Product One',
      description:
        'Product description\nsummer, sale',
      price: 80,
      salePrice: 120,
      imageUrl:
        'https://example.com/thumb.jpg',
      category: 'Featured',
      stock: 5,
      barcode: '123456',
    });
  });

  it('maps product arrays for the scheduler', () => {
    const result =
      toTelegramSchedulerProducts([
        makeProduct(),
        makeProduct({
          id: 'product-2',
          name: 'Product Two',
        }),
      ]);

    expect(result).toHaveLength(2);

    expect(result[0].id).toBe(
      'product-1',
    );

    expect(result[1].id).toBe(
      'product-2',
    );
  });

  it('maps an inventory Product to the manual post shape', () => {
    expect(
      toTelegramManualPostProduct(
        makeProduct(),
      ),
    ).toEqual({
      id: 'product-1',
      name: 'Product One',
      price: 120,
      image:
        'https://example.com/thumb.jpg',
      category: 'Featured',
      stock: 5,
      description:
        'Product description\nsummer, sale',
      keywords:
        'summer, sale',
    });
  });
});
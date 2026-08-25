import type {
  Product,
  TelegramManualPostProduct,
  TelegramSchedulerProduct,
} from '../types';

type UnknownRecord = Record<string, unknown>;

const safeText = (
  value: unknown,
  fallback = '',
): string => {
  const text = String(value ?? '').trim();

  return text || fallback;
};

const toNonNegativeNumber = (
  value: unknown,
  fallback = 0,
): number => {
  const parsed = Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    return fallback;
  }

  return parsed;
};

const asRecord = (
  value: unknown,
): UnknownRecord => {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return value as UnknownRecord;
  }

  return {};
};

export const getTelegramProductName = (
  product?: Product | null,
): string => {
  return safeText(
    product?.name,
    'Unnamed product',
  );
};

export const getTelegramProductCategory = (
  product?: Product | null,
): string => {
  return safeText(
    product?.category,
    'General',
  );
};

export const getTelegramProductBarcode = (
  product?: Product | null,
): string => {
  return safeText(
    product?.barcode,
    '-',
  );
};

export const normalizeTelegramKeywords = (
  value: unknown,
): string => {
  return safeText(value).replace(
    /^keywords\s*:\s*/i,
    '',
  );
};

export const getTelegramProductKeywords = (
  product?: Product | null,
): string => {
  if (!product) {
    return '';
  }

  return normalizeTelegramKeywords(
    product.telegramKeywords,
  );
};

export const getTelegramProductDescription = (
  product?: Product | null,
): string => {
  if (!product) {
    return '';
  }

  const description = safeText(
    product.description,
  );

  const keywords =
    getTelegramProductKeywords(product);

  if (!keywords) {
    return description;
  }

  return [description, keywords]
    .filter(Boolean)
    .join('\n');
};

export const getTelegramProductImageUrl = (
  product?: Product | null,
): string => {
  if (!product) {
    return '';
  }

  const extended =
    product as unknown as UnknownRecord;

  const galleryImages =
    Array.isArray(extended.galleryImages)
      ? extended.galleryImages
      : [];

  const images =
    Array.isArray(extended.images)
      ? extended.images
      : [];

  const firstImage = asRecord(
    images[0],
  );

  return safeText(
    product.thumbnailImage ||
      product.image ||
      extended.imageSrc ||
      galleryImages[0] ||
      firstImage.src ||
      firstImage.url ||
      '',
  );
};

export const getTelegramBuyPrice = (
  product?: Product | null,
): number => {
  return toNonNegativeNumber(
    product?.buyPrice,
    0,
  );
};

export const getTelegramSalePrice = (
  product?: Product | null,
): number => {
  if (!product) {
    return 0;
  }

  return toNonNegativeNumber(
    product.sellPrice ||
      product.buyPrice,
    0,
  );
};

export const getTelegramProductStock = (
  product?: Product | null,
): number => {
  return toNonNegativeNumber(
    product?.stock,
    0,
  );
};

export const toTelegramSchedulerProduct = (
  product: Product,
): TelegramSchedulerProduct => {
  return {
    id: safeText(product.id),

    name:
      getTelegramProductName(product),

    description:
      getTelegramProductDescription(
        product,
      ),

    price:
      getTelegramBuyPrice(product),

    salePrice:
      getTelegramSalePrice(product),

    imageUrl:
      getTelegramProductImageUrl(
        product,
      ),

    category:
      getTelegramProductCategory(
        product,
      ),

    stock:
      getTelegramProductStock(product),

    barcode:
      getTelegramProductBarcode(product),
  };
};

export const toTelegramSchedulerProducts = (
  products: Product[],
): TelegramSchedulerProduct[] => {
  return products.map(
    toTelegramSchedulerProduct,
  );
};

export const toTelegramManualPostProduct = (
  product: Product,
): TelegramManualPostProduct => {
  return {
    id: safeText(product.id),

    name:
      getTelegramProductName(product),

    price:
      getTelegramSalePrice(product),

    image:
      getTelegramProductImageUrl(
        product,
      ),

    category:
      getTelegramProductCategory(
        product,
      ),

    stock:
      getTelegramProductStock(product),

    description:
      getTelegramProductDescription(
        product,
      ),

    keywords:
      getTelegramProductKeywords(
        product,
      ),
  };
};
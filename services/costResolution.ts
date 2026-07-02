import { Product, Transaction } from '../types';

export type ResolvedCostSource =
  | 'sale_line_buy_price'
  | 'linked_sale_buy_price'
  | 'historical_purchase_cost'
  | 'current_product_buy_price'
  | 'missing_buy_price';

export type ResolveTransactionItemCostParams = {
  item: any;
  txDate: string;
  productsById: Map<string, Product>;
  transactionsById?: Map<string, Transaction>;
};

const toTime = (value: string) => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const getSourceSaleLine = (item: any, transactionsById?: Map<string, Transaction>) => {
  if (!transactionsById || !item?.sourceTransactionId) return null;
  const sourceTx = transactionsById.get(String(item.sourceTransactionId || ''));
  if (!sourceTx) return null;

  const sourceItems = Array.isArray(sourceTx.items) ? sourceTx.items : [];
  const compositeKey = String(item.sourceLineCompositeKey || '');
  const sourceUnitPrice = Number(item.sourceUnitPriceSnapshot || 0);
  const sourceVariant = String(item.selectedVariant || '');
  const sourceColor = String(item.selectedColor || '');

  if (compositeKey) {
    const matchedByComposite = sourceItems.find((sourceItem: any) => {
      const variant = String(sourceItem?.selectedVariant || '');
      const color = String(sourceItem?.selectedColor || '');
      const unitPrice = Number(sourceItem?.sellPrice || 0);
      const expectedKey = `${String(sourceItem?.id || '')}__${variant}__${color}__${unitPrice}`;
      return expectedKey === compositeKey;
    });
    if (matchedByComposite) return matchedByComposite;
  }

  return sourceItems.find((sourceItem: any) => {
    const sameId = String(sourceItem?.id || '') === String(item?.id || '');
    const sameVariant = String(sourceItem?.selectedVariant || '') === sourceVariant;
    const sameColor = String(sourceItem?.selectedColor || '') === sourceColor;
    const sameUnitPrice = Math.abs(Number(sourceItem?.sellPrice || 0) - sourceUnitPrice) < 0.0001;
    return sameId && sameVariant && sameColor && sameUnitPrice;
  }) || null;
};

export const resolveTransactionItemCost = ({
  item,
  txDate,
  productsById,
  transactionsById,
}: ResolveTransactionItemCostParams): { buyPrice: number; source: ResolvedCostSource } => {
  const direct = Number(item?.buyPrice);
  if (Number.isFinite(direct) && direct > 0) {
    return { buyPrice: direct, source: 'sale_line_buy_price' };
  }

  const sourceSaleLine = getSourceSaleLine(item, transactionsById);
  const linkedSaleBuyPrice = Number(sourceSaleLine?.buyPrice);
  if (Number.isFinite(linkedSaleBuyPrice) && linkedSaleBuyPrice > 0) {
    return { buyPrice: linkedSaleBuyPrice, source: 'linked_sale_buy_price' };
  }

  const product = productsById.get(String(item?.id || ''));
  if (!product) {
    return { buyPrice: 0, source: 'missing_buy_price' };
  }

  const txTime = toTime(txDate);
  const historical = (product.purchaseHistory || [])
    .filter((entry) => toTime(entry.date) <= txTime)
    .sort((a, b) => toTime(b.date) - toTime(a.date))[0];
  const historicalBuyPrice = Number(historical?.nextBuyPrice ?? historical?.unitPrice ?? 0);
  if (Number.isFinite(historicalBuyPrice) && historicalBuyPrice > 0) {
    return { buyPrice: historicalBuyPrice, source: 'historical_purchase_cost' };
  }

  const current = Number(product.buyPrice || 0);
  if (Number.isFinite(current) && current > 0) {
    return { buyPrice: current, source: 'current_product_buy_price' };
  }

  return { buyPrice: 0, source: 'missing_buy_price' };
};

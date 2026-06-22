import { Product, PurchaseOrder } from '../types';
import { NO_COLOR, NO_VARIANT } from './productVariants';

type ProductPurchaseHistoryRow = NonNullable<Product['purchaseHistory']>[number];

export type PurchaseOrderDerivedHistoryRow = {
  id: string;
  source: 'purchase_order';
  legacyHistoryId: string | null;
  purchaseOrderId: string;
  lineId: string;
  productId: string;
  date: string;
  variant: string;
  color: string;
  quantity: number;
  unitPrice: number;
  previousStock: number | null;
  previousBuyPrice: number | null;
  nextBuyPrice: number | null;
  reference: string | null;
  notes: string | null;
  purchaseOrderLabel: string | null;
  partyName: string | null;
  paymentMethod: 'cash' | 'online' | 'credit' | 'mixed' | null;
  paidAmount: number;
  lineTotal: number;
  orderTotal: number;
  orderPaid: number;
  remainingPayable: number;
  paymentBreakdown: {
    cash: number;
    online: number;
    partyCredit: number;
  };
  compatibility: {
    usesLegacyFallbackFields: boolean;
    missingPreviousStock: boolean;
    missingPreviousBuyPrice: boolean;
    missingNextBuyPrice: boolean;
    missingReference: boolean;
  };
};

export type LegacyProductPurchaseHistoryFallbackRow = {
  id: string;
  source: 'legacy_product_history';
  legacyHistoryId: string;
  purchaseOrderId: string | null;
  lineId: string | null;
  productId: string;
  date: string;
  variant: string;
  color: string;
  quantity: number;
  unitPrice: number;
  previousStock: number | null;
  previousBuyPrice: number | null;
  nextBuyPrice: number | null;
  reference: string | null;
  notes: string | null;
  purchaseOrderLabel: string | null;
  partyName: string | null;
  paymentMethod: 'cash' | 'online' | 'credit' | 'mixed' | null;
  paidAmount: number;
  lineTotal: number;
  orderTotal: number | null;
  orderPaid: number | null;
  remainingPayable: number | null;
  paymentBreakdown: {
    cash: number;
    online: number;
    partyCredit: number;
  };
  compatibility: {
    usesLegacyFallbackFields: boolean;
    missingPreviousStock: boolean;
    missingPreviousBuyPrice: boolean;
    missingNextBuyPrice: boolean;
    missingReference: boolean;
    orphanedLegacyRow: boolean;
  };
};

export type ProductPurchaseHistoryDisplayRow =
  | PurchaseOrderDerivedHistoryRow
  | LegacyProductPurchaseHistoryFallbackRow;

export type ProductPurchaseHistoryComparisonIssue = {
  id: string;
  type: 'missing_legacy_row' | 'orphan_legacy_row' | 'missing_purchase_order_link' | 'purchase_order_link_mismatch' | 'quantity_mismatch' | 'amount_mismatch';
  severity: 'warning';
  purchaseOrderId: string | null;
  canonicalRowId: string | null;
  legacyHistoryId: string | null;
  variant: string;
  color: string;
  canonicalQuantity: number | null;
  legacyQuantity: number | null;
  canonicalAmount: number | null;
  legacyAmount: number | null;
  message: string;
};

export type ProductPurchaseHistoryComparisonAudit = {
  canonicalCount: number;
  legacyCount: number;
  matchedCount: number;
  issueCount: number;
  missingLegacyCount: number;
  orphanLegacyCount: number;
  quantityMismatchCount: number;
  amountMismatchCount: number;
  missingLinkCount: number;
  issues: ProductPurchaseHistoryComparisonIssue[];
};

type PurchaseHistorySelectorInput = {
  orders: PurchaseOrder[];
  productId: string;
  variant?: string | null;
  color?: string | null;
};

const toSafeNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const normalizeOptionalFilter = (value?: string | null) => {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : null;
};

const normalizeVariantColor = (value?: string | null, fallback?: string) => {
  const trimmed = String(value || '').trim();
  return trimmed || fallback || '';
};

const toNullableNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeHistoryOrderId = (row?: Partial<ProductPurchaseHistoryRow>) => {
  const value = String(row?.purchaseOrderId || '').trim();
  return value || null;
};

const buildLegacyFallbackRow = (
  productId: string,
  row: ProductPurchaseHistoryRow,
  options?: {
    orphanedLegacyRow?: boolean;
    purchaseOrderLabel?: string | null;
    orderTotal?: number | null;
    orderPaid?: number | null;
    remainingPayable?: number | null;
    paymentBreakdown?: {
      cash: number;
      online: number;
      partyCredit: number;
    };
  }
): LegacyProductPurchaseHistoryFallbackRow => ({
  id: row.id,
  source: 'legacy_product_history',
  legacyHistoryId: row.id,
  purchaseOrderId: normalizeHistoryOrderId(row),
  lineId: null,
  productId,
  date: String(row.date || ''),
  variant: normalizeVariantColor(row.variant, NO_VARIANT),
  color: normalizeVariantColor(row.color, NO_COLOR),
  quantity: Math.max(0, toSafeNumber(row.quantity)),
  unitPrice: Math.max(0, toSafeNumber(row.unitPrice)),
  previousStock: toNullableNumber(row.previousStock),
  previousBuyPrice: toNullableNumber(row.previousBuyPrice),
  nextBuyPrice: toNullableNumber(row.nextBuyPrice),
  reference: String(row.reference || '').trim() || null,
  notes: String(row.notes || '').trim() || null,
  purchaseOrderLabel: options?.purchaseOrderLabel || normalizeHistoryOrderId(row),
  partyName: String(row.partyName || '').trim() || null,
  paymentMethod: row.paymentMethod === 'cash' || row.paymentMethod === 'online' || row.paymentMethod === 'credit'
    ? row.paymentMethod
    : null,
  paidAmount: Math.max(0, toSafeNumber(row.paidAmount)),
  lineTotal: Math.max(0, toSafeNumber(row.quantity) * toSafeNumber(row.unitPrice)),
  orderTotal: options?.orderTotal ?? null,
  orderPaid: options?.orderPaid ?? null,
  remainingPayable: options?.remainingPayable ?? null,
  paymentBreakdown: options?.paymentBreakdown || { cash: 0, online: 0, partyCredit: 0 },
  compatibility: {
    usesLegacyFallbackFields: true,
    missingPreviousStock: !Number.isFinite(Number(row.previousStock)),
    missingPreviousBuyPrice: !Number.isFinite(Number(row.previousBuyPrice)),
    missingNextBuyPrice: !Number.isFinite(Number(row.nextBuyPrice)),
    missingReference: !String(row.reference || '').trim(),
    orphanedLegacyRow: Boolean(options?.orphanedLegacyRow),
  },
});

const getPurchaseOrderPaymentBreakdown = (order: PurchaseOrder) => {
  return (order.paymentHistory || []).reduce((acc, payment) => {
    const amount = Math.max(0, toSafeNumber(payment.amount));
    const method = String(payment.method || '').trim().toLowerCase();
    if (method === 'party_credit') acc.partyCredit += amount;
    else if (method === 'online' || method === 'bank') acc.online += amount;
    else acc.cash += amount;
    return acc;
  }, { cash: 0, online: 0, partyCredit: 0 });
};

const getPurchaseOrderPaymentMethod = (
  order: Pick<PurchaseOrder, 'paymentHistory' | 'remainingAmount' | 'totalAmount' | 'totalPaid'>
): PurchaseOrderDerivedHistoryRow['paymentMethod'] => {
  const paymentHistory = Array.isArray(order.paymentHistory) ? order.paymentHistory : [];
  const methods = Array.from(new Set(
    paymentHistory
      .map((entry) => String(entry.method || '').trim().toLowerCase())
      .filter(Boolean)
      .map((method) => (method === 'bank' ? 'online' : method))
  ));

  if (methods.includes('party_credit') && methods.length === 1) return 'credit';
  if (methods.length === 1 && methods[0] === 'cash') return 'cash';
  if (methods.length === 1 && methods[0] === 'online') return 'online';
  if (methods.length > 1) return 'mixed';

  const orderPaid = Math.max(0, toSafeNumber(order.totalPaid));
  const orderTotal = Math.max(0, toSafeNumber(order.totalAmount));
  const orderRemaining = Math.max(0, toSafeNumber(order.remainingAmount ?? (orderTotal - orderPaid)));
  if (orderPaid <= 0 && orderRemaining > 0) return 'credit';
  return null;
};

export const getProductPurchaseHistoryRowsFromPurchaseOrders = ({
  orders,
  productId,
  variant,
  color,
}: PurchaseHistorySelectorInput): PurchaseOrderDerivedHistoryRow[] => {
  const normalizedProductId = String(productId || '').trim();
  if (!normalizedProductId) return [];

  const variantFilter = normalizeOptionalFilter(variant);
  const colorFilter = normalizeOptionalFilter(color);

  return (orders || [])
    .slice()
    .sort((a, b) => new Date(b.orderDate || b.createdAt || '').getTime() - new Date(a.orderDate || a.createdAt || '').getTime())
    .flatMap((order) => {
      const orderDate = String(order.orderDate || order.createdAt || '');
      const orderTotal = Math.max(0, toSafeNumber(order.totalAmount));
      const orderPaid = Math.max(0, toSafeNumber(order.totalPaid));
      const remainingPayable = Math.max(0, toSafeNumber(order.remainingAmount ?? (orderTotal - orderPaid)));
      const paymentBreakdown = getPurchaseOrderPaymentBreakdown(order);
      const paymentMethod = getPurchaseOrderPaymentMethod(order);

      return (order.lines || [])
        .filter((line) => String(line.productId || '').trim() === normalizedProductId)
        .filter((line) => {
          const lineVariant = normalizeVariantColor(line.variant, NO_VARIANT);
          const lineColor = normalizeVariantColor(line.color, NO_COLOR);
          if (variantFilter && lineVariant !== variantFilter) return false;
          if (colorFilter && lineColor !== colorFilter) return false;
          return true;
        })
        .map((line, lineIndex) => {
          const quantity = Math.max(0, toSafeNumber(line.quantity));
          const unitPrice = Math.max(0, toSafeNumber(line.unitCost));
          const derivedReference = String(order.billNumber || order.id || '').trim() || null;
          const derivedNotes = String(order.notes || '').trim() || null;

          return {
            id: `po-row-${order.id}-${String(line.id || lineIndex)}`,
            source: 'purchase_order',
            legacyHistoryId: null,
            purchaseOrderId: order.id,
            lineId: String(line.id || lineIndex),
            productId: normalizedProductId,
            date: orderDate,
            variant: normalizeVariantColor(line.variant, NO_VARIANT),
            color: normalizeVariantColor(line.color, NO_COLOR),
            quantity,
            unitPrice,
            previousStock: null,
            previousBuyPrice: null,
            nextBuyPrice: null,
            reference: derivedReference,
            notes: derivedNotes,
            purchaseOrderLabel: String(order.billNumber || order.id || '').trim() || null,
            partyName: String(order.partyName || '').trim() || null,
            paymentMethod,
            paidAmount: orderPaid,
            lineTotal: Math.max(0, toSafeNumber(line.totalCost || (quantity * unitPrice))),
            orderTotal,
            orderPaid,
            remainingPayable,
            paymentBreakdown,
            compatibility: {
              usesLegacyFallbackFields: true,
              missingPreviousStock: true,
              missingPreviousBuyPrice: true,
              missingNextBuyPrice: true,
              missingReference: !derivedReference,
            },
          } satisfies PurchaseOrderDerivedHistoryRow;
        });
    });
};

type PurchaseHistoryDisplaySelectorInput = PurchaseHistorySelectorInput & {
  product: Product | null;
};

const findBestLegacyMatchIndex = (
  legacyRows: ProductPurchaseHistoryRow[],
  canonicalRow: PurchaseOrderDerivedHistoryRow,
  usedLegacyIndexes: Set<number>
) => {
  const orderId = canonicalRow.purchaseOrderId;

  const exactIndex = legacyRows.findIndex((row, index) => {
    if (usedLegacyIndexes.has(index)) return false;
    if (normalizeHistoryOrderId(row) !== orderId) return false;
    if (normalizeVariantColor(row.variant, NO_VARIANT) !== canonicalRow.variant) return false;
    if (normalizeVariantColor(row.color, NO_COLOR) !== canonicalRow.color) return false;
    if (Math.abs(toSafeNumber(row.quantity) - canonicalRow.quantity) > 0.0001) return false;
    if (Math.abs(toSafeNumber(row.unitPrice) - canonicalRow.unitPrice) > 0.0001) return false;
    return true;
  });
  if (exactIndex >= 0) return exactIndex;

  return legacyRows.findIndex((row, index) => {
    if (usedLegacyIndexes.has(index)) return false;
    return normalizeHistoryOrderId(row) === orderId;
  });
};

export const getProductPurchaseHistoryDisplayRows = ({
  product,
  orders,
  productId,
  variant,
  color,
}: PurchaseHistoryDisplaySelectorInput): ProductPurchaseHistoryDisplayRow[] => {
  const canonicalRows = getProductPurchaseHistoryRowsFromPurchaseOrders({
    orders,
    productId,
    variant,
    color,
  });

  const legacyRows = Array.isArray(product?.purchaseHistory)
    ? product!.purchaseHistory!.filter((row) => {
      const rowVariant = normalizeVariantColor(row.variant, NO_VARIANT);
      const rowColor = normalizeVariantColor(row.color, NO_COLOR);
      const variantFilter = normalizeOptionalFilter(variant);
      const colorFilter = normalizeOptionalFilter(color);
      if (variantFilter && rowVariant !== variantFilter) return false;
      if (colorFilter && rowColor !== colorFilter) return false;
      return true;
    })
    : [];

  const usedLegacyIndexes = new Set<number>();

  const mergedCanonicalRows: ProductPurchaseHistoryDisplayRow[] = canonicalRows.map((row) => {
    const matchedLegacyIndex = findBestLegacyMatchIndex(legacyRows, row, usedLegacyIndexes);
    if (matchedLegacyIndex < 0) return row;

    usedLegacyIndexes.add(matchedLegacyIndex);
    const matchedLegacy = legacyRows[matchedLegacyIndex];
    return {
      ...row,
      id: matchedLegacy.id || row.id,
      legacyHistoryId: matchedLegacy.id || null,
      previousStock: toNullableNumber(matchedLegacy.previousStock),
      previousBuyPrice: toNullableNumber(matchedLegacy.previousBuyPrice),
      nextBuyPrice: toNullableNumber(matchedLegacy.nextBuyPrice),
      reference: String(matchedLegacy.reference || '').trim() || row.reference,
      notes: String(matchedLegacy.notes || '').trim() || row.notes,
      partyName: String(matchedLegacy.partyName || '').trim() || row.partyName,
      paymentMethod: matchedLegacy.paymentMethod || row.paymentMethod,
      paidAmount: Math.max(row.paidAmount, Math.max(0, toSafeNumber(matchedLegacy.paidAmount))),
      compatibility: {
        usesLegacyFallbackFields: true,
        missingPreviousStock: !Number.isFinite(Number(matchedLegacy.previousStock)),
        missingPreviousBuyPrice: !Number.isFinite(Number(matchedLegacy.previousBuyPrice)),
        missingNextBuyPrice: !Number.isFinite(Number(matchedLegacy.nextBuyPrice)),
        missingReference: !(String(matchedLegacy.reference || '').trim() || row.reference),
      },
    } satisfies PurchaseOrderDerivedHistoryRow;
  });

  const orphanLegacyRows = legacyRows
    .filter((_, index) => !usedLegacyIndexes.has(index))
    .map((row) => buildLegacyFallbackRow(productId, row, { orphanedLegacyRow: true }));

  return [...mergedCanonicalRows, ...orphanLegacyRows]
    .slice()
    .sort((a, b) => new Date(b.date || '').getTime() - new Date(a.date || '').getTime());
};

export const getProductPurchaseHistoryRowsFromPurchaseOrdersForProduct = (
  product: Product | null,
  orders: PurchaseOrder[]
): PurchaseOrderDerivedHistoryRow[] => {
  if (!product) return [];
  return getProductPurchaseHistoryRowsFromPurchaseOrders({
    orders,
    productId: product.id,
  });
};

export const getProductPurchaseHistoryDisplayRowsForProduct = (
  product: Product | null,
  orders: PurchaseOrder[]
): ProductPurchaseHistoryDisplayRow[] => {
  if (!product) return [];
  return getProductPurchaseHistoryDisplayRows({
    product,
    orders,
    productId: product.id,
  });
};

export const compareProductPurchaseHistoryForProduct = (
  product: Product | null,
  orders: PurchaseOrder[]
): ProductPurchaseHistoryComparisonAudit => {
  if (!product) {
    return {
      canonicalCount: 0,
      legacyCount: 0,
      matchedCount: 0,
      issueCount: 0,
      missingLegacyCount: 0,
      orphanLegacyCount: 0,
      quantityMismatchCount: 0,
      amountMismatchCount: 0,
      missingLinkCount: 0,
      issues: [],
    };
  }

  const canonicalRows = getProductPurchaseHistoryRowsFromPurchaseOrdersForProduct(product, orders);
  const legacyRows = Array.isArray(product.purchaseHistory) ? product.purchaseHistory : [];
  const usedLegacyIndexes = new Set<number>();
  const issues: ProductPurchaseHistoryComparisonIssue[] = [];

  canonicalRows.forEach((canonicalRow) => {
    const matchedLegacyIndex = findBestLegacyMatchIndex(legacyRows, canonicalRow, usedLegacyIndexes);
    const canonicalAmount = Math.max(0, toSafeNumber(canonicalRow.lineTotal || (canonicalRow.quantity * canonicalRow.unitPrice)));

    if (matchedLegacyIndex < 0) {
      issues.push({
        id: `missing-legacy-${canonicalRow.id}`,
        type: 'missing_legacy_row',
        severity: 'warning',
        purchaseOrderId: canonicalRow.purchaseOrderId || null,
        canonicalRowId: canonicalRow.id,
        legacyHistoryId: null,
        variant: canonicalRow.variant,
        color: canonicalRow.color,
        canonicalQuantity: canonicalRow.quantity,
        legacyQuantity: null,
        canonicalAmount,
        legacyAmount: null,
        message: 'Purchase order row has no matching embedded product.purchaseHistory row.',
      });
      return;
    }

    usedLegacyIndexes.add(matchedLegacyIndex);
    const legacyRow = legacyRows[matchedLegacyIndex];
    const legacyAmount = Math.max(0, toSafeNumber(legacyRow.quantity) * toSafeNumber(legacyRow.unitPrice));
    const legacyOrderId = normalizeHistoryOrderId(legacyRow);

    if (!legacyOrderId) {
      issues.push({
        id: `missing-link-${legacyRow.id}`,
        type: 'missing_purchase_order_link',
        severity: 'warning',
        purchaseOrderId: canonicalRow.purchaseOrderId || null,
        canonicalRowId: canonicalRow.id,
        legacyHistoryId: legacyRow.id,
        variant: canonicalRow.variant,
        color: canonicalRow.color,
        canonicalQuantity: canonicalRow.quantity,
        legacyQuantity: Math.max(0, toSafeNumber(legacyRow.quantity)),
        canonicalAmount,
        legacyAmount,
        message: 'Matched legacy history row is missing purchaseOrderId.',
      });
    } else if (legacyOrderId !== canonicalRow.purchaseOrderId) {
      issues.push({
        id: `link-mismatch-${legacyRow.id}`,
        type: 'purchase_order_link_mismatch',
        severity: 'warning',
        purchaseOrderId: canonicalRow.purchaseOrderId || null,
        canonicalRowId: canonicalRow.id,
        legacyHistoryId: legacyRow.id,
        variant: canonicalRow.variant,
        color: canonicalRow.color,
        canonicalQuantity: canonicalRow.quantity,
        legacyQuantity: Math.max(0, toSafeNumber(legacyRow.quantity)),
        canonicalAmount,
        legacyAmount,
        message: 'Legacy purchaseOrderId does not match the canonical purchase order row.',
      });
    }

    if (Math.abs(Math.max(0, toSafeNumber(legacyRow.quantity)) - canonicalRow.quantity) > 0.0001) {
      issues.push({
        id: `qty-mismatch-${legacyRow.id}`,
        type: 'quantity_mismatch',
        severity: 'warning',
        purchaseOrderId: canonicalRow.purchaseOrderId || null,
        canonicalRowId: canonicalRow.id,
        legacyHistoryId: legacyRow.id,
        variant: canonicalRow.variant,
        color: canonicalRow.color,
        canonicalQuantity: canonicalRow.quantity,
        legacyQuantity: Math.max(0, toSafeNumber(legacyRow.quantity)),
        canonicalAmount,
        legacyAmount,
        message: 'Canonical and embedded history quantities do not match.',
      });
    }

    if (Math.abs(legacyAmount - canonicalAmount) > 0.01) {
      issues.push({
        id: `amount-mismatch-${legacyRow.id}`,
        type: 'amount_mismatch',
        severity: 'warning',
        purchaseOrderId: canonicalRow.purchaseOrderId || null,
        canonicalRowId: canonicalRow.id,
        legacyHistoryId: legacyRow.id,
        variant: canonicalRow.variant,
        color: canonicalRow.color,
        canonicalQuantity: canonicalRow.quantity,
        legacyQuantity: Math.max(0, toSafeNumber(legacyRow.quantity)),
        canonicalAmount,
        legacyAmount,
        message: 'Canonical and embedded history amounts do not match.',
      });
    }
  });

  legacyRows.forEach((legacyRow, index) => {
    if (usedLegacyIndexes.has(index)) return;
    issues.push({
      id: `orphan-legacy-${legacyRow.id}`,
      type: 'orphan_legacy_row',
      severity: 'warning',
      purchaseOrderId: normalizeHistoryOrderId(legacyRow),
      canonicalRowId: null,
      legacyHistoryId: legacyRow.id,
      variant: normalizeVariantColor(legacyRow.variant, NO_VARIANT),
      color: normalizeVariantColor(legacyRow.color, NO_COLOR),
      canonicalQuantity: null,
      legacyQuantity: Math.max(0, toSafeNumber(legacyRow.quantity)),
      canonicalAmount: null,
      legacyAmount: Math.max(0, toSafeNumber(legacyRow.quantity) * toSafeNumber(legacyRow.unitPrice)),
      message: 'Embedded product.purchaseHistory row has no matching canonical purchase order row.',
    });
  });

  const missingLegacyCount = issues.filter((issue) => issue.type === 'missing_legacy_row').length;
  const orphanLegacyCount = issues.filter((issue) => issue.type === 'orphan_legacy_row').length;
  const quantityMismatchCount = issues.filter((issue) => issue.type === 'quantity_mismatch').length;
  const amountMismatchCount = issues.filter((issue) => issue.type === 'amount_mismatch').length;
  const missingLinkCount = issues.filter((issue) => issue.type === 'missing_purchase_order_link' || issue.type === 'purchase_order_link_mismatch').length;

  return {
    canonicalCount: canonicalRows.length,
    legacyCount: legacyRows.length,
    matchedCount: usedLegacyIndexes.size,
    issueCount: issues.length,
    missingLegacyCount,
    orphanLegacyCount,
    quantityMismatchCount,
    amountMismatchCount,
    missingLinkCount,
    issues,
  };
};

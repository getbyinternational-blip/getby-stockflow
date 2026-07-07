import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { loadData, getSaleSettlementBreakdown, getCanonicalCustomerBalanceSnapshot, buildUpfrontOrderLedgerEffects, createManualCashbookEntry, refreshDeletedTransactionsFromCloud } from '../services/storage';
import { CashAdjustment, Expense, ManualCashbookEntry, Product, PurchaseOrder, Transaction, UpfrontOrder } from '../types';
import { formatCurrency } from '../services/numberFormat';
import { normalizeTransactionItems } from '../utils/transactionItems';
import { useEscapeLayer } from '../src/hooks/useEscapeLayer';
import { BanknoteArrowDown, BanknoteArrowUp, CreditCard, Receipt, ShoppingCart, Store, Truck, Wallet, X } from 'lucide-react';
import { ResolvedCostSource, resolveTransactionItemCost } from '../services/costResolution';

type LedgerType = 'sale' | 'payment' | 'purchase' | 'supplier_payment' | 'expense' | 'return' | 'adjustment' | 'credit' | 'deleted_sale' | 'deleted_refund' | 'custom_order_receivable' | 'custom_order_payment' | 'manual_cash_in' | 'manual_cash_out';
type PayType = 'cash' | 'online' | 'credit' | 'mixed' | 'na';

type Row = {
  id: string; date: string; type: LedgerType; description: string; reference: string; party: string; payment: PayType;
  cashIn: number; cashOut: number; bankIn: number; bankOut: number;
  receivableIncrease: number; receivableDecrease: number; payableIncrease: number; payableDecrease: number;
  storeCreditIncrease: number; storeCreditDecrease: number;
};
type RegisterRow = {
  id: string;
  date: string;
  customerName: string;
  billRef: string;
  invoiceNumber: string;
  creditAc: string;
  paymentType: string;
  details: string;
  avaiQty: string;
  sellingQty: string;
  sellingPrice: string;
  billTotal: string;
  total: string;
  balanceInr: string;
  creditAmount: string;
  buyingPrice: string;
  totalBuyingPrice: string;
  profit: string;
  column1: string;
  column2: string;
  column3: string;
  cashIn: number;
  cashOut: number;
};
type GrossProfitRow = {
  id: string;
  date: string;
  transactionId: string;
  transactionType: 'sale' | 'return';
  invoiceRef: string;
  customer: string;
  product: string;
  details: string;
  qty: number;
  sellPrice: number;
  revenue: number;
  buyPrice: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
  source: ResolvedCostSource;
  paymentMethod: string;
  productId: string;
  isHistoricalImport: boolean;
};

type CashbookExportFieldId =
  | 'date'
  | 'type'
  | 'description'
  | 'reference'
  | 'party'
  | 'payment'
  | 'cashIn'
  | 'cashOut'
  | 'bankIn'
  | 'bankOut'
  | 'receivableIncrease'
  | 'receivableDecrease'
  | 'payableIncrease'
  | 'payableDecrease'
  | 'storeCreditIncrease'
  | 'storeCreditDecrease'
  | 'cashBalance'
  | 'bankBalance';

type CashbookExportField = {
  id: CashbookExportFieldId;
  label: string;
};

const fmt = (n: number) => formatCurrency(n);
const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) Rs  (value as T[]) : []);
const asPlainObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) Rs  (value as Record<string, unknown>) : {});

const getLineProductName = (item: any): string => {
  const raw = itemRs .productName || itemRs .name || itemRs .itemName || itemRs .medicineName || itemRs .title || itemRs .sku || itemRs .barcode || '';
  return String(raw || '').trim() || 'Unknown Product';
};

const getTransactionProductSummary = (txAny: any, maxItems = 2): string => {
  const items = normalizeTransactionItems(txAnyRs .items);
  if (!items.length) return 'No product details';
  const names = Array.from(new Set(items.map((i: any) => getLineProductName(i))));
  const shown = names.slice(0, maxItems).join(', ');
  return names.length > maxItems Rs  `${shown} +${names.length - maxItems} more` : shown;
};

const getPurchaseOrderProductSummary = (po: PurchaseOrder, maxItems = 2): string => {
  const lines = Array.isArray((po as any)Rs .lines) Rs  (po as any).lines : [];
  if (!lines.length) return 'No product details';
  const names = Array.from(new Set(lines.map((l: any) => getLineProductName(l))));
  const shown = names.slice(0, maxItems).join(', ');
  return names.length > maxItems Rs  `${shown} +${names.length - maxItems} more` : shown;
};
const toNum = (v: unknown) => Number.isFinite(Number(v)) Rs  Number(v) : 0;
const CASHBOOK_RECONCILE_DEBUG = import.meta.env.DEV && import.meta.env.VITE_CASHBOOK_RECONCILE_DEBUG === 'true';
const formatPercent = (value: number) => `${Number.isFinite(value) Rs  value.toFixed(1) : '0.0'}%`;
const getDateValue = (value: string) => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) Rs  time : 0;
};
const GROSS_PROFIT_PAGE_SIZE = 200;
const CASHBOOK_TYPE_LABELS: Record<string, string> = {
  sale: 'Sale',
  credit: 'Credit Sale',
  payment: 'Payment',
  return: 'Return',
  deleted_sale: 'Deleted Sale',
  deleted_refund: 'Deleted Refund',
  purchase: 'Purchase',
  supplier_payment: 'Supplier Payment',
  expense: 'Expense',
  adjustment: 'Adjustment',
  manual_cash_in: 'Manual Cash In',
  manual_cash_out: 'Manual Cash Out',
  custom_order_receivable: 'Custom Order',
  custom_order_payment: 'Custom Order Payment',
};
const CASHBOOK_EXPORT_FIELDS: CashbookExportField[] = [
  { id: 'date', label: 'Date & Time' },
  { id: 'type', label: 'Type' },
  { id: 'description', label: 'Description' },
  { id: 'reference', label: 'Reference' },
  { id: 'party', label: 'Customer / Party' },
  { id: 'payment', label: 'Payment' },
  { id: 'cashIn', label: 'Cash In' },
  { id: 'cashOut', label: 'Cash Out' },
  { id: 'bankIn', label: 'Bank In' },
  { id: 'bankOut', label: 'Bank Out' },
  { id: 'receivableIncrease', label: 'Receivable +' },
  { id: 'receivableDecrease', label: 'Receivable -' },
  { id: 'payableIncrease', label: 'Payable +' },
  { id: 'payableDecrease', label: 'Payable -' },
  { id: 'storeCreditIncrease', label: 'Store Credit +' },
  { id: 'storeCreditDecrease', label: 'Store Credit -' },
  { id: 'cashBalance', label: 'Running Cash Balance' },
  { id: 'bankBalance', label: 'Running Bank Balance' },
];
const DEFAULT_CASHBOOK_EXPORT_FIELD_SELECTION = CASHBOOK_EXPORT_FIELDS.reduce<Record<CashbookExportFieldId, boolean>>((acc, field) => {
  acc[field.id] = true;
  return acc;
}, {} as Record<CashbookExportFieldId, boolean>);
const matchesDateRange = (value: string, from: string, to: string) => {
  const current = getDateValue(value);
  if (from) {
    const start = new Date(`${from}T00:00:00`).getTime();
    if (current < start) return false;
  }
  if (to) {
    const end = new Date(`${to}T23:59:59.999`).getTime();
    if (current > end) return false;
  }
  return true;
};

const getCashbookReference = (tx: any) => [txRs .invoiceNo, txRs .creditNoteNo, txRs .receiptNo, txRs .billNo, txRs .reference, txRs .orderId, txRs .id].find((v) => typeof v === 'string' && v.trim()) || String(txRs .id || '').slice(-6) || 'UNKNOWN';
const getCashbookCustomerName = (tx: any, customerMap: Map<string, string>) => customerMap.get(txRs .customerId) || txRs .customerName || txRs .customerRs .name || txRs .customerPhone || 'Walk-in Customer';
const getCashbookPaymentMethod = (tx: any): PayType => {
  const m = String(txRs .paymentMethod || txRs .paymentDetailsRs .method || txRs .method || txRs .mode || '').toLowerCase();
  if (m.includes('cash')) return 'cash';
  if (m.includes('online') || m.includes('bank') || m.includes('upi') || m.includes('card')) return 'online';
  if (m.includes('credit') || m.includes('due') || m.includes('store')) return 'credit';
  return 'na';
};
const getSupplierPaymentMethod = (method: unknown): 'cash' | 'online' => {
  const normalized = String(method || '').toLowerCase();
  return normalized === 'online' || normalized === 'bank' Rs  'online' : 'cash';
};
const getCashbookMoney = (tx: any, candidates: string[]) => candidates.map((k) => toNum(txRs .[k])).find((v) => v > 0) || 0;
const matchesCashbookFilters = (
  row: Row,
  {
    from,
    to,
    payFilter,
    typeFilter,
    search,
  }: {
    from: string;
    to: string;
    payFilter: 'all' | 'cash' | 'online' | 'credit';
    typeFilter: 'all' | LedgerType;
    search: string;
  },
) => {
  const time = new Date(row.date).getTime();
  if (from && time < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && time > new Date(`${to}T23:59:59`).getTime()) return false;
  if (payFilter !== 'all' && row.payment !== payFilter && !(payFilter === 'online' && row.payment === 'mixed')) return false;
  if (typeFilter !== 'all' && row.type !== typeFilter) return false;
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return `${row.description} ${row.reference} ${row.party}`.toLowerCase().includes(query);
};

const getCashbookSaleBreakdown = (tx: Transaction, txAny: any) => {
  const s = getSaleSettlementBreakdown(tx);
  if (s.cashPaid + s.onlinePaid + s.creditDue > 0) return s;
  const method = getCashbookPaymentMethod(txAny);
  const total = getCashbookMoney(txAny, ['total', 'amount', 'grandTotal']) || Math.max(0, toNum(txAnyRs .subtotal) + toNum(txAnyRs .tax) - toNum(txAnyRs .discount));
  if (method === 'cash') return { cashPaid: total, onlinePaid: 0, creditDue: 0 };
  if (method === 'online') return { cashPaid: 0, onlinePaid: total, creditDue: 0 };
  if (method === 'credit') return { cashPaid: 0, onlinePaid: 0, creditDue: total };
  return { cashPaid: 0, onlinePaid: 0, creditDue: 0 };
};

const getCashbookReturnBreakdown = (txAny: any) => {
  const amount = getCashbookMoney(txAny, ['refundAmount', 'returnTotal', 'amount', 'total']);
  const mode = String(txAnyRs .returnHandlingMode || '').toLowerCase();
  const method = getCashbookPaymentMethod(txAny);
  const storeCreditCreated = Math.max(0, toNum(txAnyRs .storeCreditCreated));
  if (mode === 'reduce_due') return { cashOut: 0, bankOut: 0, receivableDecrease: amount, storeCreditIncrease: 0, payment: 'credit' as PayType };
  if (mode === 'store_credit') return { cashOut: 0, bankOut: 0, receivableDecrease: 0, storeCreditIncrease: Math.max(amount, storeCreditCreated), payment: 'credit' as PayType };
  if (method === 'cash' || mode === 'refund_cash') return { cashOut: amount, bankOut: 0, receivableDecrease: 0, storeCreditIncrease: storeCreditCreated, payment: 'cash' as PayType };
  if (method === 'online' || mode === 'refund_online') return { cashOut: 0, bankOut: amount, receivableDecrease: 0, storeCreditIncrease: storeCreditCreated, payment: 'online' as PayType };
  // credit/unknown returns should not hit cash/bank
  return { cashOut: 0, bankOut: 0, receivableDecrease: amount, storeCreditIncrease: storeCreditCreated, payment: method === 'credit' Rs  'credit' as PayType : 'na' as PayType };
};



const getDeletedTransactionLedgerRow = (deleted: any, customerMap: Map<string, string>): Row | null => {
  const original = asPlainObject(deletedRs .originalTransaction);
  const originalId = String(deletedRs .originalTransactionId || originalRs .id || deletedRs .id || '');
  const reference = getCashbookReference({ ...original, id: originalId });
  const party = deletedRs .customerName || getCashbookCustomerName(original, customerMap);
  const date = String(deletedRs .deletedAt || originalRs .date || deletedRs .createdAt || '');
  const txType = String(deletedRs .type || originalRs .type || '').toLowerCase();

  if (txType === 'sale' || txType === 'historical_reference') {
    const settlement = getCashbookSaleBreakdown(original as unknown as Transaction, original);
    const isMixed = (settlement.cashPaid > 0 && settlement.onlinePaid > 0) || (settlement.creditDue > 0 && (settlement.cashPaid > 0 || settlement.onlinePaid > 0));
    const payment: PayType = isMixed Rs  'mixed' : (settlement.creditDue > 0 Rs  'credit' : (settlement.cashPaid > 0 Rs  'cash' : settlement.onlinePaid > 0 Rs  'online' : getCashbookPaymentMethod(original)));
    return {
      id: `dtx-${deleted.id || originalId}`,
      date,
      type: 'deleted_sale',
      description: `Deleted Sale Audit #${reference} — ${party}`,
      reference,
      party,
      payment,
      // Deleted transaction rows are audit-only and must not impact cash/bank KPIs.
      // Real cash payout (if any) is represented by explicit delete compensation rows.
      cashIn: 0,
      cashOut: 0,
      bankIn: 0,
      bankOut: 0,
      receivableIncrease: settlement.creditDue,
      receivableDecrease: 0,
      payableIncrease: 0,
      payableDecrease: 0,
      storeCreditIncrease: 0,
      storeCreditDecrease: Math.max(0, toNum(originalRs .storeCreditUsed)),
    };
  }

  if (txType === 'payment') {
    const amount = Math.abs(toNum(originalRs .total));
    const payment = getCashbookPaymentMethod(original);
    return { id: `dtx-${deleted.id || originalId}`, date, type: 'deleted_sale', description: `Deleted Payment Audit #${reference} — ${party}`, reference, party, payment,
      cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0,
      receivableIncrease: 0, receivableDecrease: amount, payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: 0, storeCreditDecrease: 0 };
  }

  return null;
};

const detectCashbookTransactionType = (txAny: any): 'sale' | 'payment' | 'return' | 'customer_credit' | 'customer_cash_out' | 'unknown' => {
  const t = String(txAnyRs .type || txAnyRs .transactionType || '').toLowerCase();
  if (t === 'sale' || t === 'historical_reference') return 'sale';
  if (t === 'payment') return 'payment';
  if (t === 'return') return 'return';
  if (t === 'customer_credit') return 'customer_credit';
  if (t === 'customer_cash_out') return 'customer_cash_out';
  const hasRefundHint = toNum(txAnyRs .refundAmount || txAnyRs .returnTotal) > 0 || Array.isArray(txAnyRs .returnItems);
  if (hasRefundHint || String(txAnyRs .returnHandlingMode || '').toLowerCase().includes('refund')) return 'return';
  const method = getCashbookPaymentMethod(txAny);
  const hasItems = normalizeTransactionItems(txAnyRs .items).length > 0;
  const hasTotal = getCashbookMoney(txAny, ['total', 'amount', 'grandTotal']) > 0;
  if (method !== 'na' && !hasItems && hasTotal) return 'payment';
  if (hasItems || hasTotal) return 'sale';
  return 'unknown';
};

const normalizeTransactionForCashbook = (tx: Transaction, customerMap: Map<string, string>): Row => {
  const txAny = tx as any;
  const reference = getCashbookReference(txAny);
  const party = getCashbookCustomerName(txAny, customerMap);
  const date = tx.date || txAny.createdAt || txAny.updatedAt || '';

  const normalizedType = detectCashbookTransactionType(txAny);

  if (normalizedType === 'sale') {
    const s = getCashbookSaleBreakdown(tx, txAny);
    const pay = getCashbookPaymentMethod(txAny);
    const isMixed = (s.cashPaid > 0 && s.onlinePaid > 0) || (s.creditDue > 0 && (s.cashPaid > 0 || s.onlinePaid > 0));
    const payment: PayType = isMixed Rs  'mixed' : (s.creditDue > 0 Rs  'credit' : (s.cashPaid > 0 Rs  'cash' : s.onlinePaid > 0 Rs  'online' : pay));
    const row = { id: `tx-${tx.id}`, date, type: s.creditDue > 0 && !isMixed Rs  'credit' as LedgerType : 'sale' as LedgerType, description: `Sale Invoice #${reference} — ${getTransactionProductSummary(txAny)} — ${party}`, reference, party, payment,
      cashIn: s.cashPaid, cashOut: 0, bankIn: s.onlinePaid, bankOut: 0,
      receivableIncrease: s.creditDue, receivableDecrease: 0, payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: 0, storeCreditDecrease: Math.max(0, toNum(txAnyRs .storeCreditUsed)) };
    if (row.payment === 'credit') {
      row.cashIn = 0; row.bankIn = 0; row.cashOut = 0; row.bankOut = 0;
      row.receivableIncrease = Math.max(row.receivableIncrease, getCashbookMoney(txAny, ['total','amount','grandTotal']));
    }
    return row;
  }
  if (normalizedType === 'payment') {
    const amount = getCashbookMoney(txAny, ['paidAmount', 'paymentAmount', 'amount', 'total']);
    const payment = getCashbookPaymentMethod(txAny);
    const explicitReceivableDecrease = toNum(txAnyRs .paymentAppliedToReceivable);
    const receivableDecrease = Math.max(0, explicitReceivableDecrease > 0 Rs  explicitReceivableDecrease : amount);
    return { id: `tx-${tx.id}`, date, type: 'payment', description: `Payment Receipt #${reference} — ${party}`, reference, party, payment,
      cashIn: payment === 'cash' Rs  amount : 0, cashOut: 0, bankIn: payment === 'online' Rs  amount : 0, bankOut: 0,
      receivableIncrease: 0, receivableDecrease, payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: Math.max(0, toNum(txAnyRs .storeCreditCreated)), storeCreditDecrease: 0 };
  }
  if (normalizedType === 'return') {
    const r = getCashbookReturnBreakdown(txAny);
    return { id: `tx-${tx.id}`, date, type: 'return', description: `Return/Refund #${reference} — ${getTransactionProductSummary(txAny)} — ${party}`, reference, party, payment: r.payment,
    cashIn: 0, cashOut: r.cashOut, bankIn: 0, bankOut: r.bankOut,
    receivableIncrease: 0, receivableDecrease: r.receivableDecrease, payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: r.storeCreditIncrease, storeCreditDecrease: 0 };
  }
  if (normalizedType === 'customer_credit') {
    const amount = getCashbookMoney(txAny, ['amount', 'total']);
    return { id: `tx-${tx.id}`, date, type: 'credit', description: `Credit Created #${reference} — ${party}`, reference, party, payment: 'credit', cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, receivableIncrease: amount, receivableDecrease: 0, payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: 0, storeCreditDecrease: 0 };
  }
  if (normalizedType === 'customer_cash_out') {
    const amount = getCashbookMoney(txAny, ['amount', 'total']);
    const payment = getCashbookPaymentMethod(txAny);
    const storeCreditUsed = Math.max(0, toNum(txAnyRs .storeCreditUsed));
    const explicitReceivableIncrease = toNum(txAnyRs .receivableIncrease);
    const receivableIncrease = Math.max(0, explicitReceivableIncrease > 0 Rs  explicitReceivableIncrease : (amount - storeCreditUsed));
    return { id: `tx-${tx.id}`, date, type: 'adjustment', description: `Customer Advance/Cash Out #${reference} — ${party}`, reference, party, payment, cashIn: 0, cashOut: payment === 'cash' Rs  amount : 0, bankIn: 0, bankOut: payment === 'online' Rs  amount : 0, receivableIncrease, receivableDecrease: 0, payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: 0, storeCreditDecrease: storeCreditUsed };
  }
  return { id: `tx-${tx.id}`, date, type: 'adjustment', description: `Transaction #${reference} — ${party}`, reference, party, payment: 'na', cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, receivableIncrease: 0, receivableDecrease: 0, payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: 0, storeCreditDecrease: 0 };
};

export default function Cashbook() {
  const [reloadKey, setReloadKey] = useState(0);
  const data = useMemo(() => loadData(), [reloadKey]);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [payFilter, setPayFilter] = useState<'all' | 'cash' | 'online' | 'credit'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | LedgerType>('all');
  const [search, setSearch] = useState(''); const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [full, setFull] = useState(false); const [visibleRowCount, setVisibleRowCount] = useState(100);
  const [visibleRegisterRowCount, setVisibleRegisterRowCount] = useState(50);
  const [activeTab, setActiveTab] = useState<'ledger' | 'register' | 'daily_breakdown' | 'gross_profit'>('ledger');
  const [selectedDailyBreakdownKey, setSelectedDailyBreakdownKey] = useState<string | null>(null);
  const [grossProfitCustomerSearch, setGrossProfitCustomerSearch] = useState('');
  const [grossProfitProductSearch, setGrossProfitProductSearch] = useState('');
  const [isGrossProfitModalOpen, setIsGrossProfitModalOpen] = useState(false);
  const [grossProfitPage, setGrossProfitPage] = useState(1);
  const [grossProfitModalPage, setGrossProfitModalPage] = useState(1);
  const [isAddCashOpen, setIsAddCashOpen] = useState(false);
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualType, setManualType] = useState<'cash_in' | 'cash_out'>('cash_in');
  const [manualAmount, setManualAmount] = useState('');
  const [manualDetails, setManualDetails] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [downloadFrom, setDownloadFrom] = useState('');
  const [downloadTo, setDownloadTo] = useState('');
  const [downloadPayFilter, setDownloadPayFilter] = useState<'all' | 'cash' | 'online' | 'credit'>('all');
  const [downloadTypeFilter, setDownloadTypeFilter] = useState<'all' | LedgerType>('all');
  const [downloadSearch, setDownloadSearch] = useState('');
  const [downloadSort, setDownloadSort] = useState<'newest' | 'oldest'>('newest');
  const [downloadFieldSelection, setDownloadFieldSelection] = useState<Record<CashbookExportFieldId, boolean>>(DEFAULT_CASHBOOK_EXPORT_FIELD_SELECTION);
  const dailyBreakdownModalRef = React.useRef<HTMLDivElement | null>(null);
  const dailyBreakdownCloseButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const dailyBreakdownTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const grossProfitModalRef = React.useRef<HTMLDivElement | null>(null);
  const grossProfitCloseButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const downloadModalRef = React.useRef<HTMLDivElement | null>(null);
  const downloadCloseButtonRef = React.useRef<HTMLButtonElement | null>(null);
  function closeDailyBreakdownModal() {
    setSelectedDailyBreakdownKey(null);
    window.setTimeout(() => {
      dailyBreakdownTriggerRef.currentRs .focus();
    }, 0);
  }
  useEscapeLayer(isAddCashOpen, () => setIsAddCashOpen(false), { priority: 100 });
  useEscapeLayer(Boolean(selectedDailyBreakdownKey), closeDailyBreakdownModal, { priority: 110 });
  useEscapeLayer(isGrossProfitModalOpen, () => setIsGrossProfitModalOpen(false), { priority: 115 });
  useEscapeLayer(isDownloadModalOpen, () => setIsDownloadModalOpen(false), { priority: 120 });

  const refreshCashbookData = async () => {
    try {
      await refreshDeletedTransactionsFromCloud();
    } finally {
      setReloadKey((k) => k + 1);
    }
  };

  useEffect(() => {
    void refreshCashbookData();
    const handleReload = () => setReloadKey((k) => k + 1);
    window.addEventListener('local-storage-update', handleReload);
    window.addEventListener('storage', handleReload);
    return () => {
      window.removeEventListener('local-storage-update', handleReload);
      window.removeEventListener('storage', handleReload);
    };
  }, []);

  const safeTransactions = asArray<Transaction>(data.transactions);
  const safeProducts = asArray<Product>((data as any).products);
  const safePurchaseOrders = asArray<PurchaseOrder>(data.purchaseOrders);
  const safeSupplierPayments = asArray<any>((data as any).supplierPayments);
  const safeExpenses = asArray<Expense>(data.expenses);
  const safeCashAdjustments = asArray<CashAdjustment>(data.cashAdjustments);
  const safeDeletedTransactions = asArray<any>(data.deletedTransactions);
  const safeDeleteCompensations = asArray<any>(data.deleteCompensations);
  const safeUpdatedTransactionEvents = asArray<any>(data.updatedTransactionEvents);
  const safeCustomers = asArray<any>(data.customers);
  const safeUpfrontOrders = asArray<UpfrontOrder>((data as any).upfrontOrders);
  const safeManualCashbookEntries = asArray<ManualCashbookEntry>((data as any).manualCashbookEntries).filter((entry) => !entryRs .isDeleted);
  const customerMap = useMemo(() => new Map(safeCustomers.map((c) => [c.id, c.name || ''])), [safeCustomers]);
  const productMap = useMemo(() => new Map(safeProducts.map((product) => [product.id, product])), [safeProducts]);

  const openManualCashModal = (type: 'cash_in' | 'cash_out') => {
    setManualError(null);
    setManualType(type);
    setIsAddCashOpen(true);
  };

  const openDownloadModal = () => {
    setDownloadFrom(from);
    setDownloadTo(to);
    setDownloadPayFilter(payFilter);
    setDownloadTypeFilter(typeFilter);
    setDownloadSearch(search);
    setDownloadSort(sort);
    setDownloadFieldSelection({ ...DEFAULT_CASHBOOK_EXPORT_FIELD_SELECTION });
    setIsDownloadModalOpen(true);
  };

  const handleSaveManualEntry = async () => {
    const amount = Number(manualAmount);
    if (!manualDate) { setManualError('Date is required.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setManualError('Amount must be greater than 0.'); return; }
    if (manualType === 'cash_out' && amount > Math.max(0, Number(kpi.cash || 0))) {
      setManualError('Cash out cannot exceed available cash.');
      return;
    }
    setManualError(null);
    await createManualCashbookEntry({
      date: new Date(`${manualDate}T00:00:00`).toISOString(),
      type: manualType,
      amount,
      details: manualDetails.trim(),
      isDeleted: false,
    });
    setIsAddCashOpen(false);
    setManualAmount('');
    setManualDetails('');
    setManualType('cash_in');
    setManualDate(new Date().toISOString().slice(0, 10));
    setReloadKey((k) => k + 1);
  };

  const supplierPaymentRows = useMemo<Row[]>(() => {
    const directRows: Row[] = safeSupplierPayments
      .filter((sp) => !sp.deletedAt)
      .map((sp) => {
        const amount = Math.max(0, Number(sp.amount || 0));
        const paymentMethod = getSupplierPaymentMethod(sp.method);
        const isOnline = paymentMethod === 'online';
        const payableApplied = Math.max(0, Number((sp.paymentAppliedToPayable - sp.payableApplied - 0) || 0));
        const partyCreditCreated = Math.max(0, Number(sp.partyCreditCreated || 0));
        const overpaymentText = partyCreditCreated > 0
          Rs  ` • Payable reduced ${fmt(payableApplied)} • Party credit added ${fmt(partyCreditCreated)}`
          : '';
        return {
          id: `sp-${sp.id}`,
          date: sp.paidAt || sp.createdAt,
          type: 'supplier_payment',
          description: `Supplier Payment — ${sp.partyName || 'Supplier'} — ${paymentMethod}${overpaymentText}`,
          reference: sp.voucherNo || sp.id,
          party: sp.partyName || 'Supplier',
          payment: paymentMethod,
          cashIn: 0, cashOut: isOnline Rs  0 : amount, bankIn: 0, bankOut: isOnline Rs  amount : 0,
          receivableIncrease: 0, receivableDecrease: 0, payableIncrease: 0, payableDecrease: payableApplied, storeCreditIncrease: partyCreditCreated, storeCreditDecrease: 0,
        };
      });
    const legacyMap = new Map<string, { date: string; party: string; method: 'cash' | 'online'; note: string; amount: number; allocations: number }>();
    safePurchaseOrders.forEach((po) => {
      asArray<any>((po as any).paymentHistory).forEach((p) => {
        if ((p as any).supplierPaymentId) return;
        const amount = Math.max(0, Number(p.amount || 0));
        if (amount <= 0) return;
        const method = (p.method === 'online' Rs  'online' : 'cash') as 'cash' | 'online';
        const at = new Date(p.paidAt).getTime();
        if (!Number.isFinite(at)) return;
        const bucket = new Date(Math.floor(at / 60000) * 60000).toISOString().slice(0, 16);
        const note = String(p.note || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const key = `${po.partyId}|${method}|${note}|${bucket}`;
        const ex = legacyMap.get(key) || { date: p.paidAt, party: po.partyName || 'Supplier', method, note, amount: 0, allocations: 0 };
        ex.amount = Number((ex.amount + amount).toFixed(2));
        ex.allocations += 1;
        legacyMap.set(key, ex);
      });
    });
    const legacyRows: Row[] = [];
    legacyMap.forEach((g, key) => {
      legacyRows.push({
        id: `legacy-sp-${key}`,
        date: g.date,
        type: 'supplier_payment',
        description: `${g.method === 'online' Rs  'Online' : 'Cash'} supplier payment allocated across ${g.allocations} POs — ${g.party}`,
        reference: key,
        party: g.party,
        payment: g.method === 'online' Rs  'online' : 'cash',
        cashIn: 0, cashOut: g.method === 'cash' Rs  g.amount : 0, bankIn: 0, bankOut: g.method === 'online' Rs  g.amount : 0,
        receivableIncrease: 0, receivableDecrease: 0, payableIncrease: 0, payableDecrease: g.amount, storeCreditIncrease: 0, storeCreditDecrease: 0,
      });
    });
    return [...directRows, ...legacyRows];
  }, [safeSupplierPayments, safePurchaseOrders]);

  const rows = useMemo(() => {
    const txRows = safeTransactions.map((tx) => normalizeTransactionForCashbook(tx, customerMap));
    const purchaseRows: Row[] = safePurchaseOrders.flatMap((po) => {
      const base: Row = { id: `po-${po.id}`, date: po.orderDate || po.createdAt, type: 'purchase', description: `Purchase #${po.id.slice(-6)} — ${getPurchaseOrderProductSummary(po)} — ${po.partyName}`, reference: po.billNumber || po.id, party: po.partyName, payment: 'credit',
        cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, receivableIncrease: 0, receivableDecrease: 0, payableIncrease: Math.max(0, Number(po.totalAmount || 0)), payableDecrease: 0, storeCreditIncrease: 0, storeCreditDecrease: 0 };
      return [base];
    });
    const expenseRows: Row[] = safeExpenses.map((e) => ({ id: `exp-${e.id}`, date: e.createdAt, type: 'expense', description: `Expense — ${e.title}`, reference: e.id, party: e.category || '-', payment: 'cash',
      cashIn: 0, cashOut: Math.abs(e.amount || 0), bankIn: 0, bankOut: 0, receivableIncrease: 0, receivableDecrease: 0, payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: 0, storeCreditDecrease: 0 }));
    const adjRows: Row[] = safeCashAdjustments.map((a) => ({ id: `adj-${a.id}`, date: a.createdAt, type: 'adjustment', description: a.type === 'cash_addition' Rs  `Manual Cash Added — ${a.note || ''}` : `Manual Cash Withdrawn — ${a.note || ''}`,
      reference: a.id, party: '-', payment: 'cash', cashIn: a.type === 'cash_addition' Rs  a.amount : 0, cashOut: a.type === 'cash_withdrawal' Rs  a.amount : 0, bankIn: 0, bankOut: 0,
      receivableIncrease: 0, receivableDecrease: 0, payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: 0, storeCreditDecrease: 0 }));
    const manualRows: Row[] = safeManualCashbookEntries.map((entry) => ({
      id: `mce-${entry.id}`,
      date: entry.date || entry.createdAt,
      type: entry.type === 'cash_in' Rs  'manual_cash_in' : 'manual_cash_out',
      description: entry.detailsRs .trim() || (entry.type === 'cash_in' Rs  'Manual Cash In' : 'Manual Cash Out'),
      reference: entry.id,
      party: '-',
      payment: 'cash',
      cashIn: entry.type === 'cash_in' Rs  Math.max(0, Number(entry.amount || 0)) : 0,
      cashOut: entry.type === 'cash_out' Rs  Math.max(0, Number(entry.amount || 0)) : 0,
      bankIn: 0,
      bankOut: 0,
      receivableIncrease: 0,
      receivableDecrease: 0,
      payableIncrease: 0,
      payableDecrease: 0,
      storeCreditIncrease: 0,
      storeCreditDecrease: 0,
    }));
    const activeTxIds = new Set(safeTransactions.map((tx) => String(tx.id)));
    const deletedTxRows: Row[] = safeDeletedTransactions
      .filter((deleted) => !activeTxIds.has(String(deletedRs .originalTransactionId || deletedRs .originalTransactionRs .id || '')))
      .map((deleted) => getDeletedTransactionLedgerRow(deleted, customerMap))
      .filter((row): row is Row => !!row);
    const deletedByOriginalId = new Map(safeDeletedTransactions.map((d) => [String(dRs .originalTransactionId || dRs .originalTransactionRs .id || ''), d]));
    const compensationRows: Row[] = safeDeleteCompensations.flatMap((c) => {
      const linkedDeleted = deletedByOriginalId.get(String(c.transactionId));
      const reference = linkedDeleted Rs  getCashbookReference({ ...(linkedDeleted.originalTransaction || {}), id: c.transactionId }) : (String(c.transactionId || '').slice(-6) || 'UNKNOWN');
      const party = c.customerName || linkedDeletedRs .customerName || 'Customer';
      const isOrphan = !linkedDeleted;
      const isExplicitRefund = cRs .isExplicitRefund === true || cRs .refundConfirmed === true || cRs .source === 'explicit_refund';
      const baseRow: Row = {
        id: `dc-${c.id}`,
        date: c.createdAt,
        type: 'deleted_refund' as LedgerType,
        description: isExplicitRefund
          Rs  (isOrphan Rs  `Explicit Delete Refund (orphan) #${reference} — ${party}` : `Explicit Delete Refund #${reference} — ${party}`)
          : (isOrphan Rs  `Delete Compensation Audit (orphan) #${reference} — ${party}` : `Delete Compensation Audit #${reference} — ${party}`),
        reference: String(c.transactionId || c.id),
        party,
        payment: isExplicitRefund Rs  (c.mode === 'online_refund' Rs  'online' as PayType : 'cash' as PayType) : 'na' as PayType,
        cashIn: 0,
        cashOut: isExplicitRefund Rs  (c.mode === 'online_refund' Rs  0 : Math.max(0, toNum(c.amount))) : 0,
        bankIn: 0,
        bankOut: isExplicitRefund Rs  (c.mode === 'online_refund' Rs  Math.max(0, toNum(c.amount)) : 0) : 0,
        receivableIncrease: 0,
        receivableDecrease: 0,
        payableIncrease: 0,
        payableDecrease: 0,
        storeCreditIncrease: 0,
        storeCreditDecrease: 0,
      };
      if (!isExplicitRefund || !linkedDeletedRs .originalTransaction) return [baseRow];
      const originalTx = linkedDeleted.originalTransaction as Transaction;
      const originalSettlement = getCashbookSaleBreakdown(originalTx, originalTx as any);
      const originalCashIn = Math.max(0, Number(originalSettlement.cashPaid || 0));
      if (originalCashIn <= 0) return [baseRow];
      const originalCashRow: Row = {
        id: `dc-src-${c.id}`,
        date: c.createdAt,
        type: 'deleted_refund' as LedgerType,
        description: isOrphan Rs  `Deleted Sale Original Cash (orphan) #${reference} — ${party}` : `Deleted Sale Original Cash #${reference} — ${party}`,
        reference: String(c.transactionId || c.id),
        party,
        payment: 'cash',
        cashIn: originalCashIn,
        cashOut: 0,
        bankIn: 0,
        bankOut: 0,
        receivableIncrease: 0,
        receivableDecrease: 0,
        payableIncrease: 0,
        payableDecrease: 0,
        storeCreditIncrease: 0,
        storeCreditDecrease: 0,
      };
      return [originalCashRow, baseRow];
    });
    const corrRows: Row[] = [
     ...compensationRows,
     ...safeUpdatedTransactionEvents.map((u) => ({ id: `ute-${u.id}`, date: u.updatedAt, type: 'adjustment' as LedgerType, description: `Transaction edit correction — ${u.customerName || u.updatedTransactionIdRs .sliceRs .(-6) || ''}`, reference: u.originalTransactionId, party: u.customerName || '-', payment: 'na' as PayType,
        cashIn: Math.max(0, toNum(u.cashbookDeltaRs .cashIn)), cashOut: Math.max(0, toNum(u.cashbookDeltaRs .cashOut)), bankIn: Math.max(0, toNum(u.cashbookDeltaRs .onlineIn)), bankOut: Math.max(0, toNum(u.cashbookDeltaRs .onlineOut)),
        receivableIncrease: Math.max(0, toNum(u.cashbookDeltaRs .currentDueEffect)), receivableDecrease: Math.max(0, -toNum(u.cashbookDeltaRs .currentDueEffect)), payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: Math.max(0, toNum(u.cashbookDeltaRs .currentStoreCreditEffect)), storeCreditDecrease: Math.max(0, -toNum(u.cashbookDeltaRs .currentStoreCreditEffect)) })),
    ];
    const upfrontRows: Row[] = buildUpfrontOrderLedgerEffects(safeUpfrontOrders, safeCustomers).flatMap<Row>((effect): Row[] => {
      if (effect.type === 'legacy_custom_order_info') return [];
      if (effect.isReceivableOnlyRepair) return [];
      if (effect.type === 'custom_order_receivable') {
        return [{
          id: effect.id,
          date: effect.date,
          type: 'custom_order_receivable',
          description: `Custom Order Receivable — ${effect.productName} — ${effect.customerName}`,
          reference: effect.orderId,
          party: effect.customerName,
          payment: 'na' as PayType,
          cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0,
          receivableIncrease: Math.max(0, effect.receivableIncrease),
          receivableDecrease: 0, payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: 0, storeCreditDecrease: 0,
        }];
      }
      return [{
        id: effect.id,
        date: effect.date,
        type: 'custom_order_payment',
        description: `Custom Order Payment — ${effect.productName} — ${effect.customerName}`,
        reference: effect.paymentId || effect.orderId,
        party: effect.customerName,
        payment: effect.paymentMethod === 'Cash' Rs  'cash' : effect.paymentMethod === 'Online' Rs  'online' : 'na',
        cashIn: Math.max(0, effect.cashIn), cashOut: 0, bankIn: Math.max(0, effect.bankIn), bankOut: 0,
        receivableIncrease: 0,
        receivableDecrease: Math.max(0, effect.receivableDecrease), payableIncrease: 0, payableDecrease: 0, storeCreditIncrease: 0, storeCreditDecrease: 0,
      }];
    });
    return [...txRows, ...deletedTxRows, ...purchaseRows, ...supplierPaymentRows, ...expenseRows, ...adjRows, ...manualRows, ...corrRows, ...upfrontRows].filter((r) => !!r.date && (r.cashIn || r.cashOut || r.bankIn || r.bankOut || r.receivableIncrease || r.receivableDecrease || r.payableIncrease || r.payableDecrease || r.storeCreditIncrease || r.storeCreditDecrease));
  }, [safeTransactions, safeDeletedTransactions, customerMap, safePurchaseOrders, safeExpenses, safeCashAdjustments, safeManualCashbookEntries, safeDeleteCompensations, safeUpdatedTransactionEvents, supplierPaymentRows, safeUpfrontOrders, safeCustomers]);

  const allLedgerRows = useMemo(() => asArray<Row>(rows), [rows]);

  const rowsWithChronoBalances = useMemo(() => {
    const chrono = [...allLedgerRows].sort((a,b)=>new Date(a.date).getTime()-new Date(b.date).getTime());
    let runningCash = 0; let runningBank = 0;
    const map = new Map<string, {cash:number; bank:number}>();
    for (const r of chrono) {
      runningCash += r.cashIn - r.cashOut;
      runningBank += r.bankIn - r.bankOut;
      map.set(r.id, { cash: runningCash, bank: runningBank });
    }
    return map;
  }, [allLedgerRows]);

  const filteredDisplayRows = useMemo(() => asArray<Row>(allLedgerRows)
    .filter((row) => matchesCashbookFilters(row, { from, to, payFilter, typeFilter, search }))
    .sort((a, b) => sort === 'newest' Rs  new Date(b.date).getTime() - new Date(a.date).getTime() : new Date(a.date).getTime() - new Date(b.date).getTime()), [allLedgerRows, from, to, payFilter, typeFilter, search, sort]);

  const currentWindowRows = useMemo(() => asArray<Row>(allLedgerRows).filter((r) => {
    const t = new Date(r.date).getTime();
    if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
    if (to && t > new Date(`${to}T23:59:59`).getTime()) return false;
    return true;
  }), [allLedgerRows, from, to]);

  // Cashbook KPI cards intentionally use current window rows so cash closing reflects selected range/session.
  const kpi = useMemo(() => {
    const scopeRows = currentWindowRows;
    const cash = scopeRows.reduce((sum, r) => sum + r.cashIn - r.cashOut, 0);
    const bank = scopeRows.reduce((sum, r) => sum + r.bankIn - r.bankOut, 0);
    const ledgerReceivableKpi = scopeRows.reduce((sum, r) => sum + r.receivableIncrease - r.receivableDecrease, 0);
    const ledgerPayableKpi = scopeRows.reduce((sum, r) => sum + r.payableIncrease - r.payableDecrease, 0);

    let canonicalSnapshot: any = null;
    let canonicalSnapshotError = '';
    try {
      canonicalSnapshot = getCanonicalCustomerBalanceSnapshot(safeCustomers, safeTransactions, safeUpfrontOrders);
    } catch (error) {
      canonicalSnapshotError = error instanceof Error Rs  error.message : 'Ledger calculation unavailable.';
    }
    const balances: Map<string, any> = canonicalSnapshotRs .balances instanceof Map Rs  canonicalSnapshot.balances : new Map<string, any>();

    const dashboardEquivalentReceivableRows = safeCustomers.map((customer) => {
      const rawBalanceObject = balances.get(customer.id);
      const dashboardTotalDueUsed = Math.max(0, Number(rawBalanceObjectRs .totalDue || 0));
      return { customerId: customer.id, customerName: customer.name || '-', dashboardTotalDueUsed, storeCredit: Number(rawBalanceObjectRs .storeCredit || 0), rawBalanceObject };
    });
    const canonicalReceivableForComparison = dashboardEquivalentReceivableRows.reduce((sum, row) => sum + row.dashboardTotalDueUsed, 0);

    const cashbookReceivableRows = safeCustomers.map((customer) => {
      const rawBalanceObject = balances.get(customer.id);
      const cashbookAmountUsed = Math.max(0, Number(rawBalanceObjectRs .totalDue || 0));
      return { customerId: customer.id, customerName: customer.name || '-', cashbookAmountUsed, rawBalanceObject };
    });
    const cashbookCurrentReceivable = cashbookReceivableRows.reduce((sum, row) => sum + row.cashbookAmountUsed, 0);

    const mismatchRows = dashboardEquivalentReceivableRows
      .map((row) => {
        const cashbookRow = cashbookReceivableRows.find((r) => r.customerId === row.customerId);
        const dashboardValue = row.dashboardTotalDueUsed;
        const cashbookValue = Number(cashbookRowRs .cashbookAmountUsed || 0);
        return { customerId: row.customerId, dashboardValue, cashbookValue, difference: dashboardValue - cashbookValue };
      })
      .filter((row) => Math.abs(row.difference) > 0.0001);

    const dashboardPayableForComparison = safePurchaseOrders.filter((po) => Math.max(0, Number(po.remainingAmount || 0)) > 0).reduce((sum, po) => sum + Math.max(0, Number(po.remainingAmount || 0)), 0);
    const receivableDifference = canonicalReceivableForComparison - ledgerReceivableKpi;
    const payableDifference = dashboardPayableForComparison - ledgerPayableKpi;

    if (CASHBOOK_RECONCILE_DEBUG && typeof window !== 'undefined') {
    }

    return { cash, bank, receivable: canonicalSnapshotError Rs  0 : ledgerReceivableKpi, payable: ledgerPayableKpi, ledgerCalculationError: canonicalSnapshotError };
  }, [currentWindowRows, safeCustomers, safeTransactions, safePurchaseOrders]);
  const availableCashForManualOut = useMemo(() => Math.max(0, Number(kpi.cash || 0)), [kpi.cash]);


  useEffect(() => setVisibleRowCount(100), [from, to, payFilter, typeFilter, search, sort]);
  const visibleRows = useMemo(() => asArray<Row>(filteredDisplayRows).slice(0, visibleRowCount), [filteredDisplayRows, visibleRowCount]);
  const selectedDownloadFields = useMemo(() => CASHBOOK_EXPORT_FIELDS.filter((field) => downloadFieldSelection[field.id]), [downloadFieldSelection]);
  const downloadPreviewRows = useMemo(() => asArray<Row>(allLedgerRows)
    .filter((row) => matchesCashbookFilters(row, {
      from: downloadFrom,
      to: downloadTo,
      payFilter: downloadPayFilter,
      typeFilter: downloadTypeFilter,
      search: downloadSearch,
    }))
    .sort((a, b) => downloadSort === 'newest' Rs  new Date(b.date).getTime() - new Date(a.date).getTime() : new Date(a.date).getTime() - new Date(b.date).getTime()), [
      allLedgerRows,
      downloadFrom,
      downloadTo,
      downloadPayFilter,
      downloadTypeFilter,
      downloadSearch,
      downloadSort,
    ]);

  const toggleDownloadField = (fieldId: CashbookExportFieldId) => {
    setDownloadFieldSelection((current) => ({ ...current, [fieldId]: !current[fieldId] }));
  };

  const selectAllDownloadFields = () => {
    setDownloadFieldSelection({ ...DEFAULT_CASHBOOK_EXPORT_FIELD_SELECTION });
  };

  const clearDownloadFields = () => {
    setDownloadFieldSelection(CASHBOOK_EXPORT_FIELDS.reduce<Record<CashbookExportFieldId, boolean>>((acc, field) => {
      acc[field.id] = false;
      return acc;
    }, {} as Record<CashbookExportFieldId, boolean>));
  };

  const handleDownloadCashbook = () => {
    if (selectedDownloadFields.length === 0 || downloadPreviewRows.length === 0) return;

    const filterSummary = [
      { Filter: 'Date From', Value: downloadFrom || 'All' },
      { Filter: 'Date To', Value: downloadTo || 'All' },
      { Filter: 'Payment Filter', Value: downloadPayFilter === 'all' Rs  'All Payment' : downloadPayFilter },
      { Filter: 'Type Filter', Value: downloadTypeFilter === 'all' Rs  'All Type' : (CASHBOOK_TYPE_LABELS[downloadTypeFilter] || downloadTypeFilter) },
      { Filter: 'Search', Value: downloadSearch.trim() || 'None' },
      { Filter: 'Sort', Value: downloadSort === 'newest' Rs  'Newest first' : 'Oldest first' },
      { Filter: 'Selected Fields', Value: selectedDownloadFields.map((field) => field.label).join(', ') },
      { Filter: 'Total Rows', Value: String(downloadPreviewRows.length) },
    ];

    const sheetRows = downloadPreviewRows.map((row) => {
      const balances = rowsWithChronoBalances.get(row.id) || { cash: 0, bank: 0 };
      const baseValues: Record<CashbookExportFieldId, string | number> = {
        date: new Date(row.date).toLocaleString(),
        type: CASHBOOK_TYPE_LABELS[row.type] || row.type,
        description: row.description,
        reference: row.reference,
        party: row.party,
        payment: row.payment === 'na' Rs  '-' : row.payment,
        cashIn: row.cashIn,
        cashOut: row.cashOut,
        bankIn: row.bankIn,
        bankOut: row.bankOut,
        receivableIncrease: row.receivableIncrease,
        receivableDecrease: row.receivableDecrease,
        payableIncrease: row.payableIncrease,
        payableDecrease: row.payableDecrease,
        storeCreditIncrease: row.storeCreditIncrease,
        storeCreditDecrease: row.storeCreditDecrease,
        cashBalance: balances.cash,
        bankBalance: balances.bank,
      };

      return selectedDownloadFields.reduce<Record<string, string | number>>((acc, field) => {
        acc[field.label] = baseValues[field.id];
        return acc;
      }, {});
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheetRows), 'Cashbook Ledger');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filterSummary), 'Export Filters');
    XLSX.writeFile(workbook, `Cashbook_Ledger_${new Date().toISOString().split('T')[0]}.xlsx`);
    setIsDownloadModalOpen(false);
  };

  const buildRegisterRows = useCallback((): RegisterRow[] => {
    const rowsOut: RegisterRow[] = [];
    const txChrono = [...safeTransactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    txChrono.forEach((tx) => {
      const txAny = tx as any;
      const ref = getCashbookReference(txAny);
      if (tx.type === 'sale') {
        const s = getCashbookSaleBreakdown(tx, txAny);
        const hasCash = s.cashPaid > 0; const hasOnline = s.onlinePaid > 0; const hasCredit = s.creditDue > 0;
        const lanes = Number(hasCash) + Number(hasOnline) + Number(hasCredit);
        const payType = lanes > 1 Rs  'Mixed' : hasCash Rs  'Cash' : hasOnline Rs  'Online' : hasCredit Rs  'Credit' : '—';
        normalizeTransactionItems(tx.items).forEach((item: any, idx: number) => {
          const qty = Math.max(0, Number(item.quantity || 0));
          const sp = Math.max(0, Number(item.sellPrice || 0));
          const lineDisc = Math.max(0, Number(item.discountAmount || 0));
          const lineTotal = Math.max(0, (qty * sp) - lineDisc);
          const bp = Number(item.buyPrice);
          const hasBp = Number.isFinite(bp);
          const cost = hasBp Rs  Math.max(0, qty * bp) : null;
          const profit = hasBp Rs  lineTotal - (cost || 0) : null;
          rowsOut.push({
            id: `reg-${tx.id}-${idx}`,
            date: tx.date,
            customerName: tx.customerName || 'Walk-in Customer',
            billRef: ref,
            invoiceNumber: tx.invoiceNo || '',
            creditAc: 'Sell',
            paymentType: payType,
            details: `${item.name || 'Item'}${item.selectedVariant Rs  ` / ${item.selectedVariant}` : ''}${item.selectedColor Rs  ` / ${item.selectedColor}` : ''}`,
            avaiQty: '—',
            sellingQty: qty Rs  String(qty) : '',
            sellingPrice: sp Rs  fmt(sp) : '',
            billTotal: fmt(Math.abs(Number(tx.total || 0))),
            total: fmt(lineTotal),
            balanceInr: '',
            creditAmount: idx === 0 && s.creditDue > 0 Rs  fmt(s.creditDue) : '',
            buyingPrice: hasBp Rs  fmt(bp) : '—',
            totalBuyingPrice: hasBp Rs  fmt(cost || 0) : '—',
            profit: hasBp Rs  fmt(profit || 0) : '—',
            column1: '',
            column2: '',
            column3: '',
            cashIn: 0, cashOut: 0,
          });
        });
        return;
      }
      if (tx.type === 'return') {
        const r = getCashbookReturnBreakdown(txAny);
        const mode = String(txAnyRs .returnHandlingMode || '').toLowerCase();
        const payType = mode === 'store_credit' Rs  'Store Credit' : r.payment === 'cash' Rs  'Cash' : r.payment === 'online' Rs  'Online' : r.payment === 'credit' Rs  'Credit' : 'Mixed';
        normalizeTransactionItems(tx.items).forEach((item: any, idx: number) => {
          const qty = Math.max(0, Number(item.quantity || 0));
          const sp = Math.max(0, Number(item.sellPrice || 0));
          const lineTotal = qty * sp;
          const bp = Number(item.buyPrice);
          const hasBp = Number.isFinite(bp);
          const cost = hasBp Rs  Math.max(0, qty * bp) : null;
          rowsOut.push({
            id: `reg-${tx.id}-${idx}`,
            date: tx.date,
            customerName: tx.customerName || 'Walk-in Customer',
            billRef: ref,
            invoiceNumber: tx.creditNoteNo || '',
            creditAc: 'Sales Return',
            paymentType: payType,
            details: `${item.name || 'Returned item'}${item.selectedVariant Rs  ` / ${item.selectedVariant}` : ''}${item.selectedColor Rs  ` / ${item.selectedColor}` : ''}`,
            avaiQty: '—',
            sellingQty: qty Rs  String(qty) : '',
            sellingPrice: sp Rs  fmt(sp) : '',
            billTotal: fmt(Math.abs(Number(tx.total || 0))),
            total: fmt(lineTotal),
            balanceInr: '',
            creditAmount: idx === 0 && r.receivableDecrease > 0 Rs  fmt(-r.receivableDecrease) : '',
            buyingPrice: hasBp Rs  fmt(bp) : '—',
            totalBuyingPrice: hasBp Rs  fmt(cost || 0) : '—',
            profit: '—',
            column1: '',
            column2: '',
            column3: '',
            cashIn: 0, cashOut: 0,
          });
        });
        return;
      }
      const amount = Math.abs(Number(tx.total || 0));
      if (tx.type === 'payment') {
        const method = String(tx.paymentMethod || '').toLowerCase();
        const isCash = method === 'cash';
        rowsOut.push({ id: `reg-${tx.id}`, date: tx.date, customerName: tx.customerName || 'Walk-in Customer', billRef: ref, invoiceNumber: '', creditAc: 'Credit Received', paymentType: isCash Rs  'Cash' : 'Online', details: `Payment Receipt #${ref} — ${tx.customerName || 'Walk-in Customer'}`, avaiQty: '—', sellingQty: '', sellingPrice: '', billTotal: '', total: fmt(amount), balanceInr: '', creditAmount: fmt(-amount), buyingPrice: '—', totalBuyingPrice: '—', profit: '—', column1: '', column2: '', column3: '', cashIn: isCash Rs  amount : 0, cashOut: 0 });
      }
    });
    const upfrontEffects = buildUpfrontOrderLedgerEffects(safeUpfrontOrders, safeCustomers);
    upfrontEffects.forEach((effect) => {
      if (effect.type === 'legacy_custom_order_info') return;
      const payType = effect.paymentMethod === 'Cash' Rs  'Cash' : effect.paymentMethod === 'Online' Rs  'Online' : effect.paymentMethod === 'Mixed' Rs  'Mixed' : 'Advance';
      rowsOut.push({
        id: `reg-upfront-${effect.id}`,
        date: effect.date,
        customerName: effect.customerName,
        billRef: effect.orderId.slice(-6),
        invoiceNumber: '',
        creditAc: effect.type === 'custom_order_receivable' Rs  'Customer Advance / Custom Order' : 'Credit Received',
        paymentType: payType,
        details: effect.description,
        avaiQty: '—',
        sellingQty: '',
        sellingPrice: '',
        billTotal: effect.totalAmount > 0 Rs  fmt(effect.totalAmount) : '',
        total: fmt(effect.type === 'custom_order_payment' Rs  effect.paidAmount : effect.receivableIncrease),
        balanceInr: '',
        creditAmount: effect.receivableDecrease > 0 Rs  fmt(-effect.receivableDecrease) : effect.receivableIncrease > 0 Rs  fmt(effect.receivableIncrease) : '',
        buyingPrice: '—',
        totalBuyingPrice: '—',
        profit: '—',
        column1: '',
        column2: '',
        column3: '',
        cashIn: effect.cashIn,
        cashOut: 0,
      });
    });
    safePurchaseOrders.forEach((po) => {
      const lines = Array.isArray((po as any).lines) && (po as any).lines.length Rs  (po as any).lines : [null];
      lines.forEach((line: any, idx: number) => {
        const qty = line Rs  Math.max(0, Number(line.quantity || 0)) : 0;
        const unitCost = line Rs  Math.max(0, Number(line.unitCost || 0)) : 0;
        const lineTotal = line Rs  Math.max(0, Number(line.totalCost || (qty * unitCost))) : Math.max(0, Number(po.totalAmount || 0));
        rowsOut.push({ id: `reg-po-${po.id}-${idx}`, date: po.orderDate || po.createdAt, customerName: po.partyName || 'Supplier', billRef: po.billNumber || po.id.slice(-6), invoiceNumber: '', creditAc: 'Purchase', paymentType: 'Credit', details: line Rs  `PO ${po.billNumber || po.id.slice(-6)} — ${line.productName || 'Item'}` : `PO ${po.billNumber || po.id.slice(-6)}`, avaiQty: '—', sellingQty: qty Rs  String(qty) : '', sellingPrice: '', billTotal: fmt(Math.max(0, Number(po.totalAmount || 0))), total: fmt(lineTotal), balanceInr: '', creditAmount: '', buyingPrice: unitCost Rs  fmt(unitCost) : '—', totalBuyingPrice: line Rs  fmt(lineTotal) : '—', profit: '—', column1: '', column2: '', column3: '', cashIn: 0, cashOut: 0 });
      });
    });
    safeSupplierPayments.filter((sp: any) => !sp.deletedAt).forEach((sp: any) => {
      const amount = Math.max(0, Number(sp.amount || 0)); const method = getSupplierPaymentMethod(sp.method); const isOnline = method === 'online';
      const ref = sp.voucherNo || String(sp.id || '').slice(-6);
      rowsOut.push({ id: `reg-sp-${sp.id}`, date: sp.paidAt || sp.createdAt, customerName: sp.partyName || 'Supplier', billRef: ref, invoiceNumber: '', creditAc: 'Cash Withdrawn', paymentType: isOnline Rs  'Online' : 'Cash', details: `Supplier Payment #${ref} — ${sp.partyName || 'Supplier'}`, avaiQty: '—', sellingQty: '', sellingPrice: '', billTotal: '', total: fmt(amount), balanceInr: '', creditAmount: '', buyingPrice: '—', totalBuyingPrice: '—', profit: '—', column1: '', column2: '', column3: '', cashIn: 0, cashOut: isOnline Rs  0 : amount });
    });
    safeExpenses.forEach((e) => {
      const amount = Math.max(0, Number(e.amount || 0));
      rowsOut.push({ id: `reg-exp-${e.id}`, date: e.createdAt, customerName: e.category || '', billRef: String(e.id || '').slice(-6), invoiceNumber: '', creditAc: 'Expense', paymentType: 'Cash', details: e.title || 'Expense', avaiQty: '—', sellingQty: '', sellingPrice: '', billTotal: '', total: fmt(amount), balanceInr: '', creditAmount: '', buyingPrice: '—', totalBuyingPrice: '—', profit: '—', column1: '', column2: '', column3: '', cashIn: 0, cashOut: amount });
    });
    safeCashAdjustments.forEach((a) => {
      const amount = Math.max(0, Number(a.amount || 0)); const isAdd = a.type === 'cash_addition';
      rowsOut.push({ id: `reg-adj-${a.id}`, date: a.createdAt, customerName: '', billRef: String(a.id || '').slice(-6), invoiceNumber: '', creditAc: isAdd Rs  'Capital Added' : 'Cash Withdrawn', paymentType: 'Cash', details: a.note || (isAdd Rs  'Manual cash addition' : 'Manual cash withdrawal'), avaiQty: '—', sellingQty: '', sellingPrice: '', billTotal: '', total: fmt(amount), balanceInr: '', creditAmount: '', buyingPrice: '—', totalBuyingPrice: '—', profit: '—', column1: '', column2: '', column3: '', cashIn: isAdd Rs  amount : 0, cashOut: isAdd Rs  0 : amount });
    });
    const ordered = rowsOut.filter((r) => !!r.date).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let runningCash = 0;
    return ordered.map((r) => {
      runningCash += r.cashIn - r.cashOut;
      return { ...r, balanceInr: fmt(runningCash) };
    });
  }, [safeTransactions, safePurchaseOrders, safeSupplierPayments, safeExpenses, safeCashAdjustments, safeUpfrontOrders, safeCustomers]);
  const registerRows = useMemo<RegisterRow[]>(() => {
    if (activeTab !== 'register') return [];
    return buildRegisterRows();
  }, [activeTab, buildRegisterRows]);
  const visibleRegisterRows = useMemo(() => registerRows.slice(0, visibleRegisterRowCount), [registerRows, visibleRegisterRowCount]);

  const getLocalDayKey = (value: string) => {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDayLabel = (dayKey: string) => {
    const parsed = new Date(`${dayKey}T00:00:00`);
    if (!Number.isFinite(parsed.getTime())) return dayKey;
    return parsed.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatTimeLabel = (value: string) => {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return 'Invalid time';
    return parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const getDailyCategoryLabel = (row: Row) => {
    switch (row.type) {
      case 'sale': return 'Sales';
      case 'payment': return 'Customer Payments';
      case 'purchase': return 'Purchase Added';
      case 'supplier_payment': return 'Supplier Payments';
      case 'expense': return 'Expenses';
      case 'return': return 'Returns';
      case 'credit':
      case 'custom_order_receivable': return 'Credit Created';
      case 'custom_order_payment': return 'Credit Due Received';
      case 'manual_cash_in': return 'Manual Cash In';
      case 'manual_cash_out': return 'Withdrawals';
      case 'adjustment':
        return row.description.toLowerCase().includes('withdraw')
          Rs  'Withdrawals'
          : row.description.toLowerCase().includes('added')
            Rs  'Manual Cash In'
            : 'Adjustments';
      default: return 'Other';
    }
  };

  const filteredDailyRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allLedgerRows.filter((r) => {
      const t = new Date(r.date).getTime();
      if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
      if (to && t > new Date(`${to}T23:59:59`).getTime()) return false;
      if (!query) return true;
      return `${r.description} ${r.reference} ${r.party}`.toLowerCase().includes(query);
    });
  }, [allLedgerRows, from, to, search]);

  const dailyBreakdownRows = useMemo(() => {
    const chrono = [...allLedgerRows].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const dayMap = new Map<string, {
      dayKey: string;
      openingCash: number;
      cashIn: number;
      cashOut: number;
      onlineIn: number;
      onlineOut: number;
      creditCreated: number;
      creditDueReceived: number;
      purchaseAdded: number;
      supplierPayments: number;
      expenses: number;
      withdrawals: number;
      closingCash: number;
      rows: Row[];
      categoryMap: Map<string, Row[]>;
    }>();
    let runningCash = 0;

    chrono.forEach((row) => {
      const dayKey = getLocalDayKey(row.date);
      if (!dayKey) return;
      let bucket = dayMap.get(dayKey);
      if (!bucket) {
        bucket = {
          dayKey,
          openingCash: runningCash,
          cashIn: 0,
          cashOut: 0,
          onlineIn: 0,
          onlineOut: 0,
          creditCreated: 0,
          creditDueReceived: 0,
          purchaseAdded: 0,
          supplierPayments: 0,
          expenses: 0,
          withdrawals: 0,
          closingCash: runningCash,
          rows: [],
          categoryMap: new Map<string, Row[]>(),
        };
        dayMap.set(dayKey, bucket);
      }

      bucket.cashIn += row.cashIn;
      bucket.cashOut += row.cashOut;
      bucket.onlineIn += row.bankIn;
      bucket.onlineOut += row.bankOut;
      bucket.creditCreated += row.receivableIncrease;
      bucket.creditDueReceived += row.receivableDecrease;
      bucket.purchaseAdded += row.payableIncrease;
      bucket.supplierPayments += row.type === 'supplier_payment' Rs  Math.max(0, row.cashOut + row.bankOut) : 0;
      bucket.expenses += row.type === 'expense' Rs  Math.max(0, row.cashOut + row.bankOut) : 0;
      bucket.withdrawals += row.type === 'manual_cash_out' || (row.type === 'adjustment' && row.description.toLowerCase().includes('withdraw'))
        Rs  Math.max(0, row.cashOut + row.bankOut)
        : 0;
      bucket.rows.push(row);

      const category = getDailyCategoryLabel(row);
      const categoryRows = bucket.categoryMap.get(category) || [];
      categoryRows.push(row);
      bucket.categoryMap.set(category, categoryRows);

      runningCash += row.cashIn - row.cashOut;
      bucket.closingCash = runningCash;
    });

    const visibleDayKeys = new Set(filteredDailyRows.map((row) => getLocalDayKey(row.date)).filter(Boolean));
    return Array.from(dayMap.values())
      .filter((bucket) => visibleDayKeys.has(bucket.dayKey))
      .sort((a, b) => sort === 'newest'
        Rs  new Date(`${b.dayKey}T00:00:00`).getTime() - new Date(`${a.dayKey}T00:00:00`).getTime()
        : new Date(`${a.dayKey}T00:00:00`).getTime() - new Date(`${b.dayKey}T00:00:00`).getTime());
  }, [allLedgerRows, filteredDailyRows, sort]);

  const selectedDailyBreakdown = useMemo(
    () => selectedDailyBreakdownKey
      Rs  dailyBreakdownRows.find((day) => day.dayKey === selectedDailyBreakdownKey) || null
      : null,
    [dailyBreakdownRows, selectedDailyBreakdownKey],
  );

  const openDailyBreakdownModal = (dayKey: string, trigger: HTMLButtonElement | null) => {
    dailyBreakdownTriggerRef.current = trigger;
    setSelectedDailyBreakdownKey(dayKey);
  };

  useEffect(() => {
    if (!selectedDailyBreakdown) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => {
      dailyBreakdownCloseButtonRef.currentRs .focus();
    }, 0);

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedDailyBreakdown]);

  useEffect(() => {
    if (!selectedDailyBreakdown) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }

      const container = dailyBreakdownModalRef.current;
      if (!container) {
        return;
      }

      const focusable = (Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ) as HTMLElement[]).filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedDailyBreakdown]);

  const getDailyPaymentBadgeClass = (payment: string) => {
    if (payment === 'cash') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (payment === 'online') return 'border-blue-200 bg-blue-50 text-blue-700';
    if (payment === 'credit') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-slate-200 bg-slate-100 text-slate-600';
  };
  const getGrossProfitSourceLabel = (source: ResolvedCostSource) => {
    if (source === 'historical_purchase_cost') return 'Historical cost';
    if (source === 'current_product_buy_price') return 'Current product cost';
    if (source === 'linked_sale_buy_price') return 'Linked sale';
    if (source === 'missing_buy_price') return 'Buy price missing';
    return 'Sale line';
  };
  const getGrossProfitSourceClass = (source: ResolvedCostSource) => {
    if (source === 'historical_purchase_cost') return 'border-sky-200 bg-sky-50 text-sky-700';
    if (source === 'current_product_buy_price') return 'border-amber-200 bg-amber-50 text-amber-700';
    if (source === 'linked_sale_buy_price') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (source === 'missing_buy_price') return 'border-rose-200 bg-rose-50 text-rose-700';
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  };

  const getDailyCategoryIcon = (category: string) => {
    switch (category) {
      case 'Sales':
        return ShoppingCart;
      case 'Customer Payments':
      case 'Credit Due Received':
        return Wallet;
      case 'Purchases':
        return Receipt;
      case 'Supplier Payments':
        return Truck;
      case 'Expenses':
        return BanknoteArrowDown;
      case 'Withdrawals':
        return BanknoteArrowUp;
      case 'Credit Created':
        return CreditCard;
      default:
        return Store;
    }
  };
  const renderGrossProfitPagination = (
    currentPage: number,
    totalPages: number,
    totalRows: number,
    onPrevious: () => void,
    onNext: () => void,
  ) => (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>Total matching rows: {totalRows}</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onPrevious} disabled={currentPage <= 1} className="rounded border px-3 py-1 text-foreground disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
        <span>Page {currentPage} of {totalPages}</span>
        <button type="button" onClick={onNext} disabled={currentPage >= totalPages} className="rounded border px-3 py-1 text-foreground disabled:cursor-not-allowed disabled:opacity-50">Next</button>
      </div>
    </div>
  );

  const grossProfitRows = useMemo<GrossProfitRow[]>(() => {
    const rowsOut: GrossProfitRow[] = [];
    const transactionsById = new Map(safeTransactions.map((tx) => [tx.id, tx]));

    safeTransactions.forEach((tx) => {
      const txAny = tx as any;
      const normalizedType = detectCashbookTransactionType(txAny);
      if (normalizedType !== 'sale' && normalizedType !== 'return') return;

      const items = normalizeTransactionItems<any>(tx.items);
      if (!items.length) return;

      const paymentMethod = normalizedType === 'sale'
        Rs  (() => {
          const settlement = getCashbookSaleBreakdown(tx, txAny);
          const hasCash = settlement.cashPaid > 0;
          const hasOnline = settlement.onlinePaid > 0;
          const hasCredit = settlement.creditDue > 0;
          const laneCount = Number(hasCash) + Number(hasOnline) + Number(hasCredit);
          return laneCount > 1 Rs  'Mixed' : hasCash Rs  'Cash' : hasOnline Rs  'Online' : hasCredit Rs  'Credit' : (tx.paymentMethod || 'Unknown');
        })()
        : (tx.paymentMethod || 'Credit');
      const customer = getCashbookCustomerName(txAny, customerMap);
      const invoiceRef = getCashbookReference(txAny);
      const multiplier = normalizedType === 'return' Rs  -1 : 1;
      const isHistoricalImport = tx.source === 'historical_import' || tx.isHistorical === true;
      const fallbackDetails = String(tx.notes || txAny.notes || invoiceRef || tx.id || '').trim() || 'Transaction';

      items.forEach((item, index) => {
        const qty = Math.max(0, Number(itemRs .quantity || 0));
        if (qty <= 0) return;

        const sellPrice = Math.max(0, Number(itemRs .sellPrice || 0));
        const discountAmount = Math.max(0, Number(itemRs .discountAmount || 0));
        const revenue = Number((((qty * sellPrice) - discountAmount) * multiplier).toFixed(2));
        const resolvedCost = resolveTransactionItemCost({
          item,
          txDate: tx.date,
          productsById: productMap,
          transactionsById,
        });
        const buyPrice = resolvedCost.buyPrice;
        const source = resolvedCost.source;
        const cogs = Number((qty * buyPrice * multiplier).toFixed(2));
        const grossProfit = Number((revenue - cogs).toFixed(2));
        const marginPct = Math.abs(revenue) > 0 Rs  Number(((grossProfit / revenue) * 100).toFixed(2)) : 0;

        rowsOut.push({
          id: `gp-${tx.id}-${index}`,
          date: tx.date,
          transactionId: tx.id,
          transactionType: normalizedType,
          invoiceRef,
          customer,
          product: getLineProductName(item),
          details: getLineProductName(item) || fallbackDetails,
          qty: qty * multiplier,
          sellPrice,
          revenue,
          buyPrice,
          cogs,
          grossProfit,
          marginPct,
          source,
          paymentMethod,
          productId: String(itemRs .id || ''),
          isHistoricalImport,
        });
      });
    });

    return rowsOut.sort((a, b) => getDateValue(b.date) - getDateValue(a.date));
  }, [customerMap, productMap, safeTransactions]);

  const filteredGrossProfitRows = useMemo(() => {
    const customerQuery = grossProfitCustomerSearch.trim().toLowerCase();
    const productQuery = grossProfitProductSearch.trim().toLowerCase();

    return grossProfitRows.filter((row) => {
      if (!matchesDateRange(row.date, from, to)) return false;
      if (customerQuery && !row.customer.toLowerCase().includes(customerQuery)) return false;
      if (productQuery && !row.product.toLowerCase().includes(productQuery)) return false;
      return true;
    });
  }, [from, grossProfitCustomerSearch, grossProfitProductSearch, grossProfitRows, to]);

  const grossProfitSummary = useMemo(() => {
    const netSales = filteredGrossProfitRows.reduce((sum, row) => sum + row.revenue, 0);
    const cogs = filteredGrossProfitRows.reduce((sum, row) => sum + row.cogs, 0);
    const grossProfit = netSales - cogs;
    const numberOfItemsSold = filteredGrossProfitRows.reduce((sum, row) => sum + row.qty, 0);
    const numberOfSales = new Set(filteredGrossProfitRows.map((row) => row.transactionId)).size;
    const grossMarginPct = Math.abs(netSales) > 0 Rs  (grossProfit / netSales) * 100 : 0;
    return { netSales, cogs, grossProfit, grossMarginPct, numberOfSales, numberOfItemsSold };
  }, [filteredGrossProfitRows]);

  const grossProfitAuditCounts = useMemo(() => {
    const saleBuyPriceRows = filteredGrossProfitRows.filter((row) => row.source === 'sale_line_buy_price' || row.source === 'linked_sale_buy_price').length;
    const historicalCostFallbackRows = filteredGrossProfitRows.filter((row) => row.source === 'historical_purchase_cost').length;
    const missingBuyPriceRows = filteredGrossProfitRows.filter((row) => row.source === 'missing_buy_price').length;
    const hasHistoricalImportRows = filteredGrossProfitRows.some((row) => row.isHistoricalImport);
    return { saleBuyPriceRows, historicalCostFallbackRows, missingBuyPriceRows, hasHistoricalImportRows };
  }, [filteredGrossProfitRows]);
  const grossProfitTotalPages = Math.max(1, Math.ceil(filteredGrossProfitRows.length / GROSS_PROFIT_PAGE_SIZE));
  const grossProfitModalTotalPages = Math.max(1, Math.ceil(filteredGrossProfitRows.length / GROSS_PROFIT_PAGE_SIZE));
  const pagedGrossProfitRows = useMemo(() => {
    const start = (grossProfitPage - 1) * GROSS_PROFIT_PAGE_SIZE;
    return filteredGrossProfitRows.slice(start, start + GROSS_PROFIT_PAGE_SIZE);
  }, [filteredGrossProfitRows, grossProfitPage]);
  const pagedGrossProfitModalRows = useMemo(() => {
    const start = (grossProfitModalPage - 1) * GROSS_PROFIT_PAGE_SIZE;
    return filteredGrossProfitRows.slice(start, start + GROSS_PROFIT_PAGE_SIZE);
  }, [filteredGrossProfitRows, grossProfitModalPage]);

  useEffect(() => {
    setGrossProfitPage(1);
    setGrossProfitModalPage(1);
  }, [from, to, grossProfitCustomerSearch, grossProfitProductSearch]);

  useEffect(() => {
    if (grossProfitPage > grossProfitTotalPages) {
      setGrossProfitPage(grossProfitTotalPages);
    }
  }, [grossProfitPage, grossProfitTotalPages]);

  useEffect(() => {
    if (grossProfitModalPage > grossProfitModalTotalPages) {
      setGrossProfitModalPage(grossProfitModalTotalPages);
    }
  }, [grossProfitModalPage, grossProfitModalTotalPages]);

  useEffect(() => {
    if (!isGrossProfitModalOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => {
      grossProfitCloseButtonRef.currentRs .focus();
    }, 0);

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isGrossProfitModalOpen]);

  useEffect(() => {
    if (!isGrossProfitModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const container = grossProfitModalRef.current;
      if (!container) return;

      const focusable = (Array.from(
        container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ) as HTMLElement[]).filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isGrossProfitModalOpen]);

  useEffect(() => {
    if (!isDownloadModalOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => {
      downloadCloseButtonRef.currentRs .focus();
    }, 0);
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isDownloadModalOpen]);

  useEffect(() => {
    if (!isDownloadModalOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const container = downloadModalRef.current;
      if (!container) return;

      const focusable = (Array.from(
        container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ) as HTMLElement[]).filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDownloadModalOpen]);

  return <div className="space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Cashbook</h1><p className="text-sm text-muted-foreground">Track all cash and bank flows across your business.</p></div>
      <div className="flex items-center gap-2">
        <button className="border rounded px-3 h-9 bg-emerald-600 text-white border-emerald-700" onClick={() => openManualCashModal('cash_in')}>Cash In</button>
        <button className="border rounded px-3 h-9 bg-rose-50 text-rose-700 border-rose-300" onClick={() => openManualCashModal('cash_out')}>Cash Out</button>
        <button className="border rounded px-3 h-9" onClick={() => void refreshCashbookData()}>Refresh cashbook</button>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
      <div className="rounded border p-3 bg-emerald-50"><div>Net Cash Movement</div><div className="text-xl font-bold text-emerald-700">{fmt(kpi.cash)}</div></div>
      <div className="rounded border p-3 bg-blue-50"><div>Net Bank Movement</div><div className="text-xl font-bold text-blue-700">{fmt(kpi.bank)}</div></div>
      <div className="rounded border p-3 bg-orange-50"><div>Customer/Party Receivable</div><div className="text-xl font-bold text-orange-700">{kpi.ledgerCalculationError Rs  'Ledger calculation unavailable' : fmt(kpi.receivable)}</div>{kpi.ledgerCalculationError && <div className="mt-1 text-xs text-amber-700">Canonical replay failed; stored customer snapshots are not shown as trusted balances.</div>}</div>
      <div className="rounded border p-3 bg-rose-50"><div>Customer/Party Payable</div><div className="text-xl font-bold text-rose-700">{fmt(kpi.payable)}</div></div>
    </div>

    <div className="rounded border p-3 space-y-3">
      <div className="flex gap-2">
        <button onClick={() => setActiveTab('ledger')} className={`border rounded px-3 h-9 ${activeTab === 'ledger' Rs  'bg-slate-900 text-white' : ''}`}>Cashbook Ledger</button>
        <button onClick={() => setActiveTab('register')} className={`border rounded px-3 h-9 ${activeTab === 'register' Rs  'bg-slate-900 text-white' : ''}`}>Register Format</button>
        <button onClick={() => setActiveTab('daily_breakdown')} className={`border rounded px-3 h-9 ${activeTab === 'daily_breakdown' Rs  'bg-slate-900 text-white' : ''}`}>Daily Breakdown</button>
        <button onClick={() => setActiveTab('gross_profit')} className={`border rounded px-3 h-9 ${activeTab === 'gross_profit' Rs  'bg-slate-900 text-white' : ''}`}>Gross Profit</button>
      </div>
      {(activeTab === 'ledger' || activeTab === 'daily_breakdown') && (
      <>
      {activeTab === 'ledger' && (
        <div className="flex items-center justify-between gap-3 rounded border bg-slate-50 px-3 py-2">
          <div className="text-xs text-muted-foreground">
            Download the cashbook ledger with selected filters and fields.
          </div>
          <button onClick={openDownloadModal} className="border rounded px-3 h-9 bg-slate-900 text-white border-slate-900">
            Download Cashbook
          </button>
        </div>
      )}
      <div className="grid md:grid-cols-6 gap-2">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 h-9" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 h-9" />
        <select value={payFilter} onChange={e => setPayFilter(e.target.value as any)} className="border rounded px-2 h-9"><option value="all">All Payment</option><option value="cash">Cash</option><option value="online">Bank/Online</option><option value="credit">Credit</option></select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)} className="border rounded px-2 h-9"><option value="all">All Type</option><option value="sale">Sale</option><option value="credit">Credit Sale</option><option value="payment">Payment</option><option value="return">Return</option><option value="deleted_sale">Deleted Sale</option><option value="deleted_refund">Deleted Refund</option><option value="purchase">Purchase</option><option value="supplier_payment">Supplier Payment</option><option value="expense">Expense</option><option value="adjustment">Adjustment</option><option value="manual_cash_in">Manual Cash In</option><option value="manual_cash_out">Manual Cash Out</option><option value="custom_order_receivable">Custom Order</option><option value="custom_order_payment">Custom Order Payment</option></select>
        <select value={sort} onChange={e => setSort(e.target.value as any)} className="border rounded px-2 h-9"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
        <button onClick={() => setFull(v => !v)} className="border rounded px-2 h-9">{full Rs  'Compact columns' : 'Show full accountant columns'}</button>
      </div>
      <input placeholder="Search description/customer/party/reference" value={search} onChange={e => setSearch(e.target.value)} className="border rounded px-2 h-9 w-full" />
      </>
      )}
      {activeTab === 'gross_profit' && (
      <>
      <div className="grid gap-2 md:grid-cols-4">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 h-9" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 h-9" />
        <input placeholder="Search customer" value={grossProfitCustomerSearch} onChange={e => setGrossProfitCustomerSearch(e.target.value)} className="border rounded px-2 h-9" />
        <input placeholder="Search product" value={grossProfitProductSearch} onChange={e => setGrossProfitProductSearch(e.target.value)} className="border rounded px-2 h-9" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">Gross Profit = Net Sales Revenue - COGS. Sales and sales returns are included.</p>
        <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Sale Buy Price Rows: {grossProfitAuditCounts.saleBuyPriceRows}</span>
        <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">Historical Cost Fallback Rows: {grossProfitAuditCounts.historicalCostFallbackRows}</span>
        <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">Missing Buy Price Rows: {grossProfitAuditCounts.missingBuyPriceRows}</span>
        {grossProfitAuditCounts.hasHistoricalImportRows && (
          <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Historical imported rows may use legacy pricing.</span>
        )}
      </div>
      </>
      )}
      {activeTab === 'daily_breakdown' && (
      <div className="space-y-3">
        {dailyBreakdownRows.map((day) => {
          return (
            <div key={day.dayKey} className="rounded-lg border">
              <button
                type="button"
                onClick={(event) => openDailyBreakdownModal(day.dayKey, event.currentTarget)}
                className="w-full rounded-lg p-3 text-left hover:bg-slate-50"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="font-semibold">{formatDayLabel(day.dayKey)}</div>
                    <div className="text-xs text-muted-foreground">{day.rows.length} entries</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 xl:grid-cols-6">
                    <div className="rounded border bg-slate-50 px-2 py-1"><div className="text-muted-foreground">Opening Cash</div><div className="font-semibold">{fmt(day.openingCash)}</div></div>
                    <div className="rounded border bg-emerald-50 px-2 py-1"><div className="text-muted-foreground">Cash In</div><div className="font-semibold">{fmt(day.cashIn)}</div></div>
                    <div className="rounded border bg-rose-50 px-2 py-1"><div className="text-muted-foreground">Cash Out</div><div className="font-semibold">{fmt(day.cashOut)}</div></div>
                    <div className="rounded border bg-blue-50 px-2 py-1"><div className="text-muted-foreground">Online In</div><div className="font-semibold">{fmt(day.onlineIn)}</div></div>
                    <div className="rounded border bg-orange-50 px-2 py-1"><div className="text-muted-foreground">Online Out</div><div className="font-semibold">{fmt(day.onlineOut)}</div></div>
                    <div className="rounded border bg-slate-100 px-2 py-1"><div className="text-muted-foreground">Closing Cash</div><div className="font-semibold">{fmt(day.closingCash)}</div></div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4 xl:grid-cols-6">
                  <div className="rounded border px-2 py-1">Credit Created: <span className="font-semibold">{fmt(day.creditCreated)}</span></div>
                  <div className="rounded border px-2 py-1">Credit Due Received: <span className="font-semibold">{fmt(day.creditDueReceived)}</span></div>
                  <div className="rounded border px-2 py-1">Purchase Added: <span className="font-semibold">{fmt(day.purchaseAdded)}</span></div>
                  <div className="rounded border px-2 py-1">Supplier Payments: <span className="font-semibold">{fmt(day.supplierPayments)}</span></div>
                  <div className="rounded border px-2 py-1">Expenses: <span className="font-semibold">{fmt(day.expenses)}</span></div>
                  <div className="rounded border px-2 py-1">Withdrawals: <span className="font-semibold">{fmt(day.withdrawals)}</span></div>
                </div>
              </button>
            </div>
          );
        })}
        {dailyBreakdownRows.length === 0 && <div className="rounded border px-3 py-6 text-sm text-muted-foreground">No daily rows found for the current filters.</div>}
      </div>
      )}
      {selectedDailyBreakdown && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          onClick={closeDailyBreakdownModal}
          aria-hidden="true"
        >
          <div
            ref={dailyBreakdownModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="daily-breakdown-modal-title"
            aria-describedby="daily-breakdown-modal-summary"
            className="flex max-h-[85vh] w-[90vw] max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-20 border-b bg-white/95 px-5 py-4 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h2 id="daily-breakdown-modal-title" className="text-xl font-semibold text-slate-900">
                    {formatDayLabel(selectedDailyBreakdown.dayKey)}
                  </h2>
                  <p id="daily-breakdown-modal-summary" className="text-sm text-slate-500">
                    {selectedDailyBreakdown.rows.length} entries
                  </p>
                </div>
                <button
                  ref={dailyBreakdownCloseButtonRef}
                  type="button"
                  onClick={closeDailyBreakdownModal}
                  className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Close daily breakdown"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 xl:grid-cols-8">
                <div className="rounded-xl border bg-slate-50 px-3 py-2"><div className="text-slate-500">Opening Cash</div><div className="text-sm font-semibold text-slate-900">{fmt(selectedDailyBreakdown.openingCash)}</div></div>
                <div className="rounded-xl border bg-slate-100 px-3 py-2"><div className="text-slate-500">Closing Cash</div><div className="text-sm font-semibold text-slate-900">{fmt(selectedDailyBreakdown.closingCash)}</div></div>
                <div className="rounded-xl border bg-emerald-50 px-3 py-2"><div className="text-emerald-700">Cash In</div><div className="text-sm font-semibold text-emerald-800">{fmt(selectedDailyBreakdown.cashIn)}</div></div>
                <div className="rounded-xl border bg-rose-50 px-3 py-2"><div className="text-rose-700">Cash Out</div><div className="text-sm font-semibold text-rose-800">{fmt(selectedDailyBreakdown.cashOut)}</div></div>
                <div className="rounded-xl border bg-blue-50 px-3 py-2"><div className="text-blue-700">Online In</div><div className="text-sm font-semibold text-blue-800">{fmt(selectedDailyBreakdown.onlineIn)}</div></div>
                <div className="rounded-xl border bg-orange-50 px-3 py-2"><div className="text-orange-700">Online Out</div><div className="text-sm font-semibold text-orange-800">{fmt(selectedDailyBreakdown.onlineOut)}</div></div>
                <div className="rounded-xl border bg-amber-50 px-3 py-2"><div className="text-amber-700">Credit Created</div><div className="text-sm font-semibold text-amber-800">{fmt(selectedDailyBreakdown.creditCreated)}</div></div>
                <div className="rounded-xl border bg-cyan-50 px-3 py-2"><div className="text-cyan-700">Credit Due Received</div><div className="text-sm font-semibold text-cyan-800">{fmt(selectedDailyBreakdown.creditDueReceived)}</div></div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-4">
              <div className="space-y-4">
                {Array.from(selectedDailyBreakdown.categoryMap.entries()).map(([category, categoryRows]) => {
                  const CategoryIcon = getDailyCategoryIcon(category);
                  return (
                    <section key={`${selectedDailyBreakdown.dayKey}-${category}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white/95 px-4 py-3 backdrop-blur">
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg bg-slate-100 p-2 text-slate-600">
                            <CategoryIcon className="h-4 w-4" />
                          </span>
                          <div>
                            <h3 className="text-sm font-semibold text-slate-900">{category}</h3>
                            <p className="text-xs text-slate-500">{categoryRows.length} entries</p>
                          </div>
                        </div>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {categoryRows.slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map((row, index) => {
                          const amount = Math.max(row.cashIn, row.cashOut, row.bankIn, row.bankOut, row.receivableIncrease, row.receivableDecrease, row.payableIncrease, row.payableDecrease);
                          return (
                            <div
                              key={row.id}
                              className={`grid gap-3 px-4 py-3 text-xs transition hover:bg-slate-50 md:grid-cols-[96px_120px_minmax(0,1fr)_120px_120px] ${index % 2 === 0 Rs  'bg-white' : 'bg-slate-50/50'}`}
                            >
                              <div className="font-medium text-slate-700">{formatTimeLabel(row.date)}</div>
                              <div className="uppercase tracking-wide text-slate-500">{row.type.replace(/_/g, ' ')}</div>
                              <div className="min-w-0">
                                <div className="truncate font-medium text-slate-900">{row.party || '—'}</div>
                                <div className="truncate text-slate-500">{row.description}</div>
                                <div className="truncate text-slate-400">Ref: {row.reference || row.id}</div>
                              </div>
                              <div className="flex items-start md:justify-center">
                                <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium capitalize ${getDailyPaymentBadgeClass(row.payment)}`}>
                                  {row.payment === 'na' Rs  '—' : row.payment}
                                </span>
                              </div>
                              <div className="text-right text-sm font-semibold text-slate-900">{fmt(amount)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
            <div className="border-t bg-white px-5 py-3">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={closeDailyBreakdownModal}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'ledger' && (
      <>
      <div className="overflow-auto"><table className="min-w-[1400px] w-full text-xs"><thead><tr className="text-left border-b"><th>Date</th><th>Type</th><th>Description</th><th>Payment</th><th className="text-right">Cash In</th><th className="text-right">Cash Out</th><th className="text-right">Bank In</th><th className="text-right">Bank Out</th><th className="text-right">Recv +</th><th className="text-right">Recv -</th><th className="text-right">Pay +</th><th className="text-right">Pay -</th><th className="text-right">SC +</th><th className="text-right">SC -</th><th className="text-right">Cash Bal</th><th className="text-right">Bank Bal</th></tr></thead><tbody>{visibleRows.map((r) => { const bal = rowsWithChronoBalances.get(r.id) || { cash: 0, bank: 0 }; return <tr key={r.id} className="border-b"><td>{new Date(r.date).toLocaleString()}</td><td>{({sale:'Sale',credit:'Credit Sale',payment:'Payment',return:'Return',deleted_sale:'Deleted Sale',deleted_refund:'Deleted Refund',purchase:'Purchase',supplier_payment:'Supplier Payment',expense:'Expense',adjustment:'Adjustment',manual_cash_in:'Manual Cash In',manual_cash_out:'Manual Cash Out',custom_order_receivable:'Custom Order',custom_order_payment:'Custom Order Payment'} as Record<string,string>)[r.type] || r.type}</td><td>{r.description}</td><td>{r.payment}</td><td className="text-right text-emerald-700">{r.cashIn Rs  fmt(r.cashIn) : '-'}</td><td className="text-right text-red-600">{r.cashOut Rs  fmt(r.cashOut) : '-'}</td><td className="text-right text-blue-700">{r.bankIn Rs  fmt(r.bankIn) : '-'}</td><td className="text-right text-red-600">{r.bankOut Rs  fmt(r.bankOut) : '-'}</td><td className="text-right">{r.receivableIncrease Rs  fmt(r.receivableIncrease) : '-'}</td><td className="text-right">{r.receivableDecrease Rs  fmt(r.receivableDecrease) : '-'}</td><td className="text-right">{r.payableIncrease Rs  fmt(r.payableIncrease) : '-'}</td><td className="text-right">{r.payableDecrease Rs  fmt(r.payableDecrease) : '-'}</td><td className="text-right">{r.storeCreditIncrease Rs  fmt(r.storeCreditIncrease) : '-'}</td><td className="text-right">{r.storeCreditDecrease Rs  fmt(r.storeCreditDecrease) : '-'}</td><td className="text-right">{fmt(bal.cash)}</td><td className="text-right">{fmt(bal.bank)}</td></tr>; })}</tbody></table></div>
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Showing {Math.min(visibleRows.length, filteredDisplayRows.length)} of {filteredDisplayRows.length} entries</span>{filteredDisplayRows.length > visibleRowCount && <button onClick={() => setVisibleRowCount((p) => p + 100)} className="border rounded px-3 py-1 text-foreground">Load More (100)</button>}</div>
      </>
      )}
      {activeTab === 'register' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Balance INR is cumulative cash movement from available ledger records.</p>
            <button
              onClick={() => {
                const rows = buildRegisterRows().map((r, idx) => ({
                  'Sr No.': idx + 1,
                  'DATE': new Date(r.date).toLocaleString(),
                  'Customer Name': r.customerName || '',
                  'Bill Ref': r.billRef || '',
                  'Invoice Number': r.invoiceNumber || '',
                  'CREDIT A/C': r.creditAc || '',
                  'Payment Type': r.paymentType || '',
                  'Details': r.details || '',
                  'Avai. Qty': r.avaiQty || '',
                  'Selling Qty': r.sellingQty || '',
                  'Selling Price': r.sellingPrice || '',
                  'Bill Total': r.billTotal || '',
                  'Total': r.total || '',
                  'Balance INR': r.balanceInr || '',
                  'Credit Amount': r.creditAmount || '',
                  'Buying Price': r.buyingPrice || '',
                  'Total Buying Price': r.totalBuyingPrice || '',
                  'Profit': r.profit || '',
                  'Column1': r.column1 || '',
                  'Column2': r.column2 || '',
                  'Column3': r.column3 || '',
                }));
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.json_to_sheet(rows);
                XLSX.utils.book_append_sheet(wb, ws, 'Register Format');
                XLSX.writeFile(wb, `Cashbook_Register_Format_${new Date().toISOString().split('T')[0]}.xlsx`);
              }}
              className="border rounded px-3 h-8 text-xs"
            >
              Download XLSX
            </button>
          </div>
          <div className="overflow-auto">
            <table className="min-w-[2600px] w-full text-xs">
              <thead className="sticky top-0 bg-slate-50"><tr className="text-left border-b">
                <th>Sr No.</th><th>DATE</th><th>Customer Name</th><th>Bill Ref</th><th>Invoice Number</th><th>CREDIT A/C</th><th>Payment Type</th><th>Details</th><th>Avai. Qty</th><th>Selling Qty</th><th>Selling Price</th><th>Bill Total</th><th>Total</th><th>Balance INR</th><th>Credit Amount</th><th>Buying Price</th><th>Total Buying Price</th><th>Profit</th><th>Column1</th><th>Column2</th><th>Column3</th>
              </tr></thead>
              <tbody>
                {visibleRegisterRows.map((r, idx) => <tr key={r.id} className="border-b">
                  <td>{idx + 1}</td><td>{new Date(r.date).toLocaleString()}</td><td>{r.customerName || '—'}</td><td>{r.billRef || '—'}</td><td>{r.invoiceNumber || '—'}</td><td>{r.creditAc || 'XXX'}</td><td>{r.paymentType || '—'}</td><td>{r.details || '—'}</td><td>{r.avaiQty || '—'}</td><td>{r.sellingQty || '—'}</td><td>{r.sellingPrice || '—'}</td><td>{r.billTotal || '—'}</td><td>{r.total || '—'}</td><td>{r.balanceInr || '—'}</td><td>{r.creditAmount || '—'}</td><td>{r.buyingPrice || '—'}</td><td>{r.totalBuyingPrice || '—'}</td><td>{r.profit || '—'}</td><td>{r.column1 || ''}</td><td>{r.column2 || ''}</td><td>{r.column3 || ''}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Showing {Math.min(visibleRegisterRows.length, registerRows.length)} of {registerRows.length} register entries</span>
            {registerRows.length > visibleRegisterRowCount && <button onClick={() => setVisibleRegisterRowCount((p) => p + 50)} className="border rounded px-3 py-1 text-foreground">Load More (50)</button>}
          </div>
        </div>
      )}
      {activeTab === 'gross_profit' && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => filteredGrossProfitRows.length > 0 && setIsGrossProfitModalOpen(true)}
              disabled={filteredGrossProfitRows.length === 0}
              className="rounded border bg-emerald-50 p-3 text-left transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="text-xs uppercase tracking-wide text-emerald-700">Gross Profit</div>
              <div className={`text-xl font-bold ${grossProfitSummary.grossProfit >= 0 Rs  'text-emerald-700' : 'text-rose-700'}`}>{fmt(grossProfitSummary.grossProfit)}</div>
              <div className="mt-1 text-xs text-muted-foreground">Open invoice summary</div>
            </button>
            <div className="rounded border bg-blue-50 p-3">
              <div className="text-xs uppercase tracking-wide text-blue-700">Net Sales</div>
              <div className="text-xl font-bold text-blue-700">{fmt(grossProfitSummary.netSales)}</div>
            </div>
          </div>

          <div className="overflow-auto rounded border">
            <table className="min-w-[1500px] w-full text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Invoice / Transaction ID</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Sell Price</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">Buy Price</th>
                  <th className="px-3 py-2 text-right">COGS</th>
                  <th className="px-3 py-2 text-right">Gross Profit</th>
                  <th className="px-3 py-2 text-right">Margin %</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {pagedGrossProfitRows.map((row, index) => (
                  <tr key={row.id} className={`border-b ${index % 2 === 0 Rs  'bg-white' : 'bg-slate-50/50'}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(row.date).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{row.invoiceRef}</div>
                      <div className="text-[11px] text-slate-500">{row.transactionId}</div>
                    </td>
                    <td className="px-3 py-2">{row.customer}</td>
                    <td className="px-3 py-2">{row.product}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${row.transactionType === 'return' Rs  'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                        {row.transactionType === 'return' Rs  'Return' : 'Sale'}
                      </span>
                    </td>
                    <td className={`px-3 py-2 text-right ${row.qty >= 0 Rs  '' : 'text-rose-700'}`}>{row.qty}</td>
                    <td className="px-3 py-2 text-right">{fmt(row.sellPrice)}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmt(row.revenue)}</td>
                    <td className="px-3 py-2 text-right">{fmt(row.buyPrice)}</td>
                    <td className="px-3 py-2 text-right">{fmt(row.cogs)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${row.grossProfit >= 0 Rs  'text-emerald-700' : 'text-rose-700'}`}>{fmt(row.grossProfit)}</td>
                    <td className={`px-3 py-2 text-right ${row.marginPct >= 0 Rs  'text-emerald-700' : 'text-rose-700'}`}>{formatPercent(row.marginPct)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${getGrossProfitSourceClass(row.source)}`}>
                          {getGrossProfitSourceLabel(row.source)}
                        </span>
                        {row.source === 'current_product_buy_price' && (
                          <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            Fallback
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {pagedGrossProfitRows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-3 py-8 text-center text-sm text-muted-foreground">No gross profit rows found for the selected filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {renderGrossProfitPagination(
            grossProfitPage,
            grossProfitTotalPages,
            filteredGrossProfitRows.length,
            () => setGrossProfitPage((page) => Math.max(1, page - 1)),
            () => setGrossProfitPage((page) => Math.min(grossProfitTotalPages, page + 1)),
          )}
        </div>
      )}
    </div>
    {isGrossProfitModalOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={() => setIsGrossProfitModalOpen(false)} aria-hidden="true">
        <div
          ref={grossProfitModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="gross-profit-modal-title"
          className="flex max-h-[88vh] w-[94vw] max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="sticky top-0 z-20 border-b bg-white/95 px-5 py-4 backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="gross-profit-modal-title" className="text-xl font-semibold text-slate-900">Gross Profit Summary</h2>
                <p className="text-sm text-slate-500">Showing latest 200 rows. Use filters to narrow results.</p>
              </div>
              <button
                ref={grossProfitCloseButtonRef}
                type="button"
                onClick={() => setIsGrossProfitModalOpen(false)}
                className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close gross profit summary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-xl border bg-emerald-50 px-3 py-2"><div className="text-emerald-700">Gross Profit</div><div className={`text-sm font-semibold ${grossProfitSummary.grossProfit >= 0 Rs  'text-emerald-800' : 'text-rose-700'}`}>{fmt(grossProfitSummary.grossProfit)}</div></div>
              <div className="rounded-xl border bg-blue-50 px-3 py-2"><div className="text-blue-700">Net Sales</div><div className="text-sm font-semibold text-blue-800">{fmt(grossProfitSummary.netSales)}</div></div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-4">
            <div className="space-y-3">
              <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-[1200px] w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="border-b text-left">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Transaction Type</th>
                      <th className="px-3 py-2">Transaction Method</th>
                      <th className="px-3 py-2">Details</th>
                      <th className="px-3 py-2">Customer Name</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Buy Price</th>
                      <th className="px-3 py-2 text-right">Sell Price</th>
                      <th className="px-3 py-2 text-right">Gross Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedGrossProfitModalRows.map((row, index) => (
                      <tr key={`modal-${row.id}`} className={`border-b ${index % 2 === 0 Rs  'bg-white' : 'bg-slate-50/50'}`}>
                        <td className="px-3 py-2 whitespace-nowrap">{new Date(row.date).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${row.transactionType === 'return' Rs  'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                            {row.transactionType === 'return' Rs  'Return' : 'Sale'}
                          </span>
                        </td>
                        <td className="px-3 py-2">{String(row.paymentMethod || 'Unknown').toLowerCase()}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{row.details || row.invoiceRef || row.transactionId}</div>
                          <div className="text-[11px] text-slate-500">{row.invoiceRef || row.transactionId}</div>
                        </td>
                        <td className="px-3 py-2">{row.customer}</td>
                        <td className={`px-3 py-2 text-right ${row.qty >= 0 Rs  '' : 'text-rose-700'}`}>{row.qty}</td>
                        <td className="px-3 py-2 text-right">{fmt(row.buyPrice)}</td>
                        <td className="px-3 py-2 text-right">{fmt(row.sellPrice)}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${row.grossProfit >= 0 Rs  'text-emerald-700' : 'text-rose-700'}`}>{fmt(row.grossProfit)}</td>
                      </tr>
                    ))}
                    {pagedGrossProfitModalRows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">No gross profit rows found for the current filtered view.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {renderGrossProfitPagination(
                grossProfitModalPage,
                grossProfitModalTotalPages,
                filteredGrossProfitRows.length,
                () => setGrossProfitModalPage((page) => Math.max(1, page - 1)),
                () => setGrossProfitModalPage((page) => Math.min(grossProfitModalTotalPages, page + 1)),
              )}
            </div>
          </div>
          <div className="border-t bg-white px-5 py-3">
            <div className="flex justify-end">
              <button type="button" onClick={() => setIsGrossProfitModalOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    {isDownloadModalOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={() => setIsDownloadModalOpen(false)} aria-hidden="true">
        <div
          ref={downloadModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cashbook-download-modal-title"
          className="flex max-h-[90vh] w-[96vw] max-w-[1100px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="sticky top-0 z-20 border-b bg-white/95 px-5 py-4 backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="cashbook-download-modal-title" className="text-xl font-semibold text-slate-900">Download Cashbook Ledger</h2>
                <p className="text-sm text-slate-500">Choose the filters and fields to include before downloading the cashbook.</p>
              </div>
              <button
                ref={downloadCloseButtonRef}
                type="button"
                onClick={() => setIsDownloadModalOpen(false)}
                className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close cashbook download"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-xl border bg-slate-50 px-3 py-2"><div className="text-slate-500">Rows to download</div><div className="text-sm font-semibold text-slate-900">{downloadPreviewRows.length}</div></div>
              <div className="rounded-xl border bg-blue-50 px-3 py-2"><div className="text-blue-700">Selected fields</div><div className="text-sm font-semibold text-blue-900">{selectedDownloadFields.length}</div></div>
              <div className="rounded-xl border bg-emerald-50 px-3 py-2"><div className="text-emerald-700">File type</div><div className="text-sm font-semibold text-emerald-900">Excel (.xlsx)</div></div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-4">
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Export Filters</h3>
                  <p className="text-xs text-slate-500">These control what kind of ledger data will be downloaded.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Date From</label>
                    <input type="date" value={downloadFrom} onChange={(e) => setDownloadFrom(e.target.value)} className="border rounded px-2 h-9 w-full" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Date To</label>
                    <input type="date" value={downloadTo} onChange={(e) => setDownloadTo(e.target.value)} className="border rounded px-2 h-9 w-full" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Payment Filter</label>
                    <select value={downloadPayFilter} onChange={(e) => setDownloadPayFilter(e.target.value as 'all' | 'cash' | 'online' | 'credit')} className="border rounded px-2 h-9 w-full">
                      <option value="all">All Payment</option>
                      <option value="cash">Cash</option>
                      <option value="online">Bank/Online</option>
                      <option value="credit">Credit</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Type Filter</label>
                    <select value={downloadTypeFilter} onChange={(e) => setDownloadTypeFilter(e.target.value as 'all' | LedgerType)} className="border rounded px-2 h-9 w-full">
                      <option value="all">All Type</option>
                      <option value="sale">Sale</option>
                      <option value="credit">Credit Sale</option>
                      <option value="payment">Payment</option>
                      <option value="return">Return</option>
                      <option value="deleted_sale">Deleted Sale</option>
                      <option value="deleted_refund">Deleted Refund</option>
                      <option value="purchase">Purchase</option>
                      <option value="supplier_payment">Supplier Payment</option>
                      <option value="expense">Expense</option>
                      <option value="adjustment">Adjustment</option>
                      <option value="manual_cash_in">Manual Cash In</option>
                      <option value="manual_cash_out">Manual Cash Out</option>
                      <option value="custom_order_receivable">Custom Order</option>
                      <option value="custom_order_payment">Custom Order Payment</option>
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-slate-600">Search</label>
                    <input placeholder="Description / customer / party / reference" value={downloadSearch} onChange={(e) => setDownloadSearch(e.target.value)} className="border rounded px-2 h-9 w-full" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Sort</label>
                    <select value={downloadSort} onChange={(e) => setDownloadSort(e.target.value as 'newest' | 'oldest')} className="border rounded px-2 h-9 w-full">
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => {
                        setDownloadFrom(from);
                        setDownloadTo(to);
                        setDownloadPayFilter(payFilter);
                        setDownloadTypeFilter(typeFilter);
                        setDownloadSearch(search);
                        setDownloadSort(sort);
                      }}
                      className="border rounded px-3 h-9 w-full text-sm"
                    >
                      Use current page filters
                    </button>
                  </div>
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Fields In Download</h3>
                    <p className="text-xs text-slate-500">Pick the columns that should appear in the Excel file.</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={selectAllDownloadFields} className="border rounded px-2 py-1 text-xs">Select all</button>
                    <button type="button" onClick={clearDownloadFields} className="border rounded px-2 py-1 text-xs">Clear</button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {CASHBOOK_EXPORT_FIELDS.map((field) => (
                    <label key={field.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={downloadFieldSelection[field.id]}
                        onChange={() => toggleDownloadField(field.id)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span>{field.label}</span>
                    </label>
                  ))}
                </div>
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3">
                  <div className="text-xs font-medium text-slate-600">Selected field preview</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedDownloadFields.length > 0 Rs  selectedDownloadFields.map((field) => (
                      <span key={`selected-${field.id}`} className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">
                        {field.label}
                      </span>
                    )) : (
                      <span className="text-xs text-rose-600">Select at least one field to enable download.</span>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
          <div className="border-t bg-white px-5 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-500">
                The Excel file includes a `Cashbook Ledger` sheet and an `Export Filters` sheet.
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setIsDownloadModalOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCashbook}
                  disabled={downloadPreviewRows.length === 0 || selectedDownloadFields.length === 0}
                  className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Download Excel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
    {isAddCashOpen && (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg border shadow-lg w-full max-w-md p-4 space-y-3">
          <h2 className="text-lg font-semibold">Add Cash Entry</h2>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Date</label>
            <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} className="border rounded px-2 h-9 w-full" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Type</label>
            <select value={manualType} onChange={(e) => setManualType(e.target.value as 'cash_in' | 'cash_out')} className="border rounded px-2 h-9 w-full">
              <option value="cash_in">Cash In</option>
              <option value="cash_out">Cash Out</option>
            </select>
          </div>
          {manualType === 'cash_out' && (
            <div className="text-xs text-muted-foreground">Available cash: {fmt(availableCashForManualOut)}</div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Amount</label>
            <input type="number" min="0" step="0.01" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} className="border rounded px-2 h-9 w-full" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Details / note</label>
            <textarea value={manualDetails} onChange={(e) => setManualDetails(e.target.value)} className="border rounded px-2 py-2 w-full min-h-[80px]" placeholder="Optional details" />
          </div>
          {manualError && <div className="text-xs text-red-600">{manualError}</div>}
          <div className="flex justify-end gap-2">
            <button className="border rounded px-3 h-9" onClick={() => setIsAddCashOpen(false)}>Cancel</button>
            <button className="border rounded px-3 h-9 bg-slate-900 text-white" onClick={handleSaveManualEntry}>Save Entry</button>
          </div>
        </div>
      </div>
    )}
  </div>;
}

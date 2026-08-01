
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getProductBarcode, getProductCategory, getProductName, getProductSearchText, safeLower } from '../utils/productText';
import { getFriendlyErrorMessage } from '../services/errorMessages';
import { Transaction, Customer, DeletedTransactionRecord, CartItem, Product, PurchaseOrder, UpfrontOrder, SupplierPaymentLedgerEntry, Expense, CashAdjustment } from '../types';
import { NO_COLOR, NO_VARIANT } from '../services/productVariants';
import { auth } from '../services/firebase';
import { getDeleteTransactionPreview, getSaleSettlementBreakdown, getCanonicalReturnPreviewForDraft, getTransactionUpdateAuditPreview, loadData, deleteTransaction, updateTransaction, loadDeletedTransactionsPage, refreshDeletedTransactionsFromCloud, TransactionPageCursor } from '../services/storage';
import { generateReceiptPDF } from '../services/pdf';
import { shareTransactionInvoiceViaMetaWhatsApp } from '../services/metaWhatsAppShare';
import { appendWhatsAppLog } from '../services/whatsappLogs';
import { Card, CardContent, CardHeader, CardTitle, Badge, Select, Input, Button, LightweightLoader } from '../components/ui';
import { TrendingDown, TrendingUp, Calendar, X, Eye, ArrowUpRight, ArrowDownLeft, User, Package, Clock, Download, CreditCard, IndianRupee, Percent, FileText, Edit, Trash2, Search, ChevronDown, Users } from 'lucide-react';
import { UploadImportModal } from '../components/UploadImportModal';
import { downloadTransactionsData, downloadTransactionsTemplate, importHistoricalTransactionsFromFile } from '../services/importExcel';
import { DISPLAY_FALLBACK, formatCurrency, formatINRPrecise, formatINRWhole, formatMoneyPrecise, formatMoneyWhole, joinDisplayParts, sanitizeDisplayText } from '../services/numberFormat';
import { getPaymentStatusColorClass } from '../utils_paymentStatusStyles';
import { getCanonicalCustomerBalanceResult } from '../services/customerBalanceView';
import { normalizeTransactionItems } from '../utils/transactionItems';
import { useRoleSession } from '../src/auth/roleSession';
import { can, isAdmin } from '../src/auth/simplePermissions';
import { useEscapeLayer } from '../src/hooks/useEscapeLayer';
import { formatDateTimeDisplay } from '../src/utils/dateFormat';

function ConfirmDialog({ open, title, message, onCancel, onConfirm }: { open: boolean; title: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  useEscapeLayer(open, onCancel, { priority: 120 });
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={onConfirm}>Delete</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Transactions() {
  const { requestAdminOverride } = useRoleSession();
  const COLORED_ROWS_STORAGE_KEY = 'stockflow.transactions.colored_rows';
  const getTransactionReference = (tx: Transaction) => tx.type === 'sale'
    ? (tx.invoiceNo || tx.id.slice(-6))
    : tx.type === 'return'
      ? (tx.creditNoteNo || tx.id.slice(-6))
      : (tx.receiptNo || tx.id.slice(-6));
  const isUpfrontVirtualTransaction = (tx?: Transaction | null) => !!tx?.id?.startsWith('upfront-');
  const isSupplierPaymentVirtualTransaction = (tx?: Transaction | null) => !!tx?.id?.startsWith('supplier-payment-');
  const isExpenseVirtualTransaction = (tx?: Transaction | null) => !!tx?.id?.startsWith('expense-');
  const isCashAdjustmentVirtualTransaction = (tx?: Transaction | null) => !!tx?.id?.startsWith('cash-adjustment-');
  const isCashWithdrawalVirtualTransaction = (tx?: Transaction | null) => !!tx?.id?.startsWith('cash-adjustment-') && String((tx as any)?.notes || '').toLowerCase().includes('cash withdrawal');
  const isCashAdditionVirtualTransaction = (tx?: Transaction | null) => !!tx?.id?.startsWith('cash-adjustment-') && String((tx as any)?.notes || '').toLowerCase().includes('cash addition');
  const isCustomOrderPaymentRow = (tx?: Transaction | null) => !!tx && isUpfrontVirtualTransaction(tx) && String(tx.notes || '').toLowerCase().includes('order payment');
  const isCustomOrderReceivableRow = (tx?: Transaction | null) => !!tx && isUpfrontVirtualTransaction(tx) && !isCustomOrderPaymentRow(tx);
  const canExportInvoiceForTransaction = (tx?: Transaction | null) => !!tx && !isExpenseVirtualTransaction(tx) && !isCashAdjustmentVirtualTransaction(tx) && !isSupplierPaymentVirtualTransaction(tx);
  const getTransactionReceiptTitle = (tx: Transaction) => {
    if (isExpenseVirtualTransaction(tx)) return 'Expense Entry';
    if (isCashWithdrawalVirtualTransaction(tx)) return 'Cash Withdrawal Entry';
    if (isCashAdditionVirtualTransaction(tx)) return 'Cash Addition Entry';
    if (isSupplierPaymentVirtualTransaction(tx)) return 'Supplier Payment Entry';
    if (isCustomOrderPaymentRow(tx)) return 'Custom Order Payment Receipt';
    if (isCustomOrderReceivableRow(tx)) return 'Custom Order Receipt';
    if (tx.type === 'sale') return 'Sale Receipt';
    if (tx.type === 'payment') return 'Payment Receipt';
    return 'Return Receipt';
  };


  const DELETED_ROWS_PER_PAGE = 25;
  const DELETED_WINDOW_BATCH_SIZE = 100;
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [cashAdjustments, setCashAdjustments] = useState<CashAdjustment[]>([]);
  const [deletedTransactions, setDeletedTransactions] = useState<DeletedTransactionRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [upfrontOrders, setUpfrontOrders] = useState<UpfrontOrder[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPaymentLedgerEntry[]>([]);
  const [filterType, setFilterType] = useState('7days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [viewMode, setViewMode] = useState<'default' | 'list' | 'list-details' | 'medium'>('list-details');
  const [useColoredTransactionRows, setUseColoredTransactionRows] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COLORED_ROWS_STORAGE_KEY) === 'true';
  });
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [txToExport, setTxToExport] = useState<Transaction | null>(null);
  const [isInvoiceOptionsOpen, setIsInvoiceOptionsOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [batchEditTransactionIds, setBatchEditTransactionIds] = useState<string[]>([]);
  const [isBatchDeleteConfirmOpen, setIsBatchDeleteConfirmOpen] = useState(false);
  const [batchEditTransactionIndex, setBatchEditTransactionIndex] = useState(0);
  const [editingAmount, setEditingAmount] = useState('');
  const [editingTxDate, setEditingTxDate] = useState('');
  const [editingTxPaymentMethod, setEditingTxPaymentMethod] = useState<'Cash' | 'Credit' | 'Online'>('Cash');
  const [editingTxNotes, setEditingTxNotes] = useState('');
  const [editingCustomerId, setEditingCustomerId] = useState('');
  const [editingCustomerSearch, setEditingCustomerSearch] = useState('');
  const [isEditingCustomerPickerOpen, setIsEditingCustomerPickerOpen] = useState(false);
  const [showAllEditingCustomers, setShowAllEditingCustomers] = useState(false);
  const [editingItems, setEditingItems] = useState<CartItem[]>([]);
  const [editingCashPaid, setEditingCashPaid] = useState('');
  const [editingOnlinePaid, setEditingOnlinePaid] = useState('');
  const [editingCreditDue, setEditingCreditDue] = useState('');
  const [editingReturnMode, setEditingReturnMode] = useState<'reduce_due' | 'refund_cash' | 'refund_online' | 'store_credit'>('refund_cash');
  const [isProductPickerOpen, setIsProductPickerOpen] = useState(false);
  const [productPickerSearch, setProductPickerSearch] = useState('');
  const [productPickerQuantities, setProductPickerQuantities] = useState<Record<string, number>>({});
  const [recentlyAddedProductId, setRecentlyAddedProductId] = useState<string | null>(null);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [editingSectionWarning, setEditingSectionWarning] = useState<{ section: 'lines' | 'settlement' | 'customer' | 'general'; message: string } | null>(null);
  const [isSavingTransaction, setIsSavingTransaction] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showBin, setShowBin] = useState(false);
  const [selectedDeletedTx, setSelectedDeletedTx] = useState<DeletedTransactionRecord | null>(null);
  const [deleteTargetTx, setDeleteTargetTx] = useState<Transaction | null>(null);
  const editingCustomerPickerRef = useRef<HTMLDivElement | null>(null);
  useEscapeLayer(Boolean(deleteTargetTx), () => setDeleteTargetTx(null), { priority: 120 });
  useEscapeLayer(Boolean(selectedDeletedTx), () => setSelectedDeletedTx(null), { priority: 110 });
  useEscapeLayer(Boolean(selectedTx), () => setSelectedTx(null), { priority: 110 });
  useEscapeLayer(Boolean(editingTx), () => setEditingTx(null), { priority: 110 });
  useEscapeLayer(isInvoiceOptionsOpen, () => { setIsInvoiceOptionsOpen(false); setTxToExport(null); }, { priority: 110 });
  useEscapeLayer(isEditingCustomerPickerOpen, () => setIsEditingCustomerPickerOpen(false), { priority: 115 });
  useEscapeLayer(isProductPickerOpen && editingTx?.type === 'sale', () => setIsProductPickerOpen(false), { priority: 115 });
  const [deleteReason, setDeleteReason] = useState<'customer_cancelled' | 'created_by_mistake' | 'other'>('customer_cancelled');
  const [deleteReasonOther, setDeleteReasonOther] = useState('');
  const [deletedPage, setDeletedPage] = useState(1);
  const [waSendingStage, setWaSendingStage] = useState<string | null>(null);
  const [deletedWindowCursor, setDeletedWindowCursor] = useState<TransactionPageCursor>(null);
  const [hasMoreDeletedWindow, setHasMoreDeletedWindow] = useState(false);
  const [isDeletedWindowed, setIsDeletedWindowed] = useState(true);
  const virtualSupplierPaymentTransactions = useMemo<Transaction[]>(() => (supplierPayments || [])
    .filter((payment) => !payment.deletedAt)
    .map((payment) => {
      const methodRaw = String(payment.method || '').trim().toLowerCase();
      const method = methodRaw === 'online' || methodRaw === 'bank' ? 'Online' : 'Cash';
      const selectedDate = payment.paidAt || (payment as any).paymentDate || (payment as any).date || payment.createdAt || '';
      const date = Number.isFinite(new Date(selectedDate).getTime()) ? new Date(selectedDate).toISOString() : (payment.createdAt || new Date().toISOString());
      const amount = Math.max(0, Number(payment.amount || 0));
      const payableReduced = Math.max(0, Number((payment as any).paymentAppliedToPayable ?? payment.payableApplied ?? 0));
      const partyCreditAdded = Math.max(0, Number(payment.partyCreditCreated || 0));
      return {
        id: `supplier-payment-${payment.id}`,
        type: 'payment',
        date,
        total: amount,
        items: [],
        customerId: payment.partyId || '',
        customerName: payment.partyName || 'Supplier',
        paymentMethod: method,
        receiptNo: payment.voucherNo || undefined,
        notes: `Supplier Payment - ${payment.partyName || 'Supplier'} - ${method.toLowerCase()}${payableReduced > 0 ? ` | Payable reduced ${formatMoneyWhole(payableReduced)}` : ''}${partyCreditAdded > 0 ? ` | Party credit added ${formatMoneyWhole(partyCreditAdded)}` : ''}${payment.note ? ` | Note: ${payment.note}` : ''}`,
        sourceTransactionDate: selectedDate || undefined,
      } as Transaction;
    }), [supplierPayments]);
  const virtualExpenseTransactions = useMemo<Transaction[]>(() => (expenses || []).map((expense) => {
    const effectiveDate = expense.effectiveAt || expense.createdAt || new Date().toISOString();
    return {
      id: `expense-${expense.id}`,
      type: 'expense' as any,
      date: effectiveDate,
      total: Math.max(0, Number(expense.amount || 0)),
      items: [],
      customerId: '',
      customerName: expense.category || 'Expense',
      paymentMethod: 'Cash',
      receiptNo: expense.id.slice(-6),
      notes: `Expense - ${expense.title}${expense.note ? ` | Note: ${expense.note}` : ''}`,
      sourceTransactionDate: effectiveDate,
    } as Transaction;
  }), [expenses]);
  const virtualCashAdjustmentTransactions = useMemo<Transaction[]>(() => (cashAdjustments || []).map((entry) => {
    const effectiveDate = entry.effectiveAt || entry.createdAt || new Date().toISOString();
    const isWithdrawal = entry.type === 'cash_withdrawal';
    const baseLabel = isWithdrawal ? 'Cash Withdrawal' : 'Cash Addition';
    return {
      id: `cash-adjustment-${entry.id}`,
      type: (isWithdrawal ? 'cash_withdrawal' : 'cash_addition') as any,
      date: effectiveDate,
      total: Math.max(0, Number(entry.amount || 0)),
      items: [],
      customerId: '',
      customerName: isWithdrawal ? (entry.paidTo || 'Cash Drawer') : 'Cash Drawer',
      paymentMethod: entry.method || 'Cash',
      receiptNo: entry.reference || entry.id.slice(-6),
      notes: `${baseLabel}${entry.title ? ` - ${entry.title}` : ''}${entry.note ? ` | Note: ${entry.note}` : ''}${entry.paidTo ? ` | Paid To: ${entry.paidTo}` : ''}${entry.reference ? ` | Ref: ${entry.reference}` : ''}`,
      sourceTransactionDate: effectiveDate,
    } as Transaction;
  }), [cashAdjustments]);
  const virtualUpfrontOrderTransactions = useMemo<Transaction[]>(() => upfrontOrders.flatMap((order) => {
    const customerName = customers.find(c => c.id === order.customerId)?.name || 'Customer';
    const baseItem: CartItem = {
      id: `upfront-item-${order.id}`,
      barcode: '',
      name: order.productName || 'Unknown Product',
      description: order.notes || '',
      buyPrice: 0,
      sellPrice: Math.max(0, Number(order.customerPricePerPiece ?? order.pricePerPieceCustomer ?? order.cartonPriceCustomer ?? (order.customerPrice || 0))),
      stock: 0,
      image: '',
      category: 'Custom Order',
      quantity: Math.max(0, Number(order.totalPieces ?? (order.quantity || 0))),
      selectedVariant: order.isCarton ? 'Carton' : 'Unit',
      selectedColor: '',
    };
    const history = Array.isArray(order.paymentHistory) ? order.paymentHistory : [];
    if (!history.length) {
      const orderDate = order.date || order.createdAt || new Date().toISOString();
      const total = Math.max(0, Number(order.totalCost || 0));
      const advancePaid = Math.max(0, Number(order.advancePaid || 0));
      const remaining = Math.max(0, Number(order.remainingAmount || 0));
      const isCompleted = remaining <= 0.0001 || String(order.status || '').toLowerCase() === 'cleared';
      return [{
        id: `upfront-${order.id}`,
        type: 'historical_reference',
        date: orderDate,
        total,
        items: [baseItem],
        customerId: order.customerId,
        customerName,
        paymentMethod: 'Credit',
        notes: isCompleted
          ? `Legacy paid order | Product: ${order.productName || 'Unknown Product'} | Total: ${formatMoneyWhole(total)} | Paid: ${formatMoneyWhole(advancePaid)} | Remaining: ${formatMoneyWhole(remaining)} | Legacy order payment split not available. | Ref: ${order.id}`
          : `Advance Customer Order | Product: ${order.productName || 'Unknown Product'} | Total: ${formatMoneyWhole(total)} | Advance Paid: ${formatMoneyWhole(advancePaid)} | Remaining: ${formatMoneyWhole(remaining)} | Ref: ${order.id}`,
        source: 'historical_import',
        isHistorical: true,
        legacyRef: order.id,
      }];
    }
    const initial = history.filter((p) => p.kind === 'initial_advance');
    const additional = history.filter((p) => p.kind !== 'initial_advance');
    const groupedInitial: Transaction[] = initial.length ? [{
      id: `upfront-${order.id}-initial-grouped`,
      type: 'historical_reference',
      date: initial.map((p) => p.paidAt).filter(Boolean).sort()[0] || order.date || order.createdAt || new Date().toISOString(),
      total: Math.max(0, Number(order.totalCost || 0)),
      items: [baseItem],
      customerId: order.customerId,
      customerName,
      paymentMethod: initial.some((p) => String(p.method || '').toLowerCase().includes('cash')) && initial.some((p) => String(p.method || '').toLowerCase().includes('online')) ? 'Online' : (initial[0]?.method as any) || 'Advance',
      notes: `Advance Customer Order | Product: ${order.productName || 'Unknown Product'} | Total: ${formatMoneyWhole(order.totalCost || 0)} | Cash: ${formatMoneyWhole(initial.filter((p) => String(p.method || '').toLowerCase().includes('cash')).reduce((s, p) => s + Number(p.amount || 0), 0))} | Online: ${formatMoneyWhole(initial.filter((p) => String(p.method || '').toLowerCase().includes('online')).reduce((s, p) => s + Number(p.amount || 0), 0))} | Advance: ${formatMoneyWhole(initial.reduce((s, p) => s + Number(p.amount || 0), 0))} | Remaining: ${formatMoneyWhole(Math.max(0, Number(order.remainingAmount || 0)))} | Ref: ${order.id}`,
      source: 'historical_import',
      isHistorical: true,
      legacyRef: order.id,
    }] : [];
    const additionalRows = additional.map((payment, idx) => ({
      id: `upfront-${order.id}-${payment.id || idx}`,
      type: 'payment' as const,
      date: payment.paidAt || order.date || order.createdAt || new Date().toISOString(),
      total: Math.max(0, Number(payment.amount || 0)),
      items: [baseItem],
      customerId: order.customerId,
      customerName,
      paymentMethod: (payment.method as any) || 'Advance',
      notes: `Custom Order Payment | Product: ${order.productName || 'Unknown Product'} | Order Ref: ${order.id} | Paid: ${formatMoneyWhole(payment.amount || 0)} | Remaining: ${formatMoneyWhole(payment.remainingAfterPayment || 0)}${payment.note ? ` | Note: ${payment.note}` : ''}`,
      source: 'historical_import',
      isHistorical: true,
      legacyRef: order.id,
    }));
    return [...groupedInitial, ...additionalRows];
  }), [upfrontOrders, customers]);
  const renderedTransactions = useMemo(
    () => [
      ...transactions,
      ...virtualExpenseTransactions,
      ...virtualCashAdjustmentTransactions,
      ...virtualUpfrontOrderTransactions,
      ...virtualSupplierPaymentTransactions,
    ],
    [transactions, virtualExpenseTransactions, virtualCashAdjustmentTransactions, virtualUpfrontOrderTransactions, virtualSupplierPaymentTransactions]
  );

  const formatRoleLabel = (role?: string) => {
    const source = (role || 'Admin').trim();
    if (!source) return 'Admin';
    return source.charAt(0).toUpperCase() + source.slice(1);
  };

  const looksLikeUid = (value?: string) => {
    if (!value) return false;
    return /^[A-Za-z0-9]{20,}$/.test(value);
  };

  const formatDeletedByName = (record: DeletedTransactionRecord) => {
    const actor = (record.deletedBy || '').trim();
    if (!actor || looksLikeUid(actor)) return 'Unknown User';
    if (actor.includes('@')) return actor.split('@')[0];
    return actor;
  };

  useEffect(() => {
    const refreshData = () => {
      try {
        const deletedWindow = loadDeletedTransactionsPage({ limit: DELETED_WINDOW_BATCH_SIZE });
        const data = loadData();
        setTransactions(data.transactions || []);
        setExpenses((data as any).expenses || []);
        setCashAdjustments((data as any).cashAdjustments || []);
        setDeletedTransactions(deletedWindow.rows);
        setCustomers(data.customers);
        setProducts(data.products || []);
        setPurchaseOrders(data.purchaseOrders || []);
        setUpfrontOrders(data.upfrontOrders || []);
        setSupplierPayments((data as any).supplierPayments || []);
        setDeletedWindowCursor(deletedWindow.nextCursor);
        setHasMoreDeletedWindow(deletedWindow.hasMore);
        setIsDeletedWindowed(deletedWindow.hasMore);
        setLoadError(null);
      } catch (error) {
        setLoadError('Unable to load transactions right now. Please try again.');
      } finally {
        setIsInitialLoading(false);
      }
    };

    refreshData();
    void refreshDeletedTransactionsBin();
    window.addEventListener('storage', refreshData);
    window.addEventListener('local-storage-update', refreshData);
    return () => {
        window.removeEventListener('storage', refreshData);
        window.removeEventListener('local-storage-update', refreshData);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLORED_ROWS_STORAGE_KEY, useColoredTransactionRows ? 'true' : 'false');
  }, [COLORED_ROWS_STORAGE_KEY, useColoredTransactionRows]);

  const refreshDeletedTransactionsBin = async () => {
    try {
      await refreshDeletedTransactionsFromCloud();
      const deletedWindow = loadDeletedTransactionsPage({ limit: DELETED_WINDOW_BATCH_SIZE });
      setDeletedTransactions(deletedWindow.rows);
      setDeletedWindowCursor(deletedWindow.nextCursor);
      setHasMoreDeletedWindow(deletedWindow.hasMore);
      setIsDeletedWindowed(deletedWindow.hasMore);
      setLoadError(null);
    } catch (error) {
      setLoadError('Unable to refresh deleted transactions right now. Please try again.');
    }
  };


  const loadOlderDeletedWindow = () => {
    if (!deletedWindowCursor || !hasMoreDeletedWindow) return;
    const next = loadDeletedTransactionsPage({ limit: DELETED_WINDOW_BATCH_SIZE, cursor: deletedWindowCursor });
    setDeletedTransactions((prev) => {
      const existing = new Set(prev.map((row) => row.id));
      const merged = [...prev];
      next.rows.forEach((row) => {
        if (!existing.has(row.id)) merged.push(row);
      });
      return merged;
    });
    setDeletedWindowCursor(next.nextCursor);
    setHasMoreDeletedWindow(next.hasMore);
    if (!next.hasMore) setIsDeletedWindowed(false);
  };

  const dateFilteredTransactions = useMemo(() => {
      const now = new Date();
      now.setHours(0,0,0,0); // Start of today
      const toDayStart = (tx: Transaction) => {
        if (isSupplierPaymentVirtualTransaction(tx) && tx.sourceTransactionDate) {
          const rawDay = String(tx.sourceTransactionDate).slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(rawDay)) {
            const local = new Date(`${rawDay}T00:00:00`);
            local.setHours(0, 0, 0, 0);
            return local;
          }
        }
        const d = new Date(tx.date);
        d.setHours(0, 0, 0, 0);
        return d;
      };

      return renderedTransactions.filter(tx => {
          const txDate = toDayStart(tx);
          
          switch(filterType) {
              case 'today':
                  return txDate.getTime() === now.getTime();
              case 'yesterday':
                  const yest = new Date(now);
                  yest.setDate(yest.getDate() - 1);
                  return txDate.getTime() === yest.getTime();
              case '7days':
                  const week = new Date(now);
                  week.setDate(week.getDate() - 7);
                  return txDate >= week;
              case '15days':
                  const days15 = new Date(now);
                  days15.setDate(days15.getDate() - 15);
                  return txDate >= days15;
              case '30days':
                  const days30 = new Date(now);
                  days30.setDate(days30.getDate() - 30);
                  return txDate >= days30;
              case 'thismonth': {
                  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                  monthStart.setHours(0, 0, 0, 0);
                  return txDate >= monthStart;
              }
              case '6months':
                  const months6 = new Date(now);
                  months6.setMonth(months6.getMonth() - 6);
                  return txDate >= months6;
              case '1year':
                  const year1 = new Date(now);
                  year1.setFullYear(year1.getFullYear() - 1);
                  return txDate >= year1;
              case 'all':
                  return true;
              case 'custom':
                  if (!customStart) return true;
                  const start = new Date(customStart);
                  start.setHours(0,0,0,0);
                  if (txDate < start) return false;
                  
                  if (customEnd) {
                      const end = new Date(customEnd);
                      end.setHours(23,59,59,999);
                      if (txDate > end) return false;
                  }
                  return true;
              default:
                  return true;
          }
      }).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [renderedTransactions, filterType, customStart, customEnd]);

  useEffect(() => {
    if (!(import.meta as any).env?.DEV) return;
    const sampleRows = (supplierPayments || []).slice(0, 5).map((payment) => {
      const selectedDate = payment.paidAt || (payment as any).paymentDate || (payment as any).date || payment.createdAt || null;
      const normalizedDate = selectedDate && Number.isFinite(new Date(selectedDate).getTime()) ? new Date(selectedDate).toISOString() : null;
      const includedBeforeDateFilter = !payment.deletedAt && !!normalizedDate;
      const includedAfterDateFilter = dateFilteredTransactions.some((tx) => tx.id === `supplier-payment-${payment.id}`);
      return {
        id: payment.id,
        voucherNo: payment.voucherNo,
        partyName: payment.partyName,
        amount: payment.amount,
        method: payment.method,
        rawDates: { paidAt: payment.paidAt, paymentDate: (payment as any).paymentDate, date: (payment as any).date, createdAt: payment.createdAt },
        selectedDate,
        normalizedDate,
        includedBeforeDateFilter,
        includedAfterDateFilter,
        excludedReason: payment.deletedAt ? 'deleted' : (!normalizedDate ? 'invalid_date' : (includedAfterDateFilter ? null : 'filtered_by_date')),
      };
    });
  }, [supplierPayments, renderedTransactions, dateFilteredTransactions, filterType]);

  const customerPhoneById = useMemo(
    () => new Map(customers.map(customer => [customer.id, customer.phone || ''])),
    [customers]
  );
  const productsById = useMemo(
    () => new Map<string, Product>(products.map(product => [product.id, product])),
    [products]
  );

  const filteredTransactions = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return dateFilteredTransactions;

    return dateFilteredTransactions.filter((tx) => {
      const customerPhone = tx.customerId ? (customerPhoneById.get(tx.customerId) || '') : '';
      const baseHaystack = [
        tx.id,
        tx.customerName || '',
        customerPhone,
        tx.customerId || '',
        tx.receiptNo || '',
        tx.paymentMethod || '',
      ].join(' ').toLowerCase();
      if (baseHaystack.includes(query)) return true;
      if ((tx.notes || '').toLowerCase().includes(query)) return true;

      return normalizeTransactionItems(tx.items).some((item) => {
        const product = productsById.get(item.id);
        const itemHaystack = [
          item.id,
          product?.id || '',
          item.name || '',
          product?.name || '',
          product?.barcode || '',
        ].join(' ').toLowerCase();
        return itemHaystack.includes(query);
      });
    });
  }, [dateFilteredTransactions, searchTerm, customerPhoneById, productsById]);

  const matchesCurrentDateFilter = (rawDate?: string) => {
    const parsed = rawDate ? new Date(rawDate) : null;
    if (!parsed || !Number.isFinite(parsed.getTime())) return false;
    parsed.setHours(0, 0, 0, 0);

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    switch (filterType) {
      case 'today':
        return parsed.getTime() === now.getTime();
      case 'yesterday': {
        const yest = new Date(now);
        yest.setDate(yest.getDate() - 1);
        return parsed.getTime() === yest.getTime();
      }
      case '7days': {
        const week = new Date(now);
        week.setDate(week.getDate() - 7);
        return parsed >= week;
      }
      case '15days': {
        const days15 = new Date(now);
        days15.setDate(days15.getDate() - 15);
        return parsed >= days15;
      }
      case '30days': {
        const days30 = new Date(now);
        days30.setDate(days30.getDate() - 30);
        return parsed >= days30;
      }
      case 'thismonth': {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthStart.setHours(0, 0, 0, 0);
        return parsed >= monthStart;
      }
      case '6months': {
        const months6 = new Date(now);
        months6.setMonth(months6.getMonth() - 6);
        return parsed >= months6;
      }
      case '1year': {
        const year1 = new Date(now);
        year1.setFullYear(year1.getFullYear() - 1);
        return parsed >= year1;
      }
      case 'all':
        return true;
      case 'custom': {
        if (!customStart) return true;
        const start = new Date(customStart);
        start.setHours(0, 0, 0, 0);
        if (parsed < start) return false;
        if (customEnd) {
          const end = new Date(customEnd);
          end.setHours(23, 59, 59, 999);
          if (parsed > end) return false;
        }
        return true;
      }
      default:
        return true;
    }
  };

  const filteredPurchaseOrders = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return (purchaseOrders || []).filter((order) => {
      if (!order || order.status === 'cancelled') return false;
      if (!matchesCurrentDateFilter(order.effectiveAt || order.orderDate || order.createdAt)) return false;
      if (!query) return true;

      const haystack = [
        order.id,
        order.partyName || '',
        order.partyId || '',
        order.billNumber || '',
        order.notes || '',
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [purchaseOrders, searchTerm, filterType, customStart, customEnd]);

  const filteredCashSupplierPayments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return (supplierPayments || []).filter((payment) => {
      if (!payment || payment.deletedAt) return false;
      if (String(payment.method || '').trim().toLowerCase() !== 'cash') return false;
      if (!matchesCurrentDateFilter(payment.effectiveAt || payment.paidAt || payment.createdAt)) return false;
      if (!query) return true;

      const haystack = [
        payment.id,
        payment.partyName || '',
        payment.partyId || '',
        payment.voucherNo || '',
        payment.note || '',
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [supplierPayments, searchTerm, filterType, customStart, customEnd]);

  const getDisplayPaymentMethod = (tx: Transaction) => {
    if (isExpenseVirtualTransaction(tx)) return 'Cash';
    if (isCashAdjustmentVirtualTransaction(tx)) return tx.paymentMethod || 'Cash';
    if (tx.id.startsWith('upfront-')) return 'Advance';
    const txType = String((tx as Transaction & { type?: string }).type || '').toLowerCase();
    if (txType !== 'sale' && txType !== 'historical_reference') return tx.paymentMethod || 'Cash';
    const settlement = getSaleSettlementBreakdown(tx);
    if (settlement.creditDue > 0) return 'Credit';
    if (settlement.cashPaid > 0 && settlement.onlinePaid > 0) return 'Split';
    if (settlement.onlinePaid > 0) return 'Online';
    return 'Cash';
  };
  const selectedTransactions = useMemo(
    () => renderedTransactions.filter(tx => selectedTransactionIds.includes(tx.id)),
    [renderedTransactions, selectedTransactionIds]
  );
  const paginatedTransactions = useMemo(() => {
    return filteredTransactions;
  }, [filteredTransactions]);
  const getTransactionTypeUi = (tx: Transaction) => {
    const txType = String((tx as Transaction & { type?: string }).type || '').toLowerCase();
    const isSale = txType === 'sale' || txType === 'historical_reference';
    const isReturn = tx.type === 'return';
    const isPayment = tx.type === 'payment';
    if (isExpenseVirtualTransaction(tx)) {
      return { typeLabel: 'EXPENSE', typeTone: 'expense', isSale, isReturn, isPayment } as const;
    }
    if (isCashWithdrawalVirtualTransaction(tx)) {
      return { typeLabel: 'CASH WITHDRAWAL', typeTone: 'cash out', isSale, isReturn, isPayment } as const;
    }
    if (isCashAdditionVirtualTransaction(tx)) {
      return { typeLabel: 'CASH ADDITION', typeTone: 'cash', isSale, isReturn, isPayment } as const;
    }
    if (tx.id.startsWith('upfront-')) {
      return {
        typeLabel: String(tx.notes || '').toLowerCase().includes('order payment')
          ? 'ORDER PAYMENT'
          : String(tx.notes || '').toLowerCase().includes('legacy paid order')
            ? 'LEGACY PAID ORDER'
            : 'ADVANCE ORDER',
        typeTone: 'payment against due',
        isSale,
        isReturn,
        isPayment,
      } as const;
    }
    if (tx.id.startsWith('supplier-payment-')) {
      return { typeLabel: 'SUPPLIER PAYMENT', typeTone: 'cash', isSale, isReturn, isPayment } as const;
    }
    if (tx.type === 'customer_credit') {
      return { typeLabel: 'CREDIT CREATED', typeTone: 'credit due', isSale, isReturn, isPayment } as const;
    }
    if (tx.type === 'customer_cash_out') {
      return { typeLabel: 'CASH GIVEN', typeTone: 'return', isSale, isReturn, isPayment } as const;
    }
    return {
      typeLabel: isSale ? (txType === 'historical_reference' ? 'HIST' : 'SALE') : isReturn ? 'RETURN' : 'PAYMENT',
      typeTone: isReturn ? 'return' : isPayment ? 'payment against due' : (getDisplayPaymentMethod(tx) === 'Credit' ? 'credit due' : getDisplayPaymentMethod(tx)),
      isSale,
      isReturn,
      isPayment,
    } as const;
  };
  const isCreditTransaction = (tx: Transaction) => {
    const normalizedType = String((tx as Transaction & { type?: string }).type || '').toLowerCase();
    if (normalizedType !== 'sale' && normalizedType !== 'historical_reference') return false;
    return getSaleSettlementBreakdown(tx).creditDue > 0;
  };
  const getTransactionRowSurfaceClass = (tx: Transaction) => {
    const normalizedType = String((tx as Transaction & { type?: string }).type || '').toLowerCase();
    const notes = String(tx.notes || '').toLowerCase();

    if (isExpenseVirtualTransaction(tx)) return 'bg-red-100/80 hover:bg-red-50/60';
    if (isCashWithdrawalVirtualTransaction(tx)) return 'bg-rose-100/80 hover:bg-rose-50/60';
    if (isCashAdditionVirtualTransaction(tx)) return 'bg-teal-100/80 hover:bg-teal-50/60';
    if (tx.id.startsWith('supplier-payment-')) return 'bg-amber-100/80 hover:bg-amber-50/60';
    if (tx.id.startsWith('upfront-')) {
      if (notes.includes('order payment')) return 'bg-sky-100/80 hover:bg-sky-50/60';
      if (notes.includes('legacy paid order')) return 'bg-cyan-100/80 hover:bg-cyan-50/60';
      return 'bg-indigo-100/80 hover:bg-indigo-50/60';
    }
    if (isCreditTransaction(tx)) return 'bg-amber-100/85 hover:bg-amber-50/65';
    if (normalizedType === 'sale' || normalizedType === 'historical_reference') return 'bg-emerald-100/80 hover:bg-emerald-50/60';
    if (normalizedType === 'return') return 'bg-violet-100/80 hover:bg-violet-50/60';
    if (normalizedType === 'expense') return 'bg-red-100/80 hover:bg-red-50/60';
    if (normalizedType === 'cash_withdrawal') return 'bg-rose-100/80 hover:bg-rose-50/60';
    if (normalizedType === 'cash_addition') return 'bg-teal-100/80 hover:bg-teal-50/60';
    if (normalizedType === 'customer_credit') return 'bg-orange-100/80 hover:bg-orange-50/60';
    if (normalizedType === 'customer_cash_out') return 'bg-rose-100/80 hover:bg-rose-50/60';
    if (normalizedType === 'payment') return 'bg-blue-100/80 hover:bg-blue-50/60';
    return 'bg-slate-100/75 hover:bg-slate-50/55';
  };
  const paginatedTransactionRows = useMemo(() => paginatedTransactions.map((tx) => {
    const txType = String((tx as Transaction & { type?: string }).type || '').toLowerCase();
    const txTypeUi = getTransactionTypeUi(tx);
    const isSale = txTypeUi.isSale;
    const isReturn = txTypeUi.isReturn;
    const isPayment = txTypeUi.isPayment;
    const isCreditSale = isCreditTransaction(tx);
    const itemCount = normalizeTransactionItems(tx.items).reduce((acc, item) => acc + item.quantity, 0);
    const rowToneClass = isCreditSale
      ? 'text-amber-900'
      : isSale
      ? 'text-emerald-800'
      : isReturn
        ? 'text-rose-800'
        : 'text-blue-800';
    const rowMutedToneClass = isCreditSale
      ? 'text-amber-800'
      : isSale
      ? 'text-emerald-700'
      : isReturn
        ? 'text-rose-700'
        : 'text-blue-700';
    const rowSubtleToneClass = isCreditSale
      ? 'text-amber-700'
      : isSale
      ? 'text-emerald-600'
      : isReturn
        ? 'text-rose-600'
        : 'text-blue-600';
    return {
      tx,
      isSale,
      isReturn,
      isPayment,
      itemCount,
      typeLabel: txTypeUi.typeLabel,
      typeTone: txTypeUi.typeTone,
      typeVariant: 'outline',
      amountClass: isCreditSale ? 'text-amber-800' : isSale ? 'text-green-700' : isReturn ? 'text-red-700' : 'text-blue-700',
      rowToneClass,
      rowMutedToneClass,
      rowSubtleToneClass,
      rowSurfaceClass: getTransactionRowSurfaceClass(tx),
    };
  }), [paginatedTransactions]);
  const deletedTotalPages = useMemo(
    () => Math.max(1, Math.ceil(deletedTransactions.length / DELETED_ROWS_PER_PAGE)),
    [deletedTransactions.length]
  );
  const paginatedDeletedTransactions = useMemo(() => {
    const start = (deletedPage - 1) * DELETED_ROWS_PER_PAGE;
    return deletedTransactions.slice(start, start + DELETED_ROWS_PER_PAGE);
  }, [deletedTransactions, deletedPage]);
  const allFilteredTransactionsSelected = filteredTransactions.length > 0 && filteredTransactions.every(tx => selectedTransactionIds.includes(tx.id));
  const isBatchEditing = batchEditTransactionIds.length > 0;
  const remainingBatchTransactions = isBatchEditing ? Math.max(0, batchEditTransactionIds.length - batchEditTransactionIndex - 1) : 0;

  useEffect(() => {
    setDeletedPage(1);
  }, [showBin]);

  useEffect(() => {
    setDeletedPage((prev) => Math.min(prev, deletedTotalPages));
  }, [deletedTotalPages]);
  const toSafeMoney = (value: unknown) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, num);
  };
  const normalizeBucketValue = (value: unknown, fallback: string) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
  };
  const getLineCompositeKey = (item: Pick<CartItem, 'id' | 'selectedVariant' | 'selectedColor' | 'sellPrice'>) => {
    const variant = normalizeBucketValue(item.selectedVariant, NO_VARIANT);
    const color = normalizeBucketValue(item.selectedColor, NO_COLOR);
    return `${item.id}__${variant}__${color}__${toSafeMoney(item.sellPrice)}`;
  };
  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const getDerivedPaymentMethodForSale = (cashPaid: number, onlinePaid: number, creditDue: number): 'Cash' | 'Credit' | 'Online' => {
    if (creditDue > 0) return 'Credit';
    if (onlinePaid > 0 && cashPaid <= 0) return 'Online';
    return 'Cash';
  };
  const getEditedSubtotal = () => roundMoney(editingItems.reduce((sum, item) => sum + (toSafeMoney(item.quantity) * toSafeMoney(item.sellPrice)), 0));
  const getEditedDiscount = () => roundMoney(editingTx?.discount || 0);
  const getEditedTaxRate = () => Number.isFinite(Number(editingTx?.taxRate)) ? Number(editingTx?.taxRate || 0) : 0;
  const getEditedTax = () => roundMoney(Math.max(0, getEditedSubtotal() - getEditedDiscount()) * (getEditedTaxRate() / 100));
  const getEditedTotal = () => {
    if (!editingTx) return 0;
    const unsigned = roundMoney(Math.max(0, getEditedSubtotal() - getEditedDiscount()) + getEditedTax());
    return editingTx.type === 'return' ? -unsigned : unsigned;
  };

  const resetProductPickerState = () => {
    setIsProductPickerOpen(false);
    setProductPickerSearch('');
    setProductPickerQuantities({});
    setRecentlyAddedProductId(null);
  };

  const openTransactionEditor = async (tx: Transaction) => {
    if (!can('transactionEdit')) {
      const approved = await requestAdminOverride('Admin password required to edit transaction history.');
      if (!approved) return;
    }
    const settlement = getSaleSettlementBreakdown(tx);
    setEditingTx(tx);
    setEditingAmount(String(Math.abs(tx.total || 0)));
    setEditingTxDate(tx.date ? toLocalDateTimeInputValue(tx.date) : '');
    setEditingTxPaymentMethod((tx.paymentMethod || 'Cash') as 'Cash' | 'Credit' | 'Online');
    setEditingTxNotes(tx.notes || '');
    setEditingCustomerId(tx.customerId || '');
    setEditingCustomerSearch('');
    setIsEditingCustomerPickerOpen(false);
    setShowAllEditingCustomers(false);
    setEditingItems(normalizeTransactionItems(tx.items).map(item => ({ ...item })));
    setEditingCashPaid(String(settlement.cashPaid || 0));
    setEditingOnlinePaid(String(settlement.onlinePaid || 0));
    setEditingCreditDue(String(settlement.creditDue || 0));
    setEditingReturnMode(tx.returnHandlingMode || 'refund_cash');
    resetProductPickerState();
    setEditingError(null);
    setEditingSectionWarning(null);
  };

  const closeTransactionEditor = () => {
    setEditingTx(null);
    setBatchEditTransactionIds([]);
    setBatchEditTransactionIndex(0);
    setEditingError(null);
    setIsSavingTransaction(false);
    setEditingItems([]);
    setEditingCustomerId('');
    setEditingCustomerSearch('');
    setIsEditingCustomerPickerOpen(false);
    setShowAllEditingCustomers(false);
    setEditingCashPaid('');
    setEditingOnlinePaid('');
    setEditingCreditDue('');
    resetProductPickerState();
    setEditingSectionWarning(null);
  };

  const handleToggleTransactionSelection = (transactionId: string) => {
    setSelectedTransactionIds(prev => prev.includes(transactionId) ? prev.filter(id => id !== transactionId) : [...prev, transactionId]);
  };

  const handleToggleSelectAllTransactions = () => {
    const filteredIds = filteredTransactions.map(tx => tx.id);
    setSelectedTransactionIds(prev => allFilteredTransactionsSelected
      ? prev.filter(id => !filteredIds.includes(id))
      : Array.from(new Set([...prev, ...filteredIds]))
    );
  };

  const handleBatchEditTransactions = () => {
    const queue = filteredTransactions.filter(tx => selectedTransactionIds.includes(tx.id)).map(tx => tx.id);
    if (!queue.length) return;
    setBatchEditTransactionIds(queue);
    setBatchEditTransactionIndex(0);
    const firstTx = transactions.find(tx => tx.id === queue[0]);
    if (firstTx) void openTransactionEditor(firstTx);
  };

  const handleBatchDeleteTransactions = async () => {
    if (!selectedTransactions.length) return;
    if (!can('transactionDelete')) {
      const approved = await requestAdminOverride('Admin password required to delete transaction history.');
      if (!approved) return;
    }
    setIsBatchDeleteConfirmOpen(true);
  };
  const confirmBatchDeleteTransactions = () => {
    let nextTransactions = transactions;
    selectedTransactionIds.forEach(transactionId => {
      nextTransactions = deleteTransaction(transactionId);
    });
    setTransactions(nextTransactions);
    setSelectedTransactionIds([]);
    setIsBatchDeleteConfirmOpen(false);
  };

  const updateEditingItem = (index: number, patch: Partial<CartItem>) => {
    setEditingItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item));
  };

  const removeEditingItem = (index: number) => {
    if (!editingTx) return;
    const nextCount = editingItems.filter((_, i) => i !== index).length;
    if (nextCount === 0 && (editingTx.type === 'sale' || editingTx.type === 'return')) {
      closeTransactionEditor();
      void openDeleteModal(editingTx);
      return;
    }
    setEditingItems(prev => prev.filter((_, i) => i !== index));
  };

  const getProductPickerImage = (product: Product) => {
    const firstGalleryImage = Array.isArray((product as any).galleryImages) ? (product as any).galleryImages[0] : '';
    const firstImageObj = Array.isArray((product as any).images) ? (product as any).images[0] : null;
    const firstImageObjSrc = typeof firstImageObj === 'string'
      ? firstImageObj
      : (firstImageObj?.src || firstImageObj?.url || '');
    return (product as any).thumbnailImage || product.image || (product as any).imageSrc || firstGalleryImage || firstImageObjSrc || '';
  };

  const filteredProductsForPicker = useMemo(() => {
    const term = safeLower(productPickerSearch.trim());
    if (!term) return products;
    return products.filter((product) => {
      const haystack = safeLower(getProductSearchText(product));
      return haystack.includes(term);
    });
  }, [productPickerSearch, products]);

  const updateProductPickerQty = (productId: string, value: number) => {
    const safeQty = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
    setProductPickerQuantities(prev => ({ ...prev, [productId]: safeQty }));
  };

  const addProductFromPicker = (product: Product) => {
    if (!editingTx || editingTx.type !== 'sale') return;
    const requestedQty = Math.max(1, Math.floor(productPickerQuantities[product.id] || 1));
    setEditingItems((prev) => {
      const existingIndex = prev.findIndex((line) =>
        line.id === product.id
        && (line.selectedVariant || NO_VARIANT) === (product.variants?.[0] || NO_VARIANT)
        && (line.selectedColor || NO_COLOR) === (product.colors?.[0] || NO_COLOR)
      );
      if (existingIndex >= 0) {
        return prev.map((line, index) => index === existingIndex
          ? { ...line, quantity: Math.max(1, Number(line.quantity || 0) + requestedQty) }
          : line
        );
      }
      const line: CartItem = {
        ...product,
        quantity: requestedQty,
        sellPrice: product.sellPrice || 0,
        buyPrice: product.buyPrice || 0,
        selectedVariant: product.variants?.[0] || NO_VARIANT,
        selectedColor: product.colors?.[0] || NO_COLOR,
      };
      return [...prev, line];
    });
    setRecentlyAddedProductId(product.id);
    setTimeout(() => setRecentlyAddedProductId((current) => (current === product.id ? null : current)), 1500);
  };

  const deletePreview = useMemo(
    () => deleteTargetTx ? getDeleteTransactionPreview(deleteTargetTx.id) : null,
    [deleteTargetTx]
  );

  const openDeleteModal = async (tx: Transaction) => {
    if (!can('transactionDelete')) {
      const approved = await requestAdminOverride('Admin password required to delete transaction history.');
      if (!approved) return;
    }
    setDeleteTargetTx(tx);
    setDeleteReason('customer_cancelled');
    setDeleteReasonOther('');
  };

  const handleConfirmDelete = (compensationMode: 'cash_refund' | 'store_credit' = 'cash_refund') => {
    if (!deleteTargetTx) return;
    if (!deletePreview) return;
    const resolvedReason = deleteReason === 'customer_cancelled'
      ? 'Customer cancelled'
      : deleteReason === 'created_by_mistake'
        ? 'Created by mistake'
        : 'Other';
    const reasonNote = deleteReason === 'other' ? deleteReasonOther.trim() : '';
    if (deleteReason === 'other' && !reasonNote) return;
    const payableAmount = Math.max(0, Number(deletePreview.derivedCompensation.payableAfterDueAbsorption || 0));
    const next = deleteTransaction(deleteTargetTx.id, {
      reason: resolvedReason,
      reasonNote,
      compensationMode,
      compensationAmount: payableAmount,
      createCashCompensation: compensationMode === 'cash_refund',
    });
    setTransactions(next);
    setSelectedTransactionIds(prev => prev.filter(id => id !== deleteTargetTx.id));
    setDeleteTargetTx(null);
  };

  const handleSaveTransaction = async (goToNext = false) => {
    if (!editingTx || isSavingTransaction) return;

    try {
      setIsSavingTransaction(true);
      setEditingSectionWarning(null);
      const nextDate = editingTxDate ? new Date(editingTxDate).toISOString() : editingTx.date;
      const nextNotes = editingTxNotes.trim();
      const selectedCustomer = customers.find(c => c.id === editingCustomerId);
      const customerId = selectedCustomer?.id;
      const customerName = selectedCustomer?.name;
      let nextTransaction: Transaction = { ...editingTx, date: nextDate, notes: nextNotes, customerId, customerName };
      nextTransaction = { ...nextTransaction, effectiveAt: nextDate };

      if (editingTx.type === 'sale') {
        if (!editingItems.length) {
          setEditingError('Sale must include at least one line item.');
          return;
        }
        if (editingSaleLinkageInfo?.hasLinkedReturns) {
          const editedQtyByKey = new Map<string, number>();
          editingItems.forEach(item => {
            const key = getLineCompositeKey(item);
            editedQtyByKey.set(key, (editedQtyByKey.get(key) || 0) + Math.max(0, Number(item.quantity) || 0));
          });
          for (const [sourceLineKey, returnedQty] of editingSaleLinkageInfo.returnedQtyByKey.entries()) {
            const editedQty = editedQtyByKey.get(sourceLineKey) || 0;
            if (editedQty <= 0) {
              setEditingError('Cannot remove a line that already has linked returns.');
              setEditingSectionWarning({ section: 'lines', message: 'This sale line already has linked returns, so line removal is blocked for audit safety.' });
              return;
            }
            if ((editedQty + 0.0001) < returnedQty) {
              setEditingError('This sale line already has linked returns, so quantity cannot go below returned quantity.');
              setEditingSectionWarning({ section: 'lines', message: 'Returned quantity already exists for this line. Keep edited qty at or above returned qty.' });
              return;
            }
          }
          const originalByReturnLinkedKey = new Map<string, CartItem>();
          normalizeTransactionItems(editingTx.items).forEach(item => {
            const key = getLineCompositeKey(item);
            if (editingSaleLinkageInfo.returnedQtyByKey.has(key) && !originalByReturnLinkedKey.has(key)) {
              originalByReturnLinkedKey.set(key, item);
            }
          });
          for (const [sourceLineKey, originalItem] of originalByReturnLinkedKey.entries()) {
            const editedCandidate = editingItems.find(item => (
              item.id === originalItem.id
              && normalizeBucketValue(item.selectedVariant, NO_VARIANT) === normalizeBucketValue(originalItem.selectedVariant, NO_VARIANT)
              && normalizeBucketValue(item.selectedColor, NO_COLOR) === normalizeBucketValue(originalItem.selectedColor, NO_COLOR)
            ));
            if (!editedCandidate) continue;
            if (Math.abs(toSafeMoney(editedCandidate.sellPrice) - toSafeMoney(originalItem.sellPrice)) > 0.0001 || getLineCompositeKey(editedCandidate) !== sourceLineKey) {
              setEditingError('This line already has linked return history, so price cannot be changed without breaking source-linked audit truth.');
              setEditingSectionWarning({ section: 'lines', message: 'Return-linked sale lines are price-locked for audit safety.' });
              return;
            }
          }
        }
        const cashPaid = roundMoney(toSafeMoney(editingCashPaid));
        const onlinePaid = roundMoney(toSafeMoney(editingOnlinePaid));
        const creditDue = roundMoney(toSafeMoney(editingCreditDue));
        const total = Math.abs(getEditedTotal());
        if (Math.abs((cashPaid + onlinePaid + creditDue) - total) > 0.01) {
          setEditingError('Cash + Online + Credit Due must match edited sale total.');
          setEditingSectionWarning({ section: 'settlement', message: 'Settlement split is incomplete. Cash + Online + Credit Due must equal edited total.' });
          return;
        }
        if (creditDue > 0 && !customerId) {
          setEditingError('Customer is required when credit due is present.');
          setEditingSectionWarning({ section: 'customer', message: 'Credit due requires a customer ledger. Select a customer or reduce credit due to zero.' });
          return;
        }
        nextTransaction = {
          ...nextTransaction,
          items: editingItems.map(item => ({ ...item, quantity: Math.max(1, Number(item.quantity) || 1), sellPrice: toSafeMoney(item.sellPrice) })),
          subtotal: getEditedSubtotal(),
          discount: getEditedDiscount(),
          taxRate: getEditedTaxRate(),
          tax: getEditedTax(),
          total,
          saleSettlement: { cashPaid, onlinePaid, creditDue },
          paymentMethod: getDerivedPaymentMethodForSale(cashPaid, onlinePaid, creditDue),
        };
      } else if (editingTx.type === 'return') {
        if (!editingItems.length) {
          setEditingError('Return must include at least one line item.');
          return;
        }
        const originalBySourceKey = new Map<string, CartItem>();
        normalizeTransactionItems(editingTx.items).forEach(item => {
          if (!item.sourceTransactionId || !item.sourceLineCompositeKey) return;
          originalBySourceKey.set(`${item.sourceTransactionId}::${item.sourceLineCompositeKey}`, item);
        });
        for (const line of editingItems) {
          if (!line.sourceTransactionId || !line.sourceLineCompositeKey) {
            setEditingError('Return line linkage is missing. Please recreate this return from the source bill.');
            setEditingSectionWarning({ section: 'lines', message: 'Return line source linkage is required for audit-safe return edits.' });
            return;
          }
          const sourceKey = `${line.sourceTransactionId}::${line.sourceLineCompositeKey}`;
          if (!originalBySourceKey.has(sourceKey)) {
            setEditingError('Source line linkage must remain unchanged for return edits.');
            setEditingSectionWarning({ section: 'lines', message: 'Return edits cannot remap source-linked lines.' });
            return;
          }
          const sourceSale = transactions.find(tx => tx.id === line.sourceTransactionId && tx.type === 'sale');
          const originalSourceQty = normalizeTransactionItems(sourceSale?.items)
            .filter(item => getLineCompositeKey(item) === line.sourceLineCompositeKey)
            .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
          if (originalSourceQty <= 0) {
            setEditingError('Selected source sale line was not found for this return.');
            setEditingSectionWarning({ section: 'lines', message: 'Source bill line could not be resolved for this return edit.' });
            return;
          }
          const returnedExcludingCurrent = transactions
            .filter(tx => tx.type === 'return' && tx.id !== editingTx.id)
            .reduce((sum, tx) => sum + normalizeTransactionItems(tx.items)
              .filter(item => item.sourceTransactionId === line.sourceTransactionId && item.sourceLineCompositeKey === line.sourceLineCompositeKey)
              .reduce((lineSum, item) => lineSum + (Number(item.quantity) || 0), 0), 0);
          const remainingQty = Math.max(0, originalSourceQty - returnedExcludingCurrent);
          if ((Number(line.quantity) || 0) > (remainingQty + 0.0001)) {
            setEditingError('Return quantity exceeds remaining returnable quantity for the linked bill line.');
            setEditingSectionWarning({ section: 'lines', message: 'Reduce returned qty to available returnable quantity for the linked source line.' });
            return;
          }
        }
        const sanitizedItems = editingItems.map(item => ({ ...item, quantity: Math.max(1, Number(item.quantity) || 1), sellPrice: toSafeMoney(item.sellPrice) }));
        nextTransaction = {
          ...nextTransaction,
          items: sanitizedItems,
          subtotal: getEditedSubtotal(),
          discount: getEditedDiscount(),
          taxRate: getEditedTaxRate(),
          tax: getEditedTax(),
          total: -Math.abs(getEditedTotal()),
          returnHandlingMode: editingReturnMode,
          paymentMethod: editingReturnMode === 'refund_online' ? 'Online' : editingReturnMode === 'refund_cash' ? 'Cash' : 'Credit',
          saleSettlement: undefined,
        };
      } else if (editingTx.type === 'payment') {
        const amt = Number(editingAmount || 0);
        if (!Number.isFinite(amt) || amt <= 0) {
          setEditingError('Please enter a valid payment amount.');
          setEditingSectionWarning({ section: 'general', message: 'Payment amount must be greater than zero.' });
          return;
        }
        nextTransaction = { ...nextTransaction, total: Math.abs(amt), paymentMethod: editingTxPaymentMethod };
      }

      const nextTransactions = await updateTransaction(nextTransaction);
      setTransactions(nextTransactions);

      if (goToNext && batchEditTransactionIds.length > 0) {
        const nextIndex = batchEditTransactionIndex + 1;
        const nextTransactionId = batchEditTransactionIds[nextIndex];
        if (nextTransactionId) {
          const nextTx = nextTransactions.find(tx => tx.id === nextTransactionId);
          if (nextTx) {
            setBatchEditTransactionIndex(nextIndex);
            void openTransactionEditor(nextTx);
            return;
          }
        }
      }

      closeTransactionEditor();
    } catch (error) {
      setEditingError(getFriendlyErrorMessage(error, 'transactions.update'));
      setEditingSectionWarning({ section: 'general', message: 'Save failed during reconcile. Review audit impact and try again.' });
    } finally {
      setIsSavingTransaction(false);
    }
  };

  const editingReturnPreview = useMemo(() => {
    if (!editingTx || editingTx.type !== 'return') return null;
    const selectedCustomer = customers.find(c => c.id === editingCustomerId);
    const draft: Transaction = {
      ...editingTx,
      items: editingItems,
      customerId: selectedCustomer?.id,
      customerName: selectedCustomer?.name,
      subtotal: getEditedSubtotal(),
      discount: getEditedDiscount(),
      taxRate: getEditedTaxRate(),
      tax: getEditedTax(),
      total: -Math.abs(getEditedTotal()),
      returnHandlingMode: editingReturnMode,
      paymentMethod: editingReturnMode === 'refund_online' ? 'Online' : editingReturnMode === 'refund_cash' ? 'Cash' : 'Credit',
    };
    return getCanonicalReturnPreviewForDraft(draft, customers, transactions);
  }, [editingTx, editingItems, editingCustomerId, editingReturnMode, customers, transactions]);
  const editingCustomer = useMemo(
    () => customers.find(c => c.id === editingCustomerId) || null,
    [customers, editingCustomerId]
  );
  const filteredEditingCustomers = useMemo(() => {
    const normalizedSearch = safeLower(editingCustomerSearch.trim());
    const sortedCustomers = [...customers].sort((a, b) => a.name.localeCompare(b.name) || String(a.phone || '').localeCompare(String(b.phone || '')));
    if (!normalizedSearch) return sortedCustomers;
    return sortedCustomers.filter((customer) => safeLower(`${customer.name} ${customer.phone || ''} ${customer.id}`).includes(normalizedSearch));
  }, [customers, editingCustomerSearch]);
  const visibleEditingCustomers = useMemo(
    () => (showAllEditingCustomers ? filteredEditingCustomers : filteredEditingCustomers.slice(0, 6)),
    [filteredEditingCustomers, showAllEditingCustomers]
  );
  const editingCustomerBalance = useMemo(
    () => getCanonicalCustomerBalanceResult(editingCustomer, transactions, upfrontOrders),
    [editingCustomer, transactions, upfrontOrders]
  );
  const editingSaleLinkageInfo = useMemo(() => {
    if (!editingTx || editingTx.type !== 'sale') return null;
    const returnedQtyByKey = new Map<string, number>();
    transactions
      .filter(tx => tx.type === 'return')
      .forEach(tx => {
        normalizeTransactionItems(tx.items).forEach(item => {
          if (item.sourceTransactionId !== editingTx.id || !item.sourceLineCompositeKey) return;
          const next = (returnedQtyByKey.get(item.sourceLineCompositeKey) || 0) + (Number(item.quantity) || 0);
          returnedQtyByKey.set(item.sourceLineCompositeKey, next);
        });
      });
    const linkedPayments = transactions.filter(tx => (
      tx.type === 'payment'
      && !!editingTx.customerId
      && tx.customerId === editingTx.customerId
      && new Date(tx.date).getTime() >= new Date(editingTx.date).getTime()
    ));
    return {
      returnedQtyByKey,
      hasLinkedReturns: returnedQtyByKey.size > 0,
      linkedPaymentsCount: linkedPayments.length,
    };
  }, [editingTx, transactions]);
  const editingDraftTransaction = useMemo(() => {
    if (!editingTx) return null;
    const selectedCustomer = customers.find(c => c.id === editingCustomerId);
    const customerId = selectedCustomer?.id;
    const customerName = selectedCustomer?.name;
    const common = {
      ...editingTx,
      customerId,
      customerName,
      notes: editingTxNotes.trim(),
      date: editingTxDate ? new Date(editingTxDate).toISOString() : editingTx.date,
    };
    if (editingTx.type === 'sale') {
      const cashPaid = roundMoney(toSafeMoney(editingCashPaid));
      const onlinePaid = roundMoney(toSafeMoney(editingOnlinePaid));
      const creditDue = roundMoney(toSafeMoney(editingCreditDue));
      return {
        ...common,
        items: editingItems.map(item => ({ ...item, quantity: Math.max(1, Number(item.quantity) || 1), sellPrice: toSafeMoney(item.sellPrice) })),
        subtotal: getEditedSubtotal(),
        discount: getEditedDiscount(),
        taxRate: getEditedTaxRate(),
        tax: getEditedTax(),
        total: Math.abs(getEditedTotal()),
        saleSettlement: { cashPaid, onlinePaid, creditDue },
        paymentMethod: getDerivedPaymentMethodForSale(cashPaid, onlinePaid, creditDue),
      } as Transaction;
    }
    if (editingTx.type === 'return') {
      return {
        ...common,
        items: editingItems.map(item => ({ ...item, quantity: Math.max(1, Number(item.quantity) || 1), sellPrice: toSafeMoney(item.sellPrice) })),
        subtotal: getEditedSubtotal(),
        discount: getEditedDiscount(),
        taxRate: getEditedTaxRate(),
        tax: getEditedTax(),
        total: -Math.abs(getEditedTotal()),
        returnHandlingMode: editingReturnMode,
        paymentMethod: editingReturnMode === 'refund_online' ? 'Online' : editingReturnMode === 'refund_cash' ? 'Cash' : 'Credit',
        saleSettlement: undefined,
      } as Transaction;
    }
    return {
      ...common,
      total: Math.abs(Number(editingAmount || 0)),
      paymentMethod: editingTxPaymentMethod,
    } as Transaction;
  }, [editingTx, customers, editingCustomerId, editingTxNotes, editingTxDate, editingItems, editingCashPaid, editingOnlinePaid, editingCreditDue, editingReturnMode, editingAmount, editingTxPaymentMethod]);
  const editingAuditPreview = useMemo(() => {
    if (!editingTx || !editingDraftTransaction) return null;
    try {
      return getTransactionUpdateAuditPreview(editingTx, editingDraftTransaction, { transactions, customers, products });
    } catch {
      return null;
    }
  }, [editingTx, editingDraftTransaction, transactions, customers, products]);
  const editRiskBanner = useMemo(() => {
    if (!editingTx) return { tone: 'bg-emerald-50 border-emerald-200 text-emerald-800', title: 'Safe edit', detail: 'No linked-return constraints detected for this edit.' };
    if (editingTx.type === 'sale' && editingSaleLinkageInfo?.hasLinkedReturns) {
      const linkedPaymentDetail = (editingSaleLinkageInfo.linkedPaymentsCount || 0) > 0
        ? ` Also found ${editingSaleLinkageInfo.linkedPaymentsCount} linked payment collection(s); due and store-credit effects will be reconciled on save.`
        : '';
      return {
        tone: 'bg-red-50 border-red-200 text-red-800',
        title: 'High-risk linked-return edit',
        detail: `Some sale-line edits are restricted to preserve source-linked return audit truth.${linkedPaymentDetail}`,
      };
    }
    if (editingTx.type === 'sale' && (editingSaleLinkageInfo?.linkedPaymentsCount || 0) > 0) {
      return {
        tone: 'bg-amber-50 border-amber-200 text-amber-800',
        title: 'Linked payments exist',
        detail: `This sale has ${editingSaleLinkageInfo.linkedPaymentsCount} linked payment collection(s). Reconcile will recalculate due / store-credit effects on save.`,
      };
    }
    return { tone: 'bg-emerald-50 border-emerald-200 text-emerald-800', title: 'Safe edit', detail: 'Edit is allowed with standard reconcile and audit trace.' };
  }, [editingTx, editingSaleLinkageInfo]);

  useEffect(() => {
    if (!isEditingCustomerPickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!editingCustomerPickerRef.current?.contains(event.target as Node)) {
        setIsEditingCustomerPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isEditingCustomerPickerOpen]);


  const diagnostics = useMemo(() => {
    const typeCounts = transactions.reduce<Record<string, number>>((acc, tx) => {
      const txType = String((tx as Transaction & { type?: string }).type || 'unknown').toLowerCase();
      acc[txType] = (acc[txType] || 0) + 1;
      return acc;
    }, {});
    return {
      loadedTransactions: transactions.length,
      filteredTransactions: filteredTransactions.length,
      typeCounts,
      searchTerm,
    };
  }, [transactions, filteredTransactions.length, searchTerm]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const allowDebugDiagnostics = Boolean((import.meta as any)?.env?.DEV) || isAdmin();
    const show = allowDebugDiagnostics && new URLSearchParams(window.location.search).get('debug') === '1';
    if (!show) return;
  }, [diagnostics]);

  const stats = useMemo(() => {
      const productsById = new Map<string, Product>(products.map(product => [product.id, product]));
      const resolveBuyPrice = (item: CartItem, txDate: string) => {
          const direct = Number.isFinite(item.buyPrice) ? Number(item.buyPrice) : 0;
          if (direct > 0) return direct;
          const product = productsById.get(item.id);
          if (!product) return 0;
          const txTime = new Date(txDate).getTime();
          const historical = (product.purchaseHistory || [])
              .filter(entry => Number.isFinite(new Date(entry.date).getTime()) && new Date(entry.date).getTime() <= txTime)
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
          const historicalBuy = historical ? Number(historical.nextBuyPrice ?? historical.unitPrice ?? 0) : 0;
          if (Number.isFinite(historicalBuy) && historicalBuy > 0) return historicalBuy;
          const fallback = Number.isFinite(product.buyPrice) ? Number(product.buyPrice) : 0;
          return fallback > 0 ? fallback : 0;
      };
      let totalRevenue = 0;
      let totalReturns = 0;
      let grossProfit = 0;
      let totalDiscount = 0;

      filteredTransactions.forEach(tx => {
          const amount = Math.abs(tx.total);
          const txType = String((tx as Transaction & { type?: string }).type || '').toLowerCase();
          const isSaleLike = txType === 'sale' || txType === 'historical_reference';
          
          if (isSaleLike) {
              totalRevenue += amount;
              totalDiscount += (tx.discount || 0);
              // Calculate Profit: (Sell - Buy) * Qty
              normalizeTransactionItems(tx.items).forEach(item => {
                  const profit = (item.sellPrice - resolveBuyPrice(item, tx.date)) * item.quantity;
                  grossProfit += profit;
              });
          } else if (tx.type === 'return') {
              totalReturns += amount;
              // Reverse Profit for returns
              normalizeTransactionItems(tx.items).forEach(item => {
                  const profit = (item.sellPrice - resolveBuyPrice(item, tx.date)) * item.quantity;
                  grossProfit -= profit;
              });
          }
      });

       return {
           totalRevenue,
           totalReturns,
           netSales: totalRevenue - totalReturns,
           grossProfit,
           totalDiscount
       };
  }, [filteredTransactions, products]);

  const transactionKpis = useMemo(() => {
      let totalRevenue = 0;
      let totalCash = 0;
      let totalCredit = 0;
      let totalOnline = 0;
      let cashReceivedOnCreditDue = 0;
      let totalCashIn = 0;
      let totalCashOut = 0;

      filteredTransactions.forEach((tx) => {
          const amount = Math.max(0, Math.abs(Number(tx.total || 0)));
          const txType = String((tx as Transaction & { type?: string }).type || '').toLowerCase();
          const paymentMethod = String(tx.paymentMethod || '').trim().toLowerCase();
          const isSupplierPayment = isSupplierPaymentVirtualTransaction(tx);

          if (isExpenseVirtualTransaction(tx)) {
              totalCashOut += amount;
              return;
          }

          if (isCashWithdrawalVirtualTransaction(tx)) {
              if (paymentMethod === 'cash') totalCashOut += amount;
              return;
          }

          if (isCashAdditionVirtualTransaction(tx)) {
              if (paymentMethod === 'cash') totalCashIn += amount;
              return;
          }

          if (txType === 'sale' || txType === 'historical_reference') {
              const settlement = getSaleSettlementBreakdown(tx);
              const cashPaid = Math.max(0, Number(settlement.cashPaid || 0));
              const creditDue = Math.max(0, Number(settlement.creditDue || 0));
              const onlinePaid = Math.max(0, Number(settlement.onlinePaid || 0));

              totalRevenue += amount;
              totalCash += cashPaid;
              totalCredit += creditDue;
              totalOnline += onlinePaid;
              totalCashIn += cashPaid;
              return;
          }

          if (txType === 'payment') {
              if (isSupplierPayment) {
                  if (paymentMethod === 'cash') {
                      totalCashOut += amount;
                  }
                  return;
              }

              if (paymentMethod === 'cash') {
                  totalCashIn += amount;
                  cashReceivedOnCreditDue += amount;
              }
              return;
          }

          if (txType === 'return') {
              if (paymentMethod === 'cash') totalCashOut += amount;
              return;
          }

          if (txType === 'customer_cash_out' && paymentMethod === 'cash') {
              totalCashOut += amount;
          }
      });

      const totalPurchaseCash =
          filteredPurchaseOrders.reduce((sum, order) => (
              sum + (Array.isArray(order.paymentHistory) ? order.paymentHistory.reduce((historySum, payment) => {
                  const method = String(payment?.method || '').trim().toLowerCase();
                  if (method !== 'cash') return historySum;
                  if (payment?.supplierPaymentId) return historySum;
                  return historySum + Math.max(0, Number(payment.amount || 0));
              }, 0) : 0)
          ), 0)
          + filteredCashSupplierPayments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0)), 0);

      const totalPurchaseCredit = filteredPurchaseOrders.reduce(
          (sum, order) => sum + Math.max(0, Number(order.remainingAmount || 0)),
          0,
      );

      return {
          totalRevenue,
          totalCash,
          totalCredit,
          totalOnline,
          totalCombined: totalCash + totalCredit + totalOnline,
          totalPurchaseCash,
          totalPurchaseCredit,
          cashReceivedOnCreditDue,
          totalCashIn,
          totalCashOut,
      };
  }, [filteredTransactions, filteredPurchaseOrders, filteredCashSupplierPayments]);

  const getSaleSettlementText = (tx: Transaction) => {
    if (isExpenseVirtualTransaction(tx)) {
      return String(tx.notes || '').replace(/^Expense - /i, '');
    }
    if (isCashAdjustmentVirtualTransaction(tx)) {
      return String(tx.notes || '');
    }
    if (tx.id.startsWith('upfront-')) {
      const note = String(tx.notes || '');
      const totalMatch = note.match(/Total: ([0-9,]+)/i);
      const advanceMatch = note.match(/Advance Paid: ([0-9,]+)/i);
      const paidMatch = note.match(/Paid: ([0-9,]+)/i);
      const remainingMatch = note.match(/Remaining: ([0-9,]+)/i);
      if (paidMatch) return `Paid ${paidMatch[1]} ? Remaining ${remainingMatch?.[1] || '0'}`;
      return `Total ${totalMatch?.[1] || '0'} ? Advance ${advanceMatch?.[1] || '0'} ? Remaining ${remainingMatch?.[1] || '0'}`;
    }
    const txType = String((tx as Transaction & { type?: string }).type || '').toLowerCase();
    if (txType !== 'sale' && txType !== 'historical_reference') return null;
    const settlement = getSaleSettlementBreakdown(tx);
    const used = Math.max(0, Number(tx.storeCreditUsed || 0));
    return `Cash ${formatINRPrecise(settlement.cashPaid)} | Online ${formatINRPrecise(settlement.onlinePaid)} | Due ${formatINRPrecise(settlement.creditDue)}${used > 0 ? ` | SC ${formatINRPrecise(used)}` : ''}`;
  };

  const handleShareInvoiceOfficialWhatsApp = async (tx: Transaction) => {
    const customerPhone = String(tx.customerPhone || customers.find((customer) => customer.id === tx.customerId)?.phone || '').trim();
    if (!customerPhone) return setWaSendingStage('Failed: Customer phone number is missing.');

    try {
      setWaSendingStage('Preparing invoice data...');
      const { profile } = loadData();
      setWaSendingStage('Sending via Official WhatsApp...');
      const result = await shareTransactionInvoiceViaMetaWhatsApp(
        { ...tx, customerPhone, customerName: tx.customerName || customers.find((customer) => customer.id === tx.customerId)?.name || 'Customer' },
        customers,
        profile,
      );
      const uid = auth?.currentUser?.uid || '';
      await appendWhatsAppLog(uid, {
        type: 'invoice',
        customerId: tx.customerId || '',
        customerName: tx.customerName || customers.find((customer) => customer.id === tx.customerId)?.name || '',
        customerPhone,
        invoiceId: tx.id,
        invoiceNumber: tx.invoiceNo || tx.id,
        pdfUrl: '',
        status: result.ok ? 'sent' : 'failed',
        error: result.ok ? null : result.message,
        sentAt: result.ok ? new Date().toISOString() : null,
        createdBy: uid,
        meta: {
          provider: 'meta-cloud-api',
          transactionId: tx.id,
          whatsappMessageId: result.whatsappMessageId || null,
          whatsappMediaId: result.whatsappMediaId || null,
          backendUrl: result.backendUrl || String(import.meta.env.VITE_META_WHATSAPP_SERVER_URL || '').trim(),
        },
      });
      setWaSendingStage(result.ok ? 'Message accepted by WhatsApp' : `Failed: ${result.message}`);
    } catch (error) {
      setWaSendingStage(`Failed: ${getFriendlyErrorMessage(error, 'transactions.send_invoice_meta')}`);
    } finally {
      setTimeout(() => setWaSendingStage(null), 1500);
    }
  };

  const openInvoiceOptions = (tx: Transaction) => {
    setTxToExport(tx);
    setIsInvoiceOptionsOpen(true);
  };
  const closeInvoiceOptions = () => {
    setIsInvoiceOptionsOpen(false);
    setTxToExport(null);
  };
  const handleInvoiceOption = async (mode: 'a4' | 'thermal' | 'whatsapp') => {
    if (!txToExport) return;
    if (mode === 'a4') {
      await generateReceiptPDF(txToExport, customers, undefined, { invoiceFormatOverride: 'standard' });
      closeInvoiceOptions();
      return;
    }
    if (mode === 'thermal') {
      await generateReceiptPDF(txToExport, customers, undefined, { invoiceFormatOverride: 'thermal' });
      closeInvoiceOptions();
      return;
    }
    closeInvoiceOptions();
    await handleShareInvoiceOfficialWhatsApp(txToExport);
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      {waSendingStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-lg bg-background p-4 shadow-lg min-w-[280px]">
            <p className="text-sm font-medium mb-2">{waSendingStage}</p>
            <div className="h-2 w-full rounded bg-muted overflow-hidden"><div className="h-full w-2/3 animate-pulse bg-primary" /></div>
          </div>
        </div>
      )}
      {isInitialLoading && <LightweightLoader label="Loading data..." />}
      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</div>
      )}
      <div className="flex flex-wrap items-center gap-2 bg-muted/30 p-2 rounded-lg border w-full">
            <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-[140px] h-9 text-sm">
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7days">Last 7 Days</option>
                <option value="15days">Last 15 Days</option>
                <option value="30days">Last 30 Days</option>
                <option value="thismonth">This Month</option>
                <option value="6months">Last 6 Months</option>
                <option value="1year">Last 1 Year</option>
                <option value="all">All Time</option>
                <option value="custom">Custom Range</option>
            </Select>
            
            {filterType === 'custom' && (
                <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                    <Input 
                        type="date" 
                        className="h-9 w-auto text-sm" 
                        value={customStart} 
                        onChange={e => setCustomStart(e.target.value)} 
                    />
                    <span className="text-muted-foreground">-</span>
                    <Input 
                        type="date" 
                        className="h-9 w-auto text-sm" 
                        value={customEnd} 
                        onChange={e => setCustomEnd(e.target.value)} 
                    />
                </div>
            )}
            
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search product id/name, customer name/phone"
              className="h-9 w-[280px] text-sm"
            />

            {showBin && (
              <Button variant="outline" onClick={() => void refreshDeletedTransactionsBin()} className="h-9 text-sm">Refresh Bin</Button>
            )}
            {showBin && hasMoreDeletedWindow && (
              <Button variant="outline" onClick={loadOlderDeletedWindow} className="h-9 text-sm">Load Older Bin Rows</Button>
            )}
            <Button variant={showBin ? 'default' : 'outline'} onClick={() => setShowBin(prev => !prev)} className="h-9 text-sm">
              <Trash2 className="w-4 h-4 mr-1" />
              {showBin ? 'Back to Active' : `Bin (${deletedTransactions.length})`}
            </Button>

            <Button variant="outline" onClick={() => downloadTransactionsData()} className="h-9 text-sm">Download Data</Button>
            {selectedTransactionIds.length > 0 && (
              <>
                <Button variant="outline" onClick={() => downloadTransactionsData(selectedTransactions)} className="h-9 text-sm">Download Selected</Button>
                {can('transactionEdit') && <Button variant="outline" onClick={handleBatchEditTransactions} className="h-9 text-sm">Batch Edit ({selectedTransactionIds.length})</Button>}
                {can('transactionDelete') && <Button variant="destructive" onClick={() => void handleBatchDeleteTransactions()} className="h-9 text-sm">Batch Delete</Button>}
              </>
            )}
            <Button variant="outline" onClick={() => setIsImportModalOpen(true)} className="h-9 text-sm">Upload Existing File</Button>

            <div className="w-px h-6 bg-border mx-1 hidden md:block"></div>

            <Select value={viewMode} onChange={(e) => setViewMode(e.target.value as any)} className="w-[160px] h-9 text-sm">
                <option value="default">Default Cards</option>
                <option value="medium">Medium Cards</option>
                <option value="list">Show as List</option>
                <option value="list-details">List with Details</option>
            </Select>
            {!showBin && (
              <label className="flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm text-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useColoredTransactionRows}
                  onChange={(e) => setUseColoredTransactionRows(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>Colored Rows</span>
              </label>
            )}
      </div>
      {showBin && isDeletedWindowed && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Bin is currently showing a recent window. Use <span className="font-semibold">Load Older Bin Rows</span> to extend history.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-10">
        {[
          { label: 'Total Revenue', value: transactionKpis.totalRevenue, cardClass: 'border-blue-200 bg-blue-50/70', labelClass: 'text-blue-700/80', valueClass: 'text-blue-950' },
          { label: 'Total Cash', value: transactionKpis.totalCash, cardClass: 'border-green-200 bg-green-50/70', labelClass: 'text-green-700/80', valueClass: 'text-green-950' },
          { label: 'Credit', value: transactionKpis.totalCredit, cardClass: 'border-amber-200 bg-amber-50/80', labelClass: 'text-amber-700/80', valueClass: 'text-amber-950' },
          { label: 'Online', value: transactionKpis.totalOnline, cardClass: 'border-purple-200 bg-purple-50/70', labelClass: 'text-purple-700/80', valueClass: 'text-purple-950' },
          { label: 'Cash + Credit + Online', value: transactionKpis.totalCombined, cardClass: 'border-indigo-200 bg-indigo-50/70', labelClass: 'text-indigo-700/80', valueClass: 'text-indigo-950' },
          { label: 'Total Purchase in Cash', value: transactionKpis.totalPurchaseCash, cardClass: 'border-red-200 bg-red-50/70', labelClass: 'text-red-700/80', valueClass: 'text-red-950' },
          { label: 'Total Purchase in Credit', value: transactionKpis.totalPurchaseCredit, cardClass: 'border-orange-200 bg-orange-50/80', labelClass: 'text-orange-700/80', valueClass: 'text-orange-950' },
          { label: 'Cash Received on Credit Due', value: transactionKpis.cashReceivedOnCreditDue, cardClass: 'border-teal-200 bg-teal-50/80', labelClass: 'text-teal-700/80', valueClass: 'text-teal-950' },
          { label: 'Total Cash In', value: transactionKpis.totalCashIn, cardClass: 'border-emerald-200 bg-emerald-50/70', labelClass: 'text-emerald-700/80', valueClass: 'text-emerald-950' },
          { label: 'Total Cash Out', value: transactionKpis.totalCashOut, cardClass: 'border-rose-200 bg-rose-50/70', labelClass: 'text-rose-700/80', valueClass: 'text-rose-950' },
        ].map(({ label, value, cardClass, labelClass, valueClass }) => (
          <Card key={label} className={`border shadow-sm ${cardClass}`}>
            <CardContent className="p-2 lg:p-1.5">
              <p className={`text-[9px] font-semibold uppercase leading-tight tracking-[0.06em] ${labelClass}`} title={label}>
                {label}
              </p>
              <p className={`mt-1 whitespace-nowrap text-[13px] font-bold leading-none lg:text-[12px] ${valueClass}`} title={formatCurrency(value)}>
                {formatCurrency(value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="hidden grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
          {/* Revenue */}
          <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-green-50 to-emerald-100/50">
              <div className="absolute right-0 top-0 p-3 opacity-10">
                  <ArrowUpRight className="w-16 h-16 text-green-600" />
              </div>
              <CardContent className="p-4 relative z-10">
                   <p className="text-[10px] md:text-xs font-bold text-green-700/70 uppercase tracking-wider">Total Revenue</p>
                   <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-sm md:text-lg font-bold text-green-700"></span>
                      <span className="text-lg sm:text-2xl font-extrabold text-green-800 tracking-tight truncate w-full" title={formatINRWhole(stats.totalRevenue)}>
                          {formatMoneyWhole(stats.totalRevenue)}
                      </span>
                   </div>
              </CardContent>
          </Card>

          {/* Returns */}
          <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-red-50 to-rose-100/50">
              <div className="absolute right-0 top-0 p-3 opacity-10">
                  <ArrowDownLeft className="w-16 h-16 text-red-600" />
              </div>
              <CardContent className="p-4 relative z-10">
                   <p className="text-[10px] md:text-xs font-bold text-red-700/70 uppercase tracking-wider">Returns</p>
                   <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-sm md:text-lg font-bold text-red-700"></span>
                      <span className="text-lg sm:text-2xl font-extrabold text-red-800 tracking-tight truncate w-full" title={formatINRWhole(stats.totalReturns)}>
                          {formatMoneyWhole(stats.totalReturns)}
                      </span>
                   </div>
              </CardContent>
          </Card>

          {/* Discounts */}
          <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-emerald-50 to-teal-100/50">
              <div className="absolute right-0 top-0 p-3 opacity-10">
                  <Percent className="w-16 h-16 text-emerald-600" />
              </div>
              <CardContent className="p-4 relative z-10">
                   <p className="text-[10px] md:text-xs font-bold text-emerald-700/70 uppercase tracking-wider">Total Discount</p>
                   <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-sm md:text-lg font-bold text-emerald-700"></span>
                      <span className="text-lg sm:text-2xl font-extrabold text-emerald-800 tracking-tight truncate w-full" title={formatINRWhole(stats.totalDiscount)}>
                          {formatMoneyWhole(stats.totalDiscount)}
                      </span>
                   </div>
              </CardContent>
          </Card>
          
          {/* Net Sales */}
          <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-blue-50 to-indigo-100/50">
              <div className="absolute right-0 top-0 p-3 opacity-10">
                  <IndianRupee className="w-16 h-16 text-blue-600" />
              </div>
              <CardContent className="p-4 relative z-10">
                   <p className="text-[10px] md:text-xs font-bold text-blue-700/70 uppercase tracking-wider">Net Sales</p>
                   <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-sm md:text-lg font-bold text-blue-700"></span>
                      <span className="text-lg sm:text-2xl font-extrabold text-blue-800 tracking-tight truncate w-full" title={formatINRWhole(stats.netSales)}>
                          {formatMoneyWhole(stats.netSales)}
                      </span>
                   </div>
              </CardContent>
          </Card>

          {can('analytics') && (
            <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-amber-50 to-orange-100/50">
              <div className="absolute right-0 top-0 p-3 opacity-10">
                <TrendingUp className="w-16 h-16 text-amber-600" />
              </div>
              <CardContent className="p-4 relative z-10">
                <p className="text-[10px] md:text-xs font-bold text-amber-700/70 uppercase tracking-wider">Gross Profit</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-sm md:text-lg font-bold text-amber-700"></span>
                  <span className="text-lg sm:text-2xl font-extrabold text-amber-800 tracking-tight truncate w-full" title={formatINRWhole(stats.grossProfit)}>
                    {formatMoneyWhole(stats.grossProfit)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
      </div>

      {/* Responsive Transaction Grid */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            {showBin ? <Trash2 className="w-5 h-5 text-muted-foreground" /> : <Clock className="w-5 h-5 text-muted-foreground" />}
            {showBin ? 'Deleted Transaction Bin' : 'Transaction History'}
        </h2>

        {showBin ? (
            deletedTransactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-lg bg-muted/10 text-muted-foreground">
                <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4">
                  <Trash2 className="w-6 h-6 opacity-50" />
                </div>
                <p className="font-medium">Bin is empty</p>
                <p className="text-sm">Deleted transactions will appear here for audit.</p>
              </div>
            ) : (
              <Card className="overflow-hidden border-none shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-muted-foreground uppercase bg-muted/50 font-bold">
                      <tr>
                        <th className="px-4 py-3">Deleted At</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Customer</th>
                        <th className="px-4 py-3">Method</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="px-4 py-3">Deleted By</th>
                        <th className="px-4 py-3 text-center">View</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {paginatedDeletedTransactions.map(record => (
                        <tr key={record.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3">{new Date(record.deletedAt).toLocaleString()}</td>
                          <td className="px-4 py-3 uppercase font-semibold text-xs">{record.type}</td>
                          <td className="px-4 py-3">{record.customerName || 'Walk-in'}</td>
                          <td className="px-4 py-3">{record.paymentMethod || 'N/A'}</td>
                          <td className="px-4 py-3 text-right font-bold">{formatMoneyWhole(Math.abs(record.amount || 0))}</td>
                          <td className="px-4 py-3">
                            <div className="text-xs">
                              <div>{formatDeletedByName(record)}</div>
                              <div className="text-muted-foreground">{formatRoleLabel(record.deletedByRole)}</div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedDeletedTx(record)}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {deletedTransactions.length > DELETED_ROWS_PER_PAGE && (
                  <div className="flex items-center justify-between border-t bg-card px-4 py-2">
                    <Button size="sm" variant="outline" onClick={() => setDeletedPage((prev) => Math.max(1, prev - 1))} disabled={deletedPage <= 1}>Previous</Button>
                    <div className="text-xs text-muted-foreground">Page {deletedPage} of {deletedTotalPages}</div>
                    <Button size="sm" variant="outline" onClick={() => setDeletedPage((prev) => Math.min(deletedTotalPages, prev + 1))} disabled={deletedPage >= deletedTotalPages}>Next</Button>
                  </div>
                )}
              </Card>
            )
        ) : filteredTransactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-lg bg-muted/10 text-muted-foreground">
                <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4">
                    <Calendar className="w-6 h-6 opacity-50" />
                </div>
                <p className="font-medium">No transactions found</p>
                <p className="text-sm">Try changing the date filter or search keyword.</p>
            </div>
        ) : viewMode === 'list' || viewMode === 'list-details' ? (
            <Card className="overflow-hidden border-none shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-muted-foreground uppercase bg-muted/50 font-bold">
                            <tr>
                                <th className="px-4 py-3 w-12">
                                    <input
                                      type="checkbox"
                                      checked={allFilteredTransactionsSelected}
                                      onChange={handleToggleSelectAllTransactions}
                                      aria-label="Select all transactions"
                                      className="h-4 w-4 rounded border-slate-300"
                                    />
                                </th>
                                <th className="px-4 py-3">Date & ID</th>
                                <th className="px-4 py-3">Customer</th>
                                <th className="px-4 py-3">Type</th>
                                {viewMode === 'list-details' && <th className="px-4 py-3">Items</th>}
                                <th className="px-4 py-3">Method</th>
                                <th className="px-4 py-3 text-right">Amount</th>
                                <th className="px-4 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {paginatedTransactionRows.map(({ tx, isSale, isReturn, isPayment, itemCount, typeLabel, typeTone, typeVariant, amountClass, rowToneClass, rowMutedToneClass, rowSubtleToneClass, rowSurfaceClass }) => {
                                return (
                                    <tr key={tx.id} className={`${useColoredTransactionRows ? rowSurfaceClass : 'hover:bg-muted/30'} transition-colors group`}>
                                        <td className="px-4 py-3">
                                            <input
                                              type="checkbox"
                                              checked={selectedTransactionIds.includes(tx.id)}
                                              onChange={() => handleToggleTransactionSelection(tx.id)}
                                              aria-label={`Select transaction ${getTransactionReference(tx)}`}
                                              className="h-4 w-4 rounded border-slate-300"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className={`font-semibold ${rowToneClass}`}>{new Date(tx.date).toLocaleDateString()}</div>
                                            <div className={`text-[10px] font-mono ${rowSubtleToneClass}`}>#{getTransactionReference(tx)}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                                                    <User className="w-3 h-3" />
                                                </div>
                                                <span className={`font-semibold truncate max-w-[120px] ${rowToneClass}`}>{tx.customerName || 'Walk-in'}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge variant={typeVariant} className={`text-[9px] font-bold px-1.5 h-4 ${getPaymentStatusColorClass(typeTone)}`}>
                                                {typeLabel}
                                            </Badge>
                                        </td>
                                        {viewMode === 'list-details' && (
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className={`text-[10px] font-bold uppercase tracking-tight ${rowSubtleToneClass}`}>{itemCount} Items</span>
                                                    <div className="flex -space-x-2 overflow-hidden">
                                                        {normalizeTransactionItems(tx.items).slice(0, 3).map((item, i) => (
                                                            <div key={i} className="inline-block h-5 w-5 rounded-full ring-2 ring-background bg-muted overflow-hidden border">
                                                                {item.image ? <img src={item.image} className="h-full w-full object-cover" /> : <Package className="h-full w-full p-1 opacity-50" />}
                                                            </div>
                                                        ))}
                                                        {normalizeTransactionItems(tx.items).length > 3 && (
                                                            <div className="flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-background bg-slate-100 text-[8px] font-bold">
                                                                +{normalizeTransactionItems(tx.items).length - 3}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        )}
                                        <td className="px-4 py-3">
                                            <span className={`text-xs font-semibold ${rowMutedToneClass}`}>{getDisplayPaymentMethod(tx)}</span>
                                        </td>
                                        <td className={`px-4 py-3 text-right font-bold ${amountClass}`}>
                                            <div>{formatMoneyWhole(Math.abs(tx.total))}</div>
                                            {getSaleSettlementText(tx) && (
                                              <div className={`text-[10px] font-medium ${rowSubtleToneClass}`}>{getSaleSettlementText(tx)}</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedTx(tx)}><Eye className="w-3.5 h-3.5" /></Button>
                                                {can('transactionEdit') && !tx.id.startsWith('upfront-') && !isSupplierPaymentVirtualTransaction(tx) && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void openTransactionEditor(tx)}><Edit className="w-3.5 h-3.5" /></Button>}
                                                {can('transactionDelete') && !tx.id.startsWith('upfront-') && !isSupplierPaymentVirtualTransaction(tx) && <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => void openDeleteModal(tx)}><X className="w-3.5 h-3.5" /></Button>}
                                                {canExportInvoiceForTransaction(tx) && (
                                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openInvoiceOptions(tx)}><FileText className="w-3.5 h-3.5" /></Button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>
        ) : (
            <div className={`grid grid-cols-1 gap-4 ${
                viewMode === 'medium' 
                ? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' 
                : 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
            }`}>
                {paginatedTransactionRows.map(({ tx, isSale, isReturn, isPayment, itemCount }) => {
                    const cardBorder = isSale ? 'bg-green-500' : isReturn ? 'bg-red-500' : 'bg-emerald-500';
                    const amountClass = isSale ? 'text-green-600' : isReturn ? 'text-red-600' : 'text-emerald-700';
                    const badgeVariant = isSale ? 'success' : isReturn ? 'destructive' : 'secondary';
                    const badgeLabel = isSale ? 'SALE' : isReturn ? 'RETURN' : 'PAYMENT';
                    
                    if (viewMode === 'medium') {
                        return (
                            <Card 
                                key={tx.id} 
                                className="group cursor-pointer hover:shadow-lg transition-all duration-300 border-none bg-card"
                                onClick={() => setSelectedTx(tx)}
                            >
                                <CardContent className="p-0">
                                    <div className={`h-1.5 w-full ${cardBorder}`}></div>
                                    <div className="p-4 space-y-3">
                                        <div className="flex justify-between items-center">
                                            <Badge variant="outline" className="font-mono text-[9px] bg-muted/30 border-none">#{getTransactionReference(tx)}</Badge>
                                            <span className="text-[10px] text-muted-foreground font-medium">{new Date(tx.date).toLocaleDateString()}</span>
                                        </div>
                                        
                                        <div className="flex justify-between items-end">
                                            <div>
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">{tx.customerName || 'Walk-in'}</p>
                                                <p className={`text-xl font-black ${amountClass}`}>{formatMoneyWhole(Math.abs(tx.total))}</p>
                                            </div>
                                            <div className="text-right">
                                                <Badge variant={badgeVariant} className="text-[8px] font-black h-4 px-1 mb-1">
                                                    {badgeLabel}
                                                </Badge>
                                                <p className="text-[9px] text-muted-foreground font-bold">{getDisplayPaymentMethod(tx)}</p>
                                            </div>
                                        </div>
                                        
                                        <div className="pt-3 border-t border-dashed flex justify-between items-center">
                                            <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                                                <Package className="w-3 h-3" />
                                                {itemCount} Items
                                            </div>
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={(e) => { e.stopPropagation(); openInvoiceOptions(tx); }}
                                            >
                                                <Download className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    }

                    return (
                        <Card 
                            key={tx.id} 
                            className="group cursor-pointer hover:border-primary/50 hover:shadow-md transition-all duration-200 border-l-4"
                            style={{ borderLeftColor: isSale ? '#22c55e' : isReturn ? '#ef4444' : '#10b981' }}
                            onClick={() => setSelectedTx(tx)}
                        >
                            <CardContent className="p-4 flex flex-col gap-4">
                                {/* Header: ID & Badge */}
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground bg-muted/50 border-transparent px-1.5">
                                                #{getTransactionReference(tx)}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(tx.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <Calendar className="w-3 h-3" />
                                            {new Date(tx.date).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="flex items-center gap-1 justify-end mb-1">
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-6 w-6 text-muted-foreground hover:text-primary"
                                                onClick={(e) => { e.stopPropagation(); openInvoiceOptions(tx); }}
                                                title="Download Receipt"
                                            >
                                                <FileText className="w-3.5 h-3.5" />
                                            </Button>
                                            <Badge variant={badgeVariant} className="text-[10px] font-bold uppercase tracking-wider px-2 h-5">
                                                {badgeLabel}
                                            </Badge>
                                        </div>
                                        <div className="text-[10px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                                            {getDisplayPaymentMethod(tx)}
                                        </div>
                                    </div>
                                </div>

                                {/* Main: Amount */}
                                <div>
                                    <div className={`text-2xl font-bold flex items-center ${amountClass}`}>
                                        {isSale ? <ArrowUpRight className="w-5 h-5 mr-1" /> : isReturn ? <ArrowDownLeft className="w-5 h-5 mr-1" /> : <CreditCard className="w-5 h-5 mr-1" />}
                                        {formatMoneyWhole(Math.abs(tx.total))}
                                    </div>
                                </div>

                                {/* Footer: Customer & Details */}
                                <div className="pt-3 mt-auto border-t flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                                            <User className="w-3 h-3" />
                                        </div>
                                        <span className="font-medium text-foreground max-w-[100px] truncate" title={tx.customerName}>
                                            {tx.customerName || 'Walk-in'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs font-medium bg-muted/30 px-2 py-1 rounded text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                        <Package className="w-3.5 h-3.5" />
                                        <span>{itemCount} Items</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        )}
      </div>

      {/* Transaction Detail Modal */}
      {selectedTx && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
              <Card className="w-full max-w-md animate-in zoom-in duration-200 flex flex-col max-h-[90vh] shadow-2xl">
                  <CardHeader className="border-b pb-3 shrink-0 bg-muted/5">
                      <div className="flex justify-between items-center">
                          <CardTitle className="text-lg flex items-center gap-2">
                              {getTransactionReceiptTitle(selectedTx)}
                              <span className="text-xs font-normal text-muted-foreground font-mono">#{getTransactionReference(selectedTx)}</span>
                          </CardTitle>
                          <div className="flex items-center gap-1">
                              {canExportInvoiceForTransaction(selectedTx) && (
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => openInvoiceOptions(selectedTx)}
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    {isUpfrontVirtualTransaction(selectedTx) ? 'Receipt' : 'Invoice'}
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive" onClick={() => setSelectedTx(null)}><X className="w-4 h-4" /></Button>
                          </div>
                      </div>
                  </CardHeader>
                  <CardContent className="overflow-y-auto p-0">
                      <div className="p-5 space-y-5">
                          {/* Info Header */}
                          <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-xl border">
                              <div>
                                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Date</p>
                                  <p className="font-medium flex items-center gap-1.5">
                                     <Calendar className="w-3.5 h-3.5 text-primary" />
                                     {new Date(selectedTx.date).toLocaleString()}
                                  </p>
                              </div>
                              <div>
                                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Customer</p>
                                  <p className="font-medium flex items-center gap-1.5">
                                      <User className="w-3.5 h-3.5 text-primary" />
                                      {selectedTx.customerName || 'Walk-in'}
                                  </p>
                              </div>
                              <div className="col-span-2 border-t pt-2 mt-1">
                                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Payment Method</p>
                                  <p className="font-medium flex items-center gap-1.5 text-primary">
                                      <CreditCard className="w-3.5 h-3.5" />
                                      {getDisplayPaymentMethod(selectedTx)}
                                  </p>
                              </div>
                              {isUpfrontVirtualTransaction(selectedTx) && (
                                <div className="col-span-2 rounded-lg border bg-blue-50 p-2">
                                  {(() => {
                                    const note = String(selectedTx.notes || '');
                                    const read = (label: string) => {
                                      const m = note.match(new RegExp(`${label}: ([\\d,]+)`));
                                      return m ? Number(m[1].replace(/,/g, '')) : 0;
                                    };
                                    const total = read('Total') || Math.abs(Number(selectedTx.total || 0));
                                    const expense = read('Expense');
                                    const cashPaid = read('Cash');
                                    const onlinePaid = read('Online');
                                    const advance = read('Advance');
                                    const remaining = read('Remaining');
                                    return (
                                      <>
                                        <p className="text-xs">Order Subtotal: {formatMoneyWhole(Math.max(0, total - expense))}</p>
                                        {expense > 0 && <p className="text-xs">Expense: {formatMoneyWhole(expense)}</p>}
                                        <p className="text-xs font-semibold">Order Total: {formatMoneyWhole(total)}</p>
                                        <p className="text-xs">Paid Cash: {formatMoneyWhole(cashPaid)}</p>
                                        <p className="text-xs">Paid Online: {formatMoneyWhole(onlinePaid)}</p>
                                        <p className="text-xs">Total Paid: {formatMoneyWhole(Math.max(advance, cashPaid + onlinePaid, isCustomOrderPaymentRow(selectedTx) ? Math.abs(Number(selectedTx.total || 0)) : 0))}</p>
                                        <p className="text-xs font-semibold">Remaining Amount: {formatMoneyWhole(remaining)}</p>
                                      </>
                                    );
                                  })()}
                                </div>
                              )}
                              {selectedTx.type === 'sale' && (
                                <div className="col-span-2 rounded-lg border bg-muted/10 p-2">
                                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Settlement</p>
                                  <p className="text-xs">Total Sale: {formatMoneyWhole(Math.abs(selectedTx.total))}</p>
                                  <p className="text-xs">Store Credit Used: {formatMoneyWhole(Number(selectedTx.storeCreditUsed || 0))}</p>
                                  <p className="text-xs">Cash Paid: {formatMoneyWhole(getSaleSettlementBreakdown(selectedTx).cashPaid)}</p>
                                  <p className="text-xs">Online Paid: {formatMoneyWhole(getSaleSettlementBreakdown(selectedTx).onlinePaid)}</p>
                                  <p className="text-xs font-semibold">Credit Due Created: {formatMoneyWhole(getSaleSettlementBreakdown(selectedTx).creditDue)}</p>
                                </div>
                              )}
                          </div>

                          {/* Items */}
                          <div className="space-y-3">
                              <p className="text-sm font-semibold border-b pb-2 flex items-center gap-2">
                                  <Package className="w-4 h-4 text-primary" />
                                  Items Purchased
                              </p>
                              {normalizeTransactionItems(selectedTx.items).map((item, idx) => (
                                  <div key={idx} className="flex gap-3 items-start p-2 rounded-lg hover:bg-muted/50 transition-colors">
                                      <div className="h-10 w-10 bg-white rounded border flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
                                          {item.image ? (
                                              <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                                          ) : (
                                              <span className="text-[8px] text-muted-foreground">IMG</span>
                                          )}
                                      </div>
                                      <div className="flex-1">
                                          <div className="flex justify-between items-start">
                                              <p className="font-medium text-sm leading-tight">{item.name}</p>
                                              <p className="font-medium text-sm">{formatMoneyWhole((item.sellPrice * item.quantity) - (item.discountAmount || 0))}</p>
                                          </div>
                                          <div className="flex justify-between items-center mt-1">
                                              <p className="text-xs text-muted-foreground">SKU: {item.barcode} | {item.selectedVariant || NO_VARIANT} / {item.selectedColor || NO_COLOR}</p>
                                              <div className="flex flex-col items-end">
                                                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
                                                      {item.quantity} x {item.sellPrice}
                                                  </Badge>
                                                  {item.discountAmount !== undefined && item.discountAmount > 0 ? (
                                                      <span className="text-[9px] font-bold text-emerald-600 mt-0.5">
                                                          -{item.discountAmount.toFixed(2)} ({item.discountPercent}%)
                                                      </span>
                                                  ) : null}
                                              </div>
                                          </div>
                                      </div>
                                  </div>
                              ))}
                          </div>

                          {/* Footer Breakdown */}
                          <div className="bg-muted/10 p-4 rounded-xl border-2 border-dashed border-muted space-y-2">
                              {/* Subtotal */}
                              <div className="flex justify-between text-xs text-muted-foreground">
                                  <span>Subtotal</span>
                                  <span>{formatMoneyWhole(selectedTx.subtotal ? selectedTx.subtotal : Math.abs(selectedTx.total))}</span>
                              </div>
                              
                              {/* Discount */}
                              <div className="flex justify-between text-xs text-green-600">
                                  <span>Discount</span>
                                  {selectedTx.discount && selectedTx.discount > 0 ? (
                                      <span>-{formatMoneyWhole(selectedTx.discount)}</span>
                                  ) : (
                                      <span className="text-muted-foreground font-medium">No discount</span>
                                  )}
                              </div>

                              {/* Tax */}
                              <div className="flex justify-between text-xs text-muted-foreground">
                                  <span>Tax {selectedTx.tax && selectedTx.tax > 0 ? `(${selectedTx.taxLabel})` : ''}</span>
                                  {selectedTx.tax && selectedTx.tax > 0 ? (
                                      <span>+{formatMoneyWhole(selectedTx.tax)}</span>
                                  ) : (
                                      <span className="text-muted-foreground font-medium">No tax applied</span>
                                  )}
                              </div>

                              <div className="border-t pt-2 mt-2 flex justify-between items-center font-bold text-xl">
                                  <span>Total</span>
                                  <span className={selectedTx.type === 'sale' ? 'text-green-700' : selectedTx.type === 'return' ? 'text-red-700' : 'text-emerald-700'}>
                                      {selectedTx.type === 'return' ? '-' : ''}{formatMoneyWhole(Math.abs(selectedTx.total))}
                                  </span>
                              </div>
                          </div>
                      </div>
                  </CardContent>
              </Card>
          </div>
      )}

      {selectedDeletedTx && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <Card className="w-full max-w-2xl animate-in zoom-in duration-200 flex flex-col max-h-[90vh] shadow-2xl">
            <CardHeader className="border-b pb-3 shrink-0 bg-muted/5">
              <div className="flex justify-between items-center">
                <div className="space-y-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Trash2 className="w-5 h-5 text-muted-foreground" />
                    Deleted Transaction
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className="uppercase">{selectedDeletedTx.type}</Badge>
                    <Badge variant="destructive">{Math.abs(selectedDeletedTx.amount || 0).toLocaleString()}</Badge>
                    <span className="text-muted-foreground">{selectedDeletedTx.customerName || 'Walk-in'}</span>
                    <span className="text-muted-foreground">|</span>
                    <span className="text-muted-foreground">{new Date(selectedDeletedTx.deletedAt).toLocaleString()}</span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedDeletedTx(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="overflow-auto space-y-4 p-4">
              <div className="rounded-lg border p-3 space-y-2 bg-muted/5">
                <p className="font-semibold text-sm">Transaction details</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Type:</span> {selectedDeletedTx.type.toUpperCase()}</div>
                  <div><span className="text-muted-foreground">Payment method:</span> {selectedDeletedTx.paymentMethod || 'N/A'}</div>
                  <div><span className="text-muted-foreground">Customer:</span> {selectedDeletedTx.customerName || 'Walk-in'}</div>
                  <div><span className="text-muted-foreground">Original transaction date:</span> {new Date(selectedDeletedTx.originalTransaction.date).toLocaleString()}</div>
                  <div><span className="text-muted-foreground">Deleted by:</span> {formatDeletedByName(selectedDeletedTx)}</div>
                  <div><span className="text-muted-foreground">Role:</span> {formatRoleLabel(selectedDeletedTx.deletedByRole)}</div>
                </div>
              </div>

              <div className="rounded-lg border p-3 bg-muted/10 space-y-3">
                <p className="font-semibold text-sm">Before / After impact</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="rounded-md border bg-background p-2 space-y-1">
                    <p className="font-semibold text-muted-foreground">Customer impact</p>
                    <p>Due: {selectedDeletedTx.beforeImpact.customerDue.toLocaleString()} → {selectedDeletedTx.afterImpact.customerDue.toLocaleString()}</p>
                    <p className="text-muted-foreground">Change: {(selectedDeletedTx.afterImpact.customerDue - selectedDeletedTx.beforeImpact.customerDue).toLocaleString()}</p>
                    <p>Store credit: {selectedDeletedTx.beforeImpact.customerStoreCredit.toLocaleString()} → {selectedDeletedTx.afterImpact.customerStoreCredit.toLocaleString()}</p>
                    <p className="text-muted-foreground">Change: {(selectedDeletedTx.afterImpact.customerStoreCredit - selectedDeletedTx.beforeImpact.customerStoreCredit).toLocaleString()}</p>
                  </div>
                  <div className="rounded-md border bg-background p-2 space-y-1">
                    <p className="font-semibold text-muted-foreground">Cash impact</p>
                    <p>Cash estimate: {selectedDeletedTx.beforeImpact.estimatedCashFromActiveTransactions.toLocaleString()} → {selectedDeletedTx.afterImpact.estimatedCashFromActiveTransactions.toLocaleString()}</p>
                    <p className="text-muted-foreground">Change: {(selectedDeletedTx.afterImpact.estimatedCashFromActiveTransactions - selectedDeletedTx.beforeImpact.estimatedCashFromActiveTransactions).toLocaleString()}</p>
                  </div>
                  <div className="rounded-md border bg-background p-2 space-y-1">
                    <p className="font-semibold text-muted-foreground">Activity impact</p>
                    <p>Active transactions: {selectedDeletedTx.beforeImpact.activeTransactionsCount} → {selectedDeletedTx.afterImpact.activeTransactionsCount}</p>
                    <p className="text-muted-foreground">Change: {(selectedDeletedTx.afterImpact.activeTransactionsCount - selectedDeletedTx.beforeImpact.activeTransactionsCount).toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-semibold text-amber-900 mb-1">Financial effect summary</p>
                <p className="text-amber-800">
                  Deleting this {selectedDeletedTx.type} changed due by {formatMoneyWhole(selectedDeletedTx.afterImpact.customerDue - selectedDeletedTx.beforeImpact.customerDue)}
                  {' '}and cash estimate by {formatMoneyWhole(selectedDeletedTx.afterImpact.estimatedCashFromActiveTransactions - selectedDeletedTx.beforeImpact.estimatedCashFromActiveTransactions)}.
                </p>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <p className="font-semibold text-sm">Original transaction summary</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Transaction ID:</span> {selectedDeletedTx.originalTransactionId}</div>
                  <div><span className="text-muted-foreground">Type:</span> {selectedDeletedTx.originalTransaction.type.toUpperCase()}</div>
                  <div><span className="text-muted-foreground">Date:</span> {new Date(selectedDeletedTx.originalTransaction.date).toLocaleString()}</div>
                  <div><span className="text-muted-foreground">Customer:</span> {selectedDeletedTx.originalTransaction.customerName || 'Walk-in'}</div>
                  <div><span className="text-muted-foreground">Payment method:</span> {selectedDeletedTx.originalTransaction.paymentMethod || 'N/A'}</div>
                  <div><span className="text-muted-foreground">Total:</span> {formatMoneyWhole(Math.abs(selectedDeletedTx.originalTransaction.total || 0))}</div>
                  <div><span className="text-muted-foreground">Discount:</span> {formatMoneyWhole(Math.abs(selectedDeletedTx.originalTransaction.discount || 0))}</div>
                  <div><span className="text-muted-foreground">Tax:</span> {formatMoneyWhole(Math.abs(selectedDeletedTx.originalTransaction.tax || 0))}</div>
                  <div className="md:col-span-2"><span className="text-muted-foreground">Notes:</span> {selectedDeletedTx.originalTransaction.notes || '-'}</div>
                </div>
              </div>

              {normalizeTransactionItems(selectedDeletedTx.itemSnapshot ?? selectedDeletedTx.originalTransaction.items).length > 0 && (
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="font-semibold text-sm">Item summary</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="text-left py-1 pr-2">Product</th>
                          <th className="text-left py-1 pr-2">Qty</th>
                          <th className="text-left py-1 pr-2">Variant</th>
                          <th className="text-left py-1 pr-2">Color</th>
                          <th className="text-left py-1 pr-2">Unit</th>
                          <th className="text-right py-1">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {normalizeTransactionItems(selectedDeletedTx.itemSnapshot ?? selectedDeletedTx.originalTransaction.items).map((item, index) => {
                          const subtotal = (item.sellPrice || 0) * (item.quantity || 0) - (item.discountAmount || 0);
                          return (
                            <tr key={`${item.id}-${index}`} className="border-t">
                              <td className="py-1 pr-2">{item.name} <span className="text-muted-foreground">({item.id})</span></td>
                              <td className="py-1 pr-2">{item.quantity}</td>
                              <td className="py-1 pr-2">{item.selectedVariant || NO_VARIANT}</td>
                              <td className="py-1 pr-2">{item.selectedColor || NO_COLOR}</td>
                              <td className="py-1 pr-2">{formatMoneyWhole(item.sellPrice || 0)}</td>
                              <td className="py-1 text-right">{formatMoneyWhole(subtotal)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {deleteTargetTx && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-auto">
            <CardHeader>
              <CardTitle>Delete Transaction #{deleteTargetTx.id.slice(-6)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-muted/10 p-3 space-y-1 text-sm">
                <p><span className="text-muted-foreground">Type:</span> {deleteTargetTx.type.toUpperCase()}</p>
                <p><span className="text-muted-foreground">Total:</span> {formatINRPrecise(Math.abs(deleteTargetTx.total || 0))}</p>
                <p><span className="text-muted-foreground">Customer:</span> {deleteTargetTx.customerName || 'Walk-in'}</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Delete reason</label>
                <Select value={deleteReason} onChange={(e) => setDeleteReason(e.target.value as 'customer_cancelled' | 'created_by_mistake' | 'other')}>
                  <option value="customer_cancelled">Customer cancelled</option>
                  <option value="created_by_mistake">Created by mistake</option>
                  <option value="other">Other</option>
                </Select>
                {deleteReason === 'other' && (
                  <Input
                    placeholder="Enter reason"
                    value={deleteReasonOther}
                    onChange={(e) => setDeleteReasonOther(e.target.value)}
                  />
                )}
              </div>

              {deletePreview && (
                <div className="space-y-3">
                  <div className="rounded-lg border p-3 bg-muted/5 text-sm space-y-1">
                    <p className="font-semibold">Settlement removed</p>
                    <p>Cash paid: {formatINRPrecise(deletePreview.settlementRemoved.cashPaid)}</p>
                    <p>Online paid: {formatINRPrecise(deletePreview.settlementRemoved.onlinePaid)}</p>
                    <p>Credit created: {formatINRPrecise(deletePreview.settlementRemoved.creditDue)}</p>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/5 text-sm space-y-1">
                    <p className="font-semibold">Customer balance effect</p>
                    <p>Due: {formatINRPrecise(deletePreview.customerBalanceBefore.due)} → {formatINRPrecise(deletePreview.customerBalanceAfter.due)}</p>
                    <p>Store credit: {formatINRPrecise(deletePreview.customerBalanceBefore.storeCredit)} → {formatINRPrecise(deletePreview.customerBalanceAfter.storeCredit)}</p>
                    <p>Due reduced: {formatINRPrecise(deletePreview.customerDelta.dueReduced)}</p>
                    <p>Store credit increased: {formatINRPrecise(deletePreview.customerDelta.storeCreditIncreased)}</p>
                    <p className="font-medium">Payable after due absorption: {formatINRPrecise(deletePreview.derivedCompensation.payableAfterDueAbsorption)}</p>
                    <p className="font-medium">Net payable/store-credit after due absorption: {formatINRPrecise(deletePreview.derivedCompensation.netPayableAfterDueAbsorption)}</p>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/5 text-sm space-y-1">
                    <p className="font-semibold">Cash/session effect</p>
                    <p>Estimated cash reversal: {formatINRPrecise(Math.abs(deletePreview.cashSessionDelta.cashEffectDelta))}</p>
                    <p>Estimated online reversal: {formatINRPrecise(Math.abs(deletePreview.cashSessionDelta.onlineEffectDelta || 0))}</p>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/5 text-sm space-y-1">
                    <p className="font-semibold">Inventory effect</p>
                    {deletePreview.inventoryEffect.restoredLines.length > 0 ? (
                      <div className="space-y-1">
                        {deletePreview.inventoryEffect.restoredLines.map((line, idx) => (
                          <p key={`${line.productId}-${line.variant}-${line.color}-${idx}`}>
                            {line.productName || line.productId} • {line.variant || NO_VARIANT} / {line.color || NO_COLOR} • Qty {line.qty}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p>No stock restoration for this transaction type.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" onClick={() => setDeleteTargetTx(null)}>Cancel</Button>
                {deletePreview && deletePreview.derivedCompensation.payableAfterDueAbsorption > 0 ? (
                  <>
                    <Button
                      variant="destructive"
                      onClick={() => handleConfirmDelete('cash_refund')}
                      disabled={deleteReason === 'other' && !deleteReasonOther.trim()}
                    >
                      Give Cash ({formatINRPrecise(deletePreview.derivedCompensation.payableAfterDueAbsorption)}) & Delete
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleConfirmDelete('store_credit')}
                      disabled={deleteReason === 'other' && !deleteReasonOther.trim()}
                    >
                      Save as Store Credit ({formatINRPrecise(deletePreview.derivedCompensation.payableAfterDueAbsorption)}) & Delete
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="destructive"
                    onClick={() => handleConfirmDelete('cash_refund')}
                    disabled={deleteReason === 'other' && !deleteReasonOther.trim()}
                  >
                    Confirm Delete
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <UploadImportModal 
        open={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        title="Import Transactions"
        onDownloadTemplate={downloadTransactionsTemplate}
        onImportFile={async (file) => {
          const result = await importHistoricalTransactionsFromFile(file);
          const data = loadData();
          setTransactions(data.transactions);
          setDeletedTransactions(data.deletedTransactions || []);
          setCustomers(data.customers);
          return result;
        }}
      />

      {editingTx && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-5xl max-h-[90vh] overflow-hidden">
            <CardHeader className="border-b py-3 flex flex-row items-center justify-between gap-2">
              <CardTitle>{isBatchEditing ? `Batch Edit ${batchEditTransactionIndex + 1}/${batchEditTransactionIds.length}` : `Edit #${editingTx.id.slice(-6)}`} • {editingTx.type.toUpperCase()}</CardTitle>
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground">{formatDateTimeDisplay(editingTx.date)} • {editingTx.customerName || 'Walk-in customer'}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                  onClick={closeTransactionEditor}
                  aria-label="Close edit transaction"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-3 overflow-y-auto max-h-[calc(90vh-136px)]">
              {editingError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{editingError}</div>}
              <div className="space-y-1.5 text-[13px] rounded-lg border p-2.5 bg-muted/10">
                <div className="grid gap-1.5 md:grid-cols-4">
                  <div><span className="text-muted-foreground">Type:</span> <span className="font-semibold uppercase">{editingTx.type}</span></div>
                  <div><span className="text-muted-foreground">Customer:</span> <span className="font-semibold">{editingTx.customerName || 'Walk-in'}</span></div>
                  <div><span className="text-muted-foreground">Original Total:</span> <span className="font-semibold">{formatMoneyPrecise(Math.abs(editingTx.total || 0))}</span></div>
                  <div><span className="text-muted-foreground">Edited Total:</span> <span className="font-semibold">{formatMoneyPrecise(Math.abs(editingDraftTransaction?.total || 0))}</span></div>
                </div>
              </div>
              <div className={`rounded-md border px-3 py-2 text-[13px] ${editRiskBanner.tone}`}>
                <div className="font-semibold">{editRiskBanner.title}</div>
                <div>{editRiskBanner.detail}</div>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="space-y-2">
                  <div className="grid md:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</label>
                      <Input type="datetime-local" value={editingTxDate} onChange={e => setEditingTxDate(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer</label>
                      <div ref={editingCustomerPickerRef} className="relative">
                        <button
                          type="button"
                          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm"
                          onClick={() => setIsEditingCustomerPickerOpen((open) => !open)}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-900">{editingCustomer?.name || 'Walk-in customer'}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{editingCustomer?.phone || 'No customer ledger selected'}</div>
                          </div>
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                        </button>
                        {isEditingCustomerPickerOpen && (
                          <div className="absolute z-30 mt-2 w-full rounded-xl border bg-white p-3 shadow-xl">
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <Input
                                autoFocus
                                value={editingCustomerSearch}
                                onChange={(e) => {
                                  setEditingCustomerSearch(e.target.value);
                                  setShowAllEditingCustomers(false);
                                }}
                                placeholder="Search customer name, phone, or ID"
                                className="pl-9"
                              />
                            </div>
                            <div className="mt-2 rounded-lg border">
                              <button
                                type="button"
                                className={`flex w-full items-start justify-between border-b px-3 py-2 text-left text-sm hover:bg-slate-50 ${!editingCustomerId ? 'bg-slate-50' : ''}`}
                                onClick={() => {
                                  setEditingCustomerId('');
                                  setEditingCustomerSearch('');
                                  setIsEditingCustomerPickerOpen(false);
                                  setShowAllEditingCustomers(false);
                                }}
                              >
                                <div>
                                  <div className="font-medium text-slate-900">Walk-in customer</div>
                                  <div className="text-[11px] text-slate-500">No ledger link</div>
                                </div>
                                {!editingCustomerId && <span className="text-[11px] font-semibold text-primary">Selected</span>}
                              </button>
                              <div className="max-h-72 overflow-y-auto">
                                {visibleEditingCustomers.length === 0 ? (
                                  <div className="px-3 py-4 text-sm text-slate-500">No customers matched your search.</div>
                                ) : visibleEditingCustomers.map((customer) => (
                                  <button
                                    key={customer.id}
                                    type="button"
                                    className={`flex w-full items-start justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50 ${editingCustomerId === customer.id ? 'bg-slate-50' : ''}`}
                                    onClick={() => {
                                      setEditingCustomerId(customer.id);
                                      setEditingCustomerSearch(customer.name);
                                      setIsEditingCustomerPickerOpen(false);
                                      setShowAllEditingCustomers(false);
                                    }}
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate font-medium text-slate-900">{customer.name}</div>
                                      <div className="truncate text-[11px] text-slate-500">{customer.phone || 'No phone'} • {customer.id}</div>
                                    </div>
                                    {editingCustomerId === customer.id && <span className="text-[11px] font-semibold text-primary">Selected</span>}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {!showAllEditingCustomers && filteredEditingCustomers.length > visibleEditingCustomers.length && (
                              <button
                                type="button"
                                className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                onClick={() => setShowAllEditingCustomers(true)}
                              >
                                <Users className="h-4 w-4" />
                                See all {filteredEditingCustomers.length} customers
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {editingSectionWarning?.section === 'customer' && <p className="text-[11px] text-red-700">{editingSectionWarning.message}</p>}
                    </div>
                  </div>
                  {(editingTx.type === 'sale' || editingTx.type === 'return') && (
                    <div className="space-y-1.5">
                      <div className="text-[13px] font-semibold text-muted-foreground px-1">{editingTx.type === 'sale' ? 'Sale lines' : 'Return lines'}</div>
                      {editingItems.map((item, index) => {
                        const variantParts = [item.selectedVariant && item.selectedVariant !== NO_VARIANT ? item.selectedVariant : '', item.selectedColor && item.selectedColor !== NO_COLOR ? item.selectedColor : ''].filter(Boolean).join(' • ');
                        const isProtectedReturnLinkedSaleLine = editingTx.type === 'sale' && !!editingSaleLinkageInfo?.returnedQtyByKey.get(getLineCompositeKey(item));
                        return (
                          <div key={`${item.id}-${index}`} className="rounded-md border px-2 py-1.5">
                            <div className="grid grid-cols-[30px_minmax(0,1.7fr)_74px_64px_74px_72px] md:grid-cols-[34px_minmax(0,2fr)_96px_80px_84px_88px] items-center gap-1.5 md:gap-2 text-[13px]">
                              <div className="h-8 w-8 rounded border bg-muted overflow-hidden shrink-0">{item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-contain" /> : <Package className="w-full h-full p-1.5 opacity-30" />}</div>
                              <div className="min-w-0">
                                <div className="truncate font-medium">{item.name}</div>
                                {variantParts && <div className="text-[11px] text-muted-foreground truncate">{variantParts}</div>}
                              </div>
                              <Input type="number" min="1" className="h-8 px-2 text-right text-[13px]" value={item.quantity} onChange={e => updateEditingItem(index, { quantity: Math.max(1, Number(e.target.value || 1)) })} />
                              <Input type="number" min="0" step="0.01" disabled={editingTx.type === 'return' || isProtectedReturnLinkedSaleLine} className="h-8 px-2 text-right text-[13px]" value={item.sellPrice} onChange={e => updateEditingItem(index, { sellPrice: toSafeMoney(e.target.value) })} />
                              <div className="text-right font-semibold">{formatMoneyPrecise(toSafeMoney(item.quantity) * toSafeMoney(item.sellPrice))}</div>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-8 gap-1.5 border-red-200 px-2 text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:border-slate-200 disabled:text-slate-400"
                                onClick={() => removeEditingItem(index)}
                                disabled={editingTx.type === 'sale' && isProtectedReturnLinkedSaleLine}
                                title={isProtectedReturnLinkedSaleLine ? 'This line already has linked returns and cannot be removed.' : 'Remove this product from the invoice'}
                                aria-label={isProtectedReturnLinkedSaleLine ? 'Line removal blocked because returns are linked' : 'Delete product from invoice'}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span className="text-[11px] font-semibold">Delete</span>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {editingSectionWarning?.section === 'lines' && <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[12px] text-red-700">{editingSectionWarning.message}</div>}
                  {editingTx.type === 'sale' && (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => setIsProductPickerOpen(true)}>Select Product</Button>
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</label>
                    <Input value={editingTxNotes} onChange={e => setEditingTxNotes(e.target.value)} placeholder="Notes" />
                  </div>
                </div>
                <div className="space-y-2">
                  {editingTx.type === 'sale' && (
                    <div className="rounded-md border p-2.5 bg-muted/10 space-y-1.5 text-[13px]">
                      <div className="font-semibold text-[14px]">Settlement Split</div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1"><label className="text-[11px] font-semibold text-muted-foreground">Cash Paid</label><Input type="number" min="0" step="0.01" value={editingCashPaid} onChange={e => setEditingCashPaid(e.target.value)} placeholder="Cash" /></div>
                        <div className="space-y-1"><label className="text-[11px] font-semibold text-muted-foreground">Online/Bank Paid</label><Input type="number" min="0" step="0.01" value={editingOnlinePaid} onChange={e => setEditingOnlinePaid(e.target.value)} placeholder="Online" /></div>
                        <div className="space-y-1"><label className="text-[11px] font-semibold text-muted-foreground">Credit Due</label><Input type="number" min="0" step="0.01" value={editingCreditDue} onChange={e => setEditingCreditDue(e.target.value)} placeholder="Credit due" /></div>
                      </div>
                      {editingSectionWarning?.section === 'settlement' && <p className="text-[11px] text-red-700">{editingSectionWarning.message}</p>}
                    </div>
                  )}
                  {editingTx.type === 'return' && (
                    <div className="rounded-md border p-2.5 bg-orange-50/40 space-y-1.5 text-[13px]">
                      <div className="font-semibold text-[14px]">Return Handling</div>
                      <Select value={editingReturnMode} onChange={e => setEditingReturnMode(e.target.value as 'reduce_due' | 'refund_cash' | 'refund_online' | 'store_credit')}>
                        <option value="refund_cash">Refund Cash</option>
                        <option value="refund_online">Refund Online</option>
                        <option value="reduce_due">Reduce Due</option>
                        <option value="store_credit">Store Credit</option>
                      </Select>
                    </div>
                  )}
                  {editingTx.type === 'payment' && (
                    <div className="rounded-md border p-2.5 bg-muted/10 space-y-1.5 text-[13px]">
                      <div className="font-semibold text-[14px]">Payment Edit</div>
                      <Input type="number" value={editingAmount} onChange={e => setEditingAmount(e.target.value)} placeholder="Amount" />
                      <Select value={editingTxPaymentMethod} onChange={e => setEditingTxPaymentMethod(e.target.value as 'Cash' | 'Credit' | 'Online')}>
                        <option value="Cash">Cash</option>
                        <option value="Online">Online</option>
                      </Select>
                    </div>
                  )}
                  {editingTx.type === 'sale' && (
                    <div className="rounded-md border p-2.5 space-y-1.5 text-[13px]">
                      <div className="font-semibold text-[14px]">Sale Edit Summary</div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-semibold">{formatMoneyPrecise(getEditedSubtotal())}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Grand Total</span><span className="font-semibold">{formatMoneyPrecise(Math.abs(getEditedTotal()))}</span></div>
                      <div className="rounded border bg-muted/20 p-2 space-y-1">
                        <div className="flex justify-between"><span>Cash</span><span>{formatMoneyPrecise(toSafeMoney(editingCashPaid))}</span></div>
                        <div className="flex justify-between"><span>Online</span><span>{formatMoneyPrecise(toSafeMoney(editingOnlinePaid))}</span></div>
                        <div className="flex justify-between"><span>Credit Due</span><span>{formatMoneyPrecise(toSafeMoney(editingCreditDue))}</span></div>
                      </div>
                      {editingTx.type === 'sale' && (() => {
                        const before = getSaleSettlementBreakdown(editingTx);
                        const after = getSaleSettlementBreakdown(editingDraftTransaction || editingTx);
                        return (
                          <div className="rounded border bg-white p-2 space-y-1">
                            <div className="font-medium">Settlement change</div>
                            <div className="text-[12px]">Before: Cash {formatMoneyPrecise(before.cashPaid)} • Online {formatMoneyPrecise(before.onlinePaid)} • Credit {formatMoneyPrecise(before.creditDue)}</div>
                            <div className="text-[12px]">After: Cash {formatMoneyPrecise(after.cashPaid)} • Online {formatMoneyPrecise(after.onlinePaid)} • Credit {formatMoneyPrecise(after.creditDue)}</div>
                            <div className="text-[12px]">Impact: Cash {before.cashPaid === after.cashPaid ? '0.00' : `${after.cashPaid > before.cashPaid ? '+' : '-'}${formatMoneyPrecise(Math.abs(after.cashPaid - before.cashPaid))}`} • Online {before.onlinePaid === after.onlinePaid ? '0.00' : `${after.onlinePaid > before.onlinePaid ? '+' : '-'}${formatMoneyPrecise(Math.abs(after.onlinePaid - before.onlinePaid))}`} • Due {before.creditDue === after.creditDue ? '0.00' : `${after.creditDue > before.creditDue ? '+' : '-'}${formatMoneyPrecise(Math.abs(after.creditDue - before.creditDue))}`}</div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {editingTx.type === 'return' && editingReturnPreview && (
                    <div className="rounded-md border p-2.5 bg-orange-50/40 space-y-1.5 text-[13px]">
                      <div className="font-semibold text-[14px]">Return Preview Summary</div>
                      <div className="rounded border bg-white p-2 flex justify-between"><span>Due Before → After</span><span className="font-semibold">{formatMoneyPrecise(editingReturnPreview.dueBefore)} → {formatMoneyPrecise(editingReturnPreview.dueAfter)}</span></div>
                      <div className="rounded border bg-white p-2 flex justify-between"><span>Store Credit Before → After</span><span className="font-semibold">{formatMoneyPrecise(editingReturnPreview.storeCreditBefore)} → {formatMoneyPrecise(editingReturnPreview.storeCreditAfter)}</span></div>
                      <div className="rounded border bg-white p-2 flex justify-between"><span>Cash Outflow</span><span className="font-semibold">{formatMoneyPrecise(editingReturnPreview.cashRefund)}</span></div>
                      <div className="rounded border bg-white p-2 flex justify-between"><span>Online Outflow</span><span className="font-semibold">{formatMoneyPrecise(editingReturnPreview.onlineRefund)}</span></div>
                    </div>
                  )}
                  {editingTx.type === 'payment' && (
                    <div className="rounded-md border p-2.5 space-y-1.5 text-[13px]">
                      <div className="font-semibold text-[14px]">Payment Impact Preview</div>
                      <div>Collection: {formatMoneyPrecise(Number(editingAmount || 0))} via {editingTxPaymentMethod}</div>
                      {editingCustomerId && (() => {
                        const currentDue = editingCustomerBalance.currentDue;
                        const dueAfter = Math.max(0, currentDue - Math.max(0, Number(editingAmount || 0)));
                        return <div>Due: {formatMoneyPrecise(currentDue)} → {formatMoneyPrecise(dueAfter)}</div>;
                      })()}
                    </div>
                  )}
                  {editingAuditPreview && (
                    <div className="rounded-md border p-2.5 space-y-1.5 text-[13px] bg-muted/10">
                      <div className="font-semibold text-[14px]">Edit impact (audit preview)</div>
                      <div>Stock effect: {editingAuditPreview.cashbookDelta.cogsEffect === 0 ? 'No stock-value change' : `${editingAuditPreview.cashbookDelta.cogsEffect > 0 ? '+' : '-'}${formatMoneyPrecise(Math.abs(editingAuditPreview.cashbookDelta.cogsEffect))} COGS delta`}</div>
                      <div>Current due: {editingAuditPreview.cashbookDelta.currentDueEffect >= 0 ? '+' : '-'}{formatMoneyPrecise(Math.abs(editingAuditPreview.cashbookDelta.currentDueEffect))}</div>
                      <div>Store credit: {editingAuditPreview.cashbookDelta.currentStoreCreditEffect >= 0 ? '+' : '-'}{formatMoneyPrecise(Math.abs(editingAuditPreview.cashbookDelta.currentStoreCreditEffect))}</div>
                      <div>Cash movement: {editingAuditPreview.cashbookDelta.netCashEffect >= 0 ? '+' : '-'}{formatMoneyPrecise(Math.abs(editingAuditPreview.cashbookDelta.netCashEffect))}</div>
                      <div>Online movement: {((editingAuditPreview.cashbookDelta.onlineIn || 0) - (editingAuditPreview.cashbookDelta.onlineOut || 0)) >= 0 ? '+' : '-'}{formatMoneyPrecise(Math.abs((editingAuditPreview.cashbookDelta.onlineIn || 0) - (editingAuditPreview.cashbookDelta.onlineOut || 0)))}</div>
                      <div>Revenue delta: {editingAuditPreview.cashbookDelta.netSales >= 0 ? '+' : '-'}{formatMoneyPrecise(Math.abs(editingAuditPreview.cashbookDelta.netSales))}</div>
                      <div>Gross profit delta: {editingAuditPreview.cashbookDelta.grossProfitEffect >= 0 ? '+' : '-'}{formatMoneyPrecise(Math.abs(editingAuditPreview.cashbookDelta.grossProfitEffect))}</div>
                      {!!editingAuditPreview.changeSummary && <div className="text-[12px] text-muted-foreground">{editingAuditPreview.changeSummary}</div>}
                      {editingTx.customerId !== editingCustomerId && (
                        <div className="rounded border bg-white p-2 text-[12px]">
                          Customer impact: old customer effect will be removed, and new customer effect will be applied during reconcile.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="border-t pt-3 flex gap-2">
                <Button variant="outline" onClick={closeTransactionEditor} disabled={isSavingTransaction}>Cancel</Button>
                <Button variant="outline" onClick={() => void handleSaveTransaction(true)} disabled={isSavingTransaction}>
                  {isSavingTransaction ? 'Saving...' : remainingBatchTransactions > 0 ? `Update & Next (${remainingBatchTransactions} left)` : 'Update & Next'}
                </Button>
                <Button onClick={() => void handleSaveTransaction(false)} disabled={isSavingTransaction}>{isSavingTransaction ? 'Saving...' : 'Save'}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {editingTx?.type === 'sale' && isProductPickerOpen && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-4">
          <Card className="w-full max-w-5xl max-h-[90vh] overflow-hidden">
            <CardHeader className="border-b py-3 flex flex-row items-center justify-between gap-2">
              <CardTitle>Select Product</CardTitle>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsProductPickerOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="p-3 space-y-3 overflow-y-auto max-h-[calc(90vh-136px)]">
              <div className="sticky top-0 z-10 bg-background pb-2">
                <Input
                  value={productPickerSearch}
                  onChange={(e) => setProductPickerSearch(e.target.value)}
                  placeholder="Search products by name, SKU, barcode, category..."
                />
              </div>
              {filteredProductsForPicker.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No products found</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredProductsForPicker.map((product) => {
                    const qty = Math.max(1, Math.floor(productPickerQuantities[product.id] || 1));
                    const imageSrc = getProductPickerImage(product);
                    const isOutOfStock = Number(product.stock || 0) <= 0;
                    return (
                      <div key={product.id} className="rounded-md border p-2.5 space-y-2">
                        <div className="flex gap-2">
                          <div className="h-14 w-14 rounded border bg-muted overflow-hidden shrink-0">
                            {imageSrc ? <img src={imageSrc} alt={getProductName(product)} className="h-full w-full object-cover" /> : <Package className="w-full h-full p-2 opacity-30" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm truncate">{getProductName(product)}</div>
                            <div className="text-xs text-muted-foreground truncate">{(product as any).sku || getProductBarcode(product, 'No SKU/Barcode')}</div>
                            <div className="text-xs text-muted-foreground truncate">{getProductCategory(product)}</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold">{formatMoneyPrecise(product.sellPrice || 0)}</span>
                          <span className={isOutOfStock ? 'text-red-600 text-xs font-medium' : 'text-muted-foreground text-xs'}>{isOutOfStock ? 'Out of Stock' : `Stock: ${product.stock || 0}`}</span>
                        </div>
                        <div className="grid grid-cols-[auto_60px_auto_1fr] gap-1.5 items-center">
                          <Button type="button" variant="outline" className="h-8 px-2" onClick={() => updateProductPickerQty(product.id, qty - 1)}>-</Button>
                          <Input type="number" min="1" value={qty} className="h-8 px-2 text-center" onChange={(e) => updateProductPickerQty(product.id, Number(e.target.value || 1))} />
                          <Button type="button" variant="outline" className="h-8 px-2" onClick={() => updateProductPickerQty(product.id, qty + 1)}>+</Button>
                          <Button type="button" className="h-8" onClick={() => addProductFromPicker(product)} disabled={isOutOfStock}>
                            {recentlyAddedProductId === product.id ? 'Added' : 'Add'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="border-t pt-2 flex justify-end">
                <Button type="button" onClick={() => setIsProductPickerOpen(false)}>Done</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isInvoiceOptionsOpen && txToExport && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md shadow-2xl">
            <CardHeader className="border-b pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Export Invoice</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Choose how you want to generate or send invoice #{getTransactionReference(txToExport)}.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeInvoiceOptions} className="h-8 w-8">
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="p-5 space-y-3">
              <Button className="w-full justify-start h-11" variant="outline" onClick={() => void handleInvoiceOption('a4')}>
                <FileText className="mr-2 h-4 w-4" />
                Download A4 Size Standard Invoice
              </Button>
              <Button className="w-full justify-start h-11" variant="outline" onClick={() => void handleInvoiceOption('thermal')}>
                <Download className="mr-2 h-4 w-4" />
                Print Thermal Invoice
              </Button>
              <Button className="w-full justify-start h-11" variant="outline" onClick={() => void handleInvoiceOption('whatsapp')}>
                <Download className="mr-2 h-4 w-4" />
                Send Invoice via WhatsApp
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={isBatchDeleteConfirmOpen}
        title="Delete selected transactions?"
        message={`Delete ${selectedTransactions.length} selected transaction${selectedTransactions.length > 1 ? 's' : ''}? This action will move selected transactions to the bin/history according to the existing delete flow.`}
        onCancel={() => setIsBatchDeleteConfirmOpen(false)}
        onConfirm={confirmBatchDeleteTransactions}
      />
    </div>
  );
}
  const toLocalDateTimeInputValue = (iso: string) => {
    const date = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

import {
  buildUpfrontOrderLedgerEffects,
  getCanonicalReturnAllocation,
  getSaleSettlementBreakdown,
} from "./storage";
import type {
  AppState,
  CashSession,
  CashSource,
  DeleteCompensationRecord,
  DeletedTransactionRecord,
  Expense,
  Transaction,
} from "../types";

const toFiniteMoney = (value: unknown) => {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number(value);

  return Number.isFinite(numeric) ? numeric : 0;
};

const roundMoney = (value: unknown) =>
  Math.round((toFiniteMoney(value) + Number.EPSILON) * 100) / 100;

const normalizeCashSource = (rawSource: unknown): CashSource =>
  String(rawSource || "").trim().toLowerCase() === "reserve"
    ? "reserve"
    : "drawer";

const shouldAffectActiveDrawerFromSource = (rawSource: unknown) =>
  normalizeCashSource(rawSource) !== "reserve";

const shouldReduceReserveFromSource = (rawSource: unknown) =>
  normalizeCashSource(rawSource) === "reserve";

const isExplicitDeleteRefund = (record: DeleteCompensationRecord) =>
  record?.isExplicitRefund === true ||
  record?.refundConfirmed === true ||
  record?.source === "explicit_refund";

const isSaleLikeTx = (tx: Transaction) => {
  const type = String(tx.type || "").trim().toLowerCase();
  return type === "sale" || type === "historical_reference";
};

const getExpenseEffectiveDate = (expense: Expense) =>
  expense.effectiveAt || expense.createdAt;

const getTimestampFromTransactionId = (transactionId: string) => {
  const asNumber = Number(transactionId);

  if (!Number.isFinite(asNumber)) {
    return Number.NaN;
  }

  if (asNumber < 946684800000 || asNumber > 4102444800000) {
    return Number.NaN;
  }

  return asNumber;
};

const resolveTransactionTime = (transaction: Transaction) => {
  const effectiveMs = new Date(transaction.effectiveAt || "").getTime();

  if (Number.isFinite(effectiveMs)) {
    return effectiveMs;
  }

  const transactionDateMs = new Date(transaction.date || "").getTime();

  if (Number.isFinite(transactionDateMs)) {
    return transactionDateMs;
  }

  const idMs = getTimestampFromTransactionId(transaction.id);

  if (Number.isFinite(idMs)) {
    return idMs;
  }

  return Number.NaN;
};

const getSupplierPaymentMethod = (rawMethod: unknown): "cash" | "non_cash" => {
  const method = String(rawMethod || "").trim().toLowerCase();

  if (method === "cash") return "cash";
  if (method === "online" || method === "bank") return "non_cash";
  return "cash";
};

const getSupplierPaymentTimestamp = (payment: Record<string, unknown>) => {
  const at = new Date(
    String(
      payment.paidAt ||
        payment.paymentDate ||
        payment.date ||
        payment.createdAt ||
        "",
    ),
  ).getTime();

  return Number.isFinite(at) ? at : Number.NaN;
};

const isWithinWindow = (at: number, start: number, end: number) =>
  Number.isFinite(at) && at >= start && at <= end;

const getScopedReserveLedger = (
  session: CashSession,
  predicate: (entry: NonNullable<CashSession["reserveCashLedger"]>[number], at: number) => boolean,
) => {
  const ledger = Array.isArray(session.reserveCashLedger)
    ? session.reserveCashLedger
    : [];

  return ledger.filter((entry) => {
    const at = new Date(entry.date || "").getTime();
    const amount = Number(entry.amount || 0);
    const type = String(entry.type || "").trim().toLowerCase();

    return (
      Number.isFinite(at) &&
      Number.isFinite(amount) &&
      amount > 0 &&
      (type === "in" || type === "out") &&
      predicate(entry, at)
    );
  });
};

const sumReserveTransferDeltaForReserve = (
  session: CashSession,
  sessionStartMs: number,
  targetMs: number,
) =>
  roundMoney(
    getScopedReserveLedger(
      session,
      (_entry, at) => isWithinWindow(at, sessionStartMs, targetMs),
    ).reduce((balance, entry) => {
      const amount = Math.max(0, Number(entry.amount || 0));
      return String(entry.type).trim().toLowerCase() === "in"
        ? balance + amount
        : balance - amount;
    }, 0),
  );

const sumReserveTransferDeltaForActive = (
  session: CashSession,
  sessionStartMs: number,
  targetMs: number,
) => roundMoney(-sumReserveTransferDeltaForReserve(session, sessionStartMs, targetMs));

const getExplicitDeletedSaleCashIncluded = (
  deletedTransactions: DeletedTransactionRecord[],
  deleteCompensations: DeleteCompensationRecord[],
  sessionStartMs: number,
  targetMs: number,
) => {
  const deletedByOriginalId = new Map<string, DeletedTransactionRecord>(
    (deletedTransactions || []).map((record) => [
      String(record.originalTransactionId || record.originalTransaction?.id || ""),
      record,
    ]),
  );

  return roundMoney(
    (deleteCompensations || [])
      .filter((record) => isExplicitDeleteRefund(record))
      .reduce((sum, record) => {
        const eventTime = new Date(record.createdAt || "").getTime();

        if (!isWithinWindow(eventTime, sessionStartMs, targetMs)) {
          return sum;
        }

        const linkedDeleted = deletedByOriginalId.get(String(record.transactionId || ""));
        const original = linkedDeleted?.originalTransaction;

        if (!original || !isSaleLikeTx(original)) {
          return sum;
        }

        const settlement = getSaleSettlementBreakdown(original);
        return sum + Math.max(0, Number(settlement.cashPaid || 0));
      }, 0),
  );
};

const getCashRefundAmount = (transaction: Transaction) => {
  try {
    const allocation = getCanonicalReturnAllocation(transaction, [], 0);
    return Math.max(0, Number(allocation.cashRefund || 0));
  } catch {
    return 0;
  }
};

const getStateCollections = (state: AppState) => ({
  transactions: Array.isArray(state.transactions) ? state.transactions : [],
  expenses: Array.isArray(state.expenses) ? state.expenses : [],
  cashAdjustments: Array.isArray(state.cashAdjustments) ? state.cashAdjustments : [],
  deleteCompensations: Array.isArray(state.deleteCompensations)
    ? state.deleteCompensations
    : [],
  deletedTransactions: Array.isArray(state.deletedTransactions)
    ? state.deletedTransactions
    : [],
  purchaseOrders: Array.isArray(state.purchaseOrders) ? state.purchaseOrders : [],
  manualCashbookEntries: Array.isArray(state.manualCashbookEntries)
    ? state.manualCashbookEntries
    : [],
  upfrontOrders: Array.isArray(state.upfrontOrders) ? state.upfrontOrders : [],
  customers: Array.isArray(state.customers) ? state.customers : [],
  supplierPayments: Array.isArray((state as AppState & { supplierPayments?: unknown[] }).supplierPayments)
    ? (((state as AppState & { supplierPayments?: unknown[] }).supplierPayments ||
        []) as Array<Record<string, unknown>>)
    : [],
});

export const getAvailableCashAt = (
  source: CashSource,
  eventTime: string,
  state: AppState,
  openSession?: CashSession | null,
) => {
  if (!openSession) {
    return 0;
  }

  const sessionStartMs = new Date(openSession.startTime || "").getTime();
  const targetMs = new Date(eventTime || "").getTime();

  if (!Number.isFinite(sessionStartMs) || !Number.isFinite(targetMs)) {
    return 0;
  }

  if (targetMs < sessionStartMs) {
    return 0;
  }

  const {
    transactions,
    expenses,
    cashAdjustments,
    deleteCompensations,
    deletedTransactions,
    purchaseOrders,
    manualCashbookEntries,
    upfrontOrders,
    customers,
    supplierPayments,
  } = getStateCollections(state);

  const scopedTransactions = transactions.filter((transaction) =>
    isWithinWindow(resolveTransactionTime(transaction), sessionStartMs, targetMs),
  );

  const scopedExpenses = expenses.filter((expense) =>
    isWithinWindow(
      new Date(getExpenseEffectiveDate(expense) || "").getTime(),
      sessionStartMs,
      targetMs,
    ),
  );

  const scopedCashAdjustments = cashAdjustments.filter((entry) =>
    isWithinWindow(
      new Date(entry.effectiveAt || entry.createdAt || "").getTime(),
      sessionStartMs,
      targetMs,
    ),
  );

  const scopedManualCashbookEntries = manualCashbookEntries.filter((entry) => {
    if (entry?.isDeleted) {
      return false;
    }

    return isWithinWindow(
      new Date(entry.date || entry.createdAt || "").getTime(),
      sessionStartMs,
      targetMs,
    );
  });

  const explicitDeletedSaleCashIncluded = getExplicitDeletedSaleCashIncluded(
    deletedTransactions,
    deleteCompensations,
    sessionStartMs,
    targetMs,
  );

  const deleteCompensationOutflow = roundMoney(
    deleteCompensations
      .filter((record) => isExplicitDeleteRefund(record))
      .reduce((sum, record) => {
        const at = new Date(record.createdAt || "").getTime();
        if (!isWithinWindow(at, sessionStartMs, targetMs)) {
          return sum;
        }

        return sum + Math.max(0, Number(record.amount || 0));
      }, 0),
  );

  const saleCashInflows = roundMoney(
    scopedTransactions
      .filter((transaction) => isSaleLikeTx(transaction))
      .reduce((sum, transaction) => {
        const settlement = getSaleSettlementBreakdown(transaction);
        return sum + Math.max(0, Number(settlement.cashPaid || 0));
      }, 0),
  );

  const customerCashCollections = roundMoney(
    scopedTransactions
      .filter(
        (transaction) =>
          transaction.type === "payment" && transaction.paymentMethod === "Cash",
      )
      .reduce((sum, transaction) => sum + Math.abs(Number(transaction.total || 0)), 0),
  );

  const customOrderCashInflows = roundMoney(
    buildUpfrontOrderLedgerEffects(upfrontOrders, customers)
      .filter(
        (effect) =>
          effect.type === "custom_order_payment" &&
          effect.isLegacyInfoOnly !== true &&
          Math.max(0, Number(effect.cashIn || 0)) > 0,
      )
      .filter((effect) =>
        isWithinWindow(new Date(effect.date || "").getTime(), sessionStartMs, targetMs),
      )
      .reduce((sum, effect) => sum + Math.max(0, Number(effect.cashIn || 0)), 0),
  );

  const cashAdditionInflows = roundMoney(
    scopedCashAdjustments
      .filter((entry) => entry.type === "cash_addition")
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount || 0)), 0),
  );

  const manualCashInInflows = roundMoney(
    scopedManualCashbookEntries
      .filter((entry) => entry.type === "cash_in")
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount || 0)), 0),
  );

  const cashRefundOutflows = roundMoney(
    scopedTransactions
      .filter(
        (transaction) =>
          transaction.type === "return" &&
          shouldAffectActiveDrawerFromSource((transaction as Transaction & { cashSource?: unknown }).cashSource),
      )
      .reduce((sum, transaction) => sum + getCashRefundAmount(transaction), 0),
  );

  const reserveCashRefundOutflows = roundMoney(
    scopedTransactions
      .filter(
        (transaction) =>
          transaction.type === "return" &&
          shouldReduceReserveFromSource((transaction as Transaction & { cashSource?: unknown }).cashSource),
      )
      .reduce((sum, transaction) => sum + getCashRefundAmount(transaction), 0),
  );

  const activeCustomerCashOutflows = roundMoney(
    scopedTransactions
      .filter(
        (transaction) =>
          transaction.type === "customer_cash_out" &&
          transaction.paymentMethod === "Cash" &&
          shouldAffectActiveDrawerFromSource((transaction as Transaction & { cashSource?: unknown }).cashSource),
      )
      .reduce((sum, transaction) => sum + Math.abs(Number(transaction.total || 0)), 0),
  );

  const reserveCustomerCashOutflows = roundMoney(
    scopedTransactions
      .filter(
        (transaction) =>
          transaction.type === "customer_cash_out" &&
          transaction.paymentMethod === "Cash" &&
          shouldReduceReserveFromSource((transaction as Transaction & { cashSource?: unknown }).cashSource),
      )
      .reduce((sum, transaction) => sum + Math.abs(Number(transaction.total || 0)), 0),
  );

  const activeExpenseOutflows = roundMoney(
    scopedExpenses
      .filter((expense) => shouldAffectActiveDrawerFromSource(expense.cashSource))
      .reduce((sum, expense) => sum + Math.max(0, Number(expense.amount || 0)), 0),
  );

  const reserveExpenseOutflows = roundMoney(
    scopedExpenses
      .filter((expense) => shouldReduceReserveFromSource(expense.cashSource))
      .reduce((sum, expense) => sum + Math.max(0, Number(expense.amount || 0)), 0),
  );

  const activeCashWithdrawalOutflows = roundMoney(
    scopedCashAdjustments
      .filter((entry) => entry.type === "cash_withdrawal")
      .filter((entry) => shouldAffectActiveDrawerFromSource(entry.cashSource))
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount || 0)), 0),
  );

  const reserveCashWithdrawalOutflows = roundMoney(
    scopedCashAdjustments
      .filter((entry) => entry.type === "cash_withdrawal")
      .filter((entry) => shouldReduceReserveFromSource(entry.cashSource))
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount || 0)), 0),
  );

  const activeManualCashOutflows = roundMoney(
    scopedManualCashbookEntries
      .filter((entry) => entry.type === "cash_out")
      .filter((entry) => shouldAffectActiveDrawerFromSource(entry.cashSource))
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount || 0)), 0),
  );

  const reserveManualCashOutflows = roundMoney(
    scopedManualCashbookEntries
      .filter((entry) => entry.type === "cash_out")
      .filter((entry) => shouldReduceReserveFromSource(entry.cashSource))
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount || 0)), 0),
  );

  const activeSupplierPaymentOutflows = roundMoney(
    supplierPayments.reduce((sum, payment) => {
      const at = getSupplierPaymentTimestamp(payment);
      const amount = Math.max(0, Number(payment.amount || payment.total || 0));
      const isDeleted = Boolean(payment.deletedAt || payment.isDeleted === true);

      if (
        !isWithinWindow(at, sessionStartMs, targetMs) ||
        isDeleted ||
        getSupplierPaymentMethod(payment.method) !== "cash" ||
        !shouldAffectActiveDrawerFromSource(payment.cashSource) ||
        amount <= 0
      ) {
        return sum;
      }

      return sum + amount;
    }, 0),
  );

  const reserveSupplierPaymentOutflows = roundMoney(
    supplierPayments.reduce((sum, payment) => {
      const at = getSupplierPaymentTimestamp(payment);
      const amount = Math.max(0, Number(payment.amount || payment.total || 0));
      const isDeleted = Boolean(payment.deletedAt || payment.isDeleted === true);

      if (
        !isWithinWindow(at, sessionStartMs, targetMs) ||
        isDeleted ||
        getSupplierPaymentMethod(payment.method) !== "cash" ||
        !shouldReduceReserveFromSource(payment.cashSource) ||
        amount <= 0
      ) {
        return sum;
      }

      return sum + amount;
    }, 0),
  );

  const activeLegacySupplierPaymentOutflows = roundMoney(
    purchaseOrders.reduce(
      (sum, order) =>
        sum +
        (order.paymentHistory || []).reduce((inner, payment) => {
          if (payment?.supplierPaymentId) {
            return inner;
          }

          const at = new Date(payment.paidAt || "").getTime();
          if (
            !isWithinWindow(at, sessionStartMs, targetMs) ||
            getSupplierPaymentMethod(payment.method) !== "cash" ||
            !shouldAffectActiveDrawerFromSource(payment.cashSource)
          ) {
            return inner;
          }

          return inner + Math.max(0, Number(payment.amount || 0));
        }, 0),
      0,
    ),
  );

  const reserveLegacySupplierPaymentOutflows = roundMoney(
    purchaseOrders.reduce(
      (sum, order) =>
        sum +
        (order.paymentHistory || []).reduce((inner, payment) => {
          if (payment?.supplierPaymentId) {
            return inner;
          }

          const at = new Date(payment.paidAt || "").getTime();
          if (
            !isWithinWindow(at, sessionStartMs, targetMs) ||
            getSupplierPaymentMethod(payment.method) !== "cash" ||
            !shouldReduceReserveFromSource(payment.cashSource)
          ) {
            return inner;
          }

          return inner + Math.max(0, Number(payment.amount || 0));
        }, 0),
      0,
    ),
  );

  if (normalizeCashSource(source) === "reserve") {
    const reserveTransferDelta = sumReserveTransferDeltaForReserve(
      openSession,
      sessionStartMs,
      targetMs,
    );

    return roundMoney(
      Math.max(
        0,
        reserveTransferDelta -
          reserveCashRefundOutflows -
          reserveCustomerCashOutflows -
          reserveExpenseOutflows -
          reserveCashWithdrawalOutflows -
          reserveManualCashOutflows -
          reserveSupplierPaymentOutflows -
          reserveLegacySupplierPaymentOutflows,
      ),
    );
  }

  const activeTransferDelta = sumReserveTransferDeltaForActive(
    openSession,
    sessionStartMs,
    targetMs,
  );

  return roundMoney(
    Math.max(
      0,
      Number(openSession.openingBalance || 0) +
        saleCashInflows +
        explicitDeletedSaleCashIncluded +
        customerCashCollections +
        customOrderCashInflows +
        cashAdditionInflows +
        manualCashInInflows +
        activeTransferDelta -
        cashRefundOutflows -
        activeCustomerCashOutflows -
        deleteCompensationOutflow -
        activeExpenseOutflows -
        activeCashWithdrawalOutflows -
        activeManualCashOutflows -
        activeSupplierPaymentOutflows -
        activeLegacySupplierPaymentOutflows,
    ),
  );
};

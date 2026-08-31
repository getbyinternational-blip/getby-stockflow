import { describe, expect, it } from "vitest";
import type { AppState, CashSession, CashSource } from "../types";
import { getAvailableCashAt } from "./cashAvailability";

const buildState = (overrides: Partial<AppState> = {}): AppState =>
  ({
    products: [],
    transactions: [],
    deletedTransactions: [],
    deleteCompensations: [],
    updatedTransactionEvents: [],
    categories: [],
    customers: [],
    profile: {} as AppState["profile"],
    upfrontOrders: [],
    cashSessions: [],
    expenses: [],
    expenseCategories: [],
    expenseActivities: [],
    cashAdjustments: [],
    purchaseOrders: [],
    manualCashbookEntries: [],
    supplierPayments: [],
    ...overrides,
  }) as AppState;

const buildSession = (overrides: Partial<CashSession> = {}): CashSession => ({
  id: "session-1",
  startTime: "2026-08-30T10:00:00.000Z",
  openingBalance: 0,
  status: "open",
  ...overrides,
});

const available = (
  source: CashSource,
  eventTime: string,
  state: AppState,
  session: CashSession,
) => getAvailableCashAt(source, eventTime, state, session);

describe("getAvailableCashAt", () => {
  it("ignores inherited reserve-ledger entries before the current shift for both buckets", () => {
    const session = buildSession({
      openingBalance: 500,
      reserveCashLedger: [
        {
          id: "prev-reserve",
          date: "2026-08-30T09:00:00.000Z",
          type: "in",
          amount: 4000,
          note: "Reserve carried from previous shift",
        },
      ],
    });

    const state = buildState();

    expect(available("drawer", "2026-08-30T11:00:00.000Z", state, session)).toBe(
      500,
    );
    expect(available("reserve", "2026-08-30T11:00:00.000Z", state, session)).toBe(0);
  });

  it("does not let a future inflow fund an earlier expense timestamp", () => {
    const session = buildSession({ openingBalance: 1000 });
    const state = buildState({
      cashAdjustments: [
        {
          id: "future-cash-in",
          type: "cash_addition",
          amount: 1500,
          createdAt: "2026-08-30T11:00:00.000Z",
        },
      ],
    });

    expect(available("drawer", "2026-08-30T10:30:00.000Z", state, session)).toBe(
      1000,
    );
    expect(available("drawer", "2026-08-30T11:30:00.000Z", state, session)).toBe(
      2500,
    );
  });

  it("ignores reserve-to-active transfers that happen after the target time", () => {
    const session = buildSession({
      openingBalance: 100,
      reserveCashLedger: [
        {
          id: "prior-reserve",
          date: "2026-08-30T09:00:00.000Z",
          type: "in",
          amount: 2000,
        },
        {
          id: "later-out",
          date: "2026-08-30T12:00:00.000Z",
          type: "out",
          amount: 500,
          note: "Added back to shift",
        },
      ],
    });

    const state = buildState();

    expect(available("drawer", "2026-08-30T11:00:00.000Z", state, session)).toBe(
      100,
    );
    expect(available("drawer", "2026-08-30T12:30:00.000Z", state, session)).toBe(
      600,
    );
  });

  it("ignores active-to-reserve transfers that happen after the target time", () => {
    const session = buildSession({
      openingBalance: 1000,
      reserveCashLedger: [
        {
          id: "later-in",
          date: "2026-08-30T12:00:00.000Z",
          type: "in",
          amount: 300,
          note: "Reserve top-up",
        },
      ],
    });

    const state = buildState();

    expect(available("drawer", "2026-08-30T11:00:00.000Z", state, session)).toBe(
      1000,
    );
    expect(available("drawer", "2026-08-30T12:30:00.000Z", state, session)).toBe(
      700,
    );
  });

  it("rejects an active-cash expense that is only affordable after later events", () => {
    const session = buildSession({ openingBalance: 1000 });
    const state = buildState({
      cashAdjustments: [
        {
          id: "later-cash-in",
          type: "cash_addition",
          amount: 2500,
          createdAt: "2026-08-30T12:00:00.000Z",
        },
      ],
    });

    const availableAtExpenseTime = available(
      "drawer",
      "2026-08-30T10:15:00.000Z",
      state,
      session,
    );

    expect(availableAtExpenseTime).toBe(1000);
    expect(2000).toBeGreaterThan(availableAtExpenseTime);
    expect(available("drawer", "2026-08-30T12:30:00.000Z", state, session)).toBe(
      3500,
    );
  });

  it("keeps active closing, expense checks, and withdrawal checks on the same canonical calculation", () => {
    const session = buildSession({
      openingBalance: 2000,
      reserveCashLedger: [
        {
          id: "to-reserve",
          date: "2026-08-30T10:30:00.000Z",
          type: "in",
          amount: 500,
          note: "Reserve top-up",
        },
      ],
    });

    const state = buildState({
      expenses: [
        {
          id: "exp-1",
          title: "Packing",
          amount: 300,
          category: "General",
          cashSource: "drawer",
          createdAt: "2026-08-30T11:00:00.000Z",
          effectiveAt: "2026-08-30T11:00:00.000Z",
        },
      ],
      cashAdjustments: [
        {
          id: "withdraw-1",
          type: "cash_withdrawal",
          amount: 200,
          cashSource: "drawer",
          createdAt: "2026-08-30T11:30:00.000Z",
          effectiveAt: "2026-08-30T11:30:00.000Z",
        },
      ],
    });

    const now = "2026-08-30T12:00:00.000Z";
    const canonicalActive = available("drawer", now, state, session);

    expect(canonicalActive).toBe(1000);
    expect(available("drawer", now, state, session)).toBe(canonicalActive);
    expect(available("reserve", now, state, session)).toBe(500);
  });
});

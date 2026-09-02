import { AppState, CashSession } from '../types';
import { getAvailableCashAt } from './cashAvailability';
import { loadData, safeFinancePersistState } from './storage';

const roundMoney = (value: number) =>
  Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

const getDateKey = (iso?: string) => {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTodayStartIso = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
};

const getLocalDayEndIso = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).toISOString();
};

const getSessionCarryForward = (session?: CashSession | null) =>
  roundMoney(Number(session?.carryForwardBalance ?? session?.closingBalance ?? session?.openingBalance ?? 0));

const getLatestClosedSession = (sessions: CashSession[]) =>
  sessions
    .filter((session) => session.status === 'closed' && !session.deletedAt)
    .sort((a, b) => new Date(b.endTime || b.startTime).getTime() - new Date(a.endTime || a.startTime).getTime())[0] || null;

export const isSimplifiedShiftAccessEnabled = (state: Pick<AppState, 'profile'> | AppState) =>
  Boolean(state.profile?.simplifiedShiftAccess);

export const ensureSimplifiedShiftForToday = async (
  options: { reason?: string } = {}
): Promise<{ state: AppState; changed: boolean; openSession: CashSession | null }> => {
  const state = loadData();
  const sessions = Array.isArray(state.cashSessions) ? state.cashSessions : [];

  if (!isSimplifiedShiftAccessEnabled(state)) {
    return {
      state,
      changed: false,
      openSession: sessions.find((session) => session.status === 'open' && !session.deletedAt) || null,
    };
  }

  const todayKey = getDateKey();
  const openToday = sessions.find(
    (session) => session.status === 'open' && !session.deletedAt && getDateKey(session.startTime) === todayKey
  );

  if (openToday) {
    return { state, changed: false, openSession: openToday };
  }

  const closedSessions = sessions.map((session) => {
    if (session.status !== 'open' || session.deletedAt) return session;

    const endTime = getLocalDayEndIso(session.startTime);
    const closingBalance = roundMoney(getAvailableCashAt('drawer', endTime, state, session));
    const movement = roundMoney(closingBalance - Number(session.openingBalance || 0));

    return {
      ...session,
      endTime,
      closingBalance,
      activeSystemCashTotal: movement,
      systemCashTotal: movement,
      reservedCashOnHand: 0,
      carryForwardBalance: closingBalance,
      difference: 0,
      closedWithDifference: false,
      differenceAmount: 0,
      status: 'closed' as const,
    };
  });

  const openingBalance = getSessionCarryForward(getLatestClosedSession(closedSessions));
  const startTime = getTodayStartIso();
  const newSession: CashSession = {
    id: `cash-session-${Date.now()}`,
    startTime,
    openingBalance,
    reservedCashOnHand: 0,
    status: 'open',
  };

  await safeFinancePersistState(
    { cashSessions: [newSession, ...closedSessions] },
    { reason: options.reason || 'simplifiedShift.ensureToday' }
  );

  return {
    state: loadData(),
    changed: true,
    openSession: newSession,
  };
};

export const saveSimplifiedShiftNote = async (sessionId: string, note: string): Promise<AppState> => {
  const state = loadData();
  const trimmedNote = note.trim();
  const cashSessions = (Array.isArray(state.cashSessions) ? state.cashSessions : []).map((session) =>
    session.id === sessionId
      ? {
          ...session,
          closingEditNote: trimmedNote || undefined,
        }
      : session
  );

  await safeFinancePersistState(
    { cashSessions },
    { reason: 'simplifiedShift.saveNote' }
  );

  return loadData();
};

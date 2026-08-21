export type TransactionsFilterType =
  | 'today'
  | 'yesterday'
  | '7days'
  | '15days'
  | '30days'
  | 'thismonth'
  | '6months'
  | '1year'
  | 'all'
  | 'custom';

export type TransactionSearchRow = {
  id: string;
  businessDayStartMs: number;
  sortDateMs: number;
  reserveFirst: boolean;
  searchText: string;
};

export type TransactionFilterRequest = {
  filterType: TransactionsFilterType;
  customEnd?: string;
  customStart?: string;
  query: string;
  requestId: number;
  rows: TransactionSearchRow[];
};

export type TransactionFilterResult = {
  durationMs: number;
  matchingIds: string[];
  requestId: number;
};

const matchesDateFilter = (
  businessDayStartMs: number,
  filterType: TransactionsFilterType,
  customStart?: string,
  customEnd?: string,
) => {
  if (!Number.isFinite(businessDayStartMs)) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  switch (filterType) {
    case 'today':
      return businessDayStartMs === now.getTime();
    case 'yesterday': {
      const yest = new Date(now);
      yest.setDate(yest.getDate() - 1);
      return businessDayStartMs === yest.getTime();
    }
    case '7days': {
      const week = new Date(now);
      week.setDate(week.getDate() - 7);
      return businessDayStartMs >= week.getTime();
    }
    case '15days': {
      const days15 = new Date(now);
      days15.setDate(days15.getDate() - 15);
      return businessDayStartMs >= days15.getTime();
    }
    case '30days': {
      const days30 = new Date(now);
      days30.setDate(days30.getDate() - 30);
      return businessDayStartMs >= days30.getTime();
    }
    case 'thismonth': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      monthStart.setHours(0, 0, 0, 0);
      return businessDayStartMs >= monthStart.getTime();
    }
    case '6months': {
      const months6 = new Date(now);
      months6.setMonth(months6.getMonth() - 6);
      return businessDayStartMs >= months6.getTime();
    }
    case '1year': {
      const year1 = new Date(now);
      year1.setFullYear(year1.getFullYear() - 1);
      return businessDayStartMs >= year1.getTime();
    }
    case 'all':
      return true;
    case 'custom': {
      const customStartMs = customStart ? new Date(`${customStart}T00:00:00`).getTime() : Number.NaN;
      const customEndMs = customEnd ? new Date(`${customEnd}T23:59:59.999`).getTime() : Number.NaN;
      if (Number.isFinite(customStartMs) && businessDayStartMs < customStartMs) return false;
      if (Number.isFinite(customEndMs) && businessDayStartMs > customEndMs) return false;
      return true;
    }
    default:
      return true;
  }
};

export const computeFilteredTransactionIds = (request: TransactionFilterRequest): TransactionFilterResult => {
  const startedAt = performance.now();
  const normalizedQuery = request.query.trim().toLowerCase();
  const matchingIds = request.rows
    .filter((row) => matchesDateFilter(row.businessDayStartMs, request.filterType, request.customStart, request.customEnd))
    .filter((row) => !normalizedQuery || row.searchText.includes(normalizedQuery))
    .sort((left, right) => {
      if (left.reserveFirst !== right.reserveFirst) return left.reserveFirst ? -1 : 1;
      if (left.sortDateMs !== right.sortDateMs) return right.sortDateMs - left.sortDateMs;
      return left.id.localeCompare(right.id);
    })
    .map((row) => row.id);

  return {
    requestId: request.requestId,
    matchingIds,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
};

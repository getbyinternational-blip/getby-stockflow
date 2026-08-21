import { computeFilteredTransactionIds, type TransactionFilterRequest } from '../services/transactionsFilter';

self.onmessage = (event: MessageEvent<TransactionFilterRequest>) => {
  try {
    const result = computeFilteredTransactionIds(event.data);
    self.postMessage(result);
  } catch (error) {
    self.postMessage({
      requestId: event.data.requestId,
      matchingIds: [],
      durationMs: -1,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};

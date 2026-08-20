const PERF_PREFIX = '[PERF]';
const LONG_TASK_THRESHOLD_MS = 50;
const WINDOW_OBSERVER_KEY = '__stockflowLongTaskObserverInstalled__';

type PerfDetail = Record<string, unknown>;

const roundDuration = (value: number) => Math.round(value * 100) / 100;

const getPerfNow = () => {
  if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
    return Date.now();
  }
  return performance.now();
};

export const PERF_ENABLED = Boolean((import.meta as any).env?.DEV) && typeof window !== 'undefined';

export const createPerfRunId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

export const perfLog = (label: string, detail: PerfDetail = {}) => {
  if (!PERF_ENABLED) return;
  console.log(PERF_PREFIX, label, detail);
};

export const perfMark = (markName: string, detail: PerfDetail = {}) => {
  if (!PERF_ENABLED) return;
  if (typeof performance?.mark === 'function') {
    performance.mark(markName);
  }
  if (Object.keys(detail).length > 0) {
    perfLog(`${markName}:mark`, detail);
  }
};

export const perfMeasureBetweenMarks = (
  measureName: string,
  startMark: string,
  endMark: string,
  detail: PerfDetail = {},
) => {
  if (!PERF_ENABLED || typeof performance?.measure !== 'function') return;
  if (typeof performance.mark === 'function') {
    performance.mark(endMark);
  }
  performance.measure(measureName, startMark, endMark);
  const entries = performance.getEntriesByName(measureName, 'measure');
  const latestEntry = entries[entries.length - 1];
  perfLog(measureName, {
    durationMs: roundDuration(latestEntry?.duration || 0),
    ...detail,
  });
  performance.clearMarks(startMark);
  performance.clearMarks(endMark);
  performance.clearMeasures(measureName);
};

export const perfMeasureSync = <T,>(
  label: string,
  fn: () => T,
  detail: PerfDetail = {},
): T => {
  if (!PERF_ENABLED) return fn();
  const start = getPerfNow();
  try {
    return fn();
  } finally {
    perfLog(label, {
      durationMs: roundDuration(getPerfNow() - start),
      ...detail,
    });
  }
};

export const perfMeasureAsync = async <T,>(
  label: string,
  fn: () => Promise<T>,
  detail: PerfDetail = {},
): Promise<T> => {
  if (!PERF_ENABLED) return fn();
  const start = getPerfNow();
  try {
    return await fn();
  } finally {
    perfLog(label, {
      durationMs: roundDuration(getPerfNow() - start),
      ...detail,
    });
  }
};

export const installLongTaskObserver = () => {
  if (!PERF_ENABLED) return;
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;

  const globalWindow = window as typeof window & { [WINDOW_OBSERVER_KEY]?: boolean };
  if (globalWindow[WINDOW_OBSERVER_KEY]) return;
  globalWindow[WINDOW_OBSERVER_KEY] = true;

  try {
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.duration < LONG_TASK_THRESHOLD_MS) return;
        perfLog('main-thread.longtask', {
          name: entry.name || 'longtask',
          entryType: entry.entryType,
          startTimeMs: roundDuration(entry.startTime),
          durationMs: roundDuration(entry.duration),
        });
      });
    });

    const supportedEntryTypes = typeof PerformanceObserver.supportedEntryTypes !== 'undefined'
      ? PerformanceObserver.supportedEntryTypes
      : [];
    if (supportedEntryTypes.includes('longtask')) {
      observer.observe({ entryTypes: ['longtask'] });
      perfLog('main-thread.longtask_observer_installed');
    }
  } catch (error) {
    perfLog('main-thread.longtask_observer_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

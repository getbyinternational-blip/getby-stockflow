import { useEffect, useMemo, useRef } from 'react';

type EscapeLayerEntry = {
  id: symbol;
  onClose: () => void;
  priority: number;
  order: number;
};

const escapeLayerStack: EscapeLayerEntry[] = [];
let nextEscapeLayerOrder = 1;
let isEscapeListenerAttached = false;

const removeEscapeLayerEntry = (id: symbol) => {
  const index = escapeLayerStack.findIndex((entry) => entry.id === id);
  if (index >= 0) escapeLayerStack.splice(index, 1);
};

const getTopEscapeLayer = (): EscapeLayerEntry | null => {
  if (!escapeLayerStack.length) return null;
  return [...escapeLayerStack].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.order - a.order;
  })[0] || null;
};

const ensureEscapeListener = () => {
  if (typeof window === 'undefined' || isEscapeListenerAttached) return;
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (event.defaultPrevented) return;
    const topLayer = getTopEscapeLayer();
    if (!topLayer) return;
    event.preventDefault();
    event.stopPropagation();
    topLayer.onClose();
  });
  isEscapeListenerAttached = true;
};

export const useEscapeLayer = (
  active: boolean,
  onClose: () => void,
  options?: { priority?: number }
) => {
  const id = useMemo(() => Symbol('escape-layer'), []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    ensureEscapeListener();
  }, []);

  useEffect(() => {
    removeEscapeLayerEntry(id);
    if (!active) return;
    escapeLayerStack.push({
      id,
      onClose: () => onCloseRef.current(),
      priority: options?.priority ?? 0,
      order: nextEscapeLayerOrder++,
    });
    return () => {
      removeEscapeLayerEntry(id);
    };
  }, [active, id, options?.priority]);
};

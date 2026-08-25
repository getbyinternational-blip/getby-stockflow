import React, { useEffect, useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import { formatMoneyWhole } from '../services/numberFormat';

type CustomerViewItem = {
  id: string;
  name: string;
  image?: string;
  sellPrice: number;
  quantity: number;
};

type CustomerViewPayload = {
  items: CustomerViewItem[];
  grandTotal: number;
  updatedAt: string;
};

const CUSTOMER_VIEW_STORAGE_KEY = 'stockflow_customer_view_payload';

const readPayload = (): CustomerViewPayload => {
  if (typeof window === 'undefined') {
    return { items: [], grandTotal: 0, updatedAt: '' };
  }
  try {
    const raw = window.localStorage.getItem(CUSTOMER_VIEW_STORAGE_KEY);
    if (!raw) return { items: [], grandTotal: 0, updatedAt: '' };
    const parsed = JSON.parse(raw) as CustomerViewPayload;
    return {
      items: Array.isArray(parsed?.items) ? parsed.items : [],
      grandTotal: Number(parsed?.grandTotal || 0),
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return { items: [], grandTotal: 0, updatedAt: '' };
  }
};

export default function CustomerView() {
  const [payload, setPayload] = useState<CustomerViewPayload>(() => readPayload());

  useEffect(() => {
    const sync = () => setPayload(readPayload());
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== CUSTOMER_VIEW_STORAGE_KEY) return;
      sync();
    };
    const handleCustomEvent = () => sync();
    window.addEventListener('storage', handleStorage);
    window.addEventListener('customer-view-cart-state', handleCustomEvent);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('customer-view-cart-state', handleCustomEvent);
    };
  }, []);

  const totalItems = useMemo(
    () => payload.items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0),
    [payload.items],
  );

  return (
    <div className="min-h-screen bg-slate-100 p-6 md:p-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-8 py-6 md:px-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Customer View</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">Current Bill</h1>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-500 md:text-lg">Items</div>
              <div className="text-2xl font-bold text-slate-950 md:text-4xl">{totalItems}</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 md:px-10">
          {payload.items.length === 0 ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
              <Package className="h-16 w-16 text-slate-300 md:h-20 md:w-20" />
              <div className="mt-6 text-2xl font-semibold text-slate-700 md:text-4xl">No products added yet</div>
              <div className="mt-3 text-base text-slate-500 md:text-2xl">As staff adds items in POS, they will appear here live.</div>
            </div>
          ) : (
            <div className="space-y-5">
              {payload.items.map((item) => (
                <div key={item.id} className="grid grid-cols-[96px_minmax(0,1fr)_140px_120px_160px] items-center gap-5 rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-4 md:grid-cols-[120px_minmax(0,1fr)_180px_140px_180px] md:px-6 md:py-5">
                  <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl bg-white md:h-28 md:w-28">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="h-full w-full object-contain p-2" loading="lazy" decoding="async" />
                    ) : (
                      <Package className="h-10 w-10 text-slate-300 md:h-12 md:w-12" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xl font-semibold text-slate-950 md:text-3xl" title={item.name}>{item.name}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm uppercase tracking-[0.2em] text-slate-400 md:text-base">Price</div>
                    <div className="mt-2 text-2xl font-bold text-emerald-600 md:text-4xl">{formatMoneyWhole(item.sellPrice)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm uppercase tracking-[0.2em] text-slate-400 md:text-base">Qty</div>
                    <div className="mt-2 text-2xl font-bold text-slate-950 md:text-4xl">{item.quantity}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm uppercase tracking-[0.2em] text-slate-400 md:text-base">Total</div>
                    <div className="mt-2 text-2xl font-bold text-slate-950 md:text-4xl">{formatMoneyWhole(item.sellPrice * item.quantity)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-8 py-6 md:px-10">
          <div className="flex items-end justify-between gap-4">
            <div className="text-lg text-slate-500 md:text-2xl">Grand Total</div>
            <div className="text-4xl font-bold tracking-tight text-slate-950 md:text-6xl">{formatMoneyWhole(payload.grandTotal)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

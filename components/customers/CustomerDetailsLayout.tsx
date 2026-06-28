import React from 'react';
import { X } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '../ui';

type CustomerDetailTab = 'ledger' | 'store_credit' | 'custom_orders' | 'notes' | 'repair_history';

type CustomerDetailsTabConfig = {
  key: CustomerDetailTab;
  label: string;
};

type CustomerDetailsLayoutProps = {
  title: string;
  meta: React.ReactNode;
  actions?: React.ReactNode;
  alerts?: React.ReactNode;
  currentDue: React.ReactNode;
  storeCredit: React.ReactNode;
  netReceivable: React.ReactNode;
  activeTab: CustomerDetailTab;
  onTabChange: (tab: CustomerDetailTab) => void;
  onClose: () => void;
  tabs?: CustomerDetailsTabConfig[];
  children: React.ReactNode;
};

export function CustomerDetailsLayout({
  title,
  meta,
  actions,
  alerts,
  currentDue,
  storeCredit,
  netReceivable,
  activeTab,
  onTabChange,
  onClose,
  tabs,
  children,
}: CustomerDetailsLayoutProps) {
  const visibleTabs = tabs || ([
    { key: 'ledger', label: 'Ledger' },
    { key: 'store_credit', label: 'Store Credit' },
    { key: 'custom_orders', label: 'Custom Orders' },
    { key: 'notes', label: 'Notes / Audit' },
  ] satisfies CustomerDetailsTabConfig[]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <Card className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-none bg-white shadow-2xl sm:h-[90vh] sm:max-w-7xl sm:rounded-[20px]">
        <CardHeader className="sticky top-0 z-20 border-b bg-white/95 p-3 sm:p-4 backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <CardTitle className="truncate text-xl font-bold tracking-tight text-slate-950">{title}</CardTitle>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">{meta}</div>
            </div>
            <div className="flex flex-wrap items-center justify-start gap-1.5 lg:justify-end [&_button]:h-[34px] [&_button]:rounded-lg [&_button]:px-2.5 [&_button]:text-[13px] [&_button]:font-semibold">
              {actions}
              <span className="mx-2 hidden h-7 w-px bg-slate-200 lg:inline-block" />
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg border bg-white px-0" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {alerts}

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-orange-100 bg-orange-50/30 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-orange-700/80">Current Due</div>
              <div className="mt-0.5 text-[23px] font-bold leading-none text-slate-950">{currentDue}</div>
            </div>
            <div className="rounded-lg border border-blue-100 bg-blue-50/30 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-blue-700/80">Store Credit</div>
              <div className="mt-0.5 text-[23px] font-bold leading-none text-blue-700/90">{storeCredit}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-slate-500">Net Receivable</div>
              <div className="mt-0.5 text-[23px] font-bold leading-none text-slate-950">{netReceivable}</div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1 border-b border-slate-200">
            {visibleTabs.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => onTabChange(key)}
                className={`h-9 whitespace-nowrap border-b-2 px-2.5 text-[13px] font-medium transition ${
                  activeTab === key ? 'border-slate-900 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto bg-slate-50/70 p-3 sm:p-4">
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

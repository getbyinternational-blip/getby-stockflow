import { useEffect, useMemo, useState } from 'react';
import Customers from './Customers';
import PurchasePanel from './PurchasePanel';
import Finance from './Finance';
import { loadData } from '../services/storage';

type RepairCenterTab = 'customer' | 'purchase_party' | 'expense' | 'other';

const TABS: Array<{ key: RepairCenterTab; label: string }> = [
  { key: 'customer', label: 'Customer Repair' },
  { key: 'purchase_party', label: 'Purchase Party Repair' },
  { key: 'expense', label: 'Expense Repair' },
  { key: 'other', label: 'Advance Order Repair' },
];

export default function RepairCenter() {
  const [activeTab, setActiveTab] = useState<RepairCenterTab>('customer');
  const [repairData, setRepairData] = useState(() => loadData());
  const formatMoney = (value: number) => `\u20B9${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    const refresh = () => setRepairData(loadData());
    window.addEventListener('local-storage-update', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('local-storage-update', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const advanceOrderCustomers = useMemo(() => {
    const customers = (Array.isArray(repairData.customers) ? repairData.customers : []) as Array<{ id: string; name: string; phone?: string }>;
    const orders = Array.isArray(repairData.upfrontOrders) ? repairData.upfrontOrders : [];
    const customersById = new Map(customers.map((customer) => [customer.id, customer]));
    const ordersByCustomerId = new Map<string, typeof orders>();

    orders.forEach((order) => {
      const key = String(order.customerId || '').trim() || `unknown-${order.id}`;
      ordersByCustomerId.set(key, [...(ordersByCustomerId.get(key) || []), order]);
    });

    return Array.from(ordersByCustomerId.entries())
      .map(([customerId, customerOrders]) => {
        const customer = customersById.get(customerId) || {
          id: customerId,
          name: 'Customer record not found',
          phone: '',
        };
        const sortedOrders = customerOrders
          .slice()
          .sort((a, b) => new Date(b.effectiveAt || b.date || b.createdAt || 0).getTime() - new Date(a.effectiveAt || a.date || a.createdAt || 0).getTime());
        const activeCount = sortedOrders.filter((order) => (order.status || '').toLowerCase() !== 'cleared').length;
        const completedCount = sortedOrders.length - activeCount;
        const totalAmount = sortedOrders.reduce((sum, order) => sum + Number(order.finalTotal ?? order.totalCost ?? order.orderTotalCustomer ?? 0), 0);
        const totalPaid = sortedOrders.reduce((sum, order) => sum + Number(order.advancePaid || 0), 0);
        const totalRemaining = sortedOrders.reduce((sum, order) => sum + Number(order.remainingAmount || 0), 0);
        const latestOrder = sortedOrders[0];
        const latestPayment = latestOrder?.paymentHistory?.slice().sort((a, b) => new Date(b.effectiveAt || b.paidAt || 0).getTime() - new Date(a.effectiveAt || a.paidAt || 0).getTime())[0];
        return { customer, customerOrders: sortedOrders, activeCount, completedCount, totalAmount, totalPaid, totalRemaining, latestOrder, latestPayment };
      })
      .filter((entry) => entry.customerOrders.length > 0)
      .sort((a, b) => a.customer.name.localeCompare(b.customer.name));
  }, [repairData]);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-40 -mx-4 border-b bg-background/95 px-4 py-4 backdrop-blur md:-mx-8 md:px-8">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="font-semibold">Repair Mode - all changes require reason, preview, confirmation, and repair history.</div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'customer' && <Customers repairMode hideStandardHeaderActions />}
      {activeTab === 'purchase_party' && <PurchasePanel repairMode embeddedRepairCenter />}
      {activeTab === 'expense' && <Finance repairMode initialTab="expense" lockedTab="expense" embeddedExpenseRepair />}
      {activeTab === 'other' && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="text-lg font-semibold text-slate-900">Customers With Active And Completed Advance Orders</div>
            <div className="text-sm text-slate-500">Review every customer that already has advance-order history.</div>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[1280px] text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-3 text-left">Customer</th>
                  <th className="p-3 text-left">Phone</th>
                  <th className="p-3 text-right">Active Orders</th>
                  <th className="p-3 text-right">Completed Orders</th>
                  <th className="p-3 text-right">Order Amount</th>
                  <th className="p-3 text-right">Paid</th>
                  <th className="p-3 text-right">Remaining</th>
                  <th className="p-3 text-left">Latest Advance Order</th>
                  <th className="p-3 text-left">Latest Payment</th>
                </tr>
              </thead>
              <tbody>
                {advanceOrderCustomers.map(({ customer, activeCount, completedCount, totalAmount, totalPaid, totalRemaining, latestOrder, latestPayment }) => (
                  <tr key={customer.id} className="border-t align-top">
                    <td className="p-3">
                      <div className="font-medium text-slate-900">{customer.name}</div>
                      <div className="text-xs text-slate-500">{customer.id}</div>
                    </td>
                    <td className="p-3 text-slate-600">{customer.phone || '—'}</td>
                    <td className="p-3 text-right font-semibold text-amber-700">{activeCount}</td>
                    <td className="p-3 text-right font-semibold text-emerald-700">{completedCount}</td>
                    <td className="p-3 text-right font-semibold">{formatMoney(totalAmount)}</td>
                    <td className="p-3 text-right font-semibold text-emerald-700">{formatMoney(totalPaid)}</td>
                    <td className="p-3 text-right font-semibold text-amber-700">{formatMoney(totalRemaining)}</td>
                    <td className="p-3 text-slate-600">
                      <div>{latestOrder?.productName || '—'}</div>
                      <div className="text-xs text-slate-500">{latestOrder ? new Date(latestOrder.effectiveAt || latestOrder.date || latestOrder.createdAt || '').toLocaleString() : '—'}</div>
                    </td>
                    <td className="p-3 text-slate-600">
                      <div>{latestPayment ? formatMoney(Number(latestPayment.amount || 0)) : '—'}</div>
                      <div className="text-xs text-slate-500">{latestPayment ? `${latestPayment.method || 'Unknown'} · ${new Date(latestPayment.effectiveAt || latestPayment.paidAt || '').toLocaleString()}` : 'No payment yet'}</div>
                    </td>
                  </tr>
                ))}
                {advanceOrderCustomers.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-sm text-slate-500">No customers with advance orders found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


# Transactions KPI audit

Scope: source-code review of all nine cards and their popup rows in pages/Transactions.tsx. This is not a reconciliation against live account data.

## Fixed

- Purchase-order payment rows were accepted as customer receipts because they have type `payment` and a supplier identity. They are now excluded from Credit Received and Cash In. Actual cash purchase payments remain in Cash Purchase and Cash Out, without counting the order total again.
- Online cash additions/withdrawals could appear in cash popup lists while being absent from the totals. Totals and popup membership now use shared cash classification rules.
- Returns with `reduce_due`, `store_credit`, or `refund_online` could count as cash refunds if their payment method was Cash. Explicit return handling now takes precedence; legacy returns without a handling mode still use their payment method.
- Customer receipts that partly create store credit were entirely counted as Credit Received. That KPI now uses the amount allocated to receivables when recorded. Cash In still includes all cash received. Legacy receipts without allocation fields use total less recorded store credit created.
- The earlier exclusion of deletion compensation from cash KPIs remains in place.
- Direct purchase cash payments now use each payment's date, with the order date as a fallback only when a legacy payment has no date. Cash Purchase and Cash Out use the same filtered purchase and supplier payments, including the same search and effective-date rules.
- Credit Received now includes both cash and online customer repayments, limited to their receivable allocation. Online receipts do not increase Cash In.

## All cards reviewed

| KPI | Current calculation and membership | Audit result |
| --- | --- | --- |
| Cash | Cash portion of sales and historical references | Totals and rows use the same settlement. Historical classification issue below. |
| Credit | Credit portion of sales and historical references | Totals and rows agree. This is credit at sale time, not current outstanding customer debt. Historical classification issue below. |
| Online | Online portion of sales and historical references | Totals and rows agree. Historical classification issue below. |
| Credit Received | Cash and online customer payments allocated to receivables | Purchase rows and store-credit portions excluded. Totals and rows share classification. |
| Cash Purchase | Direct cash purchase-payment histories plus cash supplier payments | Each payment is filtered by payment date; supplier-linked history payments are skipped to prevent duplication. |
| Credit Purchase | Remaining amount on non-cancelled purchase orders | Rows and total agree; shows outstanding purchase balances for orders in the selected period. |
| Cash In | Sale cash settlement, customer cash receipts, cash additions and manual cash-in | Purchase/deletion entries excluded. Historical-sale classification can still affect this card. |
| Cash Out | Cash refunds, expenses, withdrawals, manual cash-out, customer cash-out and cash purchase/supplier payments | Shared classification excludes non-cash entries. Uses the same filtered purchase payments as Cash Purchase. |
| Revenue | Gross sale and historical-reference totals | Breakdown rows use the same settlement as Cash/Credit/Online. Historical classification issue below. Returns are tracked separately in net sales. |

## Remaining findings (reported, not changed)

1. **Historical references can appear in the wrong sales KPIs.** `isSaleLikeTransaction` treats every `historical_reference` as a sale, without inspecting `referenceTransactionType`. Historical payment/return references can therefore inflate Revenue and its Cash/Credit/Online components, and potentially Cash In. The storage ledger already distinguishes these reference types. Ordinary sale/payment/return records are unaffected by this particular issue.

Validation: focused regression tests for cash transaction classification; production build passed. Full TypeScript checking still reports existing errors outside the changed files. No live-browser or account-level numeric verification was performed.

# Akhtar AutoParts Manager

Build a complete, production-minded, responsive inventory + point-of-sale + shop management web app named "Akhtar Autos" for a large automobile spare-parts shop in Pakistan. This must be a real working application, not a static mockup. Use PKR (Rs), Asia/Karachi timezone, English UI with clear labels, and a clean professional automotive visual identity. Must work well on desktop, laptop, Chromebook, tablet, and mobile.

CORE ARCHITECTURE:
- Offline-first. Core workflows must work without internet. Persist primary business data locally in IndexedDB (e.g. Dexie), not localStorage.
- Optional Google Drive backup/restore and multi-device sync. Clearly distinguish one-way backup/export from true two-way sync. Implement change tracking, timestamps, device IDs, conflict handling, sync status, and explicit sync controls. If OAuth/Drive credentials or connector setup are unavailable, build the UI and guided setup state and label it "Not connected"; never pretend sync is active. Never silently overwrite data. Include working manual JSON backup/restore and CSV import/export.
- PWA installability, service-worker app-shell caching, offline status indicator, responsive layouts, first-run setup, graceful empty/error/loading states.
- Do not seed invented business figures. Dashboard starts at zero/empty until real data is entered. Optional demo data must be opt-in and removable.
- Validation, confirmations for destructive actions, searchable/paginated tables, accessible controls, formatted PKR and Pakistan-local dates.

MODULES:
1. Dashboard: today's sales, period sales, cash collected, outstanding customer credit, purchases/investment, expenses, gross/net profit, stock value, low/out-of-stock counts, recent transactions and trends. Filters: today, yesterday, week, month, year, custom range.
2. Inventory: SKU/item code, barcode, part name, category, brand, vehicle make/model compatibility, part/OEM number, unit, quantity, reorder level, purchase cost, intended/default selling price, supplier, purchase date, stock location, notes, optional image. CSV bulk import/export. Search across all useful fields.
3. Stock batches and ledger: preserve each purchase batch's quantity, unit cost, date, supplier and remaining quantity. Track opening balances, purchases, sales, returns, adjustments, transfers. Keep historical stock/cost data. FIFO costing by default; calculate COGS from actual batches. Full item movement history.
4. Locations: shop, market, warehouse, racks/shelves/bins. Create/edit/archive locations and transfer stock with ledger entries.
5. POS/Sales: quick item search/barcode, cart with unlimited lines and quantities including 1 to 1000+, editable line and invoice discounts, optional configurable tax (off by default), customer/walk-in, cash/bank/Easypaisa/JazzCash/credit/partial payment, paid/due amounts, notes. Validate stock and configurable negative-stock policy. Atomic sale posting and batch deduction. Returns/refunds linked to original invoice with stock restoration.
6. Receipts: "Akhtar Autos" prominently on all receipts. Thermal 80mm and A4 print layouts with print CSS, unique invoice number, date/time, customer, item, qty, unit price, discount, line totals, subtotal, total, paid, balance/due, payment method, configurable footer/return policy, optional shop phone/address only when entered in settings. Reprint past invoices. Long receipts and large quantities must print correctly.
7. Purchases: supplier bill/invoice no, date, items, quantities, unit costs, discounts, payment, payable balance, due date, notes. Add stock to selected location and preserve batches. Purchase returns.
8. Customers: contacts, address, notes, transaction history, customer ledger, total purchases, payments, outstanding balances, receive payment against due, printable statements.
9. Suppliers: contacts, address, notes, purchase history, payments, payables, supplier ledger, pay supplier, printable statements.
10. Expenses: categories, date, amount, payee, payment method, reference, notes, optional recurring entries.
11. Reports: daily/weekly/monthly/yearly/custom reports for sales, units sold, purchases/investment, cash collected, receivables, payables, gross profit, expenses, net profit, stock valuation, best sellers, slow movers, low/out-of-stock, profit by item/category and payment method. CSV export and print-friendly reports. Distinguish revenue from cash collected and profit from cash flow. Formula definitions visible: gross profit = net sales - COGS; net profit = gross profit - expenses.
12. Alerts: low/out-of-stock and reorder suggestions; overdue customer receivables and supplier payables.
13. Settings: shop profile (Akhtar Autos default), PKR, Asia/Karachi, receipt customization, tax, costing policy, backup/sync, preferences, import/export, database status.
14. Audit log: timestamps for create/edit/void/payment/adjustment/sync actions. Prefer archive/void over deleting financial records.

DATA INTEGRITY:
- Relational schema and migrations. Financial/stock operations atomic and transactional. Unique invoice numbers. Validate quantities and prevent invalid stock changes. Store money as integer paisa or another decimal-safe representation, never floating point.
- Consistent formulas for revenue, cash received, receivables, purchase investment, COGS, gross profit, net profit and stock valuation. Correct handling of partial payments, credit, returns/refunds, discounts and batch costs.
- Tests for FIFO COGS, partial payments, returns/refunds, location transfers, stock adjustments, invoice totals and report date boundaries.
- Every visible action must work; no inert placeholder buttons.

BUILD SEQUENCE:
Build the app shell/navigation, schema, IndexedDB persistence and dashboard, then inventory, stock batches/ledger/locations, POS/receipts, purchases, customers/suppliers, expenses, reports, alerts, settings, local backup/restore and Drive sync setup. If Drive sync requires credentials, clearly show "Not connected" and provide working local backup/restore and setup guidance.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a8aea124-5d2b-4549-8cf0-51b7c0b66606).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

# kitchen-pos — Branch POS

The **front-of-house POS** that runs on the counter machine at each branch. It
is *not* a kitchen display: the branch has a POS terminal, and the kitchen
printers hang off it. Staff work incoming orders here and the app prints the
kitchen ticket to the kitchen printer(s) connected through this machine.

React + Vite web app (runs in the branch machine's browser).

## What it does

- **Sign in** as branch staff (`/auth/staff/login`), scoped to that staff
  member's branch. The owner creates each branch's credentials; when that branch
  signs in, the POS binds to their branch and **everything on screen is their own
  branch only** — enforced server-side, not by hiding controls here. A persistent
  banner shows which branch is signed in.
- **New orders** — accept / reject (with a reason) orders awaiting acceptance
  (`/orders/awaiting-acceptance/queue`). Accepting auto-prints the kitchen
  ticket.
- **Kitchen queue** — the live board (`/orders/kitchen/queue`, oldest first,
  new-order cue) with the next action per order:
  `preparing → ready → complete pickup`. Delivery orders show “awaiting driver”.
- **New counter order** — take a walk-in / phone order for the branch: browse the
  branch menu, build a cart (variants + add-ons), enter the customer's phone
  (found-or-created) and, for delivery, an address, choose cash-now / cash-later
  / cash-on-delivery, and place it (`POST /orders`). The order then appears in the
  queues. **The POS never prices anything** — item prices and the running total
  come from the backend (`/pricing/quote`); the order is priced again server-side
  on placement.
- **Deliveries** — the branch's own deliveries (`/deliveries`, branch-isolated):
  order, status, drop-off address and the **assigned driver** (name + vehicle,
  never the customer's phone). Assign a driver to a delivery that needs one
  (`/drivers`, `/deliveries/:id/assign`).
- **Printing** — kitchen ticket + customer docket (never an invoice). Printing
  goes through a per-branch adapter:
  - **Preview (mock)** — the default; shows the exact ticket on screen and logs
    it. No hardware needed, so the flow is demoable today.
  - **QZ Tray** — the real path to the branch's thermal printer. Needs the QZ
    Tray client running on the machine plus a signed connection and the model's
    profile; configured per branch in **Print settings**.
- **Duplicate-print prevention** + a **print log** with the last error.
- **English + Arabic (RTL)** — a header toggle flips the whole app between
  English and Arabic; catalog names use their Arabic name where the backend
  provides one, and reading direction follows.

## Branch isolation

The POS is a client of the backend's server-side isolation, never a substitute
for it. Every read and action is scoped to the signed-in staff member's branch
by the backend (`branchScopeFilter` / `assertBranchAccess`): the queues,
deliveries, driver assignment and counter-order creation all reject or exclude
anything outside the caller's own branch. This app simply renders what it is
allowed to see.

## Config

- `VITE_API_BASE_URL` — the backend base URL (defaults to
  `http://localhost:3000/api/v1`).
- Printer model + connection are stored **locally on the branch machine**
  (localStorage), set in the in-app Print settings — never in the repo.
- Language choice (EN/AR) is remembered per machine in localStorage.

## Develop

```bash
npm install
npm run dev        # Vite dev server
npm run lint && npm run typecheck && npm test && npm run build
```

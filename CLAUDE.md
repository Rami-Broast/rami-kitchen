# kitchen-pos — project context

The **Branch POS** (front-of-house). Repo name stays `kitchen-pos`, but there is
**no kitchen display screen**: each branch has a POS terminal at the counter and
the thermal printers hang off it. Staff work incoming orders on this app and it
prints the kitchen ticket to the kitchen printer(s) connected through the POS
machine. Printers are per-branch by model. React + Vite web app.

## Built (Branch POS v1)

- Staff sign-in → branch resolved from the actor; branch-isolated queues. The
  owner creates each branch's credentials; that branch signs in and the POS
  binds to their branch. A persistent banner (`components/ui.tsx` `Shell`) shows
  which branch is signed in, and every screen reads **their own branch only** —
  the backend enforces it (`branchScopeFilter` / `assertBranchAccess`); the POS
  is a client of that isolation, never a substitute for it.
- **New orders** (accept/reject) + **kitchen queue** (preparing → ready →
  complete-pickup), oldest first, new-order cue. Consumes
  `/orders/awaiting-acceptance/queue`, `/orders/kitchen/queue`, and the
  transition endpoints.
- **New counter order** (`screens/NewOrderScreen.tsx`) — take a walk-in / phone
  order for the branch against `POST /orders` (backend `placeOrderForStaff`).
  Browse the branch menu (public `/branches/:id/menu`), build a cart with
  variants + add-ons, enter the customer's phone (found-or-created) and, for
  delivery, an address; choose cash-now / cash-later / cash-on-delivery. **The
  POS never prices anything** — the running total comes from `/pricing/quote`
  and the order is priced again server-side on placement.
- **Assign a driver from the board** — a READY delivery order carries an
  **Assign driver** button on its own card, not a dead "Awaiting driver" pill.
  See "Dispatch happens on the board" below.
- **Deliveries** (`screens/DeliveriesScreen.tsx`) — the branch's own deliveries
  (`/deliveries`), showing status, drop-off address and the assigned driver
  (name + vehicle, **never** the customer's phone). Assign a driver to one that
  needs it (`/drivers`, `/deliveries/:id/assign`). All branch-isolated server-side.
- **Reports** (`screens/ReportsScreen.tsx`) — this branch's sales, VAT,
  payments and timings over today or a chosen window, printable on the counter's
  own roll. See "The day's takings are on the counter" below.
- **English + Arabic (RTL)** (`i18n/`) — a header toggle flips the app; catalog
  names use `nameAr` where present; `document.dir` follows. Pure helpers tested.
- **Printing** — see the print engine section below.

## Which build is this?

The footer carries a build marker — short commit and build time
(`util/buildInfo.ts`, `buildLabel` pure and tested; injected by
`vite.config.ts` from `VERCEL_GIT_COMMIT_SHA` / `GITHUB_SHA`, and a build with
neither honestly says `local`).

It exists because "the Assign driver button isn't there" was reported against a
board whose code puts it there — confirmed by building this app and driving it
in a browser. Nothing on screen could say whether the terminal was running that
code, so a stale bundle and a real bug were indistinguishable and diagnosis
started by re-proving code that was already correct.

The counter needs this more than the admin panel does, not less: this runs on a
machine nobody reloads, in a browser nobody watches, and a Vite SPA behind a CDN
will happily serve a cached `index.html` pointing at the previous bundle long
after the deploy went green. **When a POS bug is reported, read the marker
first.**

## Dispatch happens on the board

A ready delivery order used to show a **dead pill** reading "Awaiting driver".
To actually send it, the counter left the board, opened Deliveries, found the
order again and assigned from there — during service, with the food on the
pass. `PosBoard` now carries the assign action on the card itself, and
`components/AssignDriverModal.tsx` is the one picker both screens use, so a new
failure case or driver field cannot land on one and not the other.

**Marking a delivery order ready opens the driver picker by itself.** Owner
decision: the counter should never leave this screen to dispatch. Finishing the
food and choosing who carries it are one act, and splitting them across two
screens is what had staff mark an order ready and forget the second half until
the customer rang. `promptAssign` runs as `act`'s `after` hook on
`markReady` — the same hook that prints the kitchen ticket on accept.

Two details it depends on:

- **It fetches the delivery rather than reading `unassigned`.** That state is
  set by `refresh` and React has not committed it when the hook runs. The
  backend opens the delivery row inside the same transaction as the READY
  transition, so by the time the transition returns the row exists.
- **It is silent on failure.** The order *is* ready either way, and the Assign
  driver button on the card is the way back in. A dialog that failed to open
  must not also cost the transition.

The picker is branch-scoped by the server, not by this client: `GET /drivers`
runs through `resolveRequestedBranches`, so the drivers it offers already mean
this branch's.

## The driver picker lists everyone on shift, and it is live

Three changes to `AssignDriverModal`, each fixing a way the counter got stuck
mid-service:

- **It asks for `isOnline=true`, not `isAvailable=true`.** The backend now lets
  a busy driver be given another drop — batching two drops onto one run is how a
  small fleet works — so filtering to free drivers hid exactly the person
  already riding to that street, and the dialog read "no available drivers" with
  three drivers out. What each driver is carrying is shown on their row instead,
  and the server enforces the ceiling.
- **It reloads on `driver.status`.** The list used to be fetched once, when the
  dialog opened; a driver who started their shift ten seconds later could not
  appear short of closing and reopening it. `useRealtimeReload` also fires once
  on every reconnect, so a shift that started while the shop network blinked is
  not missed either. The poll is still the floor everywhere else.
- **Stacking is confirmed, once.** A free driver is one press. Giving a second
  drop to somebody already out is an ordinary decision rather than a slip, so it
  asks rather than refusing.

`src/util/driverPicker.ts` is pure and tested, and is kept close to
`admin-app/src/util/driverPicker.ts` on purpose — the owner's Deliveries page
and this dialog are two views of one dispatch decision, and the same fleet must
not read differently depending on which screen you are standing at. Three rules
in it:

- **Free first, then the lightest load, then by name.** The name tiebreak is not
  cosmetic: the board polls every eight seconds, and without it the row under
  someone's finger moves between renders.
- **An absent `activeDeliveryCount` means unknown, never zero.** An older
  backend sends only the flag, and reading that as zero would rank a driver the
  server called busy above every free one.
- **A free driver's load is not stated.** "Carrying 0 deliveries" on eleven rows
  out of twelve is noise.

The empty state is **"No drivers are on shift"** — a cause the counter can act
on. "No available drivers" covered two different problems (nobody working, or
everybody busy) with two different answers, and now only the first can produce
an empty list at all.

`translate` takes variables (`t('driverCarryingMany', { n })`), because Arabic
and English put a number in different places in a sentence. Building the string
at the call site produces something wrong in exactly one of the two languages,
and nobody who reads only the other ever sees it.

Four things it depends on:

- **The board only ever needs `PENDING_ASSIGNMENT`.** The kitchen queue stops at
  READY, so the moment a driver is assigned the order becomes `DRIVER_ASSIGNED`
  and leaves this board for Deliveries. **The card disappearing is the
  confirmation** — there is no assigned state to render here.
- **That request fails soft and is not in `SCREEN_PERMISSIONS.board`.** The
  queues are what this screen exists for; losing the Assign button is a smaller
  failure than losing the list of food to cook, so a `/deliveries` failure never
  reaches the banner. Naming its permissions in the diagnosis would make a
  genuine `orders:kitchen` refusal report `deliveries:assign` as the cause.
- **A missing delivery row means two different things** — not listed yet (the
  backend opens it as the order reaches READY, so one poll can miss it) or
  already assigned — so the fallback pill states neither.
- The board subscribes to `delivery.assigned` / `delivery.unassigned` too, so an
  assignment made in the admin panel or on the other counter terminal takes the
  button off this card rather than leaving two people dispatching one order.

## The board is pushed, not just polled

`src/realtime/RealtimeProvider.tsx` holds one authenticated socket for the
signed-in branch. `PosBoard` and `DeliveriesScreen` subscribe through
`useRealtimeReload`, which reloads on an event **and once on every
(re)connect** — a socket that dropped for thirty seconds missed whatever
happened in them.

**The 8-second poll stays.** This is an accelerator, not a replacement: a
counter terminal on a flaky shop network must not depend on a socket staying up
to show the orders it has to cook. The poll is the floor, the socket removes
the wait in the common case — and the New Orders column is the one screen in
this app where those seconds are actually felt, with a customer's order sitting
unseen while someone is looking straight at it.

The server side was already built and unused: the gateway authenticates the
handshake with the same token service the HTTP guards use, resolves the actor
from the database, and joins the socket to exactly the rooms its `BranchScope`
allows. **Isolation holds on this channel too** — verified live: a branch-A
order reaches branch A's POS and every owner (`staff:all`), and branch B's POS
does not see it. A socket is a new channel, so that is worth re-checking rather
than assuming it inherits the REST guarantee.

Emission is one-directional. The client only listens; every state change still
goes through the REST choke points. Realtime is never a write path.

Ported from `admin-app/src/realtime/RealtimeProvider.tsx` and kept close to it
deliberately, so the two behave the same. The only difference is the
`localStorage` token key, which is per app — **if the key in
`auth/AuthProvider.tsx` ever changes, change it here too**, or the socket
silently fails to authenticate and the board quietly falls back to polling.

## The print engine

`src/print/` — the whole printer story lives here; the backend never talks to a
printer.

- **`qz-client.ts`** resolves the QZ Tray JS client: a `window.qz` if the
  machine injects its own, else the bundled `qz-tray` dependency. That bundled
  import is load-bearing. The adapter used to read `globalThis.qz` and
  **nothing ever loaded a client**, so every real print failed with "QZ Tray is
  not running" even where it was. Installing the QZ Tray *desktop app* does not
  create `window.qz` — the browser needs the JS client too, and those are two
  separate installs.
- **`discovery.ts`** asks the machine what printers it has and ranks them.
  Counter staff are not IT people, and the old settings screen asked them to
  type a printer's exact queue name — a thing they cannot be expected to know,
  and how a branch ends up unable to print on opening day. Ranking and
  inference are **pure and tested**: brand/series names score highest, virtual
  printers (PDF, XPS, fax) go negative, the system default is a nudge rather
  than a decision (on a shared machine the default is usually the A4 printer).
  `suggestMainPrinter` returns **null** when nothing looks like a receipt
  printer rather than picking the least-bad option — an unset picker asks the
  question; a wrong auto-pick prints a full A4 page and nobody knows why.
  A kitchen printer is only suggested when its name says "kitchen".
- **`printer.ts`** — the engine. **Two roles, one or two devices**: `main`
  (dockets, reprints) and optional `kitchen`; kitchen falls back to main, so a
  one-printer branch configures one thing. **Retries** with backoff, because a
  printer briefly busy or waking up is the normal case mid-service, not an
  exception — but only transient failures retry, since a misconfigured printer
  will not fix itself. **`printAndRecord`** is the entry point screens use: a
  print that is not logged breaks both the duplicate guard and the "did it
  print?" question. **ESC/POS framing** (`ESC @` init, `GS V 0` full cut) is
  standard and switchable per profile for a device that prints the bytes as
  text; nothing model-specific is guessed.
- **Config migration.** `migrateConfig` carries the old flat
  adapter/model/connection shape onto `main`. A machine upgraded mid-service
  must not silently lose its printer and start printing nowhere.
- **`tickets.ts`** builders take a **width**. 80mm is 42 columns, 58mm is 32; a
  ticket wider than the roll wraps mid-word and a cook loses the quantity off
  the front of the next line.

`autoPrintKitchenOnAccept` decides whether accepting an order also prints —
one press where the printer is at the counter, accept-then-print where it is in
the kitchen.

**Printing is still unproven against hardware.** No branch printer has been
available to test against, and per-model profiles are a per-branch
commissioning step. Treat a first print at a new branch as a task, not a given.

## The palette: light, neutral, and the brand rationed

`src/theme/theme.css`. This screen sits on a counter for a whole shift, under
shop lighting, read at arm's length by someone holding a bag. Three decisions
follow, and all three replaced something that was working against that.

- **The ground is a warm neutral, not a tint.** It was `#f6eef3` with
  pink-tinted borders, so every surface, rule and card edge carried the brand
  magenta. A brand colour earns its place on the one thing you want looked at;
  everywhere else it is noise that food photography and order text have to
  fight.
- **It is pinned light.** There was a `prefers-color-scheme: dark` block, so a
  counter machine that happened to be in dark mode ran the whole shift in dark
  purple — a palette nobody art-directed, selected by an OS setting nobody at
  the branch knows they set. Same call the customer app made.
- **Actions are near-black; magenta marks the current section and nothing
  else.** A board carries four or five primary buttons at once (accept, ready,
  complete, print). In saturated magenta they compete with each other *and* with
  the status pills that are actually trying to signal something. `.btn.brand` is
  the one magenta element on screen.

Two consequences worth keeping:

- **A card's stripe carries meaning or it carries nothing.** `.card.tile` takes
  `--tile-accent` from whatever renders it — amber for an order still waiting to
  be accepted, quiet for one already cooking. Every card used to be brand
  magenta, which told a cook nothing.
- **Status pills are tonal** (`.pill.tone-*`): a coloured word on its own soft
  ground, not white on a saturated block. Twenty saturated blocks on one board
  is a hazard-light display.
- **Rejecting is an outline button.** It is destructive and rare, and a solid
  red block beside every Accept all shift is both loud and a misclick waiting to
  happen.

Column headings are sticky (`.column-head`) with the count in a pill beside the
label rather than glued on with a `·` — during service the list scrolls, and the
count is the number a counter reads first, so it should be in the same place
regardless of how long the label is in the current language.

## A 403 says which permission is missing

`src/util/permissionDiagnosis.ts` compares what a screen needs against the
permission list `/auth/me` already returned for the signed-in account, and the
board's banner says either "This account is missing orders:kitchen — <email> ·
KITCHEN. An owner can grant it in Admin → Users." or "This account holds every
permission this screen needs", which is a *different* fault and stops an owner
re-assigning a role that was never wrong.

The backend deliberately refuses to name the missing permission — that would map
the permission model out for anyone probing the API — and it is right not to.
But the account's own permissions are already in this client, so nothing is
leaked by comparing them here, and the alternative was a counter terminal
showing "You do not have permission to perform this action" with no account, no
cause and no remedy, resolvable only by someone with database access.

`SCREEN_PERMISSIONS` mirrors the controllers' `@RequirePermissions`, and a test
holds it against the KITCHEN role's seeded grants: the POS is signed into with
whichever credentials the owner gave that branch, and a screen asking for
something KITCHEN never holds is a 403 by design rather than by
misconfiguration. Add a screen's permission here when it starts calling a new
endpoint.

`CurrentActor.branchScope.kind` is `'ALL' | 'ASSIGNED' | 'NONE'` — it said
`'ALL_BRANCHES'`, which the backend never sends, so an owner signing in matched
no branch of the union at all and got the "no branch" screen. Same rule as the
other enums: check `src/auth/types/actor.ts` before adding a value.

## Find order (order lookup)

`screens/LookupScreen.tsx` — the counter's answer to "a customer is on the
phone about an order". The board only shows what is live, so this is the only
way to reach an order once it has left the queues. Searches `GET /orders`
by the 12-digit reference printed on the docket, the branch order number or
the customer's phone, and offers a reprint of either ticket (deliberately
bypassing the duplicate-print guard — the reason someone is on this screen is
that the original was lost — but still writing to the print log).

The server narrows every result to the caller's branch *before* matching, so
this screen cannot surface another branch's order however exact the search
term. It is a client of that isolation, never a substitute for it.

## Menu availability (sold out)

`screens/MenuAvailabilityScreen.tsx` — "we've run out of the lamb". Toggles
this branch's own availability row via `PATCH /menu/branches/:branchId/
products/:productId/availability` (`menu:availability`, which BRANCH_ADMIN and
KITCHEN already hold). The catalogue stays organisation-wide and owner-owned;
**price overrides are deliberately not offered here** — changing what a dish
costs is an owner decision, not a service-time one.

**`MenuProduct.isAvailable` must be honoured wherever a cart is built.** The
branch menu returns the whole catalogue with a flag; the backend only rejects
an unavailable item at placement, so ignoring the flag means a cart that fails
at checkout with a customer standing at the counter. `NewOrderScreen` disables
sold-out items and guards the handler.

## Order numbers and the reference

`orderNumber` counts **per branch, from 1000000** — this branch's first order
is `1000000`, its next `1000001`, and other branches never advance it. It is
unique only within the branch, so it is what the counter calls out but never
what identifies an order platform-wide.

`referenceId`, a globally unique 12-digit number, is what does. Both print on
the kitchen ticket and the customer docket (`src/print/tickets.ts`), and the
reference shows on the POS board, the deliveries list and the counter-order
confirmation, because that is the number a customer quotes when they ring
about their order. The reference line is omitted, never printed empty, when an
order arrives without one.

## White screens

Every screen is wrapped in `<ErrorBoundary>` (`components/ErrorBoundary.tsx`) —
once around the whole app in `main.tsx`, and again inside `Shell` around the
active view, keyed on the view so switching tabs clears it. React unmounts the
entire tree on an uncaught render error, and **a counter terminal that goes
blank mid-service is worse than one showing a message**: inside the Shell, the
nav and the branch banner stay usable. Its copy is bilingual, and the language
is passed in rather than read from the context — the provider is one of the
things that can throw, and a boundary needing a working provider is no boundary.

`OrderStatus` and the other unions mirror the backend enums exactly. They had
carried `COMPLETED` and `REJECTED`, which the backend never sends (a completed
pickup is `DELIVERED`; a rejection is a `CANCELLED` order with the reason), and
omitted the refund states, which it does. Check `prisma/schema.prisma` before
adding a value.

## Sold out, and for how long

The availability screen asks **how long** when an item goes off — 1 hour,
2 hours, rest of today, or until someone switches it back — and sends
`unavailableUntil` with the toggle. The backend puts the item back on sale by
itself once the window passes.

That is not a nicety. **A branch that has to remember to switch every sold-out
item back on will not.** Service ends, the shift changes, and the item is still
off next morning; the menu quietly shrinks over a week and nobody can say when
it happened. "Until I switch it back" stays available for the genuine case (the
supplier failed, no time can be promised) but it is a choice rather than the
only behaviour.

Coming back on sale asks nothing — an item someone is switching on is available
now.

The arithmetic is pure and tested (`src/util/soldOutWindow.ts`). **"Rest of
today" ends at the end of the local day, not 24 hours out**: at 23:50 that is
ten minutes away, and computing it as now + 24h would keep the item off through
the whole of the next day. That is wrong exactly once a day and never while
anyone is looking, which is why it has a test.

`unavailableUntil: null` means two different things and the card must not
conflate them: on sale, or off with **no time promised**. Only `isAvailable`
separates them.

**The toggle never sends `priceOverrideMinor`.** Omitting it leaves the
branch's price alone; sending null would clear it. The backend used to apply
the field as `dto.x ?? null`, so every sold-out toggle silently erased that
branch's price — fixed backend-side, and this client stays out of the way
regardless.

## Client-demo decisions (locked)

**Read `../backend/DEMO_DECISIONS.md`.**

- **Every branch has a different thermal printer brand.** The picker + the
  adapter for the chosen model live here — the backend never talks to a
  printer directly. Store the branch's chosen printer model + connection in
  local config on this machine, and load the matching driver at boot.
- **QZ Tray** is the default cross-platform bridge for now — one adapter
  that talks to QZ, one small profile per printer model for widths /
  raster / cut commands. Add more per-model adapters as branches are added.
- **No invoice printing** — the restaurant issues its ZATCA invoice
  separately. This app prints the kitchen ticket and the customer
  order-summary docket only. Never render or print an "invoice" here.
- The **kitchen-queue screen** can be built today against the existing
  backend API (`/orders/kitchen/queue`, `/orders/:id/preparing|ready`) —
  everything but the print path is unblocked.

## The logo prints, and QZ is what rasterises it

The customer docket carries the restaurant's logo at the top **by default**, on
a branch that has configured nothing: `logoImageUrl` null means the brand mark
bundled with this app (`public/logo.jpeg`), not "no logo".

**None of the raster encoding is ours.** QZ Tray takes an image entry
(`type: 'raw'`, `format: 'image'`, `language: 'ESCPOS'`) and turns it into this
printer's own commands — which is the only reason a logo is safe to print on
hardware nobody here has tested against, and it is the same discipline as never
guessing a payment gateway's API.

What QZ does **not** do is resize, so the width is the one thing `print/logo.ts`
has to get right: 576 dots across an 80mm roll and 384 across a 58mm one, at the
203 dpi almost every head runs. An image wider than the roll is what tears a
logo across two lines, and nothing on screen shows it.

Three more rules in there:

- **It is reduced to one ink here, by threshold**, not left to the printer's
  driver — which dithers a wordmark into a grey mush on some models and not
  others. A transparent pixel becomes **white**: an alpha channel the printer
  does not understand reads as black on some drivers, which prints the whole
  rectangle around the logo solid.
- **A logo that cannot be prepared is skipped, never fatal.** `prepareLogo`
  returns null and the docket prints without a header. The receipt is the point.
- **The kitchen ticket never carries it.** That is the branch's own working
  document, and a logo on it is ink and seconds.

`buildPrintData` is pure and asserted: `ESC @` first (or a previous job's
alignment puts the logo against the margin), the image centred between
`ESC a 1` / `ESC a 0`, the text, then the cut **last** — a cut before the text
is a receipt that never printed.

**Known limit, seen rather than assumed:** the bundled mark is a 1600x384
lockup, and at 576 dots the wordmark reads while the small tagline under it and
the thin drink outline break up. The admin panel's preview runs this same code
so an owner sees that before the first receipt rather than after; replacing the
artwork with a simpler mark is a one-field change there.

## The day's takings are on the counter, not down a phone

`screens/ReportsScreen.tsx`, the **Reports** nav tab. Sales, VAT, payments and
prep/delivery timings for **this branch**, over today or any window somebody
picks, with a thermal print of the summary for handover.

It exists because the counter had every order on its own screen all day and no
**sum** of them anywhere: "how did tonight go" was a phone call to the owner,
whose admin panel was the only place the figures lived. The sum is the whole
feature — an end-of-shift handover is a number somebody has to be able to hold.

**The permission is the part that was a decision.** `reports:read` is now held
by KITCHEN and is the only financial code that role has (owner instruction; see
the backend's `prisma/seed/permissions.ts`, where the rest of the financial set
is still deliberately withheld). It is **branch-scoped server-side** like every
other read here — `resolveRequestedBranches` decides whose orders are counted —
so this screen cannot surface another branch's revenue however the request is
built, and `permissionDiagnosis.test.ts` holds the grant against what
`SCREEN_PERMISSIONS.reports` asks for.

Five things it has to keep right:

- **A window is the branch's own local days, never a UTC day.**
  `util/reportRange.ts` is pure and tested, and this is the bug it exists to
  prevent: Riyadh runs at UTC+3, so a UTC window pushes the first three hours of
  the branch's own morning into yesterday's sheet and leaves the last three
  hours of the evening out of tonight's. Nobody at a counter would ever see
  that — the totals are simply wrong by however much trade falls either side of
  03:00, every day. The window also stops at the last **millisecond** of the end
  day rather than the next day's midnight, because the server's filter is
  inclusive and an order placed in that millisecond would otherwise be counted
  in two reports that then disagree with each other.
  `now` is an argument throughout: a function that reads the clock cannot be
  tested at 23:55, which is exactly when a day-boundary bug shows and nobody is
  looking. Same rule as `soldOutWindow.ts`.
- **Which preset is lit is derived from the range, not remembered.** A terminal
  left open through a shift change would otherwise keep "Today" highlighted over
  yesterday's figures — the one state where somebody reads the wrong number with
  no reason to doubt it.
- **Zero and "failed to load" must never look the same.** An empty window says
  it is empty in as many words; a refusal names the missing permission (the POS
  holds the account's own list, so the comparison is local — the server rightly
  will not say); and a half-typed or backwards range is announced rather than
  leaving the previous window's figures on screen under the new dates.
- **The four reads fail together on purpose.** A sheet showing takings with no
  VAT, or a total with no payments, is one somebody reads as complete, and
  nothing on the page would say which half is missing.
- **VAT is stated as included, apart from the other figures.** Prices are
  VAT-inclusive, so a VAT row sitting level with subtotal and delivery reads as
  "+ VAT" to anyone checking the arithmetic by hand — which overstates the day
  by the whole of the tax. Same finding as `admin-app`'s `OrderBreakdown`.

**The printed sheet carries its caveats, because a number that leaves the screen
takes its qualifications with it.** `buildSalesReportTicket` (`print/tickets.ts`,
pure and tested at both roll widths) prints that it is **not a tax invoice** — it
has a total and a VAT line, so it looks like one, and this platform issues none —
that the VAT is **gross** and never netted of refunds, and that cash on delivery
may still read as pending. The same three sentences are on screen. It prints
through `printAndRecord` like any other job and is logged as `kind: 'report'`,
but it is deliberately **not** subject to the duplicate guard: a shift summary is
a thing somebody legitimately prints twice, once for the till and once for
whoever is taking over.

`TicketKind` gained `'report'`, and `OrderTicketKind` was split off for the two
documents an **order** produces. `buildTicket` treats anything that is not
`kitchen` as a docket, so without that split a third value reaching it would
print a customer receipt for something that is not an order.

Verified in Chromium against a real backend, signed in as a **KITCHEN** account:
three counter orders placed, 600.00 taken and 78.26 of VAT inside it read back
identically on screen and on the roll at 42 and 32 columns, the presets and a
custom range re-query, a backwards range is refused, the print logs as a report,
the whole tab flips to Arabic with the figure columns still aligned to their own
headings, and no console errors.

## The receipt has its own tab, because the question is asked mid-service

`screens/ReceiptScreen.tsx`, the **Receipt** nav tab. "What does our receipt
look like?" gets asked during service, and the answer used to be reachable only
through Print settings — the screen a branch is told to leave alone once the
printer works, which is a bad place to send somebody who only wants to look.

**The preview is the receipt, not a picture of one.** It calls the same
`buildTicket` the print path calls, on the template `docketTemplate()` returns,
at the roll width the configured printer is set to, and the logo through the
same `prepareLogo` QZ is handed. A preview drawn by a second, prettier
implementation agrees with the printer right up until the case somebody needed
to check. `print/sample.ts` is the order it renders and is deliberately
awkward — a first-time customer, a stacked promotion and coupon, an item note,
and a dish name long enough to wrap at 32 columns. It is kept in step with
`admin-app/src/print/docket/sample.ts`, like the builders themselves.

Five things it has to keep:

- **Both documents.** The customer receipt and the kitchen ticket, because the
  counter prints both and only one of them carries a logo or any money.
- **The branch's own roll first.** 80mm/58mm is a toggle, but the one the
  printer is configured for is labelled as such — previewing at a width the
  branch does not use answers a question nobody asked, and "the text ran off
  the edge" is diagnosed by comparing the two.
- **What a branch may change is two fields** — `readyTimeRules` and
  `thankYouLines`, the backend's `BRANCH_OVERRIDABLE_KEYS`. The layout, the
  logo, the brand lines and the footer are the owner's, and the screen says so
  rather than leaving their absence to be discovered.
- **The editor is gated on `receipt-template:branch`, which KITCHEN does not
  hold.** A counter account gets the preview and a sentence saying who can
  change it; it is not offered a Save button that answers 403. That is why
  `SCREEN_PERMISSIONS.receipt` lists only `receipt-template:read`.
- **A save has to reach the printer, not just the screen.** It PUTs, then
  re-reads and re-caches through `cacheDocketTemplate`, because the server is
  what resolves the owner's template with this branch's override on top. Without
  that a branch changes its thank-you, watches the preview update, and the
  counter keeps printing the old receipt until the next sign-in — which is
  exactly the failure a preview is supposed to prevent.

**Print this sample sends the stored template, never the half-typed draft.** A
test print exists to check the printer against what it prints today; handing it
an unsaved edit answers a different question.

**The preview is one sheet of paper, and the paper is `columns` characters
wide.** The logo and the ticket text live in a single column sized `${columns}ch`
— 42 on an 80mm roll, 32 on a 58mm one — and the logo's width is a percentage
*of that column*. `ch` rather than `fit-content`: **an image contributes its
intrinsic width to a shrink-to-fit box**, and the rasterised logo is 576 dots
wide, so a `fit-content` paper is sized by the logo rather than by the ticket —
about twice life size, with the logo visibly wider than the text it is supposed
to sit over. The font size then puts an 80mm roll within a couple of percent of
its real 72mm of printable width on screen, because a receipt preview at twice
the size of a receipt is answering a different question. They used to be separate elements in a
full-width card — the text a fixed 42- or 32-character column sitting at its
left, the logo centred across the whole card — so the two appeared out of line
and the logo read as landing somewhere arbitrary. The printer centres both on
the same roll (`ESC a 1` in `buildPrintData`), and `logoDotWidth` caps the image
at the roll's own dot count, so it can never overflow: at 100% it is flush with
the rule above the items, which is the honest way to answer "will it run off the
edge?".

Verified in Chromium against a real backend: the preview matches `buildDocket`
line for line, a save survives a reload and lands in `localStorage` for the
print path, 58mm wraps to 32 columns, the reset drops back to the owner's text,
and the whole tab flips to Arabic with the preview staying column-accurate.

## Setting up a printer is a guide, in the cashier's own language

`screens/PrinterSetup.tsx`, at the top of Print settings; everything technical
is folded under **Advanced settings**.

The person doing this is opening a shop. They have not done it before, there is
nobody from the platform standing next to them, and they may read Arabic rather
than English. So it is **five numbered steps** that each either turn green by
themselves or say exactly what to do next.

Three things make it a guide rather than a form:

- **It includes the steps the app cannot do.** Plugging the printer in and
  starting QZ Tray are most of what actually goes wrong, and a screen that
  starts at "choose a printer" assumes the hard part is already done. Step 1
  says which way the paper goes and what a blinking light means.
- **Every step it *can* check, it checks.** No step is ticked by pressing a
  button — the chips are read off the real state, so *Done* means done and a
  cashier can always tell which step is actually blocking them.
- **The one step that needs a person is asked as a symptom.** Nobody at a
  counter can answer "is this an 80mm or a 58mm roll?", and the printer will not
  say. Everybody can answer "did the text run off the edge?" — and that has
  exactly one fix, applied in one press with an automatic reprint.

It ends by telling the cashier what to say if they are stuck: **the step number**.
"It doesn't print" is not something anyone can act on down a phone.

The states behind it are the ways it genuinely goes wrong:

- **QZ Tray is not running** — far and away the most common. `checkQzTray` is
  the probe, and it **asks QZ something** rather than trusting
  `websocket.isActive()`: that reports the client's own idea of its socket and
  says yes while a connection is still being attempted, so a machine with no QZ
  Tray at all was told it was running — the guide ticked the step green and the
  next one failed for a reason that made no sense. A printer listing
  round-trips; an empty list is a real answer from a running QZ and a throw is
  the absence of one. **Found by driving the built app in a browser**, where the
  step said Done with QZ's own WebSocket refused in the console.
- **"Nothing came out"** — the wrong queue: a driver, a virtual PDF printer, the
  office A4. The answer is the list, not an explanation.
- **"The text ran off the edge"** — the roll width, above.

The test print carries the **logo and a full-width rule** on purpose: those are
exactly the two things that go wrong invisibly, and the whole screen rests on
somebody looking at the paper and answering.

**A branch that is already set up is left alone** — a heuristic disagreeing with
a working branch is how a working branch stops working after an unrelated visit
to this screen.

**Every string is in `i18n.ts`, both languages**, and a test holds that: a
missing entry renders as its own key (`guideStep3Body`) on a counter, and a
guide in a language the cashier does not read is a guide they ring somebody
about. The printer's name is a `{name}` slot rather than something built at the
call site, because Arabic and English put it in different places.

## The counter is never asked to allow printing

`print/qz-signing.ts`. QZ Tray shows an **untrusted website** dialog once per
session for a page it cannot verify — on a terminal nobody reloads, that is
every morning, mid-service, in front of somebody who does not know what it is
asking, with the first order of the day behind it.

QZ's own mechanism removes it: a certificate promise and a signature promise.
Both go through the API, because **the private key must never be in this app** —
this is a static bundle served to every branch and anything in it can be read
from a browser's source tab. The backend holds the key
(`backend/src/printing/`), signs SHA-512, and hands back base64.

Four rules:

- **It is installed before `connect`, and once.** QZ reads the certificate when
  the socket opens, so installing it afterwards changes nothing until the next
  reconnect — the branch is prompted for the whole of that session. Both the
  print adapter and `checkQzTray` prepare first, and `printer.test.ts` asserts
  the order, because nothing about it is visible from a screen.
- **It never costs a print.** No certificate, or an API this counter cannot
  reach, means the promises are simply not installed. A failure preparing is
  also **not** reported as QZ being down — that sends somebody to restart the
  wrong thing.
- **A failed signature rejects the promise** rather than resolving with
  something empty. QZ treats a request claiming a signature it cannot verify as
  a failure, and a print that fails loudly beats one that hangs at a counter.
- **The setup screen says which of the two states the branch is in**, so it is
  not discovered from a dialog during service.

**The certificate is self-signed** (owner decision, 2026-09-10) — free, and its
whole cost is that each counter machine has to trust it once, by having the
certificate in QZ Tray's own installation directory as `override.crt`.

**So the POS hands the branch that file, ready to run.** A browser cannot write
to Program Files, so something has to run as administrator on that machine —
and the difference between a branch coping and a branch ringing for help is
whether that something is *one file they already have* or a certificate emailed
separately, a path to type and an order to do them in.
`print/certificateInstaller.ts` builds the installer **with the certificate
inside it**: Print settings → "Download the certificate installer" → run it as
administrator. Nothing to pair up, no path to type, nothing to do in the wrong
order.

Four things it gets right, none of them visible from a screen — a script with
the wrong path writes a certificate nowhere and the branch is still prompted,
with everything on screen saying it worked:

- **The path per platform**: `C:\Program Files\QZ Tray\override.crt`, and on a
  Mac *inside* the bundle at `Contents/Resources/`, not beside it.
- **It restarts QZ Tray**, which reads the certificate at startup — a copy
  without a restart changes nothing until the machine is next rebooted.
- **It filters the Program Files roots before joining them.** Under
  PowerShell's `ErrorActionPreference = Stop`, `Join-Path` on an unset
  `ProgramFiles(x86)` throws, and the script dies before it can say why.
- **It refuses clearly when QZ Tray is not installed**, rather than creating a
  directory that looks right and does nothing.

An unrecognised platform gets the **shell** script rather than the PowerShell
one: a `.sh` on Windows is an inert file somebody asks about, where a `.ps1` on
a Mac is a confusing failure at the moment it mattered.

Unconfigured, or with the step skipped, everything still prints — the branch is
asked to allow printing once each session, which is a nuisance rather than a
fault. See `infrastructure/docs/qz-tray-signing.md`.

# Frontend–backend feature parity matrix

Date: 2026-10-13, Asia/Manila. **Investigation only. No implementation authorization.**

## Counting and classification

This inventory contains **95 independently reviewable capabilities**: **21 backend-complete, 24 partial, 50 missing**. Frontend maturity: **82 implemented, 2 partial, 2 placeholders, 9 absent**. The 84 implemented/partial frontend capabilities comprise **21 complete, 23 partial, 40 missing** backend capabilities. The other 11 entries explicitly mark requested investigation categories that are placeholders or absent, rather than expanding operational parity.

Count each ID below exactly once. A create action and an edit action are distinct commands; a pricing calculation and editing its reference definition are distinct responsibilities. Do not count every field, button, test or route as another feature. Multi-page rendering of the same behavior has one row. Route coverage is recorded separately and adds no feature count. Counts express coverage, not a production-readiness percentage.

**Complete** means the backend supports the row's explicitly bounded behavior, or no backend command is needed for that presentation behavior and canonical reads supply it. It does **not** mean the rich demo component is already connected. **Partial** means usable schema/read/command support exists but cannot deliver the complete row. **Missing** means no supported service/contract delivers the behavior; status enums, JSON columns and future plans do not count as completed commands.

Demo **Local** means genuine validation/calculation/state mutation in browser memory; it is not durable, bank-connected or authenticated. Display and API-only behavior are distinguished. P0/P1/P2 follow essential stay operations / existing financial-operational completeness / specialized or new scope. Channel financial workflows are P1 because this UI already supports them; hotel usage frequency remains unknown.

Each effort cell is a **facet estimate**, including its direct verification, with H/M/L confidence. Facets share infrastructure and overlap: **do not sum the rows**. Use the non-overlapping W0–W9 package estimates in [the roadmap](revised-implementation-roadmap.md). No hours are assigned to absent future capabilities here.

## Source and contract keys

| Alias | Exact inspected source / responsibility |
|---|---|
| RP | [ReservationPane.tsx](../../src/components/reservations/ReservationPane.tsx): submitReservation, addRoom, changeAssignedRoom, updateRoom, addCharge, addAdjustment, createGuest, changeSource, breakfast and billing sections |
| AF | [ApiReservationForms.tsx](../../src/components/reservations/ApiReservationForms.tsx): supported create/edit/guest forms, conflict review |
| RD / PRINT | [ReservationDetailPage.tsx](../../src/pages/ReservationDetailPage.tsx), [ReservationPrintPage.tsx](../../src/pages/ReservationPrintPage.tsx): saved details/actions and browser-print summary |
| DASH / RESLIST / GUESTPAGE | [DashboardPage.tsx](../../src/pages/DashboardPage.tsx), [ReservationsPage.tsx](../../src/pages/ReservationsPage.tsx), [GuestsPage.tsx](../../src/pages/GuestsPage.tsx) |
| ROOM / CFG / RC | [RoomsPage.tsx](../../src/pages/RoomsPage.tsx), [ConfigurationPage.tsx](../../src/pages/ConfigurationPage.tsx): saveRoom, save, persist, readiness handlers; [roomConfiguration.ts](../../src/lib/roomConfiguration.ts) |
| LC / UA / AV / CO | [reservationLifecycle.ts](../../src/lib/reservationLifecycle.ts), [useReservationActions.ts](../../src/app/useReservationActions.ts), [availability.ts](../../src/utils/availability.ts), [calendar.ts](../../src/lib/calendar.ts): getCalendarOccupancy and position helpers |
| CAL / CL / CT | [AvailabilityCalendar.tsx](../../src/components/AvailabilityCalendar.tsx), [calendar view components](../../src/components/calendar/DayCalendar.tsx) and MonthCalendar/WeekCalendar/YearCalendar in that directory; [CalendarStayLayer.tsx](../../src/components/calendar/CalendarStayLayer.tsx); [CalendarToolbar.tsx](../../src/components/CalendarToolbar.tsx) |
| RPc / PR / DR | [roomPricing.ts](../../src/lib/roomPricing.ts), [reservationPricing.ts](../../src/lib/reservationPricing.ts), [reservationDraftPricing.ts](../../src/lib/reservationDraftPricing.ts): buildReservationPriceLines |
| LD / DP / DE / ADD | [LineDiscountSelector.tsx](../../src/components/reservations/LineDiscountSelector.tsx), [discountPresets.ts](../../src/lib/discountPresets.ts), [DiscountPresetsEditor.tsx](../../src/features/discounts/DiscountPresetsEditor.tsx), [AppliedDiscountDescription.tsx](../../src/components/reservations/AppliedDiscountDescription.tsx) |
| AD / RA / AH / SLA | [reservationAdjustments.ts](../../src/lib/reservationAdjustments.ts), [reservationAudit.ts](../../src/lib/reservationAudit.ts), [ReservationAuditHistory.tsx](../../src/components/reservations/ReservationAuditHistory.tsx), [SavedLineAmounts.tsx](../../src/components/reservations/SavedLineAmounts.tsx) |
| TE / FIN / CF / CA / BCE | [ReservationChannelTermsEditor.tsx](../../src/components/channels/ReservationChannelTermsEditor.tsx), [ChannelFinancials.tsx](../../src/components/channels/ChannelFinancials.tsx), [channelFinance.ts](../../src/lib/channelFinance.ts), [channelActions.ts](../../src/lib/channelActions.ts), [BookingChannelsEditor.tsx](../../src/components/channels/BookingChannelsEditor.tsx) |
| INV / IP / ID / BE | [InventoryPage.tsx](../../src/pages/InventoryPage.tsx), [inventoryProducts.ts](../../src/lib/inventoryProducts.ts), [InventoryDialog.tsx](../../src/features/inventory/InventoryDialog.tsx), [BreakfastEligibilityEditor.tsx](../../src/features/inventory/BreakfastEligibilityEditor.tsx) |
| IE / RI | [RoomTypeInclusionsEditor.tsx](../../src/features/configuration/RoomTypeInclusionsEditor.tsx), [roomTypeInclusions.ts](../../src/lib/roomTypeInclusions.ts) |
| HT / MONEY / TAX | [hotelTime.ts](../../src/lib/hotelTime.ts), [money.ts](../../src/lib/money.ts), [tax.ts](../../src/lib/tax.ts): calculateTax returns zero |
| APP / ROUTER / LAYOUT / DCTX | [App.tsx](../../src/app/App.tsx), [router.tsx](../../src/app/router.tsx), [AppLayout.tsx](../../src/app/layouts/AppLayout.tsx), [ReservationDemoContext.tsx](../../src/app/ReservationDemoContext.tsx) |
| AP / AC / AM / APRO / AAPP | [presentation.ts](../../src/app/api/presentation.ts), [client.ts](../../src/app/api/client.ts), [useMutation.ts](../../src/app/api/useMutation.ts), [ApiProvider.tsx](../../src/app/api/ApiProvider.tsx), [ApiApp.tsx](../../src/app/api/ApiApp.tsx) |
| LOGIN / PERM / LAUNCH | [LoginPage.tsx](../../src/pages/LoginPage.tsx), [permissions.ts](../../src/app/permissions.ts), [run-api.ps1](../../scripts/run-api.ps1) |

Backend evidence for every DB/API status: [router.py](../../backend/app/modules/reservations/router.py), [schemas.py](../../backend/app/modules/reservations/schemas.py), [services.py](../../backend/app/modules/reservations/services.py), [pricing.py](../../backend/app/modules/reservations/pricing.py), [references.py](../../backend/app/modules/reservations/references.py), [reservation models](../../backend/app/modules/reservations/models.py), [core models](../../backend/app/core_models.py), [billing models](../../backend/app/modules/billing/models.py), and [contracts](../../backend/contracts.md).

DB shorthand: RES reservations; ALLOC room_allocations; DUR durations; RATE reference_rates; TYPE room_types; ROOM rooms; SOURCE booking_sources; GUEST guests; PRICE pricing_revisions; AUD operational_audit; REC mutation_receipts. All endpoint references below have prefix `/api/v1/`. “New” means proposed, unimplemented. W dependencies refer to [gap packages](backend-gap-analysis.md).

## Reservations

| ID | Feature / expected behavior | Frontend source | Frontend status | Demo/current behavior | Backend status | DB and API support | Specific integration gap | Dependencies | Priority | Hours / confidence | Required verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R01 | Single-room direct create, save only after commit | RP.submitReservation; AF | Implemented | Local | Complete | RES; POST reservations | Reuse rich pane instead of alternate form | W0 | P0 | 2–4 M | React save/refresh/restart |
| R02 | Hourly package reservation | RP.getStayEnd; RPc | Implemented | Local | Complete | DUR/RATE/ALLOC; POST reservations | Connect existing duration controls | W0 | P0 | 1–2 H | Fractional start and package-once |
| R03 | Overnight reservation | RP.getStayEnd; HT | Implemented | Local | Complete | DUR/company times; POST reservations | Preserve explicit start and hotel-local checkout | W0 | P0 | 1–2 H | Multi-night/year boundary |
| R04 | Multi-room add/remove and atomic save | RP.addRoom/removeRoom | Implemented | Local | Missing | ALLOC unique reservation_id prevents it; new aggregate API | Allocation array and one atomic command | W2 | P0 | 8–12 L | Two-room conflict rolls back all |
| R05 | Per-room custom start/duration/counts | RP.updateRoom/getRoomStayStart | Implemented | Local | Missing | ALLOC one stay; new allocation DTO | Validate distinct room schedules server-side | W2 | P0 | 4–6 M | Mixed durations preserve counts |
| R06 | Reassign room on an existing reservation | RP.changeAssignedRoom | Implemented | Local | Missing | Room FK exists; no reassignment API | Lock old/new rooms and validate history | W2 | P0 | 4–6 L | Competing reassignment and rollback |
| R07 | Edit scheduled arrival/departure and duration | RP.submitReservation | Implemented | Local | Missing | ALLOC timestamps exist; PATCH forbids them | Explicit stay-edit command, pricing decision | W2/W4 | P0 | 4–6 L | Overlap and captured-rate preservation |
| R08 | Change guest on a reservation | RP guest selector | Implemented | Local | Missing | RES guest FK; PATCH forbids guest | Versioned guest-reference edit | W2 | P0 | 2–3 M | Foreign-company and stale guest edit |
| R09 | Notes edit and intentional clearing | RP; AF.ApiReservationForm | Implemented | Local | Complete | RES.note; PATCH reservations/{id} | Reuse rich notes editor and await | W0 | P0 | 1–2 H | Clear/omit/stale/refresh |
| R10 | Adult/child counts edit | RP; AF.ApiReservationForm | Implemented | Local | Complete | ALLOC counts; PATCH reservations/{id} | Map per-room vs single-allocation counts | W0/W2 | P0 | 1–2 M | Strict integers and unchanged price |
| R11 | Rich expanded reservation details | RD | Implemented | Display/local actions | Partial | GET reservations/{id} only narrow DTO | Adapt complete aggregate into existing page | W0/W8 | P0 | 3–5 M | Drawer/detail/calendar agree |
| R12 | Detailed before/after reservation audit | AH; RA | Implemented | Local display | Partial | AUD raw JSON; GET returns summaries only | Typed detailed audit with visibility | W8 | P1 | 3–5 M | Accurate diff and restricted fields |
| R13 | Draft/no-change save and discard | RP.submitReservation | Implemented | Local | Partial | PATCH equal values increment; no no-op command | Dirty-field detection, no request when unchanged | W0 | P0 | 2–3 M | Discard/no-op never mutate |
| R14 | Reservation validation and overlap errors | RP; AV | Implemented | Local | Partial | Strict DTO/locks/GiST for single room | Server validation for rich aggregate | W2/W4 | P0 | 3–5 M | Field errors; no phantom save |
| R15 | Version-conflict review preserving draft | AF; AM | Implemented | API behavior | Complete | RES.version; PATCH 409 | Carry proven conflict UI into rich pane | W0 | P0 | 2–3 M | Two editors and explicit rebase |
| R16 | Same-key retry and durable server replay | AM; AC | Implemented | API behavior | Complete | REC; POST/PATCH receipts | Reuse keyed command boundary | W0 | P0 | 1–2 H | Restart replay; changed body rejected |
| R17 | Unknown-outcome recovery after navigation/reload | AM.useMutation | Partial | In-memory retry | Partial | REC durable; no receipt lookup API | Retain request identity or prevent unsafe abandonment | W0 | P0 | 3–5 L | Lost response then browser reload |
| R18 | Booking-source change with retained prior terms | RP.changeSource; CA.switchChannelTerms | Implemented | Local | Missing | SOURCE direct-only; no terms/history model | Versioned source switch retaining financial evidence | W7 | P1 | 4–6 L | Previous collection/history survives |

## Rooms, occupancy and calendar

| ID | Feature / expected behavior | Frontend source | Frontend status | Demo/current behavior | Backend status | DB and API support | Specific integration gap | Dependencies | Priority | Hours / confidence | Required verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| O01 | Scheduled room availability before choosing room | AV.findClash; RP | Implemented | Local | Partial | ALLOC exclusion; no availability GET | Scoped availability read; create rechecks | W2 | P0 | 3–4 M | Touching ranges and concurrent writer |
| O02 | Check-in, readiness/time guards, whole booking | LC.checkInReservation; UA | Implemented | Local | Missing | Status/actual fields only; new command | Atomic allocation/occupancy/audit transition | W3 | P0 | 5–7 L | Dirty second room aborts all |
| O03 | Checkout and dirty-room handoff | LC.checkOutReservation | Implemented | Local | Missing | Actual fields/readiness only; new command | Atomic release/readiness without erasing schedule | W3 | P0 | 4–6 M | Overdue checkout and rollback |
| O04 | Cancellation including guest-still-present lock | LC.cancelReservation | Implemented | Local | Missing | Status/room pointer; no cancellation API | Capture vacated choice, retain physical occupancy | W3 | P0 | 4–6 L | Cancelled occupant still blocks room |
| O05 | Four precise calendar views | CAL; CL | Implemented | Display/interactions | Complete | Single allocation GET supports existing views | Keep geometry; multi-room projection later | W0/W2 | P0 | 1–2 M | All four views and subpixel edges |
| O06 | Calendar prev/next/today/view and empty-slot opening | CT; DASH | Implemented | Local UI | Complete | No extra DB/API needed for navigation | Reuse toolbar; draft opening via shared commands | W0 | P0 | 1–2 H | Navigation/empty-cell selection |
| O07 | No-show after scheduled arrival | LC.markReservationNoShow | Implemented | Local | Missing | Status enum only; new command | Server-time eligibility, release scheduled block | W3 | P0 | 3–4 M | Too early/stale/replay |
| O08 | Record actual departure after locked cancellation | LC.recordGuestDeparture | Implemented | Local | Missing | Occupancy pointer; no departure API | Release locks and mark dirty atomically | W3 | P0 | 3–4 M | All occupied rooms release exactly once |
| O09 | Vacant/reserved/occupied/overdue/locked indicators | CO; AV | Implemented | Derived local display | Partial | Actual/status fields returned, no lifecycle writes | Explicit physical occupancy DTO plus read projection | W3 | P0 | 2–4 M | Overdue stays and future reservations |
| O10 | Start cleaning/mark clean with occupancy guard | ROOM readiness handlers | Implemented | Local | Missing | rooms.housekeeping_state; no write API | Versioned readiness command with occupancy lock | W1/W3 | P0 | 3–4 M | Occupied-room rejection and handoff |
| O11 | UTC instants and Asia/Manila presentation | HT; AP.apiInstant | Implemented | Local/API | Complete | Aware timestamps/company timezone; current DTOs | Retain raw ISO values beside Date projection | W0 | P0 | 1–2 H | Microseconds preserved, midnight mapping |
| O12 | Maintenance/operational status distinct from occupancy | ROOM; CFG | Implemented | Local | Partial | rooms.operational boolean only | Status definitions and owned references | W1 | P0 | 3–5 M | Maintenance rejects booking, not fake occupancy |

## Pricing

| ID | Feature / expected behavior | Frontend source | Frontend status | Demo/current behavior | Backend status | DB and API support | Specific integration gap | Dependencies | Priority | Hours / confidence | Required verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P01 | Hourly pricing by room type/package, not hours multiplier | RPc.getRoomPriceBasis | Implemented | Local | Complete | RATE/DUR; server pricing.capture_price | Use captured server accommodation line | W0 | P0 | 1–2 H | Package charged once incl zero rate |
| P02 | Nightly rate multiplied by configured nights | RPc; PR | Implemented | Local | Complete | RATE/pricing snapshot; POST reservations | Expose captured unit/quantity in existing UI | W0 | P0 | 1–2 H | Two nights equal two captured units |
| P03 | Line discount preset/final-price override | LD; DP; PR | Implemented | Local | Missing | No discount schema/API | Server sequential capped discount pipeline | W4 | P1 | 6–9 L | Override first, eligible caps, order |
| P04 | Reservation-wide discount stacking/order | RP.addDiscount/addReservationPreset; PR | Implemented | Local | Missing | No discount application schema | Typed application intent and captured reductions | W4 | P1 | 5–7 L | Sequential balance allocation/rounding |
| P05 | Staff-selected discount eligibility and active options | DP; DE | Implemented | Local | Missing | No definitions/application provenance | Capture selected definition and explicit eligibility | W4 | P1 | 3–4 M | Inactive historical option retained |
| P06 | Signed manual adjustment add/remove identity | RP.addAdjustment; AD | Implemented | Local | Missing | JSON accommodation only; no adjustment API | Stable adjustment IDs, audited operational correction | W4 | P1 | 4–6 M | Duplicate identity blocked; negative clamp |
| P07 | OTA accommodation override and proportional allocation | TE; CF.applyChannelPricing | Implemented | Local | Missing | Direct-only SOURCE; no channel snapshot | Server validates override/reason and room allocation | W7 | P1 | 4–6 L | Zero-basis equal split and conservation |
| P08 | Captured accommodation pricing survives rate changes | DR; SLA; AP | Implemented | Local/API | Complete | PRICE revisions and original rate snapshot; GET | Use server snapshot, never current rate for saved totals | W0 | P0 | 2–3 H | Modify current rate, old bill unchanged |
| P09 | Explicit repricing versus locked historical values | RP priceLocked; DR | Implemented | Local | Partial | PRICE supports revisions; no repricing command | Reprice only reviewed changed lines, append revision | W4 | P1 | 4–6 L | Note-only unchanged; explicit price revision |
| P10 | PHP exact minor-unit transport and formatting | MONEY; AP.formatPhp | Implemented | Local/API | Complete | BigInteger/strict DTO/server Decimal | Keep minor units canonical, display conversion only | W0 | P0 | 1–2 H | Half-away rounding and safe integer bounds |
| P11 | Commission estimate and confirmed basis distinctions | CF.commissionEstimate; FIN | Implemented | Local | Missing | No agreements/confirmation fields/API | Capture basis/version; estimates not liabilities | W7 | P1 | 4–6 L | Percentage/fixed/manual/none and overrides |
| P12 | Automatic OTA import/channel-manager synchronization | TE manual reference only | Absent | None | Missing | No adapter/import receipt schema/API | New feature, outside existing parity | Future | P2 | Not estimated | Future provider contract/replay tests |
| P13 | Confirm commission liability from a referenced document | FIN; CA.confirmChannelFinancial | Implemented | Local operational record | Missing | No confirmation model/API | Preserve amount/reference/actor/time apart from estimate | W7 | P1 | 2–4 M | Confirmation versus estimate; concurrent edit |
| P14 | External reference, agreement capture, collector choice and tax-basis flag | TE; CF.createChannelTerms | Implemented | Local | Missing | SOURCE direct-only; no terms DTO/model | Capture applicable version and required per-booking choices | W7 | P1 | 3–5 L | Required external reference/collector; historical agreement |

## Inventory, meals and inclusions

| ID | Feature / expected behavior | Frontend source | Frontend status | Demo/current behavior | Backend status | DB and API support | Specific integration gap | Dependencies | Priority | Hours / confidence | Required verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| I01 | Catalog product CRUD, enable/archive/restore | INV; IP | Implemented | Local | Missing | No catalog table/API | Owned catalog, captured historical references | W5 | P1 | 4–6 M | Archive used item retains old label/price |
| I02 | Category CRUD and system-defined restrictions | INV; IP | Implemented | Local | Missing | No category table/API | Versioned owned categories, restricted deletion | W5 | P1 | 3–4 M | Used/system category rejection |
| I03 | Room-type default inclusions and quantities | IE; RI | Implemented | Local | Missing | Room type lacks inclusion refs | Default link model with quantity and catalog FK | W5 | P1 | 3–5 M | Defaults copied once at capture |
| I04 | Manual inclusion overrides on each room | RP.updateRoom; RI | Implemented | Local | Missing | No inclusion allocation records | Explicit absent/default/removed semantics | W5 | P1 | 3–5 M | Room/type changes preserve manual selection |
| I05 | Breakfast date/guest entitlement generation | RP.getBreakfastDates/getBreakfastKey | Implemented | Local | Missing | No service-date entitlement schema | Stable entitlement IDs and date/count validation | W5 | P1 | 4–6 L | Across midnight/count edit/history |
| I06 | Eligible breakfast meal/beverage settings | BE | Implemented | Local | Missing | No breakfast catalog eligibility schema | Owned eligibility links, historical choice support | W5 | P1 | 2–3 M | Archived choices retained, new choices restricted |
| I07 | Meal/beverage selection, included zero-price meals | RP breakfast section; DR | Implemented | Local | Missing | No selection/captured line schema | Entitlement selection and zero-charge snapshot | W5/W4 | P1 | 3–5 M | Included zero; purchase uses captured price |
| I08 | Additional purchases and extra charges/quantities | RP.addCharge/renderChargeSection; DR | Implemented | Local | Missing | No stable catalog charge lines/API | Server captured line quantities and bill contribution | W5/W4 | P1 | 4–6 M | Positive quantity, removed item history |
| I09 | Stock on-hand, movements, suppliers and restocking | INV has no stock movement controls | Absent | None | Missing | No stock ledger/schema/API | New inventory scope; do not count catalog as stock | Future | P2 | Not estimated | Future stock conservation tests |
| I10 | Inventory search/category/show-archived/dialogs | INV; ID | Implemented | Local UI | Missing | No catalog reads; new catalog API | Same filters/dialogs with persisted catalog | W5/W0 | P1 | 2–3 H | Search/archive filtering after refresh |

## Billing

| ID | Feature / expected behavior | Frontend source | Frontend status | Demo/current behavior | Backend status | DB and API support | Specific integration gap | Dependencies | Priority | Hours / confidence | Required verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| B01 | Full accommodation/items/discounts/adjustment summary | RP billing; RD | Implemented | Display/local | Partial | GET PRICE one accommodation line only | Full server snapshot with line-level breakdown | W4/W5 | P1 | 3–5 M | Displayed sum agrees server everywhere |
| B02 | Saved accommodation charge breakdown | SLA; RD; AF | Implemented | Display | Complete | PRICE lines; GET reservations/{id} | Reuse existing saved amounts component | W0 | P0 | 1–2 H | Captured base/unit/quantity after refresh |
| B03 | Additional item charges remain captured | DR; RP; RD | Implemented | Local/display | Missing | No item line DTO/model | Stable lines and captured label/unit/quantity | W4/W5 | P1 | 3–4 M | Catalog price changes don't alter bill |
| B04 | Discount explanation and saved applied reductions | ADD; PR; RD | Implemented | Local/display | Missing | No applied-discount snapshot DTO | Capture rule/order/eligibility/per-line reductions | W4 | P1 | 3–4 M | Discount description equals charged amount |
| B05 | Saved adjustment history and operational removal | AD; AH; RD | Implemented | Local | Missing | No operational adjustment command/model | Audited saved correction, no implicit journal reversal | W4 | P1 | 3–5 L | Before/after raw evidence retained |
| B06 | Tax amount and tax basis presentation | TAX; TE taxBasis | Placeholder | Zero tax/display flag | Partial | PRICE tax_status not_configured only | Keep explicit unconfigured; real tax policy separate | Future/W7 | P1 | Not estimated | No invented VAT from a display flag |
| B07 | Legal invoice issue/finalize/void/credit-document lifecycle | PRINT only printable reservation | Absent | None | Missing | No invoice table/API | New accounting-compatible billing scope | Accounting | P1 | Separate accounting estimate | Document freeze/number/reversal tests |
| B08 | General direct-booking payments/allocation/residual | RESLIST says no payment data; FIN separate channel flow | Absent | None | Missing | No payments/allocation tables/API | New generic payment scope, not already full UI | Accounting | P1 | Separate accounting estimate | Allocation conservation and residual |
| B09 | Deposit/advance recognition and allocation | FIN collections do not model advance lifecycle | Absent | None | Missing | No advance/invoice allocation models | New policy-governed scope, not parity | Accounting | P1 | Separate accounting estimate | Advance applied once; no assumed revenue |
| B10 | Printable saved reservation/billing summary | PRINT | Implemented | Display/browser print | Partial | GET supported slice; API route absent | Reuse print page for canonical full snapshot | W8 | P1 | 2–4 M | Print contains same captured amounts |
| B11 | Verified collections, partial status, guest balance | FIN; CA.recordCollection; CF.verifiedCollection | Implemented | Local operational record | Missing | No collection terms/transactions/API | Payments module records with collector provenance | W6/W7 | P1 | 5–7 L | Collection vs hotel receipt distinct |
| B12 | Collection refund/reversal including historical source | FIN; CA.recordHistoricalCollection | Implemented | Local operational record | Missing | No correction/collection schema/API | Preserve original terms and correction provenance | W6/W7 | P1 | 5–7 L | Refund cap, stale/concurrent reversal |
| B13 | Native journal, reconciliation and ledger reports | No routed accounting pages | Absent | None | Missing | No accounting models/services/API | Planned new module, not operational parity | Accounting | P1 | Separate accounting estimate | Balanced immutable idempotent posting |
| B14 | Record channel settlement batch and reservation allocations | FIN; CA.validateSettlementReservations | Implemented | Local operational record | Missing | No settlement header/allocation models or API | Owned payout/deduction/invoice-reference/offset/adjustment/refund/reversal records | W7 | P1 | 5–7 L | Sum conservation, currency/company, concurrent allocation |
| B15 | Settlement reconciliation status and notes | FIN; CA.reconcileChannelSettlement | Implemented | Local | Missing | No reconciliation model/API | Versioned unreconciled/partial/reconciled/disputed changes with audit | W7 | P1 | 3–4 M | Stale reconciliation, notes and all affected reservation audits |
| B16 | Document expected settlement/entitlement and show actual hotel receipts | FIN; CF.expectedSettlement; CA.confirmChannelFinancial | Implemented | Local records/display | Missing | No confirmation/settlement read DTO | Keep estimates, confirmed entitlement and actual payout distinct | W7 | P1 | 3–5 L | Pending versus zero; payouts less corrections; historical-source isolation |

## Guests

| ID | Feature / expected behavior | Frontend source | Frontend status | Demo/current behavior | Backend status | DB and API support | Specific integration gap | Dependencies | Priority | Hours / confidence | Required verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| G01 | Create independent guest with contact fields | RP.createGuest; AF guest form | Implemented | Local/API | Complete | GUEST; POST guests | Await guest persistence in rich pane | W0 | P0 | 2–3 H | One guest on retry; failed booking doesn't delete guest |
| G02 | Guest search/selection and persisted lookup | RP guest selector; AF; AC | Implemented | Local/API | Complete | GET guests search/pagination | Match case behavior and load all needed options | W0 | P0 | 2–3 M | Literal wildcard names and page bounds |
| G03 | Guest profile edit/delete | GUESTPAGE no edit controls | Absent | None | Missing | Guest fields exist; no PATCH/DELETE | New CRM scope, not parity | Future | P2 | Not estimated | Future version/history constraints |
| G04 | Guest cards, contacts, segment and stay-count display | GUESTPAGE | Partial | Display; segment/stayCount fixtures | Partial | Guest contacts + reservations; no segment | Derive count from actual bookings; no invented segment | W8 | P1 | 2–3 M | No fixture stay counts in API mode |
| G05 | Dedicated guest detail/reservation-history page | GUESTPAGE aggregate count only | Absent | None | Missing | No guest-detail/history route | New CRM scope; retain current card behavior | Future | P2 | Not estimated | Future history/ownership tests |
| G06 | Guest account statement/billing page | No guest billing route | Absent | None | Missing | No receivable/statement model | New billing/reporting scope | Accounting | P2 | Not estimated | Future residual/date-range report |
| G07 | Guest identity retained on reservation detail | RD; RP; AF | Implemented | Display | Partial | GET nested current guest, no guest label snapshot | Choose historical label policy; retain canonical UUID | W0/W8 | P0 | 2–3 M | Stable guest ID and explicit changed name |

## Settings

| ID | Feature / expected behavior | Frontend source | Frontend status | Demo/current behavior | Backend status | DB and API support | Specific integration gap | Dependencies | Priority | Hours / confidence | Required verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S01 | Room type create/edit/archive/capacity/amenities | ROOM; CFG | Implemented | Local | Partial | TYPE core fields only; GET references | Owned write DTO and missing metadata/defaults | W1/W5 | P1 | 4–6 M | Disabled historical type visible |
| S02 | Physical-room create/edit/archive/optional clears | ROOM; CFG; RC | Implemented | Local | Partial | ROOM lacks description/notes/amenity overrides; GET only | Versioned writes preserving ID/assignment/locks | W1 | P0 | 4–6 M | Blank clears and rename preservation |
| S03 | Room status definitions and blocksReservation | CFG; configurationSections | Implemented | Local | Missing | Operational boolean only | Status FK/model; block rules server-side | W1 | P0 | 3–4 M | Status retirement and blockers |
| S04 | Hourly/nightly duration create/edit/enable | CFG duration persist | Implemented | Local | Partial | DUR reads/constraints only | Versioned config writes; existing schedules untouched | W1 | P1 | 3–4 M | Kind compatibility and positive values |
| S05 | Rates CRUD and active-rate uniqueness | CFG roomTypePrices; RPc | Implemented | Local | Partial | RATE constraints/reads only | Write endpoints, money normalization, historical snapshots | W1 | P1 | 3–5 M | Competing active rates and inactive history |
| S06 | Booking-source CRUD/classification/reference rules | CFG; BCE | Implemented | Local | Partial | SOURCE CHECK direct only; reads only | Add classification/reference metadata and writes | W1/W7 | P1 | 3–5 M | Mandatory external ref and disabled source |
| S07 | Hotel check-in/out times and display currency settings | CFG settings | Implemented | Local | Partial | company local times; PHP-only; no writes | Persist time settings; scope non-PHP support explicitly | W1 | P1 | 3–5 L | New booking changes, old schedule/currency retained |
| S08 | Discount preset CRUD/enable/scope/search | DE | Implemented | Local | Missing | No definition table/API | Owned versioned definitions and historical captures | W4 | P1 | 3–5 M | Used preset changes don't alter old bill |
| S09 | Channel agreement version/effectivity/publish/retire | BCE; CF.validateAgreement | Implemented | Local | Missing | No agreement model/API | Immutable published versions, captured agreement links | W7 | P1 | 5–7 L | Effective-date overlap/published edits rejected |

## Navigation and resilience

| ID | Feature / expected behavior | Frontend source | Frontend status | Demo/current behavior | Backend status | DB and API support | Specific integration gap | Dependencies | Priority | Hours / confidence | Required verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| U01 | Login/password and staff permissions | LOGIN; PERM | Placeholder | Cosmetic/local capability flags | Missing | Server local-development actor; no auth | Production prerequisite, new authenticated scope | Future | P0 | Separate estimate | Unauthorized access and server attribution |
| U02 | Explicit demo/API selection, no silent fallback | APP; AC; AAPP | Implemented | Real runtime selection | Complete | Independent API/provider vs fixtures | Keep same selection after shared UI reuse | W0 | P0 | 1–2 H | API failure cannot show demo data |
| U03 | Bootstrap/loading/refresh/error states | APRO; AAPP.ApiGate | Implemented | API behavior | Complete | GET guest/reference/reservation | Retain explicit loading and last-confirmed labels | W0 | P0 | 1–2 H | Empty DB vs unavailable API |
| U04 | 422/409/network errors, await persistence | AC; AF; AM | Implemented | API behavior | Complete | Current error DTO/commit semantics | Extend to existing rich modals/forms | W0 | P0 | 2–3 M | Failed write stays open, no phantom booking |
| U05 | Cross-page canonical state consistency | DCTX; APRO | Implemented | Local/API | Partial | Separate paginated bootstrap; no snapshot cursor | Upsert versions; invalidate linked room/guest data | W0/W8 | P0 | 3–5 L | Old replay cannot overwrite newer state |
| U06 | Reservation search/date/room/status/operational filters | RESLIST | Implemented | Local UI | Partial | GET all pages; API list simpler | Reuse filters; later server filter DTO for scale | W8 | P0 | 2–4 M | Arrivals/departures/overdue and pagination |
| U07 | Drawer/dialog keyboard, tiny-stay chooser/details | RP; CL; ID | Implemented | Local UI | Partial | Only API calendar subset reused | Preserve existing keyboard/target behavior in shared views | W0 | P1 | 2–3 M | Escape/focus/touch selects intended stay |
| U08 | Sidebar routes, unsupported messages and mode labeling | ROUTER; LAYOUT; AAPP | Implemented | Local/API | Partial | API print/discount/inventory routes absent | Restore all route shells; visible capability explanations | W0 | P1 | 2–3 M | No misleading enabled action or fake success |
| U09 | One-command isolated local API launch | LAUNCH | Implemented | Real developer tool | Complete | Existing Uvicorn/PostgreSQL health/API | Keep explicit mode/ownership guards | W9 | P2 | 0–1 H | Check-only/start/owned shutdown |

## Route and component coverage (not additional counts)

| Existing demo route | Actual demo surface | Current API-mode surface | Parity IDs |
|---|---|---|---|
| / | Dashboard calendar, toolbar, rich pane, stay drawer | Reused calendar plus simpler API create flow | R01–R18, O01–O12, U03–U07 |
| /reservations | Operational list, search/date/room/status filters, lifecycle actions | Simpler persisted list | R11, O02–O09, U06 |
| /reservations/:reservationId | Expanded saved details, edit, audit, channel financials, lifecycle | Narrow supported details/edit | R06–R18, B01–B12 |
| /reservations/:reservationId/print | Printable reservation summary | Wildcard unsupported | B10 |
| /rooms | Rooms/types editors, readiness and operational status | Read-only references | O10/O12, S01–S03 |
| /guests | Contact/segment/count cards; no profile edit | Guest list/create | G01–G07 |
| /configuration | Seven sections plus times/currency, inclusion and channel editors | Read-only references | S01–S09, I03 |
| /discounts | Preset editor | Wildcard unsupported; sidebar entry hidden | S08, P03–P05 |
| /inventory | Product/category/dialog/eligibility editor | Wildcard unsupported; sidebar entry hidden | I01–I10 |
| /login | Cosmetic login form; no auth guard | Unsupported | U01 |
| * | NotFoundPage | ApiUnsupported | U08 |

Bootstrap is `src/main.tsx → src/app/App.tsx`; `src/App.tsx` and its starter assets are not the routed HMS application. Shared small helpers such as InfoTip, form labels and status badges belong to their host rows rather than separate backend features. The channel guest summary belongs to B11/P14; settlement allocation, reconciliation and confirmation have explicit P13/B14–B16 rows and detailed W7 contracts.

## Evidence limits

Source paths and existing tests establish implementation paths. Previously recorded HTTP/PostgreSQL evidence corroborates the narrow slice, not rich parity. This audit did not perform database writes, migration/seed commands or browser mutation scenarios. See [summary](parity-audit-summary.md) for newly executed tests and the initial frontend timeout. All verification cells are **future acceptance tests**, not new PASS claims.


# Demo-to-API parity matrix

Progress after this audit: [B1 passed its bounded acceptance gate](b1-initial-financials-checkpoint-2026-10-15.md).
The initial ordinary purchase and initial adjustment gaps recorded below are now closed.
[B2 shared-stay multi-room](b2-multi-room-checkpoint-2026-10-15.md) also closes the named aggregate,
add/remove, allocation lifecycle, calendar and financial projection gaps. B3 custom room stays remain
unsupported at that B2 checkpoint. [B3 independent room stays](b3-custom-stays-checkpoint-2026-10-15.md)
has since closed the custom-stay gap with per-allocation dates/durations, original controls, financial
and lifecycle/calendar verification. Schedule edits require all rooms reserved. Rows below retain the
original audit classifications; read these checkpoints for the
executed changes rather than treating historical missing/single-room labels as current capability.

Audit date: October 15, 2026, Asia/Manila. Source inspection against the current dirty worktree and
accepted billing-document UI baseline, head `68f75a14d5a4`. This is a documentation-only audit:
no application/database changes, test reruns, environment rehearsal or browser mutations performed.
Existing uncommitted work was retained. Earlier parity reports were not treated as current truth.

**Full parity is not complete.** Direct single-room operations are substantially integrated; the
largest remaining model gaps are multi-room/custom allocations and original channel financial facts.
Actual external OTA connectivity and actual payment processing are outside the original demo;
the demo's manually entered channel/collection/settlement records are inside parity scope.

Complete below means the named bounded behavior has code and executed evidence. It does not certify
every combination. Unverified rows are explicit outstanding acceptance work, not missing endpoints.
JSON storage alone does not imply faithful validated support. Source paths below are repository-relative.

## Source and evidence key

| Key | Current sources / existing evidence |
|---|---|
| R | `src/types/reservation.ts`; `src/components/reservations/ReservationPane.tsx`; `src/pages/ReservationDetailPage.tsx`; `src/app/useReservationActions.ts`; `src/lib/reservationLifecycle.ts` |
| C | `src/features/configuration/types.ts`, `sampleConfiguration.ts`; `src/pages/ConfigurationPage.tsx`, `RoomsPage.tsx`, `InventoryPage.tsx`; `src/features/configuration/RoomTypeInclusionsEditor.tsx` |
| H | `src/features/channels/types.ts`; `src/components/channels/BookingChannelsEditor.tsx`, `ReservationChannelTermsEditor.tsx`, `ChannelFinancials.tsx`, `ChannelGuestSummary.tsx`; `src/lib/channelFinance.ts`, `channelActions.ts`; `src/data/channelSamples.ts` |
| A | `src/app/api/contracts.ts`, `RichApiBridge.tsx`, `richPresentation.ts`, `definitionInputs.ts`, `reservationEditInput.ts`, `ApiApp.tsx`; `src/app/ReservationDemoContext.tsx` |
| B | `backend/app/modules/reservations/models.py`, `schemas.py`, `router.py`, `services.py`, `stay_edit.py`, `lifecycle.py`, `readiness.py`, `references.py`; `backend/app/core_models.py` |
| D | `backend/app/modules/configuration/models.py`, `schemas.py`, `router.py`, `services.py`, `breakfast.py`; billing `charges.py`, `discounts.py`, `presets.py`, `overrides.py`, `adjustments.py` |
| E1 | [Integration checkpoint](full-send-session-two-checkpoint-2026-10-13.md); `backend/tests/test_configuration_api.py`, `test_reservation_api.py`, `test_reservation_patch.py`, `test_reservation_lifecycle.py`, `test_room_readiness.py` |
| E2 | [Manual discounts](manual-discounts-checkpoint-2026-10-14.md), [extras](extra-charges-checkpoint-2026-10-14.md), [inclusions](inclusions-checkpoint-2026-10-14.md), [Session 1](session-one-handoff-2026-10-14.md), [breakfast](session-two-checkpoint-2026-10-14.md); corresponding backend and adapter tests |
| E3 | [Presets/recovery](presets-recovery-checkpoint-2026-10-14.md), [final prices](final-prices-checkpoint-2026-10-15.md); `backend/tests/test_discount_presets.py`, `test_final_price_api.py`, `test_final_price_pipeline.py`, `test_special_boundaries.py` |
| E4 | [Latest UI checkpoint](billing-documents-ui-checkpoint-2026-10-15.md): 429 backend / 228 frontend passing; [26 rich browser checks](../../booking-tests/reports/20261015T015732Z-rich-api-integration/results.json), SQL/restart in same directory; document browser eight checks |

## Reservations, occupancy and guest data

| Capability / demo source | Expected behavior | PostgreSQL representation | FastAPI | API-mode UI | Evidence | Status / exact remaining gap |
|---|---|---|---|---|---|---|
| Direct single-room create; R | Guest, room, hourly/nightly duration, counts, notes; await save | Reservation + one owned allocation + pricing/audit/receipt | POST `/reservations` | Dashboard and calendar create | E1/E4 | **Complete** for this bounded workflow |
| Read, calendar selection, detail; R; `DashboardPage`, `ReservationsPage`, calendar components | Persisted stays, list/detail navigation, filters/search | UTC allocation, status, captured pricing | List/detail/reference GET | Shared original presentation | E1/E4 | **Complete** for single-room reads; four-view interaction/rare-edge coverage remains below |
| Primary guest, notes, adult/child edits; R | Clear notes, preserve omitted fields, keep draft on failure | Existing fields, reservation version | PATCH notes/counts; POST `edit-details` | Original selectors/forms + explicit conflict review | E1/E4 | **Complete** within supported reservation states |
| Pre-arrival room/arrival/duration edit; R | Stable assignment, availability, new rate only when appropriate | One allocation; revisioned captures | POST `edit-stay`, `edit-stay-charges` | Original pane | E1/E4 | **Complete** confirmed/reserved only |
| Multi-room add/remove; R | Several independently counted/charged rooms in one reservation | `room_allocations.reservation_id` unique; pricing lines max 1 | Singular `room_id`, `allocation` | Second Add room disabled; submit requires exactly one room | B/A; demo models/controls | **Missing** aggregate representation and operations; not just disabled UI |
| Custom room stays; R | Each room may depart from reservation-wide dates/duration | Dates exist but only one allocation; no multi-room contract | Only one scheduled start/duration; end derived | Custom stay fieldset disabled | R/B/A | **Missing** full room-specific stay behavior |
| Stay changes after arrival; R | Demo edit form permits stay-field changes; preserve actual occupancy | Fields exist | `stay_edit` restricts confirmed/reserved | Stay section disabled for checked-in | R/B; source inspection | **Partial** demo editing latitude is narrower in API; define exact valid transitions without weakening overlap/occupancy integrity |
| Check-in, checkout, cancel, no-show, delayed departure; R | Clean/operational/window checks; actual occupancy distinct; dirty after release | Actual instants, availability flag, room occupancy pointer | Five explicit lifecycle POSTs | Shared summary/detail actions and messages | E1/E4; lifecycle tests | **Complete** direct single-room lifecycle; multi-room atomicity absent |
| Guest name/phone/email creation; R; `ApiReservationForms.tsx` | Independent guest save; select new guest | `guests` fields | POST/list/search `/guests` | Original pane popup; Guests route API form | E1/E4 | **Complete** basic fields; separate page/modal parity needs entry-point review, not a new guest-edit feature |
| Guest segment, earlier stay count; `datasample.ts`, `GuestsPage.tsx` | Show New/Returning/VIP/Loyal and historical stay count | No segment or prior-stay count fields | Guest DTO only name/phone/email | Segment blank; count derives current reservations only | Models/DTOs inspected; no persistence evidence | **Partial** sample values carry operational meaning; explicit segment/history policy needed (B12) |

## Room and reference configuration

| Capability / demo source | Expected behavior | PostgreSQL representation | FastAPI | API-mode UI | Evidence | Status / exact remaining gap |
|---|---|---|---|---|---|---|
| Room/type create/edit incl. optional clearing; C | Auto Operational on create; name/type/capacity/description/notes/amenities | Owned versioned room/type metadata | Configuration POST/PATCH | Dedicated Rooms and generic Configuration | E1; room-status correction; E2/E4 | **Complete** ordinary create/edit; do not resurrect fixed `api-operational` mismatch |
| Room/type archive/restore; C | Retire/reactivate with assignment/history guards | Existing `enabled`, `archived` | Versioned retirement POST and configuration PATCH | Original Rooms and generic Configuration; active/archived filter | B4 focused PostgreSQL/browser + SQL/restart | **Complete** bounded B4; demo unchanged |
| Room/type permanent deletion; C | Unused records only; retain all protected history | Owned FKs, snapshot/audit dependency checks | Versioned/idempotent retirement action `delete` | Original confirmed Delete; blocked errors retain record | B4 focused concurrency/rollback and real browser | **Complete** bounded B4; no dependent cleanup |
| Room rename after reservation use; C | Dedicated form rejects history rename in both modes | Stable UUID plus captured labels | Rejects referenced number change | Dedicated form also rejects in demo | `RoomsPage.saveRoom`, D | **Complete** restriction matches dedicated demo; generic-form behavior must be compared, not assume rename is required |
| Hourly/nightly duration and rate definitions; C | Create/edit/enable, exact prices, nightly quantity | Versioned durations/rates, partial active uniqueness | Configuration duration/rate POST/PATCH | Generic forms | E1/E3/E4 | **Complete** PHP; disabled-history and all definition enable toggles require boundary verification |
| Room operational status assignment; C | Operational/Housekeeping/Maintenance distinct from readiness | Checked text enum + consistent boolean; legacy unavailable | Room edit | Dedicated selector and generic form | status correction/E4 | **Complete** predefined choices |
| Custom status definitions; C | Create/edit/enable label and blocksReservation | No owned status-definition table; closed enum | No status-definition endpoint | Generic roomStatuses disabled | C/B/A | **Missing** configurable statuses; fixed enum is not full demo parity |
| Housekeeping Start cleaning / Mark Clean; C | Only unoccupied room readiness changes | Versioned housekeeping + occupancy guard | POST `/rooms/{id}/readiness` | Original dedicated controls | E1/E4 | **Complete** two original dedicated actions |
| Generic Configuration readiness selector; C | Original form exposes Clean/Dirty/Cleaning | Same housekeeping field exists | Readiness command permits clean/cleaning only; room-definition adapter rejects changed readiness | Selector disabled in API mode | Configuration fieldsFor / definitionInputs inspected | **Partial** original entry point and manual Dirty assignment missing; B10 must reconcile safe occupancy guards, not silently remove the action |
| Hotel default check-in/out; C | Save policy wall-clock times for future stays | Company TIME fields/timezone exist | No settings mutation | Save hotel settings disabled | B/C/A | **Partial** data exists, writes missing |
| Hotel currency setting and rate currency; C; `money.ts` | Demo settings accept three-letter currency; existing captures retained | Company currency exists; rate/pricing/charge checks and DTOs enforce PHP | PHP-only | Settings disabled, adapters reject non-PHP | C/B/D/A | **Partial** actual original control, not automatically outside scope; requires safe hotel-currency policy or explicit approved PHP exception |

## Inventory, entitlements and pricing

| Capability / demo source | Expected behavior | PostgreSQL representation | FastAPI | API-mode UI | Evidence | Status / exact remaining gap |
|---|---|---|---|---|---|---|
| Ordinary categories/products; C | Create/rename/edit category, selling flag, exact price | Shared owned category/product tables | Configuration POST/PATCH | Original Inventory + Configuration product forms | E1/E4 | **Complete** basic definitions; category/product archive boundaries below |
| Amenities; C | Non-sellable amenity definitions; inheritance/additions/removals | Amenities categories/products + room/type JSON lists | Existing definitions | Shared controls | Code + configuration tests; no named full amenity browser path | **Unverified** complete inheritance/reclassification/retirement comparison |
| Product archive/restore; C | Retire new selections, retain captured history | Product enabled/archived | Product PATCH | Original dialog | E2 inclusion unused-product browser; backend cases | **Unverified** ordinary/extra and already-used default/captured cases not individually browser-proven |
| Category archive/restore; C | Ordinary category retirement; protected categories preserved | Category enabled/protected checks | Category PATCH | Original Manage categories | Source implementation; no named full browser case | **Unverified** original archive/restore path and effects on choices |
| Empty ordinary category delete; C | Delete only empty nonprotected category | FK prevents unsafe removals | No DELETE | Disabled | C/D | **Missing** safe unused-category deletion (B13) |
| Protected extras; C/R | Stable identity, configurable label, quantities, distinct extra_charge | Protected category; shared products; typed captures | Definitions/create/billing commands | Original Inventory/Configuration and pane selectors | E2/E4 | **Complete** direct single-room extras, including initial create |
| Inclusions/default reconciliation; C/R | Default vs manual quantities, zero override, clear/reset, captured labels | Owned defaults; allocation captures/origins | Definitions/create/edit-inclusions/mixed commands | Original Rooms/Configuration/pane | E2/E4; special boundary API/browser | **Complete** core slice; combined browser competition remains below |
| Complimentary breakfast; C/R | Eligible meal+drink, nightly dates, included/skipped/unrecorded; separate paid meals | Protected virtual category, eligibility, zero allocation captures | Breakfast config/create/edit/reconciliation | Inventory, both Configuration widgets, pane | E2/E3/E4 | **Complete** bounded nightly workflow; retired choices/quota browser edges verified |
| Paid ordinary purchases after creation; R | Quantity/add/remove, historical captured price | Pricing charges and classification | `edit-charges` and mixed commands | Original room settings | E1/E4 | **Complete** existing reservation purchase workflow |
| Initial ordinary purchases; R | Demo can add purchases before first save | Captures can represent them; create charges field exists | Create uses shared resolver permitting ordinary available-for-sale purchase intents | Explicitly disabled until saved | Pane gate; services/charges inspection; E1/E2 | **Partial** frontend gate remains; focused create/atomic-capture verification required, extra create success is not ordinary-purchase proof |
| Signed adjustments on saved booking; R | Exact amount/reason, add/remove distinct entries | Captured signed entries + history | `edit-billing` and mixed commands | Original controls | E1/E4 | **Complete** saved booking |
| Initial adjustments; R | Demo can add before first save | Pricing can store them | ReservationCreate lacks adjustments | Disabled until saved | B/R/A | **Partial** initial command/DTO/hash-compatible extension missing |
| Manual fixed/percentage discounts; R | Room/item then reservation, sequential caps/rounding | Captured intents/allocations schema 4/5 | Create/edit/mixed server calculation | Original controls | E2/E4 | **Complete** direct single-room scopes |
| Configured fixed/percentage presets; discount types/editor; R | Configure/select/apply, targets and captured historical terms | Owned presets + captured definition version | Configuration/create/edit commands | Original editor/selectors | E3/E4 | **Complete** core configure/select/edit/disable; Enable and named competition boundaries below |
| Set Discounted Price; same sources | Replace unit once before reductions; room package coverage/item quantity | Schema 5 captures separate replacement amounts | Same authoritative pricing commands | Original final-price builder/selectors | E3 latest final-price checkpoint, 13 browser checks | **Complete** configured room/item replacement; arbitrary reservation-wide final total is not an existing implemented demo action |
| Preset deletion; discount editor | Demo removes definition, snapshots remain | References/captures permit historical identity design | No DELETE | Disabled; Disable available | A/D | **Missing** explicit safe deletion/retirement equivalence decision (B14) |
| Billing totals, detail and reservation print; R; `ReservationPrintPage.tsx` | Saved captured amounts, replacements/discounts/extras, no current-price rewrite | Current capture + append-only pricing history | GET exposes current capture | Original routes and separate effects | E3/E4 | **Complete** supported single-room data; channel/multi-room prints wait for their models |

## Channels, history and presentation

| Capability / demo source | Expected behavior | PostgreSQL representation | FastAPI | API-mode UI | Evidence | Status / exact remaining gap |
|---|---|---|---|---|---|---|
| Booking source definitions; C/H | Add/edit/enable classification/reference-required/notes | booking_sources only direct source_id, label/enabled | Read only | Generic writes disabled; channel editing capabilities false | B/A/H | **Missing** full source fields/write model |
| Channel agreements; H | Versioned dates/status, pricing/commission/collection/settlement defaults | No agreement tables/validated capture | None | Editor read-only/no agreement data | H/A/B | **Missing** not an external integration requirement |
| External/manual channel booking & reviewed source change; R/H | Reference, captured agreement, accommodation override/reason, tax-basis facts, responsibility; archive old terms | No channel/superseded terms/pricing snapshots | Direct only; no source-change command | Source selector disabled; terms absent | H/B/A | **Missing** all non-direct booking facts and reviewed source correction |
| Guest collection/refund/reversal records; H | Manually verified amounts/references/actor/time, guest balance, old-channel collection | No collection transaction/history model | None | verify_collection false | H/A; demo channel tests only | **Missing** operational records; actual card/bank processing remains outside scope |
| Commission/entitlement/expected-settlement confirmation; H | Distinct confirmed values vs estimates | No matching records | None | confirm_commission false | H/A | **Missing** persist these facts without inventing accounting |
| Settlement batches and reconciliation; H | Partial payouts, multiple reservation allocations, deductions/invoices/offsets/adjustments/refunds/reversals, explanations/status | No settlement/batch allocation model | None | settlement/reconciliation capabilities false; empty array | H/A | **Missing** original manually recorded workflows, not external bank synchronization |
| Audit before/after and readable history; R; `ReservationAuditHistory.tsx`, `reservationAudit.ts` | Human-readable field/line diffs, actors, timestamps | Raw before/after already stored in operational_audit | AuditRead omits before/after; no pricing-history GET | richReservation maps generic actions/summaries only | B/A; E1 transactions verified | **Partial** data preserved but original detailed audit presentation lost; history browsing needs transport/adapter work |
| Calendar geometry, keyboard/tiny targets and all entry points | Four views, clipping, scroll/focus, shared create/edit | Derived; no separate calendar table needed | Existing reads sufficient | Original calendar components | Frontend calendar tests; month/create/edit E4 | **Unverified** API comparison across all four views/tiny targets/inactive-room controls, not a missing calendar backend |
| Rare combined inclusion/preset controls | Preserve competing remote fields, history after retirement, no partial save | Supported captures/commands | Existing atomic endpoints | Existing review paths | API tests E2/E3; partial browser evidence | **Unverified** named gaps: combined stay/financial/inclusion browser race; captured-default retirement; preset Enable; item quantity/removal and room-rate incompatibility conflict review |
| Guest segment vs decorative badges | Segment is business metadata; artwork/nav collapse are not | Segment missing; artwork needs none | See guest row | See guest row | `datasample.ts`, GuestsPage; layout/artwork | **Demo-only presentation** only for artwork/layout/filter/view state; do not use this label for VIP/stay counts |
| Login placeholder and capability simulation | Original login renders inputs only, no working auth | No auth tables | No auth | API local-development actor | LoginPage, permissions, context | **Outside original demo** real authentication; placeholder screen is presentation, not evidence of existing login capability |
| Optional tax fields in TS interfaces | Optional taxAmount/taxDetails exist; no inspected sample values or working tax editor/engine | PHP snapshots explicitly tax not configured/zero | No tax engine | No tax workflow | Types, sample search, schemas | **Outside original demo** tax calculation/statutory invoicing; unpopulated optional types alone do not require a new engine |
| Billing documents, immutable finalize/print | New operational document feature | Documents/counters and immutable capture | Four endpoints | New gated section/print | E4 | **Outside original demo** implemented/verified; correction/credit documents are not a parity blocker |
| Stock, accounting, Odoo, live OTA/payment rails | No original working service | Not implemented | None | No working equivalent | Scope/source review | **Outside original demo**; manual financial records above remain in scope |

## Data-model findings and boundaries

- Original room arrays cannot round-trip through singular allocation/one-line pricing DTOs. Changing
  only the pane would lose room-level counts, dates, charges, inclusions, breakfast and actual instants.
- Source labels alone cannot represent ChannelAgreement, ReservationChannelTerms, superseded terms,
  collection transactions, ChannelPricingSnapshot or ChannelSettlement allocations. None should be
  flattened into ordinary adjustments, discounts or finalized documents.
- Sample guest segment and historical stayCount have no canonical destination. Decide how imported
  history and derived current activity combine; preserve existing demo display rather than counting
  every reservation as a completed stay without review.
- Configurable statuses and non-PHP hotel settings are real original controls. Their restrictions need
  implementation or an explicit user-approved exception. Initial PHP-only approval is not full parity.
- Special categories remain protected, shared-product storage remains compatible, and final-price
  overrides are now implemented. Earlier reports saying these are entirely missing are obsolete.
- No evidence here establishes new data loss in existing databases. The clear presentational losses
  are detailed audit values and guest metadata; deliberate scope gates remain parity gaps, not defects
  to bypass by direct state setters. Source inspection is not a fresh runtime reproduction.

Closure batches and the required acceptance gate are in [the closure plan](demo-api-parity-closure-plan.md).

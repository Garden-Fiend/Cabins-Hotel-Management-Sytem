# Frontend–backend parity audit summary

Date: October 13, 2026, Asia/Manila. **Investigation complete. Implementation has not been authorized.**

The backend is a working, connected **single-room direct-booking slice**, not yet the durable equivalent of the full demo. The limited API pages do not reflect the rich frontend's full capabilities. Full operational integration requires implementing those workflows and reusing the existing interface, rather than making the simpler API screens the permanent product.

## Deliverables and reproducible totals

| Document | Purpose |
|---|---|
| [Feature parity matrix](frontend-backend-parity-matrix.md) | Source-traced capabilities, status, gaps, priorities, facet effort and acceptance tests |
| [Backend gap analysis](backend-gap-analysis.md) | Ten coherent packages, proposed endpoints/DTOs/models, transactions, locks, ownership and accounting boundaries |
| [Integration architecture](integration-architecture.md) | Existing rich UI reuse, separate demo/API providers, canonical state, awaited commands, retry/conflict handling and Mermaid diagram |
| [Revised roadmap](revised-implementation-roadmap.md) | Non-overlapping estimates, dependencies, three scenarios, capacity assumptions and next bounded task |
| This summary | Decision and evidence limits |

Count each uniquely identified matrix row once; route/component coverage does not add extra features. Backend status describes support for that row's bounded behavior, not whether its rich component is already connected or whether production is ready.

| Inventory | Complete backend | Partial backend | Missing backend | Total |
|---|---:|---:|---:|---:|
| All investigated capabilities | 21 | 24 | 50 | **95** |
| Implemented/partial frontend capabilities | 21 | 23 | 40 | **84** |
| Explicit frontend placeholders/absent categories | 0 | 1 | 10 | **11** |

Frontend maturity separately: **82 implemented, 2 partial, 2 placeholders, 9 absent**. These counts are a documented inventory, not a weighted percentage of project completion. A basic formatting/navigation capability and an atomic lifecycle command each count as one, although their effort differs sharply.

## Already operational

Source verifies nine API method/path combinations: live/health, guest create/read, reference read, reservation create/list/detail/PATCH. [ReservationService](../../backend/app/modules/reservations/services.py) implements server-priced direct hourly/nightly creation, notes/count edits with expected version, durable keyed replay, captured pricing, company ownership, raw audit and one commit per command. The allocation exclusion plus room locking protects the supported writes against scheduled overlap.

[ApiProvider](../../src/app/api/ApiProvider.tsx), [ApiReservationForm](../../src/components/reservations/ApiReservationForms.tsx) and typed [client](../../src/app/api/client.ts) connect this slice to React. They load persisted canonical records, await saves, retain failed drafts, expose errors and prevent lower-version responses replacing newer cached records. [presentation](../../src/app/api/presentation.ts) retains UUIDs, versions, raw timestamp strings and captured minor units. Explicit demo mode remains independent; no API-error fallback to fixtures exists.

The demo's richer reservation, lifecycle, pricing, catalog and channel functions do perform meaningful validated local operations. They remain in browser memory. This is different from saying that those functions are placeholders; the main task is to make their contracts and invariants durable on the server.

## Missing for full parity

- Multi-room/custom stays, guest/assignment/date/duration edits, full availability read models and stable per-allocation presentation identity.
- Check-in/out/cancel/no-show, post-cancellation departure, retained physical occupancy and readiness transitions under one transaction.
- Durable reference/configuration CRUD, descriptive room metadata, operational-status definitions and explicit handling of the frontend currency setting.
- Full captured charge lines, discounts/eligibility, adjustments, explicit repricing, inclusions/default overrides, breakfast entitlements/selections and purchases.
- Manual channel agreements/terms and source history, OTA price overrides, commission confirmation, verified collections/corrections, settlement allocations and reconciliation.
- Existing expanded detail/print/audit/filter surfaces connected to a complete canonical aggregate, with supported command boundaries instead of raw demo setters.

Tax is a zero/unconfigured placeholder; login is cosmetic. Legal invoice lifecycle, general direct payment allocations/deposits, journals, stock movements, expanded guest CRM and automatic OTA import are **not existing implemented frontend workflows**. Keep them separately scoped. Channel collections/refunds are implemented local operational records, so do not confuse absence of a generic payment ledger with absence of every financial UI action.

## Critical architectural concerns

1. ReservationPane callbacks are synchronous/unawaited; simply swapping in an API call risks early close/reset and phantom success.
2. Backend allocation uniqueness permits only one room; frontend room-number and synthetic charge IDs cannot be used as durable identities for expanded workflows.
3. Status enums/actual timestamps are not lifecycle services. Scheduled reservation, physical occupancy, operational state and housekeeping must stay distinct under concurrency.
4. Rich saved bills cannot be reconstructed from current configuration. Expand canonical capture/discount/charge DTOs and append revisions; notes/count-only PATCH must continue preserving history.
5. Server receipt replay survives restart, but browser request keys currently live only in the mounted form. Unknown-outcome navigation/reload needs an explicit recovery policy.
6. Audit reads currently omit raw before/after and actor remains local-development. UI capability flags are not authenticated authorization; local parity does not make the system production-ready.

Accounting remains module-owned future work. Stable charge/document identity, captured currency/tax treatment, linked corrections, collector provenance and explicit finalization/posting boundaries must be designed now. Reservation services must not write journal entries. Odoo remains optional and unnecessary for core operations.

## Estimate and schedule decision

Unique W0–W9 packages total **220–340 active engineer-hours**, or **264–408 with 20% contingency**. This includes implementation, direct verification, debugging, integration and broader regression. It excludes separately scoped new accounting and production deployment work. Confidence is low–medium because the source reveals complexity but there is not yet measured full-parity velocity.

One weekday engineer at 6.4 active hours/day has about **88 hours through October 31**, assuming five remaining active hours today. Under those explicit assumptions, the earliest conditional full-parity planning date is **December 9, 2026**, with the upper estimate around **January 8, 2027**, before holiday deductions. These are forecasts, not guarantees. **October 31 full parity is not realistic under the established scope/capacity.**

Recommend **Scenario B: operational parity first**. This follows the user's stated complete-workflow objective and stabilizes bill/terms identities before substantial accounting implementation. Accounting moves to December/January, with a bounded posting/payment vertical slice approximately January/February 2027. Scenario A retains accounting priority but cannot honestly preserve all original dates; Scenario C can target a bounded late-October/early-November kernel while deferring substantial operational parity. Exact assumptions, exclusions and acceptance gates are in the roadmap.

**Next bounded task, after user approval:** restore the existing rich ReservationPane and ReservationDetailPage for currently supported create/read/notes-count PATCH using awaited explicit commands and canonical presentation adapters, preserving demo behavior and drafts. Keep unavailable sections/actions visible with clear explanations. Estimated **12–18 active hours**; no new backend business rule or schema is needed for that checkpoint.

## Audit verification and preservation

Newly executed during this investigation:

| Command/check | Actual result |
|---|---|
| npm test -- --run | 185 passed, 1 inclusion test hit its default five-second timeout |
| npm test -- src/components/reservations/ReservationInclusions.test.tsx | Isolated repeat: 1 passed |
| npm test -- --maxWorkers=2 | Full repeat: **186 passed in 33 files** |
| backend scripts/python.ps1 -m pytest -q, without --postgres | **40 passed, 94 skipped**, one existing TestClient deprecation warning |
| Source/contract/route/model/migration/test inspection | Completed; matrix references actual files/functions |
| Planning-document consistency check | 95 unique IDs, backend/frontend totals, 12-column matrix rows and all relative file links validated |

The timeout did not reproduce in isolation or the lower-concurrency full repeat; this suggests contention sensitivity but does not prove its root cause. No test or timeout setting was changed.

The earlier 134-test PostgreSQL suite and browser refresh/restart/concurrency results are **historical evidence**, recorded in [PATCH checkpoint](backend-patch-checkpoint-2026-10-13.md), [Tuesday checkpoint](backend-tuesday-checkpoint-2026-10-13.md) and [integration checkpoint](frontend-api-integration-2026-10-13.md). They were not rerun here. PostgreSQL tests and HTTP/browser harnesses seed/create data, so they were intentionally excluded to satisfy this audit's no-record-change instruction. Live database state/migration head and production readiness were not newly verified. Frontend lint/build and migration checks were not rerun for these documentation-only changes.

Existing uncommitted frontend/backend/package/report work was inspected and preserved. Only the five requested planning documents were created by this audit. No business logic, schema, migration, seed data, existing tests or database records were changed. No commit or push. **Stop here; roadmap implementation awaits review and authorization.**

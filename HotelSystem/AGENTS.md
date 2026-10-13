# Repository guidance

## Current application
- Single-property React/TypeScript/Vite frontend demo. Nothing is multi-property or enterprise-scoped.
- All business data lives in ReservationDemoProvider memory and resets on reload.
- Do not describe authentication, persistence, payments, tax, stock tracking, or reporting as implemented unless the code actually implements them.
- spec.md is a roadmap, not a backlog. Do not implement spec.md items unless asked.
- Before changing pricing, discount, or totals code, read docs/room-pricing.md and docs/discounts.md. They describe current financial behavior.

## Ownership
- src/app: bootstrap, routing, layouts, shared state, action hooks.
- src/pages: route composition and screen-level interaction.
- src/components: reusable UI and domain form sections.
- src/lib, src/utils: pure calculations and business rules.
- src/types, features/configuration/types.ts: domain contracts.
- src/data, sampleConfiguration.ts: fixtures, not live data services.

## Domain rules
**State model**
- Keep four things distinct: reservation status, physical occupancy, room operational status, housekeeping readiness.
- When one changes, update reservations, stays, occupancy locks, and room readiness together so they stay consistent.
- Enforce lifecycle transitions in domain functions, not only by hiding buttons.

**Data integrity**
- Never break existing assignments when editing room identifiers.
- Unrelated edits must preserve saved timestamps, captured prices, historical labels, actual timestamps, and audit history.
- Keep disabled historical options visible on records that already use them (e.g. a retired room type on an old reservation), but do not offer them for new selections.
- Keep seed-rate history separate from current pricing configuration.

**Pricing**
- Price accommodation by room type: hourly package amount, or nightly base amount multiplied by configured nights.
- Apply discounts in their sequential order and respect eligible-balance caps.

**Validation and time**
- Validate occupancy, quantities, intervals, and currency the same way at every editing entry point. Reuse the shared validators and selectors in src/lib and src/utils instead of copying checks into pages.
- Use the hotelTime helpers for all Asia/Manila dates and inputs. Do not build dates with bare `new Date()` parsing.
- Preserve full timestamp precision in calendar geometry. Rounding to the hour or day breaks hourly stays.

## Change discipline
- Prefer small pure functions and focused components.
- Do not add state libraries, generic service frameworks, or permission systems without a concrete requirement.
- Follow the user's stated scope. Do not install packages, run commands, or edit files beyond what was asked or restricted.

## Hard restriction: preserve polished demo UI behavior during backend integration
- The existing demo UI is the behavioral specification for backend integration. Preserve its layouts, interactions, defaults, available choices, intentional clearing, validation and lifecycle behavior unless the user explicitly authorizes a behavior change. General authorization to implement persistence does not authorize redesigning or weakening that behavior.
- Adapt backend DTOs, identifiers and persistence commands to the existing workflows. Normalize mode-specific IDs/defaults at the integration boundary; never leave a demo default invalid in API mode. Do not require users to supply a field that the existing form intentionally supplies automatically or does not expose.
- Before implementing an affected workflow, inspect its demo behavior and inventory every entry point: dedicated pages, generic Configuration forms, dashboard/calendar actions, panes and expanded details as applicable. Inspect create, edit, reset/reopen and error paths separately. Two forms using the same endpoint are separate verification targets.
- Verify each affected supported entry point through its actual original UI in API mode, including successful persistence/refresh and failed-save draft retention. Compare defaults, required/optional fields, option values and validation messages against demo behavior. Passing backend tests or a different form's browser test is insufficient.
- Do not report an entire workflow as integrated or verified when only one entry point was checked. Name the verified entry points and identify unverified or failing paths explicitly. Aggregate test counts do not override a known UI failure.
- A backend-supported action that is impossible through its original UI is an integration defect, not an unsupported feature. Fix and verify such defects before expanding into new integration features when implementation is authorized. Do not use an alternate screen as the acceptance substitute.
- Truly unsupported backend actions must remain clearly gated without simulated success or demo-data fallback. Disabling an action does not count as restoring parity. Preserve independent demo behavior and its regression tests.
- Known example: Rooms → Add room automatically supplies Operational in demo mode and has no status selector. API mode must translate that default correctly; checking Configuration → Rooms alone does not verify the dedicated creation form.

## Verification
- Run from HotelSystem/: `cd HotelSystem && npm run lint`, `npm test`, `npm run build`.
- Add focused regression tests for any changed business behavior.
- Use deterministic clocks in time-sensitive tests.
- When changing reservations or configuration, check that other screens that read the same data still agree.
- Report only the checks you actually ran. If a check was not run, say so rather than implying it passed.
- Say plainly when behavior is simulated in memory rather than persisted.

# HMS defect investigation and implementation clarification

Date: 2026-10-12, Asia/Manila. Phase: investigation only. **Implementation authorization has not been granted.**

This report separates observed browser failures, conclusions established from source, recommendations, and unresolved policy. No application code, dependencies, business rules, fixtures, or existing test reports were changed for this investigation. No browser scenarios were rerun: preserved evidence was sufficient, and reservation/configuration scenarios modify session data. Proposed tests below are not newly executed results.

## A. Executive Summary

| Defect | Root cause and evidence | Operational harm | Proposed immediate correction |
|---|---|---|---|
| Financial adjustment identity, P0 | `adjustment-${Date.now()}` produces equal IDs under a fixed clock. Removal filters every matching ID. Both +100 and +200 appear and affect the preview; removing the first removes both. | High: an unintended bill reduction and ambiguous audit presentation. The failed test proves draft loss; saving that incorrect draft is a possible consequence, not a verified posted transaction. | Generate UUID identities through a focused adjustment helper, enforce uniqueness within the current adjustment list, and refuse ambiguous removal. Preserve existing pricing and lifecycle behavior. |
| Optional room fields, P1 | Application validation exempts capacity, description, and operational notes, while the generic input renderer marks them `required`. The browser blocks submission first. | Medium: legitimate edits, including housekeeping readiness changes, cannot be saved. Stale readiness can affect operational decisions. No resulting improper check-in was demonstrated. | Make room input requiredness match the existing application contract; retain validation of mandatory fields and positive integer capacity when supplied. Preserve intentional clearing. |
| Short-stay calendar bars, P1 | A 24px horizontal padding plus 2px border floor overrides smaller proportional widths. Month and year widths fail preserved DOM measurements. | Medium: staff can misread occupied duration and apparent gaps. No underlying availability or billing calculation defect was demonstrated. | Remove layout padding/border floors from the element representing time, position labels independently inside it, and remove the external start offset. Decide separately how subpixel stays remain practically discoverable. |

The preserved aggregate contains **125 PASS, 3 FAIL, 6 BLOCKED**, covering 128 executed scenarios out of 134 discovered. These totals do not establish production readiness. The application is an in-memory prototype; reload discards business data. Authentication, durable financial records, real banking, and a real accounting journal are not established by this suite. Existing collection/refund/channel settlement interfaces simulate operational records and must not be described as a production ledger.

Recommended order: adjustment identity first; room validation next; calendar geometry next. None requires adding a database or accounting system. Resolve posting/reversal policy before subsequently implementing persistent financial records; it is not a prerequisite for the narrowly scoped identity correction.

Evidence: [findings](../../booking-tests/FINDINGS.md), [coverage report](../../booking-tests/reports/coverage/index.html), [machine-readable results](../../booking-tests/reports/coverage/results.json), [execution history](../../booking-tests/reports/coverage/execution-history.json), [scenario matrix](../../booking-tests/SCENARIO-MATRIX.md).

## B. Codebase Findings

### B1. Financial adjustments

#### Code path and identity consumers

| Responsibility | File / location | Current behavior |
|---|---|---|
| Contract | `src/types/reservation.ts`, `ReservationAdjustment`, approximately line 180 | `{ id: string; amount: number; reason: string }`. No adjustment posting state, author, reversal link, currency field, or individual timestamps. |
| Draft storage | `src/components/reservations/ReservationPane.tsx`, initialization around 613 | Copies saved adjustments into pane state. Add/remove changes the draft, not provider data immediately. |
| Creation | Same file, `addAdjustment`, 985–1005 | Rejects nonfinite/zero amount and blank reason; appends a timestamp ID, amount, trimmed reason. |
| Preview calculation | Same file, around 676; `src/lib/reservationPricing.ts`, around 61 | Passes every adjustment amount to the pricing calculation. IDs do not deduplicate arithmetic. Signed amounts use existing minor-unit money rules; final total is clamped at zero. |
| Save | `submitReservation`, around 1030 and 1255–1270 | Serializes the draft array into the next complete reservation snapshot and appends audit entries. No adjustment-ID uniqueness validation was found. No-change save preserves the original snapshot. |
| Provider update | `src/pages/ReservationDetailPage.tsx`, `saveReservation`; `src/pages/DashboardPage.tsx`, reservation save handlers | Replaces the reservation and corresponding stays in provider state. No database write. |
| Removal | `ReservationPane.tsx`, around 2555 | `filter(item => item.id !== adjustment.id)` removes every item with that ID. |
| React keys | Same file, adjustment list around 2544 and billing breakdown around 2644 | Uses adjustment ID as list identity. Duplicate keys are unsupported. |
| Saved display / print | `src/pages/ReservationDetailPage.tsx:387`; `src/pages/ReservationPrintPage.tsx:181` | Saved adjustment rows also use IDs as React keys. |
| Audit creation / editing | `ReservationPane.tsx`, `buildAuditEntries`, around 220, 282 and 350 | Creation emits one added event per adjustment. Later saved array changes emit a before/after array event. |
| Audit interpretation | `src/lib/reservationAudit.ts`, 54–91 | Converts before/after lists into Maps keyed by identity; duplicate keys overwrite earlier entries in the human-readable diff. Raw serialized arrays can still contain both. |
| Fixtures | `src/data/demoReservations.ts` | Seed IDs include descriptive strings. They need not be UUIDs for the current string contract. |

Source references are repository-relative and function names identify the relevant paths; line numbers describe the inspected version.

#### Collision conclusions

The preserved `GAP-DUPLICATE-SUBMIT` case froze the clock at `2026-11-10T15:00:00+08:00`. Both adjustment IDs became `adjustment-1794294000000`. A 1100 base plus 100 and 200 produced a 1400 preview. Removing A also removed B; the expected remaining total was 1300, while removing both returns the draft to 1100. Console evidence contains duplicate React-key errors. This boundary was reproduced in preserved runs, not newly reproduced here.

The same scenario's rapid reservation double-click check passed: it created one reservation. Its name must not be interpreted as evidence that duplicate reservation submission failed.

| Question | Established result |
|---|---|
| Can duplicate adjustments coexist? | Yes, browser evidence and append logic agree. |
| Does removing one delete multiple? | Yes, browser-confirmed in the editable draft. |
| Does editing one alter another? | There is no direct edit-existing-adjustment operation. Add/remove is available. A future ID-based edit would be ambiguous; that outcome is not currently reproduced. Manual discount editing is a separate feature. |
| Does React rendering suffer? | Duplicate-key errors are observed. Do not assert a particular omitted/duplicated row outcome beyond the actual trace. |
| Are totals affected? | Both amounts are initially counted; bulk removal changes the preview unexpectedly. The failure stops before saving the corrupted draft. |
| Can audit distinguish both? | Individual creation events can remain separate. Later full-array human-readable diffs collapse duplicate IDs by Map construction. This additional finding is source-established, not browser-verified here. |
| Are other billing identities affected? | Additional charges use time plus a short random suffix; discounts and some collection/channel operations already use UUIDs. Other room/configuration creation helpers include timestamp paths. These are adjacent risks, not demonstrated instances of this exact failure. No broad ID refactor is proposed. |

Real-clock collision frequency is unknown. A fixed-clock reproduction proves the equal-ID boundary; it does not show that every ordinary rapid interaction collides.

#### UUID assessment and uniqueness guarantee

UUID creation is not centralized across the app: direct calls exist in the pane and configuration/domain helpers. No adjustment consumer inspected assumes numeric ordering or the `adjustment-` prefix; identity is compared as a string. Keep existing IDs unchanged, including fixture strings. Recommend bare UUID strings for new adjustments so a future UUID column does not require stripping an application prefix; any legacy migration still needs an explicit mapping.

`crypto.randomUUID()` creates a cryptographically generated v4 UUID and requires a secure context. MDN documents broad browser availability since March 2022. Chromium desktop is the only browser represented by the preserved suite; the repository does not establish a complete supported-browser contract. HTTPS and trustworthy loopback development origins differ from arbitrary plain-HTTP LAN origins. Feature detection and a declared supported deployment context are needed; a timestamp fallback would reintroduce the defect. Sources: [randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID), [secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).

A random UUID alone is a probability claim, not an absolute uniqueness guarantee. A focused adjustment-domain helper should check the candidate against the current list, retry a bounded number of times, and fail explicitly without mutation if it cannot produce a distinct ID. The append must verify against the latest state, including rapid consecutive additions. Avoid entropy generation or other side effects that become unsafe inside replayed React updater functions. Removal should require exactly one match; duplicates must produce a visible integrity error rather than deleting all matches. Unknown IDs must not delete anything.

This guarantees uniqueness for accepted additions within the current reservation adjustment list, conditional on rejecting invalid input rather than forcing a write. It does not guarantee global uniqueness across devices or persisted records. Future database uniqueness and transactional validation provide that authority. UUIDs also do not solve duplicate-request idempotency.

#### Current lifecycle

The app distinguishes **unsaved pane data** from **saved session snapshots**, but does not distinguish applied/unpaid, finalized/posted, or reversed adjustment records. Reservation lifecycle status and collection verification/reversal operations are not adjustment posting states.

Removal means A for an unsaved addition and B when editing an adjustment already saved in a reservation. It does not implement C, an accounting reversal retaining the original posted entry. Saved removal becomes effective on Save and may produce a before/after audit event. An add then remove before first Save leaves no adjustment event. Closing/discarding the draft does not establish a new financial audit entry.

| Policy question | Current behavior | Recommendation and reason | Immediate impact | Future accounting implication |
|---|---|---|---|---|
| A1: official record cutoff | Save stores session data only; no official posting event. | Treat Save as operational capture, and define an explicit, authorized posting/finalization event for official accounting. Approval needed. | Identity fix must not invent posting on Save or checkout. | Add posting metadata and accounting reference under backend authority. |
| A2: applied but unpaid editable? | Saved adjustments can be removed; no adjustment payment-state guard or edit-in-place UI. | Allow correction of unposted operational adjustments with attributable audit; unpaid alone must not mean unposted. Approval needed. | Preserve current add/remove behavior pending lifecycle work. | Permissions, concurrency and audit must enforce the approved cutoff. |
| A3: finalized immutable? | No finalized adjustment state exists. | Make posted monetary content immutable; retain original reason and identity. Approval needed. | Do not silently lock current reservations. | Establish ledger-grade corrections and authorization. |
| A4: correction by reversal? | No linked adjustment reversal operation. | Posted correction creates a linked opposite entry and, if needed, a replacement; avoids erasing history. Approval needed. | UUID correction adds no reversal functionality. | Store original/reversal relationships and external accounting IDs separately. |
| A5: audit deleted drafts? | Unsaved discarded entries do not create saved financial events. | Keep transient draft changes outside financial audit; audit changes to saved operational records. Optional edit telemetry is separate. | Preserve current save-time audit semantics. | Decide audit retention and authenticated actor attribution separately. |
| A6: ID owner with persistence? | Frontend generates strings. | Frontend may propose draft IDs; backend validates or assigns accepted record identity and database enforces uniqueness. | A focused client helper is sufficient now. | Separate stable record identity from request idempotency and Odoo references. |
| A7: legacy duplicates? | No automatic repair or persistent store; historical session data cannot be inventoried from files alone. | Detect and block ambiguous destructive actions. Preserve raw evidence; explicit reviewed repair must map old identity to distinct records, not discard money. | Prevention must not rekey existing snapshots automatically. | Migration needs reconciliation, immutable history policy, and reference mapping. User must approve any actual repair. |

### B2. Room configuration validation

Relevant paths: `src/features/configuration/types.ts:22`, `ConfigurationPage.tsx` `getRows` (~44), `fieldsFor` (~109), `defaultFields` (~203), value helpers (~233), `replaceItem` (~251), `editRow` (~318), room `persist` (~346), `save` (~470), generic renderer (~808–846). The dedicated editor is `src/pages/RoomsPage.tsx`, `saveRoom` (~108), room form (~366), and readiness handlers (~198).

The generic editor's domain optional set includes `capacityOverride`, `description`, `amenities`, and `operationalNotes`. Every ordinary text/number input nevertheless receives `required`. Native constraint validation stops `onSubmit`, so application validation cannot process an allowed blank. The preserved room 102 test supplied nonblank description/notes and left capacity blank, establishing `valueMissing: true` specifically for capacity. Blank description/notes have the same contradiction in source; they were not independently reproduced in that isolated case.

#### Complete field inventory

Defaults below describe **new records in the generic Configuration editor**; edits initialize from the existing room. HTML/application columns describe that editor unless stated otherwise. A TypeScript `string` permits `""`; it does not imply a nonblank domain requirement.

| Field / model type | New default | HTML required | Application requirement | Model empty allowed? | Current successful save / clear | Proposed classification |
|---|---|---|---|---|---|---|
| `number: string` | `""` | Yes | Nonblank, unique case-insensitively | Structurally yes; domain rejects | Trim and replace; blank rejected | Required; existing assignment references must survive any rename |
| `roomTypeId: string` | First room-type option | No, select | Nonblank; dedicated editor additionally validates active type | Structurally yes; invalid reference not valid domain data | Replace selected ID | Required reference; historical disabled choices must remain legible |
| `displayType: string` | `""` | Yes | Nonblank generic; dedicated editor accepts blank and uses type label | Structurally yes | Generic blank rejected; dedicated blank becomes type label | Ambiguous: required generic today, recommend optional override with fallback only after approval |
| `capacityOverride?: number` | `""` form value | **Yes, erroneous** | Optional; supplied value positive integer | Yes, `undefined` | Blank maps to `undefined`; supplied string to number | Optional, conditionally validated when supplied |
| `description: string` | `""` | **Yes, erroneous** | Optional | Yes, `""` | Trimmed text; blank explicitly clears to `""` | Optional |
| Effective `amenities: string[]` UI | Empty selection | No | Optional checkbox group | Empty array allowed | Converted to additions/removals relative to type defaults; clearing selects no effective amenities | Optional; absence versus intentionally removing defaults differs |
| `operationalNotes: string` | `""` | **Yes, erroneous** | Optional | Yes, `""` | Trimmed text; blank explicitly clears to `""` | Optional |
| `housekeepingState` enum | First option, `clean` | No, select | Nonblank | No empty enum value | Replaces chosen readiness | Required operational state, independently editable subject to approved occupancy policy |
| `roomStatusId: string` | First status option | No, select | Nonblank | Structurally empty string possible; not a valid reference | Replaces chosen operational state | Required operational reference |
| `enabled: boolean` | `true` | No, checkbox | Boolean toggle, not nonblank check | `false` is valid | Replaces boolean; unchecked disables | Required boolean value, not a mandatory checked checkbox |
| `id: string` | Generated when new room saved | Not an input | Identity managed by handler | No valid empty identity | Edit preserves stable ID | System-generated; read-only on edit |
| `archived?: boolean` | Intended `false` | Not in ordinary edit fields | Not an ordinary required field | Absent optional; false valid | **Generic edit can overwrite with false**, see below | Read-only metadata in this form; preserve current value |
| `occupancyLockReservationId?: string` | Unset | Not an input | Lifecycle-managed | Unset allowed | Generic room payload preserves existing lock | System-managed; preserve, never derive from blank descriptive fields |
| `amenitiesAdditions/removals: string[]` | Derived from effective selection | Not independent inputs | Derived | Empty arrays valid | Recomputed relative to selected type | System-derived backing fields, not separately required |

The dedicated Rooms editor already permits blank capacity, description, and notes. Its display-name fallback differs from generic validation. It has separate Start cleaning / Mark clean actions and guards related to occupancy, while the generic form exposes readiness directly. Equalizing these policies is not automatically part of the native-required fix.

#### Storage and preservation

Room edits construct a **full replacement room object** inside a new configuration state value. They do not modify fixture files or a database. It is an immutable React state update, not a partial API patch. `stringValue` trims and maps missing/null-like reads to empty strings; optional capacity explicitly maps blank to `undefined`. Current form types do not establish a null input contract. Numeric general validation sees `Number("") === 0`, but the optional-capacity branch correctly permits blank and rejects supplied zero/fractional values.

`editRow` copies the rendered fields and `enabled`, but omits `archived`; the room payload subsequently uses `booleanValue(values, "archived")`. This can reset archived metadata to false on an ordinary edit. It is a **separate source-established preservation concern**, not a fourth browser-confirmed failure. Recommend explicit preservation of noneditable metadata as a small preventive addition only if that scope is authorized.

Room number participates in saved assignment references. Neither ordinary room payload construction by itself establishes safe cascading rename behavior. Renaming assigned rooms needs a dedicated regression and may need a separate specification; do not expand these fixes into identifier migration. Preserve unchanged room IDs/numbers and locks during optional-field edits.

| Input/storage distinction | Recommended immediate contract | Future persistence contract |
|---|---|---|
| Empty text `""` | Intentionally clear description/notes; do not retain old text through truthy fallback | Keep normalized empty text consistently, unless an approved schema chooses nullable text |
| Blank capacity form string | Normalize to `undefined` (no override) | Serialize explicit clear as `null` for a nullable numeric field |
| `undefined` | Valid current absence of optional override; not an invalid number | JSON omits it; do not rely on it to express a clear operation |
| Missing update property | Current complete-form save does not define a patch contract | In PATCH, missing means unchanged; explicit null means clear only for nullable fields |
| Empty amenity selection | Save the intentional effective empty set, including removals of inherited defaults | Persist structured overrides, not a truthy fallback to old amenities |

Do not use `newValue || previousValue`: it prevents intentional clearing and mishandles valid false/zero values. Preserve noneditable fields explicitly, not by pretending submitted blanks are missing.

#### Related forms and remaining uncertainty

The generic renderer is shared with other configuration sections. Inspected required name/price inputs and conditional overnight duration fields do not establish this same optional-input defect elsewhere. Checkbox groups are excluded from nonblank checks; dedicated channel notes inputs have different rendering. This is a scoped inspection, not proof of all-form validation consistency. Do not remove `required` globally or disable native validation globally.

There is no room schema validator unifying the two editors. Reference membership/active-option handling and readiness transition constraints differ. Those are preventive/policy matters requiring scoped authorization, not justification for adding a form framework.

| Policy question | Current behavior | Recommended answer and impact |
|---|---|---|
| B1: mandatory physical-room fields | Generic requires number/type/display/status/readiness; dedicated display fallback differs | Number, valid type, operational state and readiness are required; optional display override is a recommended harmonization requiring approval. Immediate fix retains each editor's existing display rule. |
| B2: optional blank representation | Text `""`, capacity `undefined`, amenity arrays | Preserve these now. Specify SQL-null/PATCH serialization when persistence is designed; changing current text nullability is unnecessary. |
| B3: intentional clearing | Payload already clears optional fields, but native required blocks it | Yes, explicit blank clears; omitted future patch field preserves. This is technically supported for current optional fields. |
| B4: conditional requirements | Supplied capacity must be positive integer; no documented room-status-specific description/notes rules | Keep capacity conditional validation; do not invent mandatory maintenance notes or type-specific overrides. Business requirements need approval. |
| B5: independent readiness editing | Dedicated actions exist; generic readiness is coupled to form Save | Optional descriptions must not block readiness. Decide whether generic direct transitions remain allowed and what occupied-room restrictions apply. Do not equate readiness with occupancy or operational status. |
| B6: shared validation | Ad hoc rules in two editors | Reuse a small room validation/normalization contract once scope includes both forms. Immediate renderer metadata should agree with existing room save rules; no generic schema library required. |

### B3. Calendar geometry

Relevant files: `src/lib/calendar.ts`, `getTimelineRatio` (~179), `getStayPosition` (~197), `getYearStayPosition` (~242); `DayCalendar.tsx` (~272), `WeekCalendar.tsx` (~242), `MonthCalendar.tsx` (~245), `YearCalendar.tsx` (~238); `AvailabilityCalendar.tsx`; `src/index.css:4`; Dashboard callbacks.

Day/week/month use elapsed timestamp ratios after visible-range clipping. Year uses twelve equally sized month columns and each month's actual duration to position within its column. Therefore the year axis is not one uniform milliseconds-per-pixel scale across unequal months. Preserve this alignment; do not replace it with a whole-year duration percentage. Existing time helpers handle Asia/Manila; no hour/day rounding should be introduced.

| View | Scale / sizing | Stay rendering and interactions | Evidence status |
|---|---|---|---|
| Day | 24 hourly columns, 64px each | Absolute button, `min-w-0`, `overflow-hidden`, `border px-3`, truncated label, left/right 4px margins, detail click | Six-hour width passed at tested viewport; narrower intervals untested |
| Week | Seven day columns, minimum 110px, fluid | Same geometry-affecting styles; detail click | Six-hour width passed; other intervals/viewports untested |
| Month | Actual number of days, 88px each | Same styles; horizontal scrolling when necessary | Six-hour width failed |
| Year | Twelve equal month columns, minimum 90px, fluid | Same styles; native title contains guest/status; detail click | Six-hour width failed |

Toolbar changes view and navigates previous/next/today; no continuous user zoom is implemented. Changing view changes time density. Labels are truncated inside the button. Year has a native title, but it does not independently establish complete keyboard/touch disclosure of room and timestamps. Existing click handlers open reservation detail; calendar buttons do not directly change billing.

#### Preserved measurements

Scenario `GAP-CALENDAR-GEOMETRY`: guest `PW Geometry Guest`, room 101, start `2026-11-10T14:07`, end `20:07`, viewport 1600 × 1050.

| View | Timeline width, CSS px | Inline width % | Intended bar, CSS px | Actual bar, CSS px |
|---|---:|---:|---:|---:|
| Day | 1536 | 25 | 384 | 384 |
| Week | 1196 | 3.57143 | 42.7142857 | 42.703125 |
| Month | 2640 | 0.833333 | 22 | 26 |
| Year | 1196 | 0.0694444 | 0.8305556 | 26 |

Inline percentages preserve the requested precision within the test's serialization tolerance. The measured width failure is therefore a rendering defect. Global border-box sizing and `min-w-0` do not permit a content box to become negative beneath its padding/borders. Remove those dimensions from the time-geometry element rather than adding a smaller minimum width. Source: [MDN box-sizing](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/box-sizing).

The 4px `marginLeft` is an additional source-established start displacement: the visual start can differ from the percentage coordinate. Existing browser evidence measured width and inline left percentage, **not the actual bounding-rectangle start**. A new edge assertion is required. `marginRight` does not subtract 4px from assigned occupancy width.

This is not proven to be caused by timestamp rounding, label text width, flex/grid shrinkage, or availability arithmetic. Grid/container sizing determines the scale but does not explain the shared 26px floor. Long-label and scrolling boundary effects remain test targets. Draft overlays use separate rendering paths and need regression inspection rather than assumed equivalence.

#### Proposed invariants and presentation choices

Use scheduled calendar occupancy endpoints, clipped to the visible range, for the representation. Preserve current checked-in/overdue occupancy semantics; changing geometry must not redefine reservation lifecycle or physical occupancy.

1. Both visual edges map to computed timestamps, with browser pixel tolerance rather than hour/day rounding.
2. Label content, decoration and focus indication do not increase the represented interval.
3. Hit targets may be separate only under an approved interaction policy; they must not masquerade as occupied duration.
4. Subpixel reservations remain discoverable through keyboard/detail access and the approved visual cue.
5. Touching intervals must not appear to overlap because of margins, borders, or inflated widths.
6. All views share these semantics while retaining their different axis mappings.

| Presentation | Benefits | Risks / recommendation |
|---|---|---|
| Separate label overlay | Can retain readable text without changing bar width | Labels can overlap other stays and imply occupancy. Keep clipped/conditionally hidden initially; broader collision layout is optional. |
| Tooltip / focus disclosure | Full guest, room, status and exact times without geometric inflation | Hover-only excludes keyboard/touch. Use focus/tap-accessible disclosure and existing detail action; native title alone is insufficient. |
| Transparent independent hit target | Easier mouse/touch access for narrow bars | Can intercept empty-cell booking actions or select the wrong adjacent stay. Requires explicit overlap/disambiguation rules and tests. |
| Compact short-stay marker | Makes subpixel presence conspicuous | Must be visibly distinct from a duration bar and anchored to its timestamp; otherwise reintroduces misleading occupancy. Threshold/design needs approval. |
| Scale-dependent labels | Small scoped improvement; no new zoom system | Hide visible labels when they cannot fit; retain accessible name/details. Threshold and label content are defaults to review. |

| UX question | Current behavior | Recommended decision |
|---|---|---|
| C1: visible below one pixel? | Padding makes it visible by exaggerating width | Yes, retain discoverability without enlarging the duration representation. Exact cue requires approval. |
| C2: representation? | Ordinary 26px-minimum-looking bar | Accurate hairline geometry plus an explicitly distinct point cue when needed; use detail disclosure for complete times. Approve the marker design before adding it. |
| C3: extended click area? | Current painted button is the hit target | Do not silently enlarge targets. Recommend a separate target only after agreeing on collision and empty-cell behavior. |
| C4: overlapping targets? | No separate overlap arbitration | A deterministic nearest-time choice or explicit chooser is preferable to whichever element has higher z-index. Select policy before implementation. |
| C5: labels disappear? | Text truncates in all views | Hide visible text when it cannot fit; never remove the accessible reservation name or detail access. Threshold can be measured from available width. |
| C6: identical geometry rules? | Similar CSS, different axis helpers | Same edge/label invariants across views; preserve existing year month mapping. Technical decision; no new zoom design needed. |
| C7: fractional boundaries? | Ratios retain precision; boxes have padding/margin errors | Keep fractional CSS coordinates. Accept ≤1 CSS px rendering error per edge; test adjacent endpoints and no artificial floor. Do not round persisted timestamps. |

### B4. Cross-cutting impact and boundaries

| Area | Required preservation / implication |
|---|---|
| Reservation creation/editing | Keep duplicate-submit guard, saved timestamp precision, actual timestamps, captured prices, guest/room assignments and no-op saves. Adjustment uniqueness checks cannot discard valid rows. |
| Billing/discounts | Preserve `docs/room-pricing.md`, `docs/discounts.md`, existing minor-unit rounding, sequential discounts/caps, zero included breakfast and zero-total clamp. No rate, tax, commission, collection or discount calculation changes. |
| Audit | Preserve raw old records. Detect duplicate identities rather than pretending a lossy Map diff is complete. Authenticated durable audit is future work. |
| Room lifecycle | Operational status, enabled/archive state, housekeeping readiness and physical occupancy remain distinct. Preserve occupancy locks and assigned identifiers. |
| Sample data | No fixture rewriting needed for the immediate fixes. Duplicate legacy detection must not become silent fixture or history migration. |
| Architecture | A focused adjustment helper and small room validation metadata fit `src/lib`; a global service/state/permission framework does not fit this scope. |
| Persistence / accounting | Keep operational adjustments separate from ledger posting. Future schema can use stable record IDs, foreign keys, unique constraints, transactional saves, concurrency versions and external accounting references. No Supabase, PostgreSQL or Odoo dependency is required now. |

Unresolved technical evidence includes ordinary collision frequency, actual duplicate legacy datasets, Firefox/WebKit behavior, unsupported/insecure deployment origins, runtime archive preservation, assigned-room renames, visual-start offsets, subpixel hit behavior, and additional viewports. None should be reported as an already executed regression.

## C. Ambiguity Register

“Technical” means source/evidence supports a decision without inventing business policy. **Every implementation still requires the user's explicit authorization.** “Approval required” below identifies additional policy or scope decisions.

| ID | Ambiguity | Current behavior | Recommended decision | Impact if unresolved | Approval required |
|---|---|---|---|---|---|
| T1 | Technical: adjustment identity | Timestamp, unchecked duplicates | UUID plus local invariant and fail-safe exact-one removal | Unintended loss and React/audit ambiguity | Implementation authorization only |
| A1 | Business: official record cutoff | Session Save only | Explicit posting event, separate from operational Save | Cannot design reliable persistent corrections | Yes, before financial lifecycle work |
| A2 | Business: applied/unpaid edits | Saved removal allowed | Editable while unposted, audited; unpaid is not a posting criterion | Historical bills may change silently under a future backend | Yes |
| A3 | Business: finalized immutability | No finalization state | Posted financial content immutable | Financial history can be overwritten | Yes |
| A4 | Business: reversal corrections | No adjustment reversal | Linked reversal/replacement, preserve original | Reconciliation/history becomes ambiguous | Yes |
| A5 | Policy: discarded draft audit | Not recorded as saved events | Retain current behavior; audit saved changes | Audit noise or missing desired edit telemetry | Advisable; not needed for identity fix |
| A6 | Architecture: persistent ID authority | Client IDs | Backend validates accepted IDs; database uniqueness | Cross-device duplicates / request confusion | Future architecture approval |
| A7 | Business/data: legacy duplicates | No repair; unknown dataset | Detect/block; reviewed mapping/reconciliation | Repair can delete amounts or break references | Yes, before any migration/repair |
| B1 | Business: display name mandatory? | Editors disagree | Keep existing behavior in immediate fix; later optional type-label fallback | Entry-point inconsistency | Yes, for harmonization |
| B2 | Technical/future: empty representation | Text empty, capacity undefined | Preserve now; explicit nullable numeric clear in future API | Clear versus preserve semantics become inconsistent | Future schema approval |
| B3 | Technical: intentional clearing | Intended by payload, blocked by HTML | Empty optional fields clear; missing patch fields preserve | Stale values cannot be removed | Implementation authorization only |
| B4 | Business: status/type conditional fields | No documented extra requirements | No invented mandatory descriptions/notes | Unexpected edit blocks or insufficient future documentation | Yes, if introducing new requirements |
| B5 | Business: readiness controls | Dedicated actions plus generic direct select | Allow independent editing; agree occupied-room transition limits | Conflicting operational paths | Yes, before policy changes |
| B6 | Technical/scope: shared room validation | Two implementations | Small shared rules, no framework; room-only required metadata now | Drift across editors | Approval for expanding to both editors |
| B7 | Technical/scope: noneditable metadata | Generic archive value may reset | Preserve archived/lock/ID explicitly | Accidental archive changes | Approve preventive addition; source-only risk |
| C1/C2 | UX: subpixel visibility and cue | Enlarged ordinary bar | Accurate geometry plus distinct marker/disclosure | Short stay inaccessible or misleading | Yes, design choice |
| C3/C4 | UX: larger targets and conflicts | Painted bar target | Independent target only with explicit disambiguation | Wrong selection, empty-cell interception | Yes |
| C5 | UX: narrow labels | Truncated text | Hide when it cannot fit; keep accessible name | Unreadable labels | Recommended default approval |
| C6 | Technical: cross-view geometry | Shared styles, different mappings | Same invariants, retain year mapping | Fix works only at one density | Implementation authorization; confirm four-view scope |
| C7 | Technical: fractional pixel handling | Precise ratios | ≤1px edges, no timestamp rounding | False overlaps and brittle tests | Implementation authorization only |
| T2 | Technical/deployment: UUID environment | Chromium evidence only | Declare HTTPS/loopback support; fail explicitly if unavailable | Runtime failure or unsafe fallback | Deployment support decision if broader environments required |

## D. Proposed Implementation Plan

### D1. Adjustment identity

**Immediate:** `ReservationPane.addAdjustment`, removal callback, and a focused new `src/lib/reservationAdjustments.ts` helper for create/identity validation/removal. Keep the existing adjustment shape. Generate bare UUID candidates; validate uniqueness against current state; perform atomic checked append. Require exactly one identity match before deletion. Reject duplicate input IDs at Save without mutating provider state, with an actionable error instead of silent normalization. Add focused pure-function and UI regressions.

**Preventive, separate scope:** Validate loaded adjustment identities, surface ambiguous history rather than relying on a collapsed audit diff, and preserve raw before/after events. A diagnostic rendering identity must not be mistaken for a repaired financial identity. User-reviewed legacy repair is separate; do not automatically rekey or deduplicate records.

**Unchanged:** Positive/negative amounts, nonzero/finite checks, reason requirement, minor-unit totals, discount order, collection records, save-time audit behavior, current saved-removal semantics, fixture IDs and reservation IDs. No posting lifecycle or permission model.

**Regression risks/tests:** Stale-state rapid append, repeated mocked UUID results, unsupported secure context, duplicate legacy removal, save validation/no-op behavior, React keys, audit diff, details/print totals and preserved raw history. Use tests A-T1 through A-T4 below.

**Future:** Durable ID constraints, transaction and idempotency boundaries, authenticated audit, concurrency control, posting/reversal model, and external accounting reference mapping. None is an immediate dependency.

### D2. Room optional validation

**Immediate:** In `ConfigurationPage`, derive room input `required` attributes from the same small required/optional contract used by `save`. Only exempt existing optional room fields; retain native validation elsewhere. Normalize blank optional capacity as absent and text as empty; keep supplied capacity positive-integer validation. Preserve explicit clearing and current per-editor display-name behavior.

**Preventive, separately authorized:** Preserve `archived`, `occupancyLockReservationId`, and stable ID from the existing room during replacement. Extract focused room requiredness/normalization into `src/lib` if both editors are included; preserve existing historical references and avoid inventing new status-dependent requirements. Treat room renaming as a separate integrity concern if regression exposes broken assignments.

**Unchanged:** Required room number and uniqueness, type/status/readiness requirements, optional-field storage, amenity inheritance/overrides, existing reservations/captured prices, occupied-room behavior, and unrelated configuration forms.

**Regression risks/tests:** Accidental global removal of native validation, accepting zero/fractional capacity, fallback preventing clears, full replacement dropping metadata, type-change amenities, display-name discrepancy, and readiness propagation. Use B-T1 through B-T4.

**Future:** Shared frontend/backend contract and deliberate PATCH serialization. Database validation should match approved room policies; no schema library or persistence adapter now.

### D3. Calendar occupancy representation

**Immediate:** Correct the saved-stay geometry element in month/year and, with confirmed scope, the identical styles in day/week. Keep `getStayPosition`/`getYearStayPosition` calculations. Remove horizontal padding, layout border thickness and external margin from the interval element; draw decoration using an inset/positioned child that cannot impose a layout floor. Position clipped text independently inside it. Preserve button semantics, accessible reservation identity and existing detail action. Avoid scaling borders or labels into fake occupancy.

**Preventive:** Actual bounding-rectangle left/right assertions, shared rendering style if it remains a small change, draft-overlay regression, multiple viewport/scroll checks, keyboard focus disclosure and no adjacency overlap. Do not require a new calendar library or continuous zoom control.

**UX additions needing decision:** Subpixel point cue, larger transparent target, target overlap chooser, and label-fit thresholds. A mathematically correct hairline is insufficient to claim practical touch usability; this portion cannot be declared complete before the selected policy is implemented and tested.

**Unchanged:** Scheduled/actual timestamps, time precision, Asia/Manila handling, clipping, year month-column mapping, occupancy status/color semantics, availability conflicts, billing, grid columns, scroll and navigation behavior.

**Regression risks/tests:** Decorative CSS reintroducing width floors, labels altering flex layout, start offset, focus ring resembling extra occupancy, target interception of empty slots, clipped boundaries, and incorrect year alignment in February/leap years. Use C-T1 through C-T4.

**Future:** Additional calendar densities and accessible interaction policy can reuse the established separation of time geometry, decoration and interaction; no backend dependency.

## E. Acceptance Criteria

### E1. Adjustment identity

- Positive: under the fixed clock, independent +100/+200 entries have distinct IDs, display separately and total 1400 on the 1100 fixture. Removing A leaves B, total 1300, and Save/detail/print agree.
- Negative: blank reason, zero and nonfinite amounts remain rejected. Unsupported UUID generation and exhausted duplicate-candidate retries leave amounts and provider state unchanged with a clear error.
- Boundary: rapid consecutive additions check the latest list; forced repeated candidates cannot create duplicates. Removing a duplicate legacy ID is refused without deleting either row; unknown ID removes none. Existing non-UUID IDs remain supported.
- Audit: new saved adjustments remain independently interpretable, raw old history remains unchanged, and no duplicate React-key warning occurs on valid generated rows. No new lifecycle is implied.

### E2. Room validation

- Positive: room 102 with blank capacity and valid mandatory fields saves a readiness change. Blank description and notes independently and together also save.
- Negative: blank/whitespace required fields, duplicate room number, and supplied capacity 0, -1, 1.5 or nonnumeric values remain rejected without changing the room.
- Boundary: clear capacity/text that previously had values; reopen and verify absent override/empty text. Capacity 1 remains accepted; whitespace text normalizes to empty. Clearing effective amenities remains intentional.
- Preservation: ordinary optional-field saves retain stable ID, assigned room number, occupancy lock, captured reservation data and unrelated room fields. If the preventive archive correction is authorized, archived state remains unchanged too.
- Policy gates: display-name harmonization and new readiness restrictions are not acceptance conditions until separately approved.

### E3. Calendar

- Positive: original six-hour month bar is approximately 22px and year bar approximately 0.83056px at the original measured container widths, with ≤1 CSS px error. Day/week remain correct.
- Negative: long guest labels, borders and focus decorations do not create a 26px minimum or shift interval endpoints. Visible short-stay cues must not be ordinary enlarged duration bars.
- Boundary: computed visual start/end differ from expected clipped coordinates by ≤1 CSS px, including minute offsets, midnight/month/year/leap boundaries and horizontal scroll. Adjacent half-open intervals do not gain artificial overlap from padding/margins.
- Precision: percentages retain at least the existing test tolerance (0.001 percentage point); source timestamps remain byte-for-byte unchanged by rendering.
- Accessibility: every stay can be reached by keyboard and opens the intended details; exact times/room remain discoverable even when visible text is hidden. The approved subpixel/touch policy passes its explicit target-conflict tests.
- Availability and pricing: geometry-only changes do not alter conflict decisions, amounts, readiness or provider records.

## F. Testing and Evidence Plan

All following scenarios are **proposed after authorization**, not executed this turn. Use fresh demo sessions, Asia/Manila and the existing deterministic clock. Avoid reload between actions that depend on in-memory saves. Use the existing on-demand Playwright harness; no CI hook or dependency change is proposed. Preserve every original session directory and link old/new evidence explicitly. Generate new timestamped report directories; do not overwrite old screenshots or alter historical failures to PASS.

### F1. Baseline evidence to preserve

| Scenario | Original latest failed session | Evidence to compare |
|---|---|---|
| `GAP-DUPLICATE-SUBMIT` | `2026-10-12T01-01-04-925Z-4912` | Steps 13–15 show both adjustments, 1400 preview and removal failure; console duplicate key; final screenshot and trace |
| `CONFIG-OPTIONAL-CAPACITY` | `2026-10-12T01-04-33-985Z-5888` | Blank-capacity form, attempted Save, remaining edit state, `capacityValidation.valueMissing`, final screenshot and trace |
| `GAP-CALENDAR-GEOMETRY` | `2026-10-12T01-04-33-985Z-5888` | Screenshots of all four views, serialized geometry array, final failure screenshot and trace |

The [coverage report](../../booking-tests/reports/coverage/index.html) links the numbered genuine screenshots, videos and trace artifacts for each case. The [raw results](../../booking-tests/reports/coverage/results.json) retain exact artifact paths and geometry measurements. The original failing data is the comparison baseline, not a template for manufacturing screenshots.

### F2. Adjustment scenarios

| ID | Preconditions | Actions | Expected / functional assertions | Screenshots | Failure conditions |
|---|---|---|---|---|---|
| A-T1, existing `GAP-DUPLICATE-SUBMIT` extended | Fresh seeded session; clock fixed Nov 10 15:00; room 101 six-hour base 1100, direct source, John Doe | Rapid double-click Create; edit saved record; add reason A +100 and B +200; remove A; Save; reopen details/print | Exactly one reservation; two distinct adjustment IDs; preview 1400 then 1300; B alone persisted; all displays agree; no duplicate-key error | Saved reservation count, both additions, post-removal preview, detail, print and audit | Extra reservation, equal IDs, loss of B, total other than 1300, differing displays or unintended financial events |
| A-T2, helper boundary | Pure helper tests with injectable/mock UUID candidates; existing string-ID fixtures | Return same candidate twice then distinct; exhaust candidate retries; remove missing ID and duplicate ID | Accepted list always unique; bounded failure leaves original list unchanged; duplicate removal refused | Browser error state for exposed failure; unit assertions require no fabricated screenshot | Infinite retry, partial write, silent rekey or bulk delete |
| A-T3, saved audit lifecycle | Saved operational adjustment; no accounting posting state | Add/remove and Save; reopen; make an unsaved addition and discard pane | Saved change audit retains old raw values and explains intended adjustment; discarded draft changes not saved; no invented reversal/post event | Before/after saved audit and reopened discarded-draft state | Lost raw audit, duplicate collapse for newly valid records, changed save semantics |
| A-T4, validation and monetary boundaries | Fixed valid reservation; current pricing/discount fixtures | Attempt zero/blank reason; add documented negative adjustment; apply an existing discount; remove valid adjustment | Existing invalid input rejection; totals match unchanged money/discount formula including zero clamp; other IDs/history unchanged | Validation messages and before/after billing summary | Weakened amount/reason rules, rounding/discount changes, collection or timestamp mutation |

A legacy duplicate fixture for pure tests is test input, not modification of operational or seed data. Any UI reproduction using injected corruption must be explicitly identified as synthetic, and must not be counted as genuine UI-generated baseline evidence.

### F3. Room scenarios

| ID | Preconditions | Actions | Expected / functional assertions | Screenshots | Failure conditions |
|---|---|---|---|---|---|
| B-T1, existing `CONFIG-OPTIONAL-CAPACITY` | Fresh room 102; blank capacity; valid nonblank description/notes and required fields | Change readiness to dirty, Save, navigate/reopen without reload | Native capacity required false; no valueMissing; edit finishes; override remains absent; dirty visible to other room/readiness consumers | Before Save, completed edit, reopened form and room readiness | Submit blocked, capacity coerced to 0, readiness not propagated |
| B-T2, intentional clears | Room edited through UI to have capacity 2, description/notes text | Clear capacity, then description, then notes; test each and all together; clear amenities | Each explicit clear persists; mandatory fields unchanged; amenity overrides yield intended effective empty list | Populated form, blank submission, reopened fields and amenities | Old values retained by fallback, blank rejected, inherited amenities silently restored |
| B-T3, invalid/boundary values | Valid room mandatory fields | Blank required text/whitespace; duplicate number; capacity 0/-1/1.5; capacity 1; exercise both editors where applicable | Reject invalid forms without state mutation; accept 1; retain current display-name rules pending decision | Each validation category and successful capacity-1 reopen | Required fields weakened, invalid numeric/reference accepted under an approved shared contract, unintended display policy change |
| B-T4, lifecycle and metadata preservation | UI-created saved assignment; captured bill/timestamps; existing `CHECKIN-DIRTY` setup; archive fixture only if preventive scope approved | Edit optional notes without renaming; recheck reservation; perform existing dirty-room check-in scenario; inspect archived room after harmless edit if authorized | Stable ID/number/lock and historical bill/time unchanged; dirty blocks atomic multi-room check-in as existing scenario specifies; archived stays archived if fix included | Room edit, assignment/detail before/after, blocked dirty check-in; archived status if covered | Broken assignment, dropped lock/history, partial check-in, unapproved archive transition |

Do not make assigned-room renaming part of a normal optional-field test. A separate rename integrity investigation can be specified if requested.

### F4. Calendar scenarios

| ID | Preconditions | Actions | Expected / functional assertions | Screenshots | Failure conditions |
|---|---|---|---|---|---|
| C-T1, existing `GAP-CALENDAR-GEOMETRY` extended | Original 1600×1050 fixture, unique guest, room 101, Nov 10 14:07–20:07 | Open day/week/month/year; measure container and both visible edges, not just inline styles | Width and start/end within 1 CSS px of computed mapping; original month/year floor gone; source times/pricing unchanged | Each view, each targeted bar and DOM geometry JSON | 26px floor, 4px start shift, geometry outside tolerance, modified timestamps |
| C-T2, boundaries | Valid UI-created adjacent intervals with checkout == next check-in; existing `AVAIL-TOUCH`/time cases | View touching stays; cover midnight, month/year transitions, February/leap boundaries and clipped range edges | No artificial overlap; clipping matches range; year aligns within actual month durations; availability remains correct | Adjacent bars and each boundary at relevant view | Margin/padding-induced overlap, hour/day rounding, incorrect month mapping, rejected legitimate adjacency |
| C-T3, label/scroll/viewport | Same six-hour stay plus long guest name; original and narrower desktop viewport (e.g. 1024×768) | Change view, scroll month timeline, focus stay, open detail | Text cannot enlarge interval; measurements use scrolled timeline coordinates; keyboard opens correct record; accessible name supplies identity/details | Long-label, scrolled, focused and detail-open states | Label expands bar, header/scroll offsets mismeasured, focus lost or wrong detail |
| C-T4, subpixel interaction policy | Year view with <1px interval; close adjacent intervals; approved marker/target policy | Discover via keyboard, mouse and touch emulation; select near competing targets; activate empty availability cell beside stay | Approved cue is distinct from duration; no wrong selection; conflict handling deterministic; empty-cell actions remain available | Tiny-stay cue, focus/detail, competing-target choice and nearby empty-slot action | Invisible/unreachable stay under chosen policy, enlarged occupancy bar, z-index ambiguity or swallowed empty-cell action |

C-T4 cannot be finalized until UX decisions C1–C4 are approved. Browser tests should distinguish geometry nodes, labels, cues and hit targets when measuring widths; measuring a larger transparent target as occupied duration would test the wrong element.

### F5. Verification and reporting

After authorized changes, run focused domain tests, the relevant existing browser cases above, and the repository-required `npm run lint`, `npm test`, `npm run build` from `HotelSystem`. Broaden browser checks only for affected interactions: billing/discounts, readiness/check-in, time/adjacency, details/print/audit. Keep screenshots and assertions together; screenshots alone cannot prove ID uniqueness, exact monetary values or subpixel edges.

Record commit/source state, browser/version, viewport, clock, scenario inputs, DOM metrics, console errors and original/new artifact paths. Unsupported business-policy cases stay BLOCKED rather than being assigned invented PASS expectations. Historical harness/setup failures remain preserved and distinguished from application defects.

Previously recorded lint/build and 161 Vitest passes are historical evidence in FINDINGS; they were not rerun for this documentation-only investigation. Passing the proposed fixes would address these three defects, not certify production readiness or resolve the six existing blocked coverage areas.

## G. Final Decision Summary

### Ready for implementation — technical readiness only

Evidence supports the following narrow changes, **after explicit authorization**:

- Replace adjustment timestamp identity with checked UUID creation; exact-one removal and duplicate-ID Save rejection; retain pricing/lifecycle semantics.
- Align optional room `required` attributes with existing room save rules; preserve legitimate clearing and supplied-capacity validation.
- Remove padding/border width floors and the external start offset from time-geometry elements; retain timestamp helpers, clipping and year mapping; verify actual edges in all four views.

These technical corrections do not require a database, Supabase integration or a new accounting layer. This category is not permission to edit application code.

### Recommended defaults — approval advisable

- Keep existing saved operational add/remove and save-time audit semantics for the identity fix; do not add posted states implicitly.
- Keep text blanks as `""` and unset capacity as `undefined` in current memory; specify explicit null/missing semantics later at the API boundary.
- Include explicit preservation of archived metadata as a scoped preventive room change; do not silently widen the task to room renaming.
- Hide labels that cannot fit while preserving accessible names and exact-time detail access. Apply the shared geometry correction across all four views rather than changing only the observed two.
- Support UUID generation in declared secure-context browsers and fail clearly if unavailable; do not fall back to timestamp IDs.

### Requires user decision — priority order

1. **Financial record cutoff and correction policy (A1–A4):** What event makes an adjustment official/posted? Are unposted saved adjustments editable? Approve or reject immutable posted entries with linked reversal/replacement corrections. These decisions gate future financial lifecycle implementation, not the narrow ID fix.
2. **Existing duplicate records (A7):** If any are found, authorize a reviewed identity mapping and reconciliation policy. Until then, block ambiguous removal; never silently delete or merge amounts.
3. **Room requirements and readiness authority (B1, B4, B5):** Should display name be an optional override with room-type fallback in both editors? Are any fields mandatory by type/status? May the generic editor change readiness directly, especially for occupied rooms?
4. **Very short stay UX (C1–C4):** Approve an accurate hairline plus distinct point cue, or choose another representation. Decide whether targets extend beyond the cue/bar and how competing targets and adjacent empty-slot actions are resolved.
5. **Preventive scope and defaults (B6/B7, C5/C6, T2):** Confirm inclusion of archive preservation, shared room validation, all-view geometry styles, narrow-label hiding, and supported secure deployment/browser contexts. Keep unrelated ID mechanisms and calendar redesign out of scope.
6. **Draft audit and future persistence authority (A5/A6/B2):** Confirm no financial audit for discarded unsaved drafts; later agree backend ID authority, authenticated audit and API clear-versus-omission semantics before persistence/accounting implementation.

**Investigation complete. Stop here; application fixes, lifecycle changes, data repairs and architecture additions await explicit user authorization.**

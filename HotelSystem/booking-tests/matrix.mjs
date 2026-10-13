// This inventory is the test contract. Expected amounts are independent, explicit oracles.
export const rules = [
  ['R01','Creation needs a primary guest, an assigned room, an active source and valid stay.','src/components/reservations/ReservationPane.tsx:canCreate'],
  ['R02','Hourly charges are package totals; nightly charges are base rate times configured nights.','docs/room-pricing.md'],
  ['R03','Hotel timestamps use Asia/Manila; hourly timestamps preserve minute precision.','AGENTS.md; src/lib/hotelTime.ts'],
  ['R04','Operational blocks and overlapping confirmed stays prevent assignment; touching endpoints do not overlap.','src/utils/availability.ts; src/components/reservations/ReservationPane.tsx:addRoom'],
  ['R05','Checked-in stays and cancelled occupancy locks block assignment independently of scheduled end.','src/utils/availability.ts; src/lib/reservationLifecycle.ts'],
  ['R06','Check-in requires a confirmed/reserved record, all rooms clean/active/operational, and now inside each scheduled window.','src/lib/reservationLifecycle.ts:validateReservationCheckIn'],
  ['R07','Checkout changes all assigned rooms to Dirty, releases occupancy and saves actual timestamps/audit.','src/lib/reservationLifecycle.ts:checkOutReservation'],
  ['R08','Cancellation releases a future booking; occupied cancellation retains locks until departure unless vacated.','src/lib/reservationLifecycle.ts'],
  ['R09','No-show requires confirmed/reserved and now at/after scheduled arrival; it releases availability.','src/lib/reservationLifecycle.ts:markReservationNoShow'],
  ['R10','Unrelated edits preserve captured prices, dates, actual timestamps, labels and audit. Explicit duration edits resolve current rates.','AGENTS.md; docs/room-pricing.md; docs/discounts.md'],
  ['R11','Room-type defaults are replaced on assignment changes; manual inclusions survive; shared positive overrides survive. Zero inherited defaults are restored on switching type.','src/lib/roomTypeInclusions.ts; src/components/reservations/ReservationInclusions.test.tsx'],
  ['R12','Reservation inclusions clamp to nonnegative integers. Room-type defaults require positive integer quantities and unique products.','src/lib/roomTypeInclusions.ts'],
  ['R13','Purchases use active sellable ordinary products; extras use extra products; positive whole quantities, captured unit price, billed once.','docs/inventory-breakfast-purchases.md'],
  ['R14','Nightly breakfast allows one zero-priced meal/beverage pair per adult/child per service date; hourly has none. Stay/guest edits trim entitlement.','docs/inventory-breakfast-purchases.md'],
  ['R15','Final prices apply first, room/item reductions next, reservation reductions last; percentages use remaining eligible balance; fixed discounts cap at that balance.','docs/discounts.md'],
  ['R16','Presets match stable room/product/rate/currency; incompatible selections warn and block save; same nightly rate survives night-count changes.','docs/discounts.md'],
  ['R17','Manual room discount includes room charges; preset room discount covers accommodation only; item discount targets one line.','docs/discounts.md'],
  ['R18','Manual discounts must be >0; percentages <=100. Reservation presets apply explicitly and cannot be duplicated.','src/components/reservations/ReservationPane.tsx:addDiscount; docs/discounts.md'],
  ['R19','Signed nonzero adjustments require a reason; total charges cannot be negative; money rounds by currency precision.','docs/discounts.md; src/lib/money.ts'],
  ['R20','Historical disabled options remain readable and retained on unchanged records, unavailable for new selection.','AGENTS.md; docs/discounts.md; docs/inventory-breakfast-purchases.md'],
  ['R21','Source selection captures an agreement by booking-entry hotel date and never marks collection received. OTA references may be required.','docs/booking-channels.md'],
  ['R22','One permitted external accommodation total replaces discounted accommodation once; extras retain discounts; reason required when configured.','docs/booking-channels.md'],
  ['R23','Financial decimal inputs reject negative, overflow, excess precision and nonnumeric values; new values use exact minor units.','src/lib/channelFinance.ts:parseMinor; docs/booking-channels.md'],
  ['R24','Verified collection is append-only with evidence; refund/reversal cannot exceed collection; signed guest balance permits credit.','docs/booking-channels.md; src/lib/channelActions.ts'],
  ['R25','Commission estimates, documented liability, expected settlement and actual payout are separate and never reduce guest charges.','docs/booking-channels.md'],
  ['R26','Settlement allocations retain channel/currency attribution and sum exactly; reconciliation requires an explanation and audit.','docs/booking-channels.md'],
  ['R27','Source changes require review, preserve previous terms/collection/confirmations, and retain historical collection in guest balance.','docs/booking-channels.md'],
  ['R28','Calendar distinguishes reserved/occupied/overdue/vacant; checked-in is overdue strictly after checkout; inactive visibility is optional.','src/lib/calendar.ts; src/pages/DashboardPage.tsx'],
  ['R29','Details and both print layouts consume saved billing; guest print excludes accounting controls.','docs/discounts.md; docs/booking-channels.md; src/pages/ReservationPrintPage.tsx'],
  ['R30','All data is session memory and reload resets changes; no backend/authentication/bank integration/tax computation exists.','AGENTS.md; src/app/ReservationDemoContext.tsx'],
  ['R31','Guest creation requires a trimmed name; phone/email are optional.','src/components/reservations/ReservationPane.tsx:createGuest'],
  ['R32','Lifecycle actions and edits append readable, timestamped audit history.','src/lib/reservationAudit.ts; src/lib/reservationLifecycle.ts'],
  ['R33','Capabilities gate accounting domain actions; published agreements cannot rewrite financial rules; active ranges cannot overlap.','docs/booking-channels.md; src/lib/channelActions.ts; src/lib/channelFinance.ts'],
  ['R34','Physical room capacity override, description and operational notes are optional; blanks must permit other room configuration changes.','src/features/configuration/types.ts:RoomConfiguration; src/pages/ConfigurationPage.tsx:save optionalKeys and persist rooms'],
].map(([id, description, reference]) => ({id, description, reference}));

export const scenarios = [];
function add(id, module, description, ruleIds, kind, inputs = {}, expected = '', priority = 'P1', category = 'regression', executable = true, gap = '') {
  scenarios.push({id, module, description, rules:ruleIds.split(','), kind, inputs, expected, priority, category, executable, implemented:Boolean(kind), gap,
    preconditions: inputs.record ? `Fresh demo session; saved fixture ${inputs.record}; fixed hotel clock ${inputs.now ?? '2026-11-10T15:00:00+08:00'}.` : 'Fresh demo session; fixed hotel clock 2026-11-10 15:00 Asia/Manila; seeded configuration; existing John Doe unless specified.',
    references:ruleIds.split(',').map(id => rules.find(r => r.id === id)?.reference).join('; ')});
}

// All type/duration pairs are retained: the 18 distinct monetary rates are cheap and high risk.
for (const [room,type,rates] of [['101','Standard',[1100,1300,1650,2200,4400,6600]],['107','Deluxe',[1500,1800,2200,2900,5800,8700]],['201','Suite',[2200,2600,3200,4200,8400,12600]]]) {
  ['6-hours','8-hours','12-hours','1-night','2-nights','3-nights'].forEach((duration,i) => add(`BOOK-${type.slice(0,3).toUpperCase()}-${i+1}`,'creation',`${type}: save ${duration}`,'R01,R02,R03,R32','create',{room,duration,total:rates[i]},`Saved confirmed booking; accommodation PHP ${rates[i]}; calculated checkout and audit visible.`, 'P0','happy'));
}
for (const [id,missing] of [['GUEST','guest'],['ROOM','room'],['SOURCE','source'],['DATE','date']]) add(`VALID-${id}`,'validation',`Cannot save without ${missing}`,'R01','required',{missing},'Create button disabled and no saved booking.','P0','negative');
for (const [id,quantity,expectedQuantity] of [['ZERO',0,0],['NEGATIVE',-1,0],['FRACTION',1.5,1],['LARGE',999,999]]) add(`INCL-${id}`,'inclusions',`Inclusion quantity ${quantity}`,'R12','inclusionQuantity',{quantity,expectedQuantity},`UI normalizes to ${expectedQuantity}; saved inclusion absent at zero; bill unchanged.`, 'P1','boundary');
add('INCL-SWITCH','inclusions','Manual additions and positive shared overrides survive type changes','R11,R02','inclusionSwitch',{},'Water 3 and manual Towels 2 survive Standard → Deluxe → Standard; Deluxe-only defaults disappear.','P0','interaction');
add('INCL-RESTORE','inclusions','Zero inherited default restored when switching room type','R11','inclusionRestore',{},'Standard water 0 becomes Deluxe default 2 on type switch.','P1','regression');
add('INCL-SAME','inclusions','Same room type reassignment preserves manual quantities','R11','inclusionSame',{},'Water 3 remains 3 on assignment 101 → 102; accommodation unchanged.','P0','regression');
for (const [id,start,duration,end] of [['MIDNIGHT','2026-11-10T22:30','6-hours','Nov 11, 2026, 4:30 AM'],['MONTH','2026-11-30T23:45','8-hours','Dec 1, 2026, 7:45 AM'],['YEAR','2026-12-31T23:30','6-hours','Jan 1, 2027, 5:30 AM'],['LEAP','2028-02-28T14:00','2-nights','Mar 1, 2028, 12:00 PM'],['MINUTE','2026-11-10T14:07','6-hours','Nov 10, 2026, 8:07 PM']]) add(`TIME-${id}`,'time',`Stay crosses ${id.toLowerCase()} boundary`,'R02,R03','time',{start,duration,end,total:duration==='8-hours'?1300:duration==='2-nights'?4400:1100},`Checkout ${end}; saved/print timestamps retain local date and minute precision.`,'P0','boundary');
for (const [id,room] of [['HOUSEKEEPING','103'],['MAINTENANCE','106'],['OCCUPIED','202']]) add(`AVAIL-${id}`,'availability',`${id.toLowerCase()} room cannot be newly assigned`,'R04,R05','unavailable',{room},'Room option disabled; + Add room cannot assign it.','P0','negative');
add('AVAIL-CONFLICT','availability','Same room overlapping second reservation rejected','R04','conflict',{},'New same-interval room 101 option disabled after first booking saved.','P0','negative');
add('AVAIL-TOUCH','availability','Checkout exactly equals next arrival','R04','touch',{},'Room 101 available when next stay starts exactly at prior scheduled checkout.','P0','boundary');
add('AVAIL-EDIT','availability','Changing existing stay into a conflict is rejected','R04,R10','editConflict',{},'Availability warning; save rejects overlapping stay; original saved stay preserved.','P0','interaction');
add('AVAIL-DUPROOM','availability','Assigned room cannot be added twice','R04','duplicateRoom',{},'Already added option disabled; one accommodation line.','P0','negative');
add('LIFE-CHECKOUT','lifecycle','Multi-room check-in and checkout synchronizes records','R06,R07,R28,R32','lifecycle',{},'All rooms checked in then checked out; actual timestamps, audit, Dirty readiness, calendar and availability agree.','P0','state');
for (const [id,now,allowed] of [['BEFORE','2026-11-10T13:59:59+08:00',false],['AT','2026-11-10T14:00:00+08:00',true],['END','2026-11-10T20:00:00+08:00',false],['AFTER','2026-11-10T20:00:01+08:00',false]]) add(`CHECKIN-${id}`,'lifecycle',`Check-in ${id.toLowerCase()} boundary`,'R06','checkinBoundary',{now,allowed},allowed?'Check-in accepted at arrival inclusive.':'Check-in rejected; confirmed status retained.','P0','boundary');
for (const [id,now,overdue] of [['BEFORE','2026-10-10T13:59:59+08:00',false],['AT','2026-10-10T14:00:00+08:00',false],['AFTER','2026-10-10T14:00:01+08:00',true]]) add(`CAL-END-${id}`,'calendar',`Occupied checkout ${id.toLowerCase()} boundary`,'R28','overdue',{record:'DEMO-6',now,overdue},overdue?'Calendar displays overdue.':'Calendar displays occupied, not overdue.','P0','boundary');
add('LIFE-FUTURE','lifecycle','Future fixture cannot be checked in','R06','future',{record:'DEMO-2',now:'2026-10-08T15:00:00+08:00'},'Rejected outside scheduled stay; no actual check-in.','P0','negative');
add('LIFE-CANCEL-FUTURE','lifecycle','Cancel unoccupied booking releases room','R08,R28,R32','cancelFuture',{},'Cancelled status/audit; no occupancy lock; room available; billing retained.','P0','state');
for (const [id,vacated] of [['LOCK',false],['VACATED',true]]) add(`LIFE-CANCEL-${id}`,'lifecycle',`Cancel checked-in fixture, vacated=${vacated}`,'R05,R07,R08,R32','cancelOccupied',{record:'DEMO-6',now:'2026-10-08T15:00:00+08:00',vacated},vacated?'Room Dirty; no active occupancy lock.':'Room 202 locked even beyond scheduled end; departure releases lock and marks Dirty.','P0','state');
for (const [id,now,allowed] of [['EARLY','2026-10-18T13:59:59+08:00',false],['AT','2026-10-18T14:00:00+08:00',true]]) add(`NOSHOW-${id}`,'lifecycle',`No-show ${id.toLowerCase()} arrival`,'R09,R28','noShow',{record:'DEMO-3',now,allowed},allowed?'No-show saved; inactive calendar visibility; no check-in control.':'No-show rejected before arrival; confirmed retained.','P0','boundary');
add('LIFE-TERMINAL','lifecycle','Completed records expose no lifecycle or edit controls','R07,R08,R09','terminal',{record:'DEMO-6',now:'2026-10-08T15:00:00+08:00'},'After checkout, check-in/out/cancel/edit controls absent; duplicate checkout impossible through UI.','P1','negative');
for (const view of ['day','week','month','year']) add(`CAL-${view.toUpperCase()}`,'calendar',`Calendar ${view} selection opens correct saved details`,'R03,R28','calendarView',{view,now:'2026-10-08T15:00:00+08:00'},'Saved Bob Wilson stay opens Room 202 details in the selected calendar view. Inactive filtering is independently covered by NOSHOW-AT.','P1','happy');
add('EDIT-NOTE','editing','Unrelated edit preserves historic price and schedule','R10,R20,R32','editNote',{record:'DEMO-8'},'Note saved; historical base PHP 7000 retained rather than current PHP 7800; audit readable.','P0','regression');
add('EDIT-ACTUAL','editing','Unchanged save preserves actual check-in and audit','R10,R32','editActual',{record:'DEMO-2',now:'2026-10-14T17:00:00+08:00'},'Actual 5 PM check-in retained after edit/save; checked-in audit remains.','P0','regression');
add('EDIT-DISCARD','editing','Discard draft requires explicit confirmation','R10','discard',{},'Keep editing retains values; Discard changes closes without saving.','P1','negative');
for (const [id,method,value,total] of [['FIXED','fixed',100,1000],['PERCENT','percentage',10,990],['CAP','fixed',99999,0],['FULL','percentage',100,0]]) add(`DISC-${id}`,'discounts',`Manual ${method} discount ${value}`,'R15,R18,R19','manualDiscount',{method,value,total},`Saved guest charges PHP ${total}; no negative eligible balance.`,'P0','boundary');
for (const [id,method,value] of [['ZERO','fixed',0],['NEG','fixed',-1],['OVER','percentage',100.01]]) add(`DISC-INVALID-${id}`,'discounts',`Reject ${method} ${value}`,'R18','invalidDiscount',{method,value},'Validation alert; no applied manual discount; total unchanged.','P0','negative');
add('DISC-SEQUENCE','discounts','Room final price + manual room + reservation percentage','R15,R17','discountSequence',{},'Base 2200 → final 1950 → manual -100 → reservation -10% = PHP 1665.','P0','interaction');
add('DISC-PRESET-DUP','discounts','Reservation preset explicitly applied once','R18','duplicatePreset',{},'Second Apply rejected; one 10% reduction; total PHP 990.','P0','negative');
add('DISC-RATE-INVALID','discounts','Hourly duration invalidates partial preset','R16','invalidPreset',{},'Standard Special 6h → 8h warns and blocks save; removal restores PHP 1300.','P0','interaction');
add('DISC-NIGHTS','discounts','Nightly preset survives changed night count','R02,R16','presetNights',{},'Standard Special 1 → 3 nights yields 1950 × 3 = PHP 5850.','P0','interaction');
add('DISC-ROOM-SCOPE','discounts','Manual room scope includes extras','R17','roomScope',{},'Room 1100 + Laundry 120, manual room 10% gives PHP 1098.','P0','interaction');
add('DISC-ITEM','discounts','Item unit override and quantity multiplication','R13,R15,R17','itemDiscount',{},'Laundry 2 × 120; preset 2 × 90; total 1100+180=1280; removing line removes targeted discount.','P0','interaction');
for (const [id,amount,total] of [['POS',200,1300],['NEG',-200,900],['FLOOR',-99999,0]]) add(`BILL-ADJ-${id}`,'billing',`Signed adjustment ${amount}`,'R19','adjustment',{amount,total},`Saved charges PHP ${total}; reason in detail/print.`,'P0','boundary');
for (const [id,amount,reason] of [['ZERO','0','Evidence'],['REASON','200','']]) add(`BILL-ADJ-INVALID-${id}`,'billing',`Reject adjustment ${id.toLowerCase()}`,'R19','invalidAdjustment',{amount,reason},'Alert requires nonzero amount and reason; bill unchanged.','P1','negative');
for (const [id,qty,total] of [['ONE',1,1220],['MANY',3,1460],['ZERO',0,1220],['FRACTION',1.5,1220]]) add(`PURCHASE-${id}`,'purchases',`Purchased Pancit quantity ${qty}`,'R13','purchase',{qty,total},`Charge quantity ${qty===0?'clamped to one by UI':Math.floor(qty)}; captured PHP 120 unit; single charge only; saved total PHP ${total}.`, 'P0',qty===1?'happy':'boundary');
add('BREAKFAST-HOURLY','breakfast','Hourly package has no complimentary breakfast choices','R14','breakfastHourly',{},'No breakfast dates; purchases remain separate.','P1','negative');
add('BREAKFAST-NIGHTLY','breakfast','Meal and beverage included without selling-price charge','R13,R14','breakfastNightly',{},'One night, two adults and one child: 3 entitlement selectors; included pair contributes PHP 0; saved total PHP 2200.','P0','happy');
add('BREAKFAST-TRIM','breakfast','Reducing guests trims saved breakfast entitlement','R14','breakfastTrim',{},'Guest 3 breakfast discarded when guests reduce to 2; no duplicate charges.','P1','interaction');
add('GUEST-NAME','guests','Empty or whitespace name rejected','R31','guestEmpty',{},'Use guest shows validation and does not select/create guest.','P1','negative');
add('GUEST-OPTIONAL','guests','Name-only guest booking supported','R01,R31','guestOptional',{},'Trimmed guest name saved; phone/email absent; booking searchable.','P1','happy');
add('HISTORY-OPTIONS','history','Retired source, breakfast and charges visible on historic fixture','R20,R29','history',{record:'DEMO-8'},'Agoda inactive, American breakfast, Legacy minibar, saved rates/totals retained.','P0','regression');
for (const layout of ['document','thermal']) add(`PRINT-${layout.toUpperCase()}`,'printing',`Saved ${layout} guest print excludes accounting UI`,'R29','print',{record:'CHANNEL-2',layout},'Guest balance and saved accommodation visible; accounting/settlement controls absent.','P1','regression');
add('SESSION-RESET','history','Reload resets session-only reservation','R30','reload',{},'Created booking disappears after browser reload; no persistence claimed.','P1','boundary');
add('CHANNEL-PENDING','channels','OTA source selection does not imply payment','R21,R25','channelPending',{},'Booking.com agreement v1 captured; collection pending; paid zero; guest charges 1100.','P0','happy');
add('CHANNEL-REFERENCE','channels','Required OTA reference missing blocks save','R21','channelReference',{},'Visible reference error; correcting it permits save.','P0','negative');
add('CHANNEL-OVERRIDE','channels','External accommodation plus discounted extra','R15,R22,R25','channelOverride',{},'Room 1100 hotel-discounted; external room total 800 + Laundry 102 = PHP 902; commission separate.','P0','interaction');
add('CHANNEL-REASON','channels','Override requires documented reason','R22','channelReason',{},'Missing reason rejects save; correcting allows override.','P0','negative');
for (const [id,value] of [['NEG','-1'],['PRECISION','1.001'],['TEXT','oops'],['OVERFLOW','900719925474099.99']]) add(`CHANNEL-INVALID-${id}`,'channels',`Reject external amount ${value}`,'R23','invalidChannelAmount',{value},'Amount alert; save cannot silently retain previous valid override.','P0','negative');
for (const [id,amount,balance] of [['PARTIAL',100,1000],['FULL',1100,0],['CREDIT',1200,-100]]) add(`COLLECT-${id}`,'collection',`Verified collection PHP ${amount}`,'R21,R24','collection',{amount,balance},`Saved charges 1100; paid ${amount}; signed balance ${balance}; no hotel payout implied.`, 'P0','boundary');
add('COLLECT-REFUND','collection','Verified refund increases balance','R24','refund',{record:'CHANNEL-2'},'Refund PHP 100 against channel collection 2400 increases balance from 120 to 220; original collection retained.','P0','state');
add('COLLECT-EXCESS','collection','Refund exceeding collection rejected','R24','excessRefund',{record:'CHANNEL-2'},'Refund PHP 2400.01 rejected; original bill/collection unchanged.','P0','negative');
add('CHANNEL-SOURCE-REVIEW','channels','Reviewed source change preserves prior verified collection','R27','sourceReview',{record:'CHANNEL-2'},'Keep source cancels review; confirmed switch archives Agoda terms and retains paid 2400; new source uses original saved room pricing without former external override.','P0','interaction');
add('FIN-COMMISSION','financials','Document commission independent of guest balance','R25,R32','commission',{record:'CHANNEL-2'},'Confirmed liability PHP 310/evidence recorded; guest billing unchanged.','P0','happy');
add('FIN-BATCH','financials','Two-reservation batch payout and reconciliation','R26,R25,R32','batch',{record:'CHANNEL-2'},'100+200=300 batch payout, two allocations; guest billing unchanged; reconciliation saved with explanation.','P0','interaction');
add('FIN-RECON-REASON','financials','Reconciliation without explanation rejected','R26','reconcileEmpty',{record:'CHANNEL-2'},'Existing partial reconciliation unchanged; required explanation validation shown.','P1','negative');
add('FIN-ALLOC-INVALID','financials','Negative batch allocation rejected','R23,R26','negativeAllocation',{record:'CHANNEL-2'},'No new settlement; negative amount error.','P0','negative');

// Explicit gaps: these are never represented as executed or passing tests.
for (const [id,module,description,rule,reason,executable] of [
  ['GAP-RATE-ZERO','pricing','Zero configured base rate and missing/disabled-rate save guards','R02','Requires configuration editor setup; current browser batch uses seed rates.',true],
  ['GAP-SNAPSHOT-CONFIG','history','Price/preset/product configuration changes preserve saved historical snapshots','R10,R20','Existing unit/UI harness coverage exists; cross-route configuration mutation browser flow pending.',true],
  ['GAP-INCL-CONFIG','inclusions','Duplicate/default inclusion validation and archived defaults','R11,R12','Room-type editor mutation browser setup pending.',true],
  ['GAP-INVENTORY-RETIRED','purchases','Disabled product/category and sale-disabled selections','R13,R20','Inventory mutation browser setup pending.',true],
  ['GAP-PRESET-CURRENCY','discounts','Mismatched currency/base price and disabled preset applicability','R16','Configuration editor setup pending; no foreign-currency seed.',true],
  ['GAP-MONEY-ROUND','billing','Half-away rounding and minor-unit allocation ties','R19,R23','Requires custom decimal-rate configuration; existing pure unit tests are not browser evidence.',true],
  ['GAP-AGREEMENT','channels','Agreement date endpoints, overlap and published immutability','R21,R33','Booking-source agreement editor browser flow pending.',true],
  ['GAP-CAPABILITIES','financials','Denied accounting capabilities enforce domain actions','R33','All demo capabilities are granted; no UI to change identity/capabilities. Do not inject application state.',false],
  ['GAP-ALLOC-ZERO','financials','Proportional tie and zero-price room fallback allocation','R22,R26','Requires custom zero-price rates and multi-room external total setup.',true],
  ['GAP-COMMISSION-METHODS','financials','Fixed/manual/none/explicit/reference commission and offset estimates','R25','Seed fixtures cover percentage/reference/separate invoice; other agreement setups pending.',true],
  ['GAP-DOMAIN-TRANSITIONS','lifecycle','Invalid direct domain transitions despite hidden UI controls','R06,R07,R08,R09','UI cannot call hidden domain actions; existing unit tests cover some, cancellation lacks explicit domain guard.',false],
  ['GAP-OCCUPANCY-INTEGERS','validation','Fractional/over-capacity adults and children','R01,R14','Whole-guest and capacity policy unclear: UI minima exist, capacity/integer enforcement appears absent; review before asserting invented limits.',true],
  ['GAP-GUEST-CONTACT','guests','Invalid email and phone business validation','R31','Phone/email optional; no documented validation policy beyond input type; request policy review.',true],
  ['GAP-CANCEL-FINANCE','billing','Cancellation refunds, commission reversals and penalties','R08,R24','Cancellation retains captured bill; automatic refund/penalty policy not documented or implemented.',false],
  ['GAP-REAL-PERSISTENCE','history','Backend persistence, real payment and bank settlement','R30','No backend, authenticated actor or banking integration implemented.',false],
  ['GAP-DUPLICATE-SUBMIT','creation','Rapid duplicate save and adjustment IDs under fixed clock','R01,R19','Save is disabled while submitting; adversarial rapid-click/Date.now adjustment collision browser probe pending.',true],
  ['GAP-BREAKFAST-STAY','breakfast','Stay shortening removes out-of-entitlement service dates','R14','Guest trimming implemented; separate multi-date stay shortening browser flow pending.',true],
  ['GAP-CALENDAR-GEOMETRY','calendar','Exact visual geometry for subhour bars across all views','R03,R28','Minute timestamps verified; pixel geometry assertions across viewport sizes pending.',true],
]) add(id,module,description,rule,null,{},'Review or additional browser setup required.','P1','gap',executable,reason);

// Configuration cases were implemented after the first partial browser batch.
add('STAY-CUSTOM','time','Rooms retain independent stay dates, durations and package prices','R02,R03,R04','configuration',{},'Room 101: 6h/1100; Room 102: 8h/1300 from 15:30 to 23:30; saved total 2400.','P0','interaction');
add('CHECKIN-DIRTY','lifecycle','One Dirty room prevents atomic multi-room check-in','R06,R34','configuration',{},'Dirty room 102 with explicit capacity 2 can be reserved but check-in rejects all rooms; reservation stays confirmed and no check-in audit added.','P0','negative');
add('CONFIG-OPTIONAL-CAPACITY','validation','Room readiness edit saves with optional capacity override blank','R34','configuration',{room:'102',capacityOverride:'',housekeeping:'dirty',description:'PW room fixture',operationalNotes:'PW readiness fixture'},'A blank optional capacity override remains unset; Dirty readiness is saved.','P1','boundary');
add('CAL-EXTEND','calendar','Extending checkout updates overdue occupancy status','R10,R28','configuration',{record:'DEMO-6',now:'2026-10-10T15:00:00+08:00'},'Initially overdue; selecting 3 nights extends checkout and changes calendar to occupied; billing follows explicit duration edit.','P0','interaction');
for(const [id,description,expected] of [
  ['GAP-RATE-ZERO','Zero configured rate is valid; disabled exact package rate blocks new assignment','Zero-rate reservation saves PHP 0; disabling standard-6-hours prevents a new Standard hourly assignment.'],
  ['GAP-SNAPSHOT-CONFIG','Rate configuration changes preserve saved prices until explicit duration edit','Captured 1100 survives current rate 9999 and unrelated edit; changing duration to 2 nights at new nightly 3333 captures 6666.'],
  ['GAP-INCL-CONFIG','Default inclusion quantities validate and do not rewrite saved reservations','Zero default rejected; duplicate option absent; saved water 1 retained while new assignments inherit water 9.'],
  ['GAP-INVENTORY-RETIRED','Sale-disabled product is excluded from new purchases; captured price retained','Saved Pancit remains 120 despite current price 999; sale-disabled product absent from new purchase selector.'],
  ['GAP-AGREEMENT','Published agreements immutable; adjacent effective dates capture by hotel entry date','Published rules disabled and demotion rejected; overlapping inclusive dates rejected; v1/v2 captured on entry endpoints, saved snapshot retained.'],
  ['GAP-MONEY-ROUND','Nightly units round before multiplication; percentage discounts round at application','Nightly 1.005 → 1.01 × 3 = 3.03; 50% reduction rounds to 1.52; owed 1.51.'],
  ['GAP-ALLOC-ZERO','Exact accommodation cent allocation across equal and zero-price rooms','External 0.01 allocates 0.01 to first room and 0 to second for equal original values and zero-price fallback; exact guest total 0.01.'],
  ['GAP-BREAKFAST-STAY','Shortening stay removes out-of-entitlement breakfast dates','Three-night Guest 1 third-date breakfast removed on shortening to one night; two unrecorded selectors remain; total 2200.'],
  ['GAP-PRESET-CURRENCY','Disabled/changed presets retain saved snapshots; presets above current base are excluded','Captured 950 survives edited preset 900 and disabling; new selections exclude disabled and above-base presets.'],
  ['GAP-COMMISSION-METHODS','Configured commission methods/bases and settlement estimates stay separate from guest charges','Fixed 12.34; none 0; manual Pending; 15% reference 600 → 90; 15% explicit 333.33 → 50; deducted/gross/manual/offset settlement expectations verified independently.'],
  ['GAP-DUPLICATE-SUBMIT','Duplicate submit guard and independent adjustment removal under same timestamp','Double-click saves one record; independent +100/+200 adjustments total 1400; removing A must retain B and total 1300.'],
  ['GAP-CALENDAR-GEOMETRY','Minute-precise CSS and rendered occupancy bar widths across four views','A six-hour stay starting 14:07 retains precise left/width ratios, and rendered pixel width matches scheduled interval within one pixel.'],
]){
  const scenario=scenarios.find(s=>s.id===id);
  Object.assign(scenario,{kind:'configuration',description,expected,implemented:true,gap:'',category:'regression'});
}
scenarios.find(s=>s.id==='GAP-DUPLICATE-SUBMIT').priority='P0';
scenarios.find(s=>s.id==='GAP-COMMISSION-METHODS').inputs.variants=['fixed','none','manual','percentage/reference_value','percentage/explicit_amount'];
Object.assign(scenarios.find(s=>s.id==='GAP-CALENDAR-GEOMETRY').inputs,{start:'2026-11-10T14:07',duration:'6-hours',guestName:'PW Geometry Guest',viewport:'1600 × 1050'});
for(const scenario of scenarios.filter(s=>s.kind==='collection'))scenario.inputs.source='booking-com';

add('REMEDY-ROOM-CONTRACT','validation','Optional clears, dynamic display fallback, invalid capacity and occupied readiness guard','R06,R10,R34','configuration',{},'Both editors preserve clears/custom names; type fallback updates; occupied readiness change refused.');
add('REMEDY-ROOM-METADATA','validation','Archived room metadata survives generic edits','R10,R34','configuration',{},'Archiving through Rooms UI remains archived after generic optional-field edit.');
add('REMEDY-CALENDAR-INTERACTION','calendar','Subpixel marker, explicit target choice, keyboard details and nearby empty slot','R03,R04,R28','configuration',{},'Two adjacent six-hour stays keep true geometry; pointer conflicts require a choice; keyboard identifies the exact stay; empty-slot actions remain usable.');
export const limitations = [
  'UI tests exercise the actual React/Vite app. All business records and financial transactions are simulated frontend session memory, not persisted or externally verified.',
  'Chromium desktop, Asia/Manila, single property only. No claims for other browsers, mobile layouts, accessibility completeness, production authentication, or backend concurrency.',
  'Explicit documented rules provide independent expected arithmetic. Source-only behavior is labeled an implementation contract and can still represent a product defect.',
  'No full Cartesian product: all 18 monetary rate cells are tested; selected boundary/equivalence partitions and high-risk interactions cover the rest. No formal pairwise coverage claim for all dimensions.',
  'Unsupported workflows and pending scenarios are counted separately, with reasons. Passing the implemented batch never means complete booking coverage.',
  'Unclear policies: guest capacity/fractional counts, contact validation, no-show grace period, cancellation refunds, permitted overpayment policy, tax basis and reconciliation evidence need business review.',
  'No existing on-demand Playwright utility or dependency was present in the repository; this isolated utility supplies that missing infrastructure without editing application logic.',
];

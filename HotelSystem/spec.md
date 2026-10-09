1. Project Name

Hotel Management System (HMS)

2. Purpose

The system will help hotel staff manage reservations, rooms, guest information, operations, and availability in a single operational dashboard. It must be simple enough for a small to mid-sized property while remaining scalable for more advanced hotel workflows such as housekeeping, pricing, payments, and reporting.

The current prototype focuses on a calendar-based room availability view. The long-term goal is to evolve that into a proper business application with a coherent interface, domain model, and routing structure.

3. Product Vision

The product should support a hotel team in performing daily operational work quickly and confidently:
- view occupancy and room availability
- manage reservations and room assignments
- track guest activity
- monitor room inventory and housekeeping
- support future billing, pricing, and reporting

The system should be:
- easy to understand
- domain-oriented
- modular
- implementation-independent from legacy ERP complexity
- built for operational clarity rather than theoretical enterprise patterns

4. Problem Statement

The current product is a calendar prototype that has become the main application. This creates a weak foundation because the calendar is acting as both:
- a scheduling interface
- a domain model entry point
- the primary app shell

This is not sustainable as the product grows into a hotel management platform.

The new system should separate:
- UI structure
- route/page ownership
- business domain concepts
- persistence and data access
- future API layers

5. Target Users

5.1 Front Desk Staff
- check room availability
- create and update reservations
- confirm guest stays
- assign rooms

5.2 Hotel Manager / Operations
- monitor occupancy
- review arrivals and departures
- assess room inventory
- approve workflows

5.3 Housekeeping Team
- observe room status
- track clean/dirty/occupied rooms
- update room readiness

5.4 Accounting / Billing
- manage payments, invoices, and payment status
- view reservation pricing and financial state

5.5 Admin
- configure app settings
- manage users and permissions
- oversee property configuration

6. Core Business Domains

The system must model real hotel concepts, not generic ERP abstractions.

Primary domains:
- hotel / property
- room
- room type
- guest
- reservation
- stay / occupancy
- rate / pricing
- payment
- housekeeping
- user / staff
- report / analytics

7. Planned Functional Scope

7.1 Phase 1 – Core Dashboard and Routing
- login page
- dashboard
- reservations page
- rooms page
- guests page
- 404 page
- navigation and layout shell
- room availability calendar

7.2 Phase 2 – Reservation Management
- reservation list
- reservation details
- create/update reservation
- search and filter
- room assignment logic
- status lifecycle

7.3 Phase 3 – Guest Management
- guest list
- guest profiles
- reservation history
- contact details
- preferences

7.4 Phase 4 – Room and Housekeeping Management
- room inventory
- room status
- housekeeping tasks
- maintenance state
- occupancy status

7.5 Phase 5 – Pricing and Payments
- room rate rules
- discounts
- invoice generation
- payment capture
- ledger tracking

7.6 Phase 6 – Reporting and Insights
- occupancy rate
- ADR
- RevPAR
- arrivals/departures
- housekeeping completion
- revenue reports

8. Non-Goals for Initial Version

Do not build these yet unless they become real requirements:
- complex enterprise permissions framework
- multi-property complexity too early
- global state library without need
- dependency injection framework
- ERP-style model parity with systems like Odoo
- premature data-access abstraction
- extremely complicated UX patterns
- full accounting engine
- feature modules for every possible future business need

9. Architectural Principles

9.1 Pages represent routes
Each page answers the question:
- What should the user see at this URL?

Examples:
- /login
- /
- /reservations
- /rooms
- /guests

9.2 Components represent reusable UI
Components answer:
- What UI pattern can be reused?

Examples:
- AvailabilityCalendar
- DayCalendar
- WeekCalendar
- MonthCalendar
- YearCalendar
- Sidebar
- Header
- SearchField
- StatusBadge

9.3 Layouts represent shared application structure
Layouts answer:
- What is shared across multiple routes?

Examples:
- AppLayout
- AuthLayout

9.4 Routing owns navigation
The application should not use internal page flags such as:
- if (page === "dashboard") ...
- if (page === "rooms") ...

Routes should be explicit and declarative.

9.5 Domain structure should not be forced by UI structure
The UI architecture and the business domain are separate concerns.

10. Frontend Architecture

10.1 High-Level Structure

src/
  app/
    App.tsx
    router.tsx
    layouts/
      AppLayout.tsx
      AuthLayout.tsx

  pages/
    DashboardPage.tsx
    LoginPage.tsx
    ReservationsPage.tsx
    RoomsPage.tsx
    GuestsPage.tsx
    NotFoundPage.tsx

  components/
    calendar/
      DayCalendar.tsx
      WeekCalendar.tsx
      MonthCalendar.tsx
      YearCalendar.tsx
      AvailabilityCalendar.tsx
    navigation/
    ui/

  data/
    sampleStays.ts
    rooms.ts
    guests.ts

  lib/
    calendar.ts
    date.ts
    formatting.ts
    routing.ts

  types/
    booking.ts
    room.ts
    guest.ts
    reservation.ts
    user.ts

  hooks/
    useReservations.ts
    useRooms.ts
    useGuests.ts

  services/
    api.ts
    reservations.ts
    rooms.ts
    guests.ts

  styles/
    index.css

  main.tsx

10.2 Responsibilities by Layer
- app: router and app bootstrap
- pages: route-level screens
- components: reusable UI and domain UI blocks
- lib: pure utilities
- hooks: data-fetching and state composition
- services: API adapters and network logic
- types: domain-type definitions
- data: seed/mock data
- styles: global styling

11. Routing Specification

Initial routes:
- /login
- /
- /reservations
- /rooms
- /guests
- * => NotFoundPage

Protected route structure:
- public: /login
- authenticated: /, /reservations, /rooms, /guests

Longer-term route patterns:
- /reservations/:reservationId
- /rooms/:roomId
- /guests/:guestId
- /room-types
- /housekeeping
- /payments
- /reports

12. Layout Spec

12.1 Auth Layout
Used for:
- login
- password reset
- account setup
- future auth flows

Contains:
- application branding
- centered login form shell
- empty or minimal chrome

12.2 App Layout
Used for all authenticated pages.

Contains:
- sidebar navigation
- header
- app title/branding
- user menu
- page content outlet

Navigation initially:
- Dashboard
- Reservations
- Rooms
- Guests

13. Page Specifications

13.1 DashboardPage
Purpose:
- summarize room availability and current hotel operations
- render the main availability calendar
- provide a quick overview of the hotel

Initial content:
- calendar toolbar
- view switching (day/week/month/year)
- selected stay details
- room occupancy visualization

Future content:
- arrivals
- departures
- occupancy stats
- housekeeping status
- revenue snapshot

13.2 ReservationsPage
Purpose:
- manage reservations as a first-class domain object

Planned features:
- reservation list
- search
- filters by status/date/room/guest
- create reservation
- update reservation
- cancel reservation
- open details

13.3 RoomsPage
Purpose:
- manage physical rooms

Planned features:
- room list
- room number
- room type
- current status
- occupancy state
- housekeeping state
- room amenities
- maintenance notes

13.4 GuestsPage
Purpose:
- manage guest records and guest-level history

Features:
- list guests
- profile detail
- booking history
- preferences
- contact data
- loyalty-related info

13.5 LoginPage
Purpose:
- authentication entry point

Initial version:
- email/password form
- no real auth logic yet, only UI scaffold

13.6 NotFoundPage
Purpose:
- graceful fallback for unknown URLs

Design:
- friendly 404 message
- return to dashboard action

14. Calendar Architecture

The calendar is a reusable component, not a page-level feature. It represents room availability and stay timelines.

Calendar views:
- DayCalendar
- WeekCalendar
- MonthCalendar
- YearCalendar

Main component:
- AvailabilityCalendar

Responsibilities:
- choose view implementation
- render room rows
- render reservation blocks
- coordinate navigation and selection

Non-responsibilities:
- auth
- database access
- guest CRUD
- room CRUD
- backend logic
- pricing logic
- billing logic

15. Domain Model

15.1 Hotel
Represents a property or lodging entity.
Fields:
- id
- name
- address
- timezone
- status

15.2 Room
Represents a physical room.
Fields:
- id
- roomNumber
- roomTypeId
- status
- occupancyStatus
- housekeepingStatus
- floor
- amenities
- notes

15.3 RoomType
Represents a category of rooms.
Fields:
- id
- name
- description
- maxOccupancy
- baseRate

15.4 Guest
Represents a person associated with reservations.
Fields:
- id
- firstName
- lastName
- fullName
- email
- phone
- nationality
- notes

15.5 Reservation
Represents a booking.
Fields:
- id
- guestId
- roomIds[]
- checkInDate
- checkOutDate
- status
- source
- ratePlanId
- totalAmount
- currency
- notes

15.6 Stay
Short-term operational representation.
Fields:
- id
- reservationId
- roomId
- guestId
- checkIn
- checkOut
- status

15.7 Rate / RatePlan
Used for pricing.
Fields:
- id
- roomTypeId
- validFrom
- validTo
- nightlyRate
- currency
- conditions

15.8 Payment
- id
- reservationId
- amount
- currency
- paymentMethod
- status
- processedAt

15.9 HousekeepingTask
- id
- roomId
- taskType
- dueAt
- status
- assignee

16. Data Flow

Controls the transition from UI -> service -> API -> backend.

Expected structure:
- Page
- Hook or service layer
- API client
- Backend endpoint
- Persistence layer

Avoid:
- pages making raw database calls directly
- backend-specific logic leaking into screen components

17. State Management Strategy

17.1 Local State
Use local React state for:
- selected date
- current view
- modal visibility
- form drafts
- active row selection

17.2 Data Fetching State
For page-level or module-level data:
- loading
- error
- empty
- success

17.3 Global State
Only introduce global state if truly needed for:
- authenticated user
- current property selection
- global preferences

Do not add Redux or a generalized state library prematurely.

18. Authentication Requirements

Authentication should eventually be modeled as:
- login form
- auth context/provider
- protected route guard
- logout flow
- session refresh or token expiry handling

Protected routes:
- all authenticated app pages
- redirect to /login if unauthenticated

19. Data Access and API Layer

Initial mock data is acceptable in development, but architecture should anticipate real API access.

Proposed services:
- reservationsService
- roomsService
- guestsService
- authService
- reportsService

Example operations:
- getAllReservations()
- getReservationById()
- createReservation()
- updateReservation()
- deleteReservation()
- getRoomAvailability()
- getGuests()
- getGuestById()

20. Error and Loading States

Every data-driven screen should support:
- loading
- empty
- success
- error

Examples:
- Loading reservations...
- No reservations found
- Unable to load rooms
- Retry

21. Calendar Precision Rules

Reservation actual timestamps are authoritative and should not be rounded just to make layout easier.

Important rule:
- preserve timestamp precision for geometry calculations
- calendar grid can use day/month boundaries for display
- start ratio/end ratio/width ratio must be derived from actual timestamps

Example:
- Check-in: 2026-10-05 18:10
- Check-out: 2026-10-07 09:45

The UI should calculate visible ratios from these exact times, not approximate them to day starts or 00:00 boundaries.

22. Responsive Behavior

The interface must support:
- desktop
- tablet
- mobile

For timeline-heavy screens:
- horizontal scrolling is acceptable
- do not force narrow cells to unreadably small widths

23. Edge Cases to Support

23.1 Authentication
- user opens protected route while logged out
- session expires while session remains open
- navigation to /login while already authenticated
- logout during active app use

23.2 Routing
- unknown URL
- refresh on nested route
- invalid resource ID
- direct browsing to reservation detail route

23.3 Data
- empty dataset
- API unavailable
- room deleted but reservation refers to it
- cancelled reservations
- guest with no assigned room
- multiple rooms in one reservation
- reservation spanning multiple dates

23.4 Calendar
- reservation begins before visible range
- reservation ends after visible range
- reservation exactly at boundary
- invalid/inverted dates
- overlapping reservations
- short stays
- long stays
- timezone differences
- daylight-saving changes

24. Security Requirements

Not yet complex, but future architecture should support:
- authentication
- role-based access
- input validation
- sanitization of user input
- session security
- CSRF protection where relevant
- least privilege for staff roles

25. Performance Requirements

- dashboard loads quickly
- calendar interactions remain smooth
- room grid rendering should handle moderate occupancy counts efficiently
- page transitions remain lightweight
- large reservation lists should paginate or lazy-load

26. Accessibility Requirements

The product should aim for:
- keyboard navigation
- visible focus states
- semantic headings
- color contrast compliance
- screen-reader-friendly labels
- accessible form inputs and buttons
- alternate text or ARIA where needed

27. Testing Strategy

27.1 Unit Testing
- date calculations
- timeline ratio logic
- room filtering logic
- reservation status logic

27.2 Component Testing
- calendar render
- booking selection
- navigation
- page transitions

27.3 Integration Testing
- route behavior
- protected route redirects
- dashboard data flow
- reservation creation flow

27.4 E2E Testing
- login flow
- dashboard navigation
- reservation list creation
- guest profile browsing
- 404 push

28. Quality Gates

Before merging or release:
- app builds successfully
- no TypeScript errors
- lint checks pass
- routes render correctly
- major flows tested manually
- data edge cases handled
- no broken calendar geometry

29. Initial Implementation Milestone

The first milestone is complete when:
- app shell exists
- router exists
- app layout exists
- auth layout exists
- dashboard page exists
- reservations page exists
- rooms page exists
- guests page exists
- not-found page exists
- calendar works inside dashboard
- navigation works
- public and protected route separation is implemented

30. Recommended Next Milestone Sequence

Phase A – Route and layout foundation
1. create router
2. create app/auth layouts
3. create dashboard and placeholder pages
4. move existing calendar into dashboard

Phase B – Domain modeling
1. define Room
2. define Guest
3. define Reservation
4. define Rate
5. define RoomType

Phase C – Data layer
1. local mock persistence
2. service layer
3. API client abstraction
4. fetch hooks

Phase D – Reservation management
1. list
2. details
3. filters
4. create/update flows

Phase E – Inventory and operations
1. room status
2. housekeeping status
3. maintenance states

Phase F – Finance and reporting
1. rates
2. payments
3. occupancy metrics
4. reports

31. Long-Term Product Goals

The final system should be a hotel hospitality platform supporting:
- reservation management
- room inventory
- guest management
- housekeeping
- payments
- pricing logic
- reporting
- staff workflows
- analytics

It should be resilient enough that the UI, domain model, and persistence layers evolve independently without causing a rewrite of the entire app.

32. Key Design Decision

The project must not reproduce ERP or Odoo-style internal abstractions unless they are needed by the actual business domain.

The guiding principle is:
- model the hotel domain directly
- not the implementation structure of a generalized ERP

This keeps the product simpler, more maintainable, and more aligned with real hotel operations.

33. Final Summary

This project is best understood as a hotel operations platform that starts as a calendar-driven dashboard and gradually grows into a complete hospitality management system.

The correct foundation is:
- route-driven pages
- reusable UI components
- domain-oriented model
- clean separation of concerns
- minimal premature abstraction
- focus on hotel workflows rather than unrelated ERP patterns


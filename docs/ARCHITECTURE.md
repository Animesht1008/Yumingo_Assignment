# Yumingo — System Architecture

## 1. Project Overview

Yumingo is a role-based food ordering and delivery application built with React, TypeScript, Vite, and Supabase.

The application supports three user roles:

- **Customer:** Discovers restaurants, browses menus, places orders, and tracks order status.
- **Restaurant Owner:** Views incoming orders and progresses them through preparation.
- **Delivery Rider:** Views available pickup requests, accepts deliveries, and updates delivery progress.

Supabase provides authentication, PostgreSQL data storage, Row Level Security (RLS), and database functions.

The application currently uses explicit data fetching and manual refresh mechanisms. Supabase Realtime is available as a platform capability but is not currently integrated into the frontend's order-update workflow.

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript |
| Build tooling | Vite |
| Backend services | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Authorization | PostgreSQL RLS policies and database functions |
| Database operations | Supabase JavaScript client, PostgreSQL RPCs |
| Realtime capability | Supabase Realtime (not currently integrated into frontend order subscriptions) |
| Deployment target | Vercel (planned) |

## 3. High-Level Architecture

The frontend communicates with Supabase using the Supabase JavaScript client.

```text
                 React Application
                        |
             Authentication / Session
                        |
                 Role Verification
                        |
          +-------------+-------------+
          |             |             |
       Customer      Restaurant      Rider
      Dashboard       Dashboard    Dashboard
          |             |             |
          +-------------+-------------+
                        |
                 Supabase Client
                        |
                 Supabase Platform
                        |
             +----------+----------+
             |                     |
         Supabase Auth         PostgreSQL
                                   |
                              RLS + RPCs
                                   |
                         Business Transactions
```

The frontend handles presentation, user interaction, and data fetching. Sensitive business operations, including order creation, rider assignment, and delivery-status validation, are enforced at the database layer.

Dashboard data is retrieved through explicit Supabase queries. Users can manually refresh data, and relevant operations trigger additional queries to retrieve the latest database state.

## 4. Frontend Structure

The main application entry point is `src/App.tsx`.

Important components:

| File | Responsibility |
|---|---|
| `src/App.tsx` | Authentication state, role verification, and dashboard routing |
| `src/components/CustomerDashboard.tsx` | Restaurant discovery, menu browsing, cart, order placement, and order history |
| `src/components/RiderDashboard.tsx` | Available deliveries, active deliveries, order acceptance, and delivery progression |
| `src/components/OrderCard.tsx` | Reusable order presentation |
| `src/components/SummaryCard.tsx` | Dashboard summary presentation |
| `src/components/AppHeader.tsx` | Shared application header |
| `src/lib/supabase.ts` | Supabase client configuration |
| `src/types/order.ts` | Application order types |
| `src/types/databaseOrder.ts` | Database order types |

### Authentication and role resolution

1. The application retrieves the current Supabase Auth session.
2. It listens for authentication-state changes.
3. After authentication, it retrieves the user's profile and role.
4. It verifies role-specific access:
   - Riders must have a corresponding rider record.
   - Restaurant owners must own a restaurant.
   - Customers are routed to the customer dashboard.
5. Users without valid access are prevented from entering the corresponding dashboard.

## 5. Database Design

The application uses PostgreSQL tables to represent users, restaurants, menus, orders, and delivery assignments.

### Main tables

| Table | Purpose |
|---|---|
| `profiles` | Application user profile and role information |
| `restaurants` | Restaurant details and ownership |
| `riders` | Rider-specific information |
| `menu_items` | Restaurant menu and item prices |
| `orders` | Main order records and lifecycle status |
| `order_items` | Individual items belonging to an order |
| `order_assignments` | Rider-to-order assignment records and idempotency information |
| `order_delivery_details` | Delivery-related information |

### Main relationships

- A profile can own a restaurant.
- A restaurant has multiple menu items.
- A customer can create multiple orders.
- Each order belongs to a restaurant and a customer.
- An order contains multiple order items.
- An order can be assigned to a rider.
- Order assignment records preserve assignment and completion information.

Prices are represented in integer cents/paise rather than floating-point values. This avoids floating-point precision problems in monetary calculations.

## 6. Order Lifecycle

The main order lifecycle is:

```text
placed
   |
   v
accepted
   |
   v
preparing
   |
   v
ready_for_pickup
   |
   v
assigned
   |
   v
picked_up
   |
   v
delivered
```

The database validates permitted status transitions through a PostgreSQL trigger.

The rider assignment operation also updates the order's rider information as part of the database transaction.

## 7. Customer Workflow

1. The customer authenticates through Supabase Auth.
2. The customer dashboard loads restaurants that are currently open.
3. The customer selects a restaurant.
4. Available menu items are retrieved.
5. Items are added to a client-side cart.
6. The customer submits the order.
7. The frontend calls the `place_order` PostgreSQL RPC.
8. The database validates the customer, restaurant, menu items, quantities, and prices.
9. The database calculates the authoritative total and creates the order and its order items.
10. The customer can view order history and order status.

**Important pricing rule:** The cart total shown in the frontend is an estimate for display. The database calculates the authoritative order total. The client does not decide the final amount stored in the order.

## 8. Restaurant Owner Workflow

1. The restaurant owner authenticates.
2. The application verifies restaurant ownership.
3. The dashboard retrieves orders belonging to that restaurant.
4. The owner progresses orders through:
   - Accept Order
   - Start Preparing
   - Mark Ready for Pickup
5. Updates are submitted to PostgreSQL.
6. Database policies and the order-status trigger enforce access and valid transitions.

Restaurant owners cannot use the dashboard to update orders belonging to another restaurant.

## 9. Rider Workflow

1. The rider authenticates.
2. The dashboard retrieves:
   - Available orders with `ready_for_pickup` status and no assigned rider.
   - Active orders assigned to the authenticated rider.
3. The rider accepts an available order.
4. The frontend invokes `accept_order`.
5. The database validates rider authorization and atomically claims the order.
6. The rider progresses the delivery using `update_delivery_status`.
7. The database validates the rider's assignment and permitted status transition.
8. When delivery is completed, the assignment is marked completed.

### Atomic assignment and idempotency

Order acceptance is implemented as a database transaction rather than a client-side read-then-update sequence.

The `accept_order` function:

- Validates the authenticated rider.
- Uses a transaction-level advisory lock for the rider and idempotency key.
- Checks whether the same request was already processed.
- Prevents reuse of an idempotency key for a different order.
- Claims the order only when it is still available.
- Creates the corresponding assignment record.

Unique indexes provide additional protection against duplicate active assignments and duplicate rider/idempotency-key combinations.

The frontend generates an idempotency key and retains it in a React ref while retrying an uncertain request. This allows a retry to reuse the original key during the current component session.

**Known limitation:** The current key is held in memory. A page reload can discard it, so retry recovery across reloads is not guaranteed.

## 10. Database Security

Security is enforced primarily at the database layer.

### Row Level Security

RLS is enabled on all eight application tables.

Policies restrict access according to the authenticated user and their role.

Examples:

- Customers can create and view their own orders.
- Restaurant owners can access and update orders belonging to their restaurants.
- Riders can view eligible pickup orders and their own active deliveries.
- Order assignment and delivery information is restricted to relevant participants.

### Role escalation protection

A database trigger prevents authenticated users from changing their own application role through profile updates.

Profile update privileges are also restricted to permitted profile fields.

### Privileged database functions

The following PostgreSQL functions implement important business operations:

- `place_order`
- `accept_order`
- `update_delivery_status`
- `get_my_role`
- `owns_restaurant`

Sensitive transaction functions use `SECURITY DEFINER` with an explicitly controlled empty `search_path`.

Execution privileges are restricted to authenticated users rather than anonymous users.

### Frontend credentials

The frontend uses the Supabase project URL and publishable key. A service-role key must never be exposed in browser code or frontend environment variables.

## 11. Error Handling and Reliability

The frontend provides loading, success, and error states for important operations.

The rider acceptance workflow includes:

- A 10-second request timeout.
- Detection of transient network and server errors.
- A maximum of two attempts.
- Exponential backoff between attempts.
- Reuse of the same idempotency key during retries.
- A recovery message when the outcome of a request is uncertain.

After uncertain delivery-status updates, the dashboard reloads database state to avoid relying solely on the response received by the client.

## 12. Data Fetching and Refresh Behaviour

The current application uses explicit Supabase queries to retrieve dashboard data. It does not currently implement PostgreSQL change subscriptions or Supabase Broadcast subscriptions for order updates.

### Customer dashboard

- Loads open restaurants and customer order history when the dashboard initializes.
- Loads menu items when the selected restaurant changes.
- Reloads order history after successfully placing an order.
- Provides a manual Refresh Orders action.

### Restaurant dashboard

- Loads restaurant orders after restaurant ownership is verified.
- Reloads orders after a successful status update.
- Provides a manual Refresh action.

### Rider dashboard

- Loads available and assigned orders when the dashboard initializes.
- Reloads orders after acceptance, pickup, delivery completion, or uncertain operation outcomes.
- Provides a manual Refresh action.

The Supabase `supabase_realtime` publication exists in the database, but the inspected publication-table query returned no registered tables. The frontend source inspection also found no `postgres_changes` or Broadcast subscription implementation.

**Future enhancement:** Integrate Supabase Realtime subscriptions for relevant order and assignment changes. This would allow dashboards to receive database updates without requiring manual refreshes or additional queries.

Until that integration is implemented and tested, the application should be described as using query-based data fetching and manual refresh rather than live database subscriptions.

## 13. Database Schema Management

The repository now contains an exported database schema and an initial migration structure:

```text
supabase/
├── migrations/
│   ├── 20261119000000_initial_schema.sql
│   └── 20261119000100_harden_default_privileges.sql
└── schema.sql
```

- `schema.sql` preserves the exported database schema.
- `20261119000000_initial_schema.sql` is a copy of the exported schema.
- `20261119000100_harden_default_privileges.sql` revokes unnecessary default privileges for future tables created by the `postgres` role in the `public` schema.

The initial schema export includes application tables, functions, triggers, indexes, constraints, RLS policies, and grants.

**Migration status:** The files have been created and verified locally. They have not yet been validated by applying them to a clean Supabase environment. Environment-specific ownership, grants, managed Supabase objects, and migration ordering must be reviewed before using them to initialize another project.

## 14. Deployment Architecture

The planned deployment separates the frontend hosting environment from the Supabase backend.

- Frontend: Vercel.
- Backend services and database: Supabase.
- Frontend environment configuration:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`

The production frontend must use production Supabase credentials and must not include privileged service-role credentials.

## 15. Known Limitations and Follow-up Work

1. Idempotency keys are stored in component memory and do not survive a page reload.
2. Network-failure recovery has implementation support, but a conclusive runtime offline-failure test has not yet been established.
3. The database migration files have not yet been validated against a clean Supabase environment.
4. The exported schema and migration files require review for environment-specific ownership, grants, and Supabase-managed configuration.
5. Supabase Realtime subscriptions for order updates are not currently implemented in the frontend.
6. Vercel deployment and production-environment validation remain pending.

## 16. Engineering Verification

The project has been tested through role-based workflows:

- Customer authentication, restaurant/menu loading, cart operations, order placement, and order history.
- Restaurant ownership verification and order-status progression.
- Rider authentication, order acceptance, pickup, and delivery completion.
- Concurrent rider acceptance testing.
- Idempotent retry testing.
- RLS and application-role regression checks.
- Cross-role order visibility through database queries and dashboard refreshes.

The project also passed the recorded frontend lint and production build checks.

These checks demonstrate the tested workflows; they should not be represented as a full penetration test or exhaustive production-readiness certification.
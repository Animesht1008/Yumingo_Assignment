# Yumingo — System Architecture

## 1. Project Overview

Yumingo is a role-based food ordering and delivery application built with React, TypeScript, Vite, and Supabase.

The application supports three user roles:

- **Customer:** discovers restaurants, browses menus, places orders, and tracks order status.
- **Restaurant Owner:** views incoming orders and progresses them through preparation.
- **Delivery Rider:** views available pickup requests, accepts deliveries, and updates delivery progress.

Supabase provides authentication, PostgreSQL data storage, Row Level Security (RLS), database functions, and realtime capabilities.

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
| Realtime capability | Supabase Realtime |
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
          +-------------+-------------+
          |             |             |
       Supabase       PostgreSQL    Realtime
         Auth          Database
                         |
                 RLS + Database RPCs
                         |
                Business Transactions
```

The frontend handles presentation, user interaction, and data fetching. Sensitive business operations, including order creation, rider assignment, and delivery-status validation, are enforced at the database layer.

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

## 12. Realtime Behaviour

Realtime behaviour was validated across the customer, restaurant, and rider workflows.

The observed workflow included:

- A newly placed customer order becoming visible to the restaurant.
- Restaurant status changes appearing in the customer experience.
- Ready-for-pickup orders becoming available to riders.
- Rider assignment appearing in the customer's order status.

The exact client subscription configuration should be documented alongside the relevant implementation code before describing the frontend subscription mechanism in detail.

## 13. Deployment Architecture

The planned deployment separates the frontend hosting environment from the Supabase backend.

- Frontend: Vercel.
- Backend services and database: Supabase.
- Frontend environment configuration:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`

The production frontend must use production Supabase credentials and must not include privileged service-role credentials.

## 14. Known Limitations and Follow-up Work

1. The idempotency test UI currently contains hardcoded test identities and order details. It should be removed before final submission.
2. Idempotency keys are stored in component memory and do not survive a page reload.
3. Network-failure recovery has implementation support, but a conclusive runtime offline-failure test has not yet been established.
4. The repository currently contains only a backup SQL file for `accept_order`; the full database schema, policies, triggers, and RPC definitions should be consolidated into version-controlled migration files.
5. The exact frontend Realtime subscription implementation should be confirmed before documenting its internal mechanics.

## 15. Engineering Verification

The project has been tested through role-based workflows:

- Customer authentication, restaurant/menu loading, cart operations, order placement, and order history.
- Restaurant ownership verification and order-status progression.
- Rider authentication, order acceptance, pickup, and delivery completion.
- Concurrent rider acceptance testing.
- Idempotent retry testing.
- RLS and application-role regression checks.
- Cross-role order status visibility and realtime workflow checks.

The project also passed the recorded frontend lint and production build checks.

These checks demonstrate the tested workflows; they should not be represented as a full penetration test or exhaustive production-readiness certification.
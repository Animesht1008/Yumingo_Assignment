# Yumingo — Testing and Verification

## 1. Overview

This document describes the testing and verification performed for the Yumingo food ordering and delivery application.

Testing focused on:

- Authentication and role-based access.
- Customer order placement and order history.
- Restaurant order management.
- Rider order acceptance and delivery progression.
- Concurrent order assignment.
- Idempotency and duplicate-request protection.
- Row Level Security (RLS).
- Database function and table privileges.
- Cross-role order visibility.
- Database migration reproducibility.
- Frontend linting and production builds.

Testing was performed using both a local Supabase environment and the hosted Supabase project. These environments were used for different purposes and are distinguished throughout this document.

## 2. Test Environment

| Component | Configuration |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Authorization | PostgreSQL RLS |
| Browser | Microsoft Edge, Chrome |
| Runtime | Node.js v20.20.0 |
| Package manager | npm 11.8.0 |
| Local database | Supabase CLI with Docker |

### Test accounts

Separate test identities were used to verify role-specific access:

| Role | Test account |
|---|---|
| Customer | Dedicated customer test account |
| Restaurant Owner | Dedicated restaurant-owner test account |
| Rider 1 | Dedicated rider test account |
| Rider 2 | Separate rider test account |

The test environment included Green Leaf Restaurant and sample menu items.

## 3. Functional Testing

### 3.1 Authentication and Role-Based Access

**Objective:** Verify that authenticated users are routed to the correct dashboard and that role-specific access is checked.

| Test case | Expected result | Result |
|---|---|---|
| Customer login | Customer dashboard loads | PASS |
| Restaurant owner login | Restaurant dashboard loads | PASS |
| Rider 1 login | Rider dashboard loads | PASS |
| Rider 2 login | Rider dashboard loads | PASS |
| Restaurant ownership verification | Owner accesses their own restaurant | PASS |
| Rider record verification | Rider must have a corresponding rider record | PASS |
| Sign out | User session is terminated | PASS |

### 3.2 Customer Application

**Objective:** Verify restaurant discovery, menu browsing, cart operations, order creation, and order history.

| Test case | Expected result | Result |
|---|---|---|
| Load open restaurants | Available restaurants are displayed | PASS |
| Load restaurant menu | Available menu items and prices are displayed | PASS |
| Add items to cart | Selected items appear in cart | PASS |
| Update quantity | Cart quantity and total update | PASS |
| Remove cart item | Item is removed when quantity reaches zero | PASS |
| Place order | Order is created through `place_order` RPC | PASS (earlier functional test) |
| Verify order total | Database calculates and stores the correct total | PASS |
| View order history | Customer sees their own orders | PASS |
| View order status | Current order status is displayed | PASS |

**Pricing verification**

An order containing:

- Paneer Butter Masala: ₹250
- Veg Biryani: ₹180

was placed successfully.

Expected total: ₹430.

The database stored `total_cents = 43000`, and the corresponding order items were verified.

A database-side pricing issue was also identified and corrected during testing. The order-creation function was updated to calculate the total before inserting the order, rather than initially inserting an invalid zero total.

**Post-permission-hardening regression:** Customer authentication, restaurant discovery, menu loading, and order-history retrieval were successfully verified against the hosted Supabase project. A new customer order was not placed during this latest regression round.

### 3.3 Restaurant Owner Application

**Objective:** Verify that restaurant owners can retrieve their own orders and progress them through the preparation lifecycle.

| Test case | Expected result | Result |
|---|---|---|
| Owner authentication | Restaurant dashboard loads | PASS |
| Restaurant ownership check | Correct restaurant is associated with owner | PASS |
| Load restaurant orders | Orders belonging to the restaurant are displayed | PASS |
| Accept order | Status changes to `accepted` | PASS |
| Start preparation | Status changes to `preparing` | PASS |
| Mark ready for pickup | Status changes to `ready_for_pickup` | PASS |
| Dashboard summary | Order counts reflect current statuses | PASS |

The following status progression was verified:

`placed → accepted → preparing → ready_for_pickup`

Database triggers validate permitted order-status transitions.

**Post-permission-hardening regression:** The restaurant owner successfully loaded existing orders and transitioned order `4b3a35a3` from `accepted` to `ready_for_pickup` in the hosted environment. Dashboard summary counts updated accordingly.

### 3.4 Rider Application

**Objective:** Verify order discovery, assignment, pickup, and delivery completion.

| Test case | Expected result | Result |
|---|---|---|
| Rider authentication | Rider dashboard loads | PASS |
| Load available deliveries | Eligible unassigned orders are displayed | PASS |
| Load active deliveries | Orders assigned to the logged-in rider are displayed | PASS |
| Accept order | Order is assigned to the rider | PASS |
| Mark picked up | Status changes to `picked_up` | PASS |
| Mark delivered | Status changes to `delivered` | PASS |
| Assignment completion | Assignment status becomes `completed` | PASS |
| Refresh dashboard | Latest database state is retrieved | PASS |

A complete delivery lifecycle was verified:

`ready_for_pickup → assigned → picked_up → delivered`

**Post-permission-hardening regression:** The rider successfully accepted, picked up, and delivered an existing hosted test order.

The final order and assignment records were verified directly in Supabase.

Verified order:

`4b3a35a3-be46-4ead-b96a-0f69d116a40b`

Final database state:

| Field | Value |
|---|---|
| Order status | `delivered` |
| Rider ID | `4be2081e-e0f1-47a0-b90e-17939025efb2` |
| Assignment status | `completed` |
| Idempotency key | Present |
| Assigned at | 2026-11-19 11:27:20 UTC |
| Completed at | 2026-11-19 11:28:32 UTC |

This confirms that both the order and corresponding assignment reached their expected terminal states.

## 4. Concurrency Testing

**Objective:** Verify that two riders cannot successfully claim the same available order.

### Test scenario

1. A test order was made available for pickup.
2. Rider 1 and Rider 2 attempted to accept the same order.
3. The database handled the competing requests.
4. The final order and assignment records were inspected.

**Expected result:**

- Only one rider should successfully claim the order.
- Only one active assignment should exist for that order.
- The order should reference the winning rider.

**Observed result:**

**PASS**

Rider 1 won the tested race. Supabase confirmed that only one active assignment existed for the order.

The implementation uses transactional order claiming, advisory locking, and database uniqueness constraints to protect assignment integrity.

## 5. Idempotency Testing

**Objective:** Verify that retrying an order-acceptance request with the same idempotency key does not create duplicate assignments.

### Test scenario

The same rider submitted the same `accept_order` request twice with:

- The same order ID.
- The same rider identity.
- The same idempotency key.

The returned assignment IDs and database records were compared.

**Expected result:**

Both requests should return the same assignment ID, with exactly one active assignment.

**Observed result:**

**PASS**

Both requests returned the same assignment ID:

`829e79a6-48b7-4fb4-9a46-12eb4fa6fb8c`

Supabase verification confirmed exactly one active assignment for the tested rider, order, and idempotency key.

### Retry implementation

The rider frontend additionally implements:

- A 10-second request timeout.
- Transient network/server error detection.
- A maximum of two attempts.
- Exponential backoff.
- Reuse of the same idempotency key during retries.

**Known limitation:** The frontend currently stores retry keys in a React ref. A page reload can discard the key, so retry recovery across reloads is not guaranteed.

## 6. Database Security and RLS Testing

**Objective:** Verify that application roles have appropriately restricted access to database records and operations.

### 6.1 RLS verification

RLS was confirmed enabled on all eight application tables:

- `profiles`
- `restaurants`
- `riders`
- `menu_items`
- `orders`
- `order_items`
- `order_assignments`
- `order_delivery_details`

### 6.2 Policy verification

A local migration validation confirmed that all 20 RLS policies were created successfully.

The following access restrictions were reviewed:

| Area | Verification |
|---|---|
| Profiles | Users can access their own profile |
| Profile updates | Restricted to permitted profile fields |
| Role changes | Database trigger prevents authenticated role escalation |
| Restaurants | Restaurant information is accessible under the configured authenticated-user policy |
| Menu items | Owners can manage their own menu items under the configured policies |
| Orders | Customers, restaurant owners, and riders have role-specific access |
| Order items | Access is restricted according to order participation and configured policies |
| Assignments | Access is restricted to relevant riders and order participants |
| Delivery details | Access is restricted to relevant order participants |

### 6.3 Database function permissions

The following application functions were reviewed:

- `place_order`
- `accept_order`
- `update_delivery_status`
- `get_my_role`
- `owns_restaurant`

Execution permissions were verified in the local database:

- `anon` cannot execute these functions.
- `authenticated` can execute these functions.

PostgreSQL's default `PUBLIC` execution privilege was also revoked to prevent anonymous users from inheriting execution access.

The two trigger functions remained installed and operational after function privilege hardening.

### 6.4 Table privilege hardening

The initial privilege audit identified unnecessarily broad table-level permissions for `anon` and `authenticated`.

A corrective migration was prepared to:

- Revoke all existing table privileges from `anon` and `authenticated`.
- Grant only the table operations required by the application's RLS policies.
- Restrict profile updates to the `full_name` and `phone` columns.
- Remove direct table-level update access to `profiles.role`.
- Revoke unnecessary `REFERENCES`, `TRIGGER`, and `TRUNCATE` privileges.
- Restrict default privileges for future tables created by the `postgres` role.

The final local permission verification confirmed:

- `anon` has no table-level privileges on the eight application tables.
- `authenticated` has only the intended table-level operations.
- Neither role has unnecessary `REFERENCES`, `TRIGGER`, `TRUNCATE`, or `MAINTAIN` privileges.
- Authenticated users cannot update `profiles.role`.
- Authenticated users can update `profiles.full_name` and `profiles.phone`.
- Anonymous users cannot read or update profiles.

The sequence permission audit returned no rows for `anon` and `authenticated` in the public schema. No public-schema sequences requiring direct grants were present.

### 6.5 Role regression checks

After the local permission-hardening migration was validated, the hosted application was regression-tested.

Verified operations included:

- Customer authentication, restaurant discovery, menu loading, and order history.
- Restaurant-owner authentication, order retrieval, and status updates.
- Rider authentication and available-delivery retrieval.
- Rider order acceptance.
- Rider pickup and delivery completion.

**Result:** PASS for the tested hosted application workflows.

This is a focused RLS and authorization review, not a complete penetration test.

## 7. Cross-Role Order Visibility and Refresh Testing

**Objective:** Verify that order information and status changes can be retrieved by the relevant application roles as the order progresses through its lifecycle.

### End-to-end scenario

1. Customer places an order.
2. Restaurant owner retrieves the order.
3. Restaurant owner accepts and prepares the order.
4. Customer retrieves the updated order status.
5. Restaurant owner marks the order ready for pickup.
6. Rider retrieves the available delivery.
7. Rider accepts the order.
8. Customer retrieves the updated assignment status.

**Observed result:**

Cross-role order visibility was successfully verified through database queries and dashboard data refreshes.

The relevant order records and statuses were visible to the appropriate roles when their dashboards retrieved the latest database state.

### Realtime implementation status

The database contains a `supabase_realtime` publication. However, inspection of `pg_publication_tables` returned no registered tables.

Frontend source inspection also found no `postgres_changes` or Supabase Broadcast subscriptions for order updates.

The current dashboards use:

- Initial data fetching.
- Explicit manual refresh actions.
- Additional data-fetching calls after relevant successful operations.

Therefore, the observed cross-role workflow is a functional order-visibility test, **not a verified PostgreSQL Realtime subscription test**.

Supabase Realtime integration remains a potential future enhancement.

## 8. Error Handling and Network Resilience

The rider acceptance workflow includes timeout handling, transient-error detection, retries, and idempotency-key reuse.

However, a conclusive runtime test involving a real network interruption during order acceptance was not established.

| Test case | Result |
|---|---|
| Timeout handling implemented | Implemented |
| Transient error detection implemented | Implemented |
| Retry with same idempotency key | Implemented |
| Successful idempotent retry | PASS |
| Actual offline/network interruption recovery | INCONCLUSIVE |

The application should therefore not claim that all network-failure scenarios have been runtime-verified.

## 9. Frontend Quality Checks

The following commands were executed after the rider dashboard cleanup and database permission-hardening work.

### ESLint

```powershell
npm run lint
```

**Result:** PASS

No ESLint errors were reported.

### Production build

```powershell
npm run build
```

**Result:** PASS

The latest build completed successfully:

```text
vite v8.3.8 building client environment for production...
✓ 65 modules transformed.
dist/index.html                   0.47 kB
dist/assets/index-BaKegckA.css    7.96 kB
dist/assets/index-CmEUEZpE.js   448.48 kB
✓ built in 163ms
```

TypeScript compilation and Vite production bundling both completed successfully.

## 10. Database Migration Validation

The existing Supabase schema was exported into `supabase/schema.sql`.

The exported schema contains the application's tables, functions, triggers, indexes, constraints, RLS policies, and grants.

Two migration files were prepared:

| Migration | Purpose |
|---|---|
| `20261119000000_initial_schema.sql` | Initial exported schema |
| `20261119000100_harden_default_privileges.sql` | Function execution hardening, least-privilege grants for existing tables, profile column restrictions, and default privilege hardening |

The initial schema migration was verified against the original export using SHA256 hashes.

### Local clean-environment validation

A local Supabase stack was started using Docker and Supabase CLI.

The following command was executed successfully:

```powershell
npx supabase db reset
```

Both migrations were applied successfully to the recreated local database.

The following checks were performed:

| Validation | Result |
|---|---|
| Eight application tables created | PASS |
| RLS enabled on all eight tables | PASS |
| Seven public application/trigger functions created | PASS |
| Critical function execution permissions | PASS |
| Two database triggers installed and enabled | PASS |
| Twenty RLS policies created | PASS |
| Excessive table privileges revoked | PASS |
| Profile column-level update restrictions | PASS |
| Sequence privilege inspection | PASS — no public-schema sequences requiring direct grants |

The migration reset and validation were performed against the local Docker database, not the hosted Supabase project.

**Migration status:** Both migration files were successfully applied and validated in a clean local Supabase environment. They have not been applied to the hosted database through this migration workflow.

## 11. Final Verification Summary

| Testing area | Result |
|---|---|
| Authentication and role routing | PASS |
| Customer workflows | PASS |
| Restaurant owner workflows | PASS |
| Rider workflows | PASS |
| Concurrent rider assignment | PASS |
| Idempotency verification | PASS |
| RLS and authorization review | PASS for reviewed checks |
| Function execution privilege hardening | PASS |
| Table privilege hardening | PASS |
| Profile column restrictions | PASS |
| Local clean migration reset | PASS |
| Hosted application regression | PASS for tested workflows |
| Cross-role order visibility | PASS |
| PostgreSQL Realtime subscriptions | NOT IMPLEMENTED |
| Network interruption recovery | INCONCLUSIVE |
| ESLint | PASS |
| TypeScript and production build | PASS |
| Migration application to clean local database | PASS |
| Migration application to hosted database | NOT PERFORMED |

## 12. Known Testing Limitations

1. The network interruption recovery scenario has not been conclusively verified at runtime.
2. Idempotency retry keys are held in component memory and are not persisted across page reloads.
3. Testing was performed with a limited set of test accounts and sample orders.
4. No formal load, stress, or high-concurrency performance benchmark was performed.
5. The security review was focused on RLS, database function permissions, role restrictions, and application workflows. It was not a comprehensive penetration test.
6. PostgreSQL Realtime subscriptions for order updates have not been implemented in the frontend.
7. The prepared database migrations have been validated against a clean local Supabase environment but have not been applied to the hosted Supabase project through this workflow.
8. A new customer order was not created during the latest post-hardening hosted regression round; order placement had been verified in earlier functional testing.

## 13. Conclusion

The main customer, restaurant-owner, and rider workflows were successfully exercised against the hosted Supabase environment.

The implementation also passed the tested concurrency and idempotency scenarios, the reviewed database permission-hardening checks, and the frontend lint and production-build checks.

Both database migrations were successfully applied to a clean local Supabase environment. The validation confirmed the expected schema, RLS policies, database functions, triggers, and least-privilege permissions.

Cross-role order visibility was verified using database queries and dashboard refreshes. Native PostgreSQL Realtime subscription behaviour has not been implemented or verified.

The remaining limitations are documented above so that the verification results accurately reflect the scope of testing performed.
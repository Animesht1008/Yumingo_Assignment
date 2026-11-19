# Yumingo — Testing and Verification

## 1. Overview

This document describes the testing and verification performed for the Yumingo food ordering and delivery application.

Testing focused on:

- Authentication and role-based access.
- Customer order placement.
- Restaurant order management.
- Rider order acceptance and delivery progression.
- Concurrent order assignment.
- Idempotency and duplicate-request protection.
- Row Level Security (RLS).
- Realtime updates across application roles.
- Frontend linting and production builds.

The tests were performed against an actual Supabase environment, using separate customer, restaurant-owner, and rider accounts.

## 2. Test Environment

| Component | Configuration |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Authorization | PostgreSQL RLS |
| Browser | Microsoft Edge |
| Runtime | Node.js v20.20.0 |
| Package manager | npm 11.8.0 |

### Test accounts

Separate test identities were used to verify role-specific access:

| Role | Test account |
|---|---|
| Customer | customer@example.com |
| Restaurant Owner | restaurant@example.com |
| Rider 1 | animesh.rider@example.com |
| Rider 2 | rider2@test.com |

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
| Place order | Order is created through `place_order` RPC | PASS |
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

The database was queried after completion to verify the final order status, rider assignment, assignment status, and completion timestamp.

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

<badge color="success">PASS</badge>

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

<badge color="success">PASS</badge>

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

The following functions were reviewed:

- `place_order`
- `accept_order`
- `update_delivery_status`
- `get_my_role`
- `owns_restaurant`

Execution permissions were verified for authenticated users and checked to ensure anonymous users did not have execution access to these functions.

### 6.4 Privilege hardening

Unnecessary `TRUNCATE` and `TRIGGER` table privileges were revoked from the `anon` and `authenticated` roles.

A follow-up verification query returned no remaining grants for these privileges on the application tables.

Existing database triggers remained installed and operational.

### 6.5 Role regression checks

After the permission changes, customer, restaurant-owner, and rider workflows were tested again.

Verified operations included:

- Customer dashboard loading and menu visibility.
- Restaurant order retrieval and status updates.
- Rider order acceptance.
- Rider pickup and delivery completion.

**Result:** PASS for the tested application workflows after privilege hardening.

This is a focused RLS and authorization review, not a complete penetration test.

## 7. Realtime Testing

**Objective:** Verify that relevant order changes become visible across application roles without requiring manual page refreshes.

### End-to-end scenario

1. Customer places an order.
2. Restaurant dashboard receives and displays the new order.
3. Restaurant accepts and prepares the order.
4. Customer dashboard reflects the updated status.
5. Restaurant marks the order ready for pickup.
6. Rider dashboard displays the available delivery.
7. Rider accepts the order.
8. Customer dashboard reflects the assignment.

**Observed result:**

<badge color="success">PASS</badge>

The cross-role workflow was observed successfully. New orders and subsequent status changes became visible in the relevant dashboards without manual refresh.

This documents the observed application behaviour; it does not establish a load or scalability benchmark for Realtime.

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

The following commands were executed after the rider dashboard cleanup.

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

The build completed successfully:

```text
vite v8.3.8 building client environment for production...
✓ 65 modules transformed.
✓ built in 262ms
```

TypeScript compilation and Vite production bundling both completed successfully.

## 10. Final Verification Summary

| Testing area | Result |
|---|---|
| Authentication and role routing | PASS |
| Customer workflows | PASS |
| Restaurant owner workflows | PASS |
| Rider workflows | PASS |
| Concurrent rider assignment | PASS |
| Idempotency verification | PASS |
| RLS and authorization review | PASS for reviewed checks |
| Privilege hardening regression | PASS |
| Realtime cross-role workflow | PASS |
| Network interruption recovery | INCONCLUSIVE |
| ESLint | PASS |
| TypeScript and production build | PASS |

## 11. Known Testing Limitations

1. The network interruption recovery scenario has not been conclusively verified at runtime.
2. Idempotency retry keys are held in component memory and are not persisted across page reloads.
3. Testing was performed with a limited set of test accounts and sample orders.
4. No formal load, stress, or high-concurrency performance benchmark was performed.
5. The security review was focused on RLS, database function permissions, role restrictions, and application workflows. It was not a comprehensive penetration test.

## 12. Conclusion

The main customer, restaurant-owner, and rider workflows were successfully exercised against the Supabase environment.

The implementation also passed the tested concurrency and idempotency scenarios, the reviewed database permission-hardening regression checks, and the frontend lint and production-build checks.

The remaining limitations are documented above so that the verification results accurately reflect the scope of testing performed.
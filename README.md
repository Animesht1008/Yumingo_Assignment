# Yumingo — Food Ordering & Delivery Platform

Yumingo is a role-based food ordering and delivery application built with React, TypeScript, and Supabase.

The platform connects customers, restaurant owners, and delivery riders through a shared ordering workflow. It uses PostgreSQL transactions, Row Level Security (RLS), and database functions to enforce business rules and protect critical operations.

## Features

### Customer Application
- Browse currently open restaurants.
- View available restaurant menu items and prices.
- Add items to a shopping cart.
- Increase or decrease item quantities.
- Place orders securely through a PostgreSQL RPC.
- View order history and current order status.

### Restaurant Owner Dashboard
- Access restaurant-specific orders.
- View incoming customer orders.
- Accept orders.
- Update preparation status.
- Mark orders ready for pickup.
- View dashboard order summaries.

### Rider Dashboard
- View available pickup requests.
- Accept delivery requests.
- View assigned deliveries.
- Mark orders as picked up.
- Mark deliveries as completed.
- Handle transient acceptance failures with timeouts and retries.

## Technology Stack

| Category | Technology |
|---|---|
| Frontend | React 19 |
| Language | TypeScript |
| Build Tool | Vite |
| Backend | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Authorization | Row Level Security (RLS) |
| Database Operations | Supabase JavaScript Client and PostgreSQL RPCs |
| Package Manager | npm |
| Deployment Target | Vercel |

## Architecture

Yumingo follows a frontend-to-Supabase architecture.

```text
                 React Application
                        |
                  Supabase Auth
                        |
                  Role Verification
                        |
          +-------------+-------------+
          |             |             |
       Customer      Restaurant      Rider
      Dashboard      Dashboard     Dashboard
          |             |             |
          +-------------+-------------+
                        |
                  Supabase Client
                        |
                  Supabase Platform
                        |
              +---------+---------+
              |         |         |
             Auth   PostgreSQL   Storage
                        |
                   RLS Policies
                        |
                   Database RPCs
                        |
                 Business Operations
```

### Application Roles

| Role | Responsibilities |
|---|---|
| Customer | Discover restaurants, place orders, track deliveries |
| Restaurant Owner | Manage incoming orders and preparation status |
| Rider | Accept deliveries and update delivery progress |

### Order Lifecycle

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

Database triggers validate permitted order-status transitions.

## Database Design

The application uses the following primary PostgreSQL tables:

| Table | Purpose |
|---|---|
| `profiles` | User profiles and application roles |
| `restaurants` | Restaurant details and ownership |
| `riders` | Rider-specific information |
| `menu_items` | Restaurant menu and pricing |
| `orders` | Order records and lifecycle status |
| `order_items` | Items belonging to each order |
| `order_assignments` | Rider assignment and idempotency records |
| `order_delivery_details` | Delivery-related information |

Prices are stored as integer cents/paise to avoid floating-point precision issues.

### Database Files

The repository includes:

- `supabase/schema.sql` — exported database schema.
- `supabase/migrations/20261119000000_initial_schema.sql` — initial schema migration.
- `supabase/migrations/20261119000100_harden_default_privileges.sql` — database function and table privilege hardening.

The initial migration is based on the exported schema and was verified against it using SHA256 hashes.

Both migrations have been successfully applied and validated against a clean local Supabase environment.

## Reliability and Security

### Atomic Order Assignment

The `accept_order` PostgreSQL function handles rider assignment transactionally.

It includes:
- Authentication and rider-role validation.
- Transaction-level advisory locking.
- Idempotency-key validation.
- Atomic order claiming.
- Protection against duplicate active assignments.

### Idempotent Requests

Order acceptance uses a unique idempotency key for retry handling.

If the same request is repeated with the same key, the database can return the existing assignment instead of creating another one.

### Secure Order Creation

The `place_order` function:
- Validates the authenticated customer.
- Checks restaurant availability.
- Validates menu items and quantities.
- Calculates the authoritative order total on the database side.
- Creates the order and its order items.

### Database Authorization

- RLS is enabled on all eight application tables.
- Database policies restrict access according to user roles and order participation.
- A database trigger prevents authenticated users from escalating their profile role.
- Application RPC execution permissions are restricted to authenticated users.
- Table privileges follow a least-privilege approach.
- Profile updates are restricted to permitted columns.
- The frontend uses the Supabase publishable key, never a service-role key.

### Order Updates

The application currently retrieves order updates through:
- Initial data fetching.
- Manual dashboard refresh.
- Additional data-fetching calls after successful operations.

PostgreSQL Realtime subscriptions are not currently implemented in the frontend.

## Project Structure

```text
Assignment_Yumingo_Self/
│
├── public/
│
├── src/
│   ├── components/
│   │   ├── AppHeader.tsx
│   │   ├── CustomerDashboard.tsx
│   │   ├── OrderCard.tsx
│   │   ├── RiderDashboard.tsx
│   │   └── SummaryCard.tsx
│   │
│   ├── lib/
│   │   └── supabase.ts
│   │
│   ├── types/
│   │   ├── databaseOrder.ts
│   │   └── order.ts
│   │
│   ├── App.tsx
│   ├── App.css
│   ├── index.css
│   └── main.tsx
│
├── database/
│   └── accept_order_backup.sql
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── TESTING.md
│   └── DEPLOYMENT.md
│
├── supabase/
│   ├── migrations/
│   │   ├── 20261119000000_initial_schema.sql
│   │   └── 20261119000100_harden_default_privileges.sql
│   ├── .gitignore
│   ├── config.toml
│   └── schema.sql
│
├── .env
├── .gitignore
├── index.html
├── package.json
├── package-lock.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 20 or later.
- npm.
- Git.
- A configured Supabase project.

For local database development:
- Docker Desktop.
- Supabase CLI.

### 1. Clone the repository

```bash
git clone https://github.com/Animesht1008/Yumingo_Assignment.git
cd Yumingo_Assignment
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Replace the placeholders with your Supabase project credentials.

Never commit `.env` or expose a Supabase service-role key in frontend code.

### 4. Configure Supabase

For an existing hosted Supabase project, ensure that the required application tables, RLS policies, database triggers, indexes, RPC functions, and authentication configuration are present.

For local database development, initialize and start the local Supabase environment:

```bash
npx supabase start
```

Apply the version-controlled migrations to the local database:

```bash
npx supabase db reset
```

This recreates the local database and applies the migration files. It removes existing local database data.

**Important:** These commands should be used with the local Supabase environment. Do not use database reset commands against a hosted project.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/TESTING.md](docs/TESTING.md) for additional details.

### 5. Start the development server

```bash
npm run dev
```

Vite will display the local development URL in the terminal, usually:

```text
http://localhost:5173
```

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the development server |
| `npm run lint` | Run ESLint |
| `npm run build` | Compile TypeScript and build the production application |
| `npm run preview` | Preview the production build locally |

## Testing

The application has been tested against both local and hosted Supabase environments.

Verified areas include:

- Customer, restaurant-owner, and rider authentication.
- Restaurant discovery and menu loading.
- Customer order creation and price calculation.
- Restaurant order-status progression.
- Rider order acceptance and delivery completion.
- Concurrent rider assignment.
- Idempotent order-acceptance retries.
- RLS and database privilege checks.
- Clean local database migration validation.
- Hosted application regression testing.
- ESLint and production build.

Run the frontend checks:

```bash
npm run lint
npm run build
```

For detailed test scenarios and results, see [docs/TESTING.md](docs/TESTING.md).

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | System architecture, components, database design, and security |
| [Testing](docs/TESTING.md) | Functional, concurrency, idempotency, security, migration, and build verification |
| [Deployment](docs/DEPLOYMENT.md) | Supabase configuration and Vercel deployment instructions |

## Known Limitations

- Idempotency keys are currently held in frontend memory and do not survive page reloads.
- Runtime verification of actual network-interruption recovery remains inconclusive.
- PostgreSQL Realtime subscriptions are not implemented in the frontend.
- Formal load and stress testing has not been performed.
- Production Vercel deployment and its final verification remain pending.
- Database migrations have been validated locally but have not been applied to the hosted Supabase project through this migration workflow.

These limitations are documented to distinguish verified functionality from future improvements.

## Future Improvements

- Persist idempotency keys across browser reloads.
- Add automated integration and end-to-end tests.
- Introduce load and stress testing.
- Implement PostgreSQL Realtime subscriptions for order updates.
- Improve production monitoring and observability.
- Complete production deployment and verification.

## License

This project was developed as a software engineering assignment. Add an explicit license if the repository is intended for public reuse.
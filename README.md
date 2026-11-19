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
| Realtime | Supabase Realtime |
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
          +--------------+--------------+
          |              |              |
       Customer       Restaurant       Rider
      Dashboard        Dashboard     Dashboard
          |              |              |
          +--------------+--------------+
                         |
                   Supabase Client
                         |
                   Supabase Platform
                         |
             +-----------+-----------+
             |           |           |
          Auth       PostgreSQL   Realtime
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
- Sensitive database functions use controlled execution settings and restricted grants.
- The frontend uses the Supabase publishable key, never a service-role key.

### Realtime Updates

Order changes are reflected across relevant application dashboards. The tested workflow includes customer order creation, restaurant status updates, and rider assignment.

## Project Structure

```text
Assignment_Yumingo_Self/
│
├── public/
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
- A configured Supabase project.
- Git.

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd Assignment_Yumingo_Self
```

Replace the placeholder with your actual GitHub repository URL.

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

Before running the application, ensure that your Supabase project has:

- Required application tables and relationships.
- Configured RLS policies.
- Required database triggers and indexes.
- Required PostgreSQL RPC functions.
- Authentication enabled.
- Appropriate Realtime configuration.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system design.

**Note:** The current repository contains an `accept_order` SQL backup, not a complete set of database migrations. A fresh Supabase project requires the remaining database objects to be provisioned separately.

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

The application has been tested against an actual Supabase environment.

Verified areas include:

- Customer, restaurant-owner, and rider authentication.
- Restaurant discovery and menu loading.
- Customer order creation and price calculation.
- Restaurant order-status progression.
- Rider order acceptance and delivery completion.
- Concurrent rider assignment.
- Idempotent order-acceptance retries.
- RLS and database privilege checks.
- Cross-role Realtime updates.
- ESLint and production build.

Run the frontend checks:

```bash
npm run lint
npm run build
```

For detailed test scenarios and results, see [`docs/TESTING.md`](docs/TESTING.md).

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | System architecture, components, database design, and security |
| [Testing](docs/TESTING.md) | Functional, concurrency, idempotency, security, and build verification |
| [Deployment](docs/DEPLOYMENT.md) | Supabase configuration and Vercel deployment instructions |

## Known Limitations

- Idempotency keys are currently held in frontend memory and do not survive page reloads.
- Runtime verification of actual network-interruption recovery remains inconclusive.
- The repository does not yet contain a complete version-controlled database migration history.
- Formal load and stress testing has not been performed.

These limitations are documented to distinguish verified functionality from future improvements.

## Future Improvements

- Persist idempotency keys across browser reloads.
- Add complete database migration and seed scripts.
- Add automated integration and end-to-end tests.
- Introduce load and stress testing.
- Improve production monitoring and observability.
- Complete production deployment and verification.

## License

This project was developed as a software engineering assignment. Add an explicit license if the repository is intended for public reuse.
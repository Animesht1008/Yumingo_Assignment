# Yumingo — Deployment Guide

## 1. Overview

Yumingo uses a separately hosted frontend and backend architecture.

| Component | Platform |
|---|---|
| Frontend | Vercel |
| Backend services | Supabase |
| Database | Supabase PostgreSQL |
| Authentication | Supabase Auth |
| Realtime | Supabase Realtime |
| Frontend framework | React + TypeScript + Vite |

The frontend communicates directly with Supabase through the Supabase JavaScript client.

## 2. Prerequisites

Before deployment, ensure that you have:

- A working Yumingo project.
- A Supabase project with the required database schema and functions.
- Configured RLS policies and database triggers.
- A GitHub repository containing the application.
- A Vercel account connected to GitHub.
- Node.js and npm installed locally.

## 3. Supabase Configuration

### 3.1 Project credentials

Open your Supabase project dashboard.

Navigate to:

**Project Settings → API**

Retrieve:

- Project URL.
- Publishable API key.

These values are required by the frontend.

### 3.2 Database readiness

Before deploying the frontend, verify that the Supabase project contains:

- Application tables.
- Required relationships and foreign keys.
- PostgreSQL functions:
  - `place_order`
  - `accept_order`
  - `update_delivery_status`
  - `get_my_role`
  - `owns_restaurant`
- RLS policies.
- Order-status validation triggers.
- Assignment uniqueness constraints and indexes.
- Required Realtime publication configuration.

The database should be configured and tested before connecting the production frontend.

### 3.3 Authentication

Verify that:

- Email/password authentication is enabled.
- Test accounts can authenticate.
- User profiles have the correct application roles.
- Rider accounts have corresponding rider records.
- Restaurant owners have corresponding restaurant ownership records.

For production, configure the appropriate authentication redirect URLs and site URL.

## 4. Environment Variables

The frontend requires two environment variables.

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable API key |

### Local development

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Replace the placeholder values with your actual Supabase project credentials.

### Production environment

In Vercel:

1. Open the deployed project.
2. Navigate to **Settings → Environment Variables**.
3. Add `VITE_SUPABASE_URL`.
4. Add `VITE_SUPABASE_PUBLISHABLE_KEY`.
5. Select the appropriate deployment environments.
6. Save the variables.
7. Redeploy the application so the build uses the updated configuration.

**Security requirement:** Never add a Supabase service-role key to frontend environment variables or browser code. The frontend must use only the publishable key, with database access controlled by RLS and database functions.

Also ensure that `.env` is included in `.gitignore`.

## 5. Local Production Build

Before deployment, execute:

```powershell
npm install
npm run lint
npm run build
```

Expected result:

- Dependencies install successfully.
- ESLint reports no errors.
- TypeScript compilation succeeds.
- Vite generates the production bundle in `dist/`.

To preview the production build locally:

```powershell
npm run preview
```

## 6. GitHub Repository

Push the completed project to GitHub.

Example commands:

```powershell
git add .
git commit -m "Prepare Yumingo application for deployment"
git push origin main
```

Before pushing, verify that:

- `.env` is not tracked.
- No service-role credentials are committed.
- The README and documentation are included.
- Temporary test-only frontend code has been removed.

## 7. Vercel Deployment

### 7.1 Import the repository

1. Sign in to Vercel.
2. Select **Add New → Project**.
3. Import the Yumingo GitHub repository.
4. Configure the build settings.

### 7.2 Build configuration

Use the following settings:

| Setting | Value |
|---|---|
| Framework Preset | Vite |
| Root Directory | `./` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

If Vercel detects the Vite configuration automatically, verify that the generated settings match these values.

### 7.3 Configure environment variables

Add the two Supabase environment variables described in Section 4.

Then deploy the project.

Vercel will install dependencies, execute the production build, and publish the generated frontend assets.

## 8. Production Verification

After deployment, open the Vercel production URL.

Verify the following workflows.

### Customer

- Customer login succeeds.
- Open restaurants are displayed.
- Available menu items load.
- Items can be added to the cart.
- Orders can be placed.
- Order history displays correctly.
- Order status updates appear.

### Restaurant Owner

- Restaurant owner login succeeds.
- The correct restaurant is loaded.
- Incoming orders are displayed.
- Orders can be accepted.
- Preparation status can be updated.
- Orders can be marked ready for pickup.

### Rider

- Rider login succeeds.
- Available deliveries are displayed.
- Orders can be accepted.
- Assigned deliveries appear in active deliveries.
- Pickup status can be updated.
- Delivery completion works.

### Backend and security

- Supabase authentication works from the production domain.
- Database operations succeed.
- RLS policies remain enforced.
- RPC operations work for authenticated users.
- Realtime updates work across relevant dashboards.
- No privileged service-role credentials are exposed to the browser.

## 9. Continuous Deployment

When GitHub is connected to Vercel, subsequent pushes to the configured production branch can trigger new deployments.

Recommended workflow:

1. Make code changes locally.
2. Run lint and production build checks.
3. Commit and push changes.
4. Review the Vercel deployment status.
5. Verify the production application after deployment.

## 10. Troubleshooting

### Missing Supabase environment variables

**Symptoms:** The frontend cannot connect to Supabase.

**Checks:**

- Verify the variable names.
- Verify that the values are correct.
- Confirm that variables are configured for the relevant Vercel environment.
- Redeploy after changing environment variables.

### Authentication redirect problems

**Symptoms:** Login succeeds but redirects fail.

**Checks:**

- Verify the Supabase Site URL.
- Verify the allowed redirect URLs.
- Confirm that the production domain is configured.

### Database permission errors

**Symptoms:** Queries or RPC calls fail in production.

**Checks:**

- Verify the user's authenticated session.
- Inspect the relevant RLS policy.
- Confirm the RPC execution grants.
- Check database function parameters and return types.

### Realtime updates are not appearing

**Checks:**

- Verify the required tables are included in the Realtime publication.
- Confirm that the frontend subscription is configured correctly.
- Check browser console and Supabase logs.
- Verify that RLS permits the relevant user to receive the data.

## 11. Deployment Status

The deployment procedure described in this document is the intended production deployment workflow.

The Vercel production deployment and production-domain verification should be marked complete only after the application has actually been deployed and the production checks have passed.

## Production Deployment Record

### Deployment Details

| Item | Value |
|---|---|
| Frontend hosting | Vercel |
| Vercel project | `yumingo-assignment` |
| Production URL | https://yumingo-assignment.vercel.app/ |
| Source repository | https://github.com/Animesht1008/Yumingo_Assignment |
| Production branch | `main` |
| Backend | Hosted Supabase project |

### Environment Variables

The following variables are configured in Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The frontend uses the Supabase publishable key. No service-role key is exposed to the browser.

### Production Verification

The deployed application was opened and manually tested against the hosted Supabase environment.

Verified workflows:

- Customer authentication and dashboard loading.
- Restaurant discovery and menu retrieval.
- Customer order history and order-status display.
- Restaurant-owner authentication and dashboard loading.
- Restaurant order listing and status display.
- Rider authentication and dashboard loading.
- Active and available delivery listings.
- Rider pickup and delivery-status actions.

The three application roles were successfully exercised on the production deployment.

### Database Migration Note

The version-controlled database migrations were validated against the local Supabase Docker environment. They were not applied to the hosted production database as part of this deployment process. The hosted database was separately used for application regression testing.

### Deployment Status

The Vercel production deployment is live and the customer, restaurant-owner, and rider application workflows have been manually verified.

**Production URL:** https://yumingo-assignment.vercel.app/
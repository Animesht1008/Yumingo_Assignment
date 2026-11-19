
-- ============================================================
-- 1. Function execution privileges
-- ============================================================

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.accept_order(uuid, uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_role()
TO authenticated;

GRANT EXECUTE ON FUNCTION public.owns_restaurant(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.update_delivery_status(uuid, public.order_status)
TO authenticated;


-- ============================================================
-- 2. Remove excessive privileges from existing tables
-- ============================================================

REVOKE ALL PRIVILEGES
ON ALL TABLES IN SCHEMA public
FROM anon, authenticated;


-- ============================================================
-- 3. Grant only the operations required by RLS policies
-- ============================================================

-- Menu items: owners manage their own menu.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.menu_items TO authenticated;

-- Assignments: participants can read; writes use accept_order().
GRANT SELECT
ON TABLE public.order_assignments TO authenticated;

-- Delivery details: participants read; customers insert.
GRANT SELECT, INSERT
ON TABLE public.order_delivery_details TO authenticated;

-- Order items: participants read; creation uses place_order().
GRANT SELECT
ON TABLE public.order_items TO authenticated;

-- Orders: customers create, participants read, owners update.
GRANT SELECT, INSERT, UPDATE
ON TABLE public.orders TO authenticated;

-- Profiles: users read their own profile.
GRANT SELECT
ON TABLE public.profiles TO authenticated;

-- Restrict profile updates to these two columns only.
GRANT UPDATE (full_name, phone)
ON TABLE public.profiles TO authenticated;

-- Restaurants: authenticated users discover; owners create/update.
GRANT SELECT, INSERT, UPDATE
ON TABLE public.restaurants TO authenticated;

-- Riders: riders create, read and update their own profile.
GRANT SELECT, INSERT, UPDATE
ON TABLE public.riders TO authenticated;


-- ============================================================
-- 4. Harden default privileges for future tables
-- ============================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE ALL ON TABLES FROM anon, authenticated;

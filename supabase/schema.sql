


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."assignment_status" AS ENUM (
    'active',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."assignment_status" OWNER TO "postgres";


CREATE TYPE "public"."order_status" AS ENUM (
    'placed',
    'accepted',
    'preparing',
    'ready_for_pickup',
    'assigned',
    'picked_up',
    'delivered',
    'rejected',
    'cancelled'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'customer',
    'restaurant_owner',
    'rider'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_order"("p_order_id" "uuid", "p_idempotency_key" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

DECLARE
    -- The currently authenticated user's ID.
    v_rider_id uuid := auth.uid();

    -- Used to detect a previous request with the same key.
    v_existing_assignment_id uuid;
    v_existing_order_id uuid;

    -- Stores the newly created assignment ID.
    v_assignment_id uuid;

    -- Confirms that the order was successfully claimed.
    v_updated_order_id uuid;

BEGIN

    -- -----------------------------------------------------
    -- 1. VALIDATE AUTHENTICATION
    -- -----------------------------------------------------

    IF v_rider_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required'
            USING ERRCODE = '28000';
    END IF;


    -- -----------------------------------------------------
    -- 2. VALIDATE INPUT PARAMETERS
    -- -----------------------------------------------------

    IF p_order_id IS NULL OR p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Order ID and idempotency key are required'
            USING ERRCODE = '22023';
    END IF;


    -- -----------------------------------------------------
    -- 3. VERIFY THAT THE USER IS A REGISTERED RIDER
    -- -----------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = v_rider_id
          AND role = 'rider'::public.user_role
    ) THEN
        RAISE EXCEPTION 'Only registered riders can accept orders'
            USING ERRCODE = '42501';
    END IF;

    -- Also verify that a corresponding riders record exists.
    IF NOT EXISTS (
        SELECT 1
        FROM public.riders
        WHERE id = v_rider_id
    ) THEN
        RAISE EXCEPTION 'Rider profile not found'
            USING ERRCODE = '42501';
    END IF;


    -- -----------------------------------------------------
    -- 4. SERIALIZE RETRIES USING A TRANSACTION-LEVEL LOCK
    -- -----------------------------------------------------

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            v_rider_id::text || ':' || p_idempotency_key::text,
            0
        )
    );


    -- -----------------------------------------------------
    -- 5. CHECK WHETHER THIS REQUEST WAS ALREADY PROCESSED
    -- -----------------------------------------------------

    SELECT id, order_id
    INTO v_existing_assignment_id, v_existing_order_id
    FROM public.order_assignments
    WHERE rider_id = v_rider_id
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN

        -- Prevent reusing the same key for another order.
        IF v_existing_order_id <> p_order_id THEN
            RAISE EXCEPTION 'Idempotency key already used for another order'
                USING ERRCODE = '22023';
        END IF;

        -- Return the original assignment ID.
        RETURN v_existing_assignment_id;

    END IF;


    -- -----------------------------------------------------
    -- 6. ATOMICALLY CLAIM THE ORDER
    -- -----------------------------------------------------

    UPDATE public.orders
    SET
        rider_id = v_rider_id,
        status = 'assigned'::public.order_status,
        updated_at = pg_catalog.now()
    WHERE id = p_order_id
      AND status = 'ready_for_pickup'::public.order_status
      AND rider_id IS NULL
    RETURNING id INTO v_updated_order_id;

    -- No matching row means another rider already claimed it,
    -- or the order is not ready for pickup.
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order is unavailable'
            USING ERRCODE = 'P0001';
    END IF;


    -- -----------------------------------------------------
    -- 7. CREATE THE ASSIGNMENT RECORD
    -- -----------------------------------------------------

    INSERT INTO public.order_assignments (
        order_id,
        rider_id,
        status,
        idempotency_key
    )
    VALUES (
        p_order_id,
        v_rider_id,
        'active'::public.assignment_status,
        p_idempotency_key
    )
    RETURNING id INTO v_assignment_id;


    -- -----------------------------------------------------
    -- 8. RETURN THE NEW ASSIGNMENT ID
    -- -----------------------------------------------------

    RETURN v_assignment_id;

END;

$$;


ALTER FUNCTION "public"."accept_order"("p_order_id" "uuid", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT p.role
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid());
$$;


ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."owns_restaurant"("restaurant_uuid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.restaurants AS r
        WHERE r.id = restaurant_uuid
          AND r.owner_id = (SELECT auth.uid())
    );
$$;


ALTER FUNCTION "public"."owns_restaurant"("restaurant_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_order"("p_restaurant_id" "uuid", "p_items" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
    v_customer_id uuid;
    v_order_id uuid;
    v_item jsonb;
    v_menu_item record;
    v_quantity integer;
    v_total_cents bigint := 0;
BEGIN
    -- Require an authenticated customer.
    v_customer_id := auth.uid();

    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = v_customer_id
          AND role = 'customer'
    ) THEN
        RAISE EXCEPTION 'Only customers can place orders';
    END IF;

    -- Validate the restaurant.
    IF NOT EXISTS (
        SELECT 1
        FROM public.restaurants
        WHERE id = p_restaurant_id
          AND is_open = true
    ) THEN
        RAISE EXCEPTION 'Restaurant is unavailable';
    END IF;

    -- Validate JSON input.
    IF p_items IS NULL
       OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order must contain at least one item';
    END IF;

    -- PASS 1: Validate items and calculate the total.
    -- Lock menu rows so their prices cannot change during this transaction.
    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_items)
    LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
           OR jsonb_typeof(v_item->'menu_item_id') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_item->'quantity') IS DISTINCT FROM 'number'
           OR (v_item->>'quantity') !~ '^[1-9][0-9]*$' THEN
            RAISE EXCEPTION 'Invalid order item';
        END IF;

        v_quantity := (v_item->>'quantity')::integer;

        IF v_quantity > 99 THEN
            RAISE EXCEPTION 'Maximum quantity per item is 99';
        END IF;

        SELECT
            id,
            name,
            price_cents
        INTO v_menu_item
        FROM public.menu_items
        WHERE id = (v_item->>'menu_item_id')::uuid
          AND restaurant_id = p_restaurant_id
          AND is_available = true
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Menu item is unavailable or invalid';
        END IF;

        v_total_cents :=
            v_total_cents
            + (v_menu_item.price_cents::bigint * v_quantity);
    END LOOP;

    -- Ensure the calculated total satisfies the order constraint.
    IF v_total_cents <= 0 THEN
        RAISE EXCEPTION 'Order total must be greater than zero';
    END IF;

    -- Create the order with its final calculated total.
    INSERT INTO public.orders (
        customer_id,
        restaurant_id,
        status,
        total_cents
    )
    VALUES (
        v_customer_id,
        p_restaurant_id,
        'placed',
        v_total_cents
    )
    RETURNING id INTO v_order_id;

    -- PASS 2: Insert order items.
    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_items)
    LOOP
        v_quantity := (v_item->>'quantity')::integer;

        SELECT
            id,
            name,
            price_cents
        INTO v_menu_item
        FROM public.menu_items
        WHERE id = (v_item->>'menu_item_id')::uuid
          AND restaurant_id = p_restaurant_id
          AND is_available = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Menu item became unavailable';
        END IF;

        INSERT INTO public.order_items (
            order_id,
            menu_item_id,
            item_name,
            unit_price_cents,
            quantity
        )
        VALUES (
            v_order_id,
            v_menu_item.id,
            v_menu_item.name,
            v_menu_item.price_cents,
            v_quantity
        );
    END LOOP;

    RETURN v_order_id;
END;
$_$;


ALTER FUNCTION "public"."place_order"("p_restaurant_id" "uuid", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_profile_role_escalation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
    IF auth.uid() IS NOT NULL
       AND NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'You are not allowed to change your account role.';
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_profile_role_escalation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_delivery_status"("p_order_id" "uuid", "p_new_status" "public"."order_status") RETURNS "public"."order_status"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_rider_id uuid;
    v_order_rider_id uuid;
    v_current_status public.order_status;
    v_expected_status public.order_status;
    v_assignment_status public.assignment_status;
BEGIN
    v_rider_id := auth.uid();

    IF v_rider_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = v_rider_id
          AND role = 'rider'
    ) THEN
        RAISE EXCEPTION 'Only riders can update delivery status';
    END IF;

    IF p_new_status NOT IN (
        'picked_up'::public.order_status,
        'delivered'::public.order_status
    ) THEN
        RAISE EXCEPTION 'Invalid rider status update';
    END IF;

    IF p_new_status = 'picked_up' THEN
        v_expected_status := 'assigned';
    ELSE
        v_expected_status := 'picked_up';
    END IF;

    SELECT status, rider_id
    INTO v_current_status, v_order_rider_id
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found';
    END IF;

    IF v_order_rider_id IS DISTINCT FROM v_rider_id THEN
        RAISE EXCEPTION 'You are not assigned to this order';
    END IF;

    -- Safe retry when the requested transition already succeeded.
    IF v_current_status = p_new_status THEN
        RETURN v_current_status;
    END IF;

    IF v_current_status IS DISTINCT FROM v_expected_status THEN
        RAISE EXCEPTION
            'Invalid delivery transition: % -> %',
            v_current_status,
            p_new_status;
    END IF;

    SELECT status
    INTO v_assignment_status
    FROM public.order_assignments
    WHERE order_id = p_order_id
      AND rider_id = v_rider_id
      AND status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active assignment found for this rider';
    END IF;

    UPDATE public.orders
    SET status = p_new_status
    WHERE id = p_order_id
      AND rider_id = v_rider_id
      AND status = v_expected_status;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order status could not be updated';
    END IF;

    IF p_new_status = 'delivered' THEN
        UPDATE public.order_assignments
        SET status = 'completed',
            completed_at = NOW()
        WHERE order_id = p_order_id
          AND rider_id = v_rider_id
          AND status = 'active';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unable to complete rider assignment';
        END IF;
    END IF;

    RETURN p_new_status;
END;
$$;


ALTER FUNCTION "public"."update_delivery_status"("p_order_id" "uuid", "p_new_status" "public"."order_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_order_status_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF NOT (
            (OLD.status = 'placed' AND NEW.status = 'accepted')
            OR
            (OLD.status = 'accepted' AND NEW.status = 'preparing')
            OR
            (OLD.status = 'preparing' AND NEW.status = 'ready_for_pickup')
            OR
            (
                OLD.status = 'ready_for_pickup'
                AND NEW.status = 'assigned'
                AND OLD.rider_id IS NULL
                AND NEW.rider_id IS NOT NULL
            )
            OR
            (
                OLD.status = 'assigned'
                AND NEW.status = 'picked_up'
                AND OLD.rider_id IS NOT NULL
                AND NEW.rider_id IS NOT NULL
                AND OLD.rider_id = NEW.rider_id
            )
            OR
            (
                OLD.status = 'picked_up'
                AND NEW.status = 'delivered'
                AND OLD.rider_id IS NOT NULL
                AND NEW.rider_id IS NOT NULL
                AND OLD.rider_id = NEW.rider_id
            )
        ) THEN
            RAISE EXCEPTION
                'Invalid order status transition: % -> %',
                OLD.status,
                NEW.status;
        END IF;
    END IF;

    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_order_status_transition"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."menu_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "price_cents" integer NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "menu_items_price_cents_check" CHECK (("price_cents" > 0))
);


ALTER TABLE "public"."menu_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "rider_id" "uuid" NOT NULL,
    "status" "public"."assignment_status" DEFAULT 'active'::"public"."assignment_status" NOT NULL,
    "idempotency_key" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."order_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_delivery_details" (
    "order_id" "uuid" NOT NULL,
    "recipient_name" "text" NOT NULL,
    "recipient_phone" "text" NOT NULL,
    "address_line" "text" NOT NULL,
    "city" "text" NOT NULL,
    "postal_code" "text" NOT NULL,
    "delivery_instructions" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_delivery_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "menu_item_id" "uuid",
    "item_name" "text" NOT NULL,
    "unit_price_cents" integer NOT NULL,
    "quantity" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "order_items_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "order_items_unit_price_cents_check" CHECK (("unit_price_cents" > 0))
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "rider_id" "uuid",
    "status" "public"."order_status" DEFAULT 'placed'::"public"."order_status" NOT NULL,
    "total_cents" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "orders_total_cents_check" CHECK (("total_cents" > 0))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "role" "public"."user_role" DEFAULT 'customer'::"public"."user_role" NOT NULL,
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text" NOT NULL,
    "is_open" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."restaurants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."riders" (
    "id" "uuid" NOT NULL,
    "vehicle_type" "text" NOT NULL,
    "is_online" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."riders" OWNER TO "postgres";


ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_assignments"
    ADD CONSTRAINT "order_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_delivery_details"
    ADD CONSTRAINT "order_delivery_details_pkey" PRIMARY KEY ("order_id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_owner_id_key" UNIQUE ("owner_id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."riders"
    ADD CONSTRAINT "riders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_assignments"
    ADD CONSTRAINT "unique_rider_idempotency" UNIQUE ("rider_id", "idempotency_key");



CREATE INDEX "idx_menu_items_restaurant_id" ON "public"."menu_items" USING "btree" ("restaurant_id");



CREATE UNIQUE INDEX "idx_one_active_assignment_per_order" ON "public"."order_assignments" USING "btree" ("order_id") WHERE ("status" = 'active'::"public"."assignment_status");



CREATE INDEX "idx_order_assignments_rider" ON "public"."order_assignments" USING "btree" ("rider_id", "assigned_at" DESC);



CREATE INDEX "idx_order_items_order_id" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "idx_orders_available" ON "public"."orders" USING "btree" ("created_at" DESC) WHERE (("status" = 'ready_for_pickup'::"public"."order_status") AND ("rider_id" IS NULL));



CREATE INDEX "idx_orders_customer" ON "public"."orders" USING "btree" ("customer_id");



CREATE INDEX "idx_orders_restaurant_status" ON "public"."orders" USING "btree" ("restaurant_id", "status", "created_at" DESC);



CREATE INDEX "idx_orders_rider" ON "public"."orders" USING "btree" ("rider_id");



CREATE OR REPLACE TRIGGER "prevent_profile_role_escalation" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_profile_role_escalation"();



CREATE OR REPLACE TRIGGER "trg_validate_order_status_transition" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."validate_order_status_transition"();



ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_assignments"
    ADD CONSTRAINT "order_assignments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_assignments"
    ADD CONSTRAINT "order_assignments_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id");



ALTER TABLE ONLY "public"."order_delivery_details"
    ADD CONSTRAINT "order_delivery_details_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."riders"
    ADD CONSTRAINT "riders_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Authenticated users can view restaurants" ON "public"."restaurants" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authorized participants can view delivery details" ON "public"."order_delivery_details" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."orders"
  WHERE (("orders"."id" = "order_delivery_details"."order_id") AND (("orders"."customer_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."owns_restaurant"("orders"."restaurant_id") OR ("orders"."rider_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Customers can add their delivery details" ON "public"."order_delivery_details" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."orders"
  WHERE (("orders"."id" = "order_delivery_details"."order_id") AND ("orders"."customer_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("orders"."status" = 'placed'::"public"."order_status")))));



CREATE POLICY "Customers can create their own orders" ON "public"."orders" FOR INSERT TO "authenticated" WITH CHECK ((("customer_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("public"."get_my_role"() = 'customer'::"public"."user_role") AND ("status" = 'placed'::"public"."order_status") AND ("rider_id" IS NULL)));



CREATE POLICY "Owners can create their restaurant" ON "public"."restaurants" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners can delete their menu items" ON "public"."menu_items" FOR DELETE TO "authenticated" USING (("public"."owns_restaurant"("restaurant_id") AND ("public"."get_my_role"() = 'restaurant_owner'::"public"."user_role")));



CREATE POLICY "Owners can insert their menu items" ON "public"."menu_items" FOR INSERT TO "authenticated" WITH CHECK (("public"."owns_restaurant"("restaurant_id") AND ("public"."get_my_role"() = 'restaurant_owner'::"public"."user_role")));



CREATE POLICY "Owners can update their menu items" ON "public"."menu_items" FOR UPDATE TO "authenticated" USING (("public"."owns_restaurant"("restaurant_id") AND ("public"."get_my_role"() = 'restaurant_owner'::"public"."user_role"))) WITH CHECK (("public"."owns_restaurant"("restaurant_id") AND ("public"."get_my_role"() = 'restaurant_owner'::"public"."user_role")));



CREATE POLICY "Owners can update their restaurant" ON "public"."restaurants" FOR UPDATE TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Participants can view assignments" ON "public"."order_assignments" FOR SELECT TO "authenticated" USING ((("rider_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."orders"
  WHERE (("orders"."id" = "order_assignments"."order_id") AND (("orders"."customer_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."owns_restaurant"("orders"."restaurant_id")))))));



CREATE POLICY "Participants can view order items" ON "public"."order_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_items"."order_id") AND (("o"."customer_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."owns_restaurant"("o"."restaurant_id") OR ("o"."rider_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("public"."get_my_role"() = 'rider'::"public"."user_role") AND ("o"."status" = 'ready_for_pickup'::"public"."order_status") AND ("o"."rider_id" IS NULL)))))));



CREATE POLICY "Participants can view their orders" ON "public"."orders" FOR SELECT TO "authenticated" USING ((("customer_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."owns_restaurant"("restaurant_id") OR ("rider_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Restaurant owners can update their orders" ON "public"."orders" FOR UPDATE TO "authenticated" USING (("public"."owns_restaurant"("restaurant_id") AND ("public"."get_my_role"() = 'restaurant_owner'::"public"."user_role"))) WITH CHECK (("public"."owns_restaurant"("restaurant_id") AND ("public"."get_my_role"() = 'restaurant_owner'::"public"."user_role")));



CREATE POLICY "Riders can create their own profile" ON "public"."riders" FOR INSERT TO "authenticated" WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Riders can read their own profile" ON "public"."riders" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Riders can update their own profile" ON "public"."riders" FOR UPDATE TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Riders can view available pickup orders" ON "public"."orders" FOR SELECT TO "authenticated" USING ((("public"."get_my_role"() = 'rider'::"public"."user_role") AND ("status" = 'ready_for_pickup'::"public"."order_status")));



CREATE POLICY "Users can read their own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can view available menu items" ON "public"."menu_items" FOR SELECT TO "authenticated" USING (("is_available" = true));



ALTER TABLE "public"."menu_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_delivery_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."riders" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_order"("p_order_id" "uuid", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_order"("p_order_id" "uuid", "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."owns_restaurant"("restaurant_uuid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."owns_restaurant"("restaurant_uuid" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."place_order"("p_restaurant_id" "uuid", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."place_order"("p_restaurant_id" "uuid", "p_items" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_delivery_status"("p_order_id" "uuid", "p_new_status" "public"."order_status") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_delivery_status"("p_order_id" "uuid", "p_new_status" "public"."order_status") TO "authenticated";



GRANT REFERENCES,MAINTAIN ON TABLE "public"."menu_items" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,MAINTAIN ON TABLE "public"."menu_items" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."menu_items" TO "service_role";



GRANT UPDATE("name") ON TABLE "public"."menu_items" TO "authenticated";



GRANT UPDATE("price_cents") ON TABLE "public"."menu_items" TO "authenticated";



GRANT UPDATE("is_available") ON TABLE "public"."menu_items" TO "authenticated";



GRANT REFERENCES,MAINTAIN ON TABLE "public"."order_assignments" TO "anon";
GRANT SELECT,REFERENCES,MAINTAIN ON TABLE "public"."order_assignments" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_assignments" TO "service_role";



GRANT REFERENCES,MAINTAIN ON TABLE "public"."order_delivery_details" TO "anon";
GRANT SELECT,INSERT,REFERENCES,MAINTAIN ON TABLE "public"."order_delivery_details" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_delivery_details" TO "service_role";



GRANT REFERENCES,MAINTAIN ON TABLE "public"."order_items" TO "anon";
GRANT SELECT,REFERENCES,MAINTAIN ON TABLE "public"."order_items" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_items" TO "service_role";



GRANT REFERENCES,MAINTAIN ON TABLE "public"."orders" TO "anon";
GRANT SELECT,INSERT,REFERENCES,MAINTAIN ON TABLE "public"."orders" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."orders" TO "service_role";



GRANT UPDATE("status") ON TABLE "public"."orders" TO "authenticated";



GRANT UPDATE("updated_at") ON TABLE "public"."orders" TO "authenticated";



GRANT REFERENCES,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,REFERENCES,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "service_role";



GRANT UPDATE("full_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("phone") ON TABLE "public"."profiles" TO "authenticated";



GRANT REFERENCES,MAINTAIN ON TABLE "public"."restaurants" TO "anon";
GRANT SELECT,REFERENCES,MAINTAIN ON TABLE "public"."restaurants" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."restaurants" TO "service_role";



GRANT REFERENCES,MAINTAIN ON TABLE "public"."riders" TO "anon";
GRANT SELECT,REFERENCES,MAINTAIN ON TABLE "public"."riders" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."riders" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";








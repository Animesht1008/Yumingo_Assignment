CREATE OR REPLACE FUNCTION public.accept_order(p_order_id uuid, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

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

$function$

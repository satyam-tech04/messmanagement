/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by `npm run db:types` (scripts/gen-types.mjs) from the live schema.
 * Regenerate and commit this in the same change as any migration, so that code
 * outrunning the database becomes a compile error instead of a runtime one.
 *
 * Generated against project: unknown
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      announcements: {
      Row: {
        id: string;
        tenant_id: string;
        title: string;
        body: string | null;
        service_date: string | null;
        meal_slot: Database["public"]["Enums"]["meal_slot"] | null;
        starts_on: string;
        ends_on: string;
        status: Database["public"]["Enums"]["announcement_status"];
        created_by: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        title: string;
        body?: string | null;
        service_date?: string | null;
        meal_slot?: Database["public"]["Enums"]["meal_slot"] | null;
        starts_on: string;
        ends_on: string;
        status?: Database["public"]["Enums"]["announcement_status"];
        created_by?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        title?: string;
        body?: string | null;
        service_date?: string | null;
        meal_slot?: Database["public"]["Enums"]["meal_slot"] | null;
        starts_on?: string;
        ends_on?: string;
        status?: Database["public"]["Enums"]["announcement_status"];
        created_by?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
      attendance: {
      Row: {
        id: string;
        tenant_id: string;
        student_id: string;
        service_date: string;
        meal_slot: Database["public"]["Enums"]["meal_slot"];
        scanned_at: string;
        method: Database["public"]["Enums"]["attendance_method"];
        verified_by: string | null;
        device_id: string | null;
        override_reason: string | null;
        created_at: string;
        reversed_at: string | null;
        reversed_by: string | null;
        reversal_reason: string | null;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        student_id: string;
        service_date: string;
        meal_slot: Database["public"]["Enums"]["meal_slot"];
        scanned_at?: string;
        method?: Database["public"]["Enums"]["attendance_method"];
        verified_by?: string | null;
        device_id?: string | null;
        override_reason?: string | null;
        created_at?: string;
        reversed_at?: string | null;
        reversed_by?: string | null;
        reversal_reason?: string | null;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        student_id?: string;
        service_date?: string;
        meal_slot?: Database["public"]["Enums"]["meal_slot"];
        scanned_at?: string;
        method?: Database["public"]["Enums"]["attendance_method"];
        verified_by?: string | null;
        device_id?: string | null;
        override_reason?: string | null;
        created_at?: string;
        reversed_at?: string | null;
        reversed_by?: string | null;
        reversal_reason?: string | null;
      };
      Relationships: [];
    };
      audit_log: {
      Row: {
        id: string;
        tenant_id: string;
        actor_profile_id: string | null;
        action: string;
        entity_type: string;
        entity_id: string | null;
        before: Json | null;
        after: Json | null;
        ip: string | null;
        user_agent: string | null;
        created_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        actor_profile_id?: string | null;
        action: string;
        entity_type: string;
        entity_id?: string | null;
        before?: Json | null;
        after?: Json | null;
        ip?: string | null;
        user_agent?: string | null;
        created_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        actor_profile_id?: string | null;
        action?: string;
        entity_type?: string;
        entity_id?: string | null;
        before?: Json | null;
        after?: Json | null;
        ip?: string | null;
        user_agent?: string | null;
        created_at?: string;
      };
      Relationships: [];
    };
      counter_bill_items: {
      Row: {
        id: string;
        tenant_id: string;
        bill_id: string;
        counter_item_id: string | null;
        item_code_snapshot: string;
        item_name_snapshot: string;
        unit_snapshot: string;
        unit_price_paise: number;
        quantity: number;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        bill_id: string;
        counter_item_id?: string | null;
        item_code_snapshot: string;
        item_name_snapshot: string;
        unit_snapshot: string;
        unit_price_paise: number;
        quantity: number;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        bill_id?: string;
        counter_item_id?: string | null;
        item_code_snapshot?: string;
        item_name_snapshot?: string;
        unit_snapshot?: string;
        unit_price_paise?: number;
        quantity?: number;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
      counter_bills: {
      Row: {
        id: string;
        tenant_id: string;
        bill_number: string;
        person_name: string;
        status: Database["public"]["Enums"]["bill_status"];
        payment_status: Database["public"]["Enums"]["bill_payment_status"];
        total_paise: number;
        service_date: string | null;
        created_by: string | null;
        finalized_at: string | null;
        finalized_by: string | null;
        cancelled_at: string | null;
        cancelled_by: string | null;
        payment_updated_by: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        bill_number: string;
        person_name: string;
        status?: Database["public"]["Enums"]["bill_status"];
        payment_status?: Database["public"]["Enums"]["bill_payment_status"];
        total_paise?: number;
        service_date?: string | null;
        created_by?: string | null;
        finalized_at?: string | null;
        finalized_by?: string | null;
        cancelled_at?: string | null;
        cancelled_by?: string | null;
        payment_updated_by?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        bill_number?: string;
        person_name?: string;
        status?: Database["public"]["Enums"]["bill_status"];
        payment_status?: Database["public"]["Enums"]["bill_payment_status"];
        total_paise?: number;
        service_date?: string | null;
        created_by?: string | null;
        finalized_at?: string | null;
        finalized_by?: string | null;
        cancelled_at?: string | null;
        cancelled_by?: string | null;
        payment_updated_by?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
      counter_items: {
      Row: {
        id: string;
        tenant_id: string;
        item_code: string;
        item_name: string;
        unit: string;
        price_paise: number;
        is_active: boolean;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        item_code: string;
        item_name: string;
        unit: string;
        price_paise: number;
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        item_code?: string;
        item_name?: string;
        unit?: string;
        price_paise?: number;
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
      headcount_snapshots: {
      Row: {
        id: string;
        tenant_id: string;
        service_date: string;
        meal_slot: Database["public"]["Enums"]["meal_slot"];
        projected_count: number;
        guest_count: number;
        extra_plate_count: number;
        locked_at: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        service_date: string;
        meal_slot: Database["public"]["Enums"]["meal_slot"];
        projected_count: number;
        guest_count?: number;
        extra_plate_count?: number;
        locked_at?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        service_date?: string;
        meal_slot?: Database["public"]["Enums"]["meal_slot"];
        projected_count?: number;
        guest_count?: number;
        extra_plate_count?: number;
        locked_at?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
      meal_feedback: {
      Row: {
        id: string;
        tenant_id: string;
        student_id: string;
        service_date: string;
        meal_slot: Database["public"]["Enums"]["meal_slot"];
        rating: number;
        comment: string | null;
        photo_path: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        student_id: string;
        service_date: string;
        meal_slot: Database["public"]["Enums"]["meal_slot"];
        rating: number;
        comment?: string | null;
        photo_path?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        student_id?: string;
        service_date?: string;
        meal_slot?: Database["public"]["Enums"]["meal_slot"];
        rating?: number;
        comment?: string | null;
        photo_path?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
      meal_prices: {
      Row: {
        id: string;
        tenant_id: string;
        meal_slot: Database["public"]["Enums"]["meal_slot"];
        price_paise: number;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        meal_slot: Database["public"]["Enums"]["meal_slot"];
        price_paise: number;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        meal_slot?: Database["public"]["Enums"]["meal_slot"];
        price_paise?: number;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
      menus: {
      Row: {
        id: string;
        tenant_id: string;
        service_date: string;
        meal_slot: Database["public"]["Enums"]["meal_slot"];
        items: Json;
        notes: string | null;
        published_by: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        service_date: string;
        meal_slot: Database["public"]["Enums"]["meal_slot"];
        items?: Json;
        notes?: string | null;
        published_by?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        service_date?: string;
        meal_slot?: Database["public"]["Enums"]["meal_slot"];
        items?: Json;
        notes?: string | null;
        published_by?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
      mess_cuts: {
      Row: {
        id: string;
        tenant_id: string;
        student_id: string;
        subscription_id: string;
        date_from: string;
        date_to: string;
        meal_slots: Database["public"]["Enums"]["meal_slot"][];
        requested_at: string;
        effective_from: string;
        status: Database["public"]["Enums"]["mess_cut_status"];
        meals_credited: number;
        credit_amount_paise: number;
        rejection_reason: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        student_id: string;
        subscription_id: string;
        date_from: string;
        date_to: string;
        meal_slots: Database["public"]["Enums"]["meal_slot"][];
        requested_at?: string;
        effective_from: string;
        status?: Database["public"]["Enums"]["mess_cut_status"];
        meals_credited?: number;
        credit_amount_paise?: number;
        rejection_reason?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        student_id?: string;
        subscription_id?: string;
        date_from?: string;
        date_to?: string;
        meal_slots?: Database["public"]["Enums"]["meal_slot"][];
        requested_at?: string;
        effective_from?: string;
        status?: Database["public"]["Enums"]["mess_cut_status"];
        meals_credited?: number;
        credit_amount_paise?: number;
        rejection_reason?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
      plans: {
      Row: {
        id: string;
        tenant_id: string;
        name: string;
        duration_type: Database["public"]["Enums"]["plan_duration"];
        duration_days: number;
        price_paise: number;
        included_meal_slots: Database["public"]["Enums"]["meal_slot"][];
        is_active: boolean;
        created_at: string;
        updated_at: string;
        base_premium_paise: number;
        discount_paise: number;
        meal_prices_snapshot: Json | null;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        name: string;
        duration_type: Database["public"]["Enums"]["plan_duration"];
        duration_days: number;
        price_paise: number;
        included_meal_slots: Database["public"]["Enums"]["meal_slot"][];
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
        base_premium_paise: number;
        discount_paise?: number;
        meal_prices_snapshot?: Json | null;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        name?: string;
        duration_type?: Database["public"]["Enums"]["plan_duration"];
        duration_days?: number;
        price_paise?: number;
        included_meal_slots?: Database["public"]["Enums"]["meal_slot"][];
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
        base_premium_paise?: number;
        discount_paise?: number;
        meal_prices_snapshot?: Json | null;
      };
      Relationships: [];
    };
      profiles: {
      Row: {
        id: string;
        tenant_id: string;
        role: Database["public"]["Enums"]["user_role"];
        full_name: string;
        phone: string | null;
        email: string | null;
        photo_url: string | null;
        status: Database["public"]["Enums"]["profile_status"];
        must_change_password: boolean;
        created_at: string;
        updated_at: string;
        mobile: string | null;
      };
      Insert: {
        id: string;
        tenant_id: string;
        role?: Database["public"]["Enums"]["user_role"];
        full_name: string;
        phone?: string | null;
        email?: string | null;
        photo_url?: string | null;
        status?: Database["public"]["Enums"]["profile_status"];
        must_change_password?: boolean;
        created_at?: string;
        updated_at?: string;
        mobile?: string | null;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        role?: Database["public"]["Enums"]["user_role"];
        full_name?: string;
        phone?: string | null;
        email?: string | null;
        photo_url?: string | null;
        status?: Database["public"]["Enums"]["profile_status"];
        must_change_password?: boolean;
        created_at?: string;
        updated_at?: string;
        mobile?: string | null;
      };
      Relationships: [];
    };
      rate_limits: {
      Row: {
        bucket_key: string;
        window_start: string;
        request_count: number;
      };
      Insert: {
        bucket_key: string;
        window_start: string;
        request_count?: number;
      };
      Update: {
        bucket_key?: string;
        window_start?: string;
        request_count?: number;
      };
      Relationships: [];
    };
      students: {
      Row: {
        id: string;
        tenant_id: string;
        profile_id: string;
        roll_number: string;
        block: string | null;
        room_number: string | null;
        joined_at: string;
        status: Database["public"]["Enums"]["student_status"];
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        profile_id: string;
        roll_number: string;
        block?: string | null;
        room_number?: string | null;
        joined_at?: string;
        status?: Database["public"]["Enums"]["student_status"];
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        profile_id?: string;
        roll_number?: string;
        block?: string | null;
        room_number?: string | null;
        joined_at?: string;
        status?: Database["public"]["Enums"]["student_status"];
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
      subscription_pauses: {
      Row: {
        id: string;
        tenant_id: string;
        subscription_id: string;
        student_id: string;
        start_date: string;
        resume_date: string;
        end_date_before_pause: string;
        computed_end_date: string;
        remarks: string;
        status: Database["public"]["Enums"]["pause_status"];
        ended_early_at: string | null;
        created_by: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        subscription_id: string;
        student_id: string;
        start_date: string;
        resume_date: string;
        end_date_before_pause: string;
        computed_end_date: string;
        remarks: string;
        status?: Database["public"]["Enums"]["pause_status"];
        ended_early_at?: string | null;
        created_by?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        subscription_id?: string;
        student_id?: string;
        start_date?: string;
        resume_date?: string;
        end_date_before_pause?: string;
        computed_end_date?: string;
        remarks?: string;
        status?: Database["public"]["Enums"]["pause_status"];
        ended_early_at?: string | null;
        created_by?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
      subscriptions: {
      Row: {
        id: string;
        tenant_id: string;
        student_id: string;
        plan_id: string;
        price_paise_snapshot: number;
        included_meal_slots_snapshot: Database["public"]["Enums"]["meal_slot"][];
        start_date: string;
        end_date: string;
        status: Database["public"]["Enums"]["subscription_status"];
        auto_renew: boolean;
        created_at: string;
        updated_at: string;
        plan_duration_days_snapshot: number;
        assignment_duration_days: number;
        calculated_price_paise: number;
        is_price_overridden: boolean;
      };
      Insert: {
        id?: string;
        tenant_id: string;
        student_id: string;
        plan_id: string;
        price_paise_snapshot: number;
        included_meal_slots_snapshot: Database["public"]["Enums"]["meal_slot"][];
        start_date: string;
        end_date: string;
        status?: Database["public"]["Enums"]["subscription_status"];
        auto_renew?: boolean;
        created_at?: string;
        updated_at?: string;
        plan_duration_days_snapshot: number;
        assignment_duration_days: number;
        calculated_price_paise: number;
        is_price_overridden?: boolean;
      };
      Update: {
        id?: string;
        tenant_id?: string;
        student_id?: string;
        plan_id?: string;
        price_paise_snapshot?: number;
        included_meal_slots_snapshot?: Database["public"]["Enums"]["meal_slot"][];
        start_date?: string;
        end_date?: string;
        status?: Database["public"]["Enums"]["subscription_status"];
        auto_renew?: boolean;
        created_at?: string;
        updated_at?: string;
        plan_duration_days_snapshot?: number;
        assignment_duration_days?: number;
        calculated_price_paise?: number;
        is_price_overridden?: boolean;
      };
      Relationships: [];
    };
      tenant_secrets: {
      Row: {
        tenant_id: string;
        qr_signing_secret: string;
        rotated_at: string;
        created_at: string;
      };
      Insert: {
        tenant_id: string;
        qr_signing_secret: string;
        rotated_at?: string;
        created_at?: string;
      };
      Update: {
        tenant_id?: string;
        qr_signing_secret?: string;
        rotated_at?: string;
        created_at?: string;
      };
      Relationships: [];
    };
      tenant_settings: {
      Row: {
        tenant_id: string;
        meal_slots: Json;
        cut_advance_hours: number;
        cut_max_days_per_month: number;
        grace_period_days: number;
        block_on_overdue: boolean;
        allow_extras: boolean;
        guest_token_price_paise: number;
        extra_plate_price_paise: number;
        qr_token_ttl_seconds: number;
        qr_refresh_seconds: number;
        currency: string;
        created_at: string;
        updated_at: string;
        allow_meal_skipping: boolean;
        allow_partial_day_skip: boolean;
        allow_away_requests: boolean;
        away_requires_approval: boolean;
        away_advance_hours: number;
        away_max_days: number;
        auto_roll_numbers: boolean;
        allow_announcements: boolean;
        allow_feedback: boolean;
      };
      Insert: {
        tenant_id: string;
        meal_slots?: Json;
        cut_advance_hours?: number;
        cut_max_days_per_month?: number;
        grace_period_days?: number;
        block_on_overdue?: boolean;
        allow_extras?: boolean;
        guest_token_price_paise?: number;
        extra_plate_price_paise?: number;
        qr_token_ttl_seconds?: number;
        qr_refresh_seconds?: number;
        currency?: string;
        created_at?: string;
        updated_at?: string;
        allow_meal_skipping?: boolean;
        allow_partial_day_skip?: boolean;
        allow_away_requests?: boolean;
        away_requires_approval?: boolean;
        away_advance_hours?: number;
        away_max_days?: number;
        auto_roll_numbers?: boolean;
        allow_announcements?: boolean;
        allow_feedback?: boolean;
      };
      Update: {
        tenant_id?: string;
        meal_slots?: Json;
        cut_advance_hours?: number;
        cut_max_days_per_month?: number;
        grace_period_days?: number;
        block_on_overdue?: boolean;
        allow_extras?: boolean;
        guest_token_price_paise?: number;
        extra_plate_price_paise?: number;
        qr_token_ttl_seconds?: number;
        qr_refresh_seconds?: number;
        currency?: string;
        created_at?: string;
        updated_at?: string;
        allow_meal_skipping?: boolean;
        allow_partial_day_skip?: boolean;
        allow_away_requests?: boolean;
        away_requires_approval?: boolean;
        away_advance_hours?: number;
        away_max_days?: number;
        auto_roll_numbers?: boolean;
        allow_announcements?: boolean;
        allow_feedback?: boolean;
      };
      Relationships: [];
    };
      tenants: {
      Row: {
        id: string;
        slug: string;
        name: string;
        type: Database["public"]["Enums"]["tenant_type"];
        timezone: string;
        status: Database["public"]["Enums"]["tenant_status"];
        created_at: string;
        updated_at: string;
        next_roll_number: number;
        next_bill_number: number;
        next_counter_item_code: number;
        logo_path: string | null;
      };
      Insert: {
        id?: string;
        slug: string;
        name: string;
        type?: Database["public"]["Enums"]["tenant_type"];
        timezone?: string;
        status?: Database["public"]["Enums"]["tenant_status"];
        created_at?: string;
        updated_at?: string;
        next_roll_number?: number;
        next_bill_number?: number;
        next_counter_item_code?: number;
        logo_path?: string | null;
      };
      Update: {
        id?: string;
        slug?: string;
        name?: string;
        type?: Database["public"]["Enums"]["tenant_type"];
        timezone?: string;
        status?: Database["public"]["Enums"]["tenant_status"];
        created_at?: string;
        updated_at?: string;
        next_roll_number?: number;
        next_bill_number?: number;
        next_counter_item_code?: number;
        logo_path?: string | null;
      };
      Relationships: [];
    };
    };
    Views: Record<never, never>;
    Functions: {
      allocate_bill_number: {
        Args: { p_tenant_id: string };
        Returns: string;
      };
      allocate_counter_item_code: {
        Args: { p_tenant_id: string };
        Returns: string;
      };
      allocate_roll_number: {
        Args: { p_tenant_id: string };
        Returns: number;
      };
      cash_dist: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      consume_rate_limit: {
        Args: { p_bucket_key: string; p_window_seconds: number; p_max_requests: number };
        Returns: boolean;
      };
      custom_access_token_hook: {
        Args: { event: Json };
        Returns: Json;
      };
      date_dist: {
        Args: { arg0: string; arg1: string };
        Returns: number;
      };
      float4_dist: {
        Args: { arg0: number; arg1: number };
        Returns: number;
      };
      float8_dist: {
        Args: { arg0: number; arg1: number };
        Returns: number;
      };
      gbt_bit_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_bit_consistent: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_bit_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_bit_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_bit_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_bit_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_bool_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_bool_consistent: {
        Args: { arg0: unknown; arg1: boolean; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_bool_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_bool_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_bool_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_bool_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_bool_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_bpchar_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_bpchar_consistent: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_bytea_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_bytea_consistent: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_bytea_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_bytea_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_bytea_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_bytea_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_cash_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_cash_consistent: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_cash_distance: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_cash_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_cash_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_cash_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_cash_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_cash_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_date_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_date_consistent: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_date_distance: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_date_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_date_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_date_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_date_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_date_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_decompress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_enum_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_enum_consistent: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_enum_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_enum_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_enum_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_enum_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_enum_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_float4_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_float4_consistent: {
        Args: { arg0: unknown; arg1: number; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_float4_distance: {
        Args: { arg0: unknown; arg1: number; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_float4_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_float4_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_float4_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_float4_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_float4_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_float8_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_float8_consistent: {
        Args: { arg0: unknown; arg1: number; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_float8_distance: {
        Args: { arg0: unknown; arg1: number; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_float8_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_float8_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_float8_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_float8_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_float8_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_inet_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_inet_consistent: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_inet_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_inet_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_inet_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_inet_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_int2_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_int2_consistent: {
        Args: { arg0: unknown; arg1: number; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_int2_distance: {
        Args: { arg0: unknown; arg1: number; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_int2_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_int2_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_int2_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_int2_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_int2_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_int4_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_int4_consistent: {
        Args: { arg0: unknown; arg1: number; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_int4_distance: {
        Args: { arg0: unknown; arg1: number; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_int4_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_int4_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_int4_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_int4_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_int4_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_int8_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_int8_consistent: {
        Args: { arg0: unknown; arg1: number; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_int8_distance: {
        Args: { arg0: unknown; arg1: number; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_int8_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_int8_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_int8_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_int8_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_int8_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_intv_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_intv_consistent: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_intv_decompress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_intv_distance: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_intv_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_intv_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_intv_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_intv_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_intv_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_macad8_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_macad8_consistent: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_macad8_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_macad8_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_macad8_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_macad8_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_macad8_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_macad_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_macad_consistent: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_macad_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_macad_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_macad_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_macad_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_macad_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_numeric_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_numeric_consistent: {
        Args: { arg0: unknown; arg1: number; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_numeric_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_numeric_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_numeric_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_numeric_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_oid_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_oid_consistent: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_oid_distance: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_oid_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_oid_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_oid_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_oid_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_oid_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_text_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_text_consistent: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_text_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_text_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_text_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_text_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_time_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_time_consistent: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_time_distance: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_time_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_time_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_time_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_time_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_time_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_timetz_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_timetz_consistent: {
        Args: { arg0: unknown; arg1: unknown; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_ts_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_ts_consistent: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_ts_distance: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_ts_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_ts_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_ts_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_ts_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_ts_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_tstz_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_tstz_consistent: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_tstz_distance: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: number;
      };
      gbt_uuid_compress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_uuid_consistent: {
        Args: { arg0: unknown; arg1: string; arg2: number; arg3: unknown; arg4: unknown };
        Returns: boolean;
      };
      gbt_uuid_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_uuid_penalty: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_uuid_picksplit: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_uuid_same: {
        Args: { arg0: unknown; arg1: unknown; arg2: unknown };
        Returns: unknown;
      };
      gbt_uuid_union: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      gbt_var_decompress: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbt_var_fetch: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey16_in: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey16_out: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey2_in: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey2_out: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey32_in: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey32_out: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey4_in: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey4_out: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey8_in: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey8_out: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey_var_in: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      gbtreekey_var_out: {
        Args: { arg0: unknown };
        Returns: unknown;
      };
      increment_bill_line: {
        Args: { p_line_id: string; p_delta: number };
        Returns: number;
      };
      int2_dist: {
        Args: { arg0: number; arg1: number };
        Returns: number;
      };
      int4_dist: {
        Args: { arg0: number; arg1: number };
        Returns: number;
      };
      int8_dist: {
        Args: { arg0: number; arg1: number };
        Returns: number;
      };
      interval_dist: {
        Args: { arg0: string; arg1: string };
        Returns: string;
      };
      oid_dist: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: unknown;
      };
      prune_rate_limits: {
        Args: { p_older_than: string };
        Returns: number;
      };
      time_dist: {
        Args: { arg0: unknown; arg1: unknown };
        Returns: string;
      };
      ts_dist: {
        Args: { arg0: string; arg1: string };
        Returns: string;
      };
      tstz_dist: {
        Args: { arg0: string; arg1: string };
        Returns: string;
      };
    };
    Enums: {
      announcement_status: "PUBLISHED" | "ARCHIVED";
      attendance_method: "QR" | "MANUAL" | "RFID";
      bill_payment_status: "UNPAID" | "PAID";
      bill_status: "OPEN" | "FINALIZED" | "CANCELLED";
      meal_slot: "BREAKFAST" | "LUNCH" | "SNACKS" | "DINNER";
      mess_cut_status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "CREDITED";
      pause_status: "ACTIVE" | "CANCELLED";
      plan_duration: "MONTHLY" | "QUARTERLY";
      profile_status: "ACTIVE" | "DISABLED";
      student_status: "ACTIVE" | "GRACE" | "BLOCKED" | "INACTIVE";
      subscription_status: "PENDING_PAYMENT" | "ACTIVE" | "EXPIRED" | "CANCELLED";
      tenant_status: "ACTIVE" | "SUSPENDED" | "CANCELLED";
      tenant_type: "HOSTEL" | "CLOUD_KITCHEN" | "BULK_SUPPLY";
      user_role: "STUDENT" | "STAFF" | "ADMIN" | "SUPER_ADMIN";
    };
    CompositeTypes: Record<never, never>;
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

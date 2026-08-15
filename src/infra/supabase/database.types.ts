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
      };
      Relationships: [];
    };
    };
    Views: Record<never, never>;
    Functions: {
      consume_rate_limit: {
        Args: { p_bucket_key: string; p_window_seconds: number; p_max_requests: number };
        Returns: boolean;
      };
      custom_access_token_hook: {
        Args: { event: Json };
        Returns: Json;
      };
      prune_rate_limits: {
        Args: { p_older_than: string };
        Returns: number;
      };
    };
    Enums: {
      attendance_method: "QR" | "MANUAL" | "RFID";
      meal_slot: "BREAKFAST" | "LUNCH" | "SNACKS" | "DINNER";
      mess_cut_status: "APPROVED" | "REJECTED" | "CANCELLED" | "CREDITED";
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

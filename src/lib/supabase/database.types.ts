export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      availability_rules: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_archived: boolean
          profile_id: string
          start_time: string
          timezone: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          is_archived?: boolean
          profile_id: string
          start_time: string
          timezone?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_archived?: boolean
          profile_id?: string
          start_time?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commitment_events: {
        Row: {
          actor_profile_id: string | null
          actor_role: Database["public"]["Enums"]["commitment_party"] | null
          commitment_id: string
          event_type: Database["public"]["Enums"]["commitment_event_type"]
          id: string
          metadata: Json | null
          occurred_at: string
        }
        Insert: {
          actor_profile_id?: string | null
          actor_role?: Database["public"]["Enums"]["commitment_party"] | null
          commitment_id: string
          event_type: Database["public"]["Enums"]["commitment_event_type"]
          id?: string
          metadata?: Json | null
          occurred_at?: string
        }
        Update: {
          actor_profile_id?: string | null
          actor_role?: Database["public"]["Enums"]["commitment_party"] | null
          commitment_id?: string
          event_type?: Database["public"]["Enums"]["commitment_event_type"]
          id?: string
          metadata?: Json | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commitment_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitment_events_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "commitments"
            referencedColumns: ["id"]
          },
        ]
      }
      commitments: {
        Row: {
          accepted_at: string | null
          buyer_checked_in_at: string | null
          buyer_id: string
          buyer_stake_cents: number
          cancelled_at: string | null
          check_in_window_ends_at: string | null
          completed_at: string | null
          created_at: string
          declined_at: string | null
          id: string
          listing_id: string
          meetup_location_id: string
          meetup_verified_at: string | null
          request_expires_at: string
          responsible_party:
            | Database["public"]["Enums"]["commitment_party"]
            | null
          scheduled_at: string
          seller_checked_in_at: string | null
          seller_id: string
          seller_stake_cents: number
          status: Database["public"]["Enums"]["commitment_status"]
        }
        Insert: {
          accepted_at?: string | null
          buyer_checked_in_at?: string | null
          buyer_id: string
          buyer_stake_cents: number
          cancelled_at?: string | null
          check_in_window_ends_at?: string | null
          completed_at?: string | null
          created_at?: string
          declined_at?: string | null
          id?: string
          listing_id: string
          meetup_location_id: string
          meetup_verified_at?: string | null
          request_expires_at?: string
          responsible_party?:
            | Database["public"]["Enums"]["commitment_party"]
            | null
          scheduled_at: string
          seller_checked_in_at?: string | null
          seller_id: string
          seller_stake_cents: number
          status?: Database["public"]["Enums"]["commitment_status"]
        }
        Update: {
          accepted_at?: string | null
          buyer_checked_in_at?: string | null
          buyer_id?: string
          buyer_stake_cents?: number
          cancelled_at?: string | null
          check_in_window_ends_at?: string | null
          completed_at?: string | null
          created_at?: string
          declined_at?: string | null
          id?: string
          listing_id?: string
          meetup_location_id?: string
          meetup_verified_at?: string | null
          request_expires_at?: string
          responsible_party?:
            | Database["public"]["Enums"]["commitment_party"]
            | null
          scheduled_at?: string
          seller_checked_in_at?: string | null
          seller_id?: string
          seller_stake_cents?: number
          status?: Database["public"]["Enums"]["commitment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "commitments_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitments_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitments_meetup_location_id_fkey"
            columns: ["meetup_location_id"]
            isOneToOne: false
            referencedRelation: "meetup_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_availability_rules: {
        Row: {
          availability_rule_id: string
          listing_id: string
        }
        Insert: {
          availability_rule_id: string
          listing_id: string
        }
        Update: {
          availability_rule_id?: string
          listing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_availability_rules_availability_rule_id_fkey"
            columns: ["availability_rule_id"]
            isOneToOne: false
            referencedRelation: "availability_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_availability_rules_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_images: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          position: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          position: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          position?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_images_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_meetup_locations: {
        Row: {
          listing_id: string
          meetup_location_id: string
        }
        Insert: {
          listing_id: string
          meetup_location_id: string
        }
        Update: {
          listing_id?: string
          meetup_location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_meetup_locations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_meetup_locations_meetup_location_id_fkey"
            columns: ["meetup_location_id"]
            isOneToOne: false
            referencedRelation: "meetup_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          condition: Database["public"]["Enums"]["listing_condition"]
          created_at: string
          description: string | null
          id: string
          price_cents: number
          seller_id: string
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at: string
        }
        Insert: {
          condition: Database["public"]["Enums"]["listing_condition"]
          created_at?: string
          description?: string | null
          id?: string
          price_cents: number
          seller_id: string
          status?: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at?: string
        }
        Update: {
          condition?: Database["public"]["Enums"]["listing_condition"]
          created_at?: string
          description?: string | null
          id?: string
          price_cents?: number
          seller_id?: string
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_settings: {
        Row: {
          active_charity_id: string | null
          base_commitment_fee_cents: number
          check_in_radius_metres: number
          check_in_window_minutes: number
          commitment_fee_params: Json
          currency_code: string
          id: number
          market_reputation: number | null
          market_reputation_params: Json
          max_commitment_fee_cents: number
          min_commitment_fee_cents: number
          minimum_acceptance_lead_hours: number
          request_expiry_hours: number
          sol_price_cents: number
          updated_at: string
          updated_by: string | null
          user_reputation_params: Json
          vote_timezone: string
        }
        Insert: {
          active_charity_id?: string | null
          base_commitment_fee_cents: number
          check_in_radius_metres: number
          check_in_window_minutes: number
          commitment_fee_params?: Json
          currency_code?: string
          id?: number
          market_reputation?: number | null
          market_reputation_params?: Json
          max_commitment_fee_cents: number
          min_commitment_fee_cents: number
          minimum_acceptance_lead_hours: number
          request_expiry_hours: number
          sol_price_cents?: number
          updated_at?: string
          updated_by?: string | null
          user_reputation_params?: Json
          vote_timezone?: string
        }
        Update: {
          active_charity_id?: string | null
          base_commitment_fee_cents?: number
          check_in_radius_metres?: number
          check_in_window_minutes?: number
          commitment_fee_params?: Json
          currency_code?: string
          id?: number
          market_reputation?: number | null
          market_reputation_params?: Json
          max_commitment_fee_cents?: number
          min_commitment_fee_cents?: number
          minimum_acceptance_lead_hours?: number
          request_expiry_hours?: number
          sol_price_cents?: number
          updated_at?: string
          updated_by?: string | null
          user_reputation_params?: Json
          vote_timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_settings_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          note: string | null
          snapshot: Json
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          note?: string | null
          snapshot: Json
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          note?: string | null
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "market_settings_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_locations: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          latitude: number
          longitude: number
          name: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          latitude: number
          longitude: number
          name: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          latitude?: number
          longitude?: number
          name?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_locations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_wallet: {
        Row: {
          created_at: string
          id: number
          secret_key_encrypted: string
          solana_address: string
        }
        Insert: {
          created_at?: string
          id?: number
          secret_key_encrypted: string
          solana_address: string
        }
        Update: {
          created_at?: string
          id?: number
          secret_key_encrypted?: string
          solana_address?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          commitments_cancelled: number
          commitments_expired: number
          commitments_ignored: number
          commitments_stale: number
          commitments_successful: number
          commitments_total: number
          created_at: string
          description: string | null
          display_name: string
          email_receipts_enabled: boolean
          id: string
          last_vote: string | null
          last_vote_choice: string | null
          reputation: number | null
          reputation_updated_at: string | null
          updated_at: string
        }
        Insert: {
          commitments_cancelled?: number
          commitments_expired?: number
          commitments_ignored?: number
          commitments_stale?: number
          commitments_successful?: number
          commitments_total?: number
          created_at?: string
          description?: string | null
          display_name: string
          email_receipts_enabled?: boolean
          id: string
          last_vote?: string | null
          last_vote_choice?: string | null
          reputation?: number | null
          reputation_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          commitments_cancelled?: number
          commitments_expired?: number
          commitments_ignored?: number
          commitments_stale?: number
          commitments_successful?: number
          commitments_total?: number
          created_at?: string
          description?: string | null
          display_name?: string
          email_receipts_enabled?: boolean
          id?: string
          last_vote?: string | null
          last_vote_choice?: string | null
          reputation?: number | null
          reputation_updated_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          charity_id: string | null
          commitment_id: string | null
          completed_at: string | null
          created_at: string
          failure_reason: string | null
          from_address: string
          id: string
          idempotency_key: string
          lamports: number
          solana_signature: string | null
          status: Database["public"]["Enums"]["wallet_transaction_status"]
          to_address: string
          type: Database["public"]["Enums"]["wallet_transaction_type"]
          wallet_id: string | null
        }
        Insert: {
          charity_id?: string | null
          commitment_id?: string | null
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          from_address: string
          id?: string
          idempotency_key: string
          lamports: number
          solana_signature?: string | null
          status?: Database["public"]["Enums"]["wallet_transaction_status"]
          to_address: string
          type: Database["public"]["Enums"]["wallet_transaction_type"]
          wallet_id?: string | null
        }
        Update: {
          charity_id?: string | null
          commitment_id?: string | null
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          from_address?: string
          id?: string
          idempotency_key?: string
          lamports?: number
          solana_signature?: string | null
          status?: Database["public"]["Enums"]["wallet_transaction_status"]
          to_address?: string
          type?: Database["public"]["Enums"]["wallet_transaction_type"]
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          charity_id: string | null
          created_at: string
          id: string
          profile_id: string | null
          secret_key_encrypted: string
          solana_address: string
          updated_at: string
        }
        Insert: {
          charity_id?: string | null
          created_at?: string
          id?: string
          profile_id?: string | null
          secret_key_encrypted: string
          solana_address: string
          updated_at?: string
        }
        Update: {
          charity_id?: string | null
          created_at?: string
          id?: string
          profile_id?: string | null
          secret_key_encrypted?: string
          solana_address?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      commitment_event_type:
        | "request_created"
        | "seller_accepted"
        | "seller_declined"
        | "buyer_withdrew"
        | "request_expired"
        | "buyer_cancelled"
        | "seller_cancelled"
        | "buyer_checked_in"
        | "seller_checked_in"
        | "buyer_no_show"
        | "seller_no_show"
        | "meetup_verified"
        | "commitment_stale"
        | "commitment_completed"
        | "purchase_completed"
      commitment_party: "buyer" | "seller"
      commitment_status:
        | "pending"
        | "accepted"
        | "declined"
        | "expired"
        | "cancelled"
        | "no_show"
        | "stale"
        | "completed"
      listing_condition: "new" | "used_like_new" | "used_good" | "used_fair"
      listing_status: "draft" | "active" | "reserved" | "sold" | "withdrawn"
      wallet_transaction_status: "pending" | "completed" | "failed"
      wallet_transaction_type:
        | "deposit"
        | "withdrawal"
        | "commitment_lock"
        | "commitment_refund"
        | "commitment_forfeit"
        | "purchase"
        | "sale"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      commitment_event_type: [
        "request_created",
        "seller_accepted",
        "seller_declined",
        "buyer_withdrew",
        "request_expired",
        "buyer_cancelled",
        "seller_cancelled",
        "buyer_checked_in",
        "seller_checked_in",
        "buyer_no_show",
        "seller_no_show",
        "meetup_verified",
        "commitment_stale",
        "commitment_completed",
        "purchase_completed",
      ],
      commitment_party: ["buyer", "seller"],
      commitment_status: [
        "pending",
        "accepted",
        "declined",
        "expired",
        "cancelled",
        "no_show",
        "stale",
        "completed",
      ],
      listing_condition: ["new", "used_like_new", "used_good", "used_fair"],
      listing_status: ["draft", "active", "reserved", "sold", "withdrawn"],
      wallet_transaction_status: ["pending", "completed", "failed"],
      wallet_transaction_type: [
        "deposit",
        "withdrawal",
        "commitment_lock",
        "commitment_refund",
        "commitment_forfeit",
        "purchase",
        "sale",
      ],
    },
  },
} as const

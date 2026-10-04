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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      listing_condition: "new" | "used_like_new" | "used_good" | "used_fair"
      listing_status: "draft" | "active" | "reserved" | "sold" | "withdrawn"
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
      listing_condition: ["new", "used_like_new", "used_good", "used_fair"],
      listing_status: ["draft", "active", "reserved", "sold", "withdrawn"],
    },
  },
} as const

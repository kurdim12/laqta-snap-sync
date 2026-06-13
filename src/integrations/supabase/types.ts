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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assets: {
        Row: {
          bytes: number | null
          content_type: string
          created_at: string
          event_id: string
          guest_id: string | null
          id: string
          kind: string
          meta: Json
          parent_asset_id: string | null
          status: string
          storage_path: string
          variant: string
        }
        Insert: {
          bytes?: number | null
          content_type: string
          created_at?: string
          event_id: string
          guest_id?: string | null
          id: string
          kind: string
          meta?: Json
          parent_asset_id?: string | null
          status?: string
          storage_path: string
          variant?: string
        }
        Update: {
          bytes?: number | null
          content_type?: string
          created_at?: string
          event_id?: string
          guest_id?: string | null
          id?: string
          kind?: string
          meta?: Json
          parent_asset_id?: string | null
          status?: string
          storage_path?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_parent_asset_id_fkey"
            columns: ["parent_asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          channel: string
          created_at: string
          guest_id: string
          id: string
          status: string
        }
        Insert: {
          channel?: string
          created_at?: string
          guest_id: string
          id?: string
          status?: string
        }
        Update: {
          channel?: string
          created_at?: string
          guest_id?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          config: Json
          created_at: string
          id: string
          name: string
          slug: string
          staff_pin: string | null
          staff_pin_hash: string | null
          status: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          name: string
          slug: string
          staff_pin?: string | null
          staff_pin_hash?: string | null
          status?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          name?: string
          slug?: string
          staff_pin?: string | null
          staff_pin_hash?: string | null
          status?: string
        }
        Relationships: []
      }
      guests: {
        Row: {
          code: string
          consent: boolean
          created_at: string
          event_id: string
          form_data: Json
          id: string
          selfie_path: string | null
          source: string
        }
        Insert: {
          code: string
          consent?: boolean
          created_at?: string
          event_id: string
          form_data?: Json
          id: string
          selfie_path?: string | null
          source?: string
        }
        Update: {
          code?: string
          consent?: boolean
          created_at?: string
          event_id?: string
          form_data?: Json
          id?: string
          selfie_path?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_pin_attempts: {
        Row: {
          failed_count: number
          last_failed_at: string | null
          locked_until: string | null
          slug: string
        }
        Insert: {
          failed_count?: number
          last_failed_at?: string | null
          locked_until?: string | null
          slug: string
        }
        Update: {
          failed_count?: number
          last_failed_at?: string | null
          locked_until?: string | null
          slug?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      events_public: {
        Row: {
          config: Json | null
          created_at: string | null
          id: string | null
          name: string | null
          slug: string | null
          status: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
          status?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
          status?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _check_staff_pin: {
        Args: { _pin: string; _slug: string }
        Returns: string
      }
      admin_exists: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      set_guest_selfie: {
        Args: { _code: string; _id: string; _path: string }
        Returns: boolean
      }
      staff_create_asset: {
        Args: {
          _bytes: number
          _content_type: string
          _guest_id: string
          _id: string
          _kind: string
          _parent_asset_id: string
          _pin: string
          _slug: string
          _storage_path: string
          _variant: string
        }
        Returns: string
      }
      staff_list_guests: {
        Args: { _pin: string; _slug: string }
        Returns: {
          code: string
          consent: boolean
          created_at: string
          event_id: string
          form_data: Json
          id: string
          selfie_path: string | null
          source: string
        }[]
        SetofOptions: {
          from: "*"
          to: "guests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      verify_staff_pin: {
        Args: { _pin: string; _slug: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "staff" | "user"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "staff", "user"],
    },
  },
} as const

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      daily_scores: {
        Row: {
          answer: string | null
          created_at: string | null
          date: string
          guesses: string[]
          id: number
          player_id: string
        }
        Insert: {
          answer?: string | null
          created_at?: string | null
          date: string
          guesses?: string[]
          id?: number
          player_id: string
        }
        Update: {
          answer?: string | null
          created_at?: string | null
          date?: string
          guesses?: string[]
          id?: number
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_scores_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_winners: {
        Row: {
          has_seen_celebration: boolean
          id: number
          month: number
          player_id: string
          team_id: number
          year: number
        }
        Insert: {
          has_seen_celebration?: boolean
          id?: never
          month: number
          player_id: string
          team_id: number
          year: number
        }
        Update: {
          has_seen_celebration?: boolean
          id?: never
          month?: number
          player_id?: string
          team_id?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_winners_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_winners_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      player_customer: {
        Row: {
          customer_id: number | null
          id: string
          membership_status: Database["public"]["Enums"]["member_status"]
          membership_variant: number | null
          player_id: string
        }
        Insert: {
          customer_id?: number | null
          id?: string
          membership_status: Database["public"]["Enums"]["member_status"]
          membership_variant?: number | null
          player_id: string
        }
        Update: {
          customer_id?: number | null
          id?: string
          membership_status?: Database["public"]["Enums"]["member_status"]
          membership_variant?: number | null
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_customer_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string | null
          email: string
          first_name: string | null
          has_pwa: boolean
          id: string
          last_board_entry_reminder: string | null
          last_name: string | null
          reminder_delivery_methods: string[]
          reminder_delivery_time: string
          time_zone: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          first_name?: string | null
          has_pwa?: boolean
          id: string
          last_board_entry_reminder?: string | null
          last_name?: string | null
          reminder_delivery_methods?: string[]
          reminder_delivery_time?: string
          time_zone?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          first_name?: string | null
          has_pwa?: boolean
          id?: string
          last_board_entry_reminder?: string | null
          last_name?: string | null
          reminder_delivery_methods?: string[]
          reminder_delivery_time?: string
          time_zone?: string | null
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string | null
          creator: string | null
          failed: number
          five_guesses: number
          four_guesses: number
          id: number
          invited: string[]
          n_a: number
          name: string
          one_guess: number
          play_weekends: boolean
          player_ids: string[]
          show_letters: boolean
          six_guesses: number
          three_guesses: number
          two_guesses: number
        }
        Insert: {
          created_at?: string | null
          creator?: string | null
          failed?: number
          five_guesses?: number
          four_guesses?: number
          id?: number
          invited?: string[]
          n_a?: number
          name: string
          one_guess?: number
          play_weekends?: boolean
          player_ids?: string[]
          show_letters?: boolean
          six_guesses?: number
          three_guesses?: number
          two_guesses?: number
        }
        Update: {
          created_at?: string | null
          creator?: string | null
          failed?: number
          five_guesses?: number
          four_guesses?: number
          id?: number
          invited?: string[]
          n_a?: number
          name?: string
          one_guess?: number
          play_weekends?: boolean
          player_ids?: string[]
          show_letters?: boolean
          six_guesses?: number
          three_guesses?: number
          two_guesses?: number
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          body: Json
          created_at: string
          event_name: string
          id: number
          player_id: string
          processed: boolean
          processing_error: string | null
          webhook_id: string | null
        }
        Insert: {
          body: Json
          created_at?: string
          event_name: string
          id?: number
          player_id: string
          processed?: boolean
          processing_error?: string | null
          webhook_id?: string | null
        }
        Update: {
          body?: Json
          created_at?: string
          event_name?: string
          id?: number
          player_id?: string
          processed?: boolean
          processing_error?: string | null
          webhook_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      get_players_for_reminder: {
        Args: never
        Returns: {
          created_at: string | null
          email: string
          first_name: string | null
          has_pwa: boolean
          id: string
          last_board_entry_reminder: string | null
          last_name: string | null
          reminder_delivery_methods: string[]
          reminder_delivery_time: string
          time_zone: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "players"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      handle_add_player_to_team: {
        Args: { player_id_input: string; team_id_input: number }
        Returns: undefined
      }
      handle_downgrade_team_removal: {
        Args: { player_id_input: string }
        Returns: undefined
      }
      handle_invited_signup: {
        Args: { invited_email: string; invited_id: string }
        Returns: undefined
      }
      handle_upgrade_team_invites: {
        Args: { player_id_input: string }
        Returns: undefined
      }
      is_valid_timezone: { Args: { tz: string }; Returns: boolean }
      update_last_board_entry_reminder: {
        Args: { player_id_param: string }
        Returns: undefined
      }
      update_monthly_winners: {
        Args: { winners_data: Json[] }
        Returns: undefined
      }
      update_player_names: {
        Args: {
          email_to_update: string
          new_first_name: string
          new_last_name: string
        }
        Returns: undefined
      }
    }
    Enums: {
      member_status: "new" | "free" | "pro" | "cancelled" | "expired"
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
      member_status: ["new", "free", "pro", "cancelled", "expired"],
    },
  },
} as const


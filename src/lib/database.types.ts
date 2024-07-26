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
        Relationships: [
          {
            foreignKeyName: "players_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
          six_guesses?: number
          three_guesses?: number
          two_guesses?: number
        }
        Relationships: [
          {
            foreignKeyName: "teams_creator_fkey"
            columns: ["creator"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
      custom_access_token_hook: {
        Args: {
          event: Json
        }
        Returns: Json
      }
      get_players_for_reminder: {
        Args: Record<PropertyKey, never>
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
      }
      handle_add_player_to_team: {
        Args: {
          player_id_input: string
          team_id_input: number
        }
        Returns: undefined
      }
      handle_downgrade_team_removal: {
        Args: {
          player_id_input: string
        }
        Returns: undefined
      }
      handle_invited_signup: {
        Args: {
          invited_email: string
          invited_id: string
        }
        Returns: undefined
      }
      handle_upgrade_team_invites: {
        Args: {
          player_id_input: string
        }
        Returns: undefined
      }
      is_valid_timezone: {
        Args: {
          tz: string
        }
        Returns: boolean
      }
      update_last_board_entry_reminder: {
        Args: {
          player_id_param: string
        }
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

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never


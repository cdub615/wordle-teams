export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          operationName?: string
          query?: string
          variables?: Json
          extensions?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
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
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_insert_object: {
        Args: {
          bucketid: string
          name: string
          owner: string
          metadata: Json
        }
        Returns: undefined
      }
      extension: {
        Args: {
          name: string
        }
        Returns: string
      }
      filename: {
        Args: {
          name: string
        }
        Returns: string
      }
      foldername: {
        Args: {
          name: string
        }
        Returns: string[]
      }
      get_size_by_bucket: {
        Args: Record<PropertyKey, never>
        Returns: {
          size: number
          bucket_id: string
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          prefix_param: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
        }
        Returns: {
          key: string
          id: string
          created_at: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          bucket_id: string
          prefix_param: string
          delimiter_param: string
          max_keys?: number
          start_after?: string
          next_token?: string
        }
        Returns: {
          name: string
          id: string
          metadata: Json
          updated_at: string
        }[]
      }
      operation: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      search: {
        Args: {
          prefix: string
          bucketname: string
          limits?: number
          levels?: number
          offsets?: number
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          name: string
          id: string
          updated_at: string
          created_at: string
          last_accessed_at: string
          metadata: Json
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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


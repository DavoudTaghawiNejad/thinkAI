export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      ai_calls: {
        Row: {
          created_at: string;
          error_text: string | null;
          id: string;
          iteration_id: string | null;
          kind: string;
          latency_ms: number | null;
          model: string;
          raw_response: string | null;
          request_params: Json;
          run_id: string | null;
          run_ref: string | null;
          system_text: string;
          user_id: string;
          user_text: string;
        };
        Insert: {
          created_at?: string;
          error_text?: string | null;
          id?: string;
          iteration_id?: string | null;
          kind: string;
          latency_ms?: number | null;
          model: string;
          raw_response?: string | null;
          request_params?: Json;
          run_id?: string | null;
          run_ref?: string | null;
          system_text?: string;
          user_id: string;
          user_text?: string;
        };
        Update: {
          created_at?: string;
          error_text?: string | null;
          id?: string;
          iteration_id?: string | null;
          kind?: string;
          latency_ms?: number | null;
          model?: string;
          raw_response?: string | null;
          request_params?: Json;
          run_id?: string | null;
          run_ref?: string | null;
          system_text?: string;
          user_id?: string;
          user_text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_calls_iteration_id_fkey";
            columns: ["iteration_id"];
            isOneToOne: false;
            referencedRelation: "iterations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_calls_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "runs";
            referencedColumns: ["id"];
          },
        ];
      };
      invite_keys: {
        Row: {
          created_at: string;
          key: string;
        };
        Insert: {
          created_at?: string;
          key: string;
        };
        Update: {
          created_at?: string;
          key?: string;
        };
        Relationships: [];
      };
      iterations: {
        Row: {
          created_at: string;
          diagnosis: string | null;
          id: string;
          iteration_number: number;
          passed: boolean;
          prompt_snapshot: string;
          questions: Json;
          run_id: string;
          score: number | null;
          skipped: boolean;
          step_index: number;
          step_name: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          diagnosis?: string | null;
          id?: string;
          iteration_number: number;
          passed?: boolean;
          prompt_snapshot: string;
          questions?: Json;
          run_id: string;
          score?: number | null;
          skipped?: boolean;
          step_index: number;
          step_name: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          diagnosis?: string | null;
          id?: string;
          iteration_number?: number;
          passed?: boolean;
          prompt_snapshot?: string;
          questions?: Json;
          run_id?: string;
          score?: number | null;
          skipped?: boolean;
          step_index?: number;
          step_name?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "iterations_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "runs";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
        };
        Relationships: [];
      };
      runs: {
        Row: {
          created_at: string;
          current_prompt: string;
          final_answer: string | null;
          final_model: string | null;
          final_prompt: string | null;
          id: string;
          original_prompt: string;
          status: string;
          step_index: number;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          current_prompt: string;
          final_answer?: string | null;
          final_model?: string | null;
          final_prompt?: string | null;
          id?: string;
          original_prompt: string;
          status?: string;
          step_index?: number;
          title?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          current_prompt?: string;
          final_answer?: string | null;
          final_model?: string | null;
          final_prompt?: string | null;
          id?: string;
          original_prompt?: string;
          status?: string;
          step_index?: number;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          created_at: string;
          critic_instruction: string;
          critic_model: string;
          debug_mode: boolean;
          final_model: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          critic_instruction?: string;
          critic_model?: string;
          debug_mode?: boolean;
          final_model?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          critic_instruction?: string;
          critic_model?: string;
          debug_mode?: boolean;
          final_model?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      test_steps: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          instruction: string;
          max_iterations: number;
          name: string;
          pass_threshold: number;
          position: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string;
          id?: string;
          instruction: string;
          max_iterations?: number;
          name: string;
          pass_threshold?: number;
          position?: number;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          instruction?: string;
          max_iterations?: number;
          name?: string;
          pass_threshold?: number;
          position?: number;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;

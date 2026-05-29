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
      ai_insights: {
        Row: {
          generated_at: string
          id: string
          insight_text: string
          insight_type: string
          pharmacy_id: string | null
          prompt_context: Json
          user_id: string
        }
        Insert: {
          generated_at?: string
          id?: string
          insight_text: string
          insight_type: string
          pharmacy_id?: string | null
          prompt_context?: Json
          user_id: string
        }
        Update: {
          generated_at?: string
          id?: string
          insight_text?: string
          insight_type?: string
          pharmacy_id?: string | null
          prompt_context?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          accounts_type: string | null
          accounts_year: number | null
          avg_employees: number | null
          chain_name: string | null
          company_name: string | null
          company_number: string | null
          company_status: string | null
          created_at: string
          fetched_at: string | null
          gross_profit: number | null
          id: string
          incorporation_date: string | null
          is_chain: boolean | null
          last_accounts_date: string | null
          match_confidence: string | null
          matched_by: string | null
          net_assets: number | null
          net_profit: number | null
          operating_profit: number | null
          pharmacy_id: string | null
          raw_filing: Json | null
          registered_address: string | null
          registered_postcode: string | null
          sic_codes: string[] | null
          total_payroll: number | null
          turnover: number | null
        }
        Insert: {
          accounts_type?: string | null
          accounts_year?: number | null
          avg_employees?: number | null
          chain_name?: string | null
          company_name?: string | null
          company_number?: string | null
          company_status?: string | null
          created_at?: string
          fetched_at?: string | null
          gross_profit?: number | null
          id?: string
          incorporation_date?: string | null
          is_chain?: boolean | null
          last_accounts_date?: string | null
          match_confidence?: string | null
          matched_by?: string | null
          net_assets?: number | null
          net_profit?: number | null
          operating_profit?: number | null
          pharmacy_id?: string | null
          raw_filing?: Json | null
          registered_address?: string | null
          registered_postcode?: string | null
          sic_codes?: string[] | null
          total_payroll?: number | null
          turnover?: number | null
        }
        Update: {
          accounts_type?: string | null
          accounts_year?: number | null
          avg_employees?: number | null
          chain_name?: string | null
          company_name?: string | null
          company_number?: string | null
          company_status?: string | null
          created_at?: string
          fetched_at?: string | null
          gross_profit?: number | null
          id?: string
          incorporation_date?: string | null
          is_chain?: boolean | null
          last_accounts_date?: string | null
          match_confidence?: string | null
          matched_by?: string | null
          net_assets?: number | null
          net_profit?: number | null
          operating_profit?: number | null
          pharmacy_id?: string | null
          raw_filing?: Json | null
          registered_address?: string | null
          registered_postcode?: string | null
          sic_codes?: string[] | null
          total_payroll?: number | null
          turnover?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_match_queue: {
        Row: {
          candidate_address: string | null
          candidate_company_name: string | null
          candidate_company_number: string | null
          candidate_postcode: string | null
          created_at: string
          id: string
          match_score: number | null
          pharmacy_id: string | null
          status: string
        }
        Insert: {
          candidate_address?: string | null
          candidate_company_name?: string | null
          candidate_company_number?: string | null
          candidate_postcode?: string | null
          created_at?: string
          id?: string
          match_score?: number | null
          pharmacy_id?: string | null
          status?: string
        }
        Update: {
          candidate_address?: string | null
          candidate_company_name?: string | null
          candidate_company_number?: string | null
          candidate_postcode?: string | null
          created_at?: string
          id?: string
          match_score?: number | null
          pharmacy_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_match_queue_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      dispensing_data: {
        Row: {
          created_at: string
          data_source: string | null
          ehc_items: number
          eps_items: number
          eps_nominations: number
          final_payment: number
          flu_vaccinations: number
          gross_cost: number
          id: string
          is_actual_payment: boolean
          is_provisional: boolean
          items_dispensed: number
          mcr_items: number
          mcr_payment: number
          mcr_registrations: number
          methadone_items: number
          month: number
          nms_count: number
          pharmacy_first_count: number
          pharmacy_first_payment: number
          pharmacy_first_services: Json
          pharmacy_id: string
          smoking_cessation: number
          smoking_cessation_payment: number
          supervised_methadone_doses: number
          year: number
        }
        Insert: {
          created_at?: string
          data_source?: string | null
          ehc_items?: number
          eps_items?: number
          eps_nominations?: number
          final_payment?: number
          flu_vaccinations?: number
          gross_cost?: number
          id?: string
          is_actual_payment?: boolean
          is_provisional?: boolean
          items_dispensed?: number
          mcr_items?: number
          mcr_payment?: number
          mcr_registrations?: number
          methadone_items?: number
          month: number
          nms_count?: number
          pharmacy_first_count?: number
          pharmacy_first_payment?: number
          pharmacy_first_services?: Json
          pharmacy_id: string
          smoking_cessation?: number
          smoking_cessation_payment?: number
          supervised_methadone_doses?: number
          year: number
        }
        Update: {
          created_at?: string
          data_source?: string | null
          ehc_items?: number
          eps_items?: number
          eps_nominations?: number
          final_payment?: number
          flu_vaccinations?: number
          gross_cost?: number
          id?: string
          is_actual_payment?: boolean
          is_provisional?: boolean
          items_dispensed?: number
          mcr_items?: number
          mcr_payment?: number
          mcr_registrations?: number
          methadone_items?: number
          month?: number
          nms_count?: number
          pharmacy_first_count?: number
          pharmacy_first_payment?: number
          pharmacy_first_services?: Json
          pharmacy_id?: string
          smoking_cessation?: number
          smoking_cessation_payment?: number
          supervised_methadone_doses?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "dispensing_data_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      gp_dispensing_by_pharmacy: {
        Row: {
          created_at: string
          data_source: string | null
          gross_cost: number
          health_board: string | null
          id: string
          items_dispensed: number
          month: number
          pharmacy_name: string | null
          pharmacy_ods_code: string
          year: number
        }
        Insert: {
          created_at?: string
          data_source?: string | null
          gross_cost?: number
          health_board?: string | null
          id?: string
          items_dispensed?: number
          month: number
          pharmacy_name?: string | null
          pharmacy_ods_code: string
          year: number
        }
        Update: {
          created_at?: string
          data_source?: string | null
          gross_cost?: number
          health_board?: string | null
          id?: string
          items_dispensed?: number
          month?: number
          pharmacy_name?: string | null
          pharmacy_ods_code?: string
          year?: number
        }
        Relationships: []
      }
      gp_list_sizes: {
        Row: {
          country: string
          created_at: string
          data_source: string | null
          id: string
          list_size_date: string
          practice_code: string
          registered_patients: number
        }
        Insert: {
          country: string
          created_at?: string
          data_source?: string | null
          id?: string
          list_size_date: string
          practice_code: string
          registered_patients?: number
        }
        Update: {
          country?: string
          created_at?: string
          data_source?: string | null
          id?: string
          list_size_date?: string
          practice_code?: string
          registered_patients?: number
        }
        Relationships: []
      }
      gp_pharmacy_linkage: {
        Row: {
          created_at: string
          data_source: string | null
          id: string
          is_provisional: boolean
          items_dispensed: number
          month: number
          pharmacy_ods_code: string
          practice_code: string
          year: number
        }
        Insert: {
          created_at?: string
          data_source?: string | null
          id?: string
          is_provisional?: boolean
          items_dispensed?: number
          month: number
          pharmacy_ods_code: string
          practice_code: string
          year: number
        }
        Update: {
          created_at?: string
          data_source?: string | null
          id?: string
          is_provisional?: boolean
          items_dispensed?: number
          month?: number
          pharmacy_ods_code?: string
          practice_code?: string
          year?: number
        }
        Relationships: []
      }
      gp_practices: {
        Row: {
          address_line: string | null
          country: string | null
          created_at: string
          google_name: string | null
          google_place_id: string | null
          health_board: string | null
          lat: number | null
          lng: number | null
          name_verified_at: string | null
          postcode: string | null
          practice_code: string
          practice_name: string | null
          status_code: string | null
          updated_at: string
        }
        Insert: {
          address_line?: string | null
          country?: string | null
          created_at?: string
          google_name?: string | null
          google_place_id?: string | null
          health_board?: string | null
          lat?: number | null
          lng?: number | null
          name_verified_at?: string | null
          postcode?: string | null
          practice_code: string
          practice_name?: string | null
          status_code?: string | null
          updated_at?: string
        }
        Update: {
          address_line?: string | null
          country?: string | null
          created_at?: string
          google_name?: string | null
          google_place_id?: string | null
          health_board?: string | null
          lat?: number | null
          lng?: number | null
          name_verified_at?: string | null
          postcode?: string | null
          practice_code?: string
          practice_name?: string | null
          status_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      gp_prescribing: {
        Row: {
          country: string
          created_at: string
          data_source: string | null
          id: string
          is_provisional: boolean
          month: number
          practice_code: string
          total_items: number
          total_nic: number
          year: number
        }
        Insert: {
          country: string
          created_at?: string
          data_source?: string | null
          id?: string
          is_provisional?: boolean
          month: number
          practice_code: string
          total_items?: number
          total_nic?: number
          year: number
        }
        Update: {
          country?: string
          created_at?: string
          data_source?: string | null
          id?: string
          is_provisional?: boolean
          month?: number
          practice_code?: string
          total_items?: number
          total_nic?: number
          year?: number
        }
        Relationships: []
      }
      health_boards: {
        Row: {
          code: string
          country: string
          created_at: string
          name: string
        }
        Insert: {
          code: string
          country: string
          created_at?: string
          name: string
        }
        Update: {
          code?: string
          country?: string
          created_at?: string
          name?: string
        }
        Relationships: []
      }
      ingestion_log: {
        Row: {
          created_at: string
          dataset: string
          error: string | null
          id: string
          month: number | null
          resource_url: string
          rows_ingested: number
          source: string
          status: string
          year: number | null
        }
        Insert: {
          created_at?: string
          dataset: string
          error?: string | null
          id?: string
          month?: number | null
          resource_url: string
          rows_ingested?: number
          source: string
          status: string
          year?: number | null
        }
        Update: {
          created_at?: string
          dataset?: string
          error?: string | null
          id?: string
          month?: number | null
          resource_url?: string
          rows_ingested?: number
          source?: string
          status?: string
          year?: number | null
        }
        Relationships: []
      }
      ingestion_queue: {
        Row: {
          chunk_size: number | null
          created_at: string
          dataset: string
          error: string | null
          finished_at: string | null
          header_line: string | null
          id: string
          last_completed_chunk: number
          leftover_bytes: string
          month: number | null
          resource_url: string
          source: string
          started_at: string | null
          status: string
          total_bytes: number | null
          total_chunks: number | null
          year: number | null
        }
        Insert: {
          chunk_size?: number | null
          created_at?: string
          dataset: string
          error?: string | null
          finished_at?: string | null
          header_line?: string | null
          id?: string
          last_completed_chunk?: number
          leftover_bytes?: string
          month?: number | null
          resource_url: string
          source: string
          started_at?: string | null
          status?: string
          total_bytes?: number | null
          total_chunks?: number | null
          year?: number | null
        }
        Update: {
          chunk_size?: number | null
          created_at?: string
          dataset?: string
          error?: string | null
          finished_at?: string | null
          header_line?: string | null
          id?: string
          last_completed_chunk?: number
          leftover_bytes?: string
          month?: number | null
          resource_url?: string
          source?: string
          started_at?: string | null
          status?: string
          total_bytes?: number | null
          total_chunks?: number | null
          year?: number | null
        }
        Relationships: []
      }
      pharmacies: {
        Row: {
          address: string | null
          country: string | null
          created_at: string
          id: string
          name: string
          ods_code: string
          postcode: string | null
          region: string | null
          type: string | null
        }
        Insert: {
          address?: string | null
          country?: string | null
          created_at?: string
          id?: string
          name: string
          ods_code: string
          postcode?: string | null
          region?: string | null
          type?: string | null
        }
        Update: {
          address?: string | null
          country?: string | null
          created_at?: string
          id?: string
          name?: string
          ods_code?: string
          postcode?: string | null
          region?: string | null
          type?: string | null
        }
        Relationships: []
      }
      private_uploads: {
        Row: {
          created_at: string
          file_name: string
          id: string
          parsed_data: Json
          period_end: string | null
          period_start: string | null
          pharmacy_id: string | null
          upload_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          parsed_data?: Json
          period_end?: string | null
          period_start?: string | null
          pharmacy_id?: string | null
          upload_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          parsed_data?: Json
          period_end?: string | null
          period_start?: string | null
          pharmacy_id?: string | null
          upload_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "private_uploads_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          role: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          role?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          role?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      saved_analyses: {
        Row: {
          created_at: string
          id: string
          is_shortlisted: boolean
          notes: string | null
          pharmacy_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_shortlisted?: boolean
          notes?: string | null
          pharmacy_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_shortlisted?: boolean
          notes?: string | null
          pharmacy_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_analyses_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_alerts: {
        Row: {
          available_headers: string[]
          created_at: string
          dataset: string | null
          id: string
          missing_field: string
          resource_url: string | null
          source: string
          tried_variants: string[]
        }
        Insert: {
          available_headers?: string[]
          created_at?: string
          dataset?: string | null
          id?: string
          missing_field: string
          resource_url?: string | null
          source: string
          tried_variants?: string[]
        }
        Update: {
          available_headers?: string[]
          created_at?: string
          dataset?: string | null
          id?: string
          missing_field?: string
          resource_url?: string | null
          source?: string
          tried_variants?: string[]
        }
        Relationships: []
      }
      user_pharmacy: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          pharmacy_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          pharmacy_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          pharmacy_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_pharmacy_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      country_monthly_aggregates: {
        Args: {
          p_country: string
          p_end_month: number
          p_end_year: number
          p_start_month: number
          p_start_year: number
        }
        Returns: {
          avg_items: number
          avg_nms: number
          avg_pf: number
          month: number
          pharmacy_count: number
          total_items: number
          year: number
        }[]
      }
      country_split_for_period: {
        Args: { p_month: number; p_year: number }
        Returns: {
          country: string
          total_items: number
        }[]
      }
      gp_practices_near: {
        Args: {
          p_lat: number
          p_limit?: number
          p_lng: number
          p_radius_m?: number
        }
        Returns: {
          address_line: string
          distance_m: number
          google_place_id: string
          lat: number
          lng: number
          postcode: string
          practice_code: string
          practice_name: string
        }[]
      }
      gp_prescribing_add: { Args: { rows: Json }; Returns: number }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

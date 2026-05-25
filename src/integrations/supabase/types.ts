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
      analytics_events: {
        Row: {
          company_id: string | null
          event_name: string
          id: string
          is_pwa: boolean | null
          occurred_at: string
          path: string | null
          props: Json | null
          referrer: string | null
          session_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          event_name: string
          id?: string
          is_pwa?: boolean | null
          occurred_at?: string
          path?: string | null
          props?: Json | null
          referrer?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          event_name?: string
          id?: string
          is_pwa?: boolean | null
          occurred_at?: string
          path?: string | null
          props?: Json | null
          referrer?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: []
      }
      app_errors: {
        Row: {
          company_id: string | null
          context: Json | null
          created_at: string
          id: string
          message: string
          resolved: boolean
          severity: string
          source: string
          stack: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          message: string
          resolved?: boolean
          severity?: string
          source: string
          stack?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          message?: string
          resolved?: boolean
          severity?: string
          source?: string
          stack?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          company_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          metadata: Json | null
          new_values: Json | null
          old_values: Json | null
          pv_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          pv_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          pv_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      chantiers: {
        Row: {
          address: string | null
          client_id: string | null
          company_id: string | null
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          name: string
          owner_id: string
          start_date: string | null
          status: string
          type: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          client_id?: string | null
          company_id?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          owner_id: string
          start_date?: string | null
          status?: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          client_id?: string | null
          company_id?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          owner_id?: string
          start_date?: string | null
          status?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chantiers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chantiers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      client_auth_codes: {
        Row: {
          attempts: number
          client_id: string | null
          code_hash: string
          created_at: string
          email: string
          expires_at: string
          id: string
          ip_address: string | null
          used_at: string | null
          user_agent: string | null
        }
        Insert: {
          attempts?: number
          client_id?: string | null
          code_hash: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          ip_address?: string | null
          used_at?: string | null
          user_agent?: string | null
        }
        Update: {
          attempts?: number
          client_id?: string | null
          code_hash?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          used_at?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      client_sessions: {
        Row: {
          client_id: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          ip_address: string | null
          last_seen_at: string
          revoked_at: string | null
          token_hash: string
          user_agent: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          ip_address?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          token_hash: string
          user_agent?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          token_hash?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          address: string | null
          company_id: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          owner_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          owner_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          id: string
          legal_form: string | null
          logo_url: string | null
          name: string
          onboarding_completed_at: string | null
          phone: string | null
          postal_code: string | null
          siren: string | null
          siret: string | null
          updated_at: string
          vat_number: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          legal_form?: string | null
          logo_url?: string | null
          name: string
          onboarding_completed_at?: string | null
          phone?: string | null
          postal_code?: string | null
          siren?: string | null
          siret?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          legal_form?: string | null
          logo_url?: string | null
          name?: string
          onboarding_completed_at?: string | null
          phone?: string | null
          postal_code?: string | null
          siren?: string | null
          siret?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Relationships: []
      }
      company_branding_versions: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          settings_snapshot: Json
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          settings_snapshot: Json
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          settings_snapshot?: Json
        }
        Relationships: []
      }
      company_members: {
        Row: {
          accepted_at: string | null
          company_id: string
          created_at: string
          id: string
          invite_expires_at: string | null
          invite_token: string | null
          invited_by: string | null
          invited_email: string | null
          role: Database["public"]["Enums"]["company_role"]
          status: Database["public"]["Enums"]["member_status"]
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          company_id: string
          created_at?: string
          id?: string
          invite_expires_at?: string | null
          invite_token?: string | null
          invited_by?: string | null
          invited_email?: string | null
          role?: Database["public"]["Enums"]["company_role"]
          status?: Database["public"]["Enums"]["member_status"]
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          company_id?: string
          created_at?: string
          id?: string
          invite_expires_at?: string | null
          invite_token?: string | null
          invited_by?: string | null
          invited_email?: string | null
          role?: Database["public"]["Enums"]["company_role"]
          status?: Database["public"]["Enums"]["member_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          brand_color: string
          company_id: string
          currency: string
          custom_css: string | null
          date_format: string
          email_brand_color: string | null
          email_footer: string
          email_signature: string | null
          locale: string
          pdf_brand_color: string | null
          pdf_footer: string
          pdf_watermark: string
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          brand_color?: string
          company_id: string
          currency?: string
          custom_css?: string | null
          date_format?: string
          email_brand_color?: string | null
          email_footer?: string
          email_signature?: string | null
          locale?: string
          pdf_brand_color?: string | null
          pdf_footer?: string
          pdf_watermark?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          brand_color?: string
          company_id?: string
          currency?: string
          custom_css?: string | null
          date_format?: string
          email_brand_color?: string | null
          email_footer?: string
          email_signature?: string | null
          locale?: string
          pdf_brand_color?: string | null
          pdf_footer?: string
          pdf_watermark?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      email_logs: {
        Row: {
          company_id: string | null
          created_at: string
          email_type: string
          error_message: string | null
          id: string
          pv_id: string | null
          recipient_email: string
          resend_id: string | null
          sent_at: string | null
          status: string
          subject: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          email_type: string
          error_message?: string | null
          id?: string
          pv_id?: string | null
          recipient_email: string
          resend_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          email_type?: string
          error_message?: string | null
          id?: string
          pv_id?: string | null
          recipient_email?: string
          resend_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      integration_calendar_tokens: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          last_accessed_at: string | null
          name: string
          revoked_at: string | null
          scope: string
          token: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_accessed_at?: string | null
          name?: string
          revoked_at?: string | null
          scope?: string
          token: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_accessed_at?: string | null
          name?: string
          revoked_at?: string | null
          scope?: string
          token?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          company_id: string
          created_at: string
          id: string
          read: boolean
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          company_id: string
          created_at?: string
          id?: string
          read?: boolean
          title: string
          type?: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          company_id?: string
          created_at?: string
          id?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_limits: {
        Row: {
          can_advanced_stats: boolean
          can_branding: boolean
          can_export_audit: boolean
          can_remote_sign: boolean
          created_at: string
          display_name: string
          max_members: number | null
          max_pv_per_month: number | null
          monthly_price_eur: number
          plan: string
          updated_at: string
        }
        Insert: {
          can_advanced_stats?: boolean
          can_branding?: boolean
          can_export_audit?: boolean
          can_remote_sign?: boolean
          created_at?: string
          display_name: string
          max_members?: number | null
          max_pv_per_month?: number | null
          monthly_price_eur?: number
          plan: string
          updated_at?: string
        }
        Update: {
          can_advanced_stats?: boolean
          can_branding?: boolean
          can_export_audit?: boolean
          can_remote_sign?: boolean
          created_at?: string
          display_name?: string
          max_members?: number | null
          max_pv_per_month?: number | null
          monthly_price_eur?: number
          plan?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_name: string | null
          created_at: string
          first_name: string | null
          full_name: string | null
          id: string
          job_title: string | null
          last_name: string | null
          onboarding_completed_at: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          first_name?: string | null
          full_name?: string | null
          id: string
          job_title?: string | null
          last_name?: string | null
          onboarding_completed_at?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          onboarding_completed_at?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          company_id: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          company_id: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          company_id?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      pv: {
        Row: {
          chantier_id: string | null
          client_id: string | null
          client_signature: string | null
          company_id: string | null
          company_signature: string | null
          created_at: string
          description: string | null
          field_last_saved_at: string | null
          id: string
          is_field_draft: boolean
          latitude: number | null
          longitude: number | null
          numero: string
          observations: string | null
          owner_id: string
          pdf_generated_at: string | null
          pdf_url: string | null
          reception_date: string | null
          sent_to_client_at: string | null
          sent_to_email: string | null
          sign_token: string | null
          sign_token_expires_at: string | null
          signed_at: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          chantier_id?: string | null
          client_id?: string | null
          client_signature?: string | null
          company_id?: string | null
          company_signature?: string | null
          created_at?: string
          description?: string | null
          field_last_saved_at?: string | null
          id?: string
          is_field_draft?: boolean
          latitude?: number | null
          longitude?: number | null
          numero: string
          observations?: string | null
          owner_id: string
          pdf_generated_at?: string | null
          pdf_url?: string | null
          reception_date?: string | null
          sent_to_client_at?: string | null
          sent_to_email?: string | null
          sign_token?: string | null
          sign_token_expires_at?: string | null
          signed_at?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          chantier_id?: string | null
          client_id?: string | null
          client_signature?: string | null
          company_id?: string | null
          company_signature?: string | null
          created_at?: string
          description?: string | null
          field_last_saved_at?: string | null
          id?: string
          is_field_draft?: boolean
          latitude?: number | null
          longitude?: number | null
          numero?: string
          observations?: string | null
          owner_id?: string
          pdf_generated_at?: string | null
          pdf_url?: string | null
          reception_date?: string | null
          sent_to_client_at?: string | null
          sent_to_email?: string | null
          sign_token?: string | null
          sign_token_expires_at?: string | null
          signed_at?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pv_chantier_id_fkey"
            columns: ["chantier_id"]
            isOneToOne: false
            referencedRelation: "chantiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pv_photos: {
        Row: {
          caption: string | null
          company_id: string | null
          created_at: string
          id: string
          kind: string
          owner_id: string
          pv_id: string
          url: string
        }
        Insert: {
          caption?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          owner_id: string
          pv_id: string
          url: string
        }
        Update: {
          caption?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          owner_id?: string
          pv_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "pv_photos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_photos_pv_id_fkey"
            columns: ["pv_id"]
            isOneToOne: false
            referencedRelation: "pv"
            referencedColumns: ["id"]
          },
        ]
      }
      pv_reserves: {
        Row: {
          company_id: string | null
          created_at: string
          description: string
          id: string
          owner_id: string
          pv_id: string
          severity: string
          status: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          description: string
          id?: string
          owner_id: string
          pv_id: string
          severity?: string
          status?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          description?: string
          id?: string
          owner_id?: string
          pv_id?: string
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pv_reserves_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_reserves_pv_id_fkey"
            columns: ["pv_id"]
            isOneToOne: false
            referencedRelation: "pv"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          created_at: string
          id: string
          key: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          created_at?: string
          id?: string
          key: string
          window_start?: string
        }
        Update: {
          bucket?: string
          count?: number
          created_at?: string
          id?: string
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          company_id: string
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          plan: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          company_id: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          plan: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          company_id?: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_fkey"
            columns: ["plan"]
            isOneToOne: false
            referencedRelation: "plan_limits"
            referencedColumns: ["plan"]
          },
        ]
      }
      user_preferences: {
        Row: {
          animations_enabled: boolean
          dark_mode_enabled: boolean
          onboarding_tips_enabled: boolean
          sounds_enabled: boolean
          ui_density: string
          updated_at: string
          user_id: string
        }
        Insert: {
          animations_enabled?: boolean
          dark_mode_enabled?: boolean
          onboarding_tips_enabled?: boolean
          sounds_enabled?: boolean
          ui_density?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          animations_enabled?: boolean
          dark_mode_enabled?: boolean
          onboarding_tips_enabled?: boolean
          sounds_enabled?: boolean
          ui_density?: string
          updated_at?: string
          user_id?: string
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
      webhook_deliveries: {
        Row: {
          attempts: number
          company_id: string
          created_at: string
          delivered_at: string | null
          error: string | null
          event: string
          id: string
          next_attempt_at: string
          payload: Json
          response_body: string | null
          response_code: number | null
          status: string
          webhook_id: string
        }
        Insert: {
          attempts?: number
          company_id: string
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          event: string
          id?: string
          next_attempt_at?: string
          payload: Json
          response_body?: string | null
          response_code?: number | null
          status?: string
          webhook_id: string
        }
        Update: {
          attempts?: number
          company_id?: string
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          event?: string
          id?: string
          next_attempt_at?: string
          payload?: Json
          response_body?: string | null
          response_code?: number | null
          status?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          delivery_format: string
          description: string | null
          enabled: boolean
          events: string[]
          failure_count: number
          id: string
          last_delivery_at: string | null
          last_status: number | null
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          delivery_format?: string
          description?: string | null
          enabled?: boolean
          events?: string[]
          failure_count?: number
          id?: string
          last_delivery_at?: string | null
          last_status?: number | null
          secret: string
          updated_at?: string
          url: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          delivery_format?: string
          description?: string | null
          enabled?: boolean
          events?: string[]
          failure_count?: number
          id?: string
          last_delivery_at?: string | null
          last_status?: number | null
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_add_member: { Args: { _company_id: string }; Returns: boolean }
      can_create_pv: { Args: { _company_id: string }; Returns: boolean }
      can_manage_company: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      cleanup_analytics_events: { Args: never; Returns: undefined }
      cleanup_client_auth: { Args: never; Returns: undefined }
      cleanup_rate_limits: { Args: never; Returns: number }
      enqueue_webhook_event: {
        Args: { _company_id: string; _event: string; _payload: Json }
        Returns: undefined
      }
      get_company_limits: {
        Args: { _company_id: string }
        Returns: {
          can_advanced_stats: boolean
          can_branding: boolean
          can_export_audit: boolean
          can_remote_sign: boolean
          created_at: string
          display_name: string
          max_members: number | null
          max_pv_per_month: number | null
          monthly_price_eur: number
          plan: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "plan_limits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_company_member_count: {
        Args: { _company_id: string }
        Returns: number
      }
      get_company_plan: { Args: { _company_id: string }; Returns: string }
      get_company_pv_count_current_period: {
        Args: { _company_id: string }
        Returns: number
      }
      get_company_role: {
        Args: { _company_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["company_role"]
      }
      has_plan_feature: {
        Args: { _company_id: string; _feature: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_company_admin: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_owner: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "user"
      company_role: "owner" | "admin" | "manager" | "user"
      member_status: "active" | "invited" | "suspended"
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
      app_role: ["admin", "manager", "user"],
      company_role: ["owner", "admin", "manager", "user"],
      member_status: ["active", "invited", "suspended"],
    },
  },
} as const

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
      carrier_state: {
        Row: {
          channel_id: string
          faltante: number
          pedido: number
          producido: number
          sku: string
          stock: number
          updated_at: string
        }
        Insert: {
          channel_id: string
          faltante?: number
          pedido?: number
          producido?: number
          sku: string
          stock?: number
          updated_at?: string
        }
        Update: {
          channel_id?: string
          faltante?: number
          pedido?: number
          producido?: number
          sku?: string
          stock?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_state_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_state_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "view_dashboard_kpis"
            referencedColumns: ["channel_id"]
          },
          {
            foreignKeyName: "carrier_state_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "sku_catalog"
            referencedColumns: ["sku"]
          },
        ]
      }
      channels: {
        Row: {
          bg: string
          cierre_hora: string | null
          color: string
          created_at: string
          id: string
          label: string
          sort_order: number
          sub: string | null
          tipo_cierre: Database["public"]["Enums"]["cierre_enum"]
          updated_at: string
        }
        Insert: {
          bg: string
          cierre_hora?: string | null
          color: string
          created_at?: string
          id: string
          label: string
          sort_order?: number
          sub?: string | null
          tipo_cierre?: Database["public"]["Enums"]["cierre_enum"]
          updated_at?: string
        }
        Update: {
          bg?: string
          cierre_hora?: string | null
          color?: string
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
          sub?: string | null
          tipo_cierre?: Database["public"]["Enums"]["cierre_enum"]
          updated_at?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          channel_id: string
          file_hash: string
          filename: string
          id: string
          imported_at: string
          imported_by: string
          pedidos_count: number
          skus_desconocidos: string[]
          storage_path: string | null
          unidades_count: number
        }
        Insert: {
          channel_id: string
          file_hash: string
          filename: string
          id?: string
          imported_at?: string
          imported_by: string
          pedidos_count?: number
          skus_desconocidos?: string[]
          storage_path?: string | null
          unidades_count?: number
        }
        Update: {
          channel_id?: string
          file_hash?: string
          filename?: string
          id?: string
          imported_at?: string
          imported_by?: string
          pedidos_count?: number
          skus_desconocidos?: string[]
          storage_path?: string | null
          unidades_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "view_dashboard_kpis"
            referencedColumns: ["channel_id"]
          },
          {
            foreignKeyName: "import_batches_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jornadas: {
        Row: {
          channel_id: string
          closed_at: string
          closed_by: string
          faltante_arrastrado: number
          fecha: string
          id: string
          pedidos_count: number
          snapshot: Json
          unidades_pedidas: number
          unidades_producidas: number
        }
        Insert: {
          channel_id: string
          closed_at?: string
          closed_by: string
          faltante_arrastrado?: number
          fecha: string
          id?: string
          pedidos_count?: number
          snapshot: Json
          unidades_pedidas?: number
          unidades_producidas?: number
        }
        Update: {
          channel_id?: string
          closed_at?: string
          closed_by?: string
          faltante_arrastrado?: number
          fecha?: string
          id?: string
          pedidos_count?: number
          snapshot?: Json
          unidades_pedidas?: number
          unidades_producidas?: number
        }
        Relationships: [
          {
            foreignKeyName: "jornadas_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jornadas_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "view_dashboard_kpis"
            referencedColumns: ["channel_id"]
          },
          {
            foreignKeyName: "jornadas_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          leida: boolean
          link: string | null
          mensaje: string
          tipo: Database["public"]["Enums"]["notif_type_enum"]
          titulo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          leida?: boolean
          link?: string | null
          mensaje: string
          tipo: Database["public"]["Enums"]["notif_type_enum"]
          titulo: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          leida?: boolean
          link?: string | null
          mensaje?: string
          tipo?: Database["public"]["Enums"]["notif_type_enum"]
          titulo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cantidad: number
          channel_id: string
          cliente: string | null
          created_at: string
          fecha_pedido: string
          id: string
          import_batch_id: string | null
          jornada_id: string | null
          order_number: string
          sku: string
          status: Database["public"]["Enums"]["order_status_enum"]
        }
        Insert: {
          cantidad: number
          channel_id: string
          cliente?: string | null
          created_at?: string
          fecha_pedido?: string
          id?: string
          import_batch_id?: string | null
          jornada_id?: string | null
          order_number: string
          sku: string
          status?: Database["public"]["Enums"]["order_status_enum"]
        }
        Update: {
          cantidad?: number
          channel_id?: string
          cliente?: string | null
          created_at?: string
          fecha_pedido?: string
          id?: string
          import_batch_id?: string | null
          jornada_id?: string | null
          order_number?: string
          sku?: string
          status?: Database["public"]["Enums"]["order_status_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "orders_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "view_dashboard_kpis"
            referencedColumns: ["channel_id"]
          },
          {
            foreignKeyName: "orders_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_jornada_id_fkey"
            columns: ["jornada_id"]
            isOneToOne: false
            referencedRelation: "jornadas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "sku_catalog"
            referencedColumns: ["sku"]
          },
        ]
      }
      production_logs: {
        Row: {
          cantidad: number
          channel_id: string
          created_at: string
          fecha: string
          hora: string
          id: string
          notas: string | null
          operario_id: string
          sector: string
          sku: string
        }
        Insert: {
          cantidad: number
          channel_id: string
          created_at?: string
          fecha?: string
          hora?: string
          id?: string
          notas?: string | null
          operario_id: string
          sector: string
          sku: string
        }
        Update: {
          cantidad?: number
          channel_id?: string
          created_at?: string
          fecha?: string
          hora?: string
          id?: string
          notas?: string | null
          operario_id?: string
          sector?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_logs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_logs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "view_dashboard_kpis"
            referencedColumns: ["channel_id"]
          },
          {
            foreignKeyName: "production_logs_operario_id_fkey"
            columns: ["operario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_logs_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "sku_catalog"
            referencedColumns: ["sku"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          area: string | null
          avatar_color: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          role: Database["public"]["Enums"]["role_enum"]
          updated_at: string
          username: string
        }
        Insert: {
          active?: boolean
          area?: string | null
          avatar_color?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id: string
          name: string
          role?: Database["public"]["Enums"]["role_enum"]
          updated_at?: string
          username: string
        }
        Update: {
          active?: boolean
          area?: string | null
          avatar_color?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          role?: Database["public"]["Enums"]["role_enum"]
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_scans: {
        Row: {
          code: string
          id: string
          operario_id: string
          order_id: string | null
          scanned_at: string
          sku: string | null
        }
        Insert: {
          code: string
          id?: string
          operario_id: string
          order_id?: string | null
          scanned_at?: string
          sku?: string | null
        }
        Update: {
          code?: string
          id?: string
          operario_id?: string
          order_id?: string | null
          scanned_at?: string
          sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_scans_operario_id_fkey"
            columns: ["operario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scans_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scans_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "sku_catalog"
            referencedColumns: ["sku"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          items: string[]
          landing: string
          role: Database["public"]["Enums"]["role_enum"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          items?: string[]
          landing: string
          role: Database["public"]["Enums"]["role_enum"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          items?: string[]
          landing?: string
          role?: Database["public"]["Enums"]["role_enum"]
          updated_at?: string
        }
        Relationships: []
      }
      sku_catalog: {
        Row: {
          activo: boolean
          categoria: string
          color: string | null
          color_hex: string | null
          created_at: string
          es_fabricado: boolean
          modelo: string
          sku: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          categoria: string
          color?: string | null
          color_hex?: string | null
          created_at?: string
          es_fabricado?: boolean
          modelo: string
          sku: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          categoria?: string
          color?: string | null
          color_hex?: string | null
          created_at?: string
          es_fabricado?: boolean
          modelo?: string
          sku?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sku_catalog_categoria_fkey"
            columns: ["categoria"]
            isOneToOne: false
            referencedRelation: "sku_categories"
            referencedColumns: ["name"]
          },
        ]
      }
      sku_categories: {
        Row: {
          created_at: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
    }
    Views: {
      view_carrier_with_meta: {
        Row: {
          categoria: string | null
          channel_id: string | null
          color: string | null
          color_hex: string | null
          es_fabricado: boolean | null
          faltante: number | null
          modelo: string | null
          pedido: number | null
          producido: number | null
          sku: string | null
          sku_activo: boolean | null
          stock: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carrier_state_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_state_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "view_dashboard_kpis"
            referencedColumns: ["channel_id"]
          },
          {
            foreignKeyName: "carrier_state_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "sku_catalog"
            referencedColumns: ["sku"]
          },
          {
            foreignKeyName: "sku_catalog_categoria_fkey"
            columns: ["categoria"]
            isOneToOne: false
            referencedRelation: "sku_categories"
            referencedColumns: ["name"]
          },
        ]
      }
      view_dashboard_kpis: {
        Row: {
          channel_id: string | null
          cierre_hora: string | null
          color: string | null
          faltante_total: number | null
          label: string | null
          producido_hoy: number | null
          producido_total: number | null
          skus_con_faltante: number | null
          stock_total: number | null
          tipo_cierre: Database["public"]["Enums"]["cierre_enum"] | null
          unidades_activas: number | null
        }
        Relationships: []
      }
      view_historico_dia: {
        Row: {
          channel_color: string | null
          channel_id: string | null
          channel_label: string | null
          fecha: string | null
          operarios_distintos: number | null
          registros: number | null
          skus_distintos: number | null
          unidades: number | null
        }
        Relationships: [
          {
            foreignKeyName: "production_logs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_logs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "view_dashboard_kpis"
            referencedColumns: ["channel_id"]
          },
        ]
      }
    }
    Functions: {
      current_user_profile: {
        Args: never
        Returns: {
          active: boolean
          area: string | null
          avatar_color: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          role: Database["public"]["Enums"]["role_enum"]
          updated_at: string
          username: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["role_enum"]
      }
      is_active_user: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      is_owner_or_admin: { Args: never; Returns: boolean }
      recompute_carrier_state_for: {
        Args: { p_channel_id: string; p_sku: string }
        Returns: undefined
      }
      resolve_username_to_email: {
        Args: { p_username: string }
        Returns: string
      }
      role_to_sector: {
        Args: { p_role: Database["public"]["Enums"]["role_enum"] }
        Returns: string
      }
      rpc_close_jornada: {
        Args: { p_channel_id: string; p_fecha?: string }
        Returns: {
          channel_id: string
          closed_at: string
          closed_by: string
          faltante_arrastrado: number
          fecha: string
          id: string
          pedidos_count: number
          snapshot: Json
          unidades_pedidas: number
          unidades_producidas: number
        }
        SetofOptions: {
          from: "*"
          to: "jornadas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_import_batch: {
        Args: {
          p_channel_id: string
          p_file_hash: string
          p_filename: string
          p_items: Json
          p_storage_path?: string
        }
        Returns: Json
      }
      rpc_register_production: {
        Args: {
          p_cantidad: number
          p_channel_id: string
          p_notas?: string
          p_sku: string
        }
        Returns: {
          cantidad: number
          channel_id: string
          created_at: string
          fecha: string
          hora: string
          id: string
          notas: string | null
          operario_id: string
          sector: string
          sku: string
        }
        SetofOptions: {
          from: "*"
          to: "production_logs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      cierre_enum: "horario" | "flexible"
      notif_type_enum:
        | "stock_critico"
        | "pedido_urgente"
        | "nuevo_pedido"
        | "produccion"
        | "sistema"
      order_status_enum: "pendiente" | "completado" | "arrastrado" | "archivado"
      role_enum:
        | "owner"
        | "admin"
        | "encargado"
        | "ventas"
        | "cnc"
        | "melamina"
        | "pino"
        | "embalaje"
        | "carpinteria"
        | "logistica"
        | "marketing"
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
      cierre_enum: ["horario", "flexible"],
      notif_type_enum: [
        "stock_critico",
        "pedido_urgente",
        "nuevo_pedido",
        "produccion",
        "sistema",
      ],
      order_status_enum: ["pendiente", "completado", "arrastrado", "archivado"],
      role_enum: [
        "owner",
        "admin",
        "encargado",
        "ventas",
        "cnc",
        "melamina",
        "pino",
        "embalaje",
        "carpinteria",
        "logistica",
        "marketing",
      ],
    },
  },
} as const

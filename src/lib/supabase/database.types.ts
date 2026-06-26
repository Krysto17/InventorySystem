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
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
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
      advance_deductions: {
        Row: {
          amount: number
          created_at: string
          id: string
          notes: string | null
          recorded_by: string | null
          ref_visit_id: string | null
          site_id: string
          supplier_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          notes?: string | null
          recorded_by?: string | null
          ref_visit_id?: string | null
          site_id: string
          supplier_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          recorded_by?: string | null
          ref_visit_id?: string | null
          site_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "advance_deductions_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advance_deductions_ref_visit_id_fkey"
            columns: ["ref_visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advance_deductions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advance_deductions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      advances: {
        Row: {
          amount_naira: number
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          comment: string | null
          created_at: string
          id: string
          paid_at: string | null
          paid_by: string | null
          purpose: string
          recorded_by: string | null
          rejection_note: string | null
          site_id: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          amount_naira: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          purpose: string
          recorded_by?: string | null
          rejection_note?: string | null
          site_id: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          amount_naira?: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          purpose?: string
          recorded_by?: string | null
          rejection_note?: string | null
          site_id?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "advances_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_records: {
        Row: {
          analyzed_at: string | null
          created_at: string
          grade: string | null
          id: string
          purity: number | null
          qc_observations: string | null
          recorded_by: string
          sample_id: string | null
          updated_at: string
          visit_id: string
          weight: number
          xrf_result: Json | null
        }
        Insert: {
          analyzed_at?: string | null
          created_at?: string
          grade?: string | null
          id?: string
          purity?: number | null
          qc_observations?: string | null
          recorded_by: string
          sample_id?: string | null
          updated_at?: string
          visit_id: string
          weight: number
          xrf_result?: Json | null
        }
        Update: {
          analyzed_at?: string | null
          created_at?: string
          grade?: string | null
          id?: string
          purity?: number | null
          qc_observations?: string | null
          recorded_by?: string
          sample_id?: string | null
          updated_at?: string
          visit_id?: string
          weight?: number
          xrf_result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "analysis_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_records_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_settlements: {
        Row: {
          advance_deducted: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          light_bill_total: number
          materials_total: number
          net_balance: number
          paid_at: string | null
          paid_by: string | null
          rejection_note: string | null
          remaining_debt: number
          site_id: string
          status: string
          submitted_by: string | null
          updated_at: string
          visit_id: string
        }
        Insert: {
          advance_deducted?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          light_bill_total?: number
          materials_total?: number
          net_balance?: number
          paid_at?: string | null
          paid_by?: string | null
          rejection_note?: string | null
          remaining_debt?: number
          site_id: string
          status?: string
          submitted_by?: string | null
          updated_at?: string
          visit_id: string
        }
        Update: {
          advance_deducted?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          light_bill_total?: number
          materials_total?: number
          net_balance?: number
          paid_at?: string | null
          paid_by?: string | null
          rejection_note?: string | null
          remaining_debt?: number
          site_id?: string
          status?: string
          submitted_by?: string | null
          updated_at?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_settlements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_settlements_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_settlements_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_settlements_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_settlements_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_sales: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          buyer_name: string
          buyer_phone: string | null
          created_at: string
          grade: string | null
          id: string
          material_type_id: string
          received_amount: number | null
          recorded_by: string | null
          rejection_note: string | null
          site_id: string
          sold_at: string
          total: number | null
          unit_price: number
          weight: number
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          buyer_name: string
          buyer_phone?: string | null
          created_at?: string
          grade?: string | null
          id?: string
          material_type_id: string
          received_amount?: number | null
          recorded_by?: string | null
          rejection_note?: string | null
          site_id: string
          sold_at?: string
          total?: number | null
          unit_price: number
          weight: number
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          buyer_name?: string
          buyer_phone?: string | null
          created_at?: string
          grade?: string | null
          id?: string
          material_type_id?: string
          received_amount?: number | null
          recorded_by?: string | null
          rejection_note?: string | null
          site_id?: string
          sold_at?: string
          total?: number | null
          unit_price?: number
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "bulk_sales_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_sales_material_type_id_fkey"
            columns: ["material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_sales_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_sales_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      consumables: {
        Row: {
          amount_naira: number | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          category: string
          comment: string | null
          created_at: string
          entry_date: string
          id: string
          name: string
          paid_at: string | null
          paid_by: string | null
          recorded_by: string | null
          site_id: string
        }
        Insert: {
          amount_naira?: number | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          category: string
          comment?: string | null
          created_at?: string
          entry_date?: string
          id?: string
          name: string
          paid_at?: string | null
          paid_by?: string | null
          recorded_by?: string | null
          site_id: string
        }
        Update: {
          amount_naira?: number | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          comment?: string | null
          created_at?: string
          entry_date?: string
          id?: string
          name?: string
          paid_at?: string | null
          paid_by?: string | null
          recorded_by?: string | null
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consumables_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumables_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumables_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumables_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_price_run_lots: {
        Row: {
          run_id: string
          stock_lot_id: string
        }
        Insert: {
          run_id: string
          stock_lot_id: string
        }
        Update: {
          run_id?: string
          stock_lot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_price_run_lots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "cost_price_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_price_run_lots_stock_lot_id_fkey"
            columns: ["stock_lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_price_runs: {
        Row: {
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          avg_cost_price_per_kg: number | null
          batch_code: string | null
          created_at: string
          created_by: string | null
          id: string
          label: string
          material_type_id: string | null
          rejection_note: string | null
          site_id: string
          sold: boolean
          sold_at: string | null
          total_cost_price: number
          total_weight_kg: number
        }
        Insert: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          avg_cost_price_per_kg?: number | null
          batch_code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          material_type_id?: string | null
          rejection_note?: string | null
          site_id: string
          sold?: boolean
          sold_at?: string | null
          total_cost_price?: number
          total_weight_kg?: number
        }
        Update: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          avg_cost_price_per_kg?: number | null
          batch_code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          material_type_id?: string | null
          rejection_note?: string | null
          site_id?: string
          sold?: boolean
          sold_at?: string | null
          total_cost_price?: number
          total_weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "cost_price_runs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_price_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_price_runs_material_type_id_fkey"
            columns: ["material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_price_runs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_exit_authorizations: {
        Row: {
          authorized_at: string
          authorized_by: string
          id: string
          note: string | null
          visit_id: string
        }
        Insert: {
          authorized_at?: string
          authorized_by: string
          id?: string
          note?: string | null
          visit_id: string
        }
        Update: {
          authorized_at?: string
          authorized_by?: string
          id?: string
          note?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate_exit_authorizations_authorized_by_fkey"
            columns: ["authorized_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_exit_authorizations_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_logs: {
        Row: {
          bags: number | null
          created_at: string
          direction: string
          driver_name: string | null
          driver_phone: string | null
          gate_pass_id: string | null
          id: string
          material_owner: string | null
          reason: string | null
          recorded_by: string | null
          site_id: string
          supplier_id: string | null
        }
        Insert: {
          bags?: number | null
          created_at?: string
          direction: string
          driver_name?: string | null
          driver_phone?: string | null
          gate_pass_id?: string | null
          id?: string
          material_owner?: string | null
          reason?: string | null
          recorded_by?: string | null
          site_id: string
          supplier_id?: string | null
        }
        Update: {
          bags?: number | null
          created_at?: string
          direction?: string
          driver_name?: string | null
          driver_phone?: string | null
          gate_pass_id?: string | null
          id?: string
          material_owner?: string | null
          reason?: string | null
          recorded_by?: string | null
          site_id?: string
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gate_logs_gate_pass_id_fkey"
            columns: ["gate_pass_id"]
            isOneToOne: false
            referencedRelation: "gate_passes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_logs_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_logs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_logs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_passes: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          bags: number | null
          created_at: string
          id: string
          issued_at: string
          issued_by: string | null
          material_owner: string | null
          material_type_id: string | null
          pass_code: string | null
          reason: string
          site_id: string
          status: string
          stock_lot_id: string | null
          supplier_id: string | null
          weight_kg: number | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          bags?: number | null
          created_at?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          material_owner?: string | null
          material_type_id?: string | null
          pass_code?: string | null
          reason: string
          site_id: string
          status?: string
          stock_lot_id?: string | null
          supplier_id?: string | null
          weight_kg?: number | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          bags?: number | null
          created_at?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          material_owner?: string | null
          material_type_id?: string | null
          pass_code?: string | null
          reason?: string
          site_id?: string
          status?: string
          stock_lot_id?: string | null
          supplier_id?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gate_passes_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_passes_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_passes_material_type_id_fkey"
            columns: ["material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_passes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_passes_stock_lot_id_fkey"
            columns: ["stock_lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_passes_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      lot_sale_items: {
        Row: {
          lot_sale_id: string
          stock_lot_id: string
        }
        Insert: {
          lot_sale_id: string
          stock_lot_id: string
        }
        Update: {
          lot_sale_id?: string
          stock_lot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lot_sale_items_lot_sale_id_fkey"
            columns: ["lot_sale_id"]
            isOneToOne: false
            referencedRelation: "lot_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_sale_items_stock_lot_id_fkey"
            columns: ["stock_lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      lot_sales: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          avg_cost_price_per_kg: number | null
          buyer_name: string
          buyer_phone: string | null
          created_at: string
          id: string
          material_type_id: string
          recorded_by: string | null
          rejection_note: string | null
          site_id: string
          total_cost_price: number | null
          total_weight_kg: number | null
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          avg_cost_price_per_kg?: number | null
          buyer_name: string
          buyer_phone?: string | null
          created_at?: string
          id?: string
          material_type_id: string
          recorded_by?: string | null
          rejection_note?: string | null
          site_id: string
          total_cost_price?: number | null
          total_weight_kg?: number | null
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          avg_cost_price_per_kg?: number | null
          buyer_name?: string
          buyer_phone?: string | null
          created_at?: string
          id?: string
          material_type_id?: string
          recorded_by?: string | null
          rejection_note?: string | null
          site_id?: string
          total_cost_price?: number | null
          total_weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lot_sales_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_sales_material_type_id_fkey"
            columns: ["material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_sales_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_sales_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      machines: {
        Row: {
          active: boolean
          charge_basis: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          rate: number
          site_id: string
        }
        Insert: {
          active?: boolean
          charge_basis: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          rate: number
          site_id: string
        }
        Update: {
          active?: boolean
          charge_basis?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          rate?: number
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "machines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machines_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      material_types: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          direction: string
          id: string
          method: string | null
          notes: string | null
          paid_at: string
          receipt_path: string | null
          recorded_by: string | null
          status: string
          status_note: string | null
          visit_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          direction: string
          id?: string
          method?: string | null
          notes?: string | null
          paid_at?: string
          receipt_path?: string | null
          recorded_by?: string | null
          status?: string
          status_note?: string | null
          visit_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          direction?: string
          id?: string
          method?: string | null
          notes?: string | null
          paid_at?: string
          receipt_path?: string | null
          recorded_by?: string | null
          status?: string
          status_note?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing: {
        Row: {
          agreement_status: string
          created_at: string
          id: string
          overridden_by: string | null
          payment_terms: string | null
          priced_by: string | null
          purchase_amount: number | null
          unit_price: number | null
          updated_at: string
          visit_id: string
        }
        Insert: {
          agreement_status?: string
          created_at?: string
          id?: string
          overridden_by?: string | null
          payment_terms?: string | null
          priced_by?: string | null
          purchase_amount?: number | null
          unit_price?: number | null
          updated_at?: string
          visit_id: string
        }
        Update: {
          agreement_status?: string
          created_at?: string
          id?: string
          overridden_by?: string | null
          payment_terms?: string | null
          priced_by?: string | null
          purchase_amount?: number | null
          unit_price?: number | null
          updated_at?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_overridden_by_fkey"
            columns: ["overridden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_priced_by_fkey"
            columns: ["priced_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_machine_usage: {
        Row: {
          id: string
          line_cost: number | null
          machine_id: string
          measurement: number
          processing_record_id: string
          rate_snapshot: number
        }
        Insert: {
          id?: string
          line_cost?: number | null
          machine_id: string
          measurement: number
          processing_record_id: string
          rate_snapshot: number
        }
        Update: {
          id?: string
          line_cost?: number | null
          machine_id?: string
          measurement?: number
          processing_record_id?: string
          rate_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "processing_machine_usage_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_machine_usage_processing_record_id_fkey"
            columns: ["processing_record_id"]
            isOneToOne: false
            referencedRelation: "processing_records"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_records: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          recorded_by: string
          started_at: string | null
          updated_at: string
          visit_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          recorded_by: string
          started_at?: string | null
          updated_at?: string
          visit_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          recorded_by?: string
          started_at?: string | null
          updated_at?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_records_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          created_by: string | null
          full_name: string
          id: string
          must_change_password: boolean
          role: Database["public"]["Enums"]["app_role"]
          site_id: string | null
          status: string
          username: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          full_name: string
          id: string
          must_change_password?: boolean
          role: Database["public"]["Enums"]["app_role"]
          site_id?: string | null
          status?: string
          username: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          full_name?: string
          id?: string
          must_change_password?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          site_id?: string | null
          status?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      setup_codes: {
        Row: {
          created_at: string
          created_by: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          site_id: string | null
          used_at: string | null
          user_id: string
          username: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          site_id?: string | null
          used_at?: string | null
          user_id: string
          username: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          site_id?: string | null
          used_at?: string | null
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "setup_codes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          created_at: string
          id: string
          location: string | null
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string | null
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          location?: string | null
          name?: string
        }
        Relationships: []
      }
      stock_lots: {
        Row: {
          cost_price_per_kg: number | null
          created_at: string
          id: string
          material_type_id: string
          recorded_by: string | null
          ref_visit_material_id: string | null
          site_id: string
          status: string
          supplier_id: string | null
          weight_kg: number
        }
        Insert: {
          cost_price_per_kg?: number | null
          created_at?: string
          id?: string
          material_type_id: string
          recorded_by?: string | null
          ref_visit_material_id?: string | null
          site_id: string
          status?: string
          supplier_id?: string | null
          weight_kg: number
        }
        Update: {
          cost_price_per_kg?: number | null
          created_at?: string
          id?: string
          material_type_id?: string
          recorded_by?: string | null
          ref_visit_material_id?: string | null
          site_id?: string
          status?: string
          supplier_id?: string | null
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_lots_material_type_id_fkey"
            columns: ["material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_ref_visit_material_id_fkey"
            columns: ["ref_visit_material_id"]
            isOneToOne: false
            referencedRelation: "visit_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          direction: string
          grade: string | null
          id: string
          material_type_id: string
          reason: string
          recorded_by: string | null
          ref_bulk_sale_id: string | null
          ref_visit_id: string | null
          site_id: string
          weight: number
        }
        Insert: {
          created_at?: string
          direction: string
          grade?: string | null
          id?: string
          material_type_id: string
          reason: string
          recorded_by?: string | null
          ref_bulk_sale_id?: string | null
          ref_visit_id?: string | null
          site_id: string
          weight: number
        }
        Update: {
          created_at?: string
          direction?: string
          grade?: string | null
          id?: string
          material_type_id?: string
          reason?: string
          recorded_by?: string | null
          ref_bulk_sale_id?: string | null
          ref_visit_id?: string | null
          site_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_material_type_id_fkey"
            columns: ["material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_ref_bulk_sale_id_fkey"
            columns: ["ref_bulk_sale_id"]
            isOneToOne: false
            referencedRelation: "bulk_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_ref_visit_id_fkey"
            columns: ["ref_visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          account_name: string | null
          account_number: string | null
          bank_name: string | null
          created_at: string
          created_by: string | null
          former_names: string[]
          id: string
          name: string
          notes: string | null
          phone: string | null
          supplier_code: string | null
          updated_at: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          former_names?: string[]
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          supplier_code?: string | null
          updated_at?: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          former_names?: string[]
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          supplier_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          visit_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          visit_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_events_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      utility_charges: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          kind: string
          recorded_by: string | null
          visit_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          kind: string
          recorded_by?: string | null
          visit_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          recorded_by?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "utility_charges_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_charges_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_materials: {
        Row: {
          created_at: string
          finalized_at: string | null
          finalized_by: string | null
          id: string
          magnetic_analysis: string | null
          material_type_id: string
          price_finalized: boolean
          priced_by: string | null
          purchase_amount: number | null
          receiving_comment: string | null
          recorded_by: string | null
          requires_analysis: boolean
          unit_price: number | null
          updated_at: string
          visit_id: string
          weight_kg: number
        }
        Insert: {
          created_at?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          magnetic_analysis?: string | null
          material_type_id: string
          price_finalized?: boolean
          priced_by?: string | null
          purchase_amount?: number | null
          receiving_comment?: string | null
          recorded_by?: string | null
          requires_analysis?: boolean
          unit_price?: number | null
          updated_at?: string
          visit_id: string
          weight_kg: number
        }
        Update: {
          created_at?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          magnetic_analysis?: string | null
          material_type_id?: string
          price_finalized?: boolean
          priced_by?: string | null
          purchase_amount?: number | null
          receiving_comment?: string | null
          recorded_by?: string | null
          requires_analysis?: boolean
          unit_price?: number | null
          updated_at?: string
          visit_id?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "visit_materials_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_materials_material_type_id_fkey"
            columns: ["material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_materials_priced_by_fkey"
            columns: ["priced_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_materials_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_materials_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string
          declared_material_type_id: string
          entry_path: string
          id: string
          processing_deducted: boolean
          site_id: string
          state: string
          supplier_id: string
          vehicle_plate: string | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by: string
          declared_material_type_id: string
          entry_path: string
          id?: string
          processing_deducted?: boolean
          site_id: string
          state: string
          supplier_id: string
          vehicle_plate?: string | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string
          declared_material_type_id?: string
          entry_path?: string
          id?: string
          processing_deducted?: boolean
          site_id?: string
          state?: string
          supplier_id?: string
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_declared_material_type_id_fkey"
            columns: ["declared_material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      xrf_records: {
        Row: {
          created_at: string
          id: string
          mismatch: boolean
          recorded_by: string | null
          result: string | null
          submitted: boolean
          updated_at: string
          visit_material_id: string
          weight_kg: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          mismatch?: boolean
          recorded_by?: string | null
          result?: string | null
          submitted?: boolean
          updated_at?: string
          visit_material_id: string
          weight_kg?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          mismatch?: boolean
          recorded_by?: string | null
          result?: string | null
          submitted?: boolean
          updated_at?: string
          visit_material_id?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "xrf_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xrf_records_visit_material_id_fkey"
            columns: ["visit_material_id"]
            isOneToOne: true
            referencedRelation: "visit_materials"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      submit_visit_to_manager: { Args: { p_visit_id: string }; Returns: undefined }
      approve_visit_by_manager: { Args: { p_visit_id: string; p_skip_qc?: boolean }; Returns: undefined }
      delete_batch: { Args: { p_visit_id: string }; Returns: undefined }
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      current_site: { Args: never; Returns: string }
      has_cross_site_read: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      jsonb_diff_changed: { Args: { new: Json; old: Json }; Returns: Json }
      pricing_has_acted: { Args: { _visit_id: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      supplier_outstanding_debt: {
        Args: { _supplier_id: string }
        Returns: number
      }
      visit_is_open: { Args: { _visit_id: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "gate"
        | "processing"
        | "receiving"
        | "qc"
        | "manager"
        | "accounting"
        | "inventory"
        | "security"
        | "owner"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "gate",
        "processing",
        "receiving",
        "qc",
        "manager",
        "accounting",
        "inventory",
        "security",
        "owner",
      ],
    },
  },
} as const


// Generado desde el esquema de Supabase (proyecto mi-monday).
// Para regenerar: npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      board_groups: {
        Row: {
          board_id: string
          color: string
          created_at: string
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          board_id: string
          color?: string
          created_at?: string
          id?: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          board_id?: string
          color?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_groups_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      board_statuses: {
        Row: {
          board_id: string
          color: string
          created_at: string
          id: string
          is_done: boolean
          label: string
          position: number
          updated_at: string
        }
        Insert: {
          board_id: string
          color?: string
          created_at?: string
          id?: string
          is_done?: boolean
          label: string
          position?: number
          updated_at?: string
        }
        Update: {
          board_id?: string
          color?: string
          created_at?: string
          id?: string
          is_done?: boolean
          label?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_statuses_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      boards: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          name: string
          updated_at: string
          visibility: Database["public"]["Enums"]["board_visibility"]
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["board_visibility"]
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["board_visibility"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "boards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boards_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string | null
          id: string
          is_platform_admin: boolean
          must_change_password: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_platform_admin?: boolean
          must_change_password?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_platform_admin?: boolean
          must_change_password?: boolean
          updated_at?: string
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
      task_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          task_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          task_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          board_id: string
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          group_id: string
          id: string
          position: number
          priority: Database["public"]["Enums"]["task_priority"]
          status_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          board_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          group_id: string
          id?: string
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          status_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          board_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          group_id?: string
          id?: string
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          status_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          responded_at: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          updated_at: string
          workspace_id: string
          workspace_name: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          responded_at?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          updated_at?: string
          workspace_id: string
          workspace_name?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          responded_at?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          updated_at?: string
          workspace_id?: string
          workspace_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      board_overview: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          done_count: number | null
          id: string | null
          is_archived: boolean | null
          last_activity_at: string | null
          name: string | null
          task_count: number | null
          updated_at: string | null
          visibility: Database["public"]["Enums"]["board_visibility"] | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boards_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_issue_provision_token: { Args: never; Returns: string }
      respond_to_invitation: {
        Args: { p_accept: boolean; p_invitation_id: string }
        Returns: string
      }
    }
    Enums: {
      board_visibility: "workspace" | "private"
      invitation_status: "pending" | "accepted" | "revoked" | "declined"
      task_priority: "low" | "medium" | "high" | "urgent"
      workspace_role: "owner" | "admin" | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof (PublicSchema["Tables"] & PublicSchema["Views"])> =
  (PublicSchema["Tables"] & PublicSchema["Views"])[T] extends { Row: infer R } ? R : never

export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]

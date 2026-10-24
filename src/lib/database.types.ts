// Generado desde el esquema de Supabase de Vetta.
// Para regenerar: npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts

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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      automation_runs: {
        Row: {
          actor_id: string | null
          automation_id: string
          change: Json | null
          kind: string
          note: string | null
          reverted_at: string | null
          created_at: string
          error: string | null
          fire_key: string | null
          id: number
          ok: boolean
          task_id: string | null
        }
        Insert: {
          actor_id?: string | null
          automation_id: string
          change?: Json | null
          kind?: string
          note?: string | null
          reverted_at?: string | null
          created_at?: string
          error?: string | null
          fire_key?: string | null
          id?: never
          ok?: boolean
          task_id?: string | null
        }
        Update: {
          actor_id?: string | null
          automation_id?: string
          change?: Json | null
          kind?: string
          note?: string | null
          reverted_at?: string | null
          created_at?: string
          error?: string | null
          fire_key?: string | null
          id?: never
          ok?: boolean
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "board_automations"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboards: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          position: number
          updated_at: string
          visibility: string
          widgets: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          position?: number
          updated_at?: string
          visibility?: string
          widgets?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          position?: number
          updated_at?: string
          visibility?: string
          widgets?: Json
          workspace_id?: string
        }
        Relationships: []
      }
      board_forms: {
        Row: {
          access: string
          board_id: string
          closes_at: string | null
          config: Json
          created_at: string
          created_by: string | null
          id: string
          is_published: boolean
          max_responses: number | null
          name: string
          opens_at: string | null
          slug: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          access?: string
          board_id: string
          closes_at?: string | null
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          max_responses?: number | null
          name: string
          opens_at?: string | null
          slug?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          access?: string
          board_id?: string
          closes_at?: string | null
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          max_responses?: number | null
          name?: string
          opens_at?: string | null
          slug?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      form_submissions: {
        Row: {
          answers: Json
          board_id: string
          created_at: string
          duration_ms: number | null
          form_id: string
          id: string
          ip_hash: string | null
          submitted_by: string | null
          task_id: string | null
          tracking_hash: string | null
          workspace_id: string
        }
        Insert: {
          answers?: Json
          board_id: string
          created_at?: string
          duration_ms?: number | null
          form_id: string
          id?: string
          ip_hash?: string | null
          submitted_by?: string | null
          task_id?: string | null
          tracking_hash?: string | null
          workspace_id: string
        }
        Update: {
          answers?: Json
          board_id?: string
          created_at?: string
          duration_ms?: number | null
          form_id?: string
          id?: string
          ip_hash?: string | null
          submitted_by?: string | null
          task_id?: string | null
          tracking_hash?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      board_automations: {
        Row: {
          action_config: Json
          action_type: string
          board_id: string
          column_map: Json
          conditions: Json
          copy_fields: string[]
          created_at: string
          created_by: string | null
          extra_values: Json
          id: string
          is_active: boolean
          revert_on_undo: boolean
          legacy_action_type: string
          legacy_trigger_type: string
          link_direction: string | null
          name: string
          position: number
          target_board_id: string
          target_group_id: string | null
          target_status_id: string | null
          trigger_config: Json
          trigger_group_id: string | null
          trigger_status_id: string | null
          trigger_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          action_config?: Json
          action_type: string
          board_id: string
          column_map?: Json
          conditions?: Json
          copy_fields?: string[]
          created_at?: string
          created_by?: string | null
          extra_values?: Json
          id?: string
          is_active?: boolean
          revert_on_undo?: boolean
          legacy_action_type?: string
          legacy_trigger_type?: string
          link_direction?: string | null
          name: string
          position?: number
          target_board_id: string
          target_group_id?: string | null
          target_status_id?: string | null
          trigger_config?: Json
          trigger_group_id?: string | null
          trigger_status_id?: string | null
          trigger_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          board_id?: string
          column_map?: Json
          conditions?: Json
          copy_fields?: string[]
          created_at?: string
          created_by?: string | null
          extra_values?: Json
          id?: string
          is_active?: boolean
          revert_on_undo?: boolean
          legacy_action_type?: string
          legacy_trigger_type?: string
          link_direction?: string | null
          name?: string
          position?: number
          target_board_id?: string
          target_group_id?: string | null
          target_status_id?: string | null
          trigger_config?: Json
          trigger_group_id?: string | null
          trigger_status_id?: string | null
          trigger_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_target_group_same_board"
            columns: ["target_group_id", "target_board_id"]
            isOneToOne: false
            referencedRelation: "board_groups"
            referencedColumns: ["id", "board_id"]
          },
          {
            foreignKeyName: "automations_target_status_same_board"
            columns: ["target_status_id", "target_board_id"]
            isOneToOne: false
            referencedRelation: "board_statuses"
            referencedColumns: ["id", "board_id"]
          },
          {
            foreignKeyName: "automations_trigger_group_same_board"
            columns: ["trigger_group_id", "board_id"]
            isOneToOne: false
            referencedRelation: "board_groups"
            referencedColumns: ["id", "board_id"]
          },
          {
            foreignKeyName: "automations_trigger_status_same_board"
            columns: ["trigger_status_id", "board_id"]
            isOneToOne: false
            referencedRelation: "board_statuses"
            referencedColumns: ["id", "board_id"]
          },
          {
            foreignKeyName: "board_automations_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_automations_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_automations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_automations_target_board_id_fkey"
            columns: ["target_board_id"]
            isOneToOne: false
            referencedRelation: "board_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_automations_target_board_id_fkey"
            columns: ["target_board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_automations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      board_columns: {
        Row: {
          board_id: string
          created_at: string
          id: string
          kind: string
          legacy_kind: string
          name: string
          options: Json
          position: number
          settings: Json
          updated_at: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          kind?: string
          legacy_kind?: string
          name: string
          options?: Json
          position?: number
          settings?: Json
          updated_at?: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          kind?: string
          legacy_kind?: string
          name?: string
          options?: Json
          position?: number
          settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_columns_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_columns_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      board_groups: {
        Row: {
          editors: Json
          board_id: string
          color: string
          created_at: string
          id: string
          legacy_color: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          editors?: Json
          board_id: string
          color?: string
          created_at?: string
          id?: string
          legacy_color?: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          editors?: Json
          board_id?: string
          color?: string
          created_at?: string
          id?: string
          legacy_color?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_groups_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_groups_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      board_members: {
        Row: {
          role: string
          board_id: string
          created_at: string
          granted_by: string | null
          user_id: string
        }
        Insert: {
          role?: string
          board_id: string
          created_at?: string
          granted_by?: string | null
          user_id: string
        }
        Update: {
          role?: string
          board_id?: string
          created_at?: string
          granted_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_members_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_members_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_members_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          legacy_color: string
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
          legacy_color?: string
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
          legacy_color?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_statuses_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board_overview"
            referencedColumns: ["id"]
          },
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
          default_role: string
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          name: string
          settings: Json
          updated_at: string
          visibility: Database["public"]["Enums"]["board_visibility"]
          workspace_id: string
        }
        Insert: {
          default_role?: string
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name: string
          settings?: Json
          updated_at?: string
          visibility?: Database["public"]["Enums"]["board_visibility"]
          workspace_id: string
        }
        Update: {
          default_role?: string
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          settings?: Json
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
      checklist_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          items: Json
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          automation_id: string | null
          automation_name: string | null
          board_id: string | null
          body: string | null
          created_at: string
          id: number
          read_at: string | null
          task_id: string | null
          title: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          automation_id?: string | null
          automation_name?: string | null
          board_id?: string | null
          body?: string | null
          created_at?: string
          id?: never
          read_at?: string | null
          task_id?: string | null
          title: string
          user_id: string
          workspace_id: string
        }
        Update: {
          automation_id?: string | null
          automation_name?: string | null
          board_id?: string | null
          body?: string | null
          created_at?: string
          id?: never
          read_at?: string | null
          task_id?: string | null
          title?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
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
          deactivated_at: string | null
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
          deactivated_at?: string | null
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
          deactivated_at?: string | null
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
      task_events: {
        Row: {
          actor_id: string | null
          automation_id: string | null
          automation_name: string | null
          board_id: string
          created_at: string
          detail: Json
          id: number
          kind: string
          task_id: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          automation_id?: string | null
          automation_name?: string | null
          board_id: string
          created_at?: string
          detail?: Json
          id?: never
          kind: string
          task_id: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          automation_id?: string | null
          automation_name?: string | null
          board_id?: string
          created_at?: string
          detail?: Json
          id?: never
          kind?: string
          task_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      task_links: {
        Row: {
          automation_id: string | null
          created_at: string
          id: string
          source_task_id: string
          target_task_id: string
        }
        Insert: {
          automation_id?: string | null
          created_at?: string
          id?: string
          source_task_id: string
          target_task_id: string
        }
        Update: {
          automation_id?: string | null
          created_at?: string
          id?: string
          source_task_id?: string
          target_task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_links_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "board_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_target_task_id_fkey"
            columns: ["target_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      board_teams: {
        Row: {
          board_id: string
          created_at: string
          granted_by: string | null
          role: string
          team_id: string
        }
        Insert: {
          board_id: string
          created_at?: string
          granted_by?: string | null
          role?: string
          team_id: string
        }
        Update: {
          board_id?: string
          created_at?: string
          granted_by?: string | null
          role?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_teams_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspace_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspace_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_teams: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_teams_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_ids: string[]
          team_ids: string[]
          assignee_id: string | null
          board_id: string
          created_at: string
          created_by: string | null
          custom_values: Json
          description: string | null
          due_date: string | null
          group_id: string
          id: string
          parent_id: string | null
          position: number
          priority: Database["public"]["Enums"]["task_priority"]
          status_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_ids?: string[]
          team_ids?: string[]
          assignee_id?: string | null
          board_id: string
          created_at?: string
          created_by?: string | null
          custom_values?: Json
          description?: string | null
          due_date?: string | null
          group_id: string
          id?: string
          parent_id?: string | null
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          status_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee_ids?: string[]
          team_ids?: string[]
          assignee_id?: string | null
          board_id?: string
          created_at?: string
          created_by?: string | null
          custom_values?: Json
          description?: string | null
          due_date?: string | null
          group_id?: string
          id?: string
          parent_id?: string | null
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
            referencedRelation: "board_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_group_same_board"
            columns: ["group_id", "board_id"]
            isOneToOne: false
            referencedRelation: "board_groups"
            referencedColumns: ["id", "board_id"]
          },
          {
            foreignKeyName: "tasks_parent_fk"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_status_same_board"
            columns: ["status_id", "board_id"]
            isOneToOne: false
            referencedRelation: "board_statuses"
            referencedColumns: ["id", "board_id"]
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
      workspace_ai_settings: {
        Row: {
          daily_limit: number
          key_hint: string | null
          model: string
          provider: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          daily_limit?: number
          key_hint?: string | null
          model?: string
          provider?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          daily_limit?: number
          key_hint?: string | null
          model?: string
          provider?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      ai_requests: {
        Row: {
          board_id: string | null
          created_at: string
          error: string | null
          id: string
          ok: boolean
          prompt: string
          result: Json | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          board_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          ok?: boolean
          prompt: string
          result?: Json | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          board_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          ok?: boolean
          prompt?: string
          result?: Json | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: []
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
    }
    Functions: {
      my_board_role: { Args: { p_board: string }; Returns: string }
      admin_issue_provision_token: { Args: never; Returns: string }
      clear_workspace_ai_key: { Args: { p_workspace: string }; Returns: undefined }
      set_form_password: {
        Args: { p_form: string; p_password: string }
        Returns: undefined
      }
      form_has_password: {
        Args: { p_form: string }
        Returns: boolean
      }
      set_workspace_ai_key: {
        Args: { p_daily_limit?: number; p_key: string; p_workspace: string }
        Returns: undefined
      }
      respond_to_invitation: {
        Args: { p_accept: boolean; p_invitation_id: string }
        Returns: string
      }
      task_trace: {
        Args: { p_task_id: string }
        Returns: {
          automation_name: string
          board_id: string
          board_name: string
          depth: number
          group_name: string
          linked_at: string
          parent_id: string
          status_color: string
          status_done: boolean
          status_label: string
          task_id: string
          title: string
        }[]
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      board_visibility: ["workspace", "private"],
      invitation_status: ["pending", "accepted", "revoked", "declined"],
      task_priority: ["low", "medium", "high", "urgent"],
      workspace_role: ["owner", "admin", "member"],
    },
  },
} as const

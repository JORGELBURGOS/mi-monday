import type { Group, Member, Status, Task } from "@/lib/data";
import type { Priority } from "@/lib/constants";

export type { Group, Member, Status, Task };

export type SortKey = "manual" | "title" | "priority" | "due" | "status";
export type SortDir = "asc" | "desc";

export type Filters = {
  search: string;
  status: string; // "all" | "none" | statusId
  priority: "all" | Priority;
  assignee: string; // "all" | "none" | userId
};

export const EMPTY_FILTERS: Filters = { search: "", status: "all", priority: "all", assignee: "all" };

export type TaskChange =
  | { type: "update"; id: string; patch: Partial<Task> }
  | { type: "remove"; id: string }
  | { type: "add"; task: Task };

export type GroupChange =
  | { type: "update"; id: string; patch: Partial<Group> }
  | { type: "remove"; id: string };

export type BoardContext = {
  boardId: string;
  statuses: Status[];
  groups: Group[];
  members: Member[];
  today: string;
};

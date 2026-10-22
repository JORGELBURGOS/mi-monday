import { z } from "zod";
import { COLOR_NAMES } from "@/lib/constants";

const uuid = z.uuid({ message: "Identificador inválido." });

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { message: `${label}: máximo ${max} caracteres.` })
    .optional()
    .transform((v) => (v ? v : null));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Ingresá un email válido." }))
  .refine((v) => v.length <= 254, { message: "El email es demasiado largo." });

export const passwordSchema = z
  .string()
  .min(8, { message: "La contraseña debe tener al menos 8 caracteres." })
  .max(72, { message: "La contraseña puede tener hasta 72 caracteres." });

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: "Ingresá tu contraseña." }),
});

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(1, { message: "Ingresá tu nombre." }).max(120, { message: "Máximo 120 caracteres." }),
    email: emailSchema,
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden." });

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden." });

export const workspaceSchema = z.object({
  name: z.string().trim().min(1, { message: "El nombre es obligatorio." }).max(80, { message: "Máximo 80 caracteres." }),
  description: optionalText(500, "Descripción"),
});

export const createWorkspaceSchema = workspaceSchema.extend({
  withSample: z.boolean(),
});

export const boardSchema = z.object({
  name: z.string().trim().min(1, { message: "El nombre es obligatorio." }).max(80, { message: "Máximo 80 caracteres." }),
  description: optionalText(1000, "Descripción"),
  visibility: z.enum(["workspace", "private"], { message: "Visibilidad inválida." }),
});

export const colorSchema = z.enum(COLOR_NAMES, { message: "Color inválido." });

export const groupNameSchema = z
  .string()
  .trim()
  .min(1, { message: "El nombre del grupo es obligatorio." })
  .max(80, { message: "Máximo 80 caracteres." });

export const statusSchema = z.object({
  label: z.string().trim().min(1, { message: "El nombre del estado es obligatorio." }).max(40, { message: "Máximo 40 caracteres." }),
  color: colorSchema,
  isDone: z.boolean(),
});

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha inválida." })
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), { message: "Fecha inválida." });

export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, { message: "El título es obligatorio." })
  .max(500, { message: "Máximo 500 caracteres." });

export const taskPatchSchema = z
  .object({
    title: taskTitleSchema,
    description: z.string().max(10000, { message: "Máximo 10.000 caracteres." }).nullable(),
    status_id: uuid.nullable(),
    priority: z.enum(["low", "medium", "high", "urgent"], { message: "Prioridad inválida." }),
    assignee_id: uuid.nullable(),
    due_date: dateString.nullable(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "No hay cambios para guardar." });

export const moveTaskSchema = z.object({
  taskId: uuid,
  groupId: uuid,
  position: z.number().finite(),
});

export const commentSchema = z
  .string()
  .trim()
  .min(1, { message: "Escribí un comentario." })
  .max(5000, { message: "Máximo 5000 caracteres." });

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(["member", "admin"], { message: "Rol inválido." }),
});

export const roleSchema = z.enum(["owner", "admin", "member"], { message: "Rol inválido." });

export { uuid as uuidSchema };

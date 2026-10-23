# Vetta

Plataforma de gestión de proyectos y tareas para equipos: espacios de trabajo con roles, tableros con grupos, tareas con estado, prioridad, responsable y vencimiento, vista de tabla y de calendario, y comentarios.

> El nombre se cambia en un solo lugar: `src/config/site.ts` (o con la variable `NEXT_PUBLIC_APP_NAME`).
> Marca: la V inicial y la A final (Λ) en espejo, el principio y el final de cada recorrido. Ícono en `src/app/icon.svg` y `LogoMark` (`src/components/ui/icons.tsx`).

## Stack

- **Next.js 16** (App Router, Server Actions, `proxy.ts`) + **React 19** + **TypeScript**
- **Tailwind CSS 4** con tokens de diseño propios (modo claro y oscuro según el sistema)
- **Supabase**: Postgres, Auth (email y contraseña) y Row Level Security
- **zod** para validar datos en el servidor

## Funcionalidades

- Registro, inicio de sesión, recuperación y cambio de contraseña, cierre de sesión. Rutas privadas protegidas.
- Espacios de trabajo con roles **propietario / administrador / miembro** e invitaciones por email.
- Tableros compartidos o privados; renombrar, archivar, restaurar y eliminar (solo archivados y con confirmación escrita).
- Tablero de ejemplo opcional al crear un espacio nuevo (contenido marcado como “Ejemplo”).
- Grupos ordenables (renombrar, color, subir/bajar, eliminar).
- Tareas: crear, editar en línea, duplicar, mover entre grupos, reordenar (arrastrar o con el menú, accesible por teclado), eliminar con confirmación.
- Estados configurables por tablero (iniciales: Pendiente, En progreso, En revisión, Hecho) y prioridades Baja/Media/Alta/Urgente.
- Vista de tabla con búsqueda, filtros (estado, prioridad, responsable) y orden (nombre, prioridad, vencimiento, estado). En celular se muestra como tarjetas.
- Vista de calendario mensual por fecha de vencimiento.
- Comentarios por tarea.

## Seguridad

- Todas las tablas tienen **RLS**; cada lectura y escritura valida la membresía y el rol en la base de datos.
- La app usa **solo la clave pública** de Supabase. No necesita ni lee la clave `service_role`.
- Las funciones `SECURITY DEFINER` son mínimas, viven en el esquema `private` (no expuesto) salvo `respond_to_invitation`, y tienen `search_path` fijo. Cada una está justificada en la migración.
- `supabase/tests/rls_test.sql` contiene 38 pruebas de permisos (se ejecutan dentro de una transacción que se revierte).

## Puesta en marcha local

```bash
cp .env.example .env.local   # completá URL y clave pública de Supabase
npm install
npm run dev
```

## Base de datos

La migración `supabase/migrations/20261022160000_init_schema.sql` es idempotente y no contiene sentencias `DROP` ni modifica datos existentes. Se aplica con la CLI de Supabase (`supabase db push`) o pegándola en el editor SQL del panel.

Pruebas de permisos (contra una base de prueba, nunca producción):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
```

## Configuración de Auth en Supabase (una vez)

En **Authentication → URL Configuration**:

- **Site URL**: la URL de producción (por ejemplo `https://vetta.vercel.app`).
- **Redirect URLs**: agregá `https://vetta.vercel.app/**`, `https://mi-monday.vercel.app/**`, `https://*-jorges-projects-464fd33b.vercel.app/**` (previews) y `http://localhost:3000/**`.

Emails: el servidor de correo incluido en Supabase tiene un límite bajo de envíos y está pensado para pruebas. Para usuarios reales configurá un SMTP propio en **Authentication → Emails → SMTP Settings**.

## Verificaciones

```bash
npx tsc --noEmit   # tipos
npm run lint       # ESLint
npm run build      # build de producción
```

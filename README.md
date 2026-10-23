# Vetta

Plataforma de gestión de proyectos y tareas para equipos: espacios de trabajo con roles, tableros con grupos, tareas con estado, prioridad, responsable y vencimiento, vista de tabla y de calendario, y comentarios.

> El nombre se cambia en un solo lugar: `src/config/site.ts` (o con la variable `NEXT_PUBLIC_APP_NAME`).
> Marca: la V inicial y la A final (Λ) en espejo, el principio y el final de cada recorrido. Ícono en `src/app/icon.svg` y `LogoMark` (`src/components/ui/icons.tsx`).

## Stack

- **Next.js 16** (App Router, Server Actions, `proxy.ts`) + **React 19** + **TypeScript**
- **Tailwind CSS 4** con tokens de diseño propios (modo claro y oscuro según el sistema)
- **Supabase**: Postgres, Auth (email y contraseña, sin envío de correos), Row Level Security y una Edge Function (`vetta-admin`) para la gestión de cuentas
- **zod** para validar datos en el servidor

## Funcionalidades

- Cuentas administradas: no hay registro público. Un administrador da de alta a cada persona con una contraseña temporal; en el primer ingreso la persona debe cambiarla. Si alguien la olvida, un administrador la restablece. La plataforma no envía ningún email.
- Inicio de sesión, cambio de contraseña desde **Mi cuenta**, cierre de sesión. Rutas privadas protegidas.
- Espacios de trabajo con roles **propietario / administrador / miembro**.
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
- La app (navegador y servidor Next.js) usa **solo la clave pública** de Supabase. Las operaciones privilegiadas (crear cuentas, restablecer contraseñas) corren en la Edge Function `vetta-admin`, que usa la clave secreta que Supabase le inyecta y verifica en cada llamada que quien la invoca sea administrador.
- El registro público está bloqueado en la base: un trigger sobre `auth.users` exige un token de alta de un solo uso que solo emite la Edge Function.
- Mientras una cuenta tenga un cambio de contraseña pendiente, RLS le bloquea el acceso a todos los datos.
- Las funciones `SECURITY DEFINER` son mínimas, viven en el esquema `private` (no expuesto) salvo `respond_to_invitation`, y tienen `search_path` fijo. Cada una está justificada en la migración.
- `supabase/tests/rls_test.sql` contiene 49 pruebas de permisos (se ejecutan dentro de una transacción que se revierte).

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

## Cuentas y contraseñas

- **Alta**: en un espacio, **Miembros → Agregar persona** (propietarios y administradores). Se genera una contraseña temporal que se muestra una sola vez para pasársela a la persona.
- **Primer ingreso**: la persona entra con su email y la contraseña temporal y debe elegir una nueva.
- **Olvido**: un administrador usa **Restablecer contraseña** en Miembros y le pasa la nueva contraseña temporal.
- No hace falta configurar SMTP ni URLs de redirección en Supabase. Opcionalmente, desactivá **Authentication → Sign In / Providers → Allow new users to sign up** como protección extra (la base ya lo bloquea).

## Verificaciones

```bash
npx tsc --noEmit   # tipos
npm run lint       # ESLint
npm run build      # build de producción
```

# Vetta

Plataforma para seguir el trabajo de punta a punta: espacios de trabajo por empresa, tableros por etapa (ventas, producción, facturación…), carpetas, columnas propias y reglas que hacen viajar los ítems entre tableros con trazabilidad completa.

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
- Carpetas ordenables (renombrar, color, subir/bajar, eliminar).
- Tareas: crear, editar en línea, duplicar, mover entre carpetas, reordenar (arrastrar o con el menú, accesible por teclado), eliminar con confirmación.
- Estados configurables por tablero (iniciales: Pendiente, En progreso, En revisión, Hecho) y prioridades Baja/Media/Alta/Urgente.
- Vista de tabla con búsqueda, filtros (estado, prioridad, responsable) y orden (nombre, prioridad, vencimiento, estado). En celular se muestra como tarjetas.
- Vista de calendario mensual por fecha de vencimiento.
- Comentarios por tarea.
- **Columnas propias por tablero**: texto, número, fecha, persona, lista de opciones y casilla (Ajustes del tablero → Columnas).
- **Reglas entre tableros** (Tablero → Reglas): cuando un ítem cambia de estado, entra a una carpeta o llega al tablero, se puede
  - **copiar** a otro tablero/carpeta, eligiendo qué campos y columnas viajan y agregando valores fijos;
  - **mover** completo a otro tablero (con comentarios e historial);
  - **actualizar el original o las copias** (cambiarles estado o carpeta), para que la cadena se avise en ambos sentidos.
- **Reglas automáticas** (Tablero → Reglas), con ejemplos listos para usar:
  - *Cuándo*: cambio de estado (desde/hacia), de carpeta, de responsable, de prioridad o de una columna; llegada de un ítem; **X días antes, el día o después del vencimiento o de una columna fecha**; ítems que llevan **N días sin avanzar**; reglas **programadas** (diarias, de lunes a viernes, semanales o mensuales, a una hora).
  - *Solo si…*: condiciones sobre estado, carpeta, prioridad, responsable, terminado, vencimiento (vencido, vence en N días) y columnas (igual, contiene, mayor/menor…).
  - *Qué hacer*: cambiar estado, carpeta, prioridad, responsable, vencimiento o una columna; comentar; **avisar** (responsable, creador, administradores o una persona); crear un ítem; copiar, mover o actualizar ítems vinculados.
  - Textos con variables: `{titulo}`, `{tablero}`, `{carpeta}`, `{estado}`, `{vencimiento}`, `{responsable}`, `{hoy}`.
  - Las reglas por tiempo las ejecuta `pg_cron` cada 15 minutos (hora de Argentina) y no se repiten para la misma fecha. Cada regla muestra cuántas veces se ejecutó y su último error; si una acción falla, el cambio de la persona igual se guarda.
- **Avisos**: bandeja dentro de Vetta (menú → Avisos). No se envía ningún email.
- **Trazabilidad**: cada ítem tiene un *Recorrido* con la cadena de tableros (origen y copias), el tiempo que pasó en cada estado y un historial inmutable de cambios, indicando si los hizo una persona o una regla.
- **Flujo del espacio**: mapa de cómo se conectan los tableros (Espacio → Flujo).

## Seguridad

- Todas las tablas tienen **RLS**; cada lectura y escritura valida la membresía y el rol en la base de datos.
- La app (navegador y servidor Next.js) usa **solo la clave pública** de Supabase. Las operaciones privilegiadas (crear cuentas, restablecer contraseñas) corren en la Edge Function `vetta-admin`, que usa la clave secreta que Supabase le inyecta y verifica en cada llamada que quien la invoca sea administrador.
- El registro público está bloqueado en la base: un trigger sobre `auth.users` exige un token de alta de un solo uso que solo emite la Edge Function.
- Mientras una cuenta tenga un cambio de contraseña pendiente, RLS le bloquea el acceso a todos los datos.
- Las reglas solo las crea quien administra el tablero de origen **y** el de destino, dentro del mismo espacio. El motor que las ejecuta corre en la base (triggers `SECURITY DEFINER` en el esquema `private`, con `search_path` fijo) porque quien dispara una regla puede no tener acceso al tablero de destino; solo ejecuta reglas guardadas y validadas. Las cadenas circulares se cortan solas.
- El historial (`task_events`) y los vínculos (`task_links`) son de solo lectura para los usuarios: los escribe únicamente el motor.
- Las funciones `SECURITY DEFINER` son mínimas, viven en el esquema `private` (no expuesto) salvo `respond_to_invitation`, y tienen `search_path` fijo. Cada una está justificada en la migración.
- `supabase/tests/rls_test.sql` (50 pruebas de permisos) `supabase/tests/flows_test.sql` (42 pruebas de columnas, reglas y trazabilidad) y `supabase/tests/rules_test.sql` (29 pruebas del motor de reglas por fechas, condiciones y avisos) se ejecutan dentro de una transacción que se revierte.

## Puesta en marcha local

```bash
cp .env.example .env.local   # completá URL y clave pública de Supabase
npm install
npm run dev
```

## Base de datos

Las migraciones de `supabase/migrations/` se aplican en orden; son idempotentes, no eliminan objetos ni modifican datos existentes. Se aplica con la CLI de Supabase (`supabase db push`) o pegándola en el editor SQL del panel.

Pruebas de permisos (contra una base de prueba, nunca producción):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/flows_test.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rules_test.sql
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

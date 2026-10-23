# Vetta

App: **https://vettaapp.vercel.app** (las direcciones anteriores redirigen a esta).

Plataforma para seguir el trabajo de punta a punta: empresas separadas entre sí, tableros por etapa (ventas, producción, facturación…), carpetas, columnas propias y reglas que hacen viajar los ítems entre tableros con trazabilidad completa.

> El nombre se cambia en un solo lugar: `src/config/site.ts` (o con la variable `NEXT_PUBLIC_APP_NAME`).
> Marca: la V inicial y la A final (Λ) en espejo, el principio y el final de cada recorrido. Ícono en `src/app/icon.svg` y `LogoMark` (`src/components/ui/icons.tsx`).

## Stack

- **Next.js 16** (App Router, Server Actions, `proxy.ts`) + **React 19** + **TypeScript**
- **Tailwind CSS 4** con tokens de diseño propios (modo claro y oscuro según el sistema)
- **Supabase**: Postgres, Auth (email y contraseña, sin envío de correos), Row Level Security y una Edge Function (`vetta-gestion`) para la gestión de cuentas
- **zod** para validar datos en el servidor

## Funcionalidades

- Cuentas administradas: no hay registro público. Un administrador da de alta a cada persona con una contraseña temporal; en el primer ingreso la persona debe cambiarla. Si alguien la olvida, un administrador la restablece. La plataforma no envía ningún email.
- Inicio de sesión, cambio de contraseña desde **Mi cuenta**, cierre de sesión. Rutas privadas protegidas.
- **Empresas**: cada una con sus usuarios, tableros y reglas, sin mezclarse. Las da de alta solo el **superadministrador** (Superadmin → Nueva empresa), siempre junto con su administrador.
- Roles por empresa: **administrador principal / administrador / usuario**.
- **Acceso por tablero** (como en Monday): un tablero es para *todo el equipo* o *solo para las personas elegidas*. El administrador decide a qué tableros accede cada usuario (Usuarios → Editar, o Ajustes del tablero → Acceso). Los administradores ven todos los tableros.
- **Gestión completa de usuarios** (Usuarios → Editar): nombre, email, rol, tableros, restablecer contraseña, desactivar/reactivar la cuenta y quitar de la empresa.
- Tableros: renombrar, archivar, renombrar, archivar, restaurar y eliminar (solo archivados y con confirmación escrita).
- Tablero de ejemplo opcional al crear una empresa nueva (contenido marcado como “Ejemplo”).
- Carpetas ordenables (renombrar, color, subir/bajar, eliminar).
- Tareas: crear, editar en línea, duplicar, mover entre carpetas, reordenar (arrastrar o con el menú, accesible por teclado), eliminar con confirmación.
- **Tablero al estilo Monday** (todo se edita en el mismo tablero):
  - **Etiquetas editables desde la celda**: al tocar un Estado, Prioridad o cualquier columna de etiquetas aparece “Editar etiquetas” para crear, renombrar, recolorear (paleta de 18 colores), reordenar, marcar como “terminado” o quitar etiquetas.
  - **Agregar columnas** con el **+** al final de los encabezados (o desde el menú de cualquier columna, a su derecha). Tipos: Estado/Etiqueta, Texto, Texto largo, Números (unidad, decimales y resumen), Fecha, Cronograma, Persona, Desplegable de varias opciones, Casilla, Calificación, Enlace, Email, Teléfono, Hora, **Fórmula**, ID del elemento, Registro de creación y Última actualización.
  - **Menú de cada columna**: configurar, renombrar (o doble clic), ordenar, mover a izquierda/derecha, ocultar, duplicar (con o sin valores) y eliminar. Las columnas fijas (Responsable, Estado, Prioridad, Vencimiento) también se renombran, mueven y ocultan.
  - **Fórmulas** como en Monday/Excel: `{Precio} * {Cantidad}`, `IF({Estado} = "Listo", "✔", "")`, `DAYS({Vencimiento}, TODAY())`, `WORKDAYS({Cronograma#Fin}, {Cronograma#Inicio})`, `TEXT({Monto}, "$#,##0.00")`… Más de 60 funciones de números, texto, lógica y fechas, con editor, catálogo y vista previa. Se calculan sin `eval` (parser propio en `src/lib/formula.ts`).
  - **Resumen al pie de cada carpeta**: suma/promedio/mediana/mín/máx/cantidad de números y fórmulas, barra de distribución de estados y etiquetas, rango de fechas, promedio de calificación.
  - **Vistas**: Tabla, **Kanban** (arrastrar cambia el estado) y Calendario.
  - **Columnas avanzadas**: Archivos (adjuntos privados en Supabase Storage, hasta 25 MB c/u, con acceso según el tablero), Personas (varias), Checklist con avance, Depende de (dependencias entre elementos, con aviso si la previa no terminó), Conectar tableros (vincula elementos de otro tablero) y Espejo (muestra estado, fecha, números u otra columna de los elementos conectados).
  - **Vista Gantt**: barras por cronograma o vencimiento, colores por carpeta o estado, flechas de dependencias, línea de hoy, escala días/semanas/meses; se arrastran para cambiar fechas.
  - **Dashboard de la empresa**: avance por tablero, vencidos, próximos vencimientos y carga por persona.
  - **Subelementos**: cada elemento puede tener subelementos con las mismas columnas (estado, responsable, fórmulas…). Se despliegan debajo del elemento mostrando cuántos están terminados, acompañan a su elemento si cambia de carpeta o viaja a otro tablero, y se duplican y eliminan con él. Las reglas del tablero se aplican solo a los elementos.
  - **Selección múltiple** con acciones en lote: cambiar estado o prioridad, mover de carpeta, duplicar, exportar y eliminar.
  - Búsqueda en todas las columnas, filtros por estado, prioridad, responsable y cualquier columna de etiquetas/persona/casilla; orden por cualquier columna; **Exportar** a CSV para Excel.
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
- **Flujo entre tableros**: mapa de cómo se conectan los tableros de la empresa.

## Seguridad

- Todas las tablas tienen **RLS**; cada lectura y escritura valida la membresía y el rol en la base de datos.
- La app (navegador y servidor Next.js) usa **solo la clave pública** de Supabase. Las operaciones privilegiadas (crear cuentas, restablecer contraseñas) corren en la Edge Function `vetta-gestion`, que usa la clave secreta que Supabase le inyecta y verifica en cada llamada que quien la invoca sea administrador.
- El registro público está bloqueado en la base: un trigger sobre `auth.users` exige un token de alta de un solo uso que solo emite la Edge Function.
- Mientras una cuenta tenga un cambio de contraseña pendiente **o esté desactivada**, RLS le bloquea el acceso a todos los datos (además, una cuenta desactivada no puede iniciar sesión).
- El acceso a cada tablero se valida en la base (`board_members` + `private.can_access_board`); quien no tiene acceso no ve el tablero ni sus tareas, comentarios o columnas.
- **Superadministrador** (`profiles.is_platform_admin`): acceso total a todas las empresas, tableros, usuarios y datos sin necesidad de ser miembro (la base lo trata como administrador principal en cualquier empresa). Es **invisible** para los usuarios de las empresas, incluido su administrador principal: no aparece en Usuarios, no se ve su perfil y nadie más lo puede editar ni quitar. Solo él crea y elimina empresas.
- El **administrador principal** de cada empresa controla todo dentro de su empresa (usuarios, administradores, tableros y reglas), pero no ve otras empresas ni puede crearlas o eliminarlas.
- Solo el superadministrador puede crear empresas: lo exige un trigger en `workspaces` y lo vuelve a verificar `vetta-gestion`. Un administrador solo puede editar a personas que pertenezcan únicamente a empresas que él administra.
- Las reglas solo las crea quien administra el tablero de origen **y** el de destino, dentro de la misma empresa. El motor que las ejecuta corre en la base (triggers `SECURITY DEFINER` en el esquema `private`, con `search_path` fijo) porque quien dispara una regla puede no tener acceso al tablero de destino; solo ejecuta reglas guardadas y validadas. Las cadenas circulares se cortan solas.
- El historial (`task_events`) y los vínculos (`task_links`) son de solo lectura para los usuarios: los escribe únicamente el motor.
- Las funciones `SECURITY DEFINER` son mínimas, viven en el esquema `private` (no expuesto) salvo `respond_to_invitation`, y tienen `search_path` fijo. Cada una está justificada en la migración.
- `supabase/tests/rls_test.sql` (50 pruebas de permisos) `supabase/tests/flows_test.sql` (42 pruebas de columnas, reglas y trazabilidad) `supabase/tests/rules_test.sql` (29 pruebas del motor de reglas por fechas, condiciones y avisos) `supabase/tests/access_test.sql` (22 pruebas de acceso por tablero, cuentas desactivadas y alta de empresas) `supabase/tests/columns_test.sql` (13 pruebas de tipos de columna, colores y ajustes) `supabase/tests/superadmin_test.sql` (12 pruebas de acceso total e invisibilidad del superadministrador) y `supabase/tests/subitems_test.sql` (11 pruebas de subelementos) se ejecutan dentro de una transacción que se revierte.

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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/access_test.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/columns_test.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/superadmin_test.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/subitems_test.sql
```

## Cuentas y contraseñas

- **Alta de empresa**: el superadministrador, en **Superadmin → Nueva empresa**, carga el nombre y el administrador; se muestra su contraseña temporal una sola vez.
- **Alta de usuario**: en la empresa, **Usuarios → Dar de alta** (administradores), eligiendo rol y tableros. Se genera una contraseña temporal que se muestra una sola vez para pasársela a la persona.
- **Primer ingreso**: la persona entra con su email y la contraseña temporal y debe elegir una nueva.
- **Olvido**: un administrador usa **Usuarios → Editar → Restablecer contraseña** y le pasa la nueva contraseña temporal.
- No hace falta configurar SMTP ni URLs de redirección en Supabase. Opcionalmente, desactivá **Authentication → Sign In / Providers → Allow new users to sign up** como protección extra (la base ya lo bloquea).

## Verificaciones

```bash
npx tsc --noEmit   # tipos
npm run lint       # ESLint
npm run build      # build de producción
```

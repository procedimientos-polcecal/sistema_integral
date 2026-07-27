# Fase 3 — Migrar Remises Implementation Plan

**Goal:** Portar `remisgest` a `app/(app)/remises/`, con esquema relacional propio
(reemplazando el blob JSON de Firestore), motor de generación de rutas portado,
notificaciones push migradas a Web Push/Vercel Cron, vista de auto-servicio para
empleados, y los datos reales de producción. Ver el spec de diseño:
`docs/superpowers/specs/2026-07-27-fase-3-remises-design.md`.

**Convenciones:** mismas que Fases 0-2. Commits pequeños en español, directo a `main`,
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Checkboxes = tracker de
progreso entre sesiones. Después de cada task: `npx tsc --noEmit`, `npm test`,
`npm run build` en verde antes de commitear.

**Fuente:** repo original clonado en `/Users/delfina/Downloads/remisgest` (solo
lectura). Reporte de exploración completo (modelo de datos, algoritmo de rutas,
pantallas, auth, notificaciones) volcado en la sesión que lo generó — resumen clave ya
está en el spec de diseño.

**Decisiones ya tomadas por el usuario** (no volver a preguntar, ver spec):
bug `seats`/`stops` se arregla; notificaciones vía Vercel Cron + Web Push nativo (no
Firebase); Nominatim/OSRM se mantienen gratuitos; empleados con acceso a Remises
obtienen cuenta completa en `usuarios` (vinculada vía `empleado_id`); se migran los
datos reales de producción (bloqueado hasta conseguir credenciales de Firestore).

---

### Task 1: Esquema — núcleo + tablas de dominio Remises + RLS

**Files:** `supabase/migrations/012_remises_schema.sql`, `013_remises_rls.sql`,
`014_seed_remises.sql`

- [x] **Step 1:** `alter table usuarios add column empleado_id uuid references
      empleados(id) on delete set null` (vínculo opcional para auto-servicio).
- [x] **Step 2:** Enum `remises_tipo_hoja` (`ida`/`vuelta`).
- [x] **Step 3:** Tablas: `choferes`, `vehiculos`, `remises_turnos`,
      `remises_empleados_datos`, `remises_asistencia`, `remises_plan_semana`,
      `hojas_ruta`, `asientos`, `remises_plantillas`, `remises_plantillas_grupos`,
      `remises_config` (singleton, seed `id=1` con defaults), `remises_push_tokens`.
- [x] **Step 4:** Funciones `puede_editar_remises()`, `es_admin_remises()`,
      `tiene_acceso_remises()` (mismo patrón que RRHH/Mantenimiento) + RLS de todas
      las tablas nuevas.
- [x] **Step 5:** Policy separada para auto-servicio: un usuario con
      `usuarios.empleado_id` no nulo puede leer (no escribir) `asientos`/`hojas_ruta`
      donde `asientos.empleado_id = su empleado_id` — **sin** pasar por
      `tiene_acceso_remises()` (no tiene ni necesita nivel de módulo).
- [x] **Step 6:** Seed: 3 `remises_turnos` de ejemplo (Mañana/Tarde/Noche, mismos
      horarios/colores que `DEFAULT_SHIFTS` del original), `remises_config` con
      defaults (velocidad 40 km/h).
- [x] **Step 7:** Verificar tipos: `npx tsc --noEmit` — sin errores.
- [x] **Step 8:** Pendiente aplicar contra la base real — armé `supabase/migrations_fase3_combined.sql` (012-014) para el SQL Editor, mismo procedimiento que Fases 1-2. Commit.

### Task 2: Motor de generación de rutas — funciones puras + tests

**Files:** `lib/remises/engine/clustering.ts`, `lib/remises/engine/tsp.ts`,
`lib/remises/engine/geo.ts` (+ `.test.ts` de cada uno)

- [ ] **Step 1:** Haversine + utilidades geo (`lib/remises/engine/geo.ts`), portadas
      literales del original.
- [ ] **Step 2:** K-means con capacidad (`clusterWithCapacity`, k-means++ seeding, 15
      iteraciones, rebalanceo por capacidad) — función pura, mismo algoritmo.
- [ ] **Step 3:** Nearest-neighbor TSP (con matriz de duraciones real o fallback
      Haversine) + la lógica de reversión Ida-vs-Vuelta documentada en el original.
- [ ] **Step 4:** Tests para clustering (capacidad respetada, todos los empleados
      asignados, determinismo con seed fija) y TSP (orden válido, fábrica en la
      posición correcta según tipo).
- [ ] **Step 5:** Cliente OSRM (`lib/remises/engine/osrm.ts`): matriz de duraciones
      (`/table/v1`) y geometría de ruta (`/route/v1`, con `continue_straight=true` y
      fallback sin el flag, y fallback final a línea recta si OSRM no responde).
      Cliente Nominatim (`lib/remises/engine/geocode.ts`): geocodificación con
      `viewbox`/ciudad de referencia, mismo comportamiento que el original.
- [ ] **Step 6:** `npx tsc --noEmit`, `npm test` — verde.
- [ ] **Step 7:** Commit.

### Task 3: Choferes + Vehículos (CRUD)

**Files:** `app/(app)/remises/vehiculos/**`, `app/api/remises/choferes/**`,
`app/api/remises/vehiculos/**`

- [ ] **Step 1:** API choferes (GET/POST/PUT/DELETE, `puede_editar_check`/
      `es_admin_check` según corresponda, "borrado seguro" si tiene vehículo o
      historial asociado — bloquear en vez de romper FKs).
- [ ] **Step 2:** API vehículos (mismo patrón, `chofer_id` opcional).
- [ ] **Step 3:** Pantalla `remises/vehiculos`: listado + modales de alta/edición para
      ambas entidades (choferes se gestionan desde la misma pantalla, como submenú o
      tab, ya que en el original viven juntos conceptualmente).
- [ ] **Step 4:** Import/export Excel de vehículos (mismas columnas del original:
      Nombre/Vehículo, Conductor, Capacidad, Teléfono — al importar, resolver/crear el
      chofer por nombre).
- [ ] **Step 5:** `npx tsc --noEmit`, `npm run build`. Commit.

### Task 4: Turnos + Configuración

**Files:** `app/(app)/remises/configuracion/**`, `app/api/remises/turnos/**`,
`app/api/remises/configuracion/**`

- [ ] **Step 1:** API turnos (CRUD, borrado cascadea a `remises_asistencia`/
      `remises_plan_semana`/`hojas_ruta` de ese turno — igual que el original, con
      confirmación explícita en la UI).
- [ ] **Step 2:** API configuración (fábrica + geocodificación + velocidad + ciudad de
      referencia).
- [ ] **Step 3:** Pantalla Configuración: mapa Leaflet para pin de fábrica (reutilizar
      patrón de mapa si Mantenimiento/RRHH ya tienen alguno; si no, primer uso de
      Leaflet en el SdG — agregar dependencia), turnos, velocidad, ciudad.
- [ ] **Step 4:** `npx tsc --noEmit`, `npm run build`. Commit.

### Task 5: Empleados de Remises (extensión) + Asistencia + Generación de rutas (Hoy)

**Files:** `app/(app)/remises/page.tsx` (Hoy), `app/api/remises/asistencia/**`,
`app/api/remises/generar/**`, `app/api/remises/hojas-ruta/**`

- [ ] **Step 1:** Extender ficha de empleado existente de RRHH (o pantalla propia
      mínima) con los campos de `remises_empleados_datos` (dirección de recogida,
      lat/lng, turno default) + geocodificación individual y masiva ("Geocodificar
      faltantes").
- [ ] **Step 2:** API asistencia (toggle por empleado/fecha/turno, auto-seed desde
      `turno_default_id`).
- [ ] **Step 3:** API generar rutas (`POST /api/remises/generar`): corre clustering +
      TSP + OSRM, inserta `hojas_ruta` + `asientos` (reemplaza cualquier generación
      previa para esa fecha/turno/tipo — regenerar es idempotente/destructivo como en
      el original).
- [ ] **Step 4:** Edición manual post-generación: reordenar parada, mover empleado
      entre vehículos, agregar/quitar empleado, agregar/quitar vehículo — cada una
      invalida `geometria` (null) y dispara un re-fetch de OSRM solo para la hoja de
      ruta afectada.
- [ ] **Step 5:** Pantalla "Hoy": selector fecha+turno, sub-tabs Asistencia/Rutas
      Ida/Rutas Vuelta, mapa Leaflet con las rutas generadas, tarjetas de ruta con
      hora de salida editable, acciones (Google Maps/Waze, WhatsApp/Email/copiar,
      imprimir — ver Task 9, agregar/quitar persona, quitar vehículo).
- [ ] **Step 6:** `npx tsc --noEmit`, `npm test`, `npm run build`. Commit.

### Task 6: Semana

**Files:** `app/(app)/remises/semana/**`, `app/api/remises/plan-semana/**`

- [ ] **Step 1:** API plan semanal (toggle Va/No va por empleado/fecha/turno/tipo).
- [ ] **Step 2:** Pantalla Semana: navegador de semana (lunes a lunes), selector de
      día, dos tarjetas Ida/Vuelta con toggle por empleado, "Generar rutas" que copia
      el plan a `remises_asistencia` de esa fecha y llama al mismo endpoint de
      generación del Task 5.
- [ ] **Step 3:** `npx tsc --noEmit`, `npm run build`. Commit.

### Task 7: Plantillas + Historial

**Files:** `app/(app)/remises/historial/**`, `app/api/remises/plantillas/**`

- [ ] **Step 1:** API plantillas (crear desde una hoja de ruta existente o desde cero,
      aplicar a una fecha — vuelve a correr OSRM contra datos actuales).
- [ ] **Step 2:** "Historial" en la pantalla es una consulta de `hojas_ruta` pasadas
      agrupadas por fecha (no una tabla propia — ver decisión #6 del spec), con
      "Reutilizar" (aplicar como si fuera plantilla) y "Guardar como plantilla".
- [ ] **Step 3:** `npx tsc --noEmit`, `npm run build`. Commit.

### Task 8: Impresión de hoja de ruta

**Files:** `app/(app)/remises/hoja-ruta/[id]/imprimir/page.tsx`

- [ ] **Step 1:** Página imprimible dedicada (reutilizando el patrón de
      `mantenimiento/planificacion/[id]/imprimir`: ruta propia + CSS `@media print`,
      no popup `window.open`) con los datos de una `hoja_ruta` (vehículo, chofer,
      fecha, turno, hora de salida, lista de paradas en orden).
- [ ] **Step 2:** Botón "Imprimir" en la tarjeta de ruta (Task 5) navega a esta
      página en una nueva pestaña.
- [ ] **Step 3:** `npx tsc --noEmit`, `npm run build`. Commit.

### Task 9: Import/Export Excel (asistencia/rutas)

**Files:** `app/api/remises/export/**`

- [ ] **Step 1:** Export día/semana/historial en XLSX/CSV/HTML, mismo shape de
      columnas del original (`Fecha, Turno, Búsqueda, Tipo, Remis, Conductor, #,
      Empleado, Dirección`), reusando `xlsxResponse` de `lib/rrhh/xlsxExport.ts` (o
      generalizándolo a `lib/core/xlsxExport.ts` si conviene compartirlo entre
      módulos — evaluar en implementación).
- [ ] **Step 2:** Import de empleados con parser CSV real (no el `split(',')` naive
      del original) o restringir el import a XLSX únicamente.
- [ ] **Step 3:** `npx tsc --noEmit`, `npm run build`. Commit.

### Task 10: Auto-servicio del empleado ("Mi remis")

**Files:** `app/(app)/remises/mi-remis/page.tsx`, `app/api/remises/mi-remis/**`

- [ ] **Step 1:** Flujo de creación de cuenta vinculada: desde la ficha de empleado
      (Task 5), un admin de Remises puede generar/enviar acceso (mismo patrón ya
      construido en RRHH — cuenta Supabase Auth + email, o link de reseteo si ya
      existe la cuenta).
- [ ] **Step 2:** API `GET /api/remises/mi-remis` — resuelve `empleado_id` desde la
      sesión (`usuarios.empleado_id`), devuelve sus asientos de hoy/mañana con
      vehículo/chofer/hora de salida/compañeros de viaje. 403 si no hay
      `empleado_id` vinculado.
- [ ] **Step 3:** Pantalla mínima "Mi remis": toggle Hoy/Mañana, tarjeta con la
      asignación (o estado vacío "sin remis asignado"), botón para activar
      notificaciones push (ver Task 11).
- [ ] **Step 4:** Guard de layout/routing: esta ruta es accesible para cualquier
      usuario autenticado con `empleado_id` vinculado, sin requerir nivel de módulo
      `remises` (a diferencia del resto del panel).
- [ ] **Step 5:** `npx tsc --noEmit`, `npm run build`. Commit.

### Task 11: Notificaciones push (Web Push + Vercel Cron)

**Files:** `public/sw.js` (o el service worker global del SdG si ya existe uno),
`vercel.json`, `app/api/cron/remises-notificaciones/route.ts`,
`lib/remises/webpush.ts`

- [ ] **Step 1:** Generar par de claves VAPID propio del SdG (`web-push
      generate-vapid-keys`), guardar en variables de entorno
      (`WEBPUSH_VAPID_PUBLIC_KEY`/`WEBPUSH_VAPID_PRIVATE_KEY`).
- [ ] **Step 2:** Registro de suscripción del lado del cliente en "Mi remis" (Task
      10): `Notification.requestPermission()` +
      `serviceWorker.pushManager.subscribe({applicationServerKey})`, POST a
      `/api/remises/mi-remis/push-token` que upsertea `remises_push_tokens`.
- [ ] **Step 3:** Manejador `push`/`notificationclick` en el service worker (sin
      dependencia de Firebase — Web Push nativo).
- [ ] **Step 4:** Route Handler de cron (`app/api/cron/remises-notificaciones`,
      protegido por el header `Authorization: Bearer $CRON_SECRET` que agrega Vercel
      Cron): para cada `asientos` de mañana, agrupa por empleado, envía vía
      `web-push` con la `remises_push_tokens` de su `usuario_id` vinculado; si el
      envío falla por suscripción inválida, borra el token (mismo comportamiento que
      el original con tokens FCM inválidos).
- [ ] **Step 5:** `vercel.json` con `crons: [{ path: "/api/cron/remises-notificaciones",
      schedule: "0 22 * * *" }]`.
- [ ] **Step 6:** `npx tsc --noEmit`, `npm run build`. Commit.

### Task 12: Navegación

**Files:** `lib/core/nav.ts`, `lib/remises/auth.ts`, `lib/remises/route-utils.ts`,
`app/(app)/remises/layout.tsx`

- [ ] **Step 1:** `lib/remises/auth.ts` (`nivelRemisesDe`, `puedeEditarRemises`,
      `esAdminRemises`) + `lib/remises/route-utils.ts` (`tiene_acceso_check`,
      `puede_editar_check`, `es_admin_check`), mismo patrón que RRHH.
- [ ] **Step 2:** `app/(app)/remises/layout.tsx`: guard de módulo (redirect si sin
      acceso), salvo para `/remises/mi-remis` que tiene su propio guard (Task 10) y
      no debería vivir bajo este layout si el layout exige nivel de módulo — decidir
      en implementación si `mi-remis` va fuera de `app/(app)/remises/` o si el layout
      distingue el caso.
- [ ] **Step 3:** `NAV`: mover "Remises" a grupo de nivel superior (Hoy, Semana,
      Vehículos, Historial, Configuración), corregir el placeholder actual
      (`/rrhh/remises` → `/remises`).
- [ ] **Step 4:** `npx tsc --noEmit`, `npm run build`. Commit.

### Task 13: Migración de datos reales de producción

**Bloqueada hasta conseguir credenciales de Firestore** (service account de solo
lectura del proyecto `remisgest`, o export/dump). El resto de la fase no depende de
esto.

- [ ] **Step 1:** Conseguir credencial de solo lectura y confirmar alcance con el
      usuario: cuántos empleados/vehículos/choferes reales, si hay datos de prueba a
      excluir (mismo tipo de pregunta que se hizo en RRHH).
- [ ] **Step 2:** Script Node de migración (`admin.firestore()` solo lectura +
      `@supabase/supabase-js` para escribir), leyendo `orgs/*.state` (parsear el JSON
      del blob), remapeando IDs `uid()` de remisgest → `uuid` de Postgres, resolviendo
      empleados contra los ya migrados de RRHH por nombre/legajo si corresponde (a
      confirmar con el usuario — puede que no todos los "employees" de remisgest
      tengan equivalente en RRHH, o viceversa).
- [ ] **Step 3:** Migrar: choferes (extraídos de `vehicles[].driver`/`.phone`,
      deduplicados por nombre), vehículos, turnos (si difieren de los 3 default),
      empleados (extensión `remises_empleados_datos`), y opcionalmente el historial
      reciente de `routes`/`history` si el usuario lo quiere conservar (a confirmar —
      puede no valer la pena migrar rutas viejas).
- [ ] **Step 4:** Verificar conteos + spot-check contra el REST de Supabase.
      Limpiar el script y cualquier credencial cacheada.
- [ ] **Step 5:** Commit (o nota en el plan si la migración se corrió manualmente
      sin dejar código de un solo uso en el repo, mismo criterio que RRHH).

### Task 14: Verificación final de la Fase 3

- [ ] **Step 1:** `npm test` → verde (tests nuevos del motor de rutas + los ya
      existentes de Fases 0-2).
- [ ] **Step 2:** `npx tsc --noEmit` → sin errores.
- [ ] **Step 3:** `npm run build` → build exitoso.
- [ ] **Step 4:** Flujo manual completo: login admin → Vehículos/Choferes →
      Configuración (fábrica) → Empleados (geocodificar) → Hoy (asistencia → generar
      Ida/Vuelta → editar manualmente → imprimir) → Semana → Historial/Plantillas →
      vincular un empleado a una cuenta → login como ese empleado → Mi remis →
      activar notificaciones.

**Definición de "hecho" para Fase 3:** Remises funciona de punta a punta sobre el
núcleo unificado, sin ninguna dependencia de Firebase, con el bug `seats`/`stops`
corregido de raíz, con los datos reales de producción migrados, y con notificaciones
push funcionando vía Vercel Cron.

## Notas para la fase siguiente

Con esto se completan las tres fases de migración de apps (Mantenimiento, RRHH,
Remises) sobre el núcleo unificado del SdG. Quedaría, si el usuario lo pide más
adelante: apagar/dar de baja las apps originales (APPRRHH, remisgest, y la de
Mantenimiento) y sus proyectos Firebase/hosting asociados; permisos granulares por
sector para encargados (pendiente explícito desde la Fase 2); y cualquier
endurecimiento de seguridad que surja de una revisión general post-unificación.

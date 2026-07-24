# Fase 1 — Adoptar Mantenimiento Implementation Plan

**Goal:** Portar el módulo de Mantenimiento a `app/(app)/mantenimiento/`, con su esquema
reconciliado contra el núcleo (`empresas`, `sectores`, `usuarios`) y su acceso gateado por
`usuario_modulos`. Ver el spec de diseño:
`docs/superpowers/specs/2026-07-24-fase-1-mantenimiento-design.md`.

**Convenciones:** mismas que Fase 0. Commits pequeños en español, directo a `main`
(decisión del usuario para esta fase), `Co-Authored-By: Claude Sonnet 5
<noreply@anthropic.com>`. Checkboxes se van marcando a medida que se completa cada paso —
este documento es el tracker de progreso entre sesiones.

**Fuente:** repo original clonado en `/Users/delfina/Downloads/mantenimiento` (sólo
lectura, para copiar/portar código).

---

### Task 1: Migración — relajar núcleo + tablas de dominio mantenimiento

**Files:** `supabase/migrations/004_nucleo_ajustes_mantenimiento.sql`,
`supabase/migrations/005_mantenimiento_schema.sql`,
`supabase/migrations/006_mantenimiento_rls.sql`

- [x] **Step 1:** `004_nucleo_ajustes_mantenimiento.sql` — `empresas.status plant_status`
      (crear tipo `plant_status`), `empresa_status_log`; `sectores.empresa_id` a nullable,
      `sectores.transversal boolean`, `sectores.status plant_status`, constraint
      `empresa_id/transversal` mutuamente excluyentes, índice único parcial para nombre de
      sectores transversales.
- [x] **Step 2:** `005_mantenimiento_schema.sql` — tablas de dominio listadas en el spec
      (`equipos`, `equipos_checklists`, `mantenimientos_programados`,
      `mantenimientos_ejecuciones`, `equipos_status_log`, `sectores_status_log`,
      `ordenes_trabajo`, `planificacion_diaria`, `planificacion_diaria_items`), enums
      propios (`equipment_status`, `criticality_level`, `maintenance_type`,
      `schedule_type`, `schedule_status`), trigger `equipos_updated_at`, trigger
      `sync_equipos_status_from_ot`.
- [x] **Step 3:** `006_mantenimiento_rls.sql` — función `puede_editar_mantenimiento()`,
      RLS en todas las tablas nuevas (lectura abierta a authenticated, escritura gateada),
      bucket `execution-photos` + policies corregidas.
- [x] **Step 4:** Seed de prueba — 2-3 equipos, 1 checklist, 1 mantenimiento programado, en
      `supabase/migrations/007_seed_mantenimiento.sql`, idempotente.
- [x] **Step 5:** Verificar tipos: `npx tsc --noEmit`.
- [x] **Step 6:** Commit.

### Task 2: Tipos TS del dominio + registrar módulo en nav/acceso

**Files:** `lib/mantenimiento/types.ts`, `lib/core/nav.ts`, `lib/core/access.ts` (si hace
falta ajustar), `lib/core/access.test.ts`

- [x] **Step 1:** `lib/mantenimiento/types.ts` — espejo TS de las tablas nuevas (mismo
      patrón que `lib/core/types.ts`).
- [x] **Step 2:** Agregar entrada "Mantenimiento" a `NAV` en `lib/core/nav.ts` con sus
      hijos (Equipos, Mantenimientos, Ejecuciones, Historial, Órdenes de trabajo,
      Planificación).
- [x] **Step 3:** Revisar `modulosVisibles`/tests — ya soporta el módulo `mantenimiento`
      del enum `Modulo` del núcleo (Fase 0 ya lo incluía); se agregó además
      `nivelEnModulo()` (TDD) para que el layout del módulo resuelva el nivel de acceso.
- [x] **Step 4:** Verificar tipos y tests: `npx tsc --noEmit && npm test`.
- [x] **Step 5:** Commit.

### Task 3: Layout y guarda de acceso del módulo

**Files:** `app/(app)/mantenimiento/layout.tsx`

- [x] **Step 1:** Layout que redirige si el usuario no tiene `mantenimiento` en
      `modulosVisibles`; expone `nivel` de acceso (lectura/edicion/admin) a las páginas
      hijas vía contexto (`lib/mantenimiento/context.tsx` — `NivelMantenimientoProvider`,
      `useNivelMantenimiento`, `usePuedeEditarMantenimiento`).
- [x] **Step 2:** Verificar tipos.
- [x] **Step 3:** Commit.

### Task 4: Página Equipos (listado + detalle + checklist)

**Files:** `app/(app)/mantenimiento/equipos/page.tsx`,
`app/(app)/mantenimiento/equipos/EquiposClient.tsx`,
`app/(app)/mantenimiento/equipos/[id]/page.tsx`,
`app/(app)/mantenimiento/equipos/[id]/EquipoDetalle.tsx`,
`app/(app)/mantenimiento/equipos/[id]/checklist/page.tsx`,
`app/(app)/mantenimiento/equipos/[id]/checklist/ChecklistEditor.tsx`,
`app/api/mantenimiento/equipos/[id]/route.ts`, `app/api/mantenimiento/equipos/import/route.ts`

- [x] **Step 1:** Portar listado + import Excel, reapuntando `plants`→`empresas`,
      `sectors`→`sectores`, `app_users`→`usuarios`, chequeo de rol hardcodeado →
      `nivel` de `usuario_modulos`. También se portó `InfoTip` (`components/InfoTip.tsx`)
      y las clases utilitarias de Mantenimiento (`.input`, `.btn-primary`, `.card`,
      `.badge`, `.table-base`, etc.) a `app/globals.css`.
- [x] **Step 2:** Portar detalle + cambio de estado + edición.
- [x] **Step 3:** Portar editor de checklist.
- [x] **Step 4:** Verificar tipos y build: `npx tsc --noEmit` y `npm run build` — ambos
      exitosos.
- [ ] **Step 5:** Verificar en navegador — **pendiente**: falta `.env.local` con las
      credenciales del Supabase del SdG (ver instrucciones dadas al usuario).
- [x] **Step 6:** Commit.

### Task 5: Dashboard de Mantenimiento

**Files:** `app/(app)/mantenimiento/page.tsx`,
`app/(app)/mantenimiento/DashboardClient.tsx`

- [x] **Step 1:** Portar KPIs, gráficos (recharts), modal de cambio de estado de sector.
      Incluye `app/api/mantenimiento/sectores/status/route.ts` (no estaba en el plan
      original de archivos, pero el dashboard depende de él). Sectores transversales
      se muestran con un chip "Transversal" además de las empresas.
- [x] **Step 2:** Verificar tipos y build.
- [x] **Step 3:** Commit.

### Task 6: Mantenimientos programados + Ejecuciones + Historial

**Files:** `app/(app)/mantenimiento/mantenimientos/**`,
`app/(app)/mantenimiento/ejecuciones/**`, `app/(app)/mantenimiento/historial/**`,
`app/api/mantenimiento/ejecuciones/route.ts`

- [ ] **Step 1:** Portar CRUD de programaciones (crear/editar/pausar/eliminar, fotos de
      referencia a Storage).
- [ ] **Step 2:** Portar registro de ejecuciones (con avance de `next_date`), sin el envío
      de mail (queda comentado/pendiente de integración de Resend).
- [ ] **Step 3:** Portar historial + export CSV.
- [ ] **Step 4:** Verificar tipos.
- [ ] **Step 5:** Commit.

### Task 7: Órdenes de trabajo (CRUD manual, sin Sheets)

**Files:** `app/(app)/mantenimiento/ordenes/**`,
`app/api/mantenimiento/ordenes/route.ts`, `app/api/mantenimiento/ordenes/link/route.ts`

- [ ] **Step 1:** Portar listado/Kanban y alta manual de OT (sin la llamada a Sheets de
      `POST /api/work-orders` original).
- [ ] **Step 2:** Portar cambio de estado (sin reescritura en Sheets) y vínculo con
      mantenimiento programado.
- [ ] **Step 3:** Verificar tipos.
- [ ] **Step 4:** Commit.

### Task 8: Planificación diaria (+ impresión)

**Files:** `app/(app)/mantenimiento/planificacion/**`,
`app/api/mantenimiento/planificacion/route.ts`,
`app/api/mantenimiento/planificacion/[id]/route.ts`

- [ ] **Step 1:** Portar listado/detalle de planes, agregar/quitar OT, asignar
      responsable. Corregir el hallazgo del reporte: el detalle y el listado deben usar
      el cliente de sesión del usuario (RLS), no `createAdminClient()`, salvo que la
      operación puntual lo requiera.
- [ ] **Step 2:** Portar vista de impresión — agregar el chequeo de sesión/rol que
      faltaba en el original.
- [ ] **Step 3:** Verificar tipos.
- [ ] **Step 4:** Commit.

### Task 9: Verificación final de la Fase 1

- [ ] **Step 1:** `npm test` → verde.
- [ ] **Step 2:** `npx tsc --noEmit` → sin errores.
- [ ] **Step 3:** `npm run build` → build exitoso.
- [ ] **Step 4:** Flujo manual completo (con `.env.local` y seed aplicados): login → ver
      Mantenimiento en el sidebar → navegar cada pantalla → crear/editar un equipo → crear
      un mantenimiento programado → registrar una ejecución → crear y mover una OT → armar
      un plan diario e imprimirlo.

**Definición de "hecho" para Fase 1:** el módulo de Mantenimiento funciona de punta a
punta sobre el núcleo unificado (empresas/sectores/usuarios compartidos con RRHH), con
acceso gateado por `usuario_modulos`, sin ninguna tabla ni código propios de la app vieja
(`plants`, `sectors`, `app_users` no existen en el SdG). Sheets, alertas por mail y
migración de datos reales quedan documentados como pendientes explícitos.

## Notas para la fase siguiente

- **Fase 2 (RRHH):** al construir `usuario_modulos`/`empleados` reales para RRHH, revisar
  si algún `empleado` debe enlazarse a un `usuario` de Mantenimiento (mismo criterio que
  ya anticipa el spec general).
- **Integraciones diferidas:** cuando se retome Sheets, revisar el hallazgo del reporte de
  exploración sobre el trigger `sync_equipos_status_from_ot` y el patrón de escritura
  best-effort (no bloquear la respuesta HTTP si falla Sheets).

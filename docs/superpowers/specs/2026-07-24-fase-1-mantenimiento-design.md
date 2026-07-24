# Fase 1 — Adoptar Mantenimiento — Design Spec

**Fecha:** 2026-07-24
**Estado:** Diseño aprobado — pendiente de plan de implementación

## Objetivo

Portar el módulo de Mantenimiento (hoy `github.com/procedimientos-polcecal/mantenimiento`,
Next.js 16 + Supabase en producción) al SdG, bajo `app/(app)/mantenimiento/`, reapuntando
sus tablas al núcleo compartido (`empresas`, `sectores`, `usuarios`) ya construido en la
Fase 0.

## Punto de partida

Mantenimiento es una app **en producción real**, no un prototipo: tiene integración con
Google Sheets (sync + webhook de órdenes de trabajo), alertas por mail vía cron+Resend, y
un checklist de migración de dominio que confirma despliegue activo en Vercel. El reporte
de exploración completo (esquema migración por migración, RLS, inventario de páginas y
rutas API, riesgos) está volcado en este documento; el detalle línea por línea vive en el
historial de la sesión que lo generó.

El Supabase de destino (`sqfdqoxyqkaekxlluvpg`) es un **proyecto nuevo y vacío** creado
específicamente para el SdG — no es el de producción de Mantenimiento. Esto habilita
aplicar las migraciones con libertad, sin riesgo sobre datos reales.

## Decisiones tomadas

1. **Rol `gerente` → `encargado`** en el vocabulario del núcleo. `administrador` → `admin`,
   `operario` → `operario`, `admin_sistema` → `admin_sistema` (estos tres ya coinciden o
   son mapeo directo).
2. **Integraciones externas (Sheets sync/webhook, alertas cron+Resend) quedan pendientes**
   para una fase posterior. El módulo de Órdenes de trabajo se porta como CRUD manual
   (alta/edición/cambio de estado desde la UI), sin sincronización automática con la
   planilla. Los endpoints `work-orders/sync`, `work-orders/webhook` y `alertas` no se
   portan en esta fase.
3. **Migración de datos reales de producción queda para un paso de corte aparte**
   (alineado con la Fase 4 del spec general). La Fase 1 deja el código y el esquema
   funcionando sobre datos de seed/prueba.
4. **Plantas "AMBOS" (transversales a Polcecal y Polysan):** se modelan relajando
   `sectores.empresa_id` a nullable y agregando `sectores.transversal boolean default
   false`. Un sector transversal (`transversal = true`, `empresa_id = null`) es visible
   para ambas empresas. Mismo criterio se aplica a `equipos` indirectamente (cuelgan de
   `sector_id`, no necesitan su propia empresa_id).

## Reconciliación de esquema

### Tipos duplicados

El núcleo (Fase 0) ya define `create type user_role as enum (...)`. Mantenimiento define
su propio `user_role` con valores distintos. **No se recrea el tipo**: el dominio
mantenimiento reutiliza el `user_role` y la tabla `usuarios` del núcleo directamente. No
existe una tabla `app_users` separada en el SdG.

### Plantas → Empresas

`plants` desaparece como tabla propia. Los 3 valores fijos (`POLCECAL`, `POLYSAN`,
`AMBOS`) se resuelven así: `POLCECAL`/`POLYSAN` ya existen en `empresas` (seed de Fase 0).
`AMBOS` no se crea como empresa (el núcleo es explícito: "el AMBOS de Mantenimiento NO es
una empresa") — los sectores que hoy cuelgan de la planta `AMBOS` pasan a ser sectores
`transversal = true` sin `empresa_id`.

`plant_status`/`plant_status_log` (estado operativo ACTIVA/PARADA/EN_REPARACION) se
necesita tanto a nivel empresa como sector. Se agrega:
- `empresas.status plant_status not null default 'ACTIVA'` (nueva columna, migración
  aditiva sobre la tabla del núcleo).
- `empresa_status_log` (mismo patrón que `sector_status_log`).

Un sector transversal (`empresa_id null`) no tiene "empresa" cuyo estado cambiar desde esa
pantalla — el cambio de estado de planta para sectores transversales queda fuera de
alcance de esta fase (no existía un caso real de "AMBOS" con estado propio distinto de sus
partes).

### Sectores

`sectors` → `sectores` (ya existe, Fase 0). Cambios necesarios sobre la tabla del núcleo:
- `empresa_id` pasa a nullable.
- Se agrega `transversal boolean not null default false`.
- Se agrega `status plant_status not null default 'ACTIVA'` (Mantenimiento la necesita;
  RRHH no la usaba pero no la afecta).
- Constraint: `check ((empresa_id is not null) <> transversal)` — o tiene empresa, o es
  transversal, nunca ambas cosas ni ninguna.
- `unique (empresa_id, nombre)` del núcleo no cubre sectores transversales (empresa_id
  null permite múltiples nulls en Postgres) — se agrega un índice único parcial
  `unique (nombre) where transversal` para evitar duplicados ahí también.

### Usuarios

`app_users` → `usuarios` (ya existe, Fase 0). `full_name` (campo único) se separa en
`nombre`/`apellido` al portar datos (no aplica en Fase 1 porque no hay datos reales
todavía; el seed de prueba ya crea usuarios con nombre/apellido separados).

Acceso al módulo: se usa `usuario_modulos` del núcleo (ya existente), no el rol global
solo. Un usuario ve Mantenimiento si tiene un registro `usuario_modulos(modulo =
'mantenimiento')`, y dentro del módulo `nivel` (`lectura`/`edicion`/`admin`) reemplaza el
chequeo de rol hardcodeado (`role in ('admin_sistema','administrador')`) que usaba
Mantenimiento standalone. `admin_sistema` sigue viendo/editando todo por su rol global
(igual que hoy en el núcleo).

### Tablas de dominio (nuevas, prefijo implícito por carpeta `mantenimiento/`)

Se portan tal cual (con `sector_id`/`usuario_id`/`empleado_id` reapuntados al núcleo) y
**se limpia** lo marcado como legacy/dead en el reporte de exploración:

- `equipos` (ex `equipment`)
- `equipos_checklists` (ex `equipment_checklists`)
- `mantenimientos_programados` (ex `maintenance_schedules`)
- `mantenimientos_ejecuciones` (ex `maintenance_executions`) — se elimina la columna
  `status` (enum legacy nunca usado por la app) y las columnas `photos_start`,
  `photos_end`, `drive_folder_url` (reemplazadas por `photo_urls`, nunca usadas). Se
  conserva únicamente `execution_status text` (los valores reales:
  `completado`/`parcial`/`cancelado`).
- `equipos_status_log`
- `sectores_status_log` (ex `sector_status_log`)
- `empresas_status_log` (nueva, ver arriba)
- `ordenes_trabajo` (ex `work_orders`) — se conserva la estructura completa (incluidas
  columnas de sync como `sheets_row`, `app_created`) para no bloquear portar la
  integración más adelante, pero **sin los enums `ot_estado`/`ot_tipo`/`ot_quien`** (nunca
  se aplicaron en origen; se mantienen como `text` libre, igual que hoy).
- `planificacion_diaria` (ex `daily_plans`)
- `planificacion_diaria_items` (ex `daily_plan_items`)

Se **descartan** en esta fase (no se portan): el trigger
`sync_equipment_status_from_ot` se reimplementa en Fase de integración de OT si hace
falta — para Fase 1, dado que Sheets no está conectado, las OT se crean/editan a mano
desde la UI, así que el trigger se recrea igual (es lógica de negocio de la app, no
depende de Sheets) apuntando a `ordenes_trabajo`/`equipos`/`equipos_status_log`.

### RLS

Se reutiliza `es_admin()` del núcleo. El patrón de Mantenimiento (lectura abierta a
`authenticated`, escritura gateada) se conserva, pero el gate de escritura pasa a
verificar `usuario_modulos` (nivel `edicion`/`admin` en `mantenimiento`) además de
`es_admin()`, vía una función helper `puede_editar_mantenimiento()`.

### Storage

Bucket `execution-photos` se recrea igual. Se corrige el bug de policy detectado en el
reporte (las fotos de referencia de mantenimientos programados se suben a
`schedules/{id}/...`, que no matchea la policy de DELETE basada en `{uid}/...`) ajustando
la policy para cubrir ambos patrones de path.

## Alcance de esta fase

**Entra:**
- Esquema reconciliado + RLS + seed de prueba.
- Navegación: "Mantenimiento" como módulo de primer nivel en `lib/core/nav.ts`.
- Páginas: Dashboard, Equipos (listado + detalle + checklist), Mantenimientos
  programados, Ejecuciones, Historial, Órdenes de trabajo (CRUD manual, sin Sheets),
  Planificación diaria (+ impresión).
- Gestión de usuarios del módulo se resuelve desde `/administracion` del núcleo
  (asignación de `usuario_modulos`), no desde una pantalla propia de Mantenimiento — la
  pantalla `/usuarios` de Mantenimiento standalone no se porta como tal.

**No entra (queda para fases/tickets posteriores):**
- Sync/webhook con Google Sheets.
- Alertas por mail (cron + Resend).
- Migración de datos reales de producción.
- Modo offline (Dexie) — se evalúa si se re-introduce una vez validado el módulo online.

## Riesgos heredados a vigilar durante el port

- Mismatch entre `execution_status` (TEXT) y valores libres — no hay constraint hoy;
  se agrega `check (execution_status in ('completado','parcial','cancelado'))` al portar,
  ya que es un esquema nuevo sin datos que puedan violarlo.
- `ordenes_trabajo.estado` usa `SUSPENDIDA` en la app pero no en el enum original (que de
  todos modos nunca se aplicó) — se mantiene como `text` libre, sin constraint estricto,
  para no bloquear valores que la UI ya usa.

-- ============================================================
-- SdG — Mantenimiento: la lectura se cierra, salvo equipos
--
-- Siete tablas del módulo tenían la lectura abierta a cualquier usuario
-- autenticado. No fue una decisión: vienen con `using (true)` desde la 006, y
-- la 029 —que sí cerró `avisos`, `ordenes_servicio`, `os_comparativas`,
-- `produccion_semanal` y `ordenes_trabajo_repuestos` con `mant_puede_ver()`—
-- no las alcanzó. Quedaron como el resto del módulo debería haber quedado.
--
-- Apareció midiendo qué hereda el asistente de IA (ver docs/ASISTENTE.md):
-- cruzando `information_schema.tables` con `pg_policies` salieron 30 tablas de
-- 102 legibles por cualquiera, y siete eran de acá. El asistente no las
-- filtraba por su cuenta a propósito —una segunda definición de permisos es la
-- que queda vieja— así que se arregla donde corresponde, en las policies, y
-- todo lo demás lo hereda solo.
--
-- ── `equipos` NO se cierra, y es deliberado ──────────────────
--
-- Es el único caso medido donde cerrarlo rompe cosas que hoy andan. Lo leen,
-- desde fuera de Mantenimiento:
--
--   app/(app)/compras/requerimientos/page.tsx   el equipo de un RI
--   app/(app)/compras/ubicaciones/page.tsx      las ubicaciones son equipos
--   app/api/compras/requerimientos/route.ts
--   lib/compras/sheets.ts                       lo exporta a la planilla
--   lib/inventario/equipos.ts                   a dónde va lo que sale del pañol
--   lib/inventario/sincronizar.ts
--   app/api/facturacion/facturas/[id]/lineas/route.ts
--   app/api/buscar/route.ts                     el buscador global del header
--
-- O sea que en los hechos `equipos` dejó de ser una tabla de Mantenimiento y
-- pasó a ser un catálogo del núcleo, como `sectores` o `productos`: cuatro
-- módulos lo leen para nombrar a qué máquina pertenece algo. Cerrarlo dejaría
-- a un comprador sin ver el equipo de su propio requerimiento.
--
-- Se deja abierto y anotado en vez de cerrarlo y romper, que es la misma
-- decisión que tomó la 018 con Compras. Si algún día se quiere cerrar de
-- verdad, primero hay que mover el catálogo al núcleo con su propia policy —
-- es un cambio de diseño, no un ajuste de permisos.
--
-- `equipos_checklists` y `equipos_status_log` sí se cierran: son el detalle
-- técnico y la bitácora de estado de la máquina, y no los lee nadie de afuera.
--
-- ── Qué se comprobó antes ────────────────────────────────────
--
-- `app/api/home/resumen/route.ts` es el único consumidor de `ordenes_trabajo`
-- fuera del módulo, y ya llama a `resumenMantenimiento()` sólo si
-- `modulos.has("mantenimiento")`. Las otras seis no tienen ningún lector
-- externo (medido con grep sobre `app/` y `lib/`).
--
-- Sólo se tocan las policies de SELECT. Las de escritura quedan como están.
-- ============================================================

-- Órdenes de trabajo
drop policy if exists ot_select on ordenes_trabajo;
create policy ot_select on ordenes_trabajo
  for select to authenticated using (mant_puede_ver());

-- Mantenimientos programados y sus ejecuciones
drop policy if exists mp_select on mantenimientos_programados;
create policy mp_select on mantenimientos_programados
  for select to authenticated using (mant_puede_ver());

drop policy if exists me_select on mantenimientos_ejecuciones;
create policy me_select on mantenimientos_ejecuciones
  for select to authenticated using (mant_puede_ver());

-- Planificación diaria
drop policy if exists pd_select on planificacion_diaria;
create policy pd_select on planificacion_diaria
  for select to authenticated using (mant_puede_ver());

drop policy if exists pdi_select on planificacion_diaria_items;
create policy pdi_select on planificacion_diaria_items
  for select to authenticated using (mant_puede_ver());

-- Detalle y bitácora de la máquina
drop policy if exists equipos_checklists_select on equipos_checklists;
create policy equipos_checklists_select on equipos_checklists
  for select to authenticated using (mant_puede_ver());

drop policy if exists equipos_status_log_select on equipos_status_log;
create policy equipos_status_log_select on equipos_status_log
  for select to authenticated using (mant_puede_ver());

-- `equipos` queda con `using (true)` a propósito. Ver el encabezado.
comment on table equipos is
  'Las máquinas de planta. La lectura es abierta a propósito: además de '
  'Mantenimiento la leen Compras, Inventario, Facturación y el buscador '
  'global, así que en los hechos es un catálogo del núcleo. Ver la migración '
  '20260916110349.';

-- ============================================================
-- SdG — RRHH: índices para las consultas que barren el padrón
--
-- Las pantallas dejaron de recalcular antes de leer, así que ahora leen y nada
-- más: lo que queda es que esas lecturas no hagan seq scan. `calculos_diarios`
-- ya tiene el índice único (empleado_id, fecha) y uno por `fecha`, que cubren
-- los rangos por empleado. Faltan los filtros por bandera, que hoy recorren la
-- tabla entera.
--
-- A 14.682 filas nada de esto se nota. Van igual porque la tabla crece una fila
-- por empleado y por día —con 70 empleados son ~25.000 filas al año— y estos
-- índices son chicos: parciales, sólo sobre las filas que cumplen la condición.
-- ============================================================

-- Faltas sin clasificar: la pantalla de Ausencias y el Analítico. Parcial,
-- porque las filas que cumplen son una minoría y el índice queda diminuto.
create index if not exists calculos_diarios_sin_clasificar_idx
  on calculos_diarios (fecha)
  where ausente and justificada is null;

-- Top de ausencias del dashboard.
create index if not exists calculos_diarios_ausentes_idx
  on calculos_diarios (fecha)
  where ausente;

-- Top de tardanzas: la consulta pide `tarde OR retiro_anticipado`, así que un
-- índice parcial por cada bandera, que es lo que el planner puede combinar.
create index if not exists calculos_diarios_tarde_idx
  on calculos_diarios (fecha)
  where tarde;

create index if not exists calculos_diarios_retiro_idx
  on calculos_diarios (fecha)
  where retiro_anticipado;

-- El recálculo lee los días corregidos a mano para no pisarlos, y la planilla
-- los distingue de los calculados.
create index if not exists calculos_diarios_manual_idx
  on calculos_diarios (empleado_id, fecha)
  where horas_manual;

-- Francos y vacaciones se filtran por rango de fecha en el listado, el export y
-- la planilla general; hoy sólo tienen índice por empleado.
create index if not exists francos_fecha_generado_idx
  on francos (fecha_generado);

create index if not exists vacaciones_rango_idx
  on vacaciones (fecha_desde, fecha_hasta);

-- El importador y el motor borran/leen fichadas por origen dentro de un rango.
create index if not exists fichadas_origen_fecha_idx
  on fichadas (origen, fecha);

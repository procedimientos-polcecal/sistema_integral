-- ============================================================
-- SdG — RRHH: poner el módulo al día con APPRRHH
-- Dos cambios de datos que trae la última versión de la app de origen
-- (github.com/delfinapuch3/APPRRHH):
--   1. La modalidad de pago del empleado (jornal o mensual), que la
--      planilla general usa para separar el personal.
--   2. El período de vacaciones que nace de una ausencia tipo "Vacaciones",
--      para que el balance por año no quede duplicado ni huérfano.
-- ============================================================

create type modalidad_pago as enum ('JORNAL', 'MENSUAL');

-- Vive en `empleados` (núcleo) y no en `rrhh_empleados_datos` porque va de la
-- mano de `valor_hora_normal` y `horas_teoricas_diarias`, que ya están acá: es
-- el mismo grupo de datos de remuneración, y así la planilla puede filtrar por
-- modalidad sin joinear una tabla dispersa.
alter table empleados
  add column modalidad_pago modalidad_pago not null default 'JORNAL';

-- Cuando el período se generó desde el formulario de Ausencias (motivo
-- "Vacaciones"), queda vinculado a esa ausencia: si se borra o cambia de
-- motivo, este período se borra o se actualiza con ella, en vez de quedar
-- descontando un balance que ya no corresponde. Los períodos cargados a mano
-- desde la pestaña Vacaciones tienen `ausencia_id` en null, como siempre.
alter table vacaciones
  add column ausencia_id uuid unique references ausencias(id) on delete cascade;

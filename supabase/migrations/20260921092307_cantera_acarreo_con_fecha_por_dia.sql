-- ============================================================
-- SdG — Cantera: el acarreo sin pesada pasa a cargarse por día
--
-- `cantera_acarreos` (20260914091110) guardaba las 5 actividades sin pesada
-- (viajes de estabilizado, horas de destape, viaje de bloques, horas de
-- bochones, materiales Pezzuchi) como UN TOTAL POR MES — "Siempre el día 1:
-- es un total mensual, no una fecha de evento", decía su propio comentario.
--
-- El usuario pidió poder asignarle fecha a cada una de las 5, explícitamente
-- EN LA MISMA tabla y la misma pantalla por fletero — no una tabla aparte
-- (un primer intento con `cantera_acarreo_diario`, sin correr todavía, se
-- descarta acá mismo: nunca llegó a tener datos).
--
-- `fecha` pasa a ser NOT NULL: de acá en más toda carga es por día puntual,
-- no por mes. Las filas ya cargadas (todo lo corrido hasta el 21/09/2026)
-- son un total mensual sin desglose real por día — se les asigna el día 1
-- de su mes como fecha, un placeholder honesto: no hay forma de recuperar
-- qué día del mes se hizo cada viaje de un mes ya cerrado. Quedan visibles
-- como "una carga del día 1" en la nueva pantalla, editables como cualquier
-- otra.
--
-- `mes` SIGUE existiendo (ahora `date_trunc('month', fecha)`, calculado por
-- la app al guardar, no acá): lo sigue necesitando `tarifaVigente` (tarifa
-- vigente por mes) y el filtro por mes de `traerAcarreos`. Cambia quién lo
-- escribe, no su forma.
--
-- La unique constraint pasa de (fletero_id, tipo, mes) —un total por mes— a
-- (fletero_id, tipo, fecha) —un total por día—: ahora puede haber más de
-- una fila del mismo fletero+tipo en el mismo mes, una por día. El pago
-- mensual (`resumenPorFletero`, en `lib/cantera/acarreo.ts`) pasa a sumar
-- todas las filas del mes en vez de asumir una sola — se corrige en el
-- mismo commit que esta migración, no puede quedar la una sin la otra.
-- ============================================================

alter table cantera_acarreos add column if not exists fecha date;

update cantera_acarreos set fecha = mes where fecha is null;

alter table cantera_acarreos alter column fecha set not null;

alter table cantera_acarreos drop constraint cantera_acarreos_fletero_id_tipo_mes_key;
alter table cantera_acarreos add constraint cantera_acarreos_fletero_tipo_fecha_key unique (fletero_id, tipo, fecha);

create index if not exists cantera_acarreos_fecha_idx on cantera_acarreos (fecha);

comment on table cantera_acarreos is
  'Una fila por fletero, tipo (actividad sin pesada) y día — el material con pesada va en cantera_pesadas y se suma solo. `mes` es date_trunc(fecha) para la tarifa vigente y los filtros mensuales; el monto (cantidad × tarifa vigente en mes) se calcula al leer, no se guarda. Las filas cargadas antes del 21/09/2026 son un total mensual sin desglose real por día, con fecha = día 1 del mes como placeholder.';

notify pgrst, 'reload schema';

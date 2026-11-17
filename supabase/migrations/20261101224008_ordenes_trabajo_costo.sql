-- ============================================================
-- SdG — Mantenimiento: lo que se le pagó al contratista por una OT
--
-- Las OT que salen del cuaderno de PIPARO traen un costo: lo que se le pagó
-- por ese trabajo. Hasta hoy una OT no tenía dónde guardarlo, porque el costo
-- de una OT era el de los repuestos que se le cargaban.
--
-- POR QUÉ ES UNA COLUMNA Y NO UN REPUESTO CON PRECIO. Meterlo como repuesto
-- lo mezclaría con el stock y con las cuentas de repuestos, y mano de obra de
-- un tercero no es un repuesto.
--
-- OJO CON LA CUENTA DEL EQUIPO: **`costoEquipo.ts` no suma esta columna**.
-- Esa cuenta saltea a propósito las OT de contratista, y esta columna sólo se
-- llena en ésas. Si alguien la suma ahí, el costo de una máquina se infla por
-- lo que ya se cuenta en otro lado. Hacia la planilla viaja dentro del texto
-- de `REPUESTO UTILIZADO`, no en una columna propia.
--
-- Va sola en su archivo: una columna en `ordenes_trabajo`, que es de las
-- tablas más leídas del sistema, no tiene por qué caer junto con tablas
-- nuevas, y si falla no arrastra a las otras.
-- ============================================================

alter table public.ordenes_trabajo
  add column if not exists costo numeric;

comment on column public.ordenes_trabajo.costo is
  'Lo que se le pagó al contratista por este trabajo. NO lo suma costoEquipo.ts, que saltea las OT de contratista: se exporta dentro del texto de REPUESTO UTILIZADO. Null en las OT que no vienen de un contratista.';

-- ============================================================
-- SdG — Cantera: noches de sereno en la perforación
--
-- De la revisión del usuario (10/09/2026). A veces a la perforación se le suma
-- el costo de tener un sereno cuidando el pozo cargado varias noches. En la
-- planilla vieja aparece como una nota suelta en observaciones ("Se sumaron 4
-- noches de serenos ($120000)"); acá se guarda como dato:
--
--   perf_noches_sereno : cuántas noches
--   perf_monto_noche   : el costo de cada noche, en pesos (no en USD: es un
--                        pago local, no va por el TC)
--
-- El monto de la perforación pasa a ser
--   metros × precio_usd_m × tc  +  noches × monto_noche
-- (ver lib/cantera/costos.ts). Los dos campos son nullables: la mayoría de las
-- perforaciones no lleva sereno.
-- ============================================================

alter table cantera_voladuras
  add column if not exists perf_noches_sereno numeric,
  add column if not exists perf_monto_noche   numeric;

comment on column cantera_voladuras.perf_monto_noche is
  'Costo de cada noche de sereno, en pesos. Se suma al monto de la perforación sin pasar por el TC.';

notify pgrst, 'reload schema';

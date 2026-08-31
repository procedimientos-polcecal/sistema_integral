-- ============================================================
-- SdG — Núcleo: mapeo de las empresas con Odoo
--
-- El grupo son dos empresas y Odoo lleva cada registro por separado: toda orden
-- de compra, todo asiento y todo diario pertenece a una `res.company` y sólo a
-- una. Para hablar de la misma empresa en los dos lados hace falta guardar la
-- correspondencia en algún lugar.
--
-- Va como dato y no como constante en el código a propósito: los ids de Odoo son
-- de esta base de Odoo. Si mañana se restaura un backup, se migra a otra
-- instancia o se agrega una tercera empresa, esto se corrige con un update y no
-- con un deploy.
--
-- La columna queda NULL hasta que se corra /api/odoo/ping, que es lo que dice
-- qué id tiene cada empresa del lado de Odoo. El update para llenarla está al
-- final, comentado.
-- ============================================================

alter table empresas
  add column if not exists odoo_company_id integer;

comment on column empresas.odoo_company_id is
  'id de res.company en Odoo. NULL = todavía no mapeada. Lo informa /api/odoo/ping.';

-- Dos empresas del SdG no pueden apuntar a la misma empresa de Odoo: sería
-- contabilizar en un solo patrimonio lo que son dos. El índice es parcial para
-- que los NULL no cuenten como repetidos.
create unique index if not exists empresas_odoo_company_id_uniq
  on empresas (odoo_company_id)
  where odoo_company_id is not null;

-- Una vez que el ping diga los ids reales, llenarlos acá (ejemplo):
--
--   update empresas set odoo_company_id = 1 where nombre = 'POLCECAL';
--   update empresas set odoo_company_id = 2 where nombre = 'POLYSAN';
--
-- No se hace automático por nombre: en Odoo las razones sociales suelen estar
-- escritas distinto ("Polcecal S.A." y no "POLCECAL"), y adivinar el mapeo de
-- las empresas es exactamente el error que no se puede permitir.

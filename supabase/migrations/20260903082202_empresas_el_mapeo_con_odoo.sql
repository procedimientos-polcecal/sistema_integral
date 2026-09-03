-- ============================================================
-- SdG — Empresas: el mapeo con Odoo, con los ids reales
--
-- La `045_empresas_mapeo_odoo.sql` agregó `empresas.odoo_company_id` pero la
-- dejó en null, porque cuando se escribió no sabíamos qué id tenía cada empresa
-- del lado de Odoo. Ahora sí: el diagnóstico del 03/09/2026 contra
-- polcecal.odoo.com leyó `res.company` y devolvió
--
--   id 1 → "Polcecal S.A"    (moneda ARS)
--   id 2 → "Polysan S.A"     (moneda ARS)
--
-- El mapeo se hace a mano y no por nombre automático: en Odoo las razones
-- sociales están escritas distinto que en el SdG ("Polcecal S.A" contra
-- "POLCECAL"), y adivinar cuál es cuál es justo el error que no se puede
-- permitir. Con dos empresas, escribirlo es más barato y más seguro.
--
-- Estos ids son de **esta** base de Odoo (`blueorangegroup-polcecal-main-...`,
-- un build de Odoo.sh). Si alguna vez se restaura desde otra instancia, hay que
-- volver a leer `res.company` y corregir esto: por eso vive como dato y no como
-- constante en el código.
--
-- Además reemplaza el índice único parcial que había dejado la 045 por uno
-- común. Motivo: README.md de esta carpeta, trampa nº2 — un índice parcial no
-- sirve como destino de `ON CONFLICT` y rompe cualquier upsert que apunte a esa
-- columna. Acá hoy nadie hace upsert por `odoo_company_id`, pero el índice
-- común hace exactamente lo mismo (en Postgres los nulos no chocan entre sí) y
-- no deja la trampa armada. Ya se pisó en la 033 y otra vez en la 046.
-- ============================================================

-- Los ids que leyó el diagnóstico. Idempotente: correrlo dos veces no cambia nada.
update empresas set odoo_company_id = 1 where nombre = 'POLCECAL';
update empresas set odoo_company_id = 2 where nombre = 'POLYSAN';

drop index if exists empresas_odoo_company_id_uniq;

create unique index if not exists empresas_odoo_company_id_uniq
  on empresas (odoo_company_id);

-- ============================================================
-- SdG — Despacho: la orden importada no sabe de qué empresa es
--
-- `empresa_id` deja de ser `not null`.
--
-- El motivo es del dato, no de comodidad: **la planilla no tiene columna de
-- empresa**. Las órdenes que se dan de alta en el sistema siempre la saben —la
-- trae el remito de Odoo, o se elige a mano, y la ruta la exige— pero las 1.702
-- del histórico no, y poner una al azar metería el camión en el patrimonio que
-- no es. Null dice "no se sabe", que es la verdad. Es la misma regla que
-- `capataz_id` en Producción y que los enlaces a Odoo de esta misma tabla:
-- enlazar al que se le parece es peor que dejar en null.
--
-- POR QUÉ ESTO ES UNA MIGRACIÓN APARTE Y NO UNA CORRECCIÓN DE LA 20260908104729
--
-- Porque esa ya había corrido. Se la editó después de aplicarla —creyendo que
-- todavía no— y quedaron diciendo cosas distintas: el archivo, nullable; la
-- base, `not null`. El síntoma apareció recién al importar, con un
-- `null value in column "empresa_id" violates not-null constraint`, y el archivo
-- no ayudaba a entenderlo porque decía lo contrario de lo que había pasado.
--
-- La 20260908104729 volvió a decir `not null`, que es lo que realmente creó. Una
-- migración aplicada es un registro de lo que pasó, no un borrador: si se
-- corrige en el lugar, la próxima base que se arme desde cero no queda igual que
-- producción y nadie se enteraría hasta el mismo error, otra vez.
-- ============================================================

alter table despacho_ordenes_carga
  alter column empresa_id drop not null;

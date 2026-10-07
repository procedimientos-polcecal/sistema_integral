-- ============================================================
-- SdG — Un lote de importación puede no tener usuario
--
-- Spec: docs/superpowers/specs/2026-10-07-rrhh-marcaciones-desde-lenox-design.md
--
-- POR QUÉ: `rrhh_import_batches` se reusa para anotar lo que trae la
-- sincronización con Lenox —ya tiene cantidad_registros, cantidad_errores y
-- log_detalle, y es donde la gente ya busca los avisos—. El cron no tiene
-- usuario, y `usuario_id` era not null.
--
-- El `nombre_archivo` de esos lotes dice "Lenox API · 30/09 → 06/10". Se
-- mantiene el nombre de la columna aunque ya no sea siempre un archivo:
-- renombrarla rompería las lecturas existentes para ganar prolijidad.
-- ============================================================

alter table rrhh_import_batches alter column usuario_id drop not null;

comment on column rrhh_import_batches.usuario_id is
  'Quién subió el archivo. NULL cuando el lote lo creó el cron de Lenox.';

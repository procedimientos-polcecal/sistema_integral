-- ============================================================
-- Limpieza de los objetos del repo COMPRAS suelto (archivado)
--
-- NO es una migración: es una corrección de entorno, para bases donde se
-- llegaron a correr las migraciones de github.com/procedimientos-polcecal/COMPRAS
-- antes de portar el módulo al SdG.
--
-- Correr UNA VEZ, y sólo después de verificar con el diagnóstico que esas
-- tablas están vacías o que sus datos no importan (el histórico se recarga
-- desde el xlsx con scripts/import-compras/import.mjs).
--
-- BORRA DATOS. Revisá el bloque de verificación de abajo antes de ejecutar.
-- ============================================================

-- ── 1. Verificación previa ───────────────────────────────────
-- Aborta si alguna tabla del COMPRAS viejo tiene filas: en ese caso hay que
-- decidir a mano qué hacer con esos datos, no borrarlos de una.
do $$
declare
  n bigint;
  t text;
begin
  foreach t in array array[
    'requerimientos', 'cotizaciones', 'requerimiento_historial', 'proveedores'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception
          'La tabla % tiene % filas. Revisalas antes de correr esta limpieza.', t, n;
      end if;
    end if;
  end loop;
end $$;

-- ── 2. Tablas del COMPRAS suelto ─────────────────────────────
-- El orden no importa por el cascade, pero se listan de hija a padre igual.
-- cascade se lleva puestas las policies y FKs que dependan de ellas.
drop table if exists public.requerimiento_historial   cascade;
drop table if exists public.cotizaciones              cascade;
drop table if exists public.requerimientos            cascade;
drop table if exists public.sheets_sincronizaciones   cascade;
drop table if exists public.ubicaciones               cascade;
drop table if exists public.areas                     cascade;
drop table if exists public.proveedores               cascade;

-- app_users: sólo la usaba el COMPRAS suelto (el SdG usa `usuarios`).
-- OJO: si esta base también la comparte la app vieja de Mantenimiento
-- (github.com/procedimientos-polcecal/mantenimiento), NO la borres: comentá
-- esta línea. Aquella app tiene su propio app_users con full_name/is_active.
drop table if exists public.app_users cascade;

-- ── 3. Funciones del COMPRAS suelto ──────────────────────────
-- rol_actual() es la que rompe la 002: allá devolvía text, acá user_role.
-- La 002_nucleo_rls.sql la vuelve a crear con la firma correcta.
-- En el SdG ninguna policy la usa todavía, así que el cascade no rompe nada.
drop function if exists public.rol_actual()            cascade;
drop function if exists public.touch_updated_at()      cascade;
drop function if exists public.log_cambio_estado()     cascade;
drop function if exists public.siguiente_nro_ri()      cascade;
drop function if exists public.marcar_editado_en_app() cascade;

-- ── 4. Listo ─────────────────────────────────────────────────
-- Ahora sí, correr en orden desde supabase/migrations/:
--   001_nucleo_schema.sql          (si no corrió todavía)
--   002_nucleo_rls.sql
--   ... hasta 014
--   015_nucleo_ajustes_compras.sql
--   016_compras_schema.sql
--   017_compras_rls.sql

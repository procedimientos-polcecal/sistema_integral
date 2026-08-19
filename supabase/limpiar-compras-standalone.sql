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
-- Las del SdG llevan prefijo (compras_log_cambio_estado, etc.), así que estas
-- sin prefijo son restos del repo viejo. set_updated_at() NO se toca: esa sí
-- la usan Mantenimiento y RRHH.
drop function if exists public.touch_updated_at()      cascade;
drop function if exists public.log_cambio_estado()     cascade;
drop function if exists public.siguiente_nro_ri()      cascade;
drop function if exists public.marcar_editado_en_app() cascade;

-- rol_actual() es un caso aparte: existe en los dos proyectos con firmas
-- distintas y por eso choca. Sólo se borra si quedó la vieja (devuelve text y
-- lee de app_users). Si la que está viva es la del núcleo (user_role sobre
-- usuarios), se deja intacta: borrarla sin recrearla dejaría a es_admin() y a
-- las policies futuras sin su función de apoyo.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rol_actual'
      and pg_get_function_result(p.oid) = 'text'
  ) then
    drop function public.rol_actual() cascade;
    raise notice 'Se borró rol_actual() vieja (text). Recreá la del núcleo con 002_nucleo_rls.sql.';
  else
    raise notice 'rol_actual() es la del núcleo (user_role): se deja como está.';
  end if;
end $$;

-- ── 4. Listo ─────────────────────────────────────────────────
-- Si el núcleo ya está migrado (empresas/sectores/usuarios con datos y
-- policies), NO vuelvas a correr 001-014: sólo faltan las de Compras.
--   015_nucleo_ajustes_compras.sql
--   016_compras_schema.sql
--   017_compras_rls.sql

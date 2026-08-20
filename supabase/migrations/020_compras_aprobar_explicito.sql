-- ============================================================
-- SdG — Compras: aprobar exige estar en la lista, sin excepciones
--
-- La planilla restringe la columna de aprobación del master (protección
-- "APROBACIÓN DE GERENCIA") a un puñado de cuentas. La app tiene que espejar
-- esa misma regla, y hasta ahora no lo hacía:
--
--   puede_aprobar_compras() devolvía true por es_admin(), o sea que cualquier
--   admin del sistema podía aprobar aunque no estuviera en la lista.
--
-- Eso rompía la equivalencia entre los dos lados justo en el control que más
-- importa. Ahora aprobar exige el permiso explícito del módulo Compras con
-- nivel admin, y nada más: ser admin del sistema sirve para administrar
-- usuarios y para darse el permiso, pero no para aprobar sin tenerlo.
--
-- El resto de los permisos no cambia: un admin del sistema sigue pudiendo
-- gestionar compras, proveedores y ubicaciones.
-- ============================================================

create or replace function public.puede_aprobar_compras()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'compras'
        and nivel = 'admin'
    ),
    false
  )
$$;

comment on function public.puede_aprobar_compras() is
  'Espeja la protección "APROBACIÓN DE GERENCIA" de la planilla: sólo quienes '
  'tienen el módulo Compras con nivel admin. A propósito NO incluye es_admin().';

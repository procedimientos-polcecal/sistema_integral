-- ============================================================
-- SdG — RLS del núcleo
-- ============================================================

-- Rol del usuario actual (bypassa RLS vía security definer).
create or replace function public.rol_actual()
returns user_role
language sql stable security definer set search_path = public
as $$ select rol from usuarios where id = auth.uid() $$;

-- ¿El usuario actual es admin del sistema o admin general?
create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select rol in ('admin_sistema', 'admin') from usuarios where id = auth.uid()),
    false
  )
$$;

alter table empresas        enable row level security;
alter table sectores        enable row level security;
alter table usuarios        enable row level security;
alter table usuario_modulos enable row level security;
alter table empleados       enable row level security;

-- empresas: cualquier usuario autenticado lee; solo admin escribe.
create policy empresas_select on empresas for select to authenticated using (true);
create policy empresas_write  on empresas for all    to authenticated using (es_admin()) with check (es_admin());

-- sectores: igual.
create policy sectores_select on sectores for select to authenticated using (true);
create policy sectores_write  on sectores for all    to authenticated using (es_admin()) with check (es_admin());

-- usuarios: cada uno se ve a sí mismo; admin ve/escribe todos.
create policy usuarios_select_self  on usuarios for select to authenticated using (id = auth.uid() or es_admin());
create policy usuarios_write_admin  on usuarios for all    to authenticated using (es_admin()) with check (es_admin());

-- usuario_modulos: el usuario ve sus grants; admin gestiona todos.
create policy um_select on usuario_modulos for select to authenticated using (usuario_id = auth.uid() or es_admin());
create policy um_write  on usuario_modulos for all    to authenticated using (es_admin()) with check (es_admin());

-- empleados: autenticado lee; solo admin escribe (los módulos afinarán esto luego).
create policy empleados_select on empleados for select to authenticated using (true);
create policy empleados_write  on empleados for all    to authenticated using (es_admin()) with check (es_admin());

-- ============================================================
-- El umbral de monto alto lo edita quien edita los aprobadores
-- ============================================================
-- La migración `20261019092428` dejó la escritura de `compras_ajustes` detrás
-- de `es_admin()` a secas, y eso quedó incoherente con el resto de la pantalla
-- donde vive: `/compras/configuracion` también administra `compras_aprobadores`,
-- cuya policy (migración 028) dice
--
--     es_admin() or exists (
--       select 1 from usuario_modulos
--       where usuario_id = auth.uid() and modulo = 'compras' and nivel = 'admin'
--     )
--
-- O sea que un admin **del módulo** puede decidir quién aprueba las compras de
-- la empresa, pero no podía mover un número. Desde el 10/09/2026 `es_admin()`
-- es sólo `admin_sistema` —ver `20260908083338`—, así que la diferencia no era
-- de matiz: dejaba la pantalla a medias para la persona que la usa.
--
-- Se corrige con otra migración y no editando aquélla, que ya corrió.
--
-- La de SELECT no se toca: leerlo lo necesita cualquiera que entre a Compras,
-- porque el umbral decide qué se le muestra marcado.

drop policy if exists compras_ajustes_write on public.compras_ajustes;
create policy compras_ajustes_write on public.compras_ajustes
  for all to authenticated
  using (
    (select public.es_admin())
    or exists (
      select 1 from public.usuario_modulos
      where usuario_id = (select auth.uid())
        and modulo = 'compras'
        and nivel = 'admin'
    )
  )
  with check (
    (select public.es_admin())
    or exists (
      select 1 from public.usuario_modulos
      where usuario_id = (select auth.uid())
        and modulo = 'compras'
        and nivel = 'admin'
    )
  );

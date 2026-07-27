-- ============================================================
-- SdG — Ajuste de RLS de RRHH: calculos_diarios
-- ============================================================
-- El recálculo automático (recalcularEmpleadoPeriodo) escribe calculos_diarios
-- como efecto secundario de acciones que en el original NO requerían admin
-- (crear/editar una ausencia, una vacación o una fichada — cualquier usuario
-- autenticado podía hacerlo). Solo las dos acciones puntuales de "validar
-- horas extra" y "fijar horas manuales" eran admin-only, y eso se sigue
-- exigiendo a nivel de aplicación (es_admin_rrhh()) en esos dos endpoints,
-- no acá.

drop policy if exists calculos_diarios_write on calculos_diarios;
create policy calculos_diarios_write on calculos_diarios for all to authenticated
  using (puede_editar_rrhh()) with check (puede_editar_rrhh());

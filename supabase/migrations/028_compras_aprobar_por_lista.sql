-- ============================================================
-- SdG — Compras: aprobar es estar en una lista, no tener un nivel
--
-- Hasta acá `puede_aprobar_compras()` miraba `usuario_modulos.nivel = 'admin'`,
-- así que quien administraba el módulo también decidía sobre el gasto. Son dos
-- cosas distintas y las hacen personas distintas: administrar es configurar,
-- aprobar es autorizar plata.
--
-- El permiso se muda a `compras_aprobadores`, que ya existía para guardar el
-- alias con el que cada uno figura en la planilla. Ahora esa lista ES el
-- permiso, que además es como funciona la planilla: su columna de aprobación
-- está restringida a ciertas cuentas.
-- ============================================================

-- El alias deja de ser obligatorio: pertenecer a la lista es el permiso, el
-- alias es cómo se lo nombra en la planilla. Sin alias se aprueba igual y la
-- aprobación queda pendiente de escribirse allá, que es lo que ya pasaba.
alter table compras_aprobadores alter column alias_planilla drop not null;

alter table compras_aprobadores drop constraint if exists alias_no_vacio;
alter table compras_aprobadores add constraint alias_no_vacio
  check (alias_planilla is null or btrim(alias_planilla) <> '');

create or replace function public.puede_aprobar_compras()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from compras_aprobadores where usuario_id = auth.uid()
  )
$$;

comment on function public.puede_aprobar_compras() is
  'Espeja la protección "APROBACIÓN DE GERENCIA" de la planilla: sólo quienes '
  'están en compras_aprobadores. A propósito NO incluye es_admin() ni el nivel '
  'del módulo — administrar y aprobar son cosas separadas.';

-- ── Quién administra la lista ────────────────────────────────
-- Administrar la lista sí es tarea de administración, y por eso NO alcanza con
-- estar en ella: si no, cualquier aprobador podría sacar a los demás.
drop policy if exists compras_aprobadores_write on compras_aprobadores;
create policy compras_aprobadores_write on compras_aprobadores
  for all to authenticated
  using (
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'compras' and nivel = 'admin'
    )
  )
  with check (
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'compras' and nivel = 'admin'
    )
  );

-- ============================================================
-- SdG — Quién aprueba una orden de servicio
--
-- Hasta acá una OS se aprobaba escribiendo `APROBADO` a mano en la planilla, y
-- el sistema no tenía forma de saber quién puede hacerlo. La pantalla de
-- Aprobaciones de Compras va a mostrar también las OS que esperan decisión
-- —hoy 11, las que siguen en la pestaña SERVICIOS porque el FILTER de cada
-- área sólo levanta las aprobadas— y necesita una lista contra la cual
-- preguntar.
--
-- **Lista propia y no `compras_aprobadores`.** Decidido al acordar el diseño:
-- aprobar un servicio y aprobar un material los decide gente distinta, y una
-- lista que hereda de la otra en silencio no permite que se separen después.
-- Hoy se siembra con Nico, que es quien lo hace.
--
-- Se copia la forma de `compras_aprobadores` a propósito, incluida la regla de
-- quién la administra: son dos listas contiguas en la misma pantalla de
-- configuración, y que se editen con reglas distintas es de las cosas que nadie
-- descubre hasta que a alguien le falta un botón.
--
-- Sin alias de planilla, que es la única diferencia: `compras_aprobadores` lo
-- guarda porque la planilla de Compras firma la aprobación con un nombre corto
-- entre paréntesis. La de OS no firma: su columna de estado dice `APROBADO` y
-- nada más.
--
-- No es una tabla puente —tiene una sola clave foránea, a `usuarios`—, así que
-- no abre un segundo camino para PostgREST ni rompe embeds existentes.
-- ============================================================

create table if not exists os_aprobadores (
  usuario_id uuid primary key references usuarios(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table os_aprobadores is
  'Quiénes pueden aprobar o denegar una orden de servicio. Pertenecer a la '
  'lista ES el permiso, igual que en compras_aprobadores: a propósito no '
  'depende del nivel en ningún módulo, porque administrar y autorizar son '
  'cosas distintas.';

-- ── Quién ve la lista ────────────────────────────────────────
-- Cualquier autenticado: el menú y la pantalla necesitan saber si quien mira
-- es aprobador para decidir qué dibujar, y eso lo pregunta cada sesión.
alter table os_aprobadores enable row level security;

drop policy if exists os_aprobadores_select on os_aprobadores;
create policy os_aprobadores_select on os_aprobadores
  for select to authenticated using (true);

-- ── Quién la administra ──────────────────────────────────────
-- La misma regla que la 028 le puso a `compras_aprobadores`: administrar la
-- lista es tarea de administración, y por eso NO alcanza con estar en ella. Si
-- alcanzara, cualquier aprobador podría sacar a los demás.
drop policy if exists os_aprobadores_write on os_aprobadores;
create policy os_aprobadores_write on os_aprobadores
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

-- ── El permiso, del lado de la base ──────────────────────────
-- Espeja a `puede_aprobar_compras()` de la 028. Las rutas que escriben una OS
-- lo hacen con el cliente admin, donde RLS no corre, así que el chequeo también
-- vive en el código; esta función es la otra mitad, para las policies y para
-- cualquier consulta que entre con la sesión del usuario.
create or replace function public.puede_aprobar_os()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from os_aprobadores where usuario_id = auth.uid()
  )
$$;

comment on function public.puede_aprobar_os() is
  'Quién puede aprobar o denegar una orden de servicio: estar en '
  'os_aprobadores. A propósito NO incluye es_admin() ni el nivel de '
  'Mantenimiento o Compras — administrar y aprobar son cosas separadas.';

-- ── El sembrado ──────────────────────────────────────────────
-- Nico Lenzetti, que es quien aprueba las OS. Va por id y no por nombre porque
-- el id es lo estable; el `select` desde `usuarios` evita que el archivo entero
-- se revierta con un error de clave foránea si en esta base ese usuario no
-- existe —un error en cualquier línea revierte la migración completa, y desde
-- afuera se ve igual que si nunca se hubiera corrido—.
insert into os_aprobadores (usuario_id)
select id from usuarios where id = 'e960be18-2c76-4a77-8ba2-8faa4eb1828f'::uuid
on conflict (usuario_id) do nothing;

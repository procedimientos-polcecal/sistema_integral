-- ============================================================
-- SdG — Asistente: la consulta y la bitácora
--
-- `asistente_consulta()` es por dónde el asistente lee la base. Tres cosas la
-- hacen segura, y sólo la primera es de la base misma:
--
-- 1. Es **security invoker** (el default). Corre como el usuario que llama,
--    con su `auth.uid()`, así que RLS decide qué filas ve. No hay que
--    reimplementar permisos: ocho de los nueve módulos ya tienen la lectura
--    gateada (`tiene_acceso_rrhh()`, `mant_puede_ver()`, …). Compras es la
--    excepción y es deliberada desde la 018.
--
-- 2. Es **stable**, para que PostgREST la acepte por GET — y PostgREST corre
--    los GET en una transacción de sólo lectura. Ahí está la barrera de
--    verdad: si el modelo escribe un UPDATE, lo rechaza Postgres.
--
-- 3. El chequeo de texto de abajo es la **tercera** capa, y está para dar un
--    mensaje claro, no para defender. Un guard por expresión regular sobre
--    SQL siempre se puede esquivar; una transacción de sólo lectura no.
--
-- Sobre el timeout: NO se pone acá. `statement_timeout` no se puede cambiar
-- para la sentencia que ya está corriendo, así que un `set` dentro de la
-- función no haría nada — sería una falsa tranquilidad. El que aplica es el
-- del rol `authenticated`, que Supabase ya trae configurado. Se verifica
-- corriendo `select current_setting('statement_timeout')` por esta misma
-- función.
--
-- El tope de filas sí va acá, explícito, porque el que no se ve es el que
-- muerde: PostgREST corta en 1000 y no avisa. Devolver un jsonb esquiva ese
-- corte (es un valor, no mil filas), así que el límite tiene que ser propio.
-- ============================================================

create or replace function public.asistente_consulta(
  consulta text,
  tope integer default 200
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  limpio text := btrim(consulta);
  resultado jsonb;
begin
  if limpio !~* '^(select|with)\s' then
    raise exception 'El asistente sólo puede leer: la consulta tiene que empezar con SELECT o WITH.';
  end if;

  -- Un punto y coma final es normal; uno en el medio son dos sentencias.
  if position(';' in rtrim(limpio, ' ;')) > 0 then
    raise exception 'Una consulta por vez: sacá el punto y coma del medio.';
  end if;

  if tope < 1 or tope > 1000 then
    raise exception 'El tope de filas va entre 1 y 1000.';
  end if;

  execute format(
    'select coalesce(jsonb_agg(f), ''[]''::jsonb) from (select * from (%s) sub limit %s) f',
    limpio, tope
  ) into resultado;

  return resultado;
end $$;

comment on function public.asistente_consulta(text, integer) is
  'Lectura del asistente de IA. security invoker + stable: corre como el '
  'usuario con RLS, y por GET queda en transacción de sólo lectura.';

revoke all on function public.asistente_consulta(text, integer) from public;
grant execute on function public.asistente_consulta(text, integer) to authenticated;

-- ── La bitácora ──────────────────────────────────────────────
-- Sirve para dos cosas a la vez, y por eso vale la tabla: corta el gasto
-- (el tope diario se cuenta acá) y dice qué se pregunta de verdad, que es lo
-- que después decide si valen la pena las vistas de consulta que el spec
-- dejó explícitamente para después.

create table if not exists asistente_consultas (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references usuarios(id) on delete cascade,
  pregunta        text not null,
  sql_corrido     text,
  filas           integer,
  tokens_entrada  integer,
  tokens_salida   integer,
  error           text,
  creado_en       timestamptz not null default now()
);

create index if not exists asistente_consultas_usuario_idx
  on asistente_consultas (usuario_id, creado_en desc);

alter table asistente_consultas enable row level security;

drop policy if exists asistente_consultas_select on asistente_consultas;
create policy asistente_consultas_select on asistente_consultas
  for select to authenticated
  using (usuario_id = auth.uid() or es_admin_sistema());

drop policy if exists asistente_consultas_insert on asistente_consultas;
create policy asistente_consultas_insert on asistente_consultas
  for insert to authenticated
  with check (usuario_id = auth.uid());

notify pgrst, 'reload schema';

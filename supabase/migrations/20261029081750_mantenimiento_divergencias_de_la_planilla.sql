-- Las divergencias entre el SdG y la planilla de OT, para que se detecten solas.
--
-- POR QUÉ
--
-- Una divergencia no avisa nunca: la OT se lee bien en los dos lados, sólo que
-- dicen cosas distintas, y quien mira uno no mira el otro. `contrastar-ot.mts`
-- sabe encontrarlas desde el 21/10/2026, pero es un script que hay que
-- acordarse de correr, y lo que decide si un problema se encuentra no puede ser
-- que alguien se acuerde. Las tres veces que aparecieron —la OT 2845 con la
-- fecha corrida, las ocho con el ESTADO en blanco del 29/10, el registro que se
-- perdía por el pendiente sin anotar— las encontró una persona mirando.
--
-- Esta tabla es ese script convertido en dato: la sincronización de órdenes ya
-- lee la planilla entera y ya tiene las filas del sistema en memoria, así que
-- contrastar ahí no cuesta ninguna lectura más.
--
-- SE REHACE ENTERA EN CADA CORRIDA, Y POR ESO SU TAMAÑO ES LA VERDAD DE HOY
--
-- Igual que `calidad_planilla_sin_reconocer`, y por la misma razón: una
-- divergencia que se arregló tiene que desaparecer sola. Si las filas se
-- acumularan, el aviso contaría problemas viejos y nadie volvería a mirarlo.
-- El contador del aviso es, literalmente, `count(*)` de esta tabla.
--
-- Por eso la clave es `(ot_number, campo)` y no un id: una OT con la fecha de
-- ejecución y la de cierre corridas tiene dos filas, y volver a verlas en la
-- corrida siguiente las pisa en vez de duplicarlas.
--
-- LO QUE NO ES
--
-- No decide quién tiene razón. La planilla manda en Mantenimiento, pero una
-- orden que nació en el sistema y todavía no exportó tiene la verdad del otro
-- lado. Eso lo decide una persona; esto sólo dice que hay que mirar.

create table public.mantenimiento_divergencias (
  ot_number    integer not null,
  -- Cómo se llama el problema en castellano: "la fecha de ejecución", "el
  -- estado", "la celda del estado, sin la fórmula". Es texto y no un enum a
  -- propósito: la lista la decide `contraste.ts`, que tiene sus tests, y un
  -- enum nuevo pide su propia migración cada vez (55P04).
  campo        text    not null,
  en_el_sistema text,
  en_la_planilla text,
  visto_en     timestamptz not null default now(),
  primary key (ot_number, campo)
);

alter table public.mantenimiento_divergencias enable row level security;

-- LAS POLICIES VAN ENVUELTAS: `using ((select mant_puede_ver()))` y no
-- `using (mant_puede_ver())`. Postgres evalúa el USING una vez por fila aunque
-- la función sea STABLE; el subselect lo vuelve un InitPlan que se evalúa una
-- sola vez. Pelada no rompe nada y no avisa: la tabla simplemente empieza a
-- costar proporcional a sus filas. Ver las migraciones 20261014090512 y
-- 20261014104956, donde eso tenía a `calculos_diarios` en timeout.
create policy mantenimiento_divergencias_leer
  on public.mantenimiento_divergencias
  for select to authenticated
  using ((select mant_puede_ver()));

-- La escribe la sincronización, que corre con el cliente admin y se saltea RLS.
-- Esta policy existe para que un administrador pueda limpiarla a mano si hace
-- falta, no porque la aplicación la necesite.
create policy mantenimiento_divergencias_escribir
  on public.mantenimiento_divergencias
  for all to authenticated
  using ((select puede_editar_mantenimiento()))
  with check ((select puede_editar_mantenimiento()));

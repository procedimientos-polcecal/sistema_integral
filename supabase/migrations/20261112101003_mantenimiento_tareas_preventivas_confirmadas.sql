-- ============================================================
-- SdG — Mantenimiento: el catálogo de tareas preventivas, confirmado
--
-- El paso 2 del plan de
-- `docs/superpowers/specs/2026-11-12-mantenimiento-catalogo-de-tareas-preventivas-design.md`.
-- El 1 ya está hecho: los componentes que faltaban salieron del historial.
--
-- EL PROBLEMA QUE RESUELVE. El motor de planes periódicos tiene **un plan**
-- mientras el 59,9 % de las OT del año son PROGRAMADO: 1.455 órdenes escritas
-- a mano. `lib/mantenimiento/tareasPreventivas.ts` propone 49 tareas sacadas
-- de lo que ya se hizo, con su ritmo medido — pero una propuesta no es un
-- plan. Falta que una persona diga cuáles son de verdad.
--
-- ── SÓLO SE GUARDA LA DECISIÓN, NUNCA LA PROPUESTA ──────────────────────────
--
-- Es lo que hay que entender antes de tocar esto. La propuesta se **recalcula
-- del historial en cada lectura**: qué tareas hay, en qué equipos y con qué
-- ritmo sale de las OT de los últimos 365 días. Guardarla acá crearía una
-- segunda fuente de verdad que envejece sola — la tabla diría «cada 4 días»
-- tres meses después de que el ritmo cambió, y nada avisaría.
--
-- Esta tabla guarda lo único que el historial no puede contestar: **qué
-- decidió una persona**.
--
-- ── DESCARTAR ES UNA DECISIÓN Y POR ESO ESCRIBE UNA FILA ────────────────────
--
-- Podría parecer que descartar es no hacer nada. No lo es: sin fila, la tarea
-- vuelve a aparecer en la propuesta mañana, y pasado, y la pantalla se vuelve
-- una lista que nadie termina nunca. `estado = 'DESCARTADA'` es lo que hace
-- que una tarea que ya se miró deje de pedir atención. El `motivo` es opcional
-- a propósito: obligarlo haría que se escriba cualquier cosa.
--
-- ── LA CLAVE NATURAL ES (EQUIPO, ACCIÓN, COMPONENTE) ────────────────────────
--
-- Y no (acción, componente). «Rotación de martillos» se hace en seis equipos
-- con ritmos distintos —cada ~4 días en PO-C1-04 y cada ~22 en PY-C1-03—, así
-- que un plan es por máquina. El `unique` impide decidir dos veces lo mismo
-- sobre el mismo equipo.
--
-- ── POR QUÉ `accion` Y `componente` SON TEXTO Y NO CLAVES FORÁNEAS ──────────
--
-- `accion` es vocabulario que vive en el código (`ACCIONES_PREVENTIVAS`), como
-- los modos y causas de falla: una tabla para seis valores que cambian con un
-- commit sería una migración por cada palabra nueva.
--
-- `componente` es el **nombre** y no el id de `equipos_componentes`, y eso es
-- deliberado: esa tabla tiene una fila por equipo —«Martillos» son cinco filas
-- distintas— y lo que identifica la tarea es el nombre, el mismo que el
-- historial reconoce en la descripción. Un id ataría la tarea a una fila que
-- alguien puede borrar al rehacer un relevamiento.
--
-- ── `estado` ES TEXTO CON CHECK Y NO UN ENUM ────────────────────────────────
--
-- A propósito, y está en las ocho trampas del README: un valor de enum nuevo
-- tiene que viajar solo en su propio archivo (`55P04`), y ya pasó dos veces.
-- Con un check, agregar un estado es una migración común.
--
-- ESTO NO GENERA NINGUNA ORDEN. Confirmar una tarea no la engancha todavía con
-- el motor de planes periódicos: ése es el paso 3, y hacerlo antes de que el
-- catálogo esté confirmado daría órdenes automáticas sobre tareas que nadie
-- miró. Esta migración es sólo dónde se anota la decisión.
-- ============================================================

create table if not exists public.mant_tareas_preventivas (
  id             uuid primary key default gen_random_uuid(),
  equipment_id   uuid not null references public.equipos(id) on delete cascade,
  -- La clave del vocabulario: ROTACION, CAMBIO, LIMPIEZA…
  accion         text not null,
  -- El nombre del componente, como está en `equipos_componentes.nombre`.
  componente     text not null,
  -- Cómo se llama la tarea en la planta. Arranca con el nombre que propone el
  -- sistema —«rotación de Martillos»— y se puede corregir: el que sabe cómo se
  -- llama es el que la hace.
  nombre         text not null,
  -- Cada cuántos días. **Nullable a propósito**: se puede confirmar que la
  -- tarea existe sin saber todavía su período, y eso es mejor que guardar la
  -- mediana medida como si alguien la hubiera elegido.
  periodo_dias   integer,
  estado         text not null default 'CONFIRMADA',
  motivo         text,
  -- `on delete set null` como el resto del módulo: la decisión sobre una tarea
  -- no deja de valer porque quien la tomó se haya ido, y sin esto borrar un
  -- usuario quedaría trabado por esta tabla.
  decidido_por   uuid references public.usuarios(id) on delete set null,
  decidido_en    timestamptz not null default now(),

  constraint mant_tareas_preventivas_unica
    unique (equipment_id, accion, componente),
  constraint mant_tareas_preventivas_estado
    check (estado in ('CONFIRMADA', 'DESCARTADA')),
  -- Un período de cero o negativo no es un período. El tope de 3.650 días son
  -- diez años: más que eso es un error de tipeo, no un plan.
  constraint mant_tareas_preventivas_periodo
    check (periodo_dias is null or (periodo_dias > 0 and periodo_dias <= 3650))
);

-- La pantalla lee todas las decisiones de una vez para cruzarlas con la
-- propuesta, así que no hay una consulta por equipo que justifique un índice
-- más; el `unique` ya cubre la búsqueda por la clave natural.
comment on table public.mant_tareas_preventivas is
  'Qué tareas preventivas confirmó una persona, por equipo. La propuesta se recalcula del historial: acá sólo vive la decisión.';

-- ── RLS ─────────────────────────────────────────────────────
--
-- Las dos funciones van **envueltas en un select**: sin eso Postgres las
-- evalúa una vez por fila y la tabla empieza a costar proporcional a sus
-- filas. `mant_puede_ver(uid uuid default auth.uid())` declara un argumento
-- pero se llama con los paréntesis vacíos, así que va envuelta igual.
alter table public.mant_tareas_preventivas enable row level security;

drop policy if exists mant_tareas_preventivas_select on public.mant_tareas_preventivas;
create policy mant_tareas_preventivas_select on public.mant_tareas_preventivas
  for select to authenticated using ((select public.mant_puede_ver()));

drop policy if exists mant_tareas_preventivas_write on public.mant_tareas_preventivas;
create policy mant_tareas_preventivas_write on public.mant_tareas_preventivas
  for all to authenticated
  using ((select public.mant_puede_editar()))
  with check ((select public.mant_puede_editar()));

-- ============================================================
-- SdG — Mantenimiento: la programación semanal del taller
--
-- EL PROBLEMA. La programación semanal del taller mecánico y del eléctrico la
-- arma el encargado de mantenimiento y no está escrita en ningún lado: ni
-- planilla, ni pantalla, ni papel. Cuando falta alguien se entera porque el
-- operario le avisa. Esta migración crea las tres tablas que hacen falta para
-- que esa semana exista y se pueda mirar; el diseño completo, con lo que se
-- midió, está en
-- docs/superpowers/specs/2026-10-22-mantenimiento-disponibilidad-y-turnos-design.md.
--
-- LA ROTACIÓN SE CALCULA, NO SE GUARDA. Hay dos ciclos con períodos distintos:
-- los dos grupos de mecánicos se dan vuelta cada 2 semanas (4-12 / 12-20) y los
-- tres electricistas avanzan un turno por semana, o sea cada 3. El cuadro entero
-- recién se repite a las 6. Por eso no hay una tabla con la grilla de cada
-- semana: la grilla sale de una semana de referencia y de la cuenta, hacia
-- adelante y hacia atrás. Lo único que se guarda es lo que la cuenta no puede
-- saber: quién es quién (el padrón), desde dónde se cuenta (la referencia) y lo
-- que el encargado cambió a mano (las pisadas).
--
-- 1) EL PADRÓN DEL TALLER NO VA EN `empleados`. Mecánico, electricista y
-- lubricador no son sectores: son oficios. La migración 20260903090920 ya
-- tomó esta decisión una vez, para el pañol, y vale igual acá: meter el oficio
-- en el núcleo sería meterlo en RRHH, Mantenimiento, Remises y Compras, que
-- comparten esa tabla. El oficio y el grupo viven en el módulo que los usa y
-- `empleados` queda como está; el padrón sólo la enlaza.
--
-- 2) EL PADRÓN LLEVA VIGENCIA (`desde` / `hasta`), Y NO ES OPCIONAL. Si alguien
-- entra, se va o cambia de grupo, una semana pasada recalculada con el padrón
-- de hoy reescribiría lo que el encargado vio en su momento: la grilla de
-- marzo cambiaría sin que nadie tocara marzo. Es el mismo razonamiento que la
-- tarifa hora (043): con un solo valor mutable, corregirlo hoy reescribe el
-- pasado. Una semana se arma con el padrón que regía en esa semana. `hasta`
-- null quiere decir que sigue vigente.
--
-- 3) LAS PISADAS SON POR DÍA, NO POR SEMANA. La rotación es semanal, pero las
-- ausencias son por día: medido sobre `calculos_diarios`, la gente de
-- Mantenimiento trabaja 27 de 33 sábados, y una enfermedad dura dos días y no
-- siete. Cuando el encargado mueve a alguien para tapar un hueco, lo mueve ese
-- día. Guardarlo por semana obligaría a pisar los siete días para cambiar uno,
-- y las semanas siguientes se seguirían calculando del ciclo sin que esto las
-- desarme. El `unique (empleado_id, dia)` es lo que impide que una persona
-- quede en dos turnos el mismo día.
--
-- QUIÉN LA VE. Sólo el nivel admin de Mantenimiento, que es el que ya existe
-- para configurar el catálogo (operarios, contratistas, tipos): el padrón es
-- exactamente un catálogo. El encargado pidió que no la vea nadie más, y eso no
-- existe como permiso aparte; lo ve todo el que tenga admin de Mantenimiento,
-- que hoy incluye a cualquier admin_sistema. Si mañana hay dos con admin y uno
-- no debe verla, hace falta una marca en el padrón o un nivel nuevo — inventar
-- hoy un permiso para una sola persona sería construir un mecanismo que nadie
-- pidió.
--
-- LAS POLICIES VAN ENVUELTAS: `using ((select mant_es_admin()))` y no
-- `using (mant_es_admin())`. Postgres evalúa el USING una vez por fila aunque la
-- función sea STABLE; el subselect lo convierte en un InitPlan que se evalúa una
-- sola vez. Escribirla pelada no rompe nada y no avisa: la tabla simplemente
-- pasa a costar proporcional a sus filas. Ver 20261014090512.
--
-- NO HAY ENUM NUEVO: oficios, grupos y turnos van como `check`, así que esta
-- migración no gasta la regla del 55P04 (un valor de enum nuevo viaja solo) y
-- se puede correr entera, y correr de nuevo: todo es `if not exists` y
-- `drop policy if exists`.
--
-- El turno de 20 a 4 queda afuera a propósito: hoy no tiene operarios
-- designados, y por eso el `check` de las pisadas sólo admite tres turnos.
-- ============================================================

-- ── El padrón del taller ─────────────────────────────────────

create table if not exists mant_personal_taller (
  id          uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references empleados(id) on delete cascade,
  oficio      text not null check (oficio in ('mecanico', 'electricista', 'lubricador')),
  -- Sólo los que rotan en bloque. Un electricista no tiene grupo: rota solo.
  grupo       text check (grupo in ('A', 'B')),
  desde       date not null,
  hasta       date,
  created_at  timestamptz not null default now()
);

comment on table mant_personal_taller is
  'Las personas del taller, con su oficio, su grupo y desde cuándo. El oficio no vive en `empleados` porque mecánico, electricista y lubricador son oficios y no sectores (ver 20260903090920). Lleva vigencia: una semana pasada se arma con el padrón que regía entonces.';
comment on column mant_personal_taller.grupo is
  'A o B, sólo para los que rotan en bloque (mecánicos y el lubricador, que viaja con el grupo B). NULL para los electricistas, que rotan solos.';
comment on column mant_personal_taller.hasta is
  'Último día que rige, inclusive. NULL: sigue vigente.';

-- ── La semana de referencia ──────────────────────────────────

-- Una sola fila. Fija el lunes desde el que se cuenta y dónde arrancan los dos
-- ciclos: el de los grupos (2 semanas) y el de los electricistas (3).
create table if not exists mant_programacion_referencia (
  id                   uuid primary key default gen_random_uuid(),
  lunes                date not null,
  grupo_en_4a12        text not null check (grupo_en_4a12 in ('A', 'B')),
  electricista_4a12_id uuid not null references empleados(id),
  electricista_8a16_id uuid not null references empleados(id),
  electricista_12a20_id uuid not null references empleados(id)
);

comment on table mant_programacion_referencia is
  'Una sola fila: el lunes de la semana desde la que se cuenta, qué grupo estaba en 4 a 12 ese lunes, y qué electricista estaba en cada turno. De ahí salen todas las demás semanas, hacia adelante y hacia atrás.';

-- ── Lo que el encargado pisó a mano ──────────────────────────

-- Lo que el encargado pisó a mano, por día. Lo que no está acá sale del ciclo.
create table if not exists mant_programacion_pisadas (
  id            uuid primary key default gen_random_uuid(),
  empleado_id   uuid not null references empleados(id) on delete cascade,
  dia           date not null,
  turno         text not null check (turno in ('4-12', '8-16', '12-20')),
  pisado_por_id uuid not null references usuarios(id),
  created_at    timestamptz not null default now(),
  unique (empleado_id, dia)
);

comment on table mant_programacion_pisadas is
  'El turno que el encargado le asignó a mano a una persona un día puntual. Es por día y no por semana porque las ausencias son por día. Lo que no está acá sale del ciclo; pisar un día no desarma los siguientes.';

-- ── RLS ──────────────────────────────────────────────────────
-- Sólo admin de Mantenimiento, para leer y para escribir. La función va
-- envuelta en un subselect (ver el encabezado).

alter table mant_personal_taller enable row level security;

drop policy if exists mant_personal_taller_admin on mant_personal_taller;
create policy mant_personal_taller_admin on mant_personal_taller
  for all to authenticated
  using ((select mant_es_admin()))
  with check ((select mant_es_admin()));

alter table mant_programacion_referencia enable row level security;

drop policy if exists mant_programacion_referencia_admin on mant_programacion_referencia;
create policy mant_programacion_referencia_admin on mant_programacion_referencia
  for all to authenticated
  using ((select mant_es_admin()))
  with check ((select mant_es_admin()));

alter table mant_programacion_pisadas enable row level security;

drop policy if exists mant_programacion_pisadas_admin on mant_programacion_pisadas;
create policy mant_programacion_pisadas_admin on mant_programacion_pisadas
  for all to authenticated
  using ((select mant_es_admin()))
  with check ((select mant_es_admin()));

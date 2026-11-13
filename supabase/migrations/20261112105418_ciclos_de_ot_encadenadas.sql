-- ============================================================
-- SdG — Mantenimiento: OT encadenadas (el ciclo de martillos)
--
-- Una OT que al cerrarse genera la siguiente. Una **madre** arranca el ciclo,
-- de su cierre nace una **hija** que se repite x veces, y después de la última
-- vuelve la madre. Primer caso:
--
--     Cambio de martillos → Rotación × 3 → Cambio de martillos → …
--
-- El diseño está en
-- `docs/superpowers/specs/2026-11-12-mantenimiento-ot-encadenadas-design.md`.
--
-- ── QUÉ SE MIDIÓ ANTES DE ESCRIBIR ESTO ─────────────────────────────────────
--
-- El ciclo ya existe a mano: 266 OT con «martillo» en la descripción, 248 en
-- los cuatro equipos de abajo, y 24 ciclos completos de cambio a cambio en el
-- molino de Hidratación. **63 de ellas nombran la cara del martillo, y
-- aparecen la 2ª, la 3ª y la 4ª — nunca la 1ª y nunca una 5ª.** Eso es
-- exactamente un juego que entra nuevo en 1ª cara, se rota tres veces y se
-- cambia, que es el ciclo que describió quien lo pidió. Los días entre
-- rotaciones los corrigió él sobre lo medido.
--
-- ── EL ESTADO SON DOS CAMPOS Y UN CORTE, Y ESO NO SE DEDUCE DEL CÓDIGO ──────
--
-- `desde` es la fecha del último trabajo **hecho** del ciclo y `vuelta_desde`
-- qué vuelta era ése. **Las OT del ciclo que cuentan son las creadas en `desde`
-- o después**: ése es el corte, y es lo único que hace que esto no se rompa.
--
-- Sin él, el botón «Se cambiaron los martillos» no alcanzaba. La primera
-- versión del diseño derivaba el estado de «la última OT con ciclo_id» y el
-- reinicio suspendía la hija que esperaba — pero entonces la última pasaba a
-- ser la hija **anterior, ya cerrada**, y la corrida siguiente volvía a crear
-- exactamente la orden recién suspendida, fechada sobre un cierre viejo (o sea
-- nacida atrasada), sobre martillos recién cambiados. Era, palabra por palabra,
-- lo que quien lo pidió nombró como la razón por la que dejaría de confiar en
-- esto: «que genere OT sobre martillos que ya se cambiaron».
--
-- El corte lo mueven **tres puntas y nada más**: la madre al cerrarse, el botón
-- de reinicio y la carga inicial. Las hijas no: quedan dentro del rango y la
-- regla ya las lee bien.
--
-- ── POR QUÉ LAS TAREAS SON UNA FK Y NO DOS CAMPOS DE TEXTO ──────────────────
--
-- `mant_tareas_preventivas` (migración 20261112101003, del mismo día) ya es el
-- lugar donde vive «Rotación de Martillos en PO-C1-04 cada 3 días»: su
-- encabezado nombra este caso. Copiar esos nombres acá crearía dos lugares que
-- derivan — pero lo grave es lo otro: **ese catálogo existe para generar OT**.
-- El día que alguien lo enganche al generador, estas cuatro máquinas recibirían
-- la rotación dos veces en la planilla que mira la planta. Con la FK, quien
-- escriba ese enganche contesta «¿esta tarea la maneja un ciclo?» con un join;
-- sin ella tendría que cruzarlas por texto, que es justo lo que los dos diseños
-- prohíben.
--
-- Por lo mismo, el «cada cuántos días» **no se guarda acá**: es el
-- `periodo_dias` de la tarea hija.
-- ============================================================

create table if not exists public.mant_ciclos_de_ot (
  id              uuid primary key default gen_random_uuid(),
  equipment_id    uuid not null references public.equipos(id) on delete cascade,
  -- `restrict` y no `set null`: borrar una tarea del catálogo no puede dejar un
  -- ciclo apuntando al vacío y generando órdenes sin nombre.
  tarea_madre_id  uuid not null references public.mant_tareas_preventivas(id) on delete restrict,
  tarea_hija_id   uuid not null references public.mant_tareas_preventivas(id) on delete restrict,
  -- Cuántas hijas antes de que vuelva la madre. Es del ciclo y no de la tarea:
  -- son las caras del martillo menos la que entra nueva.
  repeticiones    smallint not null,
  especialidad    text,
  horas_estimadas numeric,
  -- El punto de arranque. **Nace en null a propósito** (ver el bloque de la
  -- semilla): lo carga una persona, equipo por equipo.
  desde           date,
  vuelta_desde    smallint,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  creado_por      uuid references public.usuarios(id) on delete set null,

  constraint mant_ciclos_de_ot_un_ciclo_por_equipo
    unique (equipment_id),
  constraint mant_ciclos_de_ot_repeticiones
    check (repeticiones > 0 and repeticiones <= 20),
  constraint mant_ciclos_de_ot_vuelta
    check (vuelta_desde is null or (vuelta_desde >= 0 and vuelta_desde <= repeticiones)),
  -- Un arranque a medias no existe: o están los dos o no está ninguno. Con uno
  -- solo el ciclo no sabría ni desde cuándo ni en qué vuelta, y «generar algo»
  -- sería adivinar.
  constraint mant_ciclos_de_ot_arranque
    check ((desde is null) = (vuelta_desde is null)),
  constraint mant_ciclos_de_ot_tareas_distintas
    check (tarea_madre_id <> tarea_hija_id)
);

comment on table public.mant_ciclos_de_ot is
  'Ciclos de OT encadenadas: una madre, una hija que se repite, y vuelta a empezar. El estado son desde + vuelta_desde, y cuentan sólo las OT creadas en desde o después.';
comment on column public.mant_ciclos_de_ot.desde is
  'Fecha del último trabajo HECHO del ciclo. Es el corte: las OT anteriores no cuentan.';
comment on column public.mant_ciclos_de_ot.vuelta_desde is
  'Qué vuelta era ese trabajo: 0 = la madre, n = la hija nº n.';

-- ── Las dos columnas en las órdenes ─────────────────────────
--
-- `on delete set null` y no cascade: borrar la configuración de un ciclo no
-- puede llevarse las órdenes de trabajo que ya existieron.
alter table public.ordenes_trabajo
  add column if not exists ciclo_id uuid references public.mant_ciclos_de_ot(id) on delete set null,
  add column if not exists ciclo_vuelta smallint;

comment on column public.ordenes_trabajo.ciclo_vuelta is
  '0 = la madre del ciclo, 1..n = la hija nº n. La cara del martillo es la vuelta más uno.';

-- Parcial porque la enorme mayoría de las OT no son de un ciclo. No se usa como
-- destino de ningún ON CONFLICT: un índice parcial no sirve para eso.
create index if not exists ordenes_trabajo_ciclo_idx
  on public.ordenes_trabajo (ciclo_id) where ciclo_id is not null;

-- ── RLS ─────────────────────────────────────────────────────
--
-- Las dos funciones van **envueltas en un select**: sin eso Postgres las evalúa
-- una vez por fila. `mant_puede_ver(uid uuid default auth.uid())` declara un
-- argumento pero se llama con los paréntesis vacíos, así que va envuelta igual
-- — ese detalle dejó 22 policies de Mantenimiento afuera en la primera pasada
-- del 14/10/2026.
alter table public.mant_ciclos_de_ot enable row level security;

drop policy if exists mant_ciclos_de_ot_select on public.mant_ciclos_de_ot;
create policy mant_ciclos_de_ot_select on public.mant_ciclos_de_ot
  for select to authenticated using ((select public.mant_puede_ver()));

drop policy if exists mant_ciclos_de_ot_write on public.mant_ciclos_de_ot;
create policy mant_ciclos_de_ot_write on public.mant_ciclos_de_ot
  for all to authenticated
  using ((select public.mant_puede_editar()))
  with check ((select public.mant_puede_editar()));

-- ============================================================
-- LA SEMILLA
--
-- Dos cosas, y se distinguen porque una está decidida y la otra no.
--
-- **Las ocho tareas y los cuatro ciclos sí.** Los períodos y las repeticiones
-- los dio quien lo pidió, número por número, corrigiendo lo que decía la
-- historia. Eso es exactamente lo que `mant_tareas_preventivas` guarda: qué
-- decidió una persona. `decidido_por` queda en null porque no lo apretó nadie
-- en la pantalla, y el `motivo` dice de dónde salió.
--
-- El `periodo_dias` del CAMBIO va en null a propósito: el ritmo lo marca el
-- desgaste de la cara, que es el de la rotación. Cuando el cambio necesite el
-- suyo, se carga ahí sin tocar nada más.
--
-- **El punto de arranque no.** Se intentó deducirlo del historial y no da:
-- contando rotaciones cerradas desde el último cambio, dos de los cuatro
-- equipos dan 6 rotaciones de un ciclo de 3, porque el texto libre mezcla
-- rotaciones con revisiones («Revisión de rompedora y ver si es necesario rotar
-- martillos»). Arrancar cuatro ciclos sobre esa mezcla es el anti-objetivo.
-- Por eso `desde` y `vuelta_desde` quedan en null y **hasta que una persona los
-- cargue desde la ficha del equipo, esto no genera ninguna OT**.
--
-- `on conflict do nothing` en las tareas: si alguien ya decidió una de éstas en
-- la pantalla del catálogo, manda la suya.
-- ============================================================

insert into public.mant_tareas_preventivas
  (equipment_id, accion, componente, nombre, periodo_dias, estado, motivo)
select e.id, v.accion, 'Martillos', v.nombre, v.periodo_dias, 'CONFIRMADA',
       'Del ciclo de martillos acordado el 12/11/2026 (spec 2026-11-12-mantenimiento-ot-encadenadas).'
  from public.equipos e
  join (values
    ('PO-C1-04', 'ROTACION', 'Rotación de Martillos',  3),
    ('PO-C1-04', 'CAMBIO',   'Cambio de Martillos',    null),
    ('PY-B1-06', 'ROTACION', 'Rotación de Martillos',  6),
    ('PY-B1-06', 'CAMBIO',   'Cambio de Martillos',    null),
    ('PY-A1-05', 'ROTACION', 'Rotación de Martillos',  6),
    ('PY-A1-05', 'CAMBIO',   'Cambio de Martillos',    null),
    ('PY-C1-03', 'ROTACION', 'Rotación de Martillos', 10),
    ('PY-C1-03', 'CAMBIO',   'Cambio de Martillos',    null)
  ) as v(code, accion, nombre, periodo_dias) on v.code = e.code
 on conflict (equipment_id, accion, componente) do nothing;

insert into public.mant_ciclos_de_ot
  (equipment_id, tarea_madre_id, tarea_hija_id, repeticiones, especialidad)
select e.id, madre.id, hija.id, 3, 'MECÁNICO'
  from public.equipos e
  join public.mant_tareas_preventivas madre
    on madre.equipment_id = e.id and madre.accion = 'CAMBIO'   and madre.componente = 'Martillos'
  join public.mant_tareas_preventivas hija
    on hija.equipment_id  = e.id and hija.accion  = 'ROTACION' and hija.componente  = 'Martillos'
 where e.code in ('PO-C1-04', 'PY-B1-06', 'PY-A1-05', 'PY-C1-03')
 on conflict (equipment_id) do nothing;

-- ============================================================
-- SdG — Inventario: desestimar un faltante
--
-- «Para reponer» propone comprar lo que tiene faltante y se consumió en los
-- últimos 90 días. A veces la respuesta es que no: el artículo se discontinuó,
-- el mínimo está mal cargado, se reemplazó por otro, o sencillamente se decidió
-- no reponerlo. Hoy no hay forma de decirlo, así que esa fila vuelve a
-- proponerse todas las veces que alguien abra la pantalla — y una lista que
-- repite lo que ya se contestó es una lista que se deja de leer.
--
-- ── CUÁNDO DEJA DE VALER UNA DESESTIMACIÓN ───────────────────
--
-- Pedido: que vuelva a aparecer si el artículo **vuelve a tener un
-- movimiento**. La trampa está en qué quiere decir «vuelve a tener», y los
-- datos la muestran: medido el 26/11/2026 sobre los 35 artículos que hoy están
-- para pedir, la mediana del hueco entre dos movimientos consecutivos es de
-- **0,1 días** — o sea que los movimientos llegan en tandas del mismo día,
-- porque así los trae la sincronización de la planilla.
--
-- Por eso el ancla **no es el instante** en que se desestimó. Si lo fuera, una
-- tanda importada cinco minutos después —con filas de días que ya estaban a la
-- vista— levantaría la desestimación enseguida y el botón parecería no
-- funcionar. El ancla es `ultimo_movimiento`: el **día** del último movimiento
-- que el artículo tenía cuando alguien lo desestimó. La desestimación vale
-- mientras no aparezca un movimiento de un día **posterior** a ése.
--
-- Esa es la pregunta honesta: «¿pasó algo que yo no había visto?». Un
-- movimiento del mismo día ya estaba contado en la pantalla que se miró. Y es
-- `date` y no `timestamptz` porque la columna `fecha` del kardex es un día y no
-- un instante desde la 20260903081542 — compararla contra un timestamp vuelve
-- a traer el corrimiento de huso que esa migración vino a sacar.
--
-- `null` quiere decir que no tenía ningún movimiento, y entonces cualquiera lo
-- despierta.
--
-- ── POR QUÉ UNA FILA POR ARTÍCULO Y NO UN HISTORIAL ──────────
--
-- Desestimar se deshace con un click, así que no es de lo que la `auditoria`
-- del núcleo protege. Lo que importa es el estado de ahora: quién dijo que no
-- y por qué. Volver a desestimar pisa la fila anterior con el `ultimo_movimiento`
-- nuevo, que es justamente lo que hace falta para que el reloj arranque de
-- nuevo.
--
-- ── ESTO NO VA A NINGUNA PLANILLA ────────────────────────────
--
-- En Inventario manda la planilla, pero manda sobre el stock y los
-- movimientos: desestimar no toca ninguno de los dos. Es un concepto que sólo
-- existe en el SdG —como los ensayos de Calidad o las condiciones de Seguridad
-- e Higiene—, así que acá no hay `sheets_fila` ni `sheets_pendiente` y no hay
-- nada que exportar. La regla de «toda ruta que toque un campo que se exporta
-- tiene que exportar» no aplica porque no hay campo exportado; si algún día la
-- planilla gana una columna para esto, esa regla empieza a valer y hay que
-- volver acá.
--
-- ── EL MOTIVO ES OPCIONAL, A PROPÓSITO ───────────────────────
--
-- Obligarlo es la forma más rápida de llenar la tabla de «x». Queda opcional y
-- la pantalla dice «sin motivo» cuando no hay: un blanco se lee como «nadie
-- sabe», y esto dice «nadie lo escribió», que es otra cosa.
-- ============================================================

create table if not exists public.inventario_faltantes_desestimados (
  articulo_id      uuid primary key references inventario_articulos(id) on delete cascade,

  -- El día del último movimiento que tenía el artículo al desestimarlo. La
  -- desestimación vale mientras no haya uno posterior. Null = no tenía ninguno.
  ultimo_movimiento date,

  motivo           text,

  desestimado_por  uuid references usuarios(id) on delete set null,
  -- El nombre se guarda acá y no se resuelve por el id: un usuario dado de baja
  -- deja el id en null y la fila seguiría diciendo quién fue.
  desestimado_por_nombre text,
  desestimado_en   timestamptz not null default now()
);

comment on table public.inventario_faltantes_desestimados is
  'Faltantes que alguien decidió no reponer. Deja de valer cuando el artículo tiene un movimiento de un día posterior a ultimo_movimiento.';
comment on column public.inventario_faltantes_desestimados.ultimo_movimiento is
  'Día del último movimiento al momento de desestimar. Es un date porque inventario_movimientos.fecha lo es: comparar contra un instante corre un día. Null = no tenía movimientos.';

alter table public.inventario_faltantes_desestimados enable row level security;

-- La lectura es la del módulo y la escritura pide nivel de edición, igual que
-- los movimientos. Las dos funciones van **envueltas en un select**: sin eso
-- Postgres las evalúa una vez por fila aunque sean STABLE, que es lo que tenía
-- a `calculos_diarios` en timeout el 14/10/2026.
create policy inventario_desestimados_select on public.inventario_faltantes_desestimados
  for select to authenticated using ((select tiene_acceso_inventario()));

create policy inventario_desestimados_insert on public.inventario_faltantes_desestimados
  for insert to authenticated with check ((select puede_editar_inventario()));

create policy inventario_desestimados_update on public.inventario_faltantes_desestimados
  for update to authenticated
  using ((select puede_editar_inventario()))
  with check ((select puede_editar_inventario()));

create policy inventario_desestimados_delete on public.inventario_faltantes_desestimados
  for delete to authenticated using ((select puede_editar_inventario()));

-- El puntaje GUT como columna, para poder filtrar por prioridad con él.
--
-- ── QUÉ SE PIDIÓ, EL 23/10/2026 ─────────────────────────────────────────────
--
-- Que el filtro de prioridad del listado se relacione con el GUT, manteniendo
-- las tres opciones de siempre —Alta, Media, Baja—. Y que **mande el GUT**: si
-- la orden tiene las tres notas, su prioridad sale del puntaje aunque la
-- planilla diga otra cosa; si no las tiene, vale la de la planilla.
--
-- El motivo, medido: de 2.264 órdenes, **2.081 no tienen prioridad cargada**.
-- Sólo 183 la tienen —157 Media, 22 Alta, 4 Baja—, así que el filtro dejaba
-- afuera al 92% y no servía para repartir trabajo. El GUT, que es del
-- 21/10/2026, lo tenía puntuado una sola orden: esto empieza a valer de acá en
-- adelante, no sobre lo viejo.
--
-- ── POR QUÉ HACE FALTA UNA COLUMNA ──────────────────────────────────────────
--
-- El listado se pagina en la base —2.264 filas de a 50—, así que el filtro
-- tiene que correr allá: filtrar en el cliente filtraría sólo la página que se
-- está mirando. Y PostgREST **no sabe multiplicar en un filtro**: no hay forma
-- de pedirle "las que tengan gravedad × urgencia × tendencia mayor que 80".
--
-- `gut_orden` no sirve para esto, aunque ya exista. Lleva el +1000 de lo
-- abierto y, sobre todo, el 27 de "sin puntaje" — que es un producto posible
-- (3×3×3). O sea que mirándola no se distingue una orden sin puntuar de una
-- puntuada 3-3-3, y son dos cosas distintas: la primera tiene que caer en la
-- prioridad de la planilla y la segunda en Baja.
--
-- ── POR QUÉ GUARDA EL PRODUCTO Y NO LA PRIORIDAD ────────────────────────────
--
-- Se podría haber generado directamente la palabra —un `case` con los cortes—
-- y dejar el filtro como un `.in()` liso. **No se hizo a propósito**: eso
-- pondría los cortes (80 y 30) en el SQL además de en TypeScript, y una
-- migración aplicada no se edita. El día que alguien quiera mover el corte,
-- tendría que escribir otra migración y acordarse de los dos lados; mientras
-- tanto, la pantalla y la base dirían cosas distintas sin avisar.
--
-- Es exactamente lo que ya cuesta con `gut_orden`, que sí tiene el 27 y el
-- 1000 escritos en los dos lugares y necesitó un test que reescribe el SQL a
-- mano para atarlos. Acá la columna sólo multiplica —algo que no se discute— y
-- los cortes viven en un solo lado: `lib/mantenimiento/prioridad.ts`.
--
-- ── EL NULL ES LA REGLA DE LAS TRES NOTAS, GRATIS ───────────────────────────
--
-- En Postgres cualquier operación con `null` da `null`, así que una orden a la
-- que le falte una nota tiene `gut_puntaje` nulo. Eso es justo lo que el GUT
-- pide —"las tres van juntas o no va ninguna", ver `lib/mantenimiento/gut.ts`—
-- y no hace falta escribirlo: media puntuación no es medio puntaje.

alter table ordenes_trabajo
  add column if not exists gut_puntaje integer generated always as (
    gut_gravedad * gut_urgencia * gut_tendencia
  ) stored;

comment on column ordenes_trabajo.gut_puntaje is
  'Producto de las tres notas GUT, o null si falta alguna. Existe para poder '
  'filtrar por prioridad en la base: PostgREST no multiplica en un filtro. '
  'Los cortes que lo convierten en Alta/Media/Baja viven en '
  'lib/mantenimiento/prioridad.ts y NO acá, para que haya un solo lugar.';

-- El filtro pregunta por rangos (`> 80`, `between 30 and 80`, `< 30`) y por
-- `is null`, así que un índice simple sobre la columna alcanza.
create index if not exists ordenes_trabajo_gut_puntaje_idx
  on ordenes_trabajo (gut_puntaje);

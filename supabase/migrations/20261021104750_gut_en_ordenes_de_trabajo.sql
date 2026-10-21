-- ============================================================
-- SdG — Mantenimiento: la matriz GUT en las órdenes de trabajo
--
-- Hoy las OT pendientes se ordenan por número, o sea por antigüedad, y no hay
-- forma de decir cuál va primero. La matriz GUT (gravedad × urgencia ×
-- tendencia, cada una de 1 a 5) da un puntaje de 1 a 125 para ordenarlas.
-- El diseño completo, y por qué el puntaje no se escribe en `prioridad`, está en
-- docs/superpowers/specs/2026-10-21-mantenimiento-gut-design.md.
--
-- ── LAS TRES NOTAS ───────────────────────────────────────────────────────────
--
-- Son nulas hasta que alguien las cargue: de las 2.224 órdenes que ya existen,
-- ninguna tiene puntaje y no hay de dónde sacarlo. Inventar un 3-3-3 para
-- todas sería decir algo que nadie midió. El `check` deja entrar sólo 1 a 5.
--
-- ── POR QUÉ `gut_orden` ES UNA COLUMNA GENERADA ──────────────────────────────
--
-- PostgREST sólo sabe ordenar por columnas, no por expresiones. El listado de
-- OT se pagina de a 50 sobre 2.224 filas, así que ordenar en el cliente
-- ordenaría nada más que la página que se está viendo: la orden más urgente
-- podría estar en la página 40 y nunca aparecer arriba. El orden tiene que
-- decidirlo la base, y para eso tiene que existir como columna.
--
-- Es generada y no algo que mantenga la aplicación porque Postgres la
-- recalcula en cada escritura: no puede quedar desfasada de las tres notas ni
-- del estado, ni siquiera si alguien edita la fila a mano desde el editor SQL.
-- (`estado` es `text` y no un enum, así que el `in` con literales es inmutable
-- y entra sin cast.)
--
-- ── `gut_orden` NO ES EL PUNTAJE ─────────────────────────────────────────────
--
-- Es una clave de orden, y por eso se llama así. Lleva adentro dos reglas que
-- son decisiones de ordenamiento y no mediciones de nada:
--
--   · el 27 de las que no tienen puntaje (`coalesce(..., 27)`): 27 es 3×3×3,
--     o sea el 3 en cada una de las tres notas —no el punto medio de 1 a 125,
--     que sería 63—. Una orden sin puntaje se ordena como si todo fuera
--     «medio»: no pasa por delante de una que lo tiene alto, ni se hunde
--     detrás de una que lo tiene bajo.
--   · el +1000 de las que siguen abiertas: el máximo posible es 125, así que
--     sumar 1000 deja a toda orden abierta por encima de toda orden cerrada
--     (REALIZADO o SUSPENDIDA), sin importar el puntaje de cada una.
--
-- Dos casos que se deducen del SQL pero conviene dejar dichos:
--
--   · Un trío a medias —sólo la gravedad, por ejemplo— da producto null y
--     por lo tanto el 27, igual que uno vacío. Ningún `check` obliga a cargar
--     las tres notas o ninguna: es una decisión, y es la misma que toma el
--     TypeScript, que devuelve null si falta cualquiera de las tres.
--   · Un `estado` null caería en el `else` y contaría como abierta. No puede
--     pasar: `estado` es `text not null default 'POR_HACER'` (005, línea 159),
--     así que es sólo una defensa. Los valores de hoy, medidos el 21/10/2026,
--     son exactamente REALIZADO (2.179), POR_HACER (23), EN_PROCESO (14) y
--     ATRASADO (11): en mayúsculas, sin espacios, sin nulos. SUSPENDIDA no
--     tiene filas todavía, pero la 005 (línea 143) anota que los datos de
--     origen la usan y `lib/mantenimiento/alertas.ts` ya la trata como
--     cerrada; nombrarla acá es lo correcto y no una previsión de más.
--
-- Por eso la pantalla NUNCA imprime `gut_orden`: mostraría 1027 para una orden
-- sin puntaje y 1125 para una con 5-5-5. El puntaje que se muestra es el
-- producto de las tres notas, es null si falta alguna y se calcula en
-- `lib/mantenimiento/gut.ts`.
--
-- ATENCIÓN: el 27 vive en dos lugares, acá y en ese archivo. Si se cambia uno
-- hay que cambiar el otro, y como esta migración no se edita una vez
-- aplicada, el cambio de acá es otra migración que reemplace la columna.
--
-- ── LO QUE NO HACE FALTA ─────────────────────────────────────────────────────
--
-- Policy nueva: no. `ordenes_trabajo` ya tiene las suyas y esto agrega columnas,
-- no una tabla.
--
-- La sincronización con la planilla no las pisa: el `upsert` arma su payload
-- desde lo que lee de la planilla y nunca nombra estas columnas.
--
-- Se puede correr dos veces: `if not exists` en las cuatro columnas y en el
-- índice. (Una columna generada que ya existe se saltea entera, no se compara.)
-- ============================================================

alter table ordenes_trabajo
  add column if not exists gut_gravedad  smallint check (gut_gravedad  between 1 and 5),
  add column if not exists gut_urgencia  smallint check (gut_urgencia  between 1 and 5),
  add column if not exists gut_tendencia smallint check (gut_tendencia between 1 and 5),
  add column if not exists gut_orden integer generated always as (
    (case when estado in ('REALIZADO', 'SUSPENDIDA') then 0 else 1000 end)
    + coalesce(gut_gravedad * gut_urgencia * gut_tendencia, 27)
  ) stored;

create index if not exists ordenes_trabajo_gut_orden_idx
  on ordenes_trabajo (gut_orden desc, ot_number desc);

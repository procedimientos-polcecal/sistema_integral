-- ============================================================
-- El equipo que declara el pedido
-- ============================================================
-- Desde el 15/09/2026 la planilla de PEDIDOS DE COMPRA tiene una columna
-- EQUIPO y el formulario de Google la pregunta. O sea que el equipo dejó de ser
-- algo que el sistema deduce y pasó a ser algo que **declara quien pide**.
--
-- ── POR QUÉ ESTO NO CONTRADICE A LA 019 ─────────────────────
--
-- La 019 hizo exactamente lo contrario: borró `equipo_id` de
-- `compras_requerimientos` y dejó el enlace al núcleo sólo en
-- `compras_ubicaciones`, con este motivo escrito al lado:
--
--   "El enlace al núcleo pasa a estar en compras_ubicaciones. Tenerlo además
--    por requerimiento sólo abría la puerta a que los dos lados se contradigan."
--
-- Ese motivo era correcto y sigue siéndolo **para un dato derivado**. En la 019
-- el equipo del requerimiento no era una fuente: era una copia de lo que decía
-- la ubicación, y dos copias del mismo hecho se pelean sin que nadie gane.
--
-- Lo que cambió es que ahora hay **dos hechos distintos**, no dos copias de
-- uno: "dónde se necesita" —un lugar, texto libre, que en 15 de 42 casos se
-- pudo mapear a un equipo— y "para qué equipo es", que ahora lo contesta la
-- persona que hace el pedido. El segundo no se deduce del primero: hay
-- ubicaciones que sirven a varios equipos, y hay pedidos de un equipo que se
-- entregan en otro lado.
--
-- Y la contradicción que la 019 temía queda resuelta por precedencia y no por
-- ausencia: **gana el declarado; si no hay, se sigue infiriendo por la
-- ubicación como hasta ahora.** Eso vive en `lib/compras/equipoDelPedido.ts`,
-- con sus tests, para que la regla no quede repartida entre las pantallas.
--
-- ── LAS DOS COLUMNAS ────────────────────────────────────────
--
-- Mismo par que ya usa la ubicación, y por la misma razón: la planilla escribe
-- texto libre y **enlazar al que se le parece es peor que dejar en null**. El
-- texto crudo se conserva siempre —es lo que escribió una persona y es lo que
-- hay que mirar cuando el enlace no sale—, y el id se completa sólo cuando el
-- nombre coincide con certeza.
--
-- Los 1.968 requerimientos que ya están quedan con las dos columnas en null, y
-- eso es lo correcto: ninguno declaró un equipo, y rellenarlo con la inferencia
-- de la ubicación sería fabricar un dato que nadie dio. La inferencia sigue
-- estando donde estaba y se sigue usando como respaldo.

alter table compras_requerimientos
  add column if not exists equipo_raw text,
  add column if not exists equipo_id  uuid references equipos(id) on delete set null;

comment on column compras_requerimientos.equipo_raw is
  'Lo que dice la columna EQUIPO de la planilla, tal cual. Se conserva aunque el enlace no salga: es lo que escribió quien pidió.';

comment on column compras_requerimientos.equipo_id is
  'El equipo del núcleo, sólo cuando el nombre se reconoce con certeza. Null no es "sin equipo": es "no se lo pudo reconocer", y para eso está equipo_raw.';

-- El índice es para filtrar y para sumar gasto por equipo, que es la pregunta
-- que este dato viene a contestar. Va parcial —la enorme mayoría de las filas
-- va a tener null por mucho tiempo— y **no se usa como destino de ningún
-- ON CONFLICT**, que es la trampa por la que un índice parcial no sirve.
create index if not exists compras_req_equipo_declarado_idx
  on compras_requerimientos (equipo_id)
  where equipo_id is not null;

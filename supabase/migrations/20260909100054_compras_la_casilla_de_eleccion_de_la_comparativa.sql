-- ============================================================
-- SdG — Compras: la casilla de elección de la comparativa
--
-- En las planillas de comparativa la columna **Q, "ELECCIÓN"**, es una casilla
-- de verificación, y es ahí donde la gente marca qué presupuesto ganó. El
-- sistema la escribía —al agregar una fila la pone en FALSE— y **nunca la
-- leía**: `parsearFila` no la mira, así que marcarla no tenía ningún efecto.
--
-- Medido el 09/09/2026 en la comparativa MANGUERAS (1.001 filas): **10
-- requerimientos tienen su elección marcada** y el sistema no ve ninguno. Por
-- eso hay 312 presupuestos cargados con **cero** elegidos, y por eso el RI 1933
-- muestra "Proveedor elegido: sin definir" cuando en la planilla dice CASA
-- CAMINO, $3.225 × 10.
--
-- ¿Por qué una columna nueva y no la `elegida` que ya existe? Porque no
-- significan lo mismo:
--
--   `elegida`             → alguien con permiso aprobó esta compra en el SdG.
--                           Copia proveedor y costos al requerimiento y pone
--                           `estado_compra = APROBADO`.
--   `elegida_en_planilla` → la planilla dice que ganó ésta. Es un hecho leído,
--                           no una aprobación.
--
-- Escribir la casilla directamente en `elegida` aprobaría compras desde un
-- archivo de Drive, y hoy aprobar exige estar en `compras_aprobadores` y tener
-- el RI asignado. La decisión tomada (09/09/2026) es que **la planilla propone y
-- una persona confirma**: el sistema muestra lo que dice la planilla y alguien
-- con permiso lo confirma con un click, que es la ruta de elegir que ya existe.
--
-- No lleva índice: se consulta siempre junto con `requerimiento_id`, que ya
-- tiene el suyo, y son 312 filas.
-- ============================================================

alter table compras_cotizaciones
  add column if not exists elegida_en_planilla boolean not null default false;

comment on column compras_cotizaciones.elegida_en_planilla is
  'La casilla de la columna ELECCIÓN de la planilla de comparativa. Es un hecho leído, no una aprobación: la aprobación es `elegida`.';

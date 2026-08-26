-- ============================================================
-- SdG — Compras: de dónde salió un pedido que quedó en espera
--
-- Al poner un pedido en espera, su estado deja de decir en qué etapa estaba, y
-- sin eso volver significaría empezar de nuevo: los RI 244 y 245 están en
-- "para comprar" con aprobador asignado, y mandarlos al principio del circuito
-- les borraría ese trabajo.
--
-- Lo guarda el servidor leyendo el estado actual, no el cliente: es un dato que
-- la base ya tiene y no hay motivo para confiar en que lo manden bien.
-- ============================================================

alter table compras_requerimientos
  add column if not exists etapa_previa compras_estado_compra;

comment on column compras_requerimientos.etapa_previa is
  'Etapa de la que salió un pedido puesto EN_ESPERA, para devolverlo ahí. '
  'Nula en todo lo que no está en espera.';

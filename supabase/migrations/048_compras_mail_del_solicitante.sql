-- ============================================================
-- SdG — Compras: de quién es el pedido, para cuando haga falta saberlo
--
-- Quién pidió cada cosa vive en las respuestas del formulario de Google, no en
-- la planilla PEDIDOS DE COMPRA: es registro formal, no dato de la diaria. Por
-- eso los 1929 requerimientos importados no tienen solicitante y nunca lo van a
-- tener: la sincronización no lee de dónde sacarlo.
--
-- Lo que sí puede hacer el sistema es dejarlo asentado en los que nacen acá.
--
-- El mail y no sólo el id porque `solicitante_id` es `on delete set null`: el
-- día que se dé de baja a alguien, el pedido queda sin autor y no hay forma de
-- reconstruirlo. Una foto en texto sobrevive a eso, que es justamente para lo
-- que sirve una auditoría.
--
-- Es el mail de la sesión —con el que la persona entró—, no el de la tabla de
-- usuarios: lo que interesa registrar es quién estaba operando.
-- ============================================================

alter table compras_requerimientos
  add column if not exists solicitante_email text;

comment on column compras_requerimientos.solicitante_email is
  'Mail de quien cargó el requerimiento en la app, tal como estaba al cargarlo. '
  'Nulo en los que vinieron de la planilla: ahí ese dato no existe. '
  'Es una foto para auditoría, no un vínculo: no sigue al usuario si cambia.';

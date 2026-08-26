-- ============================================================
-- SdG — Compras: el estado EN ESPERA
--
-- Hay pedidos frenados a propósito: RI 53, el más viejo del sistema, dice en su
-- detalle "PARA TENER EMERGENCIA". No están en curso, pero tampoco se
-- denegaron, y hasta ahora el circuito sólo sabía representar esas dos cosas.
-- El resultado es una cola activa que miente sobre cuánto trabajo hay.
--
-- Va solo, como la 015 y la 024: Postgres no deja usar un valor de enum nuevo
-- hasta que su transacción commitee, y la 036 lo usa.
-- ============================================================

alter type compras_estado_compra add value if not exists 'EN_ESPERA';

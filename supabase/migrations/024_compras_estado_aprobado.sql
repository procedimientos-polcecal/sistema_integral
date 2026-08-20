-- ============================================================
-- SdG — Compras: nuevo estado APROBADO en el circuito de compra
--
-- Va solo, como la 015: Postgres no deja usar un valor de enum nuevo hasta que
-- su transacción commitee, y la 025 lo usa.
-- ============================================================

alter type compras_estado_compra add value if not exists 'APROBADO';

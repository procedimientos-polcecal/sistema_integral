-- ============================================================
-- SdG — Facturación: un cuarto valor para `odoo_conciliado_por`
--
-- Corrige la migración 20260911084048, que ya está aplicada y por lo tanto no
-- se edita: se corrige con otra.
--
-- ## Qué cambió, y por qué no estaba en la primera
--
-- La primera se escribió creyendo que el número del comprobante sólo vivía en
-- `account.move.ref`, un campo de texto libre. Después apareció que **el Odoo
-- del grupo tiene una localización argentina propia** (`odoo_l10n_ar`, no la
-- estándar) con campos de verdad:
--
--   voucher_type_id  el tipo de comprobante; su `code` es el número de ARCA
--   voucher_name     el número, `0006-00010192`
--
-- Y están en el **99,8%** de las 6.423 facturas de proveedor, contra el 24% de
-- la referencia. Así que la conciliación pasó a cruzar el campo propio, y la
-- referencia quedó como respaldo para las 11 que no lo tienen.
--
-- Son dos cosas distintas y conviene poder distinguirlas después: una vino de un
-- campo estructurado y la otra de adivinarle el formato a un texto que alguien
-- escribió a mano.
-- ============================================================

alter table facturas_proveedor
  drop constraint if exists facturas_proveedor_odoo_conciliado_por_check;

alter table facturas_proveedor
  add constraint facturas_proveedor_odoo_conciliado_por_check
  check (
    odoo_conciliado_por is null
    or odoo_conciliado_por in ('push', 'numero', 'referencia', 'a mano')
  );

comment on column facturas_proveedor.odoo_conciliado_por is
  'Cómo se supo que esta factura es ese asiento de Odoo: push (la creó el SdG), numero (voucher_name), referencia (el texto libre de ref), a mano (la eligió una persona).';

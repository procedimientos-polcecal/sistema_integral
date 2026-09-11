-- ============================================================
-- SdG — Facturación: el vínculo de una factura del buzón con Odoo
--
-- Etapa 3 del spec
-- (docs/superpowers/specs/2026-09-04-facturacion-proveedores-odoo-design.md).
--
-- Hasta acá el buzón registraba la factura y el estado `contabilizada` lo ponía
-- una persona apretando "Ya está en Odoo". Eso deja dos agujeros: el sistema no
-- sabe si es verdad, y la factura hay que cargarla igual del otro lado.
--
-- Con estas columnas el circuito se cierra por los dos extremos:
--
--   1. el SdG crea la factura **en borrador** en Odoo, con el número, la fecha,
--      el importe y el proveedor que salieron del QR;
--   2. una sincronización diaria relee esos borradores y los que administración
--      cargó a mano, y pasa a `contabilizada` lo que Odoo ya posteó.
--
-- Sigue sin postear nada. El asiento lo confirma una persona en Odoo.
--
-- ## Lo que hizo falta medir antes de escribir esto (11/09/2026)
--
-- **Odoo no tiene instalada la localización argentina.** No existe
-- `l10n_latam.document.type` ni un campo para el tipo de comprobante: el `name`
-- de una factura de proveedor es `BILL/2026/09/0004`, una secuencia interna que
-- no tiene nada que ver con el papel. El número fiscal, cuando está, está
-- escrito a mano en `ref` (`FC A 00008-00003715`) — y está en apenas **1.554 de
-- 6.423** facturas.
--
-- Por eso `odoo_move_id` no alcanza y hacen falta las columnas de abajo: hay que
-- poder decir **cómo** se supo que esa factura es ésa, y qué dijo Odoo cuando no
-- se pudo.
-- ============================================================

alter table facturas_proveedor
  -- `BILL/2026/09/0004`. Mientras está en borrador Odoo lo deja en "/": recién
  -- numera al postear, así que un nombre acá también dice que ya se posteó.
  add column if not exists odoo_nombre text,

  -- `draft`, `posted` o `cancel`, como se vio en la última sincronización.
  add column if not exists odoo_estado text,

  /*
   * Cómo se estableció el vínculo. Es el mismo criterio que `identificado_por`:
   * si mañana una factura aparece contabilizada y no debía, la primera pregunta
   * es si la reconoció el sistema o la enlazó alguien, y sin esta columna los
   * dos casos son indistinguibles.
   *
   *   push   — el borrador lo creó el SdG, así que el id es de nacimiento
   *   numero — se la reconoció por el número del comprobante en la referencia
   *   a mano — la eligió una persona entre los candidatos
   */
  add column if not exists odoo_conciliado_por text
    check (odoo_conciliado_por is null or odoo_conciliado_por in ('push', 'numero', 'a mano')),

  /*
   * Lo que dijo Odoo cuando algo falló, sin traducir. Mismo patrón que
   * `compras_requerimientos.odoo_pendiente` y que `sheets_pendiente`: un fallo
   * de escritura no es un `console.warn`, se guarda y se le muestra a quien hizo
   * la acción. También queda acá el aviso de una factura que está en Odoo por un
   * importe distinto al del comprobante.
   */
  add column if not exists odoo_pendiente text,

  add column if not exists odoo_sincronizado_en timestamptz;

comment on column facturas_proveedor.odoo_move_id is
  'El account.move de Odoo. Lo escribe el push del borrador o la conciliación; nunca se adivina.';

/*
 * Índice común y no parcial, aunque la mayoría de las filas tengan el campo en
 * null: un índice parcial no sirve como destino de ON CONFLICT y ya rompió dos
 * upserts en este repo (trampa nº2 del README). Acá no hay upsert hoy, pero el
 * costo de un índice completo sobre un integer es despreciable y el de
 * descubrirlo dentro de seis meses no.
 */
create index if not exists facturas_proveedor_odoo_move_idx
  on facturas_proveedor (odoo_move_id);

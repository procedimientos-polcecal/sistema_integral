-- ============================================================
-- SdG — Facturación: el emisor, resuelto contra Odoo
--
-- ## El problema, con número
--
-- El buzón resolvía el emisor **contra el padrón de proveedores del SdG**, y sin
-- proveedor no se podía crear el borrador en Odoo. Medido sobre las **2.776
-- facturas de proveedor de 2026**: en **1.558 (56%)** el CUIT del emisor no está
-- en ese padrón. O sea que más de la mitad de las facturas no podían usar nada
-- del circuito.
--
-- Y no es que falte el dato: **Odoo tiene el CUIT del 100% de esos partners**. El
-- padrón del SdG tiene 293 proveedores activos y Odoo 587 con CUIT, y los que
-- más facturan nunca pasaron por un requerimiento de Compras, que es de donde
-- salió el padrón:
--
--   ZITO Y PRIOLA          280 facturas   está en el padrón, sin CUIT
--   RUBIALES OSCAR         98             no está
--   BAX MATIAS FEDERICO    66             no está
--   SANDOVAL MARTIN        49             no está
--   COOP. ELECTRICIDAD     49             no está
--
-- Son transportistas y servicios. Facturan todos los meses y no se compran por
-- requerimiento.
--
-- ## Qué cambia
--
-- El emisor pasa a resolverse **contra `res.partner` de Odoo por CUIT**, que es
-- lo que la factura de Odoo necesita de verdad. El proveedor del SdG sigue
-- existiendo y sigue sirviendo —es lo que vincula la factura a un requerimiento
-- de Compras— pero **deja de ser obligatorio** para crear el borrador.
--
-- Estas dos columnas guardan a quién se reconoció, para que el buzón lo pueda
-- mostrar sin volver a preguntarle a Odoo en cada carga de pantalla. El push
-- vuelve a resolverlo igual, porque la empresa de la factura puede cambiar
-- después y el partner es por empresa: acá el valor es para leer, no para decidir.
--
-- ## Por qué no se importan los proveedores de Odoo al padrón
--
-- Porque `proveedores` es un **catálogo del núcleo** que comparten seis módulos.
-- Meterle 300 transportistas que sólo le sirven a Facturación ensuciaría los
-- selectores de Compras, Mantenimiento e Inventario. El emisor de una factura y
-- el proveedor al que se le compra son dos cosas que se parecen y no son la
-- misma.
-- ============================================================

alter table facturas_proveedor
  add column if not exists odoo_partner_id integer,
  add column if not exists odoo_partner_nombre text;

comment on column facturas_proveedor.odoo_partner_id is
  'El res.partner de Odoo que emitió la factura, reconocido por CUIT. Es lo que necesita el asiento; proveedor_id es el del padrón del SdG y puede no existir.';

comment on column facturas_proveedor.odoo_partner_nombre is
  'Con qué nombre se lo reconoció. Para poder leer la fila después, y para notar si alguien lo renombró en Odoo.';

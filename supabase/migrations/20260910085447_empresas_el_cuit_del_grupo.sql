-- ============================================================
-- SdG — El CUIT de las dos empresas del grupo
--
-- **Ya está aplicada por PostgREST** (es DML, y un agente puede correr DML).
-- Queda acá para que la base se pueda reconstruir de cero y para que el dato
-- tenga una procedencia escrita, que es lo que importa: **no se tipeó a mano.**
-- Los dos valores son el `vat` de `res.company` de Odoo, leído el 10/09/2026:
--
--   Polcecal S.A → 30641068019   (id 1 en Odoo)
--   Polysan S.A  → 30707285008   (id 2)
--
-- El de Polcecal se confirmó por otro camino el mismo día: es el `nroDocRec`
-- del QR de la factura A 0005-00003733 de Torraco, o sea el CUIT al que el
-- proveedor le facturó. Las dos fuentes coinciden.
--
-- Para qué sirve: el QR de una factura electrónica trae el CUIT del receptor,
-- así que **dice a cuál de las dos empresas se le facturó** y el buzón no tiene
-- que preguntarlo. Sin esto habría que elegir la empresa a mano en cada una de
-- las ~19 facturas que entran por día.
--
-- La columna la agregó 20260910080315 (el buzón); esto sólo la llena.
-- ============================================================

update empresas set cuit = '30641068019' where nombre = 'POLCECAL' and cuit is null;
update empresas set cuit = '30707285008' where nombre = 'POLYSAN'  and cuit is null;

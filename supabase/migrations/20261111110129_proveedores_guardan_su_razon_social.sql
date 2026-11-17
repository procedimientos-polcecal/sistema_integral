-- ============================================================
-- SdG — Proveedores guardan su razón social
--
-- El pedido era emparejar el padrón con Odoo poniéndole a cada proveedor la
-- razón social que figura allá. Medido el 11/11/2026 sobre los 168 proveedores
-- con CUIT: **108 tienen un nombre distinto del de Odoo**, 17 ya coinciden, 31
-- tienen dos nombres en Odoo para el mismo CUIT y 11 no están.
--
-- Reemplazar `nombre` por la razón social rompía dos cosas, y por eso esto es
-- una columna nueva y no un UPDATE.
--
-- 1. LA SINCRONIZACIÓN DE COMPRAS CREARÍA 57 DUPLICADOS EN LA CORRIDA SIGUIENTE
--
-- `asegurarProveedores` (lib/compras/sheets.ts) lee el texto del proveedor de
-- la planilla, lo busca en el padrón por el nombre normalizado y, si no lo
-- encuentra, **crea una fila nueva**. `claveDeProveedor` sólo saca acentos,
-- mayúsculas y puntos: no saca SRL ni SA, así que los 108 cambiarían de clave
-- y los 57 que tienen requerimientos —o sea, cuyo texto está en la planilla—
-- volverían a entrar como proveedores nuevos. Es el incidente que el propio
-- archivo documenta: el 14/09/2026 eso re-apuntó 1.937 requerimientos a filas
-- recién creadas sin CUIT.
--
-- 2. LA RAZÓN SOCIAL NO ES EL NOMBRE CON QUE LO CONOCEN
--
--   "Distribuidora Pueyrredon"  ->  "GIACOMASSO MIGUEL ANGEL"
--   "El emporio del soldador"   ->  "ZAMOLO HNOS. S.A."
--   "Hierros González"          ->  "HIERCONS S.R.L"
--   "Roxaf"                     ->  "ROXAF HERRAMIENTAS E INSUMOS DE FERRETERIA
--                                    SOCIEDAD DE RESPONSABILIDAD LIMITADA"
--
-- Quien carga un requerimiento escribe «Roxaf». Un desplegable con la segunda
-- deja de servir.
--
-- Así que son dos datos distintos y ahora el padrón los tiene a los dos:
-- `nombre` es con el que se lo nombra —y el que la planilla reconoce— y
-- `razon_social` es como figura en Odoo, para la factura y lo formal.
--
-- QUEDA EN NULL LO QUE NO SE SABE. Los 31 con dos nombres en Odoo y los 11 que
-- no están no se completan: enlazar al que se le parece es peor que dejar en
-- null, y acá el valor equivocado terminaría en un documento formal.
-- ============================================================

alter table public.proveedores
  add column if not exists razon_social text;

comment on column public.proveedores.razon_social is
  'Como figura en Odoo (res.partner.name), para la factura y lo formal. NO se '
  'usa para reconocer al proveedor: eso es `nombre`, que es el texto que '
  'escribe la planilla de Compras y con el que la sincronizacion lo busca. '
  'Null cuando no se pudo saber con certeza.';

-- Sin índice: no se busca por este campo, se muestra. El día que alguien
-- quiera buscar por razón social, va con `pg_trgm` y no con un btree, porque
-- lo que va a pedir es "que contenga", no "que empiece con".

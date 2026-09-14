-- ============================================================
-- SdG — Facturación: un tercer origen para los datos de la cabecera
--
-- `identificado_por` distinguía dos casos: `qr` —lo leyó el código de ARCA— y
-- `a mano` —lo tipeó una persona—. Ahora hay un tercero: **`texto`**, leído de la
-- capa de texto del PDF cuando el comprobante no trae QR.
--
-- ## Para qué
--
-- Hay emisores que no imprimen el bloque de ARCA. El caso grande es **ZITO Y
-- PRIOLA: 280 facturas en 2026**, el que más factura del grupo; sus PDF son
-- "copia del original" sin QR y hoy se tipean enteros. Su capa de texto, en
-- cambio, está completa.
--
-- ## Por qué merece un valor propio y no entra en `qr`
--
-- Porque **no son la misma calidad de dato**, y la columna existe justamente
-- para eso. El QR es un dato firmado por ARCA. El texto es un diseño impreso que
-- cada sistema de facturación arma como quiere, y el lector lo interpreta con
-- patrones. Si mañana un importe no cuadra, la primera pregunta es de cuál de
-- las tres fuentes salió — y sin este valor, una lectura de texto sería
-- indistinguible de una firmada.
--
-- El QR sigue mandando: el texto se lee **sólo si no se encontró QR**.
-- ============================================================

alter table facturas_proveedor
  drop constraint if exists facturas_proveedor_identificado_por_check;

alter table facturas_proveedor
  add constraint facturas_proveedor_identificado_por_check
  check (identificado_por in ('qr', 'texto', 'a mano'));

comment on column facturas_proveedor.identificado_por is
  'De dónde salieron los datos fiscales: qr (firmado por ARCA), texto (leído del PDF impreso, sólo cuando no hay QR) o a mano.';

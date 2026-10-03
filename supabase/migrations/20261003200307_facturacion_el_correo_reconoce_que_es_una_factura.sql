-- ============================================================
-- SdG — Facturación: el correo reconoce qué adjunto es una factura
--
-- La bandeja se llena con un Apps Script que mira **todos** los mails con
-- adjuntos, no una etiqueta. Con ese alcance, el filtro que había —un PDF entra
-- siempre— trae presupuestos, remitos, contratos y extractos. Una lista mitad
-- basura no la mira nadie, que es justo el problema que la bandeja resuelve.
--
-- Ahora el webhook lee **el texto del PDF** y decide. La regla es la misma que
-- usa el lector del buzón para separar emisor de receptor: una factura nuestra
-- lleva el CUIT de Polcecal o el de Polysan, y además dice que es un
-- comprobante. Medido sobre los 336 PDF de la carpeta de facturas: **316 (94%)
-- la cumplen**.
--
-- ## Por qué esta columna, y no un simple sí/no
--
-- Los otros 20 (6%) son **PDF sin capa de texto** —escaneos de DON ALFREDO,
-- LOGÍSTICA VW, TECNICOR, GIACOMASSO— y son facturas de verdad. Del texto no se
-- puede saber nada de ellos: habría que renderizar y leer el QR, que es lo que
-- hace el navegador y no el servidor.
--
-- Descartarlos sería perder 20 facturas por mes **sin que nadie se entere**, que
-- es peor que mostrar de más. Así que entran igual y esta columna dice por qué
-- no se las pudo confirmar, para que en la pantalla se vean distintas de las
-- que sí se reconocieron.
--
-- `null` = se confirmó que es una factura. Con texto = entró sin confirmar, y
-- el texto explica qué faltó.
-- ============================================================

alter table facturacion_correo
  add column if not exists sin_confirmar text;

comment on column facturacion_correo.sin_confirmar is
  'Null cuando se confirmó que el adjunto es una factura del grupo. Con texto, entró igual pero no se pudo confirmar: el motivo dice por qué (casi siempre, un PDF escaneado sin capa de texto).';

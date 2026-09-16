-- ============================================================
-- Seguimiento de la compra, fase 2: la aplicación del material
-- ============================================================
-- La fase 1 llegó hasta la recepción. Esto cierra el circuito: si el material
-- que llegó se usó, y cuándo. De ahí sale el tiempo que estuvo en stock, que
-- es el único indicador de esto que no existe en ningún otro lado.
--
-- ── LO QUE SE MIDIÓ ANTES DE ESCRIBIRLO (16/09/2026) ────────
--
-- `Se aplicó?` lo carga a mano **toda** el área, entre el 67% y el 100% de sus
-- filas según la pestaña. La FECHA, en cambio, es de una sola:
--
--   Mantenimiento   345 filas a mano, 0 fórmulas
--   Taller Vial      60 filas a mano, el resto fórmula
--   Almacén           0 filas a mano: la columna entera es `=J`, o sea que
--                     COPIA la fecha de recepción. No es una aplicación, es un
--                     espejo, y por eso su "Tiempo en Stock" da siempre cero
--   Las otras seis    0
--
-- Esa distinción importa para el exportador, no para acá: las dos columnas se
-- guardan igual para cualquier área, y quien no las use las deja en null.
--
-- Sobre las 343 filas de Mantenimiento que tienen recepción Y aplicación: la
-- mediana es de 3 días en stock, el percentil 75 de 7, el máximo de 66, y hay
-- **13 negativas** —aplicado antes de recibido—, que son datos mal cargados y
-- el sistema tiene que decirlo en vez de mostrar "-15 días".
--
-- ── POR QUÉ NO SE GUARDA EL TIEMPO EN STOCK ─────────────────
--
-- Es `fecha_aplicacion - fecha_recepcion`. Ya es una fórmula en la planilla, y
-- guardarlo sería una segunda copia del mismo hecho: dos copias se pelean sin
-- que nadie gane, que es lo que la 019 dejó escrito. Se calcula al mostrar.

alter table compras_requerimientos
  -- Texto con CHECK y no booleano: la planilla ofrece "Si" y "No", y null es
  -- "todavía no contestaron", que es distinto de "no se aplicó". Un booleano
  -- nullable diría lo mismo, pero éste se lee igual que `cumplio_compras` y
  -- `cumplio_proveedor`, que salieron del mismo libro.
  add column if not exists se_aplico text
    check (se_aplico in ('SI', 'NO')),
  add column if not exists fecha_aplicacion date;

comment on column compras_requerimientos.fecha_aplicacion is
  'Cuándo se usó el material. En la pestaña del área esta columna es a mano en Mantenimiento y Taller Vial, pero en Almacén es una fórmula (=J, la fecha de recepción): el exportador no escribe celdas que sean fórmula.';

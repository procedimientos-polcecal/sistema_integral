-- ============================================================
-- SdG — Un movimiento que no llegó a la planilla queda anotado
--
-- La planilla manda, así que un movimiento que no llega allá **no existe**: la
-- próxima sincronización lee el stock que calculan sus fórmulas —que no lo
-- incluyen— y revierte el número que el RPC había bajado. El movimiento queda
-- en la base, su efecto desaparece, y nada lo señala.
--
-- El repo de origen tenía exactamente ese agujero: el espejo corre en `after()`
-- y su fallo sólo deja un `console.warn`. Ni `sheets_row`, ni un flag, ni un
-- pendiente. Para enterarse hay que ir a los logs de Vercel.
--
-- Es el mismo problema que Compras resolvió en la 022 con `sheets_pendiente`, y
-- se resuelve igual. La regla, escrita en COMPRAS-ESTADO: toda ruta que toque el
-- estado tiene que exportar, y si no puede, dejar el pendiente anotado.
-- ============================================================

alter table inventario_movimientos
  add column if not exists sheets_pendiente     text,
  add column if not exists sheets_pendiente_en  timestamptz;

-- Los pendientes son pocos y se consultan solos: el índice parcial alcanza.
create index if not exists inventario_mov_pendiente_idx
  on inventario_movimientos (sheets_pendiente_en)
  where sheets_pendiente is not null;

comment on column inventario_movimientos.sheets_pendiente is
  'Por qué no se pudo escribir en la planilla, con lo que dijo Google sin traducir. Null = está escrito. Mientras no sea null, el stock de este movimiento se va a revertir en la próxima sincronización.';

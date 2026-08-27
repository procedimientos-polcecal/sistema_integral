-- ============================================================
-- SdG — Proveedores: los datos que estaban sólo en el Excel
--
-- La tabla nació con lo mínimo para elegir a quién comprarle: nombre, CUIT,
-- un contacto y el rubro. La base de datos de proveedores que lleva
-- administración tiene bastante más, y es lo que hace falta para pagarle a
-- alguien: cómo se le paga, en cuántos días, y a qué cuenta.
--
-- Los nombres siguen el criterio del resto del esquema: se dice qué es el dato,
-- no cómo se llamaba la columna en el Excel. `alias_bancario` y no `alias`
-- porque en Compras "alias" ya significa otra cosa —cómo figura un aprobador en
-- la planilla— y dos alias distintos en el mismo sistema se confunden.
--
-- Nota sobre el acceso: la política de lectura de `proveedores` es abierta a
-- cualquier usuario con sesión. Con el CBU adentro, eso significa que quien
-- sólo carga pedidos también puede leer los datos bancarios de todos los
-- proveedores. Se decidió así a sabiendas; si en algún momento se quiere
-- cerrar, hay que partir la lectura en dos políticas.
-- ============================================================

alter table proveedores
  add column if not exists direccion       text,
  add column if not exists sitio_web       text,
  -- Un segundo teléfono o contacto, tal como viene de la planilla.
  add column if not exists telefono_alt    text,
  -- En cuántos días se paga. Se guarda como número para poder ordenar y
  -- comparar; lo que no sea un número queda en `condicion_pago`.
  add column if not exists plazo_pago_dias integer,
  -- "CTA CTE", "ECHEQ", "TRANSFERENCIA"…
  add column if not exists forma_pago      text,
  -- "FF", "CONTADO"… La columna CONDICIÓN de la planilla.
  add column if not exists condicion_pago  text,
  add column if not exists cbu             text,
  add column if not exists alias_bancario  text,
  add column if not exists comentario      text;

comment on column proveedores.plazo_pago_dias is
  'Días de plazo de pago. Nulo cuando la planilla no lo dice o no es un número.';
comment on column proveedores.alias_bancario is
  'Alias de la cuenta. Se llama así y no "alias" porque en Compras ese nombre '
  'ya lo usa el alias de un aprobador en la planilla.';

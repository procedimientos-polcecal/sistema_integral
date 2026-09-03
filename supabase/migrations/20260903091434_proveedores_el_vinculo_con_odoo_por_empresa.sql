-- ============================================================
-- SdG — Proveedores: el vínculo con Odoo, por empresa
--
-- Una orden de compra en Odoo necesita un `partner_id`, así que sin este enlace
-- no se puede empujar nada. Y no puede ser una columna `odoo_partner_id` en
-- `proveedores`, porque **un proveedor del SdG es hasta dos partners de Odoo**:
-- Odoo lleva un registro por empresa. Medido el 03/09/2026: de 610 registros de
-- proveedor en Odoo hay 422 CUITs distintos, y 147 están en las dos empresas.
--
-- El cruce va por **CUIT normalizado** (`lib/odoo/proveedores.ts`), nunca por
-- nombre. No es una preferencia estética: en Odoo el proveedor está cargado con
-- la razón social y en el SdG con el nombre de fantasía. "Casa Camino" es
-- "PEDRO H. CAMINO S.R.L."; "Distribuidora Pueyrredon" es "GIACOMASSO MIGUEL
-- ANGEL". Por nombre no se habrían encontrado nunca, y peor: se habrían
-- encontrado otros.
--
-- El ensayo del cruce con los datos de hoy (GET /api/odoo/proveedores/preview):
-- 122 proveedores enlazan —76 de ellos a las dos empresas—, 143 no tienen CUIT
-- y quedan sin enlazar, 15 tienen CUIT que no está en Odoo, y hay 3 CUITs
-- repetidos en el padrón del SdG. Ninguno de los 145 CUITs del SdG tiene el
-- dígito verificador mal.
--
-- ¿Por qué `empresa_id` es NOT NULL si en Odoo un partner puede no tener
-- empresa? Porque un partner sin empresa en Odoo lo usan las dos, así que se
-- guardan **dos filas** apuntando al mismo `odoo_partner_id`. Es más fiel —"para
-- POLCECAL este proveedor es el partner X, y para POLYSAN también"— y además
-- evita el problema real de que Postgres no admite NULL en una clave primaria,
-- que obligaría a un índice único parcial. Y un índice único parcial no sirve
-- como destino de `ON CONFLICT` (README de esta carpeta, trampa nº2), justo lo
-- que la sincronización va a necesitar para ser idempotente.
-- ============================================================

create table if not exists proveedores_odoo (
  proveedor_id    uuid    not null references proveedores(id) on delete cascade,
  empresa_id      uuid    not null references empresas(id)    on delete restrict,
  odoo_partner_id integer not null,

  -- Con qué CUIT se hizo el enlace, ya normalizado. Queda guardado para poder
  -- auditar después por qué se enlazó lo que se enlazó: si mañana alguien
  -- corrige un CUIT en cualquiera de los dos lados, esto dice qué se usó.
  cuit            text,

  -- El `write_date` del partner en Odoo la última vez que lo leímos. Es lo que
  -- permite el pull incremental: traer sólo lo que cambió desde entonces.
  odoo_write_date timestamptz,

  -- En inglés como el resto del núcleo, y no por gusto: el trigger compartido
  -- `set_updated_at()` escribe en `updated_at`. Con otro nombre, el primer
  -- update falla.
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (proveedor_id, empresa_id)
);

-- Dentro de una empresa, un partner de Odoo le pertenece a un solo proveedor del
-- SdG. Sin esto, dos proveedores mal cargados pueden reclamar el mismo partner y
-- las órdenes de compra de uno terminan a nombre del otro.
create unique index if not exists proveedores_odoo_partner_uniq
  on proveedores_odoo (empresa_id, odoo_partner_id);

-- Para el camino inverso: de un id de Odoo al proveedor del SdG.
create index if not exists proveedores_odoo_partner_idx
  on proveedores_odoo (odoo_partner_id);

create trigger proveedores_odoo_updated_at
  before update on proveedores_odoo
  for each row execute function set_updated_at();

comment on table proveedores_odoo is
  'Enlace proveedor del SdG ↔ res.partner de Odoo, una fila por empresa. El cruce es por CUIT: ver lib/odoo/proveedores.ts.';

-- ── RLS ──────────────────────────────────────────────────────
--
-- Leer, cualquiera que esté autenticado: son ids de enlace, no datos del
-- negocio, y las pantallas de Compras y Mantenimiento los necesitan para mostrar
-- de dónde viene un dato. Escribir, sólo admin del núcleo: el padrón de
-- proveedores lo comparten cinco módulos y un enlace equivocado manda una orden
-- de compra a otro proveedor.

alter table proveedores_odoo enable row level security;

drop policy if exists proveedores_odoo_select on proveedores_odoo;
create policy proveedores_odoo_select on proveedores_odoo
  for select to authenticated using (true);

drop policy if exists proveedores_odoo_write on proveedores_odoo;
create policy proveedores_odoo_write on proveedores_odoo
  for all to authenticated
  using (es_admin())
  with check (es_admin());

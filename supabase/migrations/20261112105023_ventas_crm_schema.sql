-- ============================================================
-- SdG — Ventas / CRM: tablas, permisos y RLS
--
-- REQUIERE QUE 20261112105021_ventas_enum_del_modulo.sql YA HAYA CORRIDO Y ESTÉ
-- CONFIRMADO. Las funciones de abajo mencionan 'ventas', y un valor de enum
-- recién agregado no se puede usar en la misma transacción (55P04).
--
-- Es el primer frente del módulo Ventas. Guarda a quién se le vende y a quién
-- se le quiere vender, qué se habló con cada uno y qué hay que hacer después.
--
-- ── LO QUE ESTE CRM NO ES, Y POR QUÉ ────────────────────────
--
-- **No es el padrón de Odoo.** Odoo tiene los clientes facturables; el CRM
-- tiene además los **prospectos**, que por definición todavía no están en Odoo
-- y no tienen por qué entrar. Por eso `ventas_clientes` es una tabla propia y
-- no un espejo, y el enlace vive aparte en `ventas_clientes_odoo` —por empresa,
-- calcada de `proveedores_odoo` (20260903091434)— y admite no existir.
--
-- **El enlace con Odoo lo hace una persona, nunca el sistema por parecido.**
-- Es la regla de diseño que se repite en todo el repo: enlazar al que se le
-- parece es peor que dejar en null, porque un enlace equivocado no se nota
-- nunca — el dato aparece en el lugar que no es. Acá el precio sería facturarle
-- a otro.
--
-- **Tampoco se enlaza con Despacho todavía.** `despacho_ordenes_carga` guarda
-- el cliente como texto cacheado del remito (`cliente_raw`), así que cruzar «la
-- última vez que este cliente cargó» pide comparar texto libre contra razón
-- social, que es exactamente lo de arriba. Cuando `ventas_clientes_odoo` esté
-- cargado, ese cruce se hace por `odoo_partner_id` y es exacto. Hasta entonces
-- la ficha del cliente no muestra cargas: decirlo es mejor que inventarlo.
--
-- ── LO QUE NO ES UNA COLUMNA, A PROPÓSITO ───────────────────
--
-- **La probabilidad y «si está abierta» no se guardan: salen de la etapa**
-- (`lib/ventas/crm/etapas.ts`). Guardar las dos cosas sería tener una
-- oportunidad en etapa «Ganada» con `abierta = true`, que es la clase de
-- contradicción que el repo ya pagó en otros lados con valores derivados
-- guardados. Mismo criterio que el estado de una condición insegura y que los
-- tiempos de una orden de carga.
--
-- **«Hace cuánto que no se toca a este cliente» tampoco.** Sale de
-- `ventas_actividades`, que es el registro de lo que pasó. Una columna
-- `ultima_actividad_el` sería una segunda verdad que se desincroniza en cuanto
-- alguien corrija la fecha de una actividad, y nada avisaría.
--
-- **`estado` del cliente SÍ es una columna, y es la excepción.** Prospecto /
-- activo / inactivo no se deduce de los datos: es un juicio de quien vende. Un
-- cliente que no compra hace seis meses puede estar «activo» porque hay una
-- orden de compra en camino, e «inactivo» puede querer decir que se fue a la
-- competencia. Derivarlo de la última venta sería inventar ese juicio.
--
-- ── EL PRÓXIMO PASO ES LO QUE HACE QUE UN CRM SE USE ────────
--
-- Una actividad sin `proximo_paso_el` es una nota; con él es una agenda. Los
-- dos campos van juntos o no van: el check lo exige. Es el único campo de todo
-- el esquema que genera trabajo para alguien, y por eso la pantalla de
-- seguimiento se arma sobre él.
--
-- ── TODO EL QUE TIENE VENTAS VE TODOS LOS CLIENTES ──────────
--
-- No hay «mi cartera». Son catorce personas y dos plantas: una cartera por
-- vendedor es una regla de empresa grande que acá sólo esconde datos de los
-- compañeros y hace que el que atiende el teléfono no sepa con quién está
-- hablando. `vendedor_id` dice **quién atiende**, no quién puede ver. Si algún
-- día hace falta cerrarlo, se cierra en la policy de SELECT y en un solo lugar.
--
-- ── PERMISOS ────────────────────────────────────────────────
--
--   lectura  ve clientes, contactos, oportunidades y el registro de actividades
--   edicion  además carga y corrige todo eso, y mueve una oportunidad de etapa
--   admin    además borra un cliente (con todo lo que cuelga) y reasigna vendedor
--
-- **No hay trigger de columnas acá**, al revés que Seguridad e Higiene. Allá
-- `edicion` carga y `admin` evalúa, así que la diferencia es por columna y RLS
-- no sabe de columnas. Acá la diferencia es por **fila entera** (borrar) y por
-- una sola columna que no vale un trigger (`vendedor_id`): esa la cuida la
-- ruta. Un trigger que no hace falta es una defensa más que hay que mantener.
--
-- ── LAS POLICIES LLAMAN A SU FUNCIÓN ENVUELTA ───────────────
--
-- `(select tiene_acceso_ventas())` y no `tiene_acceso_ventas()`. Postgres
-- evalúa el USING una vez por fila aunque la función sea STABLE; el subselect
-- lo convierte en un InitPlan que se evalúa una sola vez. Pelada no rompe nada
-- y no avisa: la tabla simplemente empieza a costar proporcional a sus filas
-- (el 14/10/2026 eso tuvo a `calculos_diarios` en timeout; ver 20261014090512
-- y 20261014104956).
--
-- Diseño: docs/superpowers/specs/2026-11-12-ventas-crm-design.md
-- ============================================================

-- ── 1. Permisos ──────────────────────────────────────────────
-- Calcadas de las de Seguridad e Higiene (20261029111053). Tienen que decir lo
-- mismo que lib/ventas/auth.ts: cuando no coincidieron, en la 029, un
-- admin_sistema veía los botones y RLS le devolvía listas vacías.

create or replace function public.tiene_acceso_ventas()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'ventas'
    ),
    false
  )
$$;

create or replace function public.puede_editar_ventas()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'ventas'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_ventas()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'ventas' and nivel = 'admin'
    ),
    false
  )
$$;

-- ── 2. Marcar la fila cuando se la toca ──────────────────────
-- Propia y no la compartida `set_updated_at()` (005): aquélla escribe en
-- `updated_at`, y este módulo nombra sus columnas en castellano como el resto
-- de lo que se escribió después (syh, 20261029111053). Es un trigger y no un
-- `actualizado_en = now()` en cada ruta a propósito: de las cuatro tablas de
-- acá, tres se escriben desde más de una ruta, y la ruta que se olvide deja una
-- fila que miente sobre cuándo se tocó sin que nada avise.

create or replace function public.ventas_tocar_actualizado_en()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- ── 3. Los clientes ──────────────────────────────────────────

create table if not exists public.ventas_clientes (
  id              uuid primary key default gen_random_uuid(),

  -- `generated always` y no `by default`: acá no hay ninguna importación que
  -- tenga que conservar un número de otro lado, que es lo único que justifica
  -- el `by default` de `syh_condiciones` (y que obliga a un `setval` a mano).
  numero          integer generated always as identity unique,

  razon_social    text not null,
  nombre_fantasia text,

  -- Normalizado a once dígitos por `normalizarCuit()` de
  -- lib/ventas/crm/cuit.ts; la tabla no lo impone porque el dato entra por una
  -- sola puerta (la ruta) y un check de formato acá rechazaría una corrección
  -- hecha desde el editor SQL sin decir por qué.
  --
  -- `unique` y nullable **de verdad**: un prospecto no tiene CUIT y en Postgres
  -- los nulos no chocan entre sí, así que varios conviven. Es un unique común y
  -- no un índice parcial, porque un parcial no sirve de destino de ON CONFLICT
  -- (trampa #2 del README, que ya mordió dos veces).
  cuit            text unique,

  -- Prospecto / activo / inactivo: el juicio de quien vende, no un derivado.
  -- Ver el encabezado.
  estado          text not null default 'prospecto',

  -- Quién lo atiende. No es un permiso: ver el encabezado.
  vendedor_id     uuid references public.usuarios(id),

  localidad       text,
  provincia       text,
  rubro           text,
  telefono        text,
  email           text,
  sitio_web       text,

  -- De dónde salió: referido, feria, llamó, visita en frío. Texto libre a
  -- propósito —todavía no se sabe cuáles son las categorías de verdad, y un
  -- catálogo inventado hoy se llena de «Otro»—.
  origen          text,
  notas           text,

  creado_en       timestamptz not null default now(),
  creado_por      uuid references public.usuarios(id),
  actualizado_en  timestamptz,

  constraint ventas_clientes_estado check (estado in ('prospecto', 'activo', 'inactivo'))
);

create index if not exists ventas_clientes_razon on public.ventas_clientes (razon_social);
create index if not exists ventas_clientes_vendedor on public.ventas_clientes (vendedor_id);

drop trigger if exists ventas_clientes_tocar on public.ventas_clientes;
create trigger ventas_clientes_tocar
  before update on public.ventas_clientes
  for each row execute function public.ventas_tocar_actualizado_en();

-- ── 4. El enlace con Odoo, por empresa ───────────────────────
-- Calcada de `proveedores_odoo`. Un mismo cliente puede ser dos `res.partner`
-- distintos —uno en POLCECAL y otro en POLYSAN—, así que la clave es el par.
--
-- La tabla existe desde ahora aunque todavía no haya pantalla que la llene: es
-- lo que va a permitir cruzar con Despacho y con Facturación por id y no por
-- texto. Vacía no estorba, y agregarla después obligaría a una segunda
-- migración sobre un módulo ya en uso.

create table if not exists public.ventas_clientes_odoo (
  cliente_id      uuid    not null references public.ventas_clientes(id) on delete cascade,
  empresa_id      uuid    not null references public.empresas(id)        on delete restrict,
  odoo_partner_id integer not null,

  -- Con qué CUIT se hizo el enlace, ya normalizado. Queda guardado para poder
  -- auditar después por qué se enlazó lo que se enlazó: si mañana alguien
  -- corrige un CUIT en cualquiera de los dos lados, esto dice qué se usó.
  cuit            text,

  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz,

  primary key (cliente_id, empresa_id),
  -- Un partner de Odoo no puede estar enlazado a dos clientes del CRM dentro de
  -- la misma empresa: sería facturarle a dos fichas distintas.
  unique (empresa_id, odoo_partner_id)
);

drop trigger if exists ventas_clientes_odoo_tocar on public.ventas_clientes_odoo;
create trigger ventas_clientes_odoo_tocar
  before update on public.ventas_clientes_odoo
  for each row execute function public.ventas_tocar_actualizado_en();

-- ── 5. Los contactos ─────────────────────────────────────────
-- Una tabla aparte y no tres columnas en el cliente: en una empresa se habla
-- con el de compras, con el jefe de planta y con el de pagos, y el que atiende
-- el teléfono necesita saber cuál es cuál.
--
-- `es_principal` no tiene unique parcial que lo haga único por cliente: dos
-- principales es un error de carga, no una corrupción, y un unique acá haría
-- fallar el alta del segundo contacto con un 23505 que no le dice nada a nadie.
-- La pantalla muestra el primero y la ruta no deja marcar el segundo.

create table if not exists public.ventas_contactos (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.ventas_clientes(id) on delete cascade,
  nombre         text not null,
  cargo          text,
  telefono       text,
  email          text,
  es_principal   boolean not null default false,
  activo         boolean not null default true,
  notas          text,
  creado_en      timestamptz not null default now(),
  creado_por     uuid references public.usuarios(id),
  actualizado_en timestamptz
);

create index if not exists ventas_contactos_cliente on public.ventas_contactos (cliente_id);

drop trigger if exists ventas_contactos_tocar on public.ventas_contactos;
create trigger ventas_contactos_tocar
  before update on public.ventas_contactos
  for each row execute function public.ventas_tocar_actualizado_en();

-- ── 6. Las oportunidades ─────────────────────────────────────
-- Lo que se está tratando de vender. `cliente_id` es obligatorio: una
-- oportunidad sin cliente es un pedido sin nombre, y el cliente puede ser una
-- ficha en estado «prospecto» con la razón social sola.
--
-- `producto_id` apunta al catálogo del núcleo (`productos`, 20260910104534,
-- compartido con Producción y Despacho) y admite null: se sabe que el cliente
-- quiere cal mucho antes de saber qué granulometría.
--
-- **EL MONTO NO SE CONVIERTE NUNCA.** `moneda` es la del presupuesto y el
-- embudo suma **por moneda**, mostrando las dos. Convertir pide una cotización
-- del día, y una cotización guardada junto al monto envejece sin avisar: el
-- embudo del mes pasado cambiaría de valor cada vez que se lo mira. Compras ya
-- tiene esa discusión resuelta igual (040_cotizaciones_en_dolares).

create table if not exists public.ventas_oportunidades (
  id                    uuid primary key default gen_random_uuid(),
  numero                integer generated always as identity unique,
  cliente_id            uuid not null references public.ventas_clientes(id) on delete cascade,

  titulo                text not null,
  producto_id           uuid references public.productos(id),
  toneladas_estimadas   numeric,
  monto_estimado        numeric,
  moneda                text not null default 'ARS',

  -- La etapa es lo único que se guarda del avance. La probabilidad y si está
  -- abierta salen de acá, en lib/ventas/crm/etapas.ts. Los valores tienen que
  -- decir lo mismo que `ETAPAS` de ese archivo; el test `etapas.test.ts` fija
  -- la lista y este check es su espejo en la base.
  etapa                 text not null default 'contacto_inicial',

  vendedor_id           uuid references public.usuarios(id),
  fecha_estimada_cierre date,

  -- Se completan al cerrar. `motivo_perdida` es obligatorio al perder y eso lo
  -- exige la ruta, no la tabla: una oportunidad vieja que alguien marque como
  -- perdida desde el editor SQL no tiene por qué saber el motivo, y un check
  -- acá la rechazaría sin decir por qué.
  cerrada_el            date,
  motivo_perdida        text,

  notas                 text,
  creada_en             timestamptz not null default now(),
  creada_por            uuid references public.usuarios(id),
  actualizado_en        timestamptz,

  constraint ventas_oport_moneda check (moneda in ('ARS', 'USD')),
  constraint ventas_oport_etapa check (etapa in (
    'contacto_inicial', 'relevamiento', 'cotizada', 'negociacion', 'ganada', 'perdida'
  ))
);

create index if not exists ventas_oport_cliente on public.ventas_oportunidades (cliente_id);
create index if not exists ventas_oport_etapa on public.ventas_oportunidades (etapa);
create index if not exists ventas_oport_vendedor on public.ventas_oportunidades (vendedor_id);

drop trigger if exists ventas_oport_tocar on public.ventas_oportunidades;
create trigger ventas_oport_tocar
  before update on public.ventas_oportunidades
  for each row execute function public.ventas_tocar_actualizado_en();

-- ── 7. Las actividades ───────────────────────────────────────
-- El registro de lo que pasó: un llamado, una visita, un mail. Es la tabla que
-- hace que el CRM valga algo seis meses después, y de ella sale «hace cuánto
-- que no se toca a este cliente».
--
-- **`fecha` SE TIPEA Y NO ES `now()`.** La visita se registra a la mañana
-- siguiente, igual que los cuatro horarios de una orden de carga: poner la
-- fecha del servidor obligaría a mentir o a no cargar. `creada_en` guarda
-- aparte cuándo se tipeó, que es otra cosa.
--
-- **`oportunidad_id` es `on delete set null` y no cascade**, al revés que
-- `cliente_id`: la conversación pasó aunque la oportunidad se borre, y perder
-- el registro de un llamado porque alguien limpió el embudo es perder
-- justamente lo que no se puede reconstruir. Si se borra el cliente entero sí
-- se va todo: ahí no queda a qué pegarlo.

create table if not exists public.ventas_actividades (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.ventas_clientes(id) on delete cascade,
  contacto_id     uuid references public.ventas_contactos(id) on delete set null,
  oportunidad_id  uuid references public.ventas_oportunidades(id) on delete set null,

  tipo            text not null,
  fecha           date not null default current_date,
  resumen         text not null,

  -- Los dos juntos o ninguno. Ver el encabezado: es lo único de este esquema
  -- que le genera trabajo a alguien.
  proximo_paso    text,
  proximo_paso_el date,
  -- Cuándo se dio por cumplido. Null = pendiente. No se borra el próximo paso
  -- al cumplirlo: «qué se hizo y cuándo» es justamente lo que se quiere leer
  -- después.
  cumplido_el     date,

  hecha_por       uuid references public.usuarios(id),
  creada_en       timestamptz not null default now(),
  actualizado_en  timestamptz,

  constraint ventas_act_tipo check (tipo in (
    'llamado', 'visita', 'email', 'whatsapp', 'reunion', 'otro'
  )),
  constraint ventas_act_proximo check (num_nonnulls(proximo_paso, proximo_paso_el) <> 1)
);

create index if not exists ventas_act_cliente on public.ventas_actividades (cliente_id, fecha desc);
create index if not exists ventas_act_oportunidad on public.ventas_actividades (oportunidad_id);
-- Parcial a propósito: la pantalla de seguimiento pregunta sólo por lo que
-- tiene próximo paso sin cumplir, que son unas decenas sobre el total. No es
-- destino de ningún ON CONFLICT, que es lo único que un parcial no puede ser.
create index if not exists ventas_act_pendientes on public.ventas_actividades (proximo_paso_el)
  where proximo_paso_el is not null and cumplido_el is null;

drop trigger if exists ventas_act_tocar on public.ventas_actividades;
create trigger ventas_act_tocar
  before update on public.ventas_actividades
  for each row execute function public.ventas_tocar_actualizado_en();

-- ── 8. RLS ───────────────────────────────────────────────────

alter table public.ventas_clientes       enable row level security;
alter table public.ventas_clientes_odoo  enable row level security;
alter table public.ventas_contactos      enable row level security;
alter table public.ventas_oportunidades  enable row level security;
alter table public.ventas_actividades    enable row level security;

-- Leer: cualquiera con el módulo, con cualquier nivel. Ver el encabezado: no
-- hay cartera por vendedor.
drop policy if exists ventas_clientes_leer on public.ventas_clientes;
create policy ventas_clientes_leer on public.ventas_clientes
  for select using ((select tiene_acceso_ventas()));

drop policy if exists ventas_clientes_insertar on public.ventas_clientes;
create policy ventas_clientes_insertar on public.ventas_clientes
  for insert with check ((select puede_editar_ventas()));

drop policy if exists ventas_clientes_corregir on public.ventas_clientes;
create policy ventas_clientes_corregir on public.ventas_clientes
  for update
  using ((select puede_editar_ventas()))
  with check ((select puede_editar_ventas()));

-- Borrar un cliente se lleva en cascada sus contactos, sus oportunidades y todo
-- su registro de actividades: es de `admin`, y la ruta además lo audita con el
-- verbo `borrar` (CLAUDE.md: lo que no se deshace se audita).
drop policy if exists ventas_clientes_borrar on public.ventas_clientes;
create policy ventas_clientes_borrar on public.ventas_clientes
  for delete using ((select es_admin_ventas()));

drop policy if exists ventas_cli_odoo_leer on public.ventas_clientes_odoo;
create policy ventas_cli_odoo_leer on public.ventas_clientes_odoo
  for select using ((select tiene_acceso_ventas()));

-- Enlazar y desenlazar con Odoo es de `admin`: de ese id depende a quién se le
-- factura.
drop policy if exists ventas_cli_odoo_gestionar on public.ventas_clientes_odoo;
create policy ventas_cli_odoo_gestionar on public.ventas_clientes_odoo
  for all using ((select es_admin_ventas())) with check ((select es_admin_ventas()));

drop policy if exists ventas_contactos_leer on public.ventas_contactos;
create policy ventas_contactos_leer on public.ventas_contactos
  for select using ((select tiene_acceso_ventas()));

drop policy if exists ventas_contactos_escribir on public.ventas_contactos;
create policy ventas_contactos_escribir on public.ventas_contactos
  for all using ((select puede_editar_ventas())) with check ((select puede_editar_ventas()));

drop policy if exists ventas_oport_leer on public.ventas_oportunidades;
create policy ventas_oport_leer on public.ventas_oportunidades
  for select using ((select tiene_acceso_ventas()));

drop policy if exists ventas_oport_insertar on public.ventas_oportunidades;
create policy ventas_oport_insertar on public.ventas_oportunidades
  for insert with check ((select puede_editar_ventas()));

drop policy if exists ventas_oport_corregir on public.ventas_oportunidades;
create policy ventas_oport_corregir on public.ventas_oportunidades
  for update
  using ((select puede_editar_ventas()))
  with check ((select puede_editar_ventas()));

drop policy if exists ventas_oport_borrar on public.ventas_oportunidades;
create policy ventas_oport_borrar on public.ventas_oportunidades
  for delete using ((select es_admin_ventas()));

drop policy if exists ventas_act_leer on public.ventas_actividades;
create policy ventas_act_leer on public.ventas_actividades
  for select using ((select tiene_acceso_ventas()));

-- Cargar una actividad: `edicion`, y **sólo a nombre propio**. Un registro de
-- quién habló con quién que se puede firmar a nombre de otro no sirve para
-- nada. `hecha_por` en null lo completa la ruta con el usuario de la sesión.
drop policy if exists ventas_act_insertar on public.ventas_actividades;
create policy ventas_act_insertar on public.ventas_actividades
  for insert with check (
    (select puede_editar_ventas())
    and (hecha_por is null or hecha_por = (select auth.uid()))
  );

-- Corregir una actividad: `edicion`. Cualquiera del equipo puede completar el
-- resumen de una visita a la que fueron dos, y marcar cumplido el próximo paso
-- que hizo otro es lo normal cuando alguien se toma licencia.
drop policy if exists ventas_act_corregir on public.ventas_actividades;
create policy ventas_act_corregir on public.ventas_actividades
  for update
  using ((select puede_editar_ventas()))
  with check ((select puede_editar_ventas()));

-- Borrar una actividad es de `admin`: es el registro de lo que pasó, y el
-- camino normal para una cargada mal es corregirla.
drop policy if exists ventas_act_borrar on public.ventas_actividades;
create policy ventas_act_borrar on public.ventas_actividades
  for delete using ((select es_admin_ventas()));

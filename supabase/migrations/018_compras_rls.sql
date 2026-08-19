-- ============================================================
-- SdG — Módulo Compras: RLS
--
-- Los tres niveles del núcleo se mapean así:
--   lectura  → consulta
--   edicion  → gestiona la compra (proveedor, comparativa, costos, estados)
--   admin    → además aprueba o deniega
--
-- El alta de un RI es la excepción: la puede hacer cualquier usuario activo
-- del sistema, tenga o no el módulo. Son nueve áreas las que piden materiales
-- y exigirles un permiso explícito convertiría a Compras en un cuello de
-- botella administrativo. Pedir no compromete nada; aprobar sí.
-- ============================================================

alter table compras_areas            enable row level security;
alter table compras_requerimientos   enable row level security;
alter table compras_cotizaciones     enable row level security;
alter table compras_historial        enable row level security;
alter table compras_sincronizaciones enable row level security;

-- ── Áreas: lectura abierta, escritura de quien gestiona compras ──
create policy compras_areas_select on compras_areas
  for select to authenticated using (true);

create policy compras_areas_write on compras_areas
  for all to authenticated
  using (puede_editar_compras())
  with check (puede_editar_compras());

-- ── Requerimientos ───────────────────────────────────────────

-- Lectura abierta: el circuito de compras es transversal a toda la empresa.
create policy compras_req_select on compras_requerimientos
  for select to authenticated using (true);

-- Alta: cualquier usuario activo, siempre que se cargue a sí mismo como
-- solicitante y no se autoasigne un estado ya aprobado.
create policy compras_req_insert on compras_requerimientos
  for insert to authenticated
  with check (
    puede_editar_compras()
    or (
      solicitante_id = auth.uid()
      and estado_aprobacion = 'PENDIENTE'
      and estado_compra = 'SIN_INICIAR'
    )
  );

-- Edición: quien gestiona compras o aprueba; y el solicitante sobre su propio
-- pedido mientras nadie lo haya resuelto todavía.
create policy compras_req_update on compras_requerimientos
  for update to authenticated
  using (
    puede_editar_compras()
    or puede_aprobar_compras()
    or (solicitante_id = auth.uid()
        and estado_aprobacion in ('PENDIENTE', 'EN_REVISION'))
  )
  with check (
    puede_editar_compras()
    or puede_aprobar_compras()
    or (solicitante_id = auth.uid()
        and estado_aprobacion in ('PENDIENTE', 'EN_REVISION'))
  );

-- Borrado: sólo admin global. Un RI denegado se deja asentado, no se borra.
create policy compras_req_delete on compras_requerimientos
  for delete to authenticated using (es_admin());

-- ── Cotizaciones: las arma Compras ───────────────────────────
create policy compras_cotiz_select on compras_cotizaciones
  for select to authenticated using (true);

create policy compras_cotiz_write on compras_cotizaciones
  for all to authenticated
  using (puede_editar_compras())
  with check (puede_editar_compras());

-- ── Historial: se escribe por trigger; nadie lo edita ni lo borra ──
create policy compras_historial_select on compras_historial
  for select to authenticated using (true);

create policy compras_historial_insert on compras_historial
  for insert to authenticated with check (tiene_acceso_compras());

-- ── Sincronizaciones: sólo lectura desde la app ──────────────
-- Las filas las escribe el service_role durante la sincronización.
create policy compras_sync_select on compras_sincronizaciones
  for select to authenticated using (true);

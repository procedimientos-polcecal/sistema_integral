-- ============================================================
-- SdG — Compras: el circuito real de la compra
--
-- Cómo funciona de verdad, según el desplegable de la planilla y quienes lo
-- usan:
--
--   RI aprobado
--     → EN_COMPARATIVA   Compras junta presupuestos
--     → PARA_COMPRAR     comparativa lista, esperando el visto bueno de
--                        NICO o MAXI. En la planilla el estado dice a quién le
--                        toca: "PARA COMPRAR (NICO)".
--     → APROBADO         esa persona aprobó la compra
--     → PEDIDO           Compras hizo el pedido: recién acá se registran fecha,
--                        proveedor, costo + IVA y envío
--
-- El orden anterior estaba invertido: la app pasaba de PARA_COMPRAR a
-- EN_COMPARATIVA, y aprobar el RI lo dejaba directamente en PARA_COMPRAR, que
-- se saltea el armado de la comparativa.
-- ============================================================

alter table compras_requerimientos
  -- A quién le toca aprobar la compra. Es lo que va entre paréntesis en el
  -- estado de la planilla.
  add column if not exists compra_asignada_a uuid references usuarios(id) on delete set null,
  -- Quién la aprobó y cuándo. Separado de la aprobación del RI: son dos
  -- decisiones distintas, en momentos distintos.
  add column if not exists compra_aprobada_por uuid references usuarios(id) on delete set null,
  add column if not exists compra_aprobada_en timestamptz;

create index if not exists compras_req_compra_asignada_idx
  on compras_requerimientos (compra_asignada_a)
  where estado_compra = 'PARA_COMPRAR';

comment on column compras_requerimientos.compra_asignada_a is
  'A quién le toca aprobar la compra. Define el "(NICO)" o "(MAXI)" del estado en la planilla.';

-- Aprobar un RI lo deja al principio del circuito de compra, no en
-- PARA_COMPRAR: todavía falta juntar los presupuestos.
--
-- Los que hoy están en PARA_COMPRAR sin comparativa cargada vuelven al inicio;
-- los que ya la tienen quedan donde están, esperando el visto bueno.
update compras_requerimientos
set estado_compra = 'SIN_INICIAR'
where estado_compra = 'PARA_COMPRAR'
  and comparativa_url is null
  and proveedor_id is null;

-- ── Quién puede aprobar una compra ───────────────────────────
-- Sólo la persona a la que se le asignó. Si hay que cambiarla, Compras
-- reasigna: el estado de la planilla dice a quién le toca, y que apruebe otro
-- dejaría los dos lados diciendo cosas distintas.
create or replace function public.puede_aprobar_esta_compra(req_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select compra_asignada_a = auth.uid()
     from compras_requerimientos
     where id = req_id),
    false
  )
$$;

grant execute on function public.puede_aprobar_esta_compra(uuid) to authenticated;

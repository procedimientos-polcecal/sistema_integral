-- ============================================================
-- SdG — Taller Vial: reservar repuestos del pañol para un service o
-- reparación, y que Inventario confirme la baja real
--
-- NO ES LO MISMO QUE "ordenes_trabajo_repuestos" DE MANTENIMIENTO, aunque el
-- pedido original fue "misma lógica". Investigado a fondo antes de escribir
-- esto: en Mantenimiento asignar un repuesto a una OT es sólo una checklist
-- (nombre/código/cantidad en texto libre) con una consulta de sólo lectura
-- contra `inventario_articulos` — nunca descuenta stock. Acá el usuario pidió
-- lo contrario, y además en dos pasos, no uno:
--
--   1. Taller Vial RESERVA un repuesto para un service o una reparación.
--      No toca `inventario_articulos.stock_actual` todavía.
--   2. El encargado de INVENTARIO confirma que de verdad se retiró (desde una
--      cola nueva en ese módulo) o cancela la reserva si no correspondía.
--      Confirmar es la única acción que mueve stock de verdad, y usa
--      `inventario_registrar_movimiento()` (046) tal cual — no una función
--      nueva —, porque quien confirma ya tiene `puede_editar_inventario()`
--      por definición y esa función ya hace el lock de fila y el kardex bien.
--
-- SIN RPC PROPIA: al no descontar stock en el paso 1, no hace falta el
-- bloqueo de fila (`for update`) que sí necesita un descuento real — el único
-- lugar que toca `stock_actual` es el paso 2, y ese ya está resuelto por la
-- función de Inventario. Todo lo de acá se resuelve con RLS: quién puede
-- insertar una reserva, quién puede confirmarla (pasarla a 'confirmado' y
-- dejar `movimiento_id` puesto) y quién puede cancelarla.
--
-- UN SOLO ORIGEN POR FILA: `service_id`/`reparacion_id` nullable con un
-- constraint que exige exactamente una — mismo patrón que se usaría con una
-- tabla polimórfica, pero con integridad referencial real.
--
-- `taller_vial_repuestos_confirmado_coherente` empareja `estado` con los
-- campos de confirmación: no puede haber una fila 'confirmado' sin
-- `movimiento_id`/`confirmado_por`/`confirmado_en`, ni una 'reservado' que ya
-- los tenga. Es la manera de que el estado y sus consecuencias no se
-- desincronicen aunque alguien escriba directo por SQL.
--
-- CANCELAR (confirmado con el usuario) NO GENERA NINGÚN MOVIMIENTO: como la
-- reserva nunca descontó nada, cancelarla es borrar la fila y listo — no hay
-- nada que devolver.
-- ============================================================

create table if not exists taller_vial_repuestos_asignados (
  id            uuid primary key default gen_random_uuid(),
  service_id    uuid references taller_vial_services(id) on delete cascade,
  reparacion_id uuid references taller_vial_reparaciones(id) on delete cascade,
  articulo_id   uuid not null references inventario_articulos(id) on delete restrict,
  cantidad      numeric not null check (cantidad > 0),
  estado        text not null default 'reservado' check (estado in ('reservado', 'confirmado')),
  -- Sólo se completa al confirmar (paso 2).
  movimiento_id uuid references inventario_movimientos(id) on delete set null,
  cargado_por   uuid references usuarios(id),
  cargado_en    timestamptz not null default now(),
  confirmado_por uuid references usuarios(id),
  confirmado_en  timestamptz,
  constraint taller_vial_repuestos_un_solo_origen
    check ((service_id is not null) <> (reparacion_id is not null)),
  constraint taller_vial_repuestos_confirmado_coherente check (
    (estado = 'reservado'  and movimiento_id is null     and confirmado_por is null     and confirmado_en is null)
    or
    (estado = 'confirmado' and movimiento_id is not null and confirmado_por is not null and confirmado_en is not null)
  )
);

comment on table taller_vial_repuestos_asignados is
  'Repuestos del pañol reservados para un service o reparación de Taller Vial. Reservar no descuenta stock; confirmar sí (vía inventario_registrar_movimiento) y lo hace Inventario, no Taller Vial — separa quien pide de quien despacha.';

create index if not exists tv_repuestos_service_idx on taller_vial_repuestos_asignados (service_id);
create index if not exists tv_repuestos_reparacion_idx on taller_vial_repuestos_asignados (reparacion_id);
create index if not exists tv_repuestos_articulo_idx on taller_vial_repuestos_asignados (articulo_id);
create index if not exists tv_repuestos_estado_idx on taller_vial_repuestos_asignados (estado);

alter table taller_vial_repuestos_asignados enable row level security;

-- Lectura: los dos módulos la necesitan (Taller Vial para ver qué reservó,
-- Inventario para su cola de pendientes).
drop policy if exists tv_repuestos_select on taller_vial_repuestos_asignados;
create policy tv_repuestos_select on taller_vial_repuestos_asignados
  for select to authenticated
  using (tiene_acceso_taller_vial() or tiene_acceso_inventario());

-- Reservar: sólo Taller Vial, y sólo puede insertar en estado 'reservado' —
-- no puede nacer ya confirmada.
drop policy if exists tv_repuestos_reservar on taller_vial_repuestos_asignados;
create policy tv_repuestos_reservar on taller_vial_repuestos_asignados
  for insert to authenticated
  with check (
    puede_editar_taller_vial()
    and estado = 'reservado'
    and movimiento_id is null
    and confirmado_por is null
    and confirmado_en is null
  );

-- Confirmar: sólo Inventario, y sólo puede mover una reserva a 'confirmado'
-- (nunca al revés, y nunca tocar una fila que ya estaba confirmada).
drop policy if exists tv_repuestos_confirmar on taller_vial_repuestos_asignados;
create policy tv_repuestos_confirmar on taller_vial_repuestos_asignados
  for update to authenticated
  using (puede_editar_inventario() and estado = 'reservado')
  with check (puede_editar_inventario() and estado = 'confirmado');

-- Cancelar: Taller Vial (se equivocó de repuesto) o Inventario (no
-- correspondía), pero sólo mientras siga reservada — una vez confirmada, ya
-- es un movimiento de kardex real y una corrección pasa por Inventario, no
-- por acá.
drop policy if exists tv_repuestos_cancelar on taller_vial_repuestos_asignados;
create policy tv_repuestos_cancelar on taller_vial_repuestos_asignados
  for delete to authenticated
  using (estado = 'reservado' and (puede_editar_taller_vial() or puede_editar_inventario()));

notify pgrst, 'reload schema';

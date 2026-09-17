-- ============================================================
-- SdG — Taller Vial: las cargas se sincronizan, no se cargan a mano
--
-- Pivote del 17/09/2026 (después de correr 20260917094035 y 20260917094056):
-- el usuario aclaró que la carga sigue siendo en la planilla real, no en el
-- SdG — quiere el SdG como espejo de sólo lectura, con tablas e indicadores.
-- Mismo lugar que Compras/Mantenimiento/Inventario/Cantera-pesadas, no el que
-- había arrancado (Producción/Despacho: "de acá en adelante manda el SdG").
--
-- `taller_vial_cargas` no cambia de forma: sigue siendo fecha + equipo +
-- litros + lectura. Lo único que cambia es QUIÉN escribe — antes cualquiera
-- con nivel "edicion" desde una pantalla, ahora sólo el import
-- (`lib/tallerVial/importar.ts`, corrido con la service role, que no pasa
-- por RLS) y por lo tanto sólo el admin del módulo desde la app. Mismo
-- criterio que `cantera_pesadas` (20260914091110): "las pesadas se cargan
-- por import, no fila por fila desde una pantalla, por eso el write queda en
-- admin y no en 'puede editar'".
-- ============================================================

drop policy if exists taller_vial_cargas_write on taller_vial_cargas;
create policy taller_vial_cargas_write on taller_vial_cargas
  for all to authenticated using (es_admin_taller_vial()) with check (es_admin_taller_vial());

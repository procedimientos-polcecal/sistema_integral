-- ============================================================
-- SdG — Taller Vial: las cargas y los estados vuelven a cargarse desde el SdG
--
-- Segundo pivote del módulo (el primero fue 20260917100415/20260917101424,
-- "se sincronizan, no se cargan a mano"). El usuario cambió de opinión: quiere
-- cargar la carga de combustible y el estado del día de un equipo desde el
-- sistema, no desde la planilla. A diferencia del primer pivote, esta vez el
-- SdG NO se queda como espejo de sólo lectura de la planilla real: manda el
-- SdG, y además exporta hacia la planilla en el momento de guardar
-- (`lib/tallerVial/espejo.ts`), para que quien no entra al sistema la siga
-- viendo al día — mismo patrón que Producción.
--
-- LA SINCRONIZACIÓN QUE TRAE DESDE LA PLANILLA SIGUE CORRIENDO (decisión
-- explícita del usuario, no un descuido): por si alguien todavía anota ahí
-- por costumbre. El riesgo asumido es el mismo que cualquier sincronización de
-- dos direcciones — si el mismo día se carga en los dos lados, gana el último
-- que corrió, sin avisar — y con eso el usuario ya dijo que está de acuerdo.
--
-- `taller_vial_cargas` no tiene clave natural (un equipo puede cargar
-- combustible más de una vez el mismo día), así que `sincronizarCargasDesdeSheets`
-- sigue siendo un borrar-y-recargar — pero ahora sólo de las filas con
-- `cargado_por is null` (las que vinieron de la planilla), nunca de las que
-- nacieron en el SdG. Para que una fila cargada acá no vuelva a entrar
-- DUPLICADA cuando el propio `espejarCarga` la escribe también en "DATOS", el
-- import salta cualquier fila de la planilla cuya columna H ("ID sistema",
-- ver `lib/tallerVial/espejo.ts`) tenga algo: es el eco de una carga que ya
-- está en la base, no una nueva. `taller_vial_estados_diarios` sí tiene clave
-- natural (equipo_id, fecha) y ya hacía upsert, así que ahí no hace falta
-- ningún truco: la fila que trae la planilla pisa con el mismo valor que el
-- SdG acaba de escribir, no cambia nada.
--
-- `sheets_pendiente` en las dos tablas: si la escritura hacia la planilla
-- falla, se guarda acá lo que dijo Google sin traducir (nunca un
-- console.warn — regla del núcleo) y se le avisa a quien cargó. No hay
-- reintento automático todavía: se vuelve a intentar cargando de nuevo o
-- corrigiendo la planilla a mano.
-- ============================================================

-- ── 1. Cargas: vuelve a poder cargar quien puede editar el módulo ──
drop policy if exists taller_vial_cargas_write on taller_vial_cargas;
create policy taller_vial_cargas_write on taller_vial_cargas
  for all to authenticated using (puede_editar_taller_vial()) with check (puede_editar_taller_vial());

alter table taller_vial_cargas
  add column if not exists sheets_pendiente text;

-- ── 2. Estados: mismo permiso, y las columnas que le faltaban para cargarse
-- desde una pantalla (quién, por qué, y si falló la exportación) ──
drop policy if exists taller_vial_estados_diarios_write on taller_vial_estados_diarios;
create policy taller_vial_estados_diarios_write on taller_vial_estados_diarios
  for all to authenticated using (puede_editar_taller_vial()) with check (puede_editar_taller_vial());

alter table taller_vial_estados_diarios
  add column if not exists cargado_por uuid references usuarios(id),
  add column if not exists observaciones text,
  add column if not exists sheets_pendiente text;

notify pgrst, 'reload schema';

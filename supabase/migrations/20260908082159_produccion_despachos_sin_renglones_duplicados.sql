-- ============================================================
-- SdG — Producción: los despachos no se duplican con dos guardados a la vez
--
-- `app/api/produccion/partes/route.ts` reemplaza el depósito y los despachos
-- enteros con un `delete` y un `insert` — PostgREST no da transacciones
-- multi-sentencia, así que los dos van sueltos. Con dos POST concurrentes
-- sobre el mismo parte (un doble clic en Guardar alcanza) el intercalado
-- puede quedar así:
--
--   A: delete despachos
--   B: delete despachos     (no borra nada, A ya lo dejó vacío)
--   A: insert 10 renglones
--   B: insert 10 renglones  → 20 renglones, y las dos requests devuelven 200
--
-- El día se exporta con el despacho y la rotura al doble, sin ningún error.
-- El depósito no tiene este problema porque su primary key es
-- `(parte_id, producto_id)` y el segundo insert choca solo; los despachos no
-- tenían ninguna restricción de unicidad.
--
-- Esto NO arregla la concurrencia — para eso hace falta un RPC que serialice
-- las dos requests, y es otra tarea aparte. Lo que hace es convertir la
-- duplicación silenciosa en un error visible: el segundo insert de la B
-- choca contra esta constraint, la ruta lo recibe como cualquier otro error
-- de escritura y (`fallaConParteYaEscrito`) ya sabe anotar el parte como
-- `sheets_pendiente` en vez de dejar pasar el doble en silencio.
--
-- `orden` es la posición del renglón tal como lo guarda la ruta —no hay otro
-- dato de orden en el papel—, así que dos renglones del mismo parte con el
-- mismo `orden` son, por construcción, el mismo renglón escrito dos veces.
--
-- Honesto: si la tabla ya tuviera duplicados, este `alter table` fallaría al
-- aplicarse y habría que limpiarlos antes. Hoy no es el caso — el módulo
-- todavía no tiene pantallas de carga, así que `produccion_despachos` está
-- vacía —, pero el día que deje de estarlo esta migración ya no se puede
-- correr a ciegas.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'produccion_despachos_parte_orden_key'
  ) then
    alter table produccion_despachos
      add constraint produccion_despachos_parte_orden_key unique (parte_id, orden);
  end if;
end $$;

comment on constraint produccion_despachos_parte_orden_key on produccion_despachos is
  'Dos POST concurrentes sobre el mismo parte pueden intercalar el delete+insert de despachos y duplicar todos los renglones sin que ninguno de los dos devuelva error. Esta constraint no evita la carrera (haría falta un RPC que serialice), pero hace que el segundo insert choque en vez de duplicar en silencio.';

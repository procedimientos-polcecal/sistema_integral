-- ============================================================
-- SdG — Sectores: unificar los organizativos duplicados
--
-- `sectores` tenía 39 filas y cuatro funciones repetidas tres veces cada una.
-- "Administración" existía como sector de POLCECAL, como sector de POLYSAN y
-- como transversal "Administración (RRHH)". Lo mismo Calidad, Mantenimiento y
-- Producción. Son la misma área escrita tres veces: la de cada empresa la creó
-- el modelo original de Mantenimiento —donde un sector pertenecía a una
-- empresa— y la transversal la creó la importación de RRHH, que necesitaba una
-- sola por función.
--
-- El daño es que no suman juntas. Un empleado en "Mantenimiento (RRHH)" y 170
-- movimientos de pañol en "Mantenimiento" de POLCECAL son el mismo sector para
-- cualquiera que mire, y ningún tablero los junta.
--
-- QUÉ SE MIRÓ ANTES
--
-- Se contó, contra la base, cuántas filas apunta cada sector desde las nueve
-- tablas que lo referencian (empleados, equipos, avisos, ordenes_trabajo,
-- ordenes_servicio, compras_ubicaciones, inventario_movimientos,
-- inventario_destinos y sectores_status_log). El resultado achicó el trabajo:
-- de los diez sectores que sobran, ocho tienen **cero** referencias. Los dos
-- que quedan sólo tienen movimientos de inventario, 170 y 19.
--
-- También se verificó que nada deriva la empresa desde el sector:
-- `empleados.empresa_id` es propio y no nulo, y `empresaDelSector()` sólo se
-- usa sobre sectores **de planta**. Pasar los organizativos a transversales no
-- le saca el corte por empresa a ningún reporte.
--
-- QUÉ NO SE TOCA, Y A PROPÓSITO
--
-- Los transversales "Producción - Calcinación", "Producción - Planta 02" y
-- compañía **no** se fusionan con los sectores de planta homónimos. Tienen
-- empleados y son la taxonomía de RRHH —dónde trabaja una persona—; los de
-- planta son dónde está una máquina. Es la distinción que estableció la `033`,
-- y juntarlos sería exactamente el error del que ese archivo se cuidó.
--
-- LOS QUE SOBRAN QUEDAN INACTIVOS, NO BORRADOS
--
-- `activo = false` y no `delete`: es reversible, y un catálogo del núcleo que
-- comparten los cinco módulos no es lugar para una operación que no se puede
-- deshacer. Quedan diez filas muertas; el precio de poder equivocarse.
--
-- Se puede correr de nuevo sin hacer daño: cada paso busca por el nombre que
-- va a cambiar, así que la segunda vez no encuentra nada.
-- ============================================================

do $$
declare
  v_polcecal uuid;
  v_destino  uuid;
  v_origen   uuid;
  v_movidos  int;
  v_colgados int;
begin
  select id into v_polcecal from empresas where nombre = 'POLCECAL';

  -- ── 1. Las dos fusiones ────────────────────────────────────
  -- Sólo `inventario_movimientos` tiene filas hoy, pero se repuntan las nueve
  -- tablas igual: entre que esto se escribe y se corre puede aparecer una
  -- orden nueva, y una fila que quede apuntando al sector dado de baja no
  -- vuelve a aparecer en ningún desplegable.
  for v_origen, v_destino in
    select o.id, d.id
      from sectores o
      join sectores d
        on d.transversal
       and d.nombre = o.nombre || ' (RRHH)'
     where o.empresa_id = v_polcecal
       and not o.es_de_planta
       and o.nombre in ('Mantenimiento', 'Producción')
  loop
    update empleados              set sector_id = v_destino where sector_id = v_origen;
    update equipos                set sector_id = v_destino where sector_id = v_origen;
    update avisos                 set sector_id = v_destino where sector_id = v_origen;
    update ordenes_trabajo        set sector_id = v_destino where sector_id = v_origen;
    update ordenes_servicio       set sector_id = v_destino where sector_id = v_origen;
    update compras_ubicaciones    set sector_id = v_destino where sector_id = v_origen;
    update inventario_destinos    set sector_id = v_destino where sector_id = v_origen;

    update inventario_movimientos set sector_id = v_destino where sector_id = v_origen;
    get diagnostics v_movidos = row_count;
    raise notice 'Fusionado % -> %: % movimientos de inventario', v_origen, v_destino, v_movidos;

    -- El log de estados se queda donde está: es historia de ese sector, no un
    -- dato suyo, y el sector sigue existiendo.
  end loop;

  -- ── 2. Se cae el sufijo ────────────────────────────────────
  -- El "(RRHH)" estaba para distinguirlos de los homónimos por empresa. Ya no
  -- hay homónimos. El índice único de nombres transversales no se queja: los
  -- que tenían ese nombre son de una empresa, y ese índice es parcial.
  update sectores
     set nombre = replace(nombre, ' (RRHH)', '')
   where transversal
     and nombre like '% (RRHH)';

  -- ── 3. Dos tildes que faltaban ─────────────────────────────
  update sectores set nombre = 'Producción - Hidratación'
   where nombre = 'Producción - Hidratacion';
  update sectores set nombre = 'Producción - Fábrica de Cal'
   where nombre = 'Producción - Fabrica de Cal';

  -- ── 4. Los diez que sobran ─────────────────────────────────
  -- Las cuatro funciones por empresa, ahora vacías; "Planta", que nunca se
  -- usó; y "Sector Prueba", que ya estaba inactivo.
  update sectores
     set activo = false
   where not es_de_planta
     and activo
     and (
       (empresa_id is not null
        and nombre in ('Administración', 'Calidad', 'Mantenimiento', 'Producción'))
       or (transversal and nombre = 'Planta')
       or nombre = 'Sector Prueba'
     );

  -- ── 5. Que no haya quedado nada colgado ────────────────────
  -- Un sector inactivo con filas apuntándole no rompe nada, pero no vuelve a
  -- aparecer en ningún desplegable: quien mire esa fila no va a poder
  -- corregirla desde la pantalla. Si pasa, hay que saberlo ahora.
  select count(*) into v_colgados
    from sectores s
   where not s.activo
     and (   exists (select 1 from empleados              x where x.sector_id = s.id)
          or exists (select 1 from equipos                x where x.sector_id = s.id)
          or exists (select 1 from avisos                 x where x.sector_id = s.id)
          or exists (select 1 from ordenes_trabajo        x where x.sector_id = s.id)
          or exists (select 1 from ordenes_servicio       x where x.sector_id = s.id)
          or exists (select 1 from compras_ubicaciones    x where x.sector_id = s.id)
          or exists (select 1 from inventario_destinos    x where x.sector_id = s.id)
          or exists (select 1 from inventario_movimientos x where x.sector_id = s.id));

  if v_colgados > 0 then
    raise exception 'Quedaron % sectores inactivos con filas apuntandoles. Nada se guardo.', v_colgados;
  end if;

  raise notice 'Sectores activos: %', (select count(*) from sectores where activo);
end $$;

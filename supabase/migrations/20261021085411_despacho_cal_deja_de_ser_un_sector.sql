-- ============================================================
-- SdG — Despacho cal deja de ser un sector
--
-- Es el mismo caso que la 044, con otro par de códigos. El libro BD Equipos
-- parte la molienda en dos —`PO-D1 Molienda de cal` y `PO-D2 Despacho cal`—;
-- en la planta es un solo lugar, y el resto del sistema ya lo trataba así.
--
-- LA EVIDENCIA, MEDIDA EL 21/10/2026
--
-- Las **39 órdenes de trabajo** de PO-D2 dicen `sector_raw = "Molienda de
-- cal"`. **Ninguna dice "Despacho".** Cayeron en ese sector porque el sector
-- se deduce del equipo y no del texto: la máquina es una `PO-D2-xx`.
--
-- Son la embolsadora, cuatro cintas y dos sin fines, que es la línea de
-- ensacado de la molienda. Y "Despacho cal" tampoco existe como sector en
-- Compras ni en Mantenimiento para quien trabaja ahí: no está en la lista del
-- formulario de OT —la de quince opciones que se acomodó el 19/10— ni la usa
-- nadie para pedir.
--
-- El 19/10 se lo dejó en el catálogo justamente porque tenía equipos y
-- órdenes, razonando que la lista del formulario dice *quién solicita* y el
-- catálogo *dónde está la máquina*. Eso era cierto en general y falso acá: la
-- división no existe en la planta, existe en el libro.
--
-- QUÉ SE REPUNTA, RELEVADO ANTES DE ESCRIBIR ESTO
--
--     7  equipos                     39  ordenes_trabajo
--     2  avisos                       1  compras_ubicaciones
--     1  inventario_destinos        165  inventario_movimientos
--
-- Y en cero: `ordenes_servicio`, `empleados`, `produccion_semanal`,
-- `sectores_status_log`, `mant_contratista_lugares` y
-- `mant_partes_contratista_renglones`.
--
-- Al unirlos, la sincronización queda de acuerdo sola: vuelve a resolver el
-- sector desde el equipo, y el equipo ya va a estar en Molienda de cal. Las 39
-- dejan de ser la discrepancia más grande entre lo que alguien escribió y
-- dónde está la máquina.
--
-- OJO, LA MISMA ADVERTENCIA QUE LA 044
--
-- El libro BD Equipos sigue diciendo PO-D2, y su importación reconoce los
-- sectores por código y los vuelve a crear. **Mientras el libro no se corrija,
-- un "Importar BD Equipos" deshace esto.**
-- ============================================================

-- ── 1. Todo lo que apuntaba al despacho pasa a la molienda ───
--
-- `equipos.sector_id` es NOT NULL y sin ON DELETE: si no se repunta antes, el
-- borrado de abajo falla. Lo mismo `ordenes_trabajo` y `avisos`, que declaran
-- la clave sin acción.

do $$
declare
  v_despacho uuid;
  v_molienda uuid;
begin
  select id into v_despacho from sectores where codigo = 'PO-D2';
  select id into v_molienda from sectores where codigo = 'PO-D1';

  if v_despacho is null then
    raise notice 'PO-D2 no existe: ya estaba unido, no hay nada que hacer';
    return;
  end if;
  if v_molienda is null then
    raise exception 'No existe PO-D1: sin destino, no se une nada';
  end if;

  update equipos                set sector_id = v_molienda where sector_id = v_despacho;
  update ordenes_trabajo        set sector_id = v_molienda where sector_id = v_despacho;
  update avisos                 set sector_id = v_molienda where sector_id = v_despacho;
  update ordenes_servicio       set sector_id = v_molienda where sector_id = v_despacho;
  update compras_ubicaciones    set sector_id = v_molienda where sector_id = v_despacho;
  update inventario_destinos    set sector_id = v_molienda where sector_id = v_despacho;
  update inventario_movimientos set sector_id = v_molienda where sector_id = v_despacho;
  update empleados              set sector_id = v_molienda where sector_id = v_despacho;
  update produccion_semanal     set sector_id = v_molienda where sector_id = v_despacho;

  raise notice 'Sector PO-D2 unido a PO-D1';
end $$;

-- ── 2. Despacho cal deja de existir ──────────────────────────
--
-- Se borra y no se desactiva, por el mismo motivo que en la 044:
-- `sectoresDePlanta()` filtra por `es_de_planta` y no por `activo`, así que un
-- sector inactivo seguiría apareciendo en todos los desplegables de
-- Mantenimiento. Dejarlo ahí sería no haber unido nada.
--
-- Lo que cuelga con cascada —`sectores_status_log`,
-- `mant_contratista_lugares`, `produccion_semanal`— está en cero, así que el
-- borrado no se lleva ninguna fila por delante. Se comprobó con
-- `node scripts/que-cuelga-de.mjs sectores`, que es lo que hay que volver a
-- correr si alguien agrega una tabla que cuelgue de un sector.
--
-- Los códigos de los equipos **no se tocan**: siguen siendo `PO-D2-01` y
-- compañía. Es lo que los identifica contra el libro, y renombrarlos rompería
-- la próxima importación sin arreglar nada.

delete from sectores where codigo = 'PO-D2';

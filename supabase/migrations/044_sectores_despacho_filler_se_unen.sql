-- ============================================================
-- SdG — Despacho filler deja de ser un sector aparte
--
-- El libro BD Equipos parte cada filler en dos: `PY-A1 Filler 1` y
-- `PY-A2 Despacho filler 1`, `PY-B1 Filler 2` y `PY-B2 Despacho filler 2`. En
-- la planta es un solo lugar, y el resto del sistema ya lo trataba así: las 107
-- órdenes de trabajo de los dos despachos dicen `sector_raw = "Planta filler 1"`
-- y `"Planta filler 2"`. **Ninguna dice "Despacho".**
--
-- Cayeron en el sector de despacho porque el sector se deduce del equipo, no
-- del texto: la máquina es una `PY-A2-xx`. O sea que la división existe sólo en
-- el libro, y todo lo que la usa la heredó de ahí.
--
-- Al unirlos, la sincronización queda de acuerdo sola: vuelve a resolver el
-- sector desde el equipo, y el equipo ya va a estar en Filler 1.
--
-- OJO: el libro BD Equipos sigue diciendo PY-A2 y PY-B2, y su importación
-- reconoce los sectores por código y los vuelve a crear. Mientras el libro no
-- se corrija, un "Importar BD Equipos" deshace esto.
-- ============================================================

-- ── 1. Todo lo que apuntaba al despacho pasa a su filler ─────
--
-- Relevado contra la base antes de escribir esto: 33 equipos, 107 órdenes de
-- trabajo, 2 avisos y 2 órdenes de servicio. `empleados`,
-- `sectores_status_log`, `compras_ubicaciones` y `produccion_semanal` no tienen
-- ninguna fila en estos dos sectores.

do $$
declare
  par record;
begin
  for par in
    select d.id as despacho, f.id as filler, d.codigo as cod_d, f.codigo as cod_f
    from   (values ('PY-A2', 'PY-A1'), ('PY-B2', 'PY-B1')) as m(de, a)
    join   sectores d on d.codigo = m.de
    join   sectores f on f.codigo = m.a
  loop
    -- `equipos.sector_id` es NOT NULL y sin ON DELETE: si no se repunta antes,
    -- el borrado de abajo falla.
    update equipos          set sector_id = par.filler where sector_id = par.despacho;
    update ordenes_trabajo  set sector_id = par.filler where sector_id = par.despacho;
    update avisos           set sector_id = par.filler where sector_id = par.despacho;
    update ordenes_servicio set sector_id = par.filler where sector_id = par.despacho;

    raise notice 'Sector % unido a %', par.cod_d, par.cod_f;
  end loop;
end $$;

-- ── 2. Los sectores de despacho dejan de existir ─────────────
--
-- Se borran y no se desactivan: `sectoresDePlanta()` filtra por `es_de_planta`
-- y no por `activo`, así que un sector inactivo seguiría apareciendo en todos
-- los desplegables de Mantenimiento. Dejarlo ahí sería no haber unido nada.
--
-- Los códigos de los equipos **no se tocan**: siguen siendo `PY-A2-01` y
-- compañía. Es lo que los identifica contra el libro, y renombrarlos rompería
-- la próxima importación sin arreglar nada. Que una máquina de Filler 1 tenga
-- un código que dice A2 es raro de mirar y es la verdad de dónde salió.

delete from sectores where codigo in ('PY-A2', 'PY-B2');

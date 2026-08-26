-- ============================================================
-- SdG — La comparativa dice de qué equipo es
--
-- `os_comparativas` guardaba el equipo sólo como texto libre —"PY-B1-09 –
-- Molino vertical"— mientras sus tablas hermanas, `ordenes_servicio` y
-- `avisos`, guardan además el código y el enlace al equipo del sistema.
--
-- Faltaba de verdad: la sincronización lo leía y lo mandaba, y el insert
-- fallaba entero con "Could not find the 'equipo_code' column". Por eso no
-- entró ninguna de las 147 cotizaciones.
-- ============================================================

alter table os_comparativas
  add column if not exists equipo_code text,
  add column if not exists equipment_id uuid references equipos(id) on delete set null;

create index if not exists comp_equipo_idx on os_comparativas (equipment_id);

comment on column os_comparativas.equipo_code is
  'El código sacado del texto libre del equipo. Igual que en ordenes_servicio y avisos.';

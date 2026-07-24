-- ============================================================
-- SdG — Seed de prueba del módulo RRHH
-- Idempotente. config_liquidacion ya se sembró en 008 (singleton id=1).
-- Catálogo de turnos de ejemplo, tomado del README de gestion-operarios.
-- ============================================================

insert into jornadas (nombre, hora_inicio, hora_fin, tolerancia_minutos)
select * from (values
  ('Mañana', '06:00', '14:00', 15),
  ('Tarde',  '14:00', '22:00', 15),
  ('Noche',  '22:00', '06:00', 15)
) as j(nombre, hora_inicio, hora_fin, tolerancia_minutos)
where not exists (select 1 from jornadas where jornadas.nombre = j.nombre);

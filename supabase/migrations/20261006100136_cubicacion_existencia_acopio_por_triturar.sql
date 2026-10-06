-- ============================================================
-- SdG — Cantera: la cubicación suma el acopio por triturar
--
-- Cada yacimiento tenía UNA existencia final por mes. El usuario pidió
-- separarla en dos mediciones y que la cubicación use la suma:
--
--   · existencia final del YACIMIENTO — la piedra que queda en el yacimiento
--     (es la columna `existencia_final` de siempre, no se renombra: los
--     cierres ya cargados son esto, y renombrarla habría que reescribir
--     la planilla de lectura, la ruta y la consulta sin ganar nada).
--   · existencia final del ACOPIO POR TRITURAR — la piedra ya sacada del
--     yacimiento que espera en reservas para pasar por la trituradora. Es
--     la columna nueva `existencia_acopio`.
--
-- La existencia final que se usa para el residuo, el factor implícito, la
-- lectura y la existencia inicial del mes siguiente es la SUMA de las dos
-- (`lib/cantera/cubicacion.ts`) — no se guarda: se calcula al leer, igual
-- que el resto del balance.
--
-- NULLABLE a propósito: los cierres que ya estaban cargados no tienen
-- acopio medido, y no se inventa un cero ahí. Un acopio vacío cuenta como 0
-- en la suma (la existencia total sigue siendo la que ya estaba), pero la
-- pantalla lo muestra como "sin cargar" y no como un 0 medido.
-- ============================================================

alter table cantera_cubicaciones
  add column if not exists existencia_acopio numeric;

comment on column cantera_cubicaciones.existencia_acopio is
  'Toneladas medidas a fin de mes en el acopio por triturar (reservas) de este yacimiento. Null: no se midió / cierre anterior al 06/10/2026. La existencia final que usa el balance es existencia_final (yacimiento) + existencia_acopio.';

notify pgrst, 'reload schema';

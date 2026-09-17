-- ============================================================
-- SdG — Cantera: cubicación mensual por yacimiento (fase 4 del módulo)
--
-- QUÉ REEMPLAZA. La planilla "CUBICACIÓN CANTERA" (id
-- 17yui8Gpp_BRuwRXyavepFScID_jvqguPSL6vsAjXxKc, pestaña "CIERRE CANTERAS")
-- cierra cada mes un balance físico por yacimiento:
--
--   Stock teórico = Existencia inicial + Voladuras del mes − Acarreo del mes
--   Residuo       = Stock teórico − Existencia final (medida en el yacimiento)
--   Lectura       = SIN ACTIVIDAD si no hubo voladuras ese mes,
--                   CIERRA si |Residuo / Voladuras| ≤ 5%, ACEPTABLE si ≤ 10%,
--                   REVISAR si más — medido sobre lo volado, no sobre el
--                   stock, porque el acopio en el piso es una fracción chica
--                   del flujo mensual e infla cualquier desvío si se mide ahí.
--
-- De esas cuatro cantidades, tres YA se pueden calcular con lo que el SdG
-- tiene cargado en las fases 1 y 2: las voladuras del mes por yacimiento
-- (agrupando por fin de perforación, no por fecha de voladura — la planilla
-- cierra por perforación) y el acarreo del mes por yacimiento
-- (`toneladasPorYacimientoDesdePesadas` de `lib/cantera/pesadas.ts`, que ya
-- agrupa por el ORIGEN real de la pesada y no por el nombre del material —
-- ahí estaba el bug que tenía la planilla real con "Caliza" y C1/C3).
--
-- Lo único que es un dato nuevo es la EXISTENCIA FINAL: una medición física
-- en el yacimiento, a fin de mes, que nadie puede calcular. Esta migración
-- agrega sólo eso — una fila por yacimiento y mes con ese número — y el
-- resto de la cuenta (inicial encadenada del mes anterior, stock teórico,
-- residuo, lectura) se arma en `lib/cantera/cubicacion.ts`, sin guardarse.
--
-- LA CADENA NO TIENE UN "MES CERO" ESPECIAL EN EL MODELO. La planilla real
-- arranca con una fila donde la existencia inicial es un literal a mano (0,
-- 700, 400, 300 en julio/2026); acá eso es sólo el primer mes que alguien
-- carga: si no hay un mes anterior en esta tabla, la existencia inicial de
-- ese mes queda sin dato (no se inventa un cero) y por lo tanto tampoco su
-- lectura — el mes siguiente sí encadena, porque ya tiene de dónde salir. Es
-- la misma regla del repo que "enlazar al que se le parece es peor que dejar
-- en null", aplicada a un mes sin predecesor en vez de a un nombre ambiguo.

create table if not exists cantera_cubicaciones (
  id                uuid primary key default gen_random_uuid(),
  yacimiento_id     uuid not null references cantera_yacimientos(id) on delete restrict,
  -- Siempre el día 1: es un cierre mensual, no una fecha de evento.
  mes               date not null,
  existencia_final  numeric not null,
  observaciones     text,
  cargado_por       uuid references usuarios(id),
  cargado_en        timestamptz not null default now(),
  actualizado_por   uuid references usuarios(id),
  actualizado_en    timestamptz,
  -- Un yacimiento, un mes: un solo cierre. Cargar de nuevo el mismo mes
  -- corrige el que ya estaba, no lo duplica — mismo criterio que
  -- cantera_acarreos (fletero, tipo, mes).
  unique (yacimiento_id, mes)
);

comment on table cantera_cubicaciones is
  'El cierre mensual de cubicación de un yacimiento: sólo la existencia final medida a fin de mes. Voladuras, acarreo, existencia inicial (encadenada del mes anterior) y la lectura CIERRA/ACEPTABLE/REVISAR se calculan al leer, en lib/cantera/cubicacion.ts — no se guardan.';

create index if not exists cantera_cubicaciones_mes_idx on cantera_cubicaciones (mes);
create index if not exists cantera_cubicaciones_yacimiento_idx on cantera_cubicaciones (yacimiento_id);

alter table cantera_cubicaciones enable row level security;

-- Mismas funciones de acceso que el resto de Cantera (20260910103229): quien
-- tiene el módulo lee, quien puede editar carga el cierre del mes — es una
-- medición operativa, no un catálogo, mismo nivel que cantera_acarreos.
drop policy if exists cantera_cubicaciones_select on cantera_cubicaciones;
create policy cantera_cubicaciones_select on cantera_cubicaciones
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_cubicaciones_write on cantera_cubicaciones;
create policy cantera_cubicaciones_write on cantera_cubicaciones
  for all to authenticated using (puede_editar_cantera()) with check (puede_editar_cantera());

notify pgrst, 'reload schema';

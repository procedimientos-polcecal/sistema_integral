-- ============================================================
-- SdG — Cantera: Destape toma el fletero y las horas de Acarreo
--
-- El usuario cambió de opinión sobre cómo se carga un registro de destape de
-- fletero externo: ya no se elige el fletero ni se tipean las horas a mano
-- en Destape — esas dos cosas ya se cargaron en Acarreo (fletero + fecha +
-- horas, tipo "horas_destape"), así que Destape sólo tiene que agregar el
-- yacimiento y el tipo de camión. `lib/cantera/espejo` de este cambio vive
-- en el código (`lib/cantera/destape.ts`, `app/api/cantera/destape/route.ts`):
-- acá sólo hace falta la columna que linkea un registro de Destape con LA
-- fila de Acarreo de la que salieron sus horas.
--
-- UN YACIMIENTO POR CARGA DE ACARREO (confirmado con el usuario): si un
-- fletero reparte destape entre dos yacimientos el mismo día, se carga como
-- dos filas distintas en Acarreo (mismo fletero, mismo día, cada una con su
-- parte de las horas) — no se reparte una sola fila de Acarreo entre dos
-- registros de Destape. Por eso `acarreo_id` es único: impide clasificar la
-- misma carga de horas dos veces por accidente.
--
-- NULLABLE a propósito: los registros de Destape de fletero externo
-- cargados ANTES de este cambio no tienen de dónde sacar un `acarreo_id`
-- —se tipeó el fletero y las horas a mano, no hay una fila de Acarreo
-- asociada en particular— y no se inventa un link a ciegas. Quedan
-- editables igual que antes (el fix de "edición de destape" de esta misma
-- tarea no depende de esta columna). `operario_propio` tampoco la usa nunca:
-- no hay fletero ni carga de Acarreo de la que tirar.
--
-- ÍNDICE PARCIAL, no una constraint `unique` de columna entera: con
-- `acarreo_id` nullable, una `unique` corriente dejaría pasar como mucho UNA
-- fila con `null` (Postgres trata un `unique` como "como mucho un null se
-- parece a otro", en realidad los nulls nunca son iguales entre sí así que
-- esto no aplica — pero el índice parcial es más explícito igual: sólo
-- importa la unicidad entre los que SÍ tienen un link). No se usa como
-- destino de `ON CONFLICT` en ningún lado, así que no cae en la trampa #2
-- del README de migraciones.
-- ============================================================

alter table cantera_destape
  add column if not exists acarreo_id uuid references cantera_acarreos(id) on delete set null;

create unique index if not exists cantera_destape_acarreo_id_unq
  on cantera_destape (acarreo_id)
  where acarreo_id is not null;

comment on column cantera_destape.acarreo_id is
  'La fila de cantera_acarreos (tipo ''horas_destape'') de la que salieron el fletero y las horas de este registro. Null en los registros de fletero externo cargados antes del 01/10/2026 (fletero y horas tipeados a mano) y siempre null en operario_propio.';

notify pgrst, 'reload schema';

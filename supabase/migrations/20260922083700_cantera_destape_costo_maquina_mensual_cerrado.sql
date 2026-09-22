-- ============================================================
-- SdG — Cantera destape: costo de máquina propia, cacheado por mes cerrado
--
-- Destape con máquina propia habla con Odoo Online en cada visita
-- (`lib/cantera/costoMaquinaOdoo.ts`, gasto analítico del equipo + gasto de
-- combustible, varias llamadas encadenadas) — lo midió el usuario como la
-- causa de que la página anduviera lenta, incluso después de arreglar el
-- timeout y la duplicación de sesión (commit 67f0708 del 22/09/2026).
--
-- Para un mes YA CERRADO (cualquiera antes del actual) no hace falta volver
-- a preguntarle a Odoo: las facturas de un mes cerrado no cambian. Esta tabla
-- guarda el resultado la primera vez que alguien mira ese mes, y las
-- próximas veces se lee de acá — cero viajes a Odoo. El mes en curso NUNCA
-- se guarda acá: sigue "vivo" (pueden llegar facturas nuevas todavía), se
-- sigue calculando en vivo en cada visita, igual que hoy.
--
-- ESTO ROMPE A PROPÓSITO el criterio general del módulo ("todo lo que se
-- puede despejar, no se guarda", ver el comentario grande de
-- `20260921100250_cantera_destape.sql`): ahí la razón de no guardar es que
-- una tarifa vieja se puede corregir y el costo guardado quedaría mal. Acá
-- es al revés — lo que se guarda no sale de una tarifa editable del SdG,
-- sale de facturas YA POSTEADAS en Odoo de un mes YA CERRADO, que no se
-- vuelven a tocar. Es la misma lógica que ya usa Facturación con un asiento
-- posteado: inmutable, así que cachearlo no arriesga nada.
--
-- Quién puede escribir: CUALQUIERA con acceso a Cantera, no sólo
-- `puede_editar_cantera()` como el resto del módulo. No es un dato que
-- alguien carga: es una memoria de un cálculo — quien primero mira agosto
-- (aunque sea de sólo lectura) lo calcula y lo guarda para el que lo mire
-- después. Si la política fuera "sólo edición", un usuario de sólo
-- lectura nunca podría disparar el cacheo y agosto seguiría lento para
-- siempre del lado de lectura.
-- ============================================================

create table if not exists cantera_costo_maquina_mensual (
  id                      uuid primary key default gen_random_uuid(),
  -- Primer día del mes ("2026-08-01"), mismo criterio que cantera_cubicaciones.mes.
  mes                     date not null,
  -- Código de equipo ("EM3"), no equipo_id: es la forma en que ya habla
  -- costoMaquinaOdoo.ts con Odoo (las cuentas analíticas se resuelven por
  -- código, no por uuid interno) — mismo dato que ya usa `codigoPorEquipoId`
  -- en la página de Destape.
  equipo_codigo           text not null,
  -- null si ese mes el equipo no tuvo horas cargadas en Taller Vial — no hay
  -- entre qué dividir, no es "gratis". Se cachea igual: un mes cerrado sin
  -- horas sigue sin horas la próxima vez que se mire.
  costo_hora              numeric,
  gasto_odoo              numeric not null,
  precio_implicito_litro  numeric,
  estimado_combustible    numeric not null,
  horas_del_mes           numeric,
  calculado_en            timestamptz not null default now(),
  unique (mes, equipo_codigo)
);

comment on table cantera_costo_maquina_mensual is
  'Costo $/h de una máquina propia de destape, cacheado una vez que el mes queda cerrado (lib/cantera/costoMaquinaOdoo.ts) — evita recalcular contra Odoo en cada visita a un mes pasado. El mes en curso nunca se guarda acá.';

create index if not exists cantera_costo_maquina_mensual_mes_idx on cantera_costo_maquina_mensual (mes);

alter table cantera_costo_maquina_mensual enable row level security;

drop policy if exists cantera_costo_maquina_mensual_select on cantera_costo_maquina_mensual;
create policy cantera_costo_maquina_mensual_select on cantera_costo_maquina_mensual
  for select to authenticated using (tiene_acceso_cantera());

-- A propósito NO es `puede_editar_cantera()`: ver el comentario de arriba.
drop policy if exists cantera_costo_maquina_mensual_write on cantera_costo_maquina_mensual;
create policy cantera_costo_maquina_mensual_write on cantera_costo_maquina_mensual
  for all to authenticated using (tiene_acceso_cantera()) with check (tiene_acceso_cantera());

notify pgrst, 'reload schema';

-- ============================================================
-- SdG — Cuánto vale una hora de mano de obra propia
--
-- `ordenes_trabajo` guarda las horas de cada trabajo y quiénes lo hicieron:
-- 1.169 órdenes con horas, 6.815 horas-hombre de personal propio. Lo único que
-- falta para saber cuánto costó es el precio de una hora, que no existe en
-- ningún lado —`operarios` guarda `id, slot, nombre` y nada más—.
--
-- Es una tabla y no una columna suelta porque la tarifa cambia. Con un solo
-- valor mutable, actualizarla en septiembre reescribiría lo que costó una
-- reparación de marzo, y el gasto de una máquina se movería sin que hubiera
-- pasado nada. Acá cada hora se costea con la tarifa que regía el día que se
-- trabajó.
--
-- Una sola tarifa para todos y no una por operario: son diez personas, el dato
-- real es de sueldos y vive en RRHH, y no serviría igual para las 59 órdenes
-- donde la columna de operario dice "Ambos".
-- ============================================================

create table if not exists mantenimiento_tarifas_hora (
  id             uuid primary key default gen_random_uuid(),
  valor          numeric(14,2) not null check (valor >= 0),
  -- Desde cuándo rige. Única: cargar una tarifa para una fecha que ya tiene
  -- otra es una corrección, no una segunda tarifa del mismo día.
  vigente_desde  date not null unique,
  creado_por     uuid references usuarios(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists tarifas_hora_vigencia_idx
  on mantenimiento_tarifas_hora (vigente_desde desc);

comment on table mantenimiento_tarifas_hora is
  'El precio de una hora de mano de obra propia, con su vigencia. La hora de un trabajo se costea con la tarifa de mayor vigente_desde anterior o igual a la fecha en que se ejecutó.';
comment on column mantenimiento_tarifas_hora.vigente_desde is
  'Rige desde este día inclusive. Las horas anteriores a la primera tarifa no se costean: no valen cero, se cuentan aparte.';

-- ── RLS ──────────────────────────────────────────────────────
-- Leer con acceso al módulo; escribir sólo el admin, como el resto de la
-- configuración. Es un dato de plata.

alter table mantenimiento_tarifas_hora enable row level security;

drop policy if exists mantenimiento_tarifas_hora_read on mantenimiento_tarifas_hora;
create policy mantenimiento_tarifas_hora_read on mantenimiento_tarifas_hora
  for select to authenticated using (mant_puede_ver());

drop policy if exists mantenimiento_tarifas_hora_write on mantenimiento_tarifas_hora;
create policy mantenimiento_tarifas_hora_write on mantenimiento_tarifas_hora
  for all to authenticated
  using (mant_es_admin())
  with check (mant_es_admin());

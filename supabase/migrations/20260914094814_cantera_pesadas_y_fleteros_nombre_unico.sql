-- ============================================================
-- SdG — Cantera: pesadas de balanza + fleteros.nombre único
--
-- Sigue a `20260914091110_cantera_acarreo_fleteros_y_tarifas.sql`, que ya
-- corrió: esa migración se escribió y se corrigió dos veces en la misma
-- sesión (el usuario aclaró después de correrla que el material de acarreo
-- sí tiene fletero, pesada por pesada, y esas dos correcciones —la tabla
-- `cantera_pesadas` y el `unique` de `cantera_fleteros.nombre`— habían
-- quedado escritas en el archivo original DESPUÉS de que ya se hubiera
-- corrido. Una migración aplicada no se edita (regla del README): esto es
-- la corrección aparte, con lo mismo que ese archivo ya trae.
--
-- Ver el comentario completo (por qué existe `cantera_pesadas`, la columna
-- del fletero corrida en "Datos", los 11 fleteros conocidos) en el archivo
-- original — no se repite acá para no tener el mismo texto en dos lados.

alter table cantera_fleteros add constraint cantera_fleteros_nombre_key unique (nombre);

create table if not exists cantera_pesadas (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null,
  hora          text,
  bruto         numeric,
  tara          numeric,
  tipo          text,
  toneladas     numeric not null,
  origen        text,
  destino       text,
  fletero_raw   text,
  fletero_id    uuid references cantera_fleteros(id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table cantera_pesadas is
  'Una pesada de balanza (una fila de la pestaña "Datos"): fecha, material, origen/destino y fletero. De acá sale, agrupando por fletero+tipo+mes, cuánto acarreó cada uno en materiales — las tres actividades sin pesada (destape, bloques, bochones) no están acá, van en cantera_acarreos.';

create index if not exists cantera_pesadas_fecha_idx on cantera_pesadas (fecha);
create index if not exists cantera_pesadas_fletero_idx on cantera_pesadas (fletero_id);
create index if not exists cantera_pesadas_tipo_idx on cantera_pesadas (tipo);

alter table cantera_pesadas enable row level security;

drop policy if exists cantera_pesadas_select on cantera_pesadas;
create policy cantera_pesadas_select on cantera_pesadas
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_pesadas_write on cantera_pesadas;
create policy cantera_pesadas_write on cantera_pesadas
  for all to authenticated using (es_admin_cantera()) with check (es_admin_cantera());

notify pgrst, 'reload schema';

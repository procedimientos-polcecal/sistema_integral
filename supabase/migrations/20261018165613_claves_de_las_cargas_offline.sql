-- ============================================================
-- SdG — Mantenimiento: la clave de una carga hecha sin señal
--
-- Un aviso o una OT cargados sin señal viven en el teléfono hasta que vuelve la
-- red, y entonces se mandan. Mandarlos **dos veces** es lo normal, no el
-- accidente: la respuesta se pierde con el túnel, el teléfono reintenta, y el
-- servidor que ya había creado la fila la crea otra vez. Cada carga lleva una
-- clave que genera el teléfono al cargarla, y la ruta de alta la usa para
-- reconocer el reintento y devolver lo mismo que la primera vez.
--
-- Por qué una tabla y no una columna en `avisos` y `ordenes_trabajo`: existe una
-- ventana en la que la fila ya se escribió en la planilla y el insert en la base
-- falló —`app/api/mantenimiento/ordenes/route.ts` la contempla y devuelve 500—,
-- y en esa ventana no hay ninguna fila donde haber guardado la clave. El
-- reintento no encontraría nada, escribiría otra fila en la planilla y la
-- duplicaría. Por eso la clave se **reserva antes de tocar la planilla**: la
-- tabla existe para tener dónde anotarla cuando todavía no hay nada más.
--
-- Las columnas `resuelto_en`, `numero` y `entidad_id` se llenan al terminar. Una
-- clave con `resuelto_en` en null es una carga que arrancó y no se sabe si
-- llegó: el reintento tiene que tratarla con cuidado y no darla por perdida.
--
-- RLS PRENDIDO Y NINGUNA POLICY — y eso es deliberado, no un olvido. A esta
-- tabla la escribe sólo el cliente admin, desde las dos rutas de alta, y nadie
-- más tiene por qué leerla: la pantalla de la cola lee del teléfono, no de acá.
-- Con RLS prendido y sin policies, PostgREST le niega todo a cualquier
-- autenticado y el cliente admin pasa de largo, que es exactamente lo que se
-- quiere. Sin el `enable`, la tabla quedaría abierta a cualquiera con sesión.
-- Si alguien le agrega una policy "para que se pueda leer", está abriendo lo que
-- esto cerró: preguntarse antes si de verdad hace falta.
--
-- Se borra con el usuario (`on delete cascade`): una clave no tiene sentido sin
-- quien la generó, y no es un registro que haya que conservar.
-- ============================================================

create table if not exists cargas_offline (
  clave        text primary key,
  usuario_id   uuid not null references usuarios(id) on delete cascade,
  tipo         text not null check (tipo in ('aviso', 'orden')),
  creado_en    timestamptz not null default now(),
  resuelto_en  timestamptz,
  numero       text,
  entidad_id   uuid
);

comment on table cargas_offline is
  'Claves de idempotencia de los avisos y las OT cargados sin señal. Se reserva la clave antes de escribir en la planilla, para que un reintento no duplique la fila aunque el insert en la base haya fallado. La escribe sólo el cliente admin; no tiene policies a propósito.';

comment on column cargas_offline.clave is
  'La genera el teléfono al cargar y viaja en cada reintento. Es la primaria: dos cargas con la misma clave son la misma carga.';

comment on column cargas_offline.resuelto_en is
  'Cuándo terminó la carga. Null = la clave se reservó pero no se sabe si la carga llegó a escribirse: no darla por perdida.';

comment on column cargas_offline.numero is
  'El número que se le dio al aviso o a la OT (texto, como en la planilla), para devolver lo mismo en el reintento.';

comment on column cargas_offline.entidad_id is
  'El id del aviso o de la OT creados. Sin foreign key a propósito: apunta a una u otra tabla según `tipo`.';

alter table cargas_offline enable row level security;

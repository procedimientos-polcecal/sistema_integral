-- ============================================================
-- SdG — Mensajes pegados a su registro
--
-- Hoy lo que una persona le quiere decir a otra sobre una orden de trabajo, un
-- requerimiento de compra o una condición insegura se dice por afuera —un
-- WhatsApp, un llamado, un comentario en la planilla— y no queda en el
-- registro: quien lo abre después no sabe qué se habló ni quién avisó a quién.
-- Esto es un hilo de mensajes que cuelga del registro, con menciones que
-- avisan por correo.
--
-- Un solo par de tablas para los tres tipos, y no una tabla de mensajes por
-- módulo, porque lo que cambia entre ellos es a qué se pega el hilo y no qué es
-- un mensaje. De ahí que `entidad_id` **no tenga foreign key**: apunta a tres
-- tablas distintas según `entidad_tipo` y Postgres no sabe referenciar a una
-- tabla que se decide por el valor de otra columna. Es la misma solución que
-- ya tienen `cargas_offline.entidad_id` y `auditoria`. El costo, dicho: **si se
-- borra la orden, el requerimiento o la condición, su hilo queda huérfano** —
-- no hay cascada que se lo lleve— y nada en la base lo detecta. No es teórico:
-- la sincronización de las planillas borra las OT y los requerimientos que la
-- planilla dejó de tener (ver `lib/core/borradoDeEspejo.ts`), así que un hilo
-- huérfano es posible; quien lo lea tiene que tolerar un `entidad_id` que ya no
-- existe.
--
-- No es un chat. Quien manda un mensaje y menciona a alguien cree que le avisó,
-- y ese «cree» es lo único que esta feature no puede permitir que sea falso:
-- por eso la mención lleva anotado si el aviso salió (ver más abajo).
-- ============================================================

create table if not exists mensajes (
  id           uuid primary key default gen_random_uuid(),
  -- Los tres tipos que hoy tienen hilo. Un tipo nuevo es un `check` nuevo, a
  -- propósito: que no se pueda pegar un hilo a algo que la ruta no sabe
  -- autorizar, porque el permiso depende del registro y no del mensaje.
  entidad_tipo text not null
               check (entidad_tipo in ('orden_trabajo', 'requerimiento', 'condicion_insegura')),
  entidad_id   uuid not null,
  texto        text not null,
  creado_por   uuid references usuarios(id),
  creado_en    timestamptz not null default now()
);

comment on table mensajes is
  'Hilo de mensajes pegado a un registro (OT, requerimiento, condición insegura). Sin foreign key a entidad_id: apunta a tres tablas según entidad_tipo, y si se borra el registro el hilo queda huérfano. No se edita ni se borra.';

comment on column mensajes.entidad_id is
  'Id del registro al que se pega el hilo; a qué tabla pertenece lo dice entidad_tipo. Sin foreign key a propósito (igual que cargas_offline.entidad_id y auditoria): un hilo huérfano es posible.';

-- La pantalla de un registro lee siempre todo su hilo, del más nuevo al más
-- viejo. El índice es esa consulta.
create index if not exists mensajes_entidad_idx
  on mensajes (entidad_tipo, entidad_id, creado_en desc);

-- Una persona mencionada en un mensaje. La primaria es el par, así que
-- mencionar dos veces a la misma persona en el mismo mensaje es una sola
-- mención y no dos correos.
create table if not exists mensajes_menciones (
  mensaje_id  uuid not null references mensajes(id) on delete cascade,
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  leido_en    timestamptz,
  -- Las dos columnas siguientes existen por una sola razón: el correo al
  -- mencionado se manda en un `after()` de Next.js, o sea **después** de que la
  -- respuesta HTTP ya salió, así que esa respuesta no puede decir si el correo
  -- llegó. Se anota acá, en la fila de la mención, y la pantalla lo lee al
  -- releer el hilo. Sin esto, quien escribe no tiene forma de saber que su
  -- aviso falló y sigue creyendo que le avisó al otro —que es exactamente lo
  -- que esta feature no puede permitir—, y un fallo que se guarda en un log no
  -- se le muestra a nadie.
  --   avisado_en  : cuándo salió el correo. Null = todavía no salió o no salió.
  --   aviso_fallo : lo que dijo el servicio de correo, **sin traducir**. Null =
  --                 no falló (o no se intentó todavía). Con valor y avisado_en
  --                 en null, el aviso falló y la pantalla tiene que decirlo.
  avisado_en  timestamptz,
  aviso_fallo text,
  primary key (mensaje_id, usuario_id)
);

comment on table mensajes_menciones is
  'Quién fue mencionado en un mensaje, si lo leyó y si el correo de aviso salió. Una mención por persona y mensaje.';

comment on column mensajes_menciones.avisado_en is
  'Cuándo salió el correo de aviso. El correo se manda en un after() después de responder, así que la respuesta no sabe si llegó: se anota acá y la pantalla lo lee.';

comment on column mensajes_menciones.aviso_fallo is
  'Lo que dijo el servicio de correo cuando el aviso falló, sin traducir. Null si no falló.';

-- La bandeja de cada uno: «lo que me mencionaron y todavía no leí».
create index if not exists mensajes_menciones_bandeja_idx
  on mensajes_menciones (usuario_id, leido_en);

alter table mensajes enable row level security;
alter table mensajes_menciones enable row level security;

-- ---------- mensajes ----------
--
-- La lectura es para cualquier autenticado y nada más, y **no es un olvido**:
-- quien decide si alguien puede ver un hilo es la ruta, porque el permiso
-- depende del registro al que apunta —una OT la ve quien ve Mantenimiento, un
-- requerimiento quien ve Compras— y eso RLS no lo sabe: `entidad_id` no tiene
-- foreign key, así que no hay a qué tabla mirar desde la policy. Las rutas leen
-- con el cliente que corresponda y aplican el permiso del módulo antes.
-- Las llamadas a función van envueltas en un `select`: pelada, Postgres evalúa
-- el `USING` una vez por fila (ver 20261014090512).
drop policy if exists mensajes_leer on mensajes;
create policy mensajes_leer on mensajes
  for select to authenticated using (true);

-- Escribir, sólo a nombre propio: nadie manda un mensaje firmado por otro.
drop policy if exists mensajes_insertar on mensajes;
create policy mensajes_insertar on mensajes
  for insert to authenticated with check (creado_por = (select auth.uid()));

-- **No hay policy de update ni de delete**, y es la decisión. Un mensaje con
-- menciones ya mandó un correo, y un correo no se desmanda: borrar el mensaje
-- deja a la otra persona con un texto que en el sistema no existe, y editarlo
-- hace que el correo y el hilo digan cosas distintas. Un error se corrige con
-- otro mensaje, que deja la corrección a la vista.
--
-- Esto **no copia a `ordenes_trabajo_notas`**, que al lado sí deja borrar la
-- propia nota: allí la nota es una justificación que nadie recibió por correo,
-- y borrarla no deja a nadie con un texto que ya no está. Acá sí.

-- ---------- mensajes_menciones ----------
-- Leer: igual que arriba, la ruta decide quién ve qué hilo.
drop policy if exists mensajes_menciones_leer on mensajes_menciones;
create policy mensajes_menciones_leer on mensajes_menciones
  for select to authenticated using (true);

-- Insertar una mención: sólo sobre un mensaje propio. Depende de la fila
-- (`mensaje_id`), así que esta subconsulta **no se envuelve**: es el caso
-- inverso al de las funciones sin argumentos.
drop policy if exists mensajes_menciones_insertar on mensajes_menciones;
create policy mensajes_menciones_insertar on mensajes_menciones
  for insert to authenticated
  with check (exists (
    select 1 from mensajes m
     where m.id = mensaje_id and m.creado_por = (select auth.uid())
  ));

-- Marcar como leído es de cada uno: el update es sólo de la propia fila. Pero
-- **RLS no sabe limitar una columna sola** —es la trampa por la que el valor
-- hora se mudó de `empleados` a `rrhh_empleados_datos`—, así que esta policy
-- acota *qué fila* se puede tocar y no *qué campo*: quien tenga la fila propia
-- podría, con un update directo, reescribir también `avisado_en` y
-- `aviso_fallo`. Quien acota el campo es la ruta, que sólo escribe `leido_en`;
-- los otros dos los escribe el proceso que manda el correo.
drop policy if exists mensajes_menciones_marcar_leido on mensajes_menciones;
create policy mensajes_menciones_marcar_leido on mensajes_menciones
  for update to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

-- Sin delete: la mención cae con su mensaje (`on delete cascade`) y, como el
-- mensaje no se borra, no se borra ninguna.

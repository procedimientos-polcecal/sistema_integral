-- ============================================================
-- SdG — Mantenimiento: preguntarle a Compras por un repuesto
--
-- Una OT queda parada porque falta una pieza. Quien la tiene que hacer la anota
-- en «Repuestos que hacen falta» y ahí se termina: no tiene dónde preguntar qué
-- pasa con ese pedido, y Compras no tiene dónde contestar. Lo que falta no es el
-- aviso sino la vuelta —quien abre esa OT dos semanas después tiene que poder
-- saber si alguien lo gestionó—. El diseño está en
-- docs/superpowers/specs/2026-10-26-mantenimiento-preguntar-a-compras-design.md;
-- esta migración es sólo el esquema.
--
-- **La conversación vive en `ordenes_trabajo_notas` y no en una tabla propia.**
-- Esa tabla ya es el historial de la OT —«por qué todavía no se hizo», una
-- entrada por vez, que no se edita— y hay dos cosas que dependen de que siga
-- siendo la única línea de tiempo: el cartel «Sin justificar» del listado, que
-- cuenta cualquier fila de la tabla como una justificación
-- (`api/mantenimiento/ordenes/justificadas`), y la columna X de la planilla, a la
-- que va la última (`celdaDeObservacionPrevia`). Una pregunta ES una razón válida
-- de por qué la OT sigue abierta —«preguntamos a Compras y esperamos»—, así que
-- en la misma tabla las dos cosas andan solas. En una tabla aparte habría que
-- enseñarle a cada una a leer dos fuentes, o aceptar un segundo lugar donde la
-- gente escribe sobre la misma OT, que es la clase de divergencia que este repo
-- paga caro.
--
-- Por eso son tres columnas y no una tabla:
--
--   tipo         JUSTIFICACION, PREGUNTA o RESPUESTA. El default es lo que deja
--                como estaban las filas que ya existen: hasta hoy sólo se podía
--                escribir una justificación, así que todas lo son.
--
--   repuesto_id  de qué repuesto de la OT se pregunta. Una OT puede estar
--                esperando dos piezas de dos pedidos distintos y la pregunta
--                tiene que decir cuál. `on delete set null` y **no cascade**:
--                sacar un repuesto de la lista no puede llevarse la conversación
--                que hubo sobre él. Una PREGUNTA con `repuesto_id` en null es
--                una a cuyo repuesto sacaron de la lista, y por eso ya no está
--                abierta.
--
--   responde_a   a qué nota se refiere ésta, y no siempre es una respuesta: lleva
--                tres casos. La RESPUESTA de Compras, que apunta a su PREGUNTA;
--                una PREGUNTA de seguimiento («sigue sin llegar»), que apunta a
--                la que está abierta y la supera; y el «ya llegó» de quien
--                preguntó, que es una RESPUESTA suya. Por eso
--                `responde_a is not null` no quiere decir «tiene respuesta»:
--                eso lo dice el tipo.
--
-- **`responde_a` no borra en cascada, y el límite está en la base.** La ruta de
-- notas deja borrar la nota propia (filtra por `creado_por`). Con `on delete
-- cascade`, quien preguntó podría borrar su pregunta y llevarse puesta la
-- respuesta que escribió Compras, y la ruta, además, reescribiría la columna X
-- sin ella. Sin cascade, la base se niega: una nota a la que otra apunta no se
-- puede borrar (`23503`). Va acá y no en cada ruta para que ninguna se lo pueda
-- olvidar. Borrar la OT entera sigue andando: las notas se van todas juntas por
-- `orden_id`. Lo que queda a cargo de la ruta que escribe es que `responde_a`
-- apunte a una nota de la misma OT: una que apuntara a otra haría fallar el
-- borrado de esa otra OT.
--
-- **No hay columna «cerrada».** Si una pregunta sigue abierta se deriva de lo
-- que ya está en las filas —por ejemplo, si una RESPUESTA la apunta, si otra
-- PREGUNTA del hilo la superó, si la OT ya no espera nada o si sacaron el
-- repuesto de la lista—, y esa regla está escrita en TypeScript, con tests, en
-- un solo lugar: `lib/mantenimiento/consultaDeRepuesto.ts`. Una marca guardada
-- sería un segundo dato para algo que ya está dicho en otro lado, y además no
-- habría cómo cambiarla: esta tabla no tiene policy de update y es a propósito
-- —un historial que se puede reescribir no es un historial—. Una pregunta
-- cerrada no desaparece: sigue en el historial de la OT, y lo único que cambia
-- es que deja de contarse como abierta.
--
-- **Las policies de `ordenes_trabajo_notas` no se tocan.** Todas las escrituras
-- entran por rutas que usan el cliente admin y comprueban el permiso ellas
-- mismas, y la que use Compras para contestar tiene que hacer lo mismo: quien
-- contesta no tiene nivel de edición en Mantenimiento, y dárselo para esto sería
-- abrirle la carga de órdenes. Y sigue sin haber policy de update, porque este
-- diseño no actualiza ninguna nota.
--
-- **La lista de a quién se le pregunta es propia: `compras_consultados`.** No se
-- reusa `compras_aprobadores`. Medido el 26/10/2026, al acordar el diseño: Facundo
-- Ortiz, el encargado de compras, ya está en esa lista, pero tiene cuatro
-- personas —él, Maximiliano Lenzetti, Nicolás Lenzetti y Bernardo Strupp— y
-- mandar ahí la pregunta interrumpiría a tres que no son quien contesta. El repo
-- ya pagó este error por el otro lado, con número: `compras-por-aprobar` va a
-- `compras_aprobadores` y no a todo el que ve Compras porque, medido, le llegaba
-- a 6 personas y 3 no podían aprobar. Es una lista y no una persona fija porque
-- una licencia se arregla agregando a alguien desde Compras → Configuración, no
-- editando código.
--
-- Copia la forma de `compras_aprobadores` y de `os_aprobadores`, incluida la
-- regla de quién la administra: son listas contiguas en la misma pantalla, y que
-- se editen con reglas distintas es de las cosas que nadie descubre hasta que a
-- alguien le falta un botón. Ojo con una consecuencia: quien contesta, con nivel
-- de edición en Compras, **no** puede administrar la lista; la administra un admin
-- de Compras o del sistema. No es una tabla puente —tiene una sola clave foránea,
-- a `usuarios`—, así que no abre un segundo camino para PostgREST.
--
-- **Lo que se probó**, el 29/10/2026: este archivo, tal cual, contra un Postgres
-- 15 limpio y PostgREST 12.2.8 adelante. `ordenes_trabajo_notas` era la que dejó
-- la migración del 16/10; las otras tablas (`usuarios`, `usuario_modulos`,
-- `ordenes_trabajo`, `ordenes_trabajo_repuestos`) se reconstruyeron a partir del
-- catálogo del Asistente, con sus `on delete` supuestos y no leídos de la base.
--
--   - Dos corridas seguidas, cada una en una transacción como la corre el editor
--     de Supabase: la segunda no cambia nada. Eso incluye el `check` y los
--     `references` escritos en la misma línea que `add column if not exists`,
--     que Postgres saltea junto con la columna.
--
--   - `ordenes_trabajo_notas` pasa de dos claves foráneas a cuatro, y el README
--     de migraciones advierte que una tabla puente rompe embeds que andaban. No
--     rompe ninguno: ni `autor:usuarios(nombre)`, de las rutas de notas, ni los
--     embeds entre OT y repuestos. PostgREST toma como puente a una tabla cuya
--     clave primaria ES el par de claves foráneas —así era
--     `compras_odoo_ordenes`, y por eso dio `PGRST201`—; ésta tiene `id` propio,
--     y ni siquiera un `unique` sobre el par la convierte en puente. Es lo
--     medido con esa versión: si Supabase corriera otra y apareciera un
--     `PGRST201` en esas pantallas, se arregla nombrando la FK
--     (`usuarios!creado_por`), no sacando la columna.
--
--   - Que `set null` conserva la pregunta; que una nota a la que otra apunta no
--     se puede borrar y la OT entera sí, con una pregunta, su respuesta y un
--     seguimiento adentro; y las policies de `compras_consultados` con cinco
--     sesiones: la escriben el admin del sistema y el admin de Compras; no quien
--     sólo edita Mantenimiento, ni quien sólo edita Compras, ni quien no tiene
--     sesión.
-- ============================================================

-- ── Las tres columnas ────────────────────────────────────────

alter table ordenes_trabajo_notas
  add column if not exists tipo text not null default 'JUSTIFICACION'
    check (tipo in ('JUSTIFICACION', 'PREGUNTA', 'RESPUESTA')),
  add column if not exists repuesto_id uuid
    references ordenes_trabajo_repuestos(id) on delete set null,
  -- Sin `on delete`, a propósito: ver el encabezado.
  add column if not exists responde_a uuid
    references ordenes_trabajo_notas(id);

comment on table ordenes_trabajo_notas is
  'El historial de una orden de trabajo: por qué todavía no se hizo, y lo que Mantenimiento le preguntó a Compras por un repuesto y lo que Compras contestó. Cada entrada queda, no se edita. A la columna X de la planilla va la última, sea del tipo que sea.';

comment on column ordenes_trabajo_notas.tipo is
  'JUSTIFICACION (por qué la OT sigue abierta), PREGUNTA (de Mantenimiento a Compras por un repuesto) o RESPUESTA (a una PREGUNTA: la de Compras, o el «ya llegó» de quien preguntó). Las tres cuentan como justificación. Si una PREGUNTA sigue abierta no se guarda: se deriva.';

comment on column ordenes_trabajo_notas.repuesto_id is
  'De qué repuesto de la OT es la PREGUNTA. Una PREGUNTA con repuesto_id en null es una a cuyo repuesto sacaron de la lista: la conversación queda, sólo se suelta del repuesto, y por eso ya no está abierta.';

comment on column ordenes_trabajo_notas.responde_a is
  'A qué nota se refiere ésta. Lleva tres casos: la RESPUESTA de Compras a su PREGUNTA, una PREGUNTA de seguimiento («sigue sin llegar») que apunta a la que está abierta y la supera, y el «ya llegó» de quien preguntó, que es una RESPUESTA suya. Por eso responde_a no nulo NO quiere decir «tiene respuesta»: eso lo dice el tipo. No borra en cascada: una nota a la que otra apunta no se puede borrar, así quien borra su pregunta no se lleva puesta la respuesta de otro.';

-- ── A quién se le pregunta ───────────────────────────────────

create table if not exists compras_consultados (
  usuario_id uuid primary key references usuarios(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table compras_consultados is
  'A quién se le avisa al instante cuando Mantenimiento pregunta por un repuesto. Pertenecer a la lista ES el destino del aviso: a propósito no es compras_aprobadores, que decide el gasto y es otra gente.';

alter table compras_consultados enable row level security;

-- Leerla puede cualquier autenticado, como `compras_aprobadores`: la pantalla de
-- configuración necesita mostrarla.
drop policy if exists compras_consultados_select on compras_consultados;
create policy compras_consultados_select on compras_consultados
  for select to authenticated using (true);

-- Escribirla, quien administra Compras: el administrador del sistema o quien
-- tiene nivel `admin` en el módulo. Es la misma condición de `compras_aprobadores`
-- (migración 028) y de `compras_ajustes` (20261019094903), con las llamadas
-- envueltas en un `select` —así Postgres las evalúa una vez y no por fila— y las
-- columnas calificadas con el nombre de la tabla, sólo por claridad: `usuario_id`
-- está en las dos tablas y, sin calificar, también resolvería a `usuario_modulos`.
drop policy if exists compras_consultados_write on compras_consultados;
create policy compras_consultados_write on compras_consultados
  for all to authenticated
  using (
    (select es_admin())
    or exists (
      select 1 from usuario_modulos
      where usuario_modulos.usuario_id = (select auth.uid())
        and usuario_modulos.modulo = 'compras'
        and usuario_modulos.nivel = 'admin'
    )
  )
  with check (
    (select es_admin())
    or exists (
      select 1 from usuario_modulos
      where usuario_modulos.usuario_id = (select auth.uid())
        and usuario_modulos.modulo = 'compras'
        and usuario_modulos.nivel = 'admin'
    )
  );

-- ============================================================
-- SdG — La suscripción push pasa al núcleo y acepta varios dispositivos
--
-- La tabla nació en Remises (migración 012) para el único uso que había
-- entonces: avisarle a un empleado qué remis tenía asignado al día siguiente.
-- Ahora las notificaciones son de todo el sistema —un resumen diario de lo que
-- cada uno tiene para mirar en sus módulos— así que la tabla deja de ser de un
-- módulo y pasa al núcleo, como `usuarios` o `sectores`.
--
-- EL CAMBIO QUE IMPORTA: LA CLAVE PRIMARIA
--
-- Era `usuario_id` sola, o sea **un dispositivo por persona**. Suscribirse
-- desde la computadora borraba la suscripción del celular y al revés, sin
-- error y sin aviso: la del navegador seguía viva del lado del push service,
-- pero el SdG ya no la tenía, así que esa persona simplemente dejaba de recibir
-- avisos en el aparato donde se había suscrito primero. Pasa a ser
-- `(usuario_id, endpoint)`, que es la identidad real de una suscripción Web
-- Push: el `endpoint` es la URL única que el navegador le da a **esa**
-- instalación. Celular y computadora son dos filas.
--
-- No hay datos que migrar: la tabla tiene **0 filas** (medido el 18/10/2026
-- sobre 13 usuarios activos). El botón para suscribirse vivía escondido dentro
-- de `/mi-remis` y no lo tocó nadie nunca, así que el renombre y el cambio de
-- clave no pueden romperle la suscripción a ninguna persona.
--
-- DOS COSAS QUE PARECEN DE MÁS Y NO LO SON
--
--   1. `(select auth.uid())` y no `auth.uid()` pelado. Postgres evalúa el
--      `USING` **una vez por fila**; el subselect lo convierte en un InitPlan
--      que se evalúa una sola vez. Es la misma regla que el CLAUDE.md documenta
--      para `tiene_acceso_x()`, y que el 14/10/2026 tenía a `calculos_diarios`
--      en timeout. Acá la tabla es chica, pero la regla vale para toda policy
--      nueva: escribirla pelada no rompe nada y no avisa, que es el problema.
--
--   2. El `on delete cascade` se conserva. Si se da de baja un usuario, sus
--      suscripciones se van con él: una suscripción huérfana seguiría recibiendo
--      pushes de una cuenta que ya no existe.
-- ============================================================

alter table remises_push_tokens rename to push_suscripciones;

-- La policy vieja se nombra por la tabla vieja: se rehace, no se renombra,
-- para que el `using` quede con el subselect de arriba.
drop policy if exists remises_push_tokens_own on push_suscripciones;

-- La PK vieja se busca en vez de nombrarse. Renombrar una tabla NO renombra
-- sus restricciones, así que la clave sigue llamándose `remises_push_tokens_pkey`
-- — pero eso es el nombre que Postgres le puso por defecto en 2026, no algo que
-- esté escrito en ninguna parte. Si alguna vez se recreó a mano con otro nombre,
-- un `drop constraint` literal falla y la migración queda a medias. Esto busca
-- la que haya.
do $$
declare
  nombre text;
begin
  select conname into nombre
    from pg_constraint
   where conrelid = 'push_suscripciones'::regclass and contype = 'p';
  if nombre is not null then
    execute format('alter table push_suscripciones drop constraint %I', nombre);
  end if;
end $$;

alter table push_suscripciones
  add constraint push_suscripciones_pkey primary key (usuario_id, endpoint);

-- Cuándo se suscribió ese aparato. Sirve para lo único que se va a querer saber
-- cuando alguien diga "no me llegan": si la suscripción es vieja o de recién.
alter table push_suscripciones
  add column if not exists creado_en timestamptz not null default now();

create policy push_suscripciones_propias on push_suscripciones for all to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

comment on table push_suscripciones is
  'Una fila por aparato suscrito a notificaciones push. La clave es '
  '(usuario_id, endpoint) porque una persona usa el celular y la computadora. '
  'El cron que envía usa service role, no RLS.';

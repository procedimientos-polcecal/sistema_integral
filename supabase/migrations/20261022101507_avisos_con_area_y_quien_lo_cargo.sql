-- ============================================================
-- SdG — Avisos con área y quién lo cargó, y se pueden leer
--
-- POR QUÉ. Cargar un aviso de mantenimiento hoy exige entrar a Mantenimiento
-- con nivel de edición, y casi nadie que detecta una falla lo tiene. Medido
-- el 22/10/2026: de 14 usuarios activos sólo 8 tienen el módulo (4 lectura,
-- 1 edición, 3 admin), y la ruta de alta pide edición, así que **4 de 14**
-- podrían cargar un aviso desde el sistema. De los 184 avisos que hay,
-- **ninguno** se cargó desde la app (`app_created` es falso en los 184): todos
-- entraron por la planilla, desde el Google Forms.
--
-- Se saca el alta del módulo a una pantalla abierta a cualquier usuario
-- (`/mis-avisos`), y esa pantalla filtra **por área**, no por persona: acá los
-- pedidos se hacen por área, como ya decidió `20260904103615` con Compras. Para
-- eso `avisos` necesita dos cosas que no tenía:
--
--   1. `area_id`: de qué área de la empresa es el aviso. Es lo que decide qué
--      avisos ve cada uno en `/mis-avisos`. La regla para resolverla desde el
--      texto libre de la planilla vive en `lib/mantenimiento/areaDelAviso.ts`.
--      El relleno de los 184 históricos NO va acá: es DML y va en un script
--      aparte, para reusar esa función testeada en vez de reimplementar en SQL
--      la normalización de nombres. Medido: las 4 personas que hoy están
--      cargadas en `usuario_areas_compras` explican 165 de los 184 avisos.
--      Las que no se reconocen con certeza quedan en null (ver "enlazar al que
--      se le parece es peor que dejar en null", README de migraciones).
--   2. `creado_por`: quién lo cargó en el sistema. Es la única forma de que
--      alguien vea "mis avisos" aunque su área no esté cargada, y de saber a
--      quién preguntarle por el detalle.
--
-- Y que `avisos` se pueda leer sin tener el módulo.
--
-- ── Esto revierte EN PARTE a la 20260916110349, y es deliberado ──
--
-- Esa migración cerró siete tablas de Mantenimiento porque el asistente de IA
-- hereda lo que dicen las policies y no filtra por su cuenta (una segunda
-- definición de permisos es la que queda vieja). `avisos` ya estaba cerrada
-- desde la 029 con `mant_puede_ver()`. Acá se vuelve a abrir: `using (true)`.
--
-- Consecuencia que conviene tener presente: **el asistente va a poder leer los
-- avisos de cualquiera que le pregunte**. Es el mismo trato que ya tienen
-- `compras_requerimientos` —la 018 los dejó abiertos porque "el circuito de
-- compras es transversal a toda la empresa"— y `equipos`, que la
-- 20260916110349 dejó abierta a propósito. Un aviso es "esto se rompió, vengan
-- a mirar": su gracia es que lo vea quien lo tiene que mirar, y quien lo pidió
-- tiene que poder ver cómo va sin ser de Mantenimiento. Cerrarla de nuevo
-- rompe `/mis-avisos` para todos los que no tienen el módulo, que son los
-- usuarios a los que va dirigida.
--
-- Sólo se abre el SELECT. Las policies de escritura **no se tocan**: la ruta
-- de alta inserta con el cliente admin, así que RLS no es lo que la frena, y
-- abrir la escritura sólo agregaría una puerta que nadie pidió. Tampoco hay
-- función que envolver en el `using` (el `using (true)` no llama a nada), así
-- que la regla del `(select ...)` de las policies no aplica acá.
--
-- ── El FK a `compras_areas` acopla Mantenimiento con Compras ──
--
-- `area_id` referencia `compras_areas`, o sea que una tabla de Mantenimiento
-- depende de una de Compras. Se acepta porque en los hechos esa tabla ya es un
-- catálogo del núcleo: dice "de qué área de la empresa es esto", no "de qué
-- área de Compras". Ya la usan `compras_requerimientos` y
-- `usuario_areas_compras`, y de ahí sale el criterio de "mis avisos". Crear un
-- segundo catálogo de áreas sería duplicar la lista y que se desfasen. Es el
-- mismo caso que `equipos`, que la 20260916110349 documentó como catálogo del
-- núcleo en lugar de mudarlo.
--
-- Mover `compras_areas` al núcleo es un cambio de diseño, y no es parte de
-- esto. Si un día se hace, el FK sigue apuntando a la misma tabla por nombre.
--
-- ── Qué NO cambia ──
--
-- `quien_aviso` sigue existiendo y `creado_por` NO lo reemplaza: `quien_aviso`
-- es texto libre, viaja a la columna G de la planilla de Google, y la planilla
-- la sigue llenando gente desde el Google Forms sin pasar por el sistema, así
-- que no tienen cuenta de usuario a la que apuntar. `creado_por` sólo se llena
-- cuando el aviso nace en el SdG.
--
-- ── Después de aplicarla ──
--
-- `avisos` es una tabla que el Asistente conoce: sus columnas nuevas no las ve
-- hasta que alguien corra `npm run catalogo` (README de migraciones, última
-- trampa). Y el relleno de `area_id` es el script de la tarea siguiente: hasta
-- que corra, los 184 históricos tienen `area_id` en null.
--
-- Se puede correr dos veces: `drop policy if exists`, `add column if not
-- exists`, `create index if not exists`.
-- ============================================================

drop policy if exists avisos_read on avisos;
create policy avisos_read on avisos
  for select to authenticated using (true);

alter table public.avisos
  add column if not exists area_id    uuid references compras_areas(id),
  add column if not exists creado_por uuid references usuarios(id);

create index if not exists avisos_area_idx on public.avisos (area_id);

comment on column public.avisos.area_id is
  'De qué área de la empresa es el aviso. Decide qué avisos ve cada uno en /mis-avisos. Referencia compras_areas porque en los hechos es un catálogo del núcleo. En null cuando no se pudo reconocer con certeza el área de un aviso que vino de la planilla.';

comment on column public.avisos.creado_por is
  'Quién cargó el aviso en el sistema. Es null en los que entraron por la planilla o el Google Forms. NO reemplaza a quien_aviso: ése sigue existiendo porque viaja a la columna G de la planilla y porque la planilla la sigue llenando gente que no tiene usuario.';

notify pgrst, 'reload schema';

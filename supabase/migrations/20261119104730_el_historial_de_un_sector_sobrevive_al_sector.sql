-- ============================================================
-- SdG — El historial de un sector sobrevive al sector
--
-- POR QUÉ
--
-- `sectores_status_log` es el único lugar donde queda escrito que alguien paró
-- una planta: quién, cuándo, de qué estado a cuál y por qué. La 004 la colgó
-- del sector con `on delete cascade`, y con eso **borrar un sector borra su
-- historia**.
--
-- No es hipotético: este catálogo se limpia. La 20260904112044 unificó
-- sectores organizativos duplicados y la 20261021085411 sacó «Despacho Cal».
-- Esa última lo dejó escrito — relevó lo que colgaba antes de borrar y
-- `sectores_status_log` estaba **en cero**, así que no se perdió nada. Es la
-- misma frase que la 20261018160209 escribió sobre los avisos: la cascada «no
-- costaba nada» mientras la tabla estuviera vacía. Dos días atrás, el
-- 17/11/2026, hubo que darla vuelta porque ya costaba 221 filas.
--
-- Acá todavía no cuesta —medido el 19/11/2026: **3 filas**, las tres de
-- sectores vivos, la más vieja del 12/11—, y por eso es el momento de
-- cambiarlo: dentro de un año la tabla va a tener la historia de cada parada
-- de planta y el próximo que unifique un sector se la va a llevar sin
-- enterarse. Una parada de planta es un hecho que pasó; que el sector después
-- se renombre, se unifique o se dé de baja no lo deshace.
--
-- QUÉ CAMBIA
--
-- 1. `sector_id` pasa a aceptar null y su FK de `on delete cascade` a
--    `on delete set null`. Si el sector se va, la fila queda.
--
-- 2. Columna nueva `sector_nombre text not null`, que es **cómo se llamaba el
--    sector cuando se hizo el cambio**. Sin ella `set null` dejaría una fila
--    que dice «alguien paró algo» y no qué, que es peor que no tenerla.
--
-- POR QUÉ LA LLENA UN TRIGGER Y NO LA APLICACIÓN
--
-- Es al revés que `auditar()`, y la diferencia vale escribirla. Ahí lo que la
-- aplicación decide es **si la acción merece registrarse**, que es un juicio y
-- por eso no puede vivir en un trigger. Acá no hay ningún juicio: el nombre
-- del sector es una copia mecánica de una fila que la base ya tiene a mano.
--
-- Y hay una razón concreta: en este repo **la migración la corre una persona a
-- mano y el despliegue es automático**, así que entre que el código sale y
-- alguien abre el editor SQL hay una ventana. Si la ruta nombrara
-- `sector_nombre` en su `insert`, en esa ventana cambiar el estado de un sector
-- fallaría con un 42703 y la pantalla diría que no se pudo guardar. Con el
-- trigger, `app/api/mantenimiento/sectores/status/route.ts` no se toca: sigue
-- insertando las cinco columnas de siempre y la sexta se llena sola. Tampoco
-- se le puede olvidar a quien escriba el segundo escritor, que hoy no existe.
--
-- `coalesce` y no asignación directa: si alguien algún día inserta el nombre
-- explícitamente —una importación, un repunte—, el trigger no se lo pisa.
--
-- LO QUE ESTO SÍ ROMPE, Y ES A PROPÓSITO
--
-- El tablero (`app/(app)/mantenimiento/page.tsx`) lee las últimas 20 con
-- `sector:sector_id!inner(nombre, es_de_planta, ...)` y filtra por
-- `es_de_planta`. Una fila huérfana —sector borrado— **no entra** en esa
-- lista, porque el `!inner` la saca y porque de un sector que ya no está no se
-- puede saber si era de planta. Eso queda así: esa lista es «los últimos
-- movimientos de las plantas», no el archivo. El archivo completo es
-- `/mantenimiento/sectores/historial`, que no usa `!inner` y las muestra.
--
-- La FK **no se borra**, sólo cambia su acción. Si se borrara, PostgREST
-- perdería la relación y el embebido de arriba contestaría 300 PGRST200: el
-- tablero dejaría de cargar. Es la misma trampa que el autor embebido de
-- `mensajes`.
-- ============================================================

alter table public.sectores_status_log
  alter column sector_id drop not null;

alter table public.sectores_status_log
  drop constraint sectores_status_log_sector_id_fkey;

alter table public.sectores_status_log
  add constraint sectores_status_log_sector_id_fkey
  foreign key (sector_id) references public.sectores(id) on delete set null;

alter table public.sectores_status_log
  add column if not exists sector_nombre text;

-- El relleno. Hoy son 3 filas y las tres tienen su sector vivo, así que
-- ninguna queda sin nombre y el `set not null` de abajo entra limpio. El
-- `coalesce` es por si alguna vez se corre sobre una base donde no sea así:
-- mejor una fila que diga «(sector desconocido)» que una migración que no
-- termina.
update public.sectores_status_log l
   set sector_nombre = coalesce(s.nombre, '(sector desconocido)')
  from public.sectores s
 where s.id = l.sector_id
   and l.sector_nombre is null;

update public.sectores_status_log
   set sector_nombre = '(sector desconocido)'
 where sector_nombre is null;

alter table public.sectores_status_log
  alter column sector_nombre set not null;

create or replace function public.sectores_status_log_nombre()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.sector_nombre := coalesce(
    new.sector_nombre,
    (select nombre from public.sectores where id = new.sector_id),
    '(sector desconocido)'
  );
  return new;
end;
$$;

-- Sólo en el INSERT. En un UPDATE no tiene nada que hacer: el nombre guardado
-- es el del día del cambio y volver a resolverlo contra `sectores` lo
-- reescribiría con el nombre de hoy, que es justamente lo que esta columna
-- existe para no perder.
drop trigger if exists sectores_status_log_nombre_trg on public.sectores_status_log;
create trigger sectores_status_log_nombre_trg
  before insert on public.sectores_status_log
  for each row execute function public.sectores_status_log_nombre();

comment on column public.sectores_status_log.sector_nombre is
  'Cómo se llamaba el sector cuando se hizo el cambio. La llena un trigger en el insert. Es lo que queda cuando el sector se borra y sector_id pasa a null.';

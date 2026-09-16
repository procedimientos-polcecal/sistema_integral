-- ============================================================
-- SdG — Asistente: el prólogo de la consulta
--
-- Corrige `asistente_consulta` de la 20260916090639. Dos cosas que se
-- midieron contra la base y estaban mal:
--
-- 1. `btrim(consulta)` con un solo argumento recorta **sólo espacios**, no
--    saltos de línea ni tabs. Una consulta que empieza con `\n` —que es
--    exactamente lo que escribe un modelo cuando formatea el SQL en varias
--    líneas— fallaba el `^(select|with)\s` y se rechazaba con un mensaje que
--    no tenía nada que ver. Se hubiera visto en producción como "el asistente
--    a veces dice que sólo puede leer, porque sí".
--
-- 2. La función rechazaba cualquier consulta con un comentario adelante,
--    mientras que su espejo en TypeScript la aceptaba. Dos guardas que
--    deciden distinto sobre la misma consulta son peores que uno solo: el
--    modelo recibe un rechazo que el espejo no supo anticipar, y el mensaje
--    llega desde dos lugares distintos.
--
-- Ahora las dos pelan **el prólogo**: los espacios y los comentarios **del
-- principio**, y nada más. Pelar todos los comentarios sería peor — en el
-- espejo eso causaba un falso permiso, porque un `--` dentro de un literal se
-- comía el resto de la línea, incluido un `; delete` que venía detrás.
--
-- Lo que NO cambia: la función sigue siendo `stable`, que es lo que hace que
-- PostgREST la corra en una transacción de sólo lectura. Esa es la defensa;
-- este chequeo sólo da un mensaje claro y ahorra un viaje.
-- ============================================================

create or replace function public.asistente_consulta(
  consulta text,
  tope integer default 200
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  limpio text := consulta;
  resultado jsonb;
begin
  -- Pelar el prólogo: espacios de cualquier tipo y comentarios del principio.
  loop
    limpio := ltrim(limpio, E' \t\r\n');
    if limpio ~ '^--' then
      limpio := regexp_replace(limpio, '^--[^\n]*(\n|$)', '');
    elsif limpio ~ '^/\*' then
      limpio := regexp_replace(limpio, '^/\*.*?\*/', '');
    else
      exit;
    end if;
  end loop;

  limpio := btrim(limpio, E' \t\r\n');

  if limpio !~* '^(select|with)\s' then
    raise exception 'El asistente sólo puede leer: la consulta tiene que empezar con SELECT o WITH.';
  end if;

  -- Un punto y coma final es normal; uno en el medio son dos sentencias.
  if position(';' in rtrim(limpio, E' \t\r\n;')) > 0 then
    raise exception 'Una consulta por vez: sacá el punto y coma del medio.';
  end if;

  if tope < 1 or tope > 1000 then
    raise exception 'El tope de filas va entre 1 y 1000.';
  end if;

  execute format(
    'select coalesce(jsonb_agg(f), ''[]''::jsonb) from (select * from (%s) sub limit %s) f',
    limpio, tope
  ) into resultado;

  return resultado;
end $$;

notify pgrst, 'reload schema';

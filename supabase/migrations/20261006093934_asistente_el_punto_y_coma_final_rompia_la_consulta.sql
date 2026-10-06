-- El punto y coma final rompía la consulta del asistente.
--
-- QUÉ PASÓ (06/10/2026)
--
-- El asistente falló dos veces seguidas en producción con
-- `42601 syntax error at or near ";"`, y el síntoma engañaba: parecía que el
-- modelo escribía mal el SQL. No era eso.
--
-- Esta función **envuelve** la consulta para poder paginarla:
--
--     select * from (%s) sub limit %s
--
-- Un `;` adentro de ese paréntesis cierra la sentencia donde no va. Y el `;`
-- final se acepta a propósito unas líneas más arriba —es lo que cualquiera
-- escribe, y lo que un modelo escribe casi siempre— pero nunca se quitaba.
--
-- Medido contra esta misma base antes de escribir el arreglo:
--
--     select 1 as n     ->  [{"n": 1}]
--     select 1 as n;    ->  42601
--
-- O sea que no dependía del modelo: cualquiera que terminara el SQL en `;`
-- —que es lo idiomático— se comía el error. El asistente se había probado con
-- consultas escritas a mano, que es como no apareció antes.
--
-- EL ARREGLO
--
-- Una línea: `rtrim` del `;` final, después del chequeo del `;` del medio y
-- antes de interpolar. El orden importa — si se recortara antes, `select 1;;`
-- y `select 1; delete from empresas` empezarían a parecerse.
--
-- **Sólo recorta del final.** Un `;` en el medio ya lo rechazó el chequeo de
-- arriba, y uno que vive adentro de un literal no se toca: distinguirlo pediría
-- un parser de SQL, y cortar ahí cambiaría en silencio lo que se consulta, que
-- es peor que el error que esto arregla.
--
-- El espejo en TypeScript es `sinPuntoYComaFinal()` de
-- `lib/asistente/validarConsulta.ts`, con sus tests. Si cambia uno, cambia el
-- otro: dos guardas que deciden distinto sobre la misma consulta son peores que
-- una sola.
--
-- El resto del cuerpo va igual que en `20260916093012`: se reescribe entero
-- porque `create or replace` no sabe parchear una línea.

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

  -- Y acá se lo saca, que es lo que faltaba: abajo la consulta entra adentro
  -- de un paréntesis, y ahí un `;` es un error de sintaxis.
  limpio := rtrim(limpio, E' \t\r\n;');

  if tope < 1 or tope > 1000 then
    raise exception 'El tope de filas va entre 1 y 1000.';
  end if;

  execute format(
    'select coalesce(jsonb_agg(f), ''[]''::jsonb) from (select * from (%s) sub limit %s) f',
    limpio, tope
  ) into resultado;

  return resultado;
end $$;

comment on function public.asistente_consulta(text, integer) is
  'Lectura del asistente de IA. security invoker + stable: corre como el '
  'usuario con RLS, y por GET queda en transacción de sólo lectura. '
  'Saca el punto y coma final: la consulta se envuelve en un paréntesis.';

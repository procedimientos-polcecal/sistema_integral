-- ============================================================
-- SdG — RLS: las tres de Mantenimiento que quedaron afuera
--
-- Corrige a `20261014090512`, que **no se edita porque ya se aplicó** (es la
-- regla del README: una migración corrida se arregla con otra, porque editarla
-- deja al archivo diciendo algo distinto de lo que hay en la base).
--
-- QUÉ PASÓ. Aquella migración envolvió 187 policies y dejó **22 sin tocar**,
-- todas de Mantenimiento: las que llaman a `mant_puede_ver()` y a
-- `mant_puede_editar()`. Esas 22 tablas siguen pagando la evaluación por fila
-- que el resto del sistema dejó de pagar.
--
-- POR QUÉ SE ESCAPARON. La lista de funciones salía de un filtro con
-- `pronargs = 0`, y estas tres no tienen cero argumentos:
--
--     mant_puede_ver(uid uuid DEFAULT auth.uid())
--     mant_puede_editar(uid uuid DEFAULT auth.uid())
--     mant_es_admin(uid uuid DEFAULT auth.uid())
--
-- Tienen **uno, con valor por defecto**, así que en las policies se las llama
-- con paréntesis vacíos y *parecen* de cero argumentos — pero el catálogo dice
-- `pronargs = 1` y el filtro las dejó pasar de largo.
--
-- Y EL SIMULADOR NO LO VIO, que es la parte que vale la pena anotar:
-- `scripts/simular-rls.mjs` armaba la lista de funciones con **la misma
-- consulta**, así que tenía el mismo punto ciego. Validó que la transformación
-- estuviera bien y no que el conjunto de entrada estuviera completo. Ya está
-- corregido ahí también.
--
-- POR QUÉ ES SEGURO ENVOLVERLAS. Porque el valor por defecto es `auth.uid()`,
-- que no depende de la fila. Un default se evalúa en el contexto de la función
-- y **no puede referirse a una columna de la consulta que la llama**, así que
-- una llamada con paréntesis vacíos siempre es row-independent, tenga o no
-- argumentos declarados.
--
-- EL FILTRO NUEVO SACA `pronargs` DE LA CONDICIÓN y se queda con lo que de
-- verdad importa: booleana, del esquema `public`, y **llamada con paréntesis
-- vacíos**. Eso sigue dejando intactas a las tres que reciben una columna de
-- verdad —`es_mi_asiento(empleado_id)`, `es_mi_hoja_ruta(hoja_ruta_id)` y
-- `puede_aprobar_esta_compra(...)`, que no tienen default y nunca se pueden
-- llamar con `()`— porque el patrón exige los paréntesis vacíos.
--
-- REESCRIBE 225 Y NO 22, Y CONVIENE SABERLO ANTES DE CORRERLA. Las 22 de
-- Mantenimiento son las que **cambian de significado**; las otras 203 ya están
-- bien y se vuelven a crear igual. Pasa porque el bloque desenvuelve y después
-- envuelve —que es lo que lo hace repetible— y la forma que escribe
-- (`(select fn())`) no es carácter por carácter la que Postgres guarda
-- (`( SELECT fn() AS fn)`), así que las detecta como distintas.
--
-- No hace daño: es la misma transacción, el mismo significado y el mismo plan.
-- Y tiene una ventaja: esta migración **se basta sola**. Corrida en una base
-- donde `20261014090512` nunca se aplicó, hace el trabajo de las dos.
--
-- Repetible: correrla dos veces deja exactamente lo mismo.
-- ============================================================

do $$
declare
  envolver  boolean := true;   -- `false` deja todo como estaba antes
  p         record;
  fn        text;
  q         text;
  w         text;
  sentencia text;
  tocadas   int := 0;
begin
  for p in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
     order by tablename, policyname
  loop
    q := p.qual;
    w := p.with_check;

    for fn in
      -- La diferencia con la anterior: **no se filtra por `pronargs`**. Lo que
      -- decide si se envuelve es que la llamada tenga los paréntesis vacíos,
      -- no cuántos argumentos declare la función.
      select pr.proname
        from pg_proc pr
        join pg_namespace n on n.oid = pr.pronamespace
       where n.nspname = 'public'
         and pr.prorettype = 'boolean'::regtype
         and pr.provolatile in ('s', 'i')   -- STABLE o IMMUTABLE: una VOLATILE no se puede evaluar una sola vez
      union all select 'auth.uid'
    loop
      q := regexp_replace(q, '\( *SELECT +' || replace(fn, '.', '\.') || '\(\)( +AS +[a-zA-Z_]+)? *\)',
                          fn || '()', 'gi');
      w := regexp_replace(w, '\( *SELECT +' || replace(fn, '.', '\.') || '\(\)( +AS +[a-zA-Z_]+)? *\)',
                          fn || '()', 'gi');

      if envolver then
        q := regexp_replace(q, '\m' || replace(fn, '.', '\.') || '\(\)',
                            '(select ' || fn || '())', 'g');
        w := regexp_replace(w, '\m' || replace(fn, '.', '\.') || '\(\)',
                            '(select ' || fn || '())', 'g');
      end if;
    end loop;

    continue when q is not distinct from p.qual and w is not distinct from p.with_check;

    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);

    sentencia := format(
      'create policy %I on %I.%I as %s for %s to %s',
      p.policyname, p.schemaname, p.tablename,
      case when p.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      p.cmd,
      (select string_agg(quote_ident(r), ', ') from unnest(p.roles) as r)
    );
    if q is not null then sentencia := sentencia || format(' using (%s)', q); end if;
    if w is not null then sentencia := sentencia || format(' with check (%s)', w); end if;

    execute sentencia;
    tocadas := tocadas + 1;
  end loop;

  -- 225 es lo esperado, no 22: ver el encabezado. Las 22 de Mantenimiento son
  -- las que cambian de significado; el resto se vuelve a crear igual.
  raise notice 'Policies reescritas: % (se esperan 225; las que cambian de verdad son 22)', tocadas;
end $$;

-- ── Para comprobarlo ─────────────────────────────────────────
--
--   select count(*) from pg_policies
--    where schemaname = 'public'
--      and qual ~ '(^|[^.a-zA-Z_])(tiene_acceso|puede_|es_admin|mant_puede|mant_es)[a-z_]*\(\)'
--      and qual !~ 'SELECT +(tiene_acceso|puede_|es_admin|mant_puede|mant_es)';
--   -- tiene que dar 0
--
-- Y la de tiempo, que es la que importa: `node scripts/medir-rls.mjs`.
-- `ordenes_trabajo` es de las 22, así que su número tiene que bajar.

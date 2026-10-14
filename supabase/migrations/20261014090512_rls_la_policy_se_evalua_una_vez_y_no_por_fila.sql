-- ============================================================
-- SdG — RLS: la policy se evalúa una vez, no por fila
--
-- QUÉ ARREGLA. Pedir 50 filas cuesta hoy como leer la tabla entera. Medido el
-- 14/10/2026 contra producción, con la sesión de un usuario real y la misma
-- consulta con y sin RLS:
--
--     tabla                          con RLS   sin RLS   factor
--     cantera_pesadas                6.555 ms    231 ms    x28
--     fichadas                       4.236 ms    212 ms    x20
--     calculos_diarios               (timeout)   218 ms      —
--     taller_vial_estados_diarios    2.136 ms    199 ms    x11
--     inventario_movimientos         1.952 ms    236 ms     x8
--     compras_requerimientos           225 ms    210 ms     x1
--
-- `calculos_diarios` **da timeout** para un usuario logueado: esa pantalla hoy
-- no carga.
--
-- POR QUÉ. La última fila es el control y es la que explica todo:
-- `compras_requerimientos` tiene la policy de SELECT en `true` —decisión
-- explícita de la 018— y por eso no paga nada. Las demás llaman a una función.
--
-- Postgres evalúa el `USING` de una policy **una vez por fila**, aunque la
-- función sea `STABLE`. Y acá cada tabla tiene **dos** policies permisivas que
-- cubren SELECT —una `ALL` y una `SELECT`—, que se combinan con OR, así que son
-- dos llamadas por fila. Cada llamada hace un `exists` sobre `usuario_modulos`
-- más `es_admin_sistema()`, que consulta `usuarios`.
--
-- El costo es **lineal en las filas de la tabla**, y eso se midió, no se
-- dedujo: sobre siete tablas de 1.175 a 8.269 filas da entre 793 y 934
-- microsegundos por fila, parejo. `compras_requerimientos`, con la policy en
-- `true`, da 105 — y eso es casi todo ida y vuelta de red.
--
-- LA SOLUCIÓN. Envolver la llamada en un subselect: `tiene_acceso_rrhh()` pasa
-- a `(select tiene_acceso_rrhh())`. Postgres lo trata como un InitPlan, lo
-- evalúa **una sola vez** por consulta y reusa el resultado para todas las
-- filas. Es la recomendación de Supabase para esto, y no cambia la semántica:
-- las 39 funciones son `STABLE`, no reciben argumentos y no dependen de la
-- fila. Lo mismo vale para `auth.uid()`.
--
-- POR QUÉ UN BLOQUE QUE LAS REESCRIBE Y NO 225 `CREATE POLICY` A MANO.
-- Son 225 policies sobre 121 tablas. Transcribirlas sería la oportunidad de
-- equivocarse 225 veces en algo donde un error no se ve: una policy mal
-- copiada no rompe nada hasta que alguien no ve lo que tiene que ver, o ve lo
-- que no. Acá se lee la definición que ya está, se le cambia **sólo** eso, y se
-- vuelve a crear con el mismo nombre, el mismo comando y los mismos roles.
--
-- QUÉ NO TOCA, Y ESO IMPORTA:
--
-- - Las funciones que **reciben una columna de la fila** —`es_mi_hoja_ruta(
--   hojas_ruta.id)` y `es_mi_asiento(empleado_id)`, adentro de los `EXISTS` de
--   la 013— dependen de la fila y envolverlas estaría mal. El reemplazo exige
--   **paréntesis vacíos**, así que no las alcanza. Las llamadas sin argumentos
--   que están en esas mismas policies sí se optimizan.
-- - Las 24 policies que ya son `true`: no hay nada que envolver.
-- - Los `EXISTS (select 1 from ...)` que miran otra tabla: se dejan como están.
--   Se podrían envolver también, pero ahí el subselect sí correlaciona con la
--   fila en algunos casos y no vale el riesgo por lo que queda después de esto.
--
-- ES REPETIBLE. Primero desenvuelve y después envuelve, así que correrla dos
-- veces deja exactamente lo mismo (trampa #4 del README: acá las migraciones
-- las aplica una persona y no hay tabla de control). El desenvolver contempla
-- que Postgres **le pone un alias** al subselect al guardarlo:
-- `( SELECT tiene_acceso_rrhh() AS tiene_acceso_rrhh)`.
--
-- QUE HACE ANTES DE CORRERLA. `node scripts/simular-rls.mjs` aplica **esta
-- misma transformación** sobre las definiciones que hoy están en la base y las
-- muestra, sin tocar nada. Es lo más cerca que se llega a probarla, porque un
-- agente no puede correr DDL acá. Corre tres controles, y el primero es el que
-- importa: que una función que **recibe una columna** —`es_mi_hoja_ruta(
-- hoja_ruta_id)`— quede intacta. Envolverla sería el único error de este cambio
-- que no es una lentitud sino un agujero de permisos: se evaluaría una sola vez
-- y le mostraría a cada uno los asientos del primero. Al 14/10/2026 los tres
-- pasan sobre las 249 policies: 198 se reescriben, 51 ya son `true`.
--
-- SI ALGO SALE MAL. El editor de Supabase corre el script en una transacción,
-- así que un error en cualquier policy revierte **todas**. Y para volver atrás
-- a mano alcanza con correr el bloque de abajo cambiando `envolver := true` por
-- `false`.
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

    -- Las funciones booleanas del núcleo sin argumentos, más `auth.uid()`.
    -- Se leen del catálogo y no de una lista escrita acá: una lista a mano es
    -- la que se olvida de la función que se agregue el mes que viene.
    for fn in
      select pr.proname
        from pg_proc pr
        join pg_namespace n on n.oid = pr.pronamespace
       where n.nspname = 'public'
         and pr.pronargs = 0
         and pr.prorettype = 'boolean'::regtype
      union all select 'auth.uid'
    loop
      -- 1. Desenvolver lo que ya esté envuelto, para poder repetir la migración.
      --    Postgres guarda el subselect con un alias, de ahí el `( AS ...)?`.
      q := regexp_replace(q, '\( *SELECT +' || replace(fn, '.', '\.') || '\(\)( +AS +[a-zA-Z_]+)? *\)',
                          fn || '()', 'gi');
      w := regexp_replace(w, '\( *SELECT +' || replace(fn, '.', '\.') || '\(\)( +AS +[a-zA-Z_]+)? *\)',
                          fn || '()', 'gi');

      -- 2. Envolver. Los paréntesis vacíos son obligatorios en el patrón: así
      --    `es_mi_hoja_ruta(hojas_ruta.id)` queda intacta, y `es_admin()` no se
      --    confunde con `es_admin_rrhh()`.
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

  raise notice 'Policies reescritas: %', tocadas;
end $$;

-- ── Para comprobarlo después de correrla ─────────────────────
--
-- 1. Ninguna policy debería quedar con una llamada pelada:
--
--      select tablename, policyname, qual
--        from pg_policies
--       where schemaname = 'public'
--         and qual ~ '\mtiene_acceso[a-z_]*\(\)'
--         and qual !~ 'SELECT +tiene_acceso';
--      -- tiene que dar 0 filas
--
-- 2. Y el conteo de las que sí quedaron envueltas:
--
--      select count(*) from pg_policies
--       where schemaname = 'public' and qual ilike '%( SELECT %';
--      -- tiene que dar ~225
--
-- 3. La prueba que importa es de tiempo, no de SQL: entrar a Inventario →
--    Movimientos, o a RRHH → Asistencia. Lo que tardaba segundos tiene que
--    abrir de una. `scripts/medir-rls.mjs` lo mide sin navegador.

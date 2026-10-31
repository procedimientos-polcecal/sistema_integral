-- `syh_fotos_agregar` con las cuatro cláusulas que dice tener.
--
-- QUÉ SE ENCONTRÓ, Y POR QUÉ EXISTE ESTE ARCHIVO
--
-- La policy que hay en producción tiene **dos** de las cuatro cláusulas que
-- declara `20261029111053_syh_schema.sql`. Medido el 31/10/2026 leyendo
-- `pg_policies`, su `with_check` es:
--
--   ((SELECT puede_editar_syh()) AND (EXISTS (SELECT 1 FROM syh_condiciones c
--     WHERE c.id = syh_fotos.condicion_id AND c.fecha_ejecucion IS NULL)))
--
-- Faltan `respaldada_en_drive_el is null` y el chequeo de `subida_por`. Las dos
-- se agregaron editando aquel archivo **después** de que se hubiera aplicado
-- —el razonamiento fue que todavía no se había corrido, y o ya se había corrido
-- o se corrió en el medio—. Una migración aplicada no se edita: se corrige con
-- otra, y ésta es esa otra. **La 20261029111053 no se toca**: dice lo que la
-- policy tiene que decir, y después de aplicar ésta las dos coinciden.
--
-- QUÉ ROMPE QUE FALTEN
--
-- Son justo las dos que `lib/seguridadHigiene/guardarLaFoto.ts` cita por nombre
-- como su defensa, así que el código afirma algo que la base no hace:
--
--   * Sin `respaldada_en_drive_el is null`, un `edicion` con un cliente de
--     Supabase puede insertar la fila con esa fecha ya puesta. El cron de
--     respaldo busca `is null`, así que saltea esa foto **y** el aviso
--     «fotos sin respaldar» tampoco la ve. Es el único camino por el que el
--     respaldo puede fallar en silencio, que es exactamente lo que el módulo
--     existe para evitar: las 52 fotos del Excel se perdieron así.
--   * Sin el chequeo de `subida_por`, una foto se puede firmar a nombre de
--     otro.
--
-- La aplicación no las necesita para funcionar —nunca manda esas columnas— y
-- por eso nada falló ni va a fallar al aplicar esto.
--
-- ES IDEMPOTENTE A PROPÓSITO. Acá las migraciones las aplica una persona a mano
-- y no hay tabla de control: si producción ya coincidiera, esto la deja igual.
-- El `drop ... if exists` + `create` reescribe la definición entera, así que el
-- resultado no depende de cuál de las dos versiones estuviera puesta.
--
-- Lo que NO arregla, y queda anotado: `syh_fotos_gestionar` es `for all` para
-- `es_admin_syh()`, y las policies se suman. Un admin del módulo sigue pudiendo
-- insertar una fila con `respaldada_en_drive_el` puesta por esa otra puerta.
-- Era así desde el día uno y no es lo que este archivo viene a cambiar.

drop policy if exists syh_fotos_agregar on public.syh_fotos;
create policy syh_fotos_agregar on public.syh_fotos
  for insert with check (
    (select puede_editar_syh())
    and respaldada_en_drive_el is null
    and (subida_por is null or subida_por = (select auth.uid()))
    and exists (
      select 1 from public.syh_condiciones c
      where c.id = condicion_id and c.fecha_ejecucion is null
    )
  );

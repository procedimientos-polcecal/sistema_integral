-- La auditoría acepta un noveno verbo: `corregir`.
--
-- POR QUÉ
--
-- Desde hoy las dos puntas que tocan una ausencia —la de RRHH y la nueva de
-- Mantenimiento, por donde el encargado del taller anota la falta de uno de sus
-- nueve— auditan lo que hacen. El borrado ya tenía verbo; la corrección no.
--
-- Y la corrección de una ausencia **pierde lo que había**: no hay historial de
-- `ausencias`, y `calculos_diarios` se recalcula sobre las fechas nuevas, así
-- que los días de los que la ausencia se fue vuelven a verse como si nunca
-- hubiera pasado nada. Cambiarle las fechas o el tipo a una ausencia es, para
-- cualquiera que mire después, indistinguible de que siempre hubiera sido así.
-- Eso es exactamente lo que esta tabla existe para contestar.
--
-- Los ocho de antes son todos actos de una sola dirección —postear, cerrar,
-- aprobar, borrar—. `corregir` es el primero que describe un cambio de un valor
-- a otro, y por eso es el primero que usa de verdad las dos columnas que ya
-- estaban: `valor_anterior` y `valor_nuevo`. Sin las dos, el registro diría que
-- alguien corrigió algo sin decir qué, que no sirve para nada.
--
-- El motivo NO es obligatorio para `corregir`, igual que para los otros seis que
-- no son `denegar` ni `ajustar`: el porqué lo dice el par anterior/nuevo.
--
-- CÓMO
--
-- `accion` es `text` con un check y no un enum, así que esto es un `alter
-- constraint` común y el valor nuevo NO necesita viajar solo en su propio
-- archivo (la trampa #1 del README es para los enums de verdad).
--
-- El check se borra y se vuelve a crear porque Postgres no sabe modificar uno
-- en el lugar. Entre las dos sentencias la tabla queda un instante sin esa
-- validación; es una transacción, así que nadie la ve a medias.
--
-- Hasta que esto corra, **las dos rutas de ausencias no pueden corregir nada**:
-- el registro se escribe antes del cambio y, si no entra, el cambio no se hace.
-- O sea que un `PATCH`/`PUT` de ausencia contesta 500 y no toca la fila. El
-- borrado sigue funcionando, porque `borrar` ya está en el check.

alter table auditoria
  drop constraint if exists auditoria_accion_check;

alter table auditoria
  add constraint auditoria_accion_check
  check (accion in ('postear', 'aprobar', 'denegar', 'cerrar',
                    'ajustar', 'conceder_acceso', 'quitar_acceso',
                    'borrar', 'corregir'));

comment on column auditoria.accion is
  'Los nueve verbos irreversibles. `borrar` lo escriben las sincronizaciones '
  'cuando una fila desaparece de la planilla que espejan —su `contexto` dice '
  'qué planilla y qué trajo esa corrida— y las dos rutas de ausencias cuando '
  'alguien saca una. `corregir` es el único que describe un cambio de un valor '
  'a otro: va siempre con `valor_anterior` y `valor_nuevo`, porque sin los dos '
  'no dice nada.';

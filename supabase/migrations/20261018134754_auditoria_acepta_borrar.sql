-- La auditoría acepta un octavo verbo: `borrar`.
--
-- POR QUÉ
--
-- Desde hoy las cuatro sincronizaciones que espejan una planilla —OT, avisos,
-- órdenes de servicio y los requerimientos de Compras— **borran** la fila que
-- la planilla dejó de tener. Hasta ahora sólo traían y pisaban, así que una
-- fila que alguien sacaba de la planilla seguía viva en el SdG para siempre y
-- el espejo dejaba de ser un espejo sin que nada avisara.
--
-- Un borrado no se deshace, y la regla de esta casa es que lo que no se
-- deshace se audita. Es además el caso que más lo necesita de los ocho: lo
-- dispara un proceso y no una persona, así que sin este registro el día que
-- alguien pregunte dónde fue a parar la OT 1843 no hay dónde mirar. El actor
-- va a ser `sincronizacion` o `cron`, que es justamente la distinción para la
-- que se escribió esa columna.
--
-- El motivo NO es obligatorio para `borrar`, igual que para los otros cinco:
-- el porqué ya lo dice la acción —la planilla no la trajo— y exigir que
-- alguien lo escriba en un proceso automático sería pedirle una frase fija.
-- Lo que sí va en `contexto` es qué planilla y qué corrida.
--
-- CÓMO
--
-- `accion` es `text` con un check y no un enum, así que esto es un `alter
-- constraint` común y no hace falta que el valor viaje solo en su propio
-- archivo (la trampa #1 del README es para los enums de verdad).
--
-- El check se borra y se vuelve a crear porque Postgres no sabe modificar uno
-- en el lugar. Entre las dos sentencias la tabla queda un instante sin esa
-- validación; es una transacción, así que nadie la ve a medias.

alter table auditoria
  drop constraint if exists auditoria_accion_check;

alter table auditoria
  add constraint auditoria_accion_check
  check (accion in ('postear', 'aprobar', 'denegar', 'cerrar',
                    'ajustar', 'conceder_acceso', 'quitar_acceso',
                    'borrar'));

comment on column auditoria.accion is
  'Los ocho verbos irreversibles. `borrar` lo escriben las sincronizaciones '
  'cuando una fila desaparece de la planilla que espejan; su `contexto` dice '
  'qué planilla y qué trajo esa corrida.';

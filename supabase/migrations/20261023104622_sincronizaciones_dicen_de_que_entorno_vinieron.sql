-- ============================================================
-- SdG — Las sincronizaciones dicen de qué entorno vinieron
--
-- `sincronizaciones` es un registro GLOBAL y le escriben varios entornos, pero
-- la fila no dice cuál. Mientras todos coincidan es inofensivo; el día que uno
-- esté mal configurado, su fallo tapa el éxito del que sí funciona — y lo tapa
-- en la pantalla, porque la vista `ultima_sincronizacion` toma la más reciente.
--
-- NO ES HIPOTÉTICO, Y POR ESO SE ESCRIBE ESTO. Desde el 14/10/2026 algo corre
-- todos los días a las 08:21:52 —diez días seguidos, mismo segundo, con
-- milisegundos distintos, así que son diez corridas de verdad— con credenciales
-- de Supabase pero sin las de Google, y deja:
--
--   calidad/carbonilla-planilla  NO  "Falta GOOGLE_SHEETS_STOCK_CARBONILLA_ID…"
--
-- mientras la corrida real de las 08:00 anduvo bien y trajo sus filas. La
-- pantalla de carbonilla viene mostrando ese rojo hace diez días por algo que
-- no pasa. Es exactamente lo que el CLAUDE.md advierte: un fallo esperado que
-- se ve igual que uno real entrena a no mirar ninguno. Lo mismo le pasa a
-- `cantera/acarreo` y a `taller_vial/cargas`, que fallan con
-- "GOOGLE_SERVICE_ACCOUNT_JSON no configurado" en algunas corridas y andan en
-- otras del mismo día.
--
-- Quién llama no se pudo determinar: no es ninguno de los otros cinco proyectos
-- de Vercel del equipo —los cinco revisados uno por uno— ni ninguno de los
-- workflows de este repo.
--
-- QUÉ DECIDE ESTA MIGRACIÓN. Dos cosas, y la segunda es la que arregla la
-- pantalla:
--
--   1. Cada corrida anota su entorno y su host. Con eso, el que llame de más
--      queda identificado solo la próxima vez que corra, sin tener que salir a
--      cazarlo.
--   2. La vista PREFIERE la corrida de producción. No la filtra: si para un
--      recurso no hay ninguna de producción, sigue mostrando la más reciente,
--      que es lo que hace hoy.
--
-- La preferencia, y no el filtro, es a propósito. Las filas viejas y las del
-- que llama de más tienen `entorno` en null —no conocen la columna—, así que
-- filtrar por 'production' dejaría todas las pantallas sin dato hasta que cada
-- recurso corriera de nuevo. Prefiriendo, la pantalla se cura sola en la
-- primera corrida buena de cada recurso y nunca queda peor que antes.
-- ============================================================

alter table sincronizaciones
  add column if not exists entorno text,
  add column if not exists host text;

comment on column sincronizaciones.entorno is
  'De qué entorno vino la corrida: production, preview, development, o local '
  'cuando corre fuera de Vercel. Null en las filas anteriores al 23/10/2026 y '
  'en las de cualquier despliegue que no conozca esta columna — que es '
  'justamente la señal de que no salió de acá.';

comment on column sincronizaciones.host is
  'El host que la corrió (VERCEL_URL). Es lo que permite distinguir dos '
  'despliegues del mismo entorno, que es lo que hizo falta para buscar al que '
  'corre a las 08:21:52 sin encontrarlo.';

-- La vista: la misma de la 037, con el orden cambiado.
--
-- `entorno is not distinct from 'production'` ordena primero las de producción
-- y deja atrás tanto las de otro entorno como las de entorno desconocido. El
-- `distinct on` se queda con la primera de cada grupo, así que para un recurso
-- que ya corrió en producción nunca más gana la de otro lado.
create or replace view ultima_sincronizacion
with (security_invoker = true) as
  select distinct on (modulo, recurso)
    modulo, recurso, ok, error, created_at
  from (
    select modulo, recurso, ok, error, created_at, entorno from sincronizaciones
    union all
    -- Compras habla de "importar" y "exportar"; para esto sólo interesa cuándo
    -- se trajo lo de la planilla, que es lo que la pantalla muestra.
    select
      'compras'      as modulo,
      'planilla'     as recurso,
      error is null  as ok,
      error,
      created_at,
      -- Esa tabla no tiene entorno y no hace falta que lo tenga: es de un solo
      -- camino. Entra como desconocida y, al ser la única de su grupo, gana.
      null::text     as entorno
    from compras_sincronizaciones
    where direccion = 'importar'
  ) todas
  order by
    modulo,
    recurso,
    (entorno is not distinct from 'production') desc,
    created_at desc;

comment on view ultima_sincronizacion is
  'La última sincronización de cada recurso, de todos los módulos. Alimenta el '
  'cartel de "Actualizado hace…" de las pantallas que espejan una planilla. '
  'Prefiere la corrida de producción: a esta tabla le escriben varios entornos '
  'y sin eso el fallo de uno mal configurado tapa el éxito del que funciona.';

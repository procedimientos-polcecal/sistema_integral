-- ============================================================
-- SdG — Las sincronizaciones dicen si vienen del despliegue canónico
--
-- CONTINÚA LA 20261023104622, NO LA REEMPLAZA. Aquélla hizo que la vista
-- `ultima_sincronizacion` PREFIERA la corrida de producción, y en su encabezado
-- dejó escrito: «Quién llama no se pudo determinar». Ya se determinó, y el
-- desempate que eligió no alcanza.
--
-- QUIÉN ERA. Un SEGUNDO DESPLIEGUE DE ESTE MISMO REPO, en otra cuenta de
-- Vercel: proyecto `sistemaintegral`, en `soportemantenimiento-4821s-projects`.
-- Tiene las credenciales de Supabase y no las de Google. Medido el 05/11/2026
-- contra producción, sobre la columna `host` que agregó la 20261023104622 —que
-- es justamente para lo que servía—:
--
--   53 corridas, 51 fallidas, 11 despliegues distintos
--   desde 2026-10-24 08:21:52  (el mismo segundo que marcó aquella migración)
--   hasta 2026-11-05 09:59:34
--
--   GOOGLE_SERVICE_ACCOUNT_JSON no configurado            — acarreo, cargas, molinos
--   Falta GOOGLE_SHEETS_STOCK_CARBONILLA_ID…              — carbonilla-planilla
--   Falta GOOGLE_DRIVE_SYH_FOTOS_FOLDER_ID…               — respaldo de fotos
--
-- El usuario confirmó que el despliegue es suyo o de un colaborador: no es una
-- filtración. Apagarlo está fuera del alcance de esta migración y se hace desde
-- esa cuenta de Vercel, a la que desde acá no se llega.
--
-- POR QUÉ EL DESEMPATE ANTERIOR NO DESEMPATA. Ese despliegue es la producción
-- de su propio proyecto, así que **también escribe `entorno = 'production'`**.
-- Las dos filas quedan empatadas en la primera clave del `order by` y gana la
-- segunda, `created_at desc` — o sea la más reciente, que suele ser la del otro
-- porque corre media hora después. El 05/11/2026:
--
--   agenda/barrido               05:00:11  OK      producción
--   agenda/barrido               05:30:55  FALLO   el otro despliegue   ← la pantalla mostró ésta
--   calidad/carbonilla-planilla  08:00:08  OK      producción
--   calidad/carbonilla-planilla  08:21:52  FALLO   el otro despliegue   ← y ésta, doce días seguidos
--
-- Es el fallo que advierte el CLAUDE.md: un rojo esperado que se ve igual que
-- uno real entrena a no mirar ninguno. Y no es sólo el rojo — el 05/11 dos
-- corridas del otro despliegue salieron OK con 0 filas (`agenda/canales` y
-- `agenda/pendientes`), así que también puede ganar diciendo que todo anduvo.
--
-- POR QUÉ NO SIRVE `host`. Es `VERCEL_URL`, que cambia con cada despliegue: en
-- las últimas 1000 filas el canónico dejó 31 hosts distintos y el otro 11. Sirve
-- para investigar —sirvió para esto— pero no hay ningún valor fijo contra el
-- cual compararlo, así que no puede ser el desempate.
--
-- QUÉ DECIDE ESTA MIGRACIÓN. La fila anota si salió del despliegue canónico, y
-- la vista lo prefiere ANTES que al entorno. Quién es el canónico lo decide
-- `esLaCorridaCanonica()` de lib/core/sincronizaciones.ts, con sus tests: que
-- `VERCEL_PROJECT_PRODUCTION_URL` —que Vercel define POR PROYECTO— coincida con
-- el dominio de `NEXT_PUBLIC_APP_URL`, que viaja copiada con el resto de las
-- variables de entorno. Una copia hereda la segunda pero no puede acertar la
-- primera sin apropiarse del dominio, que es un acto visible y del lado del
-- dueño. Las dos variables llegan al runtime detrás del mismo interruptor de
-- variables de sistema que `VERCEL_ENV`, y está prendido en los dos proyectos:
-- se sabe porque las 53 filas del otro traen `entorno` escrito.
--
-- PREFERIR Y NO FILTRAR, igual que la 20261023104622 y por su mismo motivo. Las
-- filas viejas tienen `canonico` en null —no conocen la columna—, así que
-- filtrar dejaría todas las pantallas sin dato hasta que cada recurso corriera
-- de nuevo. Prefiriendo, la pantalla se cura sola en la primera corrida buena de
-- cada recurso y nunca queda peor que antes. Vale también si algún día faltara
-- `NEXT_PUBLIC_APP_URL` en producción: el canónico se marcaría `false` y la
-- vista desempataría como lo hace hoy, que es el estado anterior y no uno peor.
--
-- LO QUE ESTO NO ARREGLA, Y HAY QUE SABERLO. Arregla la PANTALLA, no la
-- concurrencia. No hay ningún candado contra dos corridas simultáneas en todo el
-- sistema —ni `pg_advisory_lock` ni `for update skip locked` en ninguna parte—,
-- así que hoy lo único que separa a los dos despliegues es que al otro le faltan
-- las credenciales de Google. El día que las tenga, los dos escribirían las
-- mismas planillas y los mismos calendarios sin coordinarse: es el fallo del
-- 13/10/2026 —«la primera fila libre» calculada sobre datos que no eran datos—
-- multiplicado por dos escritores. La defensa de verdad es apagar ese
-- despliegue; esta migración sólo hace que su ruido deje de taparle la cara al
-- que sí funciona.
-- ============================================================

alter table sincronizaciones
  add column if not exists canonico boolean;

comment on column sincronizaciones.canonico is
  'Si la corrida salió del despliegue canónico, el que sirve el dominio '
  'público. Lo decide esLaCorridaCanonica() en lib/core/sincronizaciones.ts: '
  'VERCEL_PROJECT_PRODUCTION_URL, que Vercel define por proyecto, contra el '
  'dominio de NEXT_PUBLIC_APP_URL, que una copia hereda. Null en las filas '
  'anteriores al 05/11/2026 y en las de cualquier despliegue que no conozca '
  'esta columna; false es un despliegue que la conoce y dice que no es el '
  'canónico — un preview, un script corrido a mano, o la copia que escribe '
  'desde otra cuenta de Vercel desde el 24/10/2026.';

-- La vista: la misma de la 20261023104622, con una clave más adelante.
--
-- `canonico is true` ordena primero las del despliegue canónico y deja atrás
-- tanto las `false` como las de columna desconocida (null), sin filtrar
-- ninguna. El desempate por entorno queda abajo y sigue haciendo su trabajo
-- para los recursos que todavía no tienen ninguna fila canónica.
create or replace view ultima_sincronizacion
with (security_invoker = true) as
  select distinct on (modulo, recurso)
    modulo, recurso, ok, error, created_at
  from (
    select modulo, recurso, ok, error, created_at, entorno, canonico from sincronizaciones
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
      null::text     as entorno,
      null::boolean  as canonico
    from compras_sincronizaciones
    where direccion = 'importar'
  ) todas
  order by
    modulo,
    recurso,
    (canonico is true) desc,
    (entorno is not distinct from 'production') desc,
    created_at desc;

comment on view ultima_sincronizacion is
  'La última sincronización de cada recurso, de todos los módulos. Alimenta el '
  'cartel de "Actualizado hace…" y los pasos caídos de las pantallas que '
  'espejan una planilla. Prefiere la corrida del despliegue canónico y después '
  'la de producción: a esta tabla le escriben varios despliegues del mismo '
  'repo, y desde el 24/10/2026 hay un segundo que también dice production, así '
  'que sin la primera clave su fallo tapa el éxito del que funciona.';

-- ============================================================
-- SdG — Foto diaria de los conteos de avisos
--
-- POR QUÉ HACE FALTA
--
-- El resumen diario contaba stocks —«23 órdenes de trabajo atrasadas», «15
-- equipos sin ningún service»— y un stock casi no se mueve de un día para el
-- otro: el push de mañana decía lo mismo que el de hoy. Medido contra
-- producción el 18/10/2026: «Facturas en el buzón sin vincular: 1» venía
-- diciendo lo mismo desde el 05/10; hay **un solo service registrado en todo el
-- sistema**, así que «15 equipos sin service» no puede bajar; 19 de las 23 OT
-- atrasadas tienen más de una semana y la más vieja es del 11/12/2025. Y la
-- prueba de que ya costó: de 13 personas, las dos únicas que probaron las
-- notificaciones en serio tienen **los 13 avisos descartados** cada una.
--
-- Desde ahora el push diario dice lo que **se movió** desde el resumen
-- anterior, y la campana sigue mostrando lo que hay.
--
-- POR QUÉ UNA FOTO Y NO UN CÁLCULO
--
-- No hay forma de preguntarle a la base «cuántas OT se atrasaron ayer»: el
-- estado no guarda historia, y reconstruirlo aviso por aviso serían trece
-- consultas distintas, cada una con su propia manera de equivocarse. Guardar lo
-- que se contó es una sola forma de equivocarse, igual para los trece.
--
-- POR QUÉ ES GLOBAL Y NO POR PERSONA
--
-- Los conteos **son globales**: salen de un `count` sobre las tablas, y lo
-- único que cambia por persona es qué módulos ve. Así que alcanza con una fila
-- por aviso y por día —trece diarias, unas cinco mil al año— en vez de trece
-- por persona. Y la foto no pasa por los descartes de nadie a propósito: un
-- descarte es de alguien, la foto no es de nadie.
--
-- LA CLAVE PRIMARIA ES LO QUE DA LA IDEMPOTENCIA
--
-- `(fecha, notificacion_id)` con `upsert` significa que si el cron corre dos
-- veces el mismo día, la segunda corrida reescribe la misma foto — y como la
-- comparación se hace contra la última foto que haya, que ya es la de hoy, da
-- cero y no manda nada. No hace falta ningún candado.
--
-- `notificacion_id` es texto y no un enum: los ids de aviso los define
-- `lib/home/avisos.ts` y cambian con cada módulo nuevo. Un enum obligaría a una
-- migración por aviso, y un valor de enum nuevo además viaja solo en su propio
-- archivo (55P04). No vale la pena para una tabla que nadie consulta por ese
-- campo.
--
-- RLS PRENDIDO Y NINGUNA POLICY — deliberado, no un olvido. A esta tabla la
-- escribe y la lee **sólo el cliente admin**, desde el cron de los avisos
-- diarios. Ninguna pantalla la muestra: la campana lee los conteos de vivo. Con
-- RLS prendido y sin policies, PostgREST le niega todo a cualquier autenticado
-- y el cliente admin pasa de largo, que es exactamente lo que se quiere. Sin el
-- `enable`, la tabla quedaría abierta a cualquiera con sesión. Si alguien le
-- agrega una policy «para poder mirarla», está abriendo lo que esto cerró:
-- preguntarse antes si de verdad hace falta.
-- ============================================================

create table if not exists public.avisos_fotos (
  -- El día de calendario en Argentina, que es el que define «el día» para el
  -- resumen. No es `now()::date`, que en Vercel sería UTC y a partir de las 21
  -- de acá ya sería mañana: lo escribe la aplicación con `hoyEnArgentina()`.
  fecha date not null,
  notificacion_id text not null,
  cantidad integer not null,
  primary key (fecha, notificacion_id)
);

alter table public.avisos_fotos enable row level security;

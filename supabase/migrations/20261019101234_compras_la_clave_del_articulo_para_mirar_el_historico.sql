-- ============================================================
-- La clave del artículo, para poder mirar qué costó la vez pasada
-- ============================================================
-- Un RI no tiene monto hasta que se compró, así que cuando alguien lo prioriza
-- o le busca presupuestos no sabe si va a ser caro. Lo que sí se puede saber es
-- **cuánto costó la última vez que se pidió lo mismo**, y eso es un hecho sobre
-- un requerimiento pasado, no una inferencia sobre éste.
--
-- La distinción no es de estilo. Medido el 19/10/2026 simulando el
-- reconocimiento hacia adelante en el tiempo, un marcado automático por
-- histórico acierta entre el 82% y el 93% según qué tan estricto sea — o sea
-- que se equivoca entre 1 de cada 5 y 1 de cada 14. Mostrar el dato y dejar que
-- juzgue una persona no tiene ese problema: el número es cierto siempre.
--
-- ── POR QUÉ ESTA CLAVE Y NO UNA MEJOR ───────────────────────
--
-- Se midieron dos. Sobre los 308 RI que hoy no tienen ningún monto:
--
--   descripción normalizada tal cual ........ reconoce 78  (25%)
--   palabras ordenadas, sin las vacías ...... reconoce 84  (27%)
--
-- La segunda arregla que `BOLSONES DE 2 10 MTS PARA CAL` y
-- `BOLSONES PARA CAL DE 2 10 MTS` son lo mismo escrito distinto. Pero ordenar
-- palabras no se puede expresar en una columna generada —necesita un subselect—
-- y obligaría a un trigger, a un relleno y a tener la regla escrita también en
-- TypeScript. Seis coincidencias más no pagan eso: así Postgres la mantiene
-- solo, para siempre, y no hay dos versiones de la regla que puedan separarse.
--
-- ── EL MAPA DE ACENTOS NO ES DECORATIVO ─────────────────────
--
-- Se enumeraron los caracteres que de verdad aparecen en las 2.159
-- descripciones: 34 fuera de [A-Za-z0-9 ], y los acentuados son ó(137), á(71),
-- ñ(41), ú(29), é(27), í(26), ü(18), Ó(18), Ñ(6), Á(5), Ü(2), É(1). El `ø` del
-- diámetro aparece 61 veces y NO se traduce a propósito: no es una letra
-- acentuada, así que cae en el `[^A-Z0-9]` y hace de separador, que es lo
-- correcto para "TUBO ø50".
--
-- Se comprobó que esta normalización da la MISMA clave que la de referencia
-- —NFD y sacar los diacríticos— en las 2.159 descripciones, sin una sola
-- diferencia. Si no fueran iguales, la cobertura medida no valdría para esto.
--
-- Si el `add column` fallara por inmutabilidad de `upper()`, la salida es la
-- misma expresión dentro de una función marcada IMMUTABLE, o un trigger. No
-- debería: en PostgreSQL `upper(text)` es inmutable.

alter table public.compras_requerimientos
  add column if not exists clave_articulo text
  generated always as (
    nullif(
      btrim(
        regexp_replace(
          upper(
            translate(
              descripcion,
              'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
              'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
            )
          ),
          '[^A-Z0-9]+', ' ', 'g'
        )
      ),
      ''
    )
  ) stored;

comment on column public.compras_requerimientos.clave_articulo is
  'La descripción normalizada, para encontrar otros RI del mismo artículo. La mantiene Postgres: es una columna generada, no hay nada que recordar escribir. Sirve para MOSTRAR qué costó la vez pasada, no para marcar: el reconocimiento acierta entre el 82% y el 93%, y un hecho sobre un RI viejo es cierto siempre.';

-- La consulta es "otros RI con esta misma clave que ya tengan monto". El índice
-- parcial deja afuera los que no tienen monto, que es la mitad de lo que no se
-- busca nunca por acá.
create index if not exists compras_requerimientos_clave_articulo_idx
  on public.compras_requerimientos (clave_articulo)
  where clave_articulo is not null and monto_conocido is not null;

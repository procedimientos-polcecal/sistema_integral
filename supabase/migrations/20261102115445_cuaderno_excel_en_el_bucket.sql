-- El cuaderno de PIPARO también entra por Excel, y el bucket tiene que dejarlo.
--
-- El `.xlsx` es una **alternativa a las fotos** y no un modelo aparte: se guarda
-- en el mismo bucket y en la misma tabla (`mant_cuadernos_fotos`, con `orden: 1`)
-- justo para que todo lo que viene después —la procedencia de cada renglón, el
-- reintento, el borrado de la carga— siga funcionando sin tocarse. Lo único que
-- lo distingue de una foto es la extensión de la `ruta` (`esRutaDeExcel()` en
-- `lib/mantenimiento/cuadernoOrigen.ts`), y eso evitó una columna nueva.
--
-- Pero `allowed_mime_types` del bucket se creó con los cinco tipos de imagen y
-- nada más (migración `20261101224005`), así que subir el Excel devuelve un
-- error de Storage que no explica nada. Es exactamente la trampa que esa
-- migración dejó escrita: **un tipo que la ruta acepta y el bucket no se ve como
-- un 502 que no dice por qué**. Por eso va en los dos lados, y acá está el lado
-- del bucket.
--
-- Se arma con `array(select distinct ...)` y no con `||` porque esta migración
-- la corre una persona a mano: correrla dos veces por las dudas no puede dejar
-- el tipo repetido en el array.

update storage.buckets
   set allowed_mime_types = array(
         select distinct unnest(
           allowed_mime_types
           || array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
         )
       )
 where id = 'cuaderno-contratista'
returning id, allowed_mime_types;

-- El `returning` imprime el array resultante: tiene que tener los cinco tipos de
-- imagen más el del Excel. Si dice «UPDATE 0», el bucket no existe y lo que
-- falta es la migración `20261101224005`.

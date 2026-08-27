# Importar proveedores desde la app

Diseño acordado el 27 de agosto de 2026.

## El problema

La base de proveedores de verdad la lleva administración en un Excel, y va a
seguir siendo así hasta que la gente use la app. Mientras tanto hay que poder
traerla cuando cambia.

Hoy eso se hace corriendo un script desde una terminal, con el archivo en la
carpeta de Descargas de una computadora. Sirvió para la carga inicial y no sirve
para repetirlo: quien mantiene el Excel no tiene por qué abrir una consola.

## El diseño

**Un botón en Configuración de Compras**, al lado del de sincronizar con la
planilla: `Traer proveedores de la planilla`. Lo aprieta quien administra
Compras.

**El archivo se baja de Drive** con la cuenta de servicio que ya usa la planilla
de compras y las de mantenimiento. El id va en `GOOGLE_DRIVE_PROVEEDORES_ID`,
como las demás.

Se baja de dos formas según lo que sea, y eso evita tener que decidir de
antemano en qué formato vive:

- una planilla de Google se **exporta** a xlsx
- un `.xlsx` subido a Drive se baja **tal cual**

Se distingue por el `mimeType`, que la propia API informa. Después las dos se
parsean con la misma librería que ya usó el importador.

## La lógica se muda, no se copia

El cruce es exactamente el que ya corrió: mismo nombre actualiza, mismo nombre
sin el sufijo societario se une, y lo que se parece sin ser igual no se toca.

Pero se muda de `scripts/import-proveedores/import.mjs` a `lib/compras`, en
TypeScript y con sus tests, y **el script se borra**. Ya cumplió su función, y
dejar las dos versiones garantiza que dentro de tres meses digan cosas
distintas.

`resolver-pendientes.mjs` sí queda: no es un importador, es el registro de quién
decidió que Berner era BERNER y por qué.

## Lo que se ve al terminar

Cuántos se actualizaron, cuántos se dieron de alta, y **la lista de los que
quedaron a revisar con sus candidatos**.

Eso último es el cambio que más importa: antes iba a un JSON en el disco que
sólo se veía desde la terminal, así que en la práctica no lo veía nadie. Ahora
lo ve quien aprieta el botón, que es justamente quien puede resolverlo.

Los que quedan a revisar siguen sin tocarse. Resolverlos desde la pantalla es lo
natural después de esto, pero es otra funcionalidad —elegir entre candidatos,
uno por uno— y mezclarla acá haría las dos peor.

## Reglas que se mantienen

**Un campo vacío en el Excel no borra lo que ya está cargado.** Sólo se escribe
lo que el Excel dice de verdad.

**Nada se desactiva ni se borra.** El Excel manda sobre los datos, no sobre
quién existe: hay 75 proveedores con compras hechas que no figuran ahí.

**Correrlo dos veces seguidas no cambia nada la segunda vez.** Es el mismo cruce
por nombre; si nada cambió en el Excel, no hay nada que actualizar.

## Pruebas

Las que ya tiene el cruce, migradas de `decidir.test.ts` a TypeScript: mismo
nombre actualiza, el sufijo societario se une, un parecido no decide solo, y
cada fila termina en un solo lado.

Se suma una sobre la elección de cómo bajar el archivo: que un `mimeType` de
planilla de Google use la exportación y uno de xlsx la descarga directa. Es la
parte nueva, y elegir mal ahí devuelve un archivo que no se puede parsear.

## Alcance

Sin migración: las nueve columnas ya están desde la `039`.

Queda afuera correrlo solo, en un cron. Se decidió empezar por el botón: quien
mantiene el Excel sabe cuándo lo cambió, y una importación automática de algo
que se edita a mano es una forma de que aparezcan datos raros sin que nadie los
haya pedido.

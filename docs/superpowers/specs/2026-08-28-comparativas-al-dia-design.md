# Las planillas de comparativa, todas con las mismas columnas

Diseño acordado el 28 de agosto de 2026.

## El problema

Las comparativas de proveedores viven en planillas de Drive, una por artículo, y
no todas tienen las mismas columnas. Algunas se armaron antes de que el modelo
tuviera 19, otras tienen los encabezados escritos distinto —`FLETE` en vez de
`ENVÍO`, `TOTAL` en vez de `PRECIO TOTAL`—, y a algunas les falta una columna
entera.

Eso ya causó un problema concreto: la comparativa "ESPIRA SINFIN" no tiene
columna de `ENVÍO`, y la fórmula del total que la app escribía salía
`...+@1001` —`@` es lo que devuelve `letraColumna(-1)`— y Excel la marcaba como
error.

La app tolera la diferencia: `mapearEncabezados` ubica cada columna **por
nombre**, con alias, y funciona con cualquier orden. Lo que no puede hacer es
completar una columna que no existe.

## La decisión

Cada planilla queda con las 19 columnas del modelo en el orden `A:S`, con los
nombres canónicos.

El modelo es `COLUMNAS_COMPARATIVA` de `lib/compras/comparativa.ts`:

```
NRO RI · FECHA · ÁREA · DESCRIPCION · PROVEEDOR · MARCA · UNIDAD DE MEDIDA ·
PRECIO UNITARIO · CANTIDAD · ENVÍO · DESCUENTO · IVA · PRECIO TOTAL ·
PRECIO HASTA · PLAZOS · CONDICIONES DE PAGO · DISPONIBILIDAD · COMENTARIO ·
ELECCIÓN
```

## El vehículo: Apps Script

No la app. Dos razones:

**Permisos.** El sistema tiene `drive.readonly`: puede leer la carpeta pero no
crear nada, así que no puede hacer copias de respaldo. Y para una operación que
mueve columnas con años de cotizaciones, el respaldo no es opcional. Un Apps
Script corre con los permisos de quien lo ejecuta.

**`moveColumns`.** Mueve la columna **ajustando las fórmulas**, igual que
arrastrarla a mano en la interfaz. La alternativa desde la app sería leer los
valores y reescribirlos en otro orden, que pierde las fórmulas y deja las
referencias apuntando a la columna equivocada.

## Qué hace con cada planilla

1. **Respaldo.** Una copia del archivo con la fecha en el nombre. Si la copia
   falla, esa planilla no se toca.
2. **Reconoce** los encabezados con la misma tabla de alias del código,
   normalizando acentos, grados y puntos: `N° RI`, `Nº RI` y `N. RI` son el
   mismo.
3. **Corrige los nombres** de las reconocidas que están escritas distinto:
   `FLETE` → `ENVÍO`, `TOTAL` → `PRECIO TOTAL`, `DESC` → `DESCUENTO`,
   `ENTREGA` → `DISPONIBILIDAD`.
4. **Mueve cada una a su posición** del modelo, con `moveColumns`.
5. **Inserta las que faltan en su lugar**, no al final: `ENVÍO` queda en la J
   aunque hoy no exista en esa planilla.
6. **Conserva las que no reconoce**, corridas después de la S. Puede haber una
   columna que alguien agregó a propósito y cuyo contenido no está en ningún
   otro lado.
7. **Informa** qué renombró, qué movió, qué insertó y qué no reconoció.

### El orden de las operaciones

Se recorren las 19 posiciones de izquierda a derecha. Para cada una se busca su
columna y se la trae desde donde esté.

Eso hace que **todos los movimientos sean hacia la izquierda**, y es
deliberado: `moveColumns` interpreta el destino según las coordenadas de antes
de mover, así que mover hacia la derecha requiere compensar el corrimiento y es
donde se cometen los errores por uno. Trayendo siempre hacia la izquierda, las
posiciones ya resueltas no se mueven más.

El seguimiento se hace sobre un arreglo local que simula la hoja, en vez de
releerla después de cada operación: son 19 pasos por planilla y releer cada vez
serían cientos de llamadas.

## Modo de prueba primero

Una constante `SOLO_INFORMAR`, que arranca en `true`: hace todo el análisis y
**no escribe nada**. Se corre así, se lee el informe completo de todas las
planillas, y recién después se pone en `false`.

Con diez o más planillas ajenas, ver antes qué va a pasar no es opcional.

## Los riesgos, dichos

**Referencias desde afuera.** `moveColumns` ajusta las fórmulas de esa planilla.
Lo que no puede ajustar es un `IMPORTRANGE` de otra planilla apuntando a una
letra de columna de ésta: esa referencia va a quedar mirando otra cosa. Si
alguna comparativa está referenciada desde afuera, hay que dejarla fuera del
lote.

**Protecciones por rango.** Si una comparativa tiene rangos protegidos por
letra, pueden quedar cubriendo otra columna.

**Lo que no sabemos todavía.** No hay credenciales de Google en el entorno de
desarrollo, así que no se pudo relevar cuántas planillas hay ni cuáles están
desactualizadas. El informe del modo prueba es la primera vez que se va a ver.

## Fuera de alcance

- **Rellenar datos.** Una columna nueva queda vacía. `ENVÍO` insertada no
  inventa fletes viejos, y el total de las filas existentes no se recalcula:
  esas fórmulas son las que ya estaban.
- **Unificar los desplegables** de `PLAZOS` y `DISPONIBILIDAD`. La validación de
  datos viaja con la columna al moverla, pero si una planilla tiene otras
  opciones, sigue teniéndolas.

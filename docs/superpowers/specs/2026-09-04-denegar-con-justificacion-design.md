# Denegar un RI o una OS tiene que decir por qué

Diseño acordado el 4 de septiembre de 2026.

## El problema, dicho como lo dijo quien lo tiene

**"Cuando se denega un RI o una OS, que el sistema te pida una justificación de
por qué se denegó."**

Denegar es la única salida del circuito que le cierra la puerta a otra persona.
El área pidió algo, alguien decidió que no, y quien lo pidió se queda sin saber
si le falta una cotización, si estaba duplicado, si no había plata o si se
resuelve con lo que hay en el pañol. Sin el motivo, el pedido vuelve a entrar
igual la semana siguiente.

Es la misma razón por la que la devolución a comparativa ya exige motivo desde
[`lib/compras/devolucion.ts`](../../../lib/compras/devolucion.ts). Este diseño
extiende esa regla a la denegación, en los dos módulos donde existe.

## El terreno, verificado contra la base

Los dos casos arrancan de lugares muy distintos, y eso decide casi todo.

### El RI ya tiene el circuito, y el campo está vacío

`compras_requerimientos` tiene `motivo_rechazo` desde el principio, la ficha del
RI ya despliega un textarea al tocar «Denegar», y el botón «Confirmar» ya está
deshabilitado sin motivo. Pero:

| | |
|---|---|
| RI con `estado_aprobacion = DENEGADA` | 71 |
| RI con `estado_compra = DENEGADO` | 48 |
| **De los denegados, con motivo cargado** | **0** |

Cero. El campo existe y nunca se usó, porque **las 71 denegaciones entraron por
la sincronización de la planilla** —[`sheets.ts:204`](../../../lib/compras/sheets.ts:204)
mapea `DENEGAD*` y `RECHAZ*` a `DENEGADA`— y no por el formulario de la app.

Y hay un agujero real: la regla vive sólo en el botón. El PATCH de
[`app/api/compras/requerimientos/[id]/route.ts`](<../../../app/api/compras/requerimientos/[id]/route.ts>)
acepta `estado_aprobacion: "DENEGADA"` sin `motivo_rechazo` sin decir nada.

### La OS no tiene circuito de denegación en absoluto

`ESTADOS_OS` en [`lib/mantenimiento/os.ts`](../../../lib/mantenimiento/os.ts) son
cinco, y ninguno es denegado: `POR APROBAR`, `EN REVISIÓN`, `APROBADO`,
`EN PROCESO (COMPARATIVA)`, `ACEPTADO`. En las 228 filas de `ordenes_servicio` no
hay ninguna denegada, y no hay columna para el motivo.

En la planilla sí se deniega, escribiendo el estado a mano. **La palabra es
`DENEGADO`**, confirmada por quien la usa. Que el vocabulario coincida no es
cosmética: si el sistema escribiera otra, la planilla y la app estarían diciendo
cosas distintas del mismo pedido.

### Dónde vive el estado de una OS, que es la trampa

La planilla de OS tiene dos estados y no uno:

- **`SERVICIOS!L`** es el estado maestro, escrito a mano. Es el que lee el
  `FILTER` de cada pestaña de área (`estado="APROBADO"`), así que decide si la OS
  llega a la pestaña de su área o no.
- **La columna de estado de cada pestaña de área** es el seguimiento de una OS ya
  aprobada, escrita a mano después de la columna K.

El cruce de la base lo confirma: **11 OS viven sólo en `SERVICIOS`** —las que
todavía no se aprobaron, que son justamente las candidatas naturales a
denegarse—, y a ésas la app hoy no les escribe nada. `escribirEnPlanilla` corta
con *"Esta OS todavía no está aprobada, así que no tiene fila de seguimiento"*.

| estado | pestaña donde vive la fila | filas |
|---|---|---|
| `ACEPTADO` | pestañas de área | 193 |
| `null` | `SERVICIOS` | 10 |
| `null` | pestañas de área | 21 |
| `EN REVISIÓN` | `SERVICIOS` | 1 |
| `POR APROBAR` | `MANTENIMIENTO` | 2 |
| `EN PROCESO (COMPARATIVA)` | `TALLER VIAL` | 1 |

Y el circuito real, según quien lo opera: **una OS se puede denegar en
`SERVICIOS`, antes de pasar a la pestaña del área, o ya estando dentro de la
pestaña.** En el primer caso no llega nunca a la pestaña; en el segundo se queda
ahí, denegada.

## Qué se construye

### 1. Qué cuenta como justificación

`lib/core/justificacion.ts`, una función pura, compartida por los dos módulos
porque la pregunta es idéntica: *¿este texto explica algo?*

Con los espacios colapsados, un texto sirve si tiene **al menos 4 caracteres y al
menos una letra**, y no es una de las no-respuestas conocidas: `no`, `na`, `n/a`,
`nada`, `ninguno`, `sin motivo`, `x`, `-`, `.`.

El mínimo es 4 y no 10 a propósito: **«Duplicado» es un motivo perfectamente
válido de 9 letras**, y un mínimo generoso lo rechazaría mientras deja pasar
«asdfghjklñ». Lo que se filtra no es la longitud sino la no-respuesta.

Vive en `lib/core/` y no en un módulo porque la usan Compras y Mantenimiento. El
predicado de *qué transición es una denegación* sí es de cada módulo, porque los
estados son distintos.

### 2. Compras — el RI

`lib/compras/denegacion.ts`, con la misma forma que `devolucion.ts`:

- `esDenegacion(cambios, actual)` — si el cambio aterriza en denegado, **venga
  por la rama que venga**: `estado_aprobacion = DENEGADA` o
  `estado_compra = DENEGADO`. Denegar por la rama de compra no es el camino que
  ofrece la pantalla —la ficha filtra `DENEGADO` del desplegable— pero la API lo
  acepta, y una regla que se esquiva cambiando de campo no es una regla.
- `faltaLaJustificacion(...)` — combina el predicado con la regla de texto.

Se exige en el PATCH de la ruta, en las dos ramas, igual que hoy se exige
`faltaElMotivo` en la devolución. Responde **400** con un mensaje que dice qué
falta y por qué, en la misma voz que el de la devolución.

En la ficha del RI el cambio es chico, porque el textarea ya está: que el botón
deshabilitado diga por qué en su `title`, y que el error del servidor se vea si
llega.

**La sincronización no se toca.** Va a seguir importando denegaciones sin motivo,
porque la planilla de Compras no tiene columna donde ponerlo —su
[`ALIAS`](../../../lib/compras/sheets.ts) no tiene observaciones ni motivo— y no
hay de dónde sacar uno. Es una divergencia conocida: la regla vale para lo que se
deniega **dentro del sistema**.

### 3. Mantenimiento — la OS

Acá es casi todo nuevo.

**Migración**, con marca de tiempo y corrida a mano en el editor SQL de Supabase:

```sql
alter table ordenes_servicio add column motivo_rechazo text;
```

Hasta que exista la columna, esta parte no funciona. Es una dependencia, no un
detalle.

**`DENEGADO` entra en `ESTADOS_OS`**, con esa palabra exacta.

**`lib/mantenimiento/denegacion.ts`** con la misma forma: el predicado de si el
estado aterriza en `DENEGADO`, y la regla de texto compartida.

**El PATCH** de
[`app/api/mantenimiento/ordenes-servicio/route.ts`](../../../app/api/mantenimiento/ordenes-servicio/route.ts)
exige el motivo cuando el estado aterriza en `DENEGADO`, y acepta
`motivo_rechazo` como campo escribible del seguimiento.

**Dónde se escribe `DENEGADO` en la planilla: donde vive la fila.**

| Si la fila vive en… | Se escribe… | Y entonces |
|---|---|---|
| `SERVICIOS` | la columna de estado de `SERVICIOS` | la OS no llega nunca a la pestaña del área |
| una pestaña de área | el estado de seguimiento de esa pestaña, como hoy | la OS se queda en la pestaña, denegada |

Escribir en `SERVICIOS` es nuevo y va quirúrgico: **sólo la celda de estado, y la
columna se busca por encabezado y no por letra fija.** El resto de esa hoja es
`QUERY(IMPORTRANGE(...))` y escribir ahí no cambia el dato: rompe la fórmula y con
ella toda la pestaña. Se aplica la misma guarda que ya existe para las pestañas
de área: verificar que la fila siga siendo la de esa OS antes de escribir, porque
el `FILTER` corre las filas cuando una orden entra o sale.

**El motivo no viaja a la planilla.** Vive en la base y se ve en la ficha de la
OS. Es una decisión tomada: la alternativa era pisar `OBSERVACIONES`, que es un
campo de uso general con notas cargadas que no son motivos, y después no se
podría distinguir un motivo de una nota cualquiera.

Si Google rechaza la escritura del estado, el mensaje va **con lo que dijo
Google, sin traducir**, por el `planilla_error` que la ruta ya devuelve. Un fallo
de escritura no es un `console.warn`.

**En `DetalleOS`**, elegir `DENEGADO` despliega el textarea obligatorio, y Guardar
queda deshabilitado hasta que el texto explique algo. Una vez denegada, el motivo
se muestra en la ficha.

## Errores

Dos cosas distintas que no se pueden mezclar en un solo cartel:

- **Falta la justificación** → 400 antes de guardar nada. La pantalla lo muestra
  donde está el formulario.
- **La planilla rechazó el estado** → el cambio ya se guardó en la base. Se
  informa aparte, con el texto de Google, a quien hizo la acción.

## Cómo se verifica

Vitest sobre las funciones puras, que es donde están las decisiones:

- `lib/core/justificacion.test.ts` — acepta «Duplicado», «No hay presupuesto»;
  rechaza `""`, `"   "`, `"-"`, `"."`, `"no"`, `"n/a"`, `"ninguno"`.
- `lib/compras/denegacion.test.ts` — exige motivo al denegar por aprobación y al
  denegar por la rama de compra; no lo exige al aprobar, ni al mover un pedido a
  otra etapa.
- `lib/mantenimiento/denegacion.test.ts` — lo exige al aterrizar en `DENEGADO`;
  no al pasar a `ACEPTADO` ni a `APROBADO`.

Las rutas y las pantallas no llevan tests, como en el resto del repo. Lo que se
puede comprobar sin navegador se comprueba acá; el formulario se mira en el
deploy.

## Qué NO hace, explícitamente

- **No hay catálogo de motivos.** Texto libre. Un desplegable de razones se puede
  contar, pero hay que mantenerlo, y cuando falta la opción justa la gente elige
  la más parecida —que es la misma trampa que enlazar al proveedor que se le
  parece.
- **No notifica al solicitante.** El motivo se ve en «Mis pedidos», que ya lo
  muestra cuando está cargado.
- **No hay backfill de los 71 RI ya denegados.** No hay de dónde sacar esos
  motivos, e inventarlos es peor que dejarlos en null: un motivo equivocado no se
  nota nunca.
- **No toca la sincronización** ni le agrega una columna de motivo a la planilla
  de Compras.
- **No cambia quién puede denegar.** En Compras sigue requiriendo nivel de
  aprobación; en Mantenimiento, nivel de edición, que es lo que hoy exige tocar
  el estado de una OS. Inventar un rol de aprobador para Mantenimiento es otro
  proyecto.

## Riesgo asumido

Escribir en `SERVICIOS` es lo único que toca terreno nuevo de la planilla. La
hoja es casi toda fórmula y una escritura en la celda equivocada no rompe una
fila: rompe la pestaña. Por eso la columna se busca por encabezado, se escribe
una sola celda, y se verifica antes que la fila siga siendo de esa OS.

Apareció un riesgo que este diseño no había previsto y que la implementación
tuvo que cerrar: **`APROBADO` es el único valor que el `FILTER` de las pestañas
levanta**, y levantar una fila corre las de abajo mientras el seguimiento escrito
a mano no se corre con ellas —el mismo daño que detecta `seguimientoHuerfano`—.
Así que la escritura en el maestro quedó limitada a los valores que dejan la OS
afuera de las pestañas. Denegar es seguro: ya estaba afuera y sigue afuera.
Aprobar sigue siendo a mano en la planilla, como hasta ahora.

### Lo que quedó confirmado del lado de la planilla

- La **validación de la columna ya ofrece `DENEGADO`**, así que la escritura no
  la va a rechazar por un valor fuera de lista —que es lo que sí le pasa a
  Compras con «DENEGADA»—.
- La **cuenta de servicio tiene permiso de edición** sobre la columna L de
  `SERVICIOS`.
- El **encabezado de esa columna coincide con el alias `ESTADO`**. No hace falta
  abrir la planilla para saberlo: la OS 26, que vive en la fila 27 de
  `SERVICIOS`, tiene `estado = "EN REVISIÓN"` y `empresa = "Polysan"` en la base,
  y las dos las leyó la sincronización por encabezado. Si `L1` no coincidiera,
  esos dos campos estarían en null como en las otras diez filas de la hoja —que
  están vacías porque nadie las completó todavía, no porque no se lean—.
- Lectura y escritura usan la **misma convención**: el sync toma `filas[0]` como
  encabezado y guarda `sheets_row = i + 1`; la escritura lee `SERVICIOS!1:1` y
  escribe en ese `sheets_row`, con los mismos `ALIAS_OS`.

### Lo que sigue sin comprobarse

**Nunca se escribió una celda de `SERVICIOS` desde la app.** Las credenciales de
Google no están en local, así que todo lo de arriba es inferencia sobre el camino
de lectura, no una escritura hecha. La primera denegación de una OS que viva en
`SERVICIOS` hay que mirarla contra la planilla.

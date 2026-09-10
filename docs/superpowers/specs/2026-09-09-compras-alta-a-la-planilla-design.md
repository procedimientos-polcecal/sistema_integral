# Compras — El alta hecha en el sistema llega a la planilla

Hoy un RI cargado desde el sistema **no aparece en la planilla**. La
sincronización tiene los dos sentidos andando para todo lo demás —aprobación,
proveedor, costos, estado, comparativa— pero el alta viaja en una sola
dirección: de la planilla al sistema. Quien trabaja mirando la planilla no ve
esos pedidos.

La ruta de alta no intenta exportar nada: inserta en la base y termina
(`app/api/compras/requerimientos/route.ts`). Y aunque lo intentara,
`exportarRequerimiento` no tendría dónde escribir: necesita `hoja_origen` y
`sheets_fila`, que un RI del sistema no tiene.

## La planilla es una cadena de fórmulas

Relevado el 09/09/2026 contra las planillas reales, con las credenciales de
`.env.local`.

```
FORM PEDIDO DE COMPRA POLCECAL - POLYSAN   (1T551q99JfhbXeYzGRbkhcZd6wwc4oh4v83UxPIGFLVM)
  └─ "Respuestas de formulario 1"          ← el ÚNICO lugar escribible de un alta
        │  QUERY(IMPORTRANGE(...); "SELECT Col1,Col2,Col5..Col12 WHERE Col1 IS NOT NULL")
        ▼
PEDIDOS DE COMPRA                          (1hnfYHaWBprT9UGOETSoQ9GQCl3B1ZezPr5FPbCrUO80)
  ├─ "Requerimientos internos" (master)    A:J = la fórmula · K,L,M = a mano
  │     │  FILTER(master A:L; C="<área>"; M="APROBADA (NICO)" o "(MAXI)")
  │     ▼
  └─ "RI MANTENIMIENTO", "RI ALMACÉN", …   A:L = la fórmula · M:R = a mano
```

**Ninguna columna del alta es escribible.** En el master, `A2` es una sola
fórmula cuya salida ocupa A:J. En cada pestaña por área, `A2` es un `FILTER` del
master que ocupa A:L. Lo único a mano es lo que la app ya escribe: `K`, `L` y
`M` del master (prioridad, empresa, estado) y `M`..`R` de las pestañas
(solicita, comparativa, proveedor, estado, costos).

### La hoja de respuestas

| | | | |
|---|---|---|---|
| `A` | Nº RI | **fórmula por fila** | `=IF(B<n>:B<>"",A<n-1>+1,"")` |
| `B` | Marca temporal | serial | `46274.40066784722` |
| `C` | Nombre | texto | del solicitante |
| `D` | Apellido | texto | |
| `E` | ÁREA | texto | **exacto**: el `FILTER` de cada pestaña compara con este texto |
| `F` | DESCRIPCIÓN DEL PEDIDO | texto | |
| `G` | CODIGO | texto | |
| `H` | CANTIDAD A PEDIR | número | |
| `I` | PARA DONDE SE NECESITA | texto | |
| `J` | PARA CUANDO SE NECESITA | serial | |
| `K` | DETALLES EXTRA | texto | |
| `L` | ARCHIVO COMPLEMENTARIO | texto | el `QUERY` la trae como IMAGEN |
| `M` | DIRECCIÓN EMAIL ENVIADA | texto | a quién se le avisó — la escribe el Apps Script |
| `N`, `O` | correo, Area | | el `QUERY` las ignora |

Los datos arrancan en la fila 4 —las filas 2 y 3 ceban la numeración con `-1` y
`0`— y **fila − 3 = Nº de RI**, sin un solo hueco en 1.953 pedidos. La fila del
master es **fila de respuestas − 2**.

El `QUERY` saltea `Col3` y `Col4`, que son `Nombre` y `Apellido`: **quién pidió
no llega al master**. Por eso `SOLICITA` en las pestañas por área es una columna
a mano.

Locale `es_MX`, zona `America/Araguaina` (UTC−3).

## Dos cosas que se arreglaron al relevar

**El RI 1954 no existía en la planilla y su número estaba por chocar.** La
numeración de la hoja de respuestas es independiente de la base: la próxima
respuesta del formulario iba a ser 1954 también, y el `upsert` por `nro_ri` le
habría pisado descripción, área y fecha al pedido cargado en el sistema. Se
escribió su fila (respuestas 1957, master 1955) con la fórmula normal en `A`
—que calculó 1954— y con prioridad y empresa en `K`/`L` del master.

**`A1957` tenía la fórmula del Nº de RI rota:**
`=IF(B1957:B<>"";#REF!+1;"")`, la única celda rota de 1.957. Era justo la
próxima fila que iba a usar el formulario, así que el siguiente pedido cargado
allá habría entrado **sin número**, y el `WHERE Col1 IS NOT NULL` del master lo
habría dejado afuera sin avisar. Quedó reemplazada por la fórmula normal.

## El diseño

### 1. `lib/compras/formulario.ts`

Archivo nuevo, no dentro de `sheets.ts`: son dos planillas distintas, con otro
id, otra hoja y otro mapeo. `sheets.ts` ya tiene 1.100 líneas espejando una
sola.

`exportarAltaAlFormulario(requerimientoId)`:

1. Lee el RI con su área, su ubicación y el nombre y apellido del solicitante.
2. Busca la **primera fila libre por la columna B** y escribe `A:L` en un rango
   explícito. Nunca `append`: escribe después de *todo* el contenido de la hoja,
   no después de los datos, y ya mandó dos presupuestos a las filas 1003 y 1004.
3. En `A` escribe **el número como valor**. Al principio escribía la misma
   fórmula que las otras filas, para que el que numerara siguiera siendo la
   planilla; el 09/09/2026 eso costó un pedido perdido en producción y la
   corrección está más abajo, en *"Lo que la fórmula no aguanta"*.
4. Lee `A` de vuelta y **confirma que dio el `nro_ri` que asignó el sistema**. Si
   no coincide, no rompe: deja el pendiente y avisa. Dos números para un pedido
   es peor que un pedido sin fila.
5. Escribe prioridad y empresa en `K`/`L` del master, en la fila que
   corresponde, **y sólo si hay algo que escribir**: una prioridad que nadie
   sugirió no pisa la celda con vacío. Es el mismo criterio que la celda de
   comparativa, que dejó de escribirse vacía porque borraba el link que la
   planilla sí tenía.
6. Guarda `hoja_origen` y `sheets_fila` para que las exportaciones siguientes
   sepan dónde escribir.

Los encabezados se mapean **por nombre de columna, no por posición**, y si falta
alguno no se escribe y se dice cuál: escribir a ciegas en un archivo con otra
estructura es la forma más fácil de arruinar la planilla de alguien.

Las fechas van como **serial**, no como texto: la planilla es `es_MX` y un texto
depende del locale; un serial no depende de nada.

### 2. La ruta de alta la llama

`POST /api/compras/requerimientos`, después de insertar. Si Google falla, **el
alta no se voltea**: el pedido ya está guardado, se avisa en pantalla y queda el
pendiente anotado. Es la regla del módulo.

### 3. El reintento distingue el alta

`reintentarPendientes()` hoy interpreta todo pendiente como "faltan las columnas
de compra" y llamaría a `exportarRequerimiento`, que para un alta no escribe
nada. Un RI con `hoja_origen` nulo nunca llegó a la planilla: ése se reintenta
con el alta. No hace falta una columna nueva.

### 4. La sincronización no degrada lo que el sistema sabe

Tres columnas que hoy se pisarían cuando la planilla relea la fila del pedido:

| Columna | Qué pasa hoy | Por qué importa |
|---|---|---|
| `origen` | `"app"` → `"sheets"` | El indicador de *por dónde entran los pedidos nuevos* de `/compras/configuracion` es el que decide cuándo apagar el formulario |
| `prioridad` | `"1 SEMANA"` → `null` | La sugiere quien pide, en el alta |
| `paga_ambas` / `empresa_id` | `true` → `false` | Se elige en el alta |

Van con la misma regla que ya tienen el estado, el solicitante y la asignación:
**si la planilla no lo trae, se conserva lo que hubiera**. Perder una decisión es
peor que quedarse con una vieja.

### 5. `SOLICITA` se suma a lo que se exporta

Columna `M` de las pestañas por área, a mano, y **el único lugar donde la
planilla muestra quién pidió** —el `QUERY` del master saltea `Nombre` y
`Apellido`—. Se escribe junto con las demás al exportar. Para los RI viejos es
lo mismo que ya está; para los nuevos, la diferencia entre un pedido con dueño y
uno anónimo.

### 6. Variable nueva

`GOOGLE_SHEETS_COMPRAS_FORMULARIO_ID`. Sin ella el alta no se exporta y **no es
un error: se omite**, igual que hoy con `GOOGLE_SHEETS_COMPRAS_ID`. Va a
`docs/VARIABLES-VERCEL.md`.

### 7. El aviso por mail — activador por tiempo

Hoy un Apps Script avisa por mail en cada respuesta del formulario
(`NotificadorPedidoCompra extends Biblioteca.NotificadorBase`, con
`obtenerEmailArea(area)` y `new HojaPedidos(this.evento)`), y anota los
destinatarios en la columna `M`.

**Una fila escrita por la API no dispara ningún activador**: la documentación de
Apps Script es explícita —*"Script executions and API requests don't cause
triggers to run"*— y la única excepción es `Form.submitGrades()`. Ni `onEdit`,
ni un instalable de edición, ni el de envío de formulario.

Tampoco sirve que la app **envíe el formulario de verdad**: el formulario tiene
una pregunta de subida de archivo y correo verificado, y las dos obligan a
iniciar sesión, así que un envío desde el servidor se rechaza.

Entonces: un **activador por tiempo** en la planilla de respuestas que busque
las filas con `M` vacía, mande el aviso y escriba `M`. La columna ya es el
marcador de "a quién le avisé", así que el criterio existe y no hay que
inventarlo. Es autoreparable: sirve para la fila que escribe el sistema y
también para una respuesta del formulario cuyo aviso falló.

Reusa el notificador **fabricándole el evento**, en vez de duplicar el armado
del mensaje. Queda en `docs/` como los otros `.gs` del repo, para instalar a
mano.

### Cómo está hecho el aviso, y qué evento hay que fabricarle

Ya no hace falta adivinar. El que avisa del pedido nuevo es
`NotificadorSolicitud`, con `HojaFormulario`, y lo dispara:

```js
function triggerSolicitudForm(e) {
  if (!e || !e.values) return;            // <- activador de envío de formulario
  const tr = new NotificadorSolicitud(e);
  tr.notificarArea();
}
```

Manda un mail al área **y a Compras** con asunto `Solicitud de compra: N°RI
<ri>`, y antes de mandarlo escribe la dirección del área en la **columna 13**
(`M`) de la fila del evento. O sea que `M` no es sólo el marcador: es lo que
hace este notificador, y está atado a la hoja de respuestas.

`Biblioteca.Hoja` lee cada campo así: primero `e.namedValues[<nombre>][0]`, y si
no está, va a la hoja —`e.range.getSheet()`— y busca la columna por su
encabezado con `createTextFinder`. Y `getFila()` devuelve `e.range`.

Entonces el evento a fabricar es exactamente:

```js
const rango = hoja.getRange(fila, 1, 1, hoja.getLastColumn());
const e = { values: rango.getValues()[0], range: rango };
```

Sin `namedValues`, para que caiga en la lectura por encabezado, que es la que
funciona con una fila que ya está escrita. Con `values` para pasar la guarda de
`triggerSolicitudForm`, y con `range` para que `getHoja()` y `getFila()`
resuelvan la fila correcta.

**La función tiene que estar acotada por fecha, y esto es lo importante.** Hoy
hay **tres** filas con `M` vacía de 1.954: la 4 (RI 1, del arranque), la 330 (RI
327) y la 1957 (RI 1954, la que se escribió ahora). Un barrido de "M vacía" sin
límite le mandaría a Mantenimiento un aviso de dos pedidos de hace meses. Se
procesan sólo las filas cuya marca temporal sea de los últimos dos días.

Dos precauciones más:

- **Cada fila en su propio `try/catch`.** `mailPorArea` **lanza** si el área no
  está en la planilla de mails (`1jHB1uIHfz…`), así que un área sin dirección
  cargada cortaría la corrida y ninguna de las siguientes se avisaría.
- **El que falla no puede reintentarse para siempre.** Si el motivo es que falta
  la dirección, se escribe `M` con el motivo —`SIN EMAIL PARA EL ÁREA:
  Inversiones`— para que quede visible y deje de reintentarse. Es la misma forma
  que `sheets_pendiente` de este lado.

Queda por ver `notificarArea()` y `obtenerEmailArea()` de la biblioteca, que es
donde se manda el mail: hasta ahí no llegué a leer.

## Qué se prueba

Vitest sobre las funciones puras, que es donde están las decisiones:

- **El armado de la fila**: mapeo por nombre de encabezado, las dos fechas como
  serial, el área con el texto exacto, y que una columna que falta se informe en
  vez de escribir a ciegas.
- **La fila del master a partir de la fila de respuestas** (−2) y el número de RI
  a partir de la fila (−3).
- **La conservación**: que la sincronización no pise `origen`, `prioridad` ni
  `paga_ambas` cuando la planilla no los trae.

De punta a punta, contra las planillas reales: cargar un pedido de prueba, verlo
aparecer en el master, aprobarlo y verlo aparecer en la pestaña de su área con
`SOLICITA` puesto, y confirmar que el siguiente número que asigna el sistema es
el que sigue.

## Riesgos asumidos

**Lo que la fórmula no aguanta, y lo que se hizo con eso.**

La primera versión le dejaba el número a la fórmula de la hoja
—`=IF(B{n}:B<>"",A{n-1}+1,"")`— y el sistema lo verificaba después de escribir.
Verificado en el momento, daba bien. **Google Forms inserta una fila por cada
respuesta, y la inserta justo después de su propia última respuesta**, no
después de la última fila con datos: la fila del alta se escribió en la 1957,
dos respuestas la empujaron a la 1959, su referencia `B` bajó con ella y la
referencia `A1956` —que quería decir "la de arriba"— se quedó donde estaba.
Volvió a calcular `A1956+1` y quedaron **dos RI 1954**. El `upsert` por `nro_ri`
de la sincronización los colapsó y el pedido que había entrado por el formulario
desapareció del sistema.

El riesgo que este spec había dejado asumido —"la ventana que queda es un pedido
cargado en el sistema y una respuesta del formulario **en el mismo instante**"—
estaba mal medido: la ventana dura **hasta la próxima respuesta**, sin límite de
tiempo. Y la verificación del paso 4 no puede detectarlo, porque en el instante
de escribir el número todavía está bien.

Una referencia absoluta no puede significar "la de arriba" en una hoja donde
alguien inserta filas. Así que:

- **el sistema numera y escribe el número como valor** —ya lleva la serie, y ya
  tiene el control de que el número no esté tomado por otra fila—;
- **la planilla deja de numerar con una fórmula**: lo hace su Apps Script en
  cada envío del formulario, con `max(A)+1`, contando también las filas que
  escribió el sistema. Va en `docs/compras-formulario-apps-script.gs`, con su
  `LockService` para que dos respuestas simultáneas no se lleven el mismo
  número.

Los dos cuentan lo mismo y ninguno tiene que adivinar dónde va a insertar el
otro: **la serie sigue siendo una sola**. Lo que queda asumido es más chico y
está acotado: entre que el sistema lee `max(nro_ri)` y escribe su fila puede
entrar una respuesta del formulario y tomar el mismo número. Lo detecta
`filaConEsteRi` —se niega a escribir y lo dice— en vez de dejar dos pedidos con
el mismo número en silencio.

**El techo del `QUERY` es la fila 10000** (`A4:L10000`), o sea ~9.996 pedidos.
Hoy hay 1.954. No es urgente, pero el día que se acerque, la fórmula deja de
traer los nuevos sin avisar.

**Las pestañas por área son posicionales.** `A:L` es un `FILTER` cuyas filas se
corren, y `M:R` son valores a mano pegados a un número de fila. Si un RI viejo se
aprueba tarde, entra en el medio del `FILTER` y **todo lo de abajo se corre**:
comparativa, proveedor y costos quedan pegados al pedido equivocado. Es un
problema de la planilla, no del sistema, y no se puede arreglar desde acá. Se
verificaron los 1.912 punteros `sheets_fila` contra la planilla el 09/09/2026 y
coinciden todos; la sincronización los refresca cada vez que corre, así que el
sistema se recupera solo, pero lo que quedó escrito a mano en la planilla no.

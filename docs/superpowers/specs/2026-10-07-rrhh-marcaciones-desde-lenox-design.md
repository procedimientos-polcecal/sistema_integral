# Marcaciones desde Lenox: sacar el Excel del medio

Acordado el 7 de octubre de 2026. Es sobre `/rrhh/fichadas` —"Control →
Marcaciones" en el menú—, la pantalla donde hoy se sube el reporte que exporta
el servicio del reloj biométrico.

Reemplaza un gesto: bajar un `.xlsx` de Lenox, subirlo, mapear columnas,
confirmar. La API de Lenox existe y tiene el endpoint que hace falta, así que
el gesto se puede borrar entero. Lo que **no** se reemplaza es la lógica que
interpreta esas marcaciones, y buena parte de este documento explica por qué.

## Lo que pasa hoy (medido el 06/10/2026 contra producción)

| | |
|---|---|
| Fichadas cargadas | 4.672 `IMPORTADO` · 19 `MANUAL` |
| Empleados | 70 (68 activos), sin legajos duplicados |
| Formato de legajo | `PC_###` ×39 · `PS_###` ×29 · `EXT_###` ×2 — **ninguno numérico** |
| Último archivo subido | `Reporte_Marcaciones (7).xlsx`, el 01/10/2026 |
| **Fichada más reciente** | **30/09/2026** |

Los dos últimos renglones son el problema, y se leen juntos: seis días sin
cargar al momento de medir, y una numeración de archivos (`(63)`, `(69)`,
`(71)`) que cuenta sola que la carga va a los tirones. La liquidación depende
de que alguien se acuerde.

Los avisos de los imports reales nombran legajos como `PC_233`, `PC_122`,
`PC_204`. O sea que **lo que Lenox exporta como "legajo" ya es exactamente lo
que el SdG tiene en `empleados.legajo`**: el enganche entre los dos sistemas no
hay que inventarlo, ya funciona. De doce lotes revisados, uno solo tuvo un
"legajo no encontrado", y era una fila basura (un serial de Excel leído como
legajo).

## Lo que hay del otro lado

La API está documentada y es pública: [postman.lenoxhr.com](https://postman.lenoxhr.com/).

```
GET https://empresas.api.lenoxhr.com/api/v1/marcaciones/getmarcaciones
    ?Desde=2026-10-01&Hasta=2026-10-07&ExcluirDadosDeBaja=true
Header: LenoxBusinessAPI-Key: <clave de la empresa>
```

Devuelve marcaciones **sueltas** —no la celda `"E 08:07 - S 15:56"` que arma el
Excel—, cada una con `legajo`, `marcacion` (`2024-10-23 07:00:00`),
`marcacionFecha`, `marcacionHora`, `tipoMarcacion`, `comentario` y `reloj`.

Tres cosas de la doc que condicionan el diseño:

- **El rango no puede superar los 7 días.** Un mes son cinco llamadas.
- **No viene la letra E/S.** Resulta que nos favorece: `pairTokens` ya empareja
  por posición y no por la letra, justamente porque en el borde entre días la
  letra no era confiable.
- **Hay un tope de filas que la doc no dice cuál es.** Existe un parámetro
  `FilasExcluidas` ("cantidad de filas iniciales a excluir"), que es un
  *offset*, y la respuesta trae un campo `mensaje` que en el ejemplo dice
  `"Se muestran todos los resultados"` — lo cual implica que a veces dice otra
  cosa. Con 68 empleados por 7 días son del orden de 1.500 filas, así que no es
  teórico. Se trata como la trampa de PostgREST que ya conocemos: **se pagina
  siempre**, y se corta cuando una página vuelve vacía, en vez de confiar en un
  tope que no está escrito.

El parámetro `Legajo` está documentado como "Alfanumérico", así que `PC_035` no
es un problema aunque todos los ejemplos de la doc sean numéricos.

## La decisión que ordena todo: la lógica difícil no se reescribe

`reconciliarMarcaciones` en [`lib/rrhh/excelImport.ts`](../../../lib/rrhh/excelImport.ts)
tiene 4.672 fichadas de kilometraje y tests propios. Resuelve las marcaciones
fantasma, el turno que cruza la medianoche, y la fichada que quedó abierta en
un lote y se cierra con el siguiente. Nada de eso cambia porque el dato llegue
por HTTP en vez de por Excel. **Lo único que cambia es de dónde salen los
tokens.**

De ahí sale el resto del diseño.

## Arquitectura

```
lib/rrhh/lenox/
  cliente.ts      HTTP puro: la clave, el tope de 7 días, la paginación, los errores
  agrupar.ts      puro + testeable: marcaciones sueltas → días por empleado
  sincronizar.ts  orquesta: trae → agrupa → reconcilia → aplica → coteja empleados
lib/rrhh/fichadas/
  aplicar.ts      extraído de confirm/route.ts, compartido por los dos caminos
```

### `aplicar.ts` se extrae del route, y lo usan los dos caminos

Hoy [`app/api/rrhh/fichadas/import/confirm/route.ts`](../../../app/api/rrhh/fichadas/import/confirm/route.ts)
tiene 233 líneas con todo adentro: resolución de legajo, dedup dentro del
archivo, reemplazo de las `IMPORTADO` del día, alta del batch, recálculo del
período.

Como el Excel se queda de respaldo (ver más abajo), si la sincronización
escribiera por su cuenta habría dos caminos de alta que se irían separando — y
el que casi no se usa es el que se pudre sin que nadie lo note. Una sola
función de alta, dos llamadores.

Gana además lo que hoy no tiene: **tests**. No los tiene porque vive dentro de
una ruta, que es exactamente el caso que el CLAUDE.md describe cuando dice que
la lógica que importa se saca a `lib/`.

### `reconciliarMarcaciones` pasa a aceptar tokens

Hoy recibe `{ fecha, raw }` y tokeniza adentro. Se parte en dos:

- el núcleo toma `{ fecha, tokens }[]`;
- la firma actual queda como envoltorio que tokeniza y delega.

**Los tests existentes no se tocan ni una línea** —siguen entrando por el
envoltorio— y el camino de Lenox entra por la puerta de tokens. La alternativa
era armar strings sintéticos `"E 08:07 - S 15:56"` para volver a parsearlos
enseguida, que funciona pero deja una ida y vuelta que no hace falta y un
formato intermedio que nadie pidió.

### `agrupar.ts` genera también los días vacíos del rango

La API devuelve sólo marcaciones que existen; el Excel trae una fila por día
aunque la celda esté vacía, y `reconciliarMarcaciones` usa esos días vacíos
para decidir cerrar un turno pendiente.

Se revisó si la diferencia muerde: **no**. La guarda de 2 a 14 horas del cruce
de medianoche ya rechaza cualquier cierre que esté a más de un día de
distancia, así que el resultado es el mismo con o sin los días vacíos. Lo que
cambia es el texto del aviso. Se generan igual, y la razón es que vamos a
mantener los dos caminos: **que produzcan la misma salida, palabra por
palabra, es lo que permite comparar uno contra otro cuando algo no cierre.**

### El cliente no interpreta nada

Devuelve las filas como vienen. Resuelve dos cosas y ninguna es de dominio: el
partido del rango en ventanas de ≤7 días, y la paginación. Que sea tonto es lo
que hace que `agrupar.ts` se pueda testear sin red.

## Las protecciones

La sincronización corre sola. Eso convierte en peligroso algo que hoy es
inofensivo: **editar una fichada no cambia su `origen`**. El `PUT` de
[`fichadas/[id]`](../../../app/api/rrhh/fichadas/[id]/route.ts) toca las horas
y deja la fila en `IMPORTADO`, y el import borra todas las `IMPORTADO` del día
antes de insertar. Hoy casi no muerde porque el que sube el Excel sabe que está
pisando un período. Un cron diario pisa sin que nadie se entere, que es la peor
forma de todas.

### Por qué la unidad es el día y no la fichada

La primera idea fue un tercer valor `CORREGIDO` en el enum `origen_fichada`. No
alcanza, por dos razones:

1. **La sync no reemplaza fichadas, reemplaza días.** Si se protege la fila
   corregida pero se reinserta el día, queda la corregida *y* vuelve la
   importada: el día duplicado.
2. **Borrar no deja rastro.** El caso es concreto: una marca fantasma a 40
   minutos de la anterior (el filtro sólo descarta las de ≤5 min) arma un turno
   falso de 40 minutos; alguien lo borra; mañana el cron lo vuelve a crear.
   Todos los días, para siempre. Con el enum no se arregla, porque la fila que
   lo probaría ya no existe.

### 1 · El día que tocó una persona

```sql
rrhh_dias_corregidos (
  id          uuid primary key,
  empleado_id uuid not null references empleados(id) on delete cascade,
  fecha       date not null,
  usuario_id  uuid not null references usuarios(id),
  accion      text not null,     -- creada | editada | borrada
  created_at  timestamptz not null default now(),
  unique (empleado_id, fecha)
)
```

La escriben los tres verbos que significan "una persona tocó este día": el
`POST` de alta manual de `/api/rrhh/fichadas`, y el `PUT` y el `DELETE` de
`/api/rrhh/fichadas/[id]`. La sincronización saltea cualquier
`(empleado, fecha)` que esté acá.

Cubre la edición, el alta y el borrado con **un solo mecanismo**, es explícito
en vez de derivado, y no toca ningún enum — con lo que la trampa del `55P04` no
entra en juego. El `accion` no decide nada: está para que cuando alguien
pregunte "¿por qué este día no se actualiza?", la respuesta esté escrita.

### 2 · El período ya liquidado

Un `(empleado, fecha)` que cae dentro de una fila de `liquidaciones` con
`estado = 'CERRADA'` (`fecha_desde ≤ fecha ≤ fecha_hasta`) no se toca. Protege
algo distinto de lo anterior: que un cambio tardío en Lenox le mueva las horas
a un mes ya pagado.

Las cerradas se cargan una vez por corrida. Son 70 empleados: es una consulta.

### 3 · El aviso de divergencia

Saltear en silencio es casi tan malo como pisar. Cuando un día se saltea por
cualquiera de las dos razones de arriba, se compara lo guardado contra lo que
trae Lenox y, si difieren, sale un aviso:

```
Legajo PC_204, 2026-10-02: corregido a mano (07:58–16:03),
Lenox ahora trae 08:12–16:03
```

**Nunca pisa.** Es la misma regla que gobierna los enlaces por texto libre en
las planillas: cuando no hay certeza, se informa y se deja que decida una
persona. Pisar a quien corrigió es peor que avisarle.

## Dónde quedan los avisos

Se reusa `rrhh_import_batches` tal cual: ya tiene `nombre_archivo`,
`cantidad_registros`, `cantidad_errores` y `log_detalle`, y es donde la gente
ya los busca. Requiere **un solo cambio**: `usuario_id` pasa a nullable, porque
el cron no tiene usuario. El `nombre_archivo` lleva `Lenox API · 30/09 → 06/10`.

Aparte va `registrarSincronizacion({ modulo: "rrhh", recurso: "lenox-marcaciones" })`
de [`lib/core/sincronizaciones.ts`](../../../lib/core/sincronizaciones.ts),
que alimenta el cartel de "actualizado hace…" a través de la vista
`ultima_sincronizacion`. Se anota **también cuando falla**, con lo que dijo
Lenox sin traducir — la misma regla que ya rige para los errores de Google.

## Las rutas

| Ruta | Cuándo | Qué hace |
|---|---|---|
| `app/api/cron/rrhh-lenox-sync` | `30 10 * * *` | Los últimos **7 días**: una sola llamada |
| `POST /api/rrhh/fichadas/lenox/sincronizar` | El botón | Toma `{ desde, hasta }` y parte en ventanas de 7 |

La hora no es arbitraria. `30 10` UTC son las 7:30 de acá: después de que
cierre el turno noche (que termina alrededor de las 4) y antes de que alguien
abra la pantalla. Es además un hueco libre entre los ocho crons que ya hay, que
se amontonan entre las 6 y las 9:30 UTC.

El cron usa `revisarElSecreto` de [`lib/core/cron.ts`](../../../lib/core/cron.ts),
que falla cerrado, y `maxDuration = 300` como los demás. Sin `LENOX_API_KEY`
devuelve `{ omitido: "Lenox no está configurado" }` y **no es un error**, igual
que hace [`calidad-sync`](../../../app/api/cron/calidad-sync/route.ts) cuando
no hay Odoo.

## El cotejo de empleados

Va dentro de la misma corrida, no en una pantalla aparte: `GetEmpleados` contra
la tabla `empleados`, y el resultado suma dos avisos al mismo `log_detalle`:

- legajos que Lenox tiene y el SdG no (el alta que todavía no se cargó);
- empleados activos en el SdG que Lenox trae con `fechaBaja` (la baja que
  todavía no se cargó).

**No crea ni borra nada.** Los catálogos del núcleo se leen; no se rehacen
desde un módulo. Lo que hace es adelantar el aviso: hoy un alta sin cargar
aparece como `legajo "PC_241" no encontrado` después de que falló el import, y
con esto aparece antes y con nombre y apellido.

## La pantalla

`/rrhh/fichadas` queda así, de arriba a abajo:

1. El cartel de última sincronización (cuándo, y si falló, por qué).
2. El botón **"Traer de Lenox"** con rango de fechas, por defecto los últimos
   7 días.
3. El resultado: insertados, días salteados y por qué, avisos de divergencia,
   legajos desconocidos.
4. **El import de Excel, plegado.** Sigue entero.
5. El listado de fichadas, como está.

Los desplegables que haga falta agregar van con `<Select>`, nunca `<select>`.

## Lo que se testea

Vitest sobre funciones puras, que es donde están las decisiones:

| Qué | Por qué |
|---|---|
| `ventanasDe(desde, hasta)` | El tope de 7 días es de la API, no nuestro: si se rompe, se rompe en silencio |
| Paginación del cliente, con `fetch` mockeado | El tope de filas no está documentado; el test fija el comportamiento que elegimos |
| `agrupar.ts` | Días vacíos, orden por hora, legajo desconocido |
| El núcleo de `reconciliarMarcaciones` por tokens | Que el envoltorio dé idéntico a hoy — es lo que permite no tocar los tests viejos |
| `aplicar.ts` | Día protegido se saltea · liquidación cerrada se saltea · divergencia se detecta · dedup |

El último es el que más valor agrega, porque esa lógica hoy no tiene un solo
test: vive dentro de una ruta.

## Las migraciones

Dos archivos, con marca de tiempo (`npm run migracion`), que **corre el usuario
a mano en el editor SQL de Supabase**. El plan queda a la espera ahí.

1. `rrhh_dias_corregidos` — tabla, índice, RLS (`select` con
   `tiene_acceso_rrhh()`, `insert` con `puede_editar_rrhh()`).
2. `rrhh_import_batches.usuario_id` pasa a nullable.

Ninguna toca un enum.

## Variables

`LENOX_API_KEY` — la clave de empresa que va en el header
`LenoxBusinessAPI-Key`. Se agrega a
[docs/VARIABLES-VERCEL.md](../../VARIABLES-VERCEL.md). **Al 07/10/2026
todavía no está**: hay que activar la API desde la plataforma de Lenox. Es la
tarea 1 del plan y bloquea todo lo que sea medir contra la API real, aunque no
bloquea escribir ni testear nada de lo puro.

## Lo que queda fuera, a propósito

- **`FechaJornada` y `GetDiasTrabajados`.** Lenox tiene su propio concepto de
  "jornada" que resuelve el cruce de medianoche. Usarlo sería cambiar un motor
  con tests por uno sin tests, para resolver un problema que ya está resuelto.
  Se usa `Desde`/`Hasta` y se agrupa por `marcacionFecha`, que reproduce
  exactamente la entrada que recibe hoy el camino del Excel.
- **`precioHora`.** Viene en la respuesta de `GetEmpleados` y no se toca. El
  valor hora vive en `rrhh_empleados_datos` detrás de `tiene_acceso_rrhh()`
  desde el 22/09/2026, y esa decisión no se revisa acá.
- **`GetLicencias`, `GetVacaciones`, `GetFeriados`.** El SdG ya tiene
  `/rrhh/ausencias`, `/rrhh/vacaciones` y `/rrhh/feriados` con datos propios.
  Traerlos abre la pregunta de cuál de los dos manda, y esa pregunta merece su
  propio diseño. El cliente HTTP queda escrito y probado para cuando toque.
- **Sacar el import de Excel.** Se queda como respaldo. Si Lenox se cae, cambia
  la clave, o hace falta cargar un período viejo largo de un tirón, el camino
  sigue estando.

## Lo que se midió contra la API real (07/10/2026)

Las cinco incógnitas que este spec dejó abiertas, contestadas contra
producción. Tres de las respuestas cambian el código del cliente, y dos de ésas
no se deducen de la documentación.

| | Respuesta medida |
|---|---|
| ¿`GetMarcaciones` sin `Legajo` devuelve a todos? | **Sí.** 7 días = 735 filas de 62 legajos, en una sola llamada |
| ¿Tope de filas por respuesta? | **No hay página.** Devuelve todo lo que queda desde el offset |
| ¿El `legajo` es el string o un id interno? | **El string**: `EXT_001`, `PS_006`, `PC_077` |
| ¿Qué trae `tipoMarcacion`? | **`"Por Reloj"` y `"GeoCerca"`** — no los de la doc |
| ¿Hay límite de llamadas? | **Sí, y duro.** Ver abajo |

**El enganche por legajo funciona tal cual.** Era el supuesto del que colgaba
todo y el único sin plan B.

**El tope de 7 días lo impone el servidor**, no es una precaución nuestra: con
8 devuelve `400` y el mensaje *"La cantidad de dias entre las fechas desde y
hasta no debe superar los 7 días"*. Partir el rango es obligatorio.

**`FilasExcluidas` es un offset real** —con `10` devuelve 725 de 735 y la fila
11 pasa a ser la 1— pero devuelve **todo lo que queda**, no una página. Con 70
empleados nunca vamos a ver un corte. La paginación queda igual como red, con
el `mensaje` (`"Se muestran todos los resultados"`) como camino rápido para no
gastar una llamada de más.

### Las tres cosas que cambian el código

**1. Un rango sin datos devuelve `204` con el cuerpo vacío.** `res.ok` es
`true` para un 204, así que no cae en la rama de error, y `await res.json()`
sobre un cuerpo vacío **lanza**. Un fin de semana largo lo habría roto. El
cliente tiene que tratar el 204 como "cero filas" antes de intentar parsear.

**2. Hay límite de llamadas, y la API no dice cuál.** Alcanzaron unas doce
llamadas seguidas para recibir `429`. La respuesta **no trae `Retry-After`, ni
ningún header de límite, ni cuerpo**: `content-length: 0`. Medido, la ventana
no es de segundos — **a los 4 minutos seguía bloqueada**.

Consecuencias de diseño:
- El **cron** hace **una sola llamada** por corrida (7 días), más una de
  `GetEmpleados` para el cotejo. Está muy lejos del límite.
- El **botón** con un rango de un mes son 5 llamadas más la del cotejo. Es el
  que puede tocarlo.
- **No se reintenta un `429`**: sin `Retry-After` cualquier espera es inventada,
  y reintentar sobre un límite que no se conoce lo empeora. Se corta, se
  registra en `sincronizaciones` con el texto tal cual, y se le dice a la
  persona que espere y vuelva a intentar. Es la misma regla que con Google: lo
  que dijo el servicio, sin traducir.

**3. El tipo `MarcacionLenox` de la doc está incompleto.** Los datos reales
traen además `justificada`, `longitud` y `latitud`. Y `tipoMarcacion` no es
`"Manual"`/`"GEOLOCALIZADA"` como en los ejemplos, sino **`"Por Reloj"`** y
**`"GeoCerca"`**: hay gente fichando por geocerca desde el teléfono, no sólo en
el reloj de portería. No cambia la reconciliación —una marca es una marca— pero
conviene saberlo antes de que alguien pregunte por qué un fichaje no tiene
reloj asociado (`reloj` es `"porteria"` o `null`).

### Dos datos más, que no eran incógnitas

**Latencia:** la primera llamada tardó 12 segundos; las siguientes entre 0,5 y
5. Un mes son 5 llamadas, bien dentro del `maxDuration = 300` de los crons.

**Lenox tiene 73 empleados y el SdG 70**, con 2 marcados con `fechaBaja`. El
cotejo del padrón va a tener algo que decir desde el primer día, que es
exactamente para lo que está.

### Lo que falta probar, y no se puede todavía

Un día de datos reales comparado contra el Excel del mismo día, **fichada por
fichada**. Es la prueba que cierra esto —es lo que se hizo el 27/08/2026 con el
desfasaje de 3 horas y lo que lo dejó resuelto de verdad— y necesita el cliente
escrito, que es la tarea siguiente.

## Riesgos asumidos

**La ventana del cron es de 7 días.** Se eligió 7 sobre 14 a pedido. La
consecuencia concreta: si nadie mira durante más de una semana, los días más
viejos que 7 **no se recuperan solos** — hay que usar el botón. Dado que el
hueco medido al escribir esto era de seis días, el margen es de un día. Si
vuelve a pasar, subir el número es cambiar una constante y sumar una llamada
por corrida.

**La corrección manual gana siempre.** Si alguien corrige un día a mano y
después se arregla la marcación en Lenox, la local sigue tapando a la buena
hasta que una persona lea el aviso y actúe. Es deliberado: la alternativa es
que el sistema le pise el trabajo a quien corrigió.

**Dos caminos de carga.** El Excel se queda, y un camino que no se usa
envejece. Lo que lo acota es que los dos comparten `aplicar.ts`: lo que puede
envejecer es el parseo del archivo, no el alta.

**Las protecciones miran el día de entrada, no el de salida.** Un turno que
entra en un día libre y **sale** en un día que cae dentro de una liquidación
`CERRADA` se aplica igual, y el recálculo reescribe las horas de ese día
cerrado. Se evaluó y se decidió **no cerrarlo**, por tres razones:

- Para que ocurra hace falta que el período posterior se haya liquidado
  **antes** que el anterior. Con las liquidaciones cerradas en orden, el borde
  mensual no lo dispara: si el día de entrada es el último del mes anterior y
  ese mes ya está cerrado, ese día queda protegido por la regla que ya existe.
- La semántica no tiene una respuesta buena. Si el día de salida está
  protegido, saltear el turno entero deja el día de entrada sin reemplazar —y
  ése no estaba protegido—. Elegir entre las dos sin un caso real es adivinar.
- Cerrarlo cuesta unas 25 líneas y seis tests, y toca el contrato de
  `TurnoNuevo`, de `contextoDe` y de `decidirQueAplicar`.

Queda escrito acá para que se encuentre si alguna vez aparece: el síntoma
serían horas que cambian en un mes ya liquidado, en un empleado con turno
nocturno, el día siguiente a un día no liquidado.

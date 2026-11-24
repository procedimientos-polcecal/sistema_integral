# La OT que se cerró antes de empezar (Agenda) — diseño

**24/11/2026 · cambio chico**

## Qué pasa hoy y por qué molesta

Una OT que estaba programada para hoy, que se hizo y se cerró el 18, aparece en
la Agenda —y en los cinco calendarios de Google— como un turno de hoy. El
evento de una OT **no se toca cuando la orden se cierra**: lo corta
`planDelEvento` en su primera línea, con el argumento escrito de que «el evento
pasado es el registro de lo que se planificó». Para una orden cerrada *después*
de su inicio eso es cierto: el evento quedó en el día en que se planificó y el
trabajo se hizo alrededor de ahí. Para una cerrada **antes** de su inicio no:
el evento queda adelante, prometiendo trabajo que ya está hecho.

Medido contra producción el 24/11/2026:

- **73 de 2.270** OT con las dos fechas cierran antes de empezar (52
  PROGRAMADO · 21 CORRECTIVO). Eran 66 el 12/11, y **10 entraron por la app**
  contra 3 entonces.
- De los **78 eventos con `ot_id`** que hay en la Agenda, **7 caen en un día
  posterior al cierre de su OT**: las 2970, 3096, 3097, 3122, 3149, 3152 y
  3162. El de la **3149 es el de hoy**, para trabajo cerrado el 18.
- **Seis de esos siete son del ciclo de martillos**, que nace con fecha
  adelante y se cierra antes de llegar a ella. O sea que esto no es un resto
  histórico: **crece con ese mecanismo**.
- Las otras 66 no tienen evento —son anteriores al 04/11, cuando la Agenda
  empezó a recibir OT, o entraron por la planilla—.

## Qué tiene que pasar

El evento de una OT cerrada antes de su fecha de inicio **pasa al día del
cierre**, en la fila y en Google.

### Objetivos

- Que una orden cerrada antes de empezar se vea, en `/agenda` y en los cinco
  calendarios, el día en que se cerró.
- **Una sola definición de «qué día es este evento».** Ningún mecanismo nuevo:
  la maquinaria de mover, apilar, respetar lo divergido y encolar lo que Google
  rechazó ya existe y se reusa entera.
- Idempotente: la sincronización corre cada diez minutos, y un evento que se
  reescribe en cada corrida vuelve a alertar en cada corrida.

### No objetivos

- **No se le crea evento a una OT cerrada que no lo tiene.** Son 66 de las 73.
  Una OT cerrada nunca recibe un evento nuevo (`esCandidataAlCalendario`), y esa
  regla no se toca: el evento nace sólo si la fecha no pasó porque 574 de 780
  órdenes (73,6 %) tienen la ejecución anterior al alta, y sin ese freno nueve
  de cada diez eventos serían del pasado.
- **No se toca la OT cerrada normal** —cierre en o después del inicio—. Sigue
  valiendo la regla 3 tal cual.
- No se avisa a nadie: los eventos de OT se escriben con `sendUpdates=none`
  (`avisaALosInvitados()`), así que esto no manda ni una invitación.
- Sin migración: no hace falta ninguna columna.

### Anti objetivos (lo que lo volvería un fracaso aunque funcione)

- **Que una OT cerrada normal empiece a mover su evento** porque el corte de
  «cerrada no se toca» se aflojó de más. Esa regla está medida: mirar sólo
  `fecha_cierre` dejaba pasar 168 de 986 OT en `REALIZADO` (17 %), que seguían
  moviendo su evento futuro cada vez que la planilla les tocaba la fecha.
- **Que el evento se pinte en un día y el apilado se cuente contra otro.** Es
  la misma trampa que ya mordió en el mes de órdenes: la grilla usaba la fecha
  pendiente y `postergar` contaba sobre `fecha_ejecucion`, y la orden iba a un
  día que nadie eligió, sin error y sin aviso. Acá sería que el evento se mueva
  al día del cierre y el hueco se calcule sobre el día del inicio, dejándolo
  encima de otro de su especialidad.
- **Que un año mal tipeado se lleve un evento diez años atrás**, a cinco
  calendarios donde nadie lo va a encontrar.
- Que el movimiento se repita en cada corrida.

### Restricciones

- Todo en castellano.
- `fecha_cierre` y `fecha_ejecucion` son `date` en Postgres y se comparan
  **como texto**: en `AAAA-MM-DD` el orden alfabético es el cronológico, y
  parsearlas a `Date` metería la zona del servidor (UTC) en un día que es de
  Argentina.
- El movimiento va por `moverElEvento`: **la fila primero, después Google,
  después lo que Google dijo**, con `google_pendiente` escrito en el mismo
  `update` que el horario nuevo.
- **Un evento que divergió en Google no se pisa**, y eso no cambia acá.
- El presupuesto de Google por corrida y el conteo de huecos que ya tiene
  `seguirALasOT` valen igual.

## Las maneras que se consideraron

**A. La fecha que manda en el evento pasa a ser la del cierre.** *(la elegida)*
Una función pura decide la fecha autoritativa de un evento de OT; cuando el
cierre es anterior al inicio, esa fecha es `fecha_cierre`. El movimiento, la
hora desde el turno, el apilado en el día nuevo, el respeto a lo divergido y la
cola de Google son los que ya están. Queda idempotente por construcción: la
corrida siguiente encuentra el evento en el día que la función nombra y
contesta «ya está ahí». Lo elegido porque no agrega ningún mecanismo y deja una
sola definición de qué día es un evento de OT.

**B. Mover sólo los eventos que todavía no pasaron.** El mismo mecanismo con un
«y el evento es de hoy o más adelante»: hoy movería 1 de los 7, justo el que se
vio. Descartada porque **la regla pasaría a depender de cuándo mire el cron**:
si una sincronización se atrasa a después de medianoche, el mismo evento deja
de moverse y nada lo dice. Además deja los siete ya pasados diciendo lo que no
pasó, y las vistas de semana y lista de `/agenda` miran también hacia atrás.

**C. Dejar el evento quieto en Google y dibujarlo en el día del cierre sólo en
`/agenda`.** No escribe nada afuera. Descartada porque el SdG y Google pasarían
a decir cosas distintas a propósito —al revés de «el SdG manda y Google es el
espejo»— y porque los cinco que miran su propio calendario, que es para lo que
el evento existe, seguirían viendo el día equivocado.

**D. Borrar el evento al cerrarse antes de empezar.** Lo más barato. Descartada
porque lo pedido es que **aparezca** en el día del cierre: borrarlo pierde
cuándo se hizo el trabajo, que es justo el dato que faltaba.

## Cómo se hace

**1. Una función pura que diga qué pasa con el cierre adelantado**, en
`lib/agenda/evento.ts`, al lado de `fechaParaElCalendario` y `laOTEstaCerrada`,
que son las dos que necesita. Tiene **tres respuestas y no dos**, porque el año
mal tipeado no es ni «mover» ni «no es el caso»:

- `{ tipo: "mover", fecha }` — la OT está cerrada, `fecha_cierre` es un día
  válido y es anterior a `fechaParaElCalendario(o)`, con una brecha de 365 días
  o menos. `fecha` es la del cierre.
- `{ tipo: "no-creible", cierre, inicio, dias }` — lo mismo pero con más de un
  año de brecha. **El corte sale de la medición y no de un número redondo**: de
  las 73, 63 tienen 7 días o menos, 9 van de 14 a 89 —cierres adelantados de
  verdad, y uno es un CORRECTIVO cerrado 69 días antes de un inicio que la
  planilla seguía anunciando— y **una sola pasa el año: la OT 953, cerrada en
  «2016-01-28» contra un inicio del 2026-01-27**, que es un 2016 por un 2026 y
  sería un día de brecha bien escrito. Un año separa ese caso de todos los
  demás y de ninguno de los buenos.
- `null` — no es el caso: la OT no está cerrada, no tiene fecha de cierre
  legible, o se cerró en o después de su inicio.

**2. `planDelEvento` abre la excepción en su primer corte.** Hoy
`if (laOTEstaCerrada(fila.orden)) return NADA;`. Pasa a consultar la función de
arriba cuando la orden está cerrada: `null` devuelve `NADA` igual que hoy;
`no-creible` devuelve un `avisar` con el motivo (que el propio
`if (fila.aviso === decision.motivo) return NADA` de esa función ya vuelve
idempotente); `mover` sigue por `queHacerConElEvento` con la fecha del cierre
en lugar de la del inicio, y de ahí en adelante todo es lo de siempre —incluido
que sin turno del taller se avise en vez de mover, y que un evento divergido no
se pise—.

**3. `seguirALasOT` arma el `destino` del apilado con la misma función.** Hoy
calcula `fechaNueva = fechaParaElCalendario(orden)` y de ahí
`claveDelHueco(fechaNueva, especialidad, turno)`. Si la fecha que manda pasa a
ser otra y ésta no la acompaña, el evento se mueve al día del cierre y el hueco
se cuenta en el día del inicio: el anti objetivo de arriba. **Es la línea que
sostiene la decisión entera** y la que hay que mirar primero si algo sale mal.

**4. Lo que esto no toca, y conviene saber que se revisó**: los otros dos
lectores de `laOTEstaCerrada` —`problemasDeMandarLaOT` (mandar una OT a mano) y
`esCandidataAlCalendario` (el nacimiento)— siguen diciendo que una orden cerrada
no va al calendario. El cambio vive en las dos puntas de la sincronización y en
ningún lado más.

**5. La primera corrida mueve siete** —las 2970, 3096, 3097, 3122, 3149, 3152 y
3162—, las siete a un día ya pasado (seis venían de un día pasado; la 3149, de
hoy), y después queda en régimen. Lo que hay que comprobar no es que sean siete
—seis son del ciclo de martillos y eso crece— sino que toda orden listada tenga
`fecha_cierre` anterior a su inicio, que es lo que imprime el script.

### Lo que se prueba

Vitest sobre las dos funciones puras, que es donde están las decisiones: la
nueva (las tres respuestas, el corte del año, el cierre igual al inicio, la
fecha pendiente ganándole a la de la planilla) y `planDelEvento` con una OT
cerrada antes de empezar —que mueva, que no se mueva dos veces, que respete la
divergencia y que una cerrada normal siga sin tocarse—. `elEventoSigueALaOT.ts`
ya tiene tests de los tres casos de cerrada, incluido el de la REALIZADO sin
`fecha_cierre`; son los que no pueden ponerse en rojo.

### Lo que queda a quien lo implemente

- El texto exacto del aviso del cierre no creíble. Tiene que nombrar las dos
  fechas y la brecha, porque es lo único que permite ver que es un año mal
  tipeado sin abrir la OT.
- Si el valor del corte queda como constante exportada o como literal con su
  comentario.
- La subsección de `docs/AGENDA.md` donde esto se cuenta, y el renglón del
  `CLAUDE.md`.

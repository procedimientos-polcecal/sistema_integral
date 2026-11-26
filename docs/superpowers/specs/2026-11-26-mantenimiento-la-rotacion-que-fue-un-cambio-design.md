# La rotación que fue un cambio

**26/11/2026** · Mantenimiento · ciclos de OT encadenadas

## El problema

Un ciclo encadenado crea una OT que dice «Rotación de Martillos — a 4ª cara (3
de 3)». En la máquina no se rota: se cambian los martillos enteros, porque
estaban para cambiar.

Esa orden **no se puede cerrar**, y no por una traba del sistema: cerrarla
diría que se hizo algo que no se hizo. Así que queda abierta, el ciclo la mira
y contesta «esperar» para siempre, y el cambio que sí se hizo no queda escrito
en ningún lado.

La salida que existe hoy está en la ficha del equipo
(`CicloDeOT.tsx` → botón «Se cambiaron los martillos»), resuelve la mitad y
tiene tres defectos para este caso:

1. **Está donde no está el problema.** La persona está parada en la OT, en
   `/mantenimiento/ordenes`. Desde ahí nada dice que esto tiene salida.
2. **La fecha es siempre hoy** (`hoyEnArgentina()`, sin parámetro). Si el
   cambio fue el lunes y esto se acomoda el jueves, el ciclo reinicia tres días
   tarde y **todas** las rotaciones siguientes quedan corridas.
3. **El cambio no queda como OT.** Se cancela la rotación y se mueve el corte;
   del cambio sólo queda una nota sobre una orden cancelada. Sin horas, sin
   operarios, sin fila en el master, sin costo.

## Lo que se midió, el 26/11/2026, contra producción

Cuatro ciclos, los cuatro activos, 456 OT en esos equipos.

| Equipo | Corte (`desde`) | OT abierta del ciclo | Cambios cerrados en el historial |
|---|---|---|---|
| PY-A1-05 Rompedora a martillos | 14/11, vuelta 0 | **3150**, vuelta 3, ATRASADO | 17 (05/12/2025 → 14/11/2026) |
| PY-B1-06 Molino a martillos | 15/11, vuelta 0 | **3197**, vuelta 3, POR_HACER | 17 (04/12/2025 → 15/11/2026) |
| PY-C1-03 Molino a martillos | 31/10, vuelta 0 | **3198**, vuelta 2, POR_HACER | 7 (05/02/2026 → 31/10/2026) |
| PO-C1-04 Molino a martillos | 21/11, vuelta 0 | **3190**, vuelta 3, POR_HACER | 33 (11/12/2025 → 21/11/2026) |

Tres cosas de ahí:

**Hoy el botón aparecería en cuatro órdenes, una por equipo.** No es una
función que haya que esperar a que tenga caso: tiene cuatro desde el día uno.

**Nunca se canceló una OT de estos equipos. Cero de 456.** O sea que el camino
que hoy resuelve la rotación —el botón de la ficha— **no se usó jamás en
producción**. Lo que se construya acá va a ser la primera vez que esa mitad
corra con datos de verdad.

**Y el dato que cambia el peso de todo esto:** entre cambio y cambio de
martillos, contando cuántas rotaciones quedaron registradas en el medio, sobre
**70 intervalos** en los cuatro equipos:

| | |
|---|---|
| con **menos** de 3 rotaciones | **60** |
| con exactamente 3 | 8 |
| con más de 3 | 2 |

Veintiún intervalos tienen **cero** rotaciones entre dos cambios.

La salvedad, que importa y hay que decirla: eso cuenta rotaciones
**registradas**, no rotaciones hechas, y casi todos esos intervalos son
anteriores al ciclo —de las 248 órdenes de martillos medidas el 12/11/2026,
225 ni siquiera nacieron en el sistema—. Puede que se rotara sin escribirlo.
Pero las dos lecturas llevan al mismo lugar: **que llegue un cambio antes de
que el ciclo termine sus rotaciones no es el caso raro, es el caso normal.**
Si se saltean, esto pasa seguido; si se rotan y no se escriben, la OT del
ciclo queda abierta igual y el botón se va a usar igual.

Por eso esto no puede ser una salida de emergencia escondida. Es una acción de
primera línea, y tiene que ser rápida para quien acomoda las órdenes.

*(Una observación que sale de la misma medición y que **no** es parte de este
trabajo: puede que `repeticiones: 3` no sea lo que pasa en la planta. Eso se
revisa y se cambia desde «Lo que crea órdenes solo», en la Configuración de
Mantenimiento. Acá no se toca.)*

## Intención

Que desde la OT de rotación que quedó sin sentido se pueda decir, en un paso:
**«esto no fue una rotación, fue un cambio de martillos; se hizo tal día»** — y
que de ahí salgan las dos verdades escritas: la orden del cambio que sí se
hizo, y la rotación cancelada con su motivo.

El ciclo queda consistente como consecuencia, no como un paso aparte.

## Quién lo usa

**El que acomoda las órdenes**, no el que estuvo en la máquina. Dicho por el
usuario. De ahí salen dos decisiones:

- La fecha del cambio **se pregunta y es obligatoria**, y **no arranca en hoy**.
  Es el mismo criterio que ya tiene `RegistrarOTModal` desde el 16/11/2026, con
  su razón escrita: «quien registra el jueves un lunes aceptaba el lunes sin
  mirar, y de esa fecha viven el MTTR y el historial del equipo».
- **Las horas y los tres operarios** se ofrecen pero **no se exigen**. Quien
  acomoda puede no tenerlos. Una orden incompleta es peor que una completa,
  pero mucho mejor que un dato inventado, y los huecos se llenan después
  reabriendo la orden con «Registrar el trabajo».

  Que valga la pena preguntarlos está medido: de los **74 cambios de martillos
  cerrados** en los cuatro equipos, **62 tienen horas y 61 tienen operario 1**.
  Quien acomoda las órdenes normalmente sí tiene el dato.

## Objetivos

- Resolver la OT de rotación sin cerrarla en falso.
- Dejar el cambio como una **OT de verdad**: en el historial del equipo, con su
  fila en el master, sus horas y su gente.
- Que la fecha que manda sea **la del trabajo** y no la del clic.
- Que el ciclo siga desde ahí, sin un mecanismo nuevo que mantener.

## No objetivos

- No se toca el botón de la ficha del equipo. Sigue existiendo y sigue
  sirviendo para el caso en que no hay ninguna OT abierta.
- No se cargan repuestos en este formulario. La OT nueva los recibe después
  desde el `RepuestosOTModal` del listado, que ya funciona sobre cualquier
  orden.
- No se pregunta la falla (modo / causa / detalle). Un cambio de martillos
  entra como PROGRAMADO / INTERNO, igual que lo genera el ciclo, y las OT del
  ciclo nunca tuvieron falla.
- **No se pregunta el contratista, y `quien` queda en INTERNO.** Medido: de
  los 74 cambios de martillos cerrados en estos cuatro equipos, **74 son
  INTERNO y cero tienen contratista**. Ofrecer el campo y dejar `quien` fijo
  produciría una fila que se contradice y que el resto del sistema lee mal en
  dos lugares a la vez: `costoEquipo` da cero mano de obra propia en cuanto hay
  contratista, y `loQueFaltaParaCerrar` con INTERNO pide operarios y no pide el
  contratista. El día que un tercero haga el cambio, la orden ya existe y se
  corrige desde «Registrar el trabajo», que sí ofrece ese campo.
- **No se piden observaciones.** No tienen columna en `ordenes_trabajo` —
  `repartirRegistroDeOT` las deja fuera del update a propósito, y meterlas
  reproduce el «Could not find the 'observaciones' column» que este repo ya
  tuvo—: viven sólo en la celda W de la planilla. Y la W de una orden recién
  creada no se puede escribir, porque su fila llega al master por
  `IMPORTRANGE` minutos después; peor, `elPendienteDelIntento` **no encola** un
  fallo de observaciones a propósito, porque la cola rearma el registro desde
  la fila y de ahí no salen. O sea que el campo perdería lo escrito **sin un
  solo error**. Se agregan después, reabriendo la orden con «Registrar el
  trabajo», cuando la fila ya existe.
- No se generaliza a «esta OT fue otra tarea cualquiera». Dentro de un ciclo
  hay exactamente dos tareas; si la orden es la hija, lo único que pudo haber
  sido es la madre.

## Anti-objetivos

Qué haría que esto fracasara aunque funcione:

- **Que el ciclo retroceda.** Si la fecha del cambio pudiera ser anterior al
  corte, `elCorteQueSigue` movería `desde` hacia atrás y el ciclo volvería a
  pedir rotaciones ya hechas. Es, palabra por palabra, la razón que quien pidió
  los ciclos nombró para dejar de confiar en ellos.
- **Que quede la rotación cancelada y ningún cambio registrado.** Peor que no
  hacer nada: el ciclo arrancaría de cero sobre el corte viejo, en silencio.
- **Que la descripción de la OT nueva mienta.** `descripcionDeLaOT` con vuelta
  0 escribe «las 3 rotaciones están hechas», que acá es falso por construcción.

## Restricciones

- **Las migraciones las corre una persona.** Esto no necesita ninguna:
  `ciclo_id`, `ciclo_vuelta`, `app_created`, `created_at_app` y
  `ordenes_trabajo_notas` ya existen y ya se usan por estos mismos caminos.
- **El GET del listado ya trae lo necesario.** `app/api/mantenimiento/ordenes`
  hace `select("*")`, así que `ciclo_id` y `ciclo_vuelta` ya llegan al cliente.
  No hay que ampliar ninguna consulta para decidir dónde mostrar el botón.
- **Toda ruta que toque un campo que se exporta tiene que exportar**, o dejar
  el pendiente anotado. Esta ruta escribe dos filas de la planilla, así que va
  con cola (`sheets_pendiente` + `elPendienteDelIntento`) y **tiene que
  declararse en el registro de `scripts/revisar-exportaciones.mjs`** con
  estrategia `cola`, o ese script sale en ROMPE.
- **Nada va como texto crudo a una celda.** La descripción y la observación
  pasan por `textoParaLaCelda()`, como todo lo demás que tipea una persona.
- El permiso es `puedeEditarMantenimiento`, el mismo del reinicio y del alta.

## Las tres maneras que se consideraron

**A — Una ruta propia que hace las dos cosas del lado del servidor.** Un modal
pide la fecha y lo que se sepa; un solo POST crea la OT del cambio ya cerrada y
**dentro del ciclo**, cancela la rotación con el motivo escrito, la saca del
ciclo y deja el corte en la fecha del cambio. De ahí en adelante el ciclo sigue
con la maquinaria de siempre, sin nada nuevo que mantener.

**B — Dos llamadas desde el cliente**, reusando el alta de OT y el PATCH que ya
existen. **Descartada.** El POST de `/api/mantenimiento/ordenes` no acepta
`ciclo_id`: la orden nacería fuera del ciclo y el corte no se movería nunca.
Abrirle esa puerta al alta significaría que cualquier carga puede declararse
parte de un ciclo. Y son dos escrituras sin transacción, con un final partido
en el que el ciclo queda mal y nada avisa.

**C — Convertir la rotación en el cambio**: cambiarle la vuelta y la
descripción a la orden que ya existe, y que la persona la cierre con «Registrar
el trabajo» como siempre. Más barata, conserva el número que ya está en la
planilla y nadie cierra trabajo ajeno desde un botón. **Descartada** por lo que
pierde: el registro de que esa rotación existió y no se hizo. Hoy el reinicio
se toma el trabajo de dejarla cancelada y con el motivo escrito; esto lo
borraría. Y la fila del master cambiaría de tarea debajo de alguien.

**Elegida: A.** Es la única que deja las dos verdades escritas y la única donde
el ciclo queda consistente por el camino que ya existe.

## El diseño

### Dónde aparece

En el listado `/mantenimiento/ordenes`, como una acción más al lado de
«Registrar el trabajo» y «Cancelar», y **sólo** cuando la orden cumple las
tres:

- tiene `ciclo_id`,
- `ciclo_vuelta > 0` (es una hija: una rotación),
- está abierta (`estado` distinto de `REALIZADO` y de `CANCELADA`).

No hay pantalla de detalle de una OT; el listado es una pantalla con modales, y
esto es uno más.

### Qué dice el botón

**«Fue un cambio»**, y el modal se titula con el nombre real de la tarea madre
del ciclo: «Fue un cambio de martillos, no una rotación».

Esos nombres no están en la fila de la OT. El modal los pide al abrirse, con un
**GET nuevo en `app/api/mantenimiento/ciclos/[id]/route.ts`** (hoy ese archivo
sólo tiene PATCH), que devuelve: el nombre de la tarea madre, el componente,
`repeticiones` y `desde` — que además es el piso de la fecha y el modal tiene
que poder mostrarlo.

### Qué pregunta

| Campo | |
|---|---|
| **Cuándo se cambiaron** | obligatorio, arranca **vacío** |
| Horas | opcional |
| Operario 1, 2 y 3 | opcionales, los mismos desplegables del catálogo que usa el cierre |

Nada más. Por qué no están el contratista ni las observaciones, en los
no-objetivos.

Los operarios salen del catálogo y no de texto libre: las 1.223 menciones
medidas están en la columna que el catálogo les asigna, y un formato propio no
lo ofrecería después el desplegable del cierre. **La lista la trae el modal**,
con un `fetch` a `/api/mantenimiento/operarios` — que es lo que hace
`RegistrarOTModal`, y no una prop de `OrdenesClient`: lo que esa pantalla tiene
como `contratistas` es `{id, nombre}[]` para el filtro por `proveedor_id` y no
sirve para esto.

El modal es un `<Modal>` con `useBorrador`, como sus hermanos: «Cancelar» tira,
todo lo demás sale conservando.

### Las reglas de la fecha

Las tres, con su mensaje:

1. **Obligatoria.** Sin ella no hay desde dónde contar la rotación siguiente.
2. **No anterior al corte del ciclo** (`desde`). El mensaje nombra el piso:
   *«El último cambio registrado es del 21/11/2026. Una fecha anterior haría
   que el ciclo volviera atrás y pidiera rotaciones ya hechas.»*
3. **No futura.** No se registra trabajo que todavía no pasó.

Si `desde` fuera null —un ciclo sin arrancar— no hay piso; es inalcanzable,
porque una hija sólo existe si el ciclo corrió, pero la regla se escribe para
no depender de eso.

### Los dos textos

**La descripción de la OT nueva** no puede salir de `descripcionDeLaOT`, que
con vuelta 0 afirma que las rotaciones están hechas. Va una función nueva:

> `Cambio de Martillos — se hizo antes de la rotación a 4ª cara (3 de 3), que quedó cancelada en la OT 3150.`

**El motivo que se escribe en la rotación**, como nota:

> `Los martillos se cambiaron el 24/11/2026, antes de que tocara esta rotación. Quedó registrado en la OT 3211 y esta orden ya no corresponde.`

Nombra la OT nueva, que es lo que el texto de hoy no hace: hoy dice «el ciclo se
reinició» y no deja de dónde agarrarse para encontrar el trabajo.

Las dos son funciones puras, con tests, en un archivo propio de `lib/`.

### Qué hace, en orden — y por qué ese orden

Es el molde de `generarEncadenadas` y de `ciclos/[id]/reiniciar`, juntos:

1. **Validar**: sesión, `puedeEditarMantenimiento`, que la OT exista, sea de un
   ciclo, sea hija y esté abierta, y las tres reglas de la fecha.
2. **`altaEnLaPlanilla`** para la orden nueva, que es donde se reparte el
   número. Si falla, no se creó nada en ningún lado y **la rotación no se
   tocó**.
3. **Insert** de la orden nueva: `ciclo_id` el mismo, `ciclo_vuelta: 0`,
   `estado: REALIZADO`, `fecha_cierre` y `fecha_ejecucion` en la fecha del
   cambio, `tipo: PROGRAMADO`, `quien: INTERNO`, la especialidad del ciclo, y
   las tres que la protegen del borrado de espejo: `app_created`,
   `created_at_app`, `synced_at`.

   **`horas` va lo que se escribió, y `null` si no se escribió nada.** No se
   hereda `horas_estimadas` del ciclo: en una orden abierta ese número es una
   estimación y por eso el generador lo usa, pero ésta **nace cerrada**, y en
   una orden con `fecha_cierre` las horas dejan de ser una estimación y pasan a
   ser cuánto duró el trabajo — de ahí salen `horasHombreDe`, el costo por
   equipo y la columna O del master. Heredar el estimado sería exactamente el
   dato inventado que el formulario evita al no exigirlo.
4. **La nota** sobre la rotación, con el motivo. **Antes que el estado**, que es
   la regla de la casa: si la nota no entra, la rotación no se cancela. Acá
   importa el doble, porque una `CANCELADA` sin motivo es lo que
   `laCancelacionNoTieneMotivo` informa como divergencia del contraste: sonaría
   una alarma por una cancelación que el sistema hizo bien.
5. **La rotación a `CANCELADA`**, con `ciclo_id: null` y `synced_at`. El
   `ciclo_id` en null no es cosmético: una cancelada que sigue en el ciclo deja
   la decisión en `trabado`.
6. **Mover el corte del ciclo**: `desde` a la fecha del cambio,
   `vuelta_desde: 0`. Y, con el mismo argumento con el que sale la rotación,
   **sacar del ciclo (`ciclo_id: null`) toda otra orden suya cuyo
   `created_at_app` caiga en el día del cambio o después** — nunca la recién
   creada. Ver abajo: sin esto el ciclo recrea la rotación que se acaba de
   cancelar.
7. **Exportar las dos filas**, cada una con su cola: las celdas de registro de
   la orden nueva (estado, cierre, horas y los tres operarios — el contratista
   viaja en null, que es lo que esa orden es) y, en la rotación, el estado más
   la observación previa con el motivo. Lo que falle queda en
   `sheets_pendiente` con `elPendienteDelIntento`.
8. **Borrar el evento de la rotación**, con
   `borrarLosEventosDeLasOT(admin, [id de la rotación])`. Al final de todo y
   por el mismo motivo por el que el generador deja el calendario último:
   hablar con Google es lo único que puede tardar o colgar la función, y para
   este punto está todo guardado. Si no se puede borrar, esa función ya deja
   escrita la marca de borrado fallido —el único registro de un evento que
   quedó vivo en cinco calendarios— y el motivo se devuelve en la respuesta,
   sin voltear nada de lo anterior.

Los pasos 1 a 6 son la base; 7 y 8 hablan con Google y los dos tienen su red.

**Por qué el alta va primero**, que es la decisión fina de esta lista. Los dos
finales partidos no cuestan lo mismo:

- *Alta sí, cancelación no*: existe la orden del cambio (correcto: el trabajo se
  hizo) y la rotación queda abierta y en el ciclo. El ciclo igual queda bien —
  la madre recién creada ordena última, el corte se mueve a su cierre y la
  rotación cae fuera del rango—. Queda una orden suelta que alguien cancela a
  mano. **Recuperable y ruidoso.**
- *Cancelación sí, alta no*: la rotación queda cancelada citando una OT que no
  existe, del cambio no queda nada, y el ciclo —sin ninguna orden en rango—
  vuelve a crear la rotación 1 contada desde el corte **viejo**. **Mal y en
  silencio.**

Queda un final imperfecto aceptado, el mismo que ya acepta el generador: si el
insert del paso 3 falla con la fila de la planilla ya escrita, la orden existe
donde manda y la trae la sincronización — pero sin `ciclo_id`, así que el corte
no se movería. Se informa con el número de OT para que se pueda arreglar a
mano; no se inventa un rollback de la planilla.

### Por qué el corte lo mueve esta ruta, y no el generador

Esto era un agujero del primer borrador de este diseño, y vale escrito porque
produce **exactamente el anti-objetivo**, en silencio.

La idea original era no tocar el corte: una madre cerrada es lo que lo mueve, y
`elCorteQueSigue` lo haría solo en la corrida siguiente. No alcanza, porque
`laUltimaEnRango` recorta por **`created_at_app`** —cuándo se creó la fila— y
no por la fecha del trabajo, y además excluye siempre a la madre cuyo cierre
empata con el corte:

```ts
if ((o.created_at_app ?? "").slice(0, 10) < desde) return false;
if (o.ciclo_vuelta === 0 && (o.fecha_cierre ?? o.fecha_ejecucion) === desde) return false;
```

Esa segunda línea existe por un buen motivo —sin ella la madre que fijó el
corte se queda siendo «la última» para siempre y el ciclo se congela—, pero
acá la madre **nace hoy con un cierre en el pasado**, que es justo la
combinación que ese recorte no previó. Con `C` = fecha del cambio y `D0` = corte
viejo salen dos finales malos:

- **Si `C` es igual a `D0`** la madre queda excluida de entrada, el corte no se
  mueve nunca, y la última en rango vuelve a ser la hija cerrada anterior: el
  ciclo **recrea la rotación que se acaba de cancelar**.
- **Si `C` es anterior al `created_at_app` de alguna hija cerrada que siga en
  el ciclo**, el corte sí se mueve a `C`, pero entonces esa hija queda en rango
  y pasa a ser la última: el ciclo crea la **vuelta siguiente**, fechada desde
  el cierre de esa hija, o sea ya atrasada. No es hipotético: PY-C1-03 tiene
  corte 31/10 y su hija 1 nació alrededor del 01/11.

Los dos son «generar OT sobre martillos que ya se cambiaron», que es la frase
con la que quien pidió los ciclos nombró su única razón para dejar de confiar
en ellos. Y pasan sin un error: nadie mira la corrida del generador.

Mover el corte desde acá lo cierra entero, y **no inventa una punta nueva**:
las tres que pueden moverlo son la madre al cerrarse, el botón de reinicio y la
carga inicial, y ésta es la misma que el botón de reinicio — alguien afirma
desde cuándo son nuevos estos martillos. Con `desde = C`, `vuelta_desde = 0` y
ninguna otra orden del ciclo en rango, la corrida siguiente encuentra el rango
vacío y decide lo único correcto: crear la rotación 1, contada desde `C`. Si
`C + periodo` ya pasó, nace ATRASADO, que es la verdad — igual que la OT 3111
de Planta 0-2.

El desenganche del paso 7 es la otra mitad y se limita a lo que estorba: una
orden del ciclo nacida **después** del cambio habla de martillos que ya no
están, y una hija cerrada después de esa fecha además contradice al propio
cambio. Las órdenes anteriores conservan su `ciclo_id` y su `ciclo_vuelta`, que
es lo que deja contestar después cuántas rotaciones produjo cada vuelta.

### Lo que esta ruta no hace

- **No audita.** Ni cancelar una OT ni crear una están hoy entre las catorce
  acciones de `auditoria`, y esto no inaugura un criterio nuevo por la puerta
  de atrás. Quién y por qué quedan en la nota de la rotación, que lleva
  `creado_por`, y en la OT nueva, que lleva su alta.
- **No crea ningún evento de calendario.** La orden nueva nace cerrada y con
  fecha pasada, que es justamente lo que el freno de `alNacerLaOT` no manda al
  calendario. Lo que sí hace es **borrar** el de la rotación cancelada; el
  porqué está abajo.
- **No dice «reiniciar».** La palabra no aparece en la pantalla: lo que la
  persona registra es un trabajo, y que el ciclo vuelva a empezar es la
  consecuencia, no lo que se le pide.

### Por qué hay que borrar el evento a mano, si la OT queda cerrada

Un borrador anterior afirmaba que el evento de la rotación «se va solo porque
la agenda trata `CANCELADA` como cerrada». **Es falso, y conviene que quede
escrito para que nadie saque el paso 8 creyendo que sobra.**

`laOTEstaCerrada` hace que `planDelEvento` **deje de mover** el evento —«el
evento pasado es el registro de lo que se planificó», dice su comentario—, que
no es lo mismo que borrarlo. Lo único que borra eventos es
`borrarLosEventosDeLasOT`, y hasta hoy su único llamador es el borrado de
espejo (`antesDeBorrar`, en `sincronizar.ts`), que corre cuando la **fila
desaparece de la planilla** y no cuando una orden se cancela.

Sin el paso 8, cada uso de este botón deja un evento vivo en cinco calendarios
citando gente a una rotación que no se va a hacer, con fecha futura: las tres
rotaciones abiertas medidas hoy caen el 27/11, el 01/12 y el 05/12.

**El agujero no lo abre este botón** —lo tiene igual la cancelación normal
desde el PATCH de órdenes—, pero este botón lo vuelve frecuente: si los 70
intervalos medidos dicen algo, esto se va a usar seguido. Por eso se cierra
acá, a pedido.

**Queda como trabajo aparte, y no es parte de esto: la cancelación normal sigue
dejando su evento vivo.** Mientras tanto los dos caminos de cancelar hacen
cosas distintas con el calendario, que es una inconsistencia conocida y no un
descuido.

## Lo que queda a quien lo construya

- El nombre exacto de la ruta y del archivo de lógica pura. La forma sugerida
  es `app/api/mantenimiento/ordenes/[id]/fue-un-cambio/route.ts` y
  `lib/mantenimiento/cambioFueraDeTurno.ts`.
- Cómo se dibuja el botón en el listado, que ya tiene su propio patrón de
  acciones por fila.
- Si el cuerpo se valida con `zod` (`validar()` / `errorDeValidacion()`) o a
  mano: la vara es que los mensajes sean mejores que los genéricos.
- Las tres clases de test, que sí están fijadas:
  - **puras**: las dos descripciones y `loQueImpideRegistrarElCambio`, con el
    piso de la fecha y la futura.
  - **de ruta**, con `supabaseDeMentira`, porque esto es cableado y no se puede
    mudar a `lib/`: que el alta va antes que la cancelación, que una nota que
    falla no cancela nada, que la OT nueva nace con `ciclo_id` y
    `ciclo_vuelta: 0`, y que el corte queda en la fecha del cambio.
  - **del ciclo**, y éstos son los que importan: armado el estado que deja la
    ruta, `queSigueEnElCiclo` tiene que decir «crear la vuelta 1 desde la fecha
    del cambio» y `elCorteQueSigue` tiene que decir `null`. Con los **dos**
    casos del agujero: `C` igual al corte viejo, y `C` anterior al
    `created_at_app` de una hija cerrada. Un test que pase una sola OT no ve
    nada de esto — es el mismo punto ciego que dejó pasar las 426 órdenes del
    24/11/2026.
  - **del calendario**: que un borrado que falla no voltea nada de lo guardado
    y que su motivo llega en la respuesta.

## Lo que sólo se puede comprobar en la primera corrida real

- **Cancelar una OT de estos equipos nunca pasó: 0 de 456.** La mitad que
  cancela y exporta la columna M de una rotación del ciclo no se ejercitó
  nunca con datos de verdad. La primera vez conviene mirar la fila del master
  además de la pantalla.
- **Que la corrida siguiente decida «crear la rotación 1» y no otra cosa.** El
  razonamiento está arriba y es deducible del código, pero lo que lo comprueba
  de verdad es `npx tsx scripts/que-haria-el-ciclo.mts` después del primer uso:
  tiene que decir rotación 1 contada desde la fecha del cambio. Si dice la
  vuelta siguiente, o si vuelve a nombrar la rotación cancelada, el desenganche
  del paso 7 quedó corto.
- **Que el evento de la rotación desaparezca de los cinco calendarios.** El
  borrado nunca se llamó desde una cancelación: hasta hoy sólo lo dispara el
  borrado de espejo. La primera vez conviene mirar un calendario de verdad, no
  la respuesta de la ruta.
- La fila de la orden nueva llega al master por `IMPORTRANGE` segundos o
  minutos después de crearse, así que el paso 6 va a fallar casi siempre en su
  primer intento y quedar encolado. Es lo esperado y le pasa igual al
  generador; lo que hay que mirar es que el reintento la complete, no que salga
  limpia a la primera.

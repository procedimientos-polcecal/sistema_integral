# Un aviso no termina cuando nace la OT, termina cuando la OT se cierra

**16/11/2026 · acordado, sin empezar**

## Qué problema resuelve

Un aviso dice que una máquina anda mal. De un aviso sale una orden de trabajo, y
hoy las dos pantallas que muestran avisos —`/mis-avisos`, abierta a los catorce
usuarios, y `/mantenimiento/avisos`— dicen **«OT #2814»** y nada más.

Eso contesta «¿alguien lo tomó?» y deja sin contestar la que importa:
**¿se terminó de tratar?** `finalDelAviso()` devuelve `con-ot` tanto para un
aviso cuya orden se cerró hace tres semanas como para uno cuya orden está
atrasada desde diciembre. Para quien avisó, las dos cosas se ven igual.

Lo pidió el usuario con esas palabras: «que se vea en qué estado está esa OT,
para ver cuándo se cierra, es decir, cuándo se terminó de tratar». Y lo mira
**quien generó el aviso o cualquiera que quiera hacerle seguimiento** — por eso
va en las dos listas que ya existen y no en una pantalla nueva.

## Lo que se midió antes de decidir

Todo contra producción, el 16/11/2026.

**El sistema hoy no puede contestar la pregunta, aunque el dato está.** De 235
avisos:

| | |
|---|---|
| con `work_order_id` (el enlace de verdad) | **39** |
| con el número de OT sólo como texto en `ot_asignada` | **182** |
| texto que no es un número | 10 |
| sin OT (pendientes o desestimados) | 4 |

Los 182 se pueden resolver: **el número existe como OT en 182 de 182, cero
fallos.** Los 39 que sí tienen enlace vienen del «enlazar» manual del
26/10/2026 y de las OT que nacen de un aviso; **la sincronización no resuelve
`work_order_id` nunca** (verificado: esa columna no aparece en
`sincronizarAvisos`).

**El resultado útil es chico y por eso vale.** De los 221 avisos que se pueden
resolver, **208 tienen la orden REALIZADO y sólo 13 siguen abiertas**: 6
atrasadas, 5 en proceso, 2 por hacer. O sea que esta pantalla existe para
encontrar esos 13 entre 235.

**Y hay dos cosas del dato que deciden qué puede decir la pantalla:**

- De las 2.415 OT en REALIZADO, **220 no tienen `fecha_cierre`** (22 de las 208
  que le interesan a un aviso, cerca de una de cada diez). Así que **«cerrada»
  lo decide `estado` y nunca la presencia de una fecha**: la fecha se muestra
  cuando está y se calla cuando no.
- **Ninguna de las 51 OT abiertas tiene `fecha_cierre`.** La fecha, cuando
  está, es confiable; lo que no se puede es deducir el estado de su ausencia.

**El embebido ya funciona**, probado contra la base:
`avisos.select("…, ordenes_trabajo(ot_number, estado, fecha_cierre)")` devuelve
lo que hace falta y no choca con los embebidos de `equipos` y `sectores` que
esas pantallas ya traen. No hay un segundo camino de `avisos` a
`ordenes_trabajo`, así que no aparece el `PGRST201` que mordió en la mensajería.

Los `estado` posibles de una OT son cuatro: `REALIZADO` (2.415), `ATRASADO`
(20), `POR_HACER` (17) y `EN_PROCESO` (14).

## Qué se decidió

**Se resuelve el enlace de verdad y recién después se muestra.** De las tres
formas que se miraron:

- **A — resolver el número al vuelo, sólo para la pantalla.** Una consulta por
  página con los ≤50 números visibles. Sin migración y andando hoy. Se
  descartó porque el enlace queda sólo en la vista: el día que se quiera un
  aviso en la campana («3 avisos tuyos siguen abiertos») o un informe, hay que
  hacer el trabajo de nuevo.
- **B — rellenar `work_order_id` y mantenerlo. Elegida.** La columna ya existe.
  Se rellenan los 182 y la sincronización lo resuelve en cada corrida. La
  pantalla pasa a ser un embebido más.
- **C — guardar el estado del aviso como columna propia.** Descartada: duplica
  una verdad que vive en la OT y queda vieja el día que alguien cierra la
  orden. El estado del aviso es una consecuencia, no un dato.

**La sincronización tiene que resolverlo, y no sólo el relleno.** Es la misma
lección que `area_id` en octubre: sin eso, todo lo que entre del Forms mañana
vuelve a quedar sin enlace y la pantalla se congela sola. Hoy entran por ahí
casi todos los avisos.

**No se toca `finalDelAviso()`.** Contesta «¿se decidió qué hacer con esto?» y
de ella cuelgan el filtro «Sin OT» y los conteos de las dos pantallas. «¿El
trabajo terminó?» es otra pregunta y va en su propia función: meterlas en una
rompería filtros que hoy andan bien, por un valor nuevo que esos filtros no
esperan.

## Tres cosas que cambiaron después de la revisión

Lo de arriba quedó escrito antes de que un revisor leyera el diseño. Estas tres
lo corrigen y mandan sobre lo anterior.

**1. La cascada se desactiva, y necesita una migración que este diseño no
tenía.** `avisos.work_order_id` está hoy en `on delete cascade`: borrar una OT
**borra el aviso**. Está así a propósito desde el 18/10 — pero esa decisión se
tomó cuando sólo 39 avisos tenían enlace, y rellenar los 182 sube la superficie
a **221**. La sincronización borra OT que la planilla deja de traer en cada
corrida, así que no es teórico. Decidido a pedido: **pasa a `on delete set
null`**. Si la OT se va, el aviso sobrevive y vuelve a decir «sin orden». El
aviso es el reporte de una persona, no un detalle de la orden.

**2. El enlace automático sigue a la planilla; el manual no se toca nunca.** El
`.is("work_order_id", null)` que decía el diseño dejaba sin corregir un número
mal tipeado: alguien escribe 2815 en vez de 2814, la sincronización enlaza, lo
corrigen en la planilla y el aviso queda apuntando a una OT ajena para siempre
— que es justo lo que esto vino a evitar.

**La marca para distinguirlos ya existe y no hace falta una columna nueva:**
`ot_enlazada_en`, que **escribe sólo la ruta de enlazar** (migración
`20261026080748`). Entonces la regla del `UPDATE` es:

- `ot_enlazada_en is not null` → **no se toca**, lo enlazó una persona mirando
  la orden antes de confirmar.
- si no, se recalcula desde `ot_asignada` cada vez: se completa, se corrige si
  el número cambió y **se vacía si la celda quedó vacía**.

El relleno de los 182 deja `ot_enlazada_en` en null, porque no lo enlazó nadie
a mano. Eso tiene una consecuencia a mirar: hoy el desenlazar lee esa misma
combinación para decidir qué mensaje da, y a los 182 les va a decir «la OT se
generó desde el aviso», que es falso. Los sigue bloqueando, así que no hace
daño, pero el texto hay que corregirlo.

**3. `/mis-avisos` no puede leer la OT con la sesión del usuario.** Esto
invalida la comprobación de más arriba: el embebido lo probé con la
`SUPABASE_SERVICE_ROLE_KEY`, que **saltea RLS**. La pantalla lee con el cliente
del navegador, y `ordenes_trabajo` tiene el SELECT cerrado con
`mant_puede_ver()` desde la migración `20260916110349`. O sea que a los **6 de
14 usuarios sin el módulo** el embebido les devolvería null **en silencio**: la
pantalla diría «sin orden» sobre trabajo que existe.

Mi decisión: el estado de la OT para `/mis-avisos` viaja por **una ruta con el
cliente admin**, y el permiso lo pone la ruta —que es el patrón que este repo ya
usa en Disponibilidad con `ausencias`—. Se expone sólo `ot_number`, `estado` y
`fecha_cierre`: no el resto de la orden. `/mantenimiento/avisos` sí puede
embeber directo, porque a esa pantalla sólo entra quien tiene el módulo.

**Y dos que quedaron resueltas sin cambiar nada:** `ot_number` es único (2.466
de 2.466, medido), así que un número nunca resuelve a dos OT; y los dos
consumidores de `work_order_id is null` —el tablero de Mantenimiento y
`api/home/resumen`— miran **las dos columnas**, así que sus conteos no cambian.
En `resumen/route.ts` queda un comentario que dice que «sólo los generados
desde la app llenan `work_order_id`»: con esto deja de ser cierto y hay que
corregirlo.

## Lo que NO es

- **No resuelve los 9 avisos cuyo texto no es un número.** Siete dicen
  `Revision`, `-` o `si`; dos nombran **dos OT** (`1889 - 1886`, `2567-2568`).
  Se muestran con el texto crudo, como hoy. Elegir una de las dos sería
  enlazar al que se le parece.
- **No inventa una fecha de cierre** para las 22 OT cerradas que no la tienen.
  Dice «Cerrada», sin fecha.
- **No manda ningún aviso ni push.** Es una pantalla. Si después se quiere
  «tenés avisos sin cerrar» en la campana, el enlace ya va a estar — que es
  justamente por qué se eligió B.
- **No toca la planilla.** `work_order_id` es del sistema; la columna
  `OT ASIGNADA` sigue siendo la que una persona escribe a mano y la que la
  sincronización lee. Nada de esto se exporta.
- **No cambia el enlace manual** (`/api/mantenimiento/avisos/enlazar`) ni el
  desenlazar.

## Qué haría que esto fracase aunque funcione

- **Que la resolución pise un enlace que una persona hizo a mano.** El
  «enlazar» del 26/10 existe porque el número tipeado se equivoca, y la
  pantalla muestra la OT antes de confirmar. Si el relleno automático le pasa
  por encima, deshace trabajo hecho con cuidado.
- **Que se congele.** Si sólo se rellenan los 182 y la sincronización no
  resuelve, en un mes la pantalla vuelve a decir «OT #2814» a secas para todo
  lo nuevo, sin que nada avise.
- **Que «cerrada» aparezca por una fecha y no por el estado.** Hay 220 OT
  cerradas sin fecha: una pantalla que las lea al revés diría «abierta» sobre
  trabajo terminado.

## Cómo se arma

### 1. El enlace: rellenar una vez y mantenerlo

**El relleno** va como script `.mts` con corrida en seco y `--aplicar`, igual
que `scripts/rellenar-area-de-avisos.mts`. Es DML, así que lo puede correr un
agente por PostgREST. Sólo toca filas con `work_order_id is null`, y sólo
cuando `ot_asignada` es **exactamente dígitos** y ese número existe como
`ot_number`. Esperado: **182 filas**, y los otros 53 sin tocar. El relleno sí
mira `work_order_id is null` —corre una sola vez y no tiene que corregir
nada—; el que mira `ot_enlazada_en` es el de la sincronización.

**La sincronización** hace lo mismo en cada corrida, y acá está la decisión que
no se deduce:

> **Va como un `UPDATE` aparte, después del upsert, y no adentro del payload.**
> Meterlo en el upsert obliga a partir las filas en cuatro grupos —las que
> traen área nueva, las que traen enlace nuevo, las dos, ninguna—, porque
> **supabase-js arma el parámetro `columns` con la unión de las claves de todo
> el lote** y le manda `null` a la fila que no la trae
> (`node_modules/@supabase/postgrest-js/src/PostgrestQueryBuilder.ts`, la
> trampa que encontró la tarea del área en octubre). `repartirPorArea` ya parte
> en dos por ese motivo; sumar una segunda columna opcional lo vuelve
> combinatorio. Un `UPDATE` aparte lo esquiva entero y cuesta una consulta por
> corrida.

**El `where` de ese `UPDATE` es `ot_enlazada_en is null` y no
`work_order_id is null`** — es la corrección 2 de más arriba, y es lo que
permite corregir un número mal tipeado sin pisar nunca un enlace que hizo una
persona. Esa condición va **en el `where` y no sólo en el cálculo**, para que
no pise un enlace manual creado entre la lectura y la escritura.

Si esa resolución falla, **la corrida sigue** y se anota el motivo, igual que
hace hoy `area_sin_leer`: los avisos ya se guardaron y no tiene sentido
devolver un fallo por una columna que se completa sola en la próxima.

### 2. La regla de qué mostrar, en una función pura

Vive en `lib/mantenimiento/trabajoDelAviso.ts` **(mi decisión: archivo nuevo,
no dentro de `desestimarAviso.ts`)**, porque ese archivo es sobre desestimar y
esto es sobre el trabajo. Firma:

```ts
export type EstadoDelTrabajo =
  | { tipo: "cerrado"; ot: number; fecha: string | null }
  | { tipo: "abierto"; ot: number; estado: string }
  | { tipo: "sin-enlace"; texto: string }   // los 9 del texto crudo
  | { tipo: "sin-ot" };                      // pendiente o desestimado

export function estadoDelTrabajo(aviso, ot): EstadoDelTrabajo;
```

Cerrado es `estado === "REALIZADO"`, **nunca «tiene fecha»**. La fecha viaja
aparte y puede ser null.

Lleva tests con los casos medidos: REALIZADO con fecha, REALIZADO sin fecha
(son 22), las tres formas de abierta, el texto `Revision`, el texto
`1889 - 1886` y el aviso sin nada.

### 3. Las dos pantallas

Las dos agregan `ordenes_trabajo(ot_number, estado, fecha_cierre)` a su
`select()` —literal, no armado en una variable— y pintan lo que diga la
función. La columna «En qué terminó» pasa a decir:

```
OT #2814 · En proceso
OT #2790 · Cerrada el 4/11
OT #2915 · Cerrada
la planilla dice «1889 - 1886»
```

El link a la OT sigue como está: sólo para quien tenga el módulo
Mantenimiento, porque `/mantenimiento/ordenes` rebota al resto.

**En `/mis-avisos` se suma un filtro** para lo único que esta pantalla vino a
hacer posible: ver los que **siguen abiertos**. Son 13 de 235, y sin filtro hay
que recorrer cinco páginas para encontrarlos.

## Qué queda a criterio de quien lo construya

- Cómo se ve cada estado —color, etiqueta, una columna o dos—, mientras
  «cerrada» y «abierta» se distingan de un vistazo y el número de OT siga
  siendo legible.
- Si el filtro de «abiertos» es una solapa, un chip o una casilla.
- Si el `UPDATE` de la sincronización va antes o después del borrado de lo que
  la planilla no trajo; las dos sirven.
- El nombre exacto de la función y del archivo, si encuentra uno mejor.

## Cómo se verifica

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
node scripts/revisar-exportaciones.mjs
```

`revisar-exportaciones` importa acá aunque no se escriba ninguna planilla:
si marca algo, quiere decir que se tocó un camino de escritura sin querer.

Y dos comprobaciones contra el dato, que ningún test ve:

- Después del relleno, **182 avisos con enlace nuevo** y 53 sin tocar; en
  total, 221 de 235 resueltos.
- Después de la primera sincronización, que los avisos nuevos del Forms entren
  **con `work_order_id` puesto**. Es la única prueba de que no se congeló, y es
  la misma que en octubre confirmó que el área se completaba sola.

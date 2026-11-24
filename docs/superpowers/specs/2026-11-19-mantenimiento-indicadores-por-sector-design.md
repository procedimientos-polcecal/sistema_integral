# Los indicadores por sector del tablero de Mantenimiento

**19/11/2026.** Qué va en las tres secciones en que quedó partido el tablero
(`b26f9ab5`), que hoy están vacías de contenido nuevo: ese commit sólo movió
bloques de lugar.

## Para qué

El tablero contesta hoy «cómo está el parque de equipos» —cuántos operativos,
cuántos vencidos, cuántas OT por estado— y una sola pregunta de fiabilidad: los
diez equipos que menos aguantan. **Lo que no contesta es nada a nivel de
sector**, que es la unidad con la que se decide: se para Hidratación, no una
bomba; se manda el taller a Filler 1, no a una válvula.

Lo pedido, en palabras del usuario:

- **En los KPIS**: «Disponibilidad por sector, historial de disponibilidad,
  MTTF, MTBF, MTTR»
- **En evolución mensual**: «Análisis de OT´s y ordenes por sector mensual,
  Confiabilidad, Paradas de mantenimiento por sector.»
- **En gestión operativa**: «Ordenes atrasadas de la semana (por equipo y por
  sector)»

## Lo que no se hace, y por qué

**Disponibilidad por sector e historial de disponibilidad quedan sin empezar.**
El usuario dijo «Después te paso los datos para generar los indicadores»: la
disponibilidad de una planta se calcula contra horas de marcha previstas, y eso
no está en el sistema. **No se dibuja un lugar vacío que lo prometa**: una
tarjeta que dice «esperando los datos» en producción es una promesa que nadie
puede cumplir desde acá.

Ojo con el homónimo: `lib/mantenimiento/disponibilidad.ts` **no es esto**. Es la
disponibilidad de las personas del taller —quién está de franco, quién de
turno—, y se usa para la programación semanal.

## Anti-objetivos

- **Publicar un número agregado de toda la planta.** Medido el 19/11/2026: las
  981 correctivas del último año dan un MTBF de planta de **0,36 días** y una
  confiabilidad a 7 días de **0,00 %**. Es aritméticamente correcto y no dice
  nada: una planta con quince sectores tiene una correctiva cada nueve horas
  por construcción. Todo lo nuevo es **por sector**, que es lo que pidió el
  usuario y además lo único que se puede leer.
- **Dibujar un gráfico de paradas de sector.** `sectores_status_log` tiene
  **3 filas**, del 12/11 al 19/11/2026. Un gráfico de doce meses sobre eso
  dibuja once meses planos y hace creer que la planta no paró nunca.
- **Inventar un número donde no hay medición.** Los pisos que ya existen
  —`MINIMO_OBSERVADO` (14 días) y `MINIMO_REPARACIONES` (3)— valen igual acá:
  un sector sin suficiente historia dice «todavía no», no un promedio de uno.
- **Tocar lo que ya está.** Los bloques nuevos van arriba dentro de cada
  sección; nada se saca. (La única excepción, declarada y consultable abajo, es
  `diasDeAtraso`.)

## Lo que se midió, que es de donde salen las decisiones

Todo contra producción el 19/11/2026, con el `SUPABASE_SERVICE_ROLE_KEY`.

**Los sectores están en todas las OT.** De 2.531 órdenes, **2.530 tienen
`sector_id`**; de las 981 correctivas de la ventana, **981**. O sea que agregar
por sector no necesita pasar por el equipo ni por el texto de `sector_raw`, y
**entran también las 18 correctivas sin equipo enlazado** que el MTBF por
equipo tiene que tirar. El indicador por sector es, en ese sentido, más
completo que el que ya existe.

**MTBF, MTTR, MTTF y confiabilidad por sector, hoy:**

| Sector | Fallas | Observado | MTBF (d) | Rep. | MTTR (h) | MTTF (d) | R(7) | R(30) |
|---|---|---|---|---|---|---|---|---|
| Planta filler 1 | 184 | 349 | 1,9 | 127 | 2,8 | 1,8 | 2,5 % | 0,0 % |
| Planta filler 2 | 135 | 354 | 2,6 | 74 | 2,8 | 2,5 | 6,9 % | 0,0 % |
| Molienda de cal | 116 | 349 | 3,0 | 79 | 4,2 | 2,8 | 9,8 % | 0,0 % |
| Planta de trituración 1 | 116 | 354 | 3,1 | 47 | 3,9 | 2,9 | 10,1 % | 0,0 % |
| Hidratación | 112 | 351 | 3,1 | 86 | 2,9 | 3,0 | 10,7 % | 0,0 % |
| Planta 0-2 mm | 102 | 349 | 3,4 | 60 | 2,6 | 3,3 | 12,9 % | 0,0 % |
| Calcinación | 100 | 349 | 3,5 | 51 | 4,5 | 3,3 | 13,5 % | 0,0 % |
| Planta de trituración 3 | 51 | 351 | 6,9 | 11 | 3,3 | 6,7 | 36,2 % | 1,3 % |
| Planta filler 3 | 23 | 325 | 14,1 | 20 | 2,6 | 14,0 | 60,9 % | 12,0 % |
| Planta de trituración 2 | 14 | 282 | 20,1 | 0 | — | — | 70,6 % | 22,6 % |
| Servicios auxiliares | 9 | 345 | 38,3 | 2 | — | — | 83,3 % | 45,7 % |
| Taller | 8 | 345 | 43,1 | 3 | 6,0 | 42,9 | 85,0 % | 49,9 % |
| Compresores | 6 | 354 | 59,0 | 0 | — | — | 88,8 % | 60,1 % |
| Equipos móviles | 4 | 294 | 73,5 | 3 | 4,7 | 73,3 | 90,9 % | 66,5 % |
| Cantera | 1 | 343 | 343,0 | 0 | — | — | 98,0 % | 91,6 % |

De ahí salen tres decisiones y una advertencia:

1. **La confiabilidad se publica a 7 días y no a 30.** A 30 días da **0,0 % en
   los siete sectores que más fallan**, que son justamente los que alguien
   mira: una columna de ceros no ordena nada. A 7 días va de 2,5 % a 98 % y
   separa. Es además la semana, que es la unidad con la que se programa el
   taller. *Decidido por el usuario el 19/11/2026.* La ficha de un equipo sigue
   mostrando 7 y 30 —allá el MTBF es de decenas de días y los 30 sí separan—:
   son dos escalas distintas, no una inconsistencia.
2. **Cuatro sectores no tienen MTTR**, y por lo tanto tampoco MTTF, que
   necesita los dos: Trituración 2, Compresores y Cantera porque no tienen
   ninguna reparación propia con horas, y Servicios auxiliares porque tiene dos
   y el piso son tres. Dicen «—», no cero.
3. **Los días observados se cuentan por sector**, desde su primera falla de la
   ventana. No son los 365 para todos: Trituración 2 lleva 282 y Filler 3, 325.
   Es la misma regla que ya aplica `mtbf.ts` al conjunto, bajada un nivel —
   dividir por 365 le inventaría a Trituración 2 casi tres meses de buen
   funcionamiento que nadie miró.
4. **El MTTR por sector cuenta las correctivas sin equipo enlazado, y por eso
   no reusa `reparacionesDeLaVentana()`.** Esa función las descarta
   (`afuera.sinEquipo`) por una razón que acá no existe: allá el promedio se le
   imputa a un equipo, y una orden sin equipo no se le puede imputar a
   ninguno. Para un sector el dato que hace falta es `sector_id`, que esas
   órdenes **sí tienen** —las 981 correctivas de la ventana lo tienen—. Qué
   cambia, medido: **sólo Taller**, que pasa de «—» a 3 reparaciones y 6,0 h; y
   Servicios auxiliares, que pasa de 0 a 2 reparaciones y sigue bajo el piso.
   Quien lo construya va a querer reusar la función entera por economía y va a
   obtener una tabla que no es la de arriba, así que esto va escrito al lado de
   la cuenta.
5. **La advertencia: MTTF queda a dos horas de MTBF, y eso es correcto.** MTTF
   = MTBF − MTTR es lo que pidió el usuario, y con el MTTR de este sistema
   —que son las **horas de trabajo** de la reparación, no las horas que el
   equipo estuvo parado; está medido y explicado en el encabezado de
   `mttr.ts`— la resta cambia el número en un 5 % o menos. Filler 1: 1,9 → 1,8
   días. **El tooltip tiene que decir las dos cosas**: que es derivado y no
   medido, y que se le resta el trabajo y no la parada. Un MTTF que parece una
   segunda medición independiente es peor que no tenerlo.

**Las paradas de sector casi no existen todavía.** Las tres filas de
`sectores_status_log`:

| Cuándo | Sector | Cambio |
|---|---|---|
| 12/11/2026 13:26 | Planta de trituración 2 | ACTIVA → EN_REPARACIÓN |
| 16/11/2026 13:08 | Planta de trituración 2 | EN_REPARACIÓN → ACTIVA |
| 19/11/2026 13:20 | Hidratación | ACTIVA → EN_REPARACIÓN |

Una parada cerrada de 4 días y una abierta de hoy. El bloque muestra lo que hay
y **dice desde cuándo se registra**, con la fecha leída de la base y no
escrita a mano: el día que haya un año de historia, el renglón deja de llamar
la atención solo, sin que nadie lo edite.

**Las atrasadas no tienen fecha de vencimiento.** `proxima_fecha` está en null
en **todas** las filas de `ordenes_trabajo` —las 2.902 del 23/11/2026, cerradas
incluidas—, y eso no es una foto de las abiertas de hoy sino la columna entera:
la sincronización la lee de la planilla pero nadie la llena. Consecuencia:
`diasDeAtraso` devolvía `null` en todas las atrasadas, así que el panel que ya
existía mostraba «—» y su orden «de la más vieja a la más nueva» no ordenaba
nada. Lo que sí tienen es `fecha_ejecucion`.

**Esto lo resolvió `main` mientras la rama se escribía, y mejor** (commits
`371ff64e` y siguientes, traídos el 23/11/2026): dejó de usar `proxima_fecha`
para decidir, el inicio sale de `fechaParaElCalendario` —la pendiente si la
hay— y el vencimiento es `fecha_fin` cuando es posterior al inicio. Así que el
respaldo que este spec proponía para `diasDeAtraso` **no existe más**: lo
reemplaza el de main, y la ventana de siete dias se recorta con
`vencimientoDe()`, la misma fecha con la que `estaAtrasada` decide.

Con esa fecha y la ventana `[hoy − 6, hoy]` —siete días contando hoy—,
**8 de las 19 vencieron esta semana**, repartidas en **7 equipos y 5
sectores**. Y la lista entera va de enero (#809, Calcinación) a ayer.

**El número no es el contrato: la ventana sí.** Son siete días *contando hoy*,
porque una orden que vencía hoy y ya está marcada atrasada es de esta semana.
Lo que se fija con un test es la regla sobre fechas inventadas, no el 8 — que
cambia cada día que pasa.

## Las decisiones que tomó el usuario

1. Disponibilidad y su historial: **no se construyen**, esperan sus datos.
2. **MTTF se deriva** de MTBF y MTTR, y el tooltip dice que es derivado.
3. MTBF, MTTR y confiabilidad se agregan **por sector**, no por equipo, y
   respetan el filtro de empresa/sector que el tablero ya tiene.
4. **Lo que hay hoy se queda, abajo de lo nuevo.**
5. «De la semana» son **las que tenían que hacerse en los últimos 7 días**
   (19/11/2026).
6. La confiabilidad se muestra **a 7 días** (19/11/2026).

## Las decisiones que tomé yo, para que se puedan revisar de una pasada

Ninguna de éstas la preguntó nadie; están acá juntas porque son las que un
lector apurado daría por obvias y no lo son. Cada una está argumentada donde
vive.

| Decisión | Dónde | La alternativa que se descartó |
|---|---|---|
| La línea mensual de confiabilidad usa una **ventana móvil de 90 días**, no el mes solo | §1 | El mes solo: Filler 1 cierra en 33 % contra 2,5 % del año |
| El MTTR del sector **cuenta las correctivas sin equipo**, y por eso no reusa `reparacionesDeLaVentana()` | medido, punto 4 | Reusarla: Taller pierde su único número |
| El gráfico de órdenes por mes se fecha por **`fecha`** y no por la ejecución | §1 | `fechaDeFalla()`: 24 % de las órdenes cambian de mes y los dos gráficos dejan de sumar |
| «Atrasadas de esta semana» se calcula en **`page.tsx`** y no en la ruta nueva | §3 | La ruta: su ventana de 365 días se come las atrasadas viejas |
| La ventana semanal **incluye hoy**: `[hoy − 6, hoy]` | medido | Terminar ayer: una orden que vencía hoy y ya está marcada no sería de esta semana |
| `diasDeAtraso` cae en `fecha_ejecucion` cuando no hay vencimiento | §3 | Dejarlo: el panel sigue mostrando 19 guiones y dos definiciones en la misma pantalla |
| El MTTF **se recorta en 0** si la resta diera negativa | §1 | Mostrar el negativo, que en pantalla no se entiende |

## Los caminos que se consideraron

**(A) Calcularlo todo en el servidor, dentro de `page.tsx`.** Es como se arman
hoy los conteos de OT. Se descarta: el tablero se limpió a propósito de traer
miles de filas para contarlas en memoria, y estos indicadores necesitan las 981
correctivas de la ventana más las 2.531 órdenes del año para el gráfico
mensual. Sumarlo al servidor retrasa el primer pintado de toda la pantalla de
entrada del módulo.

**(B) Pedirlo desde el cliente después del primer pintado, en una ruta propia.**
Es exactamente lo que ya hace `PeoresPorMtbf`, con su esqueleto, su «no se
pudo» y su reintento. El resto del tablero pinta completo y rápido, esto llega
después, y si falla no tumba la pantalla. **Elegido**, por consistencia con el
precedente del propio tablero.

**(C) Extender `/api/mantenimiento/mtbf` para que devuelva también lo de
sector.** Ahorraría una lectura de las mismas 981 filas. Se descarta: esa ruta
devuelve el objeto `Mtbf` tal cual y el tablero lo consume por ahí; cambiarle
la forma a esa respuesta es romper al cliente que ya la lee, y la pantalla
`/mantenimiento/mtbf` la lee también.

**El costo asumido de (B)**: el tablero hace **dos** lecturas de las mismas 981
correctivas, una para `PeoresPorMtbf` y otra para esto. Las dos pasan por
`traerTodo()`, corren en el servidor y el cliente recibe sólo los resúmenes. Se
acepta: unificarlas es (C), que rompe un contrato publicado.

## Qué se construye

### 1. `lib/mantenimiento/porSector.ts` — la cuenta

Función pura `indicadoresPorSector(ordenes, hasta)`. Una fila por sector con
`fallas`, `diasObservados`, `mtbf`, `reparaciones`, `mttr`, `mttf`,
`confiabilidad`, `ultima` y la serie `porMes`.

Reusa, no copia:

- `fechaDeFalla()` de `mtbf.ts` para fechar una correctiva —`fecha_ejecucion`
  y sólo si falta, `fecha`—. Que los tres indicadores fechen igual no es
  cosmético: se leen en la misma pantalla.
- `VENTANA_DIAS`, `MINIMO_OBSERVADO`, `DIAS_RECIENTE` y `confiabilidad()` de
  `mtbf.ts`.
- `esDeUnTercero()` y `MINIMO_REPARACIONES` de `mttr.ts` — pero **no**
  `reparacionesDeLaVentana()`, por lo del punto 4 de arriba.
- `ultimosMeses()` de `dashboard.ts` para los doce meses.

Lo propio:

- **`diasObservados` por sector**, no del conjunto (ver arriba).
- **`mttf = mtbf − mttr/24`**, en días, y sólo cuando los dos existen. **Se
  recorta en 0**: un sector cuyo MTTR superara al MTBF daría un número
  negativo, que en pantalla no se entiende; cero se lee como «no llega a
  arrancar entre reparación y reparación», que es lo que estaría pasando. Hoy
  no ocurre —el margen más chico es Filler 1, 1,9 días contra 0,12— pero la
  cuenta no depende de que eso siga así.
- **`confiabilidad` a 7 días**, `null` cuando no hay MTBF. La constante vive
  acá (`PLAZO_DEL_SECTOR = 7`) y no reusa `PLAZOS` de `mtbf.ts`, que son los
  dos de la ficha de un equipo: son dos escalas distintas y atarlas haría que
  cambiar una cambie la otra sin querer.
- **`porMes`**: por cada uno de los últimos doce meses, las fallas del sector
  en ese mes y **la confiabilidad al cierre de ese mes, calculada con los 90
  días anteriores y no con el mes solo**. Es la decisión menos obvia de todo
  esto, así que va con lo que la obliga:

  - **Un mes suelto tiene muy pocas fallas y el número salta.** Planta filler 1
    lleva 2 fallas en noviembre contra 10 a 25 por mes el resto del año: con el
    mes solo, el sector que peor anda cierra el año en **33 %** contra el 2,5 %
    anual. Con la ventana móvil da **8 %**. El salto se repite todos los meses,
    siempre en el último punto, y se lee como una mejora que no pasó.
  - **El dato llega tarde, así que el mes en curso no es el único corto.**
    Medido: **10 de las 70 correctivas ejecutadas en agosto se cargaron en un
    mes posterior** (9 de 65 en septiembre), con un retraso de mediana 2 días
    pero p90 de 16. El penúltimo punto también nace incompleto.
  - **Y con el mes solo hay huecos de verdad**: Trituración 3 no tiene ninguna
    falla en octubre ni en noviembre, así que su línea se corta justo en los
    dos meses que alguien va a mirar. Con los 90 días no hay **ni un hueco** en
    doce meses por ocho sectores, medido.
  - **90 y no otro número**: es `DIAS_RECIENTE` de `mtbf.ts`, que ya es lo que
    este módulo llama «el ritmo reciente». Con 180 la línea queda tan plana que
    no dice nada (Trituración 1 se mueve entre 7 % y 12 % todo el año).
  - Un punto cuya ventana tenga **menos de 3 fallas** o **menos de
    `MINIMO_OBSERVADO` días observados** queda en `null`, y el gráfico lo
    dibuja como hueco (`connectNulls={false}`): es la misma decisión que
    sostiene la curva granulométrica de Calidad —interpolar dibuja un punto que
    nadie midió—. Hoy eso no ocurre en ningún sector con historia.
  - **El último punto se marca incompleto igual**, y el pie del gráfico dice
    por qué: su ventana termina hoy y las últimas semanas siempre están
    cargadas de menos, así que **tiende a verse mejor de lo que es**. Los ocho
    sectores medidos suben sobre el final, y parte de esa subida es la planilla
    y no la planta.
- **`sinSector`**: cuántas correctivas de la ventana quedaron sin sector
  (hoy: 0). Va en el resultado y no en un `console.warn`, por el mismo
  argumento que `sinAtribuir` en `mtbf.ts`: quien lee el número tiene derecho a
  saber sobre qué parte se calculó.

**Qué recibe y qué devuelve, porque la ruta depende de eso.** Recibe **todas**
las órdenes —no sólo las correctivas— y filtra `tipo === "CORRECTIVO"` adentro,
igual que `calcularMtbf`. Devuelve las filas por sector **y** la serie mensual
de órdenes por sector de todos los tipos, que es lo que pide el gráfico de
abajo. Una función, una lectura, un archivo de tests.

**Y las dos series se fechan distinto, a propósito.** Las fallas y la
confiabilidad usan `fechaDeFalla()` —cuándo se rompió— y la serie de órdenes
usa **`fecha`**, que es cuándo se cargó la orden. No es una inconsistencia: es
que el gráfico de órdenes por mes y por sector va **arriba del que ya existe**,
en la misma sección, y ése cuenta por `fecha` (`page.tsx` arma sus doce meses
con `q.gte("fecha", …)`). Medido: **618 de 2.532 órdenes (24 %) caen en un mes
distinto según cuál de las dos fechas se use** —noviembre da 202 por carga
contra 159 por ejecución—, así que dos gráficos de «órdenes por mes» uno encima
del otro con fechas distintas tendrían barras que no suman y nada lo diría.
Cada gráfico dice cuál usa: «generadas» el de carga, «fallas» el otro.

### 2. `lib/mantenimiento/porSectorDatos.ts` — de dónde salen

`indicadoresPorSectorDeLaPlanta(supabase, hasta)`, calcado de `mtbfDatos.ts`:
`traerTodo()` sobre `ordenes_trabajo`, el filtro de ventana como optimización
—la regla la vuelve a aplicar la función pura—, y el `select` **literal** con
`sector_id` adentro.

**Una sola lectura, de `VENTANA_DIAS + 90` días.** Los 90 de más son los que
necesita el primer punto de la línea mensual, que mira hacia atrás; pedir 365
dejaría los primeros meses sin ventana completa y con un `null` que no es un
dato faltante sino un borde.

Medido el 23/11/2026: el `.or` alcanza a **2.897 de las 2.902 filas** de la
tabla, tres tandas de `traerTodo()`. O sea que **la ventana casi no acota**
—toda la historia cabe adentro—, y está escrita por lo que va a pasar cuando la
tabla tenga años viejos, no por lo que ahorra hoy.

### 3. `lib/mantenimiento/alertas.ts` — las atrasadas de la semana

Se agrega, sin tocar `resumirAtrasadas` ni `estaAtrasada`:

- `DIAS_DE_LA_SEMANA = 7`.
- `resumirLaSemana(ordenes, hoy)`: de las atrasadas, las que tenían
  `fecha_ejecucion` dentro de `[hoy − 6, hoy]`, agrupadas **por equipo** y
  **por sector**, más el total de atrasadas para poder decir «8 de 19».

**Esto se calcula en el servidor, en `page.tsx`, y no en la ruta nueva.** Son
tres razones y la primera sola ya decide:

1. **La lista va de enero a ayer**, o sea fuera de la ventana de la ruta. Una
   `ATRASADO` más vieja que 365 días no entraría en esa lectura y
   desaparecería del conteo sin que nada avise.
2. **El «8 de 19» tiene que contarse contra la misma foto** que el panel de
   atrasadas que queda quince centímetros más abajo. Dos lecturas distintas
   darían dos números que no cierran entre sí.
3. Es lo urgente de la sección de gestión operativa: aparece con el primer
   pintado y no medio segundo después.

Lo que hay que tocar para eso: el `select` de `candidatas` en `page.tsx` hoy
trae `sector_raw` y `equipo_raw` y **no trae `fecha_ejecucion`, `sector_id` ni
`equipment_id`**. Se le agregan los tres. Sin el primero el bloque no existe;
los otros dos son para poder filtrar por empresa cruzando ids en vez de texto,
y para poder enlazar cada equipo a su listado (`?equipo=<id>`, que el listado
ya sabe leer). Sigue con su `.limit(500)` y hoy devuelve 19 filas.

**Y una excepción a «no se toca lo que está», que necesita el visto bueno:**
`diasDeAtraso` pasa a caer en `fecha_ejecucion` cuando no hay `proxima_fecha`.

- *Por qué*: sin eso, el bloque nuevo no puede decir «hace 3 días» y la
  pantalla tendría **dos definiciones de hace cuánto está atrasada una orden**
  a quince centímetros una de otra, que es exactamente la trampa que este repo
  anota en cada módulo.
- *Qué cambia a la vista*: hoy las 19 atrasadas muestran «—» y quedan sin
  ordenar. Con el cambio, **18 de 19 pasan a mostrar un número** y el panel se
  ordena de verdad de la más vieja a la más nueva. La #809 va a decir 302 días.
- *El riesgo asumido*: `fecha_ejecucion` en una orden abierta es el día
  previsto, y hay errores de carga —la #2726 dice 06/02/2026 con la orden
  cargada el 05/10/2026, o sea un año mal tipeado— que van a salir como
  atrasos enormes. Se acepta porque el número grande señala la fila que hay que
  ir a corregir, que es más útil que un guión. La #2726 queda igual fuera de la
  ventana semanal.
- La que no tiene ninguna de las dos fechas sigue devolviendo `null`: «no se
  sabe» se sigue diciendo, no se rellena con cero.

### 4. `lib/mantenimiento/paradasDeSector.ts` — las paradas

`paradasPorSector(cambios, ahoraIso)`: sobre `conPermanencia()` de
`historialDeSectores.ts`, agrupa por sector cuántas veces paró, cuánto tiempo
estuvo fuera de servicio y si está parado ahora. Reusa `duracionLegible()`.

«Fuera de servicio» suma `PARADA` y `EN_REPARACION`, igual que
`resumirHistorial`: desde producción las dos son lo mismo.

### 5. La ruta

`app/api/mantenimiento/indicadores-por-sector/route.ts`. Devuelve las filas por
sector con su `sectorId`, nombre y empresa —para que el cliente pueda filtrar
sin volver a pedir—, la serie mensual de OT por sector, las paradas y el
`mesEnCurso`. **Las atrasadas de la semana no van acá**, por lo de §3.

Guardia de acceso, manejo del error y el log con el detalle afuera del cuerpo:
calcados de `/api/mantenimiento/mtbf`, que ya resolvió exactamente este caso.

### 6. La pantalla

Todo lo nuevo **respeta el filtro de empresa/sector** que el tablero ya tiene y
se filtra en el cliente, para que cambiar de empresa sea instantáneo.

**Indicadores**, arriba de las tarjetas que ya están:

> **Fiabilidad por sector** · *último año* ⓘ
>
> | Sector | Fallas | MTBF | MTTR | MTTF | Aguanta 7 días |
> |---|---|---|---|---|---|
> | Planta filler 1 | 184 | 1,9 d | 2,8 h | 1,8 d | 2,5 % |
> | Planta filler 2 | 135 | 2,6 d | 2,8 h | 2,5 d | 6,9 % |
> | … | | | | | |
> | Compresores | 6 | 59,0 d | — | — | 88,8 % |

Ordenada por MTBF ascendente —el que menos aguanta arriba—, igual que la
pantalla de MTBF. **Sin fila de total**, por el anti-objetivo de más arriba.
Una `<table>` dentro de un contenedor con `overflow-x-auto`, que es la regla de
la casa para el teléfono de 343 px. Cada sector enlaza al listado de OT
filtrado por ese sector.

Los tooltips dicen lo que el número no puede: que el MTBF del sector es «cada
cuánto falla algo en el sector», no cada cuánto falla una máquina; que el MTTR
son horas de trabajo y no de parada; que el MTTF es derivado; y que la
confiabilidad supone tasa de falla constante, que es una aproximación
declarada, no una medición.

**Evolución mensual**, arriba de lo que está:

- **Órdenes por mes y por sector**, barras apiladas de doce meses. Agrupa
  **siguiendo el filtro**, que es lo que ya hace el gráfico de Criticidad: sin
  filtro, por empresa; con una empresa, por sus sectores; con un sector, ése
  solo. Con quince sectores apilados no se lee nada, y esta regla ya está
  resuelta en el tablero.
- **Confiabilidad por sector, mes a mes**, líneas, con la ventana móvil de 90
  días de §1. Con el filtro en «todas» se dibujan **los seis sectores con más
  fallas del año** y se dice que son ésos; con una empresa o un sector, los que
  el filtro deje. Seis es el tope porque seis líneas de colores ya son el
  límite de lo que se distingue, y **nunca choca con el filtro**: ninguna
  empresa tiene más de seis sectores de planta (POLCECAL 6, TRANSVERSAL 5,
  POLYSAN 4). El último punto va marcado como incompleto, con el pie que
  explica por qué tiende a verse mejor de lo que es.
- **Paradas de mantenimiento por sector**: la lista de sectores que pararon
  alguna vez, con cuántas veces y cuánto tiempo estuvieron fuera de servicio, y
  el sector que esté parado ahora marcado. Siempre con el renglón «se registra
  desde el …», con la fecha del primer cambio que haya en la base. Hoy eso es
  una línea para Trituración 2 (1 parada, 4 días) y una para Hidratación
  (parada ahora). Enlaza al historial completo, que ya existe.

**Gestión operativa**, arriba de lo que está:

- **Atrasadas de esta semana**, por equipo y por sector. «8 de 19 atrasadas
  tenían que hacerse esta semana» —hoy, 7 equipos y 5 sectores—, las órdenes
  listadas con su equipo y los dos agrupamientos. Cada equipo enlaza a su
  listado filtrado; el que no tiene `equipment_id` se nombra con su texto y no
  enlaza. **No se dibuja cuando da cero**, que es la misma regla que ya
  tiene el panel de atrasadas: un bloque que dice «cero» todos los días enseña
  a no mirarlo, y el día que diga otra cosa nadie lo va a ver.

## Qué se le deja a quien lo construya

- El orden exacto de las columnas y los anchos de la tabla.
- Los colores de las líneas del gráfico mensual: salen de la paleta categórica
  que el tablero ya usa en Criticidad.
- Si el bloque de fiabilidad va antes o después de las tarjetas de KPI dentro
  de la sección, mientras quede **arriba de lo que había**.
- Los textos exactos de los tooltips, siempre que digan las cuatro cosas de
  arriba.

## Cómo se verifica

`npm test` (los tests nuevos de las tres funciones puras), `npm run tipos`,
`npm run build`, `node scripts/revisar-arbol-commiteado.mjs` y
`node scripts/revisar-responsive.mjs`. La línea de base del 19/11/2026, antes
de tocar nada: **7.611 tests en verde**, tipos y build limpios, responsive con
`ROMPE 0 · MIRAR 1` —esa única la trajo `main`, es la `<table>` del reporte de
Ensayos—.

La pantalla está detrás del login, así que no se comprueba en un navegador: lo
que se comprueba contra la base real es que las funciones den los números de
las tablas de arriba, con un script de un solo uso.

**Lo que se fija con tests son las reglas, no los números de hoy.** La tabla de
MTBF por sector y el «8 de 19» cambian con cada orden que se carga; lo que no
cambia es que los días observados se cuenten por sector, que el piso devuelva
`null`, que la ventana semanal incluya hoy y que una correctiva sin equipo
entre al MTTR del sector. Un test que fije el 8 se pone rojo mañana por la
razón equivocada.

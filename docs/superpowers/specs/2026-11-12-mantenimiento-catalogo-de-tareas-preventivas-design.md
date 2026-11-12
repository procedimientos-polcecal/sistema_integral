# Catálogo de tareas preventivas — diseño

**12/11/2026.** Primera etapa hecha: el vocabulario de acciones, la propuesta
de catálogo desde el historial y la lista de lo que le falta al catálogo de
componentes. **Sin migración y sin escrituras.**

## El problema, medido

El motor de planes periódicos existe desde el 29/10/2026 y tiene **un solo plan
cargado** —«Lubricacion, MENSUAL»—. Al mismo tiempo, de las **2.428 OT del
último año, 1.455 son PROGRAMADO (59,9 %)** contra 973 correctivas.

O sea: el preventivo se hace, y en volumen. Lo que no existe es el catálogo que
permitiría generarlo en vez de escribirlo. Cada una de esas ~1.455 órdenes se
tipea a mano.

**Y no se puede deducir del historial tal como está.** De las 1.344 programadas
con equipo hay **1.222 descripciones distintas**, y sólo 17 grupos repiten tres
veces o más —el 6 %—. El texto libre las parte: «regulacion de pendulos» 18
veces y «se regulan pendulos» otras 5 son el mismo trabajo escrito de dos
formas.

## La idea: una tarea es una acción sobre un componente

Con esos dos ejes el texto se ordena solo, y es la misma forma que este repo ya
usó dos veces: el vocabulario modo/causa de las fallas, y los renglones de
repuestos en lugar de un campo de prosa.

**La acción es vocabulario nuevo** (`ACCIONES_PREVENTIVAS`, seis entradas) y
sale de los datos, no de una norma: son las seis formas en que esta planta
escribe que fue a atender una máquina antes de que se rompiera.

## Lo que la primera corrida desmintió, y es lo más importante de este documento

El diseño arrancó dando por sentado que **el objeto ya estaba resuelto**:
`equipos_componentes` tiene 398 filas con 43 nombres curados, colgados de su
equipo. Sólo había que agregarle la acción.

**Falso.** Contra los datos reales:

| | |
|---|---|
| Órdenes PROGRAMADO del último año | 1.465 |
| Preventivas reconocidas | 793 — 54 % |
| …**de ésas, con componente del catálogo** | **156 — 11 %** |
| Correctivas o de obra cargadas como PROGRAMADO | 281 — 19 % |
| Sin acción reconocible | 391 — 27 % |

Las dos listas hablan idiomas distintos. El catálogo nombra piezas de
relevamiento —«Raspador / limpiador cinta», «Masa excéntrica», «Membrana / lona
porosa»— y las órdenes nombran lo que se toca ese día. **Péndulos, grillas,
rodamientos y correas no existen como componente**, y son el segundo, tercero y
cuarto objeto más frecuente de todo el preventivo.

Por eso la salida más accionable de la herramienta no es el catálogo propuesto
sino **lo que le falta al catálogo de componentes**:

```
    34 órdenes la nombran · pendulos
    27 órdenes la nombran · rodamientos
    24 órdenes la nombran · grillas
    19 órdenes la nombran · correas
    15 órdenes la nombran · reductor
    13 órdenes la nombran · transmision
```

**Esas palabras no se agregan desde acá.** Un componente que el sistema se
inventa no está colgado de ningún equipo, y una tarea enlazada a él aparece en
el lugar que no es — es la regla de la casa sobre enlazar al que se le parece,
por el otro lado. La herramienta dice qué falta; lo agrega alguien de planta.

### El filtro que hace útil esa lista

Se descartan las palabras del propio vocabulario de acciones —«limpieza»
aparece 211 veces y es el verbo— y **las que nombran un equipo**. Esto último
no es obvio y es lo que separa una lista útil de una de ruido: «rompedora» 36
veces, «cinta» 32, «elevador» 30, «molino» 27 son máquinas, y la máquina ya
viaja en `equipment_id`. Una descripción que dice «revisión de elevador» no
pide un componente nuevo: repite el equipo.

Y una palabra cuenta **una vez por orden**: una descripción que repite
«grillas» tres veces no son tres pedidos de ese componente.

## El 19 % que no es preventivo

`ACCIONES_CORRECTIVAS` existe para contarlo, no para reclasificar nada: de las
1.025 programadas con acción reconocida, **270 son reparación (115), montaje u
obra (141) o soldadura (14)**. Es trabajo correctivo y de mejora cargado como
PROGRAMADO —«Construcción vereda portería», «Se coloca corona y se fabrica
chaveta», «Reparacion» a secas—.

Reconocerlas sirve para dos cosas y ninguna es tocar la OT: que no contaminen
el catálogo, y que se pueda decir cuántas son. Sin esa distinción, un «54 % con
acción reconocida» haría creer que hay 793 tareas preventivas donde hay 512.

CLAUDE.md ya avisaba de la punta opuesta —«si una correctiva está cargada como
programada, el MTBF va a estar mal»—; esto mide la otra.

## Lo que esta etapa NO hace

- **No crea planes ni escribe nada.** Ni órdenes, ni planes, ni la
  clasificación de una OT. Propone, y una persona decide.
- **No inventa componentes**, por lo dicho arriba.
- **No reclasifica** las 281 correctivas cargadas como PROGRAMADO.
- **No toca ninguna planilla.** Es una lectura derivada, como el MTBF y el
  MTTR. Si alguien exporta después el catálogo, ahí sí aplica la regla de las
  exportaciones.
- **Ninguna migración.** Nadie tiene que correr SQL para esto.

## Cómo se mira

```bash
npm run catalogo-de-tareas              # las 30 tareas más repetidas y la cobertura
npm run catalogo-de-tareas -- --todas   # todas
npm run catalogo-de-tareas -- --sueltas # además, las que no se reconocieron
```

La decisión de qué es una tarea vive en
[lib/mantenimiento/tareasPreventivas.ts](../../../lib/mantenimiento/tareasPreventivas.ts),
en funciones puras con sus tests; el script es sólo la lectura. La ventana es
la misma del MTBF y del MTTR —365 días— para que los tres hablen del mismo
período.

## El intervalo, que es de lo que sale el período de un plan

Cada tarea viaja con sus equipos, cuántas veces se hizo en cada uno y **la
mediana de los huecos**, no el promedio: una tarea hecha cuatro veces en marzo
y una en octubre tiene un promedio que no describe ninguno de los dos ritmos.
Con menos de tres fechas no se opina —una sola distancia entre dos fechas puede
ser cualquier cosa— y dos órdenes del mismo día no son dos repeticiones.

Hoy el ritmo se ve nítido donde hay volumen: rotación de martillos **76 veces**,
cada ~4 días en PO-C1-04, ~5 en PY-B1-06 y ~5 en PY-A1-05. Eso es un plan.

## El paso 1, hecho el mismo día: los componentes que faltaban

Se agregaron **91 filas a `equipos_componentes`** con
`scripts/componentes-desde-las-ot.mts`, y la cobertura subió:

| | antes | después |
|---|---|---|
| Nombres de componente | 43 | **49** |
| Órdenes con acción + componente | 156 — 11 % | **278 — 19 %** |
| Tareas propuestas | 26 | **46** |

**No se inventó ninguna**, y eso es lo que lo hace legítimo: qué equipo tiene
qué componente sale del historial, porque cada OT que nombra «péndulos» ya
viene con su `equipment_id`. El script sólo lee esa evidencia. Péndulos fue a
parar al **molino vertical PY-B1-09** —50 órdenes, 38 preventivas—, las grillas
a los molinos a martillos (83, 41 y 37 órdenes) y las correas a ventiladores y
cintas.

Tres reglas lo sostienen, y están en el encabezado del script:

- **Los «Edificio» quedan afuera.** Es el equipo comodín, y sin ese filtro
  «PO-D1 – Edificio» se llevaba correas y mangas.
- **Hacen falta dos órdenes, o una preventiva.** Una mención suelta en una
  correctiva puede estar nombrando la pieza de la máquina de al lado. Quedaron
  48 descartadas por eso.
- **No se pisa lo que ya está**: el relevamiento de agosto manda.

Y **se deshace entero** porque la procedencia va en la clave —`COMP-OT-NNNN`
en vez de seguir la numeración `COMP-NNNN`—, el mismo patrón que las claves
`excel-21-10-26-NN` de Seguridad e Higiene:

```sql
delete from public.equipos_componentes where componente_id like 'COMP-OT-%';
```

**Una para mirar**: `PY-B1-06 – Molino a martillos` quedó con «Péndulos» por
dos menciones correctivas, y un molino a martillos no tiene péndulos. Entra por
la regla de las dos órdenes y es el caso en que esa regla afloja. Sacarla es
una fila.

De las seis candidatas, **«Mangas» no se agregó**: `Membrana / lona porosa` ya
es eso, y partir en dos un componente que está es lo contrario de lo que se
busca.

## Lo que sigue, y en este orden

1. ~~Completar los componentes que faltan.~~ **Hecho el 12/11/2026**, arriba.
2. **Confirmar el catálogo** con alguien de planta — qué tareas son de verdad,
   con qué nombre y sobre qué equipos. Las de arriba ya se leen como un plan:
   regulación de péndulos 32 veces cada ~6 días en PY-B1-09, cambio de grillas
   12 veces cada ~3 días en PY-C1-03.
3. Recién ahí, la tabla de tareas y el enganche con el motor de planes
   periódicos, que ya existe y sabe generar.

Hacer el 3 antes del 2 daría una tabla que cubre el 19 % del preventivo y la
sensación de que el problema está resuelto.

**Y la cobertura no sube mucho más agregando componentes.** Lo que queda sin
reconocer son, en su mayoría, nombres de equipo —«motor» 22, «balanza» 19,
«cintas» 6— y palabras que no son piezas: «carga», «giro», «pérdida»,
«sistema». Componentes de verdad quedan pocos (grampas 9, cojinete 6). El
techo siguiente no es el catálogo sino el **27 % sin acción reconocible**.

## Lo que haría fracasar esto aunque funcione

- **Que se agreguen los componentes faltantes como nombres sueltos**, sin
  colgarlos del equipo que los tiene. El catálogo es por equipo: «Martillos»
  está en 5 equipos, y una tarea sin ese enlace no se puede programar.
- **Que alguien lea «26 tareas» como el catálogo de la planta.** Son las que el
  historial deja ver hoy con el catálogo que hay; la cobertura es el 11 %.
- **Que para subir la cobertura se afloje el reconocimiento** —nombres de menos
  de cuatro letras, coincidencias parciales—. Un componente mal reconocido es
  peor que ninguno: la tarea aparece colgada de la máquina que no es.

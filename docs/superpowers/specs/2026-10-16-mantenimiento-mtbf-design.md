# Mantenimiento mide cada cuánto falla cada máquina

Acordado el 16 de octubre de 2026. Agrega al módulo Mantenimiento el **tiempo
medio entre fallas (MTBF)** por equipo y la **confiabilidad** derivada de él, en
tres lugares: una pantalla nueva con el listado de todos los equipos, una
tarjeta en la ficha de cada uno y un recuadro en el tablero.

No toca ninguna tabla, no escribe nada y no necesita migración: es una cuenta
sobre las órdenes de trabajo que ya están cargadas.

## Para qué

Lo mira el área de Mantenimiento **en la diaria**, para decidir qué programar.
El pedido textual: *"este indicador es importante para revelar dónde se genera
la falla"*. Dos preguntas, en este orden:

1. **¿Qué máquina de la planta falla más seguido?** — el listado ordenado.
2. **¿Esta máquina que estoy por intervenir, cada cuánto falla, y viene mejor o
   peor que antes?** — la tarjeta de la ficha.

El área mira el **equipo puntual**, no el sector. El sector es filtro, no unidad
de medida.

## La fecha de la falla es `fecha_ejecucion`, no `fecha`

Es la decisión que más cambia los números y la que casi se pasa por alto.

`ordenes_trabajo` tiene las dos. **`fecha` es cuándo se cargó la orden en la
planilla; `fecha_ejecucion` es cuándo se hizo el trabajo.** De las 902
correctivas con equipo, **819 tienen las dos fechas distintas** — mediana 2 días
de diferencia, máximo 46 días.

Lo que lo destapó: la rompedora a martillos de Filler 1 aparecía con **29
órdenes correctivas el mismo día**, el 19/01/2026. Por `fecha_ejecucion` esas 29
se reparten entre el 25/12 y el 13/01:

```
OT 812  ejec 25/12  Cambio de rotor y rodamientos lado de la polea
OT 816  ejec 27/12  Cambio de cajas y rodamientos
OT 823  ejec 30/12  Se colocan correas
OT 829  ejec 03/01  Rotación de martillos y se colocan 2 grillas
OT 835  ejec 10/01  Cambio de martillos
OT 841  ejec 13/01  Se agregan grillas
```

Alguien se sentó un lunes a cargar tres semanas de trabajo atrasado. **Con
`fecha` eso son 29 fallas el mismo día y 23 días sin ninguna falla**, que es
exactamente al revés de lo que pasó, y le rompe la tendencia a la máquina que
más interesa.

**Entonces: `fecha_ejecucion`, con `fecha` como respaldo si viniera vacía.** Hoy
está cargada en las 902, pero la planilla puede traer una sin ella.

Dos consecuencias que hay que respetar al construirlo:

- **Se excluyen las ejecuciones futuras.** Hay 1 correctiva con
  `fecha_ejecucion` posterior a hoy —y 10 OT en total, alguna en 2027—. Son
  errores de tipeo en la planilla. Una falla que todavía no ocurrió no entra en
  el denominador de nada.
- **El rango real por fecha de ejecución arranca en 2023** (una sola OT) y el
  grueso empieza el **1/12/2025**. Eso define el denominador: ver más abajo.

## Lo que hay en la base, medido el 16/10/2026

| | |
|---|---|
| Órdenes de trabajo | 2.175 (1 con `tipo` nulo) |
| Correctivas ejecutadas en los últimos 365 días | 951 |
| De ésas, con `equipment_id` cargado | **902** |
| Sin equipo enlazado | 49 |
| Equipos activos | 239 |
| Con al menos una correctiva en la ventana | 166 |
| Sin ninguna | 73 |
| Primera correctiva de la ventana | 1/12/2025 → **319 días observados, con corte al 15/10/2026** (crece un día por día; ver más abajo) |

Reparto de correctivas por equipo: 51 equipos con una sola, 27 con dos, 27 con
tres, y **20 equipos con diez o más**. La cola larga es donde está la noticia.

Los seis peores, con la cuenta hecha:

| Equipo | Sector | Fallas | MTBF | R(7) | R(30) | Especialidad |
|---|---|---|---|---|---|---|
| PO-C1-04 Molino a martillos | Hidratación | 70 | **4,6 d** | 22% | 0,1% | 100% mecánico |
| PY-A1-05 Rompedora a martillos | Filler 1 | 56 | **5,7 d** | 29% | 0,5% | 100% mecánico |
| PY-C1-03 Molino a martillos | Planta 02 | 53 | **6,0 d** | 31% | 0,7% | 98% mecánico |
| PY-B1-06 Molino a martillos | Filler 2 | 51 | **6,3 d** | 33% | 0,8% | 100% mecánico |
| PY-B1-09 Molino vertical | Filler 2 | 28 | **11,4 d** | 54% | 7% | 96% mecánico |
| PY-A1-07 Separador dinámico | Filler 1 | 25 | **12,8 d** | 58% | 10% | 96% mecánico |

Los cuatro primeros son molinos y rompedoras a martillos, y las fallas son casi
todas mecánicas. Eso ya es el indicador funcionando: la pantalla no va a
descubrir nada que esta tabla no diga, va a decirlo todos los días sin que nadie
corra una consulta.

### El dato está parejo mes a mes

Antes de confiar en la tendencia hubo que descartar que una caída de fallas
fuera una caída de carga. Correctivas **por mes de ejecución**:

| dic | ene | feb | mar | abr | may | jun | jul | ago | sep | oct* |
|---|---|---|---|---|---|---|---|---|---|---|
| 113 | 78 | 102 | 90 | 95 | 127 | 114 | 71 | 70 | 67 | 24 |

`*` octubre va por la mitad.

Todos los meses tienen volumen. **Las correctivas bajaron de 127 en mayo a 67 en
septiembre mientras las programadas subieron**: el preventivo está funcionando,
y la tendencia va a mostrar algo cierto y no un artefacto de carga.

## Qué cuenta como falla

**Una orden de trabajo con `tipo = 'CORRECTIVO'`, con `fecha_ejecucion` dentro
de la ventana y no futura, y con `equipment_id` cargado.**

- **Las programadas no cuentan.** Son la intervención planificada, no la falla.
- **Los avisos no cuentan por separado.** El área confirmó que *todo aviso genera
  una OT*. Contarlos sería contar la misma falla dos veces.
- **Las 49 correctivas sin equipo enlazado quedan afuera** de la cuenta por
  equipo, y se muestran como un número visible al pie del listado. Nunca se
  reparten entre los equipos que se les parecen: un enlace equivocado le inventa
  fallas a una máquina sana y no se nota nunca.
- **El estado no filtra.** Una correctiva `POR_HACER` ya es una falla que
  ocurrió. Son pocas: 40 OT de 2.175 no están en `REALIZADO`.
- **Cada OT es una falla, también cuando dos caen el mismo día de ejecución.**
  Después de corregir la fecha quedan 62 OT de 902 (7%) compartiendo día con otra
  del mismo equipo. Son trabajos distintos de la misma jornada —"se desatora" y
  "cambio de martillos"— y agruparlos por día borraría la diferencia entre una
  máquina que se para una vez y una que se para tres. Si el área después dice que
  prefiere contar paradas y no trabajos, es cambiar una línea de la función pura.

## Las cuentas

### MTBF

```
MTBF = días observados de la ventana ÷ cantidad de fallas del equipo
```

**La ventana son los últimos 365 días, pero el denominador son los días
observados dentro de ella**, es decir desde la primera correctiva registrada
—hoy el 1/12/2025— hasta hoy, inclusive: **319 días con corte al 15/10/2026**,
no 365.

**Ese 319 no es un invariante: es una medición fechada, y crece un día por
día** (320 el 16/10, 322 el 18/10) hasta que la ventana se llene, alrededor del
1/12/2026, y desde ahí vale 365. Quien verifique contra la base en otra fecha
tiene que esperar `días desde el 1/12/2025 hasta hoy, inclusive`, no 319; si el
número no coincide con 319 pero sí con esa cuenta, el código anda.

Esto no es un detalle. Los 46 días de la ventana (al 15/10) que no tienen ningún dato
inflarían cada MTBF un 14%, y alrededor del **1/12/2026, cuando la ventana
termine de llenarse, todos los números de la pantalla bajarían un 13% de un día
para el otro sin que cambie nada en la planta** — y quien comparara contra una
impresión de la semana anterior leería un deterioro general que no ocurrió.

La ventana es **fija y no elegible**, para que dos equipos se comparen siempre
contra lo mismo. Los filtros por sector y por especialidad no cambian el
denominador.

Es a propósito **el promedio sobre la ventana y no el promedio de los huecos
entre fallas**. Con los huecos, un equipo con una sola falla no tiene MTBF y
desaparece del listado justo cuando interesa saber que falló. Con esta fórmula
aparece, y el que falló poco sale bien ubicado.

**Un equipo sin fallas en la ventana no tiene MTBF**: dividir por cero no da
"muy bueno", da nada. Se muestra como **"sin fallas · MTBF > N d"**, con N los días
observados de hoy (319 al 15/10/2026), que es una cota inferior verdadera. No se
le escribe un MTBF igual a N.

### Confiabilidad

```
R(t) = e^(−t / MTBF)
```

La probabilidad de que el equipo aguante *t* días sin una correctiva. **Dos
plazos fijos: 7 y 30 días** — la semana que viene y el mes que viene. Fijos y no
elegibles porque un porcentaje que se compara entre equipos tiene que estar
siempre al mismo plazo; un selector obliga a mirar qué plazo está puesto antes
de leer cualquier número.

Molino de Hidratación: R(7) = 22%, R(30) = 0,1%. Elevador 2 de Molienda cal
(MTBF 21,3 d): R(7) = 72%, R(30) = 24%. Un equipo sin fallas, con la cota de 319
días (la del 15/10/2026; crece con los días observados): R(7) ≥ 98%, R(30) ≥ 91%.

**La fórmula supone que la tasa de falla es constante, y en 18 de los 42 equipos
que importan no lo es.** Ver más abajo: ése es el riesgo asumido de todo esto.

### Tendencia

Las fallas del equipo agrupadas por **mes de ejecución**, los últimos 12. Barras
en la ficha, sparkline en el listado.

**El mes en curso va marcado como incompleto.** Octubre lleva 24 fallas a mitad
de mes; dibujado igual que los demás parece una mejora que no ocurrió.

## Lo que el número no dice, y hay que escribirlo en la pantalla

Tres límites reales. Ninguno se arregla con código, y los tres hacen que el
número mienta si nadie los conoce.

### 1. Es calendario, no horas de máquina

`equipos.horas_marcha` está en **0 de 239**. `produccion_semanal` tiene **una
sola fila** y `planificacion_diaria` está **vacía**. No hay de dónde sacar cuánto
corrió cada máquina.

Entonces el MTBF cuenta **días de calendario**: una máquina de un turno y otra
de tres se comparan como si fueran iguales, y la que más trabaja parece peor de
lo que es.

El área dijo que **las horas de marcha se van a incorporar desde Producción más
adelante**. Por eso la cuenta tiene que quedar escrita de manera que cambiar el
denominador —de días a horas— sea cambiar un argumento y no rehacer la pantalla:
**la función pura recibe la duración de la ventana, no la calcula adentro**.

### 2. La criticidad no está cargada

238 equipos en `MEDIA` y 1 en `ALTA`: es el valor por defecto, nadie la cargó.
**No se puede cruzar "falla seguido" con "es crítico"**, que es el cruce que
haría la lista accionable sola. Se ordena por MTBF y nada más.

No hay que mostrar la criticidad en esta pantalla: una columna que dice MEDIA
239 veces le hace creer a quien la mira que el dato está cargado.

### 3. La tasa de falla no es constante — y el 43% de los equipos que importan lo muestran

Es el problema de fondo. El molino de Hidratación tiene MTBF de 4,6 días, pero
**esa ventana es casi toda el verano**: venía fallando cada 2 días y hace tres
meses que falla una vez por mes. Quien abra la ficha mañana lee 4,6 y va a
intervenir una máquina que ya se arregló.

Medido: de los **42 equipos con 6 o más fallas**, **18 cambiaron de ritmo por un
factor de 2 o más** entre la ventana completa y los últimos 90 días. En las dos
direcciones:

| Equipo | MTBF ventana | MTBF 90 d | |
|---|---|---|---|
| PO-C1-04 Molino a martillos | 4,6 d | 18 d | mejoró ×3,9 |
| PO-B1-04 Alimentador hornos | 15,9 d | 90 d | mejoró ×5,6 |
| PY-D1-03 Rompedora a martillos | 15,2 d | sin fallas | mejoró |
| PY-C1-03 Molino a martillos | 6,0 d | 12,9 d | mejoró ×2,1 |

**Por eso el número grande va acompañado de un aviso cuando el ritmo cambió.**
En la ficha, cuando el equipo tiene al menos 6 fallas en la ventana y el MTBF de
los últimos 90 días difiere del de la ventana por un factor de 2 o más, la
tarjeta lo dice con todas las letras y muestra el número reciente al lado.

El aviso va **sólo en la ficha**, donde se mira un equipo a la vez. En el listado
dispararía en casi la mitad de las filas interesantes y dejaría de leerse; ahí la
tendencia la cuenta la sparkline.

Sin ese aviso, el 22% del molino es exactamente lo que no queríamos: un número
con pinta de ciencia que miente igual que decir cualquier cosa.

## Las tres pantallas

### El listado — `/mantenimiento/mtbf`

Entrada nueva en el menú del módulo en `lib/core/nav.ts`, etiqueta **MTBF**,
después de "Equipos". Alcanza con nivel de **lectura**: el layout del módulo ya
resuelve el permiso.

Una fila por equipo que falló, el peor arriba:

| Equipo (nombre + código) | Sector | MTBF | Fallas | Llega a 7 d | Llega a 30 d | Tendencia | Última |

- Ordena por MTBF ascendente. Las columnas son ordenables.
- **Filtro por sector**: se arma con `sectoresDePlanta()` de
  `lib/mantenimiento/sectores.ts`, que da **13 sectores**, no los 39 de la tabla.
  Los 239 equipos viven en esos 13; armarlo con los 39 pondría "Compras y Pañol"
  al lado de "Filler 2", que es el bug que esa función existe para evitar. Son
  más de diez opciones: va con `<Select>`.
- **Filtro por especialidad**: las correctivas traen sólo tres valores —mecánico
  749, eléctrico 149, civil 4— y ninguno nulo. **Este filtro no recalcula el
  MTBF**: muestra los equipos que tuvieron al menos una falla de esa
  especialidad, y el número que se lee sigue siendo el de todas las causas. Un
  MTBF condicionado a una especialidad bajo un encabezado que dice "MTBF" es
  justamente el tipo de número engañoso contra el que trabaja todo este
  documento.
- Los 73 equipos sin fallas van al final, agrupados y colapsados, con la leyenda
  "sin fallas en la ventana".
- Al pie, las correctivas que no se pudieron atribuir (hoy 49) **se listan ahí
  mismo**, con su número de OT, equipo en texto libre y fecha. No se linkea al
  listado de OT: ese filtro sólo acepta ids de equipos del catálogo, así que "sin
  equipo" no es expresable en su contrato, y agregarle un valor centinela
  tocaría archivos que hoy tiene abiertos otra sesión.
- El nombre del equipo linkea a su ficha.

### La tarjeta — `/mantenimiento/equipos/[id]`

Un bloque nuevo en `EquipoDetalle.tsx`, junto a `CostoDelEquipo` y por encima
tanto del historial de estados como de la lista de OT:

- **MTBF**, grande.
- **R(7) y R(30)**, al lado, como porcentajes.
- **Barras de fallas por mes**, los últimos 12, con el mes en curso aclarado y
  marcado como incompleto.
- Cantidad de fallas, fecha de la última, y el reparto por especialidad.
- El aviso de ritmo cambiado, cuando corresponde.

Un equipo sin fallas muestra la tarjeta igual, diciendo que no falló en la
ventana. Esconderla haría pensar que la cuenta no existe.

### El tablero — `/mantenimiento`

Un recuadro chico con **los cinco peores por MTBF**, cada uno linkeando a su
ficha, y un link al listado completo. Es el camino de entrada: quien abre el
módulo a la mañana ve dónde está el problema sin ir a buscarlo.

**Se carga del lado del cliente, después del primer pintado**, no en el render
del servidor. El tablero fue limpiado a propósito de leer miles de filas para
contarlas en memoria —la decisión está escrita en
[docs/MANTENIMIENTO-INTEGRACION.md](../../MANTENIMIENTO-INTEGRACION.md)— y este
recuadro necesita las ~900 correctivas. Diferirlo respeta esa decisión sin
perder el recuadro.

## Lo que no es

- **No calcula MTTR** (tiempo medio de reparación). Los datos están —`horas` en
  1.534 OT y `fecha_cierre` en 744 de las correctivas— y es el indicador que
  naturalmente sigue a éste, pero tiene sus propias trampas: una OT cerrada
  tarde no es una reparación larga. Queda anotado, no se hace acá.
- **No escribe en ninguna planilla.** Es una cuenta derivada de datos que ya
  viajan por la sincronización de OT. No hay campo exportable que se toque, así
  que la regla de "toda ruta que toque un campo que se exporta tiene que
  exportar" no aplica. Si alguien agrega después una exportación del ranking, ahí
  sí aplica.
- **No crea ni modifica tablas.** Ninguna migración, nadie tiene que correr SQL.
- **No corrige la clasificación de las OT.** Si una correctiva está cargada como
  programada, el MTBF va a estar mal y esta pantalla no lo arregla.
- **No arregla las fechas de ejecución disparatadas.** Las 10 OT con ejecución en
  2027 o en 2023 se excluyen de la cuenta, no se corrigen: la planilla manda.
- **No agrega alertas ni avisos automáticos.** Nadie pidió que el sistema avise
  cuando un MTBF empeora.

## Lo que haría fracasar esto aunque funcione

- Que alguien lea el 22% del molino y mande gente a intervenirlo **sin ver que
  hace tres meses que no falla**. El aviso de ritmo cambiado no es un adorno: es
  la mitad del valor de la pantalla.
- Que se construya sobre `fecha` en vez de `fecha_ejecucion`. Los totales dan
  casi igual y el ranking casi no se mueve, **así que nada lo delata** — pero la
  tendencia de las máquinas peores queda al revés, que es justo lo que se mira
  para decidir.
- Que el número se presente como una medida de ingeniería de confiabilidad. **No
  lo es mientras no haya horas de marcha.** La pantalla tiene que decir, en texto
  visible y no en un tooltip, que cuenta días de calendario.
- Que para "mejorar" el ranking alguien empiece a cargar correctivas como
  programadas.

## Restricciones de construcción

- **`ordenes_trabajo` tiene 2.175 filas y PostgREST corta en 1000 sin avisar.**
  La lectura va con `traerTodo()` de `lib/core/paginado.ts`. Sin eso el listado
  pierde la mitad de las fallas y **no da error**: da números optimistas.
- **La cuenta vive en `lib/mantenimiento/mtbf.ts`**, en funciones puras que
  reciben las filas y devuelven las filas calculadas, con sus tests en vitest.
  Las rutas y las pantallas no tienen tests en este repo; por eso la lógica se
  saca de la ruta. Es exactamente el tipo de código que lo necesita: son cuentas,
  y una cuenta mal hecha acá no rompe nada, simplemente miente.
- **La función pura recibe la duración de la ventana como argumento**, para que
  el día que Producción cargue horas de marcha se le pase horas en vez de días.
- **Las fechas se comparan por día local, no con `toISOString()`.** En un
  servidor en UTC el primero del mes se corre al último del anterior y las fallas
  se cuentan en el mes equivocado. `ultimosMeses()` de
  `lib/mantenimiento/dashboard.ts` ya lo resuelve; conviene reusarlo.
- **Los gráficos van con `recharts` cargado por `next/dynamic`**, como
  `GraficosMantenimiento.tsx`: son ~350 KB y bloquean el primer pintado si se
  cargan derecho. En una tabla de 166 filas conviene evaluar SVG a mano para la
  sparkline antes que un `recharts` por fila.
- **Todo desplegable con diez o más opciones va con `<Select>`** de
  `components/Select.tsx`. Escribir un `<select>` nativo no rompe nada y por eso
  es la trampa: la pantalla queda sin buscador y nadie se entera.
- Castellano en todo: rutas, nombres, comentarios y textos de pantalla.

## Lo que queda a criterio de quien lo construya

- La forma exacta de los componentes y el orden de las columnas.
- Si el listado pagina o scrollea: son 166 filas.
- Cómo se dibuja la sparkline.
- Los cortes de color del MTBF. En los bocetos se usó rojo bajo 10 días, ámbar
  entre 10 y 20, neutro arriba; es razonable pero no está acordado con el área.
- Si la tarjeta de la ficha es colapsable.

## Cómo se verifica

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-responsive.mjs
node scripts/revisar-arbol-commiteado.mjs
```

`revisar-responsive.mjs` importa acá más que de costumbre: una tabla de ocho
columnas con sparkline es justo lo que marca.

Y contra la base, con el `SUPABASE_SERVICE_ROLE_KEY` de `.env.local`, el
listado tiene que dar **PO-C1-04 primero, con 70 fallas**, 166 equipos con
fallas, 73 sin ninguna y 49 correctivas sin atribuir. Esos cuatro números no
dependen de la fecha. Los que sí dependen son el MTBF y los días observados:
al corte del 15/10/2026 daban **MTBF de 4,6 días y 319 días observados**, pero
**los días observados son los que van del 1/12/2025 hasta hoy, inclusive, así
que el número crece un día por día** (322 el 18/10) hasta que la ventana se
llene, alrededor del 1/12/2026. Hoy hay que esperar esa cuenta, no 319 — y el
MTBF de PO-C1-04 es esos días ÷ sus fallas. Si da **5,2 días** cuando la cuenta
da 4,6, el denominador se está tomando como 365 en vez de los días observados.
Si PY-A1-05 muestra 29 fallas el 19/01, se está usando
`fecha` en vez de `fecha_ejecucion`. Y si los equipos con fallas son menos de
166, la lectura se cortó en 1000 filas.

---

Los bocetos que se usaron para acordar esto quedaron en
`.superpowers/brainstorm/`, que no está en git.

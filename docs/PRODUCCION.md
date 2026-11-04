# Producción — el informe de fábrica deja de ser un papel

Diseñado y construido el 7 y 8 de septiembre de 2026. Es el primer módulo del
SdG que no porta una app ni una planilla ajena: el diseño está en
[docs/superpowers/specs/2026-09-07-produccion-design.md](superpowers/specs/2026-09-07-produccion-design.md)
y el plan de implementación, tarea por tarea, en
[docs/superpowers/plans/2026-09-07-produccion.md](superpowers/plans/2026-09-07-produccion.md).
Acá quedan las decisiones y las trampas que no se deducen del código; para el
detalle de cada paso, esos dos documentos.

## Qué reemplaza

El formulario **040/2, *INFORME DE FÁBRICA***, papel de Polcecal S.A. – Polysan
S.A., uno por turno (**4→12** y **12→20**; las otras ocho horas no se
registran). Lo firma el capataz: día, turno, material en depósito, lo
despachado camión por camión, rotura, observaciones y limpieza.

Y el Excel donde alguien lo transcribía, `INFORME PRODUCCIÓN PT.xlsx`, con un
botón ▶ GUARDAR DÍA que volcaba los totales a tres hojas de resumen.

**Sigue siendo calidad quien carga.** El capataz no entra al sistema; su papel
no cambia. Lo que cambia es el destino de la transcripción: el SdG en vez del
Excel.

## Que la producción no se mide: se despeja

Ni el papel ni el Excel tienen un número de "lo producido". Sale de la cuenta:

```
producción = depósito − depósito del parte anterior + despachado + rotura
```

Vive en `lib/produccion/produccion.ts` (`produccionDelTurno`), con
`lib/produccion/turnos.ts` (`parteAnterior`) diciendo cuál es el parte
anterior: el `12_20` del día previo antes de un `4_12`, el `4_12` del mismo día
antes de un `12_20`.

**Por qué el depósito anterior no se guarda.** En el Excel vive en la columna
`N` de `Carga Diaria`, oculta y **única por producto**, no una por día: el
Apps Script la pisa con el stock de hoy al guardar, para que "mañana esté
puesta". Si alguien cambia la fecha sin haber guardado el día anterior, guarda
el día dos veces, o abre un día viejo, esa columna queda con el stock que no
es y la producción sale mal sin que nada avise. En el archivo relevado ya
había pasado: la fecha decía 03/09, `N` para *Bolsones de Cal 0-1* decía 17,
pero el `Histórico` real del 02/09 decía otra cosa — el "producido" de ese día
salía de un stock inicial que no era el del día anterior.

Acá no hay columna que pisar: `parteAnterior()` busca el parte de turno
anterior **en orden cronológico**, así que no puede quedar viejo — no hay
dónde guardarlo viejo. Es la corrección directa de ese agujero.

## Los cuatro estados que no son un número

Un cero en una grilla de producción no se distingue de un día sin producir.
Por eso `ProduccionDelProducto` (`lib/produccion/produccion.ts`) nunca devuelve
un número solo: siempre estado y, si corresponde, cantidad.

| Estado | Cuándo aparece | Por qué existe |
|---|---|---|
| `sin_parte_anterior` | Falta el parte de turno anterior | No hay resta posible. Devolver 0 sería inventar un día sin producción — la razón de ser del módulo, contra el agujero de la columna `N` del Excel |
| `dia_incompleto` | Un día tiene un turno cargado y el otro no | `produccionDelDia` distingue "faltó cargar" de "se cargó y dio cero": los dos turnos que faltan dan el mismo `{}`, y sin este estado el día se calculaba con la mitad de los datos y mentía como si fuera el día entero (fix del 8/09) |
| Turno sin cargar (`cargado: false`) | No existe ningún `produccion_partes` para ese `(fecha, turno)` | Es un dato distinto de "cargado con todo en cero": la pantalla del día (`app/(app)/produccion/page.tsx`) lo lleva aparte y no lo mete en `ProduccionPorProducto` |
| Producción negativa | El cálculo da un número menor a cero | Es un error de carga —depósito mal contado, renglón de despacho perdido— y **se muestra en rojo con la cuenta desglosada, no se recorta a cero**. Recortarlo escondería justo lo que hay que corregir |

`produccionDelDia` prioriza `sin_parte_anterior` por sobre `dia_incompleto`
sólo cuando el turno faltante es, además, el que no tiene anterior; si lo que
falta es un turno entero, gana `dia_incompleto` porque describe la causa real
— no es que falte un dato para restar, es que falta cargar.

## El primer día no va a mostrar producción, y está bien

Es la primera pregunta que va a llegar, así que conviene saber la respuesta
antes: **el primer parte que se cargue es una línea de base, no un día
productivo.**

Su turno 4→12 no tiene parte anterior contra el cual restar, así que sale
`sin_parte_anterior` para todos los productos. Y como ese estado es absorbente
—si un turno no se puede calcular, el día tampoco— **el día entero queda sin
producción y no se exporta nada a la planilla**. Recién el turno 12→20 de ese
mismo día tiene contra qué restar.

No es un error: es la consecuencia directa de que la producción se despeje en
vez de medirse. Comprobado contra la base real el 8/09/2026, con partes de
prueba.

Si molesta empezar con un día en blanco, la salida es cargar **un parte de
arranque**: el turno 12→20 del día anterior al primero real, con el depósito
contado y sin renglones de despacho. Sirve de stock inicial y desde el día
siguiente todo se calcula. Lo que **no** hay que hacer es cargar el primer día
con el depósito en cero para "empezar de cero": eso da una producción igual al
stock entero de cada producto, en positivo, y se exporta a la planilla como
buena.

## La planilla: acá manda el sistema, no ella

Es la diferencia con Compras, donde manda la planilla. Calidad carga en el SdG
y la planilla de Google (`GOOGLE_SHEETS_PRODUCCION_ID`) queda como espejo de
**una sola dirección**, para quien la mira sin entrar al sistema. Al guardar un
parte se escriben `Resumen Producción`, `Resumen Despacho` y `Resumen Rotura`
(`lib/produccion/espejo.ts`).

Su estructura, relevada del archivo real:

- **Encabezados en la fila 4**, fechas en la columna A de la **fila 5 a la
  34**: treinta días. **Los meses de 31 no entran** — el 31 no tiene fila y no
  se le inventa una: `filaDeLaFecha` devuelve `null` y el parte queda
  `sheets_pendiente`.
- `Resumen Rotura` tiene un **segundo bloque con los porcentajes**, que arranca
  donde lo dice el marcador de la **fila 3** (`"% ROTURA / PRODUCCIÓN"`), no la
  de encabezados. Los nombres de producto se repiten idénticos en los dos
  bloques, así que buscar el nombre en toda la fila encontraría siempre el
  primer bloque — por eso `celdasDeResumen` recibe la ventana de columnas
  donde tiene que mirar, en vez de buscar en la fila entera.
- **`Carga Diaria`, `Histórico` y el botón de Apps Script quedan fuera de
  uso.** `Histórico` existía nada más para que el script supiera el stock del
  día anterior; acá esa función la cumple `parteAnterior()` leyendo los partes
  propios, así que esa hoja no tiene lector.

El riesgo asumido, dicho explícitamente: **si alguien edita la planilla a
mano, el SdG no se entera y la pisa** la próxima vez que se guarde ese día. No
hay lectura de vuelta.

Un fallo de escritura no es un `console.warn`: queda en
`produccion_partes.sheets_pendiente` con lo que dijo Google sin traducir, y
`app/api/produccion/planilla/reintentar/route.ts` lo reintenta. Las
credenciales de Google no están en local — esto sólo se prueba en el deploy.

## El renglón del papel y el producto son dos cosas (10/09/2026)

El papel tiene **~15 renglones** agrupados en tres familias (*Filler*, *0-2*,
*Cal*) más un renglón libre "Otros"; el Excel tiene **17 columnas** con otros
nombres, repartidas entre `Carga Diaria` y las hojas de resumen. **La
correspondencia entre los dos no está escrita en ningún lado** — vive en la
cabeza de quien carga hoy el Excel.

Hasta el 10/09/2026 `produccion_productos` intentaba ser las dos cosas: el
renglón del papel y el producto. Y no alcanzaba, porque su vocabulario
—`familia` (`filler`, `0_2`, `cal`, `otros`) + `envase` (`bolsa`, `bolson`)— es
**más grueso que el producto**: la familia `0_2` no dice el material, y en el
libro de Despacho `Calcio 0-2 en Bolsón` son 135 órdenes y `Dolomita 0-2 en
Bolsón` 20. Dos cosas que se venden distinto y que ese vocabulario cuenta
juntas.

Ahora son dos tablas, y el
[spec del catálogo único](superpowers/specs/2026-09-10-productos-catalogo-unico-design.md)
explica por qué:

| | |
|---|---|
| `produccion_renglones_papel` | El renglón del parte y la columna del Excel: `nombre`, `familia`, `nombre_planilla`, `orden`. Sigue **vacía a propósito** |
| `productos` (núcleo) | La cosa física, compartida con Despacho. Sembrada con los 49 productos que salieron en 180 días |
| `produccion_renglon_productos` | Qué productos cuenta cada renglón. **Muchos a muchos** |

**El puente es de muchos a muchos y eso es la decisión.** Si el papel cuenta
"cal en bolsón" en un solo renglón, ese renglón apunta a las tres variantes que
Odoo despacha —CUV 65-70, CUV 55-60 y Puesta en Destino— y la suma sale bien sin
que nadie tenga que elegir una y perder dos. Una columna obligaría a elegir, y
elegir "el que se parece" acá no es un enlace opcional: es sumar la producción de
un producto en la columna de otro, y **eso no se nota nunca**.

`produccion_renglones_papel` sigue vacía porque la lista la define calidad,
renglón por renglón, igual que antes. Lo que cambió es que ya no hay que
inventar en el mismo acto qué producto es cada renglón: eso es un enlace aparte,
que se puede cargar después y corregir sin tocar los partes.

### Los kilos por unidad ya no son del renglón

`envase` y `kg_por_unidad` se fueron al producto, que es de quien son. El kg por
unidad de un renglón **se despeja de sus productos enlazados, y sólo si
coinciden** (`kilosQueCoinciden`, en `lib/produccion/despachos.ts`, con tests):
si un renglón junta una bolsa de 25 kg con un bolsón de 1.000, queda en null y
la comprobación kilos↔bultos no corre para él. Promediarlos o elegir uno sería
inventar el número contra el que se avisa.

O sea que hasta que calidad enlace los productos, la comprobación de kilos no
avisa nada. Es visible en la pantalla —el renglón dice "sin definir"— y no
silencioso.

La pantalla `/produccion/productos` (sólo `admin`, en el menú **Renglones del
parte**) es donde se cargan los renglones y se marcan sus productos.

## Lo que quedó afuera a propósito

- **El granel.** Se mide en toneladas y hoy no está en este circuito. El
  catálogo ya modela `familia` y `envase` como para sumarlo después, pero
  sumarlo es relevar de dónde sale el dato, no una migración.
- **El módulo Despacho.** Los renglones de camión de acá son lo que el capataz
  dice que cargó — el registro de fábrica —, no el remito ni el pesaje. No hay
  catálogo de clientes en el núcleo: `cliente_raw` es texto libre hasta que
  exista ese módulo.
- **Las paradas de máquina como dato estructurado.** El campo `observaciones`
  de un parte es texto libre, igual que en el papel — *"molino de 10:00 a
  10:30, regulación y revisión"*. Convertirlo en paradas con equipo, motivo y
  horario es lo que le serviría a Mantenimiento, pero es un spec aparte que
  necesita que alguien decida el vocabulario.
- **El histórico viejo del Excel.** Este módulo arranca en la fecha en que
  calidad empiece a cargar acá. Traer los meses anteriores es una importación
  puntual, y se decide después de que el catálogo esté cerrado — importar
  contra un catálogo que todavía no está resuelto repetiría el mismo error que
  el módulo existe para evitar.
- **Versionado de correcciones.** Se guarda quién cargó y quién modificó por
  última vez (`cargado_por`/`actualizado_por` en `produccion_partes`), pero no
  el historial completo de cada edición. Se puede agregar sin migrar nada de
  lo que ya existe.

## Lo que está pendiente de una persona

De **calidad**, antes de poder cargar un parte de verdad:

1. ~~**El catálogo canónico**, renglón por renglón.~~ **Hecho el 16/09**: los 17
   renglones están cargados, uno por columna del Excel — ver la sección de abajo.
   Queda, cuando calidad quiera: renombrarlos con las palabras del papel (no
   afecta la exportación) y **enlazar cada renglón con los productos que cuenta**
   en `/produccion/productos`. Sin ese puente la comprobación kilos↔bultos no
   corre, y nada más.
2. **Los kilos por unidad de cada envase.** La bolsa son 25 kg; el bolsón está
   sin confirmar. Sin ese número, `desajustesDeKilos()` no compara ese
   producto — no inventa un kg por unidad, lo salta.
3. **La tolerancia de la comprobación kilos↔bultos**, que hoy arranca en 5% en
   el código. El caso real relevado —1.200 bolsas contra 29.280 kg, cuando
   1.200 × 25 son 30.000— da 2,4% y no dispara aviso; puede estar bien o
   pueden faltar 29 bolsas, y eso no lo decide el código.
4. **Qué número va en cada columna de "Material despachado".** El papel tiene
   dos columnas —*Productos y kilos* y *Cantidad bolsa/bolsón*— y en los
   renglones relevados el número a veces parece kilos y a veces bultos. El
   relevamiento se hizo sobre una foto de letra manuscrita: hay que
   confirmarlo antes de transcribir el primer parte real.

Del **usuario**:

5. **El id de la planilla de Google**, compartida como **editor** con la
   cuenta de servicio del SdG (`GOOGLE_SHEETS_PRODUCCION_ID`, y los tres
   nombres de pestaña si difieren de los que trae el código por defecto:
   `Resumen Producción`, `Resumen Despacho`, `Resumen Rotura`), y la decisión
   de ampliarla a 31 filas si se quiere dejar de perder los meses largos.
6. **Darle nivel `edicion` a quien transcribe.** Al 15/09/2026 hay ocho
   usuarios con acceso al módulo: siete con `lectura` y uno con `admin`.
   **Ninguno con `edicion`**, así que hoy nadie de calidad puede guardar un
   parte — la pantalla se ve y el botón no escribe. Se da desde
   Administración → Usuarios.

## Las tres migraciones del módulo están corridas

Las tres: el enum, el schema y
`20260908082159_produccion_despachos_sin_renglones_duplicados.sql`, que agrega
`unique (parte_id, orden)` a `produccion_despachos`. Verificado contra la base
el 8/09 —el insert duplicado devuelve `23505`— y de nuevo el 15/09: la
migración del catálogo único (`20260910104534`) sólo le renombró una columna a
esa tabla, no la rehízo, así que la constraint sobrevivió.

**El riesgo que la constraint no elimina, y que sigue vigente:**
`app/api/produccion/partes/route.ts` reemplaza el depósito y los despachos de
un parte con un `delete` + `insert` sueltos —PostgREST no da transacciones
multi-sentencia—, así que dos guardados simultáneos del mismo parte (alcanza un
doble clic en Guardar) todavía pueden intercalarse. Lo que cambió es que ahora
el segundo insert **choca y falla en voz alta** en vez de duplicar todos los
renglones y exportar el día con el despacho y la rotura al doble sin ningún
error. Arreglar la carrera de verdad pide un RPC que serialice las dos
escrituras; no está hecho.

Nada de esto frena el código ni los tests, que están completos. Frena cargar
datos de verdad.

## Los renglones ya están cargados, y cómo se cargaron

El 16/09/2026 se cargaron los **17 renglones** de `produccion_renglones_papel`,
uno por cada columna del Excel. La pantalla de carga ya tiene depósito que
mostrar.

**El criterio importa más que el dato.** El campo que puede hacer daño es
`nombre_planilla`: si apunta a la columna equivocada, la producción de un
producto se escribe en la columna de otro y **no se nota nunca**. Así que no se
inventó ninguna correspondencia entre los renglones del papel y las columnas del
Excel — se cargó **un renglón por columna real**, con `nombre` idéntico a
`nombre_planilla`. Los nombres salieron de leer el `.xlsx` con openpyxl, no de
una foto, y están verificados con el propio `celdasDeResumen` del módulo: las 17
ubican una columna distinta, ninguna repetida, ninguna sin columna.

Lo único inferido es la **familia** —el grupo *Filler* / *0-2* / *Cal* del
papel—, y es a propósito: sólo decide cómo se agrupa la pantalla, no toca ningún
número, y si está mal se ve a simple vista. Quedaron dos renglones en `otros`
—*Bolsones de Calcio* y *Bolsones de Magnesio 1-2*— porque son las dos columnas
del Excel que no tienen un renglón evidente en el papel.

**Lo que esto no resuelve.** Los renglones tienen el nombre del Excel, no el del
papel. Si calidad prefiere el del papel, se renombran desde
`/produccion/productos` **sin tocar la exportación**: `nombre` y
`nombre_planilla` son campos distintos, justamente para eso. Y el puente a
`productos` del núcleo sigue vacío — mientras lo esté, la comprobación
kilos↔bultos no corre para ningún renglón, que es su comportamiento documentado
cuando no hay kg por unidad, no una falla.

## Dónde está cada cosa

| | |
|---|---|
| Módulo | `app/(app)/produccion`, `lib/produccion`, `app/api/produccion` |
| El despeje | `lib/produccion/produccion.ts` — `produccionDelTurno`, `produccionDelDia` |
| Cuál es el parte anterior | `lib/produccion/turnos.ts` — `parteAnterior` |
| Renglones → totales | `lib/produccion/despachos.ts` — `totalesDeDespacho`, `roturaTotal`, `desajustesDeKilos` |
| La matriz del mes | `lib/produccion/mes.ts` — `armarLosDias`, reusa las mismas piezas que el día y la planilla |
| El espejo a Sheets | `lib/produccion/espejo.ts` + `lib/produccion/planilla.ts` (celdas, sin red) |
| Permisos | `lib/produccion/auth.ts`, espejando `tiene_acceso_produccion()` / `puede_editar_produccion()` / `es_admin_produccion()` de la base |
| Pantallas | `/produccion` (el día), `/produccion/parte/[fecha]/[turno]` (la carga), `/produccion/resumenes` (el mes), `/produccion/productos` (el catálogo, sólo admin) |
| Tarjeta del inicio | `resumenProduccion()` en `app/api/home/resumen/route.ts` — partes sin cargar de los últimos 7 días, partes que no llegaron a la planilla |
| Migraciones | `20260907154332_produccion_enum_del_modulo.sql`, `20260907154336_produccion_schema.sql` (corridas), `20260908082159_produccion_despachos_sin_renglones_duplicados.sql` (**sin correr**, ver arriba) |
| Diseño acordado | [specs/2026-09-07-produccion-design.md](superpowers/specs/2026-09-07-produccion-design.md) |
| Plan de implementación | [plans/2026-09-07-produccion.md](superpowers/plans/2026-09-07-produccion.md) |

**Ojo con el nombre repetido.** El menú de Mantenimiento ya tenía una entrada
"Producción" (`/mantenimiento/produccion`, tabla `produccion_semanal`): es la
planificación semanal por sector, para decidir ventanas de reparación —una
cosa completamente distinta de este módulo, que es el informe de fábrica por
turno. Los dos conviven porque no comparten tabla ni ruta, pero el nombre
suelto en una conversación puede referirse a cualquiera de los dos.


## Envases estuvo acá un día, y se fue a Calidad (16/09/2026)

El stock de envases se diseñó como sección de este módulo el 15/09, porque el
módulo `calidad` todavía no existía. Al día siguiente sí existió —para el stock
de carbonilla— y envases se mudó: vive en `/calidad/envases`, `lib/calidad/envases/`
y tablas `calidad_envases_*`.

Queda anotado porque los commits del 15 y del 16 lo nombran como parte de
Producción, y porque el spec y el plan viven con ese nombre:
[spec](superpowers/specs/2026-09-15-produccion-envases-design.md) ·
[plan](superpowers/plans/2026-09-15-produccion-envases.md). Lo que hay que saber
de él está en [docs/CALIDAD-ENVASES.md](CALIDAD-ENVASES.md).

## Los molinos: lo que mide el robot, y por qué no se suma con el parte (30/10/2026)

Un frente aparte dentro de Producción, que no toca nada de lo anterior. El
diseño está en
[el spec](superpowers/specs/2026-10-21-produccion-molinos-desde-el-robot-design.md),
el plan en
[el plan](superpowers/plans/2026-10-29-produccion-molinos-desde-el-robot.md), y el
libro de Excel que esto reemplaza, con los cuatro errores que se le encontraron,
en [PRODUCCION-FILLERS-MACRO.md](PRODUCCION-FILLERS-MACRO.md). Cómo llegan los
zips a Drive está en [PRODUCCION-FILLERS-SUBIDA.md](PRODUCCION-FILLERS-SUBIDA.md).
Acá quedan las decisiones y las trampas que no se deducen del código.

### Qué mide, y por qué no se suma con el parte de fábrica

El `PCRobot.exe` de cada molino (**molino Filler 1** y **molino Filler 2
(Calera)**; la palabra va siempre acompañada, porque en `/calidad/ensayos`
"Filler 1" es un producto) cuenta **lo que entra al molino**. El parte del
capataz, que es todo lo de arriba, mide **producto terminado**. Son dos
mediciones del mismo día y **no se suman ni se restan**: una es piedra y la otra
es lo que salió de la planta, con stock en el medio. Si alguna pantalla llega a
mostrar las dos, la columna tiene que decir de cuál habla.

Lo que sí agrega es lo que el parte no tiene: **los turnos 20→00 y 00→04 sólo
existen acá**. El parte registra 4→12 y 12→20 y las otras ocho horas no se
anotan en ningún lado. Y por eso "turno" tiene en este frente un significado
propio: **los cuatro cortes del contador del robot**, con los mismos números de
reloj que el turno del parte (4→12, 12→20) pero sin ser lo mismo. El sello de
cada fila es la hora de **cierre** —23:59, 3:59, 11:59 y 19:59—, y hay una sola
duración teórica por corte: 240, 240, 480 y 480 minutos.

Los cinco indicadores salen de dos números del robot, toneladas y minutos de
marcha. **Las horas no trabajadas no se tipean: se despejan** (duración teórica
menos marcha), por la misma razón que en Trituración — un número tipeado al lado
es el que queda viejo. Lo único que carga una persona es **el motivo de una
parada**.

### Las cuatro patologías del dato, y cómo se resuelve cada una

Las cuatro se encontraron midiendo y las cuatro tienen que seguir resueltas
antes de mostrar un indicador, porque ninguna avisa: un número mal no se
distingue de uno bien. Están fijadas como tests con los casos reales en
`lib/produccion/molinos/turnos.test.ts`.

1. **El turno lo decide la hora de cierre y nunca la posición de la columna.**
   La macro viejaba los encabezados en el orden en que venían las columnas, y el
   renglón de las 19:59 aparecía bajo "Turno 20-00". Con las cuatro columnas
   siempre sumadas juntas no cambiaba ningún total; acá sí, porque el turno es el
   grano que se guarda. (El orden del enum `20_00` primero tampoco es el del
   reloj: todo se ordena en JS por `TURNOS_EN_ORDEN_DE_RELOJ`.)
2. **Un día sin ninguna fila es planta cerrada**, no 24 horas de parada.
   Filler 1 tiene 22 días así en ocho meses —domingos y feriados nacionales— y
   contarlos como parada inventaría 528 horas de molino detenido. Ese día no
   cuenta ni en el numerador ni en el denominador. Un día no operativo **no
   existe en la base**: se reconstruye, y sólo **estrictamente entre** el primer
   y el último día con datos; fuera de ese rango se dice "sin datos", porque un
   día que el zip todavía no trae no es una planta parada.
3. **Pero un turno en cero dentro de un día con filas SÍ es una parada.** Los
   dos robots dicen lo mismo de maneras distintas: Filler 1 no deja filas el
   domingo, Filler 2 **nunca** deja un día sin filas y en cambio escribe ceros.
   El 12/10, feriado, Filler 1 no tiene filas (queda bien excluido) y Filler 2
   tiene cuatro ceros. La tentación es leer "cuatro ceros" como "no operó"; se
   decidió que no, porque los 34 días en cero de Filler 2 no son domingos (hay
   11 domingos, pero también ocho lunes y cuatro martes), y si la Calera no
   muele un martes alguien lo tiene que explicar. Para el caso real que esa
   regla deja afuera —el domingo, el feriado, la parada de planta programada—
   hay una salida explícita: **una persona marca el día como "planta parada"**,
   que cubre los cuatro turnos de una vez. El sistema no lo infiere porque no
   puede: la utilización de Filler 2 sube a 87 % si se marcan esos 34 días, y esa
   diferencia es exactamente la decisión humana.
4. **Un turno que falta se acumula en el siguiente.** Cuando el robot no corta
   un turno, sus minutos y sus kilos aparecen en la fila que sigue, y esa fila
   mide más que su duración teórica (hay una de 1.013 minutos en un bloque de
   480). Se resuelve así, en este orden: bajo 10 minutos de exceso es deriva del
   reloj y la teórica se toma como la marcha; por encima, se mira hacia atrás
   hasta la última fila presente y, si los faltantes explican el exceso, la fila
   queda **acumulada** y su teórica es la suma de la racha; si no, queda
   **inconsistente**. No se promedia nunca.

**La racha se corta en un día no operativo y no lo atraviesa.** Es la decisión
más cara de las cuatro y la que más fácil se "simplifica" después, así que va con
el número: contar las 24 horas de un domingo cerrado como disponibilidad **baja
la utilización de Filler 1 de 85,3 % a 82,0 %** y convierte en acumulados a
turnos que no se pueden explicar. El motivo es que del día que la planta estuvo
cerrada **no se sabe** cuánto de la marcha informada ocurrió entonces: esas horas
no son disponibilidad sino una suposición. Lo que quedó antes del corte pasa a
huérfano, y si el exceso sigue sin explicarse, el turno es inconsistente. Hubo
una versión que sí la atravesaba —era la única que daba los 2.160 minutos de un
caso del spec—, y el costo fue 949 horas no trabajadas contra las 737 reales:
**el test que la exigía estaba mal y se corrigió**; el 09/03 queda acumulado con
720 minutos teóricos, no 2.160.

**Un turno inconsistente pierde sus horas y conserva sus toneladas.** Las
toneladas las pesó una balanza y el problema es del reloj; descartarlas sería
perder producción real. En pantalla muestra la marcha tachada y la parada en
"—": sus horas no se afirman, sus toneladas cuentan. **Un huérfano no aporta
nada**: es un turno que falta sin que ninguna fila posterior lo absorba, no es
parada y no entra en ningún indicador, pero **se lista** ("el robot no informó
este turno"). El caso de todos los días es el de hoy: el zip se corta a las
09:00, así que el día en curso llega con un solo turno, y contar los otros tres
como parada le pondría al día de hoy dieciséis horas de detención fija y dos o
tres "turnos sin explicar" falsos, para siempre. Un turno que una racha absorbe
no tiene renglón propio (la pantalla lo muestra "Cubierto", apuntando al
acumulado), y **los huérfanos son los que ninguna racha absorbió, no todos los
faltantes**: contados de la segunda manera dan 44 en vez de 23, y ese 44 estuvo
en el spec hasta el 29/10/2026.

### Lo que no se guarda, y lo que se guarda pero no se muestra

**La etiqueta `MATERIAL` cruda de `DAT00000001` no se guarda.** Es confiable sólo
cuando el turno molió un material solo, y 127 de 809 turnos (15,7 %) mezclaron
dos; la macro manda el turno entero al de la etiqueta, y eso deja **4.034 de
35.797 toneladas (11,3 %) en el material equivocado**, con la caliza inflada un
21 %. El reparto bueno está en `DAT00000003..06` y es lo que se guarda en
`porMaterial`, sin mostrarse —nada por material en las pantallas—. Tener la
etiqueta cruda al lado es ofrecer el camino corto y equivocado, así que no está.

Y una trampa del reparto: **`porMaterial` no es una descomposición exacta de
`kg`.** En 65 de 842 turnos de Filler 1 la suma del reparto difiere de los kg de
`DAT00000001` —en 64 el kg es mayor, en uno menor, hasta 695 kg— porque son
contadores distintos del robot. El parser no lo fuerza. **Quien lo consuma
normaliza por su propia suma y nunca por `kg`.**

### Importación

El zip es una foto completa desde febrero, no las novedades, así que la
importación **no acumula: reconcilia**, y correrla dos veces no cambia nada
(releer el mismo zip escribe 0 filas; se comprobó contra la base real). Corre por
cron a las 13:00 UTC y con un botón, y lee la carpeta de Drive de la variable
`GOOGLE_DRIVE_PCROBOT_FOLDER_ID` (con `supportsAllDrives=true`: sin eso Drive
contesta 404 sin explicar). Tres frenos que no son opcionales:

- **Lo que una persona cargó no se pisa nunca.** El motivo, la OT y la marca de
  planta parada viven en `produccion_molino_paradas`, y la importación **no
  referencia esa tabla ni para leerla**. Si un turno cambia de kilos, lo cargado
  sigue ahí. Una reimportación que lo borre es la peor falla posible del frente.
- **Un zip que trae menos días de los que la base ya tiene no se aplica**: es el
  `laPlanillaEncogio` de las planillas, por la misma razón. Un archivo truncado o
  un robot reinstalado no puede borrar ocho meses.
- **Un zip de más de un día es un fallo**, no un aviso: lo que dejó de correr es
  la tarea que sube el archivo, y es el único control que mira el resultado y no
  el intento.

Un molino sin zip, o con el zip roto o encogido, no frena al otro. El motivo de
una parada se pide **desde 5 minutos** y **desde la puesta en servicio** del
molino, y los dos son datos del catálogo (`umbral_minutos`, `desde`) y no
constantes: con el corte en 5 se cubre el 98,7 % de las horas perdidas de Filler
1 y se deja de pedir explicación por el 47 % de turnos que tienen una detención
de uno a cinco minutos; y sin la fecha, el primer día habría traído cerca de mil
turnos sin explicar. El umbral es `>=`: 5 minutos sí, 4 no.

**No hay aviso en `lib/home/avisos.ts` a propósito**: el resumen push sale a las
11:30 UTC y la importación es posterior, así que cualquier aviso de este frente
nacería un día atrasado en el teléfono de alguien.

### La trampa de permisos

La lista de OT para enlazar una parada sale de tablas de Mantenimiento, cerradas
con su propia función de acceso. **A quien carga un motivo sin acceso a
Mantenimiento la lista le llegaría vacía y sin error**, y una lista vacía se lee
"no hay OT" — es la misma trampa que el valor hora en `rrhh_empleados_datos`. Por
eso la pantalla de la cola no la lee en ese caso y dice **"No tenés acceso a
Mantenimiento"**, la ruta contesta 403 si igual se intenta tocar el enlace, y una
parada que ya tiene OT enlazada muestra el número aunque quien mira no pueda ver
el detalle. Y **`orden_trabajo_id` ausente no es null**: ausente es "no se toca
el enlace". Sin esa distinción, quien edita un motivo sin Mantenimiento —que no
manda el campo— le borraría la OT a cualquiera que corrigiera.

### Los números de control

Sirven para saber si una importación está bien. **Son de un archivo con fecha,
no constantes**: lo que tiene que reproducirse es el orden de magnitud y el
reparto de estados, no el decimal.

| Sobre el zip del 19/10/2026 | molino Filler 1 | molino Filler 2 (Calera) |
|---|---|---|
| Toneladas | 36.028 | 23.217 |
| Horas de marcha | 4.243 | 3.852 |
| Horas no trabajadas | 737 | 2.144 |
| Utilización | 85,2 % | 64,2 % |
| Productividad | 8,49 t/h | 6,03 t/h |
| Días no operativos | 22 | 0 |

Con todo lo que hay en la base hasta el 29/10 la utilización da 85,3 % y 64,8 %,
y aparece un cuarto turno inconsistente en Filler 1 (el 21/10 19:59, 704 minutos
en un bloque de 480): los otros tres son 26/05 3:59, 04/06 11:59 y 10/08 11:59.
Un resultado lejos de eso es un error de la importación y no una novedad de la
planta.

### Dónde está cada cosa

| | |
|---|---|
| Módulo | `app/(app)/produccion/molinos` (el día, `mes`, `sin-explicar`), `lib/produccion/molinos`, `app/api/produccion/molinos/{importar,paradas}`, `app/api/cron/produccion-molinos-sync` |
| Los cuatro turnos, la racha, huérfanos | `turnos.ts` — `armarTurnos` |
| Los cinco indicadores | `indicadores.ts` — `indicadoresDe` |
| Reconciliar el zip con la base, los frenos | `importar.ts` |
| Qué parada pide motivo | `cola.ts` — `turnosSinExplicar` |
| Cómo se nombra cada cosa en pantalla | `formato.ts` — `nombreDelMolino` |
| Migraciones | `20261029091840_produccion_molinos_enums` y `20261029092611_produccion_molinos_schema`, ya aplicadas |

# Mantenimiento — la falla que tuvo el equipo, al cerrar la OT

Acordado el 26/10/2026. Medido contra la base real ese día. Sin empezar.

## Qué problema resuelve

Una OT cuenta **qué se hizo** y nunca **por qué falló la máquina**. "Cambio de
eje" no dice si el eje se rompió por fricción, por un golpe o porque nunca se
lubricó, y esas tres cosas se arreglan distinto.

Lo que se quiere poder hacer, dicho por quien lo pidió: **ver qué falla se
repite más en cada equipo**.

Hoy eso no se puede ni con buena voluntad, y está medido sobre las 2.264 OT del
26/10/2026:

- El MTBF ya cuenta fallas —toda OT `CORRECTIVO`, **976**— pero no sabe de qué.
  Son un número por equipo, sin causa.
- De esas 976, sólo **99** nombran en la descripción qué le pasó a la pieza
  (fuga 21, traba 20, ruido 17, flojedad 5, quemado 3).
- Las que parecían nombrar una causa —40— son falsos positivos: «Se repuso
  térmico», «Se cambia contactor». Otra vez el trabajo, no el motivo. **La causa
  no está escrita en ningún lado.**
- El campo libre que existe al cerrar ("Observaciones") tiene 4 textos cargados
  en total, y los cuatro cuentan qué se hizo: «Se reparo el cono, no se cambio».

O sea que esto **no ordena información que ya existe: la empieza a juntar**.

## Por qué dos listas y no texto libre

Contar "cuál se repite" exige que la misma falla se escriba igual dos veces, y
el texto libre no lo logra. Medido sobre las mismas 976, tomando la descripción
como lo más parecido a una falla que hay hoy: de 178 equipos, sólo **18** tienen
dos veces el mismo texto exacto. Y lo que sí se repite, se repite escrito de
tres formas:

```
8×  SE ROTAN MARTILLOS
8×  ROTACION DE MARTILLOS
7×  CAMBIO DE MARTILLOS
```

Veintitrés órdenes del mismo evento en el mismo equipo, que para cualquier
conteo son tres fallas distintas. Por eso se elige de una lista.

**Dos listas cortas y no una sola combinada**: la falla es "qué le pasó" + "por
qué" —«Rotura por fricción»—, y una sola lista con las frases ya armadas son
8 × 8 = 64 renglones, que ya no es una lista corta. Dos de ocho se leen de un
golpe y se combinan solas.

## El vocabulario

Acordado el 26/10/2026. **No sale de la planilla** —ahí no está escrito— así que
es una propuesta revisada y aceptada, no una medición.

| Qué le pasó (`falla_modo`) | Por qué (`falla_causa`) |
|---|---|
| `ROTURA` — Rotura / quebradura | `FRICCION` — Fricción o roce |
| `DESGASTE` — Desgaste | `LUBRICACION` — Falta de lubricación |
| `FUGA` — Fuga / pérdida | `FATIGA` — Fatiga por uso |
| `ATASCAMIENTO` — Atascamiento / traba | `SOBRECARGA` — Sobrecarga |
| `FLOJEDAD` — Flojedad / desajuste | `MATERIAL_EXTRANO` — Material extraño |
| `DESALINEACION` — Desalineación | `GOLPE` — Golpe |
| `QUEMADO` — Quemado / falla eléctrica | `CORROSION` — Corrosión o humedad |
| `VIBRACION` — Ruido / vibración | `MONTAJE` — Mala instalación o montaje |

Tres decisiones que no se ven en la tabla:

- **No hay "Otro".** El día que exista, la mitad cae ahí y se termina el conteo.
  Si no entra en ninguna, el campo queda vacío y se escribe el detalle.
- **`MATERIAL_EXTRANO` va sin ñ**, como todas las claves del sistema. `norm()`
  descompone la ñ y le saca la tilde, así que una clave con ñ no matchea contra
  su propia forma normalizada — ya mordió dos veces en este repo.
- **El detalle es uno solo para las dos listas**, no uno por lista. Ahí va lo que
  la lista no puede decir: qué pieza y de qué lado. «eje del lado motor».

## Qué se carga y dónde

En el modal **«Registrar el trabajo»** (`RegistrarOTModal`). En la pantalla de
órdenes es la única puerta: el tablero kanban y el menú de estados interceptan
`REALIZADO` y abren ese modal en vez de cambiar el estado derecho.

Pero **no es la única puerta del sistema**, y conviene tenerlas nombradas:

| Puerta | Qué hace | Lleva la falla |
|---|---|---|
| «Registrar el trabajo» | cierra una OT que existía | **sí** |
| Nueva OT con fecha de cierre | nace cerrada; 5 de las 6 OT creadas desde la app nacieron así | **sí** |
| El mismo formulario sin señal | la versión offline del anterior | **sí** |
| Generar OT de un parte de contratista | crea y cierra **en lote**, sin que nadie conteste por cada una | **no** |

**Que vaya en las tres primeras se decidió el 26/10/2026**, y hay una razón que
ya se pagó: el 19/10/2026 los repuestos por renglones se agregaron al modal y el
formulario sin señal quedó con el campo viejo, así que **la misma OT se cargaba
distinto según de dónde**.

La cuarta queda afuera porque ahí no hay nadie a quien preguntarle: son hasta 25
órdenes generadas de una, y la falla es un dato de quien estuvo en la máquina.

Tres campos nuevos, **los tres opcionales**:

- **Qué le pasó** — desplegable, las ocho de la primera columna.
- **Por qué** — desplegable, las ocho de la segunda.
- **Detalle** — texto libre, una línea.

Van juntos, bajo un rótulo que los separe de lo demás («La falla, si la hubo»),
porque lo que está arriba en ese modal es quién/cuándo/cuánto y esto es otra
cosa.

**Los tres campos se precargan con lo que la OT ya tenga.** El modal se vuelve a
abrir cada vez que una orden se da por realizada, y manda todos sus campos en
cada guardado: sin precargar, alguien que reabre una OT para corregir las horas
le borra la falla sin enterarse. Precargados, borrar es un acto deliberado
—vaciar el desplegable— y eso sí tiene que llegar como `null` a la base. Es la
misma distinción entre "no vino" y "vino vacío" que la ruta ya hace campo por
campo.

**Aparece siempre, no sólo en las correctivas.** Un preventivo encuentra fallas
—se entra a lubricar y el rodamiento está picado— y el campo es opcional: en un
trabajo donde no hubo nada que anotar, se deja vacío y no molesta. Condicionarlo
al tipo haría que la falla encontrada en un programado no tenga dónde ir.

**Una OT ya cerrada no puede cargar su falla sin reabrirla.** Las 976 correctivas
que ya existen se quedan sin causa para siempre, y las que se cierren hoy y se
quieran corregir mañana hay que pasarlas a "en proceso" y volver a cerrarlas.
Es una limitación asumida de esta primera versión, no un olvido.

## Dónde se guarda

**Tres columnas nuevas en `ordenes_trabajo`**: `falla_modo`, `falla_causa`,
`falla_detalle`, las tres `text` y nulas. No una tabla aparte: una falla está
atada a exactamente una OT —se anota al cerrarla—, así que una tabla sólo
agregaría un join y la posibilidad de una fila huérfana.

Es el mismo camino que tomó el GUT cinco días antes, y por la misma razón
verificada ahí: **el `upsert` de la sincronización arma su payload desde lo que
lee de la planilla y nunca nombra estas columnas**, así que `ON CONFLICT DO
UPDATE` no las toca y la falla sobrevive a cada corrida. Lo que sí se la lleva es
el borrado de espejo: si la fila desaparece de la planilla, la OT se borra y su
falla con ella, que es lo correcto —esa orden ya no existe.

**Sin `check` en la base y sin enum.** La validación vive en la aplicación
(`esModoDeFalla`, `esCausaDeFalla`) y la ruta rechaza lo que no esté en la
lista. El motivo es que este vocabulario se va a tocar: un valor de enum nuevo
necesita su propia migración y viajar solo (`55P04`), y un `check` obliga a una
migración por cada palabra que se agregue. Lo que no se negocia es que la ruta
**no acepte texto arbitrario**: sin eso vuelve el texto libre por la ventana y
el conteo se muere en silencio.

## La falla no viaja a la planilla

**Riesgo asumido, no olvido**, y es la misma decisión que el GUT: exportarla
significaría escribir en el libro que está por darse vuelta
([las planillas las llena el sistema](2026-10-19-las-planillas-las-llena-el-sistema-design.md)),
y la regla de "toda ruta que toque un campo que se exporta tiene que exportar"
no aplica a un campo que no se exporta. Quien lee la planilla y no entra al SdG
no ve la falla. Cuando el sistema sea el que llena la planilla, esto se revisa.

Hay una alternativa que **se descartó**: colgarla del texto de la columna W
(Observaciones), que sí se escribe hoy. Mezclaría en una celda dos cosas que se
escriben por separado y que la vuelta de la sincronización no sabría volver a
partir.

## Qué se ve, y dónde

En la **ficha del equipo** (`/mantenimiento/equipos/[id]`), una sección nueva
—«Fallas registradas»— entre Confiabilidad y el historial de estado, porque es
de lo que habla la confiabilidad.

Lo que muestra, en este orden:

1. **El ranking**, que es lo que se pidió: cada falla distinta con cuántas veces
   pasó, ordenada por veces. La clave de "la misma falla" es **modo + causa**:
   «Rotura por fricción · 3 veces · última el 12/09».
2. Debajo de cada una, un renglón por OT: su número y **su detalle**, que es la
   única parte de la falla que no entra en la clave y que si no se muestra acá
   no se ve en ninguna pantalla —en esta app no hay página de una OT sola—.

Una falla con modo y sin causa —o al revés— cuenta igual, con la mitad vacía:
«Rotura · 2 veces». Exigir las dos para contar tiraría a la basura justo lo que
alguien se tomó el trabajo de anotar. Por la misma razón, **una falla que sólo
tiene detalle también entra**, agrupada como «Sin clasificar»: el documento
mismo le pide a la gente que use ese caso cuando ninguna opción sirve, así que
descartarlo sería pedir algo y después tirarlo. Y un equipo que sólo tenga de
ésas **sí muestra la sección**.

**El ranking es de siempre y de todos los tipos**, y la tarjeta de
Confiabilidad que está justo arriba cuenta otra cosa: fallas = correctivas de
los últimos 365 días. Dos números que dicen "fallas" uno encima del otro se van
a contradecir, así que el rótulo de la sección tiene que decir de qué habla
—«todas las registradas, desde siempre»— en vez de dejar que el lector suponga.
Acotarlo a la ventana del MTBF sería peor: lo que se pidió es ver qué se repite,
y una falla que pasó hace catorce meses es exactamente lo que hay que ver.

**La fecha de una falla es `fecha_ejecucion`**, la misma que usa el MTBF y por
el mismo motivo: `fecha` es cuándo se cargó la fila en la planilla, y hay
órdenes cargadas semanas después de que la máquina se rompió.

**La sección no aparece si el equipo no tiene ninguna falla cargada.** Van a ser
casi todos durante meses, y una tarjeta vacía en 178 fichas es ruido.

## Qué NO es esto

- **No cambia el MTBF.** Sigue contando una falla por OT correctiva. Que una OT
  tenga o no cargada la causa no mueve el número: si la falla mandara, el MTBF
  caería a cero el día que alguien deje de completar el campo opcional.
- **No es un árbol de causa raíz.** Dos listas de ocho y una línea de texto. El
  día que haga falta más, se verá con datos cargados y no antes.
- **No toca las 976 correctivas viejas.** No se infiere la causa de la
  descripción: inventarla es peor que no tenerla, que es la regla de la casa
  —enlazar al que se le parece es peor que dejar en null—.
- **No agrega una pantalla de "todas las fallas de la planta".** Si después de
  unos meses el ranking por equipo sirve, esa pantalla se piensa con datos.

## Las piezas

- **Migración**: las tres columnas. La corre una persona a mano en Supabase.
- **`lib/mantenimiento/fallas.ts`** (con tests, que es donde vive la lógica que
  importa): el vocabulario, `esModoDeFalla` / `esCausaDeFalla`, `etiquetaDe`, y
  `rankingDeFallas(ots)` que agrupa por modo+causa, cuenta, ordena por veces y
  devuelve la última fecha y los números de OT.
- **`RegistrarOTModal`**, **`NuevaOTModal`** y **`FormularioOTOffline`**: los
  tres campos y su envío. En los dos últimos aparecen **sólo cuando la orden
  nace cerrada** —hay fecha de cierre—, que es cuando hubo una falla que contar;
  pedirlos en una OT que recién se pide sería preguntar por algo que todavía no
  pasó. Conviene que los tres campos sean **un componente**, como
  `RepuestosDeLaOT`: tres formularios con la misma lista escrita tres veces es
  cómo se desincronizan.
- **`app/api/mantenimiento/ordenes` (PATCH y POST)**: suma los tres a la lista
  blanca —hoy es explícita y rechaza lo que no esté— validando contra el
  vocabulario. Las tres son columnas de `ordenes_trabajo`, así que van por
  `update` y no por el `registro` que escribe la planilla. En el PATCH, "no vino
  el campo" y "vino vacío" tienen que seguir siendo cosas distintas: lo primero
  deja lo que había, lo segundo lo borra.
- **La ficha del equipo**: la consulta de la página trae las OT con falla del
  equipo y la sección las muestra.
- **El catálogo del asistente** (`lib/asistente/catalogo.generado.json`), que se
  genera desde la base y se commitea: con las tres columnas adentro, el
  asistente puede contestar "qué falla se repite más" sin que exista ninguna
  pantalla nueva. **Va después de que una persona aplique la migración**, porque
  se genera leyendo la base — el GUT necesitó exactamente este paso aparte.

## Lo que queda a criterio de quien lo construya

- La forma exacta de la sección en la ficha y el copy de los rótulos.
- Si el ranking se corta en N fallas o las muestra todas (hoy no hay dato para
  decidirlo; con 178 equipos y cero fallas cargadas, cualquier corte es una
  suposición).
- Si los dos desplegables van uno al lado del otro o uno abajo del otro en el
  teléfono. **Ojo con el ancho**: en este repo una clase `w-*` al lado de
  `.input` no hace nada (CLAUDE.md), el ancho va en un `div` que envuelva.

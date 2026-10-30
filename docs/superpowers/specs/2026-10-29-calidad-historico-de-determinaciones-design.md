# El histórico de determinaciones, consultable

Diseñado el 29 de octubre de 2026.

Los tres años de laboratorio que viven en `Determinaciones 2026.xlsx` pasan al
SdG, de sólo lectura, para poder consultarlos sin abrir el archivo.

## Por qué, y por qué ahora

**El momento es un reclamo de un cliente.** Calidad busca valores viejos cuando
alguien se queja de un despacho: qué dio el ensayo de ese producto por esas
fechas. Hoy eso obliga a abrir un Excel de nueve hojas, saber en cuál mirar y
—sin saberlo— leer números que no están todos en la misma escala.

## Esto revierte una decisión del spec de Ensayos

El [spec de Ensayos](2026-10-06-calidad-ensayos-design.md) dejó el histórico
afuera **a propósito**:

> Cualquier regla sería **una interpretación mía de qué quiso decir cada
> número**, y un histórico mal escalado es peor que no tenerlo: se grafica igual.

> **El histórico queda en el Excel.** […] Es el precio de no inventar una escala
> para 900 celdas.

**Ese argumento era correcto y este diseño no lo contradice: lo acata.**

La primera versión de este documento decía que la aritmética de cada fila
permitía comprobar su escala, y que por eso la conversión dejaba de ser una
interpretación. **Era falso, y falso justo para las filas que importaban.** La
comprobación necesita un acumulado y al menos dos retenidos en la misma fila,
pero antes del corte los retenidos casi no se medían — `Ret #50`, `#200` y `#325`
nacieron con la planilla nueva. Medido:

| Hoja | Filas anteriores al corte | Que la aritmética puede verificar |
|---|---|---|
| Filler 1 | 127 | **27** |
| Cal | 135 | **0** |
| Filler 2 | 100 | **0** |

De 362 filas, la aritmética alcanza a 27.

**De ahí sale la decisión central de este diseño: no se convierte nada.** El
valor se guarda **tal como está escrito en la planilla**, y lo que el sistema
aporta es decir **en qué escala está**. La inferencia vive en una etiqueta, no en
el dato: si la etiqueta se equivoca, el número sigue siendo el que alguien
escribió, y se puede volver a etiquetar sin reimportar.

Eso es lo que hace compatible este spec con el anterior. No se inventa una escala
para 900 celdas: se guardan las 900 celdas como están y se declara, por columna y
por época, en qué escala se las leyó.

## Qué se quiere y qué no

**Se quiere** que alguien con un reclamo escriba un cliente, un producto o una
determinación, acote por fechas y vea lo que se midió — sin que le importe si
salió del Excel viejo o se cargó ayer en Ensayos.

**No se quiere**:

- que el histórico se edite. Es memoria, no un registro vivo.
- que entre a `calidad_ensayos_muestras`. Ese modelo guarda gramos y despeja los
  porcentajes; el Excel perdió los gramos.
- que alimente promedios, gráficos de control o límites junto con lo nuevo. Dos
  orígenes con distinta confiabilidad en la misma serie es cómo se arma un
  gráfico que miente.
- **que el sistema transforme ningún número.** Ni escalas, ni redondeos, ni
  acumulados recalculados.

**Sería un fracaso** —aunque funcione— que alguien le conteste a un cliente con
un número cien veces mal porque la pantalla no distinguió una fracción de un
porcentaje. Ése es el riesgo que gobierna todo el diseño.

## Lo que el archivo es, medido

Nueve hojas, **3.511 valores** entre el 06/11/2023 y el 21/10/2026, en **tres
formas distintas**:

| Forma | Hojas | Valores |
|---|---|---|
| Tabular, una fila por día | `Filler 1`, `Cal`, `Filler 2`, `Despacho a Kartonsec`, `Despacho a Emapi` | 3.087 |
| Tabular, pero no es un ensayo | `Despachos cal fillerizada` | 254 |
| Bloques sueltos | `Calcio`, `Otros`, `Separadoras` | 170 |

Los **bloques sueltos** tienen una estructura repetida: la fecha arriba, los
nombres de muestra de costado, y debajo una fila por determinación con su valor
para cada muestra.

```
2026-06-17   | Calcio 0-1 | Calcio 0-2
Humedad bh   |    0,0068  |    0,0087
P recipiente |    426,68  |    433,22
```

Eso se lee como `(fecha, muestra, determinación, valor)` — **y las cinco
tabulares son lo mismo puesto a lo ancho.** De ahí sale la forma de la tabla.

### La escala, que se etiqueta y no se toca

El 02/06/2026 Calidad cambió de planilla —confirmado por quien la lleva—. Desde
ese día los retenidos y acumulados se anotan como porcentaje; antes, como
fracción.

**No todas las columnas cambiaron.** `Ret #50`, `Ret #200` y `Ret #325`
**nacieron** con la planilla nueva: nunca estuvieron en fracción. Una regla de
"antes del corte, por cien" las deja con 1031 donde el acumulado dice 11,3 — pasó
al escribir este spec.

La etiqueta la decide **cada columna de cada hoja**, con sus propios datos:

> Si una columna tiene valores anteriores al 02/06/2026 y **todos** son menores a
> 1, esos valores se etiquetan `fraccion`. El resto, `porcentaje`.

El ámbito es **por hoja**, no cruzando las nueve: `Despacho a Kartonsec` y
`Despacho a Emapi` arrancan el día mismo del corte, así que ninguna de sus
columnas tiene valores anteriores y todas quedan `porcentaje`, que es lo
correcto. Con ámbito global, `Ret #100` las habría arrastrado.

**La humedad es `fraccion` siempre**, en todas las hojas y todas las épocas
(0,0043 ≈ 0,43%). Nunca cambió.

Con esa regla, sobre las cinco hojas tabulares (3.087 valores):

| etiqueta | valores | qué son |
|---|---|---|
| `fraccion` | **958** | 578 retenidos y acumulados anteriores al corte, más las 380 humedades, que son fracción siempre |
| `porcentaje` | **1.544** | todo lo posterior al corte, más las columnas nacidas con la planilla nueva |
| `absoluto` | **585** | el peso volumétrico, en g/l |

Las otras cuatro hojas aportan 424 valores más, casi todos `absoluto` —gramos,
toneladas— y las humedades de los bloques sueltos, `fraccion`.

### La aritmética, que ya no justifica nada pero sigue sirviendo

El acumulado de una malla es la suma de los retenidos hasta esa malla. **Esa
comprobación sólo corre cuando la fila tiene un acumulado y al menos dos
retenidos** — si no, no hay nada contra qué comparar, y la mayoría de las filas
viejas están en ese caso (`Cal` tiene 204 filas con acumulado y ningún retenido).

No sirve para validar la etiqueta de escala, como se creyó al principio. Sirve
para lo que sí puede: **marcar las filas donde la planilla no cierra contra sí
misma.** Son **12** en todo el libro, con tolerancia de 0,15 puntos, y todas
posteriores al corte. Entran como están, con `revisar` explicando qué no cerró.
Corregirlas sería interpretar.

De las 27 filas anteriores al corte que **sí** se pueden comprobar —todas de
`Filler 1`— cierran las 27 bajo la lectura `fraccion`. Es evidencia de que la
etiqueta acierta donde se la puede probar; no es prueba para las otras 335.

### Lo que no entra aunque esté en una celda

**Las 22 celdas de agregación.** El libro tiene 22 fórmulas `AVERAGE`/`SUM`, todas
en `Calcio`, metidas entre las muestras. Un promedio guardado como medición es
exactamente el error que este diseño evita: alguien le contestaría a un cliente
con un promedio creyendo que es un ensayo. Se detectan por la **fórmula** de la
celda —no por el valor— y se descartan.

## El modelo

Una tabla larga: **una fila por valor medido**.

```sql
calidad_historico_determinaciones
  id
  fecha           date not null
  hoja            text not null   -- de qué pestaña salió, literal
  origen_raw      text not null   -- lo que decía la planilla: producto, cliente o muestra
  producto_id     uuid references calidad_ensayos_productos(id)  -- null si no se reconoce
  determinacion   text not null   -- "Ret #100 (%)", "Humedad bh (%)", "Cal (Ton)"…
  malla           integer         -- despejada de la etiqueta cuando la hay
  valor           numeric not null  -- TAL COMO ESTÁ EN LA PLANILLA. No se transforma.
  escala          text not null check (escala in ('fraccion','porcentaje','absoluto'))
  unidad          text            -- '%', 'g/l', 'ton'
  revisar         text            -- por qué mirarlo: "el acumulado no cierra contra sus retenidos"
  fila_excel      integer not null
```

`escala` es **la lectura del sistema, no una propiedad del número**: `absoluto`
para lo que no es porcentaje (g/l, toneladas, gramos). La pantalla la usa para
mostrar el valor sin ambigüedad; cambiarla no requiere reimportar.

Lo que esta forma compra: **lo que varía entre hojas deja de ser un problema de
esquema.** `Separadoras` tiene mallas como determinación y `Despachos cal
fillerizada` tiene toneladas; las dos entran sin columnas vacías.

**`producto_id` es el puente con Ensayos y queda en null sin certeza.** Medido:
de 55 orígenes distintos, **7 ya son productos del catálogo** —`Filler 1`, `Cal`,
`Filler 2`, `Despacho a Kartonsec`, `Despacho a Emapi`, `Calcio 0-1`, `Calcio
0-2`— y cubren las cinco hojas tabulares, o sea casi todos los valores. El enlace
es **por nombre exacto**, sin aproximaciones. Los otros 48 son muestras de proceso
(`Retorno A (1)`, `Tamiz`) y **19 clientes** de la hoja de despachos (`Marcalba`,
`Roggio`, `Sacde`…), que no tienen catálogo en el núcleo: van con `origen_raw` y
`producto_id` en null.

**Sólo lectura, con policy de `select` y ninguna de escritura.** Sin trigger, a
diferencia de `auditoria`: una importación equivocada **tiene que poder
rehacerse**, y un trigger que frena al cliente de servicio dejaría el error
escrito para siempre. La inmutabilidad acá protege de la app, no del importador.

## La pantalla

`/calidad/historico`: **un buscador**, con la vista de planilla adentro.

Se escribe lo que se tenga, se acota por fechas, y el resultado es una lista con
fecha, origen, determinación y valor, cada fila marcada como histórica. El valor
se muestra **con su escala**: `0,125` etiquetado como fracción no se confunde con
`12,5` etiquetado como porcentaje, y la pantalla lleva una nota fija explicando
que el 02/06/2026 cambió la planilla y con ella la forma de anotar.

Cuando el resultado viene de una de las cinco hojas tabulares se puede ver **como
planilla**: una fila por día con las determinaciones a lo ancho, que es como
Calidad lo leyó durante tres años. **Pivotea por `(fecha, fila_excel)` y no sólo
por fecha**: hay 29 fechas repetidas en `Cal` y 4 en `Filler 2` que son muestras
distintas del mismo día, y colapsarlas haría desaparecer una. Si el resultado
cruza dos hojas con juegos de mallas distintos, va **una planilla por hoja**.

Se decidió así sobre dos bocetos con datos reales: la vista de planilla sola deja
cuatro hojas afuera, y el buscador solo cuesta más para comparar días seguidos.

**La búsqueda encuentra las dos cosas.** El histórico y `calidad_ensayos_muestras`
salen juntos, ordenados por fecha, cada uno con su marca. Para eso el lado de
Ensayos se **aplana al leer** a la misma forma larga: una fila por humedad, peso
volumétrico, cal útil vial, y una por cada retenido y acumulado despejado de sus
gramos. Las etiquetas se reusan de `lib/calidad/ensayos/reporte.ts` para que las
dos mitades digan `"Humedad bh (%)"` igual. Lo de Ensayos sale siempre con escala
`porcentaje`, que es lo que sus cuentas devuelven.

El filtro de texto corre **en SQL sobre el histórico** —son 3.511 filas que van a
crecer poco, pero la tabla no tiene por qué viajar entera— y el lado de Ensayos se
filtra por producto y fecha antes de aplanar. Un buscador que traiga tres años de
retenidos a memoria para filtrarlos es el `.limit(3000)` de este módulo.

## El solape, chico y a la vista

Ensayos arranca el 06/10/2026; las hojas tabulares del Excel terminan el 07/10.
Se pisan **5 días-producto**: `Filler 1`, `Filler 2` y `Cal` del 6 y el 7.

Se importan igual y se muestran los dos. Saltearlos escondería que durante dos
días se cargó en los dos lados, y si los números difieren eso es justamente lo que
alguien querría ver.

## Cómo se importa

Una corrida única, con la forma de los otros importadores del repo
(`scripts/importar-*.mts`), contra el archivo que entregó Calidad. Es **DML**, así
que lo corre el agente con `SUPABASE_SERVICE_ROLE_KEY`; la migración la corre una
persona, como siempre.

**El importador imprime sus conteos y hay que compararlos antes de darlo por
bueno.** Los medidos el 29/10/2026 son el oráculo:

| | |
|---|---|
| valores totales | 3.304 |
| etiquetados `fraccion` (las cinco tabulares) | 958 |
| etiquetados `porcentaje` (las cinco tabulares) | 1.544 |
| etiquetados `absoluto` (las cinco tabulares) | 585 |
| filas con `revisar` | 28 |
| celdas de agregación descartadas | 22 |
| orígenes distintos | 47, de los cuales 7 enlazan a producto |
| rango | 06/11/2023 → 21/10/2026 |

**Dos de esos números cambiaron el 30/10/2026, al correr el parser de verdad
contra el archivo.** Los anteriores —3.511 valores y 12 filas con `revisar`—
salían de un prototipo que todavía convertía las escalas e inventaba nombres de
muestra, y los dos se movieron por decisiones que el propio diseño tomó después:

- **3.304 y no 3.511**, y **47 orígenes y no 55**, porque un bloque sin nombre de
  muestra ya no genera fila. Los 8 orígenes que desaparecieron eran basura del
  prototipo (`30.9`, `Feb`, `col 3`).
- **28 filas con `revisar` y no 12**, porque sin conversión la aritmética ve lo
  que la conversión tapaba: **23 filas de `Filler 1` entre febrero y mayo de 2026
  tienen el `Ret #50` en porcentaje y el `Ret #100` en fracción, en el mismo
  renglón.** Es el mismo fenómeno que el spec de Ensayos midió por su cuenta
  —«27 filas de Filler 1 tienen las dos escalas EN EL MISMO RENGLÓN»— y que la
  regla por columna no puede distinguir: un 0,6% y una fracción de 0,6 se
  escriben igual. Quedan marcadas, que es lo correcto: quien conteste un reclamo
  con una de esas filas tiene que mirarla antes.

Si un conteo no da, la regla cambió de significado y hay que mirar antes de
escribir. El archivo no se versiona en el repo —es de Calidad, no del sistema—,
así que estos números son lo único que permite reproducir la corrida.

**Detección de bloques** en las tres hojas sueltas: un bloque empieza en una fila
cuya primera celda es una fecha; las celdas a su derecha son los nombres de
muestra; las filas siguientes son `(determinación, valor por muestra)` hasta la
próxima fila con fecha en la primera celda. Una celda sin valor numérico no
genera fila.

## Lo que queda afuera

- **Editar el histórico.** No hay pantalla ni ruta de escritura.
- **Mezclarlo con los límites.** No se compara contra `calidad_ensayos_limites`
  ni dispara avisos: un límite de hoy contra un número de 2023 medido con otro
  recipiente no dice nada.
- **Gráficos.** La pantalla es una tabla. Un gráfico que mezcla dos escalas y dos
  orígenes es exactamente lo que el spec de Ensayos quería evitar.
- **Volver a importar.** Carga única; si mañana aparece otro archivo, es otra
  corrida decidida a mano.

## Riesgos asumidos

- **La etiqueta de escala es una inferencia.** Está corroborada en las 27 filas
  donde se la puede probar y apoyada en el cambio de planilla confirmado, pero
  para las 335 restantes de `Cal` y `Filler 2` **no hay forma de verificarla**.
  Lo que la vuelve aceptable es que no toca el dato: el número guardado es el que
  alguien escribió, y una etiqueta equivocada se corrige con un `update` sin
  reimportar nada.
- **El peso volumétrico arrastra un error sistemático del 1%.** El spec de
  Ensayos lo midió: se calculó con dos recipientes, 333,3 cc y 330 cc, y el bueno
  es 330. El Excel guarda el resultado, no el volumen, así que no se puede
  corregir sin saber cuál usó cada fila. Importa para un reclamo al límite, no
  para una tendencia.
- **Las 12 filas que no cierran entran igual**, marcadas y no corregidas.
- **48 de 55 orígenes quedan sin `producto_id`.** Se buscan por texto; lo que
  pierden es aparecer al filtrar por producto. Casi todos son muestras de proceso
  y clientes de despacho, no los productos del reclamo.
- **`Despachos cal fillerizada` no es un ensayo y entra igual**, porque se pidió
  todo. El spec de Ensayos había dicho que entraría como pantalla propia; acá
  entra a la misma tabla pero **marcada con su hoja**, y no se mezcla con los
  retenidos en ninguna vista. Si molesta, se filtra por `hoja`.
- **Tres humedades atípicas en 336** —27/08/2025 en dos hojas, 31/10/2025— entran
  como están. Pueden ser muestras mojadas de verdad.

## Lo que falta de una persona

1. **Correr la migración.**
2. **Decidir si los 19 clientes de `Despachos cal fillerizada` valen un
   catálogo.** Hoy van como texto. Si Despacho termina teniendo clientes de
   verdad, esto se engancha ahí y es otra tarea.

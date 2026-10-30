# El histórico de determinaciones

Los tres años de laboratorio que vivían en `Determinaciones 2026.xlsx`, dentro
del SdG y de sólo lectura. Vive en `/calidad/historico`, `lib/calidad/historico/`
y la tabla `calidad_historico_determinaciones`.

Diseño: [spec](superpowers/specs/2026-10-29-calidad-historico-de-determinaciones-design.md) ·
[plan](superpowers/plans/2026-10-29-calidad-historico-de-determinaciones.md).

## Para qué existe

Para un momento concreto: **entra un reclamo de un cliente** y Calidad necesita
saber qué dio el ensayo de ese producto por esas fechas. Antes eso obligaba a
abrir un Excel de nueve hojas y saber en cuál mirar.

## Lo único que hay que saber antes de tocarlo

**El valor no está transformado.** `valor` es el número tal como lo escribió el
laboratorio, y `escala` es **la lectura del sistema**, no una propiedad del
número:

| escala | qué quiere decir |
|---|---|
| `fraccion` | `0,19` son 19% |
| `porcentaje` | `19` son 19% |
| `absoluto` | g/l, toneladas, gramos |

Eso no es un detalle de implementación: es la decisión que hace compatible este
módulo con el spec de Ensayos, que había dejado el histórico afuera para no
inventarle una escala a 900 celdas. Si la etiqueta se equivoca, el número sigue
siendo el bueno y se corrige con un `update`. Si se hubiera convertido, no.

## Las cuatro cosas que no se deducen del código

- **La aritmética no valida la escala**, aunque lo parezca. El acumulado tiene
  que dar la suma de sus retenidos, pero eso necesita dos retenidos en la fila y
  antes del corte casi no se medían: **alcanza a 27 de 362 filas**, y a ninguna
  de `Cal` ni de `Filler 2`. Sirve para otra cosa — marcar las filas donde la
  planilla no cierra contra sí misma — y no para probar el etiquetado.
- **Las 28 filas marcadas no son un error del sistema.** 23 son de `Filler 1`
  entre febrero y mayo de 2026 y tienen **el `Ret #50` en porcentaje y el
  `Ret #100` en fracción, en el mismo renglón**. Es el mismo fenómeno que el
  spec de Ensayos midió por su cuenta, y la regla por columna no puede
  distinguirlo: un 0,6% y una fracción de 0,6 se escriben igual. Quedan marcadas
  para que nadie conteste un reclamo con una de ellas sin mirarla.
- **La humedad nunca cambió de escala.** Es fracción de punta a punta, y por eso
  `escalaDelValor` recibe la etiqueta: sin esa excepción, 251 humedades
  posteriores a junio quedan como porcentaje y un `0,0102` se lee `0,01%` en vez
  de `1,02%`. Lo encontró la comparación contra el archivo real, no un test.
- **Los conteos del oráculo son lo que permite reproducir la importación.** El
  archivo no se versiona —es de Calidad, no del sistema—, así que si se vuelve a
  correr, estos números son el único control:

| | |
|---|---|
| valores totales | 3.304 |
| `fraccion` (cinco tabulares) | 958 |
| `porcentaje` (cinco tabulares) | 1.544 |
| `absoluto` (cinco tabulares) | 585 |
| filas con `revisar` | 28 |
| agregaciones descartadas | 22 |
| orígenes distintos | 47, de los cuales 7 enlazan a producto |
| rango | 06/11/2023 → 21/10/2026 |

`npx tsx scripts/importar-determinaciones-historico.mts --secar <ruta.xlsx>` los
imprime sin escribir nada.

## Lo que entra y lo que no

Entran las nueve hojas. Las 22 celdas `=AVERAGE()` de `Calcio` **no**: se
detectan por la fórmula —nunca por el valor, que es un número como cualquier
otro— porque un promedio guardado como medición haría que alguien le conteste a
un cliente con un promedio creyendo que es un ensayo.

`Despachos cal fillerizada` no es un ensayo y entra igual, porque se pidió todo.
Queda marcada con su hoja y no se mezcla con los retenidos en ninguna vista.

## Riesgos asumidos

- **El peso volumétrico arrastra un error sistemático del 1%**: se calculó con
  dos recipientes, 333,3 cc y 330 cc, y el bueno es 330. El Excel guarda el
  resultado y no el volumen, así que no se puede corregir sin saber cuál usó cada
  fila. Importa para un reclamo al límite, no para una tendencia.
- **40 de 47 orígenes quedan sin `producto_id`** — muestras de proceso y
  clientes de despacho, que no tienen catálogo en el núcleo. Se buscan por texto;
  lo que pierden es aparecer al filtrar por producto.
- **El histórico no se compara contra `calidad_ensayos_limites`** ni dispara
  avisos. Un límite de hoy contra un número de 2023 medido con otro recipiente no
  dice nada.

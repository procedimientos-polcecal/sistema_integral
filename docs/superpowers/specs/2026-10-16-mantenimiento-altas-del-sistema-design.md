# Mantenimiento — el alta del sistema deja de compartir pestaña con el formulario

**16/10/2026.** Diseño acordado. Reemplaza la decisión de escribir las altas en
`Respuestas de formulario`, que no tiene spec propio: vivía en el encabezado de
[lib/mantenimiento/formulario.ts](../../../lib/mantenimiento/formulario.ts) y en
[MANTENIMIENTO-INTEGRACION.md](../../MANTENIMIENTO-INTEGRACION.md).

## Qué pasó

El 16/10/2026 se creó la OT **2796** desde el sistema y se le escribió la fila
en `Respuestas de formulario`. Después entraron dos respuestas del formulario.
Medido a las 11:3x:

| fila | N° OT | |
|---|---|---|
| 2175 | 2795 | del formulario |
| 2176 | **2798** | respuesta nueva |
| 2177 | **2799** | respuesta nueva |
| 2178 | 2796 | del sistema, **corrida dos lugares** |
| 2179 | 2797 | del sistema, **corrida dos lugares** |

**Google Forms inserta sus respuestas dentro de su propio rango y empuja hacia
abajo cualquier fila ajena.** Las columnas `A`–`J` y `S` del master son el
derrame de los `IMPORTRANGE` y se movieron con ellas; las `K`–`R` y `T`–`W` son
literales escritos por posición y **se quedaron**.

Resultado medido: la **OT 2798 figuraba como «Realizado, 1 h, Aguirre,
Mendizabal»** — el registro de la 2796, pegado a la orden de otro. Es la peor
forma de error que tiene este sistema: no rompe nada, no avisa, y afirma que un
trabajo está hecho.

Cuando se fue a desarmar, el orden ya había vuelto a ser numérico. Lo frenó la
guarda del script, que exigía encontrar la 2798 en esa fila y encontró la 2796.
**No se sabe qué lo reacomodó**, y por eso no alcanza con que hoy esté bien.

### Por qué la premisa del diseño anterior era falsa

Decía: *«acá sí conviven, porque el master ordena por N° de OT y entonces da
igual en qué fila física quede cada uno»*. Las cuatro fórmulas de importación
del master se leyeron el 16/10/2026 y **ninguna tiene `ORDER BY`**. El diseño
dependía de una propiedad que la planilla no tenía, y nada lo comprobaba.

Compras pasó por esto el 11/09/2026 y lo dejó escrito en
[COMPRAS-SINCRONIZACION.md](../../COMPRAS-SINCRONIZACION.md). Esto es portar esa
solución, no inventar una.

## La decisión

**El alta del sistema se escribe en una pestaña propia, `Altas del sistema`, del
mismo libro de respuestas. El master apila las dos fuentes ordenadas por N° de
OT.**

Las dos mitades son necesarias y ninguna alcanza sola:

- **La pestaña aparte** saca las filas del sistema del rango donde Forms
  inserta. Forms no puede volver a correrlas.
- **El `ORDER BY`** es lo que hace que agregar una fila no mueva a las de
  arriba. Sin él, apilar `{formulario; sistema}` deja el bloque del sistema
  debajo, y cada respuesta nueva lo corre entero un lugar — el mismo problema
  por otra puerta. Como toda OT nueva es el máximo de la serie, ordenar por N°
  deja la salida **estrictamente creciente**: lo nuevo siempre cae al final.

## Lo que hay que construir

### 1. La pestaña

`Altas del sistema` en el libro de respuestas
(`GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID`), con **el mismo encabezado de 31
columnas** que `Respuestas de formulario`, fila 1. Los datos arrancan en la 2.
Nadie inserta ahí salvo el sistema.

### 2. Las cuatro importaciones del master

Hoy son cuatro `QUERY(IMPORTRANGE(...))` sobre una sola pestaña. Pasan a apilar
las dos y a ordenar. Las tres que ya son `QUERY` son directas; la de la columna
`D` **no**, y es la parte que hay que diseñar con cuidado.

`A2` (N° OT, fecha, sector):

```
=QUERY({IMPORTRANGE(FORM; "Respuestas de formulario!A2:F10000");
        IMPORTRANGE(FORM; "Altas del sistema!A2:F10000")};
       "SELECT Col1, Col2, Col6 WHERE Col1 IS NOT NULL ORDER BY Col1"; 0)
```

`E2` (especialidad … fecha comprometida) y `S2` (prioridad), igual: apilar los
dos rangos y agregar `ORDER BY Col1`. **Ojo con `S2`**: hoy importa `AC2:AC` y
selecciona `Col1`, que es la prioridad. Para poder ordenar por N° de OT hay que
traer también la `A`, así que el rango pasa a ser `A2:AC10000` y la selección a
`SELECT Col29 … ORDER BY Col1`.

`D3` (equipo) es la trampa. Hoy es:

```
=LET(d; FLATTEN(IMPORTRANGE(FORM; "Respuestas de formulario!G2:U10000"));
     FILTER(d; d<>""))
```

Un `FLATTEN` **no tiene el N° de OT para ordenar**: aplanar quince columnas por
fila y quedarse con la no vacía funciona sólo mientras el orden físico mande.
Agregar `ORDER BY` a las otras tres y dejar ésta es desalinear la columna
EQUIPO, que es exactamente el error que se está arreglando. Propuesta:

```
=LET(
  d; {IMPORTRANGE(FORM; "Respuestas de formulario!A2:U10000");
      IMPORTRANGE(FORM; "Altas del sistema!A2:U10000")};
  k; CHOOSECOLS(d; 1);
  e; BYROW(CHOOSECOLS(d; SEQUENCE(1;15;7)); LAMBDA(f; TEXTJOIN(""; VERDADERO; f)));
  SORT(FILTER(e; k<>""); FILTER(k; k<>""); VERDADERO)
)
```

`TEXTJOIN` sobre `G:U` devuelve la única celda no vacía de esa fila —se
comprobó el 16/10/2026 que **ninguna de las 2.174 filas tiene más de una**,
incluidas las 99 que usan `DÓNDE SE SOLICITA`, que está en el medio del rango—.
Así cada fila queda con su equipo y su N° de OT al lado, y se puede ordenar
igual que las otras tres.

**Estas fórmulas no están probadas contra la planilla real** y no se pueden
probar sin escribir en ella: se prueban en un duplicado del master antes de
reemplazar nada.

### 3. El Apps Script numera contando las dos pestañas

`siguienteNumero_` hace `max(A)+1` sobre `Respuestas de formulario`. Con la
serie repartida, tiene que mirar las dos o **le va a repartir a una respuesta
del formulario un número que el sistema ya usó** — que es el incidente del
14/10 otra vez. Es lo mismo que hizo Compras en
`docs/compras-formulario-apps-script.gs`.

### 4. El alta, en el código

- `HOJA_DE_RESPUESTAS` deja de ser dónde se escribe y pasa a ser sólo una de las
  dos fuentes del máximo. `loQueSigueEnLaSerie` cuenta **las dos pestañas**, por
  la misma razón que el Apps Script.
- Se escribe en `Altas del sistema`, en su primera fila libre.
- **Idempotencia**: si ya hay una fila con ese N° de OT no se escribe otra, y si
  esa fila no es nuestra no se adopta.
- **Se relee el número después de escribir.** Si la fila no quedó con el que se
  asignó, no se corrige por las nuestras: se informa.

### 5. `sheets_row` deja de ser una cuenta y pasa a ser una búsqueda

Con el `ORDER BY`, la fila del master de una OT **cambia cuando entra otra OT
con número menor** — raro, pero posible si alguien carga una respuesta vieja— y
sobre todo deja de poder calcularse. Compras lo dice con todas las letras: *«una
cuenta que deja de valer no avisa: sigue devolviendo un número plausible»*.

`escribirEnLaFilaDeLaOT` ya relee la columna `A` y se niega si no coincide, así
que **hoy falla seguro**, no corrompe. Lo que cambia es que ante esa negativa
hay que **buscar la fila por la columna A** en vez de pedir que alguien
sincronice. Buscar hace que la búsqueda sea la verificación: si la OT no está,
no se escribe.

## Lo que queda afuera

- **Congelar la columna A** de `Respuestas de formulario` sigue pendiente y
  sigue siendo precondición del alta. Es un trabajo aparte.
- **Reordenar las filas ya escritas** del sistema (2796 y 2797) no hace falta:
  con el `ORDER BY` el orden físico deja de importar. Sus filas se quedan donde
  están, en `Respuestas de formulario`, y el apilado las toma igual.

## El riesgo mientras tanto

Hasta que esto esté, **cada OT creada desde la app puede correrse y dejar su
registro pegado a otra orden**. Hoy 2796 y 2797 están alineadas; una respuesta
del formulario puede volver a moverlas. Las opciones son dos: no crear OT desde
la app hasta que esto esté, o aceptar que haya que revisar esas filas a mano
después de cada tanda de respuestas.

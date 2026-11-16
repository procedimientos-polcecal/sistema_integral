# El pasante y la curva que se pega en un informe — Plan de implementación

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementarlo tarea por tarea. Los pasos llevan casilla (`- [ ]`) para ir tildando.

**Objetivo:** Agregar a `/calidad/ensayos/curva` un tercer gráfico con el pasante, y un botón que baja un `.xlsx` con la tabla de esa muestra y una imagen de los tres gráficos, para pegar en un informe.

**Arquitectura:** El pasante es `100 − acumulado` y se calcula en `curva.ts`, donde ya se calculan los otros dos. Las filas de la hoja las arma una función pura nueva. El `.xlsx` lo sigue escribiendo `exceljs` del lado del servidor, con una extensión chica para aceptar imágenes; el PNG lo rasteriza el navegador con `html2canvas` —recharts no dibuja sin DOM, medido— y lo sube a una ruta nueva. Sin migración.

**Stack:** Next.js 16 (App Router), recharts 3.10, html2canvas 1.4.1, exceljs 4.4, vitest.

**Spec:** [docs/superpowers/specs/2026-11-11-calidad-curva-pasante-y-excel-design.md](../specs/2026-11-11-calidad-curva-pasante-y-excel-design.md)

Se apoya en el diseño anterior de esta pantalla: [2026-11-05](../specs/2026-11-05-calidad-curva-granulometrica-design.md).

## Restricciones globales

- Todo en **castellano**: nombres, comentarios, textos de pantalla y mensajes de commit.
- **No hay migración.** Nada de esto guarda nada. Si aparece una necesidad de tabla o columna, el plan está mal: parar y decirlo.
- **El valor no se transforma.** El pasante puede dar negativo si el acumulado pasa de 100, y **se muestra como da**: es la muestra cuyos retenidos superan su propio peso, y recortarla a cero escondería justo lo que hay que corregir.
- **Ni la pantalla ni la hoja avisan de una malla que el producto declara y la muestra no midió.** Se preguntó el 11/11 y la respuesta fue dejarlo como está. Pasa en 19 de 79 muestras y va al revés de `acumuladosDelListado()`, así que es tentador "arreglarlo" de buena fe: no se agrega. El producto ni siquiera manda sus mallas declaradas al cliente, y sigue así.
- **Las diez descargas que ya existen no se tocan.** `xlsxResponse` y `xlsxSheetsResponse` siguen funcionando igual; lo que se agregue es opcional.
- **Un desplegable se escribe `<Select>`**, y nada de `w-*`, `text-*` ni `border-*` al lado de `.input`, `.card` o `.btn-*`: esas clases están fuera de capa y le ganan a la utilidad sin avisar.
- **Nunca `git add -A`**: se agregan los archivos por nombre.
- Los tests van sobre **funciones puras en `lib/`**. Las rutas y las pantallas no se testean.

## Foco de revisión

Lo que el spec implica y ningún test de tarea ejercita solo. Cada línea tiene su test asignado:

1. **El pasante de una muestra cuyos retenidos superan el peso da negativo.** `granulometria()` no recorta a 100 a propósito, así que un acumulado de 108 da un pasante de −8. No se recorta ni se oculta. (Tarea 1, test.)
2. **El PNG puede salir con el fondo transparente, y en Excel eso se ve negro o cuadriculado.** Es la trampa que ya está escrita en `reporte/ReporteClient.tsx`: `html2canvas` no siempre levanta los fondos puestos con utilidades de Tailwind. El nodo que se rasteriza lleva su fondo en `style`. (Tarea 5, verificación a mano abriendo el archivo.)
3. **Todos los tamices apagados.** La curva queda sin puntos: el gráfico no dibuja nada y la tabla es todas las filas marcadas como fuera. (Tarea 2, test; Tarea 5, el botón.)
4. **Una muestra sin peso tamizado.** `curvaDeLaMuestra` devuelve `problema`, `puntos: []` y `mallas: []`, o sea que no hay nada que exportar. (Tarea 2, test; Tarea 5, el botón.)
5. **La ruta recibe un PNG que no es un PNG, o enorme.** Es un cuerpo que entra desde el navegador: se valida el tipo por contenido y se topea el tamaño. (Tarea 4, comprobación a mano.)

---

## Estructura de archivos

| Archivo | De qué se hace cargo |
|---|---|
| `lib/calidad/ensayos/curva.ts` | **Modificar.** `PuntoDeLaCurva` gana `pasante`. |
| `lib/calidad/ensayos/curva.test.ts` | **Modificar.** Sus casos. |
| `lib/calidad/ensayos/hojaDeLaCurva.ts` | **Nuevo.** Las filas del `.xlsx`: encabezado, columnas, una fila por malla con su estado, y las notas. |
| `lib/calidad/ensayos/hojaDeLaCurva.test.ts` | **Nuevo.** |
| `lib/core/excel.ts` | **Modificar.** Una hoja puede llevar imágenes. |
| `lib/core/excel.test.ts` | **Modificar.** |
| `lib/core/xlsxExport.ts` | **Modificar.** Una respuesta de descarga con imágenes. |
| `app/api/calidad/ensayos/curva/export/route.ts` | **Nuevo.** Recibe el id, los tamices apagados y los PNG; devuelve el archivo. |
| `app/(app)/calidad/ensayos/curva/GraficosDeLaCurva.tsx` | **Modificar.** El tercer gráfico. |
| `app/(app)/calidad/ensayos/curva/CurvaClient.tsx` | **Modificar.** El tercer panel, el escalonado y el botón de descarga. |

---

### Tarea 1: El pasante

**Archivos:**
- Modificar: `lib/calidad/ensayos/curva.ts`
- Test: `lib/calidad/ensayos/curva.test.ts`

**Interfaces:**
- Produce: `PuntoDeLaCurva` gana un campo.
  ```ts
  export interface PuntoDeLaCurva {
    malla: number;
    retenido: number;
    acumulado: number;
    /** 100 − acumulado. Puede ser negativo: ver el docstring. */
    pasante: number;
  }
  ```

- [ ] **Paso 1: Escribir los tests que fallan**

Sobre el fixture que ya está en ese archivo (`Calcio 0-2` del 27/10, peso 100 g):

- `"el pasante es el complemento del acumulado"` — los pasantes de las ocho mallas son `[100, 100, 99.8, 99.1, 93.1, 58.4, 44, 33.6]`, en ese orden.
- `"el pasante se redondea a dos decimales como los otros dos"` — ningún valor sale con cola de punto flotante. **El caso real del fixture es la malla 200**: `100 - 66.4` da `33.599999999999994`, no `33.6`. (Este renglón decía `100 − 41.6`, que en JS da `58.4` exacto y no demuestra nada; lo corrigió el implementador de la Tarea 1 y está medido con `node -e`.)
- `"una muestra cuyos retenidos superan el peso da pasante negativo"` — con `pesoMuestraG: 50` sobre el mismo fixture el acumulado pasa de 100 y el pasante del último punto es **negativo**; se afirma que lo es y que no está recortado a 0. (Ese caso además devuelve `problema`, que ya existe.)
- Que los casos que ya estaban sigan pasando: apagar una malla no cambia el pasante de las demás.

- [ ] **Paso 2: Correr los tests y ver que fallan**

Correr: `npx vitest run lib/calidad/ensayos/curva.test.ts`
Esperado: FAIL, `pasante` no existe en el objeto.

- [ ] **Paso 3: Implementar**

`pasante: Math.round((100 - acumulado) * 100) / 100`, calculado junto al retenido y el acumulado.

El docstring tiene que decir **por qué el negativo no se recorta**: es la muestra cuyos retenidos superan su propio peso, el mismo caso que `granulometria()` ya se niega a recortar porque verlo es la única forma de corregirlo.

- [ ] **Paso 4: Correr los tests y ver que pasan**

Correr: `npx vitest run lib/calidad/ensayos/curva.test.ts`
Esperado: PASS.

- [ ] **Paso 5: Commitear**

```bash
git add lib/calidad/ensayos/curva.ts lib/calidad/ensayos/curva.test.ts
git commit -m "feat(calidad): el pasante de la curva, que es el complemento del acumulado"
```

---

### Tarea 2: Las filas de la hoja

**Archivos:**
- Crear: `lib/calidad/ensayos/hojaDeLaCurva.ts`
- Test: `lib/calidad/ensayos/hojaDeLaCurva.test.ts`

**Interfaces:**
- Consume: `curvaDeLaMuestra()` y `PuntoDeLaCurva` de la Tarea 1.
- Produce:
  ```ts
  export interface EncabezadoDeLaHoja {
    producto: string;
    /** ISO, como viene de la base. */
    fecha: string;
    observaciones: string | null;
  }
  /** Las filas tal cual van al .xlsx, listas para `libroXlsx`. */
  export function filasDeLaHoja(
    ensayo: { pesoMuestraG: number | null; retenidos: { malla: number; retenido_g: number }[] },
    apagadas: number[],
    encabezado: EncabezadoDeLaHoja
  ): unknown[][]
  ```

- [ ] **Paso 1: Escribir los tests que fallan**

Con el mismo fixture de `Calcio 0-2`. Los casos:

- `"lleva todas las mallas que midio la muestra, tambien las apagadas"` — con `apagadas: [20]`, hay **ocho** filas de datos y una de ellas es la de la malla 20.
- `"la fila apagada se marca en su propia columna"` — la fila de la 20 dice que está fuera del gráfico, con una palabra, y las otras siete dicen que están dentro. El test afirma el texto exacto que se use, porque es lo que va a leer una persona.
- `"los numeros de la fila apagada son los que se midieron"` — apagar no cambia su retenido ni su acumulado: la malla 20 sigue en 6 de retenido, **6,9** de acumulado y 93,1 de pasante. (Este renglón decía 41,6, que es el acumulado de la **#50** — justamente el que contiene a ese 6,0, que es el riesgo entero de esta pantalla. Lo corrigió el implementador de la Tarea 2 contra el fixture.)
- `"la nota del acumulado viaja en la hoja"` — alguna fila contiene el aviso de que las mallas que siguen a una apagada ya incluyen lo que ésa retuvo. Se afirma que **sólo aparece cuando hay alguna apagada**: sin apagadas no tiene sentido.
- `"el problema de la muestra viaja en la hoja"` — con `pesoMuestraG: 50`, alguna fila lleva el texto que devuelve `granulometria()` («Lo retenido supera el peso de la muestra.»), sin reescribirlo.
- `"una muestra sin peso no tiene filas de datos"` — con `pesoMuestraG: null`, no hay ninguna fila de malla, y está el problema escrito.
- `"el encabezado lleva el producto, la fecha y el peso"` — la fecha va **legible** (`comoSeLee`), no ISO: la lee una persona en Excel.

- [ ] **Paso 2: Correr los tests y ver que fallan**

Correr: `npx vitest run lib/calidad/ensayos/hojaDeLaCurva.test.ts`
Esperado: FAIL, el módulo no existe.

- [ ] **Paso 3: Implementar**

Llama a `curvaDeLaMuestra(ensayo, [])` —sin apagar nada— para tener **todas** las mallas con sus números, y usa `apagadas` sólo para marcar. Las columnas son `Malla`, `Retenido (%)`, `Acumulado (%)`, `Pasante (%)` y una quinta que dice si entra al gráfico.

El docstring explica por qué la fila apagada va igual: sacarla deja un Excel sin rastro de que esa malla se midió, y dejarla sin marcar produce un informe con una fila que el dibujo no tiene.

- [ ] **Paso 4: Correr los tests y ver que pasan**

Correr: `npx vitest run lib/calidad/ensayos/hojaDeLaCurva.test.ts`
Esperado: PASS, 7 tests.

- [ ] **Paso 5: Commitear**

```bash
git add lib/calidad/ensayos/hojaDeLaCurva.ts lib/calidad/ensayos/hojaDeLaCurva.test.ts
git commit -m "feat(calidad): las filas del Excel de la curva, con la malla apagada marcada"
```

---

### Tarea 3: Un libro que acepta imágenes

**Archivos:**
- Modificar: `lib/core/excel.ts`, `lib/core/xlsxExport.ts`
- Test: `lib/core/excel.test.ts`

**Interfaces:**
- Produce:
  ```ts
  export interface ImagenDeLaHoja {
    png: Buffer;
    /** Celda de arranque, 0-based, y tamaño en píxeles. */
    fila: number;
    columna: number;
    ancho: number;
    alto: number;
  }
  // `HojaAEscribir` gana un campo opcional:
  //   imagenes?: ImagenDeLaHoja[]
  export async function xlsxConImagenesResponse(
    filename: string,
    hojas: HojaAEscribir[]
  ): Promise<Response>
  ```

- [ ] **Paso 1: Escribir el test que falla**

En `lib/core/excel.test.ts`, al lado de los que ya están:

- `"una hoja puede llevar una imagen"` — se arma un libro con una hoja con filas y un PNG mínimo, se lee el buffer de vuelta con `exceljs` y se afirma que el libro tiene una imagen (`workbook.model.media` tiene un elemento, de extensión `png`).
- `"una hoja sin imagenes se escribe igual que antes"` — el campo es opcional y las llamadas que ya existen no cambian de resultado.

- [ ] **Paso 2: Correr el test y ver que falla**

Correr: `npx vitest run lib/core/excel.test.ts`
Esperado: FAIL.

- [ ] **Paso 3: Implementar**

`libroXlsx` pasa a mirar `hoja.imagenes` y, por cada una, `workbook.addImage({ buffer, extension: "png" })` y `worksheet.addImage(id, {...})`. El campo es **opcional**: las diez rutas que ya llaman no se tocan.

`xlsxConImagenesResponse` es la hermana de `xlsxSheetsResponse` que ya existe: misma cabecera de descarga, mismo `cabeceraDeDescarga`.

- [ ] **Paso 4: Correr los tests y ver que pasan**

Correr: `npx vitest run lib/core/excel.test.ts`
Esperado: PASS, incluidos los que ya estaban.

- [ ] **Paso 5: Commitear**

```bash
git add lib/core/excel.ts lib/core/excel.test.ts lib/core/xlsxExport.ts
git commit -m "feat(core): una hoja de Excel puede llevar imagenes, sin tocar las diez descargas que ya hay"
```

---

### Tarea 4: La ruta de exportación

**Archivos:**
- Crear: `app/api/calidad/ensayos/curva/export/route.ts`

**Interfaces:**
- Consume: `filasDeLaHoja()` de la Tarea 2; `xlsxConImagenesResponse()` de la Tarea 3; `traerMuestra()` de `lib/calidad/ensayos/consultas.ts`; `nivelCalidadDe()` de `lib/calidad/auth.ts`; `usuarioActual()` de `lib/core/sesion.ts`.
- Produce: `POST /api/calidad/ensayos/curva/export`, cuerpo `multipart/form-data` con:
  - `muestra_id` (uuid)
  - `apagadas` (JSON, array de números)
  - `retenido`, `acumulado`, `pasante` (archivos PNG, opcionales de a uno)

- [ ] **Paso 1: Implementar la ruta**

Pide sesión y `nivelCalidadDe`, 401 y 403 como las pantallas del módulo.

**Los números no vienen del navegador.** La ruta lee la muestra y sus retenidos de la base con `traerMuestra(id)` y arma las filas con eso. Del cliente llegan sólo los tamices apagados —que son estado de pantalla— y las imágenes.

Validación de cada archivo, que es un cuerpo que entra: que empiece con la firma PNG (`89 50 4E 47`) y no sólo que el `type` diga `image/png`, y un tope de tamaño por archivo. Lo que no pase, se rechaza con un 400 que diga qué pasó, en castellano.

El nombre del archivo lleva producto y fecha, y pasa por `cabeceraDeDescarga`, que es lo que ya resuelve los acentos.

- [ ] **Paso 2: Comprobarla de verdad**

No alcanza con que compile. Escribir un script de un solo uso en `scripts/tmp-fix/` que arme un `FormData` con un PNG real chico y el id de una muestra de `Calcio 0-2`, llame a la ruta contra `npm run dev`, y guarde el `.xlsx` que vuelva.
Esperado: el archivo abre, tiene las ocho filas de malla y la imagen adentro.

Probar también los dos rechazos: un archivo que no es PNG, y uno que pasa el tope. **Borrar el script antes de commitear.**

- [ ] **Paso 3: Correr tsc y la suite**

```bash
npx tsc --noEmit
npm test
```

- [ ] **Paso 4: Commitear**

```bash
git add "app/api/calidad/ensayos/curva/export/route.ts"
git commit -m "feat(calidad): la ruta que arma el Excel de la curva con su imagen"
```

---

### Tarea 5: La pantalla

**Archivos:**
- Modificar: `app/(app)/calidad/ensayos/curva/GraficosDeLaCurva.tsx`
- Modificar: `app/(app)/calidad/ensayos/curva/CurvaClient.tsx`

**Interfaces:**
- Consume: `PuntoDeLaCurva` con `pasante` (Tarea 1); la ruta de la Tarea 4.
- Produce: `export function CurvaDePasante({ puntos }: { puntos: PuntoDeLaCurva[] })`, hermana de las dos que ya están.

- [ ] **Paso 1: El tercer gráfico**

`CurvaDePasante` en `GraficosDeLaCurva.tsx`, con la misma forma que las otras dos: `LineChart` dentro de `ResponsiveContainer`, eje X categórico por malla, mismos colores de ejes y grilla.

El eje Y del pasante **no se fija de 0 a 100**: por el mismo motivo que el del acumulado lleva piso y no techo, un pasante negativo tiene que verse.

- [ ] **Paso 2: El tercer panel y el escalonado**

En `CurvaClient.tsx`, el tercer gráfico al lado de los otros dos. La grilla pasa de `grid-cols-1 sm:grid-cols-2` a **`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`**: en un teléfono (343 px) van apilados, a partir de `sm` entran dos, y los tres sólo desde `lg`, donde cada uno queda cerca de 320 px. Tres en una fila a 343 px serían 114 px cada uno.

El pasante hereda la misma selección de tamices que los otros dos.

- [ ] **Paso 3: El botón que baja el archivo**

Rasteriza con **`html2canvas`**, que ya es dependencia del repo (1.4.1) y ya se usa en `reporte/ReporteClient.tsx` con `scale: 2`. Importarlo dinámico, como ahí.

**La trampa que ya está escrita en ese archivo vecino y que acá muerde igual:** `html2canvas` no siempre levanta los fondos puestos con utilidades de Tailwind. El nodo que se rasteriza tiene que llevar **su fondo en `style`**, no en una clase, porque un PNG con fondo transparente en Excel se ve negro o cuadriculado.

Arma el `FormData` con el id de la muestra, los tamices apagados y los tres PNG, y descarga lo que devuelve la ruta.

Mientras no hay nada que dibujar —muestra sin granulometría, sin peso, o con todos los tamices apagados— **el botón no se ofrece**: no hay imagen que mandar.

- [ ] **Paso 4: Verificar**

```bash
npx tsc --noEmit
npm run build
node scripts/revisar-responsive.mjs
```
Esperado: tsc limpio, build compila, responsive sin ROMPE nuevo (hay un `MIRAR 1` preexistente en `reporte/ReporteClient.tsx` que no es de esta tarea).

Y **a mano, que es lo único que prueba lo que importa**: bajar el archivo de una muestra real y **abrirlo**. Mirar que la imagen esté, que no tenga el fondo transparente, y que la tabla diga lo mismo que el gráfico.

- [ ] **Paso 5: Commitear**

```bash
git add "app/(app)/calidad/ensayos/curva/GraficosDeLaCurva.tsx" "app/(app)/calidad/ensayos/curva/CurvaClient.tsx"
git commit -m "feat(calidad): el pasante en pantalla y la descarga del Excel con su grafico"
```

---

### Tarea 6: Dejarlo escrito

**Archivos:**
- Modificar: `docs/CALIDAD-ENSAYOS.md`, `CLAUDE.md`

- [ ] **Paso 1: La sección de la curva en `docs/CALIDAD-ENSAYOS.md`**

Ampliar la que ya está con lo que no se deduce del código:

1. **el pasante es el espejo exacto del acumulado** y por eso va en su propio panel y no como una línea más; puede dar negativo y no se recorta;
2. **el Excel lleva una foto y no un gráfico vivo**, porque `exceljs` no tiene API de gráficos —`chart` no aparece en sus tipos— y porque el archivo va a un informe ya escrito. Si alguien edita la tabla, el dibujo no se entera;
3. **se abre con Excel de escritorio, y de eso depende todo**: Sheets puede descartar las imágenes flotantes al importar, así que el día que alguien lo abra ahí hay que comprobarlo antes;
4. **el servidor no puede saber si el PNG corresponde a la muestra**, y está asumido con su argumento;
5. **recharts no dibuja sin DOM**: medido, devuelve un wrapper vacío de 127 caracteres, y por eso el PNG se rasteriza en el navegador.

- [ ] **Paso 2: La fila de Calidad en `CLAUDE.md`**

Sumar a la entrada de la curva el enlace a este spec y a este plan, y una línea con los dos riesgos nuevos. **Una sola fila de la tabla**, sin tocar nada más del archivo.

- [ ] **Paso 3: Revisar el árbol commiteado**

Correr: `node scripts/revisar-arbol-commiteado.mjs HEAD`
Esperado: todos los imports resuelven.

- [ ] **Paso 4: Commitear**

```bash
git add docs/CALIDAD-ENSAYOS.md CLAUDE.md
git commit -m "docs(calidad): el pasante, la foto en el Excel y los dos riesgos que trae"
```

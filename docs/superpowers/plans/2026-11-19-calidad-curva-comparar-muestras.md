# Varias muestras en la misma curva — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/calidad/ensayos/curva` deje elegir hasta seis muestras y las superponga en los tres gráficos y en el Excel.

**Architecture:** Una función pura nueva, `compararMuestras()`, arma el eje X como la unión de las mallas medidas y devuelve una fila por malla con un campo por muestra, `null` donde esa muestra no midió. La pantalla y el Excel consumen eso; `curvaDeLaMuestra()` no cambia y sigue siendo el cálculo de una muestra sola.

**Tech Stack:** Next.js 16 App Router, React, recharts 3.10, exceljs 4.4, vitest.

**Spec:** [docs/superpowers/specs/2026-11-19-calidad-curva-comparar-muestras-design.md](../specs/2026-11-19-calidad-curva-comparar-muestras-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, textos de pantalla y mensajes de commit.
- **Sin migración.** Nada de esto guarda nada en la base.
- Tope de muestras: **6**. Una sola constante exportada, `TOPE_DE_MUESTRAS`, que usan la pantalla, la página y la ruta.
- Un desplegable es `<Select>` de `components/Select.tsx`, nunca un `<select>` nativo.
- Nada de `w-*`, `text-*` ni `border-*` pegado a `.input`, `.card` o `.btn-*`: esas clases están fuera de capa y le ganan a la utilidad sin avisar. El ancho va en un `div` que envuelva.
- Las grillas llevan breakpoint: `grid-cols-1 sm:grid-cols-N`. El ancho útil del teléfono es 343 px.
- Los tests van sobre funciones puras en `lib/`. La pantalla y la ruta no se testean.
- Al apagar un tamiz **no se recalcula ningún acumulado**: sólo se saca el punto.
- La ruta del Excel lee los números **de la base**; del cliente llegan sólo ids, tamices apagados e imágenes.
- `git add` por ruta explícita, nunca `git add -A`.

## Review Focus

Cada línea tiene su test asignado a la tarea que es dueña del código.

1. **Una sola muestra tiene que seguir viéndose como hoy** — es el 99 % del uso y el cambio la toca entera. *(Task 1, `compararMuestras` con una muestra; Task 2, la hoja con una muestra.)*
2. **Un enlace viejo `?muestra=<id>`** sigue abriendo esa muestra. *(Task 4, `leerMuestrasPedidas`.)*
3. **La URL con ids repetidos** no dibuja la misma curva dos veces. *(Task 4, `leerMuestrasPedidas`.)*
4. **La URL con más de seis ids** no revienta ni trae siete. *(Task 4, `leerMuestrasPedidas`.)*
5. **Una muestra sin granulometría junto a otras que sí** no borra el gráfico de las demás. *(Task 1, `compararMuestras`.)*

---

### Task 1: La comparación, que es donde está toda la decisión

**Files:**
- Create: `lib/calidad/ensayos/comparacion.ts`
- Test: `lib/calidad/ensayos/comparacion.test.ts`

**Interfaces:**
- Consumes: `curvaDeLaMuestra(ensayo, apagadas)` de `./curva`, que devuelve `{ mallas, puntos, problema? }`.
- Produces:
  ```ts
  export const TOPE_DE_MUESTRAS = 6;
  export const COLORES_DE_LA_COMPARACION: string[]; // 6 colores

  export interface MuestraParaComparar {
    id: string;
    producto: string;
    fecha: string;           // ISO, como viene de la base
    observaciones: string | null;
    pesoMuestraG: number | null;
    retenidos: { malla: number; retenido_g: number }[];
  }

  export interface SerieDeLaComparacion {
    id: string;
    etiqueta: string;
    color: string;
    /** `r0`,`a0`,`p0` para la serie 0: las claves de sus tres campos en `filas`. */
    claves: { retenido: string; acumulado: string; pasante: string };
    problema?: string;
  }

  /** Una malla del eje. Además de `malla`, lleva `r0`,`a0`,`p0`,`r1`,… en `number | null`. */
  export type FilaDeLaComparacion = Record<string, number | null>;

  export interface Comparacion {
    /** Unión de las mallas medidas por alguna, ascendente. Son los chips. */
    mallas: number[];
    /** Unión menos las apagadas: lo que se dibuja. */
    filas: FilaDeLaComparacion[];
    series: SerieDeLaComparacion[];
    /** Quién no midió qué, sobre el eje dibujado. Vacío si todas midieron lo mismo. */
    disparejas: { etiqueta: string; faltan: number[] }[];
  }

  export function etiquetasDeMuestras(
    muestras: { producto: string; fecha: string; observaciones: string | null }[],
    conProducto: boolean
  ): string[];

  export function compararMuestras(
    muestras: MuestraParaComparar[],
    apagadas: number[]
  ): Comparacion;
  ```
- `etiquetasDeMuestras` es el `etiquetasDe` que hoy vive dentro de `CurvaClient.tsx`, mudado acá y con el producto adelante cuando `conProducto`. Conserva su desempate: los empates se numeran «(1 de 2)», «(2 de 2)», en el orden en que llegan. La observación se corta en 40 caracteres con «…».
- `compararMuestras` decide `conProducto` sola: `true` si las muestras no son todas del mismo producto.

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/calidad/ensayos/comparacion.test.ts`. Los fixtures:

```ts
/** Calcio 0-2 del 27/10/2026, el mismo de `curva.test.ts`. Peso 100: los gramos son los %. */
const CALCIO = {
  id: "a", producto: "Calcio 0-2", fecha: "2026-10-27", observaciones: null,
  pesoMuestraG: 100,
  retenidos: [
    { malla: 6, retenido_g: 0 }, { malla: 7, retenido_g: 0 },
    { malla: 10, retenido_g: 0.2 }, { malla: 12, retenido_g: 0.7 },
    { malla: 20, retenido_g: 6.0 }, { malla: 50, retenido_g: 34.7 },
    { malla: 100, retenido_g: 14.4 }, { malla: 200, retenido_g: 10.4 },
  ],
};

/** Otro juego de mallas, que es el caso que obliga a todo esto: sin #20 y con #325. */
const FINO = {
  id: "b", producto: "Filler 1", fecha: "2026-11-03", observaciones: null,
  pesoMuestraG: 100,
  retenidos: [
    { malla: 50, retenido_g: 30 }, { malla: 100, retenido_g: 20 },
    { malla: 200, retenido_g: 10 }, { malla: 325, retenido_g: 5 },
  ],
};
```

Los tests:

```ts
it("con una sola muestra el eje son sus mallas y hay una serie", () => {
  const c = compararMuestras([CALCIO], []);
  expect(c.mallas).toEqual([6, 7, 10, 12, 20, 50, 100, 200]);
  expect(c.series).toHaveLength(1);
  expect(c.filas).toHaveLength(8);
  expect(c.filas[7]).toEqual({ malla: 200, r0: 10.4, a0: 66.4, p0: 33.6 });
  expect(c.disparejas).toEqual([]);
});

it("el eje de dos muestras es la union de sus mallas", () => {
  const c = compararMuestras([CALCIO, FINO], []);
  expect(c.mallas).toEqual([6, 7, 10, 12, 20, 50, 100, 200, 325]);
});

it("la malla que una muestra no midio queda en null y no en cero", () => {
  const c = compararMuestras([CALCIO, FINO], []);
  const enVeinte = c.filas.find((f) => f.malla === 20)!;
  const en325 = c.filas.find((f) => f.malla === 325)!;
  expect(enVeinte.r0).toBe(6);
  expect(enVeinte.r1).toBeNull();
  expect(en325.r0).toBeNull();
  expect(en325.r1).toBe(5);
});

it("dice quien no midio que", () => {
  const c = compararMuestras([CALCIO, FINO], []);
  expect(c.disparejas).toEqual([
    { etiqueta: "Calcio 0-2 · 27/10/2026", faltan: [325] },
    { etiqueta: "Filler 1 · 03/11/2026", faltan: [6, 7, 10, 12, 20] },
  ]);
});

it("una malla apagada sale del eje dibujado, de los chips no, y no cuenta como despareja", () => {
  const c = compararMuestras([CALCIO, FINO], [325]);
  expect(c.mallas).toContain(325);
  expect(c.filas.some((f) => f.malla === 325)).toBe(false);
  expect(c.disparejas.find((d) => d.etiqueta.startsWith("Calcio"))).toBeUndefined();
});

it("apagar un tamiz no recalcula el acumulado de los que siguen", () => {
  const c = compararMuestras([CALCIO], [20]);
  const en50 = c.filas.find((f) => f.malla === 50)!;
  expect(en50.a0).toBe(41.6); // con #20 adentro; recalcular daria 35,6
});

it("una muestra sin granulometria no borra las demas", () => {
  const vacia = { ...FINO, id: "c", retenidos: [] };
  const c = compararMuestras([CALCIO, vacia], []);
  expect(c.mallas).toEqual([6, 7, 10, 12, 20, 50, 100, 200]);
  expect(c.series).toHaveLength(2);
  expect(c.filas[0].r1).toBeNull();
});

it("sin producto repetido la etiqueta no lo lleva", () => {
  const otra = { ...CALCIO, id: "d", fecha: "2026-10-28" };
  const c = compararMuestras([CALCIO, otra], []);
  expect(c.series.map((s) => s.etiqueta)).toEqual(["27/10/2026", "28/10/2026"]);
});

it("cada serie se lleva un color distinto", () => {
  const c = compararMuestras([CALCIO, FINO], []);
  expect(c.series[0].color).not.toBe(c.series[1].color);
});
```

Y para `etiquetasDeMuestras`:

```ts
it("numera los empates y corta la observacion larga", () => {
  const base = { producto: "Cal", fecha: "2026-10-07", observaciones: null };
  expect(etiquetasDeMuestras([base, base], false)).toEqual([
    "07/10/2026 (1 de 2)", "07/10/2026 (2 de 2)",
  ]);
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/calidad/ensayos/comparacion.test.ts`
Expected: FAIL — no existe el módulo `./comparacion`.

- [ ] **Step 3: Escribir `lib/calidad/ensayos/comparacion.ts`**

Con las firmas del bloque Interfaces. El armado:

- `conProducto` = hay más de un `producto` distinto entre las muestras.
- `mallas` = unión de `curvaDeLaMuestra(m, []).mallas`, ordenada ascendente.
- El eje dibujado = `mallas` sin las `apagadas`.
- Para cada muestra, un índice de `malla → punto` sacado de `curvaDeLaMuestra(m, apagadas).puntos`; la fila de cada malla del eje toma de ahí, y pone `null` donde no hay.
- `disparejas` compara el eje dibujado contra las mallas medidas por cada muestra; sólo entran las que a las que les falta alguna.
- `problema` de cada serie es el de su `curvaDeLaMuestra`.

El docstring del archivo tiene que decir **por qué el hueco es `null` y no cero ni interpolación**, con el ejemplo del `#325`: poner cero afirma que no quedó nada retenido ahí, que es una medición falsa.

`COLORES_DE_LA_COMPARACION`: seis colores que se distingan también impresos en gris. Arrancar con el `#1E7D34` que ya usa la pantalla para que una muestra sola se vea igual que hoy.

- [ ] **Step 4: Correrlos y ver que pasan**

Run: `npx vitest run lib/calidad/ensayos/comparacion.test.ts`
Expected: PASS, todos.

- [ ] **Step 5: Commit**

```bash
git add lib/calidad/ensayos/comparacion.ts lib/calidad/ensayos/comparacion.test.ts
git commit -m "feat(calidad): la comparacion de varias muestras, con el eje unido y los huecos en null"
```

---

### Task 2: La hoja del Excel, en formato largo

**Files:**
- Modify: `lib/calidad/ensayos/hojaDeLaCurva.ts`
- Modify: `lib/calidad/ensayos/hojaDeLaCurva.test.ts`

**Interfaces:**
- Consumes: `MuestraParaComparar` y `etiquetasDeMuestras` de Task 1; `curvaDeLaMuestra` de `./curva`.
- Produces:
  ```ts
  export function filasDeLaHoja(
    muestras: MuestraParaComparar[],
    apagadas: number[]
  ): unknown[][];
  ```
  `leerApagadas` no cambia. `EncabezadoDeLaHoja` desaparece: los datos del encabezado ya vienen en `MuestraParaComparar`.

La hoja queda:

```
Muestra | Producto | Fecha | Peso tamizado (g) | Observaciones     ← encabezado, una fila por muestra
(vacía)
Muestra | Malla | Retenido (%) | Acumulado (%) | Pasante (%) | En el gráfico
… una fila por (muestra, malla medida), agrupadas por muestra y dentro por malla ascendente
(vacía)
Nota del acumulado — sólo si alguna apagada la midió alguna muestra
(vacía)
Los problemas, uno por línea, con la etiqueta adelante cuando hay más de una muestra
```

**Toda malla medida va, también la apagada**, que es lo que ya decidía esta función: se marca `Fuera` en la última columna. Una malla que **esa** muestra no midió no genera fila.

- [ ] **Step 1: Reescribir los tests**

Reusar los fixtures `CALCIO` y `FINO` de Task 1 (importarlos no; copiarlos, como ya hace `hojaDeLaCurva.test.ts` con el de `curva.test.ts`). Los tests que importan:

```ts
it("con una muestra lleva una fila por malla medida", () => {
  const filas = filasDeLaHoja([CALCIO], []);
  const deDatos = filas.filter((f) => typeof f[1] === "number");
  expect(deDatos).toHaveLength(8);
  expect(deDatos[7]).toEqual(["27/10/2026", 200, 10.4, 66.4, 33.6, "Dentro"]);
});

it("con dos muestras no hay fila para la malla que una no midio", () => {
  const filas = filasDeLaHoja([CALCIO, FINO], []);
  const deDatos = filas.filter((f) => typeof f[1] === "number");
  expect(deDatos).toHaveLength(12); // 8 + 4, nunca 9 + 9
  expect(deDatos.filter((f) => f[1] === 325)).toHaveLength(1);
});

it("la malla apagada va igual y se marca", () => {
  const filas = filasDeLaHoja([CALCIO], [20]);
  const deVeinte = filas.find((f) => f[1] === 20)!;
  expect(deVeinte[5]).toBe("Fuera");
  expect(deVeinte[3]).toBe(6.9); // el acumulado medido, sin recalcular
});

it("el encabezado lleva una fila por muestra", () => {
  const filas = filasDeLaHoja([CALCIO, FINO], []);
  expect(filas.some((f) => f[1] === "Calcio 0-2")).toBe(true);
  expect(filas.some((f) => f[1] === "Filler 1")).toBe(true);
});

it("con varias muestras el problema dice de cual habla", () => {
  const pesada = { ...CALCIO, id: "e", pesoMuestraG: 50 }; // retenidos > peso
  const texto = filasDeLaHoja([pesada, FINO], []).map((f) => f.join(" ")).join("\n");
  expect(texto).toContain("Calcio 0-2 · 27/10/2026");
});
```

Mantener el test que ya existe de la nota del acumulado y su concordancia singular/plural.

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/calidad/ensayos/hojaDeLaCurva.test.ts`
Expected: FAIL — la firma vieja recibe un objeto y ahora llega un array.

- [ ] **Step 3: Reescribir `filasDeLaHoja`**

Las etiquetas salen de `etiquetasDeMuestras(muestras, hayMasDeUnProducto)`. El resto como el bloque de arriba. Actualizar el docstring del archivo: decir **por qué largo y no ancho** —una celda vacía en una planilla se lee como cero, y una malla que esa muestra no midió no es un cero— y que por eso no hay fila en vez de haber celda vacía.

- [ ] **Step 4: Correrlos y ver que pasan**

Run: `npx vitest run lib/calidad/ensayos/hojaDeLaCurva.test.ts`
Expected: PASS, todos.

- [ ] **Step 5: Commit**

```bash
git add lib/calidad/ensayos/hojaDeLaCurva.ts lib/calidad/ensayos/hojaDeLaCurva.test.ts
git commit -m "feat(calidad): la hoja de la curva en formato largo, una fila por muestra y malla"
```

---

### Task 3: Los tres gráficos con varias curvas

**Files:**
- Modify: `app/(app)/calidad/ensayos/curva/GraficosDeLaCurva.tsx`

**Interfaces:**
- Consumes: `FilaDeLaComparacion` y `SerieDeLaComparacion` de Task 1.
- Produces:
  ```tsx
  export function CurvaDeRetenido(props: { filas: FilaDeLaComparacion[]; series: SerieDeLaComparacion[] }): JSX.Element;
  export function CurvaDeAcumulado(props: { filas: FilaDeLaComparacion[]; series: SerieDeLaComparacion[] }): JSX.Element;
  export function CurvaDePasante(props: { filas: FilaDeLaComparacion[]; series: SerieDeLaComparacion[] }): JSX.Element;
  ```

- [ ] **Step 1: Reescribir el componente `Curva` interno**

Una `<Line>` por serie, con `dataKey={serie.claves[campo]}`, `name={serie.etiqueta}`, `stroke={serie.color}` y **`connectNulls={false}`**, que es lo que deja el hueco. `isAnimationActive={false}` se queda: el botón del Excel rasteriza el gráfico.

Agregar `<Legend />` **sólo cuando hay más de una serie** —con una, la leyenda repite el título del panel y le come alto al dibujo—, con `wrapperStyle={{ fontSize: 11 }}`.

El eje Y, el eje X, la grilla, el `tope` y el `piso` no cambian. El `tope`/`piso` ahora se calculan sobre todas las series, que es lo que ya hace recharts con el `domain` por función.

Actualizar el docstring: el eje X sigue siendo categórico y ahora es la unión; una línea que no llega a un extremo es una muestra que no midió esa malla, y eso es a propósito.

- [ ] **Step 2: Comprobar que compila y que el tipo cierra**

Run: `npx tsc --noEmit`
Expected: los únicos errores son en `CurvaClient.tsx`, que todavía le pasa `puntos`. (Se arreglan en Task 4.)

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/calidad/ensayos/curva/GraficosDeLaCurva.tsx"
git commit -m "feat(calidad): los tres graficos dibujan varias curvas con su leyenda"
```

---

### Task 4: La pantalla — elegir varias, y la URL

**Files:**
- Modify: `app/(app)/calidad/ensayos/curva/page.tsx`
- Modify: `app/(app)/calidad/ensayos/curva/CurvaClient.tsx`
- Create: `lib/calidad/ensayos/muestrasPedidas.ts`
- Test: `lib/calidad/ensayos/muestrasPedidas.test.ts`

**Interfaces:**
- Consumes: `TOPE_DE_MUESTRAS`, `compararMuestras`, `etiquetasDeMuestras`, `COLORES_DE_LA_COMPARACION` de Task 1; los tres gráficos de Task 3.
- Produces:
  ```ts
  /** Los ids que pide la URL: `?muestras=a,b` y el viejo `?muestra=a`, sin repetidos y topeados. */
  export function leerMuestrasPedidas(crudo: {
    muestra?: string | string[];
    muestras?: string | string[];
  }): string[];
  ```

- [ ] **Step 1: Escribir los tests de `leerMuestrasPedidas`**

```ts
it("lee la lista nueva", () => {
  expect(leerMuestrasPedidas({ muestras: "a,b,c" })).toEqual(["a", "b", "c"]);
});

it("sigue aceptando el enlace viejo de una muestra", () => {
  expect(leerMuestrasPedidas({ muestra: "a" })).toEqual(["a"]);
});

it("junta las dos formas sin repetir", () => {
  expect(leerMuestrasPedidas({ muestra: "a", muestras: "b,a" })).toEqual(["a", "b"]);
});

it("no se pasa del tope", () => {
  expect(leerMuestrasPedidas({ muestras: "a,b,c,d,e,f,g,h" })).toHaveLength(TOPE_DE_MUESTRAS);
});

it("descarta los vacios y los espacios", () => {
  expect(leerMuestrasPedidas({ muestras: " a , ,b " })).toEqual(["a", "b"]);
});

it("un parametro repetido toma el primero", () => {
  expect(leerMuestrasPedidas({ muestras: ["a", "b"] })).toEqual(["a"]);
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/calidad/ensayos/muestrasPedidas.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Escribir `lib/calidad/ensayos/muestrasPedidas.ts`**

El orden: primero lo que trae `muestra`, después `muestras`, sin repetidos, cortado en `TOPE_DE_MUESTRAS`.

- [ ] **Step 4: Correrlos y ver que pasan**

Run: `npx vitest run lib/calidad/ensayos/muestrasPedidas.test.ts`
Expected: PASS.

- [ ] **Step 5: Reescribir `page.tsx`**

Pide los ids con `leerMuestrasPedidas`, trae cada muestra con `traerMuestra` en un `Promise.all` (son seis como mucho: no hace falta un `.in()`, que además rompe la URL de PostgREST con muchos ids), descarta las que no existen y arma un `MuestraParaComparar[]` con el nombre del producto sacado de `traerProductos`.

El `producto` del selector sale, como hoy, de `?producto=`; si no viene y hay muestras elegidas, el de la primera, para que un enlace compartido abra la lista en un producto que tiene sentido.

- [ ] **Step 6: Reescribir `CurvaClient.tsx`**

- Sacar `etiquetasDe`: ahora viene de `comparacion.ts`.
- Un `<Select>` «Agregar muestra» que lista **las del producto elegido que todavía no están**, y al elegir una la suma a la URL. Con el tope lleno, en vez del `<Select>` va una línea que dice que son seis como máximo.
- Las muestras elegidas se muestran como chips con su color y una cruz para sacarlas. **Los chips sobreviven al cambio de producto**: así se cruzan productos sin otra pantalla.
- `LaCurva` pasa a recibir `muestras: MuestraParaComparar[]`, llama a `compararMuestras` y le pasa `filas`/`series` a los tres gráficos. Su `key` pasa a ser los ids unidos, para que los tamices apagados se reinicien al cambiar el conjunto.
- Los chips de tamices usan `comparacion.mallas` (la unión).
- Debajo de los gráficos, cuando `comparacion.disparejas` no está vacío, una línea que lo diga, por ejemplo: «No todas midieron los mismos tamices: Calcio 0-2 · 27/10/2026 no midió #325.» Con varias, una oración por muestra.
- Los avisos de «elegí un producto» y «no tiene muestras» se quedan; el de «elegí una muestra» pasa a nombrar que se pueden elegir varias.

- [ ] **Step 7: Comprobar**

Run: `npx tsc --noEmit` → Expected: limpio.
Run: `node scripts/revisar-responsive.mjs` → Expected: ROMPE 0 (el MIRAR 1 de `reporte/ReporteClient.tsx` es preexistente).

- [ ] **Step 8: Commit**

```bash
git add lib/calidad/ensayos/muestrasPedidas.ts lib/calidad/ensayos/muestrasPedidas.test.ts "app/(app)/calidad/ensayos/curva/page.tsx" "app/(app)/calidad/ensayos/curva/CurvaClient.tsx"
git commit -m "feat(calidad): elegir hasta seis muestras y compararlas en la misma curva"
```

---

### Task 5: La ruta del Excel y la documentación

**Files:**
- Modify: `app/api/calidad/ensayos/curva/export/route.ts`
- Modify: `docs/CALIDAD-ENSAYOS.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `filasDeLaHoja(muestras, apagadas)` de Task 2; `TOPE_DE_MUESTRAS` de Task 1.

- [ ] **Step 1: Cambiar el cuerpo que acepta la ruta**

`muestras`: un JSON con un array de ids. **`muestra_id` se sigue aceptando** como una sola muestra, para que una pantalla abierta durante el despliegue no quede rota. Cada id, un UUID; más de `TOPE_DE_MUESTRAS` es un 400 que lo dice.

Trae cada muestra con `traerMuestra` y su producto, arma `MuestraParaComparar[]` en el orden en que llegaron los ids, y llama a `filasDeLaHoja`.

Los `anchos` pasan a `[30, 10, 14, 14, 14, 13, 3]` —la etiqueta de la muestra es la columna A y es la ancha— y `COLUMNA_DE_LAS_IMAGENES` pasa de 6 a **7**: la tabla ahora llega hasta la F y la G queda de separador.

El nombre del archivo: con una muestra, el de hoy; con varias, `Curva granulométrica - N muestras - <fecha de hoy>.xlsx`.

- [ ] **Step 2: Comprobar**

Run: `npx tsc --noEmit` → Expected: limpio.
Run: `node scripts/revisar-exportaciones.mjs` → Expected: ROMPE 0 · MIRAR 0.

- [ ] **Step 3: Escribir la documentación**

En `docs/CALIDAD-ENSAYOS.md`, una sección `### Comparar varias muestras` con: el tope de seis y por qué; el eje unido y **por qué el hueco no se rellena**; que se pueden cruzar productos; y que el Excel pasó a formato largo y el motivo (la celda vacía que se lee como cero).

En `CLAUDE.md`, en la fila de Calidad, un renglón que enlace el spec y el plan y diga las dos cosas que no se deducen del código: **el hueco es `null` a propósito** y **el Excel es largo porque ancho mentiría con las celdas vacías**.

- [ ] **Step 4: Commit**

```bash
git add "app/api/calidad/ensayos/curva/export/route.ts" docs/CALIDAD-ENSAYOS.md CLAUDE.md docs/superpowers/specs/2026-11-19-calidad-curva-comparar-muestras-design.md docs/superpowers/plans/2026-11-19-calidad-curva-comparar-muestras.md
git commit -m "feat(calidad): el Excel de la curva con varias muestras, y la documentacion"
```

- [ ] **Step 5: La verificación de toda la rama**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
```
Expected: tests en verde, `tsc` limpio, el build con `/calidad/ensayos/curva` y `/api/calidad/ensayos/curva/export`, y los imports del árbol commiteado resueltos.

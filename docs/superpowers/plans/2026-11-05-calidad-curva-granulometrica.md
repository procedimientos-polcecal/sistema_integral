# La curva granulométrica por muestra — Plan de implementación

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementarlo tarea por tarea. Los pasos llevan casilla (`- [ ]`) para ir tildando.

**Objetivo:** Una pantalla en Calidad / Ensayos donde se elige un producto y una de sus muestras y se ve su curva granulométrica —retenido y acumulado, uno al lado del otro—, con los tamices de esa muestra prendibles y apagables.

**Arquitectura:** Todo el cálculo ya existe: `granulometria()` devuelve retenido % y acumulado % por malla. Lo nuevo es una función pura que filtra esas filas según los tamices apagados, una consulta que trae las muestras de un producto, y una pantalla que dibuja dos `LineChart` de recharts con una sola selección de tamices compartida. Sin migración, sin tabla, sin columna.

**Stack:** Next.js 16 (App Router), recharts, vitest, Supabase vía PostgREST.

**Spec:** [docs/superpowers/specs/2026-11-05-calidad-curva-granulometrica-design.md](../specs/2026-11-05-calidad-curva-granulometrica-design.md)

## Restricciones globales

- Todo en **castellano**: nombres, comentarios, textos de pantalla y mensajes de commit.
- **No hay migración.** Si aparece una necesidad de tabla o columna, el plan está mal: parar y decirlo.
- **Un desplegable se escribe `<Select>`** (de `components/Select.tsx`), nunca `<select>` nativo.
- **Una grilla de 3+ columnas lleva breakpoint**, y acá los dos gráficos juntos van `grid-cols-1 sm:grid-cols-2`: en 343 px dos gráficos al lado quedan en 171 px cada uno.
- **No poner `w-*` al lado de `.input`, `.card` ni `.btn-*`**: esas clases están fuera de capa y le ganan a la utilidad. El ancho va en un `div` que envuelva.
- Los gráficos de recharts se cargan con `dynamic(..., { ssr: false })` y un esqueleto, como en `app/(app)/calidad/ensayos/indicadores/IndicadoresClient.tsx`.
- **Nunca `git add -A`**: puede haber otra sesión en el mismo árbol. Se agregan los archivos por nombre. Y antes de commitear, `git branch --show-current`: este árbol no siempre está en `main`.
- El valor no se transforma. Apagar un tamiz **filtra filas**, nunca recalcula un acumulado.

## Foco de revisión

Lo que el spec implica y ningún test de tarea ejercita por su cuenta. Cada línea tiene su test asignado a la tarea que la posee:

1. **Una muestra con retenidos pero sin peso tamizado.** `Caliza P3` tiene dos así, y `granulometria()` ya devuelve «Falta el peso de la muestra tamizada». La pantalla muestra **ese** texto y no un gráfico vacío. (Tarea 1, test; Tarea 3, pantalla.)
2. **Todos los tamices apagados.** Queda una curva sin puntos; no es un error ni una pantalla rota. (Tarea 1, test.)
3. **Un producto sin ninguna muestra.** Son **12 de los 20**, así que es el caso normal y no el raro. (Tarea 2 y Tarea 3.)
4. **Una muestra cuyos retenidos gruesos son todos cero.** Es lo habitual en `Calcio 0-2` —#6, #7 y #10 en cero—: el tramo plano es dato, no un hueco. (Tarea 1, test.)
5. **El teléfono de 343 px.** Los dos gráficos tienen que quedar uno abajo del otro, y eso no lo atrapa `revisar-responsive.mjs`. (Tarea 3, verificación a mano.)

---

## Estructura de archivos

| Archivo | De qué se hace cargo |
|---|---|
| `lib/calidad/ensayos/curva.ts` | **Nuevo.** La función pura: de una muestra y un conjunto de tamices apagados, los puntos a dibujar. |
| `lib/calidad/ensayos/curva.test.ts` | **Nuevo.** Sus tests. |
| `lib/calidad/ensayos/consultas.ts` | **Modificar.** Agregar `traerMuestrasDeProducto()`. |
| `app/(app)/calidad/ensayos/curva/page.tsx` | **Nuevo.** Server component: permisos, datos, URL. |
| `app/(app)/calidad/ensayos/curva/CurvaClient.tsx` | **Nuevo.** La pantalla: selectores, chips de tamices, los dos gráficos. |
| `app/(app)/calidad/ensayos/curva/GraficosDeLaCurva.tsx` | **Nuevo.** Los dos `LineChart`, cargados sin SSR. |
| `lib/core/nav.ts` | **Modificar.** Una entrada en Ensayos. |

---

### Tarea 1: La función pura de la curva

**Archivos:**
- Crear: `lib/calidad/ensayos/curva.ts`
- Test: `lib/calidad/ensayos/curva.test.ts`

**Interfaces:**
- Consume: `granulometria()` de `lib/calidad/ensayos/granulometria.ts`, que recibe `{ pesoMuestraG: number | null; retenidos: { malla: number; retenido_g: number }[] }` y devuelve `{ filas: FilaDeGranulometria[]; problema?: string }`, con `FilaDeGranulometria = { malla: number; retenido: ValorEvaluado; acumulado: ValorEvaluado }`.
- Produce:
  ```ts
  export interface PuntoDeLaCurva { malla: number; retenido: number; acumulado: number }
  export interface Curva {
    /** Las mallas que midió la muestra, en orden. Son los chips de la pantalla. */
    mallas: number[];
    /** Sólo las prendidas, en orden. Es lo que se dibuja. */
    puntos: PuntoDeLaCurva[];
    problema?: string;
  }
  export function curvaDeLaMuestra(
    ensayo: { pesoMuestraG: number | null; retenidos: { malla: number; retenido_g: number }[] },
    apagadas: number[]
  ): Curva
  ```

- [ ] **Paso 1: Escribir los tests que fallan**

En `lib/calidad/ensayos/curva.test.ts`. Los números salen de la muestra real de `Calcio 0-2` del 27/10/2026; con el peso en 100 g los gramos **son** los porcentajes, así que el fixture reproduce la curva real sin inventar nada:

```ts
const MUESTRA = {
  pesoMuestraG: 100,
  retenidos: [
    { malla: 6, retenido_g: 0 }, { malla: 7, retenido_g: 0 },
    { malla: 10, retenido_g: 0.2 }, { malla: 12, retenido_g: 0.7 },
    { malla: 20, retenido_g: 6.0 }, { malla: 50, retenido_g: 34.7 },
    { malla: 100, retenido_g: 14.4 }, { malla: 200, retenido_g: 10.4 },
  ],
};
```

Los casos, con sus nombres:

- `"sin nada apagado dibuja todas las mallas medidas"` — `mallas` es `[6,7,10,12,20,50,100,200]` y `puntos` tiene 8, con el último en `{ malla: 200, retenido: 10.4, acumulado: 66.4 }`.
- `"apagar un tamiz le saca el punto y no toca ningun otro numero"` — con `apagadas: [20]`, `puntos` no tiene la malla 20, tiene 7 elementos, y **el acumulado de #50 sigue siendo 41.6** — no 35.6. Es la propiedad sobre la que se apoya todo el diseño, así que el test la afirma explícitamente.
- `"las mallas siguen estando aunque esten apagadas"` — con `apagadas: [20]`, `mallas` sigue siendo las 8: los chips no desaparecen al apagarse.
- `"apagar todos deja una curva sin puntos y sin problema"` — con las 8 apagadas, `puntos` es `[]` y `problema` es `undefined`.
- `"una muestra sin peso devuelve el problema que ya escribe granulometria"` — con `pesoMuestraG: null`, `problema` es `"Falta el peso de la muestra tamizada."` y `puntos` es `[]`.
- `"los retenidos en cero son dato y se dibujan"` — `puntos` incluye `{ malla: 6, retenido: 0, acumulado: 0 }`; no se filtran por ser cero.
- `"una malla apagada que la muestra no midio no cambia nada"` — con `apagadas: [325]`, el resultado es igual que sin apagar nada.

- [ ] **Paso 2: Correr los tests y ver que fallan**

Correr: `npx vitest run lib/calidad/ensayos/curva.test.ts`
Esperado: FAIL, `curvaDeLaMuestra` no existe.

- [ ] **Paso 3: Implementar `curvaDeLaMuestra` en `lib/calidad/ensayos/curva.ts`**

Llama a `granulometria(ensayo)`, toma `filas`, arma `mallas` con todas y `puntos` con las que no estén en `apagadas`, pasando `retenido.valor` y `acumulado.valor` a número. Propaga `problema` tal cual viene.

El docstring del archivo tiene que dejar escrito **por qué filtrar es correcto y recalcular no**: el acumulado de la malla siguiente ya incluye lo que retuvo la apagada, así que unir #12 con #50 dice «entre esas dos mallas el acumulado pasó de 0,9 a 41,6», que es lo que se habría medido sin tamizar en #20; recalcular daría 35,6, un número que nadie midió.

- [ ] **Paso 4: Correr los tests y ver que pasan**

Correr: `npx vitest run lib/calidad/ensayos/curva.test.ts`
Esperado: PASS, 7 tests.

- [ ] **Paso 5: Commitear**

```bash
git add lib/calidad/ensayos/curva.ts lib/calidad/ensayos/curva.test.ts
git commit -m "feat(calidad): la curva de una muestra, con los tamices que se apagan"
```

---

### Tarea 2: Las muestras de un producto

**Archivos:**
- Modificar: `lib/calidad/ensayos/consultas.ts`

**Interfaces:**
- Consume: `traerTodo()` de `lib/core/paginado.ts`; el tipo `Muestra` de `lib/calidad/ensayos/types.ts`.
- Produce:
  ```ts
  export async function traerMuestrasDeProducto(
    supabase: SupabaseClient,
    productoId: string
  ): Promise<Pick<Muestra, "id" | "fecha" | "observaciones">[]>
  ```

- [ ] **Paso 1: Implementar `traerMuestrasDeProducto` en `lib/calidad/ensayos/consultas.ts`**

Sin ventana de fechas, a diferencia de `traerMuestras()`, que es por días. El motivo va en el comentario: la pantalla acepta la muestra en la URL para poder mandarla por chat, y con ventana un enlace de octubre dibujaría bien mientras su muestra no aparece en la lista.

Va con `traerTodo()` —son 81 muestras hoy pero el Excel que esto reemplaza tenía 623 de tres años, y PostgREST corta en 1000 sin avisar— ordenada por `fecha` descendente, y con la cadena del `select()` **literal**, no armada en una variable.

- [ ] **Paso 2: Comprobar contra la base real**

Hay credenciales en `.env.local`. Escribir un script de un solo uso en `scripts/tmp-fix/` que llame a la función con el id de `Calcio 0-2` y imprima cuántas filas vuelven.
Esperado: **19 muestras**, la más nueva primero.

- [ ] **Paso 3: Correr tsc**

Correr: `npx tsc --noEmit`
Esperado: sin errores.

- [ ] **Paso 4: Commitear**

```bash
git add lib/calidad/ensayos/consultas.ts
git commit -m "feat(calidad): traer las muestras de un producto, sin ventana de dias"
```

---

### Tarea 3: La pantalla

**Archivos:**
- Crear: `app/(app)/calidad/ensayos/curva/page.tsx`
- Crear: `app/(app)/calidad/ensayos/curva/CurvaClient.tsx`
- Crear: `app/(app)/calidad/ensayos/curva/GraficosDeLaCurva.tsx`
- Modificar: `lib/core/nav.ts`

**Interfaces:**
- Consume: `curvaDeLaMuestra()` y los tipos `Curva` / `PuntoDeLaCurva` de la Tarea 1; `traerMuestrasDeProducto()` de la Tarea 2; `traerProductos()` y `traerMuestra()` de `consultas.ts`; `nivelCalidadDe()` de `lib/calidad/auth.ts`; `usuarioActual()` de `lib/core/sesion.ts`; `comoSeLee()` de `lib/core/fechas.ts`.

- [ ] **Paso 1: Los dos gráficos en `GraficosDeLaCurva.tsx`**

Dos componentes exportados, los dos `LineChart` de recharts dentro de un `ResponsiveContainer`, cada uno recibiendo `{ puntos: PuntoDeLaCurva[] }`:

```ts
export function CurvaDeRetenido({ puntos }: { puntos: PuntoDeLaCurva[] })
export function CurvaDeAcumulado({ puntos }: { puntos: PuntoDeLaCurva[] })
```

**Una sola curva por gráfico: la de los puntos prendidos.** La maqueta sobre la
que se decidió dibujaba además la curva original en punteado y **eso no va** —
está en el spec—. Nada de líneas fantasma, ni marcas en el hueco del tamiz
apagado.

El eje X es `malla`, **categórico y con los tamices igualmente espaciados** —no hay tabla de aberturas en milímetros en el sistema y el spec no pide una—, etiquetado `#50`. El eje Y es porcentaje. Copiar del archivo vecino `indicadores/GraficosEnsayos.tsx` los colores de ejes y grilla, para que las dos pantallas se vean de la misma familia.

- [ ] **Paso 2: La pantalla en `CurvaClient.tsx`**

Un `"use client"` con los dos `Select` —producto y muestra—, la fila de chips de tamices, y los dos gráficos en `grid-cols-1 sm:grid-cols-2`. Los gráficos entran con `dynamic(() => import("./GraficosDeLaCurva").then(m => m.CurvaDeRetenido), { ssr: false, loading: esqueleto })`.

El estado de los tamices apagados es un `useState<number[]>`, y **se resetea al cambiar de muestra**: arrastrarlo escondería un punto medido de una muestra que nadie miró.

Debajo del gráfico del acumulado va una línea fija de texto, no un tooltip, diciendo que las mallas que siguen a una apagada **ya incluyen** lo que ésa retuvo. Es la única defensa contra el riesgo que el spec nombra.

Cambiar de producto o de muestra navega por la URL (`router.push`), para que el enlace se pueda compartir. Los tamices apagados **no** van en la URL.

- [ ] **Paso 3: La página en `page.tsx`**

Server component. Pide sesión y `nivelCalidadDe`, redirige si no. Lee `?producto=` y `?muestra=` de `searchParams`. Trae los productos; si hay producto, sus muestras; si hay muestra, `traerMuestra()` por id —que funciona esté o no en la lista—.

Los tres estados vacíos, que son casos normales y no raros: **sin producto elegido**, **producto sin muestras** (12 de los 20 productos están así) y **muestra sin granulometría**. Y cuando `curvaDeLaMuestra` devuelve `problema`, se muestra **ese** texto y no uno propio.

- [ ] **Paso 4: La entrada en el nav**

En `lib/core/nav.ts`, dentro de Ensayos, después de «Indicadores`»:
`{ label: "Curva granulométrica", href: "/calidad/ensayos/curva", modulo: "calidad" }`

**Los límites no se dibujan.** El spec lo deja a quien construya y la decisión
es no, con el dato medido: hay **2 límites cargados en todo el sistema** y uno
solo es granulométrico, así que esa línea sería invisible en 19 de los 20
productos. Por eso esta pantalla no trae `traerLimites()`. Si algún día se
cargan límites de verdad, agregarlos es una tarea de una tarde.

- [ ] **Paso 5: Verificar**

```bash
npx tsc --noEmit
npm run build
node scripts/revisar-responsive.mjs
```
Esperado: tsc limpio, build compila con `/calidad/ensayos/curva` en la lista de rutas, responsive ROMPE 0.

Y a mano, lo que el script no ve: comprobar en el código que los dos gráficos están en `grid-cols-1 sm:grid-cols-2` y no en una grilla de dos columnas sin breakpoint.

- [ ] **Paso 6: Commitear**

```bash
git add "app/(app)/calidad/ensayos/curva/page.tsx" "app/(app)/calidad/ensayos/curva/CurvaClient.tsx" "app/(app)/calidad/ensayos/curva/GraficosDeLaCurva.tsx" lib/core/nav.ts
git commit -m "feat(calidad): la pantalla de la curva granulometrica por muestra"
```

---

### Tarea 4: Dejarlo escrito

**Archivos:**
- Modificar: `docs/CALIDAD-ENSAYOS.md`
- Modificar: `CLAUDE.md`

- [ ] **Paso 1: La sección en `docs/CALIDAD-ENSAYOS.md`**

Qué es la pantalla y **las dos cosas que no se deducen del código**, que son los dos riesgos asumidos del spec:

1. apagar un tamiz no hace lo mismo en los dos gráficos — en retenido saca el valor, en acumulado lo esconde pero lo deja sumado en todos los puntos a su derecha;
2. el eje son las mallas que midió la muestra y **la pantalla no avisa si falta una que el producto declara**, lo que va al revés de `acumuladosDelListado()`; medido: 19 de 79 muestras midieron un juego distinto del declarado, y la #325 está medida en 13 muestras y declarada por ningún producto.

- [ ] **Paso 2: La fila de Calidad en `CLAUDE.md`**

Agregar el enlace al spec y al plan en la fila de Calidad de la tabla de módulos, con una línea de lo que no se deduce del código.

- [ ] **Paso 3: Revisar el árbol commiteado**

Correr: `node scripts/revisar-arbol-commiteado.mjs HEAD`
Esperado: todos los imports resuelven.

- [ ] **Paso 4: Commitear**

```bash
git add docs/CALIDAD-ENSAYOS.md CLAUDE.md
git commit -m "docs(calidad): la curva granulometrica y sus dos riesgos asumidos"
```

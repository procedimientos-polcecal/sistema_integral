# Imprimir el mes de órdenes, sin color — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poder imprimir en blanco y negro, desde la pestaña «Mes», el mes, una semana o un día de órdenes de trabajo, con los filtros que se estén usando, y ver indicadores arriba de la pantalla.

**Architecture:** Toda la lógica nueva sale a cuatro módulos puros de `lib/mantenimiento/` con tests de vitest —las rutas y las pantallas de este repo no tienen tests—, y encima van tres cambios de UI: la barra de indicadores en `MesDeOrdenes`, los botones de imprimir en `CalendarioDeOT` y la pantalla nueva `ordenes/imprimir/`. El filtro que hoy vive privado dentro de `CalendarioDeOT` se extrae primero, porque es lo único que garantiza que el papel y la pantalla muestren el mismo conjunto.

**Tech Stack:** Next.js 16 (App Router), React, TypeScript, Supabase, vitest, `html2pdf.js` para el botón de PDF.

**Spec:** [docs/superpowers/specs/2026-11-23-mantenimiento-imprimir-el-mes-de-ordenes-design.md](../specs/2026-11-23-mantenimiento-imprimir-el-mes-de-ordenes-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, textos de pantalla y de commit.
- Las letras de especialidad son exactamente `M` mecánico · `E` eléctrico · `C` civil · `L` lubricación · `–` otra o vacía. El `–` es un guion corto (U+2013), no un guion bajo ni un cero.
- La especialidad se compara **siempre** con `norm()` de `lib/core/texto`, nunca con el texto crudo.
- Atrasada se dibuja con **relleno negro y texto blanco**; arrastre con **`→` delante del número de OT**. Nunca con color.
- La leyenda completa va en el encabezado de **cada** hoja.
- `/api/mantenimiento/calendario` rechaza un rango donde `sumarDias(desde, 62) < hasta`; el máximo son 63 días contando los dos extremos.
- Un desplegable nuevo se escribe `<Select>`, no `<select>`.
- Una grilla de tres o más columnas en la pantalla lleva breakpoint (`grid-cols-1 sm:grid-cols-3`). La pantalla de imprimir está exenta del revisor responsive porque su ruta contiene `/imprimir/`.
- `.no-print` y el `@media print` del armazón ya están en `app/globals.css` y **no se vuelven a declarar** por pantalla.
- Verificación: `npm test`, `npm run tipos` (no `npx tsc --noEmit`: se queda sin heap), `npm run build` con el dev server apagado.
- Se trabaja sobre `main`. Nunca `git add -A`: sólo los archivos nombrados en cada paso.

## Review Focus

- **Rango de más de 62 días:** la ruta contesta 400 y la hoja tiene que decirlo en vez de salir en blanco. → test en la Tarea 4.
- **Especialidad escrita distinto o desconocida** (`Lubricacion` sin tilde, `INSTRUMENTACIÓN`, `null`): tiene que caer en `–` y nunca romper. → test en la Tarea 2.
- **Un día con cientos de órdenes** (hoy hay uno con 356): la hoja del día corta y avisa cuántas dejó afuera. → test en la Tarea 3.
- **`?taller=1` pedido por quien no es admin:** la franja no sale y la hoja se imprime igual. → el parseo se testea en la Tarea 4; la autorización se comprueba a mano en la Tarea 7.
- **Un mes que no contiene hoy:** el bloque «Hoy» no aparece y no cuenta órdenes de otro mes. → test en la Tarea 3.

---

### Task 1: El filtro del calendario, extraído y probado

Hoy `Filtros`, `SIN_ESPECIALIDAD` y `pasaElFiltro` son privados de `CalendarioDeOT.tsx`. La hoja impresa tiene que filtrar **igual** que la pantalla, y dos copias se separan sin que nada avise.

**Files:**
- Create: `lib/mantenimiento/filtrosDelCalendario.ts`
- Create: `lib/mantenimiento/filtrosDelCalendario.test.ts`
- Modify: `app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx` (sacar las tres definiciones e importarlas)

**Interfaces:**
- Consumes: `OrdenDelDia` de `./CalendarioDeOT`, `norm` de `@/lib/core/texto`.
- Produces: `interface Filtros { especialidad: string; tipo: string; quien: string }`, `const SIN_FILTROS: Filtros`, `const SIN_ESPECIALIDAD = "__SIN__"`, `pasaElFiltro(o: OrdenDelDia, f: Filtros): boolean`.

Para no crear un ciclo de tipos, el módulo declara su propio tipo estructural mínimo —`{ especialidad: string | null; tipo: string | null; quien: string | null }`— y `pasaElFiltro` lo recibe. `OrdenDelDia` lo satisface.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("pasaElFiltro", () => {
  it("sin filtros deja pasar todo");
  it("compara la especialidad sin tilde ni mayúsculas: 'Lubricacion' pasa el filtro 'LUBRICACIÓN'");
  it("con SIN_ESPECIALIDAD deja pasar sólo las de especialidad vacía o null");
  it("con SIN_ESPECIALIDAD NO deja pasar una que tiene especialidad");
  it("filtra por tipo y por quien con la misma normalización");
  it("exige que pasen todos los filtros puestos a la vez");
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- filtrosDelCalendario`
Expected: FAIL, el módulo no existe.

- [ ] **Step 3: Crear `lib/mantenimiento/filtrosDelCalendario.ts`**

Mover el cuerpo de `pasaElFiltro` tal cual está hoy en `CalendarioDeOT.tsx` (líneas ~130-142), junto con `Filtros`, `SIN_FILTROS` y `SIN_ESPECIALIDAD`. No cambiar el comportamiento: esta tarea sólo lo mueve y lo prueba.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- filtrosDelCalendario`
Expected: PASS

- [ ] **Step 5: Rehacer `CalendarioDeOT.tsx` para que importe en vez de declarar**

Borrar las cuatro definiciones del archivo y agregar el import. No tocar nada más.

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `npm test` y `npm run tipos`
Expected: los dos en verde.

- [ ] **Step 7: Commit**

```bash
git add lib/mantenimiento/filtrosDelCalendario.ts lib/mantenimiento/filtrosDelCalendario.test.ts "app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx"
git commit -m "refactor(mantenimiento): el filtro del calendario sale a lib y gana tests"
```

---

### Task 2: Las marcas en blanco y negro

**Files:**
- Create: `lib/mantenimiento/marcasImpresas.ts`
- Create: `lib/mantenimiento/marcasImpresas.test.ts`

**Interfaces:**
- Consumes: `norm` de `@/lib/core/texto`.
- Produces: `letraDeEspecialidad(especialidad: string | null | undefined): string`, `LEYENDA_IMPRESA: { letra: string; nombre: string }[]`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("letraDeEspecialidad", () => {
  it("MECÁNICO da 'M', ELÉCTRICO 'E', CIVIL 'C', LUBRICACIÓN 'L'");
  it("'Lubricacion' sin tilde y en minúscula también da 'L'");
  it("null, undefined y cadena vacía dan '–'");
  it("INSTRUMENTACIÓN y OTRO dan '–', como el gris de la pantalla");
  it("un valor que nadie conoce da '–' y no rompe");
});

describe("LEYENDA_IMPRESA", () => {
  it("tiene cinco entradas y ninguna letra repetida");
  it("cubre todas las letras que devuelve letraDeEspecialidad");
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- marcasImpresas`
Expected: FAIL, el módulo no existe.

- [ ] **Step 3: Implementar el módulo**

`letraDeEspecialidad` resuelve con un `switch (norm(especialidad))` sobre `MECANICO`, `ELECTRICO`, `CIVIL`, `LUBRICACION` y cae en `"–"` por omisión — el mismo camino que usan `colorDeEspecialidad` y `oficioDeLaEspecialidad`. `LEYENDA_IMPRESA` lista las cinco en ese orden, con los nombres `Mecánico`, `Eléctrico`, `Civil`, `Lubricación`, `Otra o vacía`.

En el encabezado del archivo, dejar escrito por qué es letra y no color: la impresora del taller es blanco y negro, y el relleno negro de «atrasada» no esconde la letra, cosa que el rojo de la pantalla sí le hace al color de la especialidad.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- marcasImpresas`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/marcasImpresas.ts lib/mantenimiento/marcasImpresas.test.ts
git commit -m "feat(mantenimiento): la especialidad se dice con una letra para el papel"
```

---

### Task 3: Los resúmenes del día, del mes y de hoy

**Files:**
- Create: `lib/mantenimiento/resumenImpreso.ts`
- Create: `lib/mantenimiento/resumenImpreso.test.ts`

**Interfaces:**
- Consumes: `DiaDelCalendario` de `./calendarioDeOT`, `Filtros` y `pasaElFiltro` de `./filtrosDelCalendario`, `letraDeEspecialidad` de `./marcasImpresas`.
- Produces:
  - `resumenDelDia(dia: DiaDelCalendario, f: Filtros): { total: number; porLetra: { letra: string; cantidad: number }[]; atrasadas: number }`
  - `indicadoresDelMes(dias: DiaDelCalendario[], mes: string, f: Filtros): { total: number; porLetra: { letra: string; cantidad: number }[]; atrasadas: number; diaMasCargado: { dia: string; cantidad: number } | null }`
  - `indicadoresDeHoy(dias: DiaDelCalendario[], hoy: string, f: Filtros): { total: number; atrasadas: number; sinOperario: number } | null`
  - `recorteDeLaHoja<T>(ordenes: T[], tope: number): { visibles: T[]; afuera: number }`

`mes` es `"YYYY-MM"`. `porLetra` saltea las letras en cero y va en el orden de `LEYENDA_IMPRESA`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("resumenDelDia", () => {
  it("cuenta el total del día y lo desglosa por letra");
  it("saltea las letras que están en cero");
  it("cuenta las atrasadas aparte, y una atrasada también suma a su letra");
  it("respeta el filtro: con especialidad ELÉCTRICO no cuenta las mecánicas");
});

describe("indicadoresDelMes", () => {
  it("cuenta cada OT una sola vez aunque ocupe varios días");
  it("no cuenta los días de relleno que son de otro mes");
  it("diaMasCargado devuelve el día con más órdenes, contando arrastres");
  it("diaMasCargado es null si el mes no tiene ninguna orden");
});

describe("indicadoresDeHoy", () => {
  it("devuelve null si hoy no está entre los días que llegaron");
  it("cuenta las de hoy, las atrasadas de hoy y las que no tienen ningún operario");
  it("una orden con operario_2 puesto y los otros dos en null NO cuenta como sin operario");
});

describe("recorteDeLaHoja", () => {
  it("con menos órdenes que el tope no deja ninguna afuera");
  it("con 356 órdenes y tope 60 devuelve 60 visibles y 296 afuera");
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- resumenImpreso`
Expected: FAIL, el módulo no existe.

- [ ] **Step 3: Implementar el módulo**

`indicadoresDelMes` cuenta OT distintas con un `Set` de `ot_number` —es lo mismo que ya hace `totalDelMes` en `CalendarioDeOT`— y filtra los días con `d.dia.startsWith(mes)`. `diaMasCargado` sí cuenta por día, arrastres incluidos: son dos cuentas distintas a propósito y el encabezado del archivo tiene que decirlo, porque la suma de los días no va a dar el total del mes.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- resumenImpreso`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/resumenImpreso.ts lib/mantenimiento/resumenImpreso.test.ts
git commit -m "feat(mantenimiento): los resumenes del dia, del mes y de hoy"
```

---

### Task 4: La URL de la hoja

**Files:**
- Create: `lib/mantenimiento/urlDeImpresion.ts`
- Create: `lib/mantenimiento/urlDeImpresion.test.ts`

**Interfaces:**
- Consumes: `Filtros` de `./filtrosDelCalendario`, `sumarDias` de `@/lib/core/fechas`.
- Produces:
  - `type Periodo = "mes" | "semana" | "dia"`
  - `armarUrlDeImpresion(p: { periodo: Periodo; desde: string; hasta: string; filtros: Filtros; taller: boolean }): string`
  - `leerParametros(params: URLSearchParams): { periodo: Periodo; desde: string; hasta: string; filtros: Filtros; taller: boolean } | { error: string }`
  - `const MAXIMO_DE_DIAS = 62`

`armarUrlDeImpresion` devuelve una ruta relativa que arranca con `/mantenimiento/ordenes/imprimir?`. Los filtros vacíos no se escriben.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("armarUrlDeImpresion", () => {
  it("escribe periodo, desde y hasta");
  it("no escribe los filtros vacíos");
  it("escribe especialidad, tipo y quien cuando están puestos");
  it("escribe taller=1 sólo cuando taller es true");
});

describe("leerParametros", () => {
  it("vuelve a armar lo mismo que armarUrlDeImpresion escribió (ida y vuelta)");
  it("da error si falta desde o hasta");
  it("da error si desde o hasta no son AAAA-MM-DD");
  it("da error si desde es posterior a hasta");
  it("da error con un rango de 64 días, nombrando el máximo");
  it("acepta un rango de exactamente 63 días");
  it("da error si periodo no es mes, semana ni dia");
  it("taller=1 da taller true; sin el parámetro da false");
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- urlDeImpresion`
Expected: FAIL, el módulo no existe.

- [ ] **Step 3: Implementar el módulo**

El tope se comprueba con `sumarDias(desde, MAXIMO_DE_DIAS) < hasta`, la misma expresión que usa `/api/mantenimiento/calendario`, para que la hoja rechace exactamente lo que la ruta rechazaría. El mensaje de error es el que ve una persona y va en castellano.

En el encabezado, dejar dicho que **`taller` es un pedido y no un permiso**: lo autoriza `esAdminMantenimiento` del lado del servidor, en la Tarea 7.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- urlDeImpresion`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/urlDeImpresion.ts lib/mantenimiento/urlDeImpresion.test.ts
git commit -m "feat(mantenimiento): la url de la hoja, con el mismo tope que la ruta"
```

---

### Task 5: La barra de indicadores

**Files:**
- Modify: `app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx` (nueva prop `onEstado`)
- Modify: `app/(app)/mantenimiento/ordenes/MesDeOrdenes.tsx` (la barra)

**Interfaces:**
- Consumes: `indicadoresDelMes`, `indicadoresDeHoy` de `@/lib/mantenimiento/resumenImpreso`.
- Produces: en `CalendarioDeOT`, la prop opcional `onEstado?: (e: { mes: string; desde: string; hasta: string; filtros: Filtros; dias: DiaDelCalendario[] }) => void`, que reemplaza a `onRango` — lleva lo mismo y además el mes, los filtros y los días, que es lo que necesitan la barra y los botones.

**Ojo:** `onRango` hoy exige identidad estable en el padre o hace bucle infinito (`MesDeOrdenes` lo envuelve en `useCallback` y compara antes de setear). `onEstado` hereda el problema y el padre tiene que hacer lo mismo.

Esta tarea no lleva tests: las pantallas de este repo no tienen. La lógica que se podría equivocar ya está probada en la Tarea 3.

- [ ] **Step 1: Cambiar `onRango` por `onEstado` en `CalendarioDeOT`**

Un solo `useEffect`, con las mismas dependencias que hoy más `filtros` y `dias`. Actualizar al único llamador (`MesDeOrdenes`); `CalendarioDeFecha` y el modal de asignar no la pasan.

- [ ] **Step 2: Dibujar la barra en `MesDeOrdenes`, arriba del calendario**

Dos grupos. «Hoy» sólo si `indicadoresDeHoy` no devuelve null; si devuelve null, en su lugar va un botón **«Ir a hoy»**. «El mes» siempre. Los dos salen de `onEstado`, así que **respetan el filtro** sin pedir nada al servidor.

La grilla de tarjetas lleva breakpoint: `grid-cols-2 sm:grid-cols-4` o similar, nunca `grid-cols-4` pelado.

- [ ] **Step 3: Verificar**

Run: `npm run tipos`, `npm test`, `node scripts/revisar-responsive.mjs`
Expected: tipos y tests en verde; el revisor responsive en ROMPE 0 · APRETADO 0.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx" "app/(app)/mantenimiento/ordenes/MesDeOrdenes.tsx"
git commit -m "feat(mantenimiento): el mes de ordenes muestra indicadores arriba"
```

---

### Task 6: Los botones de imprimir

**Files:**
- Modify: `app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx`

**Interfaces:**
- Consumes: `armarUrlDeImpresion` de `@/lib/mantenimiento/urlDeImpresion`.

Los botones los arma **el propio calendario**, que es el que tiene el mes, los filtros y el día abierto. Subir ese estado al padre tocaría las tres pantallas que montan el componente.

- [ ] **Step 1: Botón del mes**

Al lado del selector de mes. Abre `armarUrlDeImpresion({ periodo: "mes", desde, hasta, filtros, taller })` en una pestaña nueva. `taller` sale de si el calendario recibió `franjaDeLaSemana`.

- [ ] **Step 2: Botón de la semana**

Uno por fila de semana, al borde. `desde` y `hasta` son el lunes y el domingo de esa fila, que la grilla ya conoce porque dibuja de lunes a domingo.

- [ ] **Step 3: Botón del día**

En el panel que se abre al tocar un día, con `desde === hasta === diaAbierto`.

- [ ] **Step 4: Que ninguno salga impreso**

Los tres llevan `className="no-print"`, aunque hoy no se impriman desde esta pantalla: la clase cuesta nada y la regla ya existe en `globals.css`.

- [ ] **Step 5: Verificar**

Run: `npm run tipos` y `node scripts/revisar-responsive.mjs`
Expected: los dos en verde.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx"
git commit -m "feat(mantenimiento): el calendario abre la hoja del mes, de la semana o del dia"
```

---

### Task 7: La pantalla de imprimir

**Files:**
- Create: `app/(app)/mantenimiento/ordenes/imprimir/page.tsx`
- Create: `app/(app)/mantenimiento/ordenes/imprimir/ImprimirClient.tsx`

**Interfaces:**
- Consumes: `leerParametros` de `@/lib/mantenimiento/urlDeImpresion`, `resumenDelDia` y `recorteDeLaHoja` de `@/lib/mantenimiento/resumenImpreso`, `letraDeEspecialidad` y `LEYENDA_IMPRESA` de `@/lib/mantenimiento/marcasImpresas`, `pasaElFiltro` de `@/lib/mantenimiento/filtrosDelCalendario`, `nivelMantenimientoDe` y `esAdminMantenimiento` de `@/lib/mantenimiento/auth`, `armarElCalendario` de `@/lib/mantenimiento/calendarioDeOT`.

- [ ] **Step 1: `page.tsx` — el permiso y los datos**

Server component, con la misma forma que `planificacion/[id]/imprimir/page.tsx`: sin sesión redirige a `/login`, sin `nivelMantenimientoDe` redirige a `/`. Lee los parámetros con `leerParametros`; si vuelve error, se lo pasa al cliente para que lo muestre en vez de una hoja en blanco.

**La franja se decide con las dos condiciones juntas:** sale sólo si el parámetro `taller` es true **y** `esAdminMantenimiento` da true. Sin permiso la hoja se arma igual, sin franja y sin aviso: quien la pidió por la URL no tiene por qué enterarse de que existe.

Los datos se traen acá, en el servidor, y no desde el cliente: la hoja tiene que estar entera antes de que alguien apriete imprimir.

- [ ] **Step 2: `ImprimirClient.tsx` — el encabezado**

Título con el período, el rango y **todos** los filtros puestos («Eléctrico · preventivo · semana del 16 al 22 de noviembre»); la leyenda completa de `LEYENDA_IMPRESA` más `negro = atrasada` y `→ viene de antes`; y la gente del taller una sola vez, por oficio y sin nombres, cuando hay franja.

**Dónde va la franja de rotación**, cuando está autorizada: en la hoja del mes, arriba de cada fila de semana, y en la de la semana, arriba de la tabla. **En la del día no va**: para un día la pregunta no es la rotación sino quién tiene cada orden, y eso está en la columna de operarios.

Al pie: `las órdenes de varios días cuentan en cada día`.

- [ ] **Step 3: El mes — el calendario de siete columnas**

Un cuadro por día con el número, el total grande, el desglose por letra de `resumenDelDia` y, si hay, las atrasadas en negro. Los días de los meses vecinos salen en gris. `@page { size: A4 landscape; margin: 10mm; }` en un `<style>` local, como hacen las otras tres.

- [ ] **Step 4: La semana y el día — la tabla**

Una fila por orden: letra, `→` si es arrastre, número de OT, equipo, tarea, operarios y una columna vacía para tildar. Las atrasadas con fondo negro y texto blanco.

**La semana va agrupada por día**, con un renglón de subtítulo por cada uno («lunes 16 — 9 órdenes»), y no como una corrida de siete días seguidos: la hoja se cuelga para ver qué toca cada día.

**El tope de `recorteDeLaHoja` es 60**, que son unas dos páginas de tabla y más del cuádruple del día más cargado real (15). Si dejó órdenes afuera, una última fila dice cuántas y por qué — ese caso hoy sólo lo dispara el defecto de las 353 duplicadas.

- [ ] **Step 5: Los dos botones, y que no se imprima sola**

«Imprimir» (`window.print()`) y «Guardar PDF» (`html2pdf.js`, como las otras tres), los dos con `no-print`. **Sin `setTimeout` que imprima solo**: el aviso del recorte tiene que poder leerse antes.

- [ ] **Step 6: Verificar en el navegador**

Abrir `/mantenimiento/ordenes/imprimir?periodo=mes&desde=2026-10-26&hasta=2026-12-06`, que es el mes de seis filas, y la vista previa de impresión. Comprobar: que entra en una A4 apaisada sin partirse, que el negro de «atrasada» no se confunde con el gris del encabezado, y que la letra se lee.

- [ ] **Step 7: Verificar el permiso a mano**

Con una sesión que **no** sea admin de Mantenimiento, abrir la misma URL con `&taller=1`. La hoja tiene que salir **sin franja** y sin error.

- [ ] **Step 8: Verificar el resto**

Run: `npm test`, `npm run tipos`, `npm run build` (con el dev server apagado), `node scripts/revisar-responsive.mjs`, `node scripts/revisar-exportaciones.mjs`, `node scripts/revisar-arbol-commiteado.mjs`
Expected: todo en verde. `revisar-exportaciones` tiene que seguir en ROMPE 0: esta pantalla no escribe ninguna planilla.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/imprimir/page.tsx" "app/(app)/mantenimiento/ordenes/imprimir/ImprimirClient.tsx"
git commit -m "feat(mantenimiento): la hoja del mes, la semana y el dia, sin color"
```

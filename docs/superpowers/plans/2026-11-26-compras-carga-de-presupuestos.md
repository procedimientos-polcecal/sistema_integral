# Compras — cargar la respuesta de un proveedor · Plan de implementación

> **Para quien lo ejecute con agentes:** SUB-SKILL REQUERIDA: usar
> `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans` para implementarlo tarea por tarea. Los pasos
> llevan casilla (`- [ ]`) para marcarlos.

**Objetivo:** que la respuesta de un proveedor —de 1 a 7 renglones, cada uno de
un RI distinto— se cargue de una vez en el SdG, y que la planilla del artículo
reciba una copia de respaldo que el sistema sepa reconocer como propia.

**Arquitectura:** una pantalla y una ruta nuevas que escriben en
`compras_cotizaciones` (la tabla que ya existe, con `origen = 'app'`) y vuelcan
el bloque entero a la planilla de Drive en una sola escritura. Una columna
`ID SISTEMA` en la planilla, ubicada **por nombre**, hace que la relectura
distinga el eco del sistema de una fila cargada a mano.

**Stack:** Next.js 16 (App Router) · Supabase · Google Sheets API v4 · vitest.

**Spec:** [docs/superpowers/specs/2026-11-26-compras-carga-de-presupuestos-design.md](../specs/2026-11-26-compras-carga-de-presupuestos-design.md)

## Restricciones globales

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- Cuota de Sheets: `ReadRequestsPerMinutePerUser` = **60**, compartida por los
  siete módulos. El costo se cuenta **por planilla y nunca por renglón**: siete
  renglones en una planilla cuestan lo mismo que uno. Lo que cuesta una planilla
  —corregido el 26/11/2026, acá decía «1 lectura + 1 escritura»— son **3 o 4
  lecturas y de 1 a 3 escrituras**: `leerComparativa` gasta dos (cabecera y
  valores), `asegurarColumnas` una más siempre, y `agregarFilas` la columna A y
  el bloque; las escrituras de más son el encabezado `ID SISTEMA` y el
  ensanchado de la hoja, sólo la primera vez. Subestimarlo ~4× vuelve inútil el
  número justo para lo que existe: razonar contra el tope de 60.
- Escrituras con `USER_ENTERED`: números como número, fechas como serial
  (`serialDelDia`), prosa con `textoParaLaCelda()`.
- Una planilla que está calculando no se lee ni se escribe (`estaCalculando`).
- Desplegables con `<Select>`, nunca `<select>`. Grillas de 3+ columnas con
  breakpoint (`grid-cols-1 sm:grid-cols-3`). Anchos en un `div` que envuelva al
  campo, nunca `className="input w-20"`.
- `git add` por nombre de archivo. **Nunca `git add -A`.**
- Las migraciones las aplica una persona en el editor SQL de Supabase.
- Verificación antes de dar una tarea por buena: `npm test`,
  `npx tsc --noEmit`, `npm run build`, `node scripts/revisar-arbol-commiteado.mjs`,
  `node scripts/revisar-responsive.mjs`, `node scripts/revisar-exportaciones.mjs`.

## Review Focus

Las cinco cosas que el spec implica y que ninguna tarea probaría sola. Cada una
tiene su test agregado a la tarea dueña del código:

1. **La planilla está calculando cuando se escribe el respaldo** → no se escribe
   nada y queda el pendiente con lo que dijo Google. (Tarea 2)
2. **Un comentario que arranca con `=`, `+`, `-` o `@`** → va como texto, no
   como fórmula. (Tarea 4)
3. **Dos renglones de la misma carga que caen en planillas distintas** —el 4%
   medido— → cada bloque a su planilla, y el costo se cuenta por planilla.
   (Tarea 6)
4. **Una carga sin renglones, o con un RI repetido** → se rechaza entera, con
   el renglón nombrado. (Tarea 6)
5. **Una fila vieja de `origen = 'app'` sin `ID SISTEMA`** —hay 8— → la
   relectura no la toma por eco y no la pierde. (Tarea 5)

---

### Tarea 1: La migración de la fecha de la respuesta

Va primero y **bloquea a la 4 y a la 6**: la aplica una persona a mano.

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_cotizaciones_guardan_la_fecha_de_la_respuesta.sql`

- [ ] **Paso 1: generar el archivo con marca de tiempo**

```bash
npm run migracion "cotizaciones guardan la fecha de la respuesta"
```

- [ ] **Paso 2: escribir la migración**

`alter table public.compras_cotizaciones add column if not exists fecha_respuesta date;`

El encabezado explica el porqué medido: la `FECHA` de la planilla es la fecha en
que contestó el proveedor, no la del pedido — de 323 filas comparables el **74%**
difiere, mediana **+3 días**, 233 de 238 posteriores al pedido. `created_at` no
sirve porque una respuesta de ayer cargada hoy quedaría con la de hoy.

- [ ] **Paso 3: commitear y DECIRLO**

```bash
git add supabase/migrations/<archivo>.sql
git commit -m "feat(compras): la fecha en que contestó el proveedor, en su propia columna"
```

Avisar que la migración está sin aplicar y **esperar**. Las tareas 4 y 6 no
arrancan hasta que esté corrida.

---

### Tarea 2: `agregarFilas()` — un bloque en una sola escritura

**Archivos:**
- Modificar: `lib/compras/drive.ts`
- Crear: `lib/compras/bloqueDeFilas.test.ts`
- Crear: `lib/compras/bloqueDeFilas.ts`

**Interfaces:**
- Consume: `proximaFilaLibre`, `estaCalculando`, `errorDeCalculo` (ya en `drive.ts`).
- Produce:
  - `rangoDelBloque(pestana: string, filaInicial: number, filas: string[][]): string`
  - `agregarFilas(fileId: string, pestana: string, cantidad: number, armarValores: (filaInicial: number) => string[][]): Promise<number>` — devuelve la primera fila escrita.

- [ ] **Paso 1: escribir el test que falla**, en `bloqueDeFilas.test.ts`:

```ts
describe("el rango de un bloque de filas", () => {
  it("abarca de la primera a la última fila y hasta la columna más ancha", () => {
    expect(rangoDelBloque("Hoja 1", 10, [["a", "b"], ["c", "d", "e"]]))
      .toBe("Hoja 1!A10:E11");
  });
  it("una sola fila da un rango de una sola fila", () => {
    expect(rangoDelBloque("Hoja 1", 7, [["a"]])).toBe("Hoja 1!A7:A7");
  });
  // El rango tiene que cubrir TODAS las columnas que se mandan: si queda
  // corto, Google rechaza la escritura entera.
  it("se mide por la fila más ancha y no por la primera", () => {
    expect(rangoDelBloque("Hoja 1", 1, [["a"], ["b", "c", "d"]])).toBe("Hoja 1!A1:C2");
  });
});
```

- [ ] **Paso 2: correrlo y ver que falla**

Run: `npx vitest run lib/compras/bloqueDeFilas.test.ts`
Esperado: FAIL, `rangoDelBloque is not defined`.

- [ ] **Paso 3: implementar `rangoDelBloque`** en `lib/compras/bloqueDeFilas.ts`, con `letraDeColumna` de `@/lib/core/columnaDeSheets` (es **0-based**).

- [ ] **Paso 4: correrlo y ver que pasa**

- [ ] **Paso 5: implementar `agregarFilas` en `lib/compras/drive.ts`**

Busca la fila libre **una vez** con `proximaFilaLibre` —que ya corta si la
planilla está calculando—, arma los valores con esa fila y escribe el rango de
`rangoDelBloque` con un `PUT` y `valueInputOption=USER_ENTERED`. Su docstring
dice por qué existe: siete renglones con `agregarFila()` son siete lecturas y
siete escrituras contra la cuota de 60 por minuto que se agotó el 26/11/2026.

- [ ] **Paso 6: el test del Review Focus 1** — que una planilla calculando no se
  escriba. `proximaFilaLibre` ya lo garantiza; el test fija que `agregarFilas`
  no lo saltea, mockeando la lectura de la columna A con `[["Cargando..."]]` y
  esperando que **no** se llame al `PUT`.

- [ ] **Paso 7: verificar y commitear**

```bash
npx vitest run lib/compras/bloqueDeFilas.test.ts
git add lib/compras/bloqueDeFilas.ts lib/compras/bloqueDeFilas.test.ts lib/compras/drive.ts
git commit -m "feat(compras): escribir un bloque de presupuestos en una sola llamada"
```

---

### Tarea 3: La columna `ID SISTEMA`, por nombre y no por letra

**Archivos:**
- Modificar: `lib/compras/comparativa.ts` (`ALIAS`, `ClaveColumna`)
- Modificar: `lib/compras/comparativa.test.ts`
- Modificar: `lib/compras/drive.ts`

**Interfaces:**
- Produce:
  - `ALIAS.id_sistema = ["ID SISTEMA"]` — **no** entra en `IMPRESCINDIBLES`.
  - `anchoUsado(encabezado: string[], filas: string[][]): number` — la última columna con algo, 1-based.
  - `asegurarLaColumnaDelId(fileId: string, pestana: string, encabezado: string[], filas: string[][]): Promise<number>` — devuelve el índice 0-based de la columna del id, creándola si no está.

- [ ] **Paso 1: escribir los tests que fallan**, en `comparativa.test.ts`:

```ts
it("reconoce la columna del id cuando está", () => {
  const mapa = mapearEncabezados([...COLUMNAS_COMPARATIVA, "ID SISTEMA"]);
  expect(mapa.ok && mapa.idx.id_sistema).toBe(19);
});
// Las 200 planillas son clones derivados: una sin la columna se lee igual.
it("una planilla sin esa columna sigue siendo válida", () => {
  const mapa = mapearEncabezados([...COLUMNAS_COMPARATIVA]);
  expect(mapa.ok && mapa.idx.id_sistema).toBe(-1);
});
// Medido el 26/11/2026: los anchos reales son 16, 19 y 20, y REPUESTOS
// MÁQUINAS ya usa la T para EQUIPO. La letra fija pisaría datos.
it("el ancho usado sale del encabezado y de las filas, no de la plantilla", () => {
  expect(anchoUsado(["A", "B"], [["x", "y", "z"]])).toBe(3);
  expect(anchoUsado(["A", "B", "C"], [["x"]])).toBe(3);
});
```

- [ ] **Paso 2: correrlos y ver que fallan**

- [ ] **Paso 3: agregar `id_sistema` a `ClaveColumna` y a `ALIAS`**, e implementar `anchoUsado`.

Comprobar que `IMPRESCINDIBLES` **no** la incluye: una planilla sin la columna
tiene que seguir mapeando `ok`.

- [ ] **Paso 4: correr los tests y ver que pasan**

- [ ] **Paso 5: implementar `asegurarLaColumnaDelId` en `drive.ts`**

Si `mapearEncabezados` ya la ubica, devuelve su índice. Si no: llama a
`asegurarColumnas(fileId, pestana, anchoUsado + 1)` de `@/lib/core/sheets`
—que existe por el incidente de la `K` de carbonilla: escribir fuera del ancho
real rechaza el `batchUpdate` entero— y después escribe `ID SISTEMA` en la fila 1
de esa columna.

- [ ] **Paso 6: verificar y commitear**

```bash
npx vitest run lib/compras/comparativa.test.ts
git add lib/compras/comparativa.ts lib/compras/comparativa.test.ts lib/compras/drive.ts
git commit -m "feat(compras): la comparativa dice qué fila escribió el sistema"
```

---

### Tarea 4: La fila de respaldo lleva el id y la fecha de la respuesta

**Depende de la Tarea 1 aplicada.**

**Archivos:**
- Modificar: `lib/compras/comparativa.ts` (`filaParaPlanilla`)
- Modificar: `lib/compras/comparativa.test.ts`
- Modificar: `app/api/compras/requerimientos/[id]/cotizaciones/route.ts`

**Interfaces:**
- `filaParaPlanilla` suma **`idCotizacion?: string | null`** y **`idxIdSistema?: number`** (el índice 0-based que devuelve `asegurarLaColumnaDelId` de la Tarea 3; `-1` o ausente quiere decir que esa planilla no tiene la columna). No lo saca de `idx` porque la columna puede haberse creado en esta misma llamada, después de mapear el encabezado.
- `fecha` pasa a ser **la fecha de la respuesta**, ya no la del pedido.

- [ ] **Paso 1: escribir los tests que fallan**:

```ts
it("escribe el id de la cotización en la columna del sistema", () => {
  const mapa = mapearEncabezados([...COLUMNAS_COMPARATIVA, "ID SISTEMA"]);
  const fila = filaParaPlanilla({ ...base, idCotizacion: "abc-123" });
  expect(fila[19]).toBe("abc-123");
});
it("sin columna del sistema la fila no crece", () => {
  const fila = filaParaPlanilla({ ...baseSinColumna, idCotizacion: "abc-123" });
  expect(fila).toHaveLength(COLUMNAS_COMPARATIVA.length);
});
// Review Focus 2: USER_ENTERED convierte en fórmula lo que arranca con = + - @
it("un comentario que arranca con = va como texto", () => {
  const fila = filaParaPlanilla({ ...base, cotizacion: { ...c, comentario: "=A1+1" } });
  expect(fila[mapa.idx.comentario]).toBe("'=A1+1");
});
```

- [ ] **Paso 2: correrlos y ver que fallan**

- [ ] **Paso 3: implementar.** La fila se dimensiona con el ancho que haga falta, no con `COLUMNAS_COMPARATIVA.length` fijo.

- [ ] **Paso 4: correr los tests y ver que pasan**

- [ ] **Paso 5: arreglar la carga por RI**, que hoy escribe `fecha: ri.fecha` —la del pedido— en esa celda. Pasa a mandar `fecha_respuesta` de la cotización, y a pasar el `idCotizacion` con su `idxIdSistema`.

- [ ] **Paso 6: y que deje de saltear el respaldo en silencio.** Hoy esa ruta
  envuelve la escritura a Drive en un `if (ri.comparativa_drive_id)` **sin
  `else`**: un RI sin planilla vinculada guarda el presupuesto y no escribe en
  ninguna parte, sin aviso y sin pendiente. Pasa a vincular la planilla igual
  que la ruta nueva, o a dejar dicho que no hay dónde escribirlo. Son **63 de
  los 102** pedidos candidatos.

- [ ] **Paso 7: verificar y commitear**

```bash
npx vitest run lib/compras/comparativa.test.ts
npx tsc --noEmit
git add lib/compras/comparativa.ts lib/compras/comparativa.test.ts "app/api/compras/requerimientos/[id]/cotizaciones/route.ts"
git commit -m "fix(compras): la planilla recibe la fecha de la respuesta, no la del pedido"
```

---

### Tarea 5: La relectura no borra lo que el sistema cargó

**Archivos:**
- Crear: `lib/compras/ecoDelSistema.ts` + `lib/compras/ecoDelSistema.test.ts`
- Modificar: `app/api/compras/requerimientos/[id]/comparativa/route.ts`
- Modificar: `app/api/compras/comparativas/vincular/route.ts`

**Interfaces:**
- Produce: `esEcoDelSistema(fila: string[], idxId: number, idsConocidos: Set<string>): boolean`

- [ ] **Paso 1: escribir los tests que fallan**:

```ts
it("una fila con un id que el sistema conoce es su propio eco", () => {
  expect(esEcoDelSistema(["2301", "", "x"], 2, new Set(["x"]))).toBe(true);
});
it("una fila con un id desconocido no lo es: alguien la escribió afuera", () => {
  expect(esEcoDelSistema(["2301", "", "y"], 2, new Set(["x"]))).toBe(false);
});
// Review Focus 5: las 8 filas viejas de origen 'app' no tienen la columna.
it("sin columna de id ninguna fila es eco", () => {
  expect(esEcoDelSistema(["2301", ""], -1, new Set(["x"]))).toBe(false);
});
it("una celda vacía no es eco", () => {
  expect(esEcoDelSistema(["2301", "", ""], 2, new Set(["x"]))).toBe(false);
});
```

- [ ] **Paso 2: correrlos y ver que fallan**

- [ ] **Paso 3: implementar `esEcoDelSistema`**

- [ ] **Paso 4: correr los tests y ver que pasan**

- [ ] **Paso 5: angostar el borrado de la relectura por RI**

Hoy borra todo lo que tenga `drive_fila`, sin mirar el origen, y su comentario
lo defiende citando el RI 1865. Con la columna de id la causa está atacada de
frente, así que el borrado pasa a **dejar las filas que el sistema escribió**:
se le agrega `.neq("origen", "app")`. **El comentario de esa ruta se reescribe**
explicando el cambio y por qué el argumento del RI 1865 ya no aplica — si queda
el viejo, el próximo lector cree que sigue borrando todo.

- [ ] **Paso 6: saltear el eco al leer**, en las dos rutas de relectura: una fila cuyo id ya está en `compras_cotizaciones` no entra como presupuesto nuevo.

- [ ] **Paso 7: verificar y commitear**

```bash
npx vitest run lib/compras/ecoDelSistema.test.ts
npx tsc --noEmit
git add lib/compras/ecoDelSistema.ts lib/compras/ecoDelSistema.test.ts "app/api/compras/requerimientos/[id]/comparativa/route.ts" app/api/compras/comparativas/vincular/route.ts
git commit -m "fix(compras): releer la planilla ya no se lleva puesto lo que cargó el sistema"
```

---

### Tarea 6: La ruta `POST /api/compras/presupuestos`

**Depende de la Tarea 1 aplicada, y de la 2, 3, 4 y 5.**

**Archivos:**
- Crear: `app/api/compras/presupuestos/route.ts`
- Crear: `lib/compras/cargaDePresupuestos.ts` + `.test.ts`
- Modificar: `scripts/revisar-exportaciones.mjs` (declarar el archivo nuevo)

**Interfaces:**
- Consume: `agregarFilas`, `asegurarLaColumnaDelId`, `filaParaPlanilla`, `comparativaCongelada`, `tienePresupuestoElegido`.
- Produce:
  - `type Renglon = { requerimiento_id: string; precio_unitario: number; cantidad: number | null; marca: string | null; unidad_medida: string | null; descuento: number; iva: number; plazos_pago_dias: number | null; condiciones_pago: string | null; disponibilidad: string | null; comentario: string | null; costo_envio: number | null; precio_hasta: string | null; moneda: string | null }`
  - `validarLaCarga(args: { proveedorId: string | null; fecha: string | null; renglones: Renglon[] }): string[]` — todos los problemas juntos, en castellano.
  - `planillaDeCadaRenglon(renglones, planillaDelEncabezado, planillaPorRi): Map<string, string[]>` — agrupa los renglones por planilla destino.

- [ ] **Paso 1: escribir los tests que fallan**, en `cargaDePresupuestos.test.ts`:

```ts
// Review Focus 4
it("una carga sin renglones se rechaza", () => {
  expect(validarLaCarga({ proveedorId: "p", fecha: "2026-11-18", renglones: [] }))
    .toContain("Hay que cargar al menos un presupuesto");
});
it("el mismo RI dos veces en la misma carga se rechaza, nombrándolo", () => {
  const e = validarLaCarga({ proveedorId: "p", fecha: "2026-11-18", renglones: [r(1), r(1)] });
  expect(e.join(" ")).toMatch(/dos veces/);
});
it("informa todos los problemas juntos y no de a uno", () => {
  expect(validarLaCarga({ proveedorId: null, fecha: null, renglones: [] })).toHaveLength(3);
});
// Review Focus 3: el 4% que cruza artículos
it("un renglón cuyo RI ya tiene planilla va a la suya y no a la del encabezado", () => {
  const m = planillaDeCadaRenglon([r("a"), r("b")], "libro-X", { b: "libro-Y" });
  expect([...m.keys()].sort()).toEqual(["libro-X", "libro-Y"]);
});
```

- [ ] **Paso 2: correrlos y ver que fallan**

- [ ] **Paso 3: implementar las tres funciones puras**

- [ ] **Paso 4: correr los tests y ver que pasan**

- [ ] **Paso 5: escribir la ruta**

En orden, y el orden es la decisión: **valida todo antes de escribir nada**
(si un RI está congelado o sin aprobar, no se guarda ninguno) → inserta una fila
por renglón con `origen: 'app'`, `created_by` y `fecha_respuesta` → por cada
planilla destino: `asegurarLaColumnaDelId` y **un** `agregarFilas` → guarda
`drive_fila` de cada fila escrita → vincula `comparativa_drive_id` al RI que no
tenía → si Drive falla, lo cargado **queda** y se anota el pendiente con lo que
dijo Google, sin traducir.

El avance de estado (`SIN_INICIAR → EN_COMPARATIVA`) se hace, pero las
exportaciones al master **se drenan con `after()`, una pasada para toda la
carga** — como el cuaderno de contratista, y por la misma cuota.

- [ ] **Paso 6: declarar el archivo en `revisar-exportaciones`** con su estrategia (`cola`) y el porqué. Si no se declara, el script sale ROMPE.

- [ ] **Paso 7: verificar y commitear**

```bash
npm test && npx tsc --noEmit && node scripts/revisar-exportaciones.mjs
git add app/api/compras/presupuestos/route.ts lib/compras/cargaDePresupuestos.ts lib/compras/cargaDePresupuestos.test.ts scripts/revisar-exportaciones.mjs
git commit -m "feat(compras): cargar de una vez la respuesta de un proveedor"
```

---

### Tarea 7: La pantalla

**Archivos:**
- Crear: `app/(app)/compras/presupuestos/page.tsx` y `PresupuestosClient.tsx`
- Modificar: el menú de Compras

- [ ] **Paso 1: `page.tsx`** — server component. Trae con `traerTodo()` los RI aprobados y sin compra decidida (hoy ~102), los proveedores y los archivos de la carpeta. Redirige a `/compras` si no `puedeEditar`.

- [ ] **Paso 2: el encabezado** — proveedor, fecha y planilla del artículo, los tres con `<Select>`. Con ~102 y ~200 opciones el panel con buscador sale solo.

- [ ] **Paso 3: los renglones** — RI, marca, unidad, precio unitario, cantidad, descuento, IVA, plazos, condiciones de pago, disponibilidad y comentario. **`ENVÍO`, `PRECIO HASTA` y la moneda van detrás de un «más campos»**: medido, están vacíos en 4 de 5 planillas, en 9 de cada 10 filas, y 1 de 1.077 respectivamente.

- [ ] **Paso 4: guardar** — un POST con todo junto. Los errores de `validarLaCarga` se muestran todos, y el aviso de Drive sobrevive al guardado.

- [ ] **Paso 5: verificar**

```bash
node scripts/revisar-responsive.mjs   # la carga puede pasar desde el teléfono
npm run build
```

- [ ] **Paso 6: commitear**

```bash
git add "app/(app)/compras/presupuestos/page.tsx" "app/(app)/compras/presupuestos/PresupuestosClient.tsx" <archivo del menú>
git commit -m "feat(compras): la pantalla para cargar la respuesta de un proveedor"
```

---

### Tarea 8: Documentar y cerrar

- [ ] **Paso 1:** la sección `## Cargar la respuesta de un proveedor` en `docs/COMPRAS.md`, con las tres cosas que no se deducen del código: la unidad de trabajo medida (29% más de un RI, 4% más de un artículo, máximo 7), por qué la columna del id va **por nombre** (anchos de 16, 19 y 20; `REPUESTOS MÁQUINAS` ya usa la `T`), y que la relectura dejó de borrar lo de `origen = 'app'`.
- [ ] **Paso 2:** el renglón de Compras en `CLAUDE.md`.
- [ ] **Paso 3:** decidir qué hacer con los **8 presupuestos viejos** de `origen = 'app'` con `drive_fila` y sin columna de id — escribirles el id, o dejar que la primera relectura los reemplace por su eco. Las dos son defendibles; no mirarlos, no.
- [ ] **Paso 4:** commitear y pushear.

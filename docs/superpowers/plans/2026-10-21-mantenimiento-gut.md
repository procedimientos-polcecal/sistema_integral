# Matriz GUT en las órdenes de trabajo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada orden de trabajo lleve tres notas de 1 a 5 —gravedad, urgencia, tendencia— cuyo producto ordene el listado, la pestaña "Qué hacer primero" y el selector de la planificación diaria.

**Architecture:** Las tres notas son columnas de `ordenes_trabajo`. Una cuarta columna **generada**, `gut_orden`, lleva el producto con dos reglas de ordenamiento adentro (27 para las que no tienen puntaje, +1000 para las que siguen abiertas) y es por la que ordena PostgREST, que no sabe ordenar por expresiones. Toda la lógica que se puede probar vive en `lib/mantenimiento/gut.ts`; las pantallas y las rutas la consumen.

**Tech Stack:** Next.js 16, Supabase/PostgREST, zod, vitest, Tailwind.

**Spec:** [docs/superpowers/specs/2026-10-21-mantenimiento-gut-design.md](../specs/2026-10-21-mantenimiento-gut-design.md)

## Global Constraints

- **Todo en castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Un desplegable se escribe `<Select>`** (de `components/Select.tsx`), nunca `<select>` nativo.
- **Una grilla de tres columnas lleva breakpoint**: `grid-cols-1 sm:grid-cols-3`. El ancho útil del teléfono es 343 px.
- **Nada de esto se escribe en ninguna planilla.** Ninguna ruta de este plan llama a `escribirEnLaFilaDeLaOT`.
- **Las notas válidas son enteros de 1 a 5**, o nulo. El puntaje es el producto de las tres y va de 1 a 125.
- **Sin puntaje vale 27** para ordenar. El valor aparece en dos lugares —el `coalesce` de la migración y `lib/mantenimiento/gut.ts`— y los dos tienen que decir lo mismo.
- **Las abiertas suben 1000** en `gut_orden`. Cerradas son `REALIZADO` y `SUSPENDIDA`.
- **La banda alta para el tablero es puntaje ≥ 65.**
- **Nunca `git add -A`**: cada commit nombra sus archivos. Puede haber otra sesión en el mismo árbol.
- **Commits en castellano**, conventional, terminados en `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **La migración la aplica una persona a mano** en el editor SQL de Supabase. Las tareas 5 en adelante no se pueden comprobar contra la base hasta que eso pase.

## Review Focus

Cinco cosas que el spec implica, que ninguna tarea probaría por su cuenta, y que muerden a quien usa esto. Cada una tiene su test asignado a la tarea que es dueña del código.

1. **Dos notas de tres cargadas.** El puntaje es `null`, la orden ordena como 27 y el recuadro muestra una raya — no un puntaje parcial. → Tarea 2 y Tarea 6.
2. **Una nota que no es un entero de 1 a 5** llegando a la ruta (`0`, `6`, `2.5`, `"alta"`, `null`). Tiene que salir un 400 en castellano y no un error de Postgres. → Tarea 4.
3. **Un `estado` desconocido o nulo** al calcular la clave de orden. Cuenta como abierta: una orden en un estado que nadie previó no se hunde al fondo. → Tarea 2.
4. **El orden del cliente y el de la base discrepando.** El 27 y el +1000 están escritos dos veces, en SQL y en TypeScript. → Tarea 2, con un test que ordena el mismo conjunto por las dos reglas.
5. **Una orden realizada con puntaje alto.** No puede encabezar el listado por encima de lo que todavía espera. → Tarea 2 y Tarea 5.

---

### Task 1: La migración

**Files:**
- Create: `supabase/migrations/<marca-de-tiempo>_gut_en_ordenes_de_trabajo.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `ordenes_trabajo.gut_gravedad`, `.gut_urgencia`, `.gut_tendencia` (`smallint` nulos, `check between 1 and 5`), `.gut_orden` (`integer`, generada) y el índice `ordenes_trabajo_gut_orden_idx`.

- [ ] **Step 1: Crear el archivo con marca de tiempo**

Run: `npm run migracion "gut en ordenes de trabajo"`

El contador no se usa: dos sesiones toman el mismo número libre y chocan.

- [ ] **Step 2: Escribir la migración**

El encabezado explica **por qué** `gut_orden` es generada y no calculada por la aplicación: PostgREST sólo ordena por columnas, el listado se pagina de a 50 sobre 2.224 filas, y ordenar en el cliente ordenaría la página. Y que no es el puntaje: lleva adentro el 27 y el +1000.

```sql
alter table ordenes_trabajo
  add column gut_gravedad  smallint check (gut_gravedad  between 1 and 5),
  add column gut_urgencia  smallint check (gut_urgencia  between 1 and 5),
  add column gut_tendencia smallint check (gut_tendencia between 1 and 5),
  add column gut_orden integer generated always as (
    (case when estado in ('REALIZADO', 'SUSPENDIDA') then 0 else 1000 end)
    + coalesce(gut_gravedad * gut_urgencia * gut_tendencia, 27)
  ) stored;

create index ordenes_trabajo_gut_orden_idx
  on ordenes_trabajo (gut_orden desc, ot_number desc);
```

Las tres columnas nuevas no llevan policy nueva: `ordenes_trabajo` ya tiene las suyas y esto no agrega una tabla.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/<archivo>.sql
git commit -m "feat(mantenimiento): columnas del GUT en las ordenes de trabajo"
```

- [ ] **Step 4: Pedirle al usuario que la aplique y esperar**

Decirle que hay una migración para correr en el editor SQL de Supabase, con la ruta del archivo. **No seguir con la tarea 5 hasta que confirme.** Las tareas 2, 3 y 4 no dependen de la base y se pueden hacer mientras tanto.

Si Postgres rechaza la expresión generada por el `case ... in (...)` sobre texto, la salida es dos columnas generadas en vez de una: `gut_puntaje_orden` con el `coalesce` y `gut_abierta boolean` con el `case`, y ordenar por las dos. No cambia nada del resto del plan salvo los nombres en la tarea 5.

---

### Task 2: Las funciones puras del GUT

**Files:**
- Create: `lib/mantenimiento/gut.ts`
- Test: `lib/mantenimiento/gut.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `ESCALAS_GUT: { gravedad: readonly string[]; urgencia: readonly string[]; tendencia: readonly string[] }` — cinco etiquetas cada una, índice 0 = nota 1.
  - `SIN_PUNTAJE = 27` y `EMPUJON_ABIERTA = 1000`.
  - `CERRADAS_GUT: readonly string[]` — `["REALIZADO", "SUSPENDIDA"]`.
  - `interface NotasGut { gut_gravedad?: number | null; gut_urgencia?: number | null; gut_tendencia?: number | null }`
  - `puntajeGut(notas: NotasGut): number | null`
  - `claveDeOrdenGut(orden: NotasGut & { estado?: string | null }): number`
  - `bandaDeGut(puntaje: number): 1 | 2 | 3 | 4 | 5` — 1 es la más suave.
  - `ES_ALTO_GUT = 65` y `esGutAlto(notas: NotasGut): boolean`
  - `esquemaGut` — el esquema zod de las tres notas.

- [ ] **Step 1: Escribir los tests que fallan**

Las etiquetas van textuales del material de origen; el test las fija para que nadie las "mejore".

```ts
describe("ESCALAS_GUT", () => {
  it("son las cinco palabras del material, en orden", () => {
    expect(ESCALAS_GUT.gravedad[0]).toBe("No reviste gravedad");
    expect(ESCALAS_GUT.gravedad[4]).toBe("Extremadamente grave");
    expect(ESCALAS_GUT.urgencia[4]).toBe("Sin tiempo disponible");
    expect(ESCALAS_GUT.tendencia[4]).toBe("Empeorará muy rápidamente");
    expect(ESCALAS_GUT.tendencia).toHaveLength(5);
  });
});

describe("puntajeGut", () => {
  it("multiplica las tres notas", () => {
    expect(puntajeGut({ gut_gravedad: 4, gut_urgencia: 5, gut_tendencia: 4 })).toBe(80);
  });
  it("es null si falta una, aunque haya dos cargadas", () => {
    expect(puntajeGut({ gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: null })).toBeNull();
  });
  it("es null si no hay ninguna", () => {
    expect(puntajeGut({})).toBeNull();
  });
});

describe("claveDeOrdenGut", () => {
  it("una abierta con puntaje suma el empujón", () => {
    expect(claveDeOrdenGut({ estado: "POR_HACER", gut_gravedad: 4, gut_urgencia: 5, gut_tendencia: 4 })).toBe(1080);
  });
  it("una abierta sin puntaje vale 27 más el empujón, y no cero", () => {
    // Si valiera cero, las 29 pendientes sin puntuar se hundirían al fondo.
    expect(claveDeOrdenGut({ estado: "POR_HACER" })).toBe(1027);
  });
  it("una realizada con puntaje alto queda por debajo de cualquier abierta", () => {
    const realizada = claveDeOrdenGut({ estado: "REALIZADO", gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 5 });
    const abierta = claveDeOrdenGut({ estado: "ATRASADO", gut_gravedad: 1, gut_urgencia: 1, gut_tendencia: 1 });
    expect(realizada).toBeLessThan(abierta);
  });
  it("un estado desconocido o vacío cuenta como abierta", () => {
    // Una orden en un estado que nadie previó no se hunde.
    expect(claveDeOrdenGut({ estado: null })).toBe(1027);
    expect(claveDeOrdenGut({ estado: "LO_QUE_VENGA" })).toBe(1027);
  });
});

describe("bandaDeGut", () => {
  it("cierra los agujeros que deja el material de origen", () => {
    // 64, 27, 10 y 1 no caían en ninguna banda del PDF, y 64 y 27 son
    // productos posibles: 4×4×4 y 3×3×3.
    expect(bandaDeGut(64)).toBe(3);
    expect(bandaDeGut(27)).toBe(2);
    expect(bandaDeGut(10)).toBe(1);
    expect(bandaDeGut(1)).toBe(1);
  });
  it("los bordes de cada banda", () => {
    expect(bandaDeGut(125)).toBe(5);
    expect(bandaDeGut(80)).toBe(5);
    expect(bandaDeGut(79)).toBe(4);
    expect(bandaDeGut(65)).toBe(4);
    expect(bandaDeGut(28)).toBe(3);
    expect(bandaDeGut(11)).toBe(2);
  });
});

describe("esGutAlto", () => {
  it("es alto desde 65", () => {
    expect(esGutAlto({ gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 3 })).toBe(true);   // 75
    expect(esGutAlto({ gut_gravedad: 4, gut_urgencia: 4, gut_tendencia: 4 })).toBe(false);  // 64
  });
  it("sin puntaje no es alto", () => {
    expect(esGutAlto({})).toBe(false);
  });
});
```

Y el que ata las dos mitades del ordenamiento, que es el único que prueba que la migración y el código dicen lo mismo:

```ts
describe("la clave de orden y la columna generada dicen lo mismo", () => {
  it("reproduce el coalesce y el case de la migración", () => {
    // Espejo literal de `gut_orden`. Si alguien cambia el 27 o el 1000 en un
    // lado y no en el otro, el listado y la pestaña ordenan distinto y nada avisa.
    const comoLoHaceLaBase = (o: any) =>
      (CERRADAS_GUT.includes(o.estado) ? 0 : EMPUJON_ABIERTA)
      + (puntajeGut(o) ?? SIN_PUNTAJE);
    for (const o of CASOS) expect(claveDeOrdenGut(o)).toBe(comoLoHaceLaBase(o));
  });
});
```

`CASOS` es una lista de unas ocho órdenes que cubra: las dos cerradas, dos abiertas, con puntaje, sin puntaje y con dos de tres.

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `npx vitest run lib/mantenimiento/gut.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Escribir `lib/mantenimiento/gut.ts`**

El encabezado del archivo explica por qué el 27 existe y por qué está escrito dos veces, con el enlace al spec.

`bandaDeGut` se escribe como una tabla de cortes (`[[80,5],[65,4],[28,3],[11,2]]`, resto 1) y no como una cadena de `if`: los cortes son el dato y conviene que se lean como tal.

`esquemaGut` con zod: las tres notas como `z.number().int().min(1).max(5).nullable().optional()`. No se exige que estén las tres — "sin obligar" vale también para la ruta.

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run lib/mantenimiento/gut.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/gut.ts lib/mantenimiento/gut.test.ts
git commit -m "feat(mantenimiento): las escalas y el puntaje de la matriz GUT"
```

---

### Task 3: El orden sugerido desempata por puntaje

**Files:**
- Modify: `lib/mantenimiento/prioridad.ts`
- Test: `lib/mantenimiento/prioridad.test.ts`

**Interfaces:**
- Consumes: `puntajeGut`, `SIN_PUNTAJE` de la tarea 2.
- Produces: `Ordenable` pasa a extender `NotasGut`. `ordenSugerido` y `aplicarOrdenManual` mantienen su firma.

- [ ] **Step 1: Escribir los tests que fallan**

Se agregan a `describe("ordenSugerido")`, y **los existentes que dependen del peso de `prioridad` se reescriben**: esa columna deja de ordenar.

```ts
it("entre dos que no están atrasadas, primero la de más puntaje", () => { /* 80 antes que 12 */ });
it("la que no tiene puntaje queda entre las de 28 y las de 11", () => {
  // Vale 27: ni se hunde ni se cuela arriba.
});
it("lo atrasado sigue yendo primero, aunque tenga el puntaje más bajo", () => { /* ya existía, se conserva */ });
it("la prioridad de la planilla ya no cambia el orden", () => {
  // Dos órdenes iguales salvo "🟠 Alta" / "🟢 Baja" salen en el orden en que entraron.
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/prioridad.test.ts`
Expected: FAIL en los nuevos.

- [ ] **Step 3: Cambiar el desempate en `ordenSugerido`**

El criterio 2 pasa de `peso(prioridad)` a `puntajeGut(o) ?? SIN_PUNTAJE`. `PESO_PRIORIDAD`, `soloLaPalabra` y `peso` quedan **sólo** si los usa `prioridadParaLaPlanilla`; si no, se borran y se dice en el commit.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/prioridad.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/prioridad.ts lib/mantenimiento/prioridad.test.ts
git commit -m "feat(mantenimiento): el orden sugerido desempata por puntaje GUT"
```

---

### Task 4: La ruta que guarda las tres notas

**Files:**
- Create: `app/api/mantenimiento/ordenes/[id]/gut/route.ts`
- Test: `lib/mantenimiento/gut.test.ts` (el esquema; las rutas no tienen tests en este repo)

**Interfaces:**
- Consumes: `esquemaGut` de la tarea 2; `validar`/`errorDeValidacion` de `lib/core/validar.ts`; `puedeEditarMantenimiento` de `lib/mantenimiento/auth.ts`.
- Produces: `PATCH /api/mantenimiento/ordenes/<id>/gut`, cuerpo `{ gut_gravedad, gut_urgencia, gut_tendencia }`, respuesta `{ ok: true }`.

- [ ] **Step 1: Escribir los tests del esquema**

```ts
describe("esquemaGut", () => {
  it("acepta las tres notas enteras de 1 a 5", () => { /* ok: true */ });
  it("acepta nulos: puntuar es opcional", () => { /* {gut_gravedad: null} → ok */ });
  it("rechaza 0, 6 y 2.5", () => { /* ok: false, un problema por campo */ });
  it("rechaza una palabra donde va un número", () => { /* "alta" → ok: false */ });
  it("informa los tres problemas juntos y en castellano", () => {
    const r = validar(esquemaGut, { gut_gravedad: 0, gut_urgencia: 9, gut_tendencia: "alta" });
    expect(r.ok).toBe(false);
    expect((r as any).problemas).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/gut.test.ts -t esquemaGut`
Expected: FAIL

- [ ] **Step 3: Escribir el esquema y la ruta**

El esquema va en `gut.ts` (tarea 2). La ruta sigue el patrón de `app/api/mantenimiento/ordenes/[id]/notas/route.ts`: `createClient()` para el usuario, 401 sin sesión, `puedeEditarMantenimiento` o 403, `validar()` o `errorDeValidacion()`, y el `update` con `createAdminClient()`.

**No llama a `escribirEnLaFilaDeLaOT` ni a `auditar()`**, y el comentario de cabecera dice por qué las dos cosas: el GUT no se exporta, y un puntaje se corrige escribiendo otro.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/gut.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/mantenimiento/ordenes/[id]/gut/route.ts" lib/mantenimiento/gut.ts lib/mantenimiento/gut.test.ts
git commit -m "feat(mantenimiento): ruta para puntuar una orden con GUT"
```

---

### Task 5: El listado ordena por `gut_orden` en el servidor

**Depende de que la migración esté aplicada.**

**Files:**
- Modify: `app/api/mantenimiento/ordenes/route.ts:82` (el `.order`)
- Modify: `lib/mantenimiento/types.ts:180-209` (`OrdenTrabajo`)

**Interfaces:**
- Consumes: la migración de la tarea 1.
- Produces: `OrdenTrabajo` con `gut_gravedad`, `gut_urgencia`, `gut_tendencia: number | null` y `gut_orden: number`.

- [ ] **Step 1: Agregar los cuatro campos a `OrdenTrabajo`**

No hay archivo de tipos generado por Supabase: este tipo se mantiene a mano.

- [ ] **Step 2: Cambiar el orden de la consulta**

`.order("gut_orden", { ascending: false }).order("ot_number", { ascending: false })`. El comentario dice por qué el orden es del servidor y no del cliente: 2.224 filas paginadas de a 50.

- [ ] **Step 3: Comprobarlo contra la base**

Escribir un script de un solo uso en el directorio temporal que pida la primera página por la ruta —o la misma consulta con el `SUPABASE_SERVICE_ROLE_KEY`— y compruebe dos cosas: que **ninguna realizada aparece antes que una pendiente**, y que entre las pendientes el puntaje va de mayor a menor.
Expected: las 45 pendientes primero.

- [ ] **Step 4: Commit**

```bash
git add app/api/mantenimiento/ordenes/route.ts lib/mantenimiento/types.ts
git commit -m "feat(mantenimiento): el listado de ordenes se ordena por puntaje GUT"
```

---

### Task 6: El recuadro del puntaje

**Files:**
- Create: `app/(app)/mantenimiento/ordenes/PuntajeGut.tsx`
- Modify: `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx`

**No hay página de detalle aparte**: las órdenes no tienen `[id]/page.tsx`, el listado y el detalle viven los dos en `OrdenesClient.tsx`. El recuadro va en la fila y en el detalle desplegado, los dos en ese archivo.

**Interfaces:**
- Consumes: `puntajeGut`, `bandaDeGut`, `ESCALAS_GUT` de la tarea 2.
- Produces: `<PuntajeGut orden={...} />`.

- [ ] **Step 1: Escribir el componente**

Muestra el número y, al pasar por encima, `G4 · U5 · T4` con las tres palabras completas. **Sin puntaje muestra una raya**, que es lo que después alimenta la sugerencia de la tarea 11.

**Un solo tono en cinco intensidades**, y ninguno de los cuatro colores de estado: rojo, ámbar, azul y verde ya son `ATRASADO`, `POR_HACER`, `EN_PROCESO` y `REALIZADO` en la misma fila (`ESTADOS` en `OrdenesClient.tsx:29-35`). Un GUT bajo en verde al lado de un verde que significa "terminado" es el anti-objetivo del spec entrando por el color.

**No lleva palabra**: "alta" y "media" ya son la otra escala.

- [ ] **Step 2: Ponerlo en la fila del listado y en el detalle**

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit` y `node scripts/revisar-responsive.mjs`
Expected: sin errores nuevos; ROMPE 0.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/PuntajeGut.tsx" "app/(app)/mantenimiento/ordenes/OrdenesClient.tsx"
git commit -m "feat(mantenimiento): el puntaje GUT se ve en el listado y en el detalle"
```

---

### Task 7: Los tres desplegables al crear una orden

**Files:**
- Modify: `app/(app)/mantenimiento/ordenes/NuevaOTModal.tsx:130-146` (el estado del formulario)
- Modify: `app/api/mantenimiento/ordenes/route.ts:127-200` (el POST)

**Interfaces:**
- Consumes: `ESCALAS_GUT`, `esquemaGut` de la tarea 2.
- Produces: el POST acepta las tres notas en el cuerpo.

- [ ] **Step 1: Agregar los tres al formulario**

Arrancan en `""`, con una opción vacía. **No copian la costumbre de `prioridad`**, que arranca en `"🟡 Media"` sin opción vacía: tres desplegables en 3 por defecto fabrican un 27 que nadie contestó y lo imprimen como si fuera una medición.

Los tres `<Select>`, en una grilla `grid-cols-1 sm:grid-cols-3`.

- [ ] **Step 2: Aceptarlos en el POST**

Se suman al destructuring del cuerpo y al `insert`. **`loQueFaltaParaCrear` de `lib/mantenimiento/altaDeOT.ts` no se toca**: crear una orden sin GUT se puede.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/NuevaOTModal.tsx" app/api/mantenimiento/ordenes/route.ts
git commit -m "feat(mantenimiento): puntuar con GUT al crear la orden"
```

---

### Task 8: Puntuar una orden que ya existe

**Files:**
- Create: `app/(app)/mantenimiento/ordenes/PuntuarGutModal.tsx`
- Modify: `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx`

**Interfaces:**
- Consumes: la ruta de la tarea 4, `ESCALAS_GUT` de la tarea 2.
- Produces: nada que use otra tarea.

Es el camino que importa hoy: 2.209 de 2.224 órdenes entran por el formulario de Google y llegan sin puntaje.

- [ ] **Step 1: Escribir el modal**

Los tres `<Select>` con las escalas, el puntaje calculándose mientras se eligen, y guardar con la ruta de la tarea 4. Se abre desde el recuadro de la tarea 6 y desde el detalle.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/PuntuarGutModal.tsx" "app/(app)/mantenimiento/ordenes/OrdenesClient.tsx"
git commit -m "feat(mantenimiento): puntuar con GUT una orden ya cargada"
```

---

### Task 9: Nadie hereda un puntaje

**Files:**
- Modify: `lib/mantenimiento/reutilizarOT.ts:123` (`copiarDeLaOT`)
- Test: `lib/mantenimiento/reutilizarOT.test.ts`
- Modify: `app/(app)/mantenimiento/avisos/GenerarOTModal.tsx`

**Interfaces:**
- Consumes: `ESCALAS_GUT` de la tarea 2.
- Produces: `LoQueSeCopia.noEntraron` puede traer la línea del GUT.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it("no copia el puntaje GUT de la orden vieja", () => {
  const { campos } = copiarDeLaOT({ ...vieja, gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 5 }, vocabulario);
  expect(campos.gut_gravedad).toBeUndefined();
});
it("avisa que el puntaje no viajó", () => {
  const { noEntraron } = copiarDeLaOT({ ...vieja, gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 5 }, vocabulario);
  expect(noEntraron.join(" ")).toContain("puntaje GUT");
});
it("no avisa nada si la vieja no tenía puntaje", () => { /* noEntraron vacío */ });
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/reutilizarOT.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

En `copiarDeLaOT`, el GUT **no** entra en `campos` y, si la vieja lo tenía, se agrega a `noEntraron` con el texto `el puntaje GUT ("80")`. El comentario dice por qué: el puntaje depende de cuándo es la orden, no de qué es.

En `GenerarOTModal.tsx` los tres desplegables aparecen vacíos. **`cuerpoDeLaOT` de `otDesdeAviso.ts` no siembra `gut_urgencia` desde `prioridadDeUrgencia`**: la urgencia del aviso la puso quien reportó la falla y el GUT lo contesta quien reparte el trabajo. El comentario lo dice, porque es la clase de "mejora" que alguien agrega después.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/reutilizarOT.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/reutilizarOT.ts lib/mantenimiento/reutilizarOT.test.ts "app/(app)/mantenimiento/avisos/GenerarOTModal.tsx"
git commit -m "fix(mantenimiento): ningun camino de alta hereda el puntaje GUT"
```

---

### Task 10: Las dos lecturas de `prioridad` que nunca funcionaron

**Files:**
- Modify: `lib/mantenimiento/alertas.ts:114` (`resumirAtrasadas`)
- Test: `lib/mantenimiento/alertas.test.ts`
- Modify: `app/(app)/mantenimiento/ordenes/OrdenarTrabajo.tsx:154-158`
- Modify: `app/(app)/mantenimiento/DashboardClient.tsx:116` (la leyenda)

**Interfaces:**
- Consumes: `esGutAlto`, `ES_ALTO_GUT` de la tarea 2.
- Produces: `resumirAtrasadas().urgentes` pasa a contar puntaje ≥ 65.

Las dos comparan `prioridad.toUpperCase()` contra `"ALTA"` cuando la planilla guarda `"🟠 Alta"`: **ninguna coincidió nunca**. El mismo error que `soloLaPalabra()` arregló en `prioridad.ts`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it("cuenta como urgentes las atrasadas de puntaje 65 o más", () => { /* una de 80 y una de 12 → urgentes: 1 */ });
it("no cuenta las que no tienen puntaje", () => { /* urgentes: 0 */ });
it("la prioridad de la planilla ya no cuenta", () => {
  // Una atrasada "🟠 Alta" sin GUT no es urgente. Antes tampoco lo era, pero
  // por un bug y no por una decisión.
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/alertas.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

`urgentes` pasa a `atrasadas.filter(esGutAlto).length`. La leyenda del tablero deja de decir "de prioridad alta" y dice lo que cuenta.

En `OrdenarTrabajo.tsx` **se saca la pastilla `alta`**. No es ocultar la prioridad de la planilla: esa pastilla nunca se dibujó. La prioridad sigue en los filtros y en el detalle.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/alertas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/alertas.ts lib/mantenimiento/alertas.test.ts "app/(app)/mantenimiento/ordenes/OrdenarTrabajo.tsx" "app/(app)/mantenimiento/DashboardClient.tsx"
git commit -m "fix(mantenimiento): el tablero cuenta GUT alto y no una prioridad que nunca matcheaba"
```

---

### Task 11: El plan diario ordena, y la sugerencia

**Files:**
- Modify: `app/(app)/mantenimiento/planificacion/[id]/PlanDetalle.tsx` (`availableOTs`)
- Modify: `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx` (la línea de sugerencia)

**Interfaces:**
- Consumes: `claveDeOrdenGut` de la tarea 2.
- Produces: nada.

- [ ] **Step 1: Ordenar `availableOTs` por puntaje**

"Agregar órdenes al plan" hoy no ordena por nada y es donde se elige qué se hace mañana.

- [ ] **Step 2: La línea de sugerencia**

Cuando hay pendientes sin puntuar, una línea discreta en la pantalla de órdenes: *"29 de las 45 pendientes no tienen GUT"*, con un acceso para puntuarlas.

**No es un aviso de `lib/home/avisos.ts`**, así que no va a la campana ni al push. Un contador que no se mueve dice lo mismo todos los días hasta que alguien lo descarta para siempre.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/mantenimiento/planificacion/[id]/PlanDetalle.tsx" "app/(app)/mantenimiento/ordenes/OrdenesClient.tsx"
git commit -m "feat(mantenimiento): el plan diario ordena por GUT y el listado sugiere puntuar"
```

---

### Task 12: Cerrar

- [ ] **Step 1: Las cinco verificaciones**

```bash
npm test && npx tsc --noEmit && npm run build && node scripts/revisar-responsive.mjs
```

`next build` con `npm run dev` levantado deja la app en 500: parar el dev server antes.

- [ ] **Step 2: Las tres comprobaciones contra la base**

Las del spec, que son las que ningún test puede hacer:

1. Puntuar una orden, correr la sincronización de órdenes, volver a leerla: **las tres notas siguen ahí**. Es lo que prueba que el `upsert` por `ot_number` no las pisa.
2. Cerrar una orden puntuada y mirar su `gut_orden`: **cae 1000 de golpe** sin que nadie escriba esa columna.
3. Pedir la primera página del listado por la ruta: trae **las de puntaje más alto entre las abiertas**, no las de número de OT más alto.

- [ ] **Step 3: Documentar**

Agregar el GUT a la fila de Mantenimiento de la tabla de `CLAUDE.md` y a `docs/MANTENIMIENTO-INTEGRACION.md`: que el puntaje no se exporta, que `gut_orden` es generada y no es el puntaje, y que el 27 está escrito en dos lugares.

- [ ] **Step 4: El árbol commiteado**

```bash
node scripts/revisar-arbol-commiteado.mjs
```

Es el único que mira lo que Vercel va a construir y no el disco. Un archivo nuevo que quedó *staged* y nunca se commiteó no viaja, y nada avisa.

- [ ] **Step 5: Push**

```bash
git push origin main
```

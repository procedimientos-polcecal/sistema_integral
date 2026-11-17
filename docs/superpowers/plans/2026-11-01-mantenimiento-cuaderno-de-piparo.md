# Cuaderno de Piparo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las fotos del cuaderno manuscrito de Piparo entren al SdG como
renglones chequeables, y que de ahí salga una OT por tarea.

**Architecture:** Tres capas puras en `lib/mantenimiento/` —el intérprete de las
abreviaturas, el enganche a sector/equipo, y la agrupación— con tests; cuatro
rutas que hablan con el modelo, el bucket y la base; y una pantalla nueva que
se elige por `proveedores.modo_de_carga` dentro de la ruta que ya existe. La
generación reusa el alta de OT de Candia.

**Tech Stack:** Next.js 16, Supabase (PostgREST + Storage), AI SDK 7 por el AI
Gateway de Vercel, vitest.

**Spec:** [docs/superpowers/specs/2026-10-30-mantenimiento-cuaderno-de-piparo-design.md](../specs/2026-10-30-mantenimiento-cuaderno-de-piparo-design.md)

## Global Constraints

- **Todo en castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Nunca `git add -A`.** Agregar sólo los archivos tocados, por nombre.
- **Las migraciones las corre una persona.** Un agente las escribe; cuando una
  tarea depende de una columna nueva, hay que decirlo y quedar a la espera.
- **Una migración aplicada no se edita**: se corrige con otra.
- **`traerTodo()` de `lib/core/paginado.ts`** en cualquier lectura que pueda
  pasar de 1000 filas. Un mes de cuaderno son ~118 renglones y un año, 1.400.
- **Un `select()` va literal**, no armado en una variable.
- **Una policy nueva llama a su función envuelta**: `using ((select mant_puede_ver()))`.
- **`<Select>` de `components/Select.tsx`**, nunca `<select>` nativo.
- **Grillas con breakpoint**: `grid-cols-1 sm:grid-cols-N`. Ancho útil 343 px.
- **El ancho de un campo va en un `div` que lo envuelva**, no en el `input`.
- **Al escribir en Sheets**: la prosa pasa por `textoParaLaCelda()`; los números
  y las fechas, no.
- Valores por defecto de la OT de Piparo, **medidos**: `MECÁNICO` /
  `PROGRAMADO` / `CONTRATADO` / `REALIZADO`. (Candia es `CIVIL`; no copiarlo.)
- `TOPE_POR_CORRIDA = 25`, igual que Candia.
- Verificación antes de dar por buena cualquier tarea: `npm test`,
  `npx tsc --noEmit`, `npm run build`, `node scripts/revisar-responsive.mjs`,
  `node scripts/revisar-exportaciones.mjs`.

## Review Focus

Cinco entradas que el spec implica y que ningún test de tarea ejercita si no se
las pide. Cada una tiene su test asignado a la tarea que es dueña del código.

1. **Un número sin unidad.** La hoja real del 22-09 dice `Tensar y alinear la
   misma = 4`: sin «Hs» y sin `$`. Cuatro horas y cuatro pesos son cosas
   distintas. Esperable: se guarda como horas (la unidad por defecto del
   cuaderno) y **se marca dudoso**, nunca como costo. → Tarea 3.
2. ~~**Un renglón con horas y costo a la vez.**~~ **Corregido el 01/11/2026 — era
   un defecto de este plan.** El esquema que se le pide al modelo es `valor` +
   `unidad`, un solo número, justamente para que no invente; con esa forma el
   modelo **no puede** devolver horas y costo a la vez, así que el caso no
   existe por el camino real. Lo que sí hay que fijar con un test es **el
   contrato**: que el esquema no deje pasar `horas` ni `costo` sueltos. Y lo que
   queda como límite escrito y sin test posible: si el papel trae de verdad las
   dos cosas en un renglón, el modelo elige una y el sistema no tiene cómo
   saberlo. En las diez hojas medidas no hay ningún renglón así — los de precio
   nunca traen horas. → Tarea 3.
3. **El modelo devuelve algo que no es la lista esperada** —JSON truncado, prosa,
   una foto que no es del cuaderno—. Esperable: esa foto queda en «falló» con lo
   que dijo, sin traducir, y las otras nueve siguen. El test de la
   normalización vive en la Tarea 3; el de que las otras nueve sigan es la
   prueba a mano de la Tarea 4. → Tareas 3 y 4.
4. **Una fecha imposible o fuera del mes.** `21-09-26` es 2026-09-21, pero el
   modelo puede devolver `2026-13-45` o un año de dos dígitos sin resolver.
   Esperable: el renglón entra con la fecha en null y marcado dudoso. → Tarea 3.
5. **Juntar renglones de dos sectores distintos.** Nada impide seleccionar un
   renglón de Trituración 1 y otro de Molienda y apretar «juntar». Esperable: se
   niega y dice por qué — una OT tiene un sector. → Tarea 6.

---

## File Structure

**Nuevos, puros (con test al lado):**

- `lib/mantenimiento/cuadernoAbreviaturas.ts` — el idioma de Piparo: `P/Trit N°3`
  → código de sector, `cinta 9` → número de cinta. No toca la base.
- `lib/mantenimiento/cuadernoEnganche.ts` — decide sector y equipo de un
  renglón, con el catálogo aprendido pisando al intérprete.
- `lib/mantenimiento/cuadernoLectura.ts` — el contrato de lo que devuelve el
  modelo y la normalización de su respuesta a renglones.
- `lib/mantenimiento/cuadernoGrupos.ts` — la propuesta de agrupación y las
  reglas de juntar/separar.
- `lib/mantenimiento/costoEnRepuesto.ts` — cómo entra el monto en el texto de
  `REPUESTO UTILIZADO`.

**Nuevos, rutas:**

- `app/api/mantenimiento/cuaderno/route.ts` — GET la carga, POST crearla,
  DELETE borrarla.
- `app/api/mantenimiento/cuaderno/fotos/route.ts` — POST una foto: la sube,
  la lee con el modelo, y devuelve sus renglones.
- `app/api/mantenimiento/cuaderno/renglones/route.ts` — PATCH un renglón,
  POST juntar, DELETE separar.
- `app/api/mantenimiento/cuaderno/generar/route.ts` — vista previa y generar.

**Nuevos, pantalla:**

- `app/(app)/mantenimiento/partes-contratista/CuadernoClient.tsx`

**Modificados:**

- `app/(app)/mantenimiento/partes-contratista/page.tsx` — traer `modo_de_carga`.
- `app/(app)/mantenimiento/partes-contratista/PartesContratistaClient.tsx` —
  ramificar por modo.
- `scripts/revisar-exportaciones.mjs` — declarar la ruta de generación.

**Migraciones (las corre el usuario):**

- una con las tres tablas del cuaderno y sus policies;
- una con `ordenes_trabajo.costo`;
- una con `proveedores.modo_de_carga`.

---

### Tarea 1: Las migraciones

**Files:**
- Create: `supabase/migrations/<ts>_cuaderno_de_contratista.sql`
- Create: `supabase/migrations/<ts>_ordenes_trabajo_costo.sql`
- Create: `supabase/migrations/<ts>_proveedores_modo_de_carga.sql`

**Interfaces:**
- Produces: las tablas `mant_cuadernos`, `mant_cuadernos_fotos`,
  `mant_cuadernos_renglones`; `ordenes_trabajo.costo numeric`;
  `proveedores.modo_de_carga text default 'parte_diario'`.

- [ ] **Step 1: Leer las ocho trampas**

Leer `supabase/migrations/README.md` antes de escribir una línea.

- [ ] **Step 2: Escribir las tres migraciones con `npm run migracion`**

Tres archivos separados a propósito: una columna en una tabla del núcleo
(`proveedores`) y una en `ordenes_trabajo` no tienen por qué caer con las tablas
nuevas, y una que falla no debe arrastrar a las otras.

`mant_cuadernos`: `id`, `proveedor_id` (fk `proveedores`, restrict),
`cargado_por` (fk `usuarios`, set null), `estado text not null default 'EN_CHEQUEO'`,
`created_at`.

`mant_cuadernos_fotos`: `id`, `cuaderno_id` (fk, cascade), `orden int not null`,
`ruta text not null` (el archivo en el bucket), `respuesta_cruda jsonb`,
`fallo text`, `created_at`. Comentario de columna en `respuesta_cruda`: es lo
que dijo el modelo, y es lo único que distingue «lo leyó mal» de «lo editó una
persona».

`mant_cuadernos_renglones`: `id`, `cuaderno_id` (fk, cascade), `foto_id` (fk,
set null), `linea int`, `fecha date`, `tarea text not null`,
`lugar_raw text`, `sector_id` (fk `sectores`, set null),
`sector_propuesto boolean not null default false`, `equipo_id` (fk `equipos`,
set null), `horas numeric`, `costo numeric`, `dudoso boolean not null default false`,
`motivo_dudoso text`, `heredado boolean not null default false`,
`grupo_id uuid`, `orden_trabajo_id` (fk `ordenes_trabajo`, set null),
`created_at`.

Índices: por `cuaderno_id`; por `grupo_id` donde no es null; por
`orden_trabajo_id` donde no es null.

RLS en las tres con la forma del módulo: select con
`((select public.mant_puede_ver()))`, all con
`((select public.mant_puede_editar()))` en using y check.

`ordenes_trabajo.costo numeric` con comentario: lo que se le pagó al
contratista por ese trabajo; **no lo suma `costoEquipo.ts`**, que saltea las OT
de contratista — se exporta dentro del texto de `REPUESTO UTILIZADO`.

`proveedores.modo_de_carga text not null default 'parte_diario'` con
comentario nombrando los dos valores y qué pantalla abre cada uno.

- [ ] **Step 3: Crear el bucket**

El bucket `cuaderno-contratista`, **privado**, `allowed_mime_types` =
`image/jpeg, image/jpg, image/png, image/webp, image/heic`, límite 10 MB. **Va
por SQL en la primera migración**, con un insert en `storage.buckets`: uno
creado a mano en el panel no queda en el repo y el próximo entorno no lo tiene.
Es como ya se hizo con el de las fotos de ejecución, que el comentario de
`app/api/mantenimiento/fotos/route.ts` atribuye a «la migración 006».
Privado a propósito: el cuaderno es un papel interno y nadie lo mira sin sesión,
al revés que la foto de un aviso.

- [ ] **Step 4: Pedirle al usuario que las corra y esperar**

Decirle las tres por nombre y que el resto de la tarea depende de eso. No seguir
hasta que confirme.

- [ ] **Step 5: Comprobar que quedaron aplicadas**

Leer el OpenAPI de PostgREST y confirmar que las tres tablas existen, que
`ordenes_trabajo` tiene `costo` y `proveedores` tiene `modo_de_carga`.

- [ ] **Step 6: Poner a PIPARO en modo cuaderno**

Es DML, así que puede hacerlo el agente por PostgREST:
`modo_de_carga = 'cuaderno'` donde `nombre = 'PIPARO'`
(id `6de3dfc5-b9ec-44a8-ad92-88a5b3f57fce`).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/<los tres archivos>
git commit -m "feat(mantenimiento): las tablas del cuaderno de contratista"
```

---

### Tarea 2: El idioma de Piparo

**Files:**
- Create: `lib/mantenimiento/cuadernoAbreviaturas.ts`
- Test: `lib/mantenimiento/cuadernoAbreviaturas.test.ts`

**Interfaces:**
- Consumes: `normalizarLugar()` de `lib/mantenimiento/partesDeContratista.ts`.
- Produces:
  - `codigoDeSector(texto: string): string | null`
  - `numeroDeCinta(texto: string): number | null`

- [ ] **Step 1: Escribir los tests**

`codigoDeSector` sobre los textos reales del cuaderno:

```ts
it("las tres plantas de trituracion", () => {
  expect(codigoDeSector("Colocar cartelería P/Trit N°1")).toBe("PO-A1");
  expect(codigoDeSector("Reparar rodillos 2/cinta 9 P/Trit N°3")).toBe("PO-A3");
  expect(codigoDeSector("P/TRT Nº2")).toBe("PO-A2");
  expect(codigoDeSector("p/ trit 1")).toBe("PO-A1");
});

it("los otros sectores que nombra el cuaderno", () => {
  expect(codigoDeSector("Limpieza techo Molino cal")).toBe("PO-D1");
  expect(codigoDeSector("Reparar cañería agua bomba Idratación")).toBe("PO-C1");
  expect(codigoDeSector("Limpieza techo Filer 02")).toBe("PY-B1");
  expect(codigoDeSector("limpieza techo filer 1")).toBe("PY-A1");
});

it("lo que no nombra un sector no inventa uno", () => {
  expect(codigoDeSector("Tranqueras D6")).toBeNull();
  expect(codigoDeSector("Hormigonar Dep 05")).toBeNull();
  expect(codigoDeSector("Clasificar manganeso")).toBeNull();
  expect(codigoDeSector("")).toBeNull();
});
```

`numeroDeCinta`:

```ts
it("saca el numero de la cinta", () => {
  expect(numeroDeCinta("Reparar rodillos 2/cinta 9 P/Trit N°3")).toBe(9);
  expect(numeroDeCinta("Trabajos en cinta 1 P/Trit N°1")).toBe(1);
  expect(numeroDeCinta("1 Empalme cinta (11) P/Trit N°3")).toBe(11);
});

it("no confunde otra cosa con una cinta", () => {
  expect(numeroDeCinta("Limpieza tolva de zaranda P/Trit N°3")).toBeNull();
  expect(numeroDeCinta("Reparar paño zaranda 5 P/Trit N°3")).toBeNull();
});
```

- [ ] **Step 2: Correrlos y verlos fallar**

Run: `npx vitest run lib/mantenimiento/cuadernoAbreviaturas.test.ts`
Expected: FAIL, las funciones no existen.

- [ ] **Step 3: Implementar las dos funciones**

En `lib/mantenimiento/cuadernoAbreviaturas.ts`. Las dos normalizan con
`normalizarLugar()` antes de mirar nada, así que los acentos y las mayúsculas
no entran en las expresiones. El mapa de sectores va en una constante con el
texto de Piparo a la izquierda y el código del catálogo a la derecha, con un
comentario por fila que diga de qué hoja salió.

**No adivinar**: lo que no coincide devuelve null. Es la regla de la casa —
enlazar al que se le parece pone las horas en el sector que no es y no se nota
nunca.

- [ ] **Step 4: Correrlos y verlos pasar**

Run: `npx vitest run lib/mantenimiento/cuadernoAbreviaturas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/cuadernoAbreviaturas.ts lib/mantenimiento/cuadernoAbreviaturas.test.ts
git commit -m "feat(mantenimiento): el idioma del cuaderno de Piparo"
```

---

### Tarea 3: De lo que dijo el modelo a un renglón

**Files:**
- Create: `lib/mantenimiento/cuadernoLectura.ts`
- Test: `lib/mantenimiento/cuadernoLectura.test.ts`

**Interfaces:**
- Produces:
  - `esquemaDeLaLectura` — el zod de lo que se le pide al modelo.
  - `RenglonLeido` — `{ fecha: string | null; tarea: string; lugar_raw: string;
    horas: number | null; costo: number | null; linea: number | null;
    heredado: boolean; en_llave: boolean; dudoso: boolean; motivo_dudoso: string | null }`.
    Los dos últimos son los que la pantalla filtra por «dudosos» y los que
    guarda la columna homónima de `mant_cuadernos_renglones`.
  - `normalizarRenglones(crudo: unknown, mes: string): { renglones: RenglonLeido[]; problemas: string[] }`
  - `PROMPT_DEL_CUADERNO: string`

- [ ] **Step 1: Escribir los tests**

Los cuatro de Review Focus viven acá. Con los valores de la hoja real:

```ts
it("un numero sin unidad son horas, y queda dudoso", () => {
  // «Tensar y alinear la misma = 4» — sin Hs y sin $.
  const { renglones } = normalizarRenglones(
    { renglones: [{ fecha: "2026-09-22", tarea: "Tensar y alinear la misma", valor: 4, unidad: null, linea: 11 }] },
    "2026-09"
  );
  expect(renglones[0].horas).toBe(4);
  expect(renglones[0].costo).toBeNull();
  expect(renglones[0].dudoso).toBe(true);
});

it("horas y costo a la vez entran los dos, marcados dudosos", () => { … expect(dudoso).toBe(true) });

it("una fecha imposible deja el renglon sin fecha y dudoso", () => {
  // "2026-13-45"
  expect(renglones[0].fecha).toBeNull();
  expect(renglones[0].dudoso).toBe(true);
});

it("el ano de dos digitos se resuelve con el mes de la carga", () => {
  // "21-09-26" con mes "2026-09" → "2026-09-21"
});

it("una respuesta que no es la lista esperada se denuncia entera", () => {
  const r = normalizarRenglones("no entendí la foto", "2026-09");
  expect(r.renglones).toHaveLength(0);
  expect(r.problemas[0]).toContain("no entendí la foto");
});

it("un renglon sin tarea no entra", () => { … });
it("las comillas que heredan vienen marcadas", () => { … expect(heredado).toBe(true) });

it("una llave deja las horas donde estan escritas y no las reparte", () => {
  // Los tres renglones del 22-09 con «} = 46 Hs».
  const { renglones } = normalizarRenglones({ renglones: [
    { fecha: "2026-09-22", tarea: "Trabajos en cinta 5 Reparación", valor: 46, unidad: "horas", en_llave: true, linea: 8 },
    { fecha: "2026-09-22", tarea: "Limpieza P/Trit N°1", valor: null, unidad: null, en_llave: true, linea: 9 },
    { fecha: "2026-09-22", tarea: "1 Parche metálico en descarga cono", valor: null, unidad: null, en_llave: true, linea: 10 },
  ] }, "2026-09");
  expect(renglones.map((r) => r.horas)).toEqual([46, null, null]);
  expect(renglones.every((r) => r.en_llave)).toBe(true);
  // Y no las marca dudosas: en una llave, el blanco es lo correcto.
  expect(renglones.map((r) => r.dudoso)).toEqual([false, false, false]);
});
```

- [ ] **Step 2: Correrlos y verlos fallar**

Run: `npx vitest run lib/mantenimiento/cuadernoLectura.test.ts`

- [ ] **Step 3: Implementar el esquema, el prompt y la normalización**

El esquema le pide al modelo **un valor y una unidad** (`"horas" | "pesos" | null`)
y no dos campos, porque el papel escribe un solo número y la unidad es lo que a
veces falta — pedir `horas` y `costo` por separado invita a que invente.

El prompt lleva la hoja de ejemplo del spec, dice que una página tiene varios
días, que las comillas heredan del renglón de arriba, que una llave es un total
para varios renglones, y que **no traduzca ni interprete lugares**: el texto va
como está escrito. Pide el número de línea.

La normalización es lo que decide: unidad `pesos` → `costo`; `horas` o null →
`horas`; null además marca dudoso. Fecha que no resuelve a un día real → null y
dudoso. Un error de validación del esquema devuelve `problemas` con **lo que
dijo el modelo sin traducir**, que es la regla de los fallos de Sheets aplicada
acá: un diagnóstico que no se distingue de otro no es un diagnóstico.

- [ ] **Step 4: Correrlos y verlos pasar**

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/cuadernoLectura.ts lib/mantenimiento/cuadernoLectura.test.ts
git commit -m "feat(mantenimiento): el contrato de lo que el modelo lee del cuaderno"
```

---

### Tarea 4: La foto entra y vuelve con renglones

**Files:**
- Create: `app/api/mantenimiento/cuaderno/fotos/route.ts`
- Create: `app/api/mantenimiento/cuaderno/route.ts`

**Interfaces:**
- Consumes: `normalizarRenglones`, `PROMPT_DEL_CUADERNO`, `esquemaDeLaLectura`
  (Tarea 3); `engancharRenglon` (Tarea 5) **se suma en la Tarea 5**, no acá.
- Produces: `POST /api/mantenimiento/cuaderno` → `{ id }`;
  `POST /api/mantenimiento/cuaderno/fotos` (multipart: `cuaderno_id`, `archivo`,
  `orden`, `mes`) → `{ foto_id, renglones, problemas }`.

- [ ] **Step 1: Escribir la ruta de la carga**

GET con el cliente de sesión (RLS filtra) y `traerTodo()`. POST crea la fila de
`mant_cuadernos` para el proveedor elegido. DELETE se niega si algún renglón
tiene `orden_trabajo_id`, con el mismo mensaje que el borrado del parte de
Candia.

- [ ] **Step 2: Escribir la ruta de la foto**

Sube el archivo al bucket privado con una ruta que lleve el cuaderno y el orden.
Después llama al modelo **una vez, con esa sola foto**, con
`generateObject` del AI SDK y `esquemaDeLaLectura`.

El modelo sale de `process.env.CUADERNO_MODELO ?? "anthropic/claude-sonnet-5"`,
con el comentario de por qué el default es el bueno — igual que `ASISTENTE_MODELO`.

Guarda `respuesta_cruda` **siempre**, haya salido bien o mal. Si falló, guarda
`fallo` con lo que dijo, sin traducir, y devuelve 200 con `problemas`: la foto
que falla no tira la carga, se reintenta sola.

- [ ] **Step 3: Probar la ruta contra una foto real**

No hay test automático de rutas en este repo. Se ejercita a mano: un script en
el scratchpad que llame a `normalizarRenglones` con lo que el modelo devolvió
para la hoja del 21/22-09, y comparar los renglones contra la transcripción del
spec. **Leer el modelo no alcanza: hay que correr la operación.**

- [ ] **Step 4: Commit**

```bash
git add app/api/mantenimiento/cuaderno/route.ts app/api/mantenimiento/cuaderno/fotos/route.ts
git commit -m "feat(mantenimiento): subir una foto del cuaderno y leerla"
```

---

### Tarea 5: El enganche a sector y equipo

**Files:**
- Create: `lib/mantenimiento/cuadernoEnganche.ts`
- Test: `lib/mantenimiento/cuadernoEnganche.test.ts`
- Modify: `app/api/mantenimiento/cuaderno/fotos/route.ts` — llamarlo al guardar.

**Interfaces:**
- Consumes: `codigoDeSector`, `numeroDeCinta` (Tarea 2); `normalizarLugar` y el
  tipo `LugarConocido` del cliente de Candia.
- Produces:
  - `engancharRenglon(texto, catalogo, sectores, equipos): { sector_id, equipo_id, sector_propuesto }`
  - donde `catalogo: Map<string, {sector_id, equipo_id}>`, `sectores:
    {id, codigo}[]`, `equipos: {id, code, name, sector_id}[]`.

- [ ] **Step 1: Escribir los tests**

```ts
it("el catalogo aprendido gana sobre el interprete", () => {
  // «Horno 4 Rastro» enseñado a Calcinación gana aunque el intérprete no lo conozca
});

it("el interprete resuelve sector y equipo juntos", () => {
  const r = engancharRenglon("Reparar rodillos 2/cinta 9 P/Trit N°3", vacio, sectores, equipos);
  expect(r.sector_id).toBe(TRITURACION_3);
  expect(r.equipo_id).toBe(CINTA_9_DE_TRITURACION_3);
  expect(r.sector_propuesto).toBe(false);
});

it("la cinta 9 de una planta no es la cinta 9 de otra", () => {
  // mismo número, distinto sector → distinto equipo
});

it("con equipo y sin sector, el sector sale del equipo y queda propuesto", () => {
  // «Tranqueras D6» → equipo D6 → sector Cantera.
  const r = engancharRenglon("Tranqueras D6", vacio, sectores, equipos);
  expect(r.sector_id).toBe(CANTERA);
  expect(r.equipo_id).toBe(D6);
  // Es una deduccion, no algo que el papel diga: quien carga tiene que verla.
  expect(r.sector_propuesto).toBe(true);
});

it("sin sector ni equipo no inventa nada", () => {
  const r = engancharRenglon("Hormigonar Dep 05", vacio, sectores, equipos);
  expect(r.sector_id).toBeNull();
  expect(r.equipo_id).toBeNull();
});

it("un sector que el catalogo no tiene no se enlaza al que se le parece", () => { … });
```

- [ ] **Step 2: Correrlos y verlos fallar**

- [ ] **Step 3: Implementar `engancharRenglon`**

El orden es el que manda y va escrito en el docstring: **catálogo aprendido →
intérprete → sector desde el equipo**. Lo aprendido pisa porque alguien ya
contestó esa pregunta mirando el papel.

El equipo se busca por `sector_id` **y** nombre «Cinta transportadora N», no
por nombre solo: hay 63 cintas y la 9 existe en varias plantas.

`sector_propuesto` queda en `true` **sólo cuando el sector salió del equipo**,
que es el único de los tres caminos que es una deducción y no algo que el papel
diga. El catálogo y el intérprete devuelven `false`: ahí el texto nombra el
sector.

**Y la pantalla no inventa ninguno.** Un renglón sin sector y sin equipo
—«Hormigonar Dep 05»— queda con `sector_id` en null y en rojo hasta que una
persona elija: no hay de dónde sacar una propuesta, y fabricarla sería enlazar
al que se le parece, que es la regla que gobierna todo el sistema. *(Ruling del
barrido previo, 01/11/2026: el spec pide tres escalones y sólo da fuente para
dos.)*

- [ ] **Step 4: Correrlos y verlos pasar**

- [ ] **Step 5: Llamarlo desde la ruta de la foto**

Al guardar cada renglón. El catálogo se lee una vez por foto, no por renglón.

- [ ] **Step 6: Commit**

```bash
git add lib/mantenimiento/cuadernoEnganche.ts lib/mantenimiento/cuadernoEnganche.test.ts app/api/mantenimiento/cuaderno/fotos/route.ts
git commit -m "feat(mantenimiento): enganchar sector y equipo del cuaderno"
```

---

### Tarea 6: Juntar, separar y agrupar

**Files:**
- Create: `lib/mantenimiento/cuadernoGrupos.ts`
- Test: `lib/mantenimiento/cuadernoGrupos.test.ts`
- Create: `app/api/mantenimiento/cuaderno/renglones/route.ts`

**Interfaces:**
- Produces:
  - `type RenglonDelCuaderno` — lo que la pantalla y la generación comparten.
  - `sePuedenJuntar(renglones): string[]` — los problemas, vacío si se puede.
  - `propuestaDeGrupos(renglones): Map<string, string[]>` — `grupo_id` sugerido
    por renglón, sólo para los **sin sector** que comparten tarea normalizada.
  - `enOrdenes(renglones): GrupoDeCuaderno[]` — lo que va a salir como OT.

- [ ] **Step 1: Escribir los tests**

```ts
it("dos renglones de sectores distintos no se juntan", () => {
  const p = sePuedenJuntar([enTrituracion1, enMolienda]);
  expect(p[0]).toContain("una orden de trabajo tiene un solo sector");
});   // ← Review Focus 5

it("un renglon ya convertido no se junta con nada", () => { … });

it("con sector, cada renglon es su propia OT", () => {
  expect(enOrdenes([a, b]).length).toBe(2);
});

it("sin sector, la propuesta junta los que son la misma tarea", () => {
  // «Tranqueras D6» del 17, 21 y 23 → un solo grupo
});

it("sin sector, dos tareas distintas no se juntan", () => { … });

it("un grupo juntado a mano suma las horas y toma el rango de fechas", () => {
  const [g] = enOrdenes([tranq17, tranq21, tranq23]);
  expect(g.horas).toBe(16);
  expect(g.desde).toBe("2026-09-17");
  expect(g.hasta).toBe("2026-09-23");
});

it("un renglon sin sector confirmado no sale en las ordenes", () => {
  expect(enOrdenes([sinSector])).toHaveLength(0);
});

it("un grupo que ya tiene una OT la trae en vez de pedir otra", () => { … });

it("dos OT distintas en el mismo grupo se denuncian y no se tocan", () => { … });
```

- [ ] **Step 2: Correrlos y verlos fallar**

- [ ] **Step 3: Implementar las tres funciones**

`enOrdenes` deja afuera, y lo dice en el docstring, los renglones **sin sector**
y los de **sector propuesto sin confirmar**: la generación de Candia no llama a
`loQueFaltaParaCrear` —comprobado el 01/11/2026—, así que esta negativa la tiene
que escribir este código y no se hereda de ningún lado.

- [ ] **Step 4: Correrlos y verlos pasar**

- [ ] **Step 5: Escribir la ruta de renglones**

PATCH edita un renglón (las seis columnas, y confirmar el sector propuesto).
POST `{ ids }` junta: corre `sePuedenJuntar` y, si pasa, escribe un `grupo_id`
nuevo en todos. DELETE `{ grupo_id }` separa: lo pone en null.

- [ ] **Step 6: Commit**

```bash
git add lib/mantenimiento/cuadernoGrupos.ts lib/mantenimiento/cuadernoGrupos.test.ts app/api/mantenimiento/cuaderno/renglones/route.ts
git commit -m "feat(mantenimiento): juntar y separar renglones del cuaderno"
```

---

### Tarea 7: La pantalla

**Files:**
- Create: `app/(app)/mantenimiento/partes-contratista/CuadernoClient.tsx`
- Modify: `app/(app)/mantenimiento/partes-contratista/page.tsx`
- Modify: `app/(app)/mantenimiento/partes-contratista/PartesContratistaClient.tsx`

**Interfaces:**
- Consumes: las cuatro rutas y `propuestaDeGrupos`.

- [ ] **Step 1: Traer `modo_de_carga` y ramificar**

`page.tsx` agrega `modo_de_carga` al select de proveedores. `PartesContratistaClient`
muestra `CuadernoClient` cuando el proveedor elegido lo tiene en `cuaderno`, y
lo que ya hay cuando no. El desplegable de contratista **no se mueve**: es el
que decide.

- [ ] **Step 2: La pantalla de chequeo, forma A**

Foto fija a la izquierda (`sticky`), renglones a la derecha, filtros arriba:
todos / sin sector / con costo / dudosos / ya juntados. Las seis columnas
editables. El renglón en el que estás parado dice de qué foto y qué línea salió.

**La pantalla no propone sectores**: el renglón sin sector muestra el
desplegable vacío y en rojo. Lo que sí marca distinto es el **sector deducido
del equipo** (`sector_propuesto`), que se ve como propuesta y pide confirmarse
con un clic — es una deducción del catálogo, no algo que el papel diga.

Responsive: la grilla de los renglones lleva breakpoint y la foto se va arriba
en el teléfono, no al lado. El ancho de los campos de horas y costo va en un
`div` que los envuelva.

- [ ] **Step 3: Los botones de juntar y separar**

Con la vista previa de lo que quedaría: «Tranqueras D6 · 16 h · del 17/9 al
23/9». Los problemas de `sePuedenJuntar` se muestran todos juntos.

- [ ] **Step 4: El aviso de fecha ya cargada**

Al terminar de leer las fotos, la pantalla dice qué días ya tienen renglones de
ese contratista y deja elegir: reemplazar los de ese día, o dejar los dos.
**Se niega a reemplazar si alguno de esos renglones ya tiene `orden_trabajo_id`**,
con el porqué.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && node scripts/revisar-responsive.mjs && npm run build`
Expected: tsc limpio, `ROMPE 0 · APRETADO 0`, build ok.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/mantenimiento/partes-contratista/CuadernoClient.tsx" "app/(app)/mantenimiento/partes-contratista/page.tsx" "app/(app)/mantenimiento/partes-contratista/PartesContratistaClient.tsx"
git commit -m "feat(mantenimiento): la pantalla del cuaderno de Piparo"
```

---

### Tarea 8: Generar las OT, con el costo en la planilla

**Files:**
- Create: `lib/mantenimiento/costoEnRepuesto.ts`
- Test: `lib/mantenimiento/costoEnRepuesto.test.ts`
- Create: `app/api/mantenimiento/cuaderno/generar/route.ts`
- Modify: `scripts/revisar-exportaciones.mjs`

**Interfaces:**
- Consumes: `enOrdenes` (Tarea 6); `altaEnLaPlanilla` y el patrón de
  `crearLaOT` / `actualizarLaOT` de
  `app/api/mantenimiento/partes-contratista/generar/route.ts`.
- Produces: `textoDeRepuesto(costo: number | null, repuesto: string | null): string | null`

- [ ] **Step 1: Escribir los tests de `textoDeRepuesto`**

```ts
it("el monto se escribe como ya se escribe a mano", () => {
  expect(textoDeRepuesto(920000, null)).toBe("$920.000");
});

it("si ya hay un repuesto, el monto se suma y no lo pisa", () => {
  expect(textoDeRepuesto(240000, "2 parches de 200"))
    .toBe("2 parches de 200 ($240.000)");
});

it("sin costo devuelve lo que habia", () => {
  expect(textoDeRepuesto(null, "Paño de zaranda")).toBe("Paño de zaranda");
  expect(textoDeRepuesto(null, null)).toBeNull();
});
```

- [ ] **Step 2: Correrlos y verlos fallar**

- [ ] **Step 3: Implementar `textoDeRepuesto`**

El formato sale de lo medido el 01/11/2026 sobre las 58 OT que ya lo llevan:
`"$190,000"`, `"Empalme ($680000)"`, `"2 parches de 200 (vulcanizado $240000)"`.
Se elige el separador de miles con punto, que es el castellano.

- [ ] **Step 4: Correrlos y verlos pasar**

- [ ] **Step 5: Escribir la ruta de generación**

Copia la forma de la de Candia: vista previa con `?simular`, `TOPE_POR_CORRIDA = 25`,
y los tres caminos (crear / sumar a la que existe / denunciar dos órdenes para
el mismo grupo).

Los valores de la OT, **medidos**: `MECÁNICO` / `PROGRAMADO` / `CONTRATADO` /
`REALIZADO`. `fecha` y `fecha_cierre` = el último día del grupo. `horas` = las
del grupo; `costo` = el del grupo; `repuesto` = `textoDeRepuesto(...)`.

**El costo se exporta**: va en el campo `repuesto` del alta en la planilla,
que ya viaja. Sin eso, la plata queda sólo en la base y la planilla —que es de
donde lee quien no entra al sistema— no la muestra.

- [ ] **Step 6: Declarar la ruta en `revisar-exportaciones.mjs`**

Estrategia `cola`, como las otras que escriben en la planilla de OT.

- [ ] **Step 7: Verificar**

Run: `npm test && npx tsc --noEmit && node scripts/revisar-exportaciones.mjs && npm run build`
Expected: todo verde; `ROMPE 0`.

- [ ] **Step 8: Commit**

```bash
git add lib/mantenimiento/costoEnRepuesto.ts lib/mantenimiento/costoEnRepuesto.test.ts app/api/mantenimiento/cuaderno/generar/route.ts scripts/revisar-exportaciones.mjs
git commit -m "feat(mantenimiento): generar las OT del cuaderno, con el costo a la planilla"
```

---

### Tarea 9: Dejarlo documentado y comprobado de punta a punta

**Files:**
- Modify: `CLAUDE.md` — una fila en la tabla de Mantenimiento.
- Modify: `docs/MANTENIMIENTO-INTEGRACION.md` — la sección del cuaderno.

- [ ] **Step 1: Ejercitar la carga de verdad**

Con una de las diez fotos reales, de punta a punta: subir, leer, chequear,
vista previa. **No generar sobre septiembre** — ya tiene 29 OT cargadas a mano y
se duplicarían. Usar un mes sin cargar, o no generar y quedarse en la vista
previa.

- [ ] **Step 2: Escribir lo que no se deduce del código**

En `CLAUDE.md`, la fila del cuaderno con los tres hechos que cuestan caro: que
el modo lo decide `proveedores.modo_de_carga`; que el costo **no** lo suma
`costoEquipo.ts` y vive además dentro del texto de `repuesto`; y que septiembre
de 2026 ya está cargado a mano.

- [ ] **Step 3: Verificación final**

Run: `npm test && npx tsc --noEmit && npm run build && node scripts/revisar-responsive.mjs && node scripts/revisar-exportaciones.mjs && node scripts/revisar-arbol-commiteado.mjs HEAD`

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/MANTENIMIENTO-INTEGRACION.md
git commit -m "docs(mantenimiento): el cuaderno de Piparo y sus tres trampas"
```

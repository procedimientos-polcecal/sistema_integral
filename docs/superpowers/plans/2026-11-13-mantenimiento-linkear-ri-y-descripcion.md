# Linkear un RI a mano y la descripción del pañol — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que desde el repuesto de una OT se pueda pegar el número de un RI y
elegir el artículo del pañol, y que cada OT abierta lea cuántas de las que pidió
están cubiertas por lo que viene y cuántas falta pedir.

**Architecture:** Un dato nuevo —el número del RI pegado a un artículo o a un
renglón— y **una cuenta que no se guarda**: el reparto se calcula en TypeScript
a partir de los RI pegados y de las OT abiertas, como ya hace «pregunta
abierta». La lógica vive en funciones puras de `lib/mantenimiento/`; las rutas
sólo leen, validan y escriben.

**Tech Stack:** Next.js 16 App Router, Supabase/PostgREST, vitest, zod.

**Spec:** [docs/superpowers/specs/2026-11-13-mantenimiento-linkear-ri-y-descripcion-design.md](../specs/2026-11-13-mantenimiento-linkear-ri-y-descripcion-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, textos de pantalla y de commit.
- **La migración la aplica una persona** en el editor SQL de Supabase. La Tarea 2
  termina entregándola y **la 4 y la 5 no pueden empezar hasta que esté
  aplicada**.
- **PostgREST corta en 1.000 filas sin avisar**: `traerTodo()` de
  `lib/core/paginado.ts` en cualquier lectura que pueda crecer. Un `.in()` va de
  a lotes de **200**.
- Un `select()` va **literal**, nunca armado en una variable.
- Una policy nueva llama a su función **envuelta**: `using ((select mant_puede_ver()))`.
- Un desplegable se escribe **`<Select>`** (`components/Select.tsx`), nunca `<select>`.
- Una grilla de tres columnas lleva breakpoint: `grid-cols-1 sm:grid-cols-3`.
- Un ancho al lado de `.input` no mide: va en un `div` que envuelva al campo.
- Un cuerpo que entra se valida con `validar()`/`errorDeValidacion()` de
  `lib/core/validar.ts`.

## Review Focus

Entradas que el diseño implica y que ninguna tarea ejercitaría sola. Cada una
tiene su test en la tarea que es dueña del código.

1. **Pegar dos veces el mismo RI al mismo destino** — el botón se aprieta dos
   veces y no tiene que quedar duplicado ni contar doble. (Tarea 2: `unique`;
   Tarea 4: el 409 y que no inserte.)
2. **Un `nro_ri` que no existe** en `compras_requerimientos` — se tipea a mano,
   así que va a pasar. No se pega y se dice por qué. (Tarea 4.)
3. **Un RI ya recibido entero** (`cantidad_recibida >= cantidad`) — aporta
   **cero** a lo que viene, o se cuenta dos veces: una como stock y otra como
   en camino. (Tarea 3.)
4. **Una OT sin `fecha`** — la columna es nullable y el orden por antigüedad la
   usa. Una fila sin fecha no puede quedar primera por accidente. (Tarea 3.)
5. **Más de 200 OT abiertas pidiendo el mismo artículo** — el `.in()` las
   rechaza con un 400 que no dice por qué. (Tarea 4, con el Supabase de mentira
   que ya castiga esa trampa.)

---

## File Structure

| Archivo | De qué es responsable |
|---|---|
| `lib/mantenimiento/stock.ts` *(modificar)* | Reconocer el artículo del pañol. Se le arregla la normalización. |
| `supabase/migrations/<ts>_ri_de_repuesto.sql` *(crear)* | `mant_ri_de_repuesto` y `ordenes_trabajo_repuestos.articulo_id`. |
| `lib/mantenimiento/loQueViene.ts` *(crear)* | La cuenta: cuánto trae un RI, cómo se reparte, qué lee cada OT. Puro. |
| `app/api/mantenimiento/repuestos/[id]/articulo/route.ts` *(crear)* | Elegir o soltar el artículo de un renglón. |
| `app/api/mantenimiento/repuestos/[id]/ri/route.ts` *(crear)* | Pegar y sacar un RI. |
| `app/(app)/mantenimiento/ordenes/RepuestosOTModal.tsx` *(modificar)* | Dónde se pega, dónde se elige, qué se lee. |

---

### Task 1: El cruce deja de perder lo que sí está en el pañol

**Files:**
- Modify: `lib/mantenimiento/stock.ts` (la normalización dentro de `buscarEnInventario`)
- Test: `lib/mantenimiento/stock.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `buscarEnInventario` con la misma firma de hoy. Sin cambios de tipo.

Medido el 13/11/2026: la OT dice `Niple galvanizado ø 3 " x 300 mm` y el pañol
tiene `01221 NIPLE GALVANIZADO 3" X 300MM`. `normalizar` deja pasar el `ø`, el
espacio antes de la comilla y el de `300 mm`, así que el `includes` falla.

**Cuidado, y es la razón por la que esta tarea va primera y sola:** el arreglo
gemelo de `riDelRepuesto.ts` del 12/11/2026 enseñó que tocar sólo lo obvio
cambia un falso negativo por falsos positivos. **Hay que medir las dos
direcciones.**

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// Los dos casos medidos contra producción.
it("reconoce el niple aunque la OT escriba el diámetro con ø y espacios", () => {
  const inv = [{ codigo: "01221", descripcion: 'NIPLE GALVANIZADO 3" X 300MM', stock: 5, seguridad: 1, ubicacion: null }];
  const [d] = buscarEnInventario([{ codigo: null, nombre: 'Niple galvanizado ø 3 " x 300 mm', cantidad: null }], inv);
  expect(d.insumo?.codigo).toBe("01221");
});

it("reconoce la tapa con el mismo ø", () => {
  const inv = [{ codigo: "01220", descripcion: 'TAPA GALVANIZADA 3"', stock: 2, seguridad: 1, ubicacion: null }];
  const [d] = buscarEnInventario([{ codigo: null, nombre: 'Tapa galvanizada ø 3"', cantidad: null }], inv);
  expect(d.insumo?.codigo).toBe("01220");
});

// La otra dirección: aflojar no puede juntar medidas distintas.
it("sigue sin confundir dos medidas que sólo difieren en el número", () => {
  const inv = [{ codigo: "01222", descripcion: 'NIPLE GALVANIZADO 3" X 200MM', stock: 5, seguridad: 1, ubicacion: null }];
  const [d] = buscarEnInventario([{ codigo: null, nombre: 'Niple galvanizado ø 3 " x 300 mm', cantidad: null }], inv);
  expect(d.insumo).toBeNull();
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/mantenimiento/stock.test.ts -t "niple"`
Expected: FAIL — hoy `insumo` es `null` en los dos primeros.

- [ ] **Step 3: Arreglar la normalización en `lib/mantenimiento/stock.ts`**

Una función local —no exportada— que se aplique a los dos lados de la
comparación: saca `ø`/`Ø`, saca los espacios que rodean a `"`, y pega el número
con su unidad (`300 mm` → `300mm`). **No toca `normalizar` de `planilla.ts`**,
que la usan otros módulos.

- [ ] **Step 4: Correr el archivo entero**

Run: `npx vitest run lib/mantenimiento/stock.test.ts`
Expected: PASS, los de antes incluidos.

- [ ] **Step 5: Medir contra producción las dos direcciones**

Run: `npx tsx scripts/medir-cruce-de-repuestos.mts --todas`
Expected: reconocidos **sube de 7**; y hay que **leer la lista de los que deja
de reconocer**: si alguno de los 7 de hoy se cayó, el arreglo está de más.
Anotar los dos números en el mensaje del commit.

- [ ] **Step 6: Commit**

```bash
git add lib/mantenimiento/stock.ts lib/mantenimiento/stock.test.ts
git commit -F <mensaje con los dos números medidos>
```

---

### Task 2: La migración (termina a la espera de una persona)

**Files:**
- Create: `supabase/migrations/<marca de tiempo>_ri_de_repuesto.sql`

**Interfaces:**
- Produces: la tabla `mant_ri_de_repuesto` y la columna
  `ordenes_trabajo_repuestos.articulo_id`, que consumen las tareas 3, 4 y 5.

- [ ] **Step 1: Crear el archivo con `npm run migracion "ri de repuesto"`**

Lleva marca de tiempo y no contador, porque dos sesiones toman el mismo número.

- [ ] **Step 2: Escribir el DDL**

- `alter table public.ordenes_trabajo_repuestos add column articulo_id uuid references public.inventario_articulos(id) on delete set null;`
- `create table public.mant_ri_de_repuesto` con: `id uuid default gen_random_uuid() primary key`, `nro_ri integer not null`, `articulo_id uuid references public.inventario_articulos(id) on delete cascade`, `repuesto_id uuid references public.ordenes_trabajo_repuestos(id) on delete cascade`, `creado_por uuid references public.usuarios(id)`, `creado_en timestamptz not null default now()`.
- **Un `check` de que haya exactamente un destino**: `check (num_nonnulls(articulo_id, repuesto_id) = 1)`.
- **Dos índices únicos parciales** —uno por destino— para que pegar dos veces el
  mismo RI al mismo lugar no duplique: `(nro_ri, articulo_id) where articulo_id is not null` y `(nro_ri, repuesto_id) where repuesto_id is not null`.
  **Un índice parcial no sirve como destino de `ON CONFLICT`**, así que la ruta
  atrapa el `23505` en vez de usar `upsert` — está en la Tarea 4.
- RLS: `select` para quien tiene Mantenimiento, `insert`/`delete` para quien
  puede editar, **con las funciones envueltas en `(select …)`**.
- El encabezado del archivo explica **por qué el destino es uno de dos** y por
  qué el borrado va en cascada de los dos lados.

- [ ] **Step 3: Commit y entregar**

```bash
git add supabase/migrations/<archivo>.sql
git commit -m "feat(mantenimiento): la migracion del RI pegado a un repuesto"
```

**Parar acá y decirle al usuario que la corra.** Las tareas 4 y 5 fallan sin
ella; la 3 es pura y puede seguir.

---

### Task 3: La cuenta de lo que viene

**Files:**
- Create: `lib/mantenimiento/loQueViene.ts`
- Test: `lib/mantenimiento/loQueViene.test.ts`

**Interfaces:**
- Consumes: nada de las otras tareas. Recibe datos planos.
- Produces:
  - `export interface RiPegado { nro_ri: number; cantidad: number | null; cantidad_recibida: number | null; estado_compra: string | null; estado_aprobacion: string | null }`
  - `export interface OrdenQuePide { orden_id: string; ot_number: number | null; fecha: string | null; pide: number | null }`
  - `export interface ParteDeLaOrden { orden_id: string; pide: number | null; cubiertas: number; faltaPedir: number }`
  - `export function loQueTraeUnRi(ri: RiPegado): number`
  - `export function repartir(ris: RiPegado[], ordenes: OrdenQuePide[]): ParteDeLaOrden[]`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("loQueTraeUnRi", () => {
  it("resta lo que ya llegó: lo recibido está en el pañol, no en camino", () => {
    expect(loQueTraeUnRi({ nro_ri: 1, cantidad: 100, cantidad_recibida: 40, estado_compra: "PEDIDO", estado_aprobacion: null })).toBe(60);
  });
  it("un RI recibido entero no trae nada", () => {
    expect(loQueTraeUnRi({ nro_ri: 1, cantidad: 100, cantidad_recibida: 100, estado_compra: "RECIBIDO", estado_aprobacion: null })).toBe(0);
  });
  it("sin cantidad legible no trae nada, en vez de inventar", () => {
    expect(loQueTraeUnRi({ nro_ri: 1, cantidad: null, cantidad_recibida: null, estado_compra: "PEDIDO", estado_aprobacion: null })).toBe(0);
  });
  it("un RI denegado no trae nada", () => {
    expect(loQueTraeUnRi({ nro_ri: 1, cantidad: 50, cantidad_recibida: null, estado_compra: null, estado_aprobacion: "DENEGADA" })).toBe(0);
  });
});

describe("repartir", () => {
  const ri = { nro_ri: 2230, cantidad: 100, cantidad_recibida: null, estado_compra: "PEDIDO", estado_aprobacion: null };

  it("la más vieja primero, y la siguiente lee lo que queda", () => {
    const r = repartir([ri], [
      { orden_id: "b", ot_number: 2971, fecha: "2026-10-27", pide: 50 },
      { orden_id: "a", ot_number: 2970, fecha: "2026-10-26", pide: 80 },
    ]);
    expect(r).toEqual([
      { orden_id: "a", pide: 80, cubiertas: 80, faltaPedir: 0 },
      { orden_id: "b", pide: 50, cubiertas: 20, faltaPedir: 30 },
    ]);
  });

  it("con la misma fecha desempata el número de OT, que es el unico que no se reescribe solo", () => {
    const r = repartir([{ ...ri, cantidad: 10 }], [
      { orden_id: "z", ot_number: 2898, fecha: "2026-10-26", pide: 10 },
      { orden_id: "x", ot_number: 2896, fecha: "2026-10-26", pide: 10 },
    ]);
    expect(r[0].orden_id).toBe("x");
    expect(r[1].cubiertas).toBe(0);
  });

  it("una orden sin fecha va al final y no primera por accidente", () => {
    const r = repartir([{ ...ri, cantidad: 10 }], [
      { orden_id: "sin", ot_number: 1, fecha: null, pide: 10 },
      { orden_id: "con", ot_number: 9999, fecha: "2026-10-26", pide: 10 },
    ]);
    expect(r[0].orden_id).toBe("con");
  });

  it("suma lo que traen varios RI pegados", () => {
    const r = repartir([{ ...ri, cantidad: 60 }, { ...ri, nro_ri: 2231, cantidad: 60 }], [
      { orden_id: "a", ot_number: 1, fecha: "2026-10-26", pide: 100 },
    ]);
    expect(r[0].cubiertas).toBe(100);
  });

  it("sin cantidad legible la orden no dice cubiertas ni faltantes", () => {
    const r = repartir([ri], [{ orden_id: "a", ot_number: 1, fecha: "2026-10-26", pide: null }]);
    expect(r[0]).toEqual({ orden_id: "a", pide: null, cubiertas: 0, faltaPedir: 0 });
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/loQueViene.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Escribir `lib/mantenimiento/loQueViene.ts`**

El encabezado explica **las decisiones del diseño que el código no delata**: que
el stock del pañol no descuenta (Compras repone cuando se usa), que lo que viene
es lo pedido menos lo recibido, y que el desempate es el número de OT. Reusa
`estaEnVuelo` de `riDelRepuesto.ts` para descartar denegados y recibidos.

**Y dice dónde termina su responsabilidad, porque es la mitad que no puede
probar:** `repartir` reparte lo que le dan. Que lo que le den sean **sólo los RI
pegados a mano** —y nunca los que el cruce adivina por nombre— y **sólo las OT
abiertas** lo decide quien la llama, y se prueba en la Tarea 4. Las dos reglas
salen del anti-objetivo: un falso positivo del cruce, o una orden ya hecha
reclamando, hacen que otra lea «cubierta» por algo que no es suyo.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/loQueViene.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/loQueViene.ts lib/mantenimiento/loQueViene.test.ts
git commit -m "feat(mantenimiento): la cuenta de lo que viene, que no se guarda"
```

---

### Task 4: Las dos rutas

**Files:**
- Create: `app/api/mantenimiento/repuestos/[id]/articulo/route.ts` (PUT, DELETE)
- Create: `app/api/mantenimiento/repuestos/[id]/ri/route.ts` (POST, DELETE)
- Test: `lib/mantenimiento/rutaDeRiDeRepuesto.test.ts`

**Interfaces:**
- Consumes: `mant_ri_de_repuesto` y `articulo_id` (Tarea 2).
- Produces: las dos rutas que consume la pantalla (Tarea 5).

**No puede empezar sin la migración aplicada.**

El test de ruta existe por el **cableado**, que es la única vara de la casa para
tenerlo: que un RI que no existe no se pegue, que pegarlo dos veces no duplique,
y que un `.in()` de más de 200 no se arme. Usa `lib/core/supabaseDeMentira.ts`,
que ya castiga las dos trampas de PostgREST.

- [ ] **Step 1: Escribir el test que falla**

```ts
it("no pega un RI que no existe, y no inserta nada", async () => { /* 404 y estado.inserts vacío */ });
it("pegar dos veces el mismo RI al mismo destino no duplica", async () => { /* 409 traducido del 23505, una sola fila */ });
it("elige el artículo del renglón y escribe articulo_id", async () => { /* la fila queda con el id */ });
it("soltar el artículo lo deja en null y no borra el renglón", async () => {});
it("con más de 200 órdenes pidiendo lo mismo, pide de a lotes", async () => { /* el fake rechaza un .in() de 201 */ });

// Las dos reglas que `repartir` no puede proteger: salen del anti-objetivo y
// viven acá, que es donde se arma lo que ella recibe.
it("una OT realizada no entra en el reparto", async () => { /* una REALIZADA que pide lo mismo no se cuenta */ });
it("un RI que sólo encontró el cruce por nombre no entra en la cuenta", async () => { /* se sigue mostrando «ya pedido», pero cubiertas no lo suma */ });
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/mantenimiento/rutaDeRiDeRepuesto.test.ts`
Expected: FAIL

- [ ] **Step 3: Escribir las dos rutas**

Cuerpo validado con `validar()`. El `nro_ri` se comprueba contra
`compras_requerimientos` antes de pegar. El `23505` del índice único se traduce
a **409**, como el `23503` de las notas. El destino sale de la fila: si tiene
`articulo_id`, el link va al artículo; si no, al renglón.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/rutaDeRiDeRepuesto.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/mantenimiento/repuestos/[id]/articulo/route.ts" "app/api/mantenimiento/repuestos/[id]/ri/route.ts" lib/mantenimiento/rutaDeRiDeRepuesto.test.ts
git commit -m "feat(mantenimiento): pegar un RI y elegir el articulo del panol"
```

---

### Task 5: La pantalla

**Files:**
- Modify: `app/(app)/mantenimiento/ordenes/RepuestosOTModal.tsx`

**Interfaces:**
- Consumes: las dos rutas (Tarea 4) y `repartir` (Tarea 3).

**No puede empezar sin la migración aplicada.**

- [ ] **Step 1: Pegar un RI**

Un campo de número con su botón, en el renglón del repuesto. El ancho va en un
`div` que envuelva al campo, no al lado de `.input`. Un fallo se muestra con lo
que dijo el servidor, sin traducir.

- [ ] **Step 2: Elegir el artículo del pañol**

Con **`<Select>`** y no `<select>`: el pañol tiene 1.206 artículos activos, así
que el buscador no es opcional. Al elegirlo, **la descripción del pedido cambia
sola**; cuando el artículo lo reconoció el cruce, se **ofrece** y la persona
acepta.

- [ ] **Step 3: La cuenta y la marca**

Debajo del repuesto: cuántas están cubiertas y cuántas falta pedir. **Cuando hay
más de un RI pegado se dice**, que es lo que el usuario pidió que no fuera mudo.
Lo que el cruce adivina por nombre se sigue mostrando como hoy, **separado de la
cuenta**.

- [ ] **Step 4: Verificar**

Run: `node scripts/revisar-responsive.mjs`
Expected: ROMPE 0 · APRETADO 0

- [ ] **Step 5: Commit**

---

### Task 6: La documentación

**Files:**
- Modify: `CLAUDE.md` (una fila en la tabla de Mantenimiento)
- Modify: `docs/MANTENIMIENTO-INTEGRACION.md` (una sección)

- [ ] **Step 1: La sección del documento**

Lo que no se deduce del código: que el reparto **no se guarda**; que el link es
global cuando hay artículo y de ese renglón cuando no; que el stock no
descuenta; que la cuenta **no mira** lo que el cruce adivina por nombre; y el
desempate por número de OT con su medición (2896/2897/2898, misma fecha).

- [ ] **Step 2: La fila de `CLAUDE.md`** con el enlace al spec y a este plan.

- [ ] **Step 3: Commit**

---

## Al terminar

- [ ] `npm test`, `npx tsc --noEmit`, `npm run build`
- [ ] `node scripts/revisar-arbol-commiteado.mjs`
- [ ] `node scripts/revisar-responsive.mjs`
- [ ] `node scripts/revisar-exportaciones.mjs` — **ninguna de las rutas nuevas
      escribe una planilla**, así que no deberían aparecer; si aparecen, hay que
      contestar la pregunta.
- [ ] Volver a correr `npx tsx scripts/medir-cruce-de-repuestos.mts --todas` y
      dejar el número final anotado.
- [ ] **Decidir dónde vive esto**: el PR #3 es otra cosa, así que este trabajo
      va en su propia rama.

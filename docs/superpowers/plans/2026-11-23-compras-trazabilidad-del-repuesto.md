# La trazabilidad del repuesto — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la ficha de un RI diga para qué OT se pidió el material y contra
qué orden se aplicó lo que salió del pañol.

**Architecture:** dos mitades independientes. **A** — el requerimiento guarda de
qué OT y de qué renglón de repuesto nació, escrito por la misma ruta que lo crea.
**B** — el renglón de repuesto de una OT guarda de qué salida del pañol salió,
declarado por Mantenimiento desde el modal que ya usa; Compras sólo lo lee. No se
agrega ninguna columna a `inventario_movimientos`.

**Tech Stack:** Next.js 16 App Router, Supabase/PostgREST, vitest sobre funciones
puras, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-11-23-compras-trazabilidad-del-repuesto-design.md](../specs/2026-11-23-compras-trazabilidad-del-repuesto-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- Las migraciones **las corre una persona** en el editor SQL de Supabase. Ninguna
  tarea que nombre una columna nueva en un `select()` o en un `insert()` se
  despliega antes de que su SQL esté aplicado.
- **Nunca `git add -A`**: sólo los archivos de la tarea, por nombre.
- Un desplegable se escribe `<Select>` (de `components/Select.tsx`), no `<select>`.
- Una grilla de tres o más columnas lleva breakpoint (`grid-cols-1 sm:grid-cols-3`).
- `className="input w-20"` no mide 20: el ancho va en un `div` que envuelva al campo.
- **No se infiere ninguna OT ni ningún artículo por parecido de nombre.** Sin
  enlace explícito, null y se informa.
- La ventana de candidatas es de **90 días** y el tope de **10** filas.
- El mismo día **cuenta** como salida candidata (`>=`, no `>`).
- Frases de pantalla fijadas por el spec, literales: **«Se pidió para»**,
  **«Entró al pañol»**, **«Salió del pañol»**, **«aplicado a la OT»**,
  **«sin justificar»**.
- Las policies nuevas llaman a su función **envuelta**: `using ((select
  mant_puede_ver()))`, nunca pelada.

## Review Focus

Lo que el spec implica y ninguna tarea ejercitaría si no se dijera acá. Cada
línea tiene su test puesto en la tarea que es dueña del código.

1. **Una OT borrada deja `ot_id` en null** y la ficha no puede mostrar «Se pidió
   para» vacío ni romperse — Tarea 5.
2. **Un renglón al que le sacan el `articulo_id` después de declarar la salida**
   queda apuntando a una pieza que ya no declara: tiene que avisar, no decir
   «aplicado» — Tarea 7.
3. **Un artículo con cientos de salidas** (el máximo medido es 454) no puede
   romper ni la lista de la OT ni la de la ficha — Tarea 7.
4. **Dos renglones de dos OT distintas apuntando a la misma salida** está
   permitido —una entrega puede cubrir dos órdenes— y la ficha nombra a las dos
   — Tarea 10.
5. **Un movimiento que no es una salida** (`entrada` o `ajuste`) no se puede
   declarar como la salida de un repuesto — Tarea 8.

---

## File Structure

**Parte A**

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<ts>_compras_el_pedido_recuerda_su_ot.sql` | las dos columnas en `compras_requerimientos` |
| `lib/compras/fusionDeLaPlanilla.ts` | conservar el origen cuando la planilla no lo trae |
| `lib/mantenimiento/pedirRepuesto.ts` | que el pedido sugerido lleve la OT y el renglón |
| `app/(app)/compras/requerimientos/NuevoRequerimientoModal.tsx` | pasarlos al POST |
| `app/api/compras/requerimientos/route.ts` | validarlos y guardarlos |
| `app/(app)/compras/requerimientos/[id]/page.tsx` + `RequerimientoDetalle.tsx` | la línea «Se pidió para» |

**Parte B**

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<ts>_mant_el_repuesto_dice_de_que_salida_salio.sql` | las tres columnas en `ordenes_trabajo_repuestos` |
| `lib/inventario/salidasDelRepuesto.ts` (+ test) | **todo lo puro**: qué salidas son candidatas y qué dice un vínculo |
| `app/api/mantenimiento/repuestos/[id]/movimiento/route.ts` | GET candidatas · PATCH declarar · DELETE soltar |
| `app/(app)/mantenimiento/ordenes/RepuestosOTModal.tsx` | la línea «Salió del pañol» por renglón |
| `app/(app)/compras/requerimientos/[id]/page.tsx` + `RequerimientoDetalle.tsx` | la sección Trazabilidad completa |

`lib/inventario/salidasDelRepuesto.ts` vive en Inventario y no en Compras ni en
Mantenimiento **porque la miran los tres**: el selector de la OT y la lista de la
ficha del RI son la misma función desde lados opuestos, y los movimientos son de
Inventario.

---

## Parte A — el pedido recuerda de qué OT nació

### Task 1: La migración de Compras

**Files:**
- Create: `supabase/migrations/<ts>_compras_el_pedido_recuerda_su_ot.sql` (el nombre lo da `npm run migracion "compras el pedido recuerda su ot"`)

**Interfaces:**
- Produces: `compras_requerimientos.ot_id`, `compras_requerimientos.ot_repuesto_id`.

- [ ] **Step 1: Escribir la migración**

Dos columnas, las dos nullables y con `if not exists`:

```sql
alter table public.compras_requerimientos
  add column if not exists ot_id uuid
  references public.ordenes_trabajo(id) on delete set null;

alter table public.compras_requerimientos
  add column if not exists ot_repuesto_id uuid
  references public.ordenes_trabajo_repuestos(id) on delete set null;
```

Más un índice parcial `where ot_id is not null` sobre `ot_id`, para poder
preguntar «qué pidió esta OT» sin recorrer 2.350 filas.

- [ ] **Step 2: Escribir el encabezado, que es la mitad del archivo**

Tiene que contestar, con los números del spec: por qué el origen va acá y no en
`mant_ri_de_repuesto` (esa tabla pega el RI **al artículo** cuando el renglón
tiene uno, así que de ella no sale de qué OT nació el pedido); por qué
`on delete set null` y no cascada (Mantenimiento borra OT desde el espejo y eso
no puede llevarse un requerimiento); y que **el índice parcial no sirve de
destino de un `ON CONFLICT`** — acá no se usa para eso, y se dice para que nadie
lo intente.

- [ ] **Step 3: Verificar que se puede correr dos veces**

Leerla entera y confirmar que todo va con `if not exists`. No se ejecuta desde
acá: es DDL y la corre una persona.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<ts>_compras_el_pedido_recuerda_su_ot.sql
git commit -m "feat(compras): el pedido recuerda de que OT nacio (migracion por aplicar)"
```

---

### Task 2: La sincronización no borra el origen

**Files:**
- Modify: `lib/compras/fusionDeLaPlanilla.ts`
- Test: `lib/compras/fusionDeLaPlanilla.test.ts`

**Interfaces:**
- Consumes: las columnas de la Tarea 1.
- Produces: `LoQueYaHabia` con `ot_id: string | null` y `ot_repuesto_id: string | null`.

- [ ] **Step 1: Escribir el test que falla**

```ts
it("el origen del pedido sobrevive a la sincronizacion", () => {
  // La planilla no sabe nada de OT: nunca trae estas dos columnas. Si la
  // fusion no las conservara, la primera sincronizacion borraria el vinculo
  // de todo RI nacido de una orden.
  const previo = { ...loQueYaHabia, ot_id: "ot-1", ot_repuesto_id: "rep-1" };
  const r = fusionarConLoQueYaHabia(dePlanillaVacia, previo);
  expect(r.ot_id).toBe("ot-1");
  expect(r.ot_repuesto_id).toBe("rep-1");
});

it("un pedido que la planilla trae y el sistema no conocia no tiene origen", () => {
  const r = fusionarConLoQueYaHabia(dePlanillaVacia, undefined);
  expect(r.ot_id).toBeNull();
  expect(r.ot_repuesto_id).toBeNull();
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/compras/fusionDeLaPlanilla.test.ts`
Expected: FAIL — `ot_id` no existe en el tipo.

- [ ] **Step 3: Agregar los dos campos a `LoQueYaHabia` y a `fusionarConLoQueYaHabia`**

Con el mismo patrón que `equipo_raw` (líneas 122-123), pero sin rama de planilla,
porque la planilla no los trae nunca:

```ts
ot_id: previo?.ot_id ?? null,
ot_repuesto_id: previo?.ot_repuesto_id ?? null,
```

Y un comentario de una línea: la planilla no los trae y por eso no hay `dePlanilla`.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/compras/fusionDeLaPlanilla.test.ts`
Expected: PASS

- [ ] **Step 5: Agregar las dos columnas al `select` de los existentes en `lib/compras/sheets.ts`**

Buscar la consulta de `existentes` que ya trae `hoja_origen, sheets_fila,
equipo_raw, equipo_id` y sumarle `ot_id, ot_repuesto_id`. Sin esto, `previo`
llega sin ellas y el test de arriba pasa mientras producción las borra.

- [ ] **Step 6: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add lib/compras/fusionDeLaPlanilla.ts lib/compras/fusionDeLaPlanilla.test.ts lib/compras/sheets.ts
git commit -m "fix(compras): la sincronizacion no borra de que OT nacio el pedido"
```

---

### Task 3: El pedido sugerido lleva la OT y el renglón

**Files:**
- Modify: `lib/mantenimiento/pedirRepuesto.ts`
- Modify: `app/(app)/mantenimiento/ordenes/RepuestosOTModal.tsx` (el único sitio de llamada)
- Test: `lib/mantenimiento/pedirRepuesto.test.ts`

**Interfaces:**
- Produces: `RepuestoPedido` con `id: string`; `OrdenDelPedido` con `id: string`;
  `PedidoSugerido` con `otId: string` y `otRepuestoId: string`.

- [ ] **Step 1: Escribir el test que falla**

```ts
it("el pedido sugerido dice de que orden y de que renglon sale", () => {
  const p = pedidoSugerido(
    { id: "rep-1", nombre: "CAJA DE RODAMIENTO UPC 213", codigo: "00185", cantidad: "2" },
    null,
    { id: "ot-1", ot_number: 2983, descripcion: "Cambio de rodamiento",
      equipment_id: "eq-1", equipo_raw: "Molino 2", sector_id: "sec-1" },
    []
  );
  expect(p.otId).toBe("ot-1");
  expect(p.otRepuestoId).toBe("rep-1");
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/mantenimiento/pedirRepuesto.test.ts`
Expected: FAIL

- [ ] **Step 3: Sumar `id` a `RepuestoPedido` y a `OrdenDelPedido`, y `otId`/`otRepuestoId` a `PedidoSugerido`**

`pedidoSugerido` los copia tal cual. No hay nada que derivar.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/mantenimiento/pedirRepuesto.test.ts`
Expected: PASS

- [ ] **Step 5: Pasar los ids en el único sitio de llamada**

En `RepuestosOTModal`, la llamada queda
`pedidoSugerido({ id: r.id, nombre: r.nombre, codigo: r.codigo, cantidad: r.cantidad }, d, orden, ubicaciones, areas)`,
y el objeto `orden` que ese modal ya tiene lleva su `id`. **Va en esta tarea y no
en la 4**: `id` es obligatorio en los dos tipos, así que sin esto el árbol deja de
typechequear en cuanto se commitea el paso 3.

- [ ] **Step 6: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add lib/mantenimiento/pedirRepuesto.ts lib/mantenimiento/pedirRepuesto.test.ts "app/(app)/mantenimiento/ordenes/RepuestosOTModal.tsx"
git commit -m "feat(mantenimiento): el pedido sugerido lleva su OT y su renglon"
```

---

### Task 4: El alta guarda el origen

**Files:**
- Modify: `app/(app)/compras/requerimientos/NuevoRequerimientoModal.tsx` (`ValoresIniciales` y el cuerpo del POST)
- Modify: `app/(app)/mantenimiento/ordenes/RepuestosOTModal.tsx` (la llamada a `pedidoSugerido`)
- Modify: `app/api/compras/requerimientos/route.ts` (el `registro`)

**Interfaces:**
- Consumes: `PedidoSugerido.otId` / `.otRepuestoId` (Tarea 3), las columnas (Tarea 1).
- Produces: un RI creado desde una OT con `ot_id` y `ot_repuesto_id` puestos.

- [ ] **Step 1: `ValoresIniciales` gana `otId?: string` y `otRepuestoId?: string`**

Van con un comentario de una línea: los manda sólo quien precarga desde una OT, y
las otras cinco pantallas no los mandan nunca. **`onSaved` no cambia.**

- [ ] **Step 2: El modal los suma al cuerpo del POST**

Como `ot_id` y `ot_repuesto_id` —snake_case, que es la convención del cuerpo—,
con `|| null`. Los lee de `inicial`, no del estado: no son campos del formulario
y nadie los edita.

- [ ] **Step 3: (movido a la tarea 3 por el ruling 1 del pre-flight — nada que hacer acá)**

`pedidoSugerido({ id: r.id, nombre: r.nombre, codigo: r.codigo, cantidad: r.cantidad }, d, orden, ubicaciones, areas)`
y `orden` tiene que llevar su `id`.

- [ ] **Step 4: La ruta valida y guarda**

Antes del `registro`, el mismo patrón que ya usa `equipo_id`: se comprueba que la
OT exista y que el renglón pertenezca a esa OT; si alguna no resuelve, **las dos
quedan en null y el pedido se crea igual**. Un pedido no se pierde por su
procedencia. Las dos van al `registro` como `ot_id` y `ot_repuesto_id`.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: sin errores; los tests de Compras y Mantenimiento en verde.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/compras/requerimientos/NuevoRequerimientoModal.tsx" "app/(app)/mantenimiento/ordenes/RepuestosOTModal.tsx" app/api/compras/requerimientos/route.ts
git commit -m "feat(compras): el RI nacido de una OT guarda de donde vino"
```

---

### Task 5: La ficha dice «Se pidió para»

**Files:**
- Modify: `app/(app)/compras/requerimientos/[id]/page.tsx`
- Modify: `app/(app)/compras/requerimientos/[id]/RequerimientoDetalle.tsx`

**Interfaces:**
- Consumes: `compras_requerimientos.ot_id` / `.ot_repuesto_id`.
- Produces: la prop `origenEnLaOT?: { ot_number: number | null; descripcion: string | null; equipo_raw: string | null; repuesto_nombre: string | null } | null`.

- [ ] **Step 1: Escribir el test que falla**

En `lib/compras/origenEnLaOT.test.ts`, sobre una función pura nueva
`textoDelOrigen(origen)` que arma la línea:

```ts
it("nombra la orden, su maquina y el renglon", () => {
  expect(textoDelOrigen({ ot_number: 2983, descripcion: "Cambio de rodamiento",
    equipo_raw: "Molino 2", repuesto_nombre: "CAJA DE RODAMIENTO UPC 213" }))
    .toBe('OT #2983 · Molino 2 · «Cambio de rodamiento»');
});

it("una OT borrada no deja una linea vacia", () => {
  // `on delete set null`: el RI sobrevive a la orden. Sin esto la ficha
  // mostraria «OT #» y una descripcion vacia. (Review Focus 1.)
  expect(textoDelOrigen(null)).toBeNull();
  expect(textoDelOrigen({ ot_number: null, descripcion: null, equipo_raw: null, repuesto_nombre: null })).toBeNull();
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/compras/origenEnLaOT.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `textoDelOrigen(origen: OrigenEnLaOT | null): string | null` en `lib/compras/origenEnLaOT.ts`**

Devuelve `null` cuando no hay número de OT. El nombre del repuesto va en una
segunda línea de la pantalla, no en este texto.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/compras/origenEnLaOT.test.ts`
Expected: PASS

- [ ] **Step 5: `page.tsx` trae la OT con el cliente admin**

`ordenes_trabajo` está cerrada con `mant_puede_ver()`, así que con el cliente de
sesión la línea desaparecería para casi todos. Se lee con `createAdminClient()`
sólo si `requerimiento.ot_id` no es null, y se le pasa a la pantalla ya resuelta.
El permiso va escrito arriba del archivo: lo ve **cualquiera que pueda abrir la
ficha**, porque es la procedencia de su propio pedido.

- [ ] **Step 6: La pantalla dibuja la línea**

Arriba de «Entró al pañol». Una línea con el rótulo «Se pidió para» y el texto,
y debajo, en `text-xs text-slate-500`, «desde el repuesto «…»» cuando hay
`repuesto_nombre`.

- [ ] **Step 7: Verificar**

Run: `npx tsc --noEmit && npm run build && node scripts/revisar-responsive.mjs`
Expected: sin errores; ROMPE 0.

- [ ] **Step 8: Anotar la mitad A en `docs/COMPRAS.md`**

Una sección corta: que un RI puede recordar de qué OT nació, que eso **no dice
que se haya aplicado** —eso es la mitad B—, y que la planilla no lo trae nunca,
por lo que la fusión lo conserva. Sin esta nota, el próximo que lea
`fusionDeLaPlanilla` no sabe por qué esas dos columnas no tienen rama de planilla.

- [ ] **Step 9: Commit**

```bash
git add lib/compras/origenEnLaOT.ts lib/compras/origenEnLaOT.test.ts "app/(app)/compras/requerimientos/[id]/page.tsx" "app/(app)/compras/requerimientos/[id]/RequerimientoDetalle.tsx" docs/COMPRAS.md
git commit -m "feat(compras): la ficha del RI dice para que OT se pidio"
```

---

## Parte B — el repuesto dice de qué salida salió

### Task 6: La migración de Mantenimiento

**Files:**
- Create: `supabase/migrations/<ts>_mant_el_repuesto_dice_de_que_salida_salio.sql`

**Interfaces:**
- Produces: `ordenes_trabajo_repuestos.movimiento_id`, `.movimiento_puesto_por`, `.movimiento_puesto_en`.

- [ ] **Step 1: Escribir la migración**

```sql
alter table public.ordenes_trabajo_repuestos
  add column if not exists movimiento_id uuid
  references public.inventario_movimientos(id) on delete set null,
  add column if not exists movimiento_puesto_por uuid references public.usuarios(id),
  add column if not exists movimiento_puesto_en timestamptz;
```

Más un índice parcial sobre `movimiento_id where movimiento_id is not null`, que
es por donde pregunta la ficha del RI.

- [ ] **Step 2: Escribir el encabezado**

Tiene que contestar: por qué el vínculo vive acá y no en `inventario_movimientos`
—la responsabilidad es de Mantenimiento, y acá el renglón sabe qué artículo
declaró, así que un vínculo que se mudó **se detecta** comparándolos—; la
medición que lo hace seguro (5.136 filas del kardex, **cero** retrocesos de
fecha: se agrega al final); y que **no hay policy nueva**, porque las columnas
viven en una tabla que ya tiene las suyas.

- [ ] **Step 3: Confirmar que se puede correr dos veces**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<ts>_mant_el_repuesto_dice_de_que_salida_salio.sql
git commit -m "feat(mantenimiento): el repuesto dice de que salida del panol salio (migracion por aplicar)"
```

---

### Task 7: Qué salidas son candidatas, y qué dice un vínculo

**Files:**
- Create: `lib/inventario/salidasDelRepuesto.ts`
- Test: `lib/inventario/salidasDelRepuesto.test.ts`

**Interfaces:**
- Produces:
  - `interface SalidaDelPanol { id: string; articulo_id: string | null; fecha: string | null; cantidad: number; solicitante: string | null; sector_raw: string | null; equipo_raw: string | null; tipo: string }`
  - `salidasCandidatas(entrada: { articulo_id: string | null; fecha: string | null }, salidas: SalidaDelPanol[], opciones?: { dias?: number; tope?: number }): SalidaDelPanol[]`
  - `type Aplicacion = { estado: "aplicado"; } | { estado: "sin-justificar" } | { estado: "otra-pieza" }`
  - `aplicacionDelRenglon(renglon: { articulo_id: string | null; movimiento_id: string | null }, movimiento: SalidaDelPanol | null): Aplicacion`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("que salidas son candidatas de una entrada", () => {
  it("entran las del mismo articulo posteriores a la entrada, la mas nueva primero", () => { /* … */ });

  it("el mismo dia cuenta", () => {
    // La fecha es un `date`: dentro de un dia no hay orden, y "llego y se uso
    // hoy" es el caso tipico del repuesto que se compra para arreglar algo.
    expect(salidasCandidatas(entrada("2026-11-17"), [salida("s1", "2026-11-17")]))
      .toHaveLength(1);
  });

  it("corta a los 90 dias", () => { /* una a 90 entra, una a 91 no */ });

  it("muestra 10 como mucho", () => {
    // Medido: el maximo real es 454 salidas posteriores. (Review Focus 3.)
    expect(salidasCandidatas(entrada("2026-01-01"), cien, { dias: 10_000 })).toHaveLength(10);
  });

  it("una entrada sin fecha no lista nada", () => { /* no se puede afirmar "posterior" */ });
  it("una salida sin fecha no es candidata", () => { /* idem */ });
  it("una entrada sin articulo no lista nada", () => { /* sin pieza no hay que comparar */ });
});

describe("que dice un vinculo", () => {
  it("sin movimiento, sin justificar", () => { /* … */ });
  it("con movimiento del mismo articulo, aplicado", () => { /* … */ });

  it("si el articulo no coincide, no dice aplicado", () => {
    // Pasa si le sacan el articulo al renglon despues de declarar, o si el
    // kardex reuso una `sheets_fila`. Afirmar "aplicado" ahi es el
    // anti-objetivo del diseno. (Review Focus 2.)
    expect(aplicacionDelRenglon({ articulo_id: "a1", movimiento_id: "m1" },
      { ...salida("m1", "2026-11-18"), articulo_id: "a2" }).estado).toBe("otra-pieza");
  });

  it("un renglon sin articulo con movimiento puesto tampoco dice aplicado", () => { /* … */ });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/inventario/salidasDelRepuesto.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar las dos funciones**

`salidasCandidatas` filtra por artículo y por `tipo === "salida"`, exige las dos
fechas, aplica la ventana con `>=` y ordena de más nueva a más vieja antes de
cortar por el tope. Los valores por defecto son `dias: 90` y `tope: 10`.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/inventario/salidasDelRepuesto.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/inventario/salidasDelRepuesto.ts lib/inventario/salidasDelRepuesto.test.ts
git commit -m "feat(inventario): que salidas del panol pueden ser la de un repuesto"
```

---

### Task 8: La ruta que declara la salida

**Files:**
- Create: `app/api/mantenimiento/repuestos/[id]/movimiento/route.ts`

**Interfaces:**
- Consumes: `salidasCandidatas` (Tarea 7), las columnas (Tarea 6).
- Produces: `GET` → `{ candidatas: SalidaDelPanol[] }` · `PATCH {movimiento_id}` → `{ ok: true }` · `DELETE` → `{ ok: true }`.

- [ ] **Step 1: Escribir la ruta, hermana de `…/[id]/ri/route.ts`**

Mismo esqueleto: `conPermiso()` con `puedeEditarMantenimiento` para `PATCH` y
`DELETE`, `puedeVerMantenimiento` para `GET`, y cliente admin para leer —cruza
`inventario_movimientos`, que está cerrada con `tiene_acceso_inventario()`—.

- [ ] **Step 2: `GET` — las candidatas**

Resuelve el renglón, y **si no tiene `articulo_id` devuelve lista vacía con un
motivo**: `{ candidatas: [], motivo: "El renglón todavía no dice qué artículo del
pañol es." }`. Si lo tiene, busca la entrada más reciente de ese artículo y pasa
sus salidas por `salidasCandidatas`.

- [ ] **Step 3: `PATCH` — declarar, con tres rechazos**

Rechaza con 400, cada uno con su mensaje en castellano: que el movimiento no
exista; que **no sea de tipo `salida`** (Review Focus 5); y que su `articulo_id`
no coincida con el del renglón. Escribe `movimiento_id`,
`movimiento_puesto_por` y `movimiento_puesto_en`.

- [ ] **Step 4: Verificar y regenerar el mapa**

Run: `npx tsc --noEmit && npm run build && npm run mapa-de-apis`
Expected: sin errores, y la ruta nueva aparece en el mapa generado.
`docs/API-MAPA.generado.md` **no se edita a mano**: sale de ese comando.

- [ ] **Step 5: Una línea en `docs/API.md`**

En la sección de `mantenimiento/repuestos`, al lado de `articulo` y `ri`: qué
hace, que usa cliente admin para leer movimientos y cuál es el permiso de cada
verbo.

- [ ] **Step 6: Commit**

```bash
git add "app/api/mantenimiento/repuestos/[id]/movimiento/route.ts" docs/API-MAPA.generado.md docs/API.md
git commit -m "feat(mantenimiento): declarar de que salida del panol salio un repuesto"
```

---

### Task 9: La línea «Salió del pañol» en el modal de la OT

**Files:**
- Modify: `app/(app)/mantenimiento/ordenes/RepuestosOTModal.tsx`

**Interfaces:**
- Consumes: la ruta de la Tarea 8.
- Produces: la declaración desde la pantalla.

- [ ] **Step 1: `Repuesto` gana `movimiento?: SalidaDelPanol | null`**

Y el `GET` de `…/ordenes/[id]/repuestos` lo trae embebido, como ya trae `articulo`.

- [ ] **Step 2: Dibujar la línea por renglón**

Debajo de los RI pegados. Tres estados, con las frases fijadas:

- sin artículo → «Salió del pañol: elegí primero el artículo» (sin selector);
- sin movimiento → «Salió del pañol: —» y un botón que abre el selector;
- con movimiento → «Salió del pañol: 18/11, 2 un. (ORTIZ, Facundo)» y un botón de sacar.

El selector es una lista de las candidatas del `GET`, cada una con fecha,
cantidad, quién la pidió, sector y máquina. **No es un selector de OT**: la orden
es el contexto.

- [ ] **Step 3: Verificar en 343 px**

Run: `node scripts/revisar-responsive.mjs && npx tsc --noEmit && npm run build`
Expected: ROMPE 0 · APRETADO 0; sin errores.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/RepuestosOTModal.tsx" "app/api/mantenimiento/ordenes/[id]/repuestos/route.ts"
git commit -m "feat(mantenimiento): el repuesto de una OT dice de que salida salio"
```

---

### Task 10: La sección Trazabilidad en la ficha del RI

**Files:**
- Modify: `app/(app)/compras/requerimientos/[id]/page.tsx`
- Modify: `app/(app)/compras/requerimientos/[id]/RequerimientoDetalle.tsx`
- Test: `lib/inventario/salidasDelRepuesto.test.ts` (el caso de las dos OT)

**Interfaces:**
- Consumes: `salidasCandidatas`, `aplicacionDelRenglon` (Tarea 7); `textoDelOrigen` (Tarea 5).
- Produces: la sección completa.

- [ ] **Step 1: Escribir el test que falla**

```ts
it("una misma salida puede estar declarada por dos ordenes, y se nombran las dos", () => {
  // Una entrega de 10 puede cubrir dos ordenes, y nada lo impide: el vinculo
  // vive en el renglon, no en el movimiento. La ficha no puede mostrar una
  // sola. (Review Focus 4.)
  expect(ordenesQueDeclararon("m1", [
    { movimiento_id: "m1", ot_number: 2983 }, { movimiento_id: "m1", ot_number: 3001 },
    { movimiento_id: "m2", ot_number: 2999 },
  ])).toEqual([2983, 3001]);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/inventario/salidasDelRepuesto.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `ordenesQueDeclararon(movimientoId, renglones)` en `lib/inventario/salidasDelRepuesto.ts`**

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/inventario/salidasDelRepuesto.test.ts`
Expected: PASS

- [ ] **Step 5: `page.tsx` trae las salidas y quién las declaró**

Con el cliente admin, **sólo si quien mira puede editar Compras**: las salidas
candidatas del artículo de cada entrada, y los renglones de repuesto que apuntan
a esas salidas con su OT. Va con el permiso escrito arriba del archivo.

- [ ] **Step 6: La pantalla arma la sección**

«Entró al pañol» pasa a ser **Trazabilidad**, con los tres renglones del spec en
orden: «Se pidió para» (ya está, de la Tarea 5), «Entró al pañol» (lo que ya
había) y «Salió del pañol». Cada salida dice su estado: «aplicado a la OT #2983
«…»», «sin justificar» —sin botón, y aclarando que lo declara Mantenimiento en la
OT— o el aviso de que el vínculo apunta a otra pieza. El botón de «marcar como
recibido» que hoy cuelga de esa sección se queda donde está.

- [ ] **Step 7: Verificar todo**

Run: `npm test && npx tsc --noEmit && npm run build && node scripts/revisar-responsive.mjs && node scripts/revisar-arbol-commiteado.mjs`
Expected: todo en verde; ROMPE 0; todos los imports resuelven.

- [ ] **Step 8: Anotar la mitad B y el renglón de CLAUDE.md**

En `docs/MANTENIMIENTO-INTEGRACION.md`, qué declara el renglón de repuesto y por
qué el vínculo vive ahí y no en el movimiento (la detección por artículo). En
`docs/COMPRAS-ESTADO.md`, que la ficha lo muestra y **no lo deja editar**. Y en la
fila de Compras de `CLAUDE.md`, el enlace al spec y al plan, con la frase que no
se deduce del código: **esto sirve para el repuesto y no para el consumible**,
porque la mediana son 2 salidas posteriores y el máximo 454.

- [ ] **Step 9: Commit**

```bash
git add lib/inventario/salidasDelRepuesto.ts lib/inventario/salidasDelRepuesto.test.ts "app/(app)/compras/requerimientos/[id]/page.tsx" "app/(app)/compras/requerimientos/[id]/RequerimientoDetalle.tsx" docs/MANTENIMIENTO-INTEGRACION.md docs/COMPRAS-ESTADO.md CLAUDE.md
git commit -m "feat(compras): la ficha del RI muestra la trazabilidad del repuesto"
```

---

## Orden de despliegue

Las dos migraciones las corre una persona. **La Tarea 2 no se puede desplegar
antes que la migración de la Tarea 1**: nombra `ot_id` en el `select` de los
existentes y en el upsert de la sincronización, y sin la columna la
sincronización de Compras falla entera. Lo mismo para las tareas 8 a 10 con la
migración de la Tarea 6.

La Parte A (tareas 1 a 5) y la Parte B (tareas 6 a 10) son independientes y
pueden ir en dos despliegues.

**Y hay una precondición que no es código:** B necesita que Mantenimiento enlace
el renglón de repuesto con el artículo del pañol (`articulo_id`, hoy **0 de 37**).
Sin eso no hay salidas que ofrecer y la función aparece vacía. Hay que avisarlo
antes de desplegar, o se lee como rota.

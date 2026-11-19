# Los repuestos usados, al registrar el trabajo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el modal de «Registrar el trabajo» de una OT abra precargado con los repuestos que esa orden ya tenía anotados, deje corregirlos, sacarlos y sumar otros con el buscador del inventario, y guarde la lista resultante como el registro de qué se gastó en esa OT.

**Architecture:** Dos funciones puras nuevas en `lib/mantenimiento/repuestosDeLaOT.ts` —una convierte las filas de la base en renglones de formulario, la otra decide si un cuerpo puede reemplazar la lista—, un `PUT` en la ruta de repuestos que ya existe, y el cableado del modal. No se toca la planilla, ni `ordenes_trabajo.repuesto`, ni el stock.

**Tech Stack:** Next.js 16 (App Router), React, TypeScript, Supabase/PostgREST, Vitest.

**Spec:** [docs/superpowers/specs/2026-11-19-mantenimiento-repuestos-al-registrar-design.md](../specs/2026-11-19-mantenimiento-repuestos-al-registrar-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit. Conventional commits (`feat(mantenimiento): …`).
- **Nunca `git add -A`**: suele haber otra sesión en el mismo árbol. Cada commit nombra sus archivos.
- El árbol arranca en la rama `sincronizaciones-despliegue-canonico` y con cambios sin commitear de otra sesión. **Si `tsc` o los tests fallan en archivos que este plan no toca, mirar `git status` antes de arreglarlos.**
- **No se escribe en ninguna planilla de Google** en todo este plan, así que ningún archivo nuevo se declara en `scripts/revisar-exportaciones.mjs`.
- **No se toca `ordenes_trabajo.repuesto`**: la sincronización la pisa con lo que diga la columna I del master, que es derrame.
- **No hay migración**: ninguna tabla ni columna nueva.
- `.input` declara `width: 100%` fuera de capa, así que una clase de ancho al lado no sirve: el ancho va en un `div` que envuelva al campo. `RepuestosDeLaOT` ya lo resuelve adentro.
- Comprobar con `npm test`, `npm run tipos` —y si ese script no está en esta rama, `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit`— y `node scripts/revisar-responsive.mjs`.

## Review Focus

Lo que el diseño implica y ningún test ejercitaría solo:

1. Una fila de la base con `cantidad` o `codigo` en `null` tiene que llegar al formulario como campo **vacío** y no como el texto `"null"` — Tarea 1.
2. Un `PUT` cuyo cuerpo no trae `repuestos` como arreglo tiene que contestar 400 y **no borrar nada**: un cliente viejo o un error de serialización borraría la lista entera sin dejar rastro — Tarea 1 y Tarea 2.
3. Un `PUT` con la lista **vacía** sí borra, porque sacar todos los renglones es «no se usó ninguno» — Tarea 1.
4. Los renglones que vinieron de la base tienen que volver **con su `codigo`**: perderlo al registrar desenlaza del pañol una lista que ya estaba enlazada — Tarea 1.
5. Una OT sin ningún repuesto tiene que abrir con un renglón en blanco: un formulario sin dónde escribir no se puede completar — Tarea 1.

---

### Tarea 1: Las dos funciones puras

**Files:**
- Modify: `lib/mantenimiento/repuestosDeLaOT.ts`
- Test: `lib/mantenimiento/repuestosDeLaOT.test.ts`

**Interfaces:**
- Consumes: `LineaDeRepuesto`, `lineasQueValen()` — ya están en ese archivo.
- Produces:
  - `lineasDesdeLasFilas(filas: readonly { nombre: string | null; codigo: string | null; cantidad: string | null }[] | null | undefined): LineaDeRepuesto[]`
  - `elReemplazoDelCuerpo(body: { repuestos?: unknown } | null | undefined): { ok: true; lineas: LineaDeRepuesto[] } | { ok: false; error: string }`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("lineasDesdeLasFilas", () => {
  it("un null de la base llega como campo vacío y no como el texto 'null'", () => {
    expect(lineasDesdeLasFilas([{ nombre: "periflex", codigo: null, cantidad: null }]))
      .toEqual([{ cantidad: "", nombre: "periflex" }]);
  });

  it("conserva el código, que es el enlace al pañol", () => {
    expect(lineasDesdeLasFilas([
      { nombre: "CAJA DE RODAMIENTO UPC 213", codigo: "00185", cantidad: "2" },
    ])).toEqual([{ cantidad: "2", nombre: "CAJA DE RODAMIENTO UPC 213", codigo: "00185" }]);
  });

  it("una OT sin repuestos abre con un renglón en blanco: sin dónde escribir no se completa", () => {
    expect(lineasDesdeLasFilas([])).toEqual([{ cantidad: "", nombre: "" }]);
    expect(lineasDesdeLasFilas(null)).toEqual([{ cantidad: "", nombre: "" }]);
  });
});

describe("elReemplazoDelCuerpo", () => {
  it("sin la clave `repuestos` no reemplaza: un cuerpo incompleto borraría la lista entera", () => {
    const falta = { ok: false, error: "Falta la lista de repuestos" };
    expect(elReemplazoDelCuerpo({})).toEqual(falta);
    expect(elReemplazoDelCuerpo(null)).toEqual(falta);
    expect(elReemplazoDelCuerpo({ repuestos: "2 grillas" })).toEqual(falta);
  });

  it("una lista vacía sí reemplaza: sacar todos los renglones es «no se usó ninguno»", () => {
    expect(elReemplazoDelCuerpo({ repuestos: [] })).toEqual({ ok: true, lineas: [] });
  });

  it("limpia los renglones con la misma regla que el alta", () => {
    expect(elReemplazoDelCuerpo({ repuestos: [
      { cantidad: "2", nombre: "rodamiento 22216, EK", codigo: "00185" },
      { cantidad: "", nombre: "   " },
    ] })).toEqual({
      ok: true,
      lineas: [{ cantidad: "2", nombre: "rodamiento 22216 EK", codigo: "00185" }],
    });
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run lib/mantenimiento/repuestosDeLaOT.test.ts`
Expected: FAIL — `lineasDesdeLasFilas is not a function`.

- [ ] **Step 3: Implementar las dos funciones en `lib/mantenimiento/repuestosDeLaOT.ts`**

`lineasDesdeLasFilas` pasa las filas por `lineasQueValen` —que ya limpia el nombre, vacía los nulos y deja el `codigo` fuera cuando no hay— y devuelve `[{ cantidad: "", nombre: "" }]` cuando no quedó ninguna.

`elReemplazoDelCuerpo` rechaza con `"Falta la lista de repuestos"` cuando `body?.repuestos` no es un arreglo, y si lo es devuelve `lineasQueValen(body.repuestos)`. El comentario explica por qué el rechazo importa: la ruta borra antes de insertar, así que un cuerpo sin la clave sería un borrado silencioso.

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run lib/mantenimiento/repuestosDeLaOT.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/repuestosDeLaOT.ts lib/mantenimiento/repuestosDeLaOT.test.ts
git commit -m "feat(mantenimiento): las dos funciones puras para reemplazar los repuestos de una OT"
```

---

### Tarea 2: El `PUT` que reemplaza la lista

**Files:**
- Modify: `app/api/mantenimiento/ordenes/[id]/repuestos/route.ts`

**Interfaces:**
- Consumes: `elReemplazoDelCuerpo()` y `filasParaLaBase()` de `lib/mantenimiento/repuestosDeLaOT`; `puedeEditarMantenimiento()` y `createAdminClient()`, que la ruta ya importa.
- Produces: `PUT /api/mantenimiento/ordenes/[id]/repuestos` con cuerpo `{ repuestos: LineaDeRepuesto[] }`, que responde `{ data: { guardados: number } }`.

- [ ] **Step 1: Implementar `PUT(request: Request, { params }: Params)`, debajo del `POST`**

Mismas dos guardas que el `POST`, con los mismos mensajes: 401 sin sesión, 403 con `"Cargar repuestos requiere nivel de edición en Mantenimiento"`. Después `elReemplazoDelCuerpo(await request.json().catch(() => null))`, y si no es `ok`, 400 con su `error`.

**El orden de las escrituras no es indistinto y va comentado en el archivo:** primero se leen los `id` que la orden ya tiene, después se insertan los nuevos y recién al final se borran los viejos. PostgREST no da transacción, así que borrar primero y fallar al insertar dejaría la OT sin ningún repuesto — y ésta es la lista que el registro del trabajo acaba de dar por buena. Al revés, un fallo deja renglones repetidos: se ven y se sacan, que es el lado barato de equivocarse.

El borrado va por `.in("id", viejos)` y no por `work_order_id`, para no llevarse lo que se acaba de insertar.

- [ ] **Step 2: Verificar que compila**

Run: `npm run tipos` (o `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit`)
Expected: sin errores en `app/api/mantenimiento/ordenes/[id]/repuestos/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add "app/api/mantenimiento/ordenes/[id]/repuestos/route.ts"
git commit -m "feat(mantenimiento): una ruta que reemplaza la lista de repuestos de una OT"
```

---

### Tarea 3: El campo en el modal de registrar el trabajo

**Files:**
- Modify: `app/(app)/mantenimiento/ordenes/RegistrarOTModal.tsx`

**Interfaces:**
- Consumes: `RepuestosDeLaOT` de `@/components/RepuestosDeLaOT`; `lineasDesdeLasFilas` y el tipo `LineaDeRepuesto` de la Tarea 1; el `PUT` de la Tarea 2.
- Produces: nada que otra tarea use.

- [ ] **Step 1: Traer la lista al abrir**

Dos estados nuevos: `repuestos: LineaDeRepuesto[]`, que arranca en `[{ cantidad: "", nombre: "" }]`, y `listaCargada: boolean`, que arranca en `false`. Un `useCargar` sobre `[orden.id]` pide `GET /api/mantenimiento/ordenes/${orden.id}/repuestos` y, si salió, hace `setRepuestos(lineasDesdeLasFilas(body.data))` y `setListaCargada(true)`.

Si **no** salió, `listaCargada` se queda en `false` y se muestra un aviso: «No se pudieron traer los repuestos de esta orden, así que no se van a guardar. El resto del registro se guarda igual.» Es la anti-meta del diseño: el modal no puede distinguir «esta OT no tenía ninguno» de «no se pudieron traer», y mandar la segunda como lista vacía borraría lo que había.

- [ ] **Step 2: Dibujar el campo**

Entre el textarea de «Qué se hizo y qué se encontró» y `<FallaDeLaOT />`, rotulado **«Repuestos utilizados»**, con `<RepuestosDeLaOT lineas={repuestos} onCambiar={setRepuestos} deshabilitado={guardando} buscarEnInventario />` — la búsqueda encendida como en `NuevaOTModal`, porque esta pantalla ya depende del servidor para dibujarse.

**No se usa el helper `Campo` de este archivo**: es un `<label>` que envuelve a sus hijos, y envolver una lista de varios inputs en un label manda el clic de cualquier parte del rótulo al primer campo. Va un `div` con el rótulo arriba, como el helper `F` de `NuevaOTModal`.

- [ ] **Step 3: Guardar la lista después de cerrar la OT**

En `guardar()`, después de que el `PATCH` de la orden haya salido bien y **antes** de decidir qué mensaje mostrar: si `listaCargada`, mandar `PUT` con `{ repuestos }` al mismo endpoint.

El orden —ejecución, OT, repuestos— es el del diseño: un fallo acá no tira nada, porque el trabajo ya quedó registrado y la OT cerrada. Si falla, se suma un aviso: «El trabajo quedó registrado y la OT cerrada, pero los repuestos no se guardaron: …», y se ofrece «Entendido» como ya hace el aviso de la planilla.

Los dos avisos pueden darse juntos, así que se juntan en un arreglo y se muestran con un solo botón: hoy el de la planilla hace `return` y se comería al otro.

- [ ] **Step 4: Comprobar**

Run: `npm test`
Expected: PASS (3.000+ tests).

Run: `npm run tipos`
Expected: sin errores.

Run: `node scripts/revisar-responsive.mjs`
Expected: `ROMPE 0 · APRETADO 0 · MIRAR 0`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/RegistrarOTModal.tsx"
git commit -m "feat(mantenimiento): los repuestos usados se cargan al registrar el trabajo"
```

---

### Tarea 4: Dejarlo escrito donde se busca

**Files:**
- Modify: `docs/MANTENIMIENTO-INTEGRACION.md`

- [ ] **Step 1: Agregar la sección «Los repuestos que se usaron»**

Tres cosas que no se deducen del código, que son las del diseño: la lista **no distingue previsto de usado** y en una OT cerrada significa lo segundo —con el efecto de que «Repuestos que hacen falta» puede ofrecer «Pedir a Compras» por algo ya consumido—; **no se escribe en la planilla** porque la columna I del master es derrame y sólo se corrige por «Altas del sistema», que alcanza a 262 de 2.530 OT; y **no se valúa en pesos** porque `inventario_articulos` no tiene precio y ninguna OT tiene `costo` cargado. Enlazar el diseño.

- [ ] **Step 2: Commit**

```bash
git add docs/MANTENIMIENTO-INTEGRACION.md
git commit -m "docs(mantenimiento): que significa la lista de repuestos de una OT cerrada"
```

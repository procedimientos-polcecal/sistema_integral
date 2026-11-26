# Alta de proveedor desde la carga de un presupuesto — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que desde el formulario de presupuesto se pueda dar de alta un proveedor con CUIT, que quede enlazado a Odoo si ya existe allá, y que si no existe se cree el `res.partner` al generar la orden de compra.

**Architecture:** Tres capas. Las decisiones puras (validar el alta, detectar duplicados, repartir el enlace por empresa) van a `lib/compras/altaDeProveedor.ts` con tests. El viaje a Odoo reusa lo que Facturación ya tiene probado (`buscarPartnersPorCuit` + `elegirPartnerDelEmisor`) y agrega un resolver de catálogo y un creador de partner en `lib/odoo/partnerDeProveedor.ts`. La pantalla es un modal nuevo montado en `PresupuestoForm`.

**Tech Stack:** Next.js 16 (App Router), Supabase/PostgREST, Odoo por JSON-RPC, vitest, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-11-23-compras-alta-de-proveedor-desde-el-presupuesto-design.md](../specs/2026-11-23-compras-alta-de-proveedor-desde-el-presupuesto-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **No hay migración.** `proveedores` y `proveedores_odoo` ya tienen todas las columnas.
- **Ningún id de Odoo escrito en el código.** El tipo de documento se resuelve por nombre en tiempo de ejecución.
- Un desplegable se escribe `<Select>` de `components/Select.tsx`, no `<select>`.
- Una grilla de tres columnas lleva breakpoint: `grid-cols-1 sm:grid-cols-3`.
- Un ancho al lado de `.input` no se aplica: va en un `div` que envuelva al campo.
- **Nunca `git add -A`**: agregar sólo los archivos nombrados en cada commit.
- La lógica que decide algo vive en `lib/` y tiene test; las rutas y pantallas no tienen tests.
- Mensajes de commit en conventional commits castellano, con el cuerpo explicando **por qué**.

## Review Focus

Lo que el spec implica y ningún test de las tareas ejercita por su cuenta. Cada línea tiene su test asignado a la tarea que es dueña del código:

1. **CUIT escrito con guiones en Odoo** — 2 de 1.639 partners lo tienen así; un `["vat","in",[11 dígitos]]` no los encuentra y el sistema crearía un partner que ya existía, que es el anti-objetivo número uno. → Tarea 2.
2. **El partner encontrado ya está enlazado a otro proveedor del SdG** — `proveedores_odoo` tiene `unique (empresa_id, odoo_partner_id)` y contestaría 23505 crudo. → Tarea 4, **sin test**: vive en la ruta, y en este repo las rutas no tienen tests. Lo cubre la revisión, no la suite.
3. **Odoo caído o sin credenciales durante el alta** — el proveedor se tiene que dar de alta igual; un Odoo caído no puede impedir cargar un presupuesto. → Tarea 4, **sin test**, por lo mismo. Es el caso que más conviene mirar a ojo en la revisión final: si el `try` abraza de más, un fallo de Odoo se lleva puesta el alta.
4. **Un RI sin empresa y sin `paga_ambas`** (17 de 1.024) — no hay empresa contra la cual buscar ni crear. → Tarea 1 y Tarea 6.
5. **Proveedor sin CUIT que llega a la generación de la orden** — son 40 de los 45 frenados; el mensaje tiene que decir que falta el CUIT, no el enlace. → Tarea 6.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/compras/altaDeProveedor.ts` *(nuevo)* | Decisiones puras: validar el alta, encontrar duplicados en el padrón, repartir el resultado del enlace por empresa. |
| `lib/compras/altaDeProveedor.test.ts` *(nuevo)* | Sus tests. |
| `lib/odoo/partnerDeProveedor.ts` *(nuevo)* | El viaje a Odoo: buscar por CUIT tolerando guiones, resolver el tipo de documento, armar el `vals` y crear el partner. |
| `lib/odoo/partnerDeProveedor.test.ts` *(nuevo)* | Tests de lo puro de ahí: el filtro tolerante y el armado del `vals`. |
| `app/api/compras/proveedores/con-odoo/route.ts` *(nuevo)* | `POST`: el alta del modal. Valida, inserta, busca en Odoo y escribe `proveedores_odoo`. |
| `app/(app)/compras/requerimientos/[id]/NuevoProveedorModal.tsx` *(nuevo)* | El modal. |
| `app/(app)/compras/requerimientos/[id]/PresupuestoForm.tsx` *(modificar)* | El botón «Nuevo proveedor» y el alta en la lista en memoria. |
| `lib/odoo/ordenDeCompra.ts` *(modificar)* | El mensaje del problema `"sin proveedor enlazado"`, que hoy miente cuando lo que falta es el CUIT. |
| `lib/odoo/pushOrden.ts` *(modificar)* | Antes de dar el problema por definitivo, crear el partner que falta. |
| `docs/COMPRAS.md`, `CLAUDE.md` *(modificar)* | Lo que no se deduce del código. |

---

### Tarea 1: Las decisiones puras del alta

**Files:**
- Create: `lib/compras/altaDeProveedor.ts`
- Test: `lib/compras/altaDeProveedor.test.ts`

**Interfaces:**
- Consumes: `normalizarCuit`, `cuitEsValido` de `lib/core/cuit.ts`; `nombresParecidos` de `lib/core/proveedores.ts`.
- Produces:
  - `type ProveedorDelPadron = { id: string; nombre: string; cuit: string | null }`
  - `type ProblemaDelAlta = { campo: "nombre" | "cuit"; mensaje: string; proveedorExistente?: { id: string; nombre: string } }`
  - `validarAlta(datos: { nombre: string; cuit: string }, padron: ProveedorDelPadron[]): ProblemaDelAlta[]`
  - `parecidosEnElPadron(nombre: string, padron: ProveedorDelPadron[]): ProveedorDelPadron[]`
  - `empresasDelRequerimiento(ri: { empresa_id: string | null; paga_ambas: boolean }, todas: { id: string; odoo_company_id: number | null }[]): { id: string; odooCompanyId: number }[]`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
const padron = [
  { id: "a", nombre: "Matelec", cuit: "30-70801757-0" },
  { id: "b", nombre: "TODO RULEMAN, EQUIPARTES", cuit: null },
];

it("el nombre vacío es un problema", () =>
  expect(validarAlta({ nombre: "  ", cuit: "30-70801757-0" }, padron)
    .some((p) => p.campo === "nombre")).toBe(true));

it("el CUIT es obligatorio", () =>
  expect(validarAlta({ nombre: "Nuevo", cuit: "" }, padron)
    .map((p) => p.campo)).toContain("cuit"));

it("un CUIT inválido se rechaza", () =>
  expect(validarAlta({ nombre: "Nuevo", cuit: "12345678901" }, padron)
    .map((p) => p.campo)).toContain("cuit"));

/*
 * El freno duro. Dos filas con el mismo CUIT es el caso que
 * `cruzarProveedores()` informa y NO enlaza: crear la segunda deja a las dos
 * sin poder llegar a una orden de compra.
 */
it("un CUIT que ya está en el padrón nombra al que lo tiene", () => {
  const [p] = validarAlta({ nombre: "Matelec SRL", cuit: "30708017570" }, padron);
  expect(p.campo).toBe("cuit");
  expect(p.proveedorExistente).toEqual({ id: "a", nombre: "Matelec" });
});

it("compara el CUIT normalizado: con guiones y sin guiones son el mismo", () =>
  expect(validarAlta({ nombre: "Otro", cuit: "30-708017570" }, padron)
    .some((p) => p.proveedorExistente?.id === "a")).toBe(true));

it("un alta limpia no tiene problemas", () =>
  expect(validarAlta({ nombre: "Nuevo", cuit: "30-71182027-9" }, padron)).toEqual([]));

// Avisa, no frena: por eso va aparte de validarAlta.
it("encuentra el parecido aunque cambie mayúsculas y acentos", () =>
  expect(parecidosEnElPadron("MATELEC", padron).map((p) => p.id)).toEqual(["a"]));

it("un nombre que no se parece a nada devuelve vacío", () =>
  expect(parecidosEnElPadron("Ferretería Zulema", padron)).toEqual([]));

const empresas = [
  { id: "pol", odoo_company_id: 1 },
  { id: "pys", odoo_company_id: 2 },
];

it("un RI de una empresa da una", () =>
  expect(empresasDelRequerimiento({ empresa_id: "pol", paga_ambas: false }, empresas))
    .toEqual([{ id: "pol", odooCompanyId: 1 }]));

it("AMBAS da las dos", () =>
  expect(empresasDelRequerimiento({ empresa_id: null, paga_ambas: true }, empresas))
    .toHaveLength(2));

// 17 de 1.024 RI están así. No hay empresa contra la cual buscar ni crear.
it("sin empresa y sin paga_ambas no da ninguna", () =>
  expect(empresasDelRequerimiento({ empresa_id: null, paga_ambas: false }, empresas))
    .toEqual([]));

it("una empresa sin odoo_company_id queda afuera", () =>
  expect(empresasDelRequerimiento({ empresa_id: "x", paga_ambas: false },
    [{ id: "x", odoo_company_id: null }])).toEqual([]));
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/compras/altaDeProveedor.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar las tres funciones en `lib/compras/altaDeProveedor.ts`**

`parecidosEnElPadron` llama a `nombresParecidos([nombre, ...padron.map(p => p.nombre)])`, busca el grupo que contiene a `nombre` y devuelve las filas del padrón de los otros nombres de ese grupo. El encabezado del archivo explica por qué el CUIT frena y el nombre sólo avisa, con los números del spec (81 grupos por clave exacta, 119 por el laxo, y que `proveedores.nombre` es `unique`).

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/compras/altaDeProveedor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/compras/altaDeProveedor.ts lib/compras/altaDeProveedor.test.ts
git commit -F <archivo con el mensaje>
```
Mensaje: `feat(compras): las decisiones del alta de un proveedor, con el CUIT como freno`

---

### Tarea 2: Buscar el partner en Odoo tolerando el CUIT con guiones

**Files:**
- Create: `lib/odoo/partnerDeProveedor.ts`
- Test: `lib/odoo/partnerDeProveedor.test.ts`

**Interfaces:**
- Consumes: `buscarPartnersPorCuit` de `lib/odoo/emisor.ts`; `elegirPartnerDelEmisor`, `type PartnerCandidato`, `type EleccionDelEmisor` de `lib/odoo/proveedores.ts`; `normalizarCuit` de `lib/core/cuit.ts`.
- Produces:
  - `export function dominioPorCuit(cuit: string): unknown[]`
  - `export function candidatosDelCuit(crudos: PartnerCandidato[], cuit: string, vatPorId: Map<number, string | false>): PartnerCandidato[]`
  - `export async function buscarCandidatos(cuit: string): Promise<PartnerCandidato[]>`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
/*
 * Medido el 23/11/2026 contra Odoo: de 1.639 partners con `vat`, 1.636 son
 * dígitos puros y DOS están guardados con guiones (`30-689471524`,
 * `33-655088429`). Un dominio `["vat","in",[11 dígitos]]` no los encuentra, la
 * pantalla diría "todavía no está en Odoo" y la generación de la orden crearía
 * el partner que ya existía — el anti-objetivo número uno del spec.
 */
it("el dominio busca el CUIT exacto Y por los últimos seis dígitos", () => {
  const d = dominioPorCuit("30-689471524");
  expect(JSON.stringify(d)).toContain("30689471524");
  expect(JSON.stringify(d)).toContain("471524");
});

it("el filtro acepta el partner guardado con guiones", () => {
  const vats = new Map([[7, "30-689471524"]]);
  const crudos = [{ id: 7, nombre: "X", empresa: 1, activo: true, esContactoDeOtro: false, usos: 3 }];
  expect(candidatosDelCuit(crudos, "30689471524", vats).map((c) => c.id)).toEqual([7]);
});

// El ilike de los seis dígitos puede traer a otro: se descarta en JS.
it("el filtro descarta al que sólo comparte los últimos seis dígitos", () => {
  const vats = new Map([[8, "27689471524"]]);
  const crudos = [{ id: 8, nombre: "Y", empresa: 1, activo: true, esContactoDeOtro: false, usos: 0 }];
  expect(candidatosDelCuit(crudos, "30689471524", vats)).toEqual([]);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/odoo/partnerDeProveedor.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar las tres en `lib/odoo/partnerDeProveedor.ts`**

`dominioPorCuit` devuelve `["|", ["vat", "=", <11 dígitos>], ["vat", "ilike", "%" + <últimos 6 dígitos> + "%"]]`. `buscarCandidatos` hace el `buscarLeer` con ese dominio, `active_test: false` y los campos de `emisor.ts` (`name, vat, company_id, active, parent_id, supplier_rank`), y pasa el resultado por `candidatosDelCuit`. El comentario del archivo explica por qué no alcanza el `in` de `buscarPartnersPorCuit` y por qué igual se reusa su forma de candidato.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/odoo/partnerDeProveedor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/odoo/partnerDeProveedor.ts lib/odoo/partnerDeProveedor.test.ts
git commit -F <archivo con el mensaje>
```
Mensaje: `feat(odoo): buscar un proveedor por CUIT sin que un guion lo esconda`

---

### Tarea 3: Armar y crear el `res.partner`

**Files:**
- Modify: `lib/odoo/partnerDeProveedor.ts`
- Modify: `lib/odoo/partnerDeProveedor.test.ts`

**Interfaces:**
- Consumes: `crearEn`, `buscarLeer`, `llamar` de `lib/odoo/client.ts`; lo de la Tarea 2.
- Produces:
  - `export function valsDelPartner(p: { nombre: string; cuit: string; tipoDocumentoId: number | null; regimenGanancias: string | null }): Record<string, unknown>`
  - `export async function tipoDeDocumentoCuit(): Promise<number | null>`
  - `export async function crearPartnerDeProveedor(datos: { nombre: string; cuit: string }, odooCompanyId: number): Promise<number>`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
/*
 * Medido el 23/11/2026 sobre los 658 partners con supplier_rank > 0:
 * 627 tienen `partner_document_type_id` = CUIT y 656 `income_wh_registration` = "1".
 */
it("el vals lleva el CUIT sin guiones y la marca de proveedor", () => {
  const v = valsDelPartner({ nombre: "X", cuit: "30-71182027-9", tipoDocumentoId: 25, regimenGanancias: "1" });
  expect(v.vat).toBe("30711820279");
  expect(v.supplier_rank).toBe(1);
  expect(v.name).toBe("X");
  expect(v.partner_document_type_id).toBe(25);
  expect(v.income_wh_registration).toBe("1");
});

/*
 * `supplier_rank` es lo que el cruce masivo de /api/odoo/proveedores/enlazar
 * usa para encontrarlo después: busca [["supplier_rank", ">", 0]]. Sin esto el
 * partner queda invisible y volvería a aparecer como "no está en Odoo".
 */
it("supplier_rank nunca es cero", () =>
  expect(valsDelPartner({ nombre: "X", cuit: "30711820279", tipoDocumentoId: null, regimenGanancias: "1" })
    .supplier_rank).toBe(1));

// No es `required` en Odoo: si el catálogo no tiene "CUIT", se crea sin él en
// vez de inventar un id.
it("sin tipo de documento el campo no viaja", () =>
  expect("partner_document_type_id" in
    valsDelPartner({ nombre: "X", cuit: "30711820279", tipoDocumentoId: null, regimenGanancias: "1" })).toBe(false));

// `income_wh_registration` sí es required: si default_get no lo dio, que no
// viaje en null — que falle en Odoo con su mensaje, no con uno inventado.
it("sin régimen el campo no viaja", () =>
  expect("income_wh_registration" in
    valsDelPartner({ nombre: "X", cuit: "30711820279", tipoDocumentoId: 25, regimenGanancias: null })).toBe(false));
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/odoo/partnerDeProveedor.test.ts`
Expected: FAIL — `valsDelPartner` no existe.

- [ ] **Step 3: Implementar las tres**

`tipoDeDocumentoCuit()` hace `buscarLeer("partner.document.type", [["name","=","CUIT"]], ["name"], { limite: 5 })` y devuelve el id o `null` — la constante con el nombre arriba del archivo, como `NOMBRE_IMPUESTO` en `contexto.ts`. `crearPartnerDeProveedor` pide el `income_wh_registration` con `llamar("res.partner","default_get",[["income_wh_registration"]], { context: { allowed_company_ids: [odooCompanyId], company_id: odooCompanyId } })`, arma el vals y llama a `crearEn("res.partner", odooCompanyId, vals)`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/odoo/partnerDeProveedor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/odoo/partnerDeProveedor.ts lib/odoo/partnerDeProveedor.test.ts
git commit -F <archivo con el mensaje>
```
Mensaje: `feat(odoo): crear el proveedor en Odoo completo, sin ids escritos a mano`

---

### Tarea 4: La ruta del alta

**Files:**
- Create: `app/api/compras/proveedores/con-odoo/route.ts`

**Interfaces:**
- Consumes: Tareas 1, 2 y 3; `puedeEditarCompras` de `lib/compras/auth.ts`; `createAdminClient`; `hayCredencialesOdoo`, `avisoDeCredencialesFaltantes` de `lib/odoo/client.ts`; `traerTodo` de `lib/core/paginado.ts`.
- Produces: `POST` que recibe `{ nombre, cuit, rubro?, contacto?, telefono?, email?, notas?, es_contratista?, plazo_pago_dias?, condicion_pago?, forma_pago?, requerimiento_id }` y devuelve `{ proveedor, enlaces: { empresa: string; partnerId: number }[], sinEnlazar: { empresa: string; motivo: string }[], avisoDeOdoo: string | null }`.

- [ ] **Step 1: Escribir la ruta**

Orden, y cada paso falla distinto:

1. Sesión y `puedeEditarCompras` → 401 / 403.
2. Traer el padrón con `traerTodo` (`id, nombre, cuit`) — son 484 filas y PostgREST corta en 1000.
3. `validarAlta`. Si hay problemas → 400 con el arreglo entero, incluido `proveedorExistente` cuando el CUIT ya está.
4. Insertar en `proveedores` con el cliente admin. Un 23505 de `nombre` se traduce a «Ya existe un proveedor con ese nombre».
5. Si no hay credenciales de Odoo, devolver 201 con `avisoDeOdoo` y los enlaces vacíos. **El alta no se cae porque Odoo no esté.**
6. `empresasDelRequerimiento` con el RI y las empresas. `buscarCandidatos(cuit)` una vez, y `elegirPartnerDelEmisor(candidatos, odooCompanyId)` por empresa.
7. Insertar en `proveedores_odoo` lo elegido. Un **23505** ahí es que ese partner ya es de otro proveedor del SdG: no es un error a mostrar crudo, es la señal del duplicado — se busca de quién es y se devuelve en `sinEnlazar` con el nombre de ese proveedor.
8. Completar `razon_social` **sólo si todos los partners elegidos traen el mismo `name`**; si difieren, queda en null (precedente de la migración del 11/11/2026: ese valor termina en un documento formal).
9. Cualquier fallo de Odoo de los pasos 6 a 8 se atrapa: el proveedor ya está creado y la respuesta es 201 con `avisoDeOdoo` diciendo lo que dijo Odoo, sin traducir.

El comentario de cabecera dice por qué esta ruta escribe `proveedores_odoo` siendo que esa tabla es de `admin`: porque el enlace no se elige a mano, se **deriva del CUIT**, y los tres frenos (candidato único, no archivado, no contacto hijo) lo acotan.

- [ ] **Step 2: Comprobar que compila y que la suite sigue verde**

Run: `npm run tipos && npx vitest run lib/compras lib/odoo`
Expected: 0 errores de tipos en los archivos tocados; tests en verde.

- [ ] **Step 3: Commit**

```bash
git add app/api/compras/proveedores/con-odoo/route.ts
git commit -F <archivo con el mensaje>
```
Mensaje: `feat(compras): el alta de proveedor que ademas lo enlaza con Odoo`

---

### Tarea 5: El modal y el botón

**Files:**
- Create: `app/(app)/compras/requerimientos/[id]/NuevoProveedorModal.tsx`
- Modify: `app/(app)/compras/requerimientos/[id]/PresupuestoForm.tsx`

**Interfaces:**
- Consumes: la ruta de la Tarea 4; `type ProveedorElegible` de `lib/compras/comparativa.ts`.
- Produces: `<NuevoProveedorModal requerimientoId onCerrar onCreado={(p: ProveedorElegible, aviso: string | null) => void} />`

- [ ] **Step 1: Escribir el modal**

Campos: **Nombre** y **CUIT** obligatorios; rubro, contacto, teléfono, email, notas, es contratista, plazo de pago, condición de pago, forma de pago. Grilla `grid-cols-1 sm:grid-cols-3`. El desplegable de forma de pago es `<Select>`. Un ancho junto a `.input` va en un `div` que envuelva el campo.

Mientras se escribe el nombre, con los parecidos que devolvió el servidor en el último intento: si hay, un cartel con la lista y un botón por cada uno para usar ése en vez de crear.

Al volver 400 con `proveedorExistente`, el cartel nombra al proveedor que ya tiene ese CUIT y ofrece usarlo.
Al volver 201, la pantalla dice en qué empresas quedó enlazado, o que todavía no está en Odoo y se va a crear al generar la orden, o los candidatos cuando no se pudo desempatar.

- [ ] **Step 2: Montar el botón en `PresupuestoForm`**

Junto al `SelectorProveedor` (líneas 131-138), un botón «Nuevo proveedor» que abre el modal. `onCreado` agrega el proveedor a la lista en memoria, lo elige con `elegirProveedor(p.id)` y cierra. **No se recarga la página**: lo ya tipeado del presupuesto no se pierde.

- [ ] **Step 3: Comprobar tipos, responsive y la suite**

Run: `npm run tipos && node scripts/revisar-responsive.mjs && npx vitest run`
Expected: 0 errores en los archivos tocados; `ROMPE 0`; suite en verde.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/compras/requerimientos/[id]/NuevoProveedorModal.tsx" "app/(app)/compras/requerimientos/[id]/PresupuestoForm.tsx"
git commit -F <archivo con el mensaje>
```
Mensaje: `feat(compras): dar de alta un proveedor sin salir de la carga del presupuesto`

---

### Tarea 6: Que la generación de la orden cree el partner que falta

**Files:**
- Modify: `lib/odoo/ordenDeCompra.ts`
- Modify: `lib/odoo/pushOrden.ts`
- Test: `lib/odoo/ordenDeCompra.test.ts`

**Interfaces:**
- Consumes: `crearPartnerDeProveedor`, `buscarCandidatos` de las Tareas 2 y 3; `armarOrdenes`, `type RequerimientoParaOrden`, `type Problema` de `lib/odoo/ordenDeCompra.ts`.
- Produces: `RequerimientoParaOrden` gana un campo `proveedorCuit: string | null`, y `Problema` gana la variante `{ tipo: "sin cuit"; detalle: string }`.

- [ ] **Step 1: Escribir el test que falla**

En `lib/odoo/ordenDeCompra.test.ts`, que ya prueba `armarOrdenes(...)` y tiene
los objetos de ejemplo armados arriba del archivo. Dos casos nuevos, los dos
con `odooPartnerId: null` en la empresa y cambiando sólo `proveedorCuit`:

```ts
/*
 * 40 de los 45 proveedores que hoy no llegan a una orden no tienen CUIT: para
 * ellos el problema NO es el enlace, y el mensaje que decía "no existe en
 * Odoo" mandaba a buscar en el lugar equivocado. Con CUIT el enlace se
 * resuelve solo en el push; sin CUIT no hay nada que resolver.
 */
it("sin CUIT el problema es el CUIT, no el enlace", () => {
  const r = armarOrdenes({ ...ri, proveedorCuit: null }, cotizacion, [sinPartner], contexto);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.problemas.map((p) => p.tipo)).toContain("sin cuit");
  expect(r.problemas.map((p) => p.tipo)).not.toContain("sin proveedor enlazado");
});

it("con CUIT y sin partner, el problema sigue siendo el enlace", () => {
  const r = armarOrdenes({ ...ri, proveedorCuit: "30711820279" }, cotizacion, [sinPartner], contexto);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.problemas.map((p) => p.tipo)).toContain("sin proveedor enlazado");
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/odoo/ordenDeCompra.test.ts`
Expected: FAIL

- [ ] **Step 3: Partir el problema en dos y crear el partner en el push**

En `ordenDeCompra.ts`, cuando `odooPartnerId` es null: si el proveedor no tiene CUIT, el detalle dice que falta el CUIT y dónde cargarlo; si lo tiene, queda el mensaje de hoy.

En `pushOrden.ts`, antes de armar `paraOrden`: para cada empresa sin `odooPartnerId` y con CUIT, **buscar primero** con `buscarCandidatos` + `elegirPartnerDelEmisor` —alguien pudo crearlo mientras tanto— y si no hay, `crearPartnerDeProveedor`. Guardar la fila de `proveedores_odoo` **inmediatamente después de cada creación**, como ya hace el guardado del vínculo de la orden: así un fallo en la segunda empresa no deja huérfano al partner de la primera.

En `ensayarOrdenesDeRequerimiento`, el mismo caso anuncia «se va a crear el proveedor en \<EMPRESA\>» en vez de darlo por problema. Ese ensayo es la confirmación previa: no se agrega otro botón.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/odoo`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/odoo/ordenDeCompra.ts lib/odoo/pushOrden.ts lib/odoo/ordenDeCompra.test.ts
git commit -F <archivo con el mensaje>
```
Mensaje: `feat(compras): la orden de compra crea en Odoo el proveedor que falta`

---

### Tarea 7: Lo que no se deduce del código

**Files:**
- Modify: `docs/COMPRAS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Escribir la sección en `docs/COMPRAS.md`**

`## Dar de alta un proveedor desde el presupuesto`, con: por qué el CUIT es obligatorio acá y no en `/compras/proveedores`; que el alta **lee** Odoo y no le escribe, y que el partner se crea al generar la orden; que la elección entre varios partners es `elegirPartnerDelEmisor` y que **no elegir** es un desenlace válido; que `supplier_rank: 1` es lo que lo hace visible para el cruce masivo; que esta ruta escribe una tabla de `admin` y por qué está acotado; y que **este cambio no destraba a los 40 sin CUIT que ya están en la lista**.

- [ ] **Step 2: Agregar el renglón a la tabla de `CLAUDE.md`**

En la fila de Compras, con enlace al spec y a este plan, y las tres cosas que no se deducen del código.

- [ ] **Step 3: Commit**

```bash
git add docs/COMPRAS.md CLAUDE.md
git commit -F <archivo con el mensaje>
```
Mensaje: `docs(compras): el alta de proveedor desde el presupuesto, con lo que no se deduce del codigo`

---

## Al terminar

```bash
npx vitest run
npm run tipos
node scripts/revisar-responsive.mjs
node scripts/revisar-exportaciones.mjs
node scripts/revisar-arbol-commiteado.mjs <ref>
```

**No se puede probar contra Odoo desde local**: el de `.env.local` es staging y está congelado desde el 11/09/2026. Lo que sólo se comprueba en la primera corrida real está en la última sección del spec, y la primera prueba va con **un RI de una sola empresa**, no con uno de AMBAS.

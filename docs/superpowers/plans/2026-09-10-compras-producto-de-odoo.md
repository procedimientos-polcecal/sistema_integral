# El producto de Odoo en la orden de compra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la orden de compra proponga el producto del catálogo de Odoo que corresponde según la descripción del requerimiento, y que Compras lo confirme antes de mandarla.

**Architecture:** Un emparejador **puro** decide, con la regla de la cabeza y sin aceptar parciales; lo aprendido vive en una tabla chica que se escribe al generar la orden; el catálogo se lee de Odoo en la previsualización; y la pantalla propone con un selector. El `POST` recibe el producto elegido, y sin él sigue siendo `ART. VARIOS`: nada regresiona.

**Tech Stack:** Next.js 16 (Route Handlers), Supabase (PostgREST), Odoo por JSON-RPC (`lib/odoo/client.ts`), vitest.

**Spec:** [docs/superpowers/specs/2026-09-10-compras-producto-de-odoo-design.md](../specs/2026-09-10-compras-producto-de-odoo-design.md) — etapa 1. La etapa 2 (confirmar la orden y el PDF) queda afuera y tiene un obstáculo medido.

---

## Lo que hay que saber antes de tocar

**El producto de una línea de compra es un `product.product`, no un
`product.template`.** `lib/odoo/contexto.ts` ya lee `product.product` para
`ART. VARIOS`; el catálogo nuevo y la tabla de lo aprendido guardan ids de
`product.product`. Confundirlos crea órdenes que Odoo rechaza o, peor, que
apuntan a otro producto.

**Medido el 10/09/2026 contra staging:** 378 comprables, todos con unidad
`Unidades`, todos compartidos entre las dos empresas. Existe un producto `FLETE`.

**Los nombres del catálogo son rubros** (`GUANTES`, `CABLES`, `BUJES`), no SKUs.

---

### Task 1: El emparejador

Puro, sin I/O. Es donde está la decisión y por eso es donde están los tests.

**Files:**
- Create: `lib/compras/productoOdoo.ts`
- Create: `lib/compras/productoOdoo.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/compras/productoOdoo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizarDescripcion, sugerirProducto, type ProductoDeOdoo,
} from "./productoOdoo";

/** Una muestra del catalogo real, con los casos que importan. */
const CATALOGO: ProductoDeOdoo[] = [
  { id: 1, nombre: "GUANTES" },
  { id: 2, nombre: "GRASAS" },
  { id: 3, nombre: "CABLES" },
  { id: 4, nombre: "FICHAS" },
  { id: 5, nombre: "LLAVE DE IMPACTO" },
  { id: 6, nombre: "LLAVES ALLEN" },
  { id: 7, nombre: "SELLADOR SILICONADO ACÉTICO" },
  { id: 8, nombre: "SELLADOR SILICONADO NEUTRO" },
  { id: 9, nombre: "TUBO DE ENCASTRE" },
  { id: 10, nombre: "BOLSAS CAL GÜEMES" },
  { id: 11, nombre: "ART. VARIOS" },
];

describe("normalizar una descripcion", () => {
  it("unifica mayusculas, acentos y plural", () => {
    // Las tres formas en que la misma cosa aparece escrita en los RI reales.
    const esperado = normalizarDescripcion("GUANTE");
    expect(normalizarDescripcion("Guantes")).toBe(esperado);
    expect(normalizarDescripcion("guantes")).toBe(esperado);
    expect(normalizarDescripcion(" Guánte ")).toBe(esperado);
  });

  it("saca la puntuacion y las palabras vacias", () => {
    expect(normalizarDescripcion('Cable tipo TPR 3 x 4 mm2 (x metro)')).toBe("CABLE TPR 3 4 MM2 METRO");
  });

  it("una descripcion vacia no rompe", () => {
    expect(normalizarDescripcion("")).toBe("");
    expect(normalizarDescripcion("   ")).toBe("");
  });
});

describe("sugerir el producto de Odoo", () => {
  const sugerir = (desc: string, aprendidos = new Map<string, number>()) =>
    sugerirProducto(desc, CATALOGO, aprendidos);

  it("la cabeza manda: 'Guantes de grasa' es GUANTES y no GRASAS", () => {
    // El prototipo que puntuaba por cobertura del nombre daba GRASAS, que es
    // exactamente el error que no se nota: la orden se lee bien y el gasto va a
    // otra cuenta contable.
    const r = sugerir("Guantes de grasa");
    expect(r.motivo).toBe("sugerido");
    expect(r.producto?.nombre).toBe("GUANTES");
  });

  it("acepta cuando el nombre del producto entra entero", () => {
    expect(sugerir("Ficha Macho 32A - 3P+N+T").producto?.nombre).toBe("FICHAS");
    expect(sugerir("Cable tipo TPR 3 x 4 mm2 (x metro)").producto?.nombre).toBe("CABLES");
    expect(sugerir("SELLADOR SILICONADO ACETICO TUBO").producto?.nombre).toBe("SELLADOR SILICONADO ACÉTICO");
  });

  it("NO acepta parciales, aunque compartan la cabeza", () => {
    // Medido sobre 300 RI: en esta franja el match esta mayormente mal. Es la
    // decision que sostiene todo el diseño.
    const r = sugerir("Llave combinada fija 13mm");
    expect(r.motivo).toBe("sin_sugerencia");
    expect(r.producto).toBeNull();
  });

  it("otro parcial de los medidos: un tubo estructural no es un TUBO DE ENCASTRE", () => {
    expect(sugerir('Tubo estructural 1"').motivo).toBe("sin_sugerencia");
  });

  it("sin cabeza que coincida no sugiere nada", () => {
    expect(sugerir("Modulo llave punto Kalop").motivo).toBe("sin_sugerencia");
    expect(sugerir("16x60").motivo).toBe("sin_sugerencia");
    expect(sugerir("").motivo).toBe("sin_sugerencia");
  });

  it("con empate gana el nombre mas corto y los otros van como alternativas", () => {
    // "SELLADOR SILICONADO" solo, sin decir cual, empata con los dos.
    const r = sugerir("SELLADOR SILICONADO");
    expect(r.motivo).toBe("sin_sugerencia");
    expect(r.alternativas.map((p) => p.nombre).sort()).toEqual([
      "SELLADOR SILICONADO ACÉTICO", "SELLADOR SILICONADO NEUTRO",
    ]);
  });

  it("lo aprendido gana sobre la regla", () => {
    const aprendidos = new Map([[normalizarDescripcion("Guantes de grasa"), 2]]);
    const r = sugerir("Guantes de grasa", aprendidos);
    expect(r.motivo).toBe("aprendido");
    expect(r.producto?.nombre).toBe("GRASAS");
  });

  it("lo aprendido que ya no esta en el catalogo se ignora en vez de romper", () => {
    // Alguien archivo el producto en Odoo. Se cae a la regla, no se propone un
    // id que la orden va a rechazar.
    const aprendidos = new Map([[normalizarDescripcion("Guantes de grasa"), 999]]);
    expect(sugerir("Guantes de grasa", aprendidos).motivo).toBe("sugerido");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/compras/productoOdoo.test.ts`
Expected: FAIL — `Failed to resolve import "./productoOdoo"`

- [ ] **Step 3: Escribir la implementación**

Crear `lib/compras/productoOdoo.ts`:

```ts
/**
 * Qué producto del catálogo de Odoo le corresponde a un requerimiento.
 *
 * Toda orden generada desde el SdG llevaba `ART. VARIOS`. La descripción del RI
 * va en el `name` de la línea —que es lo que se ve e imprime—, así que la orden
 * se leía bien; lo que quedaba mal es la **cuenta contable**, que la aporta el
 * producto, y con eso todo el gasto del módulo caía en la misma bolsa.
 *
 * POR QUÉ LA CABEZA
 *
 * El catálogo de Odoo no son SKUs sino rubros —`GUANTES`, `CABLES`, `BUJES`—.
 * Un primer prototipo puntuaba por "qué proporción del nombre del producto
 * aparece en la descripción" y **fallaba con confianza**: `Guantes de grasa`
 * daba `GRASAS`, y `MASCARILLA CON VÁLVULA` daba `VÁLVULAS`. Exigir que la
 * primera palabra significativa de la descripción sea también la primera del
 * producto arregla justo esos casos, con la misma cobertura.
 *
 * POR QUÉ NO SE ACEPTAN LOS PARCIALES
 *
 * Medido sobre 300 requerimientos reales: la franja que comparte la cabeza pero
 * no el resto del nombre son 29 (10%), y ahí el match está **mayormente mal**
 * —`Llave combinada fija 13mm` → `LLAVE DE IMPACTO`, `Rollo de Papel Higiénico`
 * → `ROLLO PAPEL FILM`, `Bolsas de cal Moreno` → `BOLSAS CAL GÜEMES`, que es
 * otra marca—. Un producto equivocado no se nota nunca. Se prefiere no sugerir.
 *
 * Cobertura medida con esta regla: 160 de 300 (53%) sugeridos, 111 (37%) sin
 * sugerencia. Lo que falta lo va llenando la tabla de lo aprendido.
 */

/** Un producto comprable de Odoo. El id es de `product.product`. */
export interface ProductoDeOdoo {
  id: number;
  nombre: string;
}

export type MotivoDeSugerencia = "aprendido" | "sugerido" | "sin_sugerencia";

export interface Sugerencia {
  /** `null` cuando no hay nada con qué arriesgar: la orden usa `ART. VARIOS`. */
  producto: ProductoDeOdoo | null;
  motivo: MotivoDeSugerencia;
  /** Los que empataron, para que la pantalla los ofrezca a un clic. */
  alternativas: ProductoDeOdoo[];
}

/**
 * Palabras que no distinguen nada.
 *
 * Van las preposiciones y las unidades: `Cable de 3 mm` y `Cable 3mm` tienen que
 * dar lo mismo. No van los adjetivos ni los materiales —`GOMA`, `ACERO`—, que sí
 * distinguen un producto de otro.
 */
const VACIAS = new Set([
  "DE", "DEL", "LA", "EL", "LOS", "LAS", "PARA", "CON", "SIN", "POR", "UN",
  "UNA", "EN", "MM", "CM", "MT", "MTS", "KG", "LTS", "UNIDAD", "TIPO",
]);

/**
 * Plural tosco: saca la `S` final de las palabras de 4 letras o más.
 *
 * `GUANTES` → `GUANTE`, y así el rubro en plural del catálogo empareja con la
 * descripción en singular. Se deja corta a propósito: `GAS` no es `GA`.
 */
const raiz = (palabra: string) =>
  palabra.length >= 4 && palabra.endsWith("S") ? palabra.slice(0, -1) : palabra;

/** El texto listo para comparar, y la clave de lo aprendido. */
export function normalizarDescripcion(texto: string): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (texto: string) =>
  normalizarDescripcion(texto)
    .split(" ")
    .filter((p) => p.length >= 3 && !VACIAS.has(p))
    .map(raiz);

export function sugerirProducto(
  descripcion: string,
  catalogo: ProductoDeOdoo[],
  /** Descripción normalizada → id de `product.product`, de lo ya confirmado. */
  aprendidos: Map<string, number>
): Sugerencia {
  const sinNada: Sugerencia = { producto: null, motivo: "sin_sugerencia", alternativas: [] };

  const aprendido = aprendidos.get(normalizarDescripcion(descripcion));
  if (aprendido !== undefined) {
    const p = catalogo.find((c) => c.id === aprendido);
    // Un producto archivado en Odoo ya no está en el catálogo: se cae a la
    // regla en vez de proponer un id que la orden va a rechazar.
    if (p) return { producto: p, motivo: "aprendido", alternativas: [] };
  }

  const dela = tokens(descripcion);
  if (dela.length === 0) return sinNada;

  const enDescripcion = new Set(dela);
  const candidatos = catalogo
    .map((p) => ({ p, toks: tokens(p.nombre) }))
    .filter(({ toks }) => toks.length > 0 && toks[0] === dela[0])
    // Entero: todos los tokens del producto están en la descripción.
    .filter(({ toks }) => toks.every((t) => enDescripcion.has(t)));

  if (candidatos.length === 0) {
    // Los que comparten la cabeza pero no entran enteros se ofrecen como
    // alternativas: no se sugieren, pero ahorran buscarlos en 378 nombres.
    const mismaCabeza = catalogo.filter((p) => {
      const t = tokens(p.nombre);
      return t.length > 0 && t[0] === dela[0];
    });
    return { ...sinNada, alternativas: mismaCabeza };
  }

  // Con empate gana el nombre más corto, que es el más genérico: entre
  // `GUANTES` y `GUANTES DE NITRILO` para "Guantes", el rubro.
  const ordenados = [...candidatos].sort(
    (a, b) => a.toks.length - b.toks.length || a.p.nombre.length - b.p.nombre.length
  );
  const gana = ordenados[0];
  const empatan = ordenados.filter((c) => c.toks.length === gana.toks.length);

  // Dos productos igual de específicos y los dos entran enteros: no hay con qué
  // elegir, así que se ofrecen los dos y no se arriesga ninguno.
  if (empatan.length > 1) {
    return { ...sinNada, alternativas: empatan.map((c) => c.p) };
  }

  return {
    producto: gana.p,
    motivo: "sugerido",
    alternativas: ordenados.slice(1).map((c) => c.p),
  };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run lib/compras/productoOdoo.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Verificar por mutación que los tests muerden**

Sacá el filtro de "entra entero" (la segunda línea de `.filter`), corré el test y confirmá que falla el de los parciales. Volvé a dejar el archivo como estaba.

- [ ] **Step 6: Commit**

```bash
git add lib/compras/productoOdoo.ts lib/compras/productoOdoo.test.ts
git commit -m "feat(compras): que producto de Odoo le corresponde a un requerimiento"
```

---

### Task 2: La tabla de lo aprendido

**Files:**
- Create: `supabase/migrations/<timestamp>_compras_producto_de_odoo.sql`

- [ ] **Step 1: Crear el archivo con el nombre correcto**

Run: `npm run migracion "compras producto de odoo"`

El timestamp no se escribe a mano. **Antes de escribirla, leé las ocho trampas de `supabase/migrations/README.md`.**

- [ ] **Step 2: Escribir la migración**

```sql
-- ============================================================
-- SdG — Compras: qué producto de Odoo le corresponde a un pedido
--
-- La orden de compra proponía siempre `ART. VARIOS`. El emparejador de
-- `lib/compras/productoOdoo.ts` acierta el 53% por la forma del nombre; esta
-- tabla es lo que hace que el resto se aprenda con el uso, en vez de quedarse
-- ahí para siempre.
--
-- Guarda la descripción NORMALIZADA y nunca generaliza por la primera palabra.
-- En el catálogo hay cabezas ambiguas —`LLAVE` es `LLAVE DE IMPACTO` o `LLAVES
-- ALLEN`, `TUBO` es `TUBO DE ENCASTRE` o un caño estructural—, así que atar la
-- cabeza a lo último que alguien eligió haría sugerir mal seguido. Y una
-- sugerencia mala que se confirma sin mirar es peor que no sugerir: el producto
-- equivocado no se nota, porque la descripción del pedido igual va en el texto
-- de la línea, y lo único que queda mal es la cuenta contable.
--
-- El id es de `product.product`, que es lo que lleva `purchase.order.line`, y
-- NO de `product.template`. El nombre se guarda al lado como copia para poder
-- mostrarlo sin salir a Odoo.
-- ============================================================

create table if not exists compras_producto_odoo (
  descripcion_normalizada text primary key,
  odoo_product_id         integer not null,
  odoo_product_nombre     text not null,
  -- Cuántas órdenes lo usaron. Sirve para saber qué se repite de verdad.
  veces                   integer not null default 1,
  created_by              uuid references usuarios(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

drop trigger if exists compras_producto_odoo_updated_at on compras_producto_odoo;
create trigger compras_producto_odoo_updated_at
  before update on compras_producto_odoo
  for each row execute function set_updated_at();

alter table compras_producto_odoo enable row level security;

-- Se lee para sugerir y se escribe al generar la orden, siempre desde el
-- servidor con el cliente admin. Igual queda legible para authenticated, como
-- el resto de los catálogos del módulo.
drop policy if exists compras_producto_odoo_lectura on compras_producto_odoo;
create policy compras_producto_odoo_lectura on compras_producto_odoo
  for select to authenticated using (true);

comment on table compras_producto_odoo is
  'Qué producto de Odoo (product.product) se eligió para una descripción de requerimiento. '
  'Se escribe al generar la orden, con lo confirmado. Sólo descripción exacta: no generaliza.';
```

- [ ] **Step 3: Verificar que `set_updated_at` existe**

Run: `grep -rn "function set_updated_at" supabase/migrations/ | head -2`
Expected: aparece en `001_nucleo_schema.sql`. Si no existiera, la migración fallaría entera por el trigger.

- [ ] **Step 4: Commit y avisar**

```bash
git add supabase/migrations/
git commit -m "feat(compras): la tabla de lo aprendido del producto de Odoo"
```

**La migración la corre el usuario a mano en el editor SQL de Supabase.** Las tareas 6 y 7 dependen de que esté aplicada: hay que decirlo en el reporte, no darlo por hecho.

---

### Task 3: El catálogo comprable de Odoo

**Files:**
- Create: `lib/odoo/catalogo.ts`

- [ ] **Step 1: Escribir el lector**

```ts
/**
 * El catálogo de productos comprables de Odoo.
 *
 * Son `product.product` y no `product.template`: es lo que lleva el
 * `product_id` de `purchase.order.line`. Medido el 10/09/2026: 378 comprables,
 * todos compartidos entre las dos empresas y todos con unidad `Unidades`.
 *
 * Se lee entero —son 378 nombres, una llamada— porque el emparejador necesita
 * verlos todos para saber si hay empate, y la pantalla los necesita para el
 * selector.
 */

import { buscarLeer } from "@/lib/odoo/client";
import type { ProductoDeOdoo } from "@/lib/compras/productoOdoo";

/** La unidad de compra de cada producto, que la línea de la orden necesita. */
export interface ProductoComprable extends ProductoDeOdoo {
  uomId: number | null;
}

export async function leerCatalogoComprable(): Promise<ProductoComprable[]> {
  const crudos = await buscarLeer<{
    id: number;
    display_name: string;
    uom_po_id: [number, string] | false;
  }>(
    "product.product",
    [
      ["purchase_ok", "=", true],
      ["active", "=", true],
    ],
    ["display_name", "uom_po_id"],
    { limite: 2000, orden: "display_name asc" }
  );

  return crudos.map((p) => ({
    id: p.id,
    nombre: p.display_name,
    uomId: p.uom_po_id ? p.uom_po_id[0] : null,
  }));
}
```

- [ ] **Step 2: Verificar contra Odoo de verdad**

Las credenciales están en `.env.local` y **leer no toca nada**. Escribí un script temporal en `scripts/_probar-catalogo.mts` que cargue `.env.local`, llame a `leerCatalogoComprable()` e imprima cuántos vinieron, los primeros cinco y cuántos tienen `uomId` en null. Confirmá que son ~378 y que `ART. VARIOS` está entre ellos. **Borrá el script después.**

- [ ] **Step 3: Commit**

```bash
git add lib/odoo/catalogo.ts
git commit -m "feat(odoo): el catalogo de productos comprables"
```

---

### Task 4: El contexto suma el producto del flete

**Files:**
- Modify: `lib/odoo/contexto.ts`

- [ ] **Step 1: Leer el producto `FLETE` junto con `ART. VARIOS`**

En `lib/odoo/contexto.ts`, al lado de `NOMBRE_PRODUCTO_GENERICO`, agregar:

```ts
/**
 * El producto de la línea de flete.
 *
 * Antes también era `ART. VARIOS`. El grupo ya tiene uno hecho —`FLETE`—, así
 * que la línea del envío deja de mezclarse con el resto del gasto. No hay nada
 * que decidir acá: es determinístico, a diferencia del producto del ítem.
 */
const NOMBRE_PRODUCTO_FLETE = "FLETE";
```

Sumar la lectura al `Promise.all` existente, con la misma forma que la de `ART. VARIOS` (`product.product`, `purchase_ok = true`, `limite: 5`), y agregar a `ContextoDeOdoo`:

```ts
  /**
   * El producto de la línea de flete. `null` si no está en el catálogo: ahí la
   * línea usa el genérico, como antes, en vez de no poder crear la orden.
   */
  fleteId: number | null;
```

**No suma un problema bloqueante si falta.** El flete con el producto genérico es lo que pasa hoy: degradar a eso es correcto, y fallar la orden entera por un producto de más no lo es.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit && npx vitest run lib/odoo`
Expected: sin errores. Si algún test arma un `ContextoDeOdoo` a mano, hay que sumarle `fleteId` — es un campo nuevo obligatorio del tipo.

- [ ] **Step 3: Commit**

```bash
git add lib/odoo/contexto.ts
git commit -m "feat(odoo): el contexto conoce el producto de flete"
```

---

### Task 5: La orden usa el producto elegido

**Files:**
- Modify: `lib/odoo/ordenDeCompra.ts`
- Modify: `lib/odoo/ordenDeCompra.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `lib/odoo/ordenDeCompra.test.ts` un `describe` nuevo. Usá el mismo armado de `ri`, `cotizacion`, `empresas` y `contexto` que ya usan los tests de ese archivo —copialos del test de más arriba— y sumá `fleteId` al contexto:

```ts
describe("el producto de la linea", () => {
  it("usa el elegido cuando viene, y no el generico", () => {
    // El producto es lo que aporta la cuenta contable. Con ART. VARIOS en todas
    // las ordenes, todo el gasto del modulo cae en la misma bolsa.
    const r = armarOrdenes(RI, COTIZACION, EMPRESAS, CONTEXTO, { id: 77, uomId: 1 });
    expect(r.ordenes[0].vals.order_line[0][2].product_id).toBe(77);
  });

  it("sin producto elegido sigue siendo el generico: nada regresiona", () => {
    const r = armarOrdenes(RI, COTIZACION, EMPRESAS, CONTEXTO);
    expect(r.ordenes[0].vals.order_line[0][2].product_id).toBe(CONTEXTO.productoGenericoId);
  });

  it("la linea de flete usa el producto de flete, no el elegido ni el generico", () => {
    const r = armarOrdenes(RI, { ...COTIZACION, costoEnvio: 5000 }, EMPRESAS, CONTEXTO, { id: 77, uomId: 1 });
    const flete = r.ordenes[0].vals.order_line.find((l) => l[2].name === "Flete");
    expect(flete?.[2].product_id).toBe(CONTEXTO.fleteId);
  });

  it("sin producto de flete en el catalogo, la linea de flete usa el generico", () => {
    const r = armarOrdenes(RI, { ...COTIZACION, costoEnvio: 5000 }, EMPRESAS, { ...CONTEXTO, fleteId: null }, { id: 77, uomId: 1 });
    const flete = r.ordenes[0].vals.order_line.find((l) => l[2].name === "Flete");
    expect(flete?.[2].product_id).toBe(CONTEXTO.productoGenericoId);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/odoo/ordenDeCompra.test.ts`
Expected: FAIL — `armarOrdenes` no acepta el quinto argumento.

- [ ] **Step 3: Implementar**

En `lib/odoo/ordenDeCompra.ts`:

**3a.** `armarOrdenes` suma un quinto parámetro opcional y se lo pasa a `armarUna`:

```ts
export function armarOrdenes(
  ri: RequerimientoParaOrden,
  cotizacion: CotizacionParaOrden,
  empresas: EmpresaParaOrden[],
  contexto: ContextoDeOdoo,
  /**
   * El producto que Compras confirmó para el ítem. Sin él, el genérico: una
   * pantalla vieja que no lo manda sigue creando la orden como antes.
   */
  producto?: { id: number; uomId: number | null }
): ResultadoDeArmado {
```

**3b.** En `armarUna`, el mismo parámetro, y los `obligatorios` pasan a:

```ts
  const obligatorios = {
    product_id: producto?.id ?? contexto.productoGenericoId,
    // La unidad es la del producto elegido. Hoy las 378 son `Unidades`, así que
    // no cambia nada; el día que alguien cargue un producto en kilos, Odoo
    // rechaza la línea si la unidad no es la de su categoría.
    product_uom: producto?.uomId ?? contexto.uomId,
    date_planned: ri.fechaNecesidad
      ? `${ri.fechaNecesidad} 00:00:00`
      : fechaParaOdoo(contexto.ahora),
    taxes_id: [[6, 0, [empresa.impuestoId!]]] as [[6, 0, number[]]],
  };
```

**3c.** La línea de flete pisa el producto con el del flete:

```ts
    lineas.push({
      ...obligatorios,
      // El flete tiene su propio producto en el catálogo: no comparte cuenta
      // con el ítem. Si no está, el genérico, que es lo que pasaba antes.
      product_id: contexto.fleteId ?? contexto.productoGenericoId,
      product_uom: contexto.uomId,
      name: "Flete",
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/odoo && npx tsc --noEmit`
Expected: pasan los nuevos y los que ya estaban.

- [ ] **Step 5: Commit**

```bash
git add lib/odoo/ordenDeCompra.ts lib/odoo/ordenDeCompra.test.ts
git commit -m "feat(odoo): la linea lleva el producto elegido y el flete el suyo"
```

---

### Task 6: El ensayo sugiere y el push recibe lo confirmado

**Files:**
- Modify: `lib/odoo/pushOrden.ts`
- Modify: `app/api/compras/requerimientos/[id]/odoo/route.ts`

- [ ] **Step 1: El ensayo devuelve la sugerencia y el catálogo**

En `ensayarOrdenesDeRequerimiento`, después de resolver `fuente` y antes de armar la respuesta, sumar:

```ts
  /*
   * La sugerencia y el catálogo viajan con el ensayo porque la pantalla los
   * necesita juntos: el selector muestra los 378 y arranca en el sugerido.
   *
   * Si Odoo no contesta el catálogo, la pantalla ofrece el genérico y lo dice,
   * en vez de trabar la generación de la orden por una sugerencia.
   */
  let catalogo: ProductoComprable[] = [];
  let sugerencia: Sugerencia = { producto: null, motivo: "sin_sugerencia", alternativas: [] };
  try {
    catalogo = await leerCatalogoComprable();
    const { data: filas } = await admin
      .from("compras_producto_odoo")
      .select("descripcion_normalizada, odoo_product_id");
    const aprendidos = new Map(
      (filas ?? []).map((f) => [f.descripcion_normalizada as string, f.odoo_product_id as number])
    );
    sugerencia = sugerirProducto(ri.descripcion, catalogo, aprendidos);
  } catch {
    // Sin catálogo no hay sugerencia, y con eso la orden sigue siendo posible.
  }
```

y agregarlos al objeto que se devuelve: `producto: { sugerencia, catalogo }`.

- [ ] **Step 2: El push recibe el producto elegido, lo valida y lo aprende**

`empujarOrdenesDeRequerimiento` suma un tercer parámetro:

```ts
export async function empujarOrdenesDeRequerimiento(
  admin: SupabaseClient,
  requerimientoId: string,
  /**
   * El producto que Compras confirmó, y quién lo confirmó.
   *
   * Sin esto la orden usa `ART. VARIOS`, que es lo que hacía siempre: una
   * pantalla vieja no rompe. El id se valida contra el catálogo antes de usarlo
   * —un id que no existe o no es comprable hace fallar la orden entera con un
   * error de Odoo que no dice nada útil—.
   */
  elegido?: { productoId: number; usuarioId: string | null }
): Promise<ResultadoDelPush> {
```

Antes de armar las órdenes, resolver el producto:

```ts
  let producto: ProductoComprable | undefined;
  if (elegido) {
    const catalogo = await leerCatalogoComprable();
    const encontrado = catalogo.find((p) => p.id === elegido.productoId);
    if (!encontrado) {
      return await anotarPendiente(admin, ri.id, [
        `El producto ${elegido.productoId} no está en el catálogo comprable de Odoo: ` +
          `puede haberse archivado. Elegí otro y volvé a intentar.`,
      ]);
    }
    producto = encontrado;
  }
```

pasarlo a `armarOrdenes(..., producto && { id: producto.id, uomId: producto.uomId })`, y **después de que la orden se creó bien**, guardar lo aprendido:

```ts
  /*
   * Lo aprendido se guarda con la orden ya creada, no antes: si la creación
   * falla, no queda atado un producto que nunca se usó.
   *
   * Se guarda también cuando Compras confirmó la sugerencia sin cambiarla —no
   * sólo cuando corrigió—: una confirmación es información igual, y es lo que
   * hace que la segunda vez no haya que mirar.
   */
  if (producto) {
    const clave = normalizarDescripcion(ri.descripcion);
    if (clave) {
      const { error } = await admin.from("compras_producto_odoo").upsert(
        {
          descripcion_normalizada: clave,
          odoo_product_id: producto.id,
          odoo_product_nombre: producto.nombre,
          created_by: elegido?.usuarioId ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "descripcion_normalizada" }
      );
      // No se voltea la orden por no poder aprender: la orden ya está en Odoo.
      if (error) console.error(`RI ${ri.nro_ri}: no se pudo guardar el producto aprendido`, error);
    }
  }
```

> `veces` no se incrementa en el upsert —PostgREST no sabe sumar— y no vale una consulta extra por orden. Queda en 1; si algún día importa, se cuenta con una función en la base.

- [ ] **Step 3: La ruta pasa el producto y el usuario**

En `app/api/compras/requerimientos/[id]/odoo/route.ts`, el `POST` deja de ignorar el cuerpo:

```ts
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const paso = await permiso();
  if ("error" in paso) return paso.error;

  const { id } = await params;
  // El cuerpo es opcional: sin él la orden usa el producto genérico, como antes.
  const body = await request.json().catch(() => null);
  const productoId = Number(body?.producto_id);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  try {
    const resultado = await empujarOrdenesDeRequerimiento(
      createAdminClient(),
      id,
      Number.isInteger(productoId) && productoId > 0
        ? { productoId, usuarioId: user?.id ?? null }
        : undefined
    );
```

y el docstring del archivo, que hoy dice que nunca se confirma nada, suma que el producto lo elige Compras.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/odoo/pushOrden.ts "app/api/compras/requerimientos/[id]/odoo/route.ts"
git commit -m "feat(compras): la orden se crea con el producto que Compras confirmo"
```

---

### Task 7: La pantalla propone y deja cambiar

**Files:**
- Modify: `app/(app)/compras/requerimientos/[id]/OrdenEnOdoo.tsx`

- [ ] **Step 1: Leer la pantalla entera antes de tocarla**

Ya tiene el ensayo (`GET`) y el botón que crea (`POST`). El selector va **junto al botón**, no en otra pantalla: se elige y se manda en el mismo gesto.

- [ ] **Step 2: Guardar el producto elegido en estado**

Cuando llega el ensayo, arrancar el estado en `ensayo.producto.sugerencia.producto?.id ?? ""`. El selector es un `<select>` con las opciones del catálogo (`ensayo.producto.catalogo`), ordenadas por nombre, más una opción vacía que dice `ART. VARIOS (genérico)`.

Debajo del selector, una línea que explique de dónde salió, según el motivo:

- `aprendido` → `Ya se usó este producto para un pedido igual.`
- `sugerido` → `Sugerido por la descripción del pedido.`
- `sin_sugerencia` con alternativas → `No hay una coincidencia clara. Estos se parecen: …` (los nombres de `alternativas`).
- `sin_sugerencia` sin alternativas → `Sin coincidencia: va como ART. VARIOS.`

- [ ] **Step 3: Mandarlo en el POST**

```ts
    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/odoo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productoId ? { producto_id: Number(productoId) } : {}),
    });
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores. **No se puede probar en el navegador** —todo está detrás del login—, así que la verificación es de tipos y de lectura.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/compras/requerimientos/[id]/OrdenEnOdoo.tsx"
git commit -m "feat(compras): la pantalla propone el producto de Odoo y deja cambiarlo"
```

---

### Task 8: Los documentos

**Files:**
- Modify: `docs/ODOO-INTEGRACION.md`
- Modify: `docs/COMPRAS-ESTADO.md`

- [ ] **Step 1: La integración**

En `docs/ODOO-INTEGRACION.md`, donde dice que las líneas llevan `ART. VARIOS`, corregirlo: el producto lo propone el emparejador y lo confirma Compras, el flete tiene el suyo, y lo aprendido vive en `compras_producto_odoo`. Con los números medidos (53% sugerido, 37% genérico) y por qué no se aceptan los parciales.

- [ ] **Step 2: La trampa, para la próxima**

En `docs/COMPRAS-ESTADO.md`, antes de `## Lo que quedó pendiente`:

```markdown
**El catálogo de Odoo no son SKUs, son rubros.** 432 productos, 378 comprables,
todos compartidos entre las dos empresas y sólo 51 con código: `GUANTES`,
`CABLES`, `BUJES`. Emparejar por código no sirve; emparejar por nombre sí, pero
sólo con la regla de la cabeza —la primera palabra significativa de la
descripción tiene que ser la primera del producto—. Un prototipo que puntuaba
por cobertura del nombre daba `Guantes de grasa → GRASAS` y `MASCARILLA CON
VÁLVULA → VÁLVULAS`: fallaba **con confianza**, que es lo peor, porque un
producto equivocado no se nota —la descripción igual va en el texto de la
línea— y lo único que queda mal es la cuenta contable.

Por lo mismo **no se aceptan los emparejamientos parciales**: medido sobre 300
requerimientos, esa franja son 29 y está mayormente mal (`Llave combinada fija
13mm` → `LLAVE DE IMPACTO`, `Bolsas de cal Moreno` → `BOLSAS CAL GÜEMES`, que es
otra marca). Se prefiere `ART. VARIOS` y que Compras elija.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ODOO-INTEGRACION.md docs/COMPRAS-ESTADO.md
git commit -m "docs(compras): el producto de Odoo sale de la descripcion del pedido"
```

---

## Verificación de punta a punta, después de la última tarea

Todo está detrás del login, así que la verificación es con datos reales:

1. **Correr la migración** en el editor SQL de Supabase.
2. Abrir un RI aprobado con presupuesto elegido y mirar el ensayo: que el
   producto sugerido tenga sentido y que el selector traiga los 378.
3. Generar la orden **contra staging** (`ODOO_URL` ya apunta ahí) y comprobar en
   Odoo que la línea tiene el producto elegido y que el flete tiene `FLETE`.
4. Consultar `compras_producto_odoo` y confirmar que quedó la fila.
5. Volver a abrir el ensayo del mismo RI: el motivo tiene que ser `aprendido`.

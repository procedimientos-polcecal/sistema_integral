# Para reponer — plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que Inventario tenga una pantalla con lo que hay que reponer —faltante *y* consumo reciente— y que desde ahí se abra el formulario de alta de Compras precargado, sin pedir dos veces lo mismo.

**Arquitectura:** una función pura decide qué entra, qué se ordena primero y qué ya está pedido; la pantalla sólo la llama y muestra. El alta no se construye: se reusa `NuevoRequerimientoModal` de Compras, que ya acepta valores precargados y que ya usan otras tres pantallas. **Este plan no modifica ningún archivo de Compras.**

**Stack:** Next.js 16 (App Router, Server Components), Supabase (PostgREST), Vitest.

**Spec:** [docs/superpowers/specs/2026-10-02-inventario-reponer-design.md](../specs/2026-10-02-inventario-reponer-design.md)

---

## Estructura de archivos

| Archivo | Responsabilidad | Estado |
|---|---|---|
| `lib/inventario/reponer.ts` | Qué es faltante, qué es "se usa", qué es "ya pedido", y en qué orden | crear |
| `lib/inventario/reponer.test.ts` | | crear |
| `app/(app)/inventario/reponer/page.tsx` | Trae los tres conjuntos y los catálogos del formulario | crear |
| `app/(app)/inventario/reponer/ReponerClient.tsx` | Las dos listas y el botón que abre el modal | crear |
| `lib/core/nav.ts` | La entrada en el menú | modificar |

**La pantalla de stock, la de artículos y todo Compras quedan intactas.**

---

## Contexto que hace falta antes de empezar

Cosas del repo que no se deducen del código que vas a tocar. Cada una ahorra un error:

- **Todo se escribe en castellano**: nombres, comentarios, textos de pantalla y mensajes de commit. Los comentarios explican **por qué**, no qué.
- **Mirá `git status` en su propia llamada, antes de tocar nada.** Suele haber otra sesión en el mismo árbol. **Nunca `git add -A`**, y ojo: `git commit` sin rutas commitea **el índice entero**, no lo que acabás de agregar — si la primera columna de `git status --short` muestra `M` (staged por otro), usá `git commit --only -- <tus rutas>`. Esto ya se cobró tres commits en este repo.
- Si `tsc` o los tests fallan en archivos que no tocaste, es la otra sesión. No los arregles.
- **PostgREST corta en 1000 filas y no avisa.** Todo lo que pueda crecer se lee con `traerTodo()` de `lib/core/paginado.ts`.
- **Un `select()` armado en una variable pierde la inferencia de tipos de Supabase.** La cadena va literal.
- `npm run lint` tiene 21 errores preexistentes y no está en el CI. **No lo corras.**
- **`npm test` cuenta cada test una vez por worktree abierto** si hay alguno en `.claude/worktrees/`. Ya está excluido en `vitest.config.ts`; si ves el doble, mirá si alguien agregó un worktree.

Verificación:

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
node scripts/revisar-arbol-commiteado.mjs
```

El último mira **el árbol commiteado** y no el disco: es el que atrapa un archivo nuevo que quedó sin commitear mientras los que lo importan sí viajaron. Corrélo **solo**, nunca encadenado con `&&` ni con `| tail` — el código de salida de una tubería es el del último comando.

---

## Lo que ya existe y hay que reusar, no reescribir

**`NuevoRequerimientoModal`** (`app/(app)/compras/requerimientos/NuevoRequerimientoModal.tsx`) recibe:

```ts
{
  areas: {id, nombre}[];
  empresas: {id, nombre}[];
  ubicaciones: {id, nombre}[];
  inicial?: { descripcion?, codigo?, cantidad?, detalle?, ubicacionId?, equipoId? };  // ValoresIniciales
  onClose: () => void;
  onSaved: () => void;
}
```

Lo llaman hoy `RequerimientosClient`, `AvisosClient`, `RepuestosOTModal` y `MisPedidosClient`. **Mirá `RepuestosOTModal.tsx` líneas ~214-228**: es el ejemplo más parecido a lo que vas a hacer.

Los tres catálogos se traen así (copiado de `app/(app)/mis-pedidos/page.tsx`):

```ts
supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
supabase.from("empresas").select("id, nombre").order("nombre"),
supabase.from("compras_ubicaciones").select("id, nombre").eq("activo", true).order("orden"),
```

**Permisos:** no hay nada que agregar. `compras_req_select` es `using (true)` para cualquier autenticado —"el circuito de compras es transversal a toda la empresa", migración 018— y el `insert` permite a cualquier usuario activo cargar un pedido a su propio nombre. Alguien que sólo tenga Inventario puede ver los RI y crear uno.

---

## Tarea 1: la decisión — qué reponer y en qué orden

**Archivos:**
- Crear: `lib/inventario/reponer.ts`
- Crear: `lib/inventario/reponer.test.ts`

Es el corazón del cambio. Las tres decisiones viven acá —qué es faltante, qué cuenta como consumo, qué cuenta como ya pedido— porque un corte mal puesto hace que alguien pida de más o que no vea lo que se acabó, y eso no se nota mirando la pantalla.

- [ ] **Paso 1: escribir los tests que fallan**

Crear `lib/inventario/reponer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clasificarParaReponer, estaAbierto, DIAS_DE_CONSUMO } from "./reponer";
import type { ArticuloConFaltante, MovimientoDelConsumo, RequerimientoConCodigo } from "./reponer";

const HOY = "2026-10-02";

const art = (p: Partial<ArticuloConFaltante> = {}): ArticuloConFaltante => ({
  id: "a1",
  codigo: "00018",
  descripcion: "AIRE COMPRIMIDO AEROSOL",
  stock_actual: 0,
  stock_seguridad: 2,
  faltante: 2,
  activo: true,
  ...p,
});

const salida = (codigo: string, fecha: string): MovimientoDelConsumo =>
  ({ codigo, tipo: "salida", fecha });

const ri = (p: Partial<RequerimientoConCodigo> = {}): RequerimientoConCodigo => ({
  id: "r1",
  nro_ri: 2015,
  codigo: "00018",
  fecha: "2026-09-22",
  estado_aprobacion: "APROBADA",
  estado_compra: "PEDIDO",
  ...p,
});

describe("que RI esta abierto", () => {
  it("un pedido en curso esta abierto", () => {
    expect(estaAbierto(ri({ estado_compra: "PEDIDO" }))).toBe(true);
    expect(estaAbierto(ri({ estado_compra: "SIN_INICIAR" }))).toBe(true);
    expect(estaAbierto(ri({ estado_compra: "PARA_COMPRAR" }))).toBe(true);
  });

  it("recibido y denegado lo cierran", () => {
    expect(estaAbierto(ri({ estado_compra: "RECIBIDO" }))).toBe(false);
    expect(estaAbierto(ri({ estado_compra: "DENEGADO" }))).toBe(false);
  });

  it("una aprobacion denegada lo cierra aunque la compra no diga nada", () => {
    expect(estaAbierto(ri({ estado_aprobacion: "DENEGADA", estado_compra: null }))).toBe(false);
  });

  /** Sin estado de compra es un pedido que recien entra, no uno cerrado. */
  it("sin estado de compra sigue abierto", () => {
    expect(estaAbierto(ri({ estado_compra: null }))).toBe(true);
  });
});

describe("que entra en para reponer", () => {
  it("faltante y consumo reciente entra", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-09-20")], [], HOY);
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["00018"]);
    expect(r.yaPedidos).toEqual([]);
  });

  it("sin faltante no entra, aunque se haya usado ayer", () => {
    const r = clasificarParaReponer(
      [art({ faltante: 0, stock_actual: 5 })],
      [salida("00018", "2026-10-01")],
      [],
      HOY
    );
    expect(r.paraPedir).toEqual([]);
    expect(r.yaPedidos).toEqual([]);
  });

  /**
   * El caso de los 402: con faltante, en cero, y sin moverse en seis meses.
   * Es el ruido que esta pantalla existe para no mostrar.
   */
  it("con faltante pero sin salidas en la ventana no entra, aunque este en cero", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-03-01")], [], HOY);
    expect(r.paraPedir).toEqual([]);
  });

  it("un articulo sin ningun movimiento no entra", () => {
    const r = clasificarParaReponer([art()], [], [], HOY);
    expect(r.paraPedir).toEqual([]);
  });

  it("una salida de hace exactamente 90 dias entra; una de 91 no", () => {
    const justo = clasificarParaReponer([art()], [salida("00018", "2026-07-04")], [], HOY);
    expect(justo.paraPedir).toHaveLength(1);

    const tarde = clasificarParaReponer([art()], [salida("00018", "2026-07-03")], [], HOY);
    expect(tarde.paraPedir).toEqual([]);
  });

  /** Una entrada repone, no consume: no puede justificar que haya que pedir mas. */
  it("una entrada no cuenta como consumo", () => {
    const r = clasificarParaReponer(
      [art()],
      [{ codigo: "00018", tipo: "entrada", fecha: "2026-09-20" }],
      [],
      HOY
    );
    expect(r.paraPedir).toEqual([]);
  });

  it("un ajuste tampoco cuenta", () => {
    const r = clasificarParaReponer(
      [art()],
      [{ codigo: "00018", tipo: "ajuste", fecha: "2026-09-20" }],
      [],
      HOY
    );
    expect(r.paraPedir).toEqual([]);
  });

  it("un articulo inactivo no entra en ninguno de los dos", () => {
    const r = clasificarParaReponer(
      [art({ activo: false })],
      [salida("00018", "2026-09-20")],
      [ri()],
      HOY
    );
    expect(r.paraPedir).toEqual([]);
    expect(r.yaPedidos).toEqual([]);
  });

  it("una salida con fecha en el futuro no cuenta", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-10-20")], [], HOY);
    expect(r.paraPedir).toEqual([]);
  });

  it("una salida sin fecha no rompe ni cuenta", () => {
    const r = clasificarParaReponer(
      [art()],
      [{ codigo: "00018", tipo: "salida", fecha: null }],
      [],
      HOY
    );
    expect(r.paraPedir).toEqual([]);
  });

  it("cuenta las salidas y dice hace cuanto fue la ultima", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20"), salida("00018", "2026-09-30"), salida("00018", "2026-08-01")],
      [],
      HOY
    );
    expect(r.paraPedir[0].salidas).toBe(3);
    expect(r.paraPedir[0].diasDesdeLaUltima).toBe(2);
  });
});

describe("lo que ya esta pedido", () => {
  it("con un RI abierto va a yaPedidos y no a paraPedir", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-09-20")], [ri()], HOY);
    expect(r.paraPedir).toEqual([]);
    expect(r.yaPedidos).toHaveLength(1);
    expect(r.yaPedidos[0].ri.nro_ri).toBe(2015);
    expect(r.yaPedidos[0].cuantosAbiertos).toBe(1);
    expect(r.yaPedidos[0].diasDelRi).toBe(10);
  });

  it("si su unico RI esta recibido vuelve a paraPedir", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ estado_compra: "RECIBIDO" })],
      HOY
    );
    expect(r.paraPedir).toHaveLength(1);
    expect(r.yaPedidos).toEqual([]);
  });

  it("si su unico RI esta denegado vuelve a paraPedir", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ estado_aprobacion: "DENEGADA" })],
      HOY
    );
    expect(r.paraPedir).toHaveLength(1);
  });

  /**
   * El caso del 00666, que tiene tres abiertos: el 1956 de hace 22 dias y los
   * 983/984 de hace 175. Se informa el mas nuevo y cuantos hay.
   */
  it("con varios RI abiertos informa el mas nuevo y cuantos son", () => {
    const r = clasificarParaReponer(
      [art({ codigo: "00666" })],
      [salida("00666", "2026-09-20")],
      [
        ri({ id: "viejo", nro_ri: 983, codigo: "00666", fecha: "2026-04-10" }),
        ri({ id: "nuevo", nro_ri: 1956, codigo: "00666", fecha: "2026-09-10" }),
        ri({ id: "otro", nro_ri: 984, codigo: "00666", fecha: "2026-04-10" }),
      ],
      HOY
    );
    expect(r.yaPedidos[0].ri.nro_ri).toBe(1956);
    expect(r.yaPedidos[0].cuantosAbiertos).toBe(3);
  });

  it("un RI de otro codigo no lo afecta", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ codigo: "99999" })],
      HOY
    );
    expect(r.paraPedir).toHaveLength(1);
  });

  it("un RI sin codigo no lo afecta", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ codigo: null })],
      HOY
    );
    expect(r.paraPedir).toHaveLength(1);
  });

  it("el codigo se compara sin espacios de sobra", () => {
    const r = clasificarParaReponer(
      [art({ codigo: " 00018 " })],
      [salida("00018", "2026-09-20")],
      [ri({ codigo: "00018 " })],
      HOY
    );
    expect(r.yaPedidos).toHaveLength(1);
  });
});

describe("el orden", () => {
  it("paraPedir va por cantidad de salidas, de mayor a menor", () => {
    const r = clasificarParaReponer(
      [art({ id: "a", codigo: "A" }), art({ id: "b", codigo: "B" }), art({ id: "c", codigo: "C" })],
      [
        salida("A", "2026-09-20"),
        salida("B", "2026-09-20"), salida("B", "2026-09-21"), salida("B", "2026-09-22"),
        salida("C", "2026-09-20"), salida("C", "2026-09-21"),
      ],
      [],
      HOY
    );
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["B", "C", "A"]);
  });

  /** Empatados en salidas, primero el que se uso hace menos. */
  it("a igual cantidad de salidas, primero el mas reciente", () => {
    const r = clasificarParaReponer(
      [art({ id: "a", codigo: "A" }), art({ id: "b", codigo: "B" })],
      [salida("A", "2026-08-01"), salida("B", "2026-09-30")],
      [],
      HOY
    );
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["B", "A"]);
  });

  it("empatados en todo, por codigo, para que el orden no dependa de la consulta", () => {
    const r = clasificarParaReponer(
      [art({ id: "b", codigo: "B" }), art({ id: "a", codigo: "A" })],
      [salida("A", "2026-09-20"), salida("B", "2026-09-20")],
      [],
      HOY
    );
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["A", "B"]);
  });

  it("yaPedidos usa el mismo orden", () => {
    const r = clasificarParaReponer(
      [art({ id: "a", codigo: "A" }), art({ id: "b", codigo: "B" })],
      [salida("A", "2026-09-20"), salida("B", "2026-09-20"), salida("B", "2026-09-21")],
      [ri({ id: "ra", codigo: "A" }), ri({ id: "rb", codigo: "B" })],
      HOY
    );
    expect(r.yaPedidos.map((c) => c.articulo.codigo)).toEqual(["B", "A"]);
  });
});

describe("la ventana", () => {
  it("son 90 dias", () => {
    expect(DIAS_DE_CONSUMO).toBe(90);
  });
});
```

- [ ] **Paso 2: correr los tests para ver que fallan**

```bash
npx vitest run lib/inventario/reponer.test.ts
```

Esperado: FAIL — no existe `./reponer`.

- [ ] **Paso 3: escribir la implementación**

Crear `lib/inventario/reponer.ts`:

```ts
/**
 * Qué hay que reponer, y qué no hace falta pedir porque ya está pedido.
 *
 * EL FALTANTE NO ES UNA COLA DE TRABAJO. Medido el 02/10/2026: **521 de los
 * 1.159 artículos tienen faltante** —el 45% del catálogo— y sólo 24 tienen un
 * RI abierto. Quedan 497 "pendientes" que nadie cargó en años, así que esa
 * lista es una referencia y no una bandeja.
 *
 * Lo que la vuelve accionable no es el stock sino **el consumo**: 402 de esos
 * 497 no se movieron en seis meses. Con el corte de acá abajo quedan 92, que se
 * parten en 75 para pedir y 17 que ya tienen pedido — una lista que alguien
 * puede terminar.
 *
 * Esto vive aparte de la pantalla porque es la parte que decide. Un corte mal
 * puesto hace que se pida de más o que no se vea lo que se acabó, y ninguna de
 * las dos cosas se nota mirando la pantalla.
 */

/** La ventana de consumo, en días. */
export const DIAS_DE_CONSUMO = 90;

/**
 * Qué estados cierran un pedido. Todo lo demás —`SIN_INICIAR`,
 * `PARA_COMPRAR`, `EN_COMPARATIVA`, `EN_ESPERA`, `APROBADO`, `PEDIDO`— cuenta
 * como abierto.
 */
const COMPRA_CERRADA = new Set(["RECIBIDO", "DENEGADO"]);

export interface ArticuloConFaltante {
  id: string;
  codigo: string;
  descripcion: string;
  stock_actual: number;
  stock_seguridad: number;
  faltante: number;
  activo?: boolean | null;
}

/**
 * Un movimiento con su tipo, **no una salida ya filtrada**.
 *
 * El filtro va adentro a propósito: que una entrada no justifique un pedido es
 * una de las decisiones de esta función, y si la consulta la filtrara, acá no
 * habría nada que probar.
 */
export interface MovimientoDelConsumo {
  codigo: string;
  tipo: string;
  /** ISO `2026-09-30`, o null: el kardex tiene filas sin fecha. */
  fecha: string | null;
}

export interface RequerimientoConCodigo {
  id: string;
  nro_ri: number;
  codigo: string | null;
  fecha: string | null;
  estado_aprobacion: string | null;
  estado_compra: string | null;
}

export interface Candidato {
  articulo: ArticuloConFaltante;
  /** Cuántas salidas tuvo dentro de la ventana. */
  salidas: number;
  /** Hace cuántos días fue la última. */
  diasDesdeLaUltima: number;
}

export interface ConPedido extends Candidato {
  /** El RI abierto más nuevo. */
  ri: RequerimientoConCodigo;
  /** Cuántos abiertos tiene ese código. Más de uno ya pasa: el 00666 tiene tres. */
  cuantosAbiertos: number;
  /** Hace cuántos días se pidió. */
  diasDelRi: number;
}

export interface Reposicion {
  paraPedir: Candidato[];
  yaPedidos: ConPedido[];
}

/**
 * Si un pedido sigue en curso.
 *
 * `estado_compra` en null es un pedido que recién entra, no uno cerrado: la
 * fila nace así hasta que Compras la toma.
 */
export function estaAbierto(
  ri: Pick<RequerimientoConCodigo, "estado_aprobacion" | "estado_compra">
): boolean {
  if (ri.estado_aprobacion === "DENEGADA") return false;
  return !COMPRA_CERRADA.has(String(ri.estado_compra ?? ""));
}

/** Días entre dos fechas ISO, en UTC para que no dependa del huso de quien mire. */
function diasEntre(desde: string, hasta: string): number | null {
  const a = Date.parse(`${desde.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

const clave = (v: string | null | undefined) => String(v ?? "").trim();

/**
 * Parte los artículos en los dos grupos de la pantalla.
 *
 * Entra el que tiene faltante, está activo y tuvo **al menos una salida** en la
 * ventana. Se ordena por cantidad de salidas: lo que más se mueve queda arriba,
 * que es como se corta una lista larga sin tener que decidir dónde termina.
 *
 * El que además tiene un RI abierto va a `yaPedidos` y no a `paraPedir`, con
 * cuál es y de cuándo. No se oculta: quien busca algo que sabe que falta tiene
 * que poder distinguir "el sistema no lo vio" de "ya está pedido", que son dos
 * problemas con dos arreglos distintos.
 */
export function clasificarParaReponer(
  articulos: ArticuloConFaltante[],
  movimientos: MovimientoDelConsumo[],
  requerimientos: RequerimientoConCodigo[],
  hoy: string
): Reposicion {
  // El consumo, por código: cuántas salidas y cuál fue la última.
  const consumo = new Map<string, { salidas: number; diasDesdeLaUltima: number }>();
  for (const m of movimientos) {
    if (m.tipo !== "salida") continue;
    const c = clave(m.codigo);
    if (!c || !m.fecha) continue;

    const d = diasEntre(m.fecha, hoy);
    // Fuera de la ventana, o en el futuro —que es una fila mal cargada y no un
    // consumo—, no cuenta.
    if (d === null || d < 0 || d > DIAS_DE_CONSUMO) continue;

    const previo = consumo.get(c);
    consumo.set(c, {
      salidas: (previo?.salidas ?? 0) + 1,
      diasDesdeLaUltima: Math.min(previo?.diasDesdeLaUltima ?? d, d),
    });
  }

  // Los pedidos abiertos, por código, del más nuevo al más viejo.
  const abiertos = new Map<string, RequerimientoConCodigo[]>();
  for (const r of requerimientos) {
    const c = clave(r.codigo);
    if (!c || !estaAbierto(r)) continue;
    if (!abiertos.has(c)) abiertos.set(c, []);
    abiertos.get(c)!.push(r);
  }
  for (const lista of abiertos.values()) {
    lista.sort((a, b) => String(b.fecha ?? "").localeCompare(String(a.fecha ?? "")));
  }

  const paraPedir: Candidato[] = [];
  const yaPedidos: ConPedido[] = [];

  for (const articulo of articulos) {
    if (articulo.activo === false) continue;
    if (!(Number(articulo.faltante) > 0)) continue;

    const c = clave(articulo.codigo);
    const uso = consumo.get(c);
    if (!uso) continue;

    const base: Candidato = { articulo, salidas: uso.salidas, diasDesdeLaUltima: uso.diasDesdeLaUltima };
    const pedidos = abiertos.get(c);

    if (!pedidos || pedidos.length === 0) {
      paraPedir.push(base);
      continue;
    }

    const ri = pedidos[0];
    yaPedidos.push({
      ...base,
      ri,
      cuantosAbiertos: pedidos.length,
      diasDelRi: (ri.fecha ? diasEntre(ri.fecha, hoy) : null) ?? 0,
    });
  }

  // Primero lo que más se mueve; a igual uso, lo más reciente; y a igual todo,
  // por código — si no, el orden lo decide en qué orden vino la consulta y la
  // pantalla se reordena sola entre dos cargas.
  const orden = (a: Candidato, b: Candidato) =>
    b.salidas - a.salidas ||
    a.diasDesdeLaUltima - b.diasDesdeLaUltima ||
    clave(a.articulo.codigo).localeCompare(clave(b.articulo.codigo));

  paraPedir.sort(orden);
  yaPedidos.sort(orden);

  return { paraPedir, yaPedidos };
}
```

- [ ] **Paso 4: correr los tests**

```bash
npx vitest run lib/inventario/reponer.test.ts
```

Esperado: PASS, los 27 casos.

- [ ] **Paso 5: la suite entera y los tipos**

```bash
npm test
```

```bash
npx tsc --noEmit
```

- [ ] **Paso 6: commitear**

Mirá `git status --short` **en su propia llamada** primero. Si hay archivos con `M` en la primera columna que no son tuyos, commiteá con `--only`.

```bash
git add lib/inventario/reponer.ts lib/inventario/reponer.test.ts
```

```bash
git commit -m "feat(inventario): que reponer y que no, que el faltante solo no lo dice"
```

---

## Tarea 2: la pantalla

**Archivos:**
- Crear: `app/(app)/inventario/reponer/page.tsx`
- Crear: `app/(app)/inventario/reponer/ReponerClient.tsx`

**Requiere la Tarea 1.** Esta tarea deja la pantalla andando **sin** el botón de pedir, que es la Tarea 3.

- [ ] **Paso 1: la página**

Crear `app/(app)/inventario/reponer/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe } from "@/lib/inventario/auth";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina, sumarDias } from "@/lib/core/fechas";
import {
  clasificarParaReponer, DIAS_DE_CONSUMO,
  type ArticuloConFaltante, type MovimientoDelConsumo, type RequerimientoConCodigo,
} from "@/lib/inventario/reponer";
import ReponerClient from "./ReponerClient";

/**
 * Qué hay que reponer: faltante **y** consumo reciente.
 *
 * El faltante solo no alcanza —521 artículos lo tienen, el 45% del catálogo—
 * así que lo que decide es la función pura de `lib/inventario/reponer.ts`, que
 * tiene los números medidos y el porqué del corte.
 *
 * Los catálogos del formulario de Compras se traen acá, chicos y enseguida,
 * porque el modal del alta los necesita apenas alguien aprieta Pedir. Es lo
 * mismo que hace `/mis-pedidos`.
 */
export default async function ReponerPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelInventarioDe(supabase, user.id);
  if (!nivel) redirect("/");

  const hoy = hoyEnArgentina();
  const desde = sumarDias(hoy, -DIAS_DE_CONSUMO);

  const [articulos, movimientos, requerimientos, { data: areas }, { data: empresas }, { data: ubicaciones }] =
    await Promise.all([
      // `traerTodo` y no `.limit()`: PostgREST corta en 1000 y no avisa, y hoy
      // hay 521 artículos con faltante.
      traerTodo<ArticuloConFaltante>((d, h) =>
        supabase.from("inventario_articulos")
          .select("id, codigo, descripcion, stock_actual, stock_seguridad, faltante, activo")
          .gt("faltante", 0).eq("activo", true).range(d, h)
      ),
      // Filtrado por fecha en la consulta: son ~4.200 movimientos en total y
      // traerlos todos para mirar un trimestre no tiene sentido. El tipo **no**
      // se filtra acá —lo hace la función pura, que es donde se puede probar
      // que una entrada no justifica un pedido.
      traerTodo<MovimientoDelConsumo>((d, h) =>
        supabase.from("inventario_movimientos")
          .select("codigo, tipo, fecha").gte("fecha", desde).range(d, h)
      ),
      traerTodo<RequerimientoConCodigo>((d, h) =>
        supabase.from("compras_requerimientos")
          .select("id, nro_ri, codigo, fecha, estado_aprobacion, estado_compra")
          .not("codigo", "is", null).range(d, h)
      ),
      supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
      supabase.from("empresas").select("id, nombre").order("nombre"),
      supabase.from("compras_ubicaciones").select("id, nombre").eq("activo", true).order("orden"),
    ]);

  const { paraPedir, yaPedidos } = clasificarParaReponer(articulos, movimientos, requerimientos, hoy);

  return (
    <ReponerClient
      paraPedir={paraPedir}
      yaPedidos={yaPedidos}
      areas={areas ?? []}
      empresas={empresas ?? []}
      ubicaciones={ubicaciones ?? []}
    />
  );
}
```

- [ ] **Paso 2: la pantalla**

Crear `app/(app)/inventario/reponer/ReponerClient.tsx`:

```tsx
"use client";

import Link from "next/link";
import { DIAS_DE_CONSUMO, type Candidato, type ConPedido } from "@/lib/inventario/reponer";
import { COMPRA_LABELS } from "@/lib/compras/constants";

type Opcion = { id: string; nombre: string };

/**
 * Qué reponer, en dos grupos.
 *
 * La separación es el punto. Arriba lo que hay que pedir; abajo lo que ya tiene
 * un pedido, diciendo cuál y de cuándo. Ocultar lo segundo dejaría a quien busca
 * algo que sabe que falta sin saber si el sistema no lo vio o si ya está pedido,
 * y son dos problemas con dos arreglos distintos.
 */
export default function ReponerClient({
  paraPedir, yaPedidos,
}: {
  paraPedir: Candidato[];
  yaPedidos: ConPedido[];
  areas: Opcion[];
  empresas: Opcion[];
  ubicaciones: Opcion[];
}) {
  return (
    <div className="space-y-6 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Para reponer</h1>
        <p className="text-sm text-slate-500">
          Artículos por debajo del stock de seguridad que además se usaron en los
          últimos {DIAS_DE_CONSUMO} días. El que no se mueve hace meses no entra
          acá: está en{" "}
          <Link href="/inventario/stock?faltantes=1" className="underline hover:text-slate-700">
            el stock con faltante
          </Link>.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="section-title">
          Para pedir <span className="font-normal text-slate-400">· {paraPedir.length}</span>
        </h2>

        {paraPedir.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
            No hay nada para reponer.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {paraPedir.map((c) => (
              <li key={c.articulo.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Detalle c={c} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {yaPedidos.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">
            Ya pedidos <span className="font-normal text-slate-400">· {yaPedidos.length}</span>
          </h2>
          <p className="text-xs text-slate-500">
            Faltan y se usan, pero ya tienen un pedido en curso. No hace falta
            volver a pedirlos.
          </p>

          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {yaPedidos.map((c) => (
              <li key={c.articulo.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Detalle c={c} />
                <span className="shrink-0 text-xs text-slate-500">
                  <Link href={`/compras/requerimientos/${c.ri.id}`} className="underline hover:text-slate-900">
                    RI {c.ri.nro_ri}
                  </Link>
                  {" · "}
                  {c.diasDelRi === 0 ? "hoy" : `hace ${c.diasDelRi} días`}
                  {c.cuantosAbiertos > 1 && ` · ${c.cuantosAbiertos} pedidos abiertos`}
                  {" "}
                  <span className={`rounded px-1.5 py-0.5 ${COMPRA_LABELS[c.ri.estado_compra as keyof typeof COMPRA_LABELS]?.color ?? "bg-gray-100 text-gray-600"}`}>
                    {COMPRA_LABELS[c.ri.estado_compra as keyof typeof COMPRA_LABELS]?.label ?? "Sin iniciar"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Lo que se ve de un artículo, igual en los dos grupos. */
function Detalle({ c }: { c: Candidato }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-slate-900">{c.articulo.descripcion}</p>
      <p className="text-xs text-slate-500">
        <span className="font-mono">{c.articulo.codigo}</span>
        {" · "}
        <span className={c.articulo.stock_actual === 0 ? "font-semibold text-red-600" : ""}>
          {c.articulo.stock_actual}
        </span>
        {" de un mínimo de "}{c.articulo.stock_seguridad}
        {" · "}
        {c.salidas === 1 ? "1 salida" : `${c.salidas} salidas`} en {DIAS_DE_CONSUMO} días
        {", la última "}
        {c.diasDesdeLaUltima === 0 ? "hoy" : `hace ${c.diasDesdeLaUltima} días`}
      </p>
    </div>
  );
}
```

Las props `areas`, `empresas` y `ubicaciones` entran acá sin usarse todavía: las usa el modal de la Tarea 3. Dejarlas puestas evita tocar la página dos veces.

- [ ] **Paso 3: comprobar que compila**

```bash
npx tsc --noEmit
```

Esperado: sin errores. Si se queja por `areas`/`empresas`/`ubicaciones` sin usar, **no las saques**: en este repo eso no es un error de `tsc`, y si tu configuración lo marca, decilo en el reporte en vez de cambiar el diseño.

- [ ] **Paso 4: comprobar los datos de verdad**

La pantalla está detrás del login, así que se comprueba corriendo la misma clasificación contra la base. Script en el directorio temporal de la sesión —**no en el repo**— y borralo al terminar:

```ts
import { readFileSync } from "node:fs";
for (const l of readFileSync("C:/Users/Usuario/Desktop/SdG PP/.env.local","utf-8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: K!, Authorization: `Bearer ${K}` };
async function todo(p: string) { const out: any[] = [];
  for (let d = 0; ; d += 1000) {
    const j = await (await fetch(`${U}/rest/v1/${p}&offset=${d}&limit=1000`, { headers: h })).json();
    if (!Array.isArray(j)) { console.log("ERR", j); return out; }
    out.push(...j); if (j.length < 1000) return out; } }

const { clasificarParaReponer, DIAS_DE_CONSUMO } =
  await import("file:///C:/Users/Usuario/Desktop/SdG%20PP/lib/inventario/reponer.ts");

const hoy = "2026-10-02";
const desde = "2026-07-04";
const arts = await todo("inventario_articulos?select=id,codigo,descripcion,stock_actual,stock_seguridad,faltante,activo&faltante=gt.0&activo=is.true");
const movs = await todo(`inventario_movimientos?select=codigo,tipo,fecha&fecha=gte.${desde}`);
const ris  = await todo("compras_requerimientos?select=id,nro_ri,codigo,fecha,estado_aprobacion,estado_compra&codigo=not.is.null");

const r = clasificarParaReponer(arts, movs, ris, hoy);
console.log("ventana:", DIAS_DE_CONSUMO, "dias | articulos con faltante:", arts.length);
console.log("PARA PEDIR:", r.paraPedir.length, " YA PEDIDOS:", r.yaPedidos.length);
console.log("\nlos 8 primeros para pedir:");
for (const c of r.paraPedir.slice(0, 8))
  console.log(`  ${c.articulo.codigo}  ${String(c.salidas).padStart(2)} salidas  ultima hace ${String(c.diasDesdeLaUltima).padStart(3)}d  | ${String(c.articulo.descripcion).slice(0, 38)}`);
console.log("\nlos ya pedidos:");
for (const c of r.yaPedidos)
  console.log(`  ${c.articulo.codigo}  RI ${c.ri.nro_ri} hace ${c.diasDelRi}d (${c.ri.estado_compra})${c.cuantosAbiertos > 1 ? ` [${c.cuantosAbiertos} abiertos]` : ""}`);
```

Correrlo con `npx tsx <ruta>` **desde la raíz del repo**, para que `tsx` resuelva el alias `@/`.

Esperado, con la fecha de hoy del spec: **75 para pedir y 17 ya pedidos**. Los números se mueven con cada sincronización, así que si no dan exactamente eso **no los fuerces**: lo que tiene que cumplirse es que `paraPedir + yaPedidos` sea mucho menor que los artículos con faltante (del orden de 90 contra 521), que entre los ya pedidos aparezca el `00666` con **3 abiertos**, y que ningún código esté en los dos grupos. Si algo de eso falla, decilo en el reporte con los números reales.

- [ ] **Paso 5: commitear**

`git status --short` en su propia llamada primero.

```bash
git add "app/(app)/inventario/reponer/page.tsx" "app/(app)/inventario/reponer/ReponerClient.tsx"
```

```bash
git commit -m "feat(inventario): la pantalla de lo que hay que reponer"
```

---

## Tarea 3: el botón «Pedir»

**Archivos:**
- Modificar: `app/(app)/inventario/reponer/ReponerClient.tsx`

**Requiere la Tarea 2.**

El alta no se construye. Se abre `NuevoRequerimientoModal` de Compras, el mismo que usan los avisos de Mantenimiento, los repuestos de una OT y Mis pedidos. **No toques ningún archivo de Compras.**

- [ ] **Paso 1: el estado y el modal**

En `ReponerClient.tsx`, agregar a los imports:

```tsx
import { useState } from "react";
import NuevoRequerimientoModal, {
  type ValoresIniciales,
} from "@/app/(app)/compras/requerimientos/NuevoRequerimientoModal";
```

`ValoresIniciales` ya está exportado en la línea 20 de ese archivo — comprobado. **No toques nada de Compras**: sólo importás.

Dentro del componente, antes del `return`:

```tsx
  const [pidiendo, setPidiendo] = useState<ValoresIniciales | null>(null);
  const [pedido, setPedido] = useState("");

  /**
   * Qué se le propone al formulario.
   *
   * La cantidad es el **stock de seguridad** y no el faltante, que es lo que ya
   * hace el Apps Script de la planilla, y lo medido le da la razón: se compra
   * por lote y no por diferencia —falta 2 pidió 4, falta 15 pidió 30, falta 1
   * pidió 10—. Ninguno de los pedidos reales pidió el faltante exacto.
   *
   * Todo es editable antes de enviar: esto propone, no decide.
   */
  const alta = (c: Candidato): ValoresIniciales => ({
    descripcion: c.articulo.descripcion,
    codigo: c.articulo.codigo,
    cantidad: String(c.articulo.stock_seguridad),
    detalle: `Reposición de stock. Había ${c.articulo.stock_actual} de un mínimo de ${c.articulo.stock_seguridad}.`,
  });
```

- [ ] **Paso 2: el botón en cada fila de «Para pedir»**

Dentro del `<li>` del grupo `paraPedir`, después de `<Detalle c={c} />`:

```tsx
                <button
                  onClick={() => setPidiendo(alta(c))}
                  className="shrink-0 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-dark)]"
                >
                  Pedir
                </button>
```

**En `yaPedidos` no va ningún botón.** Ese grupo existe para decir que no hay que hacer nada.

- [ ] **Paso 3: el aviso y el modal**

Antes del `</div>` que cierra el componente:

```tsx
      {pedido && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          {pedido} Lo vas a ver en{" "}
          <Link href="/mis-pedidos" className="underline">Mis pedidos</Link>.
          {" "}Va a desaparecer de esta lista en la próxima sincronización.
        </p>
      )}

      {/* El formulario de Compras, tal cual: uno solo para los dos lados, así un
          campo que se agregue allá aparece acá sin que nadie se acuerde. Se
          abre, no se envía — el paso de aprobación que hoy da una persona
          apretando GENERAR PEDIDO en la planilla se conserva igual. */}
      {pidiendo && (
        <NuevoRequerimientoModal
          areas={areas}
          empresas={empresas}
          ubicaciones={ubicaciones}
          inicial={pidiendo}
          onClose={() => setPidiendo(null)}
          onSaved={() => {
            setPedido(`Pedido cargado: ${pidiendo.descripcion}.`);
            setPidiendo(null);
          }}
        />
      )}
```

Y agregar `areas`, `empresas` y `ubicaciones` al destructuring de los props —en la Tarea 2 estaban declaradas en el tipo pero sin desestructurar, porque todavía no las usaba nadie—:

```tsx
export default function ReponerClient({
  paraPedir, yaPedidos, areas, empresas, ubicaciones,
}: {
```

- [ ] **Paso 4: comprobar que compila y que la suite sigue verde**

```bash
npx tsc --noEmit
```

```bash
npm test
```

- [ ] **Paso 5: leer el modal y confirmar que no puede fallar**

Abrí `app/(app)/compras/requerimientos/NuevoRequerimientoModal.tsx` y comprobá, leyendo:

1. Que `cantidad` se espera como **string** (el estado es `useState(inicial?.cantidad ?? "")` sobre un `<input>`), y que un `String(numero)` entra bien.
2. Que `codigo` y `detalle` son campos libres y no desplegables contra un catálogo.
3. Que el modal **no** requiere nada que vos no estés mandando. Área es obligatoria pero la elige la persona.

Decí en el reporte qué encontraste. Si algo no encaja, **no modifiques el modal**: reportalo.

- [ ] **Paso 6: commitear**

`git status --short` en su propia llamada primero.

```bash
git add "app/(app)/inventario/reponer/ReponerClient.tsx"
```

```bash
git commit -m "feat(inventario): pedir lo que falta abre el alta de Compras precargada"
```

---

## Tarea 4: la entrada en el menú, y la verificación final

**Archivos:**
- Modificar: `lib/core/nav.ts`

- [ ] **Paso 1: el ítem del menú**

En `lib/core/nav.ts`, dentro de `children` del módulo Inventario, **después de «Stock»** y antes de «Cargar movimiento»:

```ts
      { label: "Stock", href: "/inventario/stock", modulo: "inventario" },
      // Después del stock y no al final: es la lista corta que sale del stock,
      // y quien entra a mirar si hay algo es el que después pide.
      { label: "Para reponer", href: "/inventario/reponer", modulo: "inventario" },
```

No lleva `soloAdmin`: pedir un material lo puede hacer cualquier usuario activo —la migración 018 lo dejó así a propósito— y quien nota que algo se acabó es quien está parado en el pañol.

- [ ] **Paso 2: la suite y los tipos**

```bash
npm test
```

```bash
npx tsc --noEmit
```

- [ ] **Paso 3: el build**

**Parar `npm run dev` antes**: un `next build` con el dev server levantado deja la app en 500.

```bash
npm run build
```

- [ ] **Paso 4: commitear y pushear**

`git status --short` en su propia llamada primero.

```bash
git add lib/core/nav.ts
```

```bash
git commit -m "feat(inventario): Para reponer en el menu, despues del stock"
```

```bash
git push
```

- [ ] **Paso 5: comprobar el árbol commiteado**

Esto es lo que atrapa un archivo nuevo que quedó sin commitear mientras los que lo importan sí viajaron — cuatro deploys seguidos rotos el 14/09/2026 por eso. Corrélo **solo**, en su propia línea:

```bash
node scripts/revisar-arbol-commiteado.mjs
```

Esperado: sin imports que no resuelvan. Si dice "NO RESUELVEN", mirá cuál de los cuatro archivos nuevos quedó afuera y commitéalo.

- [ ] **Paso 6: la prueba de punta a punta, que la hace una persona**

La pantalla está detrás del login. Pedile al usuario:

> Entrá a `/inventario/reponer`. Deberías ver dos grupos: «Para pedir» con unos 75 y «Ya pedidos» con unos 17. Apretá **Pedir** en el primero y contame:
>
> 1. Si el formulario se abre con la descripción, el código y la cantidad ya puestos, y si la cantidad es el stock de seguridad.
> 2. Si al guardarlo aparece en `/mis-pedidos` y en el tablero de Compras.
> 3. Qué dice la fila nueva en la hoja de respuestas del formulario de Google.
>
> En «Ya pedidos» fijate que `PROYECTOR LED 100W` (código 00666) diga **3 pedidos abiertos**: es el caso que esta pantalla existe para que no se repita.

---

## Lo que este plan deja afuera a propósito

- **Selección múltiple.** Serían 75 RI de un click y nadie revisa 75 formularios.
- **Crear el RI sin que nadie confirme.** El modal se abre, no se envía: es el paso de aprobación que el Apps Script ya tiene y no hay razón para perderlo.
- **Un KPI en el dashboard de Inventario.** El menú alcanza para llegar; agregar una tarjeta es otra decisión y el spec no la pidió.
- **Depurar el stock de seguridad.** Que 402 artículos tengan un mínimo que nadie usa es el problema de fondo, pero se arregla revisando el catálogo. Esta pantalla lo deja a la vista: la diferencia entre 521 faltantes y 75 para reponer **es** su medida.

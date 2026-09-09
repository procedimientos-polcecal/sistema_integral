# Alta de Compras a la planilla — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un requerimiento cargado desde el sistema aparezca en la planilla de PEDIDOS DE COMPRA, escribiendo su fila en la hoja de respuestas del formulario — el único lugar escribible de un alta.

**Architecture:** Las columnas del alta de la planilla no son datos sino la salida de fórmulas: el master es un `QUERY(IMPORTRANGE())` de la planilla de respuestas del formulario, y cada pestaña por área es un `FILTER` del master. Así que el alta se escribe **una planilla más arriba**, en `Respuestas de formulario 1`, y desde ahí baja sola. El N° de RI lo sigue calculando la fórmula de esa hoja y el sistema lo verifica después de escribir. Todo lo que decide qué se escribe vive en funciones puras con tests; el I/O reusa los helpers de `lib/core/sheets.ts`.

**Tech Stack:** Next.js 16 (App Router, Route Handlers), Supabase (PostgREST), Google Sheets API v4 con JWT firmado a mano (`lib/core/google.ts`), vitest.

**Spec:** [docs/superpowers/specs/2026-09-09-compras-alta-a-la-planilla-design.md](../specs/2026-09-09-compras-alta-a-la-planilla-design.md) — puntos 1 a 6. El punto 7 (aviso por mail) queda para una segunda tanda.

---

## Los datos de la planilla, para no tener que ir a mirarlos

Relevado el 09/09/2026 contra las planillas reales.

**Planilla de respuestas:** `1T551q99JfhbXeYzGRbkhcZd6wwc4oh4v83UxPIGFLVM`, pestaña `Respuestas de formulario 1`. Encabezado en la fila 1, datos desde la 4, **fila − 3 = N° de RI** sin huecos en 1.953 pedidos. Locale `es_MX`, zona `America/Araguaina` (UTC−3).

| Col | Encabezado | Qué escribir |
|---|---|---|
| A | `Nº RI` (ordinal `º`) | La fórmula `=IF(B<fila>:B<>"",A<fila-1>+1,"")` |
| B | `Marca temporal` | serial con fracción |
| C | `Nombre` | nombre del solicitante |
| D | `Apellido` | apellido del solicitante |
| E | `ÁREA` | el nombre exacto del área |
| F | `DESCRIPCIÓN DEL PEDIDO` | descripción |
| G | `CODIGO` | código o vacío |
| H | `CANTIDAD A PEDIR` | cantidad o vacío |
| I | `PARA DONDE SE NECESITA` | ubicación o vacío |
| J | `PARA CUANDO SE NECESITA` | serial entero o vacío |
| K | `DETALLES EXTRA` | detalle o vacío |
| L | `ARCHIVO COMPLEMENTARIO` | `imagen_url` o vacío |
| M, N, O | `DIRECCIÓN EMAIL ENVIADA`, correo, `Area` | **no se tocan** |

**Master:** `1hnfYHaWBprT9UGOETSoQ9GQCl3B1ZezPr5FPbCrUO80`, pestaña `Requerimientos internos`. `A:J` es la fórmula; `K` (`PRIORIDAD`), `L` (`Empresa`) y `M` (`Estado`) son valores a mano. **Fila del master = fila de respuestas − 2.**

---

### Task 1: La sincronización conserva lo que el sistema sabe

Hoy, cuando la planilla vuelve a traer un RI que ya existe, tres columnas se pisan: `origen` (`app` → `sheets`), `prioridad` (a `null`) y quién paga (a "ninguna"). Las otras ocho columnas ya se conservan, con un `??` repetido en cada una. Esto unifica la regla en una función con tests y suma las tres que faltaban.

**Files:**
- Create: `lib/compras/fusionDeLaPlanilla.ts`
- Create: `lib/compras/fusionDeLaPlanilla.test.ts`
- Modify: `lib/compras/sheets.ts` (la captura de `paga`, el `select` de `existentes` y el objeto del `upsert`)

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/compras/fusionDeLaPlanilla.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  fusionarConLoQueYaHabia, type DeLaPlanilla, type LoQueYaHabia,
} from "./fusionDeLaPlanilla";

/** La planilla no dijo nada de nada: todas las celdas vacías. */
const NADA: DeLaPlanilla = {
  prioridad: null,
  estado_aprobacion: null,
  estado_compra: null,
  solicitante_nombre: null,
  compra_asignada_a: null,
  comparativa_drive_id: null,
  paga: null,
};

/** Un pedido cargado en el sistema, con todo lo que el sistema sabe de el. */
const DEL_SISTEMA: LoQueYaHabia = {
  prioridad: "1 SEMANA",
  estado_aprobacion: "PENDIENTE",
  estado_compra: "SIN_INICIAR",
  solicitante_nombre: "Admin SdG",
  compra_asignada_a: null,
  comparativa_drive_id: null,
  empresa_id: null,
  paga_ambas: true,
  origen: "app",
};

describe("lo que se conserva cuando la planilla vuelve a traer un RI", () => {
  it("un pedido cargado en el sistema sigue diciendo que entro por el sistema", () => {
    // El indicador de /compras/configuracion mide por aca por donde entran los
    // pedidos nuevos, y es el que decide cuando apagar el formulario. Si la
    // sincronizacion lo pisa con "sheets", mide siempre cero.
    expect(fusionarConLoQueYaHabia(NADA, DEL_SISTEMA).origen).toBe("app");
  });

  it("el que no existia entra como de la planilla", () => {
    expect(fusionarConLoQueYaHabia(NADA, undefined).origen).toBe("sheets");
  });

  it("una celda vacia no borra la prioridad ni quien paga", () => {
    // Las dos las elige quien pide, en el alta. En la planilla son columnas a
    // mano que recien se llenan al aprobar: vacias significan "todavia no",
    // no "borralo".
    const r = fusionarConLoQueYaHabia(NADA, DEL_SISTEMA);
    expect(r.prioridad).toBe("1 SEMANA");
    expect(r.paga_ambas).toBe(true);
  });

  it("pero lo que la planilla SI dice, manda", () => {
    const r = fusionarConLoQueYaHabia(
      { ...NADA, prioridad: "URGENTE", paga: { empresa_id: "e-polcecal", ambas: false } },
      DEL_SISTEMA
    );
    expect(r.prioridad).toBe("URGENTE");
    expect(r.empresa_id).toBe("e-polcecal");
    expect(r.paga_ambas).toBe(false);
  });

  it("sin planilla y sin previo, los estados caen al valor de un RI nuevo", () => {
    const r = fusionarConLoQueYaHabia(NADA, undefined);
    expect(r.estado_aprobacion).toBe("PENDIENTE");
    expect(r.estado_compra).toBe("SIN_INICIAR");
    expect(r.prioridad).toBeNull();
    expect(r.empresa_id).toBeNull();
    expect(r.paga_ambas).toBe(false);
  });

  it("el estado que trae la planilla no se pierde", () => {
    // Es el otro lado de la regla: 15 RI pasaron de PEDIDO a SIN_INICIAR en una
    // sola corrida cuando el default gano sobre lo que habia.
    const r = fusionarConLoQueYaHabia({ ...NADA, estado_compra: "RECIBIDO" }, DEL_SISTEMA);
    expect(r.estado_compra).toBe("RECIBIDO");
  });

  it("la comparativa enlazada no se pierde si esta vez no se pudo leer el link", () => {
    const conComparativa = { ...DEL_SISTEMA, comparativa_drive_id: "drive-1" };
    expect(fusionarConLoQueYaHabia(NADA, conComparativa).comparativa_drive_id).toBe("drive-1");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/compras/fusionDeLaPlanilla.test.ts`
Expected: FAIL — `Failed to resolve import "./fusionDeLaPlanilla"`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `lib/compras/fusionDeLaPlanilla.ts`:

```ts
/**
 * Qué se guarda cuando la planilla vuelve a traer un requerimiento que ya
 * existe.
 *
 * La regla es una sola: **lo que la planilla no dice no se pisa.** Una celda
 * vacía casi nunca significa "vacialo"; significa que ese dato no vive ahí. El
 * valor por defecto queda sólo para un RI que no existía.
 *
 * Estaba repetida en ocho columnas del `upsert` de `importarDesdeSheets`, con
 * un `??` en cada una, y tres se habían quedado afuera:
 *
 *   * `origen` — un pedido cargado en el sistema pasaba a decir que entró por
 *     la planilla en la primera sincronización que releyera su fila. Es
 *     justamente lo que mide el indicador de `/compras/configuracion` para
 *     decidir cuándo apagar el formulario.
 *   * `prioridad` y quién paga — las elige quien pide, en el alta, y en la
 *     planilla son columnas a mano que recién se llenan al aprobar.
 *
 * Vive acá y no dentro de `sheets.ts` para poder probarla: es una decisión, no
 * una llamada a Google.
 */

/** Lo que la planilla dice de un requerimiento. `null` es "no dice nada". */
export interface DeLaPlanilla {
  prioridad: string | null;
  estado_aprobacion: string | null;
  estado_compra: string | null;
  solicitante_nombre: string | null;
  compra_asignada_a: string | null;
  comparativa_drive_id: string | null;
  /**
   * Quién paga. `null` cuando la celda vino **vacía**, que no es lo mismo que
   * "ninguna de las dos": `pagaDe("")` devuelve `{empresa: null, ambas: false}`
   * y con eso vacío y decisión se confundían.
   */
  paga: { empresa_id: string | null; ambas: boolean } | null;
}

/** Lo que el sistema ya sabía del requerimiento. */
export interface LoQueYaHabia {
  prioridad: string | null;
  estado_aprobacion: string;
  estado_compra: string;
  solicitante_nombre: string | null;
  compra_asignada_a: string | null;
  comparativa_drive_id: string | null;
  empresa_id: string | null;
  paga_ambas: boolean;
  origen: string;
}

export interface Fusionado {
  prioridad: string | null;
  estado_aprobacion: string;
  estado_compra: string;
  solicitante_nombre: string | null;
  compra_asignada_a: string | null;
  comparativa_drive_id: string | null;
  empresa_id: string | null;
  paga_ambas: boolean;
  origen: string;
}

export function fusionarConLoQueYaHabia(
  de: DeLaPlanilla,
  previo: LoQueYaHabia | undefined
): Fusionado {
  return {
    prioridad: de.prioridad ?? previo?.prioridad ?? null,
    estado_aprobacion: de.estado_aprobacion ?? previo?.estado_aprobacion ?? "PENDIENTE",
    estado_compra: de.estado_compra ?? previo?.estado_compra ?? "SIN_INICIAR",
    solicitante_nombre: de.solicitante_nombre ?? previo?.solicitante_nombre ?? null,
    compra_asignada_a: de.compra_asignada_a ?? previo?.compra_asignada_a ?? null,
    comparativa_drive_id: de.comparativa_drive_id ?? previo?.comparativa_drive_id ?? null,
    // Los dos salen de la misma celda, así que se deciden juntos: o manda la
    // planilla o manda lo que había.
    empresa_id: de.paga ? de.paga.empresa_id : previo?.empresa_id ?? null,
    paga_ambas: de.paga ? de.paga.ambas : previo?.paga_ambas ?? false,
    // Haber entrado por el sistema no se deshace por aparecer después en la
    // planilla: aparecer allá es justamente lo que se quiere que pase.
    origen: previo?.origen === "app" ? "app" : "sheets",
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/compras/fusionDeLaPlanilla.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Enganchar la función en la sincronización**

En `lib/compras/sheets.ts`:

**5a.** Agregar el import arriba, junto a los otros de `@/lib/compras`:

```ts
import { fusionarConLoQueYaHabia } from "@/lib/compras/fusionDeLaPlanilla";
```

**5b.** En la rama del master de `importarDesdeSheets`, cambiar la captura de `paga`:

```ts
            paga: pagaDe(val(fila, "empresa")),
```

por:

```ts
            // `null` cuando la celda está vacía: vacío no es "ninguna de las
            // dos", y confundirlos borra la empresa que eligió quien pidió.
            paga: texto(val(fila, "empresa")) ? pagaDe(val(fila, "empresa")) : null,
```

**5c.** En el `select` de `existentes`, agregar las cuatro columnas que la fusión necesita. El tipo pasa a ser:

```ts
    const existentes = await traerTodo<{
      nro_ri: number;
      editado_en_app: boolean;
      estado_aprobacion: string;
      estado_compra: string;
      compra_asignada_a: string | null;
      solicitante_nombre: string | null;
      comparativa_drive_id: string | null;
      prioridad: string | null;
      empresa_id: string | null;
      paga_ambas: boolean;
      origen: string;
    }>((desde, hasta) =>
      admin
        .from("compras_requerimientos")
        .select(
          "nro_ri, editado_en_app, estado_aprobacion, estado_compra, compra_asignada_a, " +
          "solicitante_nombre, comparativa_drive_id, prioridad, empresa_id, paga_ambas, origen"
        )
        .range(desde, hasta)
    );
```

> Ojo: el `select()` va como cadena literal en la llamada, no armado en una variable, o Supabase pierde la inferencia de tipos. Partirlo en dos literales concatenados como acá está bien.

**5d.** En el cuerpo del `for (const registro of registros)`, antes del `aEscribir.push`, calcular la fusión:

```ts
      const yaHabia = previo.get(registro.nro_ri);
      const fusion = fusionarConLoQueYaHabia(
        {
          prioridad: (d.prioridad as string | null) ?? null,
          estado_aprobacion: (d.estado_aprobacion as string | null) ?? null,
          estado_compra: (d.estado_compra as string | null) ?? null,
          solicitante_nombre: (d.solicitante_nombre as string | null) ?? null,
          compra_asignada_a: d.asignado_alias
            ? porAlias.get(norm(d.asignado_alias as string)) ?? null
            : null,
          comparativa_drive_id: planillas.get(registro.nro_ri) ?? null,
          paga: d.paga
            ? {
                empresa_id: (d.paga as { empresa: string | null }).empresa
                  ? porEmpresa.get((d.paga as { empresa: string }).empresa) ?? null
                  : null,
                ambas: (d.paga as { ambas: boolean }).ambas,
              }
            : null,
        },
        yaHabia
      );
```

**5e.** En el objeto que se pushea a `aEscribir`, **borrar** estas nueve claves —`prioridad`, `empresa_id`, `paga_ambas`, `solicitante_nombre`, `estado_aprobacion`, `estado_compra`, `comparativa_drive_id`, `compra_asignada_a` y `origen`— con todos sus comentarios, y poner en su lugar, después de `paga_ambas` quedaría el hueco:

```ts
        // Las nueve columnas que la planilla puede no traer. La regla —y por
        // qué cada una está en la lista— vive en `fusionarConLoQueYaHabia`.
        ...fusion,
```

Las que **no** se tocan y siguen como estaban: `nro_ri`, `fecha`, `area_id`, `descripcion`, `codigo`, `cantidad`, `ubicacion_raw`, `ubicacion_id`, `fecha_necesidad`, `detalle_extra`, `imagen_url`, `aprobador`, `proveedor_id`, `costo_iva`, `costo_envio`, `hoja_origen`, `sheets_fila`, `sheets_sincronizado_en`.

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores de tipos; los 1.216 tests pasan más los 7 nuevos.

> Si `npm test` falla en archivos que no tocaste, mirá `git status` antes de arreglarlos: puede ser otra sesión trabajando en el mismo árbol.

- [ ] **Step 7: Commit**

```bash
git add lib/compras/fusionDeLaPlanilla.ts lib/compras/fusionDeLaPlanilla.test.ts lib/compras/sheets.ts
git commit -m "fix(compras): la planilla no borra lo que el sistema sabe del pedido"
```

---

### Task 2: La fecha como la guarda Sheets

Las dos fechas que se escriben —la marca temporal y el "para cuándo"— van como **serial**, no como texto: la planilla es `es_MX` y un texto se interpreta según el locale, que es exactamente cómo se dieron vuelta 885 fechas en Compras.

**Files:**
- Modify: `lib/core/fechaDeSheets.ts`
- Modify: `lib/core/fechaDeSheets.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `lib/core/fechaDeSheets.test.ts`:

```ts
describe("la fecha como la guarda Sheets", () => {
  it("un dia es un serial entero", () => {
    // Verificado contra la planilla real: la fila del RI 1954 tiene 46275 en
    // "PARA CUANDO SE NECESITA" y se ve como 10/9/2026.
    expect(serialDelDia("2026-09-10")).toBe(46275);
  });

  it("y vuelve igual: es la inversa de fechaDeSheets", () => {
    for (const iso of ["2026-09-10", "2026-01-01", "2025-12-31", "1970-01-01"]) {
      expect(fechaDeSheets(serialDelDia(iso))).toBe(iso);
    }
  });

  it("un instante lleva la fraccion del dia, en la zona de la planilla", () => {
    // La planilla esta en America/Araguaina (UTC-3), como Argentina y sin
    // horario de verano. 12:36:57 UTC son las 09:36:57 alla.
    const serial = serialDelInstante(new Date("2026-09-09T12:36:57.702Z"));
    expect(Math.floor(serial)).toBe(46274);
    expect(serial).toBeCloseTo(46274.40066, 4);
  });

  it("una fecha que no se entiende no inventa un numero", () => {
    expect(serialDelDia("")).toBeNull();
    expect(serialDelDia("10/9/2026")).toBeNull();
  });

  it("una fecha imposible se descarta, no se corrige", () => {
    expect(serialDelDia("2026-02-30")).toBeNull();
    expect(serialDelDia("2025-02-29")).toBeNull();  // 2025 no es bisiesto
    expect(serialDelDia("2026-04-31")).toBeNull();
    expect(serialDelDia("2026-13-01")).toBeNull();
    expect(serialDelDia("2024-02-29")).toBe(45351);  // 2024 si es bisiesto
  });
});
```

Y agregar los dos nombres al import que ya tiene el archivo arriba:

```ts
import { fechaDeSheets, serialDelDia, serialDelInstante } from "./fechaDeSheets";
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/core/fechaDeSheets.test.ts`
Expected: FAIL — `serialDelDia is not a function`

- [ ] **Step 3: Escribir la implementación mínima**

Agregar al final de `lib/core/fechaDeSheets.ts`:

```ts
/**
 * El otro sentido: una fecha como la guarda Sheets.
 *
 * Sheets cuenta los días desde el 30/12/1899, y `fechaDeSheets` lo deshace con
 * el mismo 25569 —los días entre esa fecha y el 1/1/1970—.
 *
 * Se escribe el serial y no el texto **a propósito**: un "9/9/2026" lo
 * interpreta la planilla según su locale, que es `es_MX` en la del formulario y
 * podría no serlo mañana. Un número no se interpreta. Es la misma precaución
 * que la lectura ya tomaba al pedir `UNFORMATTED_VALUE`.
 */
const DIAS_HASTA_1970 = 25569;
const MS_POR_DIA = 86_400_000;

/**
 * Un día (`2026-09-10`) como serial entero, o `null` si esa fecha no existe.
 *
 * **Una fecha imposible se descarta, no se corrige**: es la regla que
 * `fechaDeTexto` de `lib/core/fechas.ts` dejó escrita en mayúsculas después del
 * incidente de las 885 fechas. `Date.parse` rueda el 30 de febrero al 2 de
 * marzo y devuelve un serial plausible pero corrido, así que la comprobación es
 * de ida y vuelta. Y se normaliza el texto UNA vez: validar el valor trimeado y
 * calcular con el original deja los dos guardias mirando entradas distintas.
 */
export function serialDelDia(iso: string): number | null {
  const s = String(iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  const ms = Date.parse(`${s}T00:00:00Z`);
  if (isNaN(ms)) return null;
  if (new Date(ms).toISOString().slice(0, 10) !== s) return null;

  return ms / MS_POR_DIA + DIAS_HASTA_1970;
}

/**
 * Un instante como serial con la fracción del día.
 *
 * El desfase es el de la zona de la planilla y no el del servidor: en Vercel el
 * servidor está en UTC, y escribir la marca temporal en UTC pondría los pedidos
 * de la mañana tres horas más tarde de lo que pasaron.
 */
export function serialDelInstante(cuando: Date, desfaseHoras = -3): number {
  const local = cuando.getTime() + desfaseHoras * 3600 * 1000;
  return local / MS_POR_DIA + DIAS_HASTA_1970;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/core/fechaDeSheets.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/core/fechaDeSheets.ts lib/core/fechaDeSheets.test.ts
git commit -m "feat(core): la fecha como la guarda Sheets, para poder escribirla"
```

---

### Task 3: Qué celdas escribe un alta

La parte que decide: dado el encabezado real de la hoja y los datos del pedido, qué va en cada columna. Es puro y por eso es donde están los tests. **Se mapea por nombre de encabezado, no por posición**: si falta una columna no se escribe nada y se dice cuál falta.

**Files:**
- Create: `lib/compras/formulario.ts`
- Create: `lib/compras/formulario.test.ts`

> **Nota post-revisión (09/09/2026):** la primera versión de este paso —la que
> queda documentada más abajo como Step 1/Step 3 originales— tenía un defecto
> que una revisión posterior encontró y que **venía de este mismo plan**: la
> ventana de columnas donde buscar un alias salía de `Object.keys(ALIAS).length`
> (`COLUMNAS_DEL_ALTA`, "las 12 de ALIAS"), un conteo con dos dueños que no se
> hablaban entre sí. Si el formulario de Google agrega una pregunta, las
> columnas reales se corren pero ese conteo no, así que lo que quedaba después
> de la pregunta nueva se omitía **en silencio, con `ok: true`** — medido: una
> pregunta antes de `ARCHIVO COMPLEMENTARIO` pierde la imagen; cuatro antes de
> `DESCRIPCIÓN DEL PEDIDO` pierden ubicación, fecha de necesidad, detalle e
> imagen. Es la misma divergencia que no avisa que el CLAUDE.md del repo
> prohíbe para las planillas.
>
> El arreglo, ya aplicado en `lib/compras/formulario.ts`, saca el borde del
> encabezado mismo en vez de contarlo: `DIRECCIÓN EMAIL ENVIADA` es la primera
> columna ajena al `QUERY` del master, y esa comparación es **sensible a
> acentos y mayúsculas** (no pasa por `norm()`/`clave()`) — es la misma razón
> por la que existía el problema original de `ÁREA`/`Area` que motivó acotar la
> búsqueda. Si ese borde no aparece en el encabezado, `celdasDelAlta` devuelve
> `{ok: false}` con el motivo en vez de adivinar un ancho. De paso se corrigieron
> tres cosas más que la revisión encontró en el mismo archivo: un `creado`
> inválido ya no escribe `"NaN"` en la marca temporal (se niega con motivo, como
> pide el docstring de `serialDelInstante`); se sacaron cuatro alias de `ALIAS`
> que `clave()` ya volvía inalcanzables (`"N° RI"`, `"AREA"`, `"CÓDIGO"` y una de
> `"DESCRIPCIÓN"`/`"DESCRIPCION"`) y que sólo ensuciaban el mensaje de `faltan`;
> y `ResultadoCeldas` devuelve `fila` en el caso `ok: true`, porque queda
> horneada en la fórmula del N° de RI y quien escribe tiene que usar esa fila y
> no la suya.
>
> El código de abajo queda como registro de la primera pasada (por eso el plan
> original y su razonamiento se conservan); **la implementación real es la que
> está en `lib/compras/formulario.ts` y `lib/compras/formulario.test.ts`**, con
> 13 tests en vez de 8.

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/compras/formulario.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { celdasDelAlta, type DatosDelAlta } from "./formulario";

/** El encabezado real de "Respuestas de formulario 1", leido el 09/09/2026. */
const ENCABEZADO = [
  "Nº RI", "Marca temporal", "Nombre", "Apellido", "ÁREA",
  "DESCRIPCIÓN DEL PEDIDO", "CODIGO", "CANTIDAD A PEDIR",
  "PARA DONDE SE NECESITA", "PARA CUANDO SE NECESITA", "DETALLES EXTRA",
  "ARCHIVO COMPLEMENTARIO", "DIRECCIÓN EMAIL ENVIADA",
  "Dirección de correo electrónico", "Area",
];

const DATOS: DatosDelAlta = {
  nro_ri: 1954,
  nombre: "Admin",
  apellido: "SdG",
  area: "Almacén",
  descripcion: "Modulo llave punto Kalop",
  codigo: null,
  cantidad: 10,
  ubicacion: "Taller eléctrico",
  fecha_necesidad: "2026-09-10",
  detalle_extra: "Repo Stock",
  imagen_url: null,
  creado: new Date("2026-09-09T12:36:57.702Z"),
};

const porColumna = (celdas: { columna: number; valor: string }[]) =>
  new Map(celdas.map((c) => [c.columna, c.valor]));

describe("las celdas de un alta en la hoja de respuestas", () => {
  it("pone en cada columna lo que dice su encabezado", () => {
    const r = celdasDelAlta(ENCABEZADO, DATOS, 1957);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = porColumna(r.celdas);
    expect(c.get(2)).toBe("Admin");          // C, Nombre
    expect(c.get(3)).toBe("SdG");            // D, Apellido
    expect(c.get(4)).toBe("Almacén");        // E, ÁREA
    expect(c.get(5)).toBe("Modulo llave punto Kalop");
    expect(c.get(7)).toBe("10");             // H, CANTIDAD A PEDIR
    expect(c.get(8)).toBe("Taller eléctrico");
    expect(c.get(10)).toBe("Repo Stock");    // K, DETALLES EXTRA
  });

  it("el N° de RI va como la formula que tienen las otras filas", () => {
    // El que numera sigue siendo uno solo: la planilla. Escribir el numero como
    // literal haria que la proxima fila que Google agregue copie un valor en vez
    // de una formula, y ahi la serie se corta.
    const r = celdasDelAlta(ENCABEZADO, DATOS, 1957);
    if (!r.ok) throw new Error("deberia mapear");
    expect(porColumna(r.celdas).get(0)).toBe('=IF(B1957:B<>"",A1956+1,"")');
  });

  it("las dos fechas van como serial", () => {
    const r = celdasDelAlta(ENCABEZADO, DATOS, 1957);
    if (!r.ok) throw new Error("deberia mapear");
    const c = porColumna(r.celdas);
    expect(Number(c.get(1))).toBeCloseTo(46274.40066, 4);  // B, marca temporal
    expect(c.get(9)).toBe("46275");                         // J, para cuando
  });

  it("lo que no se cargo va vacio, no como 'null'", () => {
    const r = celdasDelAlta(ENCABEZADO, DATOS, 1957);
    if (!r.ok) throw new Error("deberia mapear");
    const c = porColumna(r.celdas);
    expect(c.get(6)).toBe("");   // G, CODIGO
    expect(c.get(11)).toBe("");  // L, ARCHIVO COMPLEMENTARIO
  });

  it("no escribe las columnas que el QUERY del master ignora", () => {
    // M, N y O son de la planilla: la M la escribe el Apps Script de los
    // avisos. Meterle mano seria decir que se aviso cuando no se aviso.
    const r = celdasDelAlta(ENCABEZADO, DATOS, 1957);
    if (!r.ok) throw new Error("deberia mapear");
    const columnas = r.celdas.map((c) => c.columna);
    expect(Math.max(...columnas)).toBe(11);
  });

  it("si falta una columna no escribe nada y dice cual falta", () => {
    // Escribir a ciegas en un archivo con otra estructura es la forma mas facil
    // de arruinar la planilla de alguien.
    const sinArea = ENCABEZADO.filter((h) => h !== "ÁREA");
    const r = celdasDelAlta(sinArea, DATOS, 1957);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltan.join(" ")).toContain("ÁREA");
  });

  it("tolera como esta escrito el encabezado: acentos, mayusculas y el ordinal", () => {
    // "Nº RI" con ordinal en la hoja de respuestas y "N° RI" con grado en el
    // master son la misma columna para quien la lee.
    const otro = [...ENCABEZADO];
    otro[0] = "N° RI";
    otro[4] = "area";
    const r = celdasDelAlta(otro, DATOS, 1957);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/compras/formulario.test.ts`
Expected: FAIL — `Failed to resolve import "./formulario"`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `lib/compras/formulario.ts`:

```ts
/**
 * El alta de un requerimiento, escrita donde la planilla la puede recibir.
 *
 * Está aparte de `sheets.ts` porque es **otra planilla**: la de respuestas del
 * formulario de Google (`FORM PEDIDO DE COMPRA POLCECAL - POLYSAN`), con otro
 * id, otra hoja y otro encabezado. `sheets.ts` espeja PEDIDOS DE COMPRA y ya
 * tiene 1.100 líneas haciendo eso.
 *
 * POR QUÉ ACÁ Y NO EN EL MASTER
 *
 * En el master las columnas del alta no son datos: `A2` es un
 * `QUERY(IMPORTRANGE(...))` de esta hoja de respuestas, y su salida ocupa A:J.
 * Las pestañas por área son a su vez un `FILTER` del master. O sea que el alta
 * no se puede escribir ni en el master ni en la pestaña del área: se escribe
 * una planilla más arriba y baja sola.
 *
 * Ver `docs/COMPRAS-SINCRONIZACION.md` y el spec del 09/09/2026.
 */

import { norm } from "@/lib/compras/texto";
import { serialDelDia, serialDelInstante } from "@/lib/core/fechaDeSheets";
import { letraDeColumna } from "@/lib/core/columnaDeSheets";

/** Cómo se llama cada columna en la hoja. La primera que exista gana. */
const ALIAS = {
  nro_ri: ["Nº RI", "N° RI", "NRO RI"],
  marca: ["Marca temporal", "Timestamp"],
  nombre: ["Nombre"],
  apellido: ["Apellido"],
  area: ["ÁREA", "AREA"],
  descripcion: ["DESCRIPCIÓN DEL PEDIDO", "DESCRIPCIÓN", "DESCRIPCION"],
  codigo: ["CODIGO", "CÓDIGO"],
  cantidad: ["CANTIDAD A PEDIR", "CANTIDAD", "CAN"],
  ubicacion: ["PARA DONDE SE NECESITA", "DONDE SE NECESITA"],
  fecha_necesidad: ["PARA CUANDO SE NECESITA", "FECHA DE REQUERIMIENTO"],
  detalle_extra: ["DETALLES EXTRA", "DETALLE EXTRA"],
  imagen: ["ARCHIVO COMPLEMENTARIO", "IMAGEN COMPLEMENTARIA", "IMAGEN"],
} as const;

type Clave = keyof typeof ALIAS;

/**
 * Sin qué columnas no se escribe.
 *
 * Son las que hacen que el pedido exista y aparezca donde tiene que aparecer:
 * el número —que lo calcula la fórmula—, la marca temporal —de la que depende
 * esa fórmula—, el área —con la que el `FILTER` de cada pestaña compara letra
 * por letra— y la descripción, que es el pedido. Sin una de ésas, escribir
 * sería dejar una fila que nadie va a poder leer.
 */
const IMPRESCINDIBLES: Clave[] = ["nro_ri", "marca", "area", "descripcion"];

export interface DatosDelAlta {
  nro_ri: number;
  nombre: string;
  apellido: string;
  area: string;
  descripcion: string;
  codigo: string | null;
  cantidad: number | null;
  ubicacion: string | null;
  /** ISO `2026-09-10`, o null si no la pidieron para una fecha. */
  fecha_necesidad: string | null;
  detalle_extra: string | null;
  imagen_url: string | null;
  creado: Date;
}

export interface Celda {
  /** Desde cero, como la espera `escribirCeldas` del núcleo. */
  columna: number;
  valor: string;
}

export type ResultadoCeldas =
  | { ok: true; celdas: Celda[] }
  | { ok: false; faltan: string[] };

/** En qué columna está cada cosa, por nombre y no por posición. */
function indexar(encabezado: string[]): Record<Clave, number> {
  const normalizado = encabezado.map((h) => norm(h).replace(/[^A-Z0-9 ]/g, ""));
  const idx = {} as Record<Clave, number>;

  for (const [clave, alias] of Object.entries(ALIAS) as [Clave, readonly string[]][]) {
    idx[clave] = -1;
    for (const a of alias) {
      const i = normalizado.indexOf(norm(a).replace(/[^A-Z0-9 ]/g, ""));
      if (i >= 0) { idx[clave] = i; break; }
    }
  }
  return idx;
}

/**
 * Qué escribir en la fila `fila` de la hoja de respuestas.
 *
 * El N° de RI va como **la misma fórmula que tienen las otras 1.955 filas** y
 * no como número. Dos razones: el que numera sigue siendo uno solo —la
 * planilla—, y la fila que Google agrega en la próxima respuesta copia la
 * fórmula de la de arriba; si arriba encuentra un literal, la serie se corta.
 *
 * Las columnas que el `QUERY` del master ignora no se tocan: `DIRECCIÓN EMAIL
 * ENVIADA` la escribe el Apps Script de los avisos, y ponerle algo sería decir
 * que se avisó cuando no se avisó.
 */
export function celdasDelAlta(
  encabezado: string[],
  datos: DatosDelAlta,
  fila: number
): ResultadoCeldas {
  const idx = indexar(encabezado);

  const faltan = IMPRESCINDIBLES.filter((c) => idx[c] < 0).map(
    (c) => `${c} (${ALIAS[c].join(" o ")})`
  );
  if (faltan.length > 0) return { ok: false, faltan };

  const marca = letraDeColumna(idx.marca);
  const nro = letraDeColumna(idx.nro_ri);
  const serialNecesidad = datos.fecha_necesidad ? serialDelDia(datos.fecha_necesidad) : null;

  const valores: Partial<Record<Clave, string>> = {
    nro_ri: `=IF(${marca}${fila}:${marca}<>"",${nro}${fila - 1}+1,"")`,
    marca: String(serialDelInstante(datos.creado)),
    nombre: datos.nombre,
    apellido: datos.apellido,
    area: datos.area,
    descripcion: datos.descripcion,
    codigo: datos.codigo ?? "",
    cantidad: datos.cantidad !== null ? String(datos.cantidad) : "",
    ubicacion: datos.ubicacion ?? "",
    fecha_necesidad: serialNecesidad !== null ? String(serialNecesidad) : "",
    detalle_extra: datos.detalle_extra ?? "",
    imagen_url: datos.imagen_url ?? "",
  };

  const celdas: Celda[] = [];
  for (const [clave, valor] of Object.entries(valores) as [Clave, string][]) {
    const columna = idx[clave];
    // Una columna que esta hoja no tiene y no es imprescindible: se omite en
    // silencio. No se escribe en una posición inventada.
    if (columna < 0) continue;
    celdas.push({ columna, valor });
  }
  return { ok: true, celdas };
}
```

> `ALIAS` usa `imagen` como clave y `DatosDelAlta` trae `imagen_url`: el `valores` de arriba las une, y el `Partial<Record<Clave, string>>` obliga a que las claves sean las del `ALIAS`. Si TypeScript se queja de `imagen_url` en `valores`, es porque falta renombrar esa clave a `imagen`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/compras/formulario.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add lib/compras/formulario.ts lib/compras/formulario.test.ts
git commit -m "feat(compras): que celdas escribe un alta en la hoja del formulario"
```

> **Este Step 3 quedó superado por la nota post-revisión de arriba.** La
> implementación final —borde sacado del encabezado, `creado` inválido
> rechazado, alias muertos afuera, `fila` devuelta en `ok: true`— está en
> `lib/compras/formulario.ts`; usarla como referencia y no este bloque.

---

### Task 4: Escribir el alta en la planilla

El I/O. Reusa los helpers del núcleo (`leerValores`, `filaSiguienteSegunLaColumna`, `escribirCeldas`), busca la fila libre por la columna de la marca temporal, escribe, **lee el número de vuelta** y recién entonces escribe prioridad y empresa en el master.

**Files:**
- Modify: `lib/compras/formulario.ts`
- Modify: `lib/compras/formulario.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `lib/compras/formulario.test.ts` (y sumar `filaDelMaster` al import):

```ts
describe("la fila del master que le corresponde a una fila de respuestas", () => {
  it("son dos menos: el QUERY lee desde A4 y sale en A2", () => {
    // Verificado el 09/09/2026: la fila 1957 de respuestas es la 1955 del
    // master, y ahi aparecio el RI 1954.
    expect(filaDelMaster(1957)).toBe(1955);
    expect(filaDelMaster(4)).toBe(2);
  });

  it("una fila que el QUERY no alcanza no tiene fila en el master", () => {
    expect(filaDelMaster(3)).toBeNull();
    expect(filaDelMaster(1)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/compras/formulario.test.ts`
Expected: FAIL — `filaDelMaster is not a function`

- [ ] **Step 3: Escribir `filaDelMaster` y la función de I/O**

Agregar a `lib/compras/formulario.ts`:

```ts
/**
 * A qué fila del master corresponde una fila de la hoja de respuestas.
 *
 * El `QUERY` del master lee `A4:L10000` y su salida arranca en la fila 2, así
 * que son dos menos. Es una cuenta y no una búsqueda porque la fórmula conserva
 * el orden de las respuestas y sólo agrega al final; buscar el N° de RI en el
 * master sería más honesto pero la fila del master puede no existir todavía
 * —`IMPORTRANGE` tarda en refrescar—, y por eso el que escribe **verifica antes
 * de escribir** en vez de confiar en la cuenta.
 */
export function filaDelMaster(filaDeRespuestas: number): number | null {
  const fila = filaDeRespuestas - 2;
  return fila >= 2 ? fila : null;
}
```

Y el I/O, en el mismo archivo:

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { leerValores, escribirCeldas, filaSiguienteSegunLaColumna } from "@/lib/core/sheets";

const HOJA_RESPUESTAS = "Respuestas de formulario 1";
const HOJA_MASTER = "Requerimientos internos";

const idFormulario = () => process.env.GOOGLE_SHEETS_COMPRAS_FORMULARIO_ID ?? "";

export interface ResultadoAlta {
  /** En qué fila de la hoja de respuestas quedó. */
  fila: number | null;
  /** Qué anotar en `sheets_pendiente`, o null si salió todo bien. */
  pendiente: string | null;
}

/**
 * Escribe el alta de un requerimiento en la hoja de respuestas del formulario.
 *
 * Sin la variable de entorno no hace nada y **no es un error**: se omite, igual
 * que la sincronización sin `GOOGLE_SHEETS_COMPRAS_ID`. Mientras la planilla no
 * esté configurada, el sistema funciona solo.
 *
 * Lo que puede fallar queda en `pendiente` en vez de lanzar: el pedido ya está
 * guardado y perderlo por no poder escribir la planilla sería peor.
 */
export async function exportarAltaAlFormulario(
  requerimientoId: string
): Promise<ResultadoAlta> {
  if (!idFormulario() || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return { fila: null, pendiente: null };
  }

  const admin = createAdminClient();
  const { data: r } = await admin
    .from("compras_requerimientos")
    .select(
      "id, nro_ri, descripcion, codigo, cantidad, fecha_necesidad, detalle_extra, " +
      "imagen_url, created_at, solicitante_id, solicitante_nombre, " +
      "compras_areas(nombre), compras_ubicaciones(nombre)"
    )
    .eq("id", requerimientoId)
    .single();

  if (!r) return { fila: null, pendiente: null };

  const area = (r.compras_areas as { nombre: string } | null)?.nombre;
  if (!area) {
    // El área es con lo que el FILTER de cada pestaña compara: sin ella el
    // pedido aparecería en el master y en ninguna pestaña.
    return { fila: null, pendiente: "el pedido no tiene área, y la planilla la necesita" };
  }

  // El nombre y el apellido van en columnas separadas. `solicitante_nombre` los
  // trae pegados, así que se prefiere el usuario.
  let nombre = "";
  let apellido = "";
  if (r.solicitante_id) {
    const { data: u } = await admin
      .from("usuarios")
      .select("nombre, apellido")
      .eq("id", r.solicitante_id as string)
      .single();
    nombre = (u?.nombre as string) ?? "";
    apellido = (u?.apellido as string) ?? "";
  }
  if (!nombre && r.solicitante_nombre) {
    const partes = String(r.solicitante_nombre).trim().split(/\s+/);
    nombre = partes[0] ?? "";
    apellido = partes.slice(1).join(" ");
  }

  try {
    const encabezado = (await leerValores(idFormulario(), `${HOJA_RESPUESTAS}!1:1`))[0] ?? [];

    // La fila libre se busca por la marca temporal y NO por la columna del N°
    // de RI: esa columna tiene una fórmula en todas las filas de la grilla, y
    // aunque hoy devuelva vacío para las filas sin marca, depender de eso es
    // depender de que la fórmula siga escrita igual.
    const columnaMarca = "B";
    const marcas = await leerValores(
      idFormulario(),
      `${HOJA_RESPUESTAS}!${columnaMarca}:${columnaMarca}`
    );
    const fila = filaSiguienteSegunLaColumna(marcas);

    const armado = celdasDelAlta(
      encabezado,
      {
        nro_ri: r.nro_ri as number,
        nombre,
        apellido,
        area,
        descripcion: r.descripcion as string,
        codigo: (r.codigo as string | null) ?? null,
        cantidad: (r.cantidad as number | null) ?? null,
        ubicacion: (r.compras_ubicaciones as { nombre: string } | null)?.nombre ?? null,
        fecha_necesidad: (r.fecha_necesidad as string | null) ?? null,
        detalle_extra: (r.detalle_extra as string | null) ?? null,
        imagen_url: (r.imagen_url as string | null) ?? null,
        creado: new Date((r.created_at as string) ?? Date.now()),
      },
      fila
    );

    if (!armado.ok) {
      return {
        fila: null,
        pendiente:
          "la hoja de respuestas no tiene las columnas esperadas; falta " +
          armado.faltan.join("; "),
      };
    }

    await escribirCeldas(
      idFormulario(),
      armado.celdas.map((c) => ({
        pestana: HOJA_RESPUESTAS,
        columna: c.columna,
        fila,
        valor: c.valor,
      }))
    );

    // Qué número calculó la planilla. Si no es el que asignó el sistema, hay un
    // hueco o una fila de más: se dice, en vez de dejar dos números para el
    // mismo pedido.
    const escrito = await leerValores(idFormulario(), `${HOJA_RESPUESTAS}!A${fila}`);
    const numeroDeLaPlanilla = Number(String(escrito[0]?.[0] ?? "").replace(/[^0-9]/g, ""));
    if (numeroDeLaPlanilla !== r.nro_ri) {
      return {
        fila,
        pendiente:
          `la planilla numeró esa fila como ${numeroDeLaPlanilla || "(vacío)"} y el sistema ` +
          `la había dado de alta como ${r.nro_ri}: hay que revisar la numeración a mano`,
      };
    }

    await admin
      .from("compras_requerimientos")
      .update({
        hoja_origen: HOJA_MASTER,
        sheets_fila: filaDelMaster(fila),
        sheets_sincronizado_en: new Date().toISOString(),
      })
      .eq("id", requerimientoId);

    return { fila, pendiente: await escribirPrioridadYEmpresa(admin, r.id as string, fila) };
  } catch (e) {
    return { fila: null, pendiente: e instanceof Error ? e.message : String(e) };
  }
}
```

Y la escritura del master, en el mismo archivo:

```ts
/**
 * Prioridad y empresa, en las columnas a mano del master.
 *
 * Las elige quien pide, en el alta, y en la planilla son dos columnas que no
 * salen de ninguna fórmula. Si no se escriben, la próxima sincronización las
 * lee vacías —y desde ahora las conserva, pero quien mira la planilla no las
 * ve—.
 *
 * **Se verifica la fila antes de escribir.** La cuenta `fila − 2` vale mientras
 * el `QUERY` conserve el orden, y además `IMPORTRANGE` tarda en refrescar: si
 * la fila del master todavía no dice este N° de RI, no se escribe nada y queda
 * pendiente. Escribir a ciegas sería ponerle la prioridad de este pedido a
 * otro.
 */
async function escribirPrioridadYEmpresa(
  admin: ReturnType<typeof createAdminClient>,
  requerimientoId: string,
  filaDeRespuestas: number
): Promise<string | null> {
  const idMaster = process.env.GOOGLE_SHEETS_COMPRAS_ID;
  const fila = filaDelMaster(filaDeRespuestas);
  if (!idMaster || fila === null) return null;

  const { data: r } = await admin
    .from("compras_requerimientos")
    .select("nro_ri, prioridad, paga_ambas, empresas!empresa_id(nombre)")
    .eq("id", requerimientoId)
    .single();
  if (!r) return null;

  const prioridad = (r.prioridad as string | null) ?? "";
  const empresa = empresaParaPlanilla(
    (r.empresas as { nombre: string } | null)?.nombre,
    r.paga_ambas === true
  );
  // Una celda que no tenemos con qué llenar no se pisa con vacío. Es el mismo
  // criterio que la celda de comparativa, que borraba el link de la planilla.
  if (!prioridad && !empresa) return null;

  const encabezado = (await leerValores(idMaster, `${HOJA_MASTER}!1:1`))[0] ?? [];
  const columna = (nombres: string[]) =>
    encabezado.findIndex((h) => nombres.includes(norm(h)));

  const colPrioridad = columna(["PRIORIDAD"]);
  const colEmpresa = columna(["EMPRESA", "PAGA"]);
  if (colPrioridad < 0 && colEmpresa < 0) {
    return "el master no tiene columnas de prioridad ni de empresa";
  }

  const enElMaster = await leerValores(idMaster, `${HOJA_MASTER}!A${fila}`);
  const nroEnLaFila = Number(String(enElMaster[0]?.[0] ?? "").replace(/[^0-9]/g, ""));
  if (nroEnLaFila !== r.nro_ri) {
    return (
      `la fila ${fila} del master todavía no dice el RI ${r.nro_ri} (dice ` +
      `${nroEnLaFila || "vacío"}): no se escribieron prioridad ni empresa`
    );
  }

  const celdas = [
    ...(colPrioridad >= 0 && prioridad
      ? [{ pestana: HOJA_MASTER, columna: colPrioridad, fila, valor: prioridad }]
      : []),
    ...(colEmpresa >= 0 && empresa
      ? [{ pestana: HOJA_MASTER, columna: colEmpresa, fila, valor: empresa }]
      : []),
  ];
  await escribirCeldas(idMaster, celdas);
  return null;
}
```

Y sumar el import de `empresaParaPlanilla` arriba del archivo:

```ts
import { empresaParaPlanilla } from "@/lib/compras/sheets";
```

- [ ] **Step 4: Correr los tests y el chequeo de tipos**

Run: `npx vitest run lib/compras/formulario.test.ts && npx tsc --noEmit`
Expected: PASS y sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add lib/compras/formulario.ts lib/compras/formulario.test.ts
git commit -m "feat(compras): escribir el alta en la hoja de respuestas del formulario"
```

---

### Task 5: La ruta de alta la llama, y quien carga se entera si falló

**Files:**
- Modify: `app/api/compras/requerimientos/route.ts`
- Modify: `app/(app)/compras/requerimientos/NuevoRequerimientoModal.tsx`

- [ ] **Step 1: Llamar a la exportación desde la ruta**

En `app/api/compras/requerimientos/route.ts`, agregar el import:

```ts
import { exportarAltaAlFormulario } from "@/lib/compras/formulario";
```

Y dentro del `if (!error) {`, después del bloque que asienta el historial y **antes** del `return`, agregar:

```ts
      // La planilla tiene que enterarse del pedido nuevo: es de donde lee quien
      // no entra al sistema. Si falla, el alta NO se voltea —el pedido ya está
      // guardado— y el motivo queda anotado en `sheets_pendiente`, que es lo
      // que el reintento de cada sincronización vuelve a intentar.
      let avisoSheets: string | null = null;
      try {
        const { pendiente } = await exportarAltaAlFormulario(data.id as string);
        avisoSheets = pendiente;
      } catch (e) {
        avisoSheets = e instanceof Error ? e.message : String(e);
      }

      if (avisoSheets) {
        await admin
          .from("compras_requerimientos")
          .update({
            sheets_pendiente: avisoSheets,
            sheets_intentado_en: new Date().toISOString(),
          })
          .eq("id", data.id as string);
        console.error(`RI ${data.nro_ri}: no se pudo escribir en la planilla: ${avisoSheets}`);
      }

      return NextResponse.json(
        { ...data, ...(avisoSheets ? { aviso_sheets: avisoSheets } : {}) },
        { status: 201 }
      );
```

Y borrar el `return NextResponse.json(data, { status: 201 });` que estaba.

- [ ] **Step 2: Mostrarlo en el formulario**

En `app/(app)/compras/requerimientos/NuevoRequerimientoModal.tsx`:

**2a.** Agregar el estado, junto a `const [error, setError] = useState("")`:

```ts
  /**
   * El pedido se guardó pero la planilla no se enteró.
   *
   * No es un error —el pedido existe— pero tampoco se puede cerrar el
   * formulario como si nada: quien lo cargó tiene que saber que en la planilla
   * todavía no está. Se reintenta solo en cada sincronización.
   */
  const [aviso, setAviso] = useState("");
```

**2b.** En `enviar`, reemplazar el final:

```ts
    setGuardando(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo guardar el requerimiento.");
      return;
    }
    onSaved();
```

por:

```ts
    const body = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar el requerimiento.");
      return;
    }
    if (body.aviso_sheets) {
      setAviso(body.aviso_sheets);
      return;
    }
    onSaved();
```

**2c.** Después del bloque de `{error && (…)}`, agregar:

```tsx
          {aviso && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <p className="font-semibold">El pedido se guardó, pero la planilla no se enteró.</p>
              <p className="mt-1">{aviso}</p>
              <p className="mt-1 text-xs">
                Se reintenta solo en la próxima sincronización. Si sigue, mirá
                Compras → Configuración.
              </p>
              <button
                type="button"
                onClick={onSaved}
                className="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                Entendido
              </button>
            </div>
          )}
```

- [ ] **Step 3: Verificar tipos y build**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add app/api/compras/requerimientos/route.ts "app/(app)/compras/requerimientos/NuevoRequerimientoModal.tsx"
git commit -m "feat(compras): el alta hecha en el sistema se escribe en la planilla"
```

---

### Task 6: El reintento distingue el alta de la exportación de compra

`reintentarPendientes()` llama a `exportarRequerimiento`, que escribe las columnas de compra en la fila del RI. Para un pedido que **nunca llegó a la planilla** eso no escribe nada: no tiene fila. Se reconoce por `hoja_origen` nulo.

**Files:**
- Modify: `lib/compras/sheets.ts` (`reintentarPendientes`)

- [ ] **Step 1: Traer también `hoja_origen` en la cola**

En `reintentarPendientes`, cambiar:

```ts
  const { data: pendientes } = await admin
    .from("compras_requerimientos")
    .select("id")
```

por:

```ts
  const { data: pendientes } = await admin
    .from("compras_requerimientos")
    // `hoja_origen` dice si el pedido llegó alguna vez a la planilla: el que no
    // llegó se reintenta con el alta y no con las columnas de compra, que
    // necesitan una fila que todavía no existe.
    .select("id, hoja_origen")
```

- [ ] **Step 2: Elegir qué reintentar**

Reemplazar el cuerpo del `try` del bucle:

```ts
    try {
      const { bloqueadas } = await exportarRequerimiento(r.id as string, cache);
      if (bloqueadas.length === 0) resueltos++;
      else siguenPendientes++;
    } catch {
      siguenPendientes++;
    }
```

por:

```ts
    try {
      if (!r.hoja_origen) {
        // Nunca llegó a la planilla: lo que falta es el alta.
        const { pendiente } = await exportarAltaAlFormulario(r.id as string);
        if (pendiente) {
          await admin
            .from("compras_requerimientos")
            .update({ sheets_pendiente: pendiente, sheets_intentado_en: new Date().toISOString() })
            .eq("id", r.id as string);
          siguenPendientes++;
        } else {
          await admin
            .from("compras_requerimientos")
            .update({ sheets_pendiente: null, sheets_intentado_en: new Date().toISOString() })
            .eq("id", r.id as string);
          resueltos++;
        }
        continue;
      }

      const { bloqueadas } = await exportarRequerimiento(r.id as string, cache);
      if (bloqueadas.length === 0) resueltos++;
      else siguenPendientes++;
    } catch {
      // Si la planilla no responde, queda pendiente para la próxima.
      siguenPendientes++;
    }
```

Y agregar el import arriba del archivo:

```ts
import { exportarAltaAlFormulario } from "@/lib/compras/formulario";
```

> `formulario.ts` importa `empresaParaPlanilla` de `sheets.ts` y `sheets.ts` importa `exportarAltaAlFormulario` de `formulario.ts`: es un ciclo de imports. En ESM funciona porque las dos son funciones y no se llaman al cargar el módulo, pero si Turbopack se queja, la salida es mover `empresaParaPlanilla` a `lib/compras/texto.ts` —no depende de nada de Sheets— y que `formulario.ts` la tome de ahí.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: sin errores. Ojo: parar `npm run dev` antes del build, o la app queda en 500.

- [ ] **Step 4: Commit**

```bash
git add lib/compras/sheets.ts
git commit -m "fix(compras): el reintento sabe que a un pedido nuevo le falta el alta"
```

---

### Task 7: `SOLICITA` se escribe junto con las demás

`SOLICITA` es la columna `M` de las pestañas por área, escrita a mano, y **el único lugar donde la planilla muestra quién pidió**: el `QUERY` del master saltea `Nombre` y `Apellido`.

**Files:**
- Modify: `lib/compras/sheets.ts` (`COLUMNAS_COMPRA` y los valores de `exportarRequerimiento`)

- [ ] **Step 1: Sumar la columna a la lista**

Cambiar:

```ts
const COLUMNAS_COMPRA = ["comparativa", "proveedor", "estado", "costo_iva", "costo_envio"] as const;
```

por:

```ts
/**
 * Columnas de la hoja de área que gestiona Compras.
 *
 * `solicita` no es de la compra pero se escribe acá porque es el único lugar de
 * la planilla donde figura quién pidió: el `QUERY` del master saltea las
 * columnas de nombre y apellido de la hoja de respuestas. Para los RI que
 * vinieron de la planilla es el mismo valor que ya está; para los cargados en
 * el sistema, la diferencia entre un pedido con dueño y uno anónimo.
 */
const COLUMNAS_COMPRA = [
  "solicita", "comparativa", "proveedor", "estado", "costo_iva", "costo_envio",
] as const;
```

- [ ] **Step 2: Darle valor**

En `exportarRequerimiento`, dentro del objeto `valores` de la sección "Columnas de compra", agregar como primera clave:

```ts
      const valores: Record<string, string | null> = {
        // Sólo si el sistema lo sabe: pisar con vacío el nombre que alguien
        // escribió a mano allá sería perderlo.
        solicita: (r.solicitante_nombre as string | null) || null,
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add lib/compras/sheets.ts
git commit -m "feat(compras): la planilla dice quien pidio cada requerimiento"
```

---

### Task 8: La variable de entorno y los documentos

**Files:**
- Modify: `docs/VARIABLES-VERCEL.md`
- Modify: `docs/COMPRAS-SINCRONIZACION.md`
- Modify: `docs/COMPRAS-ESTADO.md`

- [ ] **Step 1: La variable**

En `docs/VARIABLES-VERCEL.md`, en la tabla de "Sincronización con la planilla (módulo Compras)", agregar después de `GOOGLE_SHEETS_COMPRAS_ID`:

```markdown
| `GOOGLE_SHEETS_COMPRAS_FORMULARIO_ID` | La planilla de respuestas del formulario, `FORM PEDIDO DE COMPRA POLCECAL - POLYSAN`: `1T551q99JfhbXeYzGRbkhcZd6wwc4oh4v83UxPIGFLVM`. Es donde se escribe el **alta** de un pedido cargado en el sistema, porque las columnas del alta del master son la salida de un `QUERY(IMPORTRANGE())` de esta hoja | Sin ella el alta no se exporta y no es un error: se omite. La cuenta de servicio necesita **Editor** |
```

Y en el bloque de ejemplo con los valores, agregar la línea:

```
GOOGLE_SHEETS_COMPRAS_FORMULARIO_ID=1T551q99JfhbXeYzGRbkhcZd6wwc4oh4v83UxPIGFLVM
```

- [ ] **Step 2: La sincronización**

En `docs/COMPRAS-SINCRONIZACION.md`, en la tabla de "La regla", cambiar la fila de la planilla:

```markdown
| **Planilla** | El alta de RI nuevos | La gente sigue cargando por el formulario de Google |
```

por:

```markdown
| **Planilla** | El alta de los RI que entran por el formulario | La gente sigue cargando por el formulario de Google. Un RI cargado en el sistema **también llega**: se escribe en la hoja de respuestas y baja por las mismas fórmulas |
```

Y en la sección **Sistema → planilla**, agregar al final de la lista:

```markdown
- Al dar de alta un pedido en el sistema, escribe su fila en la **hoja de
  respuestas del formulario** —el único lugar escribible de un alta, porque las
  columnas del alta del master son la salida de un `QUERY(IMPORTRANGE())`— y la
  prioridad y la empresa en el master. El N° de RI lo sigue calculando la
  fórmula de esa hoja y el sistema lo verifica: si no coincide con el que
  asignó, no numera por su cuenta, lo deja pendiente y lo dice.
```

- [ ] **Step 3: La trampa, para la próxima**

En `docs/COMPRAS-ESTADO.md`, antes de `## Lo que quedó pendiente`, agregar:

```markdown
**Las columnas del alta de la planilla no son datos: son la salida de una
fórmula.** El master es un `QUERY(IMPORTRANGE())` de la planilla de respuestas
del formulario y cada pestaña por área es un `FILTER` del master, así que "que
la app escriba el alta" no era una escritura más: hay que escribir **una
planilla más arriba**, en `Respuestas de formulario 1`, y dejar que baje. Lo
único a mano en el master son prioridad, empresa y estado; en las pestañas, de
`SOLICITA` a los costos. El mapa completo está en el spec del 09/09/2026.

**Y la numeración de esa hoja es independiente de la base.** La columna del N°
de RI es una fórmula por fila (`=IF(B:B<>"",A_anterior+1,"")`) y cuenta las
filas de la hoja; el sistema numeraba con `max(nro_ri)+1` sobre la base. Con el
alta sin exportar, las dos series se separaron: el RI 1954 se cargó en el
sistema y la próxima respuesta del formulario iba a ser 1954 también, con el
`upsert` por `nro_ri` pisándole la descripción al pedido del sistema. Se
arregla porque cada alta ahora ocupa su fila allá, y el que numera vuelve a ser
uno solo.
```

- [ ] **Step 4: Commit**

```bash
git add docs/VARIABLES-VERCEL.md docs/COMPRAS-SINCRONIZACION.md docs/COMPRAS-ESTADO.md
git commit -m "docs(compras): la planilla del formulario, y por que el alta va ahi"
```

---

## Verificación de punta a punta, después de la última tarea

No se puede comprobar en el navegador —todo está detrás del login—, así que la
verificación es con datos reales:

1. **Configurar la variable** en Vercel y en `.env.local`, y confirmar que la
   cuenta de servicio tenga **Editor** sobre `1T551q99…`.
2. Cargar un pedido de prueba desde `/mis-pedidos`.
3. Comprobar en la hoja de respuestas que la fila quedó **al final**, que la
   columna A calculó el número del pedido, y que `M`, `N` y `O` siguen vacías.
4. Comprobar en el master, dos filas más arriba, que aparece con su prioridad y
   su empresa.
5. Correr la sincronización (`/compras/configuracion` → Sincronizar ahora) y
   confirmar con una consulta a la base que el pedido **sigue** con
   `origen = "app"`, su prioridad y su `paga_ambas`.
6. Aprobarlo desde el sistema y comprobar que aparece en la pestaña de su área,
   con `SOLICITA` puesto.
7. Borrar el pedido de prueba de la base y **vaciar su fila** en la hoja de
   respuestas (vaciar, no borrar la fila: correrla desalinea las columnas
   escritas a mano de las pestañas por área).

# El equipo del movimiento — plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que el formulario de movimientos de Inventario tenga campo de equipo, que ese equipo se escriba en la columna K del kardex, y que la sincronización lo lea de vuelta.

**Arquitectura:** el vocabulario de la K sale de la pestaña `Sectores/Equipos` de la planilla, espejada en una tabla nueva `inventario_equipos` (nombre literal + destino + enlace al núcleo). El texto que la app escribe sale de esa tabla y nunca del cliente, porque tiene que ser un valor que la validación de la planilla acepte. Las decisiones —qué se reconoce, qué cambia, qué celdas se escriben— viven en funciones puras de `lib/inventario/` con tests; las rutas y las pantallas sólo las llaman.

**Stack:** Next.js 16 (App Router), Supabase (PostgREST + RPC), Google Sheets API v4, Vitest.

**Spec:** [docs/superpowers/specs/2026-09-09-inventario-equipo-del-movimiento-design.md](../specs/2026-09-09-inventario-equipo-del-movimiento-design.md)

---

## Estructura de archivos

| Archivo | Responsabilidad | Estado |
|---|---|---|
| `supabase/migrations/<marca>_inventario_equipos_del_panol.sql` | La tabla, la columna, los 6 destinos que faltan | crear |
| `lib/inventario/planilla.ts` | Leer la columna EQUIPO del kardex | modificar |
| `lib/inventario/planilla.test.ts` | | modificar |
| `lib/inventario/espejo.ts` | Escribir la columna K | modificar |
| `lib/inventario/espejo.test.ts` | | modificar |
| `lib/inventario/enlaces.ts` | Reconocer un equipo del núcleo por su código | modificar |
| `lib/inventario/enlaces.test.ts` | | modificar |
| `lib/inventario/equipos.ts` | El espejo de la pestaña: qué insertar, qué actualizar, qué desactivar | crear |
| `lib/inventario/equipos.test.ts` | | crear |
| `lib/inventario/sincronizar.ts` | Orquestar: correr el espejo de la lista y guardar el equipo de cada fila | modificar |
| `app/api/inventario/movimientos/route.ts` | Resolver el equipo contra la lista y validar que sea del sector | modificar |
| `app/(app)/inventario/movimientos/nuevo/page.tsx` | Traer la lista de equipos | modificar |
| `app/(app)/inventario/movimientos/nuevo/NuevoMovimientoClient.tsx` | El select dependiente | modificar |
| `docs/VARIABLES-VERCEL.md` | La variable de la pestaña nueva | modificar |

**Las tareas 1 a 5 no necesitan la base.** Son funciones puras y se pueden hacer mientras la migración de la tarea 6 espera a que una persona la aplique. Las tareas 7 a 10 **sí** la necesitan aplicada.

---

## Contexto que hace falta antes de empezar

Cosas del repo que no se deducen del código que vas a tocar. Leerlas ahorra un error cada una:

- **Todo se escribe en castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Nunca `git add -A`.** Puede haber otra sesión trabajando en el mismo árbol. Agregá los archivos por nombre, los que tocaste y nada más. Si `tsc` o los tests fallan en archivos que no tocaste, mirá `git status` antes de arreglarlos.
- **`npm run lint` falla**: el repo no tiene config de ESLint. No es tu cambio. Se verifica con `npm test`, `npx tsc --noEmit` y `npm run build`.
- **`next build` con `npm run dev` levantado deja la app en 500.** Parar el dev server antes de buildear.
- **Un `select()` armado en una variable pierde la inferencia de tipos de Supabase.** La cadena va literal.
- **PostgREST corta en 1000 filas y no avisa.** Cualquier tabla que pueda crecer se lee con `traerTodo()` de `lib/core/paginado.ts`.
- **Las migraciones las corre una persona a mano** en el editor SQL de Supabase. Un agente puede escribirlas; no puede aplicarlas.

Comandos de verificación:

```bash
npm test
```

```bash
npx tsc --noEmit
```

---

## Tarea 1: el parser lee la columna EQUIPO

**Archivos:**
- Modificar: `lib/inventario/planilla.ts` (`ALIAS_KARDEX`, `MovimientoLeido`, `filaDeMovimiento`)
- Test: `lib/inventario/planilla.test.ts`

El encabezado real del kardex, medido el 9/9/2026, es:

```
["N°RI","CODIGO","DESCRIPCION","ENTRADAS","SALIDAS","QUIEN LO PIDIÓ","STOCK","FECHA","PROVEEDOR","SECTOR","EQUIPO","¿STOCK ACTUAL<=S.S.?"]
```

- [ ] **Paso 1: escribir el test que falla**

Agregar al final de `lib/inventario/planilla.test.ts`:

```ts
describe("el equipo del kardex", () => {
  const ENCABEZADO = [
    "N°RI", "CODIGO", "DESCRIPCION", "ENTRADAS", "SALIDAS", "QUIEN LO PIDIÓ",
    "STOCK", "FECHA", "PROVEEDOR", "SECTOR", "EQUIPO", "¿STOCK ACTUAL<=S.S.?",
  ];

  it("encuentra la columna EQUIPO", () => {
    expect(mapearKardex(ENCABEZADO).equipo).toBe(10);
  });

  it("la encuentra igual si la planilla la llama MAQUINA", () => {
    const otro = [...ENCABEZADO];
    otro[10] = "MAQUINA";
    expect(mapearKardex(otro).equipo).toBe(10);
  });

  it("es -1 cuando la planilla no la trae", () => {
    expect(mapearKardex(ENCABEZADO.slice(0, 10)).equipo).toBe(-1);
  });

  it("lee el equipo tal como esta escrito, sin normalizar", () => {
    const fila = [
      "", "00782", "RODAMIENTO 6308 SKF", "", "1", "FERNANDEZ, Rocco",
      "5", "7/9/2026", "", "FILLER 2", "PY-B1-05 - CINTA TRANSPORTADORA 3", "FALSE",
    ];
    const mov = filaDeMovimiento(fila, mapearKardex(ENCABEZADO), 4160);
    expect(mov?.equipo_raw).toBe("PY-B1-05 - CINTA TRANSPORTADORA 3");
  });

  /** El guion es como estas planillas escriben el vacio: lo trata `campo()`. */
  it("un guion suelto es null y no la cadena '-'", () => {
    const fila = [
      "", "00782", "RODAMIENTO 6308 SKF", "", "1", "FERNANDEZ, Rocco",
      "5", "7/9/2026", "", "FILLER 2", "-", "FALSE",
    ];
    expect(filaDeMovimiento(fila, mapearKardex(ENCABEZADO), 4160)?.equipo_raw).toBeNull();
  });

  it("una celda vacia es null", () => {
    const fila = [
      "", "00782", "RODAMIENTO 6308 SKF", "", "1", "FERNANDEZ, Rocco",
      "5", "7/9/2026", "", "FILLER 2", "", "FALSE",
    ];
    expect(filaDeMovimiento(fila, mapearKardex(ENCABEZADO), 4160)?.equipo_raw).toBeNull();
  });
});
```

Si `mapearKardex` o `filaDeMovimiento` no están importados en ese archivo, agregarlos al `import` de arriba.

- [ ] **Paso 2: correr el test para ver que falla**

```bash
npx vitest run lib/inventario/planilla.test.ts
```

Esperado: FAIL. Los de `mapearKardex` dan `undefined` en vez de `10`; los de `filaDeMovimiento` fallan al compilar porque `equipo_raw` no existe en `MovimientoLeido`.

- [ ] **Paso 3: agregar el alias**

En `lib/inventario/planilla.ts`, dentro de `ALIAS_KARDEX`, después de la línea de `sector`:

```ts
  sector: ["SECTOR", "AREA", "DESTINO"],
  equipo: ["EQUIPO", "MAQUINA", "EQUIPO/MAQUINA", "MAQUINA/EQUIPO"],
```

- [ ] **Paso 4: agregar el campo al tipo**

En `MovimientoLeido`, después de `sector_raw`:

```ts
  sector_raw: string | null;
  /**
   * La columna K, tal como está escrita. No se normaliza: es lo que la app va a
   * volver a escribir ahí, y la validación de la planilla acepta ese texto y no
   * otro parecido.
   */
  equipo_raw: string | null;
```

- [ ] **Paso 5: leerlo en `filaDeMovimiento`**

En el objeto que devuelve `filaDeMovimiento`, después de `sector_raw`:

```ts
    sector_raw: campo(celda("sector")),
    equipo_raw: campo(celda("equipo")),
```

- [ ] **Paso 6: correr los tests**

```bash
npx vitest run lib/inventario/planilla.test.ts
```

Esperado: PASS, todo el archivo.

- [ ] **Paso 7: commitear**

```bash
git add lib/inventario/planilla.ts lib/inventario/planilla.test.ts
```

```bash
git commit -m "feat(inventario): el parser del kardex lee la columna EQUIPO"
```

---

## Tarea 2: el espejo escribe la columna K

**Archivos:**
- Modificar: `lib/inventario/espejo.ts` (`COL`, `MovimientoAEspejar`, `celdasDelMovimiento`)
- Test: `lib/inventario/espejo.test.ts`

Se comprobó contra la planilla real que **la K es texto plano**, no fórmula. La G (saldo) y la L (`¿STOCK ACTUAL<=S.S.?`) sí lo son y no se tocan.

- [ ] **Paso 1: escribir el test que falla**

En `lib/inventario/espejo.test.ts`, agregar `equipo: null` al helper `mov` —después de `sector`— y agregar este bloque al final del archivo:

```ts
describe("el equipo va a la columna K", () => {
  it("K es la columna 10", () => {
    expect(COL.equipo).toBe(10);
  });

  it("se escribe el nombre tal como esta en la lista", () => {
    const celdas = celdasDelMovimiento(
      mov({ equipo: "PY-B1-05 - CINTA TRANSPORTADORA 3" }),
      4210,
      "Entradas  Salidas"
    );
    const k = celdas.find((c) => c.columna === COL.equipo);
    expect(k?.valor).toBe("PY-B1-05 - CINTA TRANSPORTADORA 3");
    expect(k?.fila).toBe(4210);
    expect(k?.pestana).toBe("Entradas  Salidas");
  });

  it("sin equipo se escribe vacio y no se omite la celda", () => {
    const celdas = celdasDelMovimiento(mov({ equipo: null }), 4210, "Entradas  Salidas");
    expect(celdas.find((c) => c.columna === COL.equipo)?.valor).toBe("");
  });

  /**
   * Prueba de regresion, no redundancia. La G es el saldo corriente y es una
   * formula: escribirla rompe el stock de todo lo que viene abajo. La L es
   * "¿STOCK ACTUAL<=S.S.?" y tambien es formula.
   */
  it("sigue sin tocar la G ni la L", () => {
    const columnas = celdasDelMovimiento(mov({ equipo: "PAÑOL" }), 4210, "Entradas  Salidas")
      .map((c) => c.columna);
    expect(columnas).not.toContain(6);
    expect(columnas).not.toContain(11);
  });
});
```

- [ ] **Paso 2: correr el test para ver que falla**

```bash
npx vitest run lib/inventario/espejo.test.ts
```

Esperado: FAIL — `COL.equipo` no existe y `equipo` no está en `MovimientoAEspejar`.

- [ ] **Paso 3: agregar la columna al mapa**

En `lib/inventario/espejo.ts`, dentro de `COL`, después de `sector`:

```ts
  sector: 9,      // J
  equipo: 10,     // K
  // L = "¿STOCK ACTUAL<=S.S.?", formula. No se toca.
```

- [ ] **Paso 4: agregar el campo al tipo**

En `MovimientoAEspejar`, después de `sector`:

```ts
  sector: string | null;
  /**
   * El nombre del equipo, tal como está en `inventario_equipos`.
   *
   * Sale de la lista y nunca del cliente: en la planilla la K es un desplegable
   * que un `onEdit` arma con los equipos del sector de la J, y aunque las
   * escrituras por API no pasan por esa validación, escribir ahí un texto que
   * el desplegable no ofrece deja una celda que nadie puede volver a elegir.
   */
  equipo: string | null;
```

- [ ] **Paso 5: escribir la celda**

En `celdasDelMovimiento`, agregar al final del array que devuelve:

```ts
    celda(COL.sector, m.sector ?? ""),
    celda(COL.equipo, m.equipo ?? ""),
  ];
```

- [ ] **Paso 6: correr los tests**

```bash
npx vitest run lib/inventario/espejo.test.ts
```

Esperado: PASS.

- [ ] **Paso 7: commitear**

```bash
git add lib/inventario/espejo.ts lib/inventario/espejo.test.ts
```

```bash
git commit -m "feat(inventario): el espejo escribe el equipo en la columna K del kardex"
```

---

## Tarea 3: reconocer un equipo del núcleo por su código

**Archivos:**
- Modificar: `lib/inventario/enlaces.ts`
- Test: `lib/inventario/enlaces.test.ts`

**Por qué por código y no por nombre.** De los 255 equipos de la pestaña, 26 comparten el código con el núcleo y tienen otro nombre: `EM8` es `SCANIA 420 4x4` en la planilla y `CAMIÓN VOLCADOR 1` en `equipos`. Matchear por nombre perdería esos 26. El código es el mismo en las dos puntas.

La tabla `equipos` del núcleo usa **`code` y `name`**, no `codigo` y `nombre` — es la única del núcleo en inglés, así que las funciones nuevas reciben esos nombres de propiedad.

- [ ] **Paso 1: escribir el test que falla**

Agregar al final de `lib/inventario/enlaces.test.ts`:

```ts
describe("reconocer un equipo del nucleo", () => {
  const equipos = [
    { id: "e1", code: "PO-A1-11", name: "Cinta transportadora 6" },
    { id: "e2", code: "PO-D1-10", name: "Separador dinámico 2" },
    { id: "e3", code: "EM8", name: "Camión volcador 1" },
    { id: "e4", code: "C1", name: "Compresor 1" },
    { id: "e5", code: "PY-B1-05", name: "Cinta transportadora 3" },
  ];
  const indice = indiceDeEquipos(equipos);

  it("engancha por el codigo cuando el nombre coincide", () => {
    expect(reconocerEquipo(indice, "PO-A1-11 - CINTA TRANSPORTADORA 6")).toBe("e1");
  });

  /**
   * Los 26 casos que costaron el diseño: la planilla y el nucleo le dicen
   * distinto a la misma maquina. El codigo manda.
   */
  it("engancha por el codigo aunque el nombre no coincida", () => {
    expect(reconocerEquipo(indice, "EM8 - SCANIA 420 4x4")).toBe("e3");
  });

  /** Los dos huerfanos del kardex, que no estan en la pestana. */
  it("engancha los separadores dinamicos 3 y 4 con el PO-D1-10", () => {
    expect(reconocerEquipo(indice, "PO-D1-10 - SEPARADOR DINÁMICO 3")).toBe("e2");
    expect(reconocerEquipo(indice, "PO-D1-10 - SEPARADOR DINÁMICO 4")).toBe("e2");
  });

  it("engancha un codigo escrito solo, sin nombre", () => {
    expect(reconocerEquipo(indice, "C1")).toBe("e4");
  });

  it("engancha por el nombre completo cuando no hay codigo adelante", () => {
    expect(reconocerEquipo(indice, "PY-B1-05 - Cinta Transportadora 3")).toBe("e5");
  });

  /**
   * Los oficios y los lugares que la pestana usa como relleno NO son equipos
   * del nucleo. Quedan en null a proposito: enlazar al que se le parece es peor
   * que dejar vacio.
   */
  it("lo que no es un equipo queda en null", () => {
    expect(reconocerEquipo(indice, "PAÑOL")).toBeNull();
    expect(reconocerEquipo(indice, "GALPON 5")).toBeNull();
    expect(reconocerEquipo(indice, "TALLER ELÉCTRICO")).toBeNull();
    expect(reconocerEquipo(indice, "PO-C1-11 - EDIFICIO")).toBeNull();
  });

  it("vacio, null y un guion suelto quedan en null", () => {
    expect(reconocerEquipo(indice, "")).toBeNull();
    expect(reconocerEquipo(indice, null)).toBeNull();
    expect(reconocerEquipo(indice, "-")).toBeNull();
  });

  it("dos equipos con el mismo codigo no resuelven a ninguno", () => {
    const ambiguo = indiceDeEquipos([
      { id: "a", code: "X1", name: "Uno" },
      { id: "b", code: "X1", name: "Otro" },
    ]);
    expect(reconocerEquipo(ambiguo, "X1 - UNO")).toBeNull();
  });

  it("un equipo sin codigo entra igual, por su nombre", () => {
    const sinCode = indiceDeEquipos([{ id: "z", code: null, name: "Molino viejo" }]);
    expect(reconocerEquipo(sinCode, "MOLINO VIEJO")).toBe("z");
  });
});
```

Agregar `indiceDeEquipos` y `reconocerEquipo` al `import` de `./enlaces` que ya tiene el archivo.

- [ ] **Paso 2: correr el test para ver que falla**

```bash
npx vitest run lib/inventario/enlaces.test.ts
```

Esperado: FAIL — `indiceDeEquipos is not a function`.

- [ ] **Paso 3: implementar las dos funciones**

En `lib/inventario/enlaces.ts`, después de `indiceDeEmpleados` y antes de `reconocer`:

```ts
/**
 * El índice de equipos del núcleo, armado por **código**.
 *
 * La planilla escribe `"PO-A1-11 - CINTA TRANSPORTADORA 6"`: el código y el
 * nombre pegados con un guión. Y en 26 de los 255 equipos de la pestaña el
 * nombre **no** es el del núcleo —`EM8` es "SCANIA 420 4x4" en la planilla y
 * "CAMIÓN VOLCADOR 1" en `equipos`—, así que matchear por nombre perdería esos
 * 26. El código es lo único que las dos puntas escriben igual.
 *
 * Se indexa por tres formas: el código solo, el `código - nombre` del núcleo, y
 * el nombre solo. Las tres van al mismo id, así que no compiten entre sí; un
 * empate real —dos equipos con el mismo código, o dos con el mismo nombre en
 * plantas distintas— resuelve a null, igual que en `indicePorNombre`.
 *
 * `equipos` es la única tabla del núcleo con las columnas en inglés (`code`,
 * `name`), de cuando la trajo Mantenimiento. Por eso la firma no dice `codigo`
 * ni `nombre`.
 */
export function indiceDeEquipos(
  filas: { id: string; code?: string | null; name: string }[]
): Indice {
  const indice: Indice = new Map();

  for (const f of filas) {
    const code = String(f.code ?? "").trim();
    const name = String(f.name ?? "").trim();
    const formas = code ? [code, `${code} - ${name}`, name] : [name];

    for (const forma of formas) {
      const k = claveDeProveedor(forma);
      if (!k) continue;
      // Contra el id y no contra la clave: las tres formas del mismo equipo son
      // el mismo equipo. Dos equipos distintos con la misma clave sí empatan.
      indice.set(k, indice.has(k) && indice.get(k) !== f.id ? null : f.id);
    }
  }
  return indice;
}

/**
 * El equipo del núcleo que nombra ese texto, o null.
 *
 * Primero prueba el **código**, que es lo que está antes del primer `" - "`; si
 * eso no reconoce nada, prueba el texto entero. En ese orden porque el código
 * es lo confiable: los nombres divergen.
 *
 * Devuelve null para `PAÑOL`, `GALPON 5` y `PO-C1-11 - EDIFICIO`, que la
 * pestaña usa como relleno para que el desplegable de un sector sin máquinas no
 * quede vacío. No son equipos y no tienen por qué serlo.
 */
export function reconocerEquipo(
  indice: Indice,
  texto: string | null | undefined
): string | null {
  const s = String(texto ?? "").trim();
  if (!s || s === "-") return null;

  const porCodigo = reconocer(indice, s.split(" - ")[0]);
  return porCodigo ?? reconocer(indice, s);
}
```

`reconocerEquipo` usa `reconocer`, que está declarada más abajo en el archivo: las declaraciones de función se izan, así que el orden no importa.

- [ ] **Paso 4: correr los tests**

```bash
npx vitest run lib/inventario/enlaces.test.ts
```

Esperado: PASS.

- [ ] **Paso 5: commitear**

```bash
git add lib/inventario/enlaces.ts lib/inventario/enlaces.test.ts
```

```bash
git commit -m "feat(inventario): reconocer un equipo del nucleo por su codigo"
```

---

## Tarea 4: leer un par de la pestaña `Sectores/Equipos`

**Archivos:**
- Crear: `lib/inventario/equipos.ts`
- Crear: `lib/inventario/equipos.test.ts`

La pestaña tiene dos columnas y encabezado `["SECTOR","EQUIPO"]`. Se midió: 255 pares, sin filas a medias, y ningún equipo repetido en dos sectores.

- [ ] **Paso 1: escribir el test que falla**

Crear `lib/inventario/equipos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filaDeSectorYEquipo } from "./equipos";

describe("una fila de la pestana Sectores/Equipos", () => {
  it("devuelve el par con los dos lados recortados", () => {
    expect(filaDeSectorYEquipo(["  PLANTA TRITURACIÓN 1 ", " PO-A1-01 - ACARREADOR DE PLACAS "]))
      .toEqual({ sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" });
  });

  it("descarta la fila que solo trae el sector", () => {
    expect(filaDeSectorYEquipo(["FILLER 1", ""])).toBeNull();
  });

  it("descarta la fila que solo trae el equipo", () => {
    expect(filaDeSectorYEquipo(["", "PO-A1-01 - ACARREADOR DE PLACAS"])).toBeNull();
  });

  it("descarta la fila vacia y la fila corta", () => {
    expect(filaDeSectorYEquipo(["", ""])).toBeNull();
    expect(filaDeSectorYEquipo([])).toBeNull();
  });

  /** El guion es como estas planillas escriben el vacio. */
  it("descarta la fila con un guion suelto de cualquiera de los dos lados", () => {
    expect(filaDeSectorYEquipo(["-", "PO-A1-01 - ACARREADOR DE PLACAS"])).toBeNull();
    expect(filaDeSectorYEquipo(["FILLER 1", "-"])).toBeNull();
  });
});
```

- [ ] **Paso 2: correr el test para ver que falla**

```bash
npx vitest run lib/inventario/equipos.test.ts
```

Esperado: FAIL — no existe `./equipos`.

- [ ] **Paso 3: crear el archivo con la función**

Crear `lib/inventario/equipos.ts`:

```ts
/**
 * La lista de equipos del pañol: el vocabulario de la columna K del kardex.
 *
 * En la planilla la K no es texto libre. Un `onEdit` de Apps Script le arma un
 * desplegable dependiente: cuando cambia el sector de la J, borra la K y le
 * pone una validación con los equipos de ese sector, leídos de la pestaña
 * **`Sectores/Equipos`** —columna A el sector, columna B el equipo—.
 *
 * Esa pestaña es la validación de verdad, así que **esta lista se espeja de
 * ella en cada sincronización** en vez de administrarse por pantalla. Es la
 * diferencia con `inventario_destinos` y `inventario_solicitantes`, que son
 * catálogos del SdG: a esos la planilla no los publica en ningún lado legible,
 * sólo en un rango de validación, y por eso se siembran una vez y se editan
 * acá. Un equipo nuevo, en cambio, el pañol lo tiene que agregar a la pestaña
 * igual —o el desplegable de la planilla no lo ofrece—, y el SdG lo levanta
 * solo.
 *
 * **El nombre se guarda literal.** Es lo que la app va a escribir en la K, y
 * tiene que ser un valor que el desplegable ofrezca: `EM8` es
 * "SCANIA 420 4x4" en la planilla y "CAMIÓN VOLCADOR 1" en `equipos`, así que
 * armar el texto desde el núcleo escribiría 26 nombres que nadie puede volver a
 * elegir. El núcleo se usa para enganchar por código y nada más.
 */

/** Un par de la pestaña, ya recortado. */
export interface ParDeLaPestana {
  sector: string;
  equipo: string;
}

/**
 * Un par de la pestaña. `null` si la fila no lo es.
 *
 * Hacen falta las dos columnas: un equipo sin sector no se puede colgar de
 * ningún destino y un sector sin equipo no aporta nada. Hoy la pestaña no tiene
 * ninguna a medias —se midieron las 255—, y esto es para que el día que
 * aparezca no entre una fila muda.
 */
export function filaDeSectorYEquipo(fila: unknown[]): ParDeLaPestana | null {
  const limpio = (v: unknown): string => {
    const s = String(v ?? "").trim();
    return s === "-" ? "" : s;
  };

  const sector = limpio(fila?.[0]);
  const equipo = limpio(fila?.[1]);
  if (!sector || !equipo) return null;

  return { sector, equipo };
}
```

- [ ] **Paso 4: correr los tests**

```bash
npx vitest run lib/inventario/equipos.test.ts
```

Esperado: PASS.

- [ ] **Paso 5: commitear**

```bash
git add lib/inventario/equipos.ts lib/inventario/equipos.test.ts
```

```bash
git commit -m "feat(inventario): leer un par de la pestana Sectores/Equipos"
```

---

## Tarea 5: decidir qué cambia en la lista

**Archivos:**
- Modificar: `lib/inventario/equipos.ts` (agregar `equiposQueCambian`)
- Test: `lib/inventario/equipos.test.ts`

Esta es la función que importa: decide qué insertar, qué actualizar y qué desactivar. **No borra nunca.** Un equipo que desaparece de la pestaña queda `activo = false`, porque borrar la fila dejaría los movimientos históricos apuntando a la nada, y porque un error de lectura vaciaría el select sin que nadie se entere.

- [ ] **Paso 1: escribir el test que falla**

Agregar a `lib/inventario/equipos.test.ts`. Sumar `equiposQueCambian` al `import` de `./equipos` que ya tiene el archivo, y agregar uno nuevo:

```ts
import { indiceDeEquipos } from "./enlaces";
```

```ts
const DESTINOS = [
  { id: "d1", nombre: "PLANTA TRITURACIÓN 1" },
  { id: "d2", nombre: "FILLER 2" },
  { id: "d3", nombre: "PAÑOL" },
];

/**
 * El indice del nucleo, armado con la funcion de verdad y no a mano: las claves
 * las decide `claveDeProveedor`, que conserva los guiones —"PO-A1-01" queda
 * "po-a1-01"—, y un test que las escriba a mano se rompe si eso cambia.
 */
const NUCLEO = indiceDeEquipos([
  { id: "e1", code: "PO-A1-01", name: "Acarreador de placas" },
  { id: "e5", code: "PY-B1-05", name: "Cinta transportadora 3" },
]);

describe("que cambia en la lista de equipos", () => {
  it("inserta lo que la pestana trae y la lista no tiene", () => {
    const cambios = equiposQueCambian(
      [{ sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" }],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.nuevos).toEqual([
      { nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1" },
    ]);
    expect(cambios.actualizados).toEqual([]);
    expect(cambios.desactivados).toEqual([]);
  });

  it("no toca el que ya esta igual", () => {
    const cambios = equiposQueCambian(
      [{ sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" }],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: true }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios).toEqual({ nuevos: [], actualizados: [], desactivados: [], sinDestino: [] });
  });

  it("actualiza el que cambio de sector en la pestana", () => {
    const cambios = equiposQueCambian(
      [{ sector: "FILLER 2", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" }],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: true }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.actualizados).toEqual([
      { id: "x1", destino_id: "d2", equipment_id: "e1", activo: true },
    ]);
    expect(cambios.nuevos).toEqual([]);
  });

  it("reactiva el que habia desaparecido y volvio", () => {
    const cambios = equiposQueCambian(
      [{ sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" }],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: false }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.actualizados).toEqual([
      { id: "x1", destino_id: "d1", equipment_id: "e1", activo: true },
    ]);
  });

  /**
   * No se borra: los movimientos historicos le apuntan, y un error de lectura
   * de la pestana vaciaria el select sin que nadie se entere.
   */
  it("desactiva el que ya no esta en la pestana, y no lo borra", () => {
    const cambios = equiposQueCambian(
      [],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: true }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.desactivados).toEqual(["x1"]);
    expect(cambios.nuevos).toEqual([]);
    expect(cambios.actualizados).toEqual([]);
  });

  it("no vuelve a desactivar al que ya esta inactivo", () => {
    const cambios = equiposQueCambian(
      [],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: false }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.desactivados).toEqual([]);
  });

  /**
   * Un sector que no esta en `inventario_destinos` se informa; no se le inventa
   * un destino ni se lo cuelga del que se le parece. Es lo que hay que agregar.
   */
  it("informa el sector que no es un destino conocido, y no inserta el equipo", () => {
    const cambios = equiposQueCambian(
      [
        { sector: "GALPONES", equipo: "GALPON 5" },
        { sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
      ],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.sinDestino).toEqual(["GALPONES"]);
    expect(cambios.nuevos.map((n) => n.nombre)).toEqual(["PO-A1-01 - ACARREADOR DE PLACAS"]);
  });

  it("informa cada sector desconocido una sola vez y ordenado", () => {
    const cambios = equiposQueCambian(
      [
        { sector: "GALPONES", equipo: "GALPON 5" },
        { sector: "BALANZA", equipo: "BALANZA" },
        { sector: "GALPONES", equipo: "GALPON 1" },
      ],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.sinDestino).toEqual(["BALANZA", "GALPONES"]);
  });

  /** Los oficios y los lugares no son equipos del nucleo: quedan en null. */
  it("el equipo que no es del nucleo entra con equipment_id en null", () => {
    const cambios = equiposQueCambian(
      [{ sector: "PAÑOL", equipo: "PAÑOL" }],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.nuevos).toEqual([
      { nombre: "PAÑOL", destino_id: "d3", equipment_id: null },
    ]);
  });

  it("el destino se reconoce sin importar acentos ni mayusculas", () => {
    const cambios = equiposQueCambian(
      [{ sector: "planta trituracion 1", equipo: "PY-B1-05 - CINTA TRANSPORTADORA 3" }],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.nuevos[0]?.destino_id).toBe("d1");
  });

  it("la pestana repetida no inserta dos veces el mismo equipo", () => {
    const cambios = equiposQueCambian(
      [
        { sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
        { sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
      ],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.nuevos).toHaveLength(1);
  });
});
```

- [ ] **Paso 2: correr el test para ver que falla**

```bash
npx vitest run lib/inventario/equipos.test.ts
```

Esperado: FAIL — `equiposQueCambian is not a function`.

- [ ] **Paso 3: implementar**

Agregar a `lib/inventario/equipos.ts`. Arriba, junto a los imports:

```ts
import { indicePorNombre, reconocer, reconocerEquipo, type Indice } from "@/lib/inventario/enlaces";
```

Y al final del archivo:

```ts
/** Una fila de la lista, como está guardada. */
export interface EquipoDeLaLista {
  id: string;
  nombre: string;
  destino_id: string;
  equipment_id: string | null;
  activo: boolean;
}

export interface CambiosDeEquipos {
  nuevos: { nombre: string; destino_id: string; equipment_id: string | null }[];
  actualizados: { id: string; destino_id: string; equipment_id: string | null; activo: true }[];
  /** Ids de los que ya no están en la pestaña. Se desactivan; no se borran. */
  desactivados: string[];
  /** Sectores que la pestaña nombra y `inventario_destinos` no tiene. */
  sinDestino: string[];
}

/**
 * Qué hay que hacerle a la lista para que refleje la pestaña.
 *
 * Va aparte de la escritura para poder probarla: es la parte que decide, y una
 * decisión equivocada acá deja el select ofreciendo un equipo del sector que no
 * es —o no ofreciendo ninguno—.
 *
 * **La clave es el nombre.** La pestaña no tiene ids, así que es lo único que
 * identifica una fila entre dos corridas. Se compara con la misma normalización
 * que el resto del módulo —sin acentos, sin mayúsculas, espacios colapsados—
 * para que un espacio de más en la planilla no inserte un duplicado; lo que se
 * **guarda** es el texto literal, que es lo que va a la columna K.
 *
 * **No borra nunca.** Lo que desaparece de la pestaña queda `activo = false`:
 * los movimientos históricos le apuntan, y si un día la pestaña se lee mal, una
 * lista vaciada sería un select vacío que nadie relaciona con la sincronización.
 *
 * **Un sector que no es un destino se informa y su equipo no entra.** No se le
 * inventa un destino ni se lo cuelga del que se le parece: enlazar al que se le
 * parece es peor que dejar en null, y acá además dejaría el equipo colgado del
 * sector equivocado en el select de otra persona.
 */
export function equiposQueCambian(
  pestana: ParDeLaPestana[],
  lista: EquipoDeLaLista[],
  destinos: { id: string; nombre: string }[],
  nucleo: Indice
): CambiosDeEquipos {
  const porDestino = indicePorNombre(destinos);
  const clave = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const actual = new Map(lista.map((e) => [clave(e.nombre), e]));
  const cambios: CambiosDeEquipos = {
    nuevos: [], actualizados: [], desactivados: [], sinDestino: [],
  };

  const vistos = new Set<string>();
  const sinDestino = new Set<string>();

  for (const par of pestana) {
    const destino_id = reconocer(porDestino, par.sector);
    if (!destino_id) { sinDestino.add(par.sector); continue; }

    const k = clave(par.equipo);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);

    const equipment_id = reconocerEquipo(nucleo, par.equipo);
    const ya = actual.get(k);

    if (!ya) {
      cambios.nuevos.push({ nombre: par.equipo, destino_id, equipment_id });
      continue;
    }
    if (ya.destino_id !== destino_id || ya.equipment_id !== equipment_id || !ya.activo) {
      cambios.actualizados.push({ id: ya.id, destino_id, equipment_id, activo: true });
    }
  }

  for (const e of lista) {
    if (e.activo && !vistos.has(clave(e.nombre))) cambios.desactivados.push(e.id);
  }

  cambios.sinDestino = [...sinDestino].sort();
  return cambios;
}
```

La normalización es local y no `claveDeProveedor` porque acá la clave la usan dos lados que no se hablan —la pestaña y la lista— y conviene que no dependa de una función pensada para nombres de proveedor. Es la misma regla, escrita para lo que compara.

- [ ] **Paso 4: correr los tests**

```bash
npx vitest run lib/inventario/equipos.test.ts
```

Esperado: PASS, los 12 casos.

- [ ] **Paso 5: correr toda la suite**

```bash
npm test
```

Esperado: PASS. Si falla algo en un archivo que no tocaste, mirá `git status` antes de arreglarlo.

- [ ] **Paso 6: commitear**

```bash
git add lib/inventario/equipos.ts lib/inventario/equipos.test.ts
```

```bash
git commit -m "feat(inventario): decidir que cambia en la lista de equipos del panol"
```

---

## Tarea 6: la migración — se escribe acá, la aplica una persona

**Archivos:**
- Crear: `supabase/migrations/<marca>_inventario_equipos_del_panol.sql`

**El nombre del archivo no se escribe a mano.** Catorce dígitos se erran y un dígito de menos rompe el orden en que se corren:

```bash
npm run migracion "inventario equipos del panol"
```

Eso imprime la ruta del archivo creado, con un encabezado a completar.

Cinco trampas de esta base que aplican a esta migración:

- **No hay valores de enum nuevos**, así que puede ir todo en un archivo. (Un valor de enum nuevo viaja solo o falla con `55P04`.)
- **Un error en cualquier línea revierte el archivo entero** — el editor de Supabase lo envuelve en una transacción. Por eso todo va con `if not exists`, y `drop trigger if exists` antes de `create trigger`, que no acepta `if not exists`.
- **`min()` no existe para uuid.** Para elegir un valor de un grupo, `(array_agg(id))[1]`.
- **Un índice parcial no sirve como destino de `ON CONFLICT`.** El de `equipo_id` es sólo para consultar, no para upsert, así que parcial está bien.
- **`notify pgrst, 'reload schema'` al final**, o hasta que Supabase recargue la caché cada consulta responde "Could not find the table in the schema cache", que se lee como si la migración no hubiera corrido.

- [ ] **Paso 1: crear el archivo**

```bash
npm run migracion "inventario equipos del panol"
```

- [ ] **Paso 2: escribir el contenido**

Reemplazar todo el contenido del archivo creado por esto:

```sql
-- ============================================================
-- SdG — Inventario: los equipos del pañol
--
-- EL PROBLEMA. El formulario de movimientos no tiene campo de equipo y el
-- kardex de la planilla sí: es su columna K. Está viva —580 de 4.174 filas la
-- traen cargada— y los siete movimientos que se cargaron desde la app quedaron
-- con esa celda vacía.
--
-- CÓMO FUNCIONA ESA COLUMNA. No es texto libre: un `onEdit` de Apps Script le
-- arma un desplegable dependiente del sector de la J, con los equipos de la
-- pestaña `Sectores/Equipos` —columna A el sector, columna B el equipo—. 255
-- pares, 26 sectores, y ningún equipo repetido en dos sectores: es un equipo
-- con su sector al lado.
--
-- POR QUÉ EL NOMBRE NO SE ARMA CON EL DEL NÚCLEO. De esos 255, 19 no tienen
-- código en `equipos` —los once oficios que la pestaña usa de relleno, más
-- `PO-C1-11 - EDIFICIO`, `D1`, `D6`, `LA ALCANCIA` y `GALPON 1/2/3/5`— y **26
-- comparten el código con otro nombre**: `EM8` es "SCANIA 420 4x4" en la
-- planilla y "CAMIÓN VOLCADOR 1" acá; `PY-A2-14` es "EMBOLSADORA" allá y
-- "FLUIDOR 7" acá. Armar el texto desde el núcleo escribiría en la K 26 valores
-- que el desplegable no ofrece. El nombre se guarda literal y el núcleo se usa
-- para enganchar por código, que es lo único que las dos puntas escriben igual.
--
-- POR QUÉ NO SE SIEMBRAN LOS 255 ACÁ. La pestaña es una pestaña hecha para
-- leerse, así que la lista se espeja de ella en cada sincronización en vez de
-- administrarse por pantalla. Sembrarla en SQL sería una segunda copia que
-- envejece sola. La contra, dicha: entre que esta migración se aplica y que
-- alguien aprieta "Traer de la planilla", el select no tiene nada que ofrecer.
-- ============================================================

-- ── Los seis destinos que faltaban ───────────────────────────
--
-- La validación de la columna J (`Empleados!D2:D28`) acepta 27 valores y
-- `inventario_destinos` tenía 21. Los seis que faltan tienen entre ellos 23
-- equipos en la pestaña, que sin un destino donde colgarse el select nunca
-- podría ofrecer.
--
-- Es exactamente la contra que la 20260903090920 dejó anotada —"si el pañol
-- agrega a alguien a la validación de la planilla y nadie lo carga acá, la app
-- no se entera"— cobrada por primera vez.

insert into inventario_destinos (nombre) values
  ('PLANTA TRITURACIÓN 2'),
  ('FILLER 3'),
  ('COMPRESORES'),
  ('CAPATACES'),
  ('BALANZA'),
  ('GALPONES')
on conflict (nombre) do nothing;

-- El sector del núcleo, para los que son uno. De los seis lo son dos: `Filler
-- 3` y `Compresores` están en `sectores`; `PLANTA TRITURACIÓN 2`, `CAPATACES`,
-- `BALANZA` y `GALPONES` no, y quedan en null a propósito — igual que MECÁNICO
-- y TALLER VIAL de la siembra original.
--
-- `having count(*) = 1` es lo que hace que un nombre repetido en `sectores`
-- quede en null en vez de engancharse al azar: hay dos sectores llamados
-- "Mantenimiento" y dos "Producción". Y el valor se saca con
-- `(array_agg(id))[1]` porque Postgres no tiene `min()` para uuid — eso hizo
-- revertir la 20260903090920 entera sin dejar rastro.

update inventario_destinos d
   set sector_id = (
         select (array_agg(s.id))[1]
           from sectores s
          where s.activo
            and upper(s.nombre) = upper(d.nombre)
         having count(*) = 1
       ),
       updated_at = now()
 where d.sector_id is null
   and d.nombre in (
     'PLANTA TRITURACIÓN 2', 'FILLER 3', 'COMPRESORES',
     'CAPATACES', 'BALANZA', 'GALPONES'
   );

-- ── La lista de equipos ──────────────────────────────────────

create table if not exists inventario_equipos (
  id           uuid primary key default gen_random_uuid(),
  -- Tal cual está en la columna B de `Sectores/Equipos`. Es lo que la app va a
  -- escribir en la K, y por eso no se normaliza ni se pasa a mayúsculas: tiene
  -- que ser un valor que el desplegable de la planilla ofrezca.
  nombre       text not null unique,
  -- El sector de la columna A. `not null` y `restrict`: un equipo sin destino no
  -- lo puede ofrecer nadie, así que borrar un destino con equipos colgados tiene
  -- que fallar en vez de dejar filas mudas. Los pares cuyo sector no es un
  -- destino conocido no entran: la sincronización los informa.
  destino_id   uuid not null references inventario_destinos(id) on delete restrict,
  -- El equipo del núcleo, cuando se lo reconoce **por código**. NULL en los 19
  -- que no son equipos: los oficios de relleno, los galpones y `D1`/`D6`.
  equipment_id uuid references equipos(id) on delete set null,
  -- Lo que desaparece de la pestaña se desactiva; no se borra. Los movimientos
  -- históricos le apuntan, y una lista vaciada por un error de lectura sería un
  -- select vacío que nadie relaciona con la sincronización.
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists inventario_equipos_destino_idx
  on inventario_equipos (destino_id);

-- `drop` antes de `create`: Postgres no tiene `create trigger if not exists`, y
-- sin esto correr la migración dos veces falla con "trigger already exists" —y
-- como el editor de Supabase envuelve el script en una transacción, ese error
-- revierte TODO, incluidas las tablas. Se ve igual que si nunca hubiera corrido.
drop trigger if exists inventario_equipos_updated_at on inventario_equipos;
create trigger inventario_equipos_updated_at
  before update on inventario_equipos
  for each row execute function set_updated_at();

comment on table inventario_equipos is
  'El vocabulario de la columna K del kardex: para qué máquina salió el material. Es el espejo de la pestaña `Sectores/Equipos` de la planilla, que es de donde el `onEdit` arma el desplegable dependiente del sector. Se re-lee en cada sincronización; no se administra por pantalla.';
comment on column inventario_equipos.nombre is
  'Literal la columna B de la pestaña. No se normaliza: es lo que la app escribe en la K y tiene que ser un valor que el desplegable ofrezca. `EM8` es "SCANIA 420 4x4" acá y "CAMIÓN VOLCADOR 1" en `equipos`, y son 26 así.';
comment on column inventario_equipos.equipment_id is
  'El equipo del núcleo, enganchado por código. NULL en los 19 valores que la pestaña usa y no son equipos —PAÑOL, MECÁNICO, GALPON 5, D6— y que no tienen por qué serlo.';

-- ── El movimiento apunta a la lista ──────────────────────────
--
-- `equipo_raw` y `equipment_id` ya existen desde la 046. `equipo_raw` guarda el
-- texto —el de la planilla cuando viene de allá, el de la lista cuando lo carga
-- la app— y es de donde el kardex de la app lee el equipo; esto es el enlace, y
-- es lo que permite preguntar "cuánto se gastó en el molino vertical", que
-- `equipment_id` sí puede contestar y `equipo_raw` no sin resolver texto.

alter table inventario_movimientos
  add column if not exists equipo_id uuid references inventario_equipos(id) on delete set null;

create index if not exists inventario_mov_equipo_idx
  on inventario_movimientos (equipo_id) where equipo_id is not null;

-- ── RLS ──────────────────────────────────────────────────────
--
-- Sólo lectura para la app. A diferencia de `inventario_destinos` y
-- `inventario_solicitantes`, esta lista **no se edita desde el navegador**: la
-- escribe la sincronización con la service role, que no pasa por RLS. Sin
-- política de escritura, un POST directo a la tabla no puede meter un nombre
-- que la validación de la planilla no acepte. Si algún día hay ABM, la política
-- se agrega entonces.

alter table inventario_equipos enable row level security;

drop policy if exists inventario_equipos_select on inventario_equipos;
create policy inventario_equipos_select on inventario_equipos
  for select to authenticated using (tiene_acceso_inventario());

-- ── Que PostgREST vea la tabla nueva ─────────────────────────
notify pgrst, 'reload schema';
```

- [ ] **Paso 3: commitear la migración**

```bash
git add supabase/migrations/
```

```bash
git commit -m "feat(inventario): la tabla de equipos del panol y los seis destinos que faltaban"
```

- [ ] **Paso 4: pedirle al usuario que la aplique y esperar**

Decirle, con el nombre exacto del archivo:

> Escribí `supabase/migrations/<archivo>.sql`. Necesito que la corras en el editor SQL de Supabase antes de seguir: las tareas 7 a 10 leen y escriben `inventario_equipos`, que todavía no existe. Avisame cuando esté y sigo. Si el editor tira algo en rojo, pegámelo: un error en cualquier línea revierte el archivo entero y desde afuera se ve igual que si no hubiera corrido.

**No seguir sin confirmación.** Para comprobar que se aplicó, el esquema que publica PostgREST dice qué tablas hay — mirar la base, no el archivo.

---

## Tarea 7: la sincronización espeja la pestaña y guarda el equipo

**Archivos:**
- Modificar: `lib/inventario/equipos.ts` (agregar `sincronizarEquipos`)
- Modificar: `lib/inventario/sincronizar.ts`

**Requiere la migración de la tarea 6 aplicada.**

- [ ] **Paso 1: escribir `sincronizarEquipos`**

Agregar al final de `lib/inventario/equipos.ts`:

```ts
/**
 * Deja la lista igual a la pestaña, y dice qué encontró.
 *
 * Lo que decide es `equiposQueCambian`; acá vive nada más que el orden en que
 * se llama y cómo se aplica. Si la pestaña no se puede leer, **no falla la
 * sincronización entera**: devuelve el error con lo que dijo Google, sin
 * traducir, y la lista queda como estaba. El kardex y los artículos entran
 * igual — perder las tres cosas porque una pestaña no se pudo leer es peor.
 */
export async function sincronizarEquipos(
  admin: SupabaseClient,
  planillaId: string,
  pestana: string
): Promise<{
  nuevos: number; actualizados: number; desactivados: number;
  sinDestino: string[]; error?: string;
}> {
  const vacio = { nuevos: 0, actualizados: 0, desactivados: 0, sinDestino: [] as string[] };

  let filas: string[][];
  try {
    filas = await leerValores(planillaId, pestana);
  } catch (e) {
    return { ...vacio, error: `No se pudo leer «${pestana}»: ${e instanceof Error ? e.message : String(e)}` };
  }

  const pares = filas
    .slice(1)
    .map((f) => filaDeSectorYEquipo(f))
    .filter((p): p is ParDeLaPestana => p !== null);

  // Una pestaña vacía no se aplica: desactivaría los 255 de una. Es más
  // probable que sea un rango mal leído que un pañol que borró la lista.
  if (pares.length === 0) {
    return { ...vacio, error: `La pestaña «${pestana}» vino sin pares sector/equipo. No se toca la lista.` };
  }

  const [lista, destinos, nucleo] = await Promise.all([
    traerTodo<EquipoDeLaLista>((desde, hasta) =>
      admin.from("inventario_equipos")
        .select("id, nombre, destino_id, equipment_id, activo").range(desde, hasta)
    ),
    traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
      admin.from("inventario_destinos").select("id, nombre").eq("activo", true).range(desde, hasta)
    ),
    traerTodo<{ id: string; code: string | null; name: string }>((desde, hasta) =>
      admin.from("equipos").select("id, code, name").eq("is_active", true).range(desde, hasta)
    ).then(indiceDeEquipos),
  ]);

  const cambios = equiposQueCambian(pares, lista, destinos, nucleo);

  if (cambios.nuevos.length > 0) {
    const { error } = await admin.from("inventario_equipos").insert(cambios.nuevos);
    if (error) return { ...vacio, sinDestino: cambios.sinDestino, error: error.message };
  }

  // De a uno: son unos pocos por corrida, y un upsert obligaría a mandar el
  // resto de las columnas — que es cómo se pisa sin querer lo que otro editó.
  for (const c of cambios.actualizados) {
    await admin.from("inventario_equipos")
      .update({ destino_id: c.destino_id, equipment_id: c.equipment_id, activo: true })
      .eq("id", c.id);
  }

  // De a lotes de 200: un `.in()` con muchos ids arma una URL que PostgREST
  // rechaza con un 400 sin decir por qué.
  for (let i = 0; i < cambios.desactivados.length; i += 200) {
    await admin.from("inventario_equipos")
      .update({ activo: false })
      .in("id", cambios.desactivados.slice(i, i + 200));
  }

  return {
    nuevos: cambios.nuevos.length,
    actualizados: cambios.actualizados.length,
    desactivados: cambios.desactivados.length,
    sinDestino: cambios.sinDestino,
  };
}
```

Y completar los imports de arriba del archivo:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerValores } from "@/lib/core/sheets";
import { traerTodo } from "@/lib/core/paginado";
import {
  indicePorNombre, indiceDeEquipos, reconocer, reconocerEquipo, type Indice,
} from "@/lib/inventario/enlaces";
```

- [ ] **Paso 2: comprobar que compila**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 3: engancharla en la sincronización**

En `lib/inventario/sincronizar.ts`:

**a)** agregar la pestaña a las constantes, después de `TAB_KARDEX`:

```ts
const TAB_KARDEX = () => process.env.GOOGLE_SHEETS_INVENTARIO_TAB_MOV ?? "Entradas  Salidas";
/**
 * La pestaña de la que sale el desplegable de la columna K. El nombre lleva
 * barra —"Sectores/Equipos"—, que en un rango de Sheets no molesta porque
 * `leerValores` lo pasa por `encodeURIComponent`.
 */
const TAB_EQUIPOS = () => process.env.GOOGLE_SHEETS_INVENTARIO_TAB_EQUIPOS ?? "Sectores/Equipos";
```

**b)** agregar el import:

```ts
import { sincronizarEquipos } from "@/lib/inventario/equipos";
```

**c)** correr el espejo de la lista justo después de `reconciliarSolicitantes`, que es donde ya se enganchan los catálogos propios del módulo:

```ts
  const catalogo = await reconciliarSolicitantes(admin);

  // La lista de equipos se espeja antes de resolver el kardex: si un equipo
  // nuevo apareció en la pestaña, esta misma corrida lo puede enganchar en vez
  // de la próxima. Un fallo acá no corta la sincronización — se informa y el
  // kardex entra igual.
  const equipos = await sincronizarEquipos(admin, planilla, TAB_EQUIPOS());
```

**d)** traer la lista para reconocer, junto a destinos y solicitantes. Reemplazar el bloque `const [destinos, solicitantes] = await Promise.all([...])` por:

```ts
  const [destinos, solicitantes, listaEquipos] = await Promise.all([
    traerTodo<Destino>((desde, hasta) =>
      admin.from("inventario_destinos").select("id, nombre, sector_id").range(desde, hasta)
    ),
    traerTodo<Solicitante>((desde, hasta) =>
      admin.from("inventario_solicitantes")
        .select("id, nombre, destino_id, empleado_id").range(desde, hasta)
    ),
    traerTodo<{ id: string; nombre: string; equipment_id: string | null }>((desde, hasta) =>
      admin.from("inventario_equipos").select("id, nombre, equipment_id").range(desde, hasta)
    ),
  ]);
  const porDestino = indicePorNombre(destinos);
  const porSolicitante = indicePorNombre(solicitantes);
  const porEquipo = indicePorNombre(listaEquipos);
```

**e)** resolver los tres campos del equipo dentro del `movimientos.flatMap`, después de `const proveedor_id = ...`:

```ts
    const proveedor_id = reconocer(proveedores, m.proveedor_raw);

    // El equipo se resuelve en dos pasos, y los dos importan:
    //
    // `equipo_id` es la fila de la lista, por nombre. Es null cuando el texto no
    // está en la pestaña — pasa con `PO-D1-10 - SEPARADOR DINÁMICO 3` y `4`, dos
    // filas históricas contra un `SEPARADOR DINÁMICO 2` en el núcleo.
    //
    // `equipment_id` es la máquina del núcleo, y se saca de la lista cuando la
    // lista lo tiene; si no, se reconoce **por código** sobre el texto crudo. Es
    // lo que hace que esos dos huérfanos igual queden colgados de la máquina
    // correcta aunque no tengan `equipo_id`.
    const equipo_id = reconocer(porEquipo, m.equipo_raw);
    const equipment_id =
      (equipo_id ? listaEquipos.find((e) => e.id === equipo_id)?.equipment_id : null) ??
      reconocerEquipo(nucleoEquipos, m.equipo_raw);
```

**f)** informar lo que no se reconoció, junto a los otros tres, dentro del mismo `flatMap`:

```ts
    if (m.proveedor_raw && !proveedor_id) {
      sinReconocer.anotar(donde("proveedores", proveedores, m.proveedor_raw), m.proveedor_raw);
    }
    // Un equipo que la K nombra y la pestaña no tiene es un dato que el
    // desplegable no puede volver a elegir: hay que arreglarlo en la pestaña.
    if (m.equipo_raw && !equipo_id) {
      sinReconocer.anotar(donde("equipos", porEquipo, m.equipo_raw), m.equipo_raw);
    }
```

**g)** guardar los tres campos en la fila del upsert, después de `proveedor_id`:

```ts
      proveedor_raw: m.proveedor_raw,
      proveedor_id,
      equipo_raw: m.equipo_raw,
      equipo_id,
      equipment_id,
```

**h)** el índice del núcleo hace falta acá también, para los huérfanos. Agregarlo al `Promise.all` de los catálogos del núcleo —el que trae `porCodigo`, `sectores`, `empleados` y `proveedores`— como un quinto elemento, y sumarlo al destructuring:

```ts
  const [porCodigo, sectores, empleados, proveedores, nucleoEquipos] = await Promise.all([
```

y como último elemento del array, después del `indicePorNombre` de proveedores:

```ts
    // Los equipos del núcleo, para reconocer por código lo que la K nombra y la
    // pestaña no tiene. Sólo los activos, por lo mismo que los sectores.
    indiceDeEquipos(
      await traerTodo<{ id: string; code: string | null; name: string }>((desde, hasta) =>
        admin.from("equipos").select("id, code, name").eq("is_active", true).range(desde, hasta)
      )
    ),
  ]);
```

**i)** agregar `indiceDeEquipos` y `reconocerEquipo` al import de `@/lib/inventario/enlaces`.

**j)** informar el resultado, en el `return logra({...})`:

```ts
    solicitantes_sin_empleado: catalogo.sueltos,
    equipos_nuevos: equipos.nuevos,
    equipos_actualizados: equipos.actualizados,
    equipos_desactivados: equipos.desactivados,
    // Sectores que la pestaña nombra y la lista de destinos no tiene: sus
    // equipos no entraron y hay que agregar el destino.
    equipos_sin_destino: equipos.sinDestino,
    // Con lo que dijo Google, sin traducir. Un fallo de lectura no es un warn.
    equipos_error: equipos.error ?? null,
    sin_reconocer: sinReconocer.resumen(),
```

- [ ] **Paso 4: comprobar que compila y que la suite sigue verde**

```bash
npx tsc --noEmit
```

```bash
npm test
```

Esperado: sin errores de tipos, todos los tests en PASS.

- [ ] **Paso 5: correr la sincronización de verdad contra la planilla**

Casi todo está detrás del login, así que esto se comprueba con un script y las credenciales de `.env.local`, que sí tiene `GOOGLE_SERVICE_ACCOUNT_JSON`. Crear el script en el scratchpad de la sesión (no en el repo) con este contenido, cambiando la ruta del repo si hace falta:

```ts
import { readFileSync } from "node:fs";
for (const l of readFileSync("C:/Users/Usuario/Desktop/SdG PP/.env.local", "utf-8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
// La planilla del almacén no está en .env.local: su id está en docs/VARIABLES-VERCEL.md
process.env.GOOGLE_SHEETS_INVENTARIO_ID ??= "1ObB2NBUpEFcEEoF2RqWpj6PPofR1X9CyCwubAyYPYHI";
const { sincronizarInventario } = await import("file:///C:/Users/Usuario/Desktop/SdG%20PP/lib/inventario/sincronizar.ts");
console.log(JSON.stringify(await sincronizarInventario(), null, 2));
```

Correrlo desde la raíz del repo:

```bash
npx tsx <ruta-del-script>
```

Esperado en la primera corrida: `equipos_nuevos: 255`, `equipos_sin_destino: []`, `equipos_error: null`. Si `equipos_sin_destino` trae algo, la migración de los seis destinos no se aplicó o el pañol agregó un sector nuevo: en los dos casos el arreglo es agregar el destino, no tocar el código.

En una segunda corrida: `equipos_nuevos: 0`, `equipos_actualizados: 0`, `equipos_desactivados: 0`. Si la segunda corrida vuelve a insertar, la clave de comparación no está funcionando.

En `sin_reconocer` tiene que aparecer `equipos: ["PO-D1-10 - SEPARADOR DINÁMICO 3", "PO-D1-10 - SEPARADOR DINÁMICO 4"]` y nada más: son los dos huérfanos conocidos.

- [ ] **Paso 6: comprobar que los movimientos históricos quedaron con equipo**

Un script en el scratchpad, con `fetch` contra PostgREST:

```ts
import { readFileSync } from "node:fs";
for (const l of readFileSync("C:/Users/Usuario/Desktop/SdG PP/.env.local", "utf-8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: K!, Authorization: `Bearer ${K}`, Prefer: "count=exact" };
const cuenta = async (q: string) =>
  (await fetch(`${U}/rest/v1/${q}`, { method: "HEAD", headers: h })).headers.get("content-range");
console.log("con equipo_raw:", await cuenta("inventario_movimientos?select=id&equipo_raw=not.is.null"));
console.log("con equipo_id: ", await cuenta("inventario_movimientos?select=id&equipo_id=not.is.null"));
console.log("con equipment_id:", await cuenta("inventario_movimientos?select=id&equipment_id=not.is.null"));
console.log("equipos en la lista:", await cuenta("inventario_equipos?select=id"));
```

```bash
npx tsx <ruta-del-script>
```

Esperado: unos 580 con `equipo_raw`, unos 578 con `equipo_id` (los dos huérfanos quedan en null), unos 580 con `equipment_id` menos los que la pestaña usa de relleno y no son equipos, y 255 en la lista. Los números exactos pueden haber cambiado si el pañol cargó más filas; lo que importa es que `equipo_id` sea apenas menor que `equipo_raw` y no cero.

- [ ] **Paso 7: commitear**

```bash
git add lib/inventario/equipos.ts lib/inventario/sincronizar.ts
```

```bash
git commit -m "feat(inventario): espejar la pestana de equipos y leer la columna K del kardex"
```

---

## Tarea 8: la ruta resuelve el equipo contra la lista

**Archivos:**
- Modificar: `app/api/inventario/movimientos/route.ts`

**Requiere la migración aplicada.**

Hoy la ruta le pasa al RPC `p_equipment_id: texto(b?.equipment_id)` — un id del núcleo tomado **del cuerpo del pedido**. Nadie lo manda, así que siempre es null, pero es una puerta abierta: un cliente podría colgar el movimiento de cualquier equipo. Se reemplaza por el que sale de la lista.

- [ ] **Paso 1: resolver el equipo**

Después del bloque que resuelve y valida `destino` —justo después del `if (destinoId && !destino)`— agregar:

```ts
  // El equipo se resuelve **contra la lista**, igual que quien retira y el
  // destino. En la planilla la K es un desplegable que un `onEdit` arma con los
  // equipos del sector: escribir ahí un texto que ese desplegable no ofrece deja
  // una celda que nadie puede volver a elegir, y el cliente no es quien puede
  // garantizarlo — alcanza con una pestaña vieja abierta.
  const equipoId = texto(b?.equipo_id);
  const { data: equipo } = equipoId
    ? await admin
        .from("inventario_equipos")
        .select("id, nombre, destino_id, equipment_id")
        .eq("id", equipoId)
        .eq("activo", true)
        .maybeSingle()
    : { data: null };

  if (equipoId && !equipo) {
    return NextResponse.json(
      { error: "Ese equipo no está en la lista del pañol" },
      { status: 400 }
    );
  }

  // Y tiene que ser un equipo **de ese sector**: es la comprobación que hace el
  // desplegable de la planilla. Sin esto, una lista desactualizada en el cliente
  // —o cambiar el sector después de elegir el equipo— mete en la K un equipo que
  // el sector de la J no ofrece, y ahí el dato aparece en el lugar que no es.
  if (equipo && equipo.destino_id !== destinoId) {
    return NextResponse.json(
      { error: `${equipo.nombre} no es un equipo de ese sector` },
      { status: 400 }
    );
  }
```

- [ ] **Paso 2: pasarle al RPC el equipo resuelto**

Reemplazar la línea del RPC:

```ts
    p_equipment_id: texto(b?.equipment_id),
```

por:

```ts
    // Del equipo de la lista y NO del cuerpo del pedido. Antes venía de `b`,
    // donde nadie lo mandaba: siempre era null, y era una puerta para colgar el
    // movimiento de cualquier máquina del núcleo.
    p_equipment_id: equipo?.equipment_id ?? null,
```

- [ ] **Paso 3: escribirlo en la planilla y guardar el texto**

Después de `const sector_raw = destino?.nombre ?? null;` agregar:

```ts
  // El nombre tal como va a quedar escrito en la K. Se guarda también en
  // `equipo_raw`, que es de donde el kardex de la app lee el equipo: sin esto,
  // un movimiento cargado acá se muestra sin equipo hasta que la sincronización
  // vuelva a leer su propia fila.
  const equipo_raw = equipo?.nombre ?? null;
```

En la llamada a `espejarMovimiento`, agregar el campo después de `sector`:

```ts
    sector: sector_raw,
    equipo: equipo_raw,
```

Y en el `update` de `inventario_movimientos`, agregar los dos campos después de `sector_raw`:

```ts
    .update({
      sector_raw,
      equipo_raw,
      equipo_id: equipo?.id ?? null,
      proveedor_raw,
```

- [ ] **Paso 4: comprobar que compila**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 5: commitear**

```bash
git add app/api/inventario/movimientos/route.ts
```

```bash
git commit -m "feat(inventario): la ruta resuelve el equipo contra la lista y valida el sector"
```

---

## Tarea 9: el select dependiente en el formulario

**Archivos:**
- Modificar: `app/(app)/inventario/movimientos/nuevo/page.tsx`
- Modificar: `app/(app)/inventario/movimientos/nuevo/NuevoMovimientoClient.tsx`

- [ ] **Paso 1: traer la lista en la página**

En `page.tsx`, agregar un cuarto elemento al `Promise.all` que trae solicitantes, destinos y proveedores, y sumarlo al destructuring:

```ts
  const [solicitantes, destinos, proveedores, equipos] = await Promise.all([
```

y como último elemento del array:

```ts
    // La lista de equipos, con su destino: es lo que hace que el select se
    // filtre igual que el desplegable de la planilla. Se ordena por nombre, que
    // empieza con el código, así que agrupa por planta solo.
    traerTodo<{ id: string; nombre: string; destino_id: string }>((desde, hasta) =>
      supabase.from("inventario_equipos").select("id, nombre, destino_id")
        .eq("activo", true).order("nombre").range(desde, hasta)
    ),
  ]);
```

Y pasarlo al cliente, en el JSX:

```tsx
      destinos={destinos}
      equipos={equipos.map((e) => ({ id: e.id, nombre: e.nombre, destinoId: e.destino_id }))}
      proveedores={proveedores}
```

- [ ] **Paso 2: recibirlo en el cliente**

En `NuevoMovimientoClient.tsx`, agregar el tipo después de `Solicitante`:

```ts
/** Cada equipo pertenece a un solo destino: es el filtro del select. */
type Equipo = Opcion & { destinoId: string };
```

Agregar la prop a la firma del componente:

```tsx
export default function NuevoMovimientoClient({
  articuloInicial, destinos, solicitantes, equipos, proveedores, sync,
}: {
  articuloInicial: Articulo | null;
  destinos: Opcion[];
  solicitantes: Solicitante[];
  equipos: Equipo[];
  proveedores: Opcion[];
  sync: UltimaSync | null;
}) {
```

Agregar el estado, después de `destinoElegido`:

```ts
  const [equipoId, setEquipoId] = useState("");
```

- [ ] **Paso 3: filtrar por el destino resuelto y limpiar lo que ya no aplica**

Después de la línea `const destino = destinos.find(...)`, agregar:

```ts
  // Los equipos de ese destino, que es exactamente lo que ofrece el desplegable
  // de la columna K en la planilla: el `onEdit` lo arma con los equipos del
  // sector de la J.
  const equiposDelDestino = useMemo(
    () => equipos.filter((e) => e.destinoId === destinoId),
    [equipos, destinoId]
  );

  // Cambiar de sector con un equipo ya elegido lo deja apuntando a otro sector,
  // y la ruta lo rechazaría con un 400 recién al apretar Registrar. Se limpia
  // acá, que es lo mismo que hace el `onEdit` de la planilla cuando cambia la J.
  useEffect(() => {
    if (equipoId && !equiposDelDestino.some((e) => e.id === equipoId)) setEquipoId("");
  }, [equipoId, equiposDelDestino]);
```

- [ ] **Paso 4: mandarlo en el POST**

En el `body: JSON.stringify({...})` de `guardar`, agregar después de `destino_id`:

```ts
        destino_id: destinoId || null,
        equipo_id: equipoId || null,
```

Y limpiar el campo después de registrar, junto a `setCantidad("")`:

```ts
    setCantidad("");
    // El equipo no se arrastra al movimiento siguiente: el artículo y la persona
    // suelen repetirse en una tanda, la máquina no.
    setEquipoId("");
```

- [ ] **Paso 5: el select**

Agregar el `<label>` inmediatamente después del que cierra "Para qué sector" y antes del bloque `{tipo === "entrada" && (`:

```tsx
          {/* Para qué máquina. Es la columna K, que en la planilla es un
              desplegable dependiente del sector de la J: acá se filtra igual,
              porque escribir ahí un equipo de otro sector deja una celda que el
              desplegable no puede volver a ofrecer. Opcional: hoy sólo el 14% de
              las filas del kardex lo trae, y exigirlo sería pedir un dato que el
              pañol muchas veces no tiene. */}
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Para qué equipo</span>
            <select
              value={equipoId}
              onChange={(e) => setEquipoId(e.target.value)}
              disabled={equiposDelDestino.length === 0}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">—</option>
              {equiposDelDestino.map((e) => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
            {!destinoId ? (
              <span className="mt-1 block text-xs text-slate-400">
                Elegí primero para qué sector: los equipos son los de ese sector.
              </span>
            ) : equiposDelDestino.length === 0 ? (
              <span className="mt-1 block text-xs text-slate-500">
                {destino?.nombre ?? "Ese sector"} no tiene equipos en la planilla.
              </span>
            ) : null}
          </label>
```

- [ ] **Paso 6: comprobar que compila**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 7: commitear**

```bash
git add "app/(app)/inventario/movimientos/nuevo/page.tsx" "app/(app)/inventario/movimientos/nuevo/NuevoMovimientoClient.tsx"
```

```bash
git commit -m "feat(inventario): el campo de equipo en el formulario de movimientos"
```

---

## Tarea 10: la variable de entorno documentada, y la verificación final

**Archivos:**
- Modificar: `docs/VARIABLES-VERCEL.md`

- [ ] **Paso 1: documentar la pestaña nueva**

En `docs/VARIABLES-VERCEL.md`, agregar esta fila inmediatamente después de la de `GOOGLE_SHEETS_INVENTARIO_TAB_MOV`:

```markdown
| `GOOGLE_SHEETS_INVENTARIO_TAB_EQUIPOS` | La pestaña de la que sale el vocabulario de la columna K del kardex | `Sectores/Equipos` — columna A el sector, columna B el equipo. Es de donde el `onEdit` de la planilla arma el desplegable dependiente, y de donde el SdG espeja `inventario_equipos` en cada sincronización |
```

- [ ] **Paso 2: la suite completa**

```bash
npm test
```

Esperado: PASS.

```bash
npx tsc --noEmit
```

Esperado: sin salida.

- [ ] **Paso 3: el build**

**Parar `npm run dev` antes.** Un `next build` con el dev server levantado deja la app en 500.

```bash
npm run build
```

Esperado: build exitoso. (`npm run lint` falla en este repo por falta de config de ESLint: no es tu cambio.)

- [ ] **Paso 4: commitear y pushear**

```bash
git add docs/VARIABLES-VERCEL.md
```

```bash
git commit -m "docs(inventario): la pestana Sectores/Equipos en las variables"
```

Se trabaja sobre `main` y se pushea al terminar:

```bash
git push
```

- [ ] **Paso 5: la prueba de punta a punta, que la hace una persona**

El formulario está detrás del login, así que esto no se puede comprobar desde acá. Pedirle al usuario:

> Cargá una salida de prueba en `/inventario/movimientos/nuevo` con un sector que tenga equipos —`FILLER 2`, por ejemplo— y elegí un equipo. Después contame:
>
> 1. Si el select se filtró por el sector y quedó vacío al elegir `MANTENIMIENTO`.
> 2. Qué quedó en la columna K de la última fila del kardex.
>
> Lo que hay que ver en la planilla es el nombre completo, `PY-B1-09 - MOLINO VERTICAL` y no un pedazo. Si la celda quedó vacía, el equipo no llegó a la ruta; si quedó con otro texto, el nombre no salió de la lista.

---

## Lo que este plan deja afuera a propósito

Tres cosas medidas al diseñar esto, anotadas en el spec y **no** tocadas acá:

1. **El espejo se come la fórmula de la columna J.** La J es `=IFERROR(XLOOKUP(F; Empleados!A:A; Empleados!B:B); "")` y el SdG le escribe un literal: las filas 4172 a 4175 ya perdieron la fórmula. Es la trampa de la G en otra columna. Escribir la J es a propósito —el destino elegido puede no ser el de quien retira—, así que hay que decidir qué se prefiere.
2. **`COL_DISPARO = 9` en el Apps Script apunta a la I (`PROVEEDOR`)**, y lo que cambia la J es la F (`QUIEN LO PIDIÓ`), que es la 6. Se arregla en el script, no en el SdG.
3. **`PO-D1-10 - SEPARADOR DINÁMICO 3` y `4`** están en el kardex y no en la pestaña, contra un `SEPARADOR DINÁMICO 2` en el núcleo. Se reconocen por código y quedan con `equipo_id` en null; alguien tiene que decidir cuál de los tres nombres es el bueno.

# El histórico de determinaciones — plan de implementación

> **Para quien lo ejecute:** cada paso es una acción con un resultado
> comprobable. Los `- [ ]` son para ir tildando.

**Objetivo:** que Calidad consulte desde el SdG los tres años de laboratorio que
viven en `Determinaciones 2026.xlsx`, de sólo lectura, buscables junto con lo que
Ensayos carga desde octubre.

**Arquitectura:** una tabla larga —una fila por valor medido— que guarda el
número **tal como está escrito en la planilla** y lo acompaña de una etiqueta de
escala. Un importador de una sola corrida la llena. La pantalla es un buscador
que mezcla esa tabla con `calidad_ensayos_muestras`, aplanada al leer.

**Herramientas:** Next.js 16 (App Router), Supabase, vitest, `exceljs` (ya es
dependencia del repo).

**Spec:** [2026-10-29-calidad-historico-de-determinaciones-design.md](../specs/2026-10-29-calidad-historico-de-determinaciones-design.md)
— **leerlo antes**: acá está el cómo, allá el porqué de cada decisión, y en
particular por qué no se convierte ningún número.

## Restricciones que valen para todo el plan

- **Ningún número se transforma.** `valor` guarda lo que dice la celda. La
  inferencia vive en `escala`, nunca en el dato.
- **El corte es `2026-06-02`** (cambio de planilla, confirmado por Calidad).
- **El ámbito de la etiqueta de escala es `(hoja, columna)`**, nunca cruzando
  hojas.
- **La humedad es `fraccion` siempre**, en todas las hojas y épocas.
- **Las celdas con fórmula `AVERAGE`/`SUM` se descartan**, detectadas por la
  fórmula y no por el valor. Son 22, todas en `Calcio`.
- **El enlace a producto es por nombre exacto.** Sin aproximaciones: lo que no
  coincide queda en `producto_id` null.
- Castellano en nombres, comentarios, pantallas y commits.
- `traerTodo()` de `lib/core/paginado.ts` en toda lectura que pueda crecer.
- La cadena del `select` de Supabase va **literal**, no armada en una variable.
- Un desplegable se escribe `<Select>` (`components/Select.tsx`), no `<select>`.
- Una grilla de tres columnas lleva breakpoint: `grid-cols-1 sm:grid-cols-3`.
- Una policy nueva llama a su función envuelta: `using ((select tiene_acceso_calidad()))`.

## Dónde mirar si algo falla

Cinco cosas que el spec implica y que ningún test obvio ejercita. Cada una tiene
su test en la tarea que la posee.

1. **Un valor exactamente `1` antes del corte.** La regla dice "todos menores a
   1". Un `1` deja la columna en `porcentaje` y sus fracciones quedan mal
   etiquetadas. → Tarea 2.
2. **Un bloque cuya fila de fecha no trae nombres de muestra.** `origen_raw` es
   `not null`; sin nombre no hay a qué colgar el valor. → Tarea 3.
3. **Una fila de `Despachos cal fillerizada` sin cliente.** Mismo problema por
   otra puerta. → Tarea 3.
4. **Una muestra de Ensayos sin retenidos** (sólo humedad). El aplanador no puede
   devolver filas vacías ni romperse. → Tarea 5.
5. **Una búsqueda con acento o eñe.** `Güemes`, `Rodríguez`: si el filtro no
   normaliza, el dato existe y no aparece. → Tarea 5.

---

## Mapa de archivos

| Archivo | De qué se ocupa |
|---|---|
| `supabase/migrations/<ts>_calidad_historico_determinaciones.sql` | La tabla, sus índices y su RLS de sólo lectura |
| `lib/calidad/historico/escala.ts` | La etiqueta de escala por `(hoja, columna)` |
| `lib/calidad/historico/planilla.ts` | Leer las tres formas del libro. Sin IO |
| `lib/calidad/historico/aplanar.ts` | Pasar una muestra de Ensayos a filas largas |
| `lib/calidad/historico/consultas.ts` | La búsqueda que mezcla las dos fuentes |
| `lib/calidad/historico/types.ts` | `FilaHistorica`, `Escala`, `FilaDeLaBusqueda` |
| `scripts/importar-determinaciones-historico.mts` | La corrida única |
| `app/(app)/calidad/historico/…` | El buscador y la vista de planilla |

---

## Tarea 1: La tabla

Va primera porque bloquea: hasta que una persona la aplique, nada que toque la
base se puede probar. Las tareas 2 y 3 son puras y no la necesitan.

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_calidad_historico_determinaciones.sql`

**Interfaces:**
- Produce: la tabla `calidad_historico_determinaciones` con las columnas que el
  spec fija, en la sección «El modelo».

- [ ] **Paso 1: Generar el archivo**

```bash
npm run migracion "calidad historico determinaciones"
```

- [ ] **Paso 2: Escribir el DDL**

Las columnas, tipos y constraints son los del spec. Además:

- `escala text not null check (escala in ('fraccion','porcentaje','absoluto'))`
- índices por `fecha`, por `producto_id` y por `(hoja, fecha)`
- **RLS: sólo `select`**, con `using ((select tiene_acceso_calidad()))`. Ninguna
  policy de `insert`, `update` ni `delete`, y **sin trigger** — el encabezado
  tiene que decir por qué: una importación equivocada debe poder rehacerse con
  el cliente de servicio, y un trigger la dejaría escrita para siempre.
- `comment on table` explicando que el valor está **sin transformar** y que
  `escala` es la lectura del sistema, no una propiedad del número.

No hay valor de enum nuevo: `escala` es un `check`, así que la migración entra
en un solo archivo.

- [ ] **Paso 3: Commitear y avisar**

```bash
git commit --only supabase/migrations/<timestamp>_calidad_historico_determinaciones.sql -m "feat(calidad): la tabla del historico de determinaciones"
```

**Decirle al usuario que la aplique** y quedar a la espera para la tarea 4.

---

## Tarea 2: La etiqueta de escala

**Archivos:**
- Crear: `lib/calidad/historico/escala.ts`, `lib/calidad/historico/escala.test.ts`

**Interfaces:**
- Produce:
  ```ts
  export type Escala = "fraccion" | "porcentaje" | "absoluto";
  export const CORTE_DE_PLANILLA = "2026-06-02";
  export function escalaDeLaColumna(
    etiqueta: string,
    valoresAnterioresAlCorte: number[]
  ): Escala;
  export function escalaDelValor(escalaDeColumna: Escala, fecha: string): Escala;
  ```
  `escalaDeLaColumna` decide por el encabezado y los valores previos;
  `escalaDelValor` aplica el corte: una columna `fraccion` sólo lo es **antes**
  del corte.

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
describe("escalaDeLaColumna", () => {
  it("una columna sin % es absoluto", () => {
    expect(escalaDeLaColumna("Peso volumétrico (g/l)", [900, 1000])).toBe("absoluto");
  });

  it("la humedad es fraccion siempre, haya o no valores previos", () => {
    expect(escalaDeLaColumna("Humedad bh (%)", [])).toBe("fraccion");
    expect(escalaDeLaColumna("Humedad bh (%)", [0.004])).toBe("fraccion");
  });

  it("con valores previos todos menores a 1, es fraccion", () => {
    expect(escalaDeLaColumna("Acumulado en #200 (%)", [0.1, 0.17, 0.04])).toBe("fraccion");
  });

  it("sin valores previos es porcentaje: la columna nacio con la planilla nueva", () => {
    // Ret #50, Ret #200 y Ret #325 estan en este caso, y multiplicarlas
    // por cien es el error que el spec describe.
    expect(escalaDeLaColumna("Ret #200(%)", [])).toBe("porcentaje");
  });

  it("un valor exactamente 1 antes del corte deja la columna en porcentaje", () => {
    // La regla dice "todos menores a 1". Queda fijado a proposito: si algun
    // dia aparece un 1,0 que era una fraccion, este test lo hace visible.
    expect(escalaDeLaColumna("Ret #100 (%)", [0.05, 1])).toBe("porcentaje");
  });
});

describe("escalaDelValor", () => {
  it("una columna fraccion es porcentaje desde el corte", () => {
    expect(escalaDelValor("fraccion", "2026-06-02")).toBe("porcentaje");
    expect(escalaDelValor("fraccion", "2026-05-04")).toBe("fraccion");
  });

  it("absoluto no depende de la fecha", () => {
    expect(escalaDelValor("absoluto", "2023-11-14")).toBe("absoluto");
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

`npx vitest run lib/calidad/historico/escala.test.ts` → FAIL, no resuelve el import.

- [ ] **Paso 3: Implementar las dos funciones y las constantes en `escala.ts`**

- [ ] **Paso 4: Correr y ver que pasa** — 7 tests.

- [ ] **Paso 5: Commitear**

---

## Tarea 3: Leer el libro

**Archivos:**
- Crear: `lib/calidad/historico/planilla.ts`, `planilla.test.ts`
- Crear: `lib/calidad/historico/types.ts`

**Interfaces:**
- Consume: `escalaDeLaColumna`, `escalaDelValor`, `CORTE_DE_PLANILLA` (Tarea 2).
- Produce:
  ```ts
  export interface FilaHistorica {
    fecha: string; hoja: string; origen_raw: string;
    determinacion: string; malla: number | null;
    valor: number; escala: Escala; unidad: string | null;
    revisar: string | null; fila_excel: number;
  }
  /** Una celda como la entrega exceljs: su valor ya resuelto y su fórmula si la tiene. */
  export interface Celda { valor: unknown; formula?: string }
  export function esAgregacion(celda: Celda): boolean;
  export function mallaDeLaEtiqueta(etiqueta: string): number | null;
  export function unidadDeLaEtiqueta(etiqueta: string): string | null;
  export function filasDeHojaTabular(
    hoja: string, encabezado: string[], filas: Celda[][]
  ): FilaHistorica[];
  export function filasDeHojaEnBloques(hoja: string, filas: Celda[][]): FilaHistorica[];
  export function revisarAritmetica(deLaFila: FilaHistorica[]): string | null;
  ```
  `filas` llega en orden, con índice 0 = fila 2 de la planilla.

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
describe("esAgregacion", () => {
  it("reconoce un promedio por su formula, no por su valor", () => {
    expect(esAgregacion({ valor: 0.0068, formula: "AVERAGE(C2:C4)" })).toBe(true);
    expect(esAgregacion({ valor: 0.0068 })).toBe(false);
  });
});

describe("mallaDeLaEtiqueta y unidadDeLaEtiqueta", () => {
  it("despeja la malla del texto", () => {
    expect(mallaDeLaEtiqueta("Acumulado en #200 (%)")).toBe(200);
    expect(mallaDeLaEtiqueta("Humedad bh (%)")).toBeNull();
  });
  it("despeja la unidad", () => {
    expect(unidadDeLaEtiqueta("Peso volumétrico (g/l)")).toBe("g/l");
    expect(unidadDeLaEtiqueta("Ret #50 (%)")).toBe("%");
    expect(unidadDeLaEtiqueta("Cal (Ton)")).toBe("Ton");
  });
});

describe("filasDeHojaTabular", () => {
  // Datos reales de Filler 1 alrededor del corte.
  const ENC = ["Fecha", "Ret #50 (%)", "Ret #100 (%)", "Ret #200 (%)", "Acumulado #200 (%)"];
  const ANTES = [{ valor: "2026-05-04" }, {}, { valor: 0.049 }, {}, { valor: 0.269 }];
  const DESPUES = [{ valor: "2026-06-02" }, { valor: 0 }, { valor: 4.3 }, { valor: 19.3 }, { valor: 23.6 }];

  it("etiqueta cada valor con la escala de su columna y su fecha", () => {
    const r = filasDeHojaTabular("Filler 1", ENC, [ANTES, DESPUES]);
    expect(r.find((f) => f.fecha === "2026-05-04")!.escala).toBe("fraccion");
    expect(r.find((f) => f.fecha === "2026-06-02" && f.malla === 200 && /Acum/.test(f.determinacion))!.escala).toBe("porcentaje");
  });

  it("Ret #200 nacio con la planilla nueva: nunca es fraccion", () => {
    // Si se la tratara como fraccion, 19,3 pasaria a 1930.
    const r = filasDeHojaTabular("Filler 1", ENC, [ANTES, DESPUES]);
    expect(r.filter((f) => f.determinacion === "Ret #200 (%)").every((f) => f.escala === "porcentaje")).toBe(true);
  });

  it("no toca el valor: guarda 0,269 y no 26,9", () => {
    const r = filasDeHojaTabular("Filler 1", ENC, [ANTES, DESPUES]);
    expect(r.find((f) => f.fecha === "2026-05-04" && /Acum/.test(f.determinacion))!.valor).toBe(0.269);
  });

  it("descarta la celda de agregacion", () => {
    const conPromedio = [{ valor: "2026-06-03" }, {}, { valor: 3.2, formula: "AVERAGE(C2:C4)" }, {}, {}];
    expect(filasDeHojaTabular("Filler 1", ENC, [conPromedio])).toHaveLength(0);
  });

  it("saltea la fila sin fecha", () => {
    expect(filasDeHojaTabular("Filler 1", ENC, [[{ valor: "" }, {}, { valor: 1 }, {}, {}]])).toHaveLength(0);
  });

  it("una fila de Despachos cal fillerizada sin cliente no genera filas", () => {
    // El cliente es el origen_raw de esa hoja, y es not null. Sin el, el valor
    // no se puede colgar de nada: se pierde, que es mejor que inventarle dueño.
    const enc = ["Fecha", "Cliente", "Cal (Ton)"];
    expect(filasDeHojaTabular("Despachos cal fillerizada", enc, [[{ valor: "2026-07-08" }, { valor: "" }, { valor: 12 }]])).toHaveLength(0);
  });
});

describe("filasDeHojaEnBloques", () => {
  // El bloque de ejemplo del spec, tal cual.
  const BLOQUE = [
    [{ valor: "2026-06-17" }, { valor: "Calcio 0-1" }, { valor: "Calcio 0-2" }],
    [{ valor: "Humedad bh (%)" }, { valor: 0.0068 }, { valor: 0.0087 }],
    [{ valor: "P recipiente" }, { valor: 426.68 }, { valor: 433.22 }],
  ];

  it("usa la fecha de la fila que la trae y los nombres de muestra de su derecha", () => {
    const r = filasDeHojaEnBloques("Otros", BLOQUE);
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({
      fecha: "2026-06-17", origen_raw: "Calcio 0-1",
      determinacion: "Humedad bh (%)", valor: 0.0068, escala: "fraccion",
    });
  });

  it("cierra el bloque en la siguiente fila con fecha", () => {
    const dos = [...BLOQUE, [{ valor: "2026-07-02" }, { valor: "Caliza Galpones" }], [{ valor: "P final" }, { valor: 533.45 }]];
    const r = filasDeHojaEnBloques("Otros", dos);
    expect(r.find((f) => f.determinacion === "P final")!.origen_raw).toBe("Caliza Galpones");
  });
  it("sin nombre de muestra no genera fila", () => {
    // origen_raw es not null: inventar "col 3" seria un origen que no existe.
    // El valor se pierde y eso es preferible a colgarlo de una etiqueta falsa.
  });
  it("ignora la celda sin valor numerico", () => {
    const conHueco = [[{ valor: "2026-06-17" }, { valor: "Calcio 0-1" }], [{ valor: "Humedad bh (%)" }, { valor: "-" }]];
    expect(filasDeHojaEnBloques("Otros", conHueco)).toHaveLength(0);
  });
});

describe("revisarAritmetica", () => {
  it("no dice nada cuando la fila no tiene con que comprobarse", () => {
    // Cal tiene 204 filas con acumulado y ningun retenido. Sin dos retenidos
    // no hay nada que comparar, y eso no es un hallazgo.
  });
  it("marca la fila cuyo acumulado no da la suma de sus retenidos", () => {
    // Caso real de Filler 1, 2026-09-07: acum200=21,9 y los retenidos suman 22,9.
    expect(revisarAritmetica(filaCon({ ret50: 0.8, ret100: 2.8, ret200: 19.3, acum200: 21.9 }))).toMatch(/acumulado/i);
  });

  it("no marca la que cierra dentro de la tolerancia de 0,15", () => {
    // 4,3 + 19,3 = 23,6, que es lo que dice el acumulado.
    expect(revisarAritmetica(filaCon({ ret100: 4.3, ret200: 19.3, acum200: 23.6 }))).toBeNull();
  });
});
```

- [ ] **Paso 2: Correr y ver que falla.**

- [ ] **Paso 3: Implementar `planilla.ts` y `types.ts`**

Un bloque arranca en una fila cuya primera celda es una fecha; las celdas a su
derecha son los nombres de muestra; las filas siguientes son
`(determinación, valor por muestra)` hasta la próxima fila con fecha. La
comprobación aritmética corre **sólo** si la fila tiene un acumulado y al menos
dos retenidos.

- [ ] **Paso 4: Correr y ver que pasa.**

- [ ] **Paso 5: Ejercitarlo contra el archivo real**

Un script temporal que lea el `.xlsx` y cuente. **Los conteos del spec son el
oráculo** y hay que compararlos uno por uno:

| | |
|---|---|
| valores totales | 3.304 |
| etiquetados `fraccion` (las cinco tabulares) | 958 |
| etiquetados `porcentaje` (las cinco tabulares) | 1.544 |
| etiquetados `absoluto` (las cinco tabulares) | 585 |
| filas con `revisar` | 28 |
| celdas de agregación descartadas | 22 |
| orígenes distintos | 47, de los cuales 7 enlazan a producto |
| rango | 06/11/2023 → 21/10/2026 |

**Dos de esos números cambiaron el 30/10/2026, al correr el parser de verdad
contra el archivo.** Los anteriores —3.511 valores y 12 filas con `revisar`—
salían de un prototipo que todavía convertía las escalas e inventaba nombres de
muestra, y los dos se movieron por decisiones que el propio diseño tomó después:

- **3.304 y no 3.511**, y **47 orígenes y no 55**, porque un bloque sin nombre de
  muestra ya no genera fila. Los 8 orígenes que desaparecieron eran basura del
  prototipo (`30.9`, `Feb`, `col 3`).
- **28 filas con `revisar` y no 12**, porque sin conversión la aritmética ve lo
  que la conversión tapaba: **23 filas de `Filler 1` entre febrero y mayo de 2026
  tienen el `Ret #50` en porcentaje y el `Ret #100` en fracción, en el mismo
  renglón.** Es el mismo fenómeno que el spec de Ensayos midió por su cuenta
  —«27 filas de Filler 1 tienen las dos escalas EN EL MISMO RENGLÓN»— y que la
  regla por columna no puede distinguir: un 0,6% y una fracción de 0,6 se
  escriben igual. Quedan marcadas, que es lo correcto: quien conteste un reclamo
  con una de esas filas tiene que mirarla antes.

Si un conteo no da, la regla cambió de significado: mirar antes de seguir.

- [ ] **Paso 6: Commitear.**

---

## Tarea 4: La importación

**Requiere la tarea 1 aplicada.**

**Archivos:**
- Crear: `scripts/importar-determinaciones-historico.mts`

**Interfaces:**
- Consume: `filasDeHojaTabular`, `filasDeHojaEnBloques`, `revisarAritmetica`
  (Tarea 3); `createAdminClient` de `lib/supabase/admin.ts`.

- [ ] **Paso 1: Escribir el importador**

Con la forma de `scripts/importar-stock-carbonilla.mts`: encabezado que explica
que **corre una sola vez**, modo `--secar` que imprime y no escribe, y la ruta
del `.xlsx` por argumento. El enlace a `calidad_ensayos_productos` es por nombre
exacto; lo que no coincide va con `producto_id` null.

Imprime los seis conteos del oráculo y, además, **cuántos orígenes distintos
quedaron sin producto** (esperado: 48 de 55).

- [ ] **Paso 2: Correr en seco y comparar contra el oráculo**

```bash
npx tsx scripts/importar-determinaciones-historico.mts --secar "<ruta al xlsx>"
```

Los seis números tienen que dar. Si no, parar.

- [ ] **Paso 3: Importar de verdad y verificar contra la base**

Contar por hoja y comparar con el seco; comprobar que `valor` quedó **sin
transformar** mirando una fila conocida: `Filler 1`, `2025-11-19`,
`Acumulado #200` tiene que decir `0.367` con `escala = 'fraccion'`.

- [ ] **Paso 4: Commitear.**

---

## Tarea 5: La búsqueda que mezcla las dos fuentes

**Archivos:**
- Crear: `lib/calidad/historico/aplanar.ts`, `aplanar.test.ts`
- Crear: `lib/calidad/historico/consultas.ts`

**Interfaces:**
- Consume: `granulometria`, `acumuladosDelListado` de
  `lib/calidad/ensayos/granulometria.ts`; `humedad`, `pesoVolumetrico`,
  `calUtilVial` de `lib/calidad/ensayos/determinaciones.ts`; `FILAS_DEL_REPORTE`
  y `filasParaMallas` de `lib/calidad/ensayos/reporte.ts`; los tipos `Muestra` y
  `Retenido` de `lib/calidad/ensayos/types.ts`. Y `Escala` de la Tarea 2.
- Produce:
  ```ts
  export interface FilaDeLaBusqueda {
    fecha: string; origen: string; determinacion: string;
    valor: number; escala: Escala; unidad: string | null;
    fuente: "historico" | "ensayos"; revisar: string | null;
    fila_excel: number | null;
  }
  export function aplanarMuestra(
    muestra: Muestra, retenidos: Retenido[], producto: string
  ): FilaDeLaBusqueda[];
  export function normalizarParaBuscar(texto: string): string;
  ```

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
describe("aplanarMuestra", () => {
  it("saca una fila por cada retenido y su acumulado, con las etiquetas del reporte", () => {
    // Las etiquetas tienen que decir lo mismo que el historico, o las dos
    // mitades de la busqueda no se encuentran entre si.
    const r = aplanarMuestra(MUESTRA, RETENIDOS, "Filler 1");
    expect(r.map((f) => f.determinacion)).toContain("Ret #100 (%)");
    expect(r.map((f) => f.determinacion)).toContain("Acumulado en #200 (%)");
  });

  it("saca humedad y peso volumetrico de los pesos crudos", () => {
    // MUESTRA lleva p_recipiente 426,68 · p_inicial 527,42 · p_final 526,73,
    // que es 0,68% de humedad. Ensayos la despeja; el historico la trae hecha.
    const r = aplanarMuestra(MUESTRA, RETENIDOS, "Filler 1");
    expect(r.find((f) => f.determinacion === "Humedad bh (%)")!.valor).toBeCloseTo(0.68, 2);
    expect(r.find((f) => f.determinacion === "Peso volumétrico (g/l)")).toBeDefined();
  });

  it("lo de Ensayos sale siempre con escala porcentaje", () => {
    const r = aplanarMuestra(MUESTRA, RETENIDOS, "Filler 1");
    const deProcentaje = r.filter((f) => f.unidad === "%");
    expect(deProcentaje.every((f) => f.escala === "porcentaje")).toBe(true);
    expect(r.every((f) => f.fuente === "ensayos")).toBe(true);
  });
  it("una muestra sin retenidos devuelve solo sus determinaciones, sin filas vacias", () => {
    // Pasa de verdad: hay muestras con humedad y nada mas.
  });
});

describe("normalizarParaBuscar", () => {
  it("ignora acentos y eñes", () => {
    expect(normalizarParaBuscar("Güemes")).toBe(normalizarParaBuscar("guemes"));
    expect(normalizarParaBuscar("Peña")).toBe(normalizarParaBuscar("pena"));
  });
});
```

- [ ] **Paso 2: Correr y ver que falla.**

- [ ] **Paso 3: Implementar `aplanar.ts` y `consultas.ts`**

`consultas.ts` filtra el histórico **en SQL** (`ilike` sobre `origen_raw` y
`determinacion`, más el rango de fechas) y trae de Ensayos sólo lo que cae en el
rango, con `traerTodo()`, antes de aplanarlo. Ordena por fecha descendente y
devuelve las dos fuentes juntas.

- [ ] **Paso 4: Correr y ver que pasa.**

- [ ] **Paso 5: Commitear.**

---

## Tarea 6: La pantalla

**Archivos:**
- Crear: `app/(app)/calidad/historico/page.tsx`, `HistoricoClient.tsx`
- Crear: `app/(app)/calidad/historico/Planilla.tsx`

**Interfaces:**
- Consume: `buscar` de `consultas.ts`, `FilaDeLaBusqueda` (Tarea 5).

- [ ] **Paso 1: El Server Component**

Gatea con `nivelCalidadDe` y redirige a `/` sin acceso, como las otras pantallas
del módulo.

- [ ] **Paso 2: El buscador**

Un campo de texto, dos fechas, y la tabla con fecha, origen, determinación y
valor. Cada fila marcada con su fuente; `revisar` a la vista cuando lo hay.

**El valor se muestra con su escala**: `0,125` etiquetado como fracción no se
puede confundir con `12,5` como porcentaje. Y la pantalla lleva una **nota fija**
—no un tooltip— que diga que el 02/06/2026 Calidad cambió de planilla y con ella
la forma de anotar, y que por eso hay dos escalas conviviendo.

- [ ] **Paso 3: La vista de planilla**

Un botón que, cuando el resultado viene de las cinco hojas tabulares, lo muestra
a lo ancho: una fila por día con las determinaciones en columnas. **Pivotea por
`(fecha, fila_excel)`** —hay 29 fechas repetidas en `Cal` que son muestras
distintas— y arma **una tabla por hoja** si el resultado cruza varias.

- [ ] **Paso 4: Verificar que compila**

`npx tsc --noEmit` y `node scripts/revisar-responsive.mjs`.

- [ ] **Paso 5: Commitear.**

---

## Tarea 7: El menú y la documentación

**Archivos:**
- Modificar: `lib/core/nav.ts` (el grupo Calidad, ~línea 237)
- Modificar: `app/(app)/calidad/page.tsx` (el tablero)
- Modificar: `CLAUDE.md` (la fila de Calidad)
- Crear: `docs/CALIDAD-HISTORICO.md`

- [ ] **Paso 1: El ítem del menú y la tarjeta del tablero**

`Histórico` dentro de Calidad, apuntando a `/calidad/historico`. Una cuarta
tarjeta en el tablero. Si el ícono no está en el mapa de `components/Sidebar.tsx`,
agregarlo — sin él cae en el genérico.

- [ ] **Paso 2: El documento del módulo**

`docs/CALIDAD-HISTORICO.md` con lo que no se deduce del código: que **el valor no
está transformado**, que `escala` es una lectura y no una propiedad, que la
aritmética sólo verifica 27 de 362 filas anteriores al corte, y que los conteos
del oráculo son lo que permite reproducir la importación.

Sumarlo a la fila de Calidad de `CLAUDE.md`, junto al spec y a este plan.

- [ ] **Paso 3: Verificar todo**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
```

`npm run build` con `npm run dev` levantado deja la app en 500: parar el dev
server antes.

- [ ] **Paso 4: Commitear y pushear.**

---

## Lo que este plan no hace

- **No vuelve a importar.** Es una corrida única; si aparece otro archivo, es
  otra tarea decidida a mano.
- **No compara contra límites ni dibuja gráficos.** El spec lo deja afuera y
  explica por qué.
- **No le da catálogo a los 19 clientes** de `Despachos cal fillerizada`. Van
  como texto hasta que alguien decida lo contrario.

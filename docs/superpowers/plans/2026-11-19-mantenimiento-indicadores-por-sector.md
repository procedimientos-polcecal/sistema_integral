# Los indicadores por sector del tablero de Mantenimiento — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** llenar las tres secciones vacías del tablero de Mantenimiento con
indicadores **por sector**: MTBF, MTTR, MTTF y confiabilidad; el análisis
mensual de órdenes y de confiabilidad; las paradas de sector; y las atrasadas
de esta semana por equipo y por sector.

**Architecture:** cuatro funciones puras en `lib/mantenimiento/` con sus tests,
una capa de datos y una ruta que el tablero pide **desde el cliente después del
primer pintado** —como ya hace `PeoresPorMtbf`—, salvo las atrasadas de la
semana, que se calculan en el servidor porque tienen que contarse contra la
misma foto que el panel que ya existe.

**Tech Stack:** Next.js 16, TypeScript, Supabase (PostgREST), recharts, vitest.

**Spec:** [docs/superpowers/specs/2026-11-19-mantenimiento-indicadores-por-sector-design.md](../specs/2026-11-19-mantenimiento-indicadores-por-sector-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, textos de pantalla y mensajes
  de commit. Conventional commits (`feat(mantenimiento): …`), con el cuerpo
  explicando **por qué**.
- **Nunca `git add -A`.** Hay otras sesiones en el mismo árbol: se commitean
  los archivos propios por nombre.
- `VENTANA_DIAS = 365`, `MINIMO_OBSERVADO = 14`, `DIAS_RECIENTE = 90` y
  `confiabilidad()` salen de `lib/mantenimiento/mtbf.ts`;
  `MINIMO_REPARACIONES = 3` y `esDeUnTercero()` de `mttr.ts`. **No** se usa
  `reparacionesDeLaVentana()` (descarta las órdenes sin equipo, que a nivel de
  sector sí cuentan).
- `PLAZO_DEL_SECTOR = 7` días es nuevo y vive en `porSector.ts`: no se ata a
  `PLAZOS` de `mtbf.ts`, que son los de la ficha de un equipo.
- Las fechas viajan como texto `YYYY-MM-DD` y se comparan como texto. Nunca
  `toISOString()` sobre una fecha local: corre el día en un servidor en UTC.
- Toda lectura de `ordenes_trabajo` pasa por `traerTodo()` de
  `lib/core/paginado.ts`, y el `select` va **literal** en la cadena.
- Un desplegable se escribe `<Select>`. Una grilla de tres columnas lleva
  breakpoint (`grid-cols-1 sm:grid-cols-3`). Una `<table>` va dentro de un
  contenedor con `overflow-x-auto`. Un color de estado va por `style`, no por
  clase al lado de `.card` / `.btn-*` / `.input`.
- **Los tests fijan reglas, no los números de hoy.** El «8 de 19» y la tabla de
  MTBF cambian con cada orden cargada.

## Review Focus

Cinco cosas que el spec implica y que ninguna tarea testearía sola:

1. **Una `fecha_ejecucion` del futuro** —hay errores de carga, la #2726 dice
   06/02/2026 con la orden cargada el 05/10— no es una falla ocurrida ni una
   atrasada de esta semana. → test en Tarea 1 y en Tarea 3.
2. **Un sector con una sola falla reciente**: ventana observada bajo
   `MINIMO_OBSERVADO`, así que `mtbf`, `confiabilidad` **y `mttf`** son `null`
   los tres. Publicar uno y no los otros es lo que hay que evitar. → Tarea 1.
3. **`horas` en 0 o negativo** en una correctiva propia: no entra al MTTR. Cero
   no es «duró cero», es que no se cargó. → Tarea 1.
4. **Una orden sin `sector_id`**: no rompe la cuenta, suma en `sinSector` y no
   inventa un sector «Sin sector» en la tabla. → Tarea 1.
5. **`sectores_status_log` vacío**: el bloque de paradas no explota y dice que
   todavía no hay registro, en vez de dibujar una lista vacía. → Tarea 4.

---

## Estructura de archivos

| Archivo | De qué se ocupa |
|---|---|
| `lib/mantenimiento/porSector.ts` *(nuevo)* | La cuenta: fiabilidad por sector y las dos series mensuales |
| `lib/mantenimiento/porSector.test.ts` *(nuevo)* | Sus reglas |
| `lib/mantenimiento/paradasDeSector.ts` *(nuevo)* | Cuántas veces paró cada sector y cuánto |
| `lib/mantenimiento/paradasDeSector.test.ts` *(nuevo)* | Sus reglas |
| `lib/mantenimiento/alertas.ts` *(modificar)* | `diasDeAtraso` cae en `fecha_ejecucion`; `resumirLaSemana` |
| `lib/mantenimiento/alertas.test.ts` *(modificar)* | Los casos nuevos |
| `lib/mantenimiento/porSectorDatos.ts` *(nuevo)* | La lectura de 455 días |
| `app/api/mantenimiento/indicadores-por-sector/route.ts` *(nuevo)* | Lo que el tablero pide después de pintar |
| `app/(app)/mantenimiento/GraficosMantenimiento.tsx` *(modificar)* | Dos gráficos más |
| `app/(app)/mantenimiento/IndicadoresPorSector.tsx` *(nuevo)* | Los tres bloques que salen de la ruta |
| `app/(app)/mantenimiento/AtrasadasDeLaSemana.tsx` *(nuevo)* | El bloque de gestión operativa |
| `app/(app)/mantenimiento/DashboardClient.tsx` *(modificar)* | Montar los cuatro bloques |
| `app/(app)/mantenimiento/page.tsx` *(modificar)* | Ampliar el `select` de candidatas y resumir la semana |

---

### Task 1: la fiabilidad de cada sector

**Files:**
- Create: `lib/mantenimiento/porSector.ts`
- Test: `lib/mantenimiento/porSector.test.ts`

**Interfaces:**
- Consumes: `fechaDeFalla`, `VENTANA_DIAS`, `MINIMO_OBSERVADO`,
  `confiabilidad` de `./mtbf`; `esDeUnTercero`, `MINIMO_REPARACIONES` de
  `./mttr`.
- Produces:

```ts
export const PLAZO_DEL_SECTOR = 7;

export interface OtDeSector {
  ot_number: number;
  tipo: string | null;
  fecha: string | null;
  fecha_ejecucion: string | null;
  sector_id: string | null;
  horas: number | null;
  contratista: string | null;
}

export interface FilaDeSector {
  sectorId: string;
  fallas: number;
  diasObservados: number;
  mtbf: number | null;          // días
  reparaciones: number;
  mttr: number | null;          // horas
  mttf: number | null;          // días, derivado
  confiabilidad: number | null; // 0..1, a PLAZO_DEL_SECTOR días
  ultima: string;
  porMes: PuntoMensual[];       // vacío hasta la Tarea 2
}

export interface IndicadoresPorSector {
  filas: FilaDeSector[];        // mtbf ascendente; las null al final
  ordenesPorMes: OrdenesDelMes[]; // vacío hasta la Tarea 2
  mesEnCurso: string;
  sinSector: number;
}

export function indicadoresPorSector(
  ordenes: OtDeSector[], hasta: string
): IndicadoresPorSector;
```

- [ ] **Step 1: Write the failing tests**

```ts
const HASTA = "2026-11-19";
const corr = (p: Partial<OtDeSector>): OtDeSector => ({
  ot_number: 1, tipo: "CORRECTIVO", fecha: null, fecha_ejecucion: null,
  sector_id: "A", horas: null, contratista: null, ...p,
});

describe("indicadoresPorSector", () => {
  it("los días observados se cuentan por sector, desde su primera falla", () => {
    // A falló hace un año, B hace 100 días: B no se lleva crédito por los
    // meses que nadie miró.
    const r = indicadoresPorSector([
      corr({ sector_id: "A", fecha_ejecucion: "2025-11-20" }),
      corr({ sector_id: "A", fecha_ejecucion: "2026-11-19" }),
      corr({ sector_id: "B", fecha_ejecucion: "2026-08-12" }),
      corr({ sector_id: "B", fecha_ejecucion: "2026-11-19" }),
    ], HASTA);
    expect(r.filas.find((f) => f.sectorId === "A")!.diasObservados).toBe(365);
    expect(r.filas.find((f) => f.sectorId === "B")!.diasObservados).toBe(100);
  });

  it("bajo el piso de días observados no publica mtbf, confiabilidad ni mttf", () => {
    const r = indicadoresPorSector([
      corr({ fecha_ejecucion: "2026-11-18", horas: 3, ot_number: 1 }),
      corr({ fecha_ejecucion: "2026-11-19", horas: 3, ot_number: 2 }),
      corr({ fecha_ejecucion: "2026-11-19", horas: 3, ot_number: 3 }),
    ], HASTA);
    const a = r.filas[0];
    expect(a.diasObservados).toBe(2);
    expect(a.mtbf).toBeNull();
    expect(a.confiabilidad).toBeNull();
    expect(a.mttf).toBeNull();
    expect(a.reparaciones).toBe(3); // la cuenta de reparaciones sí existe
    expect(a.mttr).toBeCloseTo(3);
  });

  it("el mttr cuenta las correctivas sin equipo enlazado", () => {
    // Es lo que lo separa de `reparacionesDeLaVentana()`: para un sector el
    // dato que hace falta es `sector_id`, no el equipo.
    // Tres órdenes de 6 h sin equipo → mttr 6, no null.
  });

  it("no cuenta las de contratista ni las que no tienen horas", () => {
    // contratista con texto → afuera; horas null, 0 o negativas → afuera.
  });

  it("mttf es mtbf menos el mttr pasado a días, y nunca negativo", () => {
    // mtbf 10 d, mttr 24 h → 9. mtbf 0,5 d, mttr 48 h → 0 y no -1,5.
  });

  it("una falla ejecutada después de `hasta` no cuenta", () => {
    // Hay fechas del futuro por errores de carga.
  });

  it("una orden sin sector no arma una fila: suma en sinSector", () => {
    // sinSector 1 y filas sin ninguna entrada con sectorId null.
  });

  it("ordena por mtbf ascendente y manda las sin mtbf al final", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/mantenimiento/porSector.test.ts`
Expected: FAIL, «Failed to resolve import "./porSector"».

- [ ] **Step 3: Implement `indicadoresPorSector(ordenes, hasta)` in `lib/mantenimiento/porSector.ts`**

El encabezado del archivo explica, en el estilo de `mtbf.ts`: que el MTBF del
sector es «cada cuánto falla algo en el sector» y no cada cuánto falla una
máquina; que los días observados se cuentan por sector; que el MTTR no reusa
`reparacionesDeLaVentana()` y por qué (con el dato medido: sólo Taller cambia);
y que el MTTF es derivado y se recorta en 0.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run lib/mantenimiento/porSector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/porSector.ts lib/mantenimiento/porSector.test.ts
git commit -m "feat(mantenimiento): mtbf, mttr y mttf por sector"
```

---

### Task 2: las dos series mensuales

**Files:**
- Modify: `lib/mantenimiento/porSector.ts`
- Test: `lib/mantenimiento/porSector.test.ts`

**Interfaces:**
- Consumes: `ultimosMeses()` de `./dashboard`, `DIAS_RECIENTE` de `./mtbf`, y
  lo de la Tarea 1.
- Produces:

```ts
export const MINIMO_FALLAS_DEL_MES = 3;

export interface PuntoMensual {
  etiqueta: string;
  /** Fallas del sector **en ese mes calendario**. */
  fallas: number;
  /** R(7) con los DIAS_RECIENTE que terminan en ese mes. null si no alcanza. */
  confiabilidad: number | null;
}

export interface OrdenesDelMes {
  etiqueta: string;
  /** Cuántas órdenes de **todos los tipos**, por id de sector. */
  porSector: Record<string, number>;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
describe("la serie mensual de confiabilidad", () => {
  it("cada punto mira los 90 días anteriores, no el mes solo", () => {
    // 30 fallas repartidas en los 90 días previos al cierre de un mes y
    // ninguna en el mes → el punto NO es null y no es el del mes.
  });

  it("un punto con menos de MINIMO_FALLAS_DEL_MES en su ventana es null", () => {
    // Dos fallas en 90 días → null, para que el gráfico deje el hueco.
  });

  it("un punto cuya ventana observó menos de MINIMO_OBSERVADO días es null", () => {});

  it("el último punto corta en `hasta` y no en el fin del mes", () => {
    // Con hasta = 2026-11-19, la ventana del último punto termina el 19 y no
    // el 30: contar contra un mes que no terminó baja el ritmo sin motivo.
  });

  it("las fallas del punto son las del mes calendario", () => {
    // `fallas` y `confiabilidad` miran ventanas distintas a propósito.
  });

  it("usa fallas anteriores a la ventana del año para el primer punto", () => {
    // Una falla de hace 400 días entra en la ventana móvil del primer mes y
    // NO en `fallas` de la fila, que son 365 días.
  });
});

describe("ordenesPorMes", () => {
  it("cuenta por `fecha` y no por la ejecución", () => {
    // Una orden cargada en octubre y ejecutada en noviembre cuenta en octubre:
    // es la misma fecha que usa el gráfico que ya está en la pantalla.
  });

  it("cuenta todos los tipos, no sólo las correctivas", () => {});

  it("tiene los doce meses aunque alguno esté en cero", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/mantenimiento/porSector.test.ts`
Expected: FAIL, los puntos mensuales vienen vacíos.

- [ ] **Step 3: Implement `porMes` y `ordenesPorMes` dentro de `indicadoresPorSector`**

El corte de cada mes es su último día, salvo el último, que es `hasta`. La
ventana de cada punto es `[corte − (DIAS_RECIENTE − 1), corte]` y sus días
observados se recortan igual que en la Tarea 1 —desde la primera falla de esa
ventana— para no dividir por días que nadie miró.

El comentario al lado de la ventana móvil lleva el porqué medido del spec:
Filler 1 con 2 fallas en noviembre da 33 % con el mes solo contra 2,5 % anual,
y Trituración 3 se queda sin línea justo en los dos últimos meses.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run lib/mantenimiento/porSector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/porSector.ts lib/mantenimiento/porSector.test.ts
git commit -m "feat(mantenimiento): la evolucion mensual por sector"
```

---

### Task 3: las atrasadas de esta semana

**Files:**
- Modify: `lib/mantenimiento/alertas.ts`
- Test: `lib/mantenimiento/alertas.test.ts`

**Interfaces:**
- Produces:

```ts
export const DIAS_DE_LA_SEMANA = 7;

/** `Atrasable` suma un campo. */
export interface Atrasable {
  estado?: string | null;
  proxima_fecha?: string | null;
  fecha_ejecucion?: string | null;
}

/** Lo que hace falta para agrupar una atrasada. */
export interface DeLaSemana extends Atrasable {
  ot_number?: number | null;
  sector_id?: string | null;
  sector_raw?: string | null;
  equipment_id?: string | null;
  equipo_raw?: string | null;
}

export interface GrupoDeLaSemana {
  /** El id cuando lo hay; si no, el texto, que es como se lo nombra. */
  clave: string;
  nombre: string;
  /** null cuando no hay id al que enlazar. */
  id: string | null;
  cuantas: number;
}

export function resumirLaSemana<T extends DeLaSemana>(ordenes: T[], hoy: string): {
  /** Las de la semana. */
  total: number;
  /** Todas las atrasadas, para poder decir «8 de 19». */
  deTodas: number;
  /** El primer día de la ventana, para escribirlo en pantalla. */
  desde: string;
  ordenes: T[];
  porEquipo: GrupoDeLaSemana[];
  porSector: GrupoDeLaSemana[];
}
```

- [ ] **Step 1: Write the failing tests**

```ts
describe("diasDeAtraso con fecha_ejecucion", () => {
  it("cae en fecha_ejecucion cuando no hay proxima_fecha", () => {
    expect(diasDeAtraso(
      { estado: "ATRASADO", proxima_fecha: null, fecha_ejecucion: "2026-08-20" }, HOY
    )).toBe(6);
  });

  it("proxima_fecha manda cuando están las dos", () => {
    // La que una persona puso para el vencimiento gana sobre la de ejecución.
  });

  it("sigue devolviendo null sin ninguna de las dos", () => {
    expect(diasDeAtraso({ estado: "ATRASADO", proxima_fecha: null }, HOY)).toBeNull();
  });
});

describe("resumirLaSemana", () => {
  it("entra la que vencía hoy", () => {
    // Siete días contando hoy: `[hoy - 6, hoy]`.
  });

  it("entra la del séptimo día hacia atrás y no la del octavo", () => {});

  it("no entra una con fecha_ejecucion futura", () => {});

  it("no entra una realizada ni una cancelada", () => {
    // Pasa por `estaAtrasada` primero.
  });

  it("agrupa por equipo, con id cuando lo hay y con el texto cuando no", () => {
    // Dos OT del mismo equipment_id son un grupo de 2; una sin id va sola,
    // con `id: null` para que la pantalla no la enlace.
  });

  it("agrupa por sector y ordena de más a menos", () => {});

  it("deTodas cuenta las atrasadas, no las de la semana", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/mantenimiento/alertas.test.ts`
Expected: FAIL, `resumirLaSemana` no existe y el primer test de `diasDeAtraso`
devuelve `null`.

- [ ] **Step 3: Implement the two changes in `lib/mantenimiento/alertas.ts`**

En el docstring de `diasDeAtraso` va por qué cambió: las 61 OT abiertas no
tienen `proxima_fecha`, así que devolvía `null` en las 19 atrasadas y el panel
mostraba guiones; y que `fecha_ejecucion` de una orden **abierta** es el día
previsto, con el caso de la #2726 como riesgo asumido.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run lib/mantenimiento/alertas.test.ts`
Expected: PASS, incluidos los que ya estaban.

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/alertas.ts lib/mantenimiento/alertas.test.ts
git commit -m "feat(mantenimiento): las ordenes atrasadas de la semana"
```

---

### Task 4: las paradas de cada sector

**Files:**
- Create: `lib/mantenimiento/paradasDeSector.ts`
- Test: `lib/mantenimiento/paradasDeSector.test.ts`

**Interfaces:**
- Consumes: `conPermanencia`, `CambioDeSector` de `./historialDeSectores`.
- Produces:

```ts
export interface ParadaDeSector {
  sectorId: string | null;
  sector: string;
  /** Cuántas veces pasó a un estado distinto de ACTIVA. */
  veces: number;
  fueraDeServicioMs: number;
  /** Desde cuándo está parado ahora, o null si está activo. */
  paradoDesde: string | null;
}

export function paradasPorSector(cambios: CambioDeSector[], ahoraIso: string): {
  sectores: ParadaDeSector[];   // más tiempo fuera de servicio primero
  /** El cambio más viejo que hay, para decir desde cuándo se registra. */
  desde: string | null;
};
```

- [ ] **Step 1: Write the failing tests**

```ts
describe("paradasPorSector", () => {
  it("sin ningún cambio devuelve la lista vacía y desde en null", () => {
    expect(paradasPorSector([], AHORA)).toEqual({ sectores: [], desde: null });
  });

  it("suma PARADA y EN_REPARACION como fuera de servicio", () => {
    // Desde producción las dos son lo mismo, igual que en `resumirHistorial`.
  });

  it("una parada todavía abierta cuenta hasta ahora y dice desde cuándo", () => {
    // paradoDesde con el changed_at del cambio abierto.
  });

  it("un sector que volvió a ACTIVA no está parado ahora", () => {
    expect(/* ... */.paradoDesde).toBeNull();
  });

  it("no cuenta el arranque como una parada", () => {
    // El cambio a ACTIVA no suma en `veces`.
  });

  it("desde es el cambio más viejo de todos, no el del primer sector", () => {});

  it("ordena por tiempo fuera de servicio, de más a menos", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/mantenimiento/paradasDeSector.test.ts`
Expected: FAIL, «Failed to resolve import "./paradasDeSector"».

- [ ] **Step 3: Implement `paradasPorSector(cambios, ahoraIso)`**

El encabezado dice que hoy la tabla tiene 3 filas desde el 12/11/2026, que por
eso no hay gráfico, y que `desde` existe para que la pantalla no prometa una
historia que no tiene.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run lib/mantenimiento/paradasDeSector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/paradasDeSector.ts lib/mantenimiento/paradasDeSector.test.ts
git commit -m "feat(mantenimiento): cuantas veces paro cada sector"
```

---

### Task 5: la lectura y la ruta

**Files:**
- Create: `lib/mantenimiento/porSectorDatos.ts`
- Create: `app/api/mantenimiento/indicadores-por-sector/route.ts`

**Interfaces:**
- Consumes: Tareas 1, 2 y 4; `traerTodo` de `@/lib/core/paginado`; `sumarDias`
  de `@/lib/core/fechas`; `sectoresDePlanta`, `empresaDelSector` de
  `./sectores`; `puedeVerMantenimiento` de `./auth`; `hoyISO` de `./alertas`.
- Produces:

```ts
export interface SectorConNombre extends FilaDeSector {
  sector: string;
  /** El nombre de la empresa, o "TRANSVERSAL". */
  empresa: string;
}

export interface IndicadoresDeLaPlantaPorSector {
  filas: SectorConNombre[];
  ordenesPorMes: OrdenesDelMes[];
  sectores: { id: string; nombre: string; empresa: string }[];
  paradas: ReturnType<typeof paradasPorSector>;
  mesEnCurso: string;
  sinSector: number;
  hasta: string;
}

export async function indicadoresPorSectorDeLaPlanta(
  supabase: SupabaseClient, hasta: string
): Promise<IndicadoresDeLaPlantaPorSector>;
```

- [ ] **Step 1: Implement `indicadoresPorSectorDeLaPlanta` in `lib/mantenimiento/porSectorDatos.ts`**

Una sola lectura de `ordenes_trabajo` de `VENTANA_DIAS + DIAS_RECIENTE` días,
con `traerTodo()`, el `select` literal
`"ot_number, tipo, fecha, fecha_ejecucion, sector_id, horas, contratista"`,
el filtro `or(fecha_ejecucion.gte.<desde>, and(fecha_ejecucion.is.null, fecha.gte.<desde>))`
y `.order("ot_number")` —paginar sin orden estable repite o saltea filas—.
Después, `sectoresDePlanta()` y los cambios de `sectores_status_log` con el
mismo embebido que usa `/mantenimiento/sectores/historial`.

El docstring dice por qué son 455 días y no 365, y que traer de más es
correcto y traer de menos no, como en `mtbfDatos.ts`.

- [ ] **Step 2: Implement the route**

`GET` calcado de `app/api/mantenimiento/mtbf/route.ts`: 401 sin sesión, 403 sin
`puedeVerMantenimiento`, y en el `catch` el detalle al `console.error` y un
mensaje genérico al cuerpo —el error de Supabase nombra tablas y columnas—.

- [ ] **Step 3: Verify**

Run: `npm run tipos`
Expected: sin salida.

- [ ] **Step 4: Commit**

```bash
git add lib/mantenimiento/porSectorDatos.ts app/api/mantenimiento/indicadores-por-sector/route.ts
git commit -m "feat(mantenimiento): la ruta de indicadores por sector"
```

---

### Task 6: los dos gráficos

**Files:**
- Modify: `app/(app)/mantenimiento/GraficosMantenimiento.tsx`

**Interfaces:**
- Produces:

```ts
export function OrdenesPorMesYSector({ datos, claves, colores }: {
  datos: Record<string, unknown>[];   // { etiqueta, [sector]: number }
  claves: string[];
  colores: Record<string, string>;
}): JSX.Element;

export function ConfiabilidadPorSector({ datos, claves, colores, mesEnCurso }: {
  datos: Record<string, unknown>[];   // { etiqueta, [sector]: number | null }
  claves: string[];
  colores: Record<string, string>;
  mesEnCurso: string;
}): JSX.Element;
```

- [ ] **Step 1: Implement both charts**

`OrdenesPorMesYSector` son barras apiladas (`stackId` común), con el mismo
`TOOLTIP`, `CURSOR` y estilo de ejes que los cuatro que ya están.

`ConfiabilidadPorSector` son `<Line>` con **`connectNulls={false}`**, que es la
línea que sostiene la decisión de dejar hueco donde no hay medición; eje Y en
porcentaje de 0 a 1 y `labelFormatter` que marca `mesEnCurso` como incompleto,
igual que `FallasPorMes`.

- [ ] **Step 2: Verify**

Run: `npm run tipos`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/mantenimiento/GraficosMantenimiento.tsx"
git commit -m "feat(mantenimiento): graficos de ordenes y confiabilidad por sector"
```

---

### Task 7: los tres bloques que salen de la ruta

**Files:**
- Create: `app/(app)/mantenimiento/IndicadoresPorSector.tsx`
- Modify: `app/(app)/mantenimiento/DashboardClient.tsx`

**Interfaces:**
- Consumes: la ruta de la Tarea 5, los gráficos de la Tarea 6, `useCargar` de
  `@/lib/core/useCargar`, `InfoTip`.
- Produces: tres componentes que reciben **los mismos datos ya pedidos una vez**
  y el filtro:

```ts
/** `null` mientras carga, `"error"` si el pedido falló. */
export type Estado = IndicadoresDeLaPlantaPorSector | "error" | null;

/** Los dos filtros del tablero, tal como los tiene hoy: por **nombre**. */
export interface Filtro { empresa: string; sector: string }

export function useIndicadoresPorSector(): { datos: Estado; recargar: () => void };
export function FiabilidadPorSector(props: { datos: Estado; filtro: Filtro; recargar: () => void }): JSX.Element;
export function EvolucionPorSector(props: { datos: Estado; filtro: Filtro }): JSX.Element;
export function ParadasDeSector(props: { datos: Estado; filtro: Filtro }): JSX.Element;
```

`empresa` es `"TODAS"` o el nombre de una empresa (o `"TRANSVERSAL"`);
`sector` es `"TODOS"` o el nombre de un sector. Son los valores que
`DashboardClient` ya tiene en `plantFilter` y `sectorFilter`, sin traducir.

- [ ] **Step 1: Implement `useIndicadoresPorSector`**

Un solo `fetch` a la ruta, con el patrón entero de `PeoresPorMtbf`: `null`
mientras carga, `"error"` si falla, esqueleto con `aria-busy`, renglón de «no
se pudo» con botón de reintentar, y **el recuadro ocupa su lugar siempre** —el
motivo medido está en el docstring de `PeoresPorMtbf` y vale igual acá—.

- [ ] **Step 2: Implement `FiabilidadPorSector`**

Una `<table>` dentro de `overflow-x-auto`: sector · fallas · MTBF · MTTR ·
MTTF · «Aguanta 7 días». Filas filtradas por empresa/sector, ordenadas por MTBF
ascendente, cada una enlazando a `/mantenimiento/ordenes?sector=<id>`. Sin fila
de total, con el porqué escrito al lado: el agregado de la planta da 0,36 días
y 0,00 %.

Cuatro `InfoTip`, uno por indicador, que digan: que el MTBF del sector es cada
cuánto falla *algo* en el sector; que el MTTR son horas de trabajo y no de
parada; que **el MTTF es derivado, no medido**, y de ahí que quede a dos horas
del MTBF; y que la confiabilidad supone tasa de falla constante.

Los que no tienen número dicen «—», nunca cero.

- [ ] **Step 3: Implement `EvolucionPorSector`**

Los dos gráficos de la Tarea 6. Las claves salen del filtro con la misma regla
que `Criticidad`: sin filtro por empresa; con empresa, sus sectores; con
sector, ése solo. En la línea de confiabilidad, sin filtro van los **seis
sectores con más fallas** y se dice que son ésos. El pie dice por qué el último
punto tiende a verse mejor de lo que es.

- [ ] **Step 4: Implement `ParadasDeSector`**

La lista de sectores con `veces` y `duracionLegible(fueraDeServicioMs)`, el que
esté parado marcado, y **siempre** el renglón «se registra desde el …» con
`desde`. Sin ningún cambio, sólo ese renglón. Enlaza a
`/mantenimiento/sectores/historial`.

- [ ] **Step 5: Mount them in `DashboardClient.tsx`**

`useIndicadoresPorSector()` se llama **una vez** en `DashboardClient` y el
estado baja a los tres: tres `fetch` de lo mismo serían tres lecturas de 2.503
filas. Cada bloque va **arriba** del contenido que ya tiene su sección.

- [ ] **Step 6: Verify**

Run: `npm run tipos && node scripts/revisar-responsive.mjs`
Expected: tipos sin salida; responsive `ROMPE 0 · APRETADO 0 · MIRAR 1` —ese
1 lo trajo `main`—.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/mantenimiento/IndicadoresPorSector.tsx" "app/(app)/mantenimiento/DashboardClient.tsx"
git commit -m "feat(mantenimiento): el tablero muestra la fiabilidad por sector"
```

---

### Task 8: las atrasadas de la semana en pantalla

**Files:**
- Modify: `app/(app)/mantenimiento/page.tsx`
- Create: `app/(app)/mantenimiento/AtrasadasDeLaSemana.tsx`
- Modify: `app/(app)/mantenimiento/DashboardClient.tsx`

**Interfaces:**
- Consumes: `resumirLaSemana` de la Tarea 3.
- Produces: `<AtrasadasDeLaSemana resumen={…} sectores={…} />`.

- [ ] **Step 1: Widen the `candidatas` select in `page.tsx`**

Se le agregan `fecha_ejecucion`, `sector_id` y `equipment_id` a la lista
literal que ya está. Después, `resumirLaSemana(candidatas ?? [], hoy)` al lado
de `resumirAtrasadas`, sobre **la misma lista**, y baja como prop.

- [ ] **Step 2: Implement `AtrasadasDeLaSemana.tsx`**

Encabezado «N de M atrasadas tenían que hacerse esta semana», las órdenes con
su número enlazado a `?q=<ot>`, y los dos agrupamientos. Un equipo con `id`
enlaza a `/mantenimiento/ordenes?equipo=<id>&estado=ATRASADO`; sin `id` se
nombra y no enlaza. **Devuelve `null` cuando `total` es 0**, igual que
`OrdenesAtrasadas`, con el porqué al lado.

- [ ] **Step 3: Mount it at the top of «Gestión operativa», above `OrdenesAtrasadas`**

- [ ] **Step 4: Verify**

Run: `npm run tipos && node scripts/revisar-responsive.mjs`
Expected: igual que en la Tarea 7.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/mantenimiento/page.tsx" "app/(app)/mantenimiento/AtrasadasDeLaSemana.tsx" "app/(app)/mantenimiento/DashboardClient.tsx"
git commit -m "feat(mantenimiento): las atrasadas de esta semana por equipo y por sector"
```

---

### Task 9: comprobarlo contra la base real y cerrar

**Files:**
- Create: `scripts/indicadores-por-sector.mts`

- [ ] **Step 1: Write the script**

Corre `indicadoresPorSectorDeLaPlanta` con el `SUPABASE_SERVICE_ROLE_KEY` de
`.env.local` e imprime la tabla por sector, la serie de confiabilidad y las
atrasadas de la semana. **No escribe nada.** Mismo preámbulo de carga de
`.env.local` que `scripts/que-haria-el-ciclo.mts`.

- [ ] **Step 2: Run it and compare against the spec's table**

Run: `npx tsx scripts/indicadores-por-sector.mts`
Expected: los quince sectores con los MTBF del spec (Filler 1 en 1,9 días,
Taller con MTTR 6,0 h, cuatro sectores sin MTTR), ninguna línea mensual con
huecos, y las atrasadas de la semana con la ventana `[hoy − 6, hoy]`.

Si algún número no coincide, el que manda es la base: hay que entender la
diferencia antes de seguir, no ajustar el código al papel.

- [ ] **Step 3: Run the five controls**

```bash
npm test
npm run tipos
NODE_OPTIONS=--max-old-space-size=8192 npm run build
node scripts/revisar-responsive.mjs
node scripts/revisar-exportaciones.mjs
```

Expected: tests en verde (los 7.611 de la base más los nuevos), tipos y build
limpios, responsive `MIRAR 1`, exportaciones `ROMPE 0 · MIRAR 0`.

- [ ] **Step 4: Run the committed-tree check**

Run: `node scripts/revisar-arbol-commiteado.mjs`
Expected: sin imports rotos. Es el que atrapa el archivo nuevo que quedó
*staged* y nunca viajó.

- [ ] **Step 5: Commit**

```bash
git add scripts/indicadores-por-sector.mts
git commit -m "chore(mantenimiento): script para medir los indicadores por sector"
```

---

## Lo que este plan NO hace

- **Disponibilidad por sector y su historial.** Esperan los datos del usuario,
  y no se dibuja ningún lugar que los prometa.
- **Ninguna migración.** Nada de esto necesita una columna nueva.
- **Tocar `/mantenimiento/mtbf`, `/api/mantenimiento/mtbf` ni
  `ConfiabilidadDelEquipo`.** Siguen con sus plazos de 7 y 30 días, que a
  escala de equipo sí separan.

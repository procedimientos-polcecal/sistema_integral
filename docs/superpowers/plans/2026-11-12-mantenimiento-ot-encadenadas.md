# OT encadenadas — plan de implementación

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: `superpowers:subagent-driven-development`
> o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan `- [ ]` para marcarlos.

**Objetivo:** que una OT cerrada genere sola la siguiente del ciclo —madre →
hija × 3 → madre— empezando por el cambio y la rotación de martillos en cuatro
molinos y rompedoras.

**Arquitectura:** la decisión es pura y vive en `lib/mantenimiento/cicloDeOT.ts`;
quien habla con la base y con Google es `generarLasEncadenadas`, que compone las
mismas cinco reglas que ya usa `generarLasPeriodicas` y entra como un `recurso`
más de `SINCRONIZACIONES`. El estado del ciclo son dos campos (`desde`,
`vuelta_desde`) y un corte: cuentan sólo las OT del ciclo creadas en `desde` o
después.

**Stack:** Next.js 16 (App Router), Supabase/PostgREST, Vitest, TypeScript.

**Spec:** [docs/superpowers/specs/2026-11-12-mantenimiento-ot-encadenadas-design.md](../specs/2026-11-12-mantenimiento-ot-encadenadas-design.md)

## Restricciones globales

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Las migraciones las corre una persona** a mano en el editor SQL de Supabase.
  El DML sí puede ir por PostgREST. Una migración aplicada **no se edita**.
- **Nunca `git add -A`**: se agregan por nombre los archivos tocados.
- Una policy nueva llama a su función **envuelta**: `using ((select mant_puede_ver()))`.
- `traerTodo()` de `lib/core/paginado.ts` en cualquier tabla que pueda crecer:
  PostgREST corta en 1000 filas y no avisa.
- Al escribir en una planilla nada va como texto: `escribirCeldas` y
  `agregarFila` usan `USER_ENTERED`; la prosa pasa por `textoParaLaCelda()`.
- Un desplegable se escribe `<Select>`; una grilla de 3 lleva `grid-cols-1 sm:grid-cols-3`;
  el ancho de un `.input` va en un `div` que lo envuelva.
- **Los períodos y la cantidad de repeticiones son del usuario, verbatim:**
  PO-C1-04 → 3 días, PY-B1-06 → 6, PY-A1-05 → 6, PY-C1-03 → 10; `repeticiones` = 3
  en los cuatro. Filler 3 (PY-D1-03) **no entra**.
- Verificación antes de dar por buena cualquier tarea: `npx tsc --noEmit`,
  `npm test`, `node scripts/revisar-arbol-commiteado.mjs`, y
  `node scripts/revisar-exportaciones.mjs` en las que tocan una escritura.

## Review Focus

Entradas que el diseño implica y que ninguna tarea probaría sola. Cada una tiene
su test en la tarea dueña del código.

1. **`periodo_dias` en null en la tarea hija.** `mant_tareas_preventivas` lo
   permite a propósito. Sin él no hay fecha: el ciclo tiene que quedar trabado
   diciéndolo, nunca crear una OT sin fecha ni tirar. → Tarea 2.
2. **OT REALIZADO sin `fecha_cierre`.** Pasa: 168 de 986 históricas. Se usa la
   fecha de ejecución, y si tampoco está, trabado. → Tarea 2.
3. **`vuelta_desde` = `repeticiones` al arrancar.** Es el caso de Filler 2, que
   hoy está en 4ª cara: lo próximo es **la madre**, no una cuarta rotación. → Tarea 2.
4. **Dos OT del ciclo abiertas a la vez.** No debería pasar, pero si pasa no se
   crea una tercera. → Tarea 2.
5. **Un ciclo cuyo equipo quedó inactivo.** No genera y se informa, en vez de
   seguir creando órdenes para una máquina que no existe. → Tarea 4.

---

## Tarea 1: La migración y la semilla

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_mantenimiento_ciclos_de_ot.sql`
  (el nombre lo da `npm run migracion "ciclos de ot"`)

**Interfaces:**
- Produce: la tabla `public.mant_ciclos_de_ot` y las columnas
  `ordenes_trabajo.ciclo_id` / `ordenes_trabajo.ciclo_vuelta` que usan las tareas 2 a 7.

- [ ] **Paso 1: Generar el archivo con `npm run migracion "ciclos de ot"`**

Lleva marca de tiempo y no un contador, porque dos sesiones toman el mismo
"próximo número libre" y chocan.

- [ ] **Paso 2: Escribir el encabezado con el porqué**

Qué resuelve, qué se midió (266 OT de martillos, 248 en estos cuatro equipos,
las caras 2ª/3ª/4ª en 63 de ellas) y las dos trampas: que el estado es
`desde` + `vuelta_desde` con el corte, y que las tareas referenciadas viven en
la tabla de la otra sesión.

- [ ] **Paso 3: Crear `public.mant_ciclos_de_ot`**

```sql
create table if not exists public.mant_ciclos_de_ot (
  id              uuid primary key default gen_random_uuid(),
  equipment_id    uuid not null references public.equipos(id) on delete cascade,
  tarea_madre_id  uuid not null references public.mant_tareas_preventivas(id) on delete restrict,
  tarea_hija_id   uuid not null references public.mant_tareas_preventivas(id) on delete restrict,
  repeticiones    smallint not null,
  especialidad    text,
  horas_estimadas numeric,
  desde           date,
  vuelta_desde    smallint,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  creado_por      uuid references public.usuarios(id) on delete set null,

  constraint mant_ciclos_de_ot_un_ciclo_por_equipo unique (equipment_id),
  constraint mant_ciclos_de_ot_repeticiones check (repeticiones > 0 and repeticiones <= 20),
  constraint mant_ciclos_de_ot_vuelta check (vuelta_desde is null or (vuelta_desde >= 0 and vuelta_desde <= repeticiones)),
  constraint mant_ciclos_de_ot_arranque check ((desde is null) = (vuelta_desde is null)),
  constraint mant_ciclos_de_ot_tareas_distintas check (tarea_madre_id <> tarea_hija_id)
);
```

`on delete restrict` en las dos tareas: borrar una tarea del catálogo no puede
dejar un ciclo apuntando al vacío. `(desde is null) = (vuelta_desde is null)`
es lo que impide un arranque a medias.

- [ ] **Paso 4: Las dos columnas en `ordenes_trabajo`**

```sql
alter table public.ordenes_trabajo
  add column if not exists ciclo_id uuid references public.mant_ciclos_de_ot(id) on delete set null,
  add column if not exists ciclo_vuelta smallint;

create index if not exists ordenes_trabajo_ciclo_idx
  on public.ordenes_trabajo (ciclo_id) where ciclo_id is not null;
```

- [ ] **Paso 5: RLS envuelta**

`enable row level security`, lectura `using ((select mant_puede_ver()))` y
escritura con la función de edición del módulo. **Envuelta y no pelada**: pelada
no rompe nada, no avisa, y hace que la tabla cueste proporcional a sus filas.

- [ ] **Paso 6: Sembrar las ocho tareas y los cuatro ciclos**

Las ocho filas de `mant_tareas_preventivas` son
`(equipo, 'ROTACION'|'CAMBIO', 'Martillos')` con `nombre` «Rotación de
Martillos» / «Cambio de Martillos», `periodo_dias` el del equipo en la rotación
y **null en el cambio** —su ritmo lo marca la cara—, `estado` CONFIRMADA y
`motivo` que diga que salió del ciclo de martillos acordado el 12/11/2026. El
`insert` cruza por `equipos.code` y lleva `on conflict (equipment_id, accion,
componente) do nothing`, para no pisar lo que una persona ya haya decidido en la
pantalla del catálogo.

Los cuatro ciclos van con `repeticiones` = 3, `especialidad` = 'MECÁNICO',
**`desde` y `vuelta_desde` en null**: el punto de arranque lo carga una persona.

- [ ] **Paso 7: Comprobar que el SQL es válido sin aplicarlo**

Leerlo entero contra el README de migraciones (las ocho trampas). No se aplica
desde acá: lo corre el usuario.

- [ ] **Paso 8: Commit**

```bash
git add supabase/migrations/<archivo>.sql
git commit -F <mensaje>
```

- [ ] **Paso 9: Decirle al usuario que la corra y esperar**

Las tareas 2 y 3 son puras y siguen sin la base; de la 4 en adelante la
necesitan.

---

## Tarea 2: La decisión, pura

**Archivos:**
- Crear: `lib/mantenimiento/cicloDeOT.ts`
- Test: `lib/mantenimiento/cicloDeOT.test.ts`

**Interfaces:**
- Consume: `sumarDias`, `comoSeLee` de `lib/core/fechas.ts`.
- Produce:

```ts
export interface CicloParaDecidir {
  id: string;
  repeticiones: number;
  /** El de la tarea hija. Nullable: el catálogo lo permite. */
  periodo_dias: number | null;
  desde: string | null;
  vuelta_desde: number | null;
}

export interface OTDelCiclo {
  ot_number: number;
  ciclo_vuelta: number;
  estado: string | null;
  fecha_cierre: string | null;
  fecha_ejecucion: string | null;
  /** ISO. El corte compara contra `desde`. */
  created_at_app: string | null;
}

export type Decision =
  | { que: "crear"; vuelta: number; fecha_ejecucion: string }
  | { que: "esperar"; ot: number }
  | { que: "sin_arrancar" }
  | { que: "trabado"; porque: string };

export function queSigueEnElCiclo(
  ciclo: CicloParaDecidir,
  ots: readonly OTDelCiclo[]
): Decision;

/** Vuelta 1 → "2ª". La cara es la vuelta más uno: los martillos entran en 1ª. */
export function caraDeLaVuelta(vuelta: number): string;

export function descripcionDeLaOT(p: {
  tarea: string;
  componente: string;
  vuelta: number;
  repeticiones: number;
  ultimoCambio: string | null;
}): string;
```

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
const CICLO: CicloParaDecidir = {
  id: "c1", repeticiones: 3, periodo_dias: 3,
  desde: "2026-11-03", vuelta_desde: 0,
};

describe("queSigueEnElCiclo", () => {
  it("sin arranque no hace nada", () => {
    expect(queSigueEnElCiclo({ ...CICLO, desde: null, vuelta_desde: null }, []))
      .toEqual({ que: "sin_arrancar" });
  });

  it("sin OT propias arranca en la vuelta siguiente a la cargada", () => {
    expect(queSigueEnElCiclo(CICLO, []))
      .toEqual({ que: "crear", vuelta: 1, fecha_ejecucion: "2026-11-06" });
  });

  // Review Focus 3: el caso de Filler 2, hoy en 4ª cara.
  it("con la ultima vuelta hecha, lo que sigue es la madre", () => {
    expect(queSigueEnElCiclo({ ...CICLO, vuelta_desde: 3 }, []))
      .toEqual({ que: "crear", vuelta: 0, fecha_ejecucion: "2026-11-06" });
  });

  it("una hija cerrada genera la siguiente desde su cierre", () => {
    const ots = [{ ot_number: 10, ciclo_vuelta: 1, estado: "REALIZADO",
      fecha_cierre: "2026-11-07", fecha_ejecucion: "2026-11-06",
      created_at_app: "2026-11-03T12:00:00Z" }];
    expect(queSigueEnElCiclo(CICLO, ots))
      .toEqual({ que: "crear", vuelta: 2, fecha_ejecucion: "2026-11-10" });
  });

  it("la madre cerrada no genera: lo hace el corte en la corrida siguiente", () => {
    const ots = [{ ot_number: 11, ciclo_vuelta: 0, estado: "REALIZADO",
      fecha_cierre: "2026-11-05", fecha_ejecucion: "2026-11-04",
      created_at_app: "2026-11-03T12:00:00Z" }];
    expect(queSigueEnElCiclo(CICLO, ots)).toEqual({ que: "esperar", ot: 11 });
  });

  it("una OT abierta hace esperar", () => {
    const ots = [{ ot_number: 12, ciclo_vuelta: 1, estado: "POR_HACER",
      fecha_cierre: null, fecha_ejecucion: "2026-11-06",
      created_at_app: "2026-11-03T12:00:00Z" }];
    expect(queSigueEnElCiclo(CICLO, ots)).toEqual({ que: "esperar", ot: 12 });
  });

  // El corte: lo anterior a `desde` no cuenta. Es lo que hace que el boton
  // de reinicio no reviva la orden que acaba de suspender.
  it("ignora las OT creadas antes de desde", () => {
    const ots = [{ ot_number: 13, ciclo_vuelta: 2, estado: "REALIZADO",
      fecha_cierre: "2026-10-30", fecha_ejecucion: "2026-10-29",
      created_at_app: "2026-10-25T12:00:00Z" }];
    expect(queSigueEnElCiclo(CICLO, ots))
      .toEqual({ que: "crear", vuelta: 1, fecha_ejecucion: "2026-11-06" });
  });

  // Review Focus 1
  it("sin periodo_dias queda trabado y lo dice", () => {
    const d = queSigueEnElCiclo({ ...CICLO, periodo_dias: null }, []);
    expect(d.que).toBe("trabado");
    expect((d as { porque: string }).porque).toContain("cada cuántos días");
  });

  // Review Focus 2
  it("REALIZADO sin fecha de cierre usa la de ejecucion", () => {
    const ots = [{ ot_number: 14, ciclo_vuelta: 1, estado: "REALIZADO",
      fecha_cierre: null, fecha_ejecucion: "2026-11-07",
      created_at_app: "2026-11-03T12:00:00Z" }];
    expect(queSigueEnElCiclo(CICLO, ots))
      .toEqual({ que: "crear", vuelta: 2, fecha_ejecucion: "2026-11-10" });
  });

  it("REALIZADO sin ninguna fecha queda trabado", () => {
    const ots = [{ ot_number: 15, ciclo_vuelta: 1, estado: "REALIZADO",
      fecha_cierre: null, fecha_ejecucion: null,
      created_at_app: "2026-11-03T12:00:00Z" }];
    expect(queSigueEnElCiclo(CICLO, ots).que).toBe("trabado");
  });

  it("una SUSPENDIDA detiene el ciclo", () => {
    const ots = [{ ot_number: 16, ciclo_vuelta: 1, estado: "SUSPENDIDA",
      fecha_cierre: null, fecha_ejecucion: "2026-11-06",
      created_at_app: "2026-11-03T12:00:00Z" }];
    const d = queSigueEnElCiclo(CICLO, ots);
    expect(d.que).toBe("trabado");
    expect((d as { porque: string }).porque).toContain("suspendida");
  });

  // Review Focus 4
  it("con dos abiertas no crea una tercera", () => {
    const abierta = (n: number, v: number) => ({ ot_number: n, ciclo_vuelta: v,
      estado: "POR_HACER", fecha_cierre: null, fecha_ejecucion: "2026-11-06",
      created_at_app: "2026-11-03T12:00:00Z" });
    expect(queSigueEnElCiclo(CICLO, [abierta(17, 1), abierta(18, 2)]).que)
      .toBe("esperar");
  });
});

describe("caraDeLaVuelta", () => {
  it("la vuelta n lleva a la cara n+1", () => {
    expect([1, 2, 3].map(caraDeLaVuelta)).toEqual(["2ª", "3ª", "4ª"]);
  });
});

describe("descripcionDeLaOT", () => {
  it("la hija dice la cara, la vuelta y cuando se cambiaron", () => {
    expect(descripcionDeLaOT({ tarea: "Rotación de Martillos",
      componente: "Martillos", vuelta: 2, repeticiones: 3,
      ultimoCambio: "2026-10-23" }))
      .toBe("Rotación de Martillos — a 3ª cara (2 de 3). Martillos cambiados el 23/10/2026.");
  });

  it("sin fecha de cambio no inventa la frase", () => {
    expect(descripcionDeLaOT({ tarea: "Rotación de Martillos",
      componente: "Martillos", vuelta: 1, repeticiones: 3, ultimoCambio: null }))
      .toBe("Rotación de Martillos — a 2ª cara (1 de 3).");
  });

  it("la madre dice que las vueltas estan hechas", () => {
    expect(descripcionDeLaOT({ tarea: "Cambio de Martillos",
      componente: "Martillos", vuelta: 0, repeticiones: 3,
      ultimoCambio: "2026-10-17" }))
      .toBe("Cambio de Martillos — las 3 rotaciones están hechas. Martillos cambiados el 17/10/2026.");
  });
});
```

- [ ] **Paso 2: Correr los tests y ver que fallan**

Run: `npx vitest run lib/mantenimiento/cicloDeOT.test.ts`
Esperado: FAIL, «does not provide an export named».

- [ ] **Paso 3: Implementar las tres funciones**

El orden de `queSigueEnElCiclo`: recortar a las OT creadas en `desde` o después
(comparando el día de `created_at_app`), tomar la de mayor `ciclo_vuelta` y,
a igualdad, la de `created_at_app` más reciente. El encabezado del archivo
explica **por qué existe el corte**, con el caso que el revisor encontró: sin él
el reinicio revivía la orden recién suspendida.

- [ ] **Paso 4: Correr los tests y ver que pasan**

Run: `npx vitest run lib/mantenimiento/cicloDeOT.test.ts` → PASS

- [ ] **Paso 5: Commit**

---

## Tarea 3: La sospecha, pura

**Archivos:**
- Crear: `lib/mantenimiento/sospechaDeCambio.ts`
- Test: `lib/mantenimiento/sospechaDeCambio.test.ts`

**Interfaces:**
- Produce:

```ts
/** Si el texto habla de cambiar/colocar martillos. Nunca decide: sólo pregunta. */
export function pareceUnCambio(descripcion: unknown, componente: string): boolean;

export interface CicloVigilado {
  id: string; equipment_id: string; equipo: string;
  desde: string | null; componente: string;
}
export interface CerradaParaMirar {
  ot_number: number; equipment_id: string | null;
  descripcion: string | null; fecha_cierre: string | null; ciclo_id: string | null;
}
export interface Sospecha { ciclo_id: string; equipo: string; ot: number[] }

export function sospechasDeCambio(
  ciclos: readonly CicloVigilado[],
  cerradas: readonly CerradaParaMirar[]
): Sospecha[];
```

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
describe("pareceUnCambio", () => {
  it("reconoce las formas que usa la planta", () => {
    for (const t of ["Cambio de martillos", "Se cambian martillos",
                     "Cambio de 20 grillas y cambio de martillos",
                     "Se colocan martillos nuevos"]) {
      expect(pareceUnCambio(t, "Martillos")).toBe(true);
    }
  });

  it("una rotacion no es un cambio, aunque cambie otra cosa", () => {
    for (const t of ["Rotación de martillos y cambio de grillas",
                     "Se rotan martillos a 2da cara y se cambian 3 grillas de 2mm",
                     "Se cambian grillas y se rotan martillos"]) {
      expect(pareceUnCambio(t, "Martillos")).toBe(false);
    }
  });

  it("sin el componente nombrado no sospecha", () => {
    expect(pareceUnCambio("Cambio de correas", "Martillos")).toBe(false);
    expect(pareceUnCambio(null, "Martillos")).toBe(false);
  });
});

describe("sospechasDeCambio", () => {
  const ciclo = { id: "c1", equipment_id: "e1", equipo: "PO-C1-04",
    desde: "2026-11-03", componente: "Martillos" };
  const cerrada = (p: Partial<CerradaParaMirar>): CerradaParaMirar => ({
    ot_number: 1, equipment_id: "e1", descripcion: "Cambio de martillos",
    fecha_cierre: "2026-11-09", ciclo_id: null, ...p });

  it("avisa de un cambio ajeno posterior a desde", () => {
    expect(sospechasDeCambio([ciclo], [cerrada({ ot_number: 70 })]))
      .toEqual([{ ciclo_id: "c1", equipo: "PO-C1-04", ot: [70] }]);
  });

  // El corte: es lo unico que hace que este aviso se apague solo.
  it("no mira lo cerrado antes de desde", () => {
    expect(sospechasDeCambio([ciclo], [cerrada({ fecha_cierre: "2026-10-30" })]))
      .toEqual([]);
  });

  it("la OT del propio ciclo no es sospechosa", () => {
    expect(sospechasDeCambio([ciclo], [cerrada({ ciclo_id: "c1" })])).toEqual([]);
  });

  it("un ciclo sin arrancar no sospecha nada", () => {
    expect(sospechasDeCambio([{ ...ciclo, desde: null }], [cerrada({})])).toEqual([]);
  });

  it("no mezcla equipos", () => {
    expect(sospechasDeCambio([ciclo], [cerrada({ equipment_id: "e2" })])).toEqual([]);
  });
});
```

- [ ] **Paso 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/sospechaDeCambio.test.ts` → FAIL

- [ ] **Paso 3: Implementar**

`pareceUnCambio` normaliza sin acentos (`normalize("NFD")`) y pide un verbo de
cambio pegado al componente, **descartando antes** las que hablan de rotar ese
mismo componente. El encabezado dice que el texto no decide nunca: un falso
positivo cuesta una pregunta, un falso negativo deja todo como estaba.

- [ ] **Paso 4: Correr y ver que pasan** → PASS

- [ ] **Paso 5: Commit**

---

## Tarea 4: El generador, y su lugar en la sincronización

**Archivos:**
- Crear: `lib/mantenimiento/generarEncadenadas.ts`
- Modificar: `lib/mantenimiento/sincronizar.ts` (la constante `SINCRONIZACIONES`)
- Test: `lib/mantenimiento/generarEncadenadas.test.ts`

**Interfaces:**
- Consume: `queSigueEnElCiclo`, `descripcionDeLaOT` (Tarea 2);
  `altaEnLaPlanilla` de `lib/mantenimiento/formulario.ts`;
  `estadoSegunElCierre`, `loQueHayQueExportar` de `lib/mantenimiento/cierreDeOT.ts`;
  `celdasParaRegistrar` de `lib/mantenimiento/ordenes.ts`;
  `escribirEnLaFilaDeLaOT` de `lib/mantenimiento/planillaDeOT.ts`;
  `elPendienteDelIntento` de `lib/mantenimiento/pendienteDeLaOT.ts`;
  `alNacerLaOT` de `lib/agenda/alNacerLaOT.ts`.
- Produce:

```ts
export interface ResultadoDeEncadenadas {
  generadas: { ot_number: number; ciclo_id: string; vuelta: number }[];
  sinArrancar: string[];
  trabados: { ciclo_id: string; porque: string }[];
  fallaron: { ciclo_id: string; error: string }[];
  sinEstadoTodavia: number[];
  sinCalendario: { ot_number: number; aviso: string }[];
}

export async function generarLasEncadenadas(
  admin?: ReturnType<typeof createAdminClient>,
  hoy?: string
): Promise<ResultadoDeEncadenadas>;
```

- [ ] **Paso 1: Escribir el test que falla**

Lo que se prueba acá es **el reparto del resultado**, no el camino a Google: la
decisión ya tiene sus tests en la Tarea 2 y el alta los suyos. Un `admin` falso
que devuelve los ciclos y las OT alcanza.

```ts
it("un ciclo sin arrancar se informa y no se crea nada", async () => {
  const r = await generarLasEncadenadas(adminFalso({ ciclos: [cicloSinDesde] }));
  expect(r.sinArrancar).toEqual(["c1"]);
  expect(r.generadas).toEqual([]);
});

// Review Focus 5
it("un ciclo de un equipo inactivo no genera y se informa", async () => {
  const r = await generarLasEncadenadas(adminFalso({ ciclos: [cicloEquipoInactivo] }));
  expect(r.generadas).toEqual([]);
  expect(r.trabados[0].porque).toContain("inactivo");
});

it("un ciclo trabado no frena al siguiente", async () => {
  const r = await generarLasEncadenadas(adminFalso({ ciclos: [cicloTrabado, cicloListo] }));
  expect(r.trabados).toHaveLength(1);
  expect(r.generadas).toHaveLength(1);
});
```

- [ ] **Paso 2: Correr y ver que falla** → FAIL

- [ ] **Paso 3: Implementar `generarLasEncadenadas`**

El orden es el mismo que el de las periódicas y **no es cosmético**: primero la
planilla (`altaEnLaPlanilla`), después el insert, después la columna M con su
`sheets_pendiente`, y el calendario al final. Una orden existe cuando tiene su
fila allá; si la planilla falla, no se creó nada en ningún lado y no se consumió
ningún número.

Lee los ciclos activos con sus dos tareas y su equipo por embed, y las OT de
cada ciclo con `traerTodo()`. Nunca tira: devuelve qué pasó con cada ciclo.

La OT nace con `tipo: "PROGRAMADO"`, `especialidad` la del ciclo,
`quien: "INTERNO"`, sin operario y sin prioridad; `app_created: true` y
`created_at_app`, que es lo que la protege del borrado de espejo; y
`ciclo_id` / `ciclo_vuelta`. La fila de la planilla la firma «SdG (automático)».

- [ ] **Paso 4: Correr y ver que pasa** → PASS

- [ ] **Paso 5: Mover el corte cuando la madre se cierra**

Sin esto **el ciclo se detiene para siempre después del primer cambio**: la
tabla de la Tarea 2 dice que una madre cerrada no genera nada, así que si nadie
mueve `desde`, esa madre queda siendo la última en rango para toda la eternidad.
Lo mueven **tres puntas y nada más** —la madre al cerrarse, el botón, la carga
inicial—; las hijas no, porque quedan dentro del rango y la tabla ya las lee
bien.

```ts
it("la madre cerrada mueve el corte a su fecha de cierre", async () => {
  const admin = adminFalso({ ciclos: [ciclo], ots: [madreCerrada("2026-11-20")] });
  await generarLasEncadenadas(admin);
  expect(admin.actualizado("mant_ciclos_de_ot")).toMatchObject({
    desde: "2026-11-20", vuelta_desde: 0,
  });
});

it("una hija cerrada no mueve el corte", async () => {
  const admin = adminFalso({ ciclos: [ciclo], ots: [hijaCerrada(1, "2026-11-07")] });
  await generarLasEncadenadas(admin);
  expect(admin.actualizado("mant_ciclos_de_ot")).toBeUndefined();
});
```

Run: `npx vitest run lib/mantenimiento/generarEncadenadas.test.ts` → PASS

- [ ] **Paso 6: Agregar el recurso a `SINCRONIZACIONES`**

Entra **después de `ordenes`**, al lado de `periodicas`, por el mismo motivo
escrito ahí: una OT recién creada todavía no está en el master. El comentario lo
dice. Actualizar el test que fija cuántas sincronizaciones hay y que las cuatro
que espejan la planilla siguen primero.

- [ ] **Paso 7: Verificar entero**

Run: `npx tsc --noEmit` y `npm test`
Esperado: limpio, y el test del conteo de `SINCRONIZACIONES` actualizado en verde.

- [ ] **Paso 8: Commit**

---

## Tarea 5: Las dos rutas — arrancar y reiniciar

**Archivos:**
- Crear: `app/api/mantenimiento/ciclos/[id]/route.ts` (PATCH: el arranque)
- Crear: `app/api/mantenimiento/ciclos/[id]/reiniciar/route.ts` (POST: el botón)
- Modificar: `scripts/revisar-exportaciones.mjs`
- Test: `lib/mantenimiento/arranqueDelCiclo.test.ts`
- Crear: `lib/mantenimiento/arranqueDelCiclo.ts`

**Interfaces:**
- Consume: `puedeEditarMantenimiento` de `lib/mantenimiento/auth.ts`;
  `cuerpoJson` de `lib/core/cuerpo.ts`; `celdasParaRegistrar`,
  `escribirEnLaFilaDeLaOT`, `elPendienteDelIntento`.
- Produce:

```ts
/** Qué le falta al arranque, todo junto y en castellano. */
export function loQueFaltaParaArrancar(
  p: { desde: unknown; vuelta_desde: unknown },
  repeticiones: number
): string[];
```

- [ ] **Paso 1: Escribir los tests de `loQueFaltaParaArrancar`**

```ts
it("informa todos los problemas juntos", () => {
  expect(loQueFaltaParaArrancar({ desde: "", vuelta_desde: 9 }, 3))
    .toEqual(["la fecha del último trabajo", "en qué vuelta quedó"]);
});
it("una vuelta igual a las repeticiones es valida: lo proximo es la madre", () => {
  expect(loQueFaltaParaArrancar({ desde: "2026-11-11", vuelta_desde: 3 }, 3)).toEqual([]);
});
it("una fecha futura no se acepta", () => {
  expect(loQueFaltaParaArrancar({ desde: "2027-01-01", vuelta_desde: 0 }, 3))
    .toContain("la fecha del último trabajo");
});
```

- [ ] **Paso 2: Correr y ver que fallan** → FAIL

- [ ] **Paso 3: Implementar `loQueFaltaParaArrancar`** → PASS

- [ ] **Paso 4: Escribir el PATCH de `/api/mantenimiento/ciclos/[id]`**

Permisos → `loQueFaltaParaArrancar` → `update` de `desde` y `vuelta_desde`.
No toca la planilla: no cambia ninguna OT.

- [ ] **Paso 5: Escribir el POST de `/reiniciar`**

El orden importa y el encabezado lo explica:

1. Permisos, y el ciclo existe.
2. Buscar la OT viva del ciclo. **Si es la madre** (`ciclo_vuelta` = 0), no se
   toca nada y se contesta 400 diciendo que esa orden *es* el cambio y que
   cerrándola el ciclo arranca solo.
3. Si es una hija: `estado` = SUSPENDIDA, `ciclo_id` = null, y una nota
   automática que diga por qué. **Exporta o encola**: `celdasParaRegistrar` con
   el estado nuevo y `elPendienteDelIntento` si la planilla no contestó.
4. `desde` = hoy, `vuelta_desde` = 0.

- [ ] **Paso 6: Declarar las dos rutas en `revisar-exportaciones`**

La de reiniciar escribe la planilla: estrategia `cola`. La de arrancar no
escribe: no se declara, y si el script la marca, es que escribe y hay que mirarlo.

Run: `node scripts/revisar-exportaciones.mjs`
Esperado: `ROMPE 0 · MIRAR 0`

- [ ] **Paso 7: Verificar y commitear**

Run: `npx tsc --noEmit` y `npm test` → limpio

---

## Tarea 6: La sección en la ficha del equipo

**Archivos:**
- Crear: `app/(app)/mantenimiento/equipos/[id]/CicloDeOT.tsx`
- Modificar: `app/(app)/mantenimiento/equipos/[id]/page.tsx`

**Interfaces:**
- Consume: las dos rutas de la Tarea 5; `caraDeLaVuelta` (Tarea 2).

- [ ] **Paso 1: Escribir el componente**

Muestra, sin que haya que deducirlo: la tarea madre y la hija con su período y
`repeticiones`; **en qué vuelta va y de cuántas**, y desde cuándo; **cuál es la
OT viva**, enlazada a `/mantenimiento/ordenes`; y el botón **«Se cambiaron los
martillos»** con confirmación, que dice que va a suspender la orden que espera.

Si el ciclo está sin arrancar, lo dice con todas las letras y ofrece cargar la
fecha y la vuelta: un ciclo activo que no hace nada y no explica por qué es
indistinguible de uno roto.

`<Select>` para la vuelta (son 4 opciones, así que renderiza el nativo),
`grid-cols-1 sm:grid-cols-3` si hay grilla, y el ancho de los campos en un `div`
que los envuelva — `.input` declara `width:100%` fuera de toda capa y le gana a
cualquier `w-*`.

- [ ] **Paso 2: Enlazarlo desde la ficha**

Sólo si el equipo tiene un ciclo: un componente que diga «este equipo no tiene
ciclo» en los 265 equipos restantes es ruido.

- [ ] **Paso 3: Verificar**

Run: `npx tsc --noEmit`, `node scripts/revisar-responsive.mjs`
Esperado: limpio, `ROMPE 0 · APRETADO 0 · MIRAR 0`

- [ ] **Paso 4: Commit**

---

## Tarea 7: El aviso que pregunta

**Archivos:**
- Modificar: `lib/home/avisos.ts` (productor dinámico nuevo)
- Modificar: `lib/home/avisosDeUsuario.ts` (la consulta y el enganche)
- Test: `lib/home/avisos.test.ts`

**Interfaces:**
- Consume: `sospechasDeCambio` (Tarea 3).
- Produce: `export function avisosDeCiclos(sospechas: readonly Sospecha[], equipos: ...): Notificacion[]`

- [ ] **Paso 1: Escribir el test que falla**

```ts
it("un aviso por ciclo, con id propio y enlace a la ficha", () => {
  expect(avisosDeCiclos([{ ciclo_id: "c1", equipo: "PO-C1-04", ot: [70, 71] }],
                        { c1: "e1" }))
    .toEqual([{
      id: "mant-ciclo-sospechoso-PO-C1-04",
      titulo: "Puede que se hayan cambiado los martillos de PO-C1-04 sin avisar al ciclo",
      cantidad: 2,
      href: "/mantenimiento/equipos/e1",
    }]);
});
it("sin sospechas no hay avisos", () => {
  expect(avisosDeCiclos([], {})).toEqual([]);
});
```

- [ ] **Paso 2: Correr y ver que falla** → FAIL

- [ ] **Paso 3: Implementar, con la forma de `avisosDeSalud`**

Uno por ciclo y no uno con el conteo: un aviso único hace que arreglar uno y
romper otro deje el número igual, y entonces no suena la campana. El id es nuevo
y no se reusa.

- [ ] **Paso 4: Engancharlo en `avisosDeUsuario`**

Trae los ciclos activos con `desde` y las OT cerradas de esos equipos
posteriores a `desde`, y pasa las dos listas a `sospechasDeCambio`.

**Esto sale por la campana y por el push**, así que el corte por `desde` no es
negociable: sin él son 56 el primer día.

- [ ] **Paso 5: Correr y ver que pasa** → PASS

- [ ] **Paso 6: Commit**

---

## Tarea 8: La documentación, y la primera corrida

**Archivos:**
- Modificar: `docs/MANTENIMIENTO-INTEGRACION.md` (sección nueva)
- Modificar: `CLAUDE.md` (la fila de Mantenimiento en la tabla de documentos)

- [ ] **Paso 1: Escribir la sección del módulo**

Las tres cosas que **no se deducen del código**: que el estado del ciclo es
`desde` + `vuelta_desde` con el corte y por qué (el bug que el revisor
encontró); que la cara es la vuelta más uno y que eso lo confirman 63 OT con las
caras 2ª, 3ª y 4ª; y que el ciclo apunta a `mant_tareas_preventivas` para que el
día que ese catálogo genere planes no se dupliquen estas cuatro máquinas.

- [ ] **Paso 2: Agregar el enlace en `CLAUDE.md`**

- [ ] **Paso 3: Verificación final**

Run: `npx tsc --noEmit`, `npm test`, `node scripts/revisar-arbol-commiteado.mjs`,
`node scripts/revisar-exportaciones.mjs`, `node scripts/revisar-responsive.mjs`

- [ ] **Paso 4: Commit y push**

- [ ] **Paso 5: Decirle al usuario qué falta para que esto genere algo**

Que cargue el punto de arranque de los cuatro equipos desde la ficha. Hasta
entonces **no se genera ninguna OT**, y eso es a propósito.

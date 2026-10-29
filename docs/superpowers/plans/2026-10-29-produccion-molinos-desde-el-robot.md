# Molinos desde el PC Robot — Plan de implementación

> **Para quien ejecute esto:** SUB-SKILL REQUERIDA: usar
> superpowers:subagent-driven-development (recomendada) o
> superpowers:executing-plans para implementarlo tarea por tarea. Los pasos
> usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que el SdG lea solo los zips del PC Robot desde Drive y muestre,
por molino, toneladas procesadas, horas de marcha, horas no trabajadas,
utilización y productividad — con la única carga manual siendo el motivo de una
parada.

**Arquitectura:** la lógica pura (parseo, reglas de turno, indicadores) vive en
`lib/produccion/molinos/` con tests de vitest; la importación es un cron que
**reconcilia** —procesa el zip entero y deja la base igual a lo que dice— y
nunca pisa lo que cargó una persona; las pantallas son tres bajo
`/produccion/molinos`.

**Stack:** Next.js 16 (App Router), Supabase, vitest, `jszip` (ya es
dependencia), la cuenta de servicio de Google que ya existe.

**Spec:** [docs/superpowers/specs/2026-10-21-produccion-molinos-desde-el-robot-design.md](../specs/2026-10-21-produccion-molinos-desde-el-robot-design.md)

**La mitad de afuera ya está hecha** y no es parte de este plan: la tarea
programada que sube los zips a la unidad compartida `PC Robot`, documentada en
[docs/PRODUCCION-FILLERS-SUBIDA.md](../../PRODUCCION-FILLERS-SUBIDA.md).
Verificado el 29/10/2026 que `sheets-reader@mantenimientopp` —la credencial que
tiene Vercel— **lista y descarga** esos archivos.

## Restricciones globales

- **Todo en castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Los cuatro turnos y su duración teórica**, que no se negocian:
  `23:59 → 20_00` (240 min), `3:59 → 00_04` (240), `11:59 → 04_12` (480),
  `19:59 → 12_20` (480). **El turno lo decide la hora de cierre, nunca la
  posición de la columna.**
- **Tolerancia de exceso de marcha: 10 minutos.**
- **Umbral para pedir motivo: 5 minutos**, dato del catálogo y no constante.
- **Los CSV** son `;`, sin encabezado, fecha `d/m/yyyy`, cp1252, y traen líneas
  en blanco.
- **Una policy nueva llama a su función envuelta**: `using ((select tiene_acceso_produccion()))`.
- **`traerTodo()`** de `lib/core/paginado.ts` en toda lectura que pueda pasar
  de 1000 filas. `produccion_molino_turnos` crece ~1.460 filas por molino por
  año: pasa el umbral en el primer año.
- **`<Select>` y no `<select>`**; `grid-cols-1 sm:grid-cols-N`.
- **Las migraciones las aplica una persona.** Las tareas 1 y 2 terminan
  avisando y esperando.
- **No se escribe ninguna planilla de Google** y **no se agrega ningún aviso** a
  `lib/home/avisos.ts` (ver el spec: el push sale 11:30 UTC y la importación es
  posterior).

## Foco de revisión

Cinco cosas que el spec implica, que ningún test de tarea ejercita por su
cuenta, y que van a morder a alguien. Cada una tiene su test agregado a la
tarea que es dueña del código.

1. **Una fila con una hora distinta de los cuatro cortes.** Hoy no existe
   ninguna en 1.811 filas; el día que aparezca significa que el robot cambió.
   Tiene que avisar, no acomodarse ni descartarse en silencio → Tarea 3.
2. **Un archivo de Drive cuyo prefijo no coincide con ningún molino del
   catálogo.** No se adivina a cuál pertenece: no se importa y se informa →
   Tarea 6.
3. **Líneas en blanco y campos no numéricos en el CSV.** `DAT00000001.CSV` de
   Filler 2 tiene 747 líneas para ~249 filas útiles: las blancas son reales y
   no deben entrar como filas de cero → Tarea 3.
4. **El archivo más nuevo de un molino tiene más de un día.** Es el único
   control que mira el resultado y no el intento; sin él, una tarea programada
   que dejó de correr no se nota → Tarea 6.
5. **Quien carga un motivo no tiene acceso a Mantenimiento.** La lista de OT le
   llega vacía y sin error —la trampa del valor hora—, y eso se lee como "no
   hay OT" → Tarea 8. **Es el único de los cinco que no se cierra con un
   test**, porque en este repo las pantallas no tienen tests: se comprueba a
   mano, con un usuario sin acceso a Mantenimiento, y el paso lo dice.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<ts>_produccion_molinos_enums.sql` | los dos enums, solos |
| `supabase/migrations/<ts>_produccion_molinos_schema.sql` | tres tablas, permisos, RLS, catálogo inicial |
| `lib/produccion/molinos/types.ts` | tipos, sin lógica |
| `lib/produccion/molinos/csv.ts` | CSV crudo → `FilaCruda[]`, por formato de molino |
| `lib/produccion/molinos/turnos.ts` | las cuatro reglas del spec: corte→turno, día no operativo, racha acumulada, huérfano |
| `lib/produccion/molinos/indicadores.ts` | los cinco números, sobre turnos ya armados |
| `lib/produccion/molinos/drive.ts` | listar la carpeta, bajar el zip, descomprimir |
| `lib/produccion/molinos/importar.ts` | reconciliar contra la base sin pisar lo humano |
| `lib/produccion/molinos/consultas.ts` | lo que leen las pantallas |
| `app/api/cron/produccion-molinos-sync/route.ts` | el cron diario |
| `app/api/produccion/molinos/importar/route.ts` | el botón de importar a mano |
| `app/api/produccion/molinos/paradas/route.ts` | alta y edición del motivo |
| `app/(app)/produccion/molinos/page.tsx` + `MolinosClient.tsx` | el día |
| `app/(app)/produccion/molinos/mes/page.tsx` + `MesClient.tsx` | el mes |
| `app/(app)/produccion/molinos/sin-explicar/page.tsx` + `ColaClient.tsx` | la cola |

---

### Tarea 1: Los enums

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_produccion_molinos_enums.sql`

**Interfaces:**
- Produce: los tipos `produccion_molino_turno` y `produccion_molino_estado`,
  que usa la Tarea 2.

- [ ] **Paso 1: Crear el archivo con `npm run migracion "produccion molinos enums"`**

- [ ] **Paso 2: Escribir los dos tipos**

```sql
create type produccion_molino_turno  as enum ('20_00', '00_04', '04_12', '12_20');
create type produccion_molino_estado as enum ('normal', 'acumulado', 'inconsistente', 'huerfano');
```

El encabezado explica dos cosas.

Por qué viajan solos: **la Tarea 2 los usa en columnas y en policies, y para eso
tienen que estar aplicados.** Ojo con la tentación de citar el `55P04` acá —
ese error es de `alter type ... add value` usado en la misma transacción que lo
agregó, y acá no hay ningún `alter type`: los dos tipos se crean de cero. La
trampa del README existe, pero no es ésta.

Y por qué los turnos del robot **no** reusan `produccion_turno`: ese tiene dos
valores, `4_12` y `12_20`, que caen en las mismas horas de reloj midiendo
producto terminado. Son cosas que no se suman, así que no comparten tipo aunque
el horario coincida — y los turnos `20_00` y `00_04` sólo existen acá.

Los `create type` van **pelados**, sin envolverlos en un `do ... exception when
duplicate_object`. Ese envoltorio se traga el duplicado sin comparar los
valores, así que un tipo que ya exista con otros valores pasa en silencio y
deja el esquema mal sin que nada avise. Un error ruidoso de tipo duplicado es
mejor que eso, y la regla de la casa es que una migración aplicada no se vuelve
a correr.

- [ ] **Paso 3: Commit, avisar al usuario y esperar a que la aplique**

```bash
git add supabase/migrations/<timestamp>_produccion_molinos_enums.sql
git commit -m "feat(produccion): los enums de los turnos del robot, solos"
```

---

### Tarea 2: El esquema

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_produccion_molinos_schema.sql`

**Interfaces:**
- Consume: los enums de la Tarea 1, **ya aplicados**.
- Produce: `produccion_molinos`, `produccion_molino_turnos`,
  `produccion_molino_paradas`.

- [ ] **Paso 1: Escribir las tres tablas**

`produccion_molinos` — catálogo: `id uuid`, `clave text unique` (`filler_1`,
`filler_2`), `nombre text` (`Filler 1`, `Filler 2 (Calera)`), `formato text`
(`filler_1` | `filler_2`), `prefijo_archivo text` (`Filler 1`, `Filler 2`),
`umbral_minutos int not null default 5`, `desde date` (la puesta en servicio,
desde la que corre la cola), `activo boolean default true`.

`produccion_molino_turnos` — `id uuid`, `molino_id`, `fecha date`,
`turno produccion_molino_turno`, `kg numeric`, `minutos_marcha numeric`,
`minutos_teoricos numeric`, `estado produccion_molino_estado`,
`por_material jsonb` (`{"membranero": kg, ...}`), con
`unique (molino_id, fecha, turno)`.

`produccion_molino_paradas` — `id uuid`, `molino_id`, `fecha date`,
`turno produccion_molino_turno **null**` (null = el día entero, "planta
parada"), `motivo text`, `orden_trabajo_id uuid references ordenes_trabajo(id)
on delete set null`, `creado_por uuid`, `creado_en timestamptz default now()`,
con `unique (molino_id, fecha, turno)`.

- [ ] **Paso 2: Permisos y RLS**

Lectura con `tiene_acceso_produccion()`, escritura con
`puede_editar_produccion()`, **las dos envueltas**:
`using ((select tiene_acceso_produccion()))`. El encabezado dice por qué: sin
el subselect Postgres evalúa el `USING` una vez por fila y esa tabla crece
1.460 filas por molino por año.

- [ ] **Paso 3: Sembrar el catálogo**

Dos filas, `filler_1` y `filler_2`, con `umbral_minutos = 5` y `desde` en la
fecha en que esto entre en servicio. Una tercera fila para `FILLER3` **no** se
crea: aparece en los horímetros del robot y nadie sabe si produce.

- [ ] **Paso 4: Commit, avisar al usuario y esperar a que la aplique**

- [ ] **Paso 5: Comprobar contra la base real que las tres tablas existen y que
      un usuario sin acceso a Producción no las ve**

---

### Tarea 3: Del CSV a filas crudas

**Archivos:**
- Crear: `lib/produccion/molinos/types.ts`, `lib/produccion/molinos/csv.ts`
- Test: `lib/produccion/molinos/csv.test.ts`

**Interfaces:**
- Produce:
  - `type CorteDeTurno = "3:59" | "11:59" | "19:59" | "23:59"`
  - `type TurnoDeMolino = "20_00" | "00_04" | "04_12" | "12_20"`
  - `type EstadoDeTurno = "normal" | "acumulado" | "inconsistente" | "huerfano"`
  - `interface FilaCruda { fecha: string /* "YYYY-MM-DD" */; corte: CorteDeTurno; kg: number; minutos: number; porMaterial: Record<string, number> }`
  - `leerFiller1(dat1: string, desglose: Partial<Record<CorteDeTurno, string>>): { filas: FilaCruda[]; avisos: string[] }`
  - `leerFiller2(porCorte: Partial<Record<CorteDeTurno, string>>): { filas: FilaCruda[]; avisos: string[] }`

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
describe("leerFiller1", () => {
  it("arma una fila por renglon y le pone el turno segun la hora de cierre", () => {
    const dat1 = "26/2/2026;19:59;0;0;0;51530;451;min;MEMBRANERO;AUTOMATICO";
    const { filas } = leerFiller1(dat1, {});
    expect(filas).toEqual([{
      fecha: "2026-02-26", corte: "19:59", kg: 51530, minutos: 451, porMaterial: {},
    }]);
  });

  it("toma el reparto por material del archivo del corte, no de la etiqueta", () => {
    // 1/3/2026 3:59 son 17.682 de membranero + 15.961 de dolomita, y DAT1 dice DOLOMITA
    const dat1 = "1/3/2026;3:59;0;33643;0;0;232;min;DOLOMITA;AUTOMATICO";
    const dat3 = "1/3/2026;3:59;17682;15961;0";
    const { filas } = leerFiller1(dat1, { "3:59": dat3 });
    expect(filas[0].porMaterial).toEqual({ membranero: 17682, dolomita: 15961, caliza: 0 });
    expect(filas[0].kg).toBe(33643);
  });

  it("ignora las lineas en blanco", () => {
    const { filas } = leerFiller1("\n\n26/2/2026;19:59;0;0;0;51530;451;min;MEMBRANERO;X\n\n", {});
    expect(filas).toHaveLength(1);
  });

  it("avisa de una hora que no es uno de los cuatro cortes, y no la incluye", () => {
    const { filas, avisos } = leerFiller1("26/2/2026;7:30;0;0;0;100;60;min;CALIZA;X", {});
    expect(filas).toHaveLength(0);
    expect(avisos[0]).toContain("7:30");
  });
});

describe("leerFiller2", () => {
  it("suma los seis pares kg y minutos", () => {
    const { filas } = leerFiller2({ "19:59": "12/2/2026;19:59;23285;290;0;0;0;0;0;0;0;0;0;0" });
    expect(filas[0]).toMatchObject({ fecha: "2026-02-12", corte: "19:59", kg: 23285, minutos: 290 });
  });

  it("guarda el reparto por los seis materiales", () => {
    const { filas } = leerFiller2({ "3:59": "13/2/2026;3:59;0;0;1000;20;0;0;0;0;0;0;500;10" });
    expect(filas[0].porMaterial).toMatchObject({ piedra_dolomita: 1000, arena_caliza: 500 });
  });
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

Comando: `npx vitest run lib/produccion/molinos/csv.test.ts`
Esperado: FAIL, el módulo no existe.

- [ ] **Paso 3: Escribir `types.ts` y `csv.ts`**

La fecha viene `d/m/yyyy` y sale `"YYYY-MM-DD"`; el `kg` de Filler 1 es la
suma de los cuatro campos de kilos, de los que sólo uno trae valor. El orden
de los tres materiales de `DAT00000003..06` es **membranero, dolomita,
caliza** (verificado: 18/10 a las 3:59 son `51511;0;0` y la etiqueta dice
MEMBRANERO; 19/10 son `0;0;46753` y dice CALIZA).

- [ ] **Paso 4: Correr y verificar que pasan**

- [ ] **Paso 5: Commit**

---

### Tarea 4: Las reglas del turno

El corazón del módulo. Las tres patologías del spec viven acá.

**Archivos:**
- Crear: `lib/produccion/molinos/turnos.ts`
- Test: `lib/produccion/molinos/turnos.test.ts`

**Interfaces:**
- Consume: `FilaCruda`, `CorteDeTurno`, `TurnoDeMolino`, `EstadoDeTurno` de la Tarea 3.
- Produce:
  - `const DURACION: Record<CorteDeTurno, number>` — 240/480/480/240
  - `turnoDelCorte(corte: CorteDeTurno): TurnoDeMolino`
  - `interface TurnoDeRobot { fecha: string; turno: TurnoDeMolino; kg: number; minutosMarcha: number; minutosTeoricos: number; estado: EstadoDeTurno; porMaterial: Record<string, number> }`
  - `armarTurnos(filas: FilaCruda[], toleranciaMin?: number): { turnos: TurnoDeRobot[]; diasNoOperativos: string[] }`

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
it("el turno lo decide la hora de cierre", () => {
  expect(turnoDelCorte("23:59")).toBe("20_00");
  expect(turnoDelCorte("3:59")).toBe("00_04");
  expect(turnoDelCorte("11:59")).toBe("04_12");
  expect(turnoDelCorte("19:59")).toBe("12_20");
});

it("un dia sin ninguna fila no cuenta: ni numerador ni denominador", () => {
  // 2026-10-12, feriado: Filler 1 no tiene ninguna fila
  const { turnos, diasNoOperativos } = armarTurnos(filasDel11Y13);
  expect(diasNoOperativos).toContain("2026-10-12");
  expect(turnos.some((t) => t.fecha === "2026-10-12")).toBe(false);
});

it("un turno en cero dentro de un dia con filas es una parada normal", () => {
  // Filler 2 el 2026-10-12: cuatro filas en cero. NO es no_opero.
  const { turnos, diasNoOperativos } = armarTurnos(cuatroCerosDelMismoDia);
  expect(diasNoOperativos).toHaveLength(0);
  expect(turnos).toHaveLength(4);
  expect(turnos[0]).toMatchObject({ estado: "normal", minutosMarcha: 0, minutosTeoricos: 240 });
});

it("una fila que excede su duracion se cubre con la racha de turnos faltantes", () => {
  // 2026-03-09 11:59, 631 minutos en un bloque de 480, con cinco turnos faltantes antes
  const { turnos } = armarTurnos(filasConRachaDelNueveDeMarzo);
  const t = turnos.find((x) => x.fecha === "2026-03-09" && x.turno === "04_12")!;
  expect(t.estado).toBe("acumulado");
  expect(t.minutosTeoricos).toBe(2160);
  expect(t.minutosMarcha).toBe(631);
});

it("un exceso dentro de la tolerancia es un turno normal", () => {
  // Filler 2, 2026-06-04 11:59: 486 minutos en 480
  const { turnos } = armarTurnos([fila(486, "11:59")]);
  expect(turnos[0].estado).toBe("normal");
  expect(turnos[0].minutosTeoricos).toBe(486);
});

it("un exceso sin racha que lo explique queda inconsistente y conserva sus kilos", () => {
  // Filler 1, 2026-06-04 11:59: 498 minutos en 480, sin turnos faltantes antes
  const { turnos } = armarTurnos([filaDelDiaAnteriorCompleto, fila(498, "11:59", 90000)]);
  const t = turnos.at(-1)!;
  expect(t.estado).toBe("inconsistente");
  expect(t.kg).toBe(90000);
});

it("un turno que falta sin racha que lo absorba es huerfano, no una parada", () => {
  // el dia en curso siempre llega con un solo turno: el zip se corta a las 09:00
  const { turnos } = armarTurnos([fila(239, "3:59")]);
  const huerfanos = turnos.filter((t) => t.estado === "huerfano");
  expect(huerfanos.map((t) => t.turno)).toEqual(["04_12", "12_20", "20_00"]);
  expect(huerfanos.every((t) => t.minutosMarcha === 0 && t.minutosTeoricos === 0)).toBe(true);
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

- [ ] **Paso 3: Implementar `armarTurnos`**

El orden de las reglas importa y es el del spec: primero los días sin ninguna
fila salen de la secuencia; después, por cada fila presente, si
`minutosMarcha > minutosTeoricos + tolerancia` se mira hacia atrás hasta la
última fila presente y se suman las duraciones de los turnos faltantes; si eso
alcanza, `acumulado`; si no, `inconsistente`. Los turnos faltantes que ninguna
racha absorbió quedan `huerfano` con marcha y teórica en cero.

Un turno `inconsistente` conserva `kg` y pierde las horas: el consumidor
—Tarea 5— es quien no las suma.

- [ ] **Paso 4: Correr y verificar que pasan**

- [ ] **Paso 5: Commit**

---

### Tarea 5: Los cinco indicadores

**Archivos:**
- Crear: `lib/produccion/molinos/indicadores.ts`
- Test: `lib/produccion/molinos/indicadores.test.ts`

**Interfaces:**
- Consume: `TurnoDeRobot` de la Tarea 4.
- Produce:
  - `interface Indicadores { toneladas: number; horasDeMarcha: number; horasNoTrabajadas: number; utilizacion: number | null; productividad: number | null; diasNoOperativos: number }`
  - `indicadoresDe(turnos: TurnoDeRobot[], diasNoOperativos: string[]): Indicadores`

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
it("utilizacion es marcha sobre teorica, productividad es toneladas sobre marcha", () => {
  const i = indicadoresDe([turno({ kg: 48000, marcha: 240, teorica: 480 })], []);
  expect(i.toneladas).toBe(48);
  expect(i.horasDeMarcha).toBe(4);
  expect(i.horasNoTrabajadas).toBe(4);
  expect(i.utilizacion).toBeCloseTo(0.5, 6);
  expect(i.productividad).toBeCloseTo(12, 6);
});

it("un turno inconsistente aporta sus toneladas y no sus horas", () => {
  const i = indicadoresDe([
    turno({ kg: 10000, marcha: 240, teorica: 240, estado: "normal" }),
    turno({ kg: 90000, marcha: 498, teorica: 480, estado: "inconsistente" }),
  ], []);
  expect(i.toneladas).toBe(100);
  expect(i.horasDeMarcha).toBe(4);
  expect(i.utilizacion).toBeCloseTo(1, 6);
});

it("un turno huerfano no aporta nada", () => {
  const i = indicadoresDe([turno({ estado: "huerfano", kg: 0, marcha: 0, teorica: 0 })], []);
  expect(i.utilizacion).toBeNull();
});

it("sin horas teoricas devuelve null y no cero", () => {
  expect(indicadoresDe([], []).utilizacion).toBeNull();
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

- [ ] **Paso 3: Implementar `indicadoresDe`**

Mismo criterio que `lib/trituracion/informeMensual.ts`: una razón sin
denominador devuelve `null` y nunca `0` — un cero se lee como un dato y un
`null` como "no hay con qué calcularlo".

- [ ] **Paso 4: Correr y verificar que pasan**

- [ ] **Paso 5: Commit**

---

### Tarea 6: Leer el zip de Drive e importar

**Archivos:**
- Crear: `lib/produccion/molinos/drive.ts`, `lib/produccion/molinos/importar.ts`
- Test: `lib/produccion/molinos/importar.test.ts`
- Modificar: `docs/VARIABLES-VERCEL.md` (agregar `GOOGLE_DRIVE_PCROBOT_FOLDER_ID`)

**Interfaces:**
- Consume: `leerFiller1`/`leerFiller2` (T3), `armarTurnos` (T4),
  `obtenerToken` y `SCOPE_DRIVE_LECTURA` de `lib/core/google.ts`,
  `traerTodo` de `lib/core/paginado.ts`.
- Produce, en `drive.ts`:
  - `interface ArchivoDeMolino { molinoClave: string; nombre: string; id: string; modificado: string }`
  - `emparejar(archivos: { nombre: string; id?: string; modificado?: string }[], molinos: { clave: string; prefijo_archivo: string }[]): { archivos: ArchivoDeMolino[]; sinMolino: string[] }` — **puro, es el que se testea**
  - `estaObsoleto(modificado: string, ahora: Date): boolean` — **puro**, true a partir de 24 h
  - `listarArchivos(): Promise<{ archivos: ArchivoDeMolino[]; sinMolino: string[] }>` — llama a Drive y delega en `emparejar`
  - `bajarYDescomprimir(id: string): Promise<Record<string, string>>` — nombre de CSV → contenido ya decodificado
- Produce, en `importar.ts`:
  - `interface PlanDeReconciliacion { turnosAInsertar: TurnoDeRobot[]; turnosABorrar: { fecha: string; turno: TurnoDeMolino }[]; paradasABorrar: never[] }`
  - `planDeReconciliacion(delZip: TurnoDeRobot[], enLaBase: TurnoDeRobot[], paradas: unknown[]): PlanDeReconciliacion` — **puro, es el que se testea**; lanza si el zip trae menos días que la base
  - `importarMolino(admin, molino, csvs): Promise<{ turnos: number; obsoleto: boolean }>`

`paradasABorrar` es `never[]` a propósito y no una lista que casualmente queda
vacía: que el tipo no admita elementos es lo que impide que alguien agregue el
borrado de paradas más adelante sin darse cuenta de que está pisando lo único
que carga una persona.

- [ ] **Paso 1: Escribir los tests que fallan** (sobre las funciones puras,
      no sobre Drive)

```ts
it("empareja el archivo con el molino por prefijo, y no adivina", () => {
  const r = emparejar(
    [{ nombre: "Filler 1 2026-10-29.zip" }, { nombre: "Filler 9 2026-10-29.zip" }],
    [{ clave: "filler_1", prefijo_archivo: "Filler 1" }]
  );
  expect(r.archivos.map((a) => a.molinoClave)).toEqual(["filler_1"]);
  expect(r.sinMolino).toEqual(["Filler 9 2026-10-29.zip"]);
});

it("marca obsoleto cuando el archivo mas nuevo tiene mas de un dia", () => {
  expect(estaObsoleto("2026-10-27T12:00:00Z", new Date("2026-10-29T12:00:00Z"))).toBe(true);
  expect(estaObsoleto("2026-10-29T12:00:00Z", new Date("2026-10-29T13:00:00Z"))).toBe(false);
});

it("reconciliar no pisa la parada que cargo una persona", () => {
  const plan = planDeReconciliacion(turnosDelZip, turnosEnLaBase, paradasEnLaBase);
  expect(plan.paradasABorrar).toEqual([]);
});

it("un zip con menos dias de los que la base ya tiene no se aplica", () => {
  expect(() => planDeReconciliacion(dosDias, seiscientosDias, [])).toThrow(/encogi/i);
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

- [ ] **Paso 3: Implementar `drive.ts`**

Listado con `q: "'<carpeta>' in parents and trashed = false"`,
`supportsAllDrives: "true"` e `includeItemsFromAllDrives: "true"` —sin eso
Drive contesta 404 sobre una unidad compartida y no dice por qué—, ordenado por
`modifiedTime desc`, y se toma **el más nuevo por prefijo de molino**. La
descarga es `?alt=media&supportsAllDrives=true`; el zip se abre con `jszip` y
cada CSV se decodifica con `TextDecoder("windows-1252")`.

- [ ] **Paso 4: Implementar `importar.ts`**

Reconcilia: borra los turnos de ese molino que el zip ya no tiene, inserta y
actualiza el resto con `upsert` sobre `(molino_id, fecha, turno)`. **Las
paradas no se tocan nunca.** El freno de encogimiento corta si el zip trae
menos días de los que la base ya tiene.

- [ ] **Paso 5: Correr y verificar que pasan**

- [ ] **Paso 6: La ruta del cron y la del botón**

`app/api/cron/produccion-molinos-sync/route.ts` con `revisarElSecreto()`,
`maxDuration = 300` y `registrarSincronizacion({ modulo: "produccion", recurso:
"molinos", ... })` — también cuando falla, que es lo que evita que una fecha
vieja quede sin explicación. Y la gemela a mano en
`app/api/produccion/molinos/importar/route.ts`, detrás de
`puedeEditarProduccion()`.

- [ ] **Paso 7: Declarar el cron en `vercel.json`**

```json
{ "path": "/api/cron/produccion-molinos-sync", "schedule": "0 13 * * *" }
```

13:00 UTC son las 10 de Argentina: **media hora después de que la tarea
programada sube el zip, que corre 09:30 local**. Antes de eso el archivo del día
todavía no existe. Y queda después del resumen diario de las 11:30 UTC a
propósito — por eso este frente no agrega avisos en la v1.

- [ ] **Paso 8: Correr la importación contra el Drive real y comprobar los
      números de control del spec**

Filler 1: utilización **85,2 %**, productividad **8,49 t/h**, 22 días no
operativos, 14 acumulados, 3 inconsistentes, 44 huérfanos.
Filler 2: **64,2 %**, **6,03 t/h**, 0 días no operativos, 2 acumulados, 0
inconsistentes, 3 huérfanos.
Un resultado lejos de eso es un error de la importación, no una novedad.

- [ ] **Paso 9: Commit**

---

### Tarea 7: Las consultas y las dos pantallas de lectura

**Archivos:**
- Crear: `lib/produccion/molinos/consultas.ts`,
  `app/(app)/produccion/molinos/page.tsx` + `MolinosClient.tsx`,
  `app/(app)/produccion/molinos/mes/page.tsx` + `MesClient.tsx`
- Modificar: la navegación de `/produccion`

**Interfaces:**
- Consume: `indicadoresDe` (T5), `tieneAccesoProduccion` (`lib/produccion/auth.ts`).
- Produce: `diaDeMolino(admin, molinoId, fecha)`, `mesDeMolino(admin, molinoId, mes)`.

- [ ] **Paso 1: Implementar `consultas.ts` con `traerTodo()`**

- [ ] **Paso 2: La pantalla del día**

Los cuatro turnos por molino con toneladas, marcha, parada e indicadores. Los
turnos **acumulado**, **inconsistente** y **huérfano** se señalan por lo que
son, cada uno con su leyenda; no se promedian ni se esconden. Un día no
operativo se muestra como tal y no como cuatro ceros.

- [ ] **Paso 3: La pantalla del mes**

Los cinco indicadores, con los días no operativos contados aparte.

- [ ] **Paso 4: Decir "molino Filler 1", nunca "Filler 1" solo**

En `/calidad/ensayos` esas dos palabras ya son productos, con un cartel en
pantalla avisándolo. Es la única defensa que hay contra el choque de nombres.

- [ ] **Paso 5: `node scripts/revisar-responsive.mjs` y `npx tsc --noEmit`**

- [ ] **Paso 6: Commit**

---

### Tarea 8: El motivo de la parada

**Archivos:**
- Crear: `app/api/produccion/molinos/paradas/route.ts`,
  `app/(app)/produccion/molinos/sin-explicar/page.tsx` + `ColaClient.tsx`
- Test: `lib/produccion/molinos/cola.test.ts`
- Modificar: `lib/produccion/molinos/consultas.ts`

**Interfaces:**
- Consume: el catálogo (`umbral_minutos`, `desde`), `tieneAccesoMantenimiento`.
- Produce: `turnosSinExplicar(turnos, paradas, umbralMin, desde): TurnoDeRobot[]`

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
it("pide motivo recien a partir del umbral", () => {
  const r = turnosSinExplicar([turno({ marcha: 239, teorica: 240 })], [], 5, "2026-01-01");
  expect(r).toHaveLength(0);
});

it("no pide motivo antes de la puesta en servicio", () => {
  const r = turnosSinExplicar([turno({ fecha: "2026-03-01", marcha: 0, teorica: 480 })], [], 5, "2026-10-29");
  expect(r).toHaveLength(0);
});

it("una parada marcada a nivel dia tapa los cuatro turnos", () => {
  const r = turnosSinExplicar(losCuatroDelDia, [{ fecha: "2026-10-12", turno: null }], 5, "2026-01-01");
  expect(r).toHaveLength(0);
});

it("un turno huerfano no entra en la cola", () => {
  const r = turnosSinExplicar([turno({ estado: "huerfano" })], [], 5, "2026-01-01");
  expect(r).toHaveLength(0);
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

- [ ] **Paso 3: Implementar `turnosSinExplicar` y la ruta**

La ruta valida con `validar()` de `lib/core/validar.ts` y exige
`puedeEditarProduccion()`.

- [ ] **Paso 4: La pantalla de la cola**

La lista de turnos con parada sobre el umbral y sin explicar, con el campo de
motivo, el `<Select>` de OT y el botón de "planta parada" a nivel día.

- [ ] **Paso 5: El acceso a Mantenimiento, dicho y no supuesto**

Si quien carga **no** tiene acceso a Mantenimiento, el desplegable de OT dice
*"No tenés acceso a Mantenimiento"* y **no una lista vacía**, que se lee como
"no hay OT" — es la misma trampa que el valor hora en `rrhh_empleados_datos`.
Y una parada que ya tiene OT enlazada muestra **el número** aunque quien mire
no pueda abrir el detalle.

- [ ] **Paso 6: Comprobarlo a mano con un usuario sin acceso a Mantenimiento**

Es el único de los cinco puntos del foco de revisión que no se cierra con un
test, porque acá las pantallas no tienen tests. Abrir la cola con un usuario
que tenga Producción y **no** Mantenimiento, y ver el mensaje en vez de la
lista vacía.

- [ ] **Paso 7: Correr los tests, `npx tsc --noEmit`, `npm run build`**

- [ ] **Paso 8: Commit**

---

### Tarea 9: Cerrar

- [ ] **Paso 1: `npm test`, `npx tsc --noEmit`, `npm run build`,
      `node scripts/revisar-arbol-commiteado.mjs`,
      `node scripts/revisar-responsive.mjs`**

- [ ] **Paso 2: Escribir la sección en `docs/PRODUCCION.md`**

Qué mide este frente y por qué **no se suma** con el parte de fábrica; las
cuatro patologías del dato y cómo se resuelven; los números de control.

- [ ] **Paso 3: Agregar la fila a la tabla de CLAUDE.md**

Con las dos o tres cosas que no se deducen del código: que "turno" acá significa
los cuatro cortes del robot y no los dos del parte; que un día sin filas es
planta cerrada pero un turno en cero no; y que la etiqueta de material de
`DAT00000001` está 11 % mal y por eso no se guarda.

- [ ] **Paso 4: Cargar `GOOGLE_DRIVE_PCROBOT_FOLDER_ID` en Vercel**
      (`0AH83x2YPTJdbUk9PVA`), en los tres entornos — **lo hace el usuario**.

- [ ] **Paso 5: Commit y push**

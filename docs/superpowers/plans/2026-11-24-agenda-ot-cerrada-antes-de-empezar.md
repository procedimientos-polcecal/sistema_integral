# La OT cerrada antes de empezar (Agenda) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el evento de una OT cerrada antes de su fecha de inicio pase al día del cierre, en la fila y en los cinco calendarios de Google.

**Architecture:** Una función pura nueva en `lib/agenda/evento.ts` dice qué día manda en el evento de una OT; `planDelEvento` abre con ella una excepción en su corte de «cerrada no se toca», y `seguirALasOT` arma con la **misma** función el día contra el que cuenta el apilado. Ningún mecanismo nuevo: mover, apilar, respetar lo divergido y encolar lo que Google rechace ya existen.

**Tech Stack:** TypeScript · Next.js 16 · Supabase · Vitest.

**Spec:** [docs/superpowers/specs/2026-11-24-agenda-ot-cerrada-antes-de-empezar-design.md](../specs/2026-11-24-agenda-ot-cerrada-antes-de-empezar-design.md)

## Global Constraints

- Todo en castellano: nombres, comentarios, mensajes de pantalla y de commit.
- Las fechas `AAAA-MM-DD` se comparan **como texto**, nunca parseadas a `Date`. La única aritmética permitida es el conteo de días de la brecha, y va con `Date.parse(\`${iso}T00:00:00Z\`)` — con la `Z`, para que ninguna zona entre en un día que es de Argentina. El patrón ya existe en el `diasEntre` privado de `lib/agenda/vista.ts:386`.
- **Sin migración**: no se agrega ni se toca ninguna columna.
- El corte del cierre no creíble es **365 días**.
- No se le crea evento a una OT cerrada que no lo tiene: `esCandidataAlCalendario` no se toca.
- `problemasDeMandarLaOT` no se toca: mandar una OT a mano sigue negándose sobre una orden cerrada.
- Un evento que divergió en Google no se pisa.
- `npm test` para correr la suite; `npm run tipos` para los tipos (lleva el heap que hace falta).

## Review Focus

- **El apilado sobre un día del pasado puede topear a las 20:00.** `horarioApilado` no mira si el día pasó; con suficientes eventos de la misma especialidad y turno en el día del cierre, el evento llega topeado y se escribe `AVISO_DE_TOPE`. Lo esperable es que se mueva igual y quede dicho, no que se caiga. → test en la Task 2.
- **Dos OT cerradas el mismo día, de la misma especialidad y el mismo turno, no se pisan.** El `cupos`/`tomarElCupo` de `seguirALasOT` ya reparte huecos, pero nunca se lo ejercitó con el día del cierre como destino. → test en la Task 2.
- **Un `fecha_cierre` que no es un día** (`"2026-11-18 00:00:00"`, `" "`, `"18/11/2026"`). La columna es `date` y Postgres normaliza, pero la función es pura y recibe lo que le den: lo esperable es que no sea el caso y el evento no se toque, nunca un evento en una fecha ilegible. → test en la Task 1.
- **`fecha_ejecucion_pendiente` adelante con el cierre en el medio** (cierre 18, pendiente 24, ejecución 20): la brecha se mide contra la fecha que manda —la pendiente—, no contra `fecha_ejecucion`. → test en la Task 1.
- **Una OT cerrada antes de empezar cuyo evento no tiene turno del taller**: lo esperable es el `avisar` que ya da `queHacerConElEvento`, no un movimiento a una hora inventada. → test en la Task 2.

---

## Estructura de archivos

- `lib/agenda/evento.ts` — **Modificar**: la decisión pura de qué día manda. Es donde ya viven `fechaParaElCalendario`, `laOTEstaCerrada` y el `esFechaDelDia` privado que la nueva función necesita.
- `lib/agenda/elEventoSigueALaOT.ts` — **Modificar**: `planDelEvento` (la excepción) y `seguirALasOT` (el destino del apilado), más los tres puntos donde hoy se llama a `fechaParaElCalendario`.
- `docs/AGENDA.md` y `CLAUDE.md` — **Modificar**: dónde se cuenta.
- `scripts/que-eventos-se-moverian.mts` — **Crear**: qué haría la próxima corrida contra los datos reales, sin escribir nada.

---

### Task 1: La fecha que manda en el evento de una OT

**Files:**
- Modify: `lib/agenda/evento.ts` (al lado de `fechaParaElCalendario`, línea 142, y de `laOTEstaCerrada`, línea 178)
- Test: `lib/agenda/evento.test.ts`

**Interfaces:**
- Consumes: `fechaParaElCalendario`, `laOTEstaCerrada` y el `esFechaDelDia` privado, todos de este mismo archivo.
- Produces:
  ```ts
  export type CierreAdelantado =
    | { tipo: "manda-el-cierre"; fecha: string }
    | { tipo: "no-creible"; cierre: string; inicio: string; dias: number }
    | null;

  export const DIAS_DE_CIERRE_CREIBLE = 365;

  export function elCierreQueAdelanta(o: {
    fecha_ejecucion: string | null;
    fecha_ejecucion_pendiente?: string | null;
    fecha_cierre?: string | null;
    estado?: string | null;
  }): CierreAdelantado;

  export function laFechaQueMandaEnElEvento(o: {
    fecha_ejecucion: string | null;
    fecha_ejecucion_pendiente?: string | null;
    fecha_cierre?: string | null;
    estado?: string | null;
  }): string | null;
  ```

- [ ] **Step 1: Escribir los tests que fallan**, en un `describe("el cierre que adelanta al inicio", ...)` nuevo de `lib/agenda/evento.test.ts`:

```ts
const cerradaEl = (cierre: string | null, inicio: string | null, extra = {}) =>
  ({ fecha_ejecucion: inicio, fecha_ejecucion_pendiente: null, fecha_cierre: cierre, estado: "REALIZADO", ...extra });

it("un cierre anterior al inicio manda, y la fecha es la del cierre", () => {
  expect(elCierreQueAdelanta(cerradaEl("2026-11-18", "2026-11-24")))
    .toEqual({ tipo: "manda-el-cierre", fecha: "2026-11-18" });
});

it("un cierre en el mismo dia o despues no es el caso", () => {
  expect(elCierreQueAdelanta(cerradaEl("2026-11-24", "2026-11-24"))).toBeNull();
  expect(elCierreQueAdelanta(cerradaEl("2026-11-25", "2026-11-24"))).toBeNull();
});

it("una OT abierta no es el caso, ni una cerrada sin fecha de cierre", () => {
  expect(elCierreQueAdelanta({ fecha_ejecucion: "2026-11-24", fecha_cierre: null, estado: "POR_HACER" })).toBeNull();
  expect(elCierreQueAdelanta({ fecha_ejecucion: "2026-11-24", fecha_cierre: null, estado: "REALIZADO" })).toBeNull();
  expect(elCierreQueAdelanta({ fecha_ejecucion: "2026-11-24", fecha_cierre: null, estado: "CANCELADA" })).toBeNull();
});

it("sin fecha de inicio no hay contra que comparar", () => {
  expect(elCierreQueAdelanta(cerradaEl("2026-11-18", null))).toBeNull();
});

/* La OT 953: cerrada en «2016-01-28» contra un inicio del 2026-01-27. Es un
 * 2016 por un 2026 —seria un dia de brecha bien escrito—, y es la unica de las
 * 73 que pasa el ano. */
it("mas de un ano de brecha no se cree: la OT 953 y su 2016 por 2026", () => {
  expect(elCierreQueAdelanta(cerradaEl("2016-01-28", "2026-01-27")))
    .toEqual({ tipo: "no-creible", cierre: "2016-01-28", inicio: "2026-01-27", dias: 3652 });
});

it("los 89 dias de la OT 1671 si se creen: el corte es el ano y no el mes", () => {
  expect(elCierreQueAdelanta(cerradaEl("2026-02-03", "2026-05-03")).tipo).toBe("manda-el-cierre");
});

/* Review Focus: la columna es `date` y Postgres normaliza, pero la funcion es
 * pura y recibe lo que le den. Una fecha que no es un dia no puede terminar en
 * el inicio de un evento. */
it("un cierre que no es un dia no es el caso", () => {
  for (const malo of ["2026-11-18 00:00:00", "18/11/2026", "  ", "2026-13-01"]) {
    expect(elCierreQueAdelanta(cerradaEl(malo, "2026-11-24"))).toBeNull();
  }
});

/* Review Focus: la que manda es la pendiente, que es la que el SdG fijo y la
 * planilla todavia no devolvio. Medir contra `fecha_ejecucion` daria 2 dias de
 * brecha donde hay 6. */
it("la brecha se mide contra la fecha que manda, o sea la pendiente", () => {
  expect(elCierreQueAdelanta({
    fecha_ejecucion: "2026-11-20", fecha_ejecucion_pendiente: "2026-11-24",
    fecha_cierre: "2026-11-18", estado: "REALIZADO",
  })).toEqual({ tipo: "manda-el-cierre", fecha: "2026-11-18" });
});

it("laFechaQueMandaEnElEvento devuelve la del cierre solo cuando el cierre manda", () => {
  expect(laFechaQueMandaEnElEvento(cerradaEl("2026-11-18", "2026-11-24"))).toBe("2026-11-18");
  expect(laFechaQueMandaEnElEvento(cerradaEl("2026-11-25", "2026-11-24"))).toBe("2026-11-24");
  expect(laFechaQueMandaEnElEvento(cerradaEl("2016-01-28", "2026-01-27"))).toBe("2026-01-27");
  expect(laFechaQueMandaEnElEvento({ fecha_ejecucion: null, fecha_cierre: "2026-11-18" })).toBeNull();
});
```

- [ ] **Step 2: Correr los tests para ver que fallan**

Run: `npx vitest run lib/agenda/evento.test.ts`
Expected: FAIL — `elCierreQueAdelanta is not a function` (o el error de import equivalente).

- [ ] **Step 3: Implementar `elCierreQueAdelanta`, `laFechaQueMandaEnElEvento` y `DIAS_DE_CIERRE_CREIBLE` en `lib/agenda/evento.ts`**

Las firmas están en Interfaces. El cuerpo sale de los tests; lo único que no sale de ahí es el conteo de días, que va con `Date.parse(\`${iso}T00:00:00Z\`)` (ver Global Constraints).

El docstring tiene que dejar escrito lo que no se deduce del código, que es el porqué de que esta función exista:

- **Por qué hay tres respuestas y no dos**: el año mal tipeado no es ni «mover» ni «no es el caso», y sin el tercero se mueve un evento diez años atrás, a cinco calendarios donde nadie lo encuentra.
- **De dónde sale el 365**, con la medición: de las 73 OT cerradas antes de empezar, 63 tienen 7 días o menos, 9 van de 14 a 89 —cierres adelantados de verdad, uno es un CORRECTIVO cerrado 69 días antes de un inicio que la planilla seguía anunciando— y una sola pasa el año, la OT 953.
- **Que la brecha se mide contra la fecha que manda y no contra `fecha_ejecucion`.**
- **Que `laFechaQueMandaEnElEvento` es la única definición de qué día es un evento de OT**, y que si alguien la usa en un lado y `fechaParaElCalendario` en otro, el evento se pinta en un día y el apilado se cuenta contra otro.

- [ ] **Step 4: Correr los tests para ver que pasan**

Run: `npx vitest run lib/agenda/evento.test.ts`
Expected: PASS, con los tests de `fechaParaElCalendario`, `laOTEstaCerrada` y «una OT cerrada no se manda» en verde.

- [ ] **Step 5: Commit**

```bash
git add lib/agenda/evento.ts lib/agenda/evento.test.ts
git commit -m "feat(agenda): que dia manda en el evento de una OT cerrada antes de empezar"
```

---

### Task 2: La sincronización mueve el evento al día del cierre

**Files:**
- Modify: `lib/agenda/elEventoSigueALaOT.ts` — `planDelEvento` (línea 216 y siguientes), `seguirALasOT` (línea 590), el `separados` (línea 247) y el import (línea 4)
- Test: `lib/agenda/elEventoSigueALaOT.test.ts`

**Interfaces:**
- Consumes: `elCierreQueAdelanta` y `laFechaQueMandaEnElEvento` de la Task 1.
- Produces: nada nuevo hacia afuera. `planDelEvento`, `queHacerConElEvento` y `seguirALasOT` conservan sus firmas.

- [ ] **Step 1: Arreglar el test que fija el comportamiento viejo**

`lib/agenda/elEventoSigueALaOT.test.ts:106` dice hoy «una OT cerrada no se toca, cambie o no su fecha, o esté vacía» y usa `fecha_cierre: "2026-11-04"` con `fecha_ejecucion: "2026-11-10"` — que es **exactamente** el caso que esta tarea cambia. Partirlo en dos: la mitad de `fecha_ejecucion: null` sigue siendo `nada` (sin inicio no hay contra qué comparar), y se le agrega el caso de un cierre **posterior** al inicio, que es el que de verdad no se toca:

```ts
it("una OT cerrada despues de su inicio no se toca, y sin fecha tampoco", () => {
  expect(planDelEvento(fila({}, { fecha_cierre: "2026-11-12", fecha_ejecucion: "2026-11-10" })))
    .toEqual({ tipo: "nada", mover: null, aviso: undefined, volverAAlertar: false });
  expect(planDelEvento(fila({}, { fecha_cierre: "2026-11-04", fecha_ejecucion: null })))
    .toEqual({ tipo: "nada", mover: null, aviso: undefined, volverAAlertar: false });
});
```

- [ ] **Step 2: Escribir los tests que fallan**, en un `describe("una OT cerrada antes de empezar", ...)` nuevo del mismo archivo. `evento()` pone el evento el `2026-11-10` con turno `8-16`; `orden()` pone `fecha_ejecucion: "2026-11-10"`:

```ts
it("el evento se mueve al dia del cierre", () => {
  const p = planDelEvento(fila({}, { fecha_cierre: "2026-11-04" }));
  expect(p.tipo).toBe("mover");
  expect(p.mover!.inicio).toContain("2026-11-04");
});

/* Idempotencia: la sincronizacion corre cada diez minutos. Con el evento ya en
 * el dia del cierre no se escribe nada, ni siquiera un update de aviso. */
it("una vez movido no se vuelve a mover", () => {
  // 08:00 de Argentina del 04/11, en el mismo formato que la constante INICIO.
  expect(planDelEvento(fila({ inicio: "2026-11-04T11:00:00+00:00" }, { fecha_cierre: "2026-11-04" })))
    .toEqual({ tipo: "nada", mover: null, aviso: undefined, volverAAlertar: false });
});

it("un cierre de mas de un ano no mueve: avisa nombrando las dos fechas", () => {
  const p = planDelEvento(fila({}, { fecha_cierre: "2016-11-04" }));
  expect(p.tipo).toBe("avisar");
  expect(p.aviso).toContain("2016-11-04");
  expect(p.aviso).toContain("2026-11-10");
});

it("el aviso del cierre no creible no se reescribe en cada corrida", () => {
  const primero = planDelEvento(fila({}, { fecha_cierre: "2016-11-04" }));
  expect(planDelEvento(fila({ aviso: primero.aviso }, { fecha_cierre: "2016-11-04" })))
    .toEqual({ tipo: "nada", mover: null, aviso: undefined, volverAAlertar: false });
});

it("un evento divergido no se pisa, tambien cuando la OT cerro antes", () => {
  const p = planDelEvento(fila({ divergencia: "movido" }, { fecha_cierre: "2026-11-04" }));
  expect(p.tipo).toBe("respetar");
  expect(p.mover).toBeNull();
});

/* Review Focus: sin turno del taller no se sabe a que hora ponerlo. */
it("sin turno del taller se avisa en vez de inventar una hora", () => {
  expect(planDelEvento(fila({ turno: null }, { fecha_cierre: "2026-11-04" })).tipo).toBe("avisar");
});

/* Review Focus: el apilado corre sobre el dia del cierre, pase o no pase. */
it("el apilado cuenta sobre el dia del cierre y puede topear a las 20:00", () => {
  const p = planDelEvento(fila({}, { fecha_cierre: "2026-11-04" }), 20);
  expect(p.tipo).toBe("mover");
  expect(p.mover!.inicio).toContain("2026-11-04");
  expect(p.aviso).toBe(AVISO_DE_TOPE);
});
```

Y uno de `seguirALasOT` con la base en memoria, que es el que prueba la otra punta —la línea que sostiene la decisión entera—. El helper `EVENTO_EN` de ese archivo arma la fila con `fecha_cierre: null` fijo: hay que darle un parámetro opcional `cierre` que vaya a esa columna, con `null` por omisión, y nada más. Va dentro del `describe("al mover un evento de OT a otra fecha", ...)`, que es el que ya mockea `actualizarEvento`:

```ts
/* Review Focus: dos OT cerradas el mismo dia, misma especialidad y mismo
 * turno. Si el destino del apilado se calculara sobre la fecha de inicio, las
 * dos caerian a la misma hora en el dia del cierre, sin error y sin aviso. */
it("dos OT cerradas el mismo dia se apilan en ese dia y no se pisan", async () => {
  const base = baseEnMemoria([
    EVENTO_EN({ n: 1, dia: "2026-11-03", hora: "08:00", destino: "2026-11-10", cierre: "2026-11-04" }),
    EVENTO_EN({ n: 2, dia: "2026-11-03", hora: "08:00", destino: "2026-11-11", cierre: "2026-11-04" }),
  ]);
  await seguirALasOT(base.cliente);
  const uno = horarioDe(base.hechos, 1)!;
  const dos = horarioDe(base.hechos, 2)!;
  expect(uno).toContain("2026-11-04");
  expect(dos).toContain("2026-11-04");
  expect(uno).not.toBe(dos);
});
```

El armado de `base` sigue el de los tests que ya hay en ese `describe` (ahí están los nombres exactos del helper de la base en memoria y de `hechos`).

- [ ] **Step 3: Correr los tests para ver que fallan**

Run: `npx vitest run lib/agenda/elEventoSigueALaOT.test.ts`
Expected: FAIL — los nuevos dan `nada` donde esperan `mover`/`avisar`.

- [ ] **Step 4: Abrir la excepción en `planDelEvento`**

Hoy su primera línea es `if (laOTEstaCerrada(fila.orden)) return NADA;`. Pasa a consultar `elCierreQueAdelanta(fila.orden)` cuando la orden está cerrada: `null` devuelve `NADA` igual que hoy; `no-creible` devuelve un `avisar` cuyo motivo nombra **las dos fechas y la brecha en días**, y sigue por el `if (fila.aviso === decision.motivo) return NADA` que esa función ya tiene; `manda-el-cierre` sigue por el camino normal.

El texto del aviso lo escribe quien implementa (ver «Lo que queda a quien lo implemente» del spec): tiene que nombrar las dos fechas y la brecha, porque es lo único que permite ver que es un año mal tipeado sin abrir la OT.

- [ ] **Step 5: Cambiar las tres llamadas a `fechaParaElCalendario` por `laFechaQueMandaEnElEvento`**

Son `elEventoSigueALaOT.ts:229` (lo que se le pasa a `queHacerConElEvento`), `:247` (el `separados` de la divergencia) y `:590` (el `fechaNueva` del que sale el `destino` del apilado en `seguirALasOT`). Actualizar también el import de la línea 4 y el comentario de la línea 97, que nombra `fechaParaElCalendario`.

**La de la 590 es la que sostiene la decisión entera**: si queda apuntando a `fechaParaElCalendario`, el evento se mueve al día del cierre y el hueco se cuenta en el día del inicio, dejándolo encima de otro de su especialidad, sin error y sin aviso.

- [ ] **Step 6: Correr los tests para ver que pasan**

Run: `npx vitest run lib/agenda/elEventoSigueALaOT.test.ts lib/agenda/evento.test.ts`
Expected: PASS, incluidos los tres tests viejos de OT cerrada —el de cerrada después del inicio, el de la `REALIZADO` sin `fecha_cierre` y el de la `CANCELADA`—, que son los que no pueden ponerse en rojo.

- [ ] **Step 7: Correr la suite entera**

Run: `npm test`
Expected: PASS. Si algo rojo no es de la Agenda, mirar `git status` antes de tocarlo: puede ser el refactor de otra sesión en el mismo árbol.

- [ ] **Step 8: Commit**

```bash
git add lib/agenda/elEventoSigueALaOT.ts lib/agenda/elEventoSigueALaOT.test.ts
git commit -m "feat(agenda): la OT cerrada antes de empezar mueve su evento al dia del cierre"
```

---

### Task 3: Dónde se cuenta, y la verificación

**Files:**
- Modify: `docs/AGENDA.md` (subsección nueva), `CLAUDE.md` (el renglón de Agenda de la tabla de módulos)
- Create: `scripts/que-eventos-se-moverian.mts`

**Interfaces:**
- Consumes: lo construido en las Tasks 1 y 2.
- Produces: nada de código.

- [ ] **Step 1: Escribir la subsección `## La OT que se cerró antes de empezar` en `docs/AGENDA.md`**

Con lo medido el 24/11/2026 —73 de 2.270 OT con las dos fechas, 7 de los 78 eventos con `ot_id` cayendo después del cierre, seis de los siete del ciclo de martillos— y las tres cosas que no se deducen del código: que **la excepción es sólo para el cierre anterior al inicio** y que una cerrada normal sigue sin tocarse (168 de 986 `REALIZADO` no tienen `fecha_cierre`); que **el día lo decide `laFechaQueMandaEnElEvento` y las dos puntas de la sincronización la usan**, porque pintar en un día y contar el apilado contra otro no da error ni aviso; y que **el corte de 365 días separa un año mal tipeado de un cierre adelantado de verdad**, con la OT 953 como el único caso.

- [ ] **Step 2: Agregar al renglón de Agenda de `CLAUDE.md`** la referencia a este spec y a este plan, y en una frase lo que no se deduce del código.

- [ ] **Step 3: Verificar los tipos**

Run: `npm run tipos`
Expected: sin errores. Si aparecen en `mantenimiento/tipos/route.ts`, `remises/RoutesMap.tsx` o `mantenimiento/enlaces.ts`, es el TypeScript 7 que el `node_modules` tiene por fuera del lock: comprobar con `npx -p typescript@5.9.3 tsc --noEmit` antes de tocar nada.

- [ ] **Step 4: Verificar el build**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npm run build`
Expected: `Compiled successfully`. El dev server tiene que estar parado.

- [ ] **Step 5: Verificar que el árbol commiteado está completo**

Run: `node scripts/revisar-arbol-commiteado.mjs`
Expected: todos los imports resuelven.

- [ ] **Step 6: Escribir `scripts/que-eventos-se-moverian.mts`**

Lee `agenda_eventos` con `ot_id` y sus órdenes, corre `elCierreQueAdelanta` y `laFechaQueMandaEnElEvento` sobre las filas reales y dice, por cada evento que cambiaría de día, de qué día a qué día y con qué brecha. **No escribe nada.** Es el gemelo de `scripts/comparar-franja-con-la-semana.mts`, y existe por la misma razón: la decisión es pura y tiene tests, pero lo que la alimenta son dos consultas, y leer el modelo no alcanza para saber si las columnas que se piden son las que hay.

- [ ] **Step 7: Correrlo contra producción**

Run: `npx tsx scripts/que-eventos-se-moverian.mts`
Expected: **siete** —las OT 2970, 3096, 3097, 3122, 3149, 3152 y 3162—, ninguno con más de un año de brecha, y cero «no creíbles». Si da más, la excepción está agarrando OT cerradas normales y hay que parar antes de desplegar.

- [ ] **Step 8: Commit**

```bash
git add docs/AGENDA.md CLAUDE.md scripts/que-eventos-se-moverian.mts
git commit -m "docs(agenda): la OT que se cerro antes de empezar"
```

---

## Lo que sólo se puede comprobar en la primera corrida real

- Que la sincronización mueva **siete** eventos y no más, y que los seis que van a un día ya pasado queden ahí sin volver a moverse en la corrida siguiente.
- Que Google acepte el `PATCH` de un evento hacia atrás sin devolver nada raro. No hay motivo para que no —la fecha pasada no es un caso especial para la API—, pero no se puede medir sin escribir en producción.
- Que el evento movido no le llegue a nadie como notificación: los de OT se escriben con `sendUpdates=none`, así que no debería salir ninguna invitación. Lo que esto **no** apaga es el recordatorio propio del calendario, que para un día ya pasado no suena.

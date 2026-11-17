# Las OT van solas al calendario — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que toda OT con fecha de ejecución de hoy en adelante llegue sola al
calendario de Google sin pisarse con otra de su especialidad, y que al elegir la
fecha de ejecución se vea qué hay esos días.

**Architecture:** Una función compartida (`mandarLaOTAlCalendario`) extraída de
la ruta manual que ya existe y funciona, llamada desde las cinco puertas que
insertan una OT y desde un barrido posterior a la sincronización. Dos módulos de
reglas puras deciden quién es candidata y a qué hora cae. La pantalla de
selección lee órdenes —no eventos— por un endpoint propio.

**Tech Stack:** Next.js 16 (App Router), Supabase/PostgREST, vitest, Google
Calendar API v3 a través de `lib/core/calendar.ts`.

**Spec:** [docs/superpowers/specs/2026-11-04-agenda-ot-automatica-design.md](../specs/2026-11-04-agenda-ot-automatica-design.md)

## Global Constraints

- **Castellano** en nombres, comentarios, textos de pantalla y mensajes de commit.
- **Conventional commits**: `feat(agenda): …`, `fix(mantenimiento): …`. El cuerpo
  explica **por qué**, no qué.
- **Nunca `git add -A`.** Cada commit nombra sus archivos. Puede haber otra
  sesión en el mismo árbol.
- **El evento arranca a las 08:00 y dura 90 minutos** (`DURACION_OT_MINUTOS`).
- **El arranque nunca pasa de las 20:00.**
- **Los cinco invitados** son `INVITADOS_DE_UNA_OT`, sin cambios.
- **`traerTodo()`** de `lib/core/paginado.ts` en toda lectura de
  `ordenes_trabajo`: PostgREST corta en 1000 filas sin avisar.
- **La cadena de `.select()` va literal**, en una sola pieza: partida con `+`
  pierde la inferencia de tipos de Supabase.
- **Las horas de pared se arman sin `Date`**: el servidor corre en UTC.
- **`<Select>` y no `<select>`**; `grid-cols-1 sm:grid-cols-3`; el ancho va en un
  `div` que envuelva al campo, nunca junto a `.input`.
- **Una policy nueva llama a su función envuelta**: `using ((select f()))`.
- **El DDL lo corre una persona** a mano en el editor SQL de Supabase.
- Verificación de cada tarea: `npm test`, `npx tsc --noEmit`, y
  `node scripts/revisar-exportaciones.mjs` en las tareas que escriben una planilla.

## Review Focus

Cinco cosas que el diseño implica y que ninguna tarea ejercitaría sola. Cada una
tiene su test asignado a la tarea que es dueña del código.

1. **Una OT cuya fecha es hoy pero cuyas 08:00 ya pasaron** (se carga a las
   15:00). Se crea igual: es información de lo que se hizo o se está haciendo
   hoy, no una alarma, y filtrarla dejaría los días de hoy a medias. → Tarea 1.
2. **Una `fecha_ejecucion` mal formada** llegando de la planilla. No se crea
   evento y se dice por qué: `horarioDeLaOT` no valida, y un evento con fecha
   inválida haría que cada aviso de Google saliera «movido» para siempre. → Tarea 1.
3. **Una OT con `especialidad` nula o desconocida** (hay una en producción). Las
   de especialidad vacía se agrupan entre sí y se apilan como cualquier otra; no
   revientan ni comparten hueco con las mecánicas. → Tarea 1.
4. **Dos OT de la misma especialidad y día en la misma corrida del importador.**
   La segunda tiene que ver a la primera y arrancar hora y media después. →
   Tarea 5.

   *(Corregido el 04/11/2026, durante la ejecución.* Esto decía que la segunda
   no puede ver a la primera y que por eso hacía falta adelantar los huecos con
   `yaTomados`. **La premisa era falsa**: el bucle no corre dentro de una
   transacción, así que el insert de la primera está commiteado y la lectura de
   la segunda lo ve. Pasar `yaTomados` encima la contaba dos veces — medido:
   08:00 y 11:00 en vez de 08:00 y 09:30. El parámetro se sacó.)*
5. **Un ítem del plan cuya OT se borró** entre que se abrió la pantalla y se
   apretó el botón. Ese ítem se informa y los demás siguen. → Tarea 6.

---

### Task 1: Las dos reglas puras — quién es candidata y dónde cae

**Files:**
- Create: `lib/agenda/apilado.ts`
- Create: `lib/agenda/apilado.test.ts`
- Create: `lib/agenda/candidata.ts`
- Create: `lib/agenda/candidata.test.ts`

**Interfaces:**
- Consumes: `DURACION_OT_MINUTOS`, `fechaParaElCalendario`, `laOTEstaCerrada` de
  `lib/agenda/evento.ts`.
- Produces:
  - `HORA_DE_ARRANQUE = "08:00"` y `TOPE_DE_ARRANQUE = "20:00"` (`lib/agenda/apilado.ts`)
  - `horarioApilado(fecha: string, ocupados: number): { inicio: string; fin: string; topeado: boolean } | null`
  - `AVISO_DE_TOPE: string`
  - `esCandidataAlCalendario(o: OTCandidata, hoy: string): { ok: true; fecha: string } | { ok: false; motivo: string }` (`lib/agenda/candidata.ts`)
  - `interface OTCandidata { fecha_ejecucion?: string | null; fecha_ejecucion_pendiente?: string | null; fecha_cierre?: string | null; estado?: string | null }`
  - `claveDeApilado(especialidad: string | null | undefined): string`

- [ ] **Step 1: Escribir los tests que fallan de `horarioApilado`**

```ts
describe("donde cae una OT en su dia", () => {
  it("la primera arranca a las 08:00 y dura 1:30", () => {
    expect(horarioApilado("2026-11-06", 0)).toEqual({
      inicio: "2026-11-06T08:00:00", fin: "2026-11-06T09:30:00", topeado: false,
    });
  });

  it("la segunda cae hora y media despues", () => {
    expect(horarioApilado("2026-11-06", 1)?.inicio).toBe("2026-11-06T09:30:00");
  });

  it("la quinta cae a las 14:00", () => {
    expect(horarioApilado("2026-11-06", 4)?.inicio).toBe("2026-11-06T14:00:00");
  });

  /** 08:00 + 8 x 1:30 = 20:00, el fin del ultimo turno: todavia sin topear. */
  it("la novena cae justo en el tope y no se marca", () => {
    const r = horarioApilado("2026-11-06", 8);
    expect(r?.inicio).toBe("2026-11-06T20:00:00");
    expect(r?.topeado).toBe(false);
  });

  /**
   * Sin tope, la undecima daria 24:30: `instanteDe` la rechaza y la OT se
   * quedaria SIN EVENTO, en silencio. Comparten las 20:00 y se marcan.
   */
  it("de la decima en adelante comparten las 20:00 y quedan marcadas", () => {
    for (const n of [9, 10, 25]) {
      const r = horarioApilado("2026-11-06", n);
      expect(r?.inicio).toBe("2026-11-06T20:00:00");
      expect(r?.topeado).toBe(true);
    }
  });

  it("una fecha mal formada no produce horario", () => {
    for (const f of ["", "06/11/2026", "2026-13-01", "ayer"]) {
      expect(horarioApilado(f, 0)).toBeNull();
    }
  });

  it("ningun horario cruza la medianoche", () => {
    for (let n = 0; n < 30; n++) {
      expect(horarioApilado("2026-11-06", n)?.fin.slice(0, 10)).toBe("2026-11-06");
    }
  });
});

describe("como se agrupa el apilado", () => {
  it("la especialidad decide el grupo", () => {
    expect(claveDeApilado("MECÁNICO")).toBe(claveDeApilado("MECÁNICO"));
    expect(claveDeApilado("MECÁNICO")).not.toBe(claveDeApilado("ELÉCTRICO"));
  });

  /** Hay una OT en produccion con la especialidad vacia. No puede reventar ni
      caer en el monton de las mecanicas. */
  it("las de especialidad vacia son su propio grupo", () => {
    const sinNada = claveDeApilado(null);
    expect(sinNada).toBe(claveDeApilado(""));
    expect(sinNada).toBe(claveDeApilado("   "));
    expect(sinNada).not.toBe(claveDeApilado("MECÁNICO"));
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/agenda/apilado.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar `lib/agenda/apilado.ts`**

`horarioApilado` arma las cadenas con aritmética sobre minutos, **sin `Date`**,
igual que `horarioDeLaOT` en `lib/agenda/evento.ts`: copiá su forma. Valida la
fecha con el mismo criterio que `instanteDe` usa para el día. `AVISO_DE_TOPE`
dice que ese día ya tiene nueve órdenes de esa especialidad y que ésta comparte
las 20:00.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run lib/agenda/apilado.test.ts`
Expected: PASS

- [ ] **Step 5: Escribir los tests que fallan de `esCandidataAlCalendario`**

```ts
const HOY = "2026-11-04";

describe("que OT entra sola al calendario", () => {
  it("una con fecha futura y abierta entra", () => {
    const r = esCandidataAlCalendario({ fecha_ejecucion: "2026-11-06", estado: "POR_HACER" }, HOY);
    expect(r).toEqual({ ok: true, fecha: "2026-11-06" });
  });

  /**
   * Review Focus 1: cargada a las 15:00 con fecha de hoy, las 08:00 ya pasaron.
   * Entra igual — el filtro es por DIA y no por hora.
   */
  it("la de hoy entra aunque las 08:00 ya hayan pasado", () => {
    expect(esCandidataAlCalendario({ fecha_ejecucion: HOY, estado: "POR_HACER" }, HOY).ok).toBe(true);
  });

  it("una con fecha pasada no entra, y lo dice", () => {
    const r = esCandidataAlCalendario({ fecha_ejecucion: "2026-11-03", estado: "POR_HACER" }, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/pas/i);
  });

  it("una sin ninguna fecha no entra", () => {
    expect(esCandidataAlCalendario({ fecha_ejecucion: null, estado: "POR_HACER" }, HOY).ok).toBe(false);
  });

  /** `laOTEstaCerrada`: `fecha_cierre` O estado REALIZADO. 168 de 986 REALIZADO
      no tienen fecha de cierre, asi que las dos puntas cuentan. */
  it("una cerrada no entra por ninguna de las dos puntas", () => {
    expect(esCandidataAlCalendario({ fecha_ejecucion: "2026-11-06", fecha_cierre: "2026-11-01", estado: "POR_HACER" }, HOY).ok).toBe(false);
    expect(esCandidataAlCalendario({ fecha_ejecucion: "2026-11-06", estado: "REALIZADO" }, HOY).ok).toBe(false);
  });

  /** La pendiente gana: es la que `fechaParaElCalendario` prefiere y la que el
      derrame todavia no llevo al master. */
  it("manda la fecha pendiente cuando la hay", () => {
    const r = esCandidataAlCalendario(
      { fecha_ejecucion: "2026-11-06", fecha_ejecucion_pendiente: "2026-11-20", estado: "POR_HACER" }, HOY);
    expect(r).toEqual({ ok: true, fecha: "2026-11-20" });
  });

  /** Review Focus 2: la planilla puede mandar cualquier cosa. */
  it("una fecha mal formada no entra, y lo dice", () => {
    const r = esCandidataAlCalendario({ fecha_ejecucion: "06/11/2026", estado: "POR_HACER" }, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/fecha/i);
  });
});
```

- [ ] **Step 6: Correr, ver que falla, implementar `lib/agenda/candidata.ts`, correr y ver que pasa**

Run: `npx vitest run lib/agenda/candidata.test.ts`
La fecha sale de `fechaParaElCalendario`; el cierre de `laOTEstaCerrada`. La
comparación con `hoy` es de strings ISO, sin parsear a `Date`.

- [ ] **Step 7: Commit**

```bash
git add lib/agenda/apilado.ts lib/agenda/apilado.test.ts lib/agenda/candidata.ts lib/agenda/candidata.test.ts
git commit -m "feat(agenda): las reglas de que OT entra sola al calendario y donde cae en el dia"
```

---

### Task 2: `mandarLaOTAlCalendario`, extraída de la ruta manual

La ruta `app/api/mantenimiento/ordenes/[id]/calendario/route.ts` ya hace todo
esto bien y en el orden correcto (fila → invitados → Google, el dueño que no
cambia, el pendiente cuando Google falla). Esta tarea **no reinventa nada**:
mueve ese cuerpo a una función que no sabe de `Request` ni de `NextResponse`, y
deja la ruta llamándola.

**Files:**
- Create: `lib/agenda/mandarLaOT.ts`
- Create: `lib/agenda/mandarLaOT.test.ts`
- Modify: `app/api/mantenimiento/ordenes/[id]/calendario/route.ts`

**Interfaces:**
- Consumes: Tarea 1 (`horarioApilado`, `claveDeApilado`, `esCandidataAlCalendario`);
  `elegirElDuenoDeLaOT` (`lib/agenda/duenoDeLaOT.ts`); `escribirEnGoogle`,
  `columnasDespuesDeEscribir`, `parPendiente`, `parDivergencia`,
  `advertenciaDeLaEscritura`, `advertenciaDeReenviarDivergido`
  (`lib/agenda/escribirEnGoogle.ts`); `agregarInvitados`, `sacarInvitados`,
  `diferenciaDeInvitados` (`lib/agenda/invitados.ts`); `anotarEnLaFila`
  (`lib/agenda/cargar.ts`); `aInstanteISO`, `invitadosLimpios`,
  `eventoParaGoogle` (`lib/agenda/pedido.ts`); `datosDeLaOT`,
  `problemasDelEvento`, `INVITADOS_DE_UNA_OT` (`lib/agenda/evento.ts`).
- Produces:

```ts
export interface PedidoDeMandar {
  /** Null = automático: se calcula el hueco. Un turno explícito es el botón manual. */
  turno: Turno | null;
  invitadosExtra: string[];
  /** Confirmación de pisar un evento divergido. El automático nunca pisa. */
  pisar: boolean;
  /**
   * Huecos ya tomados por esta misma corrida y que todavía no están en la base.
   * La clave es `` `${fecha}|${claveDeApilado(especialidad)}` `` — una sola
   * definición, acá, porque la arma esta función y la llena la Tarea 5.
   */
  yaTomados?: ReadonlyMap<string, number>;
}

/** La clave de `yaTomados`. Exportada para que nadie la rearme a mano. */
export function claveDelHueco(fecha: string, especialidad: string | null | undefined): string;

export type ResultadoDeMandar =
  | { ok: true; eventoId: string; reemplazo: boolean; inicio: string;
      enGoogle: boolean; pendiente: string | null; advertencias: string[] }
  | { ok: false; estado: 400 | 404 | 409 | 500; error: string; requiereConfirmacion?: boolean };

export async function mandarLaOTAlCalendario(
  admin: SupabaseClient,
  ordenId: string,
  pedido: PedidoDeMandar,
  ahora?: Date,
): Promise<ResultadoDeMandar>;
```

Contar cuántos eventos de esa especialidad hay ya ese día es **interno** de
este módulo: `barrerLasQueFaltan` no cuenta por su cuenta, pasa `yaTomados` y
deja que `mandarLaOTAlCalendario` haga la cuenta. Un export que nadie consume
sobra.

- [ ] **Step 1: Escribir los tests que fallan**

Usar `lib/agenda/baseEnMemoria.testhelper.ts`, que ya existe y es lo que usan
los tests de la Agenda.

```ts
describe("mandar una OT al calendario", () => {
  it("la primera del dia y la especialidad arranca a las 08:00", async () => { /* … */ });

  it("la segunda mecanica del mismo dia arranca a las 09:30", async () => { /* … */ });

  /** El caso que hace util el apilado: no comparten gente, si pueden la hora. */
  it("una electrica el mismo dia vuelve a arrancar a las 08:00", async () => { /* … */ });

  it("con turno explicito usa ese turno y no el hueco", async () => { /* … */ });

  it("reenviar una OT que ya tiene evento lo mueve y no lo duplica", async () => { /* … */ });

  it("el dueño de un evento que ya existia no cambia al reenviarlo", async () => { /* … */ });

  /** El automatico no pisa a nadie: pisar es un acto de una persona. */
  it("sin `pisar`, una OT con evento divergido devuelve 409 y no toca nada", async () => { /* … */ });

  it("si Google falla, el evento igual queda y con `google_pendiente`", async () => { /* … */ });

  it("una OT cerrada se rechaza con 400", async () => { /* … */ });

  /** Review Focus 4, la mitad de una corrida: `yaTomados` adelanta el hueco. */
  it("`yaTomados` corre el hueco aunque la base todavia no lo tenga", async () => {
    // Base vacia y yaTomados con `claveDelHueco("2026-11-06", "MECÁNICO") → 2`
    // tiene que dar las 11:00.
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/agenda/mandarLaOT.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Mover el cuerpo del `POST` a `lib/agenda/mandarLaOT.ts`**

Mover, no reescribir. Lo que cambia respecto del original:
- El turno sale de `pedido.turno` o, si es null, de `horarioApilado(fecha,
  huecosOcupados(...) + (yaTomados.get(clave) ?? 0))`.
- Cuando `horarioApilado` devuelve `topeado`, se suma `AVISO_DE_TOPE` a
  `advertencias` **y** se escribe en la columna `aviso` del evento — es el canal
  que ya existe para «algo que mirar», y no es `google_pendiente`, que significa
  «falta escribir».
- Los `NextResponse.json(...)` pasan a `{ ok: false, estado, error }`.
- Cuando no hay usuario activo para la casilla del área, el automático **no**
  corta: `elegirElDuenoDeLaOT` ya devuelve la casilla; sin usuario, se devuelve
  `{ ok: false, estado: 409 }` y es quien llama el que decide. La ruta manual lo
  muestra; el barrido lo anota y sigue.

- [ ] **Step 4: Dejar la ruta manual llamando a la función**

El `POST` queda con: permisos, validación del cuerpo, `turno` explícito desde
`datos.turno`, la llamada, y el mapeo de `ResultadoDeMandar` a `NextResponse`.
El `GET` no se toca.

- [ ] **Step 5: Correr todo y comprobar que la ruta manual no cambió de comportamiento**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, incluidos los tests que ya existían de la Agenda.

- [ ] **Step 6: Commit**

```bash
git add lib/agenda/mandarLaOT.ts lib/agenda/mandarLaOT.test.ts "app/api/mantenimiento/ordenes/[id]/calendario/route.ts"
git commit -m "refactor(agenda): mandar una OT al calendario deja de vivir en la ruta"
```

---

### Task 2B: El barrido recalcula el hueco al mover un evento

Esta tarea no estaba en el plan original. El spec la pide —«cuando el barrido
nocturno mueve un evento porque cambió la fecha de la OT, **recalcula el hueco
en la fecha nueva**»— y la autorrevisión no lo detectó. Sin ella, una OT que se
mueve del 6 al 20 llega con la hora vieja y puede caer encima de otra de su
especialidad, que es justo lo que este trabajo existe para evitar.

**Files:**
- Modify: `lib/agenda/elEventoSigueALaOT.ts` (`planDelEvento`, `queHacerConElEvento`, `seguirALasOT`)
- Modify: `lib/agenda/elEventoSigueALaOT.test.ts`
- Modify: `lib/agenda/apilado.ts` y `lib/agenda/apilado.test.ts` (el arranque deja de estar fijo en 08:00)

**Interfaces:**
- Consumes: `horarioApilado`, `claveDeApilado`, `TOPE_DE_ARRANQUE`, `AVISO_DE_TOPE` (Tarea 1); `mandarLaOT.ts` no se toca.
- Produces: `horarioApilado(fecha: string, ocupados: number, arranque?: string)` — el tercer
  parámetro es la hora de arranque y por defecto sigue siendo `HORA_DE_ARRANQUE`.

**El criterio, que es la decisión de esta tarea.** El hueco se recalcula **desde
el turno guardado del evento**, apilando 1:30 por cada evento de la misma
especialidad que ya haya ese día *en ese turno*, con el mismo tope de las 20:00.

Es lo que resuelve una ambigüedad real: el camino automático guarda
`turno = "8-16"`, así que la columna **no distingue** un evento automático de uno
que una persona puso en el turno de 8. Recalcular siempre desde las 08:00
tiraría a la basura el turno que alguien eligió; agregar una columna para marcar
«automático» cuesta una migración que corre una persona, para una distinción que
así no hace falta. Para un evento automático este criterio es exactamente la
regla del spec, porque su turno arranca a las 08:00.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("al mover un evento de OT a otra fecha", () => {
  /** Lo que falta hoy: llega con la hora vieja y se encima. */
  it("recalcula el hueco en la fecha nueva y no conserva la hora vieja", () => { /* … */ });

  it("si la fecha nueva ya tiene una de su especialidad, cae 1:30 despues", () => { /* … */ });

  it("una de otra especialidad en la fecha nueva no le corre el hueco", () => { /* … */ });

  /** El turno que eligio una persona no se pierde al moverse de fecha. */
  it("un evento del turno 4-12 se recalcula desde las 04:00, no desde las 08:00", () => { /* … */ });

  it("el evento no se cuenta a si mismo al recalcular", () => {
    // Mover del 6 al 20 con el dia 20 vacio tiene que dar el primer hueco.
  });

  it("si en la fecha nueva el hueco topea, el evento queda con AVISO_DE_TOPE", () => { /* … */ });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/agenda/elEventoSigueALaOT.test.ts`

- [ ] **Step 3: Darle a `horarioApilado` la hora de arranque**

Tercer parámetro opcional, por defecto `HORA_DE_ARRANQUE`. El tope de las 20:00
y el `topeado` no cambian. Los tests que ya existen de `apilado` tienen que
seguir pasando sin tocarse: ésa es la prueba de que el valor por defecto
preserva el comportamiento.

- [ ] **Step 4: Que el barrido resuelva el hueco antes de decidir**

La cuenta es una lectura y `planDelEvento` es pura, así que el hueco se resuelve
en `seguirALasOT` y entra como argumento. Una lectura por fecha y no una por
evento: varios eventos del mismo día comparten la cuenta.

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm test && npx tsc --noEmit`
Los tests que ya existían de `elEventoSigueALaOT` tienen que seguir en verde.

- [ ] **Step 6: Commit**

```bash
git add lib/agenda/elEventoSigueALaOT.ts lib/agenda/elEventoSigueALaOT.test.ts lib/agenda/apilado.ts lib/agenda/apilado.test.ts
git commit -m "fix(agenda): al mover un evento de OT, el hueco se recalcula en la fecha nueva"
```

---

### Task 3: El enganche en las cuatro puertas que insertan una OT de a una

Son cinco las puertas que insertan una OT. **Cuatro insertan de a una y llevan
este enganche. La quinta —la sincronización del formulario— no puede: hace un
`upsert` de la planilla entera y no distingue un alta de una actualización**, y
además tiene que cubrir el caso de la fecha que se edita después. Ésa la
resuelve el barrido de la Tarea 5, con las mismas reglas de la Tarea 1.

**Files:**
- Create: `lib/agenda/alNacerLaOT.ts`
- Create: `lib/agenda/alNacerLaOT.test.ts`
- Modify: `app/api/mantenimiento/ordenes/route.ts` (después del insert)
- Modify: `lib/mantenimiento/generarPeriodicas.ts:181`
- Modify: `app/api/mantenimiento/cuaderno/generar/route.ts:559`
- Modify: `app/api/mantenimiento/partes-contratista/generar/route.ts:559`

**Interfaces:**
- Consumes: Tarea 2 (`mandarLaOTAlCalendario`), Tarea 1 (`esCandidataAlCalendario`).
- Produces: `alNacerLaOT(admin: SupabaseClient, ordenId: string, ahora?: Date): Promise<string | null>`
  — devuelve una advertencia para mostrar, o `null`. **Nunca lanza.**

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("cuando nace una OT", () => {
  it("una con fecha futura queda con evento", async () => { /* … */ });
  it("una con fecha pasada no genera nada y devuelve null", async () => { /* … */ });
  it("una cerrada no genera nada", async () => { /* … */ });

  /** Lo que no puede pasar nunca: que el espejo tumbe al dato. */
  it("si mandar explota, devuelve la advertencia y no lanza", async () => { /* … */ });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/agenda/alNacerLaOT.test.ts`

- [ ] **Step 3: Implementar `lib/agenda/alNacerLaOT.ts`**

Envuelve la llamada en `try/catch` y traduce `{ ok: false }` a una frase. El
encabezado del archivo tiene que decir **por qué es una sola función y no cuatro
enganches**: dos criterios en dos puertas es cómo una queda con otra regla sin
que nada avise.

- [ ] **Step 4: Llamarla desde las cuatro puertas**

En las cuatro, **después** de que la orden esté guardada y nunca dentro de su
transacción. En `app/api/mantenimiento/ordenes/route.ts` la advertencia se suma
a la respuesta; en las otras tres se acumula en el informe que ya devuelven.

- [ ] **Step 5: Correr todo**

Run: `npm test && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add lib/agenda/alNacerLaOT.ts lib/agenda/alNacerLaOT.test.ts app/api/mantenimiento/ordenes/route.ts lib/mantenimiento/generarPeriodicas.ts app/api/mantenimiento/cuaderno/generar/route.ts app/api/mantenimiento/partes-contratista/generar/route.ts
git commit -m "feat(agenda): toda OT que nace con fecha futura entra sola al calendario"
```

---

### Task 4: `fecha_fin` llega a la base

**Bloquea:** el DDL lo corre el usuario a mano. Avisarle al empezar la tarea y
esperar la confirmación antes del paso 4.

**Files:**
- Create: `supabase/migrations/<timestamp>_ot_fecha_fin.sql` (con `npm run migracion "ot fecha fin"`)
- Modify: `app/api/mantenimiento/ordenes/route.ts` (que la escriba también en la base)
- Modify: `lib/mantenimiento/sincronizar.ts` (que la importe de la planilla)

**Interfaces:**
- Produces: la columna `ordenes_trabajo.fecha_fin date null`.

- [ ] **Step 1: Escribir la migración**

Una columna, nullable, con `comment on column` que diga que **vacía quiere decir
«dura un día»** y no que falte —la misma convención que `fecha_hasta` en el
cuaderno— y que las órdenes anteriores al 04/11/2026 la tienen vacía porque
hasta entonces el dato vivía sólo en la planilla.

- [ ] **Step 2: Pedirle al usuario que la corra y esperar**

Decirle el archivo y que es una columna nueva, nullable, sin backfill.

- [ ] **Step 3: Comprobar que está aplicada**

Run: una lectura por PostgREST de `ordenes_trabajo?select=fecha_fin&limit=1`
Expected: HTTP 200.

- [ ] **Step 4: Escribirla en el alta y leerla en el importador**

En `app/api/mantenimiento/ordenes/route.ts:491` hoy va sólo a la planilla con un
comentario que dice que mandársela a PostgREST corta el insert. Ese comentario
deja de ser cierto: ahora va a los dos lados, y hay que actualizarlo. En
`sincronizar.ts`, sumar la columna al `registros` que arma el upsert, leyéndola
por **el nombre del encabezado y no por la letra** —es la regla del cuaderno, y
el mismo contenido ya se mudó de columna una vez.

- [ ] **Step 5: Correr todo**

Run: `npm test && npx tsc --noEmit && node scripts/revisar-exportaciones.mjs`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<timestamp>_ot_fecha_fin.sql app/api/mantenimiento/ordenes/route.ts lib/mantenimiento/sincronizar.ts
git commit -m "feat(mantenimiento): la fecha de fin estimada deja de vivir solo en la planilla"
```

---

### Task 5: El barrido después de la sincronización

**Files:**
- Create: `lib/agenda/barridoDeNuevas.ts`
- Create: `lib/agenda/barridoDeNuevas.test.ts`
- Modify: `lib/mantenimiento/sincronizar.ts` (después del upsert, línea ~745)

**Interfaces:**
- Consumes: Tareas 1 y 2.
- Produces:

```ts
export const TOPE_POR_CORRIDA = 25;

export async function barrerLasQueFaltan(
  admin: SupabaseClient, ahora: Date, tope?: number,
): Promise<{ creados: number; quedaron: number; fallos: string[] }>;
```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("el barrido de las que faltan", () => {
  it("crea evento para una OT futura sin evento", async () => { /* … */ });
  it("no vuelve a crear uno para una que ya lo tiene", async () => { /* … */ });
  it("ignora las pasadas y las cerradas", async () => { /* … */ });

  /**
   * Review Focus 4: dos mecanicas del mismo dia en la MISMA corrida. Si cada
   * una lee la base antes de escribir, las dos ven cero ocupados y las dos
   * caen a las 08:00 — que es exactamente lo que este diseño evita.
   */
  it("dos de la misma especialidad y dia en una corrida no comparten hora", async () => {
    // Esperado: 08:00 y 09:30.
  });

  it("respeta el tope y dice cuantas quedaron", async () => {
    // 30 candidatas, tope 25 → creados 25, quedaron 5.
  });

  /** Las mas cercanas primero: si el tope corta, que corte lo lejano. */
  it("manda primero las de fecha mas cercana", async () => { /* … */ });

  it("un fallo en una no frena a las demas", async () => { /* … */ });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/agenda/barridoDeNuevas.test.ts`

- [ ] **Step 3: Implementar `lib/agenda/barridoDeNuevas.ts`**

La consulta trae las órdenes con `fecha_ejecucion` o `fecha_ejecucion_pendiente`
de hoy en adelante, no cerradas, cuyo `id` no está en `agenda_eventos.ot_id`
—con `traerTodo()`—, ordenadas por fecha ascendente. Va de a una, acumulando los
huecos tomados en un `Map` que se le pasa a `mandarLaOTAlCalendario` como
`yaTomados`: **ésa es la única defensa contra el caso de arriba**, porque la
fila de la base todavía no refleja lo recién escrito dentro de la misma pasada.

El encabezado explica el tope con su medida: ~8,7 altas por día, de las que
pocas son futuras; 25 deja pasar cualquier día normal y frena una pegada de
columna en la planilla.

- [ ] **Step 4: Engancharlo en `sincronizar.ts`**

Después del upsert y de la limpieza de `fecha_ejecucion_pendiente`, dentro del
presupuesto de Google que ya reparte la corrida (`presupuestoDeGoogle`). Un
fallo del barrido **no** hace fallar la sincronización: se suma a su informe.

- [ ] **Step 5: Correr todo**

Run: `npm test && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add lib/agenda/barridoDeNuevas.ts lib/agenda/barridoDeNuevas.test.ts lib/mantenimiento/sincronizar.ts
git commit -m "feat(agenda): las OT del formulario con fecha futura entran despues de cada sincronizacion"
```

---

### Task 6: La razón de postergación y el envío desde el plan

**Files:**
- Create: `lib/mantenimiento/planAlCalendario.ts`
- Create: `lib/mantenimiento/planAlCalendario.test.ts`
- Create: `app/api/mantenimiento/planificacion/[id]/calendario/route.ts`

**Interfaces:**
- Consumes: Tarea 2; `laNuevaFecha`, `loQueFaltaParaPostergar` (`lib/mantenimiento/postergar.ts`).
- Produces:

```ts
export type QueHacerConElItem =
  | { que: "mandar"; fecha: string }
  | { que: "correr-y-mandar"; dias: number; fecha: string }
  | { que: "mandar-avisando"; fecha: string; aviso: string }
  | { que: "saltear"; motivo: string };

export function queHacerConElItem(
  item: { ot_number: number },
  orden: { fecha_ejecucion: string | null; fecha_ejecucion_pendiente: string | null;
           fecha_cierre: string | null; estado: string | null; app_created: boolean | null } | null,
  fechaDelPlan: string,
): QueHacerConElItem;

export const RAZON_DEL_PLAN = "planificacion_del_dia";
export function justificacionDelPlan(fechaDelPlan: string): string;
```

- [ ] **Step 1: Comprobar si `razon` admite un valor nuevo sin DDL**

Leer la definición de la columna y de `mant_razones_de_postergacion`. Si `razon`
es una FK al catálogo, alcanza con un insert por PostgREST. Si hay un enum o un
check, **hay que escribir una migración y esperar a que el usuario la corra**:
un valor de enum nuevo viaja solo en su propio archivo (`55P04`).

- [ ] **Step 2: Escribir los tests que fallan de `queHacerConElItem`**

```ts
describe("que hacer con cada item del plan", () => {
  it("si las fechas coinciden, se manda y listo", () => { /* que: "mandar" */ });

  it("si el plan es posterior y la OT es del SdG, se le corre la fecha", () => {
    // plan 2026-11-10, OT 2026-11-06, app_created → { que: "correr-y-mandar", dias: 4 }
  });

  /** Postergar exige `dias > 0`: adelantar una fecha no es postergarla. */
  it("si el plan es ANTERIOR, se manda en la fecha de la OT avisando", () => {
    // plan 2026-11-02, OT 2026-11-06 → "mandar-avisando", fecha 2026-11-06
  });

  it("si la OT vino del formulario, se manda en su fecha avisando", () => {
    // El aviso nombra el bloqueo: su fecha se cambia en la planilla.
  });

  it("una OT cerrada se saltea diciendolo", () => { /* que: "saltear" */ });

  /** Review Focus 5: la OT se borro entre que se abrio la pantalla y el boton. */
  it("un item cuya OT ya no existe se saltea y no rompe el lote", () => {
    expect(queHacerConElItem({ ot_number: 2951 }, null, "2026-11-06").que).toBe("saltear");
  });

  /** MAXIMO_DE_DIAS es 90: mas lejos, postergar lo rechaza. */
  it("una diferencia mayor al maximo se manda avisando, no se intenta correr", () => { /* … */ });
});
```

- [ ] **Step 3: Correr, ver que falla, implementar, correr y ver que pasa**

Run: `npx vitest run lib/mantenimiento/planAlCalendario.test.ts`

- [ ] **Step 4: Escribir la ruta `POST /api/mantenimiento/planificacion/[id]/calendario`**

Cuerpo: `{ item_id?: string }` — sin `item_id`, el plan entero. Para cada ítem
lee la orden de verdad (nunca la copia del ítem), decide con
`queHacerConElItem`, y en el caso `correr-y-mandar` llama a la ruta de postergar
**reusándola y no duplicándola**: es la escritura más peligrosa del módulo y
tiene su propio orden de pasos. Devuelve un renglón por ítem con qué pasó. Un
fallo en uno no cancela los demás.

- [ ] **Step 5: Correr todo**

Run: `npm test && npx tsc --noEmit && node scripts/revisar-exportaciones.mjs`
La ruta nueva escribe en la planilla a través de postergar: tiene que quedar
declarada como `delega` en el registro de exportaciones.

- [ ] **Step 6: Commit**

```bash
git add lib/mantenimiento/planAlCalendario.ts lib/mantenimiento/planAlCalendario.test.ts "app/api/mantenimiento/planificacion/[id]/calendario/route.ts"
git commit -m "feat(mantenimiento): un plan del dia se manda al calendario, y el plan manda la fecha"
```

---

### Task 7: Los botones en la pantalla del plan

**Files:**
- Modify: `app/(app)/mantenimiento/planificacion/[id]/PlanDetalle.tsx`

**Interfaces:**
- Consumes: la ruta de la Tarea 6.

- [ ] **Step 1: Agregar el botón del plan entero y el de cada ítem**

El del plan entero, arriba, dice cuántos ítems va a mandar. El de cada ítem, en
su renglón. Antes de mandar el plan entero, un `useConfirm` que diga **cuántas
invitaciones se van a mandar** (ítems × 5): es el número que la gente no espera.

- [ ] **Step 2: Mostrar el resultado renglón por renglón**

Cada ítem queda con lo que le pasó: mandada, mandada en otra fecha con el
motivo, o salteada. Un resumen de arriba no sirve: el caso interesante es
justamente el ítem que no hizo lo que el plan decía.

- [ ] **Step 3: Comprobar el teléfono**

Run: `node scripts/revisar-responsive.mjs`
Expected: ROMPE 0 · APRETADO 0

- [ ] **Step 4: Correr todo**

Run: `npx tsc --noEmit && npm run build`

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/mantenimiento/planificacion/[id]/PlanDetalle.tsx"
git commit -m "feat(mantenimiento): mandar al calendario desde el plan del dia"
```

---

### Task 8: Cuánta gente del taller hay cada día, por oficio

**Files:**
- Create: `lib/mantenimiento/genteDelDia.ts`
- Create: `lib/mantenimiento/genteDelDia.test.ts`

**Interfaces:**
- Consumes: `type Oficio` de `lib/mantenimiento/programacion.ts` —**no se
  redefine acá**, por lo mismo que `Turno` no se redefinió en
  `lib/agenda/evento.ts`: dos tipos iguales en dos archivos es cómo se separan
  sin que nada avise—; `PersonaDelTaller`, `AusenciaCruda`, `estaVigente`,
  `estaAusente` y `TIPOS_QUE_NO_SON_FALTA` de
  `lib/mantenimiento/disponibilidad.ts`.
- Produces:

```ts
/** `null` para CIVIL y para cualquier especialidad sin oficio en el taller. */
export function oficioDeLaEspecialidad(especialidad: string | null | undefined): Oficio | null;

export type GenteDelDia =
  | { sabemos: false }                                   // el padrón está vacío
  | { sabemos: true; porOficio: Record<Oficio, number> };

export function genteDelDia(
  padron: PersonaDelTaller[], ausencias: AusenciaCruda[],
  francos: { empleado_id: string; fecha_descanso: string | null }[], dia: string,
): GenteDelDia;
```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("cuanta gente del taller hay un dia", () => {
  /** La decision del usuario: por DIA, no por turno. Los grupos A y B nunca van
      a 8-16, asi que contar por turno daria cero mecanicos para siempre. */
  it("cuenta a todo el taller presente, sin mirar el turno", () => { /* … */ });

  it("un ausente no cuenta", () => { /* … */ });

  /** Un franco abre hueco por `fecha_descanso`, NUNCA por `fecha_tomado`. */
  it("un franco con fecha_descanso ese dia no cuenta", () => { /* … */ });

  it("un franco con fecha_descanso en null no abre hueco", () => {
    // Los 56 viejos: el sistema no sabe cuando descansaron.
  });

  /** Una TARDANZA viene a trabajar. */
  it("una tardanza no saca a nadie", () => { /* … */ });

  it("alguien fuera de su vigencia no cuenta", () => { /* … */ });

  /** La distincion que el anti-objetivo exige: cero no es lo mismo que no se. */
  it("con el padron vacio contesta que no sabe, no cero", () => {
    expect(genteDelDia([], [], [], "2026-11-06")).toEqual({ sabemos: false });
  });
});

describe("de la especialidad al oficio", () => {
  it("las tres que tienen oficio lo encuentran", () => {
    expect(oficioDeLaEspecialidad("MECÁNICO")).toBe("mecanico");
    expect(oficioDeLaEspecialidad("ELÉCTRICO")).toBe("electricista");
    expect(oficioDeLaEspecialidad("LUBRICACIÓN")).toBe("lubricador");
  });

  /** 279 ordenes: son contratistas o albañileria, y no llevan gente del taller. */
  it("CIVIL no tiene oficio", () => {
    expect(oficioDeLaEspecialidad("CIVIL")).toBeNull();
    expect(oficioDeLaEspecialidad(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr, ver que falla, implementar, correr y ver que pasa**

Run: `npx vitest run lib/mantenimiento/genteDelDia.test.ts`
Funciones puras, sin base ni red, como sus vecinas. Las fechas son strings ISO y
se comparan como strings.

- [ ] **Step 3: Commit**

```bash
git add lib/mantenimiento/genteDelDia.ts lib/mantenimiento/genteDelDia.test.ts
git commit -m "feat(mantenimiento): cuanta gente del taller hay cada dia, por oficio"
```

---

### Task 9: La ruta que alimenta el calendario de selección

**Files:**
- Create: `app/api/mantenimiento/calendario/route.ts`
- Create: `lib/mantenimiento/calendarioDeOT.ts`
- Create: `lib/mantenimiento/calendarioDeOT.test.ts`

**Interfaces:**
- Consumes: Tarea 8 (`genteDelDia`, `oficioDeLaEspecialidad`), Tarea 4 (`fecha_fin`).
- Produces:

```ts
export interface DiaDelCalendario {
  dia: string;
  ordenes: { ot_number: number; especialidad: string | null; tipo: string | null;
             quien: string | null; descripcion: string | null; sector_raw: string | null;
             equipo_raw: string | null; /** true si ese día es parte de la ventana, no el inicio */
             arrastre: boolean }[];
  gente: GenteDelDia;
}

/** Una fila de `ordenes_trabajo` como la lee la grilla. */
export interface OrdenDelCalendario {
  ot_number: number;
  fecha_ejecucion: string | null;
  fecha_ejecucion_pendiente: string | null;
  fecha_fin: string | null;
  especialidad: string | null;
  tipo: string | null;
  quien: string | null;
  descripcion: string | null;
  sector_raw: string | null;
  equipo_raw: string | null;
}

/** Una OT ocupa todos los días de su ventana: del inicio a `fecha_fin` inclusive. */
export function diasQueOcupa(fechaInicio: string, fechaFin: string | null): string[];

export function armarElCalendario(
  ordenes: OrdenDelCalendario[], desde: string, hasta: string,
  gentePorDia: Map<string, GenteDelDia>,
): DiaDelCalendario[];
```

`GET /api/mantenimiento/calendario?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`

- [ ] **Step 1: Escribir los tests que fallan de `diasQueOcupa` y `armarElCalendario`**

```ts
describe("que dias ocupa una OT", () => {
  it("sin fecha de fin, un solo dia", () => {
    expect(diasQueOcupa("2026-11-06", null)).toEqual(["2026-11-06"]);
  });

  it("con ventana, todos los dias inclusive", () => {
    expect(diasQueOcupa("2026-11-02", "2026-11-04"))
      .toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
  });

  /** Dato sucio de la planilla: no inventar un rango al reves. */
  it("una fecha de fin anterior al inicio se trata como un solo dia", () => {
    expect(diasQueOcupa("2026-11-06", "2026-11-01")).toEqual(["2026-11-06"]);
  });
});

describe("armar el calendario", () => {
  it("la OT aparece en todos sus dias, y solo el primero no es arrastre", () => { /* … */ });
  it("los dias sin ordenes estan igual, vacios", () => { /* … */ });
  it("una ventana que empieza antes del rango pedido se recorta sin perder el arrastre", () => { /* … */ });
});
```

- [ ] **Step 2: Correr, ver que falla, implementar, correr y ver que pasa**

Run: `npx vitest run lib/mantenimiento/calendarioDeOT.test.ts`

- [ ] **Step 3: Escribir la ruta**

Lee `ordenes_trabajo` con `traerTodo()` por el rango, con el cliente de la
sesión. **No filtra por estado**: la grilla muestra el trabajo que hay, cerrado
o no, porque para decidir dónde poner la próxima importa todo. Lee el padrón,
las ausencias y los francos una sola vez para todo el rango y arma el `Map` por
día — no una consulta por día.

- [ ] **Step 4: Correr todo**

Run: `npm test && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add app/api/mantenimiento/calendario/route.ts lib/mantenimiento/calendarioDeOT.ts lib/mantenimiento/calendarioDeOT.test.ts
git commit -m "feat(mantenimiento): el calendario de ordenes por mes, con la gente del taller"
```

---

### Task 10: El calendario al elegir la fecha de ejecución

**Files:**
- Create: `app/(app)/mantenimiento/ordenes/CalendarioDeFecha.tsx`
- Create: `app/(app)/mantenimiento/ordenes/coloresDeEspecialidad.ts`
- Modify: `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx` (el campo de fecha de ejecución del alta)

**Interfaces:**
- Consumes: la ruta de la Tarea 9.
- Produces: `<CalendarioDeFecha valor={…} onElegir={(dia: string) => void} onCerrar={…} />`

- [ ] **Step 1: Los cuatro colores**

`coloresDeEspecialidad.ts`: MECÁNICO `#d97706`, ELÉCTRICO `#2563eb`, CIVIL
`#16a34a`, LUBRICACIÓN `#9333ea`, y un gris para la vacía. Van por `style` y no
por clase de utilidad — es lo que ya hacen los badges de Mantenimiento, y una
utilidad al lado de `.card` o `.btn-*` no gana.

- [ ] **Step 2: La grilla del mes**

Siete columnas, navegación de mes. Cada día: hasta **tres fichas** con el número
de OT pintadas por especialidad, y de la cuarta en adelante **«+N más»**. Las de
arrastre se distinguen de las que empiezan ese día. Ancho útil de 343 px: cada
día mide 46 px, y por eso el corte es en tres.

- [ ] **Step 3: Los filtros**

Especialidad, tipo y quién realiza, con `<Select>`. Filtran lo que se pinta, no
lo que se pide: el mes ya vino entero.

- [ ] **Step 4: El panel del día**

Se abre con click en una ficha, en el «+N más» o en el día. Arriba la cuenta de
órdenes y **la cuenta por sector**; después cada orden con número, descripción,
equipo, sector y etiquetas de tipo y quién. La gente del taller: el número por
oficio, **«padrón sin cargar»** cuando `sabemos` es false, y **«no lleva gente
del taller»** para CIVIL. Abajo, el botón que elige ese día.

- [ ] **Step 5: Engancharlo en el alta de OT**

El campo de fecha de ejecución lo abre. Elegir un día lo completa y cierra.

- [ ] **Step 6: Comprobar el teléfono y el árbol**

Run: `node scripts/revisar-responsive.mjs && npx tsc --noEmit && npm run build`
Expected: ROMPE 0 · APRETADO 0, y el build limpio.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/CalendarioDeFecha.tsx" "app/(app)/mantenimiento/ordenes/coloresDeEspecialidad.ts" "app/(app)/mantenimiento/ordenes/OrdenesClient.tsx"
git commit -m "feat(mantenimiento): elegir la fecha de ejecucion viendo que hay esos dias"
```

---

### Task 11: El script que manda las que ya existen

**Files:**
- Create: `scripts/mandar-las-ot-futuras.mts`

**Interfaces:**
- Consumes: Tareas 1, 2 y 5 (`barrerLasQueFaltan`).

- [ ] **Step 1: Escribir el script**

Sin argumento, **corre en seco**: imprime qué órdenes mandaría, con qué fecha y
a qué hora, y cuántas invitaciones serían. Con `--mandar`, lo hace. Ese orden y
no al revés: la corrida de verdad manda ~100 invitaciones y no se deshace.

- [ ] **Step 2: Correrlo en seco contra producción**

Run: `npx tsx scripts/mandar-las-ot-futuras.mts`
Expected: lista las órdenes abiertas con fecha de hoy en adelante, sin escribir
nada. Comprobar a ojo que los horarios apilan como dice el diseño: las cuatro
del 04/11 en 08:00, 09:30, 11:00 y 12:30, y la civil del 06/11 a las 08:00 junto
a la primera mecánica de ese día.

- [ ] **Step 3: Commit**

```bash
git add scripts/mandar-las-ot-futuras.mts
git commit -m "feat(agenda): script de una vez para mandar las OT futuras que ya existian"
```

- [ ] **Step 4: Pedirle al usuario que decida cuándo correrlo de verdad**

No correrlo sin que lo diga: son ~100 invitaciones a cinco casillas.

---

### Task 12: Lo que no se deduce del código

**Files:**
- Modify: `docs/AGENDA.md`
- Modify: `CLAUDE.md` (la fila de Agenda)
- Modify: el registro de `scripts/revisar-exportaciones.mjs` si falta alguna entrada

- [ ] **Step 1: La sección nueva en `docs/AGENDA.md`**

Lo que un lector no puede deducir leyendo el código:
- **Por qué el evento no nace si la fecha ya pasó**, con el 73,6% medido. Sin ese
  número, el freno parece una restricción arbitraria y el próximo lector lo saca.
- **Por qué el apilado agrupa por especialidad y no por sector**: misma
  especialidad es misma gente.
- **Por qué «gente disponible» cuenta por día y no por turno**: los grupos A y B
  nunca van a 8–16, y contar por turno daría cero mecánicos para siempre.
- **Por qué la grilla cuenta órdenes y el apilado cuenta eventos**, que son dos
  conjuntos distintos a propósito.
- **Que el tope de las 20:00 existe** para que la undécima no se quede sin
  evento en silencio.
- **Que `fecha_fin` vacía quiere decir «dura un día»**, no que falte.

- [ ] **Step 2: Actualizar la fila de Agenda en `CLAUDE.md`**

Nombrar el spec y el plan nuevos, y las dos o tres trampas de arriba que valen
para quien retome el módulo.

- [ ] **Step 3: Correr las seis comprobaciones**

```bash
npm test && npx tsc --noEmit && npm run build
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
node scripts/revisar-exportaciones.mjs
```

- [ ] **Step 4: Commit**

```bash
git add docs/AGENDA.md CLAUDE.md scripts/revisar-exportaciones.mjs
git commit -m "docs(agenda): lo que no se deduce del codigo de las OT automaticas"
```

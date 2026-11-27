# Configurar las OT automáticas — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una sección «Lo que crea órdenes solo» en `/mantenimiento/configuracion`
donde se vean y se configuren los ciclos de OT encadenadas, y donde los
mantenimientos programados queden nombrados y enlazados.

**Architecture:** Primero se extrae a una función pura la decisión completa del
ciclo —que hoy son tres pasos encadenados dentro de `generarEncadenadas.ts`—
para que la pantalla pueda mostrar exactamente lo que el generador va a hacer
sin reimplementarlo. Sobre esa función se arma la sección: una tarjeta por
ciclo, de sólo lectura primero, después editable, y por último el alta. La
pantalla es un Server Component que calcula la previsión al pintar; lo único
que se recalcula en el cliente es la proyección aritmética del plazo.

**Tech Stack:** Next.js 16 (App Router, Server Components), Supabase/PostgREST,
TypeScript, Vitest. Sin migración: todas las columnas existen.

**Spec:** [docs/superpowers/specs/2026-11-24-mantenimiento-configurar-ot-automaticas-design.md](../specs/2026-11-24-mantenimiento-configurar-ot-automaticas-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Ninguna migración.** Si una tarea termina pidiendo una columna nueva, es la
  señal de que se desvió: parar y decirlo.
- **Nada de esto escribe una planilla de Google.** No va cola de exportación, no
  entra en `revisar-exportaciones`.
- Un desplegable se escribe `<Select>` (de `components/Select.tsx`), nunca
  `<select>`.
- Una grilla de tres columnas lleva breakpoint: `grid-cols-1 sm:grid-cols-3`.
- El ancho va en un `div` que envuelve al campo, nunca como `w-*` al lado de
  `className="input"`.
- Un formulario con algo que perder va en `<Modal>` con `useBorrador`.
- Una lectura que puede crecer va con `traerTodo()` de `lib/core/paginado.ts`.
- Un `select()` de Supabase va **literal**, nunca armado en una variable.
- Permiso: `puedeEditarMantenimiento(supabase, user.id)`. Quien no lo tiene ve
  la sección entera sin campos ni botones.
- Conventional commits en castellano: `feat(mantenimiento): …`.
- Verificación antes de dar por buena cada tarea: `npm test` y `npm run tipos`.

## Review Focus

Las cinco que la spec implica y que ningún test ejercitaría solo. Cada una
lleva su test a la tarea que es dueña del código:

1. **`repeticiones` bajado por debajo de `vuelta_desde`** rompe el check
   `mant_ciclos_de_ot_vuelta` con un 500 — la pantalla tiene que negarlo antes
   (Tarea 3).
2. **El plazo fuera de 1..3650, vacío o no numérico** rompe el check
   `mant_tareas_preventivas_periodo` (Tarea 3).
3. **Un alta sobre un equipo que ya tiene ciclo** —página vieja, dos pestañas—
   llega al `unique (equipment_id)` y devuelve un 409 crudo (Tarea 5).
4. **Madre e hija con la misma acción y el mismo componente** da
   `tarea_madre_id = tarea_hija_id` y rompe `mant_ciclos_de_ot_tareas_distintas`
   (Tarea 5).
5. **Un equipo sin ningún componente relevado** —62 de los 269— tiene que poder
   igual: el camino «otro…» escribe texto libre (Tarea 5).

---

## Mapa de archivos

| Archivo | De qué es responsable |
|---|---|
| `lib/mantenimiento/loQueHaraElCiclo.ts` | **nuevo** · la decisión completa de un ciclo, pura: arranque + corte + decisión |
| `lib/mantenimiento/loQueHaraElCiclo.test.ts` | **nuevo** · sus tests |
| `lib/mantenimiento/generarEncadenadas.ts` | pasa a llamarla y a persistir lo que devuelve |
| `lib/mantenimiento/configurarElCiclo.ts` | **nuevo** · las reglas de qué se puede guardar: validación de parámetros, del alta, y el par de tareas |
| `lib/mantenimiento/configurarElCiclo.test.ts` | **nuevo** · sus tests |
| `app/(app)/mantenimiento/configuracion/LoQueCreaOrdenesSolo.tsx` | **nuevo** · la sección entera (tarjetas + modal del alta) |
| `app/(app)/mantenimiento/configuracion/page.tsx` | trae los ciclos, sus OT, los programados, y calcula la previsión |
| `app/(app)/mantenimiento/configuracion/ConfiguracionClient.tsx` | monta la sección arriba de todo |
| `app/api/mantenimiento/ciclos/route.ts` | **nuevo** · `POST` del alta |
| `app/api/mantenimiento/ciclos/[id]/configuracion/route.ts` | **nuevo** · `PATCH` de los parámetros |
| `lib/core/nav.ts` | devuelve «Mantenimientos programados» al menú |

---

### Task 1: La decisión completa, en una función sola

Hoy `generarEncadenadas.ts` decide en tres pasos encadenados
(`elArranqueDeUnCambio` → `elCorteQueSigue` → `queSigueEnElCiclo`) y produce
dos motivos de `trabado` por su cuenta. La pantalla tiene que poder preguntar
lo mismo sin reimplementarlo.

**Files:**
- Create: `lib/mantenimiento/loQueHaraElCiclo.ts`
- Test: `lib/mantenimiento/loQueHaraElCiclo.test.ts`
- Modify: `lib/mantenimiento/generarEncadenadas.ts:155-240`

**Interfaces:**
- Consumes: `CicloParaDecidir`, `OTDelCiclo`, `Decision`, `queSigueEnElCiclo()`,
  `elCorteQueSigue()` de `lib/mantenimiento/cicloDeOT.ts` ·
  `elArranqueDeUnCambio()`, `CerradaParaMirar` de `lib/mantenimiento/sospechaDeCambio.ts`
- Produces:

```ts
export interface TareaDelCiclo { nombre: string; componente: string; periodo_dias?: number | null }

export interface CicloCompleto {
  id: string;
  equipment_id: string;
  repeticiones: number;
  desde: string | null;
  vuelta_desde: number | null;
  /** ISO. El arranque sólo mira cierres posteriores a este día. */
  creado_en: string;
  equipoActivo: boolean;
  equipoCode: string | null;
  madre: TareaDelCiclo | null;
  hija: TareaDelCiclo | null;
}

export interface LoQueHara {
  decision: Decision;
  /** Lo que habría que escribir en el ciclo antes de decidir, o null. */
  arranque: { desde: string; ot_number: number } | null;
  corte: { desde: string; vuelta_desde: number } | null;
}

export function loQueHaraElCiclo(
  ciclo: CicloCompleto,
  suyas: readonly OTDelCiclo[],
  cerradasDelEquipo: readonly CerradaParaMirar[]
): LoQueHara
```

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/mantenimiento/loQueHaraElCiclo.test.ts`. Los cinco casos son los que
hoy sólo da la composición de los tres pasos:

```ts
test("un equipo inactivo traba el ciclo", () => {
  const r = loQueHaraElCiclo(ciclo({ equipoActivo: false, equipoCode: "PO-C1-04" }), [], []);
  expect(r.decision).toEqual({ que: "trabado", porque: expect.stringContaining("inactivo") });
});

test("sin tarea madre o hija traba el ciclo", () => {
  const r = loQueHaraElCiclo(ciclo({ hija: null }), [], []);
  expect(r.decision).toEqual({ que: "trabado", porque: expect.stringContaining("catálogo") });
});

test("la madre recién cerrada mueve el corte y crea la hija 1, no espera", () => {
  // desde = 2026-11-17 v0, y la madre 3166 cerrada el 2026-11-24.
  const r = loQueHaraElCiclo(ciclo({ desde: "2026-11-17", vuelta_desde: 0 }), [madreCerrada(3166, "2026-11-24")], []);
  expect(r.corte).toEqual({ desde: "2026-11-24", vuelta_desde: 0 });
  expect(r.decision).toEqual({ que: "crear", vuelta: 1, fecha_ejecucion: "2026-11-27" });
});

test("un ciclo sin arrancar cuyo cambio ya se cerró arranca, no dice «sin arrancar»", () => {
  const r = loQueHaraElCiclo(ciclo({ desde: null, vuelta_desde: null, creado_en: "2026-11-01" }),
    [], [cerrada(3100, "2026-11-14", "Cambio de martillos")]);
  expect(r.arranque).toEqual({ desde: "2026-11-14", ot_number: 3100 });
  expect(r.decision.que).toBe("crear");
});

test("un ciclo sin arrancar y sin ningún cambio posterior sigue sin arrancar", () => {
  const r = loQueHaraElCiclo(ciclo({ desde: null, vuelta_desde: null }), [], []);
  expect(r.arranque).toBeNull();
  expect(r.decision).toEqual({ que: "sin_arrancar" });
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/mantenimiento/loQueHaraElCiclo.test.ts`
Expected: FAIL — `loQueHaraElCiclo is not a function`.

- [ ] **Step 3: Implementar `loQueHaraElCiclo()` en `lib/mantenimiento/loQueHaraElCiclo.ts`**

Es el bloque `generarEncadenadas.ts:156-237` sin los `await admin.update(...)`:
los dos updates se reemplazan por poblar `arranque` y `corte` en el resultado,
y por aplicar esos valores al `CicloParaDecidir` local antes del paso
siguiente — el mismo orden de hoy, que es lo que hace que la hija nazca en la
misma corrida. Los dos `trabado` de equipo inactivo y de tarea faltante
conservan su texto **palabra por palabra**: son los que ya se leen en
`/administracion/salud`.

El encabezado del archivo dice por qué existe: que la previsión de la pantalla
y lo que hace el generador no puedan discrepar, y que llamar sólo a
`queSigueEnElCiclo()` discrepa con la madre recién cerrada y con el ciclo sin
arrancar.

- [ ] **Step 4: Correrlos y ver que pasan**

Run: `npx vitest run lib/mantenimiento/loQueHaraElCiclo.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Hacer que `generarEncadenadas` la use**

Reemplazar `generarEncadenadas.ts:156-237` por una llamada a
`loQueHaraElCiclo()` y, si vienen, persistir `arranque` y `corte` con los
mismos dos `update` de hoy y el mismo manejo de error (`r.fallaron.push` y
`continue`). `r.arrancados` se sigue empujando con lo que devuelve `arranque`.
**No cambia ninguna decisión.**

- [ ] **Step 6: Correr la suite entera**

Run: `npm test`
Expected: PASS. En particular los 34 de `lib/mantenimiento/cicloDeOT.test.ts` y
los de `generarEncadenadas` / `sincronizar`, **sin tocarlos**: si alguno pide
cambiar su expectativa, el refactor movió una decisión y hay que volver atrás.

- [ ] **Step 7: Commit**

```bash
git add lib/mantenimiento/loQueHaraElCiclo.ts lib/mantenimiento/loQueHaraElCiclo.test.ts lib/mantenimiento/generarEncadenadas.ts
git commit -m "refactor(mantenimiento): la decisión de un ciclo, en una función sola"
```

---

### Task 2: La sección, de sólo lectura

**Files:**
- Create: `app/(app)/mantenimiento/configuracion/LoQueCreaOrdenesSolo.tsx`
- Create: `lib/mantenimiento/configurarElCiclo.ts`
- Test: `lib/mantenimiento/configurarElCiclo.test.ts`
- Modify: `app/(app)/mantenimiento/configuracion/page.tsx`
- Modify: `app/(app)/mantenimiento/configuracion/ConfiguracionClient.tsx:60-90`

**Interfaces:**
- Consumes: `loQueHaraElCiclo()`, `LoQueHara` (Tarea 1) · `caraDeLaVuelta()`,
  `Decision` de `cicloDeOT.ts` · `ACCIONES_PREVENTIVAS` de `tareasPreventivas.ts`
- Produces:

```ts
// lib/mantenimiento/configurarElCiclo.ts
export function comoSeLeeLaDecision(d: Decision, tareas: { madre: string; hija: string }): string

/** Si el arranque automático puede ver esa madre: `pareceUnCambio` busca verbos
 *  de reemplazo, así que una madre que no se escriba así nace dormida. */
export function arrancaSolo(accionMadre: string): boolean

// app/(app)/mantenimiento/configuracion/LoQueCreaOrdenesSolo.tsx
export interface CicloDeLaSeccion {
  id: string; equipoId: string; equipoCode: string | null; equipoNombre: string | null;
  madre: string; hija: string; accionMadre: string; componente: string;
  repeticiones: number; periodoDias: number | null;
  especialidad: string | null; horasEstimadas: number | null;
  activo: boolean; desde: string | null; vueltaDesde: number | null;
  /** Ya calculada en el servidor con `loQueHaraElCiclo`. */
  decision: Decision;
}
export interface ProgramadoDeLaSeccion {
  id: string; equipo: string; cadaCuanto: string; proxima: string | null; estado: string;
}
export default function LoQueCreaOrdenesSolo(props: {
  ciclos: CicloDeLaSeccion[]; programados: ProgramadoDeLaSeccion[]; puedeEditar: boolean;
}): JSX.Element
```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
test("una decisión de crear se lee con la tarea, la cara y la fecha", () => {
  expect(comoSeLeeLaDecision({ que: "crear", vuelta: 2, fecha_ejecucion: "2026-11-27" },
    { madre: "Cambio de Martillos", hija: "Rotación de Martillos" }))
    .toBe("Crea «Rotación de Martillos» — a 3ª cara — para el 27/11/2026");
});

test("la vuelta 0 se lee con el nombre de la madre y sin cara", () => {
  expect(comoSeLeeLaDecision({ que: "crear", vuelta: 0, fecha_ejecucion: "2026-12-01" },
    { madre: "Cambio de Martillos", hija: "Rotación de Martillos" }))
    .toBe("Crea «Cambio de Martillos» para el 01/12/2026");
});

test("esperar nombra la orden", () => {
  expect(comoSeLeeLaDecision({ que: "esperar", ot: 3166 }, tareas)).toBe("Espera la OT 3166");
});

test("una madre escrita como reemplazo arranca sola", () => {
  expect(arrancaSolo("CAMBIO")).toBe(true);
});

test("una madre que el detector no puede ver no arranca sola", () => {
  expect(arrancaSolo("LIMPIEZA")).toBe(false);
  expect(arrancaSolo("REVISION")).toBe(false);
  expect(arrancaSolo("ROTACION")).toBe(false);
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/mantenimiento/configurarElCiclo.test.ts`
Expected: FAIL — las dos funciones no existen.

- [ ] **Step 3: Implementar las dos en `lib/mantenimiento/configurarElCiclo.ts`**

`comoSeLeeLaDecision` cubre las cuatro formas de `Decision` y usa `comoSeLee()`
de `lib/core/fechas.ts` para la fecha y `caraDeLaVuelta()` para la cara.

`arrancaSolo` decide **contra `pareceUnCambio()`**, no contra una lista de
claves escrita a mano: arma el texto de prueba con la etiqueta corta de la
acción más un componente de muestra y pregunta. Así el día que el regex de
`sospechaDeCambio.ts` cambie, esto lo sigue sin que haya dos listas. El
docstring dice eso.

- [ ] **Step 4: Correrlos y ver que pasan**

Run: `npx vitest run lib/mantenimiento/configurarElCiclo.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Traer los datos en `page.tsx`**

Agregar a las lecturas en paralelo: `mant_ciclos_de_ot` con el equipo y las dos
tareas embebidos (`equipos(id, code, name, is_active)`,
`madre:tarea_madre_id(nombre, componente, accion, periodo_dias)`,
`hija:tarea_hija_id(nombre, componente, accion, periodo_dias)`), las
`ordenes_trabajo` con `ciclo_id` no nulo (`traerTodo`), las cerradas de los
equipos de los ciclos sin arrancar, y `mantenimientos_programados` con su
equipo. Para cada ciclo, llamar `loQueHaraElCiclo()` y mandar la `decision` ya
resuelta. **Lecturas con el cliente de sesión**, como el resto de esa página.

- [ ] **Step 6: Dibujar la sección y montarla primera**

Una tarjeta por ciclo: equipo arriba, la frase «{hija} × {repeticiones}, y
después {madre}», los parámetros como texto, el estado (último trabajo, vuelta,
OT esperando) con enlace a `/mantenimiento/equipos/{equipoId}`, y la línea de
previsión con `comoSeLeeLaDecision`.

- Un ciclo con `activo = false` se dibuja en gris y dice «apagado, no genera
  órdenes». **No se esconde.**
- Un ciclo sin arrancar cuya madre no pase `arrancaSolo` dice «este ciclo no
  arranca solo: hay que arrancarlo desde la ficha del equipo cuando se haga el
  primer *{madre}*», con el enlace.
- Debajo, la lista de programados —equipo, cada cuánto, próxima, estado— con un
  enlace a `/mantenimiento/mantenimientos`.

En `ConfiguracionClient.tsx`, montarla **arriba de `<Operarios/>`**.

- [ ] **Step 7: Verificar**

Run: `npm test` y `npm run tipos`
Expected: PASS las dos. Y `node scripts/revisar-responsive.mjs` sin ROMPE nuevo
(el piso conocido es ROMPE 0 · MIRAR 1).

- [ ] **Step 8: Commit**

```bash
git add lib/mantenimiento/configurarElCiclo.ts lib/mantenimiento/configurarElCiclo.test.ts "app/(app)/mantenimiento/configuracion/LoQueCreaOrdenesSolo.tsx" "app/(app)/mantenimiento/configuracion/page.tsx" "app/(app)/mantenimiento/configuracion/ConfiguracionClient.tsx"
git commit -m "feat(mantenimiento): la sección que dice qué crea órdenes solo"
```

---

### Task 3: Editar los parámetros de un ciclo

**Files:**
- Create: `app/api/mantenimiento/ciclos/[id]/configuracion/route.ts`
- Modify: `lib/mantenimiento/configurarElCiclo.ts`
- Modify: `lib/mantenimiento/configurarElCiclo.test.ts`
- Modify: `app/(app)/mantenimiento/configuracion/LoQueCreaOrdenesSolo.tsx`

**Interfaces:**
- Produces:

```ts
export interface Parametros {
  periodo_dias?: number | null;
  repeticiones?: number;
  especialidad?: string | null;
  horas_estimadas?: number | null;
  activo?: boolean;
  /** Los usa la Tarea 4; acá sólo tienen que caber en el tipo. */
  tarea_madre_id?: string;
  tarea_hija_id?: string;
}

/** El ciclo como está hoy, que es contra lo que se validan los cambios. */
export interface CicloComoEsta {
  repeticiones: number;
  vuelta_desde: number | null;
  tarea_madre_id: string;
  tarea_hija_id: string;
}

/** Qué impide guardar estos parámetros. Vacío = se puede. */
export function loQueImpideGuardar(p: Parametros, ciclo: CicloComoEsta): string[]
```

- [ ] **Step 1: Escribir los tests que fallan**

Los dos primeros son los puntos 1 y 2 de Review Focus:

```ts
test("no se bajan las repeticiones por debajo de la vuelta en la que está", () => {
  expect(loQueImpideGuardar({ repeticiones: 2 }, { repeticiones: 3, vuelta_desde: 3 }))
    .toEqual(["El ciclo está en la vuelta 3, así que no puede repetirse menos de 3 veces."]);
});

test("un ciclo sin arrancar admite cualquier repetición válida", () => {
  expect(loQueImpideGuardar({ repeticiones: 1 }, { repeticiones: 3, vuelta_desde: null })).toEqual([]);
});

test("las repeticiones van de 1 a 20", () => {
  expect(loQueImpideGuardar({ repeticiones: 0 }, ciclo)).toHaveLength(1);
  expect(loQueImpideGuardar({ repeticiones: 21 }, ciclo)).toHaveLength(1);
});

test("el plazo va de 1 a 3650 días y no acepta texto", () => {
  expect(loQueImpideGuardar({ periodo_dias: 0 }, ciclo)).toHaveLength(1);
  expect(loQueImpideGuardar({ periodo_dias: 3651 }, ciclo)).toHaveLength(1);
  expect(loQueImpideGuardar({ periodo_dias: Number.NaN }, ciclo)).toHaveLength(1);
});

test("el plazo puede vaciarse, y eso deja el ciclo detenido", () => {
  expect(loQueImpideGuardar({ periodo_dias: null }, ciclo)).toEqual([]);
});

test("las horas estimadas no pueden ser negativas", () => {
  expect(loQueImpideGuardar({ horas_estimadas: -1 }, ciclo)).toHaveLength(1);
});

test("informa todos los problemas juntos y no de a uno", () => {
  expect(loQueImpideGuardar({ repeticiones: 0, periodo_dias: 0 }, ciclo)).toHaveLength(2);
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/mantenimiento/configurarElCiclo.test.ts`
Expected: FAIL — `loQueImpideGuardar is not a function`.

- [ ] **Step 3: Implementar `loQueImpideGuardar()`**

Devuelve todos los mensajes, en castellano, como hace `loQueFaltaParaArrancar`
de `arranqueDelCiclo.ts`. Los límites son los de los checks de la base, que es
lo que esto existe para no tocar nunca.

- [ ] **Step 4: Correrlos y ver que pasan**

Run: `npx vitest run lib/mantenimiento/configurarElCiclo.test.ts`
Expected: PASS.

- [ ] **Step 5: Escribir la ruta `PATCH`**

`app/api/mantenimiento/ciclos/[id]/configuracion/route.ts`, con el mismo molde
que `ciclos/[id]/route.ts`: sesión, `puedeEditarMantenimiento`, cliente admin,
el ciclo existe. Después `loQueImpideGuardar` → 400 con `error` juntando los
mensajes. Y dos escrituras:

- `periodo_dias` va a **`mant_tareas_preventivas` de la tarea hija**, nunca al
  ciclo. No hay columna que duplicar.
- lo demás va a `mant_ciclos_de_ot`.

El docstring dice que esta ruta no toca ninguna planilla ni ninguna OT.

- [ ] **Step 6: Hacer editable la tarjeta**

Cada campo guarda solo, al estilo de `RazonesDePostergacion`, con el `llamar()`
que `ConfiguracionClient` ya pasa hacia abajo. El plazo lleva al lado, en letra
chica, de qué tarea es y un enlace a `/mantenimiento/tareas-preventivas`.
`especialidad` es un `<Select>` de `ESPECIALIDADES` (de
`lib/mantenimiento/ordenes.ts`), el mismo vocabulario que el alta de una OT.
`activo` es un switch «Genera órdenes».

Debajo del plazo, la línea condicional de 5.2 —**en el cliente, con
`sumarDias`**—: «al cerrarse la OT {n}, la siguiente sería {N} días después», y
si no hay orden abierta, la fecha. Es lo único que reacciona al tipeo.

- [ ] **Step 7: Verificar**

Run: `npm test`, `npm run tipos`, `node scripts/revisar-exportaciones.mjs`
Expected: los dos primeros PASS. El tercero, **el mismo ROMPE 1 conocido**
(`lib/mantenimiento/altaDeOS.ts`) y ninguno más: si aparece otro, esta ruta
escribió una planilla sin declararse.

- [ ] **Step 8: Commit**

```bash
git add "app/api/mantenimiento/ciclos/[id]/configuracion/route.ts" lib/mantenimiento/configurarElCiclo.ts lib/mantenimiento/configurarElCiclo.test.ts "app/(app)/mantenimiento/configuracion/LoQueCreaOrdenesSolo.tsx"
git commit -m "feat(mantenimiento): se configuran el plazo y los parámetros de un ciclo"
```

---

### Task 4: Cambiar las dos tareas resetea el ciclo

**Files:**
- Modify: `app/api/mantenimiento/ciclos/[id]/configuracion/route.ts`
- Modify: `lib/mantenimiento/configurarElCiclo.ts`
- Modify: `lib/mantenimiento/configurarElCiclo.test.ts`
- Modify: `app/(app)/mantenimiento/configuracion/LoQueCreaOrdenesSolo.tsx`

**Interfaces:**
- Produces:

```ts
/** Lo que hay que escribirle al ciclo cuando se le cambia el par de tareas. */
export function elResetPorCambioDeTareas(
  p: Parametros,
  ciclo: CicloComoEsta
): { desde: null; vuelta_desde: null } | null
```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
test("cambiar la hija resetea el ciclo a sin arrancar", () => {
  expect(elResetPorCambioDeTareas({ tarea_hija_id: "b2" }, { tarea_madre_id: "a", tarea_hija_id: "b" }))
    .toEqual({ desde: null, vuelta_desde: null });
});

test("mandar las mismas tareas no resetea nada", () => {
  expect(elResetPorCambioDeTareas({ tarea_madre_id: "a", tarea_hija_id: "b" },
    { tarea_madre_id: "a", tarea_hija_id: "b" })).toBeNull();
});

test("no mandar tareas no resetea nada", () => {
  expect(elResetPorCambioDeTareas({}, { tarea_madre_id: "a", tarea_hija_id: "b" })).toBeNull();
});

test("la madre y la hija no pueden terminar siendo la misma", () => {
  expect(loQueImpideGuardar({ tarea_madre_id: "a", tarea_hija_id: "a" }, ciclo)).toHaveLength(1);
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/mantenimiento/configurarElCiclo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar, y engancharlo en la ruta**

`elResetPorCambioDeTareas` compara contra lo que el ciclo tiene hoy, no contra
la presencia del campo: mandar el mismo id no es un cambio.
`loQueImpideGuardar` suma la comprobación de que el par resultante no sea
`a === a` (Review Focus 4, por la punta de la edición).

En la ruta, el update de las tareas lleva `desde: null, vuelta_desde: null`
cuando el reset aplica. El docstring explica por qué: `desde` describe el par
viejo y «la 2ª rotación el 14/11» no quiere decir nada si la hija es otra
tarea.

- [ ] **Step 4: Correrlos y ver que pasan**

Run: `npx vitest run lib/mantenimiento/configurarElCiclo.test.ts`
Expected: PASS.

- [ ] **Step 5: El cambio de tareas en la tarjeta, con confirmación**

Dos `<Select>` con las tareas confirmadas de ese equipo, detrás de un
`useConfirm()` que diga exactamente qué pasa: *«Cambiar las tareas deja el
ciclo sin arrancar: se pierde que el último trabajo fue {…} el {…}, porque
describe las tareas viejas. ¿Seguimos?»*. El `ConfirmProvider` ya está montado
en `app/(app)/layout.tsx`.

- [ ] **Step 6: Verificar**

Run: `npm test` y `npm run tipos`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "app/api/mantenimiento/ciclos/[id]/configuracion/route.ts" lib/mantenimiento/configurarElCiclo.ts lib/mantenimiento/configurarElCiclo.test.ts "app/(app)/mantenimiento/configuracion/LoQueCreaOrdenesSolo.tsx"
git commit -m "feat(mantenimiento): cambiarle las tareas a un ciclo lo deja sin arrancar"
```

---

### Task 5: Armar un ciclo nuevo

**Files:**
- Create: `app/api/mantenimiento/ciclos/route.ts`
- Modify: `lib/mantenimiento/configurarElCiclo.ts`
- Modify: `lib/mantenimiento/configurarElCiclo.test.ts`
- Modify: `app/(app)/mantenimiento/configuracion/LoQueCreaOrdenesSolo.tsx`
- Modify: `app/(app)/mantenimiento/configuracion/page.tsx`

**Interfaces:**
- Produces:

```ts
export interface AltaDeCiclo {
  equipment_id: string; componente: string;
  accionMadre: string; nombreMadre: string;
  accionHija: string;  nombreHija: string;
  periodo_dias: number; repeticiones: number;
  especialidad: string | null; horas_estimadas: number | null;
}
/** Qué falta o qué está mal en el alta. Vacío = se puede. */
export function loQueFaltaParaArmar(datos: unknown): string[]

/** El mensaje de un choque contra un `unique` de la base, o null si no es eso. */
export function elMensajeDelChoque(error: { code?: string; message?: string }): string | null
```

- [ ] **Step 1: Escribir los tests que fallan**

Los dos últimos son Review Focus 4 y 5:

```ts
test("pide el equipo, el componente, las dos acciones, los dos nombres, el plazo y las repeticiones", () => {
  expect(loQueFaltaParaArmar({})).toHaveLength(8);
});

test("la acción tiene que estar en el vocabulario", () => {
  expect(loQueFaltaParaArmar({ ...alta, accionHija: "INVENTADA" })).toHaveLength(1);
});

test("la madre y la hija no pueden ser la misma acción sobre el mismo componente", () => {
  expect(loQueFaltaParaArmar({ ...alta, accionMadre: "CAMBIO", accionHija: "CAMBIO" }))
    .toEqual(["La tarea que se repite y la que cierra el ciclo tienen que ser distintas."]);
});

test("un componente escrito a mano es válido: 62 de los 269 equipos no tienen ninguno relevado", () => {
  expect(loQueFaltaParaArmar({ ...alta, componente: "Zaranda vibratoria" })).toEqual([]);
});

test("un equipo que ya tiene ciclo se contesta con una frase, no con el error de Postgres", () => {
  expect(elMensajeDelChoque({ code: "23505", message: 'duplicate key value violates unique constraint "mant_ciclos_de_ot_un_ciclo_por_equipo"' }))
    .toBe("Ese equipo ya tiene un ciclo. Si está apagado, se prende desde su tarjeta.");
});

test("un error que no es un choque no se traduce", () => {
  expect(elMensajeDelChoque({ code: "23503", message: "foreign key" })).toBeNull();
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/mantenimiento/configurarElCiclo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `loQueFaltaParaArmar()`**

Reusa `loQueImpideGuardar` para el plazo, las repeticiones y las horas, y suma
lo del alta: los obligatorios, la acción contra `ACCIONES_PREVENTIVAS`, y que
el par `(acción, componente)` de la madre y de la hija no coincida — que es la
forma en que `tarea_madre_id = tarea_hija_id` llegaría a la base.

`elMensajeDelChoque` existe para que el único camino que la validación **no
puede** cubrir —dos pestañas abiertas, o una página vieja— llegue como una
frase. Mira el nombre de la constraint en el mensaje, no sólo el `23505`.

- [ ] **Step 4: Correrlos y ver que pasan**

Run: `npx vitest run lib/mantenimiento/configurarElCiclo.test.ts`
Expected: PASS.

- [ ] **Step 5: Escribir la ruta `POST /api/mantenimiento/ciclos`**

Sesión, `puedeEditarMantenimiento`, cliente admin, `loQueFaltaParaArmar` → 400.
Después, en orden:

1. Por cada tarea, un `upsert` sobre `mant_tareas_preventivas` con
   `onConflict: "equipment_id,accion,componente"` que escriba `nombre`,
   `periodo_dias`, `estado: "CONFIRMADA"`, `decidido_por: user.id` y
   **`motivo: null`** — la regla de la ruta del catálogo, que lo explica donde
   está. La hija lleva el plazo; la madre va con `periodo_dias: null`, como la
   semilla.
2. El `insert` en `mant_ciclos_de_ot` con los dos ids, `repeticiones`,
   `especialidad`, `horas_estimadas`, `creado_por: user.id`, y `desde` /
   `vuelta_desde` **en null**.

Si el insert choca con `unique (equipment_id)` —Review Focus 3— devolver **409
con un mensaje que lo diga**: «Ese equipo ya tiene un ciclo. Si está apagado,
se prende desde su tarjeta.» No se deja salir el error de Postgres.

- [ ] **Step 6: El modal del alta**

`<Modal>` con `useBorrador`. Equipo: `<Select>` con los que **no** tienen ciclo
—la página ya los sabe—. Componente: `<Select>` de los de ese equipo más
«otro…» que muestra un campo de texto. Al completar equipo + acción +
componente de cualquiera de las dos tareas, si ya hay una fila en el catálogo
se carga y se muestra: «ya existe *{nombre}*, cada {n} días», con el nombre y
el plazo editables; si estaba `DESCARTADA`, lo dice y avisa que armar el ciclo
la vuelve a confirmar.

Al guardar, si la madre no pasa `arrancaSolo()`, el modal lo dice antes de
cerrar: **este ciclo no va a arrancar solo**.

- [ ] **Step 7: Verificar**

Run: `npm test`, `npm run tipos`, `node scripts/revisar-modales.mjs`
Expected: los dos primeros PASS; el tercero ROMPE 0 · MIRAR 0.

- [ ] **Step 8: Commit**

```bash
git add app/api/mantenimiento/ciclos/route.ts lib/mantenimiento/configurarElCiclo.ts lib/mantenimiento/configurarElCiclo.test.ts "app/(app)/mantenimiento/configuracion/LoQueCreaOrdenesSolo.tsx" "app/(app)/mantenimiento/configuracion/page.tsx"
git commit -m "feat(mantenimiento): se arma un ciclo nuevo desde la configuración"
```

---

### Task 6: Devolver los programados al menú

**Files:**
- Modify: `lib/core/nav.ts:132`

- [ ] **Step 1: Agregar la entrada**

Debajo de «Tareas preventivas»:
`{ label: "Mantenimientos programados", href: "/mantenimiento/mantenimientos", modulo: "mantenimiento" }`.

Un comentario al lado dice por qué estaba afuera y por qué vuelve: configura el
motor `periodicas`, nada en la app la enlazaba, y una pantalla a la que sólo se
llega tipeando la URL es una que no existe — medido el 24/11/2026, con **1**
programado en toda la base y cero OT nacidas de uno en toda la historia.

- [ ] **Step 2: Verificar**

Run: `npm test` y `npm run tipos`
Expected: PASS.

- [ ] **Step 3: Commit y push**

```bash
git add lib/core/nav.ts
git commit -m "feat(mantenimiento): los mantenimientos programados vuelven al menú"
git push
```

---

## Al terminar

- `npm test` · `npm run tipos` · `NODE_OPTIONS=--max-old-space-size=8192 npm run build`
- `node scripts/revisar-arbol-commiteado.mjs` antes de dar la tarea por buena.
- `node scripts/revisar-responsive.mjs` (piso conocido: ROMPE 0 · MIRAR 1) ·
  `node scripts/revisar-modales.mjs` (0 · 0) ·
  `node scripts/revisar-exportaciones.mjs` (piso conocido: ROMPE 1 · MIRAR 0).
- Y lo que ningún test puede dar: abrir `/mantenimiento/configuracion` con una
  sesión real y comprobar que la previsión de los cuatro ciclos dice lo mismo
  que `npx tsx scripts/que-haria-el-ciclo.mts`. Si discrepan, la Tarea 1 no
  quedó bien y la pantalla está tranquilizando sobre algo que no va a pasar.

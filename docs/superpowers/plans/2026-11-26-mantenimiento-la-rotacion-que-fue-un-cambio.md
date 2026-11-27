# La rotación que fue un cambio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que desde una OT de rotación abierta de un ciclo encadenado se pueda
decir «esto no fue una rotación, fue un cambio de martillos, el día tal» y que
de ahí salgan la OT del cambio, la rotación cancelada con su motivo y el ciclo
apuntando a la fecha correcta.

**Architecture:** Una ruta POST propia sobre la OT que hace todo del lado del
servidor en ocho pasos, con la lógica de validación y los dos textos en un
módulo puro aparte. El modal vive en el listado de órdenes, dentro de
`OTDetail`, como sus hermanos «Postergar» y «Mandar al calendario».

**Tech Stack:** Next.js 16 App Router, Supabase/PostgREST, Vitest,
TypeScript 5.9.3.

**Spec:** [docs/superpowers/specs/2026-11-26-mantenimiento-la-rotacion-que-fue-un-cambio-design.md](../specs/2026-11-26-mantenimiento-la-rotacion-que-fue-un-cambio-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Ninguna migración.** Todas las columnas que se usan ya existen.
- Un desplegable se escribe `<Select>` de `components/Select.tsx`, no `<select>`.
- Un modal se escribe `<Modal>` de `components/Modal.tsx`, con `useBorrador`:
  «Cancelar» tira, todo lo demás sale conservando.
- Una grilla de tres columnas lleva breakpoint: `grid-cols-1 sm:grid-cols-3`.
- `className="input w-20"` no mide 20: el ancho va en un `div` que envuelva al campo.
- Las cadenas de `select()` van **literales**, nunca armadas en una variable.
- Nada va como texto crudo a una celda: la prosa pasa por `textoParaLaCelda()`.
- El permiso de escritura es `puedeEditarMantenimiento`.
- `npm test` · `npm run tipos` (que es `tsc` con el heap puesto) ·
  `node scripts/revisar-exportaciones.mjs` tienen que quedar en verde.
  Ese último sale **ROMPE 1** de base por `lib/mantenimiento/altaDeOS.ts`, que
  ya estaba así en `main` y no es de este trabajo: lo que no tiene que crecer
  es ese número.
- `npm run build` en este worktree se corre
  `NODE_OPTIONS=--max-old-space-size=8192 npx next build --webpack` (el
  worktree no tiene `node_modules` propio y Turbopack rechaza el de afuera).

## Review Focus

Las cinco que el spec implica y que ningún test de las tareas tocaría solo. Cada
una tiene su test asignado abajo.

1. **La orden ya fue resuelta en otra pestaña.** Dos personas, o una con dos
   pestañas: el segundo POST no puede crear una segunda OT de cambio. → Tarea 1
   (`loQueImpideRegistrarElCambio` sobre una orden cerrada) y Tarea 2 (que no se
   escriba nada).
2. **El cuerpo miente sobre la orden.** Un POST armado a mano contra una OT sin
   `ciclo_id`, o contra la madre (`ciclo_vuelta: 0`): la ruta no puede confiar
   en que el cliente filtró. → Tarea 1.
3. **La fecha vacía, mal formada o futura.** → Tarea 1.
4. **Las horas no numéricas o negativas**, que escribirían basura en la columna
   O del master. → Tarea 1.
5. **El ciclo apagado (`activo: false`).** La orden abierta existe igual y hay
   que poder resolverla; mover el corte de un ciclo apagado no genera nada. →
   Tarea 2 (que el POST funcione igual y el corte quede movido).

---

## Estructura de archivos

| | |
|---|---|
| Crear | `lib/mantenimiento/cambioFueraDeTurno.ts` — las reglas y los dos textos, puro |
| Crear | `lib/mantenimiento/cambioFueraDeTurno.test.ts` |
| Crear | `app/api/mantenimiento/ordenes/[id]/fue-un-cambio/route.ts` — los ocho pasos |
| Crear | `lib/mantenimiento/rutaDeFueUnCambio.test.ts` — el cableado, con `supabaseDeMentira` |
| Crear | `app/(app)/mantenimiento/ordenes/FueUnCambioModal.tsx` |
| Modificar | `app/api/mantenimiento/ciclos/[id]/route.ts` — sumar `GET` |
| Modificar | `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx` — el botón y el modal en `OTDetail` |
| Modificar | `scripts/revisar-exportaciones.mjs` — declarar la ruta nueva |
| Modificar | `lib/mantenimiento/cicloDeOT.test.ts` — los dos escenarios del corte |
| Modificar | `docs/MANTENIMIENTO-INTEGRACION.md` — la sección del módulo |
| Modificar | `CLAUDE.md` — el renglón del índice |

---

### Task 1: Las reglas y los textos

**Files:**
- Create: `lib/mantenimiento/cambioFueraDeTurno.ts`
- Test: `lib/mantenimiento/cambioFueraDeTurno.test.ts`

**Interfaces:**
- Consumes: `caraDeLaVuelta` de `lib/mantenimiento/cicloDeOT.ts`; `comoSeLee` de
  `lib/core/fechas.ts`; `ESTADO_CANCELADA` de `lib/mantenimiento/cancelacion.ts`.
- Produces:

```ts
export interface RotacionAResolver {
  id: string;
  ot_number: number | null;
  ciclo_id: string | null;
  ciclo_vuelta: number | null;
  estado: string | null;
}

export interface CicloDelCambio {
  repeticiones: number;
  /** La fecha del último trabajo registrado. Es el piso de la fecha nueva. */
  desde: string | null;
  tareaMadre: string;
  tareaHija: string;
  componente: string;
}

export interface DatosDelCambio {
  fecha: unknown;
  horas?: unknown;
  operario_1?: unknown;
  operario_2?: unknown;
  operario_3?: unknown;
}

export function loQueImpideRegistrarElCambio(
  orden: RotacionAResolver,
  ciclo: CicloDelCambio,
  datos: DatosDelCambio,
  hoy: string,
): string[];

export function descripcionDelCambio(ciclo: CicloDelCambio, orden: RotacionAResolver): string;

export function elMotivoDeLaRotacion(
  ciclo: CicloDelCambio, fecha: string, otDelCambio: number,
): string;

/** Los `id` de las OT del ciclo que dejan de pertenecerle. */
export function lasQueSalenDelCiclo(
  ots: readonly { id: string; created_at_app: string | null }[],
  fechaDelCambio: string,
  yaResueltas: readonly string[],
): string[];
```

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/mantenimiento/cambioFueraDeTurno.test.ts`, con `describe`/`test` (este
repo usa `test`, no `it`, en los archivos que importan `{ describe, expect, test }`).

Una rotación válida de base: `{ id: "ot-rot", ot_number: 3150, ciclo_id: "c1", ciclo_vuelta: 3, estado: "ATRASADO" }`.
Un ciclo de base: `{ repeticiones: 3, desde: "2026-11-14", tareaMadre: "Cambio de Martillos", tareaHija: "Rotación de Martillos", componente: "Martillos" }`.
`hoy` = `"2026-11-26"`.

`loQueImpideRegistrarElCambio`:
- `"no dice nada cuando está todo bien"` → `[]` con `{ fecha: "2026-11-24" }`.
- `"la fecha es obligatoria"` → con `{ fecha: "" }`, un problema que incluye `"Falta decir cuándo"`.
- `"la fecha tiene que tener forma de fecha"` → `{ fecha: "24/11/2026" }` da un problema.
- `"una fecha futura no se acepta"` → `{ fecha: "2026-11-27" }` da un problema que incluye `"futura"`.
- `"una fecha anterior al último cambio nombra el piso"` → `{ fecha: "2026-11-13" }` da un problema que incluye `"14/11/2026"`.
- `"la fecha del último cambio sí se acepta"` → `{ fecha: "2026-11-14" }` → `[]`.
- `"una orden que no es de un ciclo no entra"` → `ciclo_id: null` da un problema.
- `"la madre no es una rotación"` → `ciclo_vuelta: 0` da un problema.
- `"una orden ya realizada no entra"` → `estado: "REALIZADO"` da un problema.
- `"una orden ya cancelada no entra"` → `estado: ESTADO_CANCELADA` da un problema.
- `"las horas tienen que ser un número"` → `{ fecha: "2026-11-24", horas: "cuatro" }` da un problema.
- `"las horas no pueden ser negativas"` → `{ fecha: "2026-11-24", horas: -1 }` da un problema.
- `"sin horas no hay problema"` → `{ fecha: "2026-11-24" }` y `{ fecha: "2026-11-24", horas: "" }` → `[]`.
- `"informa todos los problemas juntos"` → `ciclo_vuelta: 0` y `{ fecha: "" }` → `length === 2`.
- `"un ciclo sin arrancar no pone piso"` → `desde: null`, `{ fecha: "2020-01-01" }` → `[]`.

`descripcionDelCambio`:
- `"nombra la cara, la vuelta y la OT que se cancela"` →
  `"Cambio de Martillos — se hizo antes de la rotación a 4ª cara (3 de 3), que quedó cancelada en la OT 3150."`
- `"sin número de OT no inventa uno"` → con `ot_number: null`, el texto termina en
  `"que quedó cancelada."`

`elMotivoDeLaRotacion`:
- `"dice el día y nombra la orden del cambio"` → con fecha `"2026-11-24"` y OT 3211 →
  `"Los martillos se cambiaron el 24/11/2026, antes de que tocara esta rotación. Quedó registrado en la OT 3211 y esta orden ya no corresponde."`

`lasQueSalenDelCiclo`:
- `"saca las nacidas el día del cambio o después"` → con
  `[{id:"a",created_at_app:"2026-11-13T10:00:00Z"},{id:"b",created_at_app:"2026-11-24T09:00:00Z"},{id:"c",created_at_app:"2026-11-25T09:00:00Z"}]`,
  fecha `"2026-11-24"`, sin exclusiones → `["b","c"]`.
- `"no saca las que ya se resolvieron"` → lo mismo con `["b"]` → `["c"]`.
- `"una sin created_at_app se queda"` → `created_at_app: null` no aparece.

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `npx vitest run lib/mantenimiento/cambioFueraDeTurno.test.ts`
Expected: FAIL — `Failed to resolve import "./cambioFueraDeTurno"` o
`loQueImpideRegistrarElCambio is not a function`.

- [ ] **Step 3: Escribir `lib/mantenimiento/cambioFueraDeTurno.ts`**

Las cuatro funciones con las firmas de arriba. Decisiones que el test no fija y
el spec sí:

- La fecha válida es `/^\d{4}-\d{2}-\d{2}$/` comparada como cadena, que es lo
  que ya hace el resto del módulo con las fechas ISO.
- «Cerrada» es `REALIZADO` o `ESTADO_CANCELADA`, comparado contra `estado`.
- `lasQueSalenDelCiclo` compara `created_at_app.slice(0, 10) >= fechaDelCambio`,
  que es el mismo recorte por día que usa `laUltimaEnRango`.
- El encabezado del archivo explica **por qué la ruta mueve el corte y
  desengancha** — los dos finales malos de la sección «Por qué el corte lo mueve
  esta ruta» del spec, resumidos—, porque es la única parte de este trabajo que
  no se deduce leyendo el código.

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run lib/mantenimiento/cambioFueraDeTurno.test.ts`
Expected: PASS

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: PASS, sin archivos en FAIL

- [ ] **Step 6: Commit**

```bash
git add lib/mantenimiento/cambioFueraDeTurno.ts lib/mantenimiento/cambioFueraDeTurno.test.ts
git commit -m "feat(mantenimiento): las reglas de registrar un cambio fuera de turno"
```

---

### Task 2: La ruta

**Files:**
- Create: `app/api/mantenimiento/ordenes/[id]/fue-un-cambio/route.ts`
- Create: `lib/mantenimiento/rutaDeFueUnCambio.test.ts`
- Modify: `scripts/revisar-exportaciones.mjs`
- Modify: `lib/mantenimiento/cicloDeOT.test.ts`

**Interfaces:**
- Consumes: todo lo que produce la Tarea 1; y del árbol: `altaEnLaPlanilla`
  (`lib/mantenimiento/formulario.ts`), `loQueHayQueExportar`
  (`lib/mantenimiento/cierreDeOT.ts`), `celdasParaRegistrar`
  (`lib/mantenimiento/ordenes.ts`), `escribirEnLaFilaDeLaOT`
  (`lib/mantenimiento/planillaDeOT.ts`), `elPendienteDelIntento`
  (`lib/mantenimiento/pendienteDeLaOT.ts`), `celdaDeObservacionPrevia`
  (`lib/mantenimiento/notas.ts`), `borrarLosEventosDeLasOT`
  (`lib/agenda/elEventoSigueALaOT.ts`), `hoyEnArgentina` (`lib/core/fechas.ts`),
  `cuerpoJson` (`lib/core/cuerpo.ts`), `puedeEditarMantenimiento`.
- Produces: `POST /api/mantenimiento/ordenes/<id>/fue-un-cambio`.
  Cuerpo: `{ fecha, horas?, operario_1?, operario_2?, operario_3? }`.
  Respuesta 201: `{ data: { ot_number, cancelada }, planilla_error, calendario_error }`.
  Errores: 401 sin sesión · 403 sin permiso · 404 si la orden no existe ·
  400 con `{ error: <problemas unidos por un espacio> }` · 500 con el mensaje de
  la base.

- [ ] **Step 1: Escribir el test de ruta que falla**

En `lib/mantenimiento/rutaDeFueUnCambio.test.ts`, con el molde de
`lib/mantenimiento/rutaDeCiclos.test.ts`: `supabaseDeMentira`, `vi.mock` de
`@/lib/supabase/server`, `@/lib/supabase/admin` y `@/lib/mantenimiento/auth`.
Además hay que mockear lo que habla con Google y con la planilla:

```ts
const google = { alta: { ok: true, ot_number: 3211 } as any, planilla: null as string | null, borrado: new Map<string, string>() };
vi.mock("@/lib/mantenimiento/formulario", () => ({ altaEnLaPlanilla: async () => google.alta }));
vi.mock("@/lib/mantenimiento/planillaDeOT", () => ({ escribirEnLaFilaDeLaOT: async () => google.planilla }));
vi.mock("@/lib/agenda/elEventoSigueALaOT", () => ({ borrarLosEventosDeLasOT: async () => google.borrado }));
```

Estado de base: un ciclo `c1` (`repeticiones: 3`, `desde: "2026-11-14"`,
`activo: true`), sus dos tareas, y tres OT con `ciclo_id: "c1"` — la hija 1 y la
2 cerradas (`created_at_app` en `2026-11-14` y `2026-11-18`) y la hija 3 abierta
(`ot-rot`, `ot_number: 3150`, `created_at_app: "2026-11-22T10:00:00Z"`).

Los tests:

- `"crea la OT del cambio dentro del ciclo, cerrada y con la fecha que se dijo"` —
  POST con `{ fecha: "2026-11-24", horas: 4 }`; la fila nueva de
  `ordenes_trabajo` tiene `ciclo_id: "c1"`, `ciclo_vuelta: 0`,
  `estado: "REALIZADO"`, `fecha_cierre: "2026-11-24"`,
  `fecha_ejecucion: "2026-11-24"`, `quien: "INTERNO"`, `horas: 4`,
  `app_created: true`.
- `"sin horas la orden nace con horas en null"` — POST sin `horas`; la fila nueva
  tiene `horas: null`, **no** las `horas_estimadas` del ciclo.
- `"deja el motivo escrito antes de cancelar, y si la nota no entra no cancela nada"` —
  con `alInsertar` devolviendo error para `ordenes_trabajo_notas`: respuesta 500,
  `ot-rot` sigue con su estado original y con `ciclo_id: "c1"`.
- `"cancela la rotación y la saca del ciclo"` — `ot-rot` queda con
  `estado: ESTADO_CANCELADA` y `ciclo_id: null`.
- `"mueve el corte del ciclo a la fecha del cambio"` — `mant_ciclos_de_ot` queda
  con `desde: "2026-11-24"` y `vuelta_desde: 0`.
- `"desengancha las órdenes del ciclo nacidas desde el cambio, y no las otras"` —
  con la fecha `"2026-11-18"`: la hija 2 queda con `ciclo_id: null`, la hija 1 se
  queda con `ciclo_id: "c1"`, y la OT nueva también.
- `"si la planilla no acepta el alta, no se tocó nada"` — con
  `google.alta = { ok: false, error: "la planilla está calculando" }`: respuesta
  500, no hay fila nueva en `ordenes_trabajo`, `ot-rot` intacta y el ciclo con su
  `desde` viejo.
- `"una orden ya cancelada se rechaza con 400 y no escribe nada"` — con `ot-rot`
  en `ESTADO_CANCELADA`: 400 y el conteo de `ordenes_trabajo` no cambia.
  *(Review Focus 1.)*
- `"una orden que no es de un ciclo se rechaza con 400"` — `ciclo_id: null`.
  *(Review Focus 2.)*
- `"con el ciclo apagado funciona igual"` — `activo: false`: 201 y el corte
  movido. *(Review Focus 5.)*
- `"un borrado de evento que falla no voltea nada"` — con
  `google.borrado = new Map([["ot-rot", "Google no contesta"]])`: 201, la orden
  nueva existe, `ot-rot` cancelada, y `calendario_error` lo nombra.

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run lib/mantenimiento/rutaDeFueUnCambio.test.ts`
Expected: FAIL — no existe el módulo de la ruta.

- [ ] **Step 3: Escribir la ruta**

`export async function POST(request: Request, { params }: Params)` con
`type Params = { params: Promise<{ id: string }> }`, en los ocho pasos de la
sección «Qué hace, en orden» del spec y en ese orden exacto. El encabezado del
archivo explica **por qué el alta va primero** (los dos finales partidos no
cuestan lo mismo) y **por qué el calendario va último**.

Para armar el `CicloDelCambio` y los datos de la orden nueva hace falta leer, con
el cliente admin y cadenas literales: la OT por `id`, su ciclo por `ciclo_id`
con las dos tareas embebidas —**el embed lleva el FK explícito**,
`madre:mant_tareas_preventivas!mant_ciclos_de_ot_tarea_madre_id_fkey(...)` y su
gemelo de la hija, porque hay dos caminos entre esas dos tablas—, el equipo con
su sector, y las OT del ciclo (`ot_number, created_at_app`) para
`lasQueSalenDelCiclo`.

La fila nueva se arma con la forma que ya usa `generarEncadenadas.ts` en su paso
2, cambiando: `ciclo_vuelta: 0`, `estado: "REALIZADO"`, `fecha_cierre` y
`fecha_ejecucion` en la fecha del cambio, `horas` lo que vino, los tres
operarios, y `descripcion` de `descripcionDelCambio`.

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run lib/mantenimiento/rutaDeFueUnCambio.test.ts`
Expected: PASS

- [ ] **Step 5: Fijar lo que el ciclo decide después**

En `lib/mantenimiento/cicloDeOT.test.ts`, un `describe` nuevo —
`"después de registrar un cambio fuera de turno"` — con el estado que deja la
ruta: ciclo `{ repeticiones: 3, periodo_dias: 6, desde: C, vuelta_desde: 0 }` y
**una sola** OT del ciclo, la madre nueva (`ciclo_vuelta: 0`, `REALIZADO`,
`fecha_cierre: C`, `created_at_app` de hoy). Dos escenarios, que son los dos
finales malos del spec:

- `"con el cambio en la misma fecha que el corte viejo, crea la rotación 1"` —
  `C` igual al `desde` anterior: `queSigueEnElCiclo` → `{ que: "crear", vuelta: 1, fecha_ejecucion: C + 6 }`
  y `elCorteQueSigue` → `null`.
- `"con una hija vieja todavía en el ciclo, volvería a crear la vuelta siguiente"` —
  el mismo estado **más** una hija 2 cerrada con `created_at_app` posterior a `C`:
  `queSigueEnElCiclo` → `{ que: "crear", vuelta: 3, … }`. Este test **no** prueba
  un arreglo: documenta por qué el paso 6 de la ruta tiene que desengancharla, y
  su nombre lo dice.

Estos tests pasan desde el primer momento, porque ejercitan funciones que ya
existen. Eso es lo que son: el candado sobre la afirmación central del diseño.
Van con un comentario que lo diga, para que nadie los lea como TDD mal hecho.

Run: `npx vitest run lib/mantenimiento/cicloDeOT.test.ts`
Expected: PASS

- [ ] **Step 6: Declarar la ruta en el registro de exportaciones**

En `scripts/revisar-exportaciones.mjs`, una entrada para
`app/api/mantenimiento/ordenes/[id]/fue-un-cambio/route.ts` con
`estrategia: "cola"` y el porqué: escribe dos filas de la planilla y las dos
anotan `sheets_pendiente` con `elPendienteDelIntento`.

Run: `node scripts/revisar-exportaciones.mjs`
Expected: `ROMPE 1 · MIRAR 0` — el mismo 1 de antes (`altaDeOS.ts`), no dos.

- [ ] **Step 7: Correr la suite y los tipos**

Run: `npm test` y `npm run tipos`
Expected: PASS las dos

- [ ] **Step 8: Commit**

```bash
git add app/api/mantenimiento/ordenes/\[id\]/fue-un-cambio/route.ts lib/mantenimiento/rutaDeFueUnCambio.test.ts lib/mantenimiento/cicloDeOT.test.ts scripts/revisar-exportaciones.mjs
git commit -m "feat(mantenimiento): registrar el cambio que reemplazó a una rotación"
```

---

### Task 3: El GET del ciclo, el modal y el botón

**Files:**
- Modify: `app/api/mantenimiento/ciclos/[id]/route.ts`
- Create: `app/(app)/mantenimiento/ordenes/FueUnCambioModal.tsx`
- Modify: `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx`

**Interfaces:**
- Consumes: la ruta de la Tarea 2; `Modal`/`PieDeModal`, `useBorrador`,
  `claveDelBorrador`, `Select`, `avisoDelPendiente`, `laOTEstaCerrada`
  (`lib/agenda/evento.ts`).
- Produces: `GET /api/mantenimiento/ciclos/<id>` →
  `{ data: { id, repeticiones, desde, tareaMadre, tareaHija, componente } }`,
  con `puedeEditarMantenimiento`, 401 / 403 / 404 como la ruta hermana.

- [ ] **Step 1: Sumar el `GET` a `app/api/mantenimiento/ciclos/[id]/route.ts`**

Junto al `PATCH` que ya está. Devuelve lo de arriba, con el embed de las dos
tareas por su FK explícito. Es lo que el modal necesita para titularse con el
nombre real de la tarea madre y para mostrar el piso de la fecha.

- [ ] **Step 2: Escribir `FueUnCambioModal.tsx`**

```tsx
export default function FueUnCambioModal({ orden, onCerrar, onRegistrado }: {
  orden: { id: string; ot_number: number | null; ciclo_id: string; ciclo_vuelta: number; equipo_raw: string | null; descripcion: string | null };
  onCerrar: () => void;
  onRegistrado: () => void;
})
```

- Al montarse, dos `fetch`: `/api/mantenimiento/ciclos/${orden.ciclo_id}` y
  `/api/mantenimiento/operarios` (que devuelve `{ id, slot, nombre }[]`, una
  lista por posición). Mientras no llegue el ciclo, el modal dice que está
  cargando y no deja guardar.
- `useBorrador(claveDelBorrador("mantenimiento-fue-un-cambio", { tipo: "ot", id: orden.id }), { cuando: "", horas: "", operario_1: "", operario_2: "", operario_3: "" })`.
  **`cuando` arranca vacío**, nunca en hoy: el porqué está en el spec y es el
  mismo que ya tiene `RegistrarOTModal`.
- Un párrafo arriba que diga qué va a pasar, con las dos órdenes nombradas: que
  se crea la orden del cambio y que la OT #N queda cancelada con el motivo
  escrito.
- Debajo del campo de fecha, el piso en texto chico: «El último cambio
  registrado es del …».
- Los tres operarios con `<Select>`, filtrando la lista por `slot`.
- El botón positivo dice «Registrar el cambio» y está deshabilitado mientras
  `cuando` esté vacío o mientras se guarda. El negativo se llama **«Descartar»**
  y es el único que llama a `tirar()`.
- Al volver en verde: `tirar()` **antes** de mirar el aviso de la planilla; si
  `planilla_error` o `calendario_error` vienen con algo, se muestra el aviso con
  un «Entendido» que llama a `onRegistrado`, igual que `CancelarOTModal`.

- [ ] **Step 3: Sumar el botón en `OTDetail`**

En `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx`, dentro de `OTDetail`:
un `useState` local `fueUnCambio`, el botón en la misma barra de acciones que
«Repuestos que hacen falta» y «Postergar», con el mismo `className`, y el modal
renderizado junto a `PostergarOTModal`. La condición:

```tsx
{canEdit && o.ciclo_id && (o.ciclo_vuelta ?? 0) > 0 && !laOTEstaCerrada(o) && (
```

`onRegistrado` llama a `onPostergada?.()`, que es el `load` del listado — el
mismo refresco que ya usa `PostergarOTModal`.

- [ ] **Step 4: Comprobar los tipos y el build**

Run: `npm run tipos`
Expected: PASS

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx next build --webpack`
Expected: `Compiled successfully`

- [ ] **Step 5: Comprobar lo que el escaneo puede ver**

Run: `node scripts/revisar-responsive.mjs`
Expected: `ROMPE 0 · APRETADO 0 · MIRAR 1` — el mismo 1 de base (la `<table>` de
`calidad/ensayos/reporte`), no dos.

Run: `node scripts/revisar-modales.mjs`
Expected: `ROMPE 0 · MIRAR 0`

- [ ] **Step 6: Correr la suite entera**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/mantenimiento/ciclos/\[id\]/route.ts app/\(app\)/mantenimiento/ordenes/FueUnCambioModal.tsx app/\(app\)/mantenimiento/ordenes/OrdenesClient.tsx
git commit -m "feat(mantenimiento): el boton «Fue un cambio» en la OT de rotación"
```

---

### Task 4: El documento del módulo

**Files:**
- Modify: `docs/MANTENIMIENTO-INTEGRACION.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Escribir la sección**

En `docs/MANTENIMIENTO-INTEGRACION.md`, una sección
`## La rotación que resultó ser un cambio`, con lo que no se deduce del código:
que el corte lo mueve la ruta y por qué no alcanza con dejárselo al generador;
que no se pide ni contratista ni observaciones, con las dos mediciones (74 de 74
INTERNO; la celda W no se puede escribir en una orden recién creada); que las
horas van vacías porque la orden nace cerrada; y que el borrado del evento es a
mano porque `CANCELADA` no borra nada sola — con la nota de que la cancelación
normal sigue sin hacerlo.

- [ ] **Step 2: Sumar el renglón al índice de `CLAUDE.md`**

Una fila en la tabla de Mantenimiento, con el enlace a la sección, al spec y a
este plan, y las tres cosas que no se deducen del código, en el estilo de sus
vecinas.

- [ ] **Step 3: Commit**

```bash
git add docs/MANTENIMIENTO-INTEGRACION.md CLAUDE.md
git commit -m "docs(mantenimiento): la rotación que resultó ser un cambio"
```

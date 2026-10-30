# Preguntarle a Compras por un repuesto — Plan de implementación

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: usar
> `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans` para implementar tarea por tarea. Los pasos van
> con casilla (`- [ ]`) para poder tacharlos.

**Goal:** Que Mantenimiento pueda preguntarle a Compras por un repuesto que
falta, desde la OT, y que la pregunta y la respuesta queden en el historial de
esa misma orden.

**Architecture:** La conversación **no es una tabla nueva**: son filas de
`ordenes_trabajo_notas` con un `tipo`. Así se leen en una sola línea de tiempo
sin unir nada, y las dos cosas que ya miran esa tabla —el cartel «Sin
justificar» y la columna X de la planilla— siguen funcionando solas, que es
justo lo que el spec decidió al declarar que preguntar ya es explicar. Compras
contesta desde una pantalla propia; la ruta de respuesta valida acceso a
Compras en vez de nivel de Mantenimiento.

**Tech Stack:** Next.js 16 (App Router, Route Handlers), Supabase/PostgREST,
vitest, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-10-26-mantenimiento-preguntar-a-compras-design.md](../specs/2026-10-26-mantenimiento-preguntar-a-compras-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- Conventional commits en castellano. El cuerpo explica **por qué**.
- **Nunca `git add -A`**: agregar los archivos por nombre.
- La migración la corre **una persona** en el editor SQL de Supabase. El agente
  la escribe y **queda a la espera**; no puede correr DDL.
- El archivo de migración se crea con `npm run migracion "descripcion corta"`
  (marca de tiempo, no contador).
- Un `select()` de Supabase va **literal**, nunca armado en una variable.
- Una policy nueva llama a su función envuelta: `using ((select mant_puede_ver()))`.
- Lo que va a una celda de planilla pasa por `textoParaLaCelda()`.
- Los desplegables se escriben `<Select>`, no `<select>`.
- Una grilla de tres columnas lleva breakpoint (`grid-cols-1 sm:grid-cols-3`).
- El payload de un push es plano: `{title, body, url}`, la `url` en el primer nivel.
- Verificación antes de dar por buena una tarea: `npm test`, `npx tsc --noEmit`,
  `npm run build`, `node scripts/revisar-arbol-commiteado.mjs`,
  `node scripts/revisar-responsive.mjs`.

## Review Focus

Cinco cosas que el spec implica, que ninguna tarea probaría por su cuenta, y que
le van a morder a alguien. Cada una tiene su test asignado a la tarea que es
dueña del código.

1. **La lista `compras_consultados` vacía.** Se puede preguntar igual, pero no
   interrumpe a nadie: eso **se dice** en la respuesta, no se calla. (Tarea 5)
2. **El texto de la pregunta empieza con `=`, `+`, `-` o `@`.** Va a la columna X
   con `USER_ENTERED`: sin `textoParaLaCelda()` se vuelve fórmula, que es lo que
   el 19/10 dejó once pestañas en blanco. (Tarea 5)
3. **Dos personas contestan la misma pregunta.** La segunda no puede romper ni
   duplicar el hilo: la pregunta deja de estar abierta con la primera. (Tarea 2)
4. **La OT pasa a `REALIZADO` con una pregunta abierta.** Deja de estar abierta
   —no espera nada— pero **no desaparece del historial**. (Tarea 2)
5. **El push falla o la persona no tiene aparatos.** La respuesta ya se guardó;
   un envío que falla no puede voltearla. (Tarea 6)

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<ts>_mantenimiento_preguntar_a_compras.sql` | `tipo`, `repuesto_id` y `responde_a` en `ordenes_trabajo_notas`; tabla `compras_consultados`; RLS. |
| `lib/mantenimiento/consultaDeRepuesto.ts` | Puro: los tres tipos, qué pregunta sigue abierta, el texto del push. |
| `lib/core/avisoAlInstante.ts` | Parametrizar la frase, que hoy dice «espera tu aprobación» a mano. |
| `lib/core/avisoAUnaPersona.ts` | Push puntual a una sola persona (la respuesta al que preguntó). |
| `lib/compras/auth.ts` | `consultadosDeCompras()`, gemela de `aprobadoresDeCompras()`. |
| `app/api/mantenimiento/ordenes/[id]/notas/route.ts` | El POST acepta una pregunta y manda el push a Compras. |
| `app/api/compras/consultas/route.ts` | GET las abiertas · POST la respuesta. |
| `app/(app)/compras/consultas/page.tsx` + `ConsultasClient.tsx` | La bandeja de Facundo. |
| `app/(app)/mantenimiento/ordenes/RepuestosOTModal.tsx` | El botón «Preguntar a Compras». |
| `app/(app)/mantenimiento/ordenes/JustificacionOT.tsx` | La línea de tiempo distingue pregunta de respuesta. |
| `lib/home/avisos.ts` + `lib/home/avisosDeUsuario.ts` | La línea del resumen diario. |
| `app/(app)/compras/configuracion/ConfiguracionClient.tsx` | Administrar la lista. |

---

### Tarea 1: La migración

**Files:**
- Create: `supabase/migrations/<ts>_mantenimiento_preguntar_a_compras.sql`

**Interfaces:**
- Produces: columnas `tipo`, `repuesto_id`, `responde_a` en
  `ordenes_trabajo_notas`; tabla `compras_consultados (usuario_id uuid primary
  key references usuarios(id) on delete cascade, created_at timestamptz)`.

- [ ] **Step 1: Crear el archivo**

Run: `npm run migracion "mantenimiento preguntar a compras"`

- [ ] **Step 2: Escribir el DDL**

```sql
alter table ordenes_trabajo_notas
  add column if not exists tipo text not null default 'JUSTIFICACION'
    check (tipo in ('JUSTIFICACION', 'PREGUNTA', 'RESPUESTA')),
  add column if not exists repuesto_id uuid
    references ordenes_trabajo_repuestos(id) on delete set null,
  add column if not exists responde_a uuid
    references ordenes_trabajo_notas(id);

create table if not exists compras_consultados (
  usuario_id uuid primary key references usuarios(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table compras_consultados enable row level security;
```

`on delete set null` en `repuesto_id` y **no cascade**: sacar un repuesto de la
lista no puede borrar la conversación que hubo sobre él.

Y `responde_a` **sin `on delete`**: con cascade, quien preguntó podía borrar su
pregunta —la ruta de notas deja borrar la propia— y llevarse la respuesta de
Compras. El límite lo pone la base, así que ninguna ruta se lo puede olvidar.
Borrar la OT entera sigue andando por el cascade de `orden_id`. El `default
'JUSTIFICACION'` es lo que deja intactas las filas que ya existen.

Las policies de `compras_consultados` copian las de `compras_aprobadores`
(lectura para autenticados, escritura para quien administra Compras), con las
llamadas **envueltas en un `select`**. No hace falta tocar las policies de
`ordenes_trabajo_notas`: todas las escrituras pasan por rutas que usan el
cliente admin y comprueban el permiso ellas mismas — y la ausencia de policy de
`update` se conserva, porque este diseño **no actualiza ninguna nota**.

- [ ] **Step 3: Encabezado de la migración**

Explicar por qué la conversación vive en `ordenes_trabajo_notas` y no en una
tabla propia (una sola línea de tiempo; el cartel «Sin justificar» y la columna
X siguen andando solos), y por qué no hay columna de "cerrada": se deriva.

- [ ] **Step 4: Commit y quedar a la espera**

```bash
git add supabase/migrations/<ts>_mantenimiento_preguntar_a_compras.sql
git commit -m "feat(mantenimiento): esquema para preguntarle a Compras por un repuesto"
```

**Decirle al usuario que la corra y esperar.** Las tareas 5 a 8 no andan sin
esto; las 2, 3 y 4 sí.

---

### Tarea 2: Qué pregunta sigue abierta

**Files:**
- Create: `lib/mantenimiento/consultaDeRepuesto.ts`
- Test: `lib/mantenimiento/consultaDeRepuesto.test.ts`

**Interfaces:**
- Produces:
  - `export const TIPOS_DE_NOTA = ["JUSTIFICACION", "PREGUNTA", "RESPUESTA"] as const`
  - `export type TipoDeNota = (typeof TIPOS_DE_NOTA)[number]`
  - `export interface NotaDeLaOT { id: string; tipo: TipoDeNota; texto: string; creado_en: string; creado_por: string | null; repuesto_id: string | null; responde_a: string | null }`
  - `export function preguntasAbiertas(notas: readonly NotaDeLaOT[], estadoDeLaOrden: string | null): NotaDeLaOT[]`
  - `export function tieneRespuesta(pregunta: NotaDeLaOT, notas: readonly NotaDeLaOT[]): boolean`
  - `export function preguntaAbiertaDelRepuesto(notas: readonly NotaDeLaOT[], repuestoId: string, estadoDeLaOrden: string | null): NotaDeLaOT | null`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
const pregunta = (p: Partial<NotaDeLaOT> = {}): NotaDeLaOT => ({
  id: "n1", tipo: "PREGUNTA", texto: "¿Qué pasa con el rodamiento?",
  creado_en: "2026-10-29T10:00:00Z", creado_por: "u1",
  repuesto_id: "r1", responde_a: null, ...p,
});

it("una pregunta sin respuesta, sobre una OT abierta, esta abierta", () => {
  expect(preguntasAbiertas([pregunta()], "POR_HACER"))
    .toHaveLength(1);
});

it("con una respuesta deja de estar abierta", () => {
  const r = pregunta({ id: "n2", tipo: "RESPUESTA", responde_a: "n1" });
  expect(preguntasAbiertas([pregunta(), r], "POR_HACER"))
    .toEqual([]);
});

// Review Focus 3: dos respuestas no rompen ni duplican.
it("dos respuestas a la misma pregunta la cierran una sola vez", () => {
  const r1 = pregunta({ id: "n2", tipo: "RESPUESTA", responde_a: "n1" });
  const r2 = pregunta({ id: "n3", tipo: "RESPUESTA", responde_a: "n1" });
  expect(preguntasAbiertas([pregunta(), r1, r2], "ATRASADO"))
    .toEqual([]);
});

// Review Focus 4: la OT realizada ya no espera nada.
it("una OT realizada no tiene preguntas abiertas", () => {
  expect(preguntasAbiertas([pregunta()], "REALIZADO"))
    .toEqual([]);
});

// `repuesto_id` en null en una PREGUNTA significa que sacaron ese repuesto:
// la FK es `on delete set null`, y T5 exige el id al preguntar.
it("si sacaron el repuesto, la pregunta deja de estar abierta", () => {
  expect(preguntasAbiertas([pregunta({ repuesto_id: null })], "POR_HACER")).toEqual([]);
});

it("una justificacion no es una pregunta", () => {
  expect(preguntasAbiertas([pregunta({ tipo: "JUSTIFICACION" })], "POR_HACER"))
    .toEqual([]);
});

// Conflicto 2 del barrido previo: el hilo que agrega T5 no puede dejar dos
// abiertas diciendo lo mismo en la bandeja de Facundo.
it("una pregunta superada por otra del mismo hilo no esta abierta", () => {
  const seguimiento = pregunta({ id: "n2", tipo: "PREGUNTA", responde_a: "n1" });
  expect(preguntasAbiertas([pregunta(), seguimiento], "POR_HACER").map((p) => p.id))
    .toEqual(["n2"]);
});

// Una pregunta abierta por repuesto: el boton no abre la segunda.
it("dice si ese repuesto ya tiene una pregunta esperando", () => {
  expect(preguntaAbiertaDelRepuesto([pregunta()], "r1", "POR_HACER"))
    .toMatchObject({ id: "n1" });
  expect(preguntaAbiertaDelRepuesto([pregunta()], "r2", "POR_HACER")).toBeNull();
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/mantenimiento/consultaDeRepuesto.test.ts`
Expected: FAIL, "preguntasAbiertas is not a function".

- [ ] **Step 3: Implementar**

`preguntasAbiertas` filtra `tipo === "PREGUNTA"` y descarta: las que tienen una
`RESPUESTA` apuntándolas, las superadas por otra `PREGUNTA` del mismo hilo, las
de una OT `REALIZADO`, y **las que tienen `repuesto_id` en null** — la FK es
`on delete set null` y T5 exige el id al preguntar, así que un null quiere decir
que sacaron ese repuesto de la lista. No hace falta recibir qué repuestos siguen
vigentes: un id no nulo siempre apunta a una fila viva.

El docstring tiene que decir **por qué no hay columna `cerrada_en`**: el
historial no tiene policy de `update` a propósito —«un historial que se puede
reescribir no es un historial»— y una pregunta cerrada por el sistema que
escribiera una fila terminaría en la columna X de la planilla diciendo «quedó
sin responder», que es ruido para quien la mira de afuera. Se deriva.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run lib/mantenimiento/consultaDeRepuesto.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/consultaDeRepuesto.ts lib/mantenimiento/consultaDeRepuesto.test.ts
git commit -m "feat(mantenimiento): que pregunta a Compras sigue esperando respuesta"
```

---

### Tarea 3: La frase del push deja de decir «aprobación» a mano

**Files:**
- Modify: `lib/core/avisoAlInstante.ts`
- Modify: `lib/core/avisoAlInstante.test.ts`
- Modify: los dos emisores que hoy la llaman (`grep -rn "avisarAQuienDecide" app lib`)

**Interfaces:**
- Produces: `NombreDeLoQueEspera` gana `verbo: { singular: string; plural: string }`
  (hoy «espera tu aprobación» / «esperan tu aprobación», escrito a mano dentro de
  `textoDeLaInterrupcion`), y `ListaDeAprobadores` gana `"compras_consultados"`.

- [ ] **Step 1: Test que falla**

```ts
it("la frase la pone quien llama, no la funcion", () => {
  const aviso = textoDeLaInterrupcion(
    [{ etiqueta: "OT 2885", descripcion: "Rodamiento 6206" }],
    { singular: "Una consulta", plural: "consultas", verbo: { singular: "espera tu respuesta", plural: "esperan tu respuesta" } },
    "/compras/consultas"
  );
  expect(aviso?.title).toBe("Una consulta espera tu respuesta");
});
```

Y que los dos emisores de hoy sigan diciendo exactamente lo mismo que antes:
mantener los tests existentes de `textoDeLaInterrupcion` sin cambiarles el texto
esperado, pasándoles el verbo de aprobación.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/core/avisoAlInstante.test.ts` → FAIL

- [ ] **Step 3: Implementar**

Agregar `verbo` a `NombreDeLoQueEspera` y usarlo en los dos `return` de
`textoDeLaInterrupcion`. Actualizar los dos llamadores con el verbo de siempre —
esto **no puede cambiar el texto de ninguna notificación que ya existe**.

- [ ] **Step 4: Correr toda la suite**

Run: `npm test` → PASS (los tests de los dos emisores incluidos)

- [ ] **Step 5: Commit**

```bash
git add lib/core/avisoAlInstante.ts lib/core/avisoAlInstante.test.ts <los dos emisores>
git commit -m "feat(core): la frase de la interrupcion la pone quien avisa"
```

---

### Tarea 4: Avisarle a una sola persona

**Files:**
- Create: `lib/core/avisoAUnaPersona.ts`
- Test: `lib/core/avisoAUnaPersona.test.ts`

**Interfaces:**
- Consumes: `esHoraDeAvisar()` y `aparatosAAvisar()` de `avisoAlInstante.ts`;
  `enviarPush()`, `Aviso` y `SuscripcionPush` de `webpush.ts`.
- Produces: `export async function avisarAUnaPersona(admin: SupabaseClient, opciones: { usuarioId: string; aviso: Aviso; ahora?: Date }): Promise<ResultadoDelAviso>`

- [ ] **Step 1: Tests que fallan**

Con un `admin` falso que devuelve suscripciones:

```ts
it("fuera de hora no manda nada", async () => {
  const r = await avisarAUnaPersona(adminFalso([sub("u1")]), {
    usuarioId: "u1", aviso, ahora: new Date("2026-10-29T06:00:00-03:00"),
  });
  expect(r).toMatchObject({ enviadas: 0, motivo: "fuera de hora" });
});

it("manda a todos los aparatos de esa persona y a nadie mas", async () => {
  const r = await avisarAUnaPersona(adminFalso([sub("u1"), sub("u1"), sub("u2")]), {
    usuarioId: "u1", aviso, ahora: mediodia,
  });
  expect(r.enviadas).toBe(2);
});

// Review Focus 5: sin aparatos no es un error.
it("sin aparatos no falla, lo dice", async () => {
  const r = await avisarAUnaPersona(adminFalso([]), { usuarioId: "u1", aviso, ahora: mediodia });
  expect(r).toMatchObject({ enviadas: 0, motivo: "sin aparatos" });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/core/avisoAUnaPersona.test.ts` → FAIL

- [ ] **Step 3: Implementar**

Lee `push_suscripciones` de ese usuario **paginando con `traerTodo()`**, filtra
con `aparatosAAvisar(subs, new Set([usuarioId]), null)` y manda con
`enviarPush`. Borra las filas que vuelvan `vencida`, igual que el emisor que ya
existe. Todo adentro de un `try/catch` que **no relanza**.

El docstring explica por qué esto no es `avisarAQuienDecide`: una respuesta no
cumple la segunda condición del aviso al instante —nadie espera una decisión de
quien preguntó—, y por qué no va al resumen diario: ese camino cuenta cosas
globales y guarda una foto global, así que «mi pregunta fue respondida» habría
sido el primer aviso con estado por persona del sistema. **Esto es un evento, no
un conteo**: se manda una vez y no hace falta marca de leído.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run lib/core/avisoAUnaPersona.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add lib/core/avisoAUnaPersona.ts lib/core/avisoAUnaPersona.test.ts
git commit -m "feat(core): avisarle por push a una sola persona"
```

---

### Tarea 5: Preguntar desde la OT

**Depende de la Tarea 1 aplicada.**

**Files:**
- Modify: `app/api/mantenimiento/ordenes/[id]/notas/route.ts`
- Modify: `lib/compras/auth.ts` (agregar `consultadosDeCompras`)
- Modify: `app/(app)/mantenimiento/ordenes/RepuestosOTModal.tsx`
- Modify: `app/(app)/mantenimiento/ordenes/JustificacionOT.tsx`

**Interfaces:**
- Consumes: `TipoDeNota` (Tarea 2), `textoDeLaInterrupcion` con `verbo` (Tarea 3).
- Produces: el POST de notas acepta `{ texto, tipo?, repuesto_id?, responde_a? }`
  y devuelve `{ data, planilla_error, aviso }`; y en
  `consultaDeRepuesto.ts`,
  `export function itemDeLaConsulta(orden: { ot_number: number | null }, repuesto: { nombre: string; codigo: string | null }): ItemQueEspera`.

- [ ] **Step 1: Tests de lo puro que agrega esta tarea**

En `lib/mantenimiento/consultaDeRepuesto.test.ts`, el texto del push y el
Review Focus 2:

```ts
it("el push nombra la OT y el repuesto", () => {
  expect(itemDeLaConsulta({ ot_number: 2885 }, { nombre: "Rodamiento 6206", codigo: "00473" }))
    .toEqual({ etiqueta: "OT 2885", descripcion: "Rodamiento 6206 · 00473" });
});

// Review Focus 2: lo que va a la celda X pasa por textoParaLaCelda.
it("una pregunta que arranca con = no viaja como formula", () => {
  expect(celdaDeObservacionPrevia("=IMPORTRANGE(...)").valor).toMatch(/^'/);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/mantenimiento/consultaDeRepuesto.test.ts` → FAIL

- [ ] **Step 3: Implementar `itemDeLaConsulta` y la ruta**

En la ruta, el POST:
- acepta `tipo` (default `"JUSTIFICACION"`), `repuesto_id` y `responde_a`;
- con `tipo === "PREGUNTA"` **exige `repuesto_id`** y comprueba que ese repuesto
  sea de esta OT: el spec dice que la pregunta nace de un repuesto concreto, y
  de eso depende que después se pueda cerrar sola cuando lo saquen;
- y comprueba que `responde_a`, cuando viene, **sea una nota de esta misma OT**.
  Sin cascade, una nota que apunte a otra orden traba el borrado de esa otra:
  `delete` da `23503`, y el borrado de espejo borra OT de a 200 con un `.in()`,
  así que la tanda entera falla y se repite en cada corrida hasta arreglar el
  dato. No se llega desde la pantalla, y la ruta es lo único que lo impide;
- sigue exigiendo `puedeEditarMantenimiento` **también para preguntar** —es la
  decisión del spec—;
- con `tipo === "PREGUNTA"`, después de guardar e **igual que hoy** escribir la
  columna X con `celdaDeObservacionPrevia`, llama a `avisarAQuienDecide` con
  `lista: "compras_consultados"`, el verbo «espera tu respuesta» y
  `url: "/compras/consultas"`;
- devuelve en `aviso` lo que contestó esa función. **Review Focus 1:** con la
  lista vacía vuelve `motivo: "nadie aprueba"`, y la pantalla lo dice —«se
  guardó, pero no hay nadie configurado para contestar»— en vez de callarlo.

**Los dos `select` de esa ruta** —el del GET y el del POST— tienen que traer
`tipo`, `repuesto_id` y `responde_a`. Hoy piden `id, texto, creado_en,
creado_por, autor`: sin extenderlos, `preguntasAbiertas` devuelve `[]` para
todo **sin un solo error**. Y el POST valida `tipo` contra `TIPOS_DE_NOTA`.

**El servidor también defiende «una abierta por repuesto»**: si ya hay una,
el POST de una `PREGUNTA` nueva sin `responde_a` contesta 409. Con una pantalla
vieja, dos personas abren dos hilos de la misma pieza y la regla se pierde.

Y el **DELETE** de esa misma ruta traduce el `23503` que ahora devuelve la base
a un **409 legible**: desde la migración, `responde_a` no borra en cascada, así
que quien preguntó ya no puede llevarse la respuesta de Compras al borrar su
pregunta. Sin traducir, eso llega como un error de base de datos crudo.

`consultadosDeCompras(supabase)` en `lib/compras/auth.ts` es la gemela de
`aprobadoresDeCompras`, sin alias.

En `RepuestosOTModal`, al lado de «Pedir a Compras» y bajo las mismas
condiciones de stock, el botón **«Preguntar a Compras»** — visible sólo si la OT
está `POR_HACER` o `ATRASADO`. Abre una caja de texto, precargada con el
repuesto y, si `risDelRepuesto` encontró uno en curso, con el número de RI.

**Una pregunta abierta por repuesto**: si `preguntaAbiertaDelRepuesto` devuelve
una, el botón no abre otra — ofrece sumar al mismo hilo («sigue sin llegar»), lo
que manda un `tipo: "PREGUNTA"` con `responde_a` apuntando **a esa pregunta
abierta y no «a la primera»**. Con tres en un hilo, si el segundo seguimiento
apunta a la primera quedan dos abiertas: medido, `["B","C"]` contra `["C"]`. Dos
preguntas vivas sobre la misma pieza son dos entradas en la bandeja de Facundo
diciendo lo mismo, que es el anti-objetivo del spec.

En `JustificacionOT`, cada entrada muestra su tipo y, **en las que
`preguntasAbiertas` devuelve** —no en las que no tienen respuesta, que incluye
a las superadas—, **«preguntado hace N días, sin respuesta»** y un **«ya llegó»** que
la cierra: escribe una `RESPUESTA` del que preguntó. Es la misma fila que
escribiría Compras, así que no hace falta un cuarto tipo — quién la escribió lo
dice `creado_por`.

- [ ] **Step 4: Verificar**

Run: `npx vitest run lib/mantenimiento/consultaDeRepuesto.test.ts` → PASS
Run: `npx tsc --noEmit && node scripts/revisar-responsive.mjs`

- [ ] **Step 5: Commit**

```bash
git add app/api/mantenimiento/ordenes/\[id\]/notas/route.ts lib/compras/auth.ts \
  app/\(app\)/mantenimiento/ordenes/RepuestosOTModal.tsx \
  app/\(app\)/mantenimiento/ordenes/JustificacionOT.tsx \
  lib/mantenimiento/consultaDeRepuesto.ts lib/mantenimiento/consultaDeRepuesto.test.ts
git commit -m "feat(mantenimiento): preguntarle a Compras por un repuesto desde la OT"
```

---

### Tarea 6: Contestar desde Compras

**Depende de las Tareas 1, 4 y 5.**

**Files:**
- Create: `app/api/compras/consultas/route.ts`
- Create: `app/(app)/compras/consultas/page.tsx`, `ConsultasClient.tsx`

**Interfaces:**
- Consumes: `preguntasAbiertas` (Tarea 2), `avisarAUnaPersona` (Tarea 4).
- Produces: `GET /api/compras/consultas` → las abiertas con su OT y su repuesto;
  `POST` con `{ pregunta_id, texto }`; y en `lib/compras/auth.ts`,
  `export function puedeResponderConsulta(quien: { accesoCompras: boolean }, preguntaAbierta: { id: string } | null): boolean`.

- [ ] **Step 1: Test de la regla de permiso**

En `lib/compras/auth.test.ts` o donde viva lo puro: **se puede responder si se
tiene acceso a Compras y hay una pregunta abierta en esa orden** — no hace falta
nivel de Mantenimiento.

```ts
it("sin acceso a Compras no se contesta aunque la pregunta este abierta", () => {
  expect(puedeResponderConsulta({ accesoCompras: false }, pregunta())).toBe(false);
});
it("con acceso a Compras se contesta, sin permiso de Mantenimiento", () => {
  expect(puedeResponderConsulta({ accesoCompras: true }, pregunta())).toBe(true);
});
it("una pregunta ya respondida no se vuelve a contestar", () => {
  expect(puedeResponderConsulta({ accesoCompras: true }, null)).toBe(false);
});
```

- [ ] **Step 2: Correr y verificar que falla** → FAIL

- [ ] **Step 3: Implementar**

**Dos condiciones antes de avisar**, que `avisarAUnaPersona` no puede tomar por
su cuenta: que la pregunta **tenga** `creado_por` —la columna es nullable, así
que `tsc` va a obligar a decidirlo— y que ese autor **no sea quien contesta**.
Sin la segunda, un administrador con acceso a las dos puntas recibe «Compras
contestó tu pregunta» de algo que escribió él un segundo antes.

El POST **comprueba `pregunta_id` contra `preguntasAbiertas`** en vez de darlo
por bueno —una pregunta ya contestada o superada no se vuelve a contestar— e
inserta una fila `tipo: "RESPUESTA"` con `responde_a` apuntando a la pregunta, **escribe la columna X** con `celdaDeObservacionPrevia` (la respuesta
pasa a ser la justificación vigente) y llama a `avisarAUnaPersona` con el
`creado_por` de la pregunta.

**Review Focus 5:** el envío va **después** de guardar, en un `try/catch` que no
relanza; si falla, la respuesta ya está y lo único que queda es el `motivo` en
la respuesta de la ruta.

La pantalla lista las abiertas con la OT, el repuesto, quién preguntó, hace
cuánto, y la caja para contestar. Enlace a la OT.

- [ ] **Step 4: Verificar**

Run: `npm test && npx tsc --noEmit && node scripts/revisar-responsive.mjs`

- [ ] **Step 5: Commit**

```bash
git add app/api/compras/consultas/route.ts app/\(app\)/compras/consultas/ lib/compras/auth.ts
git commit -m "feat(compras): contestar las consultas de repuestos de Mantenimiento"
```

---

### Tarea 7: Que una pregunta sin responder no se pierda

**Depende de las Tareas 1 y 6.**

**Files:**
- Modify: `lib/home/avisos.ts`, `lib/home/avisosDeUsuario.ts`
- Test: `lib/home/avisos.test.ts`

- [ ] **Step 1: Test que falla**

```ts
it("las consultas sin responder son un aviso de Compras", () => {
  const avisos = avisosDeLosModulos({ ...conteosVacios, comprasConsultasAbiertas: 3 }, permisosDeCompras);
  expect(avisos).toContainEqual(expect.objectContaining({
    id: "compras-consultas-repuestos", cantidad: 3,
  }));
});
it("a quien no ve Compras no le llega", () => { /* … */ });
```

- [ ] **Step 2: Correr y verificar que falla** → FAIL

- [ ] **Step 3: Implementar**

Sumar `comprasConsultasAbiertas` a `ConteosParaAvisos` y la entrada a `AVISOS`.
El conteo vive en `lib/home/avisosDeUsuario.ts` —`conteos.ts` no existe— donde
casi todos son `count … head`;
con `href: "/compras/consultas"`. **Id nuevo**: la regla de `avisos_fotos` es que
un conteo nuevo pide un id nuevo, o el día del cambio sale una novedad falsa.

Va a la lista de `compras_consultados` y no a todo el que vea Compras, por lo
mismo que `compras-por-aprobar` va a los aprobadores.

- [ ] **Step 4: Verificar** → `npm test` PASS

- [ ] **Step 5: Commit**

```bash
git add lib/home/avisos.ts lib/home/avisosDeUsuario.ts lib/home/avisos.test.ts
git commit -m "feat(compras): las consultas de repuestos sin responder entran al resumen"
```

---

### Tarea 8: Administrar quién contesta

**Depende de la Tarea 1.**

**Files:**
- Modify: `app/(app)/compras/configuracion/page.tsx`, `ConfiguracionClient.tsx`
- Modify o create: la ruta que escribe `compras_consultados`

- [ ] **Step 1: Agregar la sección**

Copiar la sección de aprobadores: listar, agregar y sacar, con el mismo permiso
de administración de Compras. Sin alias — esta tabla no lo necesita.

- [ ] **Step 2: Dejar la lista con Facundo**

`compras@polcecal.com`. Es DML, así que **se puede aplicar por PostgREST** sin
esperar a una persona. Dejar dicho en el commit que hoy la lista tiene uno solo
y que una licencia se arregla ahí y no en el código.

- [ ] **Step 3: Verificar**

Run: `npm run build && node scripts/revisar-responsive.mjs`

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/compras/configuracion/
git commit -m "feat(compras): configurar quien contesta las consultas de repuestos"
```

---

## Al terminar

- [ ] `npm test`, `npx tsc --noEmit`, `npm run build`
- [ ] `node scripts/revisar-arbol-commiteado.mjs`
- [ ] `node scripts/revisar-responsive.mjs`
- [ ] Agregar a `docs/MANTENIMIENTO-INTEGRACION.md` la sección de la consulta a
      Compras, y la fila a la tabla de CLAUDE.md.
- [ ] **`CLAUDE.md:487`** dice que el payload plano «lo mandan los **tres**
      emisores que hay». Con `avisarAUnaPersona` son cuatro.
- [ ] **Los dos textos que la Tarea 5 deja falsos al sumar el tercer emisor del
      aviso al instante:** el encabezado de `lib/core/avisoAlInstante.ts`, que
      dice «hoy las cumplen dos cosas», y el párrafo de CLAUDE.md sobre el aviso
      al instante, que nombra dos. Pasan a ser tres.
- [ ] **El Asistente**, en este orden, que es el que pide su README: la nota de
      `ordenes_trabajo_notas` en `lib/asistente/notas.ts` —la que hay dice «la
      última es la que vale» y se queda corta con los tres tipos—, después
      `npm run catalogo`, y mapear `compras_consultados` en
      `lib/asistente/modulos.ts`. Es el atraso que ese archivo documenta que ya
      se repitió.

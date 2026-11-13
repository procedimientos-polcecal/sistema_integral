# Cancelar una OT — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una orden de trabajo se pueda cancelar —no se va a hacer nunca— y que no se pueda cancelar sin escribir por qué.

**Architecture:** `CANCELADA` reemplaza al estado muerto `SUSPENDIDA` (0 filas en 2.453) en el vocabulario de `lib/mantenimiento/ordenes.ts`. La justificación reusa `ordenes_trabajo_notas`, que ya es «por qué una OT no se hizo» y ya exporta a la columna X. El PATCH de órdenes exige la nota y **la inserta antes** de cambiar el estado. Como la columna M de la planilla la edita gente a mano y esa puerta no se puede cerrar, una `CANCELADA` sin notas se informa como divergencia en el contraste que ya corre dentro de la sincronización.

**Tech Stack:** Next.js 16 (App Router, Route Handlers), Supabase/PostgREST, Vitest, Google Sheets API vía `lib/core/sheets.ts`.

**Spec:** [docs/superpowers/specs/2026-11-13-mantenimiento-cancelar-una-ot-design.md](../specs/2026-11-13-mantenimiento-cancelar-una-ot-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit. Conventional commits: `feat(mantenimiento): …`.
- **Nunca `git add -A`.** Puede haber otra sesión en el mismo árbol: se agregan por nombre los archivos que tocó la tarea. Si `tsc` o los tests fallan en archivos que no tocaste, mirá `git status` antes de arreglarlos.
- El valor guardado es **`CANCELADA`**; en la planilla la palabra es **`"Cancelada"`**.
- `estadoDeTexto()` acepta **`"CANCELADA"` y `"CANCELADO"`** y deja de aceptar `"SUSPENDIDA"`.
- Las dos listas de cerradas quedan en `["REALIZADO", "CANCELADA"]` y **se escriben dos veces, no se unifican**: `CERRADAS` en `alertas.ts` y `CERRADAS_GUT` en `gut.ts` tienen dueños distintos.
- Sólo se cancela desde `POR_HACER`, `EN_PROCESO` o `ATRASADO`. Cancelar **no** escribe `fecha_cierre`.
- Tope de la justificación: **1.000 caracteres** (`MAXIMO_DE_NOTA`, ya existe).
- Un desplegable se escribe `<Select>`, no `<select>`. Una grilla de tres columnas lleva `grid-cols-1 sm:grid-cols-3`. Un ancho (`w-20`, `w-40`…) va en un `div` que envuelva al campo, nunca en el `className` del `input`.
- Los tests van sobre funciones puras de `lib/`; las rutas y las pantallas no tienen tests, así que la lógica que decide algo se saca de la ruta a `lib/`.

## Review Focus

Los cinco casos que el spec implica, que ninguna tarea probaría por su cuenta, y que son los que muerden. Cada uno tiene su test asignado abajo:

1. **Justificación vacía o sólo espacios al cancelar** → 400, y **el estado no cambia ni entra la nota**. Es la razón de que la nota vaya primero. *(Tarea 4)*
2. **Justificación de más de 1.000 caracteres** → 400 y nada cambia; se rechaza, no se recorta. *(Tarea 4)*
3. **`justificacion` enviada con un estado que no es `CANCELADA`** → 400. Ignorarla en silencio deja a quien llama creyendo que escribió algo. *(Tarea 4)*
4. **Cancelar una OT `REALIZADO`** → 400. Es la fila que se contradice a sí misma: tiene `fecha_cierre`, y `estadoSegunElCierre()` dice que la fecha manda. *(Tarea 4)*
5. **Un cliente viejo manda `SUSPENDIDA`** —un teléfono con la app sin actualizar— → 400 con la lista de los que valen, nunca un guardado silencioso. *(Tarea 1)*

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `lib/mantenimiento/ordenes.ts` | El vocabulario y el viaje de ida y vuelta con la planilla | 1 |
| `lib/mantenimiento/alertas.ts`, `gut.ts`, `lib/asistente/notas.ts`, `lib/mantenimiento/notas.ts` | Qué cuenta como cerrada | 2 |
| `supabase/migrations/<ts>_gut_orden_cuenta_la_cancelada_como_cerrada.sql` | Rehacer la columna generada | 3 |
| `lib/mantenimiento/cancelacion.ts` *(nuevo)* | La regla de cancelar, pura y probable | 4 |
| `app/api/mantenimiento/ordenes/route.ts` | El PATCH exige la nota; el POST rechaza `CANCELADA` | 5 |
| `app/api/mantenimiento/ordenes/[id]/notas/route.ts` | No se borra la nota de una cancelada | 6 |
| `lib/mantenimiento/contraste.ts`, `sincronizar.ts` | El detector de «cancelada sin motivo» | 7 |
| `app/(app)/mantenimiento/ordenes/CancelarOTModal.tsx` *(nuevo)*, `OrdenesClient.tsx` | Cancelar desde la pantalla | 8 |
| Las cinco pantallas de etiquetas, `page.tsx`, `RegistrarOTModal.tsx` | La palabra nueva donde se pinta | 9 |

---

### Task 1: El vocabulario y el viaje de ida y vuelta

**Files:**
- Modify: `lib/mantenimiento/ordenes.ts` (`estadoDeTexto` ~146-159, `EN_LA_PLANILLA` ~256-262, `ESTADOS_DE_OT` ~301-303)
- Test: `lib/mantenimiento/ordenes.test.ts`

**Interfaces:**
- Produces: `ESTADOS_DE_OT = ["REALIZADO", "EN_PROCESO", "ATRASADO", "POR_HACER", "CANCELADA"] as const`; `esEstadoDeOT(valor: unknown): valor is EstadoDeOT`; `estadoDeTexto(valor: unknown): string`; `celdaDeEstado(estado: string | null | undefined, fila: number): string`.

- [ ] **Step 1: Escribir los tests que fallan** en `lib/mantenimiento/ordenes.test.ts`

```ts
describe("CANCELADA", () => {
  it("el viaje de ida y vuelta: lo que se escribe es lo que se lee", () => {
    // Si esto se rompe, la sincronización descancela la orden en silencio.
    expect(estadoDeTexto(EN_LA_PLANILLA_PARA_TEST("CANCELADA"))).toBe("CANCELADA");
  });

  it("acepta las dos formas que puede tipear una persona", () => {
    expect(estadoDeTexto("Cancelada")).toBe("CANCELADA");
    expect(estadoDeTexto("Cancelado")).toBe("CANCELADA");
    expect(estadoDeTexto("  CANCELADA  ")).toBe("CANCELADA");
  });

  it("lo que no se reconoce sigue cayendo en por hacer", () => {
    expect(estadoDeTexto("Anulada")).toBe("POR_HACER");
    expect(estadoDeTexto("Suspendida")).toBe("POR_HACER");
  });

  it("en la planilla va el literal, no la fórmula", () => {
    // Una cancelada no tiene que volver a decir «Atrasado» cuando la fecha pase.
    expect(celdaDeEstado("CANCELADA", 42)).toBe("Cancelada");
    expect(celdaDeEstado("POR_HACER", 42)).toBe('=IF(J42="","",L42)');
  });

  it("SUSPENDIDA ya no es un estado, y el error dice cuáles valen", () => {
    // Un teléfono con la app vieja manda el estado que dejó de valer.
    expect(esEstadoDeOT("SUSPENDIDA")).toBe(false);
    expect(esEstadoDeOT("CANCELADA")).toBe(true);
  });
});
```

El primer test necesita la palabra de la planilla. `EN_LA_PLANILLA` es privada: exponerla sólo para el test sería abrirla por un test, así que el viaje se arma con lo que ya es público — `celdaDeEstado("CANCELADA", 42)` devuelve exactamente lo que se escribe en la celda. Usá eso en vez del placeholder.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/ordenes.test.ts`
Expected: FAIL — `estadoDeTexto("Cancelada")` devuelve `"POR_HACER"`.

- [ ] **Step 3: Cambiar las tres constantes en `lib/mantenimiento/ordenes.ts`**

- `ESTADOS_DE_OT`: `"SUSPENDIDA"` → `"CANCELADA"`.
- `EN_LA_PLANILLA`: la clave `SUSPENDIDA: "Suspendida"` → `CANCELADA: "Cancelada"`.
- `estadoDeTexto`: la línea `if (v === "SUSPENDIDA") return "SUSPENDIDA";` → `if (v === "CANCELADA" || v === "CANCELADO") return "CANCELADA";`

El comentario de `estadoDeTexto` tiene que decir **por qué** acepta los dos géneros: esa celda la tipea una persona, y un «Cancelado» a mano que caiga en `POR_HACER` descancela la orden sin avisar. Es la misma tolerancia que la función ya tiene con `v.includes("PROCESO")`.

- [ ] **Step 4: Arreglar los tests existentes que nombran SUSPENDIDA**

`lib/mantenimiento/ordenes.test.ts` tiene `it("acepta los cinco del vocabulario")`, que recorre `ESTADOS_DE_OT` y sigue pasando solo. No hay nada más que tocar en este archivo.

- [ ] **Step 5: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/ordenes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/mantenimiento/ordenes.ts lib/mantenimiento/ordenes.test.ts
git commit -m "feat(mantenimiento): CANCELADA entra al vocabulario de las OT"
```

---

### Task 2: Qué cuenta como cerrada

**Files:**
- Modify: `lib/mantenimiento/alertas.ts:30` (`CERRADAS`), `lib/mantenimiento/gut.ts:127` (`CERRADAS_GUT`), `lib/asistente/notas.ts:74-76`, `lib/mantenimiento/notas.ts` (comentario de `pideJustificacion`)
- Test: `lib/mantenimiento/alertas.test.ts`, `lib/mantenimiento/gut.test.ts`, `lib/mantenimiento/notas.test.ts`

**Interfaces:**
- Consumes: el vocabulario de la Tarea 1.
- Produces: `CERRADAS_GUT: readonly string[]` = `["REALIZADO", "CANCELADA"]`.

- [ ] **Step 1: Escribir / cambiar los tests que fallan**

En `lib/mantenimiento/alertas.test.ts`, reemplazar `it("una suspendida no está atrasada")` por:

```ts
it("una cancelada no está atrasada", () => {
  // No se va a hacer nunca: avisarlo todos los días es ruido.
  expect(estaAtrasada({ estado: "CANCELADA", proxima_fecha: "2026-01-01" }, HOY)).toBe(false);
});
```

En `lib/mantenimiento/gut.test.ts`, en `describe("las constantes")`:

```ts
expect(CERRADAS_GUT).toEqual(["REALIZADO", "CANCELADA"]);
```

y agregar, en `describe("claveDeOrdenGut")`:

```ts
it("una cancelada no lleva el empujón: ya no espera nada", () => {
  expect(claveDeOrdenGut({ estado: "CANCELADA" })).toBe(27);
});
```

En `lib/mantenimiento/notas.test.ts`, en `it("todas las abiertas si")`, cambiar `"SUSPENDIDA"` por `"CANCELADA"` en la lista.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/alertas.test.ts lib/mantenimiento/gut.test.ts lib/mantenimiento/notas.test.ts`
Expected: FAIL — `claveDeOrdenGut({ estado: "CANCELADA" })` da 1027.

- [ ] **Step 3: Cambiar las dos listas y los dos textos**

- `alertas.ts`: `const CERRADAS = ["REALIZADO", "CANCELADA"];`
- `gut.ts`: `export const CERRADAS_GUT: readonly string[] = ["REALIZADO", "CANCELADA"];`
- Los comentarios de las dos siguen diciendo que son gemelas con dueños distintos y que **no se unifican**; el de `gut.ts` tiene que nombrar la migración nueva de la Tarea 3 en vez de la `20261021104750`.
- `lib/asistente/notas.ts`: las dos menciones de `SUSPENDIDA` pasan a `CANCELADA`, incluida la del SQL de ejemplo `estado not in ('REALIZADO','CANCELADA')`.
- `lib/mantenimiento/notas.ts`: el docstring de `pideJustificacion` nombra «una suspendida»; pasa a «una cancelada». La función no cambia: sigue pidiendo para todo lo que no sea `REALIZADO`, así que una cancelada puede sumar otra nota.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/alertas.test.ts lib/mantenimiento/gut.test.ts lib/mantenimiento/notas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/alertas.ts lib/mantenimiento/alertas.test.ts lib/mantenimiento/gut.ts lib/mantenimiento/gut.test.ts lib/mantenimiento/notas.ts lib/mantenimiento/notas.test.ts lib/asistente/notas.ts
git commit -m "feat(mantenimiento): una OT cancelada deja de contar como abierta"
```

---

### Task 3: La migración de `gut_orden`

**Files:**
- Create: `supabase/migrations/<timestamp>_gut_orden_cuenta_la_cancelada_como_cerrada.sql`

**Interfaces:**
- Consumes: `CERRADAS_GUT` de la Tarea 2; el `case` del SQL tiene que decir exactamente lo mismo.

- [ ] **Step 1: Crear el archivo con marca de tiempo**

Run: `npm run migracion "gut orden cuenta la cancelada como cerrada"`

Marca de tiempo y no contador: dos sesiones toman el mismo «próximo número libre» y chocan.

- [ ] **Step 2: Escribir la migración**

```sql
alter table ordenes_trabajo drop column if exists gut_orden;

alter table ordenes_trabajo
  add column if not exists gut_orden integer generated always as (
    (case when estado in ('REALIZADO', 'CANCELADA') then 0 else 1000 end)
    + coalesce(gut_gravedad * gut_urgencia * gut_tendencia, 27)
  ) stored;

create index if not exists ordenes_trabajo_gut_orden_idx
  on ordenes_trabajo (gut_orden desc, ot_number desc);
```

El encabezado tiene que dejar escrito, con el estilo de los demás: que una columna generada **no se altera en su lugar** —hay que dropearla y rehacerla, y el `drop` se lleva el índice, por eso se vuelve a crear—; que el `27` se conserva tal cual porque está escrito también en `lib/mantenimiento/gut.ts` con un test que los ata; que `SUSPENDIDA` sale del `case` porque tenía **0 filas de 2.453** medidas el 13/11/2026; y que mientras esta migración no se aplique **el tablero GUT muestra las canceladas arriba de todo**.

- [ ] **Step 3: Verificar que el SQL dice lo mismo que `CERRADAS_GUT`**

Leer las dos y comprobar a ojo que la lista coincide. No hay test que lea el archivo: lo que los ata es el test literal de `gut.test.ts` y este paso.

- [ ] **Step 4: Commit, y avisar que queda pendiente**

```bash
git add supabase/migrations/
git commit -m "feat(mantenimiento): gut_orden cuenta la cancelada como cerrada"
```

**Esta migración la corre una persona** en el editor SQL de Supabase. Un agente no puede correr DDL. Decirlo al entregar.

---

### Task 4: La regla de cancelar, pura

**Files:**
- Create: `lib/mantenimiento/cancelacion.ts`
- Test: `lib/mantenimiento/cancelacion.test.ts`

**Interfaces:**
- Consumes: `validarNota(valor: unknown): NotaValidada` y `MAXIMO_DE_NOTA` de `lib/mantenimiento/notas.ts`; `esEstadoDeOT` de `ordenes.ts`.
- Produces:
  - `ESTADO_CANCELADA = "CANCELADA"`
  - `esCancelacion(estado: unknown): boolean`
  - `SE_CANCELA_DESDE: readonly string[]` = `["POR_HACER", "EN_PROCESO", "ATRASADO"]`
  - `loQueImpideCancelar(args: { estadoPedido: unknown; estadoActual: unknown; justificacion: unknown; fechaCierre?: unknown }): { ok: true; texto: string } | { ok: false; error: string }`

- [ ] **Step 1: Escribir el test que falla** en `lib/mantenimiento/cancelacion.test.ts`

```ts
const abierta = { estadoPedido: "CANCELADA", estadoActual: "ATRASADO" };

describe("loQueImpideCancelar", () => {
  it("con motivo y desde una abierta, deja", () => {
    const r = loQueImpideCancelar({ ...abierta, justificacion: "  Se dio de baja el equipo  " });
    expect(r).toEqual({ ok: true, texto: "Se dio de baja el equipo" });
  });

  it("sin motivo no deja, y el mensaje dice qué falta", () => {
    for (const vacia of ["", "   ", null, undefined, 7]) {
      const r = loQueImpideCancelar({ ...abierta, justificacion: vacia });
      expect(r.ok).toBe(false);
    }
  });

  it("un motivo de más de 1.000 se rechaza, no se recorta", () => {
    const r = loQueImpideCancelar({ ...abierta, justificacion: "x".repeat(1001) });
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty("error", expect.stringContaining("1001"));
  });

  it("no se cancela una realizada", () => {
    // Tiene fecha_cierre, y estadoSegunElCierre dice que la fecha manda.
    const r = loQueImpideCancelar({
      estadoPedido: "CANCELADA", estadoActual: "REALIZADO", justificacion: "lo que sea",
    });
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty("error", expect.stringContaining("realizada"));
  });

  it("una ya cancelada se puede volver a justificar", () => {
    const r = loQueImpideCancelar({
      estadoPedido: "CANCELADA", estadoActual: "CANCELADA", justificacion: "se corrige el motivo",
    });
    expect(r.ok).toBe(true);
  });

  it("una cancelación no lleva fecha de cierre", () => {
    // Una fecha de cierre dice «se hizo tal día»: estadoSegunElCierre la
    // convierte en REALIZADO y costoEquipo la cobra. No se ignora en
    // silencio, porque quien la mandó cree que la guardó.
    const r = loQueImpideCancelar({ ...abierta, justificacion: "x", fechaCierre: "2026-11-13" });
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty("error", expect.stringContaining("fecha de cierre"));
  });

  it("una justificación con otro estado es un error del que llama", () => {
    const r = loQueImpideCancelar({
      estadoPedido: "EN_PROCESO", estadoActual: "POR_HACER", justificacion: "algo",
    });
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty("error", expect.stringContaining("justificación"));
  });

  it("sin cancelación y sin justificación no opina", () => {
    const r = loQueImpideCancelar({
      estadoPedido: "EN_PROCESO", estadoActual: "POR_HACER", justificacion: undefined,
    });
    expect(r).toEqual({ ok: true, texto: "" });
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/mantenimiento/cancelacion.test.ts`
Expected: FAIL — `Cannot find module './cancelacion'`

- [ ] **Step 3: Implementar `lib/mantenimiento/cancelacion.ts`**

El orden de los chequeos es el de los tests: primero si hay justificación con un estado que no es cancelación (error del que llama), después si el estado actual deja cancelar, y recién ahí `validarNota`. `texto: ""` cuando no hay nada que decidir, para que quien llame no tenga que distinguir «no vino» de «vino vacía».

El encabezado del archivo tiene que decir **por qué existe acá y no en la ruta**: es la regla que decide, y en la ruta no se puede probar. Y por qué `SE_CANCELA_DESDE` no incluye `REALIZADO`: una orden realizada tiene `fecha_cierre`, y `estadoSegunElCierre()` dice que la fecha manda, así que cancelarla crearía una fila que se contradice a sí misma — medido, hoy hay 0 filas en ese caso.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run lib/mantenimiento/cancelacion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/cancelacion.ts lib/mantenimiento/cancelacion.test.ts
git commit -m "feat(mantenimiento): la regla de cancelar una OT, aparte y probada"
```

---

### Task 5: El PATCH exige la nota, y el POST rechaza `CANCELADA`

**Files:**
- Modify: `app/api/mantenimiento/ordenes/route.ts` (POST ~260-267, PATCH ~672-775, `escribirEnLaPlanilla` ~780-790)
- Modify: `scripts/revisar-exportaciones.mjs:261` (el `porque` de la entrada)

**Interfaces:**
- Consumes: `loQueImpideCancelar`, `esCancelacion` (Tarea 4); `celdaDeObservacionPrevia(texto: string | null): { columna: number; valor: string }` de `lib/mantenimiento/notas.ts`; `escribirEnLaFilaDeLaOT(orden, celdas)` de `planillaDeOT.ts`.
- Produces: el PATCH acepta `justificacion?: string` en el cuerpo.

- [ ] **Step 1: El POST rechaza nacer cancelada**

En el bloque que ya valida el estado (`if (estado !== undefined && … && !esEstadoDeOT(estado))`), agregar antes el caso de la cancelación: si `esCancelacion(estado)`, devolver 400 con un mensaje concreto —que una OT no nace cancelada y que se cancela después, con su motivo— y llamar a `avisarDeLaCarga` igual que las otras ramas, porque esto **sí es alcanzable desde la cola** de las cargas sin señal.

- [ ] **Step 2: El PATCH, en orden**

Después de leer `const { id, estado, requiere_parada_sector } = body ?? {}` y antes de tocar nada:

1. Traer el estado actual de la orden (`select("estado").eq("id", id).single()` con el cliente admin). Hace falta para la regla y de paso un id inventado no sigue adelante.
2. `loQueImpideCancelar({ estadoPedido: estado, estadoActual, justificacion: body.justificacion, fechaCierre: body.fecha_cierre })`. Si no, 400 con su `error`.
3. Si es cancelación: **insertar la nota primero** en `ordenes_trabajo_notas` (`{ orden_id: id, texto, creado_por: user.id }`). Si falla, 400 y **no se toca el estado**.
4. Recién ahí el `update` de siempre.

El comentario al lado del orden es la regla de la casa y tiene que estar escrito: el registro va antes de la acción que no se deshace —«si no entra, no se borra»—; al revés quedarían órdenes canceladas sin motivo, que es justo lo que esto vino a impedir.

- [ ] **Step 3: Las dos celdas en una sola escritura**

Cambiar la firma de la función local:

```ts
async function escribirEnLaPlanilla(
  orden: FilaDeOT,
  registro: RegistroDeOT,
  extra: readonly { columna: number; valor: ValorDeCelda }[] = []
): Promise<string | null>
```

que devuelve `escribirEnLaFilaDeLaOT(orden, [...celdasParaRegistrar(registro), ...extra])`. Al cancelar se le pasa `[celdaDeObservacionPrevia(texto)]`. `ValorDeCelda` se importa de `@/lib/mantenimiento/ordenes`, que ya se importa en esa ruta.

Las **dos** llamadas —la primera y la del `after()`— pasan el mismo `extra`, así que el reintento de los cuatro minutos lleva la X sin código nuevo. Lo que el drenaje no puede rehacer es la X, porque `exportarLoPendiente` arma el registro desde la fila con `loQueHayQueExportar` y la observación previa no tiene columna ahí: eso ya está medido y escrito en el encabezado de `ordenes/[id]/notas/route.ts` y no empeora.

- [ ] **Step 4: Actualizar el registro de exportaciones**

En `scripts/revisar-exportaciones.mjs`, el `porque` de `app/api/mantenimiento/ordenes/route.ts` tiene que decir que **la M va a la cola y la X no**: el `after()` la reintenta, el drenaje la deja, y la salida es volver a guardar la justificación. La `estrategia` sigue siendo `"cola"`.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores

Run: `node scripts/revisar-exportaciones.mjs`
Expected: `ROMPE 0 · MIRAR 0`

- [ ] **Step 6: Commit**

```bash
git add app/api/mantenimiento/ordenes/route.ts scripts/revisar-exportaciones.mjs
git commit -m "feat(mantenimiento): cancelar una OT exige el motivo, y la nota va primero"
```

---

### Task 6: La nota de una cancelada no se borra

**Files:**
- Modify: `app/api/mantenimiento/ordenes/[id]/notas/route.ts` (el `DELETE`)

**Interfaces:**
- Consumes: `esCancelacion` (Tarea 4).

- [ ] **Step 1: Cortar el DELETE antes de borrar**

Leer el estado de la orden; si está cancelada, devolver **409** con el motivo dicho: que la justificación de una orden cancelada no se borra y que para corregirla se escribe otra, que pasa a ser la última y va a la planilla.

Va **antes** del `delete`, no después: el `delete` ya filtra por `creado_por` a propósito —entre leer y borrar hay una ventana— y esto es una regla distinta, sobre la orden y no sobre el autor.

- [ ] **Step 2: Dejar escrito el porqué**

En el encabezado del `DELETE`: sin este corte queda la puerta de atrás del requisito entero —cancelo con motivo, borro la nota, y queda una OT cancelada sin razón en ningún lado con la X mostrando una justificación vieja que habla de otra cosa—. Y por qué no se auditó en vez de esto: `ACCIONES` en `lib/core/auditoria.ts` es una lista cerrada, así que un décimo verbo pide una segunda migración para registrar algo que la nota ya dice mejor y donde se lo busca.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add "app/api/mantenimiento/ordenes/[id]/notas/route.ts"
git commit -m "fix(mantenimiento): la justificacion de una OT cancelada no se borra"
```

---

### Task 7: El detector de «cancelada sin motivo»

**Files:**
- Modify: `lib/mantenimiento/contraste.ts` (`OrdenDelSistema` ~36-55, `contrastar` ~170-185)
- Modify: `lib/mantenimiento/sincronizar.ts:536-543` (el `select` de `anotarLasDivergencias`)
- Test: `lib/mantenimiento/contraste.test.ts`

**Interfaces:**
- Consumes: `OrdenLeida` de `ordenes.ts`.
- Produces: `OrdenDelSistema` gana `tiene_nota?: boolean`; `laCancelacionNoTieneMotivo(s: OrdenDelSistema): boolean`.

- [ ] **Step 1: Escribir el test que falla** en `lib/mantenimiento/contraste.test.ts`

```ts
describe("laCancelacionNoTieneMotivo", () => {
  it("una cancelada sin notas es un defecto", () => {
    expect(laCancelacionNoTieneMotivo({ estado: "CANCELADA", tiene_nota: false })).toBe(true);
  });

  it("una cancelada con nota no suena", () => {
    expect(laCancelacionNoTieneMotivo({ estado: "CANCELADA", tiene_nota: true })).toBe(false);
  });

  it("una abierta sin nota tampoco: es el caso normal de las 51 de hoy", () => {
    // Sonar por esto hundiría la lista, que es la vara de divergencias.ts.
    expect(laCancelacionNoTieneMotivo({ estado: "ATRASADO", tiene_nota: false })).toBe(false);
  });
});
```

Los objetos van completos con el resto de `OrdenDelSistema` o la función tipa sólo lo que mira; elegí lo segundo y declará el parámetro como `Pick<OrdenDelSistema, "estado" | "tiene_nota">`.

Y en `describe("contrastar")`, que la divergencia sale con el nombre del problema:

```ts
it("informa la cancelada sin motivo con el nombre del problema", () => {
  const sistema = [{ ...base, ot_number: 10, estado: "CANCELADA", tiene_nota: false }];
  const planilla = [{ ...baseP, ot_number: 10, estado: "CANCELADA", estado_raw: "Cancelada" }];
  const d = contrastar(sistema, planilla).divergencias;
  expect(d).toHaveLength(1);
  expect(d[0].campo).toContain("cancelada sin motivo");
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/mantenimiento/contraste.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

- `OrdenDelSistema` gana `tiene_nota?: boolean`, documentado: no sale de `ordenes_trabajo` sino de una consulta aparte.
- `laCancelacionNoTieneMotivo` con el docstring que explique que es la hermana de `laCeldaDelEstadoEstaVacia`: no es una diferencia entre los dos lados —los dos dicen «cancelada»— sino un problema que sólo el sistema ve, y que **no puede sonar por lo que no importa** porque el sistema nunca produce una cancelada sin nota (el PATCH no lo permite y el alta la rechaza), así que toda la que aparezca entró por la planilla.
- En `contrastar`, al lado del bloque de `laCeldaDelEstadoEstaVacia`, empujar la divergencia con `campo: "cancelada sin motivo"`, `enElSistema: "(cancelada, y sin ninguna justificación)"`, `enLaPlanilla: comparable(p.estado_raw) || "(vacío)"`.

- [ ] **Step 4: Cargar el dato en la sincronización**

En `anotarLasDivergencias` de `sincronizar.ts`, después del `traerTodo` de las órdenes: traer los `orden_id` distintos de `ordenes_trabajo_notas` —son 25 filas hoy, una consulta chica y aparte, por lo mismo que explica `ordenes/justificadas/route.ts`— y marcar `tiene_nota` en cada orden. El `select` de `ordenes_trabajo` necesita además el `id`, que hoy no trae.

- [ ] **Step 5: Correr y ver que pasa**

Run: `npx vitest run lib/mantenimiento/contraste.test.ts && npx tsc --noEmit`
Expected: PASS y sin errores

- [ ] **Step 6: Commit**

```bash
git add lib/mantenimiento/contraste.ts lib/mantenimiento/contraste.test.ts lib/mantenimiento/sincronizar.ts
git commit -m "feat(mantenimiento): una OT cancelada sin motivo sale en el contraste"
```

---

### Task 8: Cancelar desde la pantalla

**Files:**
- Create: `app/(app)/mantenimiento/ordenes/CancelarOTModal.tsx`
- Modify: `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx` (`ESTADOS` ~36-43, `changeEstado` ~377-400, `KANBAN_ESTADOS` ~305, `ESTADO_OPTIONS` ~978, `NEXT` ~1104-1109)

**Interfaces:**
- Consumes: el PATCH de la Tarea 5 (`{ id, estado: "CANCELADA", justificacion }`); `SE_CANCELA_DESDE` de la Tarea 4; `avisoDelPendiente` de `reintentoDePendientes`.

- [ ] **Step 1: El modal**

`CancelarOTModal({ orden, onCerrar, onCancelada })`, con la forma de `RegistrarOTModal`: un `textarea` para el motivo, el contador contra `MAXIMO_DE_NOTA`, el botón deshabilitado mientras esté vacío, y el aviso de la planilla por `avisoDelPendiente`. Manda un solo PATCH.

El texto de la pantalla tiene que decir que cancelar es **no se va a hacer nunca** —es la diferencia con «suspender», que ya no existe— y que el motivo queda en el historial de la orden y en la planilla.

Ancho: lo que lleve `w-*` va en un `div` que envuelva al campo, no en el `className` del `textarea`.

- [ ] **Step 2: Engancharlo**

- `ESTADOS` gana `{ value: "CANCELADA", label: "Cancelada", … }` con el gris de lo cerrado-sin-hacer, distinto del verde de `REALIZADO`.
- `changeEstado` intercepta `"CANCELADA"` como ya intercepta `"EN_PROCESO"` y `"REALIZADO"`: abre el modal en vez de confirmar. Sin motivo no hay PATCH.
- `NEXT` suma `"CANCELADA"` a `POR_HACER`, `EN_PROCESO` y `ATRASADO`, y **no** a `REALIZADO`. `ESTADO_OPTIONS` de la fila expandida, igual.
- `KANBAN_ESTADOS` se deja en cuatro: una columna de canceladas en el tablero es ruido permanente. Se ven por el filtro de estado, que ya sale de `ESTADOS_DE_OT`.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && node scripts/revisar-responsive.mjs`
Expected: sin errores; `ROMPE 0 · APRETADO 0 · MIRAR 0`

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/CancelarOTModal.tsx" "app/(app)/mantenimiento/ordenes/OrdenesClient.tsx"
git commit -m "feat(mantenimiento): se cancela una OT desde el listado, con su motivo"
```

---

### Task 9: La palabra nueva donde se pinta

**Files:**
- Modify: `app/(app)/mantenimiento/page.tsx:72`, `DashboardClient.tsx:62-68`, `mantenimientos/MantenimientosClient.tsx:50-56`, `equipos/[id]/EquipoDetalle.tsx:15-21`, `planificacion/[id]/PlanDetalle.tsx:8-14`, `ordenes/RegistrarOTModal.tsx:19-29`

- [ ] **Step 1: Las cinco listas de etiquetas**

`SUSPENDIDA` → `CANCELADA` / «Cancelada» en `page.tsx` (`OT_ESTADOS`), `DashboardClient` y `MantenimientosClient`. `EquipoDetalle` y `PlanDetalle` **no la tienen** y hay que agregarla: sin entrada, `OT_ESTADO[o.estado]` cae a `undefined` y la fila se rompe o queda sin pintar.

- [ ] **Step 2: El modal de registrar pierde «Cancelado»**

En `RegistrarOTModal.tsx`: sacar `{ valor: "cancelado", label: "Cancelado" }` de `RESULTADOS` y la clave `cancelado` de `ESTADO_SEGUN`. `RESULTADOS` queda en «Completado» y «Parcial».

El comentario tiene que dejar por qué: ese modal es «se fue a hacer el trabajo y salió así» y manda `fecha_cierre`, que una cancelación no pone; cancelar ahora es su propia acción con su propio motivo, y era el único camino que llevaba a `SUSPENDIDA` — **cero filas en 2.453 órdenes**, así que no se pierde ningún caso real.

La guarda `if (!observaciones.trim() && resultado !== "completado")` se queda: sigue valiendo para «parcial».

- [ ] **Step 3: Que no quede ningún SUSPENDIDA suelto**

Run: `grep -rn "SUSPENDIDA\|Suspendida" app lib components scripts`
Expected: sólo menciones históricas en comentarios y en los encabezados de migraciones ya aplicadas, que **no se editan**. Ninguna en código vivo.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && node scripts/revisar-responsive.mjs`
Expected: sin errores; `ROMPE 0 · APRETADO 0 · MIRAR 0`

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/mantenimiento/page.tsx" "app/(app)/mantenimiento/DashboardClient.tsx" "app/(app)/mantenimiento/mantenimientos/MantenimientosClient.tsx" "app/(app)/mantenimiento/equipos/[id]/EquipoDetalle.tsx" "app/(app)/mantenimiento/planificacion/[id]/PlanDetalle.tsx" "app/(app)/mantenimiento/ordenes/RegistrarOTModal.tsx"
git commit -m "feat(mantenimiento): Cancelada se ve en las cinco pantallas que pintan estados"
```

---

### Task 10: Verificación final

- [ ] **Step 1: Las seis comprobaciones**

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run build
```

Parar `npm run dev` antes del build: con el dev server levantado deja la app en 500.

```bash
node scripts/revisar-responsive.mjs
```

```bash
node scripts/revisar-exportaciones.mjs
```

- [ ] **Step 2: Pushear y revisar el árbol commiteado**

Se trabaja sobre `main` y se pushea al terminar. Después del push:

```bash
node scripts/revisar-arbol-commiteado.mjs
```

Es el que atrapa lo que los otros no pueden: `cancelacion.ts` y `CancelarOTModal.tsx` son archivos **nuevos**, y un archivo nuevo que quedó *staged* y nunca se commiteó no viaja mientras los que lo importan sí. Eso tiró cuatro deploys seguidos el 14/09/2026.

- [ ] **Step 3: Decir lo que queda pendiente de una persona**

La migración de la Tarea 3 la aplica el usuario a mano en el editor SQL de Supabase. Hasta entonces el tablero GUT muestra las canceladas arriba de todo, y el resto funciona.

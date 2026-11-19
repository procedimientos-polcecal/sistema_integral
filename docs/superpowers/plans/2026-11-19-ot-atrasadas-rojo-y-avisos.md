# Las OT atrasadas se ven y avisan — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que «atrasada» signifique «se le pasó la fecha» en todo Mantenimiento, que una OT atrasada se vea roja en el calendario del mes, y que los cinco que administran el módulo reciban un push dos días antes de que una OT arranque y otro el día que se atrasa.

**Architecture:** La definición vive en una sola función pura (`estaAtrasada`) que pasa a mirar la fecha de ejecución efectiva en vez de `proxima_fecha`, que está vacía en las 2531 filas; todo lo que hoy dice 21 la hereda. El calendario recibe `hoy` y marca cada orden, y la ficha se pinta roja con la especialidad en el borde. Los dos avisos los manda un cron diario propio que deriva de la fecha qué nombrar, sin tabla ni memoria.

**Tech Stack:** Next.js 16 (App Router), Supabase/PostgREST, Tailwind v4, vitest, web-push.

**Spec:** [docs/superpowers/specs/2026-11-19-ot-atrasadas-rojo-y-avisos-design.md](../specs/2026-11-19-ot-atrasadas-rojo-y-avisos-design.md)

## Global Constraints

- **Todo en castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Conventional commits en castellano**, con el cuerpo explicando el porqué.
- **Nunca `git add -A`**: los archivos se agregan por nombre.
- **Sin migración.** Ninguna tarea agrega ni cambia una columna.
- **Las fechas se comparan como texto `AAAA-MM-DD`**, recortadas con `.slice(0, 10)`; nunca se parsean a `Date` para comparar.
- **El día de hoy sale de `hoyEnArgentina()` / `fechaEnArgentina`** (UTC−3 fijo), nunca del reloj del navegador ni de `toISOString()`.
- **El payload de un push es plano: `{title, body, url}`**, con la `url` en el primer nivel (`Aviso` de `lib/core/webpush.ts`).
- **La ventana para mandar es 7:00–21:00 de Argentina**, con `esHoraDeAvisar` importado de `lib/core/avisoAlInstante.ts`; no se redefine.
- **`traerTodo()` de `lib/core/paginado.ts`** en toda lectura de `ordenes_trabajo`: PostgREST corta en 1000 filas y no avisa.
- **Los colores van por `style` y no por utilidades de Tailwind**, porque `.card` y los `.btn-*` están fuera de capa y les ganan.
- **Rojo de la ficha atrasada: `#b91c1c` con texto blanco** (6,47:1 medido).

## Review Focus

Lo que el diseño implica, ninguna tarea ejercita por su cuenta, y muerde a una persona:

1. **Una OT abierta sin ninguna fecha de inicio** (la OT 622 existe hoy) no está atrasada, no se pinta y ningún push la nombra. → test en la Tarea 1 y en la Tarea 6.
2. **Las fechas pueden llegar con hora** (`2026-11-18T00:00:00+00`) según la columna y la ruta: todo lo que compara tiene que recortar a 10 caracteres primero, o una orden de ayer se lee como de hoy. → test en la Tarea 1.
3. **`fecha_fin` anterior al inicio** es dato sucio de la planilla y vale «dura un día», como ya hace `diasQueOcupa`: no puede adelantar el vencimiento. → test en la Tarea 1.
4. **Una cuenta desactivada no recibe aunque tenga el grant de admin.** → test en la Tarea 7. (Que una persona con dos aparatos reciba en los dos sale de la forma de `push_suscripciones`, cuya clave es `(usuario_id, endpoint)`: el envío recorre filas, no personas.)
5. **Los bordes del fin de semana**: el sábado nombra lo que arranca el lunes y el martes, y el lunes nombra lo que cruzó el sábado y el domingo. Sin eso el martes nunca recibe su aviso de dos días. → test en la Tarea 6.

---

### Task 1: La definición única de «atrasada»

**Files:**
- Modify: `lib/mantenimiento/alertas.ts`
- Test: `lib/mantenimiento/alertas.test.ts`
- Modify: `app/(app)/mantenimiento/page.tsx:168-176` (la consulta y su `select`)
- Modify: `app/(app)/mantenimiento/ordenes/OrdenarTrabajo.tsx:149`
- Modify: `app/(app)/mantenimiento/DashboardClient.tsx:212`
- Modify: `lib/mantenimiento/prioridad.ts:201-202`, `lib/mantenimiento/prioridad.test.ts`

**Interfaces:**
- Consumes: `fechaParaElCalendario(o)` de `lib/agenda/evento.ts`, que ya resuelve `fecha_ejecucion_pendiente ?? fecha_ejecucion`.
- Produces:
  - `interface Atrasable { estado?: string | null; fecha_ejecucion?: string | null; fecha_ejecucion_pendiente?: string | null; fecha_fin?: string | null }`
  - `estaAtrasada(orden: Atrasable, hoy: string): boolean`
  - `diasDeAtraso(orden: Atrasable, hoy: string): number | null`
  - `condicionDeAtrasada(hoy: string): string` — la cadena para `.or()` de PostgREST
  - `ESTADOS_CERRADOS: readonly string[]` — `["REALIZADO", "CANCELADA"]`, para el `.not("estado", "in", ...)` de quien consulte
  - `ordenarPorAtraso` y `resumirAtrasadas` conservan su firma

- [ ] **Step 1: Escribir los tests que fallan en `lib/mantenimiento/alertas.test.ts`**

Reemplazan a los que hoy usan `proxima_fecha`. `const HOY = "2026-11-19"`.

```ts
describe("estaAtrasada", () => {
  it("la que arrancaba ayer y sigue abierta está atrasada", () => {
    expect(estaAtrasada({ estado: "POR_HACER", fecha_ejecucion: "2026-11-18" }, HOY)).toBe(true);
  });
  it("la que arranca hoy no está atrasada", () => {
    expect(estaAtrasada({ estado: "POR_HACER", fecha_ejecucion: HOY }, HOY)).toBe(false);
  });
  it("la que arrancó ayer pero termina mañana sigue en curso", () => {
    expect(estaAtrasada(
      { estado: "EN_PROCESO", fecha_ejecucion: "2026-11-18", fecha_fin: "2026-11-20" }, HOY
    )).toBe(false);
  });
  it("la que terminó ayer está atrasada", () => {
    expect(estaAtrasada(
      { estado: "EN_PROCESO", fecha_ejecucion: "2026-11-10", fecha_fin: "2026-11-18" }, HOY
    )).toBe(true);
  });
  it("una fecha_fin anterior al inicio vale «dura un día» y no adelanta el vencimiento", () => {
    expect(estaAtrasada(
      { estado: "POR_HACER", fecha_ejecucion: HOY, fecha_fin: "2026-11-01" }, HOY
    )).toBe(false);
  });
  it("la pendiente le gana a la de la planilla", () => {
    expect(estaAtrasada(
      { estado: "POR_HACER", fecha_ejecucion: "2026-11-01", fecha_ejecucion_pendiente: "2026-11-25" }, HOY
    )).toBe(false);
  });
  it("recorta la hora antes de comparar", () => {
    expect(estaAtrasada({ estado: "POR_HACER", fecha_ejecucion: "2026-11-18T00:00:00+00" }, HOY)).toBe(true);
    expect(estaAtrasada({ estado: "POR_HACER", fecha_ejecucion: `${HOY}T00:00:00+00` }, HOY)).toBe(false);
  });
  it("sin ninguna fecha no está atrasada", () => {
    expect(estaAtrasada({ estado: "POR_HACER" }, HOY)).toBe(false);
  });
  it("la que marcó la planilla está atrasada aunque no tenga fecha", () => {
    expect(estaAtrasada({ estado: "ATRASADO" }, HOY)).toBe(true);
  });
  it("una realizada o una cancelada nunca", () => {
    expect(estaAtrasada({ estado: "REALIZADO", fecha_ejecucion: "2026-01-01" }, HOY)).toBe(false);
    expect(estaAtrasada({ estado: "CANCELADA", fecha_ejecucion: "2026-01-01" }, HOY)).toBe(false);
  });
});

describe("diasDeAtraso", () => {
  it("cuenta contra el inicio efectivo", () => {
    expect(diasDeAtraso({ estado: "POR_HACER", fecha_ejecucion: "2026-11-13" }, HOY)).toBe(6);
  });
  it("null cuando no hay ninguna fecha", () => {
    expect(diasDeAtraso({ estado: "ATRASADO" }, HOY)).toBeNull();
  });
});

describe("condicionDeAtrasada", () => {
  it("nombra las dos columnas de inicio y protege la ventana", () => {
    const c = condicionDeAtrasada(HOY);
    expect(c).toContain("estado.eq.ATRASADO");
    expect(c).toContain(`fecha_ejecucion_pendiente.lt.${HOY}`);
    expect(c).toContain(`fecha_ejecucion.lt.${HOY}`);
    expect(c).toContain(`fecha_fin.lt.${HOY}`);
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/alertas.test.ts`
Expected: FAIL — los campos nuevos no existen en `Atrasable` y `condicionDeAtrasada` no está definida.

- [ ] **Step 3: Reescribir la decisión en `lib/mantenimiento/alertas.ts`**

`estaAtrasada`: cerrada (`ESTADOS_CERRADOS`) → false; `ATRASADO` → true; si no, `inicio = fechaParaElCalendario(orden)?.slice(0, 10)`, y si no hay inicio → false; `fin = fechaFin && fechaFin > inicio ? fechaFin : inicio`; devuelve `fin < hoy`. Todas las fechas recortadas a 10 antes de comparar.

`diasDeAtraso` cuenta contra ese mismo `inicio`.

`condicionDeAtrasada(hoy)` devuelve exactamente esta cadena (verificada contra producción: devuelve las 34 que la versión de TypeScript cuenta). El `fecha_fin <= inicio` del caso sucio no hace falta escribirlo: junto con `inicio < hoy` ya implica `fecha_fin < hoy`.

```
estado.eq.ATRASADO,and(fecha_ejecucion_pendiente.not.is.null,fecha_ejecucion_pendiente.lt.HOY,or(fecha_fin.is.null,fecha_fin.lt.HOY)),and(fecha_ejecucion_pendiente.is.null,fecha_ejecucion.lt.HOY,or(fecha_fin.is.null,fecha_fin.lt.HOY))
```

Actualizar el docstring del archivo: `proxima_fecha` está vacía en las 2531 filas y por eso se dejó de mirar; `CERRADAS` pasa a exportarse como `ESTADOS_CERRADOS`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/alertas.test.ts`
Expected: PASS

- [ ] **Step 5: Seguir la definición en los cuatro lugares que la consumen**

- `app/(app)/mantenimiento/page.tsx`: el `select` pasa a traer `fecha_ejecucion, fecha_ejecucion_pendiente, fecha_fin` en vez de `proxima_fecha`, y el `.or(...)` pasa a ser `condicionDeAtrasada(hoy)` con `.not("estado", "in", `(${ESTADOS_CERRADOS.join(",")})`)`.
- `OrdenarTrabajo.tsx`: sin cambio de código; comprobar que el tipo de `o` trae las tres fechas.
- `DashboardClient.tsx`: sin cambio de código.
- `prioridad.ts`: sin cambio de código; sus tests cambian las fixtures de `proxima_fecha` a `fecha_ejecucion`.

- [ ] **Step 6: Correr la suite y los tipos**

Run: `npx vitest run lib/mantenimiento` y `npm run tipos`
Expected: PASS las dos. Si `tsc` marca un consumidor que este paso no nombra, es un consumidor nuevo: seguirlo igual.

- [ ] **Step 7: Commit**

```bash
git add lib/mantenimiento/alertas.ts lib/mantenimiento/alertas.test.ts lib/mantenimiento/prioridad.test.ts "app/(app)/mantenimiento/page.tsx" "app/(app)/mantenimiento/ordenes/OrdenarTrabajo.tsx" "app/(app)/mantenimiento/DashboardClient.tsx"
git commit -m "fix(mantenimiento): atrasada es que se paso la fecha, no lo que marca la planilla"
```

---

### Task 2: El filtro «atrasada» del listado

El enlace del aviso y la url del push apuntan acá, así que va antes que ellos.

**Files:**
- Modify: `lib/mantenimiento/filtrosOt.ts`
- Test: `lib/mantenimiento/filtrosOt.test.ts`
- Modify: `app/api/mantenimiento/ordenes/route.ts:90-160`
- Modify: `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx`

**Interfaces:**
- Consumes: `condicionDeAtrasada(hoy)` y `ESTADOS_CERRADOS` de la Tarea 1.
- Produces: `FiltrosOt` gana `atrasada: boolean`; `FILTROS_VACIOS.atrasada = false`; en la url es `atrasada=1` y nada cuando es `false`.

- [ ] **Step 1: Escribir los tests que fallan en `lib/mantenimiento/filtrosOt.test.ts`**

```ts
it("lee atrasada=1 de la url", () => {
  expect(leer("atrasada=1").atrasada).toBe(true);
});
it("cualquier otro valor es false", () => {
  expect(leer("atrasada=0").atrasada).toBe(false);
  expect(leer("").atrasada).toBe(false);
});
it("escribe atrasada=1 y no escribe nada cuando es false", () => {
  expect(escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, atrasada: true })).toBe("atrasada=1");
  expect(escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, atrasada: false })).toBe("");
});
it("cuenta como filtro puesto", () => {
  expect(hayAlgunFiltro({ ...FILTROS_VACIOS, atrasada: true })).toBe(true);
});
it("viaja a la consulta de la ruta", () => {
  expect(consultaDeLaRuta({ ...FILTROS_VACIOS, atrasada: true }, 1)).toContain("atrasada=1");
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/filtrosOt.test.ts`
Expected: FAIL — `atrasada` no existe en `FiltrosOt`.

- [ ] **Step 3: Agregar el filtro en `lib/mantenimiento/filtrosOt.ts`**

Campo `atrasada: boolean` en `FiltrosOt` y en `FILTROS_VACIOS`; se lee con `params.get("atrasada") === "1"`; entra a `NOMBRES` como `["atrasada", "atrasada"]` y se escribe sólo cuando es `true`. **No** es un valor más de `estado`: ese vocabulario espeja el de la planilla y meterle uno inventado rompe la validación contra `ESTADOS_DE_OT`.

- [ ] **Step 4: Aplicarlo en `app/api/mantenimiento/ordenes/route.ts`**

Junto a los demás filtros, con `hoyEnArgentina()` como día:

```ts
if (searchParams.get("atrasada") === "1") {
  query = query
    .not("estado", "in", `(${ESTADOS_CERRADOS.join(",")})`)
    .or(condicionDeAtrasada(hoyEnArgentina()));
}
```

Va **después** del `.or(dePrioridad)`: dos `.or()` seguidos se combinan con AND, que es lo que se quiere.

- [ ] **Step 5: Poner el control en `OrdenesClient.tsx`**

Un interruptor «Sólo atrasadas» al lado de los filtros existentes, que escribe `atrasada` en el estado de filtros como los demás.

- [ ] **Step 6: Correr los tests y los tipos**

Run: `npx vitest run lib/mantenimiento/filtrosOt.test.ts` y `npm run tipos`
Expected: PASS las dos.

- [ ] **Step 7: Comprobar contra producción que el filtro devuelve 34**

Run: un script de una vez en el scratchpad que pegue `condicionDeAtrasada("2026-11-19")` contra `ordenes_trabajo` con la `SUPABASE_SERVICE_ROLE_KEY` de `.env.local`.
Expected: 34 órdenes, empezando por la 809 y terminando en la 3142.

- [ ] **Step 8: Commit**

```bash
git add lib/mantenimiento/filtrosOt.ts lib/mantenimiento/filtrosOt.test.ts app/api/mantenimiento/ordenes/route.ts "app/(app)/mantenimiento/ordenes/OrdenesClient.tsx"
git commit -m "feat(mantenimiento): el listado de OT se puede filtrar por atrasadas"
```

---

### Task 3: La campana cuenta por fecha, con id nuevo

**Files:**
- Modify: `lib/home/avisos.ts:45`
- Test: `lib/home/avisos.test.ts`
- Modify: `lib/home/avisosDeUsuario.ts:112`
- Modify: `app/api/cron/avisos-al-instante/route.ts` (la constante `YA_AVISA_SOLO`)

**Interfaces:**
- Consumes: `condicionDeAtrasada`, `ESTADOS_CERRADOS` de la Tarea 1; el filtro `?atrasada=1` de la Tarea 2.
- Produces: el id del aviso pasa a ser `mant-atrasadas-por-fecha`. La clave de `ConteosParaAvisos` sigue siendo `mantenimientoAtrasadas`.

- [ ] **Step 1: Escribir el test que falla en `lib/home/avisos.test.ts`**

```ts
it("el aviso de atrasadas lleva el id nuevo y enlaza al filtro que muestra lo mismo", () => {
  const [aviso] = avisosDeConteos({ mantenimientoAtrasadas: 34 });
  expect(aviso.id).toBe("mant-atrasadas-por-fecha");
  expect(aviso.href).toBe("/mantenimiento/ordenes?atrasada=1");
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run lib/home/avisos.test.ts`
Expected: FAIL — hoy el id es `mant-atrasadas` y el href `?estado=ATRASADO`.

- [ ] **Step 3: Cambiar el id y el href en `lib/home/avisos.ts`**

Con un comentario al lado: el id es nuevo porque el conteo cambió de 21 a 34, y reusarlo haría salir la diferencia como novedad falsa contra `avisos_fotos` y `avisos_vistos`. El viejo queda huérfano en `notificaciones_descartes`, que es inofensivo, y no se reusa.

- [ ] **Step 4: Cambiar el conteo en `lib/home/avisosDeUsuario.ts`**

Reemplazar `head("ordenes_trabajo").eq("estado", "ATRASADO")` por la misma condición del filtro, con `hoy` ya disponible en esa función.

- [ ] **Step 5: Sacarlo del canal de quince minutos**

En `app/api/cron/avisos-al-instante/route.ts`, agregar `"mant-atrasadas-por-fecha"` a `YA_AVISA_SOLO`, con el porqué al lado: el cron de recordatorios lo nombra orden por orden, y dejarlo acá haría que el mismo hecho avise dos veces con números distintos. Sigue en la campana y en los totales de los lunes.

- [ ] **Step 6: Correr los tests y los tipos**

Run: `npx vitest run lib/home` y `npm run tipos`
Expected: PASS las dos.

- [ ] **Step 7: Commit**

```bash
git add lib/home/avisos.ts lib/home/avisos.test.ts lib/home/avisosDeUsuario.ts app/api/cron/avisos-al-instante/route.ts
git commit -m "feat(mantenimiento): la campana cuenta las atrasadas por fecha, con id nuevo"
```

---

### Task 4: El calendario sabe cuál está atrasada

**Files:**
- Modify: `lib/mantenimiento/calendarioDeOT.ts`
- Test: `lib/mantenimiento/calendarioDeOT.test.ts`
- Modify: `app/api/mantenimiento/calendario/route.ts` (la llamada final)

**Interfaces:**
- Consumes: `estaAtrasada` de la Tarea 1.
- Produces: `armarElCalendario(ordenes, desde, hasta, gentePorDia, hoy: string)` — un parámetro más al final; cada entrada de `DiaDelCalendario["ordenes"]` gana `atrasada: boolean`.

- [ ] **Step 1: Escribir los tests que fallan en `lib/mantenimiento/calendarioDeOT.test.ts`**

```ts
it("marca atrasada la orden vencida, en todos los días que ocupa", () => {
  const dias = armarElCalendario(
    [orden({ ot_number: 1, fecha_ejecucion: "2026-11-16", fecha_fin: "2026-11-17" })],
    "2026-11-16", "2026-11-20", new Map(), "2026-11-19"
  );
  expect(dias[0].ordenes[0].atrasada).toBe(true);
  expect(dias[1].ordenes[0].atrasada).toBe(true);
});
it("no marca la que sigue dentro de su ventana, ni en el día ya pasado", () => {
  const dias = armarElCalendario(
    [orden({ ot_number: 2, fecha_ejecucion: "2026-11-18", fecha_fin: "2026-11-25" })],
    "2026-11-18", "2026-11-25", new Map(), "2026-11-19"
  );
  expect(dias.flatMap((d) => d.ordenes).every((o) => !o.atrasada)).toBe(true);
});
it("decide contra el inicio verdadero y no contra el borde del rango", () => {
  const dias = armarElCalendario(
    [orden({ ot_number: 3, fecha_ejecucion: "2026-10-30", fecha_fin: "2026-11-02" })],
    "2026-11-01", "2026-11-30", new Map(), "2026-11-19"
  );
  expect(dias[0].ordenes[0].atrasada).toBe(true);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/calendarioDeOT.test.ts`
Expected: FAIL — `armarElCalendario` toma cuatro parámetros y `atrasada` no existe.

- [ ] **Step 3: Agregar el campo en `lib/mantenimiento/calendarioDeOT.ts`**

`atrasada` se calcula **una vez por orden**, antes del bucle de días, con `estaAtrasada(o, hoy)`, y se copia en cada día que ocupa — igual que los demás campos, y al revés de `arrastre`, que sí depende del día. Docstring: se decide contra la ventana de la orden y no contra el día de la celda, que es lo que evita pintar de rojo un día futuro.

- [ ] **Step 4: Pasarle `hoy` desde la ruta**

En `app/api/mantenimiento/calendario/route.ts`, la última línea pasa a `armarElCalendario(ordenes, desde, hasta, gentePorDia, hoyEnArgentina())`.

- [ ] **Step 5: Correr los tests y los tipos**

Run: `npx vitest run lib/mantenimiento/calendarioDeOT.test.ts` y `npm run tipos`
Expected: PASS las dos.

- [ ] **Step 6: Commit**

```bash
git add lib/mantenimiento/calendarioDeOT.ts lib/mantenimiento/calendarioDeOT.test.ts app/api/mantenimiento/calendario/route.ts
git commit -m "feat(mantenimiento): el calendario dice que orden esta atrasada"
```

---

### Task 5: El rojo en la ficha y en el panel

**Files:**
- Modify: `app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx:569-586` (la ficha) y el panel del día (~690-712)
- Modify: `app/(app)/mantenimiento/ordenes/coloresDeEspecialidad.ts`
- Test: `app/(app)/mantenimiento/ordenes/coloresDeEspecialidad.test.ts`

**Interfaces:**
- Consumes: `atrasada` de la Tarea 4; `diasDeAtraso` de la Tarea 1.
- Produces: `COLOR_ATRASADA = "#b91c1c"` y `TEXTO_SOBRE_ATRASADA = "#ffffff"` en `coloresDeEspecialidad.ts`; `LEYENDA_DE_ESPECIALIDADES` gana una entrada `{ nombre: "Atrasada", color: COLOR_ATRASADA }`.

- [ ] **Step 1: Escribir el test que falla**

Fija lo que la medición descubrió: que el rojo no puede ir **encima** del relleno de especialidad.

```ts
it("el rojo de atrasada contrasta con el blanco de su texto", () => {
  expect(contraste(COLOR_ATRASADA, TEXTO_SOBRE_ATRASADA)).toBeGreaterThan(4.5);
});
it("el rojo NO contrasta contra ningún relleno de especialidad, que es por qué va de relleno y no de franja", () => {
  for (const color of Object.values(COLORES_DE_ESPECIALIDAD)) {
    expect(contraste(COLOR_ATRASADA, color)).toBeLessThan(2);
  }
  expect(contraste(COLOR_ATRASADA, COLOR_SIN_ESPECIALIDAD)).toBeLessThan(2);
});
it("la leyenda nombra la atrasada", () => {
  expect(LEYENDA_DE_ESPECIALIDADES.map((l) => l.nombre)).toContain("Atrasada");
});
```

`contraste(a, b)` es una función del propio test: luminancia relativa WCAG de los dos y `(claro + 0.05) / (oscuro + 0.05)`.

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run "app/(app)/mantenimiento/ordenes/coloresDeEspecialidad.test.ts"`
Expected: FAIL — `COLOR_ATRASADA` no está definido.

- [ ] **Step 3: Agregar los dos colores y la entrada de leyenda**

En `coloresDeEspecialidad.ts`, con el porqué medido al lado: el rojo contra los cinco rellenos da de 1,00:1 a 1,52:1, así que una franja encima no se ve; de relleno con texto blanco da 6,47:1.

- [ ] **Step 4: Pintar la ficha en `CalendarioDeOT.tsx`**

El objeto de `style` pasa a tener cuatro ramas, en este orden:

| | Relleno | Borde | Texto |
|---|---|---|---|
| atrasada, arrastre | `#ffffff` | `1.5px dashed ${COLOR_ATRASADA}` | `COLOR_ATRASADA` |
| atrasada | `COLOR_ATRASADA` | `1.5px solid ${color}` | `TEXTO_SOBRE_ATRASADA` |
| arrastre | `#ffffff` | `1.5px dashed ${color}` | `#0f172a` |
| normal | `color` | `1.5px solid ${color}` | `textoSobreLaEspecialidad(...)` |

Agregar un `title` o `aria-label` que diga «atrasada», porque el color solo no lo dice.

- [ ] **Step 5: Poner la etiqueta en el panel del día**

Al lado de la píldora «OT N», una etiqueta roja con `diasDeAtraso(o, hoy)`: «Atrasada 6 días», «Atrasada 1 día», o «Atrasada» cuando devuelve `null`. Por `style`, no por utilidades.

- [ ] **Step 6: Correr los tests, los tipos y el responsive**

Run: `npx vitest run "app/(app)/mantenimiento/ordenes"`, `npm run tipos`, `node scripts/revisar-responsive.mjs`
Expected: los dos primeros PASS; el tercero ROMPE 0 · APRETADO 0 · MIRAR 1, y ese 1 es la tabla de `calidad/ensayos/reporte` que ya estaba en `main`.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx" "app/(app)/mantenimiento/ordenes/coloresDeEspecialidad.ts" "app/(app)/mantenimiento/ordenes/coloresDeEspecialidad.test.ts"
git commit -m "feat(mantenimiento): la OT atrasada se ve roja en el calendario del mes"
```

---

### Task 6: Qué nombra cada corrida, y cómo se escribe

Todo lógica pura: la parte donde están las decisiones y la única que los tests pueden cubrir de verdad.

**Files:**
- Create: `lib/mantenimiento/recordatorioDeOT.ts`
- Test: `lib/mantenimiento/recordatorioDeOT.test.ts`

**Interfaces:**
- Consumes: `estaAtrasada`, `ESTADOS_CERRADOS` de la Tarea 1; `sumarDias` y `diaDeLaSemana` de `lib/core/fechas.ts`; `Aviso` de `lib/core/webpush.ts`.
- Produces:
  - `interface OrdenParaRecordar { ot_number: number; estado: string | null; fecha_ejecucion: string | null; fecha_ejecucion_pendiente: string | null; fecha_fin: string | null; sector_raw: string | null; descripcion: string | null }`
  - `diasQueCruzaron(hoy: string): string[]` — qué días de inicio cuentan como «se atrasó» en la corrida de `hoy`
  - `diasQueArrancan(hoy: string): string[]` — qué días de inicio cuentan como «arranca en dos días»
  - `lasQueSeAtrasaron(ordenes: OrdenParaRecordar[], hoy: string): OrdenParaRecordar[]`
  - `lasQueArrancan(ordenes: OrdenParaRecordar[], hoy: string): OrdenParaRecordar[]`
  - `textoDeLasAtrasadas(ordenes: OrdenParaRecordar[]): Aviso | null`
  - `textoDeLasQueArrancan(ordenes: OrdenParaRecordar[]): Aviso | null`
  - `URL_ATRASADAS = "/mantenimiento/ordenes?atrasada=1"`, `URL_LISTADO = "/mantenimiento/ordenes"`

- [ ] **Step 1: Escribir los tests que fallan**

El 2026-11-19 es jueves; 21 sábado, 22 domingo, 23 lunes.

```ts
describe("qué días mira cada corrida", () => {
  it("un día común mira ayer, y pasado mañana", () => {
    expect(diasQueCruzaron("2026-11-19")).toEqual(["2026-11-18"]);
    expect(diasQueArrancan("2026-11-19")).toEqual(["2026-11-21"]);
  });
  it("el sábado mira dos días hacia adelante, porque el domingo no corre", () => {
    expect(diasQueArrancan("2026-11-21")).toEqual(["2026-11-23", "2026-11-24"]);
    expect(diasQueCruzaron("2026-11-21")).toEqual(["2026-11-20"]);
  });
  it("el lunes cubre lo que cruzó el sábado y el domingo", () => {
    expect(diasQueCruzaron("2026-11-23")).toEqual(["2026-11-21", "2026-11-22"]);
    expect(diasQueArrancan("2026-11-23")).toEqual(["2026-11-25"]);
  });
  it("ningún día queda sin cubrir, ni hacia atrás ni hacia adelante", () => {
    // Las corridas de un mes: lunes a sábado, nunca domingo.
    const corridas = diasDe("2026-11-01", "2026-11-30").filter((d) => diaDeLaSemana(d) !== 0);
    const cruzados = new Set(corridas.flatMap(diasQueCruzaron));
    const arrancan = new Set(corridas.flatMap(diasQueArrancan));
    // Todo día del medio del mes es mirado por las dos puntas, exactamente una vez.
    for (const dia of diasDe("2026-11-05", "2026-11-25")) {
      expect(cruzados.has(dia)).toBe(true);
      expect(arrancan.has(dia)).toBe(true);
      expect(corridas.filter((c) => diasQueCruzaron(c).includes(dia))).toHaveLength(1);
      expect(corridas.filter((c) => diasQueArrancan(c).includes(dia))).toHaveLength(1);
    }
  });
});

describe("a quién nombra", () => {
  it("la que arrancaba ayer y sigue abierta", () => { /* … */ });
  it("no nombra la que sigue dentro de su ventana", () => { /* fecha_fin futura */ });
  it("no nombra una realizada ni una cancelada", () => { /* … */ });
  it("no nombra la que no tiene ninguna fecha", () => { /* … */ });
  it("usa la pendiente y no la de la planilla", () => { /* … */ });
});

describe("el texto", () => {
  it("null cuando no hay ninguna", () => {
    expect(textoDeLasAtrasadas([])).toBeNull();
    expect(textoDeLasQueArrancan([])).toBeNull();
  });
  it("con una sola la nombra entera", () => {
    expect(textoDeLasAtrasadas([ot(2926, "Planta filler 1", "Revisión sinfín de retorno")]))
      .toEqual({
        title: "Se atrasó una orden de trabajo",
        body: "OT 2926 · Planta filler 1 — Revisión sinfín de retorno",
        url: "/mantenimiento/ordenes?atrasada=1",
      });
  });
  it("con varias dice cuántas y nombra tres", () => {
    const a = textoDeLasQueArrancan([ot(3145, "Hidratación"), ot(3147, "Planta filler 1"),
                                     ot(2486, "Planta filler 1"), ot(2825, "Planta filler 1"),
                                     ot(3122, "Hidratación")]);
    expect(a?.title).toBe("5 órdenes de trabajo arrancan en dos días");
    expect(a?.body).toBe("OT 3145 (Hidratación), OT 3147 (Planta filler 1), OT 2486 (Planta filler 1) y 2 más");
  });
  it("recorta la descripción a 60 caracteres", () => { /* … */ });
  it("aguanta el sector y la descripción vacíos", () => { /* … */ });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/recordatorioDeOT.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Escribir `lib/mantenimiento/recordatorioDeOT.ts`**

`diaDeLaSemana` de `lib/core/fechas.ts` devuelve `getUTCDay()`: **0 es domingo y 6 es sábado**.

`diasQueCruzaron(hoy)`: `[hoy−1]`, salvo cuando `diaDeLaSemana(hoy) === 1` (lunes), que devuelve `[hoy−2, hoy−1]` — o sea sábado y domingo.
`diasQueArrancan(hoy)`: `[hoy+2]`, salvo cuando `diaDeLaSemana(hoy) === 6` (sábado), que devuelve `[hoy+2, hoy+3]` — lunes y martes.

El docstring tiene que decir **por qué** y no sólo qué: el domingo no se manda (pedido), así que el lunes recoge lo que cruzó el fin de semana y el sábado adelanta el aviso del martes, que si no le tocaría el domingo y no saldría nunca. Un aviso tres días antes es aceptable; uno que no sale, no.

Las dos selecciones filtran por `estaAtrasada` / por no estarlo según corresponda, y comparan el inicio efectivo recortado a 10 contra la lista de días.

Los dos textos siguen la forma de `textoDeLaDivergencia` en `lib/agenda/avisoDeDivergencia.ts`: tres nombradas y «y N más».

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/recordatorioDeOT.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/recordatorioDeOT.ts lib/mantenimiento/recordatorioDeOT.test.ts
git commit -m "feat(mantenimiento): que OT nombra cada corrida del recordatorio"
```

---

### Task 7: El cron que manda los dos avisos

**Files:**
- Modify: `lib/mantenimiento/recordatorioDeOT.ts` (el envío)
- Test: `lib/mantenimiento/recordatorioDeOT.test.ts`
- Create: `app/api/cron/mantenimiento-recordatorios/route.ts`
- Modify: `vercel.json`
- Modify: `lib/core/avisoAlInstante.ts` (el renglón que lleva la cuenta de los emisores de afuera)

**Interfaces:**
- Consumes: todo lo de la Tarea 6; `enviarPush` de `lib/core/webpush.ts`; `esHoraDeAvisar` y `ResultadoDelAviso` de `lib/core/avisoAlInstante.ts`; `nivelEnModulo` de `lib/core/access.ts`; `revisarElSecreto` de `lib/core/cron.ts`; `traerTodo` de `lib/core/paginado.ts`.
- Produces:
  - `quienesAdministran(usuarios, grants): Set<string>` — los ids con `nivelEnModulo(...) === "admin"` en `mantenimiento`, de entre los activos
  - `avisarDeLasOT(admin: SupabaseClient, hoy: string, ahora?: Date): Promise<ResultadoDelAviso & { atrasadas: number; proximas: number }>`

- [ ] **Step 1: Escribir los tests que fallan, sobre `quienesAdministran`**

Es la única mitad del envío que es pura. Las fixtures copian la forma real medida: un `encargado` con grant `admin`, un `admin_sistema` con grant `edicion`, un `admin_sistema` con grant `lectura`, un `encargado` con grant `lectura`, y uno inactivo con grant `admin`.

```ts
it("son los que tienen admin efectivo en Mantenimiento", () => {
  expect(quienesAdministran(USUARIOS, GRANTS)).toEqual(
    new Set(["francisco", "nicolas", "bernardo", "delfina", "rocco"])
  );
});
it("un admin del sistema con lectura explícita entra igual", () => {
  expect(quienesAdministran(USUARIOS, GRANTS).has("delfina")).toBe(true);
});
it("quien tiene lectura y no es admin del sistema no entra", () => {
  expect(quienesAdministran(USUARIOS, GRANTS).has("enzo")).toBe(false);
});
it("una cuenta desactivada no entra aunque tenga el grant", () => {
  expect(quienesAdministran(USUARIOS, GRANTS).has("dadadebaja")).toBe(false);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/recordatorioDeOT.test.ts`
Expected: FAIL — `quienesAdministran` no está definida.

- [ ] **Step 3: Escribir el envío en `lib/mantenimiento/recordatorioDeOT.ts`**

`avisarDeLasOT` sigue el orden de `avisarDeLasDivergencias` en `lib/agenda/avisoDeDivergencia.ts`, que es el que no cuesta nada cuando no hay nada que hacer: primero la hora (`esHoraDeAvisar`), después las órdenes, y recién ahí la gente. **Nunca tira**: todo adentro de un `try` que devuelve el motivo, porque un push service caído no puede hacer fallar una corrida de cron.

Manda **una notificación por aparato y por aviso**, a todas las suscripciones de los que administran; una suscripción que el push service da por vencida se borra, sólo esa fila. Las personas desactivadas no reciben.

El docstring tiene que decir, como el de la Agenda, que esto **no pasa por `avisarAQuienDecide()`** y que **no cumple la condición 2** —nada se frena hasta que alguien reprograme—: se manda porque se pidió, y es un precedente y no un permiso. Y el número incómodo: medido el 19/11/2026, de los cinco que administran Mantenimiento sólo dos tienen suscripción, y son los dos `admin_sistema`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/recordatorioDeOT.test.ts`
Expected: PASS

- [ ] **Step 5: Escribir la ruta `app/api/cron/mantenimiento-recordatorios/route.ts`**

`revisarElSecreto(request)` primero, `export const maxDuration = 300`, cliente admin, `hoyEnArgentina()`, y devuelve el resultado como JSON. Lee `ordenes_trabajo` con `traerTodo()` y el `select` literal de `OrdenParaRecordar`.

El encabezado dice por qué el cron es diario y no cada quince minutos, y por qué de lunes a sábado.

- [ ] **Step 6: Programarlo en `vercel.json`**

`{ "path": "/api/cron/mantenimiento-recordatorios", "schedule": "0 11 * * 1-6" }`. Son las 8:00 de Argentina, dentro de la ventana, y 1-6 es lunes a sábado. **No** va a GitHub Actions: desde el 05/11/2026 el reloj es uno solo.

- [ ] **Step 7: Anotar el emisor nuevo en `lib/core/avisoAlInstante.ts`**

En la sección «HAY UNA EXCEPCIÓN, Y NO PASA POR ACÁ», sumar este emisor al lado del de la Agenda, con la misma forma: qué condiciones cumple, cuál no, y que no es permiso para el próximo.

- [ ] **Step 8: Correr la suite entera, los tipos y el build**

Run: `npm test`, `npm run tipos`, `NODE_OPTIONS=--max-old-space-size=8192 npm run build`
Expected: los tres PASS. La suite tiene que quedar por encima de los 7182 tests de la base.

- [ ] **Step 9: Comprobar contra producción, sin mandar nada**

Run: un script de una vez que lea `ordenes_trabajo` y corra `lasQueSeAtrasaron` y `lasQueArrancan` para el 19, el 21 y el 23 de noviembre.
Expected: para el 21 (sábado), `lasQueArrancan` nombra las del lunes 23 **y** las del martes 24; para el 23 (lunes), `diasQueCruzaron` incluye el 21 y el 22. Ninguna OT sin fecha aparece en ninguna lista.

- [ ] **Step 10: Commit**

```bash
git add lib/mantenimiento/recordatorioDeOT.ts lib/mantenimiento/recordatorioDeOT.test.ts app/api/cron/mantenimiento-recordatorios/route.ts vercel.json lib/core/avisoAlInstante.ts
git commit -m "feat(mantenimiento): un push dos dias antes de una OT y otro cuando se atrasa"
```

---

### Task 8: La documentación

**Files:**
- Modify: `docs/MANTENIMIENTO-INTEGRACION.md`
- Modify: `CLAUDE.md` (la fila de Mantenimiento y la sección de avisos)

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Escribir la sección en `docs/MANTENIMIENTO-INTEGRACION.md`**

`## Cuándo una OT está atrasada, y quién se entera`. Lo que no se deduce del código:

- **`proxima_fecha` está vacía en las 2531 filas** y por eso `estaAtrasada` decía 21 donde la fecha dice 34. La consulta del tablero ya intentaba mirar la fecha con esa misma columna: unificar fue terminar lo que estaba escrito.
- **«Atrasada» es que la ventana entera quedó atrás**, no que el inicio haya pasado: una OT que arrancó ayer y termina el 30 está en curso. Y como el dato viaja por orden y no por día, mirar sólo el inicio pintaría de rojo celdas de días futuros.
- **El rojo va de relleno y la especialidad al borde**, porque el rojo sobre los cinco rellenos da de 1,00:1 a 1,52:1 — contra el gris es el mismo tono de luz exacto.
- **El cron corre de lunes a sábado**: por eso el lunes cubre dos días hacia atrás y el sábado dos hacia adelante. Sacar uno de los dos deja un día sin avisar y nada lo dice.
- **Le llega a dos personas**, medido el 19/11/2026: de los cinco que administran el módulo, sólo los dos `admin_sistema` tienen las notificaciones prendidas.
- **Si el cron se muere nadie se entera**: como los otros cuatro crons de push, no escribe en `sincronizaciones` y no está en el `REGISTRO` de salud.

- [ ] **Step 2: Actualizar `CLAUDE.md`**

En la fila de Mantenimiento, el enlace al spec y al plan con las tres o cuatro cosas que no se deducen del código. En la sección de avisos, el payload pasa a tener **seis** emisores y este emisor se nombra al lado del de la Agenda.

- [ ] **Step 3: Comprobar que el árbol commiteado está completo**

Run: `node scripts/revisar-arbol-commiteado.mjs`
Expected: sin faltantes.

- [ ] **Step 4: Commit**

```bash
git add docs/MANTENIMIENTO-INTEGRACION.md CLAUDE.md
git commit -m "docs(mantenimiento): que significa atrasada y quien se entera"
```

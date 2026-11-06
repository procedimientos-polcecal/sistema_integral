# Avisos al instante — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cuando un pedido de compra o una orden de servicio quede esperando
una decisión, quien tiene que decidir reciba un push en el momento y no al otro
día a las 8:30.

**Architecture:** Un módulo nuevo del núcleo, `lib/core/avisoAlInstante.ts`, con
las tres decisiones puras —si es hora, quién recibe, qué dice— y un único envío
que nunca relanza. Lo llaman tres lugares que ya saben qué acaba de nacer: la
sincronización de Compras, el alta de un requerimiento desde la app, y la
sincronización de órdenes de servicio. No hay tabla nueva: la idempotencia sale
de anunciar sólo lo que esta corrida insertó.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase/PostgREST,
`web-push` a través de `lib/core/webpush.ts`, vitest.

**Spec:** [docs/superpowers/specs/2026-10-18-avisos-al-instante-design.md](../specs/2026-10-18-avisos-al-instante-design.md)

## Global Constraints

- Todo en castellano: nombres, comentarios, textos de pantalla y de commit. Los
  comentarios explican **por qué**, no qué.
- **No hay migración.** Ninguna tarea crea tablas ni columnas: si una parece
  necesitarlo, está mal planteada.
- **El envío nunca puede voltear la acción que lo disparó.** Todo va después de
  que el dato está guardado, adentro de un `try/catch` que no relanza, y un
  fallo de envío no cuenta como fallo de la corrida.
- **Una notificación por corrida, no una por ítem.** Medido: mediana 2 filas
  nuevas por corrida, promedio 3,7, máximo 16.
- Ventana horaria **7:00–21:00 de Argentina**, decidida con el desplazamiento
  fijo UTC−3 de `lib/core/fechas.ts`, nunca con el huso del runtime.
- Cero ítems es **no mandar**, nunca una notificación que diga que no pasa nada.
- No se toca `public/sw.js`, ni `lib/home/avisos.ts`, ni el cron
  `avisos-diarios` — hay otra sesión en `public/sw.js` y en las rutas de alta de
  Mantenimiento.
- `traerTodo()` de `lib/core/paginado.ts` en cualquier lectura que pueda pasar
  las 1000 filas.
- Nunca `git add -A`: se commitea nombrando las rutas
  (`git commit --only <rutas> -F -`).

## Review Focus

Lo que el spec implica, ninguna tarea ejercita por sí sola, y es lo que primero
va a morder:

1. **Una corrida con 200 filas nuevas** manda **una** notificación, no 200 — el
   freno contra una pegada en la planilla sale de la forma del texto, así que
   tiene que estar pinchado con un test (tarea 1).
2. **Las 00:00 y las 23:59 de Argentina** caen fuera de la ventana aunque en UTC
   sean las 03:00 y las 02:59 del día siguiente: el borde se prueba con el
   instante UTC, que es lo que recibe la función en producción (tarea 1).
3. **Un push service caído** no puede hacer fallar la sincronización ni el alta:
   `enviarPush` devuelve `"fallo"` y el llamador sigue (tareas 2, 3, 4, 5).
4. **Un aprobador dado de baja** que todavía tiene su suscripción no recibe —
   `push_suscripciones` sobrevive hasta que se borre la fila de `usuarios`
   (tarea 2).
5. **Quien cargó el pedido es aprobador**: no se le avisa de lo que acaba de
   hacer él (tareas 1 y 2).

---

## Task 1: Las tres decisiones, puras

**Files:**
- Create: `lib/core/avisoAlInstante.ts`
- Test: `lib/core/avisoAlInstante.test.ts`
- Modify: `lib/core/fechas.ts`
- Test: `lib/core/fechas.test.ts`

**Interfaces:**
- Consumes: `Aviso` de `lib/core/webpush.ts` (`{ title, body, url }`).
- Produces:
  - `horaEnArgentina(instante?: Date): number` en `lib/core/fechas.ts` — la hora
    de pared, 0 a 23.
  - `ItemQueEspera = { etiqueta: string; descripcion: string | null }`
  - `NombreDeLoQueEspera = { singular: string; plural: string }`
  - `esHoraDeAvisar(instante?: Date): boolean`
  - `textoDeLaInterrupcion(items: ItemQueEspera[], nombre: NombreDeLoQueEspera, url: string): Aviso | null`
  - `aparatosAAvisar<T extends { usuario_id: string }>(suscripciones: T[], puedenDecidir: Set<string>, excepto: string | null): T[]`

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/core/fechas.test.ts`, agregar al bloque que ya existe:

```ts
it("horaEnArgentina usa UTC-3 fijo y no el huso del runtime", () => {
  expect(horaEnArgentina(new Date("2026-10-18T12:00:00Z"))).toBe(9);
  expect(horaEnArgentina(new Date("2026-10-18T02:00:00Z"))).toBe(23);
  expect(horaEnArgentina(new Date("2026-10-18T00:30:00Z"))).toBe(21);
});
```

En `lib/core/avisoAlInstante.test.ts`:

```ts
describe("esHoraDeAvisar", () => {
  // La ventana es 7:00-21:00 de Argentina, o sea 10:00-00:00 UTC.
  it("adentro de la ventana", () => {
    expect(esHoraDeAvisar(new Date("2026-10-18T12:00:00Z"))).toBe(true); // 9 AR
    expect(esHoraDeAvisar(new Date("2026-10-18T10:00:00Z"))).toBe(true); // 7 AR, el borde
    expect(esHoraDeAvisar(new Date("2026-10-18T23:59:00Z"))).toBe(true); // 20:59 AR
  });
  it("afuera: la madrugada de Argentina, que en UTC es el dia siguiente", () => {
    expect(esHoraDeAvisar(new Date("2026-10-19T00:00:00Z"))).toBe(false); // 21 AR
    expect(esHoraDeAvisar(new Date("2026-10-19T03:00:00Z"))).toBe(false); // 0 AR
    expect(esHoraDeAvisar(new Date("2026-10-19T02:59:00Z"))).toBe(false); // 23:59 AR
    expect(esHoraDeAvisar(new Date("2026-10-18T09:00:00Z"))).toBe(false); // 6 AR, el cron
  });
});

describe("textoDeLaInterrupcion", () => {
  const PEDIDO = { singular: "Un pedido", plural: "pedidos" };
  const URL = "/compras/aprobaciones";

  it("sin items no se manda nada", () => {
    expect(textoDeLaInterrupcion([], PEDIDO, URL)).toBeNull();
  });

  it("uno solo se nombra, con lo que pidio", () => {
    expect(textoDeLaInterrupcion(
      [{ etiqueta: "RI 1842", descripcion: "Rodamiento SKF 6205" }], PEDIDO, URL
    )).toEqual({
      title: "Un pedido espera tu aprobación",
      body: "RI 1842 · Rodamiento SKF 6205",
      url: URL,
    });
  });

  it("uno solo sin descripcion queda con la etiqueta sola", () => {
    expect(textoDeLaInterrupcion(
      [{ etiqueta: "OS 231", descripcion: null }],
      { singular: "Una orden de servicio", plural: "órdenes de servicio" }, URL
    )).toEqual({
      title: "Una orden de servicio espera tu aprobación",
      body: "OS 231",
      url: URL,
    });
  });

  it("tres se nombran todos", () => {
    const r = textoDeLaInterrupcion(
      [1842, 1843, 1844].map((n) => ({ etiqueta: `RI ${n}`, descripcion: "x" })), PEDIDO, URL
    );
    expect(r).toEqual({
      title: "3 pedidos esperan tu aprobación",
      body: "RI 1842, RI 1843 y RI 1844",
      url: URL,
    });
  });

  // El freno contra una pegada de doscientas filas en la planilla: sigue
  // siendo UNA notificacion. Es la regla que gobierna todo el diseño.
  it("doscientos son una sola notificacion", () => {
    const r = textoDeLaInterrupcion(
      Array.from({ length: 200 }, (_, i) => ({ etiqueta: `RI ${i + 1}`, descripcion: null })),
      PEDIDO, URL
    );
    expect(r).toEqual({
      title: "200 pedidos esperan tu aprobación",
      body: "RI 1, RI 2, RI 3 y 197 más",
      url: URL,
    });
  });

  it("una descripcion larga se recorta", () => {
    const larga = "a".repeat(200);
    const r = textoDeLaInterrupcion([{ etiqueta: "RI 1", descripcion: larga }], PEDIDO, URL);
    expect(r!.body.length).toBeLessThanOrEqual(90);
    expect(r!.body.endsWith("…")).toBe(true);
  });
});

describe("aparatosAAvisar", () => {
  const subs = [
    { usuario_id: "ana", endpoint: "a1" },
    { usuario_id: "ana", endpoint: "a2" },
    { usuario_id: "beto", endpoint: "b1" },
    { usuario_id: "caro", endpoint: "c1" },
  ];

  it("los dos aparatos de la misma persona reciben los dos", () => {
    expect(aparatosAAvisar(subs, new Set(["ana"]), null)).toEqual([
      { usuario_id: "ana", endpoint: "a1" },
      { usuario_id: "ana", endpoint: "a2" },
    ]);
  });

  it("quien no puede decidir no recibe", () => {
    expect(aparatosAAvisar(subs, new Set(["beto"]), null).map((s) => s.endpoint)).toEqual(["b1"]);
  });

  it("a quien lo cargo no se le avisa de lo que acaba de hacer", () => {
    expect(aparatosAAvisar(subs, new Set(["ana", "beto"]), "ana").map((s) => s.endpoint))
      .toEqual(["b1"]);
  });

  it("nadie con suscripcion entre los que deciden da vacio", () => {
    expect(aparatosAAvisar(subs, new Set(["nadie"]), null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/core/avisoAlInstante.test.ts lib/core/fechas.test.ts`
Expected: FAIL, `avisoAlInstante` no existe y `horaEnArgentina` no está exportada.

- [ ] **Step 3: Implementar `horaEnArgentina(instante: Date = new Date()): number` en `lib/core/fechas.ts`**

Al lado de `ahoraEnArgentina`, con el mismo `OFFSET_ARGENTINA_MS` que ya está en
el archivo. El comentario dice por qué no se usa `getHours()`: Vercel corre en
UTC, así que a las 22 de Argentina el runtime cree que son las 1.

- [ ] **Step 4: Implementar las tres puras en `lib/core/avisoAlInstante.ts`**

El encabezado del archivo es la parte que importa, y tiene que decir las tres
cosas que no se deducen del código:

- **qué merece interrumpir** — las tres condiciones del spec (una persona
  nombrada esperando, nada avanza hasta que decida, acaba de pasar) y la lista
  de los que no pasan, para poder decirle que no al próximo módulo;
- **por qué una por corrida y no una por ítem** — con los números: 42 corridas
  con filas nuevas en 27 días, mediana 2, máximo 16; una por ítem reproduce
  exactamente lo que la fase 2 decidió no hacer;
- **por qué la ventana horaria no encola nada** — el resumen de las 8:30 ya
  cuenta los `PENDIENTE` sin mirar cuándo entraron, así que el repesque existe
  sin código.

Las constantes de la ventana (`DESDE = 7`, `HASTA = 21`) van nombradas y con el
comentario de que 21 es exclusivo.

`CUANTOS_SE_NOMBRAN = 3` y el recorte de la descripción a 60 caracteres con `…`.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/core/avisoAlInstante.test.ts lib/core/fechas.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit --only lib/core/avisoAlInstante.ts lib/core/avisoAlInstante.test.ts lib/core/fechas.ts lib/core/fechas.test.ts -F -
```

Mensaje: `feat(core): las tres decisiones de un aviso al instante`. El cuerpo
explica por qué una por corrida y no una por ítem, con los números medidos.

---

## Task 2: El envío, que no puede hacer fallar a nadie

**Files:**
- Modify: `lib/core/avisoAlInstante.ts`

**Interfaces:**
- Consumes: `enviarPush`, `SuscripcionPush` de `lib/core/webpush.ts`; las tres
  puras de la tarea 1; `traerTodo` de `lib/core/paginado.ts`.
- Produces:
  ```ts
  export type ListaDeAprobadores = "compras_aprobadores" | "os_aprobadores";

  export interface ResultadoDelAviso {
    enviadas: number;
    personas: number;
    /** Por qué no se mandó, cuando no se mandó. Para el log y para la respuesta del sync. */
    motivo?: string;
  }

  export async function avisarAQuienDecide(
    admin: SupabaseClient,
    opciones: {
      lista: ListaDeAprobadores;
      items: ItemQueEspera[];
      nombre: NombreDeLoQueEspera;
      url: string;
      /** Quien lo cargó: no se le avisa de lo que acaba de hacer. */
      excepto?: string | null;
      /** Sólo para los tests. En producción se llama sin nada. */
      ahora?: Date;
    }
  ): Promise<ResultadoDelAviso>;
  ```

- [ ] **Step 1: Escribir el test que falla**

En `lib/core/avisoAlInstante.test.ts`, con un cliente falso —el mismo molde que
`lib/mantenimiento/*.test.ts` usa para fingir PostgREST— y `vi.mock` sobre
`@/lib/core/webpush`:

```ts
describe("avisarAQuienDecide", () => {
  it("fuera de hora no manda y lo dice", async () => {
    const r = await avisarAQuienDecide(clienteFalso({}), {
      lista: "compras_aprobadores", items: [uno()], nombre: PEDIDO,
      url: "/compras/aprobaciones", ahora: new Date("2026-10-19T05:00:00Z"),
    });
    expect(r).toEqual({ enviadas: 0, personas: 0, motivo: "fuera de hora" });
    expect(enviarPush).not.toHaveBeenCalled();
  });

  it("sin items no lee ni manda nada", async () => { /* motivo: "nada que avisar" */ });

  it("un aprobador dado de baja no recibe aunque tenga suscripcion", async () => { /* … */ });

  it("manda a cada aparato de cada aprobador activo", async () => { /* enviadas: 3, personas: 2 */ });

  // Un push service caido no puede voltear la sincronizacion.
  it("si enviarPush tira, devuelve el motivo y no relanza", async () => {
    vi.mocked(enviarPush).mockRejectedValue(new Error("boom"));
    await expect(avisarAQuienDecide(/* … */)).resolves.toMatchObject({ enviadas: 0 });
  });

  it("si la lectura de la base tira, devuelve el motivo y no relanza", async () => { /* … */ });

  it("una suscripcion vencida se borra, y las otras de la misma persona no", async () => { /* … */ });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/core/avisoAlInstante.test.ts`
Expected: FAIL, `avisarAQuienDecide` no existe.

- [ ] **Step 3: Implementar `avisarAQuienDecide`**

El orden es el que hace que sea barato cuando no hay nada que hacer: primero
`items.length === 0`, después `esHoraDeAvisar`, y recién ahí se toca la base.
Las lecturas son tres: la lista de aprobadores, `push_suscripciones` con
`traerTodo`, y `usuarios` filtrado por `activo` sobre los ids que quedaron.
El borrado de la vencida copia el del cron: por `(usuario_id, endpoint)`, no por
usuario.

El `try/catch` envuelve **todo** el cuerpo y devuelve
`{ enviadas, personas, motivo: mensaje }`. El comentario dice por qué: un push
service caído no puede hacer que la compra no quede pedida.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run lib/core/avisoAlInstante.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit --only lib/core/avisoAlInstante.ts lib/core/avisoAlInstante.test.ts -F -
```

Mensaje: `feat(core): el envio de un aviso al instante, que no voltea nada`.

---

## Task 3: Cuáles nacieron esperando, en Compras

**Files:**
- Modify: `lib/compras/ordenesDesdeLaPlanilla.ts`
- Test: `lib/compras/ordenesDesdeLaPlanilla.test.ts`
- Modify: `lib/compras/sheets.ts`

**Interfaces:**
- Consumes: `ItemQueEspera` de `lib/core/avisoAlInstante.ts`.
- Produces:
  ```ts
  export function lasQueNacenEsperando(
    escritas: { nro_ri: number; descripcion?: unknown; estado_aprobacion?: unknown }[],
    previas: Map<number, unknown>
  ): ItemQueEspera[];
  ```
  Vive al lado de `lasQuePasaronAPedido`, que resuelve el problema gemelo sobre
  los mismos dos argumentos.

- [ ] **Step 1: Escribir el test que falla**

En `lib/compras/ordenesDesdeLaPlanilla.test.ts`:

```ts
describe("lasQueNacenEsperando", () => {
  const antes = (nros: number[]) => new Map(nros.map((n) => [n, {}]));

  it("una que ya estaba no nace", () => {
    expect(lasQueNacenEsperando(
      [{ nro_ri: 10, descripcion: "x", estado_aprobacion: "PENDIENTE" }], antes([10])
    )).toEqual([]);
  });

  it("una nueva en PENDIENTE nace esperando", () => {
    expect(lasQueNacenEsperando(
      [{ nro_ri: 11, descripcion: "Rodamiento", estado_aprobacion: "PENDIENTE" }], antes([])
    )).toEqual([{ etiqueta: "RI 11", descripcion: "Rodamiento" }]);
  });

  it("EN_REVISION tambien espera: es lo mismo que cuenta la campana", () => {
    expect(lasQueNacenEsperando(
      [{ nro_ri: 12, descripcion: "x", estado_aprobacion: "EN_REVISION" }], antes([])
    )).toHaveLength(1);
  });

  it("una que la planilla trae ya aprobada o denegada no interrumpe a nadie", () => {
    expect(lasQueNacenEsperando([
      { nro_ri: 13, descripcion: "x", estado_aprobacion: "APROBADA" },
      { nro_ri: 14, descripcion: "x", estado_aprobacion: "DENEGADA" },
      { nro_ri: 15, descripcion: "x", estado_aprobacion: null },
    ], antes([]))).toEqual([]);
  });

  it("'(sin descripción)' es el relleno del importador, no una descripcion", () => {
    expect(lasQueNacenEsperando(
      [{ nro_ri: 16, descripcion: "(sin descripción)", estado_aprobacion: "PENDIENTE" }], antes([])
    )).toEqual([{ etiqueta: "RI 16", descripcion: null }]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/compras/ordenesDesdeLaPlanilla.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `lasQueNacenEsperando`**

Mismo molde que `lasQuePasaronAPedido`: un `filter` y un `map`. Los dos estados
que esperan son `PENDIENTE` y `EN_REVISION`, y el comentario dice de dónde salen
—son los mismos dos que cuenta `avisosDeUsuario`, así que lo que interrumpe y lo
que la campana muestra no pueden decir cosas distintas—.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run lib/compras/ordenesDesdeLaPlanilla.test.ts`
Expected: PASS

- [ ] **Step 5: Engancharlo en `importarDesdeSheets`**

En `lib/compras/sheets.ts`, **después** del bucle de `upsert` y del bloque de
Odoo, antes del `return`. Usa `aEscribir` y `previo`, que ya están en alcance —
son los mismos dos que recibe `lasQuePasaronAPedido` tres líneas más arriba.

```ts
const nacenEsperando = lasQueNacenEsperando(
  aEscribir as { nro_ri: number }[], previo
);
const aviso = await avisarAQuienDecide(admin, {
  lista: "compras_aprobadores",
  items: nacenEsperando,
  nombre: { singular: "Un pedido", plural: "pedidos" },
  url: "/compras/aprobaciones",
});
```

`avisar_push: aviso.enviadas` entra en el objeto que devuelve la función, al
lado de `ordenes_odoo`. **No entra en `resultado`**, que es exactamente lo que
se inserta en `compras_sincronizaciones` y esa tabla no tiene la columna — es la
misma razón por la que `ResultadoSyncCompleto` existe aparte de `ResultadoSync`.

Agregar `avisar_push?: number` a `ResultadoSyncCompleto`, con el comentario de
que un fallo de envío no es un fallo de la corrida.

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `npx vitest run lib/compras/ && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git commit --only lib/compras/ordenesDesdeLaPlanilla.ts lib/compras/ordenesDesdeLaPlanilla.test.ts lib/compras/sheets.ts -F -
```

Mensaje: `feat(compras): avisar al instante de los pedidos que nacen esperando`.
El cuerpo dice que 397 de los últimos 400 RI entraron por la planilla, que es
por lo que el enganche va acá y no en la ruta de alta.

---

## Task 4: El alta desde la app también avisa

**Files:**
- Modify: `app/api/compras/requerimientos/route.ts`

**Interfaces:**
- Consumes: `avisarAQuienDecide` de `lib/core/avisoAlInstante.ts`.

- [ ] **Step 1: Engancharlo**

En el `POST`, dentro del `if (!error)`, **después** del bloque que exporta el
alta a la planilla y antes del `return`. El `excepto` es `user.id`: quien carga
un pedido suele ser aprobador, y avisarle de lo que acaba de hacer es la clase
de notificación que enseña a ignorarlas.

```ts
await avisarAQuienDecide(admin, {
  lista: "compras_aprobadores",
  items: [{ etiqueta: `RI ${data.nro_ri}`, descripcion }],
  nombre: { singular: "Un pedido", plural: "pedidos" },
  url: "/compras/aprobaciones",
  excepto: user.id,
});
```

El comentario dice por qué va después de la planilla y no antes: el alta ya está
guardada, así que esto no puede voltear nada — y el orden importa porque la
exportación es la parte lenta y la que puede tardar.

Nada de lo que devuelve entra en la respuesta de la ruta: quien cargó el pedido
no tiene nada que hacer con que a otro le haya llegado o no un push.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit --only app/api/compras/requerimientos/route.ts -F -
```

Mensaje: `feat(compras): el alta desde la app tambien avisa a quien aprueba`.

---

## Task 5: Las órdenes de servicio que nacen esperando

**Files:**
- Modify: `lib/mantenimiento/aprobacion.ts`
- Test: `lib/mantenimiento/aprobacion.test.ts`
- Modify: `lib/mantenimiento/sincronizar.ts`

**Interfaces:**
- Consumes: `esperaDecision` de `lib/mantenimiento/aprobacion.ts` (ya existe);
  `ItemQueEspera` y `avisarAQuienDecide` de `lib/core/avisoAlInstante.ts`.
- Produces:
  ```ts
  export function lasOSQueNacenEsperando(
    registros: { os_number: number; descripcion?: string | null; sheets_tab: string | null; estado: string | null }[],
    yaEstaban: Set<number>
  ): ItemQueEspera[];
  ```

- [ ] **Step 1: Escribir el test que falla**

En `lib/mantenimiento/aprobacion.test.ts`, al lado de los de `esperaDecision`:

```ts
describe("lasOSQueNacenEsperando", () => {
  const enMaestro = (n: number, estado: string | null = null) =>
    ({ os_number: n, descripcion: `trabajo ${n}`, sheets_tab: "SERVICIOS", estado });

  it("una que ya estaba no nace", () => {
    expect(lasOSQueNacenEsperando([enMaestro(10)], new Set([10]))).toEqual([]);
  });

  it("una nueva en el maestro espera decision", () => {
    expect(lasOSQueNacenEsperando([enMaestro(11)], new Set()))
      .toEqual([{ etiqueta: "OS 11", descripcion: "trabajo 11" }]);
  });

  it("una nueva que la planilla trae ya en la pestaña de su area no espera a nadie", () => {
    expect(lasOSQueNacenEsperando(
      [{ os_number: 12, descripcion: "x", sheets_tab: "CALCINACIÓN", estado: null }], new Set()
    )).toEqual([]);
  });

  it("una denegada no interrumpe", () => {
    expect(lasOSQueNacenEsperando([enMaestro(13, "DENEGADO")], new Set())).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/mantenimiento/aprobacion.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `lasOSQueNacenEsperando`**

Un `filter` sobre `!yaEstaban.has(os_number) && esperaDecision(os)` y un `map`.
No se reimplementa qué significa "espera": `esperaDecision` ya lo decide, y su
encabezado explica por qué la pregunta se hace sobre la pestaña y no sobre la
columna de estado.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run lib/mantenimiento/aprobacion.test.ts`
Expected: PASS

- [ ] **Step 5: Engancharlo en `sincronizarOrdenesDeServicio`**

En `lib/mantenimiento/sincronizar.ts`. A diferencia de Compras, este `upsert` no
sabe cuáles son nuevas, así que hay que leer los números que ya están **antes**
del bucle de `upsert`:

```ts
const yaEstaban = new Set(
  (await traerTodo<{ os_number: number }>((desde, hasta) =>
    admin.from("ordenes_servicio").select("os_number").range(desde, hasta)
  )).map((o) => o.os_number)
);
```

`traerTodo` y no `.select()` a secas: son 261 filas hoy y PostgREST corta en
1000 sin avisar.

El aviso va **después** del `borrarLoQueLaPlanillaNoTrajo` y del
`registrarSincronizacion`, con `lista: "os_aprobadores"` y
`nombre: { singular: "Una orden de servicio", plural: "órdenes de servicio" }`.
La url es `/compras/aprobaciones`, igual que las compras: es donde se ejerce la
decisión, aunque la OS sea una entidad de Mantenimiento.

`avisar_push: aviso.enviadas` entra en el `logra({ … })`.

- [ ] **Step 6: Verificar**

Run: `npx vitest run lib/mantenimiento/ && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git commit --only lib/mantenimiento/aprobacion.ts lib/mantenimiento/aprobacion.test.ts lib/mantenimiento/sincronizar.ts -F -
```

Mensaje: `feat(mantenimiento): avisar al instante de las OS que nacen esperando`.

---

## Task 6: Que quede escrito dónde se busca

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-10-16-app-instalable-design.md`

- [ ] **Step 1: Ampliar la sección «Un aviso nuevo sale por dos lados» de `CLAUDE.md`**

Son tres lados ahora, y lo que hay que decir es el portón: las tres condiciones
para interrumpir, que sólo las cumplen las dos aprobaciones, y que un aviso
nuevo en `lib/home/avisos.ts` **no** se vuelve instantáneo solo —eso se decide
en `lib/core/avisoAlInstante.ts` y hay que querer hacerlo—.

- [ ] **Step 2: Anotar la fase en el spec de la app instalable**

Esa sección lista cuatro fases. El instantáneo no es una quinta: es la excepción
explícita a la decisión de la fase 2, y el spec de la fase 2 ya dice por qué no
se avisa por evento. Una línea que enlace
[el spec del instantáneo](2026-10-18-avisos-al-instante-design.md) y diga que
esa decisión sigue en pie para todo lo demás.

- [ ] **Step 3: Commit**

```bash
git commit --only CLAUDE.md docs/superpowers/specs/2026-10-16-app-instalable-design.md -F -
```

Mensaje: `docs: las tres condiciones para interrumpir a alguien`.

---

## Task 7: Verificación completa y prueba en producción

- [ ] **Step 1: Las cuatro verificaciones**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
```

`npm run build` con `npm run dev` levantado deja la app en 500: parar el dev
server antes.

- [ ] **Step 2: Pushear**

```bash
git push origin main
```

- [ ] **Step 3: Probar de verdad en producción**

Que el código parezca correcto no es la prueba. El único usuario con push
prendido hoy es Bernardo Strupp (`procedimientos@polcecal.com`), que **sí** está
en `compras_aprobadores`, así que se puede verificar de punta a punta.

Con el despliegue arriba y dentro de la ventana 7:00–21:00:

1. Cargar un requerimiento desde la app con **otra** cuenta —si lo carga él
   mismo, `excepto` lo filtra y no llega nada, que es lo correcto y no prueba
   nada—. Confirmar que llega el push al teléfono y que tocarlo abre
   `/compras/aprobaciones`.
2. Disparar el webhook de la planilla y confirmar que la respuesta trae
   `avisar_push` con el número esperado.

Si no llega: mirar los logs de Vercel de la ruta, no adivinar. `enviarPush`
registra el código del push service con `console.error`.

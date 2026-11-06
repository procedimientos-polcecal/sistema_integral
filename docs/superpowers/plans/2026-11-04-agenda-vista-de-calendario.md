# La Agenda se ve como un calendario — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/agenda` deje de ser una lista de tarjetas y se vea como el calendario de Google: la semana en una cuadrícula de días por horas, un día por vez en el teléfono, sin perder ninguna de las alertas ni de las acciones que la pantalla hace hoy.

**Architecture:** Toda la decisión que se puede equivocar en silencio —qué días se ven, qué ventana de datos pedir, cómo se parte un evento que cruza la medianoche, cómo se reparten en columnas los que se superponen, qué va en la banda de alertas— vive en tres módulos nuevos de `lib/agenda/` con tests. Los componentes sólo dibujan. El cuerpo de un evento (datos, panel de divergencia, caja de la OT, botones) se saca de `TarjetaDeEvento` a un componente compartido, para que la tarjeta de la lista y el detalle que abre la grilla muestren **exactamente lo mismo**. El día y la vista viajan en la URL, así que mover la semana es una navegación y el Server Component relee con la ventana que corresponde.

**Tech Stack:** Next.js 16 (App Router), React, Tailwind v4, Supabase, vitest.

**Spec:** [docs/superpowers/specs/2026-11-04-agenda-vista-de-calendario-design.md](../specs/2026-11-04-agenda-vista-de-calendario-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, textos de pantalla y mensajes de commit.
- **Las pantallas no tienen tests en este repo.** Toda decisión que se pueda equivocar en silencio va a `lib/agenda/` y se prueba con vitest; lo que queda en el componente es dibujar.
- **La hora es siempre la de pared de Argentina** (`diaYHoraDe`, `fechaEnArgentina`, `hoyEnArgentina`). **La grilla no usa nunca la hora local del navegador** ni `getHours()`.
- **`.input`, `.card` y los `.btn-*` están declarados fuera de toda capa** y le ganan a cualquier utilidad de Tailwind que declare la misma propiedad. Un ancho o un color de columna va en un contenedor o por `style`, nunca como utilidad al lado de una de esas clases.
- **`grid-cols-7` sin breakpoint es lo que `scripts/revisar-responsive.mjs` marca.** Acá las siete columnas son deliberadas: o llevan su breakpoint, o entran en la lista de excepciones del script **con el porqué escrito**. No se deja marcando en rojo.
- **Nunca `git add -A`**: puede haber otra sesión en el mismo árbol. Se agregan los archivos por nombre.
- La lectura de eventos sigue siendo **con el cliente del usuario**, para que corran las policies. El cliente admin se usa sólo para el directorio de nombres.
- **Se dibujan las 24 horas**, no un recorte. Un evento que cae fuera del rango dibujado no se ve y nada avisa.
- **Dos eventos a la misma hora van lado a lado**, nunca tapados.

## Review Focus

Cinco cosas que el diseño implica, que ningún test de un camino feliz toca, y que son las que más probablemente muerdan a una persona usando esto. Cada una tiene su test asignado a la tarea que es dueña del código.

1. **Un evento que empieza antes del rango visible y termina adentro** (y al revés). Al mirar la semana del 9, un evento que va del domingo 8 a las 23:00 al lunes 9 a las 01:00 tiene que verse el lunes, recortado, y con una marca de que viene de antes. → Tarea 2.
2. **`?dia=` inválido o ausente** (`?dia=banana`, `?dia=2026-13-45`, sin parámetro). La pantalla tiene que caer en hoy, no romperse ni mostrar una semana vacía. → Tarea 1.
3. **Un evento de duración cero o de pocos minutos.** Google lo permite y «aceptar lo de Google» lo puede traer. Un bloque de alto cero es un evento que existe y no se ve. → Tarea 2.
4. **Muchos eventos superpuestos a la misma hora.** Ninguno puede quedar sin dibujar, por angosto que salga. → Tarea 2.
5. **Un evento pendiente de escribirse en Google, viejo.** La banda promete nombrarlo; si la consulta no lo trae, la promesa es falsa. → Tarea 4.

---

## Estructura de archivos

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `lib/agenda/rango.ts` | Qué vista y qué día se están mirando, qué días se dibujan, y desde cuándo hay que leer |
| `lib/agenda/rango.test.ts` | — |
| `lib/agenda/grilla.ts` | Partir los eventos en pedazos de un día y repartirlos en columnas |
| `lib/agenda/grilla.test.ts` | — |
| `lib/agenda/banda.ts` | Qué entra en la banda de alertas de arriba y en qué orden |
| `lib/agenda/banda.test.ts` | — |
| `app/(app)/agenda/CuerpoDeEvento.tsx` | Todo lo que se dice de un evento: datos, divergencia, caja de la OT, botones. Compartido por la tarjeta y el detalle |
| `app/(app)/agenda/DetalleDeEvento.tsx` | El modal que abre al hacer clic en un bloque de la grilla o en la banda |
| `app/(app)/agenda/Grilla.tsx` | La cuadrícula de días por horas |
| `app/(app)/agenda/BarraDeLaAgenda.tsx` | `‹ › Hoy`, el título, el selector de vistas y «Nuevo evento» |
| `app/(app)/agenda/BandaDeAlertas.tsx` | La banda de arriba |

**Se modifican:**

| Archivo | Qué cambia |
|---|---|
| `lib/agenda/listar.ts` | La ventana pasa a depender del día que se mira, y los pendientes se traen siempre |
| `app/(app)/agenda/page.tsx` | Lee `vista` y `dia` de `searchParams` y arma la ventana |
| `app/(app)/agenda/AgendaClient.tsx` | Decide qué vista dibujar, abre el detalle, y crea desde un hueco vacío |
| `app/(app)/agenda/TarjetaDeEvento.tsx` | Queda como el envoltorio `.card` de `CuerpoDeEvento` |
| `docs/AGENDA.md` | La sección de la vista de calendario |
| `CLAUDE.md` | La fila de la Agenda, que hoy dice dos cosas falsas |

---

## Task 1: El rango — qué día, qué vista, desde cuándo

**Files:**
- Create: `lib/agenda/rango.ts`
- Test: `lib/agenda/rango.test.ts`

**Interfaces:**
- Consumes: `corteDelHistorial(ahora?: Date): string` de `lib/agenda/vista.ts`; `sumarDias(iso: string, dias: number): string` y `hoyEnArgentina(instante?: Date): string` de `lib/core/fechas.ts`.
- Produces:
  - `type VistaDeAgenda = "semana" | "dia" | "lista"`
  - `leerVista(crudo: string | string[] | undefined): VistaDeAgenda`
  - `leerDia(crudo: string | string[] | undefined, hoy: string): string`
  - `inicioDeLaSemana(dia: string): string`
  - `diasDelRango(vista: VistaDeAgenda, dia: string): string[]`
  - `desdeParaLeer(vista: VistaDeAgenda, dia: string, ahora?: Date): string`
  - `tituloDelRango(vista: VistaDeAgenda, dia: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
describe("leerVista", () => {
  it("por defecto es la semana", () => {
    expect(leerVista(undefined)).toBe("semana");
  });
  it("acepta las tres y rechaza cualquier otra cosa", () => {
    expect(leerVista("dia")).toBe("dia");
    expect(leerVista("lista")).toBe("lista");
    expect(leerVista("mes")).toBe("semana");
    expect(leerVista(["dia", "lista"])).toBe("semana");
  });
});

describe("leerDia", () => {
  it("sin parámetro es hoy", () => {
    expect(leerDia(undefined, "2026-11-04")).toBe("2026-11-04");
  });
  it("un día válido se respeta", () => {
    expect(leerDia("2026-03-09", "2026-11-04")).toBe("2026-03-09");
  });
  // Review Focus 2: la URL la escribe cualquiera.
  it("una fecha que no existe o no es una fecha cae en hoy", () => {
    expect(leerDia("banana", "2026-11-04")).toBe("2026-11-04");
    expect(leerDia("2026-13-45", "2026-11-04")).toBe("2026-11-04");
    expect(leerDia("2026-02-30", "2026-11-04")).toBe("2026-11-04");
    expect(leerDia("", "2026-11-04")).toBe("2026-11-04");
  });
});

describe("inicioDeLaSemana", () => {
  it("la semana arranca el lunes", () => {
    expect(inicioDeLaSemana("2026-11-04")).toBe("2026-11-02"); // miércoles
    expect(inicioDeLaSemana("2026-11-02")).toBe("2026-11-02"); // el lunes mismo
  });
  it("un domingo pertenece a la semana que termina, no a la que empieza", () => {
    expect(inicioDeLaSemana("2026-11-08")).toBe("2026-11-02");
  });
});

describe("diasDelRango", () => {
  it("la semana son siete días, de lunes a domingo", () => {
    expect(diasDelRango("semana", "2026-11-04")).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05",
      "2026-11-06", "2026-11-07", "2026-11-08",
    ]);
  });
  it("el día es uno solo", () => {
    expect(diasDelRango("dia", "2026-11-04")).toEqual(["2026-11-04"]);
  });
  it("la lista no dibuja grilla", () => {
    expect(diasDelRango("lista", "2026-11-04")).toEqual([]);
  });
});

describe("desdeParaLeer", () => {
  const ahora = new Date("2026-11-04T12:00:00Z"); // corte del historial: 2026-10-05

  it("mirando esta semana, manda el corte del historial", () => {
    expect(desdeParaLeer("semana", "2026-11-04", ahora)).toBe(corteDelHistorial(ahora));
  });
  it("mirando una semana vieja, se pide desde esa semana", () => {
    expect(desdeParaLeer("semana", "2026-03-09", ahora)).toBe("2026-03-09T00:00:00.000Z");
  });
  it("mirando el futuro, el corte del historial sigue mandando", () => {
    expect(desdeParaLeer("semana", "2027-05-10", ahora)).toBe(corteDelHistorial(ahora));
  });
});

describe("tituloDelRango", () => {
  it("una semana dentro de un mes dice el mes y el año", () => {
    expect(tituloDelRango("semana", "2026-11-04")).toBe("Noviembre 2026");
  });
  it("una semana a caballo de dos meses los nombra a los dos", () => {
    expect(tituloDelRango("semana", "2026-12-02")).toBe("Noviembre – Diciembre 2026");
  });
  it("un día se dice entero", () => {
    expect(tituloDelRango("dia", "2026-11-04")).toBe("mié 04/11/2026");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run lib/agenda/rango.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implement `lib/agenda/rango.ts`**

`leerDia` valida que el texto sea `YYYY-MM-DD` **y que ese día exista** —`2026-02-30` matchea el formato y no es un día—: reconstruir la fecha y comparar contra el texto es lo que lo atrapa. `desdeParaLeer` devuelve el menor entre el inicio del rango visible a medianoche UTC y `corteDelHistorial(ahora)`; para la vista `lista` devuelve siempre `corteDelHistorial(ahora)` (decisión 11 del diseño: Lista ignora el día que se mira). Los nombres de mes van en un arreglo del módulo, con mayúscula inicial. `tituloDelRango` de un día reusa `etiquetaDelDia` de `lib/agenda/vista.ts`.

En el docstring del módulo va **por qué `leerDia` cae en hoy en vez de tirar**: la URL la escribe cualquiera y una pantalla de agenda que explota con un parámetro mal tipeado es peor que una que muestra hoy.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run lib/agenda/rango.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agenda/rango.ts lib/agenda/rango.test.ts
git commit -F <mensaje>
```

---

## Task 2: La grilla — partir por día y repartir en columnas

**Files:**
- Create: `lib/agenda/grilla.ts`
- Test: `lib/agenda/grilla.test.ts`

**Interfaces:**
- Consumes: `EventoVista` y `diaYHoraDe` de `lib/agenda/vista.ts`.
- Produces:
  - `interface PedazoDelDia { evento: EventoVista; dia: string; desdeMin: number; hastaMin: number; vieneDeAntes: boolean; sigueDespues: boolean }`
  - `interface PedazoUbicado extends PedazoDelDia { columna: number; columnas: number }`
  - `partirPorDia(eventos: readonly EventoVista[], dias: readonly string[]): PedazoDelDia[]`
  - `acomodar(pedazos: readonly PedazoDelDia[]): PedazoUbicado[]`
  - `const MINUTOS_MINIMOS = 20`

**Qué es un pedazo:** un evento visto desde **un** día. `desdeMin` y `hastaMin` son minutos desde la medianoche de ese día, en hora de pared de Argentina, recortados a `[0, 1440]`. `vieneDeAntes` y `sigueDespues` dicen que el evento se extiende fuera de ese día, para que la pantalla lo pueda marcar.

- [ ] **Step 1: Write the failing tests**

```ts
const ev = (id: string, inicio: string, fin: string): EventoVista => ({ /* el mínimo de EventoVista */ });

describe("partirPorDia", () => {
  it("un evento de un día es un pedazo con sus minutos", () => {
    const p = partirPorDia([ev("a", "2026-11-04T08:00:00-03:00", "2026-11-04T09:30:00-03:00")], ["2026-11-04"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ dia: "2026-11-04", desdeMin: 480, hastaMin: 570, vieneDeAntes: false, sigueDespues: false });
  });

  it("un evento fuera de los días pedidos no da ningún pedazo", () => {
    expect(partirPorDia([ev("a", "2026-11-20T08:00:00-03:00", "2026-11-20T09:00:00-03:00")], ["2026-11-04"])).toEqual([]);
  });

  // Review Focus 1: cruza la medianoche. Google lo permite y «aceptar» lo trae.
  it("un evento que cruza la medianoche da un pedazo por día, marcados", () => {
    const p = partirPorDia(
      [ev("a", "2026-11-08T23:00:00-03:00", "2026-11-09T01:00:00-03:00")],
      ["2026-11-08", "2026-11-09"]
    );
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ dia: "2026-11-08", desdeMin: 1380, hastaMin: 1440, vieneDeAntes: false, sigueDespues: true });
    expect(p[1]).toMatchObject({ dia: "2026-11-09", desdeMin: 0, hastaMin: 60, vieneDeAntes: true, sigueDespues: false });
  });

  it("si sólo se mira el día de llegada, el pedazo igual sale, marcado como que viene de antes", () => {
    const p = partirPorDia([ev("a", "2026-11-08T23:00:00-03:00", "2026-11-09T01:00:00-03:00")], ["2026-11-09"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ dia: "2026-11-09", desdeMin: 0, vieneDeAntes: true });
  });

  // Review Focus 3: un bloque de alto cero es un evento que existe y no se ve.
  it("un evento de duración cero ocupa el mínimo visible", () => {
    const p = partirPorDia([ev("a", "2026-11-04T08:00:00-03:00", "2026-11-04T08:00:00-03:00")], ["2026-11-04"]);
    expect(p[0].hastaMin - p[0].desdeMin).toBe(MINUTOS_MINIMOS);
  });

  it("un evento de cinco minutos también", () => {
    const p = partirPorDia([ev("a", "2026-11-04T08:00:00-03:00", "2026-11-04T08:05:00-03:00")], ["2026-11-04"]);
    expect(p[0].hastaMin - p[0].desdeMin).toBe(MINUTOS_MINIMOS);
  });

  it("el mínimo no empuja un evento del final del día fuera de la grilla", () => {
    const p = partirPorDia([ev("a", "2026-11-04T23:55:00-03:00", "2026-11-04T23:57:00-03:00")], ["2026-11-04"]);
    expect(p[0].hastaMin).toBeLessThanOrEqual(1440);
    expect(p[0].hastaMin - p[0].desdeMin).toBe(MINUTOS_MINIMOS);
  });
});

describe("acomodar", () => {
  it("dos eventos que no se tocan ocupan cada uno todo el ancho", () => {
    // 08:00–09:00 y 10:00–11:00 el mismo día
    const u = acomodar(/* dos pedazos */);
    expect(u.map((x) => [x.columna, x.columnas])).toEqual([[0, 1], [0, 1]]);
  });

  it("dos superpuestos se parten el ancho", () => {
    // 08:00–09:30 y 09:00–10:00
    const u = acomodar(/* dos pedazos */);
    expect(u.map((x) => [x.columna, x.columnas])).toEqual([[0, 2], [1, 2]]);
  });

  it("uno que termina antes de que empiece el tercero libera su columna", () => {
    // 08:00–09:00, 08:30–10:00, 09:15–10:00 → el tercero reusa la columna del primero
    const u = acomodar(/* tres pedazos */);
    expect(u[2].columna).toBe(0);
  });

  // Review Focus 4: ninguno puede desaparecer.
  it("seis superpuestos salen los seis, en seis columnas", () => {
    const u = acomodar(/* seis pedazos de 08:00 a 09:00 */);
    expect(u).toHaveLength(6);
    expect(new Set(u.map((x) => x.columna)).size).toBe(6);
    expect(u.every((x) => x.columnas === 6)).toBe(true);
  });

  it("pedazos de días distintos no se superponen entre sí", () => {
    // mismo horario, 2026-11-04 y 2026-11-05
    const u = acomodar(/* dos pedazos */);
    expect(u.every((x) => x.columnas === 1)).toBe(true);
  });

  it("el orden de entrada no cambia el resultado", () => {
    // los mismos tres pedazos al derecho y al revés dan las mismas columnas por id
    expect(/* columnas por id de ida */).toEqual(/* columnas por id de vuelta */);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run lib/agenda/grilla.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implement `lib/agenda/grilla.ts`**

`partirPorDia` recorre los días pedidos y, para cada evento que toca ese día, recorta. Los minutos salen de `diaYHoraDe` (hora de pared de Argentina), **nunca de `getHours()`**. El mínimo de `MINUTOS_MINIMOS` se aplica al final y, si no entra antes de las 24:00, se corre hacia arriba en vez de pasarse.

`acomodar` trabaja por día: ordena los pedazos de un día por `desdeMin` y desempata por `evento.id` —el desempate es lo que hace el resultado independiente del orden de entrada—, los agrupa en racimos de pedazos que se solapan encadenados, y dentro de cada racimo le da a cada uno la primera columna libre. `columnas` es el ancho del racimo, igual para todos los del racimo.

En el docstring va **por qué `MINUTOS_MINIMOS` existe**: un evento de duración cero es posible —Google lo permite y «aceptar lo de Google» lo puede traer— y un bloque de alto cero es exactamente la falla que este trabajo evita.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run lib/agenda/grilla.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agenda/grilla.ts lib/agenda/grilla.test.ts
git commit -F <mensaje>
```

---

## Task 3: La banda de alertas

**Files:**
- Create: `lib/agenda/banda.ts`
- Test: `lib/agenda/banda.test.ts`

**Interfaces:**
- Consumes: `EventoVista` y `avisoDelPendiente` de `lib/agenda/vista.ts`.
- Produces:
  - `type TipoDeAlerta = "divergencia" | "pendiente" | "aviso"`
  - `interface EntradaDeLaBanda { eventoId: string; titulo: string; tipo: TipoDeAlerta; texto: string }`
  - `entradasDeLaBanda(eventos: readonly EventoVista[]): EntradaDeLaBanda[]`

- [ ] **Step 1: Write the failing tests**

```ts
describe("entradasDeLaBanda", () => {
  it("un evento sano no entra", () => {
    expect(entradasDeLaBanda([sano])).toEqual([]);
  });

  it("un evento movido entra como divergencia y lo dice en una línea", () => {
    const [e] = entradasDeLaBanda([movido]);
    expect(e).toMatchObject({ eventoId: movido.id, titulo: movido.titulo, tipo: "divergencia" });
    expect(e.texto).toContain("de horario");
  });

  it("un borrado se distingue de un movido", () => {
    expect(entradasDeLaBanda([borrado])[0].texto).toContain("borró");
  });

  // Decisión 10 del diseño: el pendiente también va a la banda.
  it("un evento que no llegó a Google entra aunque no esté divergido", () => {
    const [e] = entradasDeLaBanda([pendiente]);
    expect(e.tipo).toBe("pendiente");
    expect(e.texto).toContain("no figura en el calendario");
  });

  it("un `aviso` entra con su propio texto", () => {
    expect(entradasDeLaBanda([conAviso])[0]).toMatchObject({ tipo: "aviso", texto: conAviso.aviso });
  });

  it("un evento con divergencia y pendiente a la vez da una sola entrada, la divergencia", () => {
    const es = entradasDeLaBanda([movidoYPendiente]);
    expect(es).toHaveLength(1);
    expect(es[0].tipo).toBe("divergencia");
  });

  it("las divergencias van antes que los pendientes y los pendientes antes que los avisos", () => {
    expect(entradasDeLaBanda([conAviso, pendiente, movido]).map((e) => e.tipo))
      .toEqual(["divergencia", "pendiente", "aviso"]);
  });

  it("dentro del mismo tipo, el que empieza antes va primero", () => {
    expect(entradasDeLaBanda([movidoTarde, movidoTemprano]).map((e) => e.eventoId))
      .toEqual([movidoTemprano.id, movidoTarde.id]);
  });

  it("una divergencia ya vista sigue en la banda", () => {
    // «Ya lo vi» apaga la campana, no la alerta: el evento sigue divergido.
    expect(entradasDeLaBanda([movidoYaVisto])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run lib/agenda/banda.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implement `lib/agenda/banda.ts`**

Un evento da **una** entrada como mucho, por el tipo más grave: divergencia, después pendiente, después aviso. El texto del pendiente sale de `avisoDelPendiente()`, que ya existe y ya distingue el caso divergido del que no. El orden es por tipo y después por `inicio`, desempatando por `id`.

En el docstring va **por qué una divergencia ya vista no se saca**: «Ya lo vi» apaga la campana de quien lo apretó, no la alerta. Sacarla de la banda convertiría un botón personal en un botón que esconde el problema para todos.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run lib/agenda/banda.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agenda/banda.ts lib/agenda/banda.test.ts
git commit -F <mensaje>
```

---

## Task 4: La ventana de datos

**Files:**
- Modify: `lib/agenda/listar.ts`
- Modify: `app/(app)/agenda/page.tsx`
- Test: `lib/agenda/listar.test.ts` (crear)

**Interfaces:**
- Consumes: `desdeParaLeer`, `leerVista`, `leerDia` de Tarea 1.
- Produces: `traerEventos(supabase, opciones: { historial: boolean; desde: string; directorio: ReadonlyMap<string, string>; ahora?: Date })` — `desde` es nuevo y obligatorio; reemplaza al `corteDelHistorial()` que la función calculaba sola.

- [ ] **Step 1: Write the failing test**

Con un doble del cliente de Supabase que captura el `.or(...)` que recibe, porque **lo que se prueba es la condición, no la red**.

```ts
describe("traerEventos", () => {
  it("pide desde la fecha que le dan y no desde el corte que calculaba sola", async () => {
    const espia = clienteEspia();
    await traerEventos(espia.cliente, { historial: false, desde: "2026-03-09T00:00:00.000Z", directorio: new Map() });
    expect(espia.or).toContain("fin.gte.2026-03-09T00:00:00.000Z");
  });

  // Review Focus 5: la banda promete nombrar un pendiente viejo.
  it("trae siempre lo divergido Y lo pendiente, de cualquier fecha", () => {
    expect(espia.or).toContain("divergencia.not.is.null");
    expect(espia.or).toContain("google_pendiente.not.is.null");
  });

  it("con historial no filtra nada", async () => {
    await traerEventos(espia.cliente, { historial: true, desde: "...", directorio: new Map() });
    expect(espia.or).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run lib/agenda/listar.test.ts`
Expected: FAIL — `traerEventos` no acepta `desde` y la condición no nombra `google_pendiente`.

- [ ] **Step 3: Implement**

En `lib/agenda/listar.ts`: `desde` entra por opciones y reemplaza a `corteDelHistorial(opciones.ahora)`; la condición pasa a `fin.gte.${desde},divergencia.not.is.null,google_pendiente.not.is.null`. El docstring dice que la ventana ahora la fija quien llama, **y por qué los pendientes se traen como los divergidos**: la banda los nombra, y una promesa sobre una fila que la consulta no leyó es una promesa falsa.

En `app/(app)/agenda/page.tsx`: leer `vista` y `dia` de `searchParams` con `leerVista`/`leerDia` (el `hoy` sale de `hoyEnArgentina()`), calcular `desde` con `desdeParaLeer`, pasárselo a `traerEventos`, y pasarle `vista` y `dia` a `AgendaClient`.

- [ ] **Step 4: Run the tests and `tsc`**

Run: `npx vitest run lib/agenda/ && npx tsc --noEmit`
Expected: PASS y sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add lib/agenda/listar.ts lib/agenda/listar.test.ts "app/(app)/agenda/page.tsx"
git commit -F <mensaje>
```

---

## Task 5: Sacar el cuerpo del evento a un componente compartido

Es la parte cara del trabajo y la que más chance tiene de romper algo que hoy funciona. **No cambia ningún comportamiento**: qué botones aparecen lo sigue decidiendo `permisosDelEvento()`, los textos de confirmación son los mismos y las rutas se llaman igual.

**Files:**
- Create: `app/(app)/agenda/CuerpoDeEvento.tsx`
- Create: `app/(app)/agenda/DetalleDeEvento.tsx`
- Modify: `app/(app)/agenda/TarjetaDeEvento.tsx`

**Interfaces:**
- Produces:
  - `CuerpoDeEvento` con **las mismas props que hoy tiene `TarjetaDeEvento`** (`evento`, `miId`, `numeroDeOT`, `nombrePorCorreo`, `pasado`, `ocupado`, `onEditar`, `onBorrar`, `onVisto`, `onDestrabar`), sin el envoltorio `.card`.
  - `DetalleDeEvento` con esas mismas props más `onCerrar: () => void`.

- [ ] **Step 1: Mover, sin tocar nada**

Mover a `CuerpoDeEvento.tsx` el contenido actual de `TarjetaDeEvento` —el `PanelDeDivergencia`, la `CajaDeLaOT`, el bloque de datos y los botones— **textualmente**, incluidos sus docstrings y las constantes `AMBAR` y `GRIS`. `TarjetaDeEvento` queda como `<div className="card overflow-hidden"><CuerpoDeEvento {...props} /></div>`.

- [ ] **Step 2: Verificar que no cambió nada**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores. **Y `git diff --stat`: las líneas que salieron de `TarjetaDeEvento.tsx` tienen que ser las mismas que entraron a `CuerpoDeEvento.tsx`.** Si no cuadran, algo se editó en el camino y éste es el único momento en que se nota.

- [ ] **Step 3: Escribir `DetalleDeEvento.tsx`**

Un modal —el mismo patrón que `EventoModal`: fondo oscuro, panel centrado, cerrar con la X y con Escape— que adentro dibuja `CuerpoDeEvento` con las props que recibe, y tiene un botón «Cerrar». El título del evento va en el encabezado del modal.

- [ ] **Step 4: `tsc` y build**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/agenda/CuerpoDeEvento.tsx" "app/(app)/agenda/DetalleDeEvento.tsx" "app/(app)/agenda/TarjetaDeEvento.tsx"
git commit -F <mensaje>
```

---

## Task 6: La cuadrícula, la barra y la banda

**Files:**
- Create: `app/(app)/agenda/Grilla.tsx`
- Create: `app/(app)/agenda/BarraDeLaAgenda.tsx`
- Create: `app/(app)/agenda/BandaDeAlertas.tsx`

**Interfaces:**
- Consumes: `partirPorDia`, `acomodar`, `PedazoUbicado` (Tarea 2); `entradasDeLaBanda`, `EntradaDeLaBanda` (Tarea 3); `diasDelRango`, `tituloDelRango`, `VistaDeAgenda` (Tarea 1); `EventoVista`, `etiquetaDelDia` de `lib/agenda/vista.ts`.
- Produces:
  - `Grilla({ dias, eventos, hoy, ahoraMin, onEvento, onHueco })` — `onEvento(e: EventoVista): void`, `onHueco(dia: string, hora: string): void`.
  - `BarraDeLaAgenda({ vista, dia, hrefDe, onNuevo })` — `hrefDe(vista: VistaDeAgenda, dia: string): string`.
  - `BandaDeAlertas({ entradas, onEntrada })` — `onEntrada(eventoId: string): void`.

- [ ] **Step 1: `Grilla.tsx`**

Encabezado de días (nombre abreviado arriba, número abajo; el de `hoy` con el número en un círculo azul) y debajo un contenedor con scroll vertical que tiene la columna de horas y una columna por día. **Las 24 horas**, `ALTO_DE_LA_HORA = 48` px, constante exportada del propio archivo.

Cada pedazo se dibuja absoluto dentro de su columna: `top = desdeMin / 60 * ALTO_DE_LA_HORA`, `height = (hastaMin - desdeMin) / 60 * ALTO_DE_LA_HORA`, y el ancho y el desplazamiento horizontal salen de `columna` y `columnas`. `vieneDeAntes` y `sigueDespues` se marcan achatando la esquina de ese lado (sin borde redondeado) — es lo que dice «esto sigue» sin texto.

Los colores van por `style` y no por utilidades: verde para los de OT, azul para los propios, naranja con borde más oscuro para los divergidos. Un evento pasado va con menos opacidad. **Las columnas de sábado y domingo van con un fondo apenas más gris** —la planta opera con turno de 04:00, así que el fin de semana no se esconde, pero se distingue (decisión 7 del diseño)—.

La línea roja de «ahora» se dibuja a `ahoraMin / 60 * ALTO_DE_LA_HORA`, **sólo si `hoy` está entre los `dias`**. `ahoraMin` llega por props desde el servidor, no se calcula con el reloj del navegador.

Hacer clic en un hueco llama a `onHueco(dia, hora)` con la hora en punto de la fila; hacer clic en un bloque llama a `onEvento` y **no** dispara el hueco de abajo.

El scroll arranca a la altura del primer evento del rango, o cerca de las 06:00 si no hay ninguno.

- [ ] **Step 2: `BarraDeLaAgenda.tsx`**

`‹ › Hoy`, el título de `tituloDelRango`, el selector de las tres vistas y «Nuevo evento». Las flechas y el selector son `<Link>` a `hrefDe(...)`, no botones: **mover la semana es una navegación**, porque la lectura vive en el Server Component.

Cuánto avanzan las flechas lo decide el ancho: siete días en escritorio, uno en teléfono. Se resuelve con una media query leída en el cliente (`window.matchMedia("(min-width: 640px)")`), con el valor de escritorio como inicial para que el render del servidor y el del navegador coincidan.

- [ ] **Step 3: `BandaDeAlertas.tsx`**

Una franja ámbar arriba de la grilla, con la cuenta y hasta tres entradas nombradas; con más de tres, «y N más». Cada entrada es un botón que llama a `onEntrada(eventoId)`. Si no hay entradas, no se dibuja nada.

- [ ] **Step 4: `tsc`, build y responsive**

Run: `npx tsc --noEmit && npm run build && node scripts/revisar-responsive.mjs`
Expected: sin errores. Si `revisar-responsive` marca las siete columnas, se agregan a su lista de excepciones **con el porqué escrito**, no se silencia.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/agenda/Grilla.tsx" "app/(app)/agenda/BarraDeLaAgenda.tsx" "app/(app)/agenda/BandaDeAlertas.tsx" scripts/revisar-responsive.mjs
git commit -F <mensaje>
```

---

## Task 7: Armar la pantalla y escribir lo que no se deduce

**Files:**
- Modify: `app/(app)/agenda/AgendaClient.tsx`
- Modify: `docs/AGENDA.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: `AgendaClient.tsx`**

Recibe `vista` y `dia` por props. Dibuja siempre `BarraDeLaAgenda` y `BandaDeAlertas`; debajo, la `Grilla` con `diasDelRango(vista, dia)` si la vista es `semana` o `dia`, o la lista de hoy —intacta, con sus secciones «Próximos» y «Anteriores»— si es `lista`.

**En un ancho de teléfono, la vista `semana` dibuja un solo día**: el de `dia`. Es la decisión 8 del diseño y lo que evita que el servidor tenga que adivinar el ancho. Se resuelve con la misma media query que la barra.

`onEvento` y `onEntrada` abren `DetalleDeEvento` con el evento; sus `onEditar`, `onBorrar`, `onVisto` y `onDestrabar` son **los mismos manejadores que ya existen** en este archivo. `onHueco(dia, hora)` abre `EventoModal` en alta con ese día y esa hora.

El `hrefDe(vista, dia)` que consume la barra se define acá: arma `/agenda?vista=…&dia=…`, y **conserva el `historial=1`** si estaba puesto, para no perderlo al cambiar de vista.

- [ ] **Step 2: `EventoModal` acepta un arranque**

Una prop opcional `arranque?: { dia: string; desde: string }` que, en un alta, reemplaza a los valores por defecto (`hoyEnArgentina()`, `"09:00"`, `"10:00"`). El `hasta` sale de sumarle una hora al `desde`.

- [ ] **Step 3: Verificar entero**

Run: `npm test && npx tsc --noEmit && npm run build && node scripts/revisar-responsive.mjs && node scripts/revisar-arbol-commiteado.mjs`
Expected: todo en verde.

- [ ] **Step 4: Abrirla en el navegador**

No es opcional y es lo único que ningún script puede hacer: **abrir `/agenda` en la computadora y en un ancho de teléfono**, con los dos eventos que hay en producción. Comprobar que la semana se dibuja, que las flechas se mueven, que al hacer clic en un hueco se abre el alta con el día y la hora puestos, que al hacer clic en un evento se abre el detalle con sus botones, y que las tres vistas cambian. La Agenda ya se desplegó una vez sin que nadie hubiera abierto la pantalla.

- [ ] **Step 5: Escribir lo que no se deduce del código**

En `docs/AGENDA.md`, una sección nueva con: que la vista `semana` en un teléfono dibuja un día y por qué (la contradicción entre el ancho y la URL); que lo que se acomoda en columnas son **pedazos de un día y no eventos**, por los que cruzan la medianoche; que `MINUTOS_MINIMOS` existe porque un evento de duración cero es posible; y que la banda nombra también los pendientes, lo que obligó a traerlos siempre en la consulta.

En `CLAUDE.md`, en la fila de la Agenda: **corregir las dos cosas que hoy dice y son falsas** —que la migración no está aplicada y que la pantalla nunca se abrió en un navegador— y agregar la vista de calendario con el enlace a este plan y a su spec.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/agenda/AgendaClient.tsx" "app/(app)/agenda/EventoModal.tsx" docs/AGENDA.md CLAUDE.md
git commit -F <mensaje>
```

# El resumen diario dice lo que se movió — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el push diario diga lo que cambió desde el resumen anterior en vez
de repetir todos los días el total, y que los lunes siga yendo el total.

**Architecture:** Una foto diaria de los conteos —una fila por aviso y por día,
global, porque los conteos son globales— guardada por el mismo cron que manda el
resumen, después de mandarlo. La comparación y la redacción son funciones puras
en `lib/home/`. La campana no se toca: sigue mostrando el stock.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase/PostgREST, vitest.

**Spec:** [docs/superpowers/specs/2026-10-18-a-quien-le-avisa-el-sdg-design.md](../specs/2026-10-18-a-quien-le-avisa-el-sdg-design.md)

## Global Constraints

- Todo en castellano: nombres, comentarios, textos de pantalla y de commit. Los
  comentarios explican **por qué**, no qué.
- **La campana no se toca.** `lib/home/avisos.ts` y los conteos de
  `avisosDeUsuario()` quedan igual: esto cambia **cuándo se dice**, no **qué se
  cuenta**. `/api/home/avisos` tiene que seguir devolviendo el stock.
- **Sólo se avisan las subidas.** Una bajada no genera nada.
- **Los administradores siguen recibiendo todo.** No se reparte por nivel de
  permiso y no hay preferencia por módulo. La única excepción son los dos avisos
  de aprobación, que van a su lista (tarea 6).
- **La comparación es contra la última foto que haya**, nunca contra "ayer": el
  día que el cron no corra, un delta calculado contra ayer sale al doble o sale
  vacío.
- La migración la aplica **una persona a mano** en el editor SQL de Supabase. Un
  agente no corre DDL.
- `traerTodo()` de `lib/core/paginado.ts` en cualquier lectura que pueda pasar
  las 1000 filas.
- Nunca `git add -A`: se commitea nombrando las rutas
  (`git commit --only <rutas> -F -`).

## Review Focus

1. **El cron no corre un día.** La comparación va contra la última foto
   existente, así que el delta del día siguiente abarca los dos días en vez de
   mentir (tarea 1).
2. **El primer día, sin ninguna foto.** No se manda nada y sólo se guarda la
   foto; tratar "sin foto" como "todo es nuevo" sería un push de 13 líneas de
   estreno (tareas 1 y 5).
3. **El cron corre dos veces el mismo día.** La segunda corrida compara contra
   la foto que acaba de escribir la primera, así que da cero y no manda nada
   (tareas 4 y 5).
4. **Un aviso que nunca estuvo en la foto.** Su delta es su cantidad entera, no
   `NaN` ni cero (tarea 1).
5. **Un aviso que baja o desaparece.** No genera línea y no rompe la
   comparación (tarea 1).

---

## Task 1: Qué se movió, y qué día toca el recordatorio

**Files:**
- Create: `lib/home/movimiento.ts`
- Test: `lib/home/movimiento.test.ts`

**Interfaces:**
- Consumes: `Notificacion` de `lib/home/notificaciones.ts`
  (`{ id, titulo, cantidad, href }`); `diaDeLaSemana` de `lib/core/fechas.ts`.
- Produces:
  - `type Foto = Map<string, number>` — por `notificacion_id`, la cantidad de la
    última foto.
  - `loQueSeMovio(avisos: Notificacion[], foto: Foto): Notificacion[]` — los que
    subieron, con `cantidad` reemplazada por **cuánto subieron**.
  - `esDiaDeRecordatorio(fecha: string): boolean` — lunes.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
const aviso = (id: string, cantidad: number): Notificacion =>
  ({ id, titulo: `t-${id}`, cantidad, href: `/${id}` });

describe("loQueSeMovio", () => {
  it("lo que subio sale con cuanto subio, no con el total", () => {
    expect(loQueSeMovio([aviso("ot", 23)], new Map([["ot", 20]])))
      .toEqual([{ id: "ot", titulo: "t-ot", cantidad: 3, href: "/ot" }]);
  });

  it("lo que no se movio no sale", () => {
    expect(loQueSeMovio([aviso("ot", 23)], new Map([["ot", 23]]))).toEqual([]);
  });

  it("lo que bajo no sale: una baja no pide nada", () => {
    expect(loQueSeMovio([aviso("ot", 20)], new Map([["ot", 23]]))).toEqual([]);
  });

  // Aparecio despues de la ultima foto: subio desde cero.
  it("un aviso que no estaba en la foto sube por su cantidad entera", () => {
    expect(loQueSeMovio([aviso("nuevo", 4)], new Map())[0].cantidad).toBe(4);
  });

  // La foto recuerda avisos que hoy no existen (el conteo llego a cero). No
  // tienen que aparecer ni romper la comparacion.
  it("un aviso que estaba en la foto y hoy no existe no genera nada", () => {
    expect(loQueSeMovio([], new Map([["se-fue", 5]]))).toEqual([]);
  });

  it("de una lista mezclada salen solo los que subieron", () => {
    const foto = new Map([["sube", 1], ["queda", 7], ["baja", 9]]);
    expect(loQueSeMovio([aviso("sube", 4), aviso("queda", 7), aviso("baja", 2)], foto)
      .map((a) => [a.id, a.cantidad])).toEqual([["sube", 3]]);
  });

  // Sin foto es el primer dia: lo decide el cron, no esta funcion, pero tiene
  // que ser consistente — sin foto todo es nuevo.
  it("con la foto vacia todo cuenta como nuevo", () => {
    expect(loQueSeMovio([aviso("a", 2), aviso("b", 5)], new Map())).toHaveLength(2);
  });
});

describe("esDiaDeRecordatorio", () => {
  it("el lunes si", () => {
    expect(esDiaDeRecordatorio("2026-10-19")).toBe(true); // lunes
  });
  it("el resto de la semana no", () => {
    for (const d of ["2026-10-18", "2026-10-20", "2026-10-24", "2026-10-25"]) {
      expect(esDiaDeRecordatorio(d)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/home/movimiento.test.ts`
Expected: FAIL, el módulo no existe.

- [ ] **Step 3: Implementar las dos en `lib/home/movimiento.ts`**

El encabezado dice por qué existe el archivo: el resumen contaba stocks, que no
se mueven de un día para el otro, así que el push repetía el mismo mensaje —
medido, «Facturas sin vincular: 1» dijo lo mismo trece días y «Equipos sin
ningún service: 15» no puede bajar porque hay un solo service en todo el
sistema. Y dice la regla que gobierna el archivo: **la campana muestra el
stock, el push muestra el movimiento.**

`esDiaDeRecordatorio` usa `diaDeLaSemana` de `lib/core/fechas.ts`, que devuelve
0 para domingo. El comentario dice por qué existe el recordatorio: sin él, una
OT atrasada desde el 11/12/2025 no se nombra nunca más y el depósito se pudre en
silencio.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run lib/home/movimiento.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit --only lib/home/movimiento.ts lib/home/movimiento.test.ts -F -
```

Mensaje: `feat(inicio): que se movio desde el resumen anterior`.

---

## Task 2: El texto de un resumen de movimiento

**Files:**
- Modify: `lib/home/resumenDeAvisos.ts`
- Test: `lib/home/resumenDeAvisos.test.ts`

**Interfaces:**
- Consumes: `Notificacion`; `Aviso` de `lib/core/webpush.ts`.
- Produces: `resumirElMovimiento(avisos: Notificacion[]): Aviso | null`, donde
  `cantidad` **ya es el delta** (lo que devuelve `loQueSeMovio`).

- [ ] **Step 1: Escribir los tests que fallan**

Mismo molde que los de `resumirParaPush`, que queda intacto para los lunes.

```ts
describe("resumirElMovimiento", () => {
  it("sin movimiento no se manda nada", () => {
    expect(resumirElMovimiento([])).toBeNull();
  });

  // "mas" es invariable a proposito: los titulos mezclan genero —"Ausencias
  // sin clasificar", "Requerimientos esperando aprobacion"— y "3 nuevas"
  // concuerda con la mitad y chirria con la otra.
  it("uno solo dice cuanto subio, no el total", () => {
    expect(resumirElMovimiento([
      { id: "mant-atrasadas", titulo: "Órdenes de trabajo atrasadas", cantidad: 3, href: "/x" },
    ])).toEqual({ title: "Órdenes de trabajo atrasadas", body: "3 más", url: "/x" });
  });

  it("varios se cuentan como novedades", () => {
    const r = resumirElMovimiento([
      { id: "a", titulo: "Ausencias sin clasificar", cantidad: 2, href: "/a" },
      { id: "b", titulo: "Órdenes de trabajo atrasadas", cantidad: 3, href: "/b" },
    ]);
    expect(r).toEqual({
      title: "2 novedades",
      body: "2 más · Ausencias sin clasificar\n3 más · Órdenes de trabajo atrasadas",
      url: "/",
    });
  });

  // Un aviso de ritmo no cuenta cosas: su cantidad son umbrales. Va sin numero,
  // igual que en `resumirParaPush`.
  it("un aviso de ritmo va sin numero", () => {
    expect(resumirElMovimiento([
      { id: "ritmo-trituracion", titulo: "Trituración: hace 18 días que no se carga", cantidad: 1, href: "/t" },
    ])!.body).toBe("");
  });

  it("con mas de tres se nombran tres y se resume el resto", () => {
    const r = resumirElMovimiento(
      ["a","b","c","d","e"].map((id) => ({ id, titulo: `T${id}`, cantidad: 1, href: `/${id}` }))
    );
    expect(r!.title).toBe("5 novedades");
    expect(r!.body.split("\n")).toHaveLength(4);
    expect(r!.body).toContain("y 2 más");
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/home/resumenDeAvisos.test.ts`
Expected: FAIL, `resumirElMovimiento` no existe.

- [ ] **Step 3: Implementar `resumirElMovimiento`**

Reusa `CUANTOS_SE_NOMBRAN` y el `esDeRitmo` que ya están en el archivo. El
comentario dice lo que el spec fija: **un 3 que antes era el total y ahora es el
delta es peor que cualquiera de los dos**, así que el número nunca va solo — va
con "más", que es invariable y no obliga a concordar género con trece títulos.

`resumirParaPush` **no se toca**: es la de los lunes.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run lib/home/resumenDeAvisos.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit --only lib/home/resumenDeAvisos.ts lib/home/resumenDeAvisos.test.ts -F -
```

Mensaje: `feat(inicio): el texto de un resumen que cuenta movimiento`.

---

## Task 3: Los avisos de todo el sistema, para la foto

**Files:**
- Modify: `lib/home/avisosDeUsuario.ts`

**Interfaces:**
- Produces: `avisosDeTodoElSistema(supabase: SupabaseClient): Promise<Notificacion[]>`
  — los avisos de **todos** los módulos, sin filtrar por persona ni por
  descartes.

- [ ] **Step 1: Extraer el cuerpo que ya existe**

`avisosDeUsuario` hoy hace dos cosas: contar sobre los módulos que la persona ve,
y sacar lo descartado. Se parte en dos sin cambiar comportamiento:

- `avisosDeLosModulos(supabase, modulos: Modulo[]): Promise<Notificacion[]>` —
  privada, es el cuerpo de hoy con `modulos` como parámetro en vez de calcularlo
  de `quien`.
- `avisosDeUsuario` pasa a ser `filtrarDescartadas(await avisosDeLosModulos(supabase, modulosVisibles(quien.rol, quien.grants)), descartes)`.
- `avisosDeTodoElSistema` es `avisosDeLosModulos(supabase, MODULOS_ORDEN)`.

El comentario de `avisosDeTodoElSistema` dice para qué existe: **la foto es
global porque los conteos son globales** —lo único que cambia por persona es qué
módulos ve—, así que son trece filas por día y no trece por persona. Y dice que
no pasa por `filtrarDescartadas` a propósito: un descarte es de una persona y la
foto no es de nadie.

- [ ] **Step 2: Verificar que no cambió nada**

Run: `npx vitest run lib/home/`
Expected: PASS, sin cambios en los tests que ya había.

- [ ] **Step 3: Commit**

```bash
git commit --only lib/home/avisosDeUsuario.ts -F -
```

Mensaje: `refactor(inicio): los avisos de todo el sistema, aparte de los de una persona`.

---

## Task 4: La tabla de la foto, y cómo se lee y se escribe

**Files:**
- Create: `supabase/migrations/<timestamp>_foto_diaria_de_avisos.sql` (con `npm run migracion "foto diaria de avisos"`)
- Create: `lib/home/fotoDeAvisos.ts`

**Interfaces:**
- Consumes: `Foto` de `lib/home/movimiento.ts`; `Notificacion`.
- Produces:
  - `ultimaFoto(admin: SupabaseClient): Promise<{ fecha: string | null; foto: Foto }>`
  - `guardarFoto(admin: SupabaseClient, fecha: string, avisos: Notificacion[]): Promise<void>`

- [ ] **Step 1: Escribir la migración**

Tabla `avisos_fotos`: `fecha date not null`, `notificacion_id text not null`,
`cantidad integer not null`, primary key `(fecha, notificacion_id)`.

**RLS prendido y ninguna policy**, igual que `claves_de_carga`: la escribe sólo
el cliente admin desde el cron y nadie más tiene por qué leerla. Con RLS
prendido y sin policies PostgREST le niega todo a cualquier autenticado y el
admin pasa de largo. Sin el `enable`, la tabla queda abierta a cualquiera con
sesión.

El encabezado explica **por qué una foto y no un cálculo**: no hay forma de
preguntarle a la base "cuántas OT se atrasaron ayer" —el estado no guarda
historia— y reconstruirlo aviso por aviso serían trece consultas distintas, cada
una con su propia manera de equivocarse. Y dice por qué es global: los conteos
son globales, lo único que cambia por persona es qué módulos ve.

- [ ] **Step 2: Pedir que la apliquen y esperar**

La aplica una persona en el editor SQL de Supabase. **No seguir hasta que esté
aplicada**: las dos funciones de abajo no se pueden probar contra nada.

- [ ] **Step 3: Implementar `lib/home/fotoDeAvisos.ts`**

`ultimaFoto` lee **la fecha más alta que haya** y las filas de esa fecha, en dos
consultas: `.order("fecha", { ascending: false }).limit(1)` y después
`.eq("fecha", esa)`. El comentario dice por qué no es "ayer": el día que el cron
no corra, un delta contra ayer sale vacío o al doble. Devuelve
`{ fecha: null, foto: new Map() }` cuando la tabla está vacía, que es el primer
día.

`guardarFoto` hace un `upsert` sobre `(fecha, notificacion_id)`. El comentario
dice qué compra ese upsert: si el cron corre dos veces el mismo día, la segunda
corrida reescribe la misma foto y —porque `ultimaFoto` ya devuelve la de hoy—
calcula delta cero y no manda nada. La idempotencia sale de ahí y no de un
candado.

- [ ] **Step 4: Verificar contra la base real**

Un script de una sola vez en el scratchpad que guarde una foto de prueba, la lea
y la borre. No va al repo.

Expected: lo guardado se lee igual, y un segundo `guardarFoto` del mismo día no
duplica filas.

- [ ] **Step 5: Commit**

```bash
git commit --only supabase/migrations/<archivo>.sql lib/home/fotoDeAvisos.ts -F -
```

Mensaje: `feat(inicio): la foto diaria de los conteos de avisos`.

---

## Task 5: El cron manda movimiento, y los lunes el total

**Files:**
- Modify: `app/api/cron/avisos-diarios/route.ts`

**Interfaces:**
- Consumes: `loQueSeMovio`, `esDiaDeRecordatorio` (tarea 1);
  `resumirElMovimiento` (tarea 2); `avisosDeTodoElSistema` (tarea 3);
  `ultimaFoto`, `guardarFoto` (tarea 4); `hoyEnArgentina` de `lib/core/fechas.ts`.

- [ ] **Step 1: Reescribir el cuerpo del `GET`**

El orden es el que hace que todo lo demás funcione:

1. `const { fecha: fechaFoto, foto } = await ultimaFoto(admin)`.
2. `const hoy = hoyEnArgentina()`; `const esLunes = esDiaDeRecordatorio(hoy)`.
3. **Si `fechaFoto` es null, no se manda nada**: es el primer día y no hay con
   qué comparar. Se salta directo al paso 5.
4. Por cada persona suscripta y activa, igual que hoy: se calculan sus avisos
   con `avisosDeUsuario`, y el resumen sale de
   `esLunes ? resumirParaPush(avisos) : resumirElMovimiento(loQueSeMovio(avisos, foto))`.
   El resto del bucle —mandar, contar, borrar la vencida— no cambia.
5. **Después de mandarle a todos**, `guardarFoto(admin, hoy, await avisosDeTodoElSistema(admin))`.

Dos comentarios que no se deducen del código:

- Por qué la foto se guarda **al final y no al principio**: si se guardara
  antes, `ultimaFoto` de esta misma corrida devolvería la de hoy y el delta
  daría cero para todos.
- Por qué la foto sale de `avisosDeTodoElSistema` y no de lo que se le calculó a
  las personas: si saliera de ahí, dependería de quién esté suscripto ese día —
  un módulo que nadie suscripto mira quedaría sin foto y mañana aparecería
  entero como novedad.

La respuesta del endpoint suma `esLunes`, `avisosEnLaFoto` y `primerDia`, para
poder mirar qué hizo sin adivinar.

- [ ] **Step 2: Verificar los tipos y el build**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit --only app/api/cron/avisos-diarios/route.ts -F -
```

Mensaje: `feat(inicio): el resumen diario cuenta movimiento y los lunes el total`.

---

## Task 6: Los avisos de aprobación van a su lista

**Files:**
- Modify: `lib/home/avisosDeUsuario.ts`
- Test: `lib/home/avisosDeUsuario.test.ts` (crear si no existe)

**Interfaces:**
- Consumes: `puedeAprobarCompras`, `puedeAprobarOS` de `lib/compras/auth.ts`.

- [ ] **Step 1: Escribir el test que falla**

El filtro es puro y va aparte para poder probarlo:

```ts
describe("sinLoQueNoPuedeAtender", () => {
  const avisos = [
    { id: "compras-por-aprobar", titulo: "x", cantidad: 11, href: "/a" },
    { id: "mant-atrasadas", titulo: "y", cantidad: 23, href: "/b" },
  ];

  it("quien no aprueba no recibe el aviso de aprobacion", () => {
    expect(sinLoQueNoPuedeAtender(avisos, { apruebaCompras: false, apruebaOS: false })
      .map((a) => a.id)).toEqual(["mant-atrasadas"]);
  });

  it("quien aprueba lo recibe", () => {
    expect(sinLoQueNoPuedeAtender(avisos, { apruebaCompras: true, apruebaOS: false })
      .map((a) => a.id)).toEqual(["compras-por-aprobar", "mant-atrasadas"]);
  });

  // Los administradores siguen recibiendo todo lo demas: el filtro mira la
  // lista, no el rol ni el nivel.
  it("no toca ningun otro aviso", () => {
    const otros = [{ id: "ritmo-remises", titulo: "z", cantidad: 1, href: "/c" }];
    expect(sinLoQueNoPuedeAtender(otros, { apruebaCompras: false, apruebaOS: false }))
      .toEqual(otros);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/home/avisosDeUsuario.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar y enganchar**

`sinLoQueNoPuedeAtender(avisos: Notificacion[], puede: { apruebaCompras: boolean; apruebaOS: boolean }): Notificacion[]`
en `lib/home/avisosDeUsuario.ts`, y `avisosDeUsuario` lo aplica después de
`filtrarDescartadas`, consultando las dos listas con las funciones que ya
existen.

El comentario dice por qué esto no es "repartir por permiso": es **una lista de
responsables**, igual que la que usa el aviso al instante. Medido el 18/10/2026,
«Requerimientos esperando aprobación» le llegaba a 6 personas y 3 no podían
aprobar nada. Pedirle a alguien algo que no puede hacer enseña que un aviso tuyo
puede no ser tuyo.

**No se filtra nada más.** Los administradores reciben todo lo demás, decidido a
pedido.

- [ ] **Step 4: Correr y verificar**

Run: `npx vitest run lib/home/ && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit --only lib/home/avisosDeUsuario.ts lib/home/avisosDeUsuario.test.ts -F -
```

Mensaje: `fix(inicio): el aviso de aprobacion va a quien puede aprobar`.

---

## Task 7: Borrar los descartes que ya no defienden nada

**Files:** ninguno del repo.

- [ ] **Step 1: Contar antes**

Leer `notificaciones_descartes` y anotar cuántas filas hay y de quién. Medido el
18/10/2026: 13 de Bernardo Strupp y 13 de Delfina Puch, 26 en total, y nadie más
descartó nada.

- [ ] **Step 2: Borrarlas**

Es DML, así que lo puede aplicar un agente por PostgREST con el cliente admin.
**Antes de borrar, mirar lo que hay**: si el conteo no da 26, parar y decirlo —
alguien descartó algo nuevo entre que se escribió esto y ahora, y eso sí es una
decisión reciente que no hay que pisar.

- [ ] **Step 3: Verificar**

La tabla queda vacía, y `avisosDeUsuario` para Bernardo vuelve a devolver sus
avisos en vez de cero.

---

## Task 8: Que quede escrito, y la verificación completa

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-10-18-a-quien-le-avisa-el-sdg-design.md`

- [ ] **Step 1: La sección de `CLAUDE.md`**

En «Un aviso nuevo sale por dos lados», que ya habla del resumen diario: ahora
el resumen **cuenta movimiento**, la campana cuenta stock, y los lunes van los
totales. Lo que hay que saber antes de tocar un aviso: su `cantidad` la compara
la foto del día anterior, así que **un aviso cuyo conteo cambie de significado
va a generar una novedad falsa el día del cambio**.

- [ ] **Step 2: La sección de cierre del spec**

Qué se verificó y con qué números, igual que los otros specs.

- [ ] **Step 3: Las cuatro verificaciones**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
```

`npm run build` con `npm run dev` levantado deja la app en 500: parar el dev
server antes.

- [ ] **Step 4: Pushear y probar en producción**

```bash
git push origin main
```

La prueba de verdad no es que el código parezca correcto: con la foto de un día
ya guardada, disparar el cron y confirmar que **el push dice un número de
movimiento y no el total**, y que un segundo disparo el mismo día **no manda
nada**. El único aparato con notificaciones es el de Bernardo Strupp.

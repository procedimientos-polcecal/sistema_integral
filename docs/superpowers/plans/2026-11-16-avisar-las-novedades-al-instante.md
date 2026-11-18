# Avisar las novedades al instante — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una novedad de la campana, o una ausencia recién cargada, llegue
por push en minutos y no al otro día a las 8:30.

**Architecture:** Un cron cada 15 minutos recalcula **una sola vez** los
conteos globales (`avisosDeTodoElSistema`), los compara contra una tabla nueva
`avisos_vistos` —una fila por aviso, no por día— y después filtra esa única
lista **por persona**: sus módulos, sus descartes y lo que puede atender. Las
decisiones viven en funciones puras de `lib/home/`; la ruta sólo orquesta.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase/PostgREST, vitest.

**Spec:** [docs/superpowers/specs/2026-11-16-avisar-las-novedades-al-instante-design.md](../specs/2026-11-16-avisar-las-novedades-al-instante-design.md)

## Global Constraints

- **Se trabaja sobre `main`.** El árbol donde se diseñó estaba en
  `sincronizaciones-despliegue-canonico`, 228 commits atrás, donde no existen
  `avisosDeSalud`, `CRECE_CON_EL_DIA` ni `POR_PREFIJO`. Todas las firmas de este
  plan salen de `git show origin/main:…`.
- Todo en castellano: nombres, comentarios, textos y commits. Los comentarios
  explican **por qué**, no qué.
- **No se toca qué cuenta cada aviso ni cómo.** Agregarle el `modulo` a la
  definición es metadato.
- **Una notificación por corrida y por persona**, nunca una por aviso.
- Ventana **7:00–21:00 de Argentina**, con `esHoraDeAvisar()` de
  `lib/core/avisoAlInstante.ts`. Fuera de ella no se manda y **no se encola**.
- **`compras-por-aprobar` no entra**: ya tiene su push al crearse el
  requerimiento y llegaría dos veces.
- La migración la aplica **una persona a mano**. Un agente no corre DDL.
- Nunca `git add -A`: se commitea nombrando las rutas.

## Review Focus

1. **Un recurso de salud que sigue roto no vuelve a avisar.** Su `cantidad` es
   la racha de corridas fallidas y sube ~6 veces por hora: sin el flanco son
   hasta 56 pushes en un día (tarea 2).
2. **La primera corrida de todas, con `avisos_vistos` vacía, no manda nada.**
   Tratar «no hay vistazo» como «todo es nuevo» es un push de estreno con todo
   lo que haya (tareas 2 y 5).
3. **`salud-sin-comprobar` no genera una novedad a las 7:00 de cada mañana.** Su
   `cantidad` es el día como número (tarea 2).
4. **Una persona sin módulos, sin suscripción o sin nada que mirar no rompe la
   corrida ni recibe un push vacío** (tareas 1 y 5).
5. **Dos corridas seguidas sin movimiento no mandan nada**, ni siquiera la
   segunda (tareas 2 y 5).

---

## Task 1: De qué módulo es cada aviso

**Files:**
- Modify: `lib/home/avisos.ts`
- Create: `lib/home/moduloDelAviso.ts`
- Test: `lib/home/moduloDelAviso.test.ts`

**Interfaces:**
- Consumes: `Notificacion` de `./notificaciones`; `Modulo` de `@/lib/core/types`.
- Produces:
  - `moduloDelAviso(id: string): Modulo | null` — `null` es «no es de un
    módulo»: los `salud-*`, que son del sistema.
  - `soloDeSusModulos(avisos: Notificacion[], modulos: Modulo[]): Notificacion[]`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("moduloDelAviso", () => {
  it("un aviso de conteo sale de su definicion", () => {
    expect(moduloDelAviso("mant-atrasadas")).toBe("mantenimiento");
    expect(moduloDelAviso("compras-por-aprobar")).toBe("compras");
    expect(moduloDelAviso("syh-vencidas")).toBe("seguridad_higiene");
  });

  it("uno de ritmo lleva su modulo en el id", () => {
    expect(moduloDelAviso("ritmo-trituracion")).toBe("trituracion");
    expect(moduloDelAviso("ritmo-taller_vial")).toBe("taller_vial");
  });

  // La salud es del sistema: no es de ningun modulo y su filtro es el de
  // `sinLoQueNoPuedeAtender`, que la manda solo a admin_sistema.
  it("la salud no es de ningun modulo", () => {
    expect(moduloDelAviso("salud-produccion/molinos")).toBeNull();
    expect(moduloDelAviso("salud-sin-declarar")).toBeNull();
  });

  it("un id que no existe no revienta", () => {
    expect(moduloDelAviso("inventado")).toBeNull();
  });

  // El contrato con `avisos.ts`: si alguien agrega una entrada sin `modulo`,
  // esto se pone en rojo en vez de dejar un aviso que no le llega a nadie.
  it("todas las entradas de AVISOS resuelven a un modulo", () => {
    for (const a of avisosDeConteos(Object.fromEntries(
      Object.keys(CONTEOS_EN_CERO).map((k) => [k, 1])
    ) as ConteosParaAvisos)) {
      expect(moduloDelAviso(a.id), a.id).not.toBeNull();
    }
  });
});

describe("soloDeSusModulos", () => {
  const avisos = [
    { id: "mant-atrasadas", titulo: "a", cantidad: 1, href: "/" },
    { id: "ritmo-trituracion", titulo: "b", cantidad: 1, href: "/" },
    { id: "salud-x/y", titulo: "c", cantidad: 1, href: "/" },
  ];

  it("deja solo los de sus modulos", () => {
    expect(soloDeSusModulos(avisos, ["mantenimiento"]).map((a) => a.id))
      .toEqual(["mant-atrasadas", "salud-x/y"]);
  });

  // La salud pasa siempre porque no es de un modulo: quien la frena es
  // `sinLoQueNoPuedeAtender`, y ponerle un filtro de modulo acá la dejaria
  // fuera para todos.
  it("la del sistema pasa aunque no tenga ningun modulo", () => {
    expect(soloDeSusModulos(avisos, []).map((a) => a.id)).toEqual(["salud-x/y"]);
  });
});
```

`CONTEOS_EN_CERO` es un objeto con las claves de `ConteosParaAvisos` en 0, que
el test arma para recorrer todas las entradas sin escribir la lista a mano.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/home/moduloDelAviso.test.ts`
Expected: FAIL, el módulo no existe.

- [ ] **Step 3: Agregar `modulo` a cada entrada de `AVISOS` en `lib/home/avisos.ts`**

Son 21 entradas y el tipo del array pasa a incluir `modulo: Modulo`. El
comentario arriba del array dice **por qué ahora hace falta**: la relación
aviso→módulo vivía en la llamada `contarSiTiene(modulo, …)` de
`avisosDeLosModulos`, o sea en el call site; con una sola pasada global ya no
hay dónde aplicarla, así que se declara.

`mensajes-menciones-sin-leer` y `agenda-divergencias` llevan su módulo igual
aunque hoy no se usen acá: están en `ES_POR_PERSONA` y el instantáneo los
saltea, pero dejar la metadata incompleta es lo que hace que la próxima lectura
no sepa si falta o si no corresponde.

- [ ] **Step 4: Implementar las dos de `lib/home/moduloDelAviso.ts`**

`moduloDelAviso` resuelve en tres pasos: el prefijo `ritmo-` lleva el módulo en
el id; `salud-` devuelve `null`; el resto sale de `AVISOS`. `soloDeSusModulos`
deja pasar lo que dé `null` —no es de nadie en particular— y lo que esté en la
lista.

- [ ] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run lib/home/ && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit --only lib/home/avisos.ts lib/home/moduloDelAviso.ts lib/home/moduloDelAviso.test.ts -F -
```

Mensaje: `feat(inicio): cada aviso declara de que modulo es`.

---

## Task 2: Qué es novedad para el instantáneo

**Files:**
- Create: `lib/home/novedadAlInstante.ts`
- Test: `lib/home/novedadAlInstante.test.ts`

**Interfaces:**
- Consumes: `Notificacion`; `ES_POR_PERSONA` y `CRECE_CON_EL_DIA` de
  `./notificaciones`; `Foto` de `./movimiento`.
- Produces: `novedadesAlInstante(avisos: Notificacion[], vistos: Foto): Notificacion[]`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
const aviso = (id: string, cantidad: number): Notificacion =>
  ({ id, titulo: `t-${id}`, cantidad, href: `/${id}` });

describe("novedadesAlInstante", () => {
  it("lo que subio sale con cuanto subio", () => {
    expect(novedadesAlInstante([aviso("mant-atrasadas", 24)], new Map([["mant-atrasadas", 21]])))
      .toEqual([{ ...aviso("mant-atrasadas", 3) }]);
  });

  it("lo que no se movio no sale", () => {
    expect(novedadesAlInstante([aviso("mant-atrasadas", 24)], new Map([["mant-atrasadas", 24]]))).toEqual([]);
  });

  it("lo que bajo no sale", () => {
    expect(novedadesAlInstante([aviso("mant-atrasadas", 20)], new Map([["mant-atrasadas", 24]]))).toEqual([]);
  });

  /*
   * EL FLANCO DE LA SALUD, que es la razon por la que esta funcion existe
   * aparte de `loQueSeMovio`.
   *
   * Su cantidad es la racha de corridas fallidas, y con diez sincronizaciones
   * corriendo seis veces por hora sube unas seis veces por hora mientras el
   * recurso siga roto. Tratarla como un conteo son hasta 56 pushes en un dia
   * por un solo sync caido.
   */
  it("un recurso que se acaba de romper avisa una vez", () => {
    expect(novedadesAlInstante([aviso("salud-rrhh/lenox", 1)], new Map()))
      .toEqual([{ ...aviso("salud-rrhh/lenox", 1) }]);
  });

  it("un recurso que sigue roto no vuelve a avisar, aunque su racha suba", () => {
    expect(novedadesAlInstante([aviso("salud-rrhh/lenox", 7)], new Map([["salud-rrhh/lenox", 1]]))).toEqual([]);
  });

  it("un recurso que se arreglo y se volvio a romper avisa de nuevo", () => {
    // Se arreglo: dejo de estar en los avisos, asi que sale del vistazo.
    expect(novedadesAlInstante([aviso("salud-rrhh/lenox", 1)], new Map([["otro", 1]])))
      .toHaveLength(1);
  });

  // Su cantidad es el dia como numero: comparar un reloj da siempre novedad.
  it("salud-sin-comprobar nunca es novedad", () => {
    for (const vistos of [new Map(), new Map([["salud-sin-comprobar", 20261115]])]) {
      expect(novedadesAlInstante([aviso("salud-sin-comprobar", 20261116)], vistos as Foto)).toEqual([]);
    }
  });

  // Su numero depende de quien mira y este calculo es global.
  it("los de una persona no salen nunca", () => {
    expect(novedadesAlInstante(
      [aviso("agenda-divergencias", 3), aviso("mensajes-menciones-sin-leer", 2)], new Map()
    )).toEqual([]);
  });

  /*
   * LA PRIMERA CORRIDA DE TODAS no manda nada, y eso lo decide `queMandarAhora`
   * en la tarea 3 — no esta funcion, que con el vistazo vacio da todo por
   * nuevo. Se fija aca para que las dos mitades no se contradigan.
   */
  it("con el vistazo vacio da todo por nuevo: el freno es de quien la llama", () => {
    expect(novedadesAlInstante([aviso("mant-atrasadas", 24)], new Map())).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/home/novedadAlInstante.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `novedadesAlInstante`**

El encabezado dice por qué no alcanza con `loQueSeMovio`: ésa compara contra la
foto de ayer, una vez por día, y acá se compara contra el vistazo anterior,
cincuenta y seis veces. La diferencia que importa es **la familia `salud-`**, y
el porqué medido va ahí con los números.

Para `salud-`: sale sólo si el id **no estaba** en `vistos`, y con `cantidad: 1`
—su racha no es una cantidad de cosas y escribirla diría «7 más»—.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run lib/home/novedadAlInstante.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit --only lib/home/novedadAlInstante.ts lib/home/novedadAlInstante.test.ts -F -
```

Mensaje: `feat(inicio): que es novedad para el aviso al instante`.

---

## Task 3: El vistazo anterior, y si hay que mandar algo

**Files:**
- Create: `supabase/migrations/<timestamp>_vistazo_de_avisos.sql` (`npm run migracion "vistazo de avisos"`)
- Create: `lib/home/vistazoDeAvisos.ts`
- Test: `lib/home/vistazoDeAvisos.test.ts`

**Interfaces:**
- Consumes: `Foto` de `./movimiento`; `Notificacion`.
- Produces:
  - `ultimoVistazo(admin): Promise<{ cuando: string | null; vistos: Foto; error?: string }>`
  - `guardarElVistazo(admin, avisos: Notificacion[], cuando: string): Promise<{ error?: string }>`
  - `queMandarAhora(v: { cuando: string | null; ahora: Date }): "nada" | "novedades"`

- [ ] **Step 1: Escribir la migración**

Tabla `avisos_vistos`: `notificacion_id text primary key`, `cantidad integer not
null`, `visto_en timestamptz not null`. **RLS prendido y ninguna policy**, igual
que `avisos_fotos`: la escribe y la lee sólo el cliente admin.

El encabezado explica **por qué es otra tabla y no `avisos_fotos`**: la foto
tiene una fila por aviso **y por día** y es contra la que el resumen de los
lunes calcula los totales —la fecha de la foto de hoy es además la idempotencia
de ese cron—; ésta tiene una sola fila por aviso y se pisa 56 veces al día.
Mezclarlas rompe el delta de los lunes.

Y dice por qué **el borrado importa**: un `salud-*` que se arregla tiene que
salir de la tabla, o el día que vuelva a romperse no se lo ve como flanco. El
guardado reemplaza el contenido entero, no hace sólo upsert.

- [ ] **Step 2: Pedir que la apliquen y esperar**

La aplica una persona en el editor SQL de Supabase. **No seguir sin eso**: las
funciones de abajo no se pueden ejercitar contra nada.

- [ ] **Step 3: Escribir los tests que fallan**

Con el cliente falso de `lib/home/fotoDeAvisos.test.ts` como molde.

```ts
describe("queMandarAhora", () => {
  const DE_DIA = new Date("2026-11-16T15:00:00Z");   // 12:00 AR
  const DE_NOCHE = new Date("2026-11-16T05:00:00Z"); // 2:00 AR

  it("fuera de la ventana no se manda nada", () => {
    expect(queMandarAhora({ cuando: "2026-11-16T14:00:00Z", ahora: DE_NOCHE })).toBe("nada");
  });

  // La primera corrida de todas: no hay con que comparar, asi que solo se
  // guarda. Tratarlo como "todo es nuevo" seria un push de estreno.
  it("sin ningun vistazo anterior no se manda nada", () => {
    expect(queMandarAhora({ cuando: null, ahora: DE_DIA })).toBe("nada");
  });

  it("con un vistazo anterior y dentro de la ventana, se mandan las novedades", () => {
    expect(queMandarAhora({ cuando: "2026-11-16T14:45:00Z", ahora: DE_DIA })).toBe("novedades");
  });
});

describe("ultimoVistazo", () => {
  it("devuelve las cantidades y la hora de la corrida anterior", async () => { /* … */ });
  it("sin filas devuelve cuando null y el mapa vacio", async () => { /* … */ });
  it("si la tabla no existe, lo dice en vez de parecer la primera corrida", async () => { /* … */ });
});

describe("guardarElVistazo", () => {
  it("deja exactamente los avisos de ahora, y borra los que ya no estan", async () => {
    // Un salud- que se arreglo tiene que salir, o su proxima rotura no se ve
    // como flanco.
  });
  it("sin avisos deja la tabla vacia pero con la hora", async () => { /* … */ });
  it("si la base falla devuelve el motivo y no tira", async () => { /* … */ });
});
```

- [ ] **Step 4: Correr y verificar que fallan**

Run: `npx vitest run lib/home/vistazoDeAvisos.test.ts`
Expected: FAIL

- [ ] **Step 5: Implementar las tres**

`ultimoVistazo` distingue **el error de «no hay vistazo»**, por lo mismo que
`ultimaFoto`: entre el deploy y la migración la tabla no existe, y confundirlo
con la primera corrida deja al cron callado para siempre sin que nadie se
entere.

`guardarElVistazo` **reemplaza**: borra lo que ya no está y escribe lo de ahora.
La hora de la corrida se guarda en cada fila (`visto_en`); con la tabla vacía
hace falta una fila centinela para no perder `cuando` — mismo patrón que
`SIN_AVISOS` en `fotoDeAvisos.ts`.

- [ ] **Step 6: Verificar contra la base real**

Un script de una sola vez en el scratchpad: guardar un vistazo de prueba,
leerlo, guardar otro sin uno de los ids y comprobar que desapareció. No va al
repo.

- [ ] **Step 7: Commit**

```bash
git commit --only supabase/migrations/<archivo>.sql lib/home/vistazoDeAvisos.ts lib/home/vistazoDeAvisos.test.ts -F -
```

Mensaje: `feat(inicio): el vistazo anterior de los avisos`.

---

## Task 4: Las ausencias cargadas desde la corrida anterior

**Files:**
- Create: `lib/rrhh/ausenciasRecientes.ts`
- Test: `lib/rrhh/ausenciasRecientes.test.ts`

**Interfaces:**
- Produces:
  - `contarAusenciasDesde(admin, desde: string): Promise<{ cuantas: number; error?: string }>`
  - `lineaDeAusencias(cuantas: number): Notificacion | null`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("lineaDeAusencias", () => {
  it("sin ninguna no genera linea", () => {
    expect(lineaDeAusencias(0)).toBeNull();
  });

  it("una sola se dice en singular", () => {
    expect(lineaDeAusencias(1)).toEqual({
      id: "rrhh-ausencias-cargadas",
      titulo: "Se cargó una ausencia",
      cantidad: 1,
      href: "/rrhh/ausencias",
    });
  });

  it("varias dicen cuantas", () => {
    expect(lineaDeAusencias(105)?.titulo).toBe("Se cargaron 105 ausencias");
  });
});

describe("contarAusenciasDesde", () => {
  it("cuenta por created_at y no por la fecha de la ausencia", async () => {
    // La mediana entre que empieza y que se carga es de 33 dias: contar por
    // `fecha_desde` no diria nunca que se acaba de cargar algo.
  });
  it("si la base falla devuelve el motivo y no tira", async () => { /* … */ });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/rrhh/ausenciasRecientes.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar las dos**

`contarAusenciasDesde` hace un `count … head` sobre `ausencias` con
`.gte("created_at", desde)`. El comentario dice por qué **`created_at` y no
`fecha_desde`**, con el número: la mediana entre que la ausencia empieza y que
alguien la carga es de 33 días, así que la fecha de la ausencia no dice nada
sobre cuándo entró al sistema.

El id `rrhh-ausencias-cargadas` **no es un aviso de `lib/home/avisos.ts`**: no
hay stock que contar —una ausencia cargada no queda pendiente de nada— así que
no va a la campana. Vive sólo acá, y el comentario lo dice para que nadie lo
busque allá.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run lib/rrhh/ausenciasRecientes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit --only lib/rrhh/ausenciasRecientes.ts lib/rrhh/ausenciasRecientes.test.ts -F -
```

Mensaje: `feat(rrhh): cuantas ausencias se cargaron desde la corrida anterior`.

---

## Task 5: La ruta del cron

**Files:**
- Create: `app/api/cron/avisos-al-instante/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `avisosDeTodoElSistema` y `sinLoQueNoPuedeAtender` de
  `lib/home/avisosDeUsuario`; `soloDeSusModulos` (tarea 1);
  `novedadesAlInstante` (tarea 2); `ultimoVistazo`, `guardarElVistazo`,
  `queMandarAhora` (tarea 3); `contarAusenciasDesde`, `lineaDeAusencias`
  (tarea 4); `resumirElMovimiento` de `lib/home/resumenDeAvisos`;
  `enviarPush` de `lib/core/webpush`; `filtrarDescartadas` de
  `lib/home/notificaciones`; `modulosVisibles` y `nivelEnModulo` de
  `lib/core/access`; `revisarElSecreto` de `lib/core/cron`.

- [ ] **Step 1: Escribir la ruta**

El orden, que es lo que hace que funcione:

1. `revisarElSecreto(request)`.
2. `ultimoVistazo(admin)`; si trae `error`, cortar con 503 y decirlo —mismo
   criterio que `avisos-diarios` con `avisos_fotos`—.
3. `queMandarAhora({ cuando, ahora: new Date() })`.
4. `const todos = await avisosDeTodoElSistema(admin)` — **una sola vez**.
5. Si hay que mandar: `novedadesAlInstante(todos, vistos)` y
   `contarAusenciasDesde(admin, cuando)`.
6. Por cada persona con suscripción y activa: `soloDeSusModulos` por sus
   módulos, `filtrarDescartadas` con sus descartes, `sinLoQueNoPuedeAtender`
   con su `QuePuedeAtender`, más la línea de ausencias si la hay; una sola
   notificación con `resumirElMovimiento`.
7. `guardarElVistazo(admin, todos, ahora)` **siempre**, incluso cuando no se
   mandó nada.

Cuatro comentarios que no se deducen del código:

- **Por qué `avisosDeTodoElSistema` se llama una vez y no por persona**: los
  conteos son globales y lo que es por persona es el filtrado. Medido el
  16/11/2026: una pasada 1,2 s, las dieciséis como las hace el cron diario 8,7 s
  (544 ms c/u), y la vista de ritmo sola 295 ms en caliente. Es la salida que el
  encabezado de `avisos-diarios` ya dejó anotada.
- **Por qué el vistazo se guarda al final**: guardarlo antes dejaría la
  comparación de esta misma corrida en cero.
- **Por qué se guarda aunque no se haya mandado nada**: si no, la primera
  corrida nunca deja de ser la primera y el cron queda callado para siempre.
- **Por qué `compras-por-aprobar` no entra**: ya tiene su push al crearse el
  requerimiento (`lib/compras/avisoDeAprobacion.ts`) y llegaría dos veces por lo
  mismo.

La respuesta JSON lleva `queMandar`, `cuandoFueElVistazo`, `novedades`,
`ausencias`, `personas` y `enviadas`, para poder mirar qué hizo sin adivinar.

- [ ] **Step 2: Agregarlo a `vercel.json`**

Cada 15 minutos dentro de la ventana, en UTC: 7:00–21:00 de Argentina son
10:00–00:00 UTC. **Con minuto propio y no en `0,15,30,45`**: `main` ya escalona
sus diez crons frecuentes (`6,16,26,36,46,56`, `7,17,…`) justamente para no
amontonarlos. Elegir un minuto libre.

Que la cadencia entra está probado: `main` ya corre diez crons seis veces por
hora.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit --only app/api/cron/avisos-al-instante/route.ts vercel.json -F -
```

Mensaje: `feat(inicio): las novedades se avisan al instante`.

---

## Task 6: El resumen diario deja de contar movimiento

**Files:**
- Modify: `app/api/cron/avisos-diarios/route.ts`

- [ ] **Step 1: Sacar la rama `"movimiento"`**

`queMandarHoy` sigue devolviendo sus tres valores y el cron **sigue corriendo
todos los días**: lo único que cambia es que con `"movimiento"` no se manda
nada. Los `"totales"` de los lunes quedan igual.

El comentario dice las dos cosas que hacen falta para no deshacerlo por error:

- **No se saca el cron de `vercel.json`.** Además de mandar, escribe
  `avisos_fotos` al final, y la fecha de esa foto es la idempotencia de los
  lunes (`queMandarHoy`: «si la última foto es la de hoy, esta corrida ya
  pasó»). Sacarlo se lleva los totales y el candado contra el reenvío.
- **Los lunes hay solapamiento conocido**: la misma persona recibe los totales
  de las 8:30 y además las novedades del cron nuevo desde las 7:00. Es una vez
  por semana y es el precio de conservar la red.

- [ ] **Step 2: Verificar**

Run: `npx vitest run lib/home/ && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit --only app/api/cron/avisos-diarios/route.ts -F -
```

Mensaje: `refactor(inicio): el resumen diario deja de repetir lo que ya se aviso`.

---

## Task 7: Que quede escrito, y la verificación completa

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-11-16-avisar-las-novedades-al-instante-design.md`
- Modify: `docs/API-MAPA.generado.md` (regenerado)

- [ ] **Step 1: La sección de `CLAUDE.md`**

En «Un aviso nuevo sale por dos lados», que ya habla del resumen y del aviso al
instante: ahora hay un **quinto emisor** y el diario dejó de contar movimiento.
Lo que hay que saber antes de tocar un aviso:

- su `cantidad` se compara contra el vistazo anterior, 56 veces al día, no
  contra la foto de ayer;
- **la familia `salud-*` avisa por el flanco y no por el número**, porque su
  cantidad es una racha que sube seis veces por hora;
- un aviso nuevo **tiene que declarar su `modulo`**, o no le llega a nadie.

- [ ] **Step 2: La sección de cierre del spec**

Qué se verificó y con qué números, igual que los otros specs. **Incluye volver a
medir el volumen real**: el 2,1 por día de las fotos diarias es un piso, porque
no ve lo que sube y baja dentro del mismo día.

- [ ] **Step 3: Regenerar el mapa de APIs**

Run: `npm run mapa-de-apis`

- [ ] **Step 4: Las verificaciones**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
```

`npm run build` con `npm run dev` levantado deja la app en 500: parar el dev
server antes.

- [ ] **Step 5: Pushear y probar en producción**

La prueba de verdad no es que el código parezca correcto:

1. con un vistazo ya guardado, disparar la ruta y confirmar que **no manda nada**
   cuando nada se movió;
2. mover un conteo a propósito —cargar una ausencia— y confirmar que **llega el
   push en la corrida siguiente**, y que dice el movimiento y no el total;
3. con un recurso de salud caído, confirmar que **avisa una sola vez** y no en
   cada pasada.

Los dos aparatos con push prendido son los únicos que lo van a recibir.

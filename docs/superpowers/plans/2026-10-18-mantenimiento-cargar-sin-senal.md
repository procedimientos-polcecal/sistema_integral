# Cargar un aviso o una OT sin señal — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el SdG abra en la planta sin señal, deje cargar un aviso o una OT, y que esas cargas lleguen solas —una sola vez, con su fecha, y firmadas por quien las hizo— cuando vuelve la conexión.

**Architecture:** Una pantalla propia `/cargar`, fuera del grupo `(app)` para que ningún componente de servidor la bloquee, guardada entera por el service worker y usada por él como respaldo de cualquier navegación que falle sin conexión. La cola y los catálogos viven en IndexedDB; todas las decisiones (qué fallo es definitivo, de quién es una carga, cuál sigue) viven en funciones puras de `lib/core/colaOffline.ts` con tests. El envío llama a las rutas de alta que ya existen, que pasan a aceptar una clave de idempotencia reservada **antes** de tocar la planilla.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase/PostgREST, vitest, `public/sw.js` a mano (sin Serwist), IndexedDB sin librería.

**Spec:** [docs/superpowers/specs/2026-10-18-mantenimiento-cargar-sin-senal-design.md](../specs/2026-10-18-mantenimiento-cargar-sin-senal-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, textos de pantalla y mensajes de commit. Conventional commits: `feat(mantenimiento): …`.
- **Nunca `git add -A`.** Hay otra sesión en el mismo árbol. Commitear con `git commit --only <rutas> -F -`.
- **Sólo se encolan dos cosas:** el aviso y la OT de Mantenimiento. Nada de stock, compras, producción ni fotos.
- **El número no se inventa nunca en el teléfono.** Sale de la planilla, en el servidor, al aterrizar.
- **La fecha que viaja es la del momento en que se cargó**, no la del momento en que entró.
- Los desplegables se escriben `<Select>` de `components/Select.tsx`, no `<select>`.
- Una grilla de tres columnas lleva breakpoint: `grid-cols-1 sm:grid-cols-3`. El ancho útil es 343 px.
- Una policy nueva llama a su función envuelta: `using ((select ...))`.
- Las migraciones **las aplica una persona a mano**. Un agente no corre DDL.
- Verificación antes de dar una tarea por buena: `npm test`, `npx tsc --noEmit`, `npm run build`, `node scripts/revisar-arbol-commiteado.mjs`, `node scripts/revisar-responsive.mjs`.

## Review Focus

1. **Dos vaciados a la vez** (se abre la app justo cuando llega el push) mandan la misma carga dos veces. Tarea 2 y 7: una carga tomada queda marcada y el segundo disparo la saltea.
2. **Un `401` tratado como definitivo** tira a la basura una carga buena; es el fallo más probable de todos, porque la sesión se vence sola. Tarea 2.
3. **El teléfono cambia de mano** y una carga se manda bajo otra sesión, firmando la planilla con quien no la hizo. Tarea 2.
4. **Sin IndexedDB** (Safari privado, almacenamiento lleno) la pantalla tiene que decir que no puede guardar, no fingir que guardó. Tarea 6 lo implementa y **tarea 9 lo comprueba**: en este repo las pantallas no tienen tests, así que esto se prueba en un navegador de verdad o no se prueba.
5. **Dos avisos iguales a propósito** —dos fallas idénticas el mismo día— no son un duplicado: la clave la genera el teléfono por carga, nunca sale del contenido. Tarea 6 lo implementa y **tarea 9 lo comprueba** cargando dos avisos idénticos seguidos.

---

## Task 1: La tabla de las claves de carga

**Files:**
- Create: `supabase/migrations/<timestamp>_claves_de_las_cargas_offline.sql` (generar con `npm run migracion "claves de las cargas offline"`)

**Interfaces:**
- Produces: tabla `cargas_offline` con columnas `clave text primary key`, `usuario_id uuid not null references usuarios(id) on delete cascade`, `tipo text not null check (tipo in ('aviso','orden'))`, `creado_en timestamptz not null default now()`, `resuelto_en timestamptz`, `numero text`, `entidad_id uuid`.

- [ ] **Step 1: Escribir la migración**

El encabezado explica **por qué una tabla y no una columna**: existe una ventana en la que la fila ya se escribió en la planilla y el insert en la base falló —`app/api/mantenimiento/ordenes/route.ts` la contempla y devuelve 500—, y en esa ventana no hay ninguna fila donde haber guardado la clave. La clave se reserva antes de tocar la planilla.

`alter table cargas_offline enable row level security;` **y ninguna policy.** Eso no es un olvido y va dicho en el comentario: a la tabla la escribe sólo el cliente admin desde las dos rutas de alta, y nadie más tiene por qué leerla — la pantalla de la cola lee del teléfono, no de acá. Sin RLS la tabla quedaría abierta a cualquier autenticado por PostgREST.

- [ ] **Step 2: Commit y pedir que se aplique**

```bash
git add supabase/migrations/<timestamp>_claves_de_las_cargas_offline.sql
git commit --only supabase/migrations/<timestamp>_claves_de_las_cargas_offline.sql -F -
```

**Decirle al usuario que la aplique y esperar.** Las tareas 3 y 4 no se pueden verificar hasta que exista.

- [ ] **Step 3: Verificar que quedó aplicada**

Script de sólo lectura con el `SUPABASE_SERVICE_ROLE_KEY` de `.env.local` que pida `cargas_offline` por PostgREST y confirme las columnas. **No alcanza `.select("*", { head: true })` sin `count`:** eso esconde el error y da por buena una tabla que no existe. Mirar el status HTTP, 404 contra 200.

---

## Task 2: Qué es definitivo, qué es pasajero, y de quién es cada carga

**Files:**
- Create: `lib/core/colaOffline.ts`
- Test: `lib/core/colaOffline.test.ts`

**Interfaces:**
- Produces:
  - `type TipoDeCarga = "aviso" | "orden"`
  - `interface CargaEnCola { clave: string; tipo: TipoDeCarga; cuerpo: Record<string, unknown>; usuarioId: string; creadaEn: string; tomadaEn: string | null; intentos: number; ultimoError: string | null; estado: "esperando" | "parada" }`
  - `clasificarFallo(status: number | null): "definitivo" | "pasajero"`
  - `puedeMandarse(carga: CargaEnCola, usuarioActualId: string | null, ahora: Date): boolean`
  - `proximaAMandar(cargas: CargaEnCola[], usuarioActualId: string | null, ahora: Date): CargaEnCola | null`
  - `esperandoDesdeAyer(cargas: CargaEnCola[], ahora: Date): CargaEnCola[]`
  - `esperaAntesDeReintentar(intentos: number): number` — minutos
  - `MINUTOS_PARA_SOLTAR = 5`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("clasificarFallo", () => {
  it("un 400 y un 403 son definitivos: reintentar no cambia nada", () => {
    expect(clasificarFallo(400)).toBe("definitivo");
    expect(clasificarFallo(403)).toBe("definitivo");
  });

  it("un 401 es PASAJERO: la sesión se vence sola mientras la carga espera", () => {
    expect(clasificarFallo(401)).toBe("pasajero");
  });

  it("un 502 es pasajero: así reporta la ruta que Google no contestó", () => {
    expect(clasificarFallo(502)).toBe("pasajero");
  });

  it("no haber llegado a hablar con el servidor es pasajero", () => {
    expect(clasificarFallo(null)).toBe("pasajero");
  });
});

describe("puedeMandarse", () => {
  it("no se manda una carga de otro: firmaría la planilla con quien no la hizo", () => { /* usuarioId "ana" vs sesión "beto" → false */ });
  it("no se manda una carga parada", () => { /* estado "parada" → false */ });
  it("no se manda una carga que otro disparo tomó recién", () => { /* tomadaEn hace 1 minuto → false */ });
  it("una carga tomada hace más de MINUTOS_PARA_SOLTAR se suelta: el disparo anterior murió", () => { /* tomadaEn hace 6 minutos → true */ });
  it("sin sesión conocida no se manda nada", () => { /* usuarioActualId null → false */ });
});

describe("proximaAMandar", () => {
  it("manda la más vieja primero", () => { /* orden por creadaEn ascendente */ });
});

describe("esperandoDesdeAyer", () => {
  it("devuelve las que llevan más de 24 horas esperando", () => { /* el tope acordado */ });
  it("ignora una carga con fecha futura: el reloj del teléfono puede estar mal", () => { /* creadaEn mañana → no está */ });
});

describe("esperaAntesDeReintentar", () => {
  it("el primer reintento es casi inmediato", () => {});
  it("la espera crece con los intentos y tiene techo", () => { /* que 50 intentos no den días */ });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/core/colaOffline.test.ts`
Expected: FAIL, no existe el módulo.

- [ ] **Step 3: Implementar `lib/core/colaOffline.ts`**

Sólo funciones puras: no toca IndexedDB ni `fetch`. El comentario de cabecera dice por qué `401` es pasajero, que es lo único contraintuitivo del archivo.

`tomadaEn` es la marca que impide que dos disparos simultáneos manden lo mismo; se suelta a los `MINUTOS_PARA_SOLTAR` porque un service worker que se duerme en el medio dejaría la carga tomada para siempre.

La espera entre reintentos vive acá y no en el service worker: es una decisión, y las decisiones van donde se pueden probar.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/core/colaOffline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

---

## Task 3: La clave de idempotencia en el servidor

**Files:**
- Create: `lib/mantenimiento/claveDeCarga.ts`
- Test: `lib/mantenimiento/claveDeCarga.test.ts`

**Interfaces:**
- Consumes: la tabla `cargas_offline` de la tarea 1.
- Produces:
  - `type FilaDeClave = { clave: string; usuario_id: string; tipo: string; resuelto_en: string | null; numero: string | null; entidad_id: string | null }`
  - `decidirPorClave(fila: FilaDeClave | null, usuarioId: string): "seguir" | "ya-esta" | "en-duda" | "ajena"` — pura, testeable
  - `reservarClave(admin: SupabaseClient, datos: { clave: string; usuarioId: string; tipo: TipoDeCarga }): Promise<{ decision: ReturnType<typeof decidirPorClave>; fila: FilaDeClave | null }>`
  - `resolverClave(admin: SupabaseClient, clave: string, resultado: { numero: string; entidadId: string }): Promise<void>`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("decidirPorClave", () => {
  it("sin fila, la carga es nueva y se sigue", () => {
    expect(decidirPorClave(null, "ana")).toBe("seguir");
  });

  it("con fila resuelta se devuelve lo de antes, no se carga de nuevo", () => {
    // resuelto_en con fecha, numero "2796" → "ya-esta"
  });

  it("con fila sin resolver queda EN DUDA: pudo haberse escrito la fila en la planilla", () => {
    // resuelto_en null → "en-duda"
  });

  it("una clave de otro usuario no se toca", () => {
    // usuario_id "beto", sesión "ana" → "ajena"
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/claveDeCarga.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `lib/mantenimiento/claveDeCarga.ts`**

`reservarClave` intenta el `insert`; si choca con la primaria, lee la fila y llama a `decidirPorClave`. El insert va **antes** de tocar la planilla, y ése es el punto entero del archivo: dejarlo para después lo vuelve inútil.

El comentario de cabecera dice qué significa `"en-duda"` y por qué no se puede resolver solo: la fila puede estar en la planilla sin estar en la base, y desde acá no hay forma de saberlo sin leer la planilla entera.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/claveDeCarga.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

---

## Task 4: Las dos rutas aceptan la clave, y el aviso acepta su fecha

**Files:**
- Modify: `app/api/mantenimiento/avisos/route.ts`
- Modify: `app/api/mantenimiento/ordenes/route.ts`
- Modify: `lib/mantenimiento/avisos.ts`
- Test: `lib/mantenimiento/avisos.test.ts`

**Interfaces:**
- Consumes: `reservarClave`, `resolverClave`, `decidirPorClave` de la tarea 3.
- Produces: `fechaDelAviso(cuerpo: { fecha?: unknown }, hoy: string): string` en `lib/mantenimiento/avisos.ts`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("fechaDelAviso", () => {
  it("sin fecha en el cuerpo usa la de hoy, como hasta ahora", () => {
    expect(fechaDelAviso({}, "2026-10-19")).toBe("2026-10-19");
  });

  it("con la fecha del viernes la respeta, aunque entre el lunes", () => {
    expect(fechaDelAviso({ fecha: "2026-10-16" }, "2026-10-19")).toBe("2026-10-16");
  });

  it("una fecha que no es una fecha no entra: cae a hoy", () => {
    expect(fechaDelAviso({ fecha: "el viernes" }, "2026-10-19")).toBe("2026-10-19");
  });

  it("una fecha futura no entra: el reloj del teléfono puede estar mal", () => {
    expect(fechaDelAviso({ fecha: "2026-11-30" }, "2026-10-19")).toBe("2026-10-19");
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/avisos.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `fechaDelAviso` y usarla en la ruta**

En `app/api/mantenimiento/avisos/route.ts`, `fecha: hoyEnArgentina()` pasa a `fecha: fechaDelAviso(b, hoyEnArgentina())`. **Es el único ensanche de «la misma ruta de hoy» que este plan hace**, y el comentario lo dice: sin él, un aviso cargado el viernes que entra el lunes queda fechado el lunes, y de esa fecha salen el historial del equipo y el MTBF.

- [ ] **Step 4: Enganchar la clave en las dos rutas**

En las dos, apenas pasado el chequeo de permisos y **antes** de leer o escribir la planilla:

- Sin `clave` en el cuerpo, todo sigue exactamente como hoy. Es lo que mantiene la promesa de que con señal no cambia nada.
- Con `clave`: `reservarClave(...)`, y según la decisión — `"seguir"` continúa; `"ya-esta"` devuelve 200 con el número guardado, sin tocar la planilla; `"ajena"` devuelve 403; `"en-duda"` devuelve 409 con un texto que diga que esa carga pudo haber quedado escrita en la planilla y hay que mirarla antes de reintentar.
- Después del insert exitoso, `resolverClave(...)` con el número y el id.

El 409 es **definitivo** para la cola (tarea 2 lo clasifica así por no estar entre los pasajeros): reintentar solo volvería a dar 409.

- [ ] **Step 5: Verificar**

Run: `npx vitest run lib/mantenimiento/avisos.test.ts` → PASS
Run: `npx tsc --noEmit` → sin errores nuevos. **Si falla en archivos que no tocaste, mirar `git status` antes de arreglarlos**: puede ser el refactor en curso de otra sesión.

- [ ] **Step 6: Commit**

---

## Task 5: La cola y los catálogos en el teléfono

**Files:**
- Create: `lib/core/idb.ts`

**Interfaces:**
- Consumes: `CargaEnCola` de la tarea 2.
- Produces:
  - `abrirBase(): Promise<IDBDatabase>` — base `sdg`, almacenes `cola` (clave: `clave`) y `catalogos` (clave: `nombre`)
  - `guardarCarga(carga: CargaEnCola): Promise<void>`
  - `leerCola(): Promise<CargaEnCola[]>`
  - `actualizarCarga(clave: string, cambios: Partial<CargaEnCola>): Promise<void>`
  - `borrarCarga(clave: string): Promise<void>`
  - `guardarCatalogo(nombre: string, datos: unknown): Promise<void>`
  - `leerCatalogo<T>(nombre: string): Promise<T | null>`

- [ ] **Step 1: Implementar `lib/core/idb.ts`**

Envoltorio delgado sobre IndexedDB, sin librería y **sin ninguna decisión adentro**: todas viven en `colaOffline.ts`, que es lo que se puede probar. El comentario de cabecera dice por qué IndexedDB y no `localStorage` —`localStorage` no se puede leer desde un service worker, y es el service worker quien tiene que vaciar la cola con la app cerrada— para que nadie lo "simplifique" después.

Escrito en JavaScript que el service worker pueda importar además de la app.

**Ninguna función traga su propio error.** Si la base no abre, la promesa rechaza: quien llama tiene que poder decirle a la persona que no se guardó (tarea 6).

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

No lleva tests: no tiene decisiones, y `fake-indexeddb` sería una dependencia nueva para probar un envoltorio. Lo que sí se prueba de verdad es el vaciado completo, en un navegador real, en la tarea 9.

- [ ] **Step 3: Commit**

---

## Task 6: La pantalla que anda sin señal

**Files:**
- Create: `app/cargar/page.tsx`
- Create: `app/cargar/CargarClient.tsx`
- Create: `app/cargar/FormularioAvisoOffline.tsx`
- Create: `app/cargar/FormularioOTOffline.tsx`
- Modify: `proxy.ts`

**Interfaces:**
- Consumes: `lib/core/idb.ts` (tarea 5), `lib/core/colaOffline.ts` (tarea 2).
- Produces: la ruta `/cargar`, dibujada enteramente en el navegador.

- [ ] **Step 1: La página**

`app/cargar/page.tsx` **va fuera del grupo `(app)`** y es lo único que hace falta explicar en su comentario: `app/(app)/layout.tsx` es `async`, le pregunta a Supabase quién sos y hace `redirect("/login")`, así que una pantalla que tiene que dibujarse sin servidor no puede vivir ahí abajo. Es un componente de servidor que no consulta nada y devuelve `<CargarClient />`.

El acceso lo sigue resolviendo `proxy.ts` cuando hay señal; sin señal no hay servidor que consultar y la sirve el service worker desde el caché. Lo que se carga ahí no sale del teléfono hasta que haya una sesión válida, así que la pantalla no filtra nada: los catálogos que muestra ya los bajó alguien logueado en ese mismo teléfono.

- [ ] **Step 2: `CargarClient.tsx`**

Decide qué mostrar: los dos formularios, el estado de la conexión, y la cola. Lee los catálogos con `leerCatalogo` y, si hay señal, los refresca desde `/api/mantenimiento/equipos-y-sectores` y `/api/mantenimiento/operarios` y los guarda. Recuerda en el almacén `catalogos` quién es la sesión actual (id y nombre), que es lo que `puedeMandarse` necesita cuando no hay red para preguntarlo.

**Si IndexedDB no está disponible o rechaza** —Safari privado, almacenamiento lleno—, la pantalla lo dice y **deshabilita los dos formularios**. Lo que no puede pasar es que acepte una carga que no va a poder guardar. (Review Focus 4.)

- [ ] **Step 3: Los dos formularios**

Mismos campos que `NuevoAvisoModal.tsx` y `NuevaOTModal.tsx`, con `<Select>` de `components/Select.tsx` y los catálogos de IndexedDB.

**Los dos modales de hoy no se tocan y conviven con éstos**, y es una decisión de este plan, no un descuido: los de hoy viven dentro de pantallas que traen sus datos del servidor y los usan para más cosas que cargar. El spec deja anotado el riesgo —dos formularios para lo mismo se van separando— y la salida, si molesta, es que los modales pasen a usar estos componentes, no al revés.

Al enviar:

- Arman el cuerpo igual que los modales de hoy, más `clave` —un `crypto.randomUUID()` **por carga**, nunca derivado del contenido: dos avisos iguales el mismo día son dos avisos (Review Focus 5)— y `fecha` con el día de hoy en Argentina.
- Con señal, mandan directo a la ruta y muestran el número, como hoy.
- Sin señal, o si el envío falla con algo pasajero, `guardarCarga` y el cartel dice que **queda para mandarse y todavía no tiene número**. No puede parecer que se cargó.

- [ ] **Step 4: La cola a la vista**

En la misma pantalla: cuántas esperan, de cuándo es cada una, cuál falló y con qué texto —el de la ruta, sin traducir—, y de quién es si no es de la sesión actual. Botón para reintentar una parada y para borrarla con confirmación. Mientras no exista el correo, **ésta es la única forma que tienen doce de trece personas de enterarse de que algo salió mal**.

`grid-cols-1 sm:grid-cols-3` donde haga falta: se mira en un teléfono de 375 px, que es el único lugar donde esta pantalla importa.

- [ ] **Step 5: Dejar pasar `/cargar` sin romper nada**

Revisar el matcher de `proxy.ts`. `/cargar` tiene que seguir pidiendo sesión cuando hay señal; lo que no puede es quedar excluido del chequeo. **Al tocar ese matcher, usar `\\.` para los puntos:** un `.` suelto hizo que `/rrhhXpng` se saltara el chequeo de sesión, y se arregló el 18/10.

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit` → sin errores nuevos
Run: `npm run build` → compila (con `npm run dev` **parado**)
Run: `node scripts/revisar-responsive.mjs` → ROMPE 0

- [ ] **Step 7: Commit**

---

## Task 7: El service worker guarda la pantalla, la sirve sin señal y vacía la cola

**Files:**
- Modify: `public/sw.js`
- Modify: `lib/core/sw.test.ts`

**Interfaces:**
- Consumes: `lib/core/idb.ts` (tarea 5), `lib/core/colaOffline.ts` (tarea 2).
- Produces: nada que otra tarea use.

- [ ] **Step 1: Escribir los tests que fallan**

Mismo molde que ya usa `lib/core/sw.test.ts`: se lee el archivo, se evalúa contra un `self` falso y se disparan los eventos a mano. Se agregan dobles de `caches` y de la cola.

```ts
describe("install", () => {
  it("guarda /cargar y los archivos que esa página pide", () => { /* el HTML doble trae <script src>, se espera que esos URLs se cacheen */ });
});

describe("fetch", () => {
  it("una navegación que la red rechaza se contesta con /cargar guardado", () => { /* fetch que rechaza → responde el caché */ });
  it("una navegación que la red contesta pasa igual que hoy", () => { /* no toca el caché */ });
  it("sigue sin meterse con /api/ ni con /auth/", () => { /* las dos exclusiones de hoy siguen */ });
  it("guarda lo de /_next/static al pasarlo, porque esos nombres llevan hash", () => {});
});

describe("vaciado", () => {
  it("el evento sync manda la carga que corresponde", () => {});
  it("el push vacía la cola además de mostrar la notificación", () => {});
  it("dos disparos a la vez no mandan la misma carga dos veces", () => { /* Review Focus 1: la segunda la ve tomada */ });
  it("un fallo pasajero deja la carga para después y uno definitivo la para", () => {});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/core/sw.test.ts`
Expected: FAIL en los casos nuevos; **los de hoy tienen que seguir pasando**.

- [ ] **Step 3: Implementar**

En `public/sw.js`, **arriba de todo y sin tocar lo que ya hay**:

- `install`: abre el caché, pide `/cargar`, saca de ese HTML los `src` de `<script>` y los `href` de `<link rel="stylesheet">`, y guarda todo junto. Sin eso la página se guarda sin su JavaScript y sin señal queda en blanco.
- `fetch`: antes del `return` de hoy, si la navegación falla contra la red, contestar con `/cargar` del caché. Y guardar al pasar todo lo de `/_next/static/`, que lleva hash en el nombre y por lo tanto nunca queda viejo.
- `sync` y, dentro del `push` que ya existe, el vaciado.

**Las dos exclusiones de hoy —`/api/` y `/auth/`— no se tocan.** Están comentadas en el archivo con el porqué: las 14 descargas de Excel y el canje del `?code=` de los correos, por donde entra todo usuario nuevo. Un service worker ya registrado sigue sirviendo hasta que se actualiza, así que equivocarse ahí no se arregla con un deploy.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/core/sw.test.ts`
Expected: PASS, los nuevos y los viejos.

- [ ] **Step 5: Commit**

---

## Task 8: Al abrir la app, decir que había algo esperando

**Files:**
- Create: `components/CargasEsperando.tsx`
- Modify: `app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `esperandoDesdeAyer` (tarea 2), `leerCola` (tarea 5).

- [ ] **Step 1: El componente**

Cliente, por `useCargar` como el resto. Lee la cola al montar; si `esperandoDesdeAyer` devuelve algo, muestra una barra que diga cuántas y desde cuándo, con un enlace a `/cargar`. Si no, no dibuja nada. Dispara además un vaciado, porque abrir la app es el disparo que siempre funciona.

**Es la red de abajo de todo el diseño.** Si la prueba del iPhone de la tarea 9 sale mal, pasa a ser el mecanismo principal y hay que hacerla más visible.

- [ ] **Step 2: Montarlo**

En `app/(app)/layout.tsx`, al lado de `RegistrarServiceWorker` y `BarraInstalar`.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit` y `npm run build`

- [ ] **Step 4: Commit**

---

## Task 9: Probarlo donde importa

**Files:** ninguno. Es la tarea que decide si esto se puede dar por bueno.

- [ ] **Step 1: En Chrome de escritorio, con el modo sin conexión de las herramientas**

Abrir `/cargar` con señal, cortarla, recargar, cargar un aviso, volver la señal, y ver que entra una sola vez. Después repetir cortando la señal **sin haber abierto `/cargar` antes** en esa sesión: tiene que aparecer igual, que es el caso del pedido.

- [ ] **Step 2: Los dos casos que ningún test cubre**

En el mismo Chrome: cargar **dos avisos idénticos seguidos** sin señal y ver que al volver entran los dos, con dos números. Son dos fallas iguales, no un duplicado (Review Focus 5).

Y en una ventana privada, o con el almacenamiento del sitio bloqueado: abrir `/cargar` y ver que **dice que no puede guardar y no deja cargar**, en vez de aceptar algo que se va a perder (Review Focus 4).

- [ ] **Step 3: En un Android real**

Lo mismo, más: cerrar la app con una carga esperando, volver la conexión, y ver si entra sola por el `sync`.

- [ ] **Step 4: En un iPhone real, con la app en la pantalla de inicio**

Lo mismo, y después **la prueba que el spec marca como no demostrada**: con una carga esperando y la app cerrada, disparar el cron de avisos diarios y ver si el push despierta al service worker y la manda.

**Si eso no funciona, la fase sale igual.** Se anota en el spec que en iPhone el vaciado es sólo al abrir la app, y la tarea 8 se vuelve el mecanismo principal en vez de la red de abajo.

- [ ] **Step 5: Escribir lo que se midió**

En el spec, una sección «Cómo terminó la fase 4» con lo que se probó, en qué aparato, y qué quedó sin probar. Es lo que hace que esto se pueda retomar en seis meses.

- [ ] **Step 6: Verificación final y push**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
```

`revisar-arbol-commiteado` **solo, nunca en una tubería**: el código de salida de un `| tail` es el del `tail` y siempre es 0.

# Mensajería interna — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que lo que se habla sobre una OT, un requerimiento o una condición insegura quede pegado a ese registro, y que a quien se menciona le llegue un correo.

**Architecture:** Una tabla de mensajes que apunta a su registro por `(entidad_tipo, entidad_id)` sin foreign key, y una de menciones que además lleva la marca de leído. Lo que decide —a quién le llega, qué dice el correo— vive en funciones puras de `lib/core/mensajes.ts` con tests. El puente entre un tipo de entidad y «quién puede ver un registro de ese tipo» es un registro de una línea por tipo en `lib/mensajes/entidades.ts`, y esa misma función se usa para dos cosas: dejar entrar a un hilo y armar la lista de a quién se puede mencionar. El aviso sale por **correo** reusando `lib/core/correo.ts`, que ya está probado contra el Apps Script real.

**Tech Stack:** Next.js 16 (App Router), Supabase/PostgREST, vitest, el Apps Script de correo que ya existe.

**Spec:** [docs/superpowers/specs/2026-11-11-mensajeria-interna-design.md](../specs/2026-11-11-mensajeria-interna-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, textos de pantalla y de commit. Conventional commits.
- **Nunca `git add -A`.** Hay otras sesiones en el mismo árbol: `git commit --only <rutas> -F -`.
- **Ver el registro = ver el hilo = escribir en el hilo.** No hay permiso nuevo y **no hay mensajes privados**: la pantalla tiene que decirlo. Esto va contra el molde de `ordenes_trabajo_notas`, que separa ver de editar, y el spec explica por qué.
- **Sólo se menciona a quien puede ver el registro.** El correo lleva el texto adentro.
- **Un mensaje no se edita ni se borra.** Lo único que cambia después es la marca de leído, que es de cada uno.
- **El aviso sale por correo y no por push.** No se agrega un quinto emisor instantáneo; el portón de `lib/core/avisoAlInstante.ts` no se toca.
- **Sin mención no se interrumpe a nadie.** Un mensaje sin destinatario queda en el registro y no manda nada.
- Un desplegable se escribe `<Select>` de `components/Select.tsx`, nunca `<select>`.
- `grid-cols-1 sm:grid-cols-3`; el ancho útil es 343 px. Un ancho no va suelto al lado de `.input` — va en un `div` que lo envuelva.
- Las migraciones **las aplica una persona**. Un agente no corre DDL.
- Verificación: `npm test`, `npx tsc --noEmit`, `npm run build` (dev parado), `node scripts/revisar-arbol-commiteado.mjs`, `node scripts/revisar-responsive.mjs`, `npm run mapa-de-apis`.

## Review Focus

1. **El correo no está configurado en producción.** `enviarCorreo()` devuelve `"sin-configurar"` en silencio y sin loguear, así que la mensajería mandaría cero correos sin que nadie se entere — el anti-objetivo número uno. La pantalla lo dice **antes** de escribir. Tareas 3 y 4.
2. **Mencionar a alguien que no puede ver el registro.** El correo lleva el texto, así que es una filtración de un módulo cerrado, y el enlace lo rebota al inicio. La lista se arma filtrada (tarea 3) **y** la ruta lo vuelve a comprobar (tarea 3, paso 4): la lista del navegador puede estar vieja.
3. **El registro ya no existe** —las sincronizaciones borran de verdad desde el 18/10/2026— y el hilo queda huérfano: se ve igual, para los mismos que ven registros de ese tipo, y la pantalla lo dice. Tareas 2 y 3.
4. **Mencionarse a uno mismo**: no se manda correo a quien escribió. Tarea 2.
5. **Un texto largo o con saltos de línea** en el asunto del correo: es una cabecera. Tarea 2, con la función que ya resolvió esto para la carga sin señal.

---

## Task 1: La migración

**Files:**
- Create: `supabase/migrations/<timestamp>_mensajes_pegados_a_su_registro.sql` (con `npm run migracion "mensajes pegados a su registro"`)

**Interfaces:**
- Produces: `mensajes (id, entidad_tipo, entidad_id, texto, creado_por, creado_en)` y `mensajes_menciones (mensaje_id, usuario_id, leido_en)`.

- [ ] **Step 1: Escribir la migración**

`mensajes`: `entidad_tipo text not null check (entidad_tipo in ('orden_trabajo','requerimiento','condicion_insegura'))`, `entidad_id uuid not null`, `texto text not null`, `creado_por uuid references usuarios(id)`, `creado_en timestamptz not null default now()`.

`mensajes_menciones`: `mensaje_id uuid not null references mensajes(id) on delete cascade`, `usuario_id uuid not null references usuarios(id) on delete cascade`, `leido_en timestamptz`, con la primaria en `(mensaje_id, usuario_id)` — mencionar dos veces a la misma persona en un mensaje es una sola mención.

El encabezado explica **por qué no hay foreign key a `entidad_id`**: apunta a tres tablas distintas según `entidad_tipo`, igual que `cargas_offline.entidad_id` y `auditoria`. Y dice el costo que eso trae, que es el hilo huérfano.

Índices: `mensajes (entidad_tipo, entidad_id, creado_en desc)` —que es exactamente la consulta de la pantalla— y `mensajes_menciones (usuario_id, leido_en)` para la bandeja.

- [ ] **Step 2: Las policies, que son la parte que no se puede corregir después**

RLS prendido en las dos. **Sin policy de update ni de delete en `mensajes`**: un mensaje ya mandó un correo que no se desmanda, así que borrarlo deja a la otra persona con un texto que en el sistema no existe. Esto **no** copia a `ordenes_trabajo_notas`, que sí deja borrar la propia; el porqué va escrito en el encabezado, porque el próximo lector va a ver el precedente al lado.

`mensajes_menciones` sí lleva update, y **sólo de la propia fila**: marcar como leído es de cada uno.

De lectura, policy para el autenticado y nada más: **quien decide si alguien ve un hilo es la ruta**, porque el permiso depende del registro al que apunta y eso RLS no lo sabe. Dejarlo escrito, para que no se lea como un olvido.

Una policy nueva llama a su función **envuelta**: `using ((select ...))`, nunca pelada.

- [ ] **Step 3: Commit y pedir que se aplique**

Decirle al usuario que la aplique y **seguir con las tareas 2 y 3**, cuyos tests no la necesitan.

- [ ] **Step 4: Verificar que quedó aplicada**

Script de sólo lectura con el `SUPABASE_SERVICE_ROLE_KEY`, mirando el **status HTTP** (404 contra 200): un `.select("*", { head: true })` sin `count` esconde el error y da por buena una tabla que no existe.

---

## Task 2: A quién le llega y qué dice

**Files:**
- Create: `lib/core/mensajes.ts`
- Test: `lib/core/mensajes.test.ts`
- Modify: `lib/mantenimiento/correoDeLaCarga.ts` (sacar `paraUnAsunto` a `lib/core/`)

**Interfaces:**
- Produces:
  - `type TipoDeEntidad = "orden_trabajo" | "requerimiento" | "condicion_insegura"`
  - `interface Destinatario { usuarioId: string; email: string | null; puedeVerElRegistro: boolean }`
  - `aQuienLeLlega(mencionados: Destinatario[], autorId: string): Destinatario[]`
  - `correoPorMencion(m: { autor: string; queEs: string; texto: string; dondeVerlo: string; hiloId: string }): { asunto: string; cuerpo: string }`
  - `tituloDelHilo(queEs: string, existeElRegistro: boolean): string`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("aQuienLeLlega", () => {
  it("no le manda nada a quien escribió el mensaje", () => {
    // el autor está entre los mencionados → no sale en el resultado
  });

  it("no le manda nada a quien no puede ver el registro", () => {
    // puedeVerElRegistro: false → afuera. El correo lleva el texto del
    // mensaje, así que mandárselo le filtraría un módulo que no tiene, y el
    // enlace lo rebotaría al inicio.
  });

  it("no le manda nada a quien no tiene correo cargado", () => {
    // email: null → afuera, sin romper
  });

  it("sin menciones no le llega a nadie, y eso no es un error", () => {
    expect(aQuienLeLlega([], "ana")).toEqual([]);
  });
});

describe("correoPorMencion", () => {
  it("dice quién, sobre qué, y qué se escribió", () => {
    // el cuerpo contiene el autor, el `queEs` y el texto tal cual
  });

  it("el asunto no lleva saltos de línea ni crece sin límite", () => {
    // un texto con \n y 500 caracteres → asunto de una línea y acotado
  });

  it("el asunto lleva el id del hilo", () => {
    // para que una respuesta se pueda enganchar el día que se quiera leerla;
    // agregarlo después no sirve para los correos ya mandados
  });

  it("el cuerpo dice que no se responde ahí", () => {
    // va a pasar igual: la respuesta cae en una casilla personal y se pierde
  });

  it("un texto con HTML o comillas viaja como texto", () => {
    // '<b>x</b> "y"' aparece tal cual en el cuerpo
  });
});

describe("tituloDelHilo", () => {
  it("cuando el registro ya no está lo dice, en vez de mostrar un hilo mudo", () => {
    expect(tituloDelHilo("OT 2983", false)).toContain("ya no está");
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/core/mensajes.test.ts` → FAIL, no existe el módulo.

- [ ] **Step 3: Implementar `lib/core/mensajes.ts`**

Puro: no toca la base, ni `fetch`, ni `process.env`.

Para el asunto, **reusar el recorte que ya existe** en `lib/mantenimiento/correoDeLaCarga.ts` (`paraUnAsunto`, con su `LARGO_DEL_ASUNTO`): se escribió para exactamente este problema —un `<textarea>` sin tope que termina en una cabecera— y tenerlo dos veces es cómo se separan. Sacarlo a `lib/core/` y que los dos lo importen, actualizando los tests de aquél.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/core/mensajes.test.ts lib/mantenimiento/correoDeLaCarga.test.ts` → PASS los dos.

- [ ] **Step 5: Commit**

---

## Task 3: El registro de entidades y las rutas

**Files:**
- Create: `lib/mensajes/entidades.ts`
- Create: `app/api/mensajes/route.ts`
- Create: `app/api/mensajes/destinatarios/route.ts`
- Create: `app/api/mensajes/mios/route.ts`
- Test: `lib/mensajes/entidades.test.ts`

**Interfaces:**
- Consumes: todo lo de la tarea 2; `enviarCorreo` y `estaConfigurado` de `lib/core/correo`.
- Produces:
  - `ENTIDADES: Record<TipoDeEntidad, { tabla: string; comoSeLlama: string; puedeVerlo: (sb, userId: string) => Promise<boolean>; ruta: (id: string) => string }>`
  - `quienesLoVen(sb, tipo: TipoDeEntidad): Promise<string[]>`
  - `GET /api/mensajes?tipo=…&id=…` → el hilo
  - `GET /api/mensajes/destinatarios?tipo=…` → a quién se puede mencionar, y si el correo está configurado
  - `POST /api/mensajes` → `{ tipo, id, texto, menciones: string[] }`
  - `GET /api/mensajes/mios` → mis menciones sin leer

- [ ] **Step 1: El registro, con su test**

```ts
it("cada tipo del check de la migración está en el registro", () => {
  // si alguien agrega un tipo a la migración y no acá, la ruta no sabría a
  // quién dejar entrar
});

it("un requerimiento lo ve cualquiera con sesión, y eso no es un error", () => {
  // compras_requerimientos tiene el SELECT en `true` desde la migración 018,
  // con su razón escrita: «el circuito de compras es transversal a toda la
  // empresa». El hilo sigue al registro, no al módulo.
});
```

`puedeVerlo` es **«puede ver este registro»** y no «tiene el módulo», y por eso no es siempre una función de nivel: para la OT es `nivelMantenimientoDe(...) !== null`, para la condición insegura `nivelSyhDe(...) !== null`, y para el requerimiento es que haya sesión. Las trece funciones de nivel del repo comparten firma —`nivelXDe(supabase, userId): Promise<NivelAcceso | null>`—, así que agregar una entidad de las que sí dependen del módulo es **una línea**. Eso es lo que hace cierto el «a todo el sistema» del spec.

`quienesLoVen` recorre los usuarios activos preguntándole a `puedeVerlo`. Con 14 usuarios son 14 llamadas y alcanza; va el comentario que diga a partir de cuántos deja de alcanzar, para que el próximo no tenga que medirlo de nuevo.

- [ ] **Step 2: `GET /api/mensajes`**

Pide sesión, resuelve el tipo contra el registro, **comprueba `puedeVerlo`** y recién ahí lee. Con el cliente admin y el permiso ya comprobado, por el mismo motivo que la ruta de notas: con el de la sesión el nombre del autor vuelve `null` para todos menos uno mismo, y un mensaje sin autor no sirve.

Si el registro ya no existe, contesta el hilo igual con la marca que `tituloDelHilo` usa. **El permiso en ese caso sigue siendo `puedeVerlo` del tipo** —no se puede preguntar por un registro que no está—, que es lo que el spec decidió.

- [ ] **Step 3: `GET /api/mensajes/destinatarios`**

Devuelve `quienesLoVen(tipo)` con nombre y correo, **y `correoConfigurado: estaConfigurado()`**. Lo segundo es lo que le permite a la pantalla avisar antes de que alguien escriba creyendo que avisó.

- [ ] **Step 4: `POST /api/mensajes`**

Comprueba `puedeVerlo` para quien escribe —ver y escribir son lo mismo— y **vuelve a comprobarlo para cada mencionado**: la lista del navegador puede estar vieja, y es la segunda cinta del punto 2 del Review Focus.

Guarda el mensaje, guarda las menciones, y recién después manda los correos — **nunca al revés**: un fallo del correo no puede impedir que el mensaje quede.

El envío va en `after()`, como el correo de la carga rechazada: corre después de la respuesta, así que no le suma los segundos del Apps Script a quien aprieta «Enviar».

**Si `estaConfigurado()` da falso, no se intenta.** El mensaje se guarda igual y la respuesta lo dice, para que la pantalla no afirme lo que no pasó.

- [ ] **Step 5: `GET /api/mensajes/mios`**

Las menciones de quien pregunta, sin leer, más nuevas primero. **Con `traerTodo()`**: es una tabla que crece.

- [ ] **Step 6: Verificar**

Run: `npx vitest run lib/mensajes/entidades.test.ts`, `npx tsc --noEmit`, `npm run build`, y `npm run mapa-de-apis` — las cuatro rutas nuevas tienen que aparecer y **ninguna `ABIERTA`**.

- [ ] **Step 7: Commit**

---

## Task 4: El hilo en la pantalla

**Files:**
- Create: `components/HiloDeMensajes.tsx`
- Modify: la pantalla de la OT, para montarlo

**Interfaces:**
- Consumes: las cuatro rutas de la tarea 3.
- Produces: `<HiloDeMensajes tipo={…} id={…} />`, que es lo único que hay que poner en una pantalla nueva.

- [ ] **Step 1: El componente**

Lista los mensajes, y debajo el campo para escribir con el selector de a quién mencionar. El selector es **`<Select>`** —`components/Select.tsx` decide solo si va nativo o con buscador según cuántas opciones le lleguen— y se alimenta de `destinatarios`, **no de todos los usuarios**.

**Dice a quién le va a llegar antes de mandar, no después.** Es el anti-objetivo principal del spec. Y cubre los dos casos en que no va a llegar: si `correoConfigurado` es falso, la mención queda deshabilitada **con el motivo a la vista**; y la lista corta se explica —«sólo se puede mencionar a quien pueda ver este registro»— en vez de dejar que alguien busque un nombre que no está.

Después de mandar, lo que muestra sale de la **respuesta** y no de lo que se pidió: si un correo no salió, lo dice.

Y dice, donde se ve, que **el hilo lo ve cualquiera que pueda ver el registro**. No hay mensajes privados y eso tiene que estar en la pantalla, no sólo en el documento.

- [ ] **Step 2: Montarlo en la OT**

En la pantalla de la orden de trabajo, **al lado de las notas y sin mezclarse**: una nota dice «por qué no se hizo» y alimenta la columna X de la planilla; un mensaje no. Los dos rótulos tienen que dejar clara la diferencia.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`, `npm run build`, `node scripts/revisar-responsive.mjs` → ROMPE 0.

- [ ] **Step 4: Commit**

---

## Task 5: Las otras dos pantallas, y la tercera que el permiso obliga

**Files:**
- Modify: la pantalla del requerimiento de compra en `compras`, la de la condición insegura, y **`app/(app)/mis-pedidos`**

- [ ] **Step 1: Montar el componente en las tres**

Es poner `<HiloDeMensajes>` con su tipo. Si hace falta algo más que eso, el registro de la tarea 3 no quedó bien y conviene arreglar eso en vez de parchear la pantalla.

`mis-pedidos` está en la lista **porque un requerimiento lo ven los catorce y el módulo Compras lo tienen ocho**: dejar el hilo sólo en la pantalla del módulo haría que seis de los que pueden escribir no tengan dónde.

- [ ] **Step 2: Verificar y commitear**

Run: `npx tsc --noEmit`, `npm run build`, `node scripts/revisar-responsive.mjs`.

---

## Task 6: Dónde veo los míos

**Files:**
- Modify: `app/(app)/mis-avisos/` o una pantalla propia — **decisión de quien construya**, después de mirar «Mis avisos» y «Mis pedidos», que ya resolvieron esto para otra cosa.

- [ ] **Step 1: La bandeja**

Mis menciones sin leer, con el registro al que pertenecen y un enlace que lleva ahí. Marcar como leído al abrir el hilo.

El encabezado de `mis-avisos/page.tsx` explica por qué esa pantalla vive fuera del módulo: «de 14 usuarios 10 no tienen el módulo». Vale igual acá y es el motivo de que esto no pueda colgar de un módulo.

- [ ] **Step 2: Verificar y commitear**

---

## Task 7: Probarlo donde importa

- [ ] **Step 1: Un mensaje de punta a punta**

Escribir un mensaje en una OT mencionando a alguien, y confirmar que **llega el correo** y que lleva el texto, el enlace y el id del hilo en el asunto.

**Esto depende de que `SDG_CORREO_URL` y `SDG_CORREO_SECRET` estén en el proyecto `sistema-integral` de Vercel**, no sólo en `.env.local`. Si no están, lo que hay que comprobar en su lugar es que la pantalla lo diga: ése es el punto 1 del Review Focus y es el que no se puede dejar sin mirar.

- [ ] **Step 2: Los cuatro casos que ningún test cubre**

Que a alguien **sin acceso a Mantenimiento** no se lo pueda ni elegir en la lista de una OT. Abrir un hilo de un registro borrado. Escribir un mensaje **sin mencionar a nadie**: tiene que quedar y no mandar ningún correo. Y entrar con alguien que **no edita** Seguridad e Higiene pero sí la ve: tiene que poder escribir, que es la decisión que se tomó contra el precedente de las notas.

- [ ] **Step 3: Escribir lo que se midió**

Una sección «Cómo terminó» en el spec, y la fila en la tabla de CLAUDE.md.

- [ ] **Step 4: Verificación final y push**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
npm run mapa-de-apis
```

`revisar-arbol-commiteado` **solo, nunca en una tubería**: el código de salida de un `| tail` es el del `tail`.

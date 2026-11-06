# El correo de la carga que no entró — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que quien cargó un aviso o una OT en la planta reciba un correo cuando esa carga, que el teléfono mandó solo con la app cerrada, fue rechazada.

**Architecture:** La carga viaja diciendo de dónde salió —en una cabecera HTTP, no en el cuerpo, para no tocar nada de lo que las rutas validan—; la ruta, al rechazar definitivamente una carga con `clave` que vino del fondo, arma el correo con una función pura y lo manda llamando a un Apps Script con un secreto compartido. Si el correo falla o no está configurado, la respuesta de la ruta no cambia en nada.

**Tech Stack:** Next.js 16 (App Router), TypeScript, vitest, Apps Script (`MailApp`), `public/sw.js` a mano.

**Spec:** [docs/superpowers/specs/2026-10-19-correo-de-la-carga-que-no-entro-design.md](../specs/2026-10-19-correo-de-la-carga-que-no-entro-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, el texto del correo y los mensajes de commit. Conventional commits.
- Los comentarios explican **por qué**, no qué, y **tienen que ser verdad**. En el plan anterior se rechazaron más de doce por afirmar algo que el código no hacía.
- **Nunca `git add -A`.** Hay otras sesiones en el mismo árbol: `git commit --only <rutas> -F -`.
- **Que el correo no salga nunca puede cambiar la respuesta de la ruta ni el estado de una carga.**
- **Sin las variables configuradas, todo se comporta exactamente como hoy** y no se intenta mandar nada.
- El correo sale **sólo** cuando la carga la mandó el teléfono con la app cerrada (`push` o `sync`), nunca desde la pantalla.
- Las dos exclusiones del handler de `fetch` de `public/sw.js` —`/api/` y `/auth/`— no se tocan.
- Verificación: `npm test`, `npx tsc --noEmit`, `npm run build` (con el dev parado), `node scripts/revisar-arbol-commiteado.mjs`.

## Review Focus

1. **Una carga guardada antes de este cambio** no trae la marca de disparo: no manda correo y no rompe nada. Tarea 2.
2. **Un usuario sin correo en `usuarios`**: no hay a quién mandarle, y el rechazo tiene que salir igual. Lo implementa la tarea 4 y **lo comprueba la tarea 5**: las rutas no tienen tests en este repo.
3. **El Apps Script que tarda o no contesta**: no puede demorar el rechazo que el service worker está esperando. Lo implementa la tarea 3 y **lo comprueba la tarea 5**.
4. **Un `error` de la ruta larguísimo, con HTML o con comillas**: el correo lo muestra como texto y no arma nada raro. Tarea 2.
5. **Las variables sin configurar**: no se intenta mandar, no se loguea un error por cada rechazo, y nada cambia. Tarea 3, con test — es lo único que garantiza que el día del deploy no cambie nada en producción.

---

## Task 1: La carga dice de dónde salió

**Files:**
- Modify: `public/sw.js`
- Modify: `app/cargar/envio.tsx`
- Test: `lib/core/sw.test.ts`

**Interfaces:**
- Produces: la cabecera **`X-SdG-Disparo`**, con los valores `"fondo"` y `"pantalla"`, en el POST a las dos rutas de alta.

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/core/sw.test.ts`, con el molde que ya existe (lee `public/sw.js`, lo evalúa contra un `self` falso y dispara los eventos a mano):

```ts
it("una carga que sale por el push viaja marcada como del fondo", () => {
  // disparar `push` con una carga en la cola → el fetch doble recibe
  // headers["X-SdG-Disparo"] === "fondo"
});
it("una carga que sale por el sync también es del fondo", () => {});
it("una carga que sale por el message de la pantalla NO es del fondo", () => {
  // headers["X-SdG-Disparo"] === "pantalla"
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/core/sw.test.ts`
Expected: FAIL en los tres nuevos; **los 63 viejos tienen que seguir pasando**.

- [ ] **Step 3: Llevar el dato hasta el `fetch`**

En `public/sw.js` el origen del disparo ya está distinguido: son tres handlers. Hoy los tres llaman a `loQueHaceUnDisparo()`, que llama a `vaciarLaCola()`, que llama a `mandarALaRuta(tipo, cuerpo)`. Hay que pasar el dato por esa cadena hasta la cabecera.

**Va en una cabecera y no en el cuerpo, y es una decisión de este plan:** el cuerpo es lo que las dos rutas validan, y la promesa de que «sin `clave` nada cambia» se sostiene sobre que ese cuerpo no se toque. Una cabecera no entra en ninguna validación ni en ningún `insert`.

En `app/cargar/envio.tsx`, `mandarALaRuta` manda siempre `"pantalla"`: todo lo que sale de ahí es con alguien mirando.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/core/sw.test.ts`
Expected: PASS, los nuevos y los viejos.

- [ ] **Step 5: Commit**

---

## Task 2: Qué correo corresponde, y cuál no

**Files:**
- Create: `lib/mantenimiento/correoDeLaCarga.ts`
- Test: `lib/mantenimiento/correoDeLaCarga.test.ts`

**Interfaces:**
- Produces:
  - `interface RechazoDeCarga { delFondo: boolean; status: number; error: string; enDuda: boolean; tipo: "aviso" | "orden"; descripcion: string; sector: string | null; fecha: string }`
  - `correoPorElRechazo(rechazo: RechazoDeCarga): { asunto: string; cuerpo: string } | null`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("correoPorElRechazo", () => {
  it("no manda nada si la carga salió desde la pantalla: la persona está mirando el cartel", () => {
    // delFondo: false → null
  });

  it("no manda nada si el rechazo no es definitivo", () => {
    // status 502 y 401 → null, aunque delFondo sea true
  });

  it("un rechazo claro lleva qué carga era, el motivo sin traducir, y dónde quedó", () => {
    // status 400, error "Contá qué pasa." →
    // asunto nombra el tipo; el cuerpo contiene la descripción, el sector,
    // el motivo textual, y la palabra "Cargar"
  });

  it("el caso en duda lleva OTRO asunto y manda a mirar la planilla", () => {
    // enDuda: true → asunto distinto del anterior, y el cuerpo nombra la planilla
  });

  it("el caso en duda NUNCA dice que no se pudo cargar, porque quizás se cargó", () => {
    // el cuerpo no contiene "no se pudo"
  });

  it("no promete ningún enlace a la carga: vive en el IndexedDB de ese teléfono", () => {
    // el cuerpo no contiene "http" ni "/cargar"
  });

  it("un motivo con HTML o comillas viaja como texto y no arma nada", () => {
    // error: '<b>roto</b> "x"' → aparece tal cual en el cuerpo
  });

  it("una carga sin la marca de disparo no manda nada", () => {
    // delFondo: false por defecto cuando el dato no vino
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/correoDeLaCarga.test.ts`
Expected: FAIL, no existe el módulo.

- [ ] **Step 3: Implementar `correoDeLaCarga.ts`**

Pura: no toca la base, ni `fetch`, ni `process.env`. Devuelve `null` cuando no corresponde mandar, que es la mayoría de las veces.

Para «definitivo» usa el mismo criterio que la cola —400, 403 y 409— y el comentario dice de dónde sale, nombrando `clasificarFallo` de `public/cola/colaOffline.js`, para que nadie los desincronice sin enterarse.

Los textos son los del spec. El del caso en duda tiene que decir que hay que mirar la planilla **antes** de cargar de nuevo, que es lo mismo que ya dice la ruta en pantalla.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/correoDeLaCarga.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

---

## Task 3: Mandar el correo

**Files:**
- Create: `lib/core/correo.ts`
- Create: `docs/sdg-correo-apps-script.gs`
- Modify: `docs/VARIABLES-VERCEL.md`

**Interfaces:**
- Produces: `enviarCorreo(mensaje: { para: string; asunto: string; cuerpo: string }): Promise<"enviado" | "sin-configurar" | "fallo">`

- [ ] **Step 1: Implementar `lib/core/correo.ts`**

Mismo molde que `lib/core/webpush.ts`, que es el hermano de esto: **devuelve qué pasó en vez de lanzar**, para que quien llama decida y nunca se le caiga encima.

- Sin `SDG_CORREO_URL` o sin `SDG_CORREO_SECRET` devuelve `"sin-configurar"` **sin intentar nada y sin loguear**: entre el deploy y el día que alguien publique el script va a pasar tiempo, y un error por cada rechazo sería ruido diario (Review Focus 5).
- El `fetch` lleva un **tope de espera corto** —`AbortSignal.timeout`— porque del otro lado hay un servicio que no es rápido y del lado de acá hay un rechazo esperando (Review Focus 3). El tope va como constante con nombre.
- Un fallo se loguea con `console.error` y **lo que contestó el Apps Script, sin traducir**, y devuelve `"fallo"`.

El comentario de cabecera dice **por qué un `console.error` alcanza acá**, que es una excepción deliberada a una regla del repo: un correo que no sale no crea ninguna divergencia —la carga sigue parada, visible en `/cargar` y contada por la barra—, y por diseño no hay nadie mirando cuando esto pasa. El spec lo explica; el archivo tiene que repetirlo, porque es ahí donde alguien se va a preguntar por qué.

- [ ] **Step 1b: El único test de este archivo**

`lib/core/correo.test.ts`, un solo caso, y es el que protege el día del deploy:

```ts
it("sin las variables configuradas no intenta nada y no loguea", async () => {
  // sin SDG_CORREO_URL ni SDG_CORREO_SECRET:
  // devuelve "sin-configurar", el `fetch` doble no se llamó,
  // y `console.error` tampoco
});
```

El resto del archivo no lleva tests: es una llamada HTTP sin decisiones, igual que `enviarPush`.

- [ ] **Step 2: Escribir el Apps Script**

`docs/sdg-correo-apps-script.gs`, con el molde de `docs/facturacion-correo-apps-script.gs` —encabezado que explica el porqué, e instrucciones de instalación paso a paso—, pero **en la dirección contraria**: éste se publica como aplicación web y lo llama el SdG.

Lo que no puede faltar:

- **Rechaza todo pedido que no traiga el secreto**, antes de mirar nada más.
- **Sólo manda a direcciones de los dominios permitidos**, que son una propiedad del script y no una lista incrustada —el grupo tiene Polcecal y Polysan—. Sin esto, una URL filtrada es un relay para mandar correo desde la empresa, y es la única protección que no la da el secreto.
- Falla **diciendo qué pasó**, nunca en silencio.
- Las instrucciones dicen que se publica **desde una casilla del sistema y no desde la cuenta de una persona**, porque el dueño del proyecto es el remitente que la gente va a ver y a donde van a ir las respuestas.

- [ ] **Step 3: Documentar las variables**

En `docs/VARIABLES-VERCEL.md`, con el estilo de las que ya están: `SDG_CORREO_URL` (la url de la aplicación web publicada) y `SDG_CORREO_SECRET` (lo inventa quien instala, y el mismo valor va en las propiedades del script).

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` → sin errores nuevos.
Run: `npm run build` → compila. **Mirá que `lib/core/correo.ts` no termine en el bundle del cliente**: en este repo un import transitivo metió `web-push` en el cliente y rompió el build sin que `tsc` ni los tests lo vieran.

- [ ] **Step 5: Commit**

---

## Task 4: Engancharlo en las dos rutas

**Files:**
- Modify: `app/api/mantenimiento/avisos/route.ts`
- Modify: `app/api/mantenimiento/ordenes/route.ts`

**Interfaces:**
- Consumes: `correoPorElRechazo` (tarea 2), `enviarCorreo` (tarea 3), la cabecera `X-SdG-Disparo` (tarea 1).

- [ ] **Step 1: Enganchar**

En los dos puntos donde la ruta devuelve un rechazo definitivo de una carga que trajo `clave` —el 400 de validación, el 403 de permisos, y los 409 de `respuestaDeLaReserva`—, antes de devolver:

1. Leer la cabecera. Sin ella, o con `"pantalla"`, no se hace nada más.
2. Buscar el correo de quien está logueado. La ruta de OT **ya lo hace** para la planilla (`quienPide`, con el cliente admin, porque `usuarios` sólo deja leer la fila propia salvo admin); la de avisos no, y va a necesitarlo.
3. `correoPorElRechazo(...)`, y si devuelve algo, `enviarCorreo(...)`.

**Dentro de un `try/catch` que no relanza, y sin cambiar nada de lo que la ruta devuelve.** Es la misma regla que ya gobierna `anotarLaClave` en esas dos rutas y por el mismo motivo: la respuesta que la ruta le debe a la persona es sobre su carga.

**Si el usuario no tiene correo cargado**, no hay a quién mandarle: no se intenta y el rechazo sale igual (Review Focus 2).

- [ ] **Step 2: Verificar que no cambió nada de lo de antes**

Esto es lo que más importa de la tarea. Comprobá y dejá en el reporte **en qué línea se decide**, para los dos casos:

- un cuerpo **sin `clave`** no toca nada nuevo;
- un cuerpo **con `clave` pero sin la cabecera**, tampoco.

Run: `npm test` → los 3.866 siguen pasando (el rojo de `lib/asistente/consulta.test.ts` es viejo y ajeno).
Run: `npx tsc --noEmit` y `npm run build`.

- [ ] **Step 3: Commit**

---

## Task 5: Probarlo de punta a punta

**Files:** ninguno, salvo el spec al final.

Esta tarea **depende de que una persona publique el Apps Script** y ponga las dos variables. Hasta entonces no se puede correr.

- [ ] **Step 1: Con las variables puestas en `.env.local`, mandarse un correo a uno mismo**

Un script de una vez en el scratchpad que llame a `enviarCorreo` con un asunto y un cuerpo de prueba. Confirma la url, el secreto, el dominio permitido y el remitente, que son las cuatro cosas que sólo se ven del otro lado.

- [ ] **Step 2: El camino entero, en un teléfono**

Cargar un aviso sin señal **dejando la descripción vacía no se puede** —el formulario no deja—, así que el rechazo hay que provocarlo de otra forma: cargar una OT sin señal a la que le falte algo que la ruta exige, o quitarse el permiso de edición en Mantenimiento un rato. Después: cerrar la app, esperar el disparo, y ver si llega el correo.

**Lo que hay que confirmar es lo que ningún test puede:** que con la app cerrada llega, y que abriendo la app y mandando desde la pantalla **no** llega.

- [ ] **Step 3: Escribir lo que se midió**

Una sección «Cómo terminó» en el spec: qué se probó, con qué aparato, y qué quedó sin probar.

- [ ] **Step 4: Verificación final y push**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
```

`revisar-arbol-commiteado` **solo, nunca en una tubería**: el código de salida de un `| tail` es el del `tail`, y siempre es 0.

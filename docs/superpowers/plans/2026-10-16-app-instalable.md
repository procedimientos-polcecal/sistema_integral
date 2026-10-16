# App instalable — Plan de implementación (fase 1)

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea.
> Los pasos usan casilla (`- [ ]`).

**Objetivo:** que el SdG se pueda instalar en la pantalla de inicio de un
teléfono y que las pantallas que hoy no entran en 375 px entren.

**Arquitectura:** un `app/manifest.ts` (ruta de metadata de Next 16) más íconos
generados del logo; al service worker que ya existe se le agrega un `fetch` de
paso —sin el cual Chrome no ofrece instalar— y se le saca el destino cableado
del click. La detección de plataforma es una función pura en `lib/core/`, así
que la pantalla de instalación no tiene lógica propia. Las correcciones de
pantalla son CSS, y un script las vuelve a buscar.

**Stack:** Next.js 16 (App Router), Tailwind, vitest, `sharp` como devDependency.

**Spec:** [docs/superpowers/specs/2026-10-16-app-instalable-design.md](../specs/2026-10-16-app-instalable-design.md)

## Restricciones globales

- **Todo en castellano**: nombres, comentarios, textos de pantalla y mensajes de commit.
- Conventional commits; el cuerpo explica **por qué**, no qué.
- **Nunca `git add -A`.** Hay otra sesión en el árbol. Agregar por nombre.
- **Atención con Mantenimiento:** al escribir este plan, otra sesión tenía
  modificados `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx`,
  `app/api/mantenimiento/ordenes/route.ts` y `lib/mantenimiento/*`. La tarea 8
  toca `NuevaOTModal.tsx` y `RegistrarOTModal.tsx`, de esa misma carpeta:
  **mirar `git status` antes y saltear esos dos archivos si aparecen tomados**,
  dejándolos anotados en el reporte.
- `display: standalone`, `start_url: "/"`, `theme_color` y `background_color`
  `#0A0F1C` — el mismo que ya declara `viewport` en `app/layout.tsx`.
- El ancho útil de referencia es **343 px** (375 menos los 32 de padding del layout).
- **Los cinco calendarios no se tocan** (`/remises/semana`,
  `/cantera/destape` ×2, `/trituracion/partes` ×2). Un calendario de una columna
  no es un calendario.

## Foco de revisión

Lo que el spec implica y ningún test ejercitaría solo.

**Tres tienen test automático**, porque la lógica es pura:

1. **Chrome en iOS** manda `CriOS` en el user agent: es un iPhone y va por el
   camino de Apple, aunque diga Chrome. → tarea 1.
2. **Safari de escritorio**: no dispara `beforeinstallprompt` y no es iOS. Cae en
   `escritorio` y muestra el texto genérico, no las instrucciones de iPhone. → tarea 1.
3. **Una notificación sin `data.url`**: `notificationclick` abre `/` y no rompe.
   → tarea 4, con el arnés que carga `sw.js` y dispara el handler.

**Dos no lo tienen, y hay que decirlo en vez de fingirlo.** Este repo no testea
pantallas —está escrito en el CLAUDE.md— así que caen en la pasada manual de la
tarea 9, y van nombrados ahí como casos a probar y no como "revisar que ande":

4. **La app ya instalada**: la barra no se muestra, aunque el navegador vuelva a
   disparar `beforeinstallprompt`. La mitad pura la cubre la tarea 1
   (`standalone: true` gana sobre todo); que el componente respete lo que esa
   función devuelve, no.
5. **El navegador sin `serviceWorker`** (contexto inseguro, navegador viejo):
   `/instalar` tiene que explicar, no tirar.

---

### Tarea 1: `lib/core/instalacion.ts` — qué plataforma es

**Archivos:**
- Crear: `lib/core/instalacion.ts`
- Crear: `lib/core/instalacion.test.ts`

**Interfaces:**
- Produce: `type PlataformaInstalacion = "ya-instalada" | "ios" | "android" | "escritorio"`
  y `plataformaDeInstalacion(userAgent: string, standalone: boolean): PlataformaInstalacion`.
  La consumen las tareas 5.

- [ ] **Paso 1: escribir los tests que fallan**

En `lib/core/instalacion.test.ts`, con estos nombres y estos user agents reales:

- `"ya-instalada gana sobre todo lo demás"` — cualquier UA con `standalone: true` ⇒ `"ya-instalada"`.
- `"Safari en iPhone es ios"` — `Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1` ⇒ `"ios"`.
- `"Chrome en iOS también es ios, aunque diga Chrome"` — el mismo UA pero con `CriOS/122.0` en vez de `Version/17.4` ⇒ `"ios"`. En iOS todos los navegadores son WebKit y ninguno puede instalar solo.
- `"iPad es ios"` — `Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1` ⇒ `"ios"`.
- `"Chrome en Android es android"` — `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36` ⇒ `"android"`.
- `"Chrome en escritorio es escritorio"` — `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36` ⇒ `"escritorio"`.
- `"Safari de escritorio es escritorio y no ios"` — `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15` ⇒ `"escritorio"`. Es el caso que confunde: dice `Safari` y `Mac`, y no es un teléfono.
- `"un user agent vacío es escritorio"` — `""` ⇒ `"escritorio"`. Es el peor caso seguro: muestra el texto genérico en vez de romper.

- [ ] **Paso 2: correr y ver que falla**

```bash
npx vitest run lib/core/instalacion.test.ts
```
Esperado: FAIL, `Failed to resolve import "./instalacion"`.

- [ ] **Paso 3: implementar `plataformaDeInstalacion(userAgent, standalone)` en `lib/core/instalacion.ts`**

Pura: no toca `navigator` ni `window`; quien la llama le pasa los dos datos. El
comentario explica por qué `CriOS` cae en `ios` (en iOS todo navegador es WebKit
y ninguno puede disparar la instalación) y por qué el Safari de escritorio no.

- [ ] **Paso 4: correr y ver que pasa**

```bash
npx vitest run lib/core/instalacion.test.ts
```
Esperado: PASS, 8 tests.

- [ ] **Paso 5: `tsc` y commit**

```bash
npx tsc --noEmit
```
```bash
git add lib/core/instalacion.ts lib/core/instalacion.test.ts
git commit -m "feat(app): detectar la plataforma para explicar como instalar"
```

---

### Tarea 2: los íconos, y los 2 MB que se van

**Archivos:**
- Crear: `scripts/generar-iconos.mjs`
- Crear (generados y commiteados): `public/icon-192.png`, `public/icon-512.png`,
  `public/icon-512-maskable.png`, `public/apple-touch-icon.png`, `public/logo-320.png`
- Modificar: `package.json` (devDependency `sharp`)
- Modificar: `components/Header.tsx`, `app/login/page.tsx`,
  `app/forgot-password/page.tsx`, `app/reset-password/ResetPasswordForm.tsx`

**Interfaces:**
- Produce: los cinco PNG en `public/`. Los consume la tarea 3 (manifest) y la 5.

- [ ] **Paso 1: agregar `sharp` como devDependency**

```bash
npm install --save-dev sharp
```

Va como devDependency y no dependency: los íconos se generan a mano y se
commitean, así que producción no lo necesita. Está en `node_modules` porque lo
arrastra Next, pero depender de una transitiva es frágil.

- [ ] **Paso 2: escribir `scripts/generar-iconos.mjs`**

Lee `public/logo.png` (4266×4266) y escribe:

| Archivo | Tamaño | Detalle |
|---|---|---|
| `icon-192.png` | 192 | |
| `icon-512.png` | 512 | |
| `icon-512-maskable.png` | 512 | el logo ocupa el 80% centrado, sobre fondo `#0A0F1C`. Android recorta en círculo y sin ese margen se come el logo |
| `apple-touch-icon.png` | 180 | iOS usa éste y no los del manifest. Sin transparencia: iOS la pinta de negro |
| `logo-320.png` | 320 de ancho | para las pantallas que hoy muestran el de 4266 escalado por CSS |

Cabecera con el porqué, el uso (`node scripts/generar-iconos.mjs`) y la
advertencia de que si cambia `logo.png` hay que volver a correrlo — nada avisa.
Mismo molde que `scripts/copiar-activos-del-lector.mjs`.

- [ ] **Paso 3: correr el script y verificar los tamaños**

```bash
node scripts/generar-iconos.mjs
```
```bash
node -e "const s=require('sharp');for(const f of ['icon-192','icon-512','icon-512-maskable','apple-touch-icon','logo-320'])s('public/'+f+'.png').metadata().then(m=>console.log(f,m.width+'x'+m.height,Math.round(require('fs').statSync('public/'+f+'.png').size/1024)+'KB'))"
```
Esperado: 192×192, 512×512, 512×512, 180×180, y `logo-320` de 320 de ancho.
Los cinco juntos tienen que pesar **menos que los 2 MB del original**.

- [ ] **Paso 4: cambiar los cinco usos de `logo.png` por `logo-320.png`**

En `components/Header.tsx` (que está en **todas** las páginas), `app/login/page.tsx`
(dos usos), `app/forgot-password/page.tsx` y `app/reset-password/ResetPasswordForm.tsx`.

**No tocar** `app/(app)/mantenimiento/planificacion/[id]/imprimir/ImprimirClient.tsx`:
sale en papel y ahí la resolución sirve.

- [ ] **Paso 5: verificar que no quedó ningún uso de pantalla con el grande**

```bash
grep -rn "logo.png" app components --include=*.tsx
```
Esperado: una sola línea, la de `imprimir`.

- [ ] **Paso 6: commit**

```bash
git add scripts/generar-iconos.mjs public/icon-192.png public/icon-512.png public/icon-512-maskable.png public/apple-touch-icon.png public/logo-320.png package.json package-lock.json components/Header.tsx app/login/page.tsx app/forgot-password/page.tsx app/reset-password/ResetPasswordForm.tsx
git commit -m "feat(app): iconos del manifest, y el logo de 2 MB deja de servirse en cada pagina"
```

---

### Tarea 3: `app/manifest.ts`

**Archivos:**
- Crear: `app/manifest.ts`

**Interfaces:**
- Consume: los íconos de la tarea 2.
- Produce: `/manifest.webmanifest`, que sirve Next.

- [ ] **Paso 1: escribir `app/manifest.ts`**

`export default function manifest(): MetadataRoute.Manifest`, con los valores de
las Restricciones globales: `name: "SdG — Polcecal / Polysan"`,
`short_name: "SdG"`, `start_url: "/"`, `display: "standalone"`, `lang: "es"`,
`background_color` y `theme_color` `#0A0F1C`, y los cuatro íconos —el maskable
con `purpose: "maskable"` y los otros con `purpose: "any"`.

- [ ] **Paso 2: verificar que Next lo sirve**

```bash
npm run build
```
Esperado: en el listado de rutas aparece `/manifest.webmanifest`.

- [ ] **Paso 3: commit**

```bash
git add app/manifest.ts
git commit -m "feat(app): el manifest que hace instalable al SdG"
```

---

### Tarea 4: el service worker

**Archivos:**
- Modificar: `public/sw.js`

**Interfaces:**
- Produce: un `sw.js` con `fetch`, y un `notificationclick` que abre `data.url`.
  La fase 2 manda ese campo en el payload.

- [ ] **Paso 1: agregar el manejador de `fetch` de paso**

Un `self.addEventListener("fetch", () => {})` que no intercepta nada. Con un
comentario que diga: **está por la instalabilidad**, Chrome no dispara
`beforeinstallprompt` sin él y entonces el botón de Android no aparece nunca,
sin ningún error; y es el gancho donde la fase 3 va a colgar el caché. **Que
nadie lo borre por parecer inútil.**

- [ ] **Paso 2: que `notificationclick` abra lo que venga en el payload**

Hoy está cableado a `/mi-remis`. Pasa a `event.notification.data?.url ?? "/"`, y
antes de abrir una ventana nueva busca una ya abierta del mismo origen y la
enfoca con `clients.matchAll({ type: "window", includeUncontrolled: true })`.
Sin eso, cada notificación abre una pestaña y a los tres avisos hay cuatro
copias de la app.

El `push` tiene que guardar `data` en la notificación para que el click lo
encuentre: `self.registration.showNotification(titulo, { ..., data })`.

- [ ] **Paso 3: escribir el test del handler**

`public/sw.js` es JavaScript plano que usa `self`, así que se puede ejercitar de
verdad: en `lib/core/sw.test.ts`, armar un `self` falso con un `addEventListener`
que guarde los handlers, leer el archivo y evaluarlo, y después disparar
`notificationclick` con eventos armados a mano. Tres tests:

- `"abre la url que viene en el payload"` — `data: { url: "/compras/aprobaciones" }`
  ⇒ se abre esa.
- `"sin url abre la raíz"` — `data` vacío ⇒ `/`. Es el caso del foco de revisión:
  no puede tirar.
- `"si ya hay una ventana abierta la enfoca en vez de abrir otra"` — con un
  cliente en `clients.matchAll` ⇒ llama a `focus()` y no a `openWindow()`.

Y uno más, que es el que protege la instalabilidad:

- `"el service worker registra un handler de fetch"` — porque sin él Chrome no
  ofrece instalar, y es justo la línea que alguien podría borrar por parecer
  inútil.

- [ ] **Paso 4: correr los tests y verificar la sintaxis**

```bash
npx vitest run lib/core/sw.test.ts
```
Esperado: PASS, 4 tests.

```bash
node --check public/sw.js
```
Esperado: sin salida.

- [ ] **Paso 5: commit**

```bash
git add public/sw.js lib/core/sw.test.ts
git commit -m "fix(app): el service worker acepta instalarse y deja de abrir siempre mi-remis"
```

---

### Tarea 5: la pantalla de instalación y la barra

**Archivos:**
- Crear: `app/(app)/instalar/page.tsx`
- Crear: `app/(app)/instalar/InstalarClient.tsx`
- Crear: `components/BarraInstalar.tsx`
- Modificar: `app/(app)/layout.tsx` (montar la barra)
- Modificar: `components/Sidebar.tsx` (el enlace a `/instalar`)

**Interfaces:**
- Consume: `plataformaDeInstalacion` de la tarea 1.

- [ ] **Paso 1: `InstalarClient.tsx`**

Cliente. Resuelve la plataforma con
`plataformaDeInstalacion(navigator.userAgent, estaInstalada())`, donde
`estaInstalada()` es
`window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true`
— la segunda mitad es iOS, que no soporta la media query.

Qué muestra cada caso:

| | |
|---|---|
| `ya-instalada` | «Ya la tenés instalada.» |
| `android` | El botón «Instalar la app», habilitado sólo si llegó `beforeinstallprompt`; si no llegó, el texto de cómo hacerlo desde el menú de Chrome |
| `ios` | Los dos pasos: tocar Compartir y elegir «Agregar a inicio», con el ícono de Compartir dibujado en SVG |
| `escritorio` | Que Chrome y Edge muestran un ícono de instalar en la barra de direcciones |

**En los cuatro casos** va la advertencia de que **la primera vez que la abras te
va a pedir la contraseña de nuevo**, porque la app instalada tiene su propio
almacenamiento. Si nadie lo dice, el primer día parece que está rota.

Y si `!("serviceWorker" in navigator)`, el texto de que el navegador no la
soporta — mismo molde que `mi-remis`, que distingue «no soportado» de «denegado»
en vez de no hacer nada.

- [ ] **Paso 2: capturar `beforeinstallprompt`**

En un efecto: `e.preventDefault()` y guardar el evento en un estado. El botón
llama a `prompt()` y después descarta el evento guardado —no se puede usar dos
veces—. Si el resultado es `dismissed`, el botón vuelve a quedar disponible pero
**la barra no se muestra más en esa sesión**.

- [ ] **Paso 3: `BarraInstalar.tsx`**

La misma detección, en una barra al pie. No se muestra si la plataforma es
`ya-instalada`, ni si el usuario la descartó —se recuerda en `localStorage` con
`try/catch`, que en modo privado tira—, ni en `escritorio`. Enlaza a `/instalar`
en iOS y dispara el `prompt()` en Android.

- [ ] **Paso 4: montarla y enlazarla**

La barra en `app/(app)/layout.tsx`, dentro de `NavMovilProvider`. El enlace a
`/instalar` en `components/Sidebar.tsx`, siguiendo el patrón de los que ya están.

- [ ] **Paso 5: verificar**

```bash
npx tsc --noEmit
```
```bash
npm test
```
```bash
npx eslint "app/(app)/instalar/InstalarClient.tsx" "components/BarraInstalar.tsx"
```
Esperado: los tres limpios. Los 3 errores conocidos de `AcarreoClient.tsx` y
`LineasDeFactura.tsx` no son de esta tarea.

- [ ] **Paso 6: commit**

```bash
git add "app/(app)/instalar/page.tsx" "app/(app)/instalar/InstalarClient.tsx" components/BarraInstalar.tsx "app/(app)/layout.tsx" components/Sidebar.tsx
git commit -m "feat(app): pantalla y barra para instalar, con las instrucciones de cada telefono"
```

---

### Tarea 6: `scripts/revisar-responsive.mjs`

**Archivos:**
- Crear: `scripts/revisar-responsive.mjs`
- Crear: `scripts/revisar-responsive.test.mjs`

**Interfaces:**
- Produce: `revisarResponsive(archivos: {ruta: string, texto: string}[]): Hallazgo[]`
  exportada para el test, y un `main` que recorre `app/` y `components/` cuando
  se lo corre directo. `Hallazgo` es
  `{ ruta: string, linea: number, severidad: "ROMPE" | "APRETADO" | "MIRAR", que: string }`.

- [ ] **Paso 1: escribir los tests que fallan**

En `scripts/revisar-responsive.test.mjs`, pasándole textos armados a mano (no el
árbol real, que cambia):

- `"una tabla sin contenedor con scroll sale como MIRAR"`.
- `"una tabla con overflow-x-auto arriba no sale"` — el contenedor hasta 12 líneas antes.
- `"grid-cols-3 sin breakpoint sale como APRETADO"`.
- `"sm:grid-cols-3 no sale"`.
- `"grid-cols-12 sale como ROMPE"`.
- `"grid-cols-2 no sale"` — 165 px por columna entran.
- `"w-[400px] sale como ROMPE y w-[300px] no"` — el corte es 343.
- `"los calendarios de la lista de excepciones no salen"` — con las cinco
  entradas reales (`SemanaClient.tsx`, `DestapeClient.tsx` ×2,
  `PartesClient.tsx` ×2) y su `grid-cols-7`.
- `"una pantalla de imprimir no sale"` — la ruta con `/imprimir/`.

- [ ] **Paso 2: correr y ver que falla**

```bash
npx vitest run scripts/revisar-responsive.test.mjs
```
Esperado: FAIL, no resuelve el import.

- [ ] **Paso 3: implementar el script**

Las excepciones van en una constante `CALENDARIOS` arriba, con el comentario de
por qué: son el calendario del mes, 49 px por celda es lo que mide un día en
cualquier teléfono, y ponerles un breakpoint los rompería.

Cabecera con el porqué, al estilo de `revisar-arbol-commiteado.mjs`: **escribir
una pantalla nueva con una grilla apretada no rompe nada, y ése es el problema.**
No hay error y no hay test que lo note; esa pantalla simplemente queda inusable
en el teléfono y nadie se entera hasta que alguien la abre desde la cantera.

Y que **no está en el CI todavía** y por qué: hasta que la lista de excepciones
esté estable, un CI rojo no lo mira nadie — la misma razón que el lint.

- [ ] **Paso 4: correr los tests y el script sobre el árbol**

```bash
npx vitest run scripts/revisar-responsive.test.mjs
```
Esperado: PASS, 9 tests.

```bash
node scripts/revisar-responsive.mjs
```
Esperado: **ROMPE 2** (las dos filas de 12 de voladuras; los cinco calendarios
ya no salen), **APRETADO 20**, **MIRAR 8**.

- [ ] **Paso 5: commit**

```bash
git add scripts/revisar-responsive.mjs scripts/revisar-responsive.test.mjs
git commit -m "feat(app): un script que busca lo que no entra en un telefono"
```

---

### Tarea 7: las 8 tablas sin scroll

**Archivos:**
- Modificar: `app/(app)/produccion/resumenes/ResumenesClient.tsx` (líneas 188, 301, 383)
- Modificar: `app/(app)/inventario/lista/ListaClient.tsx` (135, 242)
- Modificar: `app/(app)/cantera/acarreo/AcarreoClient.tsx` (161)
- Modificar: `app/(app)/remises/page.tsx` (103)
- Modificar: `app/(app)/rrhh/liquidaciones/LiquidacionesClient.tsx` (309)

- [ ] **Paso 1: envolver cada tabla**

Cada `<table>` va dentro de un `<div className="overflow-x-auto">`. **Copiar el
patrón exacto de las 95 que ya lo tienen** en vez de inventar uno: buscar un
ejemplo con `grep -rn -B3 "<table" app --include=*.tsx | grep overflow-x-auto`
y seguirlo, incluidas las clases que lo acompañen.

`AcarreoClient.tsx` es uno de los tres archivos con errores de lint conocidos:
**envolver la tabla y nada más**, no arreglar el lint de paso.

- [ ] **Paso 2: verificar que el script ya no las ve**

```bash
node scripts/revisar-responsive.mjs
```
Esperado: **MIRAR 0**. ROMPE y APRETADO sin cambios (2 y 20).

- [ ] **Paso 3: `tsc` y commit**

```bash
npx tsc --noEmit
```
```bash
git add "app/(app)/produccion/resumenes/ResumenesClient.tsx" "app/(app)/inventario/lista/ListaClient.tsx" "app/(app)/cantera/acarreo/AcarreoClient.tsx" "app/(app)/remises/page.tsx" "app/(app)/rrhh/liquidaciones/LiquidacionesClient.tsx"
git commit -m "fix(app): las ocho tablas que estiraban la pagina en el telefono"
```

---

### Tarea 8: las 20 grillas apretadas y las 2 filas de 12

**Archivos** (línea entre paréntesis):
- `app/(app)/mantenimiento/ordenes/NuevaOTModal.tsx` (141, 165, 177, 202) — **ver la advertencia de Mantenimiento**
- `app/(app)/mantenimiento/ordenes/RegistrarOTModal.tsx` (246) — **ídem**
- `app/(app)/rrhh/empleados/EmpleadosClient.tsx` (296, 399)
- `app/(app)/rrhh/empleados/[id]/EmpleadoDetalle.tsx` (322, 673)
- `app/(app)/cantera/cubicacion/CubicacionClient.tsx` (164)
- `app/(app)/cantera/destape/cargar/CargarDestapeClient.tsx` (286)
- `app/(app)/cantera/tarifas-acarreo/TarifasAcarreoClient.tsx` (90)
- `app/(app)/inventario/movimientos/nuevo/NuevoMovimientoClient.tsx` (267)
- `app/(app)/mantenimiento/DashboardClient.tsx` (704)
- `app/(app)/mantenimiento/produccion/ProduccionClient.tsx` (534)
- `app/(app)/rrhh/fichadas/FichadasClient.tsx` (534)
- `app/(app)/rrhh/vacaciones/VacacionesClient.tsx` (88)
- `app/(app)/taller-vial/page.tsx` (180)
- `components/rrhh/FichadaEditModal.tsx` (318)
- `app/(app)/cantera/voladuras/[codigo]/VoladuraClient.tsx` (541, 575) — las de 12

- [ ] **Paso 1: las 20 de tres columnas**

**Mirar qué hay adentro de cada una antes de elegir** — es la decisión que el
plan no puede tomar:

- Campo de formulario con su etiqueta ⇒ `grid-cols-1 sm:grid-cols-3`.
- Número corto con su rótulo (un KPI, un total) ⇒ `grid-cols-2 sm:grid-cols-3`.

En los dos casos el breakpoint es `sm` (640 px), que es el que ya usan las
grillas sanas del repo.

- [ ] **Paso 2: las 2 filas de 12 de voladuras**

`grid-cols-12` con el nombre del insumo en `col-span-7` y los inputs
repartiéndose el resto. Abajo de `sm` se apila: la fila pasa a
`grid-cols-1 sm:grid-cols-12` y los hijos a `col-span-full sm:col-span-7` (y lo
que corresponda a cada uno). El nombre arriba, los campos abajo.

`VoladuraClient.tsx` es una de las tres pantallas que quedaron sin migrar a
`<Select>` porque otra sesión las tenía tomadas: **tocar sólo las dos filas, no
los desplegables**.

- [ ] **Paso 3: verificar**

```bash
node scripts/revisar-responsive.mjs
```
Esperado: **ROMPE 0 · APRETADO 0 · MIRAR 0** — salvo los archivos que se hayan
salteado por estar tomados por la otra sesión, que van anotados en el reporte.

```bash
npx tsc --noEmit
```
```bash
npm test
```

- [ ] **Paso 4: commit**

Agregar **por nombre** sólo los archivos efectivamente tocados.

```bash
git commit -m "fix(app): las grillas que no entraban en 375 px"
```

---

### Tarea 9: verificación final

- [ ] **Paso 1: las cuatro de siempre**

Parar `npm run dev` antes del build: con el dev server levantado, `next build`
deja la app en 500.

```bash
npm test
```
```bash
npx tsc --noEmit
```
```bash
npm run build
```
```bash
node scripts/revisar-arbol-commiteado.mjs
```

El último importa especialmente acá: esta fase agrega **nueve archivos nuevos**
—la función, su test, el script, su test, el manifest, la pantalla, el cliente,
la barra y los cinco PNG—. Si alguno quedó *staged* sin commitear, el build local
pasa y el deploy se cae con `Module not found`.

- [ ] **Paso 2: verificar el manifest servido**

```bash
npm run build && npx next start &
```
```bash
curl -s localhost:3000/manifest.webmanifest
```
Esperado: el JSON con los cuatro íconos, `display: "standalone"` y
`start_url: "/"`. Parar el server después.

- [ ] **Paso 3: pushear**

```bash
git push
```

- [ ] **Paso 4: lo que necesita una persona**

Decirle al usuario que faltan dos cosas que un agente no puede hacer, y que
**hasta que se hagan la fase 1 no está terminada**:

1. **Probar la instalación en un Android y en un iPhone reales.** Que la barra
   aparezca en Android, que «Agregar a inicio» deje el ícono bien en iPhone, y
   que abra sin la barra del navegador. El criterio de instalabilidad lo define
   Chrome y cambió más de una vez: el `fetch` de paso es lo que hoy se pide.
2. **La pasada visual por las 22 pantallas a 375 px**, con sesión iniciada. El
   navegador lo maneja el agente una vez que haya sesión; el login lo hace una
   persona.
3. **Los dos casos del foco de revisión que no tienen test automático**, porque
   este repo no testea pantallas: que con la app **ya instalada** la barra no
   aparezca (abrirla desde el ícono, no desde el navegador), y que en un
   navegador **sin `serviceWorker`** la pantalla `/instalar` explique en vez de
   quedar en blanco — se reproduce abriendo la app por `http://` en vez de
   `https://`, que es contexto inseguro.

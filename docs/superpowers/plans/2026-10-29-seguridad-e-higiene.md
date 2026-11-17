# Seguridad e Higiene — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un décimo módulo donde se cargan condiciones inseguras desde el
teléfono —incluso sin señal— y se gestionan desde la computadora, con las fotos
en Storage y respaldo en Drive.

**Architecture:** Un módulo más del SdG, calcado de Calidad: valor nuevo en el
enum `modulo`, tablas `syh_*` con RLS por acceso al módulo, pantallas en
`app/(app)/seguridad-higiene`, rutas en `app/api/seguridad-higiene`, lógica pura
en `lib/seguridadHigiene`. La carga desde el teléfono entra como **tercer tipo**
en la cola offline que ya existe (`public/cola/colaOffline.js` + `/cargar`), que
hasta hoy sólo manda JSON y tiene que aprender a mandar una foto.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + RLS + Storage),
TypeScript, vitest, Tailwind v4. Sin librerías nuevas.

**Spec:** [docs/superpowers/specs/2026-10-29-seguridad-e-higiene-design.md](../specs/2026-10-29-seguridad-e-higiene-design.md)

## Global Constraints

- **Todo en castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Enum**: `seguridad_higiene`. **Ruta**: `/seguridad-higiene`. **Carpeta de
  código**: `lib/seguridadHigiene`. **Prefijo de tablas**: `syh_`.
- **Umbrales del riesgo, exactos**: `>=139` → `I`; `>=90` → `S`; `>=49` → `M`;
  `>=18` → `PS`; `>0` → `NS`.
- **Puntajes válidos**: frecuencia 3/2/1, antecedentes 3/2/1, controles 5/3/1,
  magnitud del daño 9/7/3, legislación 5/3/1. Ningún otro valor entra.
- **Un valor de enum nuevo viaja solo en su propio archivo** (`55P04`).
- **Las migraciones las corre una persona** a mano en el editor SQL de Supabase.
  Un agente las escribe y espera; **no puede correr DDL**.
- **Toda policy nueva llama a su función envuelta**: `using ((select
  tiene_acceso_syh()))`, nunca pelada.
- **Un desplegable se escribe `<Select>`**, no `<select>`.
- **Una grilla de tres o más columnas lleva breakpoint**: `grid-cols-1
  sm:grid-cols-3`. El ancho útil del teléfono es 343 px.
- **`className="input w-20"` no mide 20**: el ancho va en un `div` que envuelva
  al campo.
- **Nunca `git add -A`.** Se commitea con rutas explícitas:
  `git commit --only <rutas> -F <mensaje>`.
- **`traerTodo()` de `lib/core/paginado.ts`** en cualquier tabla que pueda crecer.
- Commits: conventional en castellano, `feat(seguridad-higiene): …`, con el
  cuerpo explicando **por qué**.

## Review Focus

Cinco cosas que la spec implica, que ningún test obvio ejercita, y que le van a
morder a una persona de verdad. Cada una tiene su test asignado a la tarea que
es dueña del código:

1. **`fecha_maxima` igual a hoy.** ¿Vencida o Pendiente? Pendiente: todavía es
   hoy. Un `<` donde iba `<=` vence todo un día antes. → Tarea 1.
2. **Una evaluación a medias.** Cuatro puntajes cargados y uno en null tiene que
   dar nivel null y clasificación vacía, nunca un `NS` falso que la saque de
   «sin completar». → Tarea 1 (la función pura) y Tarea 2 (las columnas
   generadas, donde `null + 3` ya da null en Postgres).
3. **Una foto rechazada por tipo o tamaño cuando viene de la cola.** Es un 400,
   o sea definitivo: la carga queda parada y la foto **ya no se puede sacar de
   nuevo**. El mensaje tiene que decir qué pasó con la foto, no sólo que falló.
   → Tarea 6.
4. **Dos disparos mandando la misma condición.** La pantalla y el service worker
   pueden despertar juntos; la `clave` de la carga tiene que dejar una sola
   fila. → Tarea 3.
5. **Sector y equipo juntos.** El `check` de la base lo rechaza con un error de
   Postgres que no le dice nada a nadie; la ruta tiene que contestarlo en
   castellano antes. → Tarea 3.

---

## Estructura de archivos

**Lógica pura (con tests):**

| Archivo | Responsabilidad |
|---|---|
| `lib/seguridadHigiene/riesgo.ts` | Los cinco criterios con su texto y sus puntos; `clasificar(nivel)` |
| `lib/seguridadHigiene/condicion.ts` | `estadoDe()`, `loQueFalta()`, y los tipos de la condición |
| `lib/seguridadHigiene/auth.ts` | Los tres niveles, espejo de las funciones de la base |

**Base:**

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<ts>_syh_enum_del_modulo.sql` | El valor del enum, solo |
| `supabase/migrations/<ts>_syh_schema.sql` | Tablas, columnas generadas, funciones, policies |
| `supabase/migrations/<ts>_syh_bucket_de_fotos.sql` | El bucket y sus policies |

**Rutas:**

| Archivo | Responsabilidad |
|---|---|
| `app/api/seguridad-higiene/condiciones/route.ts` | POST (alta, también desde la cola) y GET |
| `app/api/seguridad-higiene/condiciones/[id]/route.ts` | PATCH (completar, corregir, cerrar, reabrir) |
| `app/api/seguridad-higiene/fotos/route.ts` | POST de una foto |
| `app/api/seguridad-higiene/peligros/route.ts` | GET del glosario, para el catálogo offline |
| `app/api/cron/syh-respaldo-de-fotos/route.ts` | El respaldo a Drive |

**Pantallas:**

| Archivo | Responsabilidad |
|---|---|
| `app/(app)/seguridad-higiene/page.tsx` | El tablero con una tarjeta |
| `app/(app)/seguridad-higiene/condiciones/page.tsx` + `CondicionesClient.tsx` | La gestión |
| `app/cargar/FormularioCondicionOffline.tsx` | El formulario del teléfono |

**Tocados:** `lib/core/types.ts`, `lib/core/access.ts`, `lib/core/nav.ts`,
`lib/home/avisos.ts`, `lib/home/avisosDeUsuario.ts`, `lib/home/ritmo.ts`,
`app/(app)/administracion/usuarios/UsuariosClient.tsx`,
`public/cola/colaOffline.js`, `public/sw.js`, `app/cargar/CargarClient.tsx`,
`app/cargar/catalogos.ts`, `app/cargar/envio.tsx`,
`docs/VARIABLES-VERCEL.md`, `CLAUDE.md`.

---

## Task 1: La lógica del riesgo y el estado

Primero porque no depende de ninguna migración, y porque es donde están las
decisiones.

**Files:**
- Create: `lib/seguridadHigiene/riesgo.ts`, `lib/seguridadHigiene/riesgo.test.ts`
- Create: `lib/seguridadHigiene/condicion.ts`, `lib/seguridadHigiene/condicion.test.ts`

**Interfaces:**
- Consumes: `hoyEnArgentina()` de `lib/core/fechas`.
- Produces:
  - `type Clasificacion = "I" | "S" | "M" | "PS" | "NS"`
  - `clasificar(nivel: number | null): Clasificacion | null`
  - `CRITERIOS: Record<Criterio, { puntos: number; texto: string }[]>` donde
    `type Criterio = "frecuencia" | "antecedentes" | "controles" | "magnitud_dano" | "legislacion"`
  - `type Estado = "Pendiente" | "Cerrada" | "Vencida"`
  - `estadoDe(c: { fecha_maxima: string | null; fecha_ejecucion: string | null }, hoy: string): Estado`
  - `type Falta = "sin_evaluar" | "sin_asignar" | "sin_lugar"`
  - `loQueFalta(c: CondicionParaFaltantes): Falta[]`
  - `interface CondicionParaFaltantes` con `sector_id`, `equipo_id`,
    `responsable_id`, `fecha_maxima` y los cinco puntajes, todos nullables.

- [ ] **Step 1: Escribir los tests de `clasificar`, que fallan**

En `lib/seguridadHigiene/riesgo.test.ts`. Los bordes son el punto:

```ts
it("clasifica cada borde exacto", () => {
  expect(clasificar(139)).toBe("I");
  expect(clasificar(138)).toBe("S");
  expect(clasificar(90)).toBe("S");
  expect(clasificar(89)).toBe("M");
  expect(clasificar(49)).toBe("M");
  expect(clasificar(48)).toBe("PS");
  expect(clasificar(18)).toBe("PS");
  expect(clasificar(17)).toBe("NS");
  expect(clasificar(1)).toBe("NS");
});

it("sin nivel no hay clasificación", () => {
  expect(clasificar(null)).toBeNull();
  expect(clasificar(0)).toBeNull();
});

// El Excel del que viene esto decía IF(151>=49,"M",…) en todas las filas menos
// una: una constante donde iba el nivel. Nada podía salir PS ni NS, y nadie lo
// notó en 44 filas. Este test es ese error.
it("un nivel bajo NO cae siempre en M", () => {
  expect(clasificar(42)).toBe("PS");
  expect(clasificar(9)).toBe("NS");
});
```

Y que los cinco criterios tengan sus puntos y sus textos:

```ts
it("los cinco criterios tienen los puntajes de la planilla", () => {
  expect(CRITERIOS.frecuencia.map((o) => o.puntos)).toEqual([3, 2, 1]);
  expect(CRITERIOS.antecedentes.map((o) => o.puntos)).toEqual([3, 2, 1]);
  expect(CRITERIOS.controles.map((o) => o.puntos)).toEqual([5, 3, 1]);
  expect(CRITERIOS.magnitud_dano.map((o) => o.puntos)).toEqual([9, 7, 3]);
  expect(CRITERIOS.legislacion.map((o) => o.puntos)).toEqual([5, 3, 1]);
});

it("cada opción trae el texto que explica cuándo corresponde", () => {
  for (const opciones of Object.values(CRITERIOS)) {
    for (const o of opciones) expect(o.texto.length).toBeGreaterThan(10);
  }
});
```

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `npx vitest run lib/seguridadHigiene/riesgo.test.ts`
Expected: FAIL, no existe el módulo.

- [ ] **Step 3: Escribir `lib/seguridadHigiene/riesgo.ts`**

`clasificar` es la cascada de umbrales de las Global Constraints. `CRITERIOS`
lleva los textos **copiados del apéndice de la spec**, tal cual, sin resumir:
son lo que hace que dos personas puntúen parecido.

El encabezado del archivo explica de dónde salen los umbrales: de la única fila
del Excel que tenía la fórmula sana, porque las demás comparaban una constante.

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run lib/seguridadHigiene/riesgo.test.ts`
Expected: PASS

- [ ] **Step 5: Escribir los tests de `estadoDe` y `loQueFalta`, que fallan**

En `lib/seguridadHigiene/condicion.test.ts`. Los dos primeros son los del
Review Focus:

```ts
const HOY = "2026-10-29";

it("con fecha de ejecución está cerrada, aunque la máxima haya pasado", () => {
  expect(estadoDe({ fecha_maxima: "2026-10-01", fecha_ejecucion: "2026-10-05" }, HOY)).toBe("Cerrada");
});

// El borde: todavía es hoy, así que no venció. Un `<` donde va `<=` vence todo
// un día antes.
it("la fecha máxima de hoy todavía no venció", () => {
  expect(estadoDe({ fecha_maxima: HOY, fecha_ejecucion: null }, HOY)).toBe("Pendiente");
  expect(estadoDe({ fecha_maxima: "2026-10-28", fecha_ejecucion: null }, HOY)).toBe("Vencida");
});

it("sin fecha máxima no puede vencer", () => {
  expect(estadoDe({ fecha_maxima: null, fecha_ejecucion: null }, HOY)).toBe("Pendiente");
});

it("una evaluación a medias sigue siendo sin evaluar", () => {
  const cuatroDeCinco = { ...COMPLETA, legislacion: null };
  expect(loQueFalta(cuatroDeCinco)).toContain("sin_evaluar");
});

it("sin responsable o sin fecha máxima está sin asignar", () => {
  expect(loQueFalta({ ...COMPLETA, responsable_id: null })).toContain("sin_asignar");
  expect(loQueFalta({ ...COMPLETA, fecha_maxima: null })).toContain("sin_asignar");
});

it("sin sector ni equipo está sin lugar; con uno de los dos, no", () => {
  expect(loQueFalta({ ...COMPLETA, sector_id: null, equipo_id: null })).toContain("sin_lugar");
  expect(loQueFalta({ ...COMPLETA, sector_id: null, equipo_id: "e1" })).not.toContain("sin_lugar");
});

it("una condición completa no tiene faltantes", () => {
  expect(loQueFalta(COMPLETA)).toEqual([]);
});
```

`COMPLETA` es una condición con todo cargado, definida arriba en el archivo.

- [ ] **Step 6: Correr los tests y ver que fallan**

Run: `npx vitest run lib/seguridadHigiene/condicion.test.ts`
Expected: FAIL

- [ ] **Step 7: Escribir `lib/seguridadHigiene/condicion.ts`**

Las fechas se comparan como texto ISO (`YYYY-MM-DD`), que es lo que hace el
resto del repo: ordenan igual que las fechas y no arrastran zona horaria.

- [ ] **Step 8: Correr los tests y ver que pasan**

Run: `npx vitest run lib/seguridadHigiene/`
Expected: PASS, los dos archivos.

- [ ] **Step 9: Commit**

```bash
git add lib/seguridadHigiene/riesgo.ts lib/seguridadHigiene/riesgo.test.ts lib/seguridadHigiene/condicion.ts lib/seguridadHigiene/condicion.test.ts
git commit --only lib/seguridadHigiene/riesgo.ts lib/seguridadHigiene/riesgo.test.ts lib/seguridadHigiene/condicion.ts lib/seguridadHigiene/condicion.test.ts -F <mensaje>
```

---

## Task 2: El módulo entra al sistema

**⚠️ Esta tarea termina esperando a una persona.** Las migraciones las aplica el
usuario a mano en el editor SQL de Supabase. El agente las escribe, avisa, y
**no sigue a la Tarea 3 hasta que estén corridas**.

**Files:**
- Create: `supabase/migrations/<ts>_syh_enum_del_modulo.sql`
- Create: `supabase/migrations/<ts>_syh_schema.sql`
- Create: `supabase/migrations/<ts>_syh_bucket_de_fotos.sql`
- Create: `lib/seguridadHigiene/auth.ts`
- Modify: `lib/core/types.ts:11` (el tipo `Modulo`)
- Modify: `lib/core/access.ts:4` (`MODULOS_ORDEN`)
- Modify: `lib/home/avisos.ts:90,97` (`NOMBRE`, `HREF`)
- Modify: `lib/home/ritmo.ts:70` (`FUENTES_POR_MODULO`)
- Modify: `app/(app)/administracion/usuarios/UsuariosClient.tsx:46` (`MODULO_LABEL`)
- Modify: `lib/core/nav.ts` (la entrada del módulo)
- Test: `lib/core/access.test.ts` (ya existe; lleva el módulo nuevo)

**Interfaces:**
- Produces: `nivelSyhDe()`, `tieneAccesoSyh()`, `puedeEditarSyh()`,
  `esAdminSyh()` en `lib/seguridadHigiene/auth.ts`, con las mismas firmas que
  las de `lib/calidad/auth.ts` (`(supabase: SupabaseClient, userId: string)`).
- Produces: las tablas `syh_condiciones`, `syh_peligros`, `syh_fotos`.

- [ ] **Step 1: Agregar `seguridad_higiene` al tipo y a los cinco mapas**

`Modulo` en `lib/core/types.ts`, `MODULOS_ORDEN` al final (el orden es el de la
navegación), y las cuatro `Record<Modulo, …>`: `NOMBRE` → `"Seguridad e
Higiene"`, `HREF` → `"/seguridad-higiene"`, `MODULO_LABEL` → `"Seguridad e
Higiene"`, `FUENTES_POR_MODULO` → `[]`.

El `[]` es a propósito y lleva comentario: deja al módulo fuera del aviso de
ritmo («hace N días que no se carga»), que es lo que la spec decidió — sus dos
avisos cuentan otra cosa.

- [ ] **Step 2: Correr `tsc` para ver qué más rompió**

Run: `npx tsc --noEmit`
Expected: PASS. Si falla, es otro `Record<Modulo, …>` que el grep no encontró:
se completa igual.

- [ ] **Step 3: Escribir la migración del enum, sola**

`npm run migracion "syh enum del modulo"`. Adentro, **una sola línea**:
`alter type modulo add value if not exists 'seguridad_higiene';`

Más el encabezado que explica el `55P04`, calcado de
`20260916090407_calidad_enum_del_modulo.sql`, y que cita este plan.

- [ ] **Step 4: Escribir la migración del schema**

`npm run migracion "syh schema"`. Lleva, en este orden:

1. `syh_peligros` — `id`, `nombre` (único), `descripcion`, `activo`, y el
   `insert` de los **32 peligros del apéndice de la spec**, con sus
   descripciones.
2. `syh_condiciones` — las columnas de la spec. Las tres generadas:
   ```sql
   probabilidad  int generated always as (frecuencia + antecedentes + controles) stored,
   gravedad      int generated always as (magnitud_dano + legislacion) stored,
   nivel_riesgo  int generated always as ((frecuencia + antecedentes + controles) * (magnitud_dano + legislacion)) stored,
   ```
   `nivel_riesgo` repite la suma en vez de multiplicar las otras dos columnas
   generadas: Postgres no deja que una columna generada referencie a otra.
3. Los `check` de los puntajes: `frecuencia in (1,2,3)`, `antecedentes in
   (1,2,3)`, `controles in (1,3,5)`, `magnitud_dano in (3,7,9)`,
   `legislacion in (1,3,5)`. Todos admiten null.
4. `check (num_nonnulls(sector_id, equipo_id) <= 1)`.
4b. **`clave text unique`**, nullable — la clave de idempotencia que manda la
   cola offline. Va acá y no en una migración posterior porque la Tarea 3 la
   necesita y una migración aplicada no se edita.
5. `syh_fotos` — `id`, `condicion_id` (`on delete cascade`), `ruta`,
   `subida_por`, `subida_el`, `respaldada_en_drive_el`.
6. Las tres funciones `tiene_acceso_syh()`, `puede_editar_syh()`,
   `es_admin_syh()`, calcadas de las de Calidad
   (`20260916090409_calidad_schema.sql:47`).
7. Las policies, **todas con la función envuelta**: `using ((select
   tiene_acceso_syh()))` para leer, `((select puede_editar_syh()))` para
   insertar y para actualizar la primera etapa, `((select es_admin_syh()))`
   para el resto.

El encabezado deja escrito por qué `nivel_riesgo` repite la cuenta, y por qué
los `check` admiten null (una condición nace sin evaluar).

- [ ] **Step 5: Escribir la migración del bucket**

Calcada de `006_mantenimiento_rls.sql`. Bucket `syh-fotos`, **privado**,
`allowed_mime_types` = `image/jpeg`, `image/png`, `image/webp`, `image/heic`.
Comentario: `image/heif` no va, y la lista tiene que decir lo mismo que
`TIPOS` de la ruta de fotos (Tarea 3) — cuando no coincidieron, una foto HEIF se
rechazaba con un 502 que no explicaba nada.

- [ ] **Step 6: Escribir `lib/seguridadHigiene/auth.ts`**

Copia de `lib/calidad/auth.ts` con `"seguridad_higiene"` y el docstring de los
tres niveles de la spec. El comentario que importa es el que ya está allá: las
dos mitades —esto y las funciones de la base— tienen que decir lo mismo.

- [ ] **Step 7: Agregar el módulo a la navegación**

En `lib/core/nav.ts`, una entrada `{ label: "Seguridad e Higiene", href:
"/seguridad-higiene", modulo: "seguridad_higiene" }` con un solo hijo,
`Condiciones inseguras` → `/seguridad-higiene/condiciones`. La raíz queda fuera
de la lista de hijos, como en Calidad y Cantera: es el tablero.

- [ ] **Step 8: Actualizar el test de acceso**

`lib/core/access.test.ts:25` tiene la lista de módulos. Agregar el nuevo y un
caso: un grant de `seguridad_higiene` en nivel `edicion` hace que
`modulosVisibles` lo incluya y `nivelEnModulo` devuelva `"edicion"`.

- [ ] **Step 9: Verificar**

Run: `npx tsc --noEmit` ; `npm test`
Expected: los dos en verde.

- [ ] **Step 10: Después de que las migraciones estén aplicadas, comprobar la evaluación a medias contra la base**

Es el Review Focus 2 del lado de Postgres, y no lo puede probar vitest. Con el
`SUPABASE_SERVICE_ROLE_KEY` de `.env.local`, insertar una condición con cuatro
puntajes y `legislacion` en null, y leerla:

Expected: `probabilidad` con su número, `gravedad` **null** y `nivel_riesgo`
**null** — `null + 3` da null, que es lo que queremos. Si `nivel_riesgo`
volviera 0, la condición saldría de «sin completar» con una clasificación
inventada. Borrar la fila de prueba después.

- [ ] **Step 11: Commit y PARAR**

Commitear las tres migraciones y los archivos tocados. Después **decirle al
usuario que tiene que aplicar las tres migraciones en el editor SQL de Supabase,
en orden**, y que el enum va solo y confirmado antes de las otras dos. No
avanzar a la Tarea 3 hasta que conteste.

---

## Task 3: La ruta de alta y la de fotos

**Files:**
- Create: `app/api/seguridad-higiene/condiciones/route.ts`
- Create: `app/api/seguridad-higiene/fotos/route.ts`
- Create: `app/api/seguridad-higiene/peligros/route.ts`
- Create: `lib/seguridadHigiene/cuerpoDeCondicion.ts` + su test

**Interfaces:**
- Consumes: `puedeEditarSyh()` (Tarea 2); `validar()` y `errorDeValidacion()`
  de `lib/core/validar.ts`. **No consume `clasificar()`**: el nivel lo calcula
  la base con sus columnas generadas y la clasificación la hace la pantalla
  (Tarea 4). La ruta no clasifica nada.
- Produces: `POST /api/seguridad-higiene/condiciones` devuelve
  `{ numero: string }` — el campo se llama **`numero`** y la cola lo lee de ahí
  (Tarea 5). `POST /api/seguridad-higiene/fotos` devuelve `{ ruta, link }`.
- Produces: `esquemaDeCondicion` (zod) y
  `problemaDelLugar(sector_id, equipo_id): string | null` en
  `lib/seguridadHigiene/cuerpoDeCondicion.ts`.

- [ ] **Step 1: Escribir los tests de `cuerpoDeCondicion`, que fallan**

Los dos que importan son del Review Focus:

```ts
it("sector y equipo juntos se rechazan en castellano", () => {
  expect(problemaDelLugar("s1", "e1")).toBe(
    "Una condición se carga en un sector o en un equipo, no en los dos."
  );
});

it("uno solo, o ninguno, está bien", () => {
  expect(problemaDelLugar("s1", null)).toBeNull();
  expect(problemaDelLugar(null, "e1")).toBeNull();
  expect(problemaDelLugar(null, null)).toBeNull();
});

it("el esquema rechaza un puntaje fuera de la escala", () => {
  const r = validar(esquemaDeCondicion, { ...MINIMO, controles: 4 });
  expect(r.ok).toBe(false);
});

it("el esquema acepta una condición sin evaluar", () => {
  expect(validar(esquemaDeCondicion, MINIMO).ok).toBe(true);
});
```

`problemaDelLugar` devuelve null con los dos en null porque el alta exige el
lugar por su cuenta (abajo) y la migración necesita poder dejarlo vacío.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/seguridadHigiene/cuerpoDeCondicion.test.ts`
Expected: FAIL

- [ ] **Step 3: Escribir `lib/seguridadHigiene/cuerpoDeCondicion.ts`**

El esquema zod con los cinco puntajes opcionales y restringidos a sus valores,
`descripcion` y `accion_propuesta` no vacíos, `prioridad` en 1/2/3.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/seguridadHigiene/cuerpoDeCondicion.test.ts`
Expected: PASS

- [ ] **Step 5: Escribir la ruta de alta**

`POST /api/seguridad-higiene/condiciones`. En orden: sesión (401), usuario
activo, `puedeEditarSyh()` (403), `validar()` + `errorDeValidacion()`,
`problemaDelLugar()` (400), **y el lugar obligatorio**: sin sector ni equipo,
400 con «Falta decir en qué sector o equipo es».

**La idempotencia por `clave`** es lo del Review Focus 4: si el cuerpo trae
`clave`, se guarda en una columna única de `syh_condiciones` y un segundo POST
con la misma clave devuelve la fila que ya existe en vez de crear otra. Es lo
que hacen las dos rutas de alta de Mantenimiento; copiar de
`app/api/mantenimiento/avisos/route.ts`. **Esa columna va en la migración de la
Tarea 2** — si se llega acá y no está, se escribe otra migración, no se edita la
aplicada.

Un GET en la misma ruta devuelve el listado para la gestión, con
`traerTodo()`.

- [ ] **Step 6: Escribir la ruta de fotos**

`app/api/seguridad-higiene/fotos/route.ts`, calcada de
`app/api/mantenimiento/fotos/route.ts`. Tres diferencias, todas con comentario:
bucket `syh-fotos`; **privado**, así que siempre link firmado y nunca
`getPublicUrl`; y la ruta dentro del bucket es `condiciones/<id>/<timestamp>.<ext>`
con el id limpiado igual que allá (`replace(/[^A-Za-z0-9_-]/g, "-")`), porque lo
que llega del formulario termina siendo una ruta.

`TIPOS` tiene que decir lo mismo que `allowed_mime_types` del bucket.

- [ ] **Step 7: Escribir la ruta del glosario**

`GET /api/seguridad-higiene/peligros` **exige `puedeEditarSyh()`** y devuelve
`{ data: [{id, nombre}], puedeCargar: true }`. Quien no pueda editar recibe 403.

Las dos cosas que devuelve son a propósito: la Tarea 5 usa este mismo endpoint
para saber si al teléfono hay que mostrarle la tarjeta de condición. Un 403 acá
**es** la respuesta de «esta persona no puede cargar», así que no hace falta un
endpoint de permisos aparte.

- [ ] **Step 8: Ejercitar el alta dos veces con la misma clave**

Es el Review Focus 4, y las rutas de este repo no tienen tests: se comprueba
corriendo la operación de verdad. Con `npm run dev` levantado, mandar **dos
veces** el mismo POST con la misma `clave` y contar las filas.

Expected: una sola fila, y el segundo pedido devuelve el mismo `numero` que el
primero. Si hay dos, un teléfono que despierta la pantalla y el service worker
al mismo tiempo carga la condición duplicada.

- [ ] **Step 9: Verificar**

Run: `npx tsc --noEmit` ; `npm test`

- [ ] **Step 10: Commit**

---

## Task 4: La pantalla de gestión

**Files:**
- Create: `app/(app)/seguridad-higiene/page.tsx` (tablero)
- Create: `app/(app)/seguridad-higiene/condiciones/page.tsx` y `CondicionesClient.tsx`
- Create: `app/api/seguridad-higiene/condiciones/[id]/route.ts` (PATCH)

**Interfaces:**
- Consumes: `loQueFalta()`, `estadoDe()`, `clasificar()`, `CRITERIOS` (Tarea 1);
  `puedeEditarSyh()`, `esAdminSyh()` (Tarea 2).

- [ ] **Step 1: Escribir el PATCH**

`PATCH /api/seguridad-higiene/condiciones/[id]`. Dos permisos distintos en la
misma ruta, que es lo que la spec decidió:

- `puedeEditarSyh()` → los campos de la primera etapa (lugar, descripción,
  peligro, acción, prioridad) de una condición **no cerrada**.
- `esAdminSyh()` → además los cinco puntajes, responsable, fecha máxima,
  requiere inversión, observaciones, `fecha_ejecucion` (cerrar) y borrarla
  (reabrir).

Un `edicion` que mande un campo de admin recibe 403 con qué campo fue.

**Y acá se decide lo de la auditoría**, que la spec deja escrito y no resuelve:
cerrar una condición la saca de la lista de lo que hay que arreglar, pero no
mueve plata ni stock ni escribe en Odoo, y se deshace borrando la fecha. La
lectura de la spec es que no hace falta `auditar()`. Si quien implementa esto
concluye que sí —que la ausencia de una condición de la lista puede hacerle daño
a alguien—, el verbo `cerrar` ya existe en `ACCIONES` y no necesita migración.
Lo que no vale es no mirarlo: la auditoría la escribe la aplicación y no un
trigger, así que es lo único que puede olvidarse.

- [ ] **Step 2: El tablero**

`app/(app)/seguridad-higiene/page.tsx`: una tarjeta, «Condiciones inseguras»,
con el conteo de las que están sin completar y de las vencidas. Modelo:
`app/(app)/calidad/page.tsx`.

- [ ] **Step 3: La pantalla de condiciones**

La tabla. Lo que la spec fija y no es negociable: **lo que falta se ve antes que
lo que está completo**. Por defecto ordena las vencidas primero, después las sin
completar, después el resto por nivel de riesgo descendente; y hay filtros por
estado, por falta, por sector/equipo y por clasificación.

La ficha de una condición muestra sus fotos, con botón de descargar y de copiar
el link firmado.

Los cinco puntajes se cargan con `<Select>` —cada opción muestra su texto de
`CRITERIOS`—, y el nivel y la clasificación se ven calculados mientras se
elige, antes de guardar.

Reglas del repo que muerden justo acá: `<Select>` y no `<select>` (el glosario
tiene 32 opciones); `grid-cols-1 sm:grid-cols-3`; y si algún campo lleva ancho
fijo, el ancho va en un `div` que lo envuelva.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` ; `npm run build` (con el dev server parado) ;
`node scripts/revisar-responsive.mjs`
Expected: build en verde y el responsive en **ROMPE 0 · APRETADO 0**.

- [ ] **Step 5: Commit**

---

## Task 5: La cola offline acepta un tercer tipo

Sin foto todavía: primero el tipo, después el archivo. Así el aviso y la OT
quedan probados antes de tocar cómo se manda un cuerpo.

**Files:**
- Modify: `public/cola/colaOffline.js` (`TipoDeCarga`, `RUTA_DE`,
  `comoSeLlama`, `conSuArticulo`, `concordado`, `CAMPO_DEL_NUMERO`)
- Modify: `lib/core/colaOffline.test.ts`
- Modify: `app/cargar/CargarClient.tsx:550,560,593` (la tercera pestaña)
- Modify: `app/cargar/catalogos.ts` (el glosario de peligros)
- Create: `app/cargar/FormularioCondicionOffline.tsx`

**Interfaces:**
- Consumes: `GET /api/seguridad-higiene/peligros` (Tarea 3).
- Produces: `TipoDeCarga` pasa a ser `"aviso" | "orden" | "condicion"`;
  `RUTA_DE.condicion = "/api/seguridad-higiene/condiciones"`;
  `Catalogos` gana `peligros: PeligroDelCatalogo[]`.

- [ ] **Step 1: Escribir los tests del tercer tipo, que fallan**

En `lib/core/colaOffline.test.ts`:

```ts
it("la condición tiene su nombre, su artículo y su concordancia", () => {
  expect(comoSeLlama("condicion")).toBe("Condición insegura");
  expect(conSuArticulo("condicion")).toBe("la condición insegura");
  expect(concordado("condicion", "parad")).toBe("parada");
});

it("la condición va a su ruta de alta", () => {
  expect(RUTA_DE.condicion).toBe("/api/seguridad-higiene/condiciones");
});

it("lee el número de la condición del campo que devuelve su ruta", () => {
  const r = comoContesto("condicion", { status: 200, redirigida: false, cuerpo: { numero: "CI-45" } });
  expect(r.ok).toBe(true);
  expect(r.numero).toBe("CI-45");
});
```

`concordado("condicion", "parad")` tiene que dar `"parada"`: «condición» es
femenino. Hoy esas tres funciones son ternarios binarios (`tipo === "aviso" ? …
: …`), así que el tercer tipo caería en la rama de «orden» por accidente — y en
dos de los tres casos daría una frase correcta, que es exactamente cómo esto se
escapa sin que nadie lo note.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/core/colaOffline.test.ts`
Expected: FAIL

- [ ] **Step 3: Convertir los tres ternarios en mapas**

En `public/cola/colaOffline.js`: `comoSeLlama`, `conSuArticulo` y `concordado`
pasan a leer de un `Record<TipoDeCarga, …>`, igual que `RUTA_DE` y
`CAMPO_DEL_NUMERO`. Un mapa exhaustivo es lo que hace que el cuarto tipo falle
en `tsc` en vez de caer en la rama de otro.

`RUTA_DE` y `CAMPO_DEL_NUMERO` ya son mapas y sólo les falta su entrada:
`condicion: "/api/seguridad-higiene/condiciones"` y `condicion: "numero"`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/core/colaOffline.test.ts`
Expected: PASS

- [ ] **Step 5: Sumar el glosario al catálogo offline**

En `app/cargar/catalogos.ts`: `PeligroDelCatalogo { id, nombre }`, un almacén
nuevo, y la bajada desde `/api/seguridad-higiene/peligros` dentro de
`refrescarCatalogos`, con el mismo patrón que los otros dos (si no vino, queda
lo guardado).

- [ ] **Step 6: Escribir el formulario**

`app/cargar/FormularioCondicionOffline.tsx`, con el mismo contrato que
`FormularioAvisoOffline` (props `catalogos`, `borrador`, `onMandar`). Seis
campos, en este orden: foto, sector o equipo, qué viste, peligro, acción
propuesta, prioridad. La foto se deja para la Tarea 6: acá el campo existe y
está deshabilitado con un cartel que dice que todavía no viaja.

- [ ] **Step 7: La tercera pestaña**

En `CargarClient.tsx:550`, `["aviso", "orden"]` pasa a incluir `"condicion"`, y
la etiqueta sale de `comoSeLlama(tipo)` en vez del ternario de la línea 560 —
que es el mismo error, una vez más.

**Y el permiso**: la tarjeta de condición sólo se muestra si el teléfono tiene
anotado que esta persona puede editar el módulo. Eso se guarda junto con los
catálogos: un campo más en lo que baja `refrescarCatalogos`, leído del mismo
endpoint de peligros (que ya exige el permiso, así que un 403 **es** la
respuesta). Sin esa anotación, no se muestra.

- [ ] **Step 8: Verificar**

Run: `npx tsc --noEmit` ; `npm test`

- [ ] **Step 9: Commit**

---

## Task 6: La foto viaja en la cola

La tarea más riesgosa del plan: toca piezas compartidas con el aviso y la OT,
que hoy andan.

**Files:**
- Modify: `public/cola/colaOffline.js` (`llevaArchivo`)
- Modify: `lib/core/colaOffline.test.ts`
- Modify: `app/cargar/envio.tsx` (`mandarALaRuta`)
- Modify: `public/sw.js:824` (`mandarALaRuta`, la gemela)
- Modify: `app/cargar/FormularioCondicionOffline.tsx`

**Interfaces:**
- Produces: `llevaArchivo(tipo: TipoDeCarga): boolean` en `colaOffline.js`.
- El `cuerpo` de una carga de tipo `condicion` puede tener `foto: Blob | null`.

- [ ] **Step 1: Escribir los tests, que fallan**

```ts
it("sólo la condición lleva archivo", () => {
  expect(llevaArchivo("aviso")).toBe(false);
  expect(llevaArchivo("orden")).toBe(false);
  expect(llevaArchivo("condicion")).toBe(true);
});
```

Y el del Review Focus 3, sobre `clasificarFallo` / `despuesDelIntento`: un 400
por una foto que no entra es **definitivo**, la carga queda parada, y el
mensaje que se guarda tiene que ser el de la ruta sin traducir —el que dice que
la foto pesa 14 MB y el máximo son 10—, porque es lo único que va a leer quien
mire la carga parada y tenga que decidir si vuelve a sacarla.

```ts
it("una foto rechazada deja la carga parada con lo que dijo la ruta", () => {
  const r = despuesDelIntento({ ok: false, status: 400, deLaRuta: true, error: "La foto pesa 14 MB y el máximo son 10." });
  expect(r.estado).toBe("parada");
  expect(r.ultimoError).toBe("La foto pesa 14 MB y el máximo son 10.");
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/core/colaOffline.test.ts`
Expected: FAIL

- [ ] **Step 3: Escribir `llevaArchivo` y las dos ramas de envío**

`llevaArchivo` es un mapa en `colaOffline.js` — **una sola definición**, que es
el invariante de ese archivo: lo que los dos mundos tienen que escribir igual
vive ahí y en ningún otro lado.

Después, en las dos `mandarALaRuta` gemelas (`app/cargar/envio.tsx` y
`public/sw.js:824`), una rama: si `llevaArchivo(tipo)`, el cuerpo va como
`FormData` —los campos y la foto— y **sin** `Content-Type` (lo pone el
navegador, con su boundary); si no, todo sigue exactamente como está.

**La promesa que no se puede romper**: para `aviso` y `orden` el pedido tiene
que salir byte por byte igual que antes. El `if` va alrededor de la construcción
del pedido, no adentro de ella.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/core/colaOffline.test.ts`
Expected: PASS

- [ ] **Step 5: Guardar la foto en la cola**

En el formulario, el archivo se mete en el `cuerpo` como `Blob`. No hace falta
tocar `idb.js`: IndexedDB guarda `Blob` por clonado estructurado, y ese archivo
no tiene decisiones adentro — si hiciera falta un `if`, estaría en el archivo
equivocado.

La ruta de alta tiene que aceptar `multipart/form-data` además de JSON.

**Y acá se cierra el hueco que la Tarea 3 dejó abierto: nadie escribe en
`syh_fotos`.** Hoy `/api/seguridad-higiene/fotos` guarda el archivo y devuelve
`{ruta, link}`, y ahí termina — la foto queda en el bucket sin enlace a ninguna
condición, invisible para la pantalla y para el cron de respaldo, que lee esa
tabla. **El insert en `syh_fotos` es de esta tarea.** Va con el cliente del
usuario, porque su policy exige `respaldada_en_drive_el is null` y que
`subida_por` sea `auth.uid()`.

El caso que hay que no olvidarse, y que es la razón de que esto se escriba acá:
**si la condición ya existía por un reintento** —la rama de idempotencia por
`clave`, cuando el segundo disparo encuentra la fila en vez de crearla— **la
foto tiene que enlazarse igual**. Si sólo se enlaza en el camino de alta nueva,
el segundo disparo sube el archivo y lo pierde, que es exactamente el campo que
no se puede volver a sacar.

- [ ] **Step 5b: Agregar y sacar fotos desde la ficha**

El otro lado del mismo hueco, que tampoco tenía dueño. La spec le da a `edicion`
agregar y sacar fotos de una condición, y las policies `syh_fotos_agregar` y
`syh_fotos_sacar` ya existen desde la Tarea 2 — lo que falta es la pantalla.

No es un extra: **las 44 condiciones que migra la Tarea 9 entran sin foto**,
porque las del Excel son links a un disco. Sin esto, la ficha dice «Esta
condición no tiene fotos» y nadie puede cambiarlo nunca.

Va en `FichaDeCondicion.tsx`. Conviene extraer antes el bloque de fotos a su
propio componente —estado, carga, copiar link—: hoy son unas 60 líneas dentro
de un archivo de 628, y el botón de agregar vive ahí.

- [ ] **Step 6: La prueba de verdad, en un navegador**

Esto no lo prueba vitest. Con `npm run dev`, en el navegador:

1. Cargar una condición con foto **con red** → entra, y la foto se ve.
2. Cortar la red (DevTools → Offline), cargar otra con foto → queda en la cola.
3. Volver la red, abrir la app → se manda sola y la foto llega.
4. Cargar un aviso y una OT sin señal → siguen andando igual que antes.

El paso 4 es el que prueba que no se rompió nada; los otros tres son la
función nueva.

- [ ] **Step 7: Sacar el cartel del formulario**

El campo de foto deja de estar deshabilitado.

- [ ] **Step 8: Verificar y commitear**

Run: `npx tsc --noEmit` ; `npm test`

---

## Task 7: Los dos avisos

**Files:**
- Modify: `lib/home/avisos.ts` (`ConteosParaAvisos`, `AVISOS`)
- Modify: `lib/home/avisosDeUsuario.ts` (los conteos y `QuePuedeAtender`)
- Modify: `lib/home/avisos.test.ts` / el test de `avisosDeUsuario` si existe

**Interfaces:**
- Consumes: `nivelEnModulo()` de `lib/core/access`.
- Produces: dos ids nuevos, `syh-vencidas` y `syh-sin-completar`.

- [ ] **Step 1: Escribir los tests, que fallan**

```ts
it("los dos avisos de Seguridad e Higiene salen con sus títulos y links", () => {
  const avisos = avisosDeConteos({ syhVencidas: 3, syhSinCompletar: 12 });
  expect(avisos).toEqual([
    { id: "syh-vencidas", titulo: "Condiciones inseguras vencidas", cantidad: 3, href: "/seguridad-higiene/condiciones?estado=vencida" },
    { id: "syh-sin-completar", titulo: "Condiciones inseguras sin completar", cantidad: 12, href: "/seguridad-higiene/condiciones?falta=cualquiera" },
  ]);
});

it("los dos van sólo a quien puede evaluar y cerrar", () => {
  const avisos = [{ id: "syh-vencidas", titulo: "x", cantidad: 1, href: "/x" },
                  { id: "syh-sin-completar", titulo: "y", cantidad: 1, href: "/y" }];
  expect(sinLoQueNoPuedeAtender(avisos, { apruebaCompras: true, evaluaSyh: false })).toEqual([]);
  expect(sinLoQueNoPuedeAtender(avisos, { apruebaCompras: true, evaluaSyh: true })).toHaveLength(2);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/home/`
Expected: FAIL

- [ ] **Step 3: Sumar los dos avisos**

En `avisos.ts`: dos claves en `ConteosParaAvisos` y dos entradas en `AVISOS`, al
final. La entrada de `syh-sin-completar` lleva el comentario de por qué es
**una** y no tres: una condición evaluada pero sin responsable ni fecha máxima no
puede vencer nunca y dejaría de ser «sin evaluar», así que con avisos separados
desaparecería de todos para siempre.

En `avisosDeUsuario.ts`, los dos conteos con `contarSiTiene("seguridad_higiene",
…)`. El de vencidas es `head("syh_condiciones").is("fecha_ejecucion",
null).lt("fecha_maxima", hoy)`. El de sin completar necesita contar varias
condiciones `or`, así que va como una consulta propia con `.or(...)` sobre las
columnas nullables — con el comentario de que tiene que decir lo mismo que
`loQueFalta()` de la Tarea 1, que es la versión probada de esa regla.

- [ ] **Step 4: Extender `QuePuedeAtender`**

`evaluaSyh: boolean`, calculado con `nivelEnModulo(quien.rol, quien.grants,
"seguridad_higiene") === "admin"` — **sin consulta nueva**: los grants ya están
en `QuienMira`.

Y actualizar el docstring de `sinLoQueNoPuedeAtender`, que hoy dice «acá no se
filtra por rol ni por nivel». Pasa a: lo que se mira es quién puede **hacer** lo
que el aviso pide, sea una lista de responsables (Compras) o el nivel que
habilita la acción (acá). La razón es la misma y está medida: un push diario
sobre trabajo que uno no tiene permiso de hacer enseña que un aviso tuyo puede
no ser tuyo.

- [ ] **Step 5: Correr y ver que pasan**

Run: `npx vitest run lib/home/`
Expected: PASS

- [ ] **Step 6: Commit**

---

## Task 8: El respaldo en Drive

**Files:**
- Create: `lib/seguridadHigiene/respaldoDeFotos.ts` + su test
- Create: `app/api/cron/syh-respaldo-de-fotos/route.ts`
- Modify: `vercel.json` (el cron)
- Modify: `docs/VARIABLES-VERCEL.md`

**Interfaces:**
- Consumes: `obtenerToken`, `SCOPE_DRIVE`, `mensajeDeGoogle` de
  `lib/core/google.ts`; el patrón de `scripts/backup/subir-a-drive.mts`.
- Produces: `cualesRespaldar(fotos, maximo)` — puro, con test.

- [ ] **Step 1: Test de `cualesRespaldar`**

```ts
it("elige las que nunca se respaldaron, las más viejas primero", () => { /* … */ });
it("no devuelve más que el máximo por corrida", () => { /* … */ });
```

- [ ] **Step 2: Correr, ver que falla, escribir, ver que pasa**

Run: `npx vitest run lib/seguridadHigiene/respaldoDeFotos.test.ts`

- [ ] **Step 3: La ruta del cron**

Baja cada foto de Storage y la sube a `GOOGLE_DRIVE_SYH_FOTOS_FOLDER_ID`,
marcando `respaldada_en_drive_el`. Una por una, con tope por corrida.

El encabezado lleva la advertencia que ya pagó este repo: **la carpeta tiene que
estar en una unidad compartida**. Una cuenta de servicio no tiene cuota de
Drive, y subir a «Mi unidad» de alguien falla con *"Service Accounts do not have
storage quota"* aunque la carpeta esté compartida como editor.

**Si falta la variable, la ruta contesta que falta y no rompe nada**: el
respaldo no bloquea la primera entrega, y `respaldada_en_drive_el` en null es un
estado válido.

- [ ] **Step 4: Documentar la variable y commitear**

`GOOGLE_DRIVE_SYH_FOTOS_FOLDER_ID` en `docs/VARIABLES-VERCEL.md`, con la nota de
la unidad compartida. Avisarle al usuario que tiene que crear la carpeta y poner
la variable en Vercel.

---

## Task 9: Migrar las 44

**Última a propósito**: depende del `.xlsm` y de la carpeta de fotos, que el
usuario está buscando. Si las fotos no aparecen, las 44 entran sin foto y hay
que **decirlo**, no inventar un placeholder.

**Files:**
- Create: `scripts/importar-condiciones-del-excel.mts`
- Create: `lib/seguridadHigiene/filaDelExcel.ts` + su test

**Interfaces:**
- Consumes: `fechaDeSheets()` de `lib/core/fechaDeSheets.ts` si hiciera falta
  interpretar fechas en texto; `guardarFoto()` de `lib/home/fotoDeAvisos.ts`.
- Produces: `sectorDe(texto: string, catalogo: {id: string; nombre: string}[]): string | null`
  y `personaDe(texto: string, usuarios: {id: string; nombre: string}[]): string | null`
  en `lib/seguridadHigiene/filaDelExcel.ts`.

- [ ] **Step 1: Tests de `filaDelExcel`**

Lo único que tiene decisiones es el enlace por texto, y la regla es la del repo:

```ts
it("enlaza un sector cuando el nombre coincide, ignorando ceros y acentos", () => {
  expect(sectorDe("Planta 02", CATALOGO)).toBe(ID_PLANTA_2);
  expect(sectorDe("Planta 2", CATALOGO)).toBe(ID_PLANTA_2);
});

// Enlazar al que se le parece es peor que dejar en null: un enlace equivocado
// no se nota nunca, porque el dato aparece en el lugar que no es.
it("deja en null lo que no reconoce con certeza", () => {
  expect(sectorDe("Deposito abierto", CATALOGO)).toBeNull();
  expect(sectorDe("Cal", CATALOGO)).toBeNull();
});
```

- [ ] **Step 2: Correr, ver que falla, escribir, ver que pasa**

- [ ] **Step 3: El script**

Lee el `.xlsm`, arma las 44 filas, informa **cuántas quedaron sin sector, sin
responsable y sin foto**, y las inserta. `peligro_id` queda en null en las 44: la
planilla no tiene esa columna y deducirla del texto de la descripción es
exactamente el enlace al que se le parece.

Lo último que hace es **escribir la foto de avisos del día** con
`guardarFoto()`. Sin eso, el primer resumen diario anuncia «+35 · Condiciones
inseguras sin completar», una novedad que no pasó.

- [ ] **Step 4: Correrlo y mirar lo que informa**

Es un script de una sola vez: lo que importa es leer su salida, no que termine.
Los números que informa se le pasan al usuario.

- [ ] **Step 5: Verificación final de todo el módulo**

Run, cada uno en su propia línea:

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-responsive.mjs
node scripts/revisar-arbol-commiteado.mjs
```

- [ ] **Step 6: Documentar el módulo en `CLAUDE.md` y commitear**

Una entrada en la tabla de módulos apuntando a la spec, y en la lista de
planillas la línea de que **Seguridad e Higiene no tiene planilla**, como
Ensayos.

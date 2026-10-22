# Avisar sin entrar a Mantenimiento — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para ejecutar este plan tarea por tarea. Los pasos llevan casilla (`- [ ]`) para marcarlos.

**Objetivo:** que cualquier usuario del SdG pueda cargar un aviso de mantenimiento y seguir en qué terminó, sin tener el módulo Mantenimiento.

**Arquitectura:** una pantalla nueva `/mis-avisos` con la forma de `/mis-pedidos`, el alta reusando el modal que ya existe en Mantenimiento, y una columna `area_id` en `avisos` que llenan los **tres** caminos de entrada: el relleno de los 184 que ya están, el alta y la sincronización desde la planilla. La regla de resolución vive en una sola función pura que los tres llaman.

**Stack:** Next.js 16 (App Router), Supabase (PostgREST + RLS), TypeScript, Vitest, Google Sheets API.

**Spec:** [docs/superpowers/specs/2026-10-22-avisos-fuera-de-mantenimiento-design.md](../specs/2026-10-22-avisos-fuera-de-mantenimiento-design.md)

## Restricciones globales

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- Conventional commits en castellano. El cuerpo explica **por qué**, no qué.
- **Nunca `git add -A`.** Hay otra sesión en el árbol (worktree en `.claude/worktrees/pensive-panini-9fca1a`). Agregar por nombre.
- Un desplegable se escribe `<Select>` de `components/Select.tsx`, nunca `<select>` nativo.
- Una grilla de 3+ columnas lleva breakpoint: `grid-cols-1 sm:grid-cols-3`. Ancho útil del teléfono: **343 px**.
- Un ancho nunca va en el `input`: `.input` declara `width: 100%` fuera de capa y le gana a cualquier `w-*`. El ancho va en un `div` que lo envuelva.
- Un `select()` de Supabase va **literal**, no armado en una variable: si no, se pierde la inferencia de tipos.
- Las migraciones llevan marca de tiempo (`npm run migracion "descripcion corta"`) y **las aplica una persona a mano**. Un agente no corre DDL.
- Al escribir en una planilla nada va como texto: `escribirCeldas()` y `agregarFila()` usan `USER_ENTERED`.
- `COL` de `lib/mantenimiento/avisos.ts` es **0-based**: el índice 10 es la columna **K**.

## Dónde mirar al revisar

Cinco cosas que el diseño implica, que ninguna tarea prueba por su cuenta, y que son las que muerden. Cada una tiene su test asignado abajo:

1. **Una persona con dos áreas carga un aviso** → el área queda en null y la pantalla lo dice, nunca adivina una de las dos. Enlazar al que se le parece es peor que dejar en null. (Tarea 1, Tarea 6)
2. **La sincronización corre sobre un aviso que ya tiene área elegida a mano** → no la pisa. Es la diferencia entre "la pantalla anda" y "la pantalla anda hasta la próxima corrida del cron". (Tarea 7)
3. **`quien_aviso` vacío, o con un nombre que no es ningún usuario** → área null, sin error y sin enlace equivocado. 1 de los 184 lo tiene vacío. (Tarea 1)
4. **Dos usuarios cuyos nombres normalizan igual** (sacar acentos convierte `ñ` en `n`) → los dos quedan en null, no gana el primero. (Tarea 1)
5. **La foto se sube con el bucket privado** → se le dice a quien cargó, no se traga el aviso. (Tarea 6)

---

## Estructura de archivos

**Se crean:**
- `lib/mantenimiento/areaDelAviso.ts` — la única regla de "de qué área es un aviso". La llaman el relleno, el alta y la sincronización.
- `lib/mantenimiento/areaDelAviso.test.ts`
- `supabase/migrations/<marca>_avisos_con_area_y_quien_lo_cargo.sql` — RLS + dos columnas.
- `scripts/rellenar-area-de-avisos.mts` — el relleno de los 184. Es DML, así que lo puede correr un agente por PostgREST.
- `app/(app)/mis-avisos/page.tsx` y `app/(app)/mis-avisos/MisAvisosClient.tsx`

**Se modifican:**
- `lib/mantenimiento/avisos.ts` — `filaParaLaPlanilla()` escribe la columna K.
- `lib/mantenimiento/types.ts` — `Aviso` gana `area_id` y `creado_por`.
- `app/api/mantenimiento/fotos/route.ts` — permiso y prefijo.
- `app/api/mantenimiento/avisos/route.ts` — permiso, `area_id`, `creado_por`, foto.
- `app/(app)/mantenimiento/avisos/NuevoAvisoModal.tsx` — quién avisó precargado, área, foto.
- `app/(app)/mantenimiento/avisos/page.tsx` — le pasa al modal las áreas y el usuario.
- `lib/mantenimiento/sincronizar.ts` — `area_id` sólo donde falta.
- `lib/core/nav.ts` — el ítem "Mis avisos".

---

### Tarea 1: La regla de qué área es un aviso

Es el corazón del plan: la misma función la llaman los tres caminos por los que entra un aviso. Se apoya en dos piezas que ya existen y resuelven lo difícil — `claveDeNombre()` / `indiceDeCatalogo()` / `elQueNombra()` de [lib/core/catalogo.ts](../../../lib/core/catalogo.ts), que ya sacan acentos, colapsan espacios y **apagan la clave que empata**, y `areaPorDefecto()` de [lib/compras/areaDelUsuario.ts](../../../lib/compras/areaDelUsuario.ts), que con dos áreas no elige ninguna.

**Archivos:**
- Crear: `lib/mantenimiento/areaDelAviso.ts`
- Test: `lib/mantenimiento/areaDelAviso.test.ts`

**Interfaces:**
- Consume: `indiceDeCatalogo`, `elQueNombra` de `@/lib/core/catalogo`; `areaPorDefecto` de `@/lib/compras/areaDelUsuario`.
- Produce:
  ```ts
  export interface UsuarioConAreas {
    id: string;
    nombre: string;
    apellido: string;
    areas: readonly string[];
  }

  /**
   * Devuelve la función que, dado el texto de `quien_aviso`, dice de qué área
   * es el aviso. `null` cuando no se lo reconoce con certeza.
   */
  export function resolverElArea(
    usuarios: readonly UsuarioConAreas[]
  ): (quienAviso: string | null | undefined) => string | null;
  ```
  Se devuelve un resolvedor y no una función de un solo tiro porque la sincronización la llama 184 veces por corrida y el índice se arma una sola vez.

- [ ] **Paso 1: Escribir el test que falla**

```ts
// lib/mantenimiento/areaDelAviso.test.ts
const USUARIOS = [
  { id: "u-martin", nombre: "Martin", apellido: "Sandoval", areas: ["a-produccion"] },
  { id: "u-luna",   nombre: "Luna",   apellido: "Fourcade", areas: ["a-cantera"] },
  { id: "u-mayra",  nombre: "Mayra",  apellido: "Benitez",  areas: ["a-lab", "a-produccion"] },
];

it("reconoce las cuatro formas en que la planilla escribe el mismo nombre", () => {
  const area = resolverElArea(USUARIOS);
  expect(area("MARTIN SANDOVAL")).toBe("a-produccion");
  expect(area("MARTIN  SANDOVAL")).toBe("a-produccion");   // dos espacios: 15 avisos
  expect(area("Martin Sandoval")).toBe("a-produccion");
  expect(area("Martín  Sandoval")).toBe("a-produccion");   // acento y dos espacios
  expect(area("Luna  Fourcade")).toBe("a-cantera");
});

it("con dos áreas no elige ninguna", () => {
  expect(resolverElArea(USUARIOS)("Mayra Benitez")).toBeNull();
});

it("sin nombre, o con un nombre que no es de nadie, queda en null", () => {
  const area = resolverElArea(USUARIOS);
  expect(area("")).toBeNull();
  expect(area(null)).toBeNull();
  expect(area("Juan Perez")).toBeNull();
});

it("dos usuarios que normalizan igual quedan los dos en null", () => {
  const area = resolverElArea([
    { id: "u-1", nombre: "Ana", apellido: "Núñez", areas: ["a-uno"] },
    { id: "u-2", nombre: "Ana", apellido: "Nunez", areas: ["a-dos"] },
  ]);
  expect(area("Ana Núñez")).toBeNull();
  expect(area("Ana Nunez")).toBeNull();
});
```

- [ ] **Paso 2: Correrlo y verificar que falla**

Run: `npx vitest run lib/mantenimiento/areaDelAviso.test.ts`
Esperado: FAIL, "resolverElArea is not a function" o "Cannot find module".

- [ ] **Paso 3: Implementar `resolverElArea` en `lib/mantenimiento/areaDelAviso.ts`**

El índice se arma con `indiceDeCatalogo(usuarios.map((u) => ({ id: u.id, nombre: \`${u.nombre} ${u.apellido}\` })))`, más un `Map` de id a áreas. El resolvedor pasa por `elQueNombra` y después por `areaPorDefecto`, que devuelve `""` cuando hay cero o dos — eso se convierte a `null`.

El encabezado del archivo tiene que decir **por qué** no se adivina con dos áreas ni con un nombre parecido: un área equivocada no se nota nunca, el aviso simplemente aparece en la pantalla de otro.

- [ ] **Paso 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/mantenimiento/areaDelAviso.test.ts`
Esperado: PASS, 4 tests.

- [ ] **Paso 5: Commitear**

```bash
git add lib/mantenimiento/areaDelAviso.ts lib/mantenimiento/areaDelAviso.test.ts
git commit -m "feat(mantenimiento): la regla de de que area es un aviso"
```

---

### Tarea 2: La migración (la aplica una persona)

**Archivos:**
- Crear: `supabase/migrations/<marca>_avisos_con_area_y_quien_lo_cargo.sql` (con `npm run migracion "avisos con area y quien lo cargo"`)

**Interfaces:**
- Produce: las columnas `avisos.area_id` (FK a `compras_areas`) y `avisos.creado_por` (FK a `usuarios`), y la lectura de `avisos` abierta. Todas las tareas que sigan las dan por existentes.

- [ ] **Paso 1: Escribir la migración**

Tres cosas, en este orden:

```sql
drop policy if exists avisos_read on avisos;
create policy avisos_read on avisos
  for select to authenticated using (true);

alter table public.avisos
  add column if not exists area_id    uuid references compras_areas(id),
  add column if not exists creado_por uuid references usuarios(id);

create index if not exists avisos_area_idx on public.avisos (area_id);
```

No hay función que envolver en el `using`, así que la regla del `(select ...)` no aplica acá. **Las policies de escritura no se tocan**: la ruta de alta inserta con el cliente admin.

El encabezado tiene que dejar escritas las dos cosas que dentro de seis meses van a parecer un descuido:

- Que esto **revierte en parte a la `20260916110349`**, que cerró siete tablas de Mantenimiento justamente porque el asistente de IA hereda lo que dicen las policies. Abrir `avisos` quiere decir que el asistente los va a poder leer. Es deliberado, y es el mismo trato que ya tienen `compras_requerimientos` (migración 018) y `equipos`.
- Que el FK a `compras_areas` **acopla una tabla de Mantenimiento con una de Compras**, porque en los hechos esa tabla ya es un catálogo del núcleo. Moverla al núcleo es un cambio de diseño y no es parte de esto.

Y los `comment on column` de las dos columnas: `creado_por` no reemplaza a `quien_aviso`, que sigue existiendo porque viaja a la columna G de la planilla y porque la planilla la sigue llenando gente desde el Forms.

- [ ] **Paso 2: Pedirle al usuario que la aplique y esperar**

Decirle textualmente que hacen falta **dos** pasos manuales y que conviene darlos juntos:
1. correr la migración en el editor SQL de Supabase;
2. **hacer público el bucket `execution-photos`** (hoy es `public: false`), o la foto va a quedar con un link firmado que vence en un año y que no se abre desde la planilla.

No seguir a la Tarea 3 hasta que confirme el primero.

- [ ] **Paso 3: Commitear**

```bash
git add supabase/migrations/<marca>_avisos_con_area_y_quien_lo_cargo.sql
git commit -m "feat(mantenimiento): avisos gana area y quien lo cargo, y se puede leer"
```

---

### Tarea 3: Rellenar el área de los 184 que ya están

**Archivos:**
- Crear: `scripts/rellenar-area-de-avisos.mts`

**Interfaces:**
- Consume: `resolverElArea` de la Tarea 1; `traerTodo` de `@/lib/core/paginado`.

Es DML, así que lo corre el agente por PostgREST. Sigue la convención de los scripts del repo: sin argumentos dice qué haría, con `--aplicar` escribe (ver `scripts/restaurar-equipo-de-seis-ot.mts`).

- [ ] **Paso 1: Escribir el script**

Lee `usuarios` (id, nombre, apellido, activo) y `usuario_areas_compras`, arma el resolvedor, trae los avisos con `traerTodo()` y para cada uno con `area_id` en null resuelve desde `quien_aviso`. Imprime cuántos quedarían con área y cuántos sin, **y la lista de los nombres que no resolvió**, que es lo accionable: un nombre que no existe se arregla distinto que uno ambiguo.

Uso en el encabezado:
```
npx tsx scripts/rellenar-area-de-avisos.mts            ← dice qué haría
npx tsx scripts/rellenar-area-de-avisos.mts --aplicar
```

- [ ] **Paso 2: Correrlo en seco y comprobar el número**

Run: `npx tsx scripts/rellenar-area-de-avisos.mts`
Esperado: **165 con área, 19 sin**. Si da otro número, la normalización no hace lo que dice y hay que volver a la Tarea 1 antes de escribir nada.

Entre los 19 tienen que aparecer Francisco Varela (9 avisos) y Maximiliano Lenzetti (2): son usuarios activos **sin área cargada**, no un fallo del código.

- [ ] **Paso 3: Aplicarlo**

Run: `npx tsx scripts/rellenar-area-de-avisos.mts --aplicar`
Esperado: 165 filas actualizadas.

- [ ] **Paso 4: Commitear**

```bash
git add scripts/rellenar-area-de-avisos.mts
git commit -m "feat(mantenimiento): rellenar el area de los 184 avisos que ya estaban"
```

---

### Tarea 4: La foto viaja a la planilla

Hoy `filaParaLaPlanilla()` llena el array hasta la L y **no escribe la K, que es la imagen**. Una foto cargada en la app que no llegue ahí no existe para quien mira la planilla, y además la próxima sincronización la lee vacía y pisa lo que había.

**Archivos:**
- Modificar: `lib/mantenimiento/avisos.ts` (`filaParaLaPlanilla`)
- Test: `lib/mantenimiento/avisos.test.ts` (ya existe)

**Interfaces:**
- Produce: `filaParaLaPlanilla()` acepta además `reference_photos?: readonly string[] | null`.

- [ ] **Paso 1: Escribir el test que falla**

```ts
it("la foto va a la columna K y no corre de lugar a las observaciones", () => {
  const fila = filaParaLaPlanilla({
    oa_number: "A185",
    descripcion: "pierde aceite",
    observaciones: "avisado al jefe",
    reference_photos: ["https://ejemplo/foto.jpg"],
  });
  expect(fila[10]).toBe("https://ejemplo/foto.jpg");   // COL.imagen = K
  expect(fila[11]).toBe("avisado al jefe");            // COL.observaciones = L
});

it("sin foto, la K queda vacía", () => {
  expect(filaParaLaPlanilla({ oa_number: "A186" })[10]).toBe("");
});
```

- [ ] **Paso 2: Correrlo y verificar que falla**

Run: `npx vitest run lib/mantenimiento/avisos.test.ts`
Esperado: FAIL en el primero, `fila[10]` es `""`.

- [ ] **Paso 3: Escribir `fila[COL.imagen]` en `filaParaLaPlanilla`**

La primera foto, o `""`. `COL.imagen` es 10 y eso es la **K** — comprobar el encabezado de esa columna en la planilla real antes de dar esto por bueno. El 21/10/2026 un script escribió en la G creyendo que era la F y seis OT quedaron con el equipo equivocado.

- [ ] **Paso 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/mantenimiento/avisos.test.ts`
Esperado: PASS.

- [ ] **Paso 5: Commitear**

```bash
git add lib/mantenimiento/avisos.ts lib/mantenimiento/avisos.test.ts
git commit -m "fix(mantenimiento): la foto del aviso viaja a la columna K de la planilla"
```

---

### Tarea 5: Las dos rutas se abren

**Archivos:**
- Modificar: `app/api/mantenimiento/fotos/route.ts`
- Modificar: `app/api/mantenimiento/avisos/route.ts`
- Modificar: `lib/mantenimiento/types.ts` (`Aviso` gana `area_id: string | null` y `creado_por: string | null`)

**Interfaces:**
- Consume: `resolverElArea` (Tarea 1).
- Produce: `POST /api/mantenimiento/avisos` acepta en el cuerpo `area_id?: string | null` y `reference_photos?: string[]`. `POST /api/mantenimiento/fotos` acepta el campo de formulario `aviso` además de `ot`.

- [ ] **Paso 1: Abrir `POST /api/mantenimiento/fotos`**

Reemplazar el chequeo de `puedeEditarMantenimiento` por el mismo que usa el alta de un RI en `app/api/compras/requerimientos/route.ts:55-63`: leer `usuarios.activo` y devolver 403 con *"Tu usuario está desactivado"* si no lo está. El 401 por falta de sesión queda igual.

Y el prefijo: si viene el campo `aviso`, la ruta es `avisos/<oa>/<timestamp>.<ext>`; si viene `ot`, queda como está. Un aviso no es una orden, y dentro de seis meses `ordenes/sin-ot/` no le va a decir nada a nadie.

De paso, cerrar una inconsistencia que con la foto como función se vuelve visible: la ruta acepta `image/heif` en su lista `TIPOS` pero el bucket no lo tiene en `allowed_mime_types`, así que una foto HEIF pasa el chequeo de la ruta y la rechaza Storage con un 502 que no explica nada. Se arregla de cualquiera de los dos lados; sacarlo de `TIPOS` es el que no necesita a una persona.

- [ ] **Paso 2: Abrir `POST /api/mantenimiento/avisos`**

El mismo cambio de permiso. **Ojo con el orden:** el 403 actual llama a `avisarDeLaCarga(...)` antes de contestar, porque a quien cargó sin señal hay que avisarle por correo qué pasó. Ese camino se conserva con el texto nuevo.

- [ ] **Paso 3: Resolver `area_id` y `creado_por` en el insert**

`creado_por` es siempre `user.id`.

`area_id` sale del cuerpo si viene. **Si no viene, la ruta lo resuelve con `resolverElArea`, y sólo cuando la persona tiene exactamente un área** — con cero o con dos queda en null.

**`area_id` NO puede ser obligatorio.** `app/cargar/FormularioAvisoOffline.tsx` postea a esta misma ruta y no sabe nada de áreas, y **para la cola de cargas sin señal un 400 es definitivo**: el aviso quedaría parado para siempre por un campo que su propio formulario no tiene. Lo mismo vale para el asistente, que arma una URL con valores iniciales.

- [ ] **Paso 4: Pasarle la foto a la planilla**

`reference_photos` del cuerpo entra en el objeto `aviso` que va a `filaParaLaPlanilla()` (Tarea 4) **y** en el insert. La planilla se escribe primero, como hoy.

- [ ] **Paso 5: Verificar que compila y que nada se rompió**

Run: `npx tsc --noEmit && npm test`
Esperado: sin errores; la suite en verde.

- [ ] **Paso 6: Commitear**

```bash
git add app/api/mantenimiento/fotos/route.ts app/api/mantenimiento/avisos/route.ts lib/mantenimiento/types.ts
git commit -m "feat(mantenimiento): avisar y subir la foto dejan de pedir el modulo"
```

---

### Tarea 6: El modal pregunta el área y saca la foto

Se reusa `NuevoAvisoModal`, no se escribe un segundo formulario: dos copias van a decir cosas distintas dentro de tres meses. Es lo mismo que hace "Mis pedidos", que importa `NuevoRequerimientoModal` desde la carpeta de Compras.

**Archivos:**
- Modificar: `app/(app)/mantenimiento/avisos/NuevoAvisoModal.tsx`
- Modificar: `app/(app)/mantenimiento/avisos/page.tsx` (pasarle las props nuevas)

**Interfaces:**
- Produce: `NuevoAvisoModal` suma las props
  ```ts
  quienAviso?: string;                              // "Nombre Apellido" de la sesión
  areas: { id: string; nombre: string }[];          // las 9 de compras_areas
  areaInicial?: string;                             // "" si tiene cero o dos
  ```

- [ ] **Paso 1: Precargar quién avisó**

El campo arranca con el nombre y apellido de quien tiene la sesión, **editable**: Martín carga lo que le cuentan los de Producción y a veces el que vio la falla es otro. Precargado es lo que corta la quinta ortografía de "Martín Sandoval" — hoy hay cuatro.

- [ ] **Paso 2: El área**

Un `<Select>` (nunca `<select>`) con las 9 áreas. Arranca en `areaInicial`. **Si viene vacío —cero áreas o dos— hay que elegirla, y el cartel dice por qué**, como hace "Mis pedidos" con quien no tiene área. Con dos no se adivina: `usuario_areas_compras` existe justamente porque una persona puede cubrir más de una.

- [ ] **Paso 3: La foto**

Un input de archivo que sube a `/api/mantenimiento/fotos` con el campo `aviso`, y manda el link devuelto en `reference_photos`. Si la respuesta trae `publica: false`, **mostrar el texto que la ruta devuelve en `aviso`** tal cual, sin traducir: dice que el link no se abre desde la planilla y que el bucket tiene que ser público. Una foto que sólo sirve adentro del sistema es media foto, y enterarse en silencio es peor.

- [ ] **Paso 4: Comprobar que entra en un teléfono**

Run: `node scripts/revisar-responsive.mjs`
Esperado: ROMPE 0 · APRETADO 0 · MIRAR 0. Cualquier cosa que aparezca es de lo que se acaba de escribir.

- [ ] **Paso 5: Commitear**

```bash
git add "app/(app)/mantenimiento/avisos/NuevoAvisoModal.tsx" "app/(app)/mantenimiento/avisos/page.tsx"
git commit -m "feat(mantenimiento): el alta de un aviso pregunta el area y saca la foto"
```

---

### Tarea 7: La sincronización también pone el área

**Ésta es la tarea que decide si la pantalla sigue sirviendo dentro de una semana.** El Forms sigue prendido un tiempo, y `sincronizarAvisos()` arma su payload con `filaDeAviso()` más `{equipment_id, sector_id, synced_at}`: no sabe nada de áreas, y la planilla no tiene columna de dónde leerla. Sin esto, **todo lo que llegue del Forms a partir de mañana cae con `area_id` en null** y no aparece en la pantalla de nadie.

**Archivos:**
- Modificar: `lib/mantenimiento/sincronizar.ts` (`sincronizarAvisos`, alrededor de la línea 214)
- Test: `lib/mantenimiento/areaDelAviso.test.ts`

**Interfaces:**
- Consume: `resolverElArea` (Tarea 1).
- Produce:
  ```ts
  /**
   * Qué `area_id` le toca a una fila que llega de la planilla. `undefined`
   * quiere decir "no mandes la columna": el upsert escribe todo lo que esté en
   * el payload, así que mandar null pisaría el área elegida a mano.
   */
  export function areaParaElUpsert(
    areaGuardada: string | null | undefined,
    areaResuelta: string | null
  ): string | undefined;
  ```

- [ ] **Paso 1: Escribir el test que falla**

```ts
it("no pisa el área que ya tiene el aviso", () => {
  expect(areaParaElUpsert("a-produccion", "a-cantera")).toBeUndefined();
  expect(areaParaElUpsert("a-produccion", null)).toBeUndefined();
});

it("completa la que falta, y si no la resuelve no manda la columna", () => {
  expect(areaParaElUpsert(null, "a-cantera")).toBe("a-cantera");
  expect(areaParaElUpsert(null, null)).toBeUndefined();
});
```

- [ ] **Paso 2: Correrlo y verificar que falla**

Run: `npx vitest run lib/mantenimiento/areaDelAviso.test.ts`
Esperado: FAIL, "areaParaElUpsert is not a function".

- [ ] **Paso 3: Implementar `areaParaElUpsert` en `lib/mantenimiento/areaDelAviso.ts`**

- [ ] **Paso 4: Usarla en `sincronizarAvisos`**

Antes del bucle: leer `usuarios` + `usuario_areas_compras` una sola vez por corrida y armar el resolvedor, y traer las áreas que ya tienen los avisos de la planilla (`oa_number`, `area_id`). Dentro del bucle, agregar `area_id` al registro **sólo cuando `areaParaElUpsert` devuelve algo** — con `undefined` la columna no va al payload.

El comentario al lado tiene que decir por qué, porque el día que alguien "simplifique" esto a un `area_id: x ?? null` el bug vuelve y es silencioso: el upsert de PostgREST escribe todas las columnas presentes, así que un null pisaría el área que alguien eligió en el modal o corrigió a mano.

- [ ] **Paso 5: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/mantenimiento/areaDelAviso.test.ts && npx tsc --noEmit`
Esperado: PASS; sin errores de tipos.

- [ ] **Paso 6: Commitear**

```bash
git add lib/mantenimiento/sincronizar.ts lib/mantenimiento/areaDelAviso.ts lib/mantenimiento/areaDelAviso.test.ts
git commit -m "fix(mantenimiento): la sincronizacion completa el area sin pisar la elegida a mano"
```

---

### Tarea 8: La pantalla

**Archivos:**
- Crear: `app/(app)/mis-avisos/page.tsx`
- Crear: `app/(app)/mis-avisos/MisAvisosClient.tsx`
- Modificar: `lib/core/nav.ts`

**Interfaces:**
- Consume: `finalDelAviso()` de `@/lib/mantenimiento/desestimarAviso` — ya existe, con sus tests, incluida la regla de que tener OT le gana a estar desestimado. **No se escribe una segunda copia.**
- Consume: `NuevoAvisoModal` con las props de la Tarea 6.

- [ ] **Paso 1: El ítem del menú**

En `lib/core/nav.ts`, **sin `modulo`**, pegado debajo de `{ label: "Mis pedidos", href: "/mis-pedidos" }`:

```ts
{ label: "Mis avisos", href: "/mis-avisos" },
```

Con el comentario que explique por qué no lleva módulo, en la misma línea que el de "Mis pedidos": contar que una máquina anda mal no compromete nada; decidir qué se hace con eso sí, y eso queda adentro de Mantenimiento.

- [ ] **Paso 2: La página servidor**

Copia la forma de `app/(app)/mis-pedidos/page.tsx`: resuelve la sesión, trae **sólo los catálogos chicos** —las 9 áreas, los equipos y sectores para el modal— y las áreas de esta persona desde `usuario_areas_compras`. Los avisos los trae el cliente.

- [ ] **Paso 3: El cliente**

Copia la forma de `MisPedidosClient`: estado `"mios" | "todos"`, arranca en `"mios"` salvo que la persona no tenga área —ahí abre en todos y el cartel explica qué falta—, búsqueda con espera de 350 ms, paginado de 50, y `useCargar` para descartar la respuesta que llega tarde.

Columnas: **N° OA, fecha, qué pasa, equipo, área, quién avisó, urgencia y en qué terminó.** La urgencia viene con emoji desde la planilla —`🟡 Media` (102), `🟠 Alta` (57), `🟢 Baja` (24)—, así que las opciones del filtro salen de los datos y no de una lista fija, igual que hace `AvisosClient`.

"En qué terminó" sale de `finalDelAviso()`. **El número de OT se linkea sólo para quien tenga el módulo Mantenimiento** — `/mantenimiento/ordenes` rebota a `/` a quien no lo tenga, que son 10 de los 14 usuarios y justo los destinatarios de esta pantalla. Quien no lo tenga ve el número pelado. El layout ya sabe quién tiene qué; se le pasa como prop desde la página.

Lo que **no** se muestra: generar la OT, desestimar y sincronizar siguen viviendo en `/mantenimiento/avisos`, que es de quien es la decisión. Acá se avisa y se mira en qué terminó.

- [ ] **Paso 4: Verificar todo**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-responsive.mjs
```
Esperado: suite en verde, sin errores de tipos, build limpio, responsive en ROMPE 0. **Parar `npm run dev` antes del build**, o la app queda en 500.

- [ ] **Paso 5: Commitear y comprobar el árbol**

```bash
git add "app/(app)/mis-avisos/page.tsx" "app/(app)/mis-avisos/MisAvisosClient.tsx" lib/core/nav.ts
git commit -m "feat(mantenimiento): Mis avisos, para avisar sin tener el modulo"
node scripts/revisar-arbol-commiteado.mjs
```

`revisar-arbol-commiteado` es el que atrapa lo que los otros no pueden: con dos archivos nuevos y commits por nombre, uno que quede *staged* y sin commitear no viaja a Vercel y nada avisa.

---

## Al terminar

Decirle al usuario las dos cosas que no puede ver el código:

- **A Francisco Varela y a Maximiliano Lenzetti les falta el área** en Administración → Usuarios. Son 11 avisos que van a seguir entrando sin área, y no es un error del sistema.
- Si todavía no hizo público el bucket `execution-photos`, la foto entra pero su link vence en un año y no se abre desde la planilla.

Y correr `npm run planillas` una vez: esto le agregó una columna a una escritura y es el único chequeo que mira el dato del otro lado. Hoy da ROMPE 0 · MIRAR 21.

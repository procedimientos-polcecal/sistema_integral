# Crear una OS desde el sistema, y enlazarla con su OT — Plan de implementación

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: usar
> `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans` para implementarlo tarea por tarea. Los pasos
> llevan casilla (`- [ ]`) para ir marcándolos.

**Goal:** que una orden de servicio se pueda crear desde el SdG, que caiga en la
planilla con su número como si la hubiera pedido el formulario, y que las OS y
las OT queden enlazadas en los dos sentidos.

**Architecture:** el alta escribe en la pestaña `Altas del sistema` del libro de
respuestas del formulario de OS, y el master apila esa pestaña con la del
formulario ordenando por N° de OS. Es exactamente lo que ya hace el alta de OT,
así que `lib/mantenimiento/formularioDeOS.ts` es el hermano de
`lib/mantenimiento/formulario.ts` y **reusa de él lo que es genérico**
(`laSerieEstaCongelada`, `maximoDeLaSerie`, `laFilaEstaLibre`). El enlace es una
columna `os_id` en `ordenes_trabajo`.

**Tech Stack:** Next.js 16 (App Router), Supabase, Google Sheets API vía
`lib/core/sheets.ts`, vitest.

**Spec:** [docs/superpowers/specs/2026-11-19-mantenimiento-crear-una-os-desde-el-sistema-design.md](../specs/2026-11-19-mantenimiento-crear-una-os-desde-el-sistema-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Nunca `git add -A`**: se commitea nombrando los archivos. Suele haber otra
  sesión en el mismo árbol.
- La planilla **manda**: se escribe primero allá y después en la base. Si la
  planilla rechaza, no se guarda nada.
- Un fallo de escritura se guarda y se muestra **con lo que dijo Google, sin
  traducir**. Nunca un `console.warn`.
- Al escribir, **nada va como texto**: `USER_ENTERED`, la fecha como serial con
  `serialDelDia()`, los números como número. La prosa pasa por
  `textoParaLaCelda()`.
- Un desplegable se escribe `<Select>`, no `<select>`.
- Una grilla de tres columnas lleva breakpoint: `grid-cols-1 sm:grid-cols-3`.
- Un ancho no va suelto al lado de `.input`: va en un `div` que lo envuelva.
- Verificación: `npm test`, `npm run tipos`, `npm run build`,
  `node scripts/revisar-arbol-commiteado.mjs`, `node scripts/revisar-responsive.mjs`,
  `node scripts/revisar-exportaciones.mjs`.
- La migración la aplica **una persona** en el editor SQL de Supabase. Se escribe
  con `npm run migracion "descripcion corta"` y se queda a la espera.
- Valores fijados por el spec: pestañas `Respuestas de formulario 1` y
  `Altas del sistema`; libro `1qEar7UpLUFQzjs-nmR-U_oKatNrMdcF8wawjulFw8CY`;
  variable `GOOGLE_SHEETS_OS_FORMULARIO_ID`; columnas de equipo `G`…`T`;
  columna `Y` = correos, **no se escribe**; `J`/`K`/`L` del master a mano.

## Review Focus

Lo que el spec implica, ninguna tarea ejercita sola, y le va a morder a alguien.
Cada línea tiene su test en la tarea que posee el código.

1. **Dos altas a la vez toman el mismo número.** Dos personas creando una OS en
   el mismo minuto leen la misma columna y calculan la misma fila libre. Lo
   frena `laFilaEstaLibre` releyendo la celda justo antes de escribir, como en
   OT. → Tarea 2.
2. **Un sector sin columna de equipo.** Las catorce columnas cubren lo que el
   formulario ofrece hoy; una OS de un sector nuevo no tendría dónde poner el
   equipo. Tiene que negarse con el nombre del sector, no escribir en la
   columna de otro. → Tarea 1.
3. **La planilla está calculando.** `leerValores()` ya corta solo, pero el alta
   lee con `leerFormulas`: tiene que dar un error que se distinga de «la hoja
   está vacía». → Tarea 2.
4. **El `IMPORTRANGE` nunca derrama.** Si el master no trae la fila, el drenaje
   de `J`/`K` se queda sin dónde escribir y hoy eso se perdería en silencio.
   Tiene que quedar anotado como pendiente. → Tarea 5.
5. **La descripción empieza con `=`.** `USER_ENTERED` la convertiría en fórmula;
   es lo que dejó once pestañas de Compras en blanco. → Tarea 1.

---

## Antes de la primera tarea: los pasos que hace una persona

Ninguna tarea de código puede ejercitarse de verdad hasta que estén. El código
se escribe igual —las tareas 1 a 3 no tocan la planilla—, pero la 4 en adelante
no se puede probar contra Google sin esto.

- [ ] **P1.** Borrar el `.` suelto de `S13` en `Respuestas de formulario 1`.
- [ ] **P2.** Congelar la columna `A` de `Respuestas de formulario 1`: pegarla
      como sólo valores (280 números, filas 4 a 283).
- [ ] **P3.** En la misma sentada que P2, instalar el Apps Script que numera
      cada respuesta nueva con **el máximo de las dos pestañas más uno**,
      partiendo de `docs/mantenimiento-formulario-apps-script.gs`.
- [ ] **P4.** Reemplazar las tres fórmulas del master (`A2`, `E2`, `F2`) por las
      que apilan las dos pestañas con `ORDER BY`, **después de probarlas en
      pestañas temporales** (Tarea 4).
- [ ] **P5.** Cargar `GOOGLE_SHEETS_OS_FORMULARIO_ID` en los tres entornos de
      Vercel. Ojo: **la toma el próximo deploy, no el que está corriendo**.
- [ ] **P6.** Aplicar la migración de la Tarea 3 en el editor SQL de Supabase.

---

## Estructura de archivos

| Archivo | De qué se ocupa |
|---|---|
| `lib/mantenimiento/formularioDeOS.ts` | **Nuevo.** Lo puro del alta de OS: columnas, serie, celdas. Reusa de `formulario.ts` lo genérico |
| `lib/mantenimiento/formularioDeOS.test.ts` | **Nuevo.** Los tests de lo anterior |
| `lib/mantenimiento/altaDeOS.ts` | **Nuevo.** Lo que habla con Google: leer la serie y escribir la fila |
| `app/api/mantenimiento/ordenes-servicio/route.ts` | **Modificar.** Suma el `POST` |
| `app/api/mantenimiento/ordenes-servicio/[id]/ot/route.ts` | **Nuevo.** Enlazar y desenlazar una OT |
| `app/(app)/mantenimiento/ordenes-servicio/NuevaOS.tsx` | **Nuevo.** El formulario de alta |
| `app/(app)/mantenimiento/ordenes-servicio/DetalleOS.tsx` | **Modificar.** Las OT de esta OS |
| `app/(app)/mantenimiento/ordenes/[numero]/…` | **Modificar.** La OS de esta OT |
| `supabase/migrations/<ts>_ot_apunta_a_su_os.sql` | **Nuevo.** La columna `os_id` |
| `scripts/probar-las-formulas-del-master-de-os.mts` | **Nuevo.** Prueba las tres fórmulas en pestañas temporales |
| `docs/VARIABLES-VERCEL.md`, `docs/MANTENIMIENTO-INTEGRACION.md` | **Modificar.** La variable nueva y el párrafo que decía que no se podía |

---

### Tarea 1: Lo puro del alta de OS

**Files:**
- Create: `lib/mantenimiento/formularioDeOS.ts`
- Test: `lib/mantenimiento/formularioDeOS.test.ts`

**Interfaces:**
- Consumes: de `lib/mantenimiento/formulario.ts`, `laSerieEstaCongelada()`,
  `maximoDeLaSerie()`, `laFilaEstaLibre()` y el tipo `Celda` — son genéricos y
  no se reescriben. De `lib/core/sheets.ts`, `serialDelDia()` y
  `textoParaLaCelda()`.
- Produces:
  - `HOJA_DE_RESPUESTAS_OS = "Respuestas de formulario 1"`
  - `HOJA_DE_ALTAS_OS = "Altas del sistema"`
  - `COLUMNA_DE_EQUIPO_POR_SECTOR: Record<string, string>` — sector normalizado
    → letra, `G`…`T`
  - `columnaDeEquipo(sector: string): { ok: true; columna: number } | { ok: false; error: string }`
  - `interface DatosDelAltaDeOS { fecha: Date; area: string; sector: string; equipo: string; descripcion: string; fechaRequerimiento: string | null; detalleExtra: string | null }`
  - `celdasDelAltaDeOS(datos: DatosDelAltaDeOS, osNumber: number): { ok: true; celdas: Celda[] } | { ok: false; error: string }`
  - `loQueSigueEnLaSerieDeOS(serieDelFormulario, serieDeLasAltas): { ok: true; os_number: number; fila: number } | { ok: false; error: string }`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("columnaDeEquipo", () => {
  it("manda cada sector a su columna", () => {
    expect(columnaDeEquipo("Planta filler 2")).toEqual({ ok: true, columna: 14 }); // O
    expect(columnaDeEquipo("Despacho")).toEqual({ ok: true, columna: 16 });        // Q
  });
  it("ignora acentos y mayusculas, como el resto del modulo", () => {
    expect(columnaDeEquipo("PLANTA DE TRITURACION 3")).toEqual({ ok: true, columna: 9 }); // J
  });
  it("se niega con el nombre del sector cuando no tiene columna", () => {
    const r = columnaDeEquipo("Sector nuevo");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("Sector nuevo");
  });
});

describe("celdasDelAltaDeOS", () => {
  it("escribe la fecha como serial y el numero como numero", () => { /* A y B */ });
  it("pone el equipo en la columna del sector y en ninguna otra", () => { /* G..T */ });
  it("no escribe nunca la columna Y, que son correos", () => { /* ninguna celda con columna 24 */ });
  it("protege una descripcion que arranca con =", () => {
    const r = celdasDelAltaDeOS({ ...base, descripcion: "=IMPORTRANGE(…)" }, 281);
    expect(celda(r, 20).valor).toBe("'=IMPORTRANGE(…)");
  });
});

describe("loQueSigueEnLaSerieDeOS", () => {
  it("toma el maximo de las dos pestanas mas uno", () => { /* 280 y 0 → 281 */ });
  it("se niega mientras la columna A siga siendo una formula", () => {
    const r = loQueSigueEnLaSerieDeOS([["=IF(B:B<>\"\";A282+1;\"\")"]], [[]]);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/formularioDeOS.test.ts`
Expected: FAIL, el módulo no existe.

- [ ] **Step 3: Escribir `lib/mantenimiento/formularioDeOS.ts`**

El mapa sector→columna sale de la tabla del spec. Se compara **normalizado**,
con `normalizar()` de `lib/mantenimiento/planilla.ts`, por lo mismo que
`pestanaDeSector`: las OS escriben el sector a mano.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/formularioDeOS.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/formularioDeOS.ts lib/mantenimiento/formularioDeOS.test.ts
git commit -F - <<'EOF'
feat(mantenimiento): lo puro del alta de una OS en la planilla del formulario
EOF
```

---

### Tarea 2: La escritura en la planilla

**Files:**
- Create: `lib/mantenimiento/altaDeOS.ts`
- Test: `lib/mantenimiento/altaDeOS.test.ts`

**Interfaces:**
- Consumes: todo lo de la Tarea 1; de `lib/core/sheets.ts`, `leerFormulas()`,
  `escribirCeldas()` y `estaCalculando()`.
- Produces:
  - `altaDeOSEnLaPlanilla(datos: DatosDelAltaDeOS): Promise<{ ok: true; os_number: number; fila: number } | { ok: false; error: string }>`
  - `maximoDeLaSerieDeOSEnLaPlanilla(): Promise<number | null>`

Es el gemelo de `altaEnLaPlanilla()` de `formulario.ts`, con tres diferencias:
la variable de entorno, el nombre de la pestaña del formulario (lleva ` 1`) y
que la fila se arma con `celdasDelAltaDeOS`. **Leer esa función entera antes de
escribir ésta.**

- [ ] **Step 1: Escribir los tests que fallan** — sobre lo que decide, con
      `leerFormulas` y `escribirCeldas` mockeados:

```ts
it("no escribe si entre leer y escribir alguien tomo la fila", async () => { /* laFilaEstaLibre false → ok:false, y escribirCeldas no se llamo */ });
it("dice que falta la variable con su nombre", async () => { /* error contiene GOOGLE_SHEETS_OS_FORMULARIO_ID */ });
it("distingue una planilla calculando de una hoja vacia", async () => { /* estaCalculando → error propio */ });
it("devuelve lo que dijo Google sin traducir", async () => { /* el mensaje del throw aparece en error */ });
```

- [ ] **Step 2: Correr y ver que fallan.** → FAIL.
- [ ] **Step 3: Escribir `lib/mantenimiento/altaDeOS.ts`.**
- [ ] **Step 4: Correr y ver que pasan.** → PASS.
- [ ] **Step 5: Commit** (`feat(mantenimiento): escribir el alta de una OS en Altas del sistema`).

---

### Tarea 3: La columna `os_id`

**Files:**
- Create: `supabase/migrations/<timestamp>_ot_apunta_a_su_os.sql`
- Modify: `lib/mantenimiento/types.ts` (`OrdenTrabajo`, sumar `os_id: string | null`)

- [ ] **Step 1: Crear la migración**

Run: `npm run migracion "ot apunta a su os"`

- [ ] **Step 2: Escribirla**

`alter table public.ordenes_trabajo add column os_id uuid references
public.ordenes_servicio(id) on delete set null;` más su índice. El encabezado
explica **por qué `set null`**: el borrado de espejo se lleva la OS cuando
desaparece de la planilla, y eso no es razón para llevarse la OT.

No hace falta policy nueva: es una columna de una tabla que ya tiene las suyas.

- [ ] **Step 3: Sumar `os_id` al tipo `OrdenTrabajo`.**
- [ ] **Step 4: `npm run tipos`** → sin errores.
- [ ] **Step 5: Commit** y **avisar al usuario que hay una migración por aplicar**.
      Hasta que la aplique, **ninguna cadena `select()` puede nombrar `os_id`**:
      nombrarla rompe lo que ya andaba.

---

### Tarea 4: Probar las tres fórmulas del master

**Files:**
- Create: `scripts/probar-las-formulas-del-master-de-os.mts`

No tiene test: es el script que prueba. Lo que hace, en pestañas **temporales**
del libro de respuestas, creadas y borradas en la misma pasada:

- [ ] **Step 0: Comprobar el encabezado de `Altas del sistema`** columna por
      columna contra el de `Respuestas de formulario 1`. Si no coinciden, lo que
      se escriba va a aterrizar en la columna de otra cosa y nada lo va a
      avisar. El script se niega y dice cuáles difieren.
- [ ] **Step 1: Comprobar que la serie es ascendente** en `Respuestas de
      formulario 1`. Si no lo fuera, el `ORDER BY` correría las 280 filas del
      master debajo de los literales `J`/`K`/`L`, que es el anti-objetivo. El
      script **se niega** y lo dice.
- [ ] **Step 2: Escribir las tres fórmulas candidatas** en una pestaña temporal
      y leer el resultado.
- [ ] **Step 3: Comparar contra lo que hay hoy en `SERVICIOS`**, OS por OS. Lo
      esperado: idéntico en las 280 salvo la **OS 14**, que hoy dice `.` y
      tiene que pasar a vacía.
- [ ] **Step 4: Correrlo** y pegar la salida en el mensaje al usuario, que es
      quien pega las fórmulas (P4).
- [ ] **Step 5: Commit.**

---

### Tarea 5: El `POST` de la ruta, con el aviso y el drenaje

**Files:**
- Modify: `app/api/mantenimiento/ordenes-servicio/route.ts`

**Interfaces:**
- Consumes: `altaDeOSEnLaPlanilla()` (Tarea 2); `puedeEditarMantenimiento()`;
  `avisarAQuienDecide()` de `lib/core/avisoAlInstante.ts`;
  `escribirEnLaFilaDeLaOS()` de `lib/mantenimiento/planillaDeOS.ts`.

- [ ] **Step 1: El `POST`.** Pide **nivel de edición en Mantenimiento**. Valida
      con `validar()` de `lib/core/validar.ts`: área, sector, equipo y
      descripción obligatorios. **Primero la planilla**: si
      `altaDeOSEnLaPlanilla` devuelve `ok: false`, contesta 502 con ese error y
      **no inserta nada**.
- [ ] **Step 2: El insert.** Con `sheets_tab: "SERVICIOS"`, `sheets_row: null`,
      `app_created: true`, `estado: null`. El `sheets_tab` es lo que la hace
      aparecer en Compras → Aprobaciones en el acto; el `sheets_row` en null es
      lo que la protege del borrado de espejo.
- [ ] **Step 3: El aviso.** `avisarAQuienDecide()` con la lista
      `"os_aprobadores"` y la etiqueta `OS <n>`. No es un emisor nuevo: es el
      portón que ya existe. La sincronización no lo va a duplicar porque filtra
      con `!yaEstaban.has(os_number)` y la OS ya está en la base.
- [ ] **Step 4: El drenaje de `J` y `K` con `after()`.** La fila del master
      **se busca por N° de OS, no se calcula**: con las dos fuentes apiladas y
      ordenadas, la posición ya no es deducible. Espera a que el `IMPORTRANGE`
      derrame, con las esperas recortadas a lo que queda de `maxDuration`.

      Lo que decide **qué escribir y qué queda pendiente es una función pura en
      `lib/mantenimiento/altaDeOS.ts`**, porque las rutas de este repo no tienen
      tests y ésta es la lógica que importa:

      `celdasDelSeguimiento(filaDelMaster: unknown[], quiere: { prioridad: string | null; empresa: string | null }): { celdas: Celda[]; pisadas: ("prioridad" | "empresa")[] }`

      Escribe **sólo si la celda está vacía**; lo que ya tenía algo vuelve en
      `pisadas` para que la pantalla muestre las dos, la que se pidió y la que
      quedó.

- [ ] **Step 4b: Los tests de esa función** (van antes que ella, como siempre):

```ts
it("escribe las dos cuando el master las trae vacias", () => { /* celdas J y K, pisadas [] */ });
it("no pisa la prioridad que alguien cargo a mano", () => { /* J ya tiene "URGENTE" → sin celda J, pisadas ["prioridad"] */ });
it("si el IMPORTRANGE no derramo, no inventa una fila", () => { /* fila vacia → celdas [], y la ruta lo anota como pendiente */ });
```
- [ ] **Step 5: Verificar.** `npm run tipos`, `npm test`,
      `node scripts/revisar-exportaciones.mjs` — esta ruta escribe una planilla,
      así que tiene que quedar declarada ahí o sale ROMPE.
- [ ] **Step 6: Commit.**

---

### Tarea 6: La pantalla del alta

**Files:**
- Create: `app/(app)/mantenimiento/ordenes-servicio/NuevaOS.tsx`
- Modify: `app/(app)/mantenimiento/ordenes-servicio/OrdenesServicioClient.tsx`

- [ ] **Step 1: El formulario.** Área, sector, equipo, descripción, fecha de
      requerimiento, detalle extra, prioridad y empresa. Los desplegables con
      `<Select>`. El área se precarga con la del usuario y se puede cambiar. El
      equipo se elige de la lista del sector, no se tipea.
- [ ] **Step 2: Decir qué pasa después**, en una línea: que la OS va a la
      planilla y queda esperando la aprobación de gerencia.
- [ ] **Step 3: Mostrar el error de la planilla tal cual viene**, sin traducir.
- [ ] **Step 4: Verificar.** `node scripts/revisar-responsive.mjs` → ROMPE 0.
- [ ] **Step 5: Commit.**

---

### Tarea 7: El enlace, en las dos direcciones

**Files:**
- Create: `app/api/mantenimiento/ordenes-servicio/[id]/ot/route.ts`
- Modify: `app/(app)/mantenimiento/ordenes-servicio/DetalleOS.tsx`
- Modify: la ficha de la OT

- [ ] **Step 1: La ruta.** `PATCH` enlaza (`{ ot_id }` o `{ os_id }`), `DELETE`
      desenlaza. Pide nivel de edición. **El enlace no se exporta a ninguna
      planilla** y eso va escrito en el encabezado del archivo, porque es
      justamente lo que `revisar-exportaciones` va a hacer preguntar.
- [ ] **Step 2: En la ficha de la OS:** las OT que la cubren, el botón «Generar
      OT» —que reusa el alta de OT que ya existe, heredando equipo, sector y
      descripción— y «Enlazar una OT que ya existe».
- [ ] **Step 3: En la ficha de la OT:** la OS que la cubre, «Crear la OS» —que
      abre el alta de la Tarea 6 precargada y vuelve con la OT enlazada— y
      «Enlazar una OS que ya existe». Las dos listas con `<Select>`.
- [ ] **Step 4: Verificar** las seis comprobaciones.
- [ ] **Step 5: Commit.**

---

### Tarea 8: La documentación

**Files:**
- Modify: `docs/MANTENIMIENTO-INTEGRACION.md`, `docs/VARIABLES-VERCEL.md`, `CLAUDE.md`

- [ ] **Step 1:** Reemplazar el párrafo **«Por eso no se puede crear una OS
      desde la app»**, que a partir de acá es falso, por cómo se crea y qué lo
      hace posible.
- [ ] **Step 2:** Corregir dos cosas que el relevamiento encontró mal: que
      `A..J` del master son fórmula (la `J` es a mano) y la cuenta de pestañas.
- [ ] **Step 3:** `GOOGLE_SHEETS_OS_FORMULARIO_ID` en `VARIABLES-VERCEL.md`,
      con la nota de que la cuenta de servicio necesita **Editor**.
- [ ] **Step 4:** La fila de Mantenimiento en `CLAUDE.md` apunta al spec nuevo.
- [ ] **Step 5: Commit y push.**

---

### Tarea 9: La primera alta de verdad

- [ ] **Step 1:** Crear una OS desde el sistema.
- [ ] **Step 2:** Verificar que la fila cayó en `Altas del sistema` con su
      número, y que el número no lo tenía nadie.
- [ ] **Step 3:** Verificar que aparece en Compras → Aprobaciones.
- [ ] **Step 4:** Verificar que llegó el aviso a `os_aprobadores`.
- [ ] **Step 5:** Si algo falló, la salida es **denegarla**: es lo único que el
      sistema sabe escribir en el maestro. Consume un número de producción y
      está aceptado.

# Disponibilidad y ausentismo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el SdG sea el único lugar donde se carga una ausencia, que cualquiera vea quién no viene sin ver por qué, y que RRHH saque del sistema los tres números por los que hoy mantiene una planilla a mano.

**Architecture:** Toda la aritmética —las dos reglas de conteo de días, los días hábiles y los tres reportes— vive en funciones puras de `lib/rrhh/ausentismo/`, que es lo único que este repo testea. Las rutas sólo leen `ausencias` y se la pasan. La pantalla es transversal, fuera de todo módulo, al lado de `/mis-avisos`. La importación de la planilla es un script de una sola vez, con su lógica de emparejado también pura.

**Tech Stack:** Next.js 16 (App Router), Supabase (PostgREST + RLS), TypeScript, Vitest, Tailwind v4, API de Google Sheets (sólo para la importación inicial).

**Spec:** [docs/superpowers/specs/2026-10-29-disponibilidad-y-ausentismo-design.md](../specs/2026-10-29-disponibilidad-y-ausentismo-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, textos de pantalla y de commit.
- Conventional commits en castellano, con el porqué, lo probado y el riesgo asumido en el cuerpo.
- **Nunca `git add -A`.** Suele haber otra sesión commiteando en este mismo árbol.
- La migración **la corre una persona** a mano en el editor SQL de Supabase (`npm run migracion "descripcion"`, marca de tiempo). Antes, las ocho trampas de `supabase/migrations/README.md`.
- **Una policy nueva llama a su función envuelta**: `using ((select …))`.
- **PostgREST corta en 1000 filas**: `traerTodo()` de `lib/core/paginado.ts`. `ausencias` tiene 147 y crece.
- **Un `select()` armado en una variable** pierde la inferencia de tipos. La cadena va literal.
- Desplegables con **`<Select>`**; grillas `grid-cols-1 sm:grid-cols-3`; `<table>` en contenedor con scroll; un ancho sobre un `.input` va en un `div` que lo envuelva.
- Las fechas son ISO `YYYY-MM-DD` y se comparan como strings. Los meses son `YYYY-MM`.
- **La disponibilidad abierta nunca manda el `tipo` ni las `observaciones`.** De 218 novedades, 74 son enfermedad y 3 ART.
- **Las dos reglas de conteo no coinciden entre sí, y eso es el requisito**, no un error.

## Review Focus

Cinco cosas que el spec implica, que ningún test de tarea ejercita por su cuenta, y que si fallan las sufre una persona. Cada una tiene abajo el test que la fija, en la tarea dueña del código.

1. **Una ausencia que cruza el fin de mes.** 49 de las 207 novedades lo hacen: el mensual la prorratea, el anual la imputa entera al mes en que empieza. Confundirlas es el error que hace que los dos reportes dejen de parecerse a los de RRHH. → Tarea 2.
2. **Una ausencia de un solo día.** Son 97 de 147, y con la regla del anual valen **cero**. Un `+1` de más ahí duplica el reporte anual. → Tarea 2.
3. **Un empleado sin sector.** `sector_id` es nullable: si no se contempla, esa persona desaparece del mensual y del porcentual sin que nada avise. → Tarea 4.
4. **Un mes sin feriados cargados.** `feriados` tiene 17 filas, todas de 2026. En 2027 los hábiles salen de más y el porcentaje de menos, en silencio. → Tarea 3.
5. **Una `TARDANZA`.** El reporte de la planilla la cuenta como día, pero el que llega tarde **sí vino**: no puede abrir hueco en la disponibilidad. Las dos cosas a la vez. → Tareas 4 y 6.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<ts>_horas_a_realizar_por_sector.sql` | El catálogo nuevo, con su RLS |
| `lib/rrhh/ausentismo/diasDeAusencia.ts` | Las dos reglas de conteo. Puro. |
| `lib/rrhh/ausentismo/diasHabiles.ts` | Hábiles y sábados del mes, y el acumulado del año. Puro. |
| `lib/rrhh/ausentismo/reportes.ts` | Los tres reportes. Puro. |
| `lib/rrhh/importarNovedades.ts` | Emparejar por nombre y decidir qué ya está. Puro. |
| `scripts/importar-novedades.mts` | La corrida de una sola vez |
| `app/api/disponibilidad/route.ts` | Quién no viene, abierto, sin motivo |
| `app/api/disponibilidad/reportes/route.ts` | Los tres reportes, gateados |
| `app/api/rrhh/horas-a-realizar/route.ts` | El catálogo nuevo |
| `app/(app)/disponibilidad/page.tsx` · `DisponibilidadClient.tsx` · `Reportes.tsx` | La pantalla |
| `lib/core/nav.ts` | *(modificar)* la entrada transversal |

---

### Tarea 1: El catálogo de horas a realizar

**Files:**
- Create: `supabase/migrations/<ts>_horas_a_realizar_por_sector.sql` (nombre generado por `npm run migracion "horas a realizar por sector"`)

**Interfaces:**
- Produces: tabla `rrhh_horas_a_realizar` (`sector_id uuid references sectores(id)`, `horas_por_empleado numeric not null`, `desde date not null`, `hasta date`), que lee la tarea 4 y escribe la tarea 6.

El tercer reporte necesita, por sector, cuántas horas debería trabajar un empleado en el mes. En la planilla eso es `(hábiles + sábados) × 8` para los sectores de planta y un **200 escrito a mano** para los de oficina — o sea que no es una fórmula, es una decisión de RRHH. Por eso es un catálogo y no un cálculo.

- [ ] **Step 1: Leer las ocho trampas de `supabase/migrations/README.md`**
- [ ] **Step 2: Crear el archivo con `npm run migracion "horas a realizar por sector"`**
- [ ] **Step 3: Escribir el encabezado y el DDL**

El encabezado explica en castellano por qué es un catálogo y no una fórmula (el 208 sale de una cuenta, el 200 no), y que lleva vigencia para que un cambio de hoy no reescriba los meses ya reportados — la misma razón que el padrón de la programación del taller.

- [ ] **Step 4: RLS con la función envuelta**

Lectura para cualquier autenticado —el reporte porcentual lo ve todo el mundo—; escritura sólo con acceso de edición a RRHH: `using ((select tiene_acceso_rrhh()))` en el `with check`.

- [ ] **Step 5: Avisar y quedar a la espera.** Las tareas 2, 3 y 5 son puras y avanzan mientras tanto; la 4 en adelante necesita la tabla.
- [ ] **Step 6: Commit**

---

### Tarea 2: Las dos reglas de conteo

**Files:**
- Create: `lib/rrhh/ausentismo/diasDeAusencia.ts`
- Test: `lib/rrhh/ausentismo/diasDeAusencia.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Ausencia {
    empleado_id: string;
    fecha_desde: string;  // "YYYY-MM-DD"
    fecha_hasta: string;
    tipo: string;
  }
  /** Regla del reporte mensual: inclusive y prorrateada dentro de `mes` ("YYYY-MM"). */
  export function diasEnElMes(a: Ausencia, mes: string): number;
  /** Regla del reporte anual: exclusive, `hasta - desde`, sin el +1. */
  export function diasDelAnual(a: Ausencia): number;
  /** El mes al que el anual le imputa la ausencia entera: el del `fecha_desde`. */
  export function mesDeImputacion(a: Ausencia): string;
  ```

**El archivo tiene que dejar escrito, arriba, que las dos reglas no coinciden y que eso es a propósito.** La primera persona que vea las dos funciones juntas va a querer arreglar una. No es un error: es que los dos reportes de RRHH cuentan distinto y se pidió que los números no se muevan.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
const a = (desde: string, hasta: string, tipo = "VACACIONES"): Ausencia =>
  ({ empleado_id: "e1", fecha_desde: desde, fecha_hasta: hasta, tipo });

it("el mensual cuenta inclusive", () => {
  expect(diasEnElMes(a("2026-01-05", "2026-01-12"), "2026-01")).toBe(8);
});

it("el anual cuenta exclusive, sin el mas uno", () => {
  expect(diasDelAnual(a("2026-01-05", "2026-01-12"))).toBe(7);
});

// Son 97 de las 147 ausencias de la base: un mas uno de mas acá duplica el anual
it("una ausencia de un solo dia vale cero en el anual y uno en el mensual", () => {
  expect(diasDelAnual(a("2026-03-10", "2026-03-10"))).toBe(0);
  expect(diasEnElMes(a("2026-03-10", "2026-03-10"), "2026-03")).toBe(1);
});

// 49 de las 207 novedades cruzan un fin de mes
it("el mensual prorratea entre los meses y el anual no", () => {
  const cruza = a("2025-12-19", "2026-01-02");
  expect(diasEnElMes(cruza, "2025-12")).toBe(13);
  expect(diasEnElMes(cruza, "2026-01")).toBe(2);
  expect(mesDeImputacion(cruza)).toBe("2025-12");
  expect(diasDelAnual(cruza)).toBe(14);
});

it("un mes que la ausencia no toca da cero", () => {
  expect(diasEnElMes(a("2026-01-05", "2026-01-12"), "2026-02")).toBe(0);
});

it("cuenta dias de calendario, fines de semana incluidos", () => {
  // 2026-03-07 es sabado y 2026-03-08 domingo
  expect(diasEnElMes(a("2026-03-06", "2026-03-09"), "2026-03")).toBe(4);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/rrhh/ausentismo/diasDeAusencia.test.ts` — FAIL, el módulo no existe.

- [ ] **Step 3: Implementar las tres funciones**

Las fechas son ISO y se comparan como strings; el prorrateo recorta el rango contra el primero y el último día del mes. No parsear a `Date` para comparar.

- [ ] **Step 4: Correr y verificar que pasan**
- [ ] **Step 5: Commit**

---

### Tarea 3: Los días hábiles

**Files:**
- Create: `lib/rrhh/ausentismo/diasHabiles.ts`
- Test: `lib/rrhh/ausentismo/diasHabiles.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Lunes a viernes del mes, menos los feriados que caigan en día hábil. */
  export function habilesDelMes(mes: string, feriados: readonly string[]): number;
  /** Los sábados del mes. El reporte porcentual los suma aparte. */
  export function sabadosDelMes(mes: string): number;
  /** Hábiles de enero hasta el mes de `hasta`, inclusive. El denominador del anual. */
  export function habilesAcumulados(hasta: string, feriados: readonly string[]): number;
  /** Los meses de `anio` que no tienen ningún feriado cargado. */
  export function mesesSinFeriados(anio: number, feriados: readonly string[]): string[];
  ```

**Los hábiles salen del calendario y de `feriados`, NO de `calculos_diarios`.** Esa tabla arranca en febrero de 2026 — enero no existe en ella—, así que no puede dar el denominador del primer mes del año.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it("cuenta lunes a viernes del mes", () => {
  // Enero 2026: 31 dias, 22 habiles si no hubiera feriados
  expect(habilesDelMes("2026-01", [])).toBe(22);
});

it("descuenta un feriado que cae en dia habil y no uno que cae en domingo", () => {
  expect(habilesDelMes("2026-01", ["2026-01-01"])).toBe(21);  // jueves
  expect(habilesDelMes("2026-01", ["2026-01-04"])).toBe(22);  // domingo
});

it("acumula desde enero hasta el mes pedido", () => {
  expect(habilesAcumulados("2026-02", [])).toBe(habilesDelMes("2026-01", []) + habilesDelMes("2026-02", []));
});

// feriados tiene 17 filas, todas de 2026: en 2027 los habiles saldrian de mas
it("dice que meses del anio no tienen feriados cargados", () => {
  expect(mesesSinFeriados(2027, ["2026-01-01"])).toHaveLength(12);
  expect(mesesSinFeriados(2026, ["2026-01-01"])).not.toContain("2026-01");
});
```

- [ ] **Step 2: Correr y verificar que fallan**
- [ ] **Step 3: Implementar las cuatro funciones**
- [ ] **Step 4: Correr y verificar que pasan**
- [ ] **Step 5: Commit**

---

### Tarea 4: Los tres reportes

**Files:**
- Create: `lib/rrhh/ausentismo/reportes.ts`
- Test: `lib/rrhh/ausentismo/reportes.test.ts`

**Interfaces:**
- Consumes: todo lo de las tareas 2 y 3.
- Produces:
  ```ts
  export interface EmpleadoDelReporte { id: string; nombre: string; apellido: string; sectorId: string | null; sector: string | null }
  export interface HorasDeSector { sectorId: string; horasPorEmpleado: number; desde: string; hasta: string | null }

  /** Mensual: sector × motivo, con totales. Agregado, sin nombres. */
  export function reporteMensual(ausencias: Ausencia[], empleados: EmpleadoDelReporte[], mes: string): {
    filas: { sector: string; porMotivo: Record<string, number>; total: number }[];
    totalPorMotivo: Record<string, number>;
    total: number;
  };

  /** Anual por persona: un número por mes, el total, los hábiles acumulados y el porcentual. */
  export function reporteAnual(
    ausencias: Ausencia[], empleados: EmpleadoDelReporte[], anio: number, hastaMes: string, feriados: readonly string[],
  ): { empleadoId: string; nombre: string; sector: string | null; porMes: number[]; total: number; habiles: number; porcentual: number }[];

  /** El porcentual: horas perdidas sobre horas a realizar, por sector y general. */
  export function reportePorcentual(
    ausencias: Ausencia[], empleados: EmpleadoDelReporte[], mes: string,
    horas: HorasDeSector[], feriados: readonly string[],
  ): { filas: { sector: string; personal: number; horasARealizar: number; horasPerdidas: number; porcentual: number }[]; general: number };
  ```

**El mensual y el porcentual usan `diasEnElMes`; el anual usa `diasDelAnual` + `mesDeImputacion`.** No se mezclan.

- [ ] **Step 1: Escribir los tests que fallan**

Los del contrato, más los dos del Review Focus:

```ts
// Review Focus 3 — `sector_id` es nullable y esa persona no puede desaparecer
it("agrupa bajo 'Sin sector' a quien no tiene sector asignado", () => { /* una fila con sector null aparece, no se pierde */ });

// Review Focus 5 — la planilla cuenta la tardanza como dia en el reporte
it("la tardanza cuenta como dia en los reportes", () => { /* un dia de TARDANZA suma en el mensual */ });

it("el mensual cruza sector por motivo y cierra los totales", () => { /* totales por fila y por columna coinciden con el total */ });

// Decidido a pedido: NO se suprime nada. Hay sectores de una sola persona
// (RRHH, Produccion-Hidratacion), asi que la celda deja ver su motivo. El test
// esta para que nadie "arregle" esto mas adelante sin volver a preguntar.
it("un sector de una sola persona aparece igual, sin suprimir", () => { /* la fila existe y su celda trae el numero */ });
it("el anual imputa la ausencia entera al mes en que empieza", () => { /* una que cruza diciembre/enero cae toda en diciembre */ });
it("el porcentual son horas perdidas sobre horas a realizar", () => { /* dias x 8 sobre personal x horasPorEmpleado */ });
it("una vigencia de horas que no cubre el mes no se usa", () => { /* la fila con `hasta` anterior al mes se ignora */ });
```

- [ ] **Step 2: Correr y verificar que fallan**
- [ ] **Step 3: Implementar las tres funciones**
- [ ] **Step 4: Correr y verificar que pasan**
- [ ] **Step 5: Commit**

---

### Tarea 5: La importación de una sola vez

**Files:**
- Create: `lib/rrhh/importarNovedades.ts`
- Test: `lib/rrhh/importarNovedades.test.ts`
- Create: `scripts/importar-novedades.mts`

**Interfaces:**
- Consumes: el tipo `Ausencia` de `lib/rrhh/ausentismo/diasDeAusencia.ts` (tarea 2); `norm` de `lib/core/texto.ts`; `fechaDeSheets` de `lib/core/fechaDeSheets.ts`; `TIPOS_AUSENCIA` de `lib/rrhh/tiposAusencia.ts`.
- Produces:
  ```ts
  export interface NovedadDePlanilla { fila: number; nombre: string; desde: string; hasta: string; motivo: string }
  /** El id del empleado, o null si no se lo reconoce con certeza. Nunca adivina. */
  export function emparejarEmpleado(nombre: string, empleados: { id: string; nombre: string; apellido: string }[]): string | null;
  /** El valor del enum para la etiqueta de la planilla, o null. */
  export function tipoDesdeElMotivo(motivo: string): string | null;
  /** Qué hacer con cada novedad. */
  export function clasificar(
    novedades: NovedadDePlanilla[],
    empleados: { id: string; nombre: string; apellido: string }[],
    existentes: Ausencia[],
  ): { aImportar: (NovedadDePlanilla & { empleadoId: string; tipo: string })[]; yaEstaban: NovedadDePlanilla[]; sinReconocer: NovedadDePlanilla[] };
  ```

**Dos reglas del proyecto mandan acá.** *Enlazar al que se le parece es peor que dejar en null*: lo que no se reconozca con certeza va a `sinReconocer` y lo mira una persona. Y **la importación inserta sin recalcular**: el script no llama a `recalcularEmpleadoPeriodo()`, porque importar enero–junio reescribiría medio año de `calculos_diarios` que hoy está 77% marcado como ausente sin motivo.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
const emp = [
  { id: "e1", nombre: "Roberto Orlando", apellido: "PICART" },
  { id: "e2", nombre: "Claudio Dario", apellido: "FERNANDEZ" },
  { id: "e3", nombre: "Carlos Abel", apellido: "FERNANDEZ" },
];

it("empareja APELLIDO Nombre ignorando acentos y mayusculas", () => {
  expect(emparejarEmpleado("PICART Roberto Orlando", emp)).toBe("e1");
});

it("no adivina cuando el apellido tiene dos personas y el nombre no alcanza", () => {
  expect(emparejarEmpleado("FERNANDEZ", emp)).toBeNull();
});

it("no adivina con un nombre que no esta", () => {
  expect(emparejarEmpleado("MILIA Pablo Ramiro Ramiro", emp)).toBeNull();
});

it("traduce las etiquetas de la planilla al enum", () => {
  expect(tipoDesdeElMotivo("Enfermedad/accidente inculpable")).toBe("ENFERMEDAD_ACCIDENTE_INCULPABLE");
  expect(tipoDesdeElMotivo("Otra (aclarar)")).toBe("OTRA");
  expect(tipoDesdeElMotivo("Cualquier cosa")).toBeNull();
});

it("reconoce como ya cargada una que se solapa con la misma persona", () => { /* mismo empleado y rango que se solapa -> yaEstaban */ });
it("lo que no se reconoce no se importa ni se descarta: se informa", () => { /* va a sinReconocer, no a aImportar */ });
```

- [ ] **Step 2: Correr y verificar que fallan**
- [ ] **Step 3: Implementar las tres funciones**
- [ ] **Step 4: Correr y verificar que pasan**
- [ ] **Step 5: Escribir `scripts/importar-novedades.mts`**

Carga el env **antes** de importar los módulos de Google, como hace `scripts/revisar-planillas.mts` (si se importan arriba, `lib/core/google.ts` se evalúa sin credencial). Lee la pestaña `NOVEDADES` del libro `164obdrj7BmEsWofK-0NOi-i_Ue7Ca5hW5nwBuuv88N0`, clasifica, **imprime el resumen y no escribe nada salvo que se le pase `--escribir`**. Al escribir inserta en `ausencias` con `cargado_por_id` del usuario de RRHH, sin llamar al recálculo.

- [ ] **Step 6: Correr el script en seco y pegar el resumen en el reporte**

Run: `npx tsx scripts/importar-novedades.mts`
Expected: imprime cuántas van a importarse, cuántas ya estaban y la lista de las que no se reconocieron. **No escribe.**

- [ ] **Step 7: Commit** (sin correr la importación de verdad — eso lo decide el usuario)

---

### Tarea 6: Las rutas

**Files:**
- Create: `app/api/disponibilidad/route.ts`
- Create: `app/api/disponibilidad/reportes/route.ts`
- Create: `app/api/rrhh/horas-a-realizar/route.ts`

**Depende de la tarea 1 aplicada.**

**Interfaces:**
- Produces: `GET /api/disponibilidad?desde=&hasta=` → `{ dias: string[]; ausentes: { empleadoId: string; nombre: string; sector: string | null; dia: string }[] }` — **sin `tipo` ni `observaciones`, nunca**.
- Produces: `GET /api/disponibilidad/reportes?mes=YYYY-MM` → `{ mensual, anual, porcentual, avisos: string[] }`.

- [ ] **Step 1: `app/api/disponibilidad/route.ts`**

Abierta a cualquier autenticado. `ausencias` está cerrada con `tiene_acceso_rrhh()` —hoy sólo 6 de 14 usuarios la pueden leer—, así que se lee con el cliente admin y **se proyecta a lo que puede ser público**. El `tipo` se trae sólo para excluir `TARDANZA`, que no abre hueco porque esa persona vino: es la misma regla que ya rige en la programación del taller (`TIPOS_QUE_NO_SON_FALTA` de `lib/mantenimiento/disponibilidad.ts`). **No debe aparecer en la respuesta.**

- [ ] **Step 2: `app/api/disponibilidad/reportes/route.ts`**

Gateada a `encargado`, `admin_sistema` o acceso a RRHH. Arma los tres reportes con las funciones de la tarea 4 y devuelve además `avisos`: los meses sin feriados cargados (tarea 3) y una línea fija diciendo que el total incluye **todos** los sectores y no la lista fija de 17 de la planilla, por lo que no va a dar igual.

- [ ] **Step 3: `app/api/rrhh/horas-a-realizar/route.ts`**

`GET` para cualquiera; `POST`/`PATCH` sólo con edición de RRHH. Valida que las horas sean un número positivo y que la vigencia no se solape para el mismo sector, con mensajes en castellano.

- [ ] **Step 4: Ejercitar las tres contra la base real** con el `SUPABASE_SERVICE_ROLE_KEY`. Tres comprobaciones que no son opcionales: que el JSON de `/api/disponibilidad` **no contiene** `tipo` ni `observaciones`; que **una `TARDANZA` no aparece como ausente ahí** pero **sí suma un día en el reporte mensual** (es el Review Focus 5, y es lo único del plan donde la misma fila cuenta distinto según quién pregunta); y que un empleado sin sector aparece en el mensual. Limpiar lo que se escriba.
- [ ] **Step 5: Commit**

---

### Tarea 7: La pantalla

**Files:**
- Create: `app/(app)/disponibilidad/page.tsx` · `DisponibilidadClient.tsx` · `Reportes.tsx`
- Modify: `lib/core/nav.ts`

- [ ] **Step 1: `page.tsx`** — sólo pide sesión; quién ve los reportes lo decide la ruta. Mismo molde que `app/(app)/mis-avisos/page.tsx`, que es el precedente de una pantalla transversal.
- [ ] **Step 2: `DisponibilidadClient.tsx`** — quién no viene y qué día, con `useCargar`. **Nunca el motivo.**
- [ ] **Step 3: `Reportes.tsx`** — los tres, detrás del permiso, con los `avisos` de la ruta a la vista y no al pie: el mensual va a dar más alto que la planilla y eso tiene que estar dicho **donde se ve el número**.
- [ ] **Step 4: La entrada del menú** en `lib/core/nav.ts`, de primer nivel y sin `modulo`, al lado de las otras transversales. **Se llama Disponibilidad, no Avisos** — esa palabra ya está ocupada dos veces.
- [ ] **Step 5: Verificar** — `npm test`, `npx tsc --noEmit`, `node scripts/revisar-responsive.mjs` (hoy da ROMPE 0 · APRETADO 0 · MIRAR 0: lo que aparezca es de lo que se acaba de escribir).
- [ ] **Step 6: Commit**

---

### Tarea 8: Cierre

- [ ] **Step 1: Verificación completa** — `npm test`, `npx tsc --noEmit`, `npm run build` (con el dev server parado), `node scripts/revisar-arbol-commiteado.mjs`, `node scripts/revisar-responsive.mjs`.
- [ ] **Step 2: Documentar** — una sección en `docs/RRHH-ACTUALIZACION.md` y la fila en la tabla de `CLAUDE.md`, con las tres cosas que no se deducen del código: que las dos reglas de conteo **no coinciden a propósito**, que la importación **no recalcula**, y que el mensual da más alto que la planilla porque ésta tira 69 de 207 filas contra su lista fija de 17 sectores.
- [ ] **Step 3: Decirle al usuario qué queda en sus manos** — correr la migración, correr la importación de verdad (`--escribir`) después de mirar la lista de no reconocidos, sembrar el catálogo de horas, y avisarle a RRHH que los dos números se mueven antes de que los vea.
- [ ] **Step 4: No pushear.** Lo decide el usuario; suele haber trabajo de otra sesión en el árbol.

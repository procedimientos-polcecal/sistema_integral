# OT periódicas que se crean solas — Plan de implementación

> **Para quien ejecute:** SUB-SKILL REQUERIDA: `superpowers:subagent-driven-development` o `superpowers:executing-plans`, tarea por tarea. Los pasos usan `- [ ]`.

**Objetivo:** que una OT periódica se cree sola el día que toca, y que cualquier OT nacida en el sistema se pueda postergar con una razón configurable y justificación obligatoria.

**Arquitectura:** las decisiones puras viven en `lib/mantenimiento/` con tests; el alta de una OT se extrae de la ruta a `lib/` para que un cron pueda crear sin sesión; la generación se cuelga de `SINCRONIZACIONES`, que es lo que ya corre el cron del módulo. La fecha nueva se escribe en `Altas del sistema` y una columna nueva la protege hasta que el derrame llega al master.

**Stack:** Next.js 16, Supabase (PostgREST), vitest. Castellano en todo.

**Spec:** [docs/superpowers/specs/2026-10-29-mantenimiento-ot-periodicas-y-reprogramacion-design.md](../specs/2026-10-29-mantenimiento-ot-periodicas-y-reprogramacion-design.md)

## Restricciones globales

- **Una sola migración, y la corre una persona.** Después de la Tarea 1 hay que parar y pedirla. Las tareas 6 a 9 no se pueden probar contra la base hasta que esté aplicada.
- **La fecha de ejecución se escribe en `Altas del sistema`, columna índice 26 (`FECHA COMPROMETIDA`), nunca en la J del master** — es derrame de `IMPORTRANGE`.
- **Sólo se posterga una OT con `app_created = true`.**
- **El cron no es diario**: corre cada 3 a 5 horas. Todo paso nuevo tiene que poder correr diez veces por día sin duplicar nada.
- **Toda escritura nueva a una planilla se declara en `scripts/revisar-exportaciones.mjs`** o ese script falla.
- `<Select>` y no `<select>`; grillas de tres columnas con breakpoint.
- Conventional commits en castellano, cuerpo con el porqué.

## Foco de revisión

Lo que la spec implica y ningún test obvio ejercita. Cada línea tiene su test en la tarea que la posee.

1. **Un programado vencido hace tres ciclos genera una sola OT y su próxima fecha queda en el futuro** — Tarea 2.
2. **El paso de generación corre dos veces seguidas y la segunda no crea nada**, ni siquiera después de cerrar la OT — Tarea 5.
3. **Si la escritura en la planilla falla, la fecha no se mueve en la base** — Tarea 6.
4. **Una OT con `fecha_ejecucion_pendiente` no la pisa la importación ni la cuenta el contraste** — Tarea 7.
5. **Un programado sin especialidad no genera, y lo dice** — Tarea 3.

---

### Tarea 1: La migración

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_mantenimiento_periodicas_y_postergacion.sql` (con `npm run migracion "periodicas y postergacion"`)

**Interfaces — Produce:**
- `ordenes_trabajo.fecha_ejecucion_pendiente date`
- `mantenimientos_programados.especialidad text`
- `mant_razones_de_postergacion (codigo text primary key, etiqueta text not null, dias integer not null, activa boolean not null default true, orden integer not null default 0)`

- [ ] **Paso 1:** escribir la migración con las tres cosas, encabezado explicando el porqué de `fecha_ejecucion_pendiente` (la ventana de 3 a 53 horas del derrame) y por qué no se reusa `sheets_pendiente`.
- [ ] **Paso 2:** RLS en `mant_razones_de_postergacion`: lectura `using ((select mant_puede_ver()))`, escritura `using ((select puede_editar_mantenimiento()))`, **envueltas**.
- [ ] **Paso 3:** sembrar la razón acordada: `('falta_repuesto', 'Falta de repuesto en planta', 3, true, 1)`.
- [ ] **Paso 4:** commit, y **parar**: pedirle al usuario que la corra antes de seguir con las tareas 6-9.

---

### Tarea 2: Cuándo vence un programado

**Archivos:**
- Crear: `lib/mantenimiento/vencimiento.ts`, `lib/mantenimiento/vencimiento.test.ts`
- Modificar: `app/api/mantenimiento/ejecuciones/route.ts` (borrar `calcNextDate`, importar la nueva)

**Interfaces — Produce:**
- `proximaFecha(schedule: {schedule_type, interval_days, next_date}, hoy: string): string | null`
- `leToca(schedule, hoy: string): boolean`

- [ ] **Paso 1: tests que fallan** en `vencimiento.test.ts`:
  - `leToca` es true con `next_date` de ayer y false con la de mañana.
  - `proximaFecha` de un MENSUAL vencido el `2026-08-08` con hoy `2026-10-29` da **una fecha futura** (`2026-11-05`), no `2026-09-07`: **saltea los ciclos perdidos**.
  - `proximaFecha` de un MENSUAL al día suma 30.
  - `FECHA_FIJA` devuelve `null`.
  - `PERSONALIZADO` sin `interval_days` devuelve `null`.
  - `PERSONALIZADO` con 45 suma 45, saltando ciclos si hace falta.
- [ ] **Paso 2:** `npx vitest run lib/mantenimiento/vencimiento.test.ts` → FAIL.
- [ ] **Paso 3:** implementar las dos en `vencimiento.ts`. Los intervalos son los de `calcNextDate` (DIARIO 1, SEMANAL 7, QUINCENAL 15, MENSUAL 30, TRIMESTRAL 90, SEMESTRAL 180, ANUAL 365). Sumar el intervalo en bucle mientras la fecha siga siendo pasada. Sin `new Date(iso)` pelado: usar `sumarDias` de `lib/core/fechas.ts`.
- [ ] **Paso 4:** tests en verde; `npx tsc --noEmit`.
- [ ] **Paso 5:** commit.

---

### Tarea 3: Qué le falta a un programado para poder generar

**Archivos:**
- Modificar: `lib/mantenimiento/otDesdeMantenimiento.ts`, `lib/mantenimiento/otDesdeMantenimiento.test.ts`

**Interfaces — Consume:** `especialidadDeTipo`. **Produce:** `loQueFaltaParaGenerar(m: MantenimientoParaLaOT & {especialidad?: string | null}): string[]`

- [ ] **Paso 1: tests que fallan** — devuelve `[]` con especialidad propia cargada; devuelve `["la especialidad"]` con un `maintenance_type` de los cinco que `especialidadDeTipo` no resuelve (`Inspeccion`) y sin especialidad propia; devuelve `[]` con `Lubricacion` aunque no tenga especialidad propia, porque el tipo la resuelve.
- [ ] **Paso 2:** correr → FAIL.
- [ ] **Paso 3:** implementar. La especialidad efectiva es `m.especialidad?.trim() || especialidadDeTipo(m.maintenance_type)`.
- [ ] **Paso 4:** verde; `tsc`.
- [ ] **Paso 5:** commit.

---

### Tarea 4: El alta de una OT, fuera de la ruta

**Archivos:**
- Crear: `lib/mantenimiento/altaDeLaOrden.ts`
- Modificar: `app/api/mantenimiento/ordenes/route.ts` (el POST pasa a llamarla)

**Interfaces — Produce:**
```ts
export interface QuienCrea { email: string | null; nombre: string | null; apellido: string | null; usuario_id: string | null }
export const EL_SISTEMA: QuienCrea  // { email: null, nombre: "SdG", apellido: "(automático)", usuario_id: null }
export async function crearLaOrden(
  admin: SupabaseClient, datos: Record<string, unknown>, quien: QuienCrea
): Promise<{ ok: true; orden: FilaDeOT; ot_number: number; planilla_error: string | null }
        | { ok: false; error: string; status: number }>
```

- [ ] **Paso 1:** leer el POST entero de `app/api/mantenimiento/ordenes/route.ts` antes de tocar nada. Es el camino de escritura más importante del módulo.
- [ ] **Paso 2:** mover a `altaDeLaOrden.ts`, **sin cambiar comportamiento**: validación con `loQueFaltaParaCrear`, `altaEnLaPlanilla`, insert, repuestos, `sheets_pendiente` y el `after()` de reintento quedan donde están pero detrás de esta firma. El `after()` sigue siendo responsabilidad de la ruta —un cron no lo tiene— así que `crearLaOrden` devuelve `planilla_error` y **quien llama** decide si insiste.
- [ ] **Paso 3:** el POST queda como: sesión → permisos → `crearLaOrden(admin, body, {del usuario})` → `after()` si hubo error.
- [ ] **Paso 4:** `npm test` completo y `npx tsc --noEmit`. **No hay test nuevo acá**: es un movimiento, y lo que lo cubre es que los 4.387 que hay sigan en verde.
- [ ] **Paso 5:** `node scripts/revisar-exportaciones.mjs` → ROMPE 0 (declarar `lib/mantenimiento/altaDeLaOrden.ts` con estrategia `cola`).
- [ ] **Paso 6:** commit.

---

### Tarea 5: Generar las periódicas

**Archivos:**
- Crear: `lib/mantenimiento/generarPeriodicas.ts`, `lib/mantenimiento/generarPeriodicas.test.ts`
- Modificar: `lib/mantenimiento/sincronizar.ts` (sumar a `SINCRONIZACIONES`)

**Interfaces — Consume:** `leToca`, `proximaFecha`, `loQueFaltaParaGenerar`, `crearLaOrden`, `cuerpoDeLaOT`. **Produce:** `queGenerar(programados, hoy): {generar: [...], incompletos: [...]}` (pura) y `generarLasPeriodicas(opciones?): Promise<Resultado>`.

- [ ] **Paso 1: tests que fallan** sobre `queGenerar`: un programado vencido entra; uno futuro no; uno `status != "active"` no; uno vencido **sin especialidad** va a `incompletos` y no a `generar`.
- [ ] **Paso 2:** correr → FAIL.
- [ ] **Paso 3:** implementar `queGenerar`.
- [ ] **Paso 4:** verde.
- [ ] **Paso 5:** implementar `generarLasPeriodicas`: lee los activos, usa `queGenerar`, y por cada uno llama `crearLaOrden(admin, cuerpoDeLaOT(...), EL_SISTEMA)`. **Sólo si sale**, actualiza `next_date` con `proximaFecha` y `last_executed_at`. Si `proximaFecha` da `null` (FECHA_FIJA, PERSONALIZADO sin intervalo), el programado pasa a `status: "completed"`.
- [ ] **Paso 6:** agregarla a `SINCRONIZACIONES` **después** de `ordenes`, para que la OT nueva no la pise la importación de la misma corrida.
- [ ] **Paso 7:** `npm test`, `tsc`, `revisar-exportaciones`.
- [ ] **Paso 8:** commit.

---

### Tarea 6: Postergar una OT

> Necesita la Tarea 1 aplicada.

**Archivos:**
- Crear: `lib/mantenimiento/postergar.ts`, `lib/mantenimiento/postergar.test.ts`, `app/api/mantenimiento/ordenes/[id]/postergar/route.ts`

**Interfaces — Produce:**
- `laNuevaFecha(fecha: string | null, dias: number): string | null` (pura)
- `loQueFaltaParaPostergar(body): string[]` (pura: razón, días > 0, justificación no vacía)
- `celdaDeLaFechaComprometida(fila: number, iso: string): {pestana, fila, columna, valor}`

- [ ] **Paso 1: tests que fallan**: `laNuevaFecha("2026-11-02", 3)` → `"2026-11-05"`; con `null` → `null`. `loQueFaltaParaPostergar` pide las tres cosas y las informa **juntas**, no de a una.
- [ ] **Paso 2:** correr → FAIL.
- [ ] **Paso 3:** implementar las puras.
- [ ] **Paso 4:** verde.
- [ ] **Paso 5:** la ruta POST, en este orden: permisos → la OT tiene que ser `app_created` (si no, 400 con el porqué) → escribir la celda en `Altas del sistema` → **si falló, devolver el error de Google sin traducir y no tocar la base** → update de `fecha_ejecucion` + `fecha_ejecucion_pendiente` → nota con la justificación (reusando el camino de `notas`) → `auditar()` con verbo `corregir`, `valor_anterior` y `valor_nuevo`.
- [ ] **Paso 6:** declarar la escritura en `revisar-exportaciones.mjs`.
- [ ] **Paso 7:** `npm test`, `tsc`, `revisar-exportaciones` → ROMPE 0.
- [ ] **Paso 8:** commit.

---

### Tarea 7: Que la importación y el contraste respeten la fecha en camino

> Necesita la Tarea 1 aplicada.

**Archivos:**
- Modificar: `lib/mantenimiento/sincronizar.ts`, `lib/mantenimiento/contraste.ts` + sus tests

- [ ] **Paso 1: tests que fallan** en `contraste.test.ts`: una OT cuyo sistema dice `2026-11-05` y la planilla `2026-11-02`, **con `fecha_ejecucion_pendiente = "2026-11-05"`**, no es divergencia y va a `enLaCola`. Sin esa columna, sí lo es.
- [ ] **Paso 2:** correr → FAIL.
- [ ] **Paso 3:** `OrdenDelSistema` gana `fecha_ejecucion_pendiente?: string | null`, y el bucle la saltea igual que a `sheets_pendiente`.
- [ ] **Paso 4:** verde.
- [ ] **Paso 5:** en `sincronizarOrdenes`: si la OT tiene `fecha_ejecucion_pendiente`, no se pisa su `fecha_ejecucion`; y si la J del master **ya coincide** con ese valor, se limpia la columna. Sumar `fecha_ejecucion_pendiente` al select del contraste.
- [ ] **Paso 6:** `npm test`, `tsc`.
- [ ] **Paso 7:** commit.

---

### Tarea 8: El menú de razones

> Necesita la Tarea 1 aplicada.

**Archivos:**
- Crear: `app/api/mantenimiento/razones-postergacion/route.ts`
- Modificar: la pantalla de configuración de Mantenimiento

- [ ] **Paso 1:** GET (lista) y PUT (alta/edición de una razón), con `puedeEditarMantenimiento`.
- [ ] **Paso 2:** la pantalla: etiqueta, días, activa. `<Select>` donde haya desplegable; grilla con breakpoint.
- [ ] **Paso 3:** `tsc`, `npm test`, `node scripts/revisar-responsive.mjs` → ROMPE 0.
- [ ] **Paso 4:** commit.

---

### Tarea 9: El botón en la orden

> Necesita las tareas 6 y 8.

**Archivos:**
- Crear: `app/(app)/mantenimiento/ordenes/PostergarOTModal.tsx`
- Modificar: `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx`

- [ ] **Paso 1:** el modal pide razón (`<Select>` con las razones activas, que **trae puestos los días**), días editables y justificación obligatoria.
- [ ] **Paso 2:** en `OTDetail`, el botón sólo si `o.app_created`; si no, una línea diciendo que esa fecha no se puede mover desde el sistema.
- [ ] **Paso 3:** `tsc`, `npm test`, `revisar-responsive` → ROMPE 0.
- [ ] **Paso 4:** commit y push.

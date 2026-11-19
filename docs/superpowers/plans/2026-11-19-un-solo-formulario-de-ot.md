# Un solo formulario de orden de trabajo — plan de implementación

> **Para quien lo ejecute con agentes:** SUB-SKILL REQUERIDA: usar
> `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans` para implementarlo tarea por tarea. Los pasos
> usan `- [ ]` para ir marcándolos.

**Objetivo:** que generar una OT desde un aviso abra el mismo formulario que
«Nueva OT», para que se pueda cargar el contratista —y los otros diez campos
que faltaban— sin salir de la pantalla de avisos.

**Arquitectura:** `NuevaOTModal` recibe un aviso opcional. Cuando viene,
arranca sembrado con lo que el aviso propone, lo dice arriba, y manda
`aviso_id` para que la ruta marque el aviso como ya hace hoy. `GenerarOTModal`
se borra y `otDesdeAviso.ts` queda sólo con lo que sigue sirviendo.

**Stack:** Next.js 16 App Router, React, TypeScript, vitest.

**Spec:** [docs/superpowers/specs/2026-11-19-un-solo-formulario-de-ot-design.md](../specs/2026-11-19-un-solo-formulario-de-ot-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, textos de pantalla y mensajes
  de commit.
- **Nunca `git add -A`.** Se agregan por nombre sólo los archivos tocados: el
  árbol está compartido con otras sesiones.
- Un desplegable se escribe **`<Select>`**, no `<select>`.
- `className="input w-20"` **no mide 20**: `.input` está fuera de capa en
  `app/globals.css` y su `width: 100%` le gana a cualquier `w-*` al lado. El
  ancho va en un `div` que envuelva al campo.
- Una grilla de **tres o más columnas lleva breakpoint** (`grid-cols-1
  sm:grid-cols-3`). El ancho útil del teléfono son 343 px.
- **No se toca la regla de obligatorios** (`loQueFaltaParaCrear` de
  `lib/mantenimiento/altaDeOT.ts`) ni `/api/mantenimiento/ordenes`.
- **No se toca `app/cargar/FormularioOTOffline.tsx`.**

## Review Focus

Cinco cosas que el diseño implica y que ninguna pantalla puede testear sola.
Cada una tiene su test en la tarea que la posee:

1. **Un aviso sin sector y sin equipo** siembra los dos vacíos y la barra ámbar
   tiene que nombrar **los dos**, no uno. (Tarea 1)
2. **Un aviso con la descripción vacía** no puede sembrar una descripción
   vacía: cae en `Aviso A123`, porque la descripción es obligatoria y un campo
   vacío obliga a adivinar qué se reportó. (Tarea 1)
3. **Una urgencia que no está en el mapa** —null, `""`, una palabra nueva— no
   puede sembrar una prioridad inventada ni romper. (Tarea 1)
4. **El sembrado no puede pisar lo que ya tiene el formulario**: lo que el
   aviso no sabe (contratista, horas, operarios, estado, fechas de creación y
   cierre) queda con el valor por defecto de `NuevaOTModal` y no en `""`.
   (Tarea 1)
5. **`aviso_id` tiene que sobrevivir a «Traer» una OT vieja.** Reutilizar pisa
   el estado del formulario; si `aviso_id` viviera ahí adentro, reciclar un
   número desenlazaría el aviso en silencio. Vive fuera del estado, en la prop.
   (Tarea 2, comprobado por lectura y fijado por el test de `extrasDelAviso`
   en la tarea 1)

---

### Task 1: lo que el aviso propone, como funciones puras

**Archivos:**
- Modificar: `lib/mantenimiento/otDesdeAviso.ts`
- Test: `lib/mantenimiento/otDesdeAviso.test.ts`

**Interfaces:**
- Consume: `AvisoParaLaOT`, `loQuePropone`, `prioridadDeUrgencia` (ya existen).
- Produce:
  - `export interface EquipoDelAviso { id: string; name: string; code: string | null; sector_id: string | null }`
    — se **muda** acá desde `app/(app)/mantenimiento/avisos/GenerarOTModal.tsx`,
    porque ese archivo se borra en la tarea 3 y `avisos/page.tsx` lo importa.
  - `export function sembradoDesdeElAviso(aviso: AvisoParaLaOT, hoy: string): Record<string, string>`
    — **sólo las claves que el aviso llena**, para que `NuevaOTModal` las
    extienda sobre sus valores por defecto. Las claves son las de
    `RespuestasDelAviso` menos las que arrancan vacías: `descripcion`, `tipo`,
    `prioridad`, `sector_id`, `sector_raw`, `equipment_id`, `equipo_raw`,
    `equipo_code`, `quien`, `fecha_ejecucion`. **No** devuelve
    `especialidad`, `fecha_fin` ni las tres notas GUT: el aviso no las sabe y
    devolverlas en `""` sería pisar el valor por defecto con un vacío que
    nadie eligió.
  - `export function extrasDelAviso(aviso: AvisoParaLaOT): { aviso_id: string; repuesto: string | null }`
    — lo que viaja en el cuerpo además de los campos del formulario.

- [ ] **Paso 1: escribir los tests que fallan**

En `lib/mantenimiento/otDesdeAviso.test.ts`, un `describe("lo que el aviso siembra")`:

```ts
const AVISO: AvisoParaLaOT = {
  id: "av-1", oa_number: "A123", descripcion: "TRANSMISION HORNO 4 SALTA LA CADENA",
  urgencia: "ALTA", sector_id: "sec-1", sector_raw: "Molienda",
  equipment_id: "eq-1", equipo_raw: "M2 – Molino 2", equipo_code: "M2",
  repuesto: "cadena",
};

it("siembra lo que el aviso sabe y nada más", () => {
  const s = sembradoDesdeElAviso(AVISO, "2026-11-19");
  expect(s.descripcion).toBe("TRANSMISION HORNO 4 SALTA LA CADENA");
  expect(s.sector_id).toBe("sec-1");
  expect(s.equipment_id).toBe("eq-1");
  expect(s.tipo).toBe("CORRECTIVO");
  expect(s.quien).toBe("INTERNO");
  expect(s.fecha_ejecucion).toBe("2026-11-19");
  // Lo que el aviso no sabe NO viaja: pisaría el valor por defecto del
  // formulario con un vacío que nadie eligió. (Review Focus 4)
  expect(s).not.toHaveProperty("especialidad");
  expect(s).not.toHaveProperty("fecha_fin");
  expect(s).not.toHaveProperty("gut_gravedad");
  expect(s).not.toHaveProperty("estado");
  expect(s).not.toHaveProperty("contratista");
});

// Review Focus 2
it("sin descripción cae en el número del aviso y nunca en vacío", () => {
  const s = sembradoDesdeElAviso({ ...AVISO, descripcion: "   " }, "2026-11-19");
  expect(s.descripcion).toBe("Aviso A123");
});

// Review Focus 3
it("una urgencia que no conoce no inventa una prioridad ni rompe", () => {
  for (const u of [null, "", "URGENTÍSIMO"]) {
    const s = sembradoDesdeElAviso({ ...AVISO, urgencia: u }, "2026-11-19");
    expect(typeof s.prioridad).toBe("string");
    expect(s.prioridad).toBe(prioridadDeUrgencia(u));
  }
});

// Review Focus 1
it("un aviso sin sector ni equipo nombra los dos", () => {
  const sinNada = { ...AVISO, sector_id: null, equipment_id: null };
  expect(loQueElAvisoNoTrae(sinNada)).toEqual(["el sector", "el equipo"]);
  const s = sembradoDesdeElAviso(sinNada, "2026-11-19");
  expect(s.sector_id).toBe("");
  expect(s.equipment_id).toBe("");
});

// Review Focus 5: el enlace no vive en el estado del formulario.
it("los extras llevan el aviso y su repuesto", () => {
  expect(extrasDelAviso(AVISO)).toEqual({ aviso_id: "av-1", repuesto: "cadena" });
});
```

- [ ] **Paso 2: correrlos y ver que fallan**

Correr: `npx vitest run lib/mantenimiento/otDesdeAviso.test.ts`
Esperado: FALLA con «sembradoDesdeElAviso is not a function».

- [ ] **Paso 3: implementar `sembradoDesdeElAviso` y `extrasDelAviso`, y mudar `EquipoDelAviso`**

`sembradoDesdeElAviso` se arma **desde `loQuePropone`**, no en paralelo: toma
`loQuePropone(aviso, { quien: "INTERNO", fecha_ejecucion: hoy })` y devuelve
sólo las diez claves de arriba. Escribir una segunda regla de sembrado es
exactamente lo que el encabezado del archivo documenta como el bug de octubre.

- [ ] **Paso 4: correrlos y ver que pasan**

Correr: `npx vitest run lib/mantenimiento/otDesdeAviso.test.ts`
Esperado: PASA.

- [ ] **Paso 5: commit**

```bash
git add lib/mantenimiento/otDesdeAviso.ts lib/mantenimiento/otDesdeAviso.test.ts
git commit -m "feat(mantenimiento): lo que el aviso le propone al formulario completo"
```

---

### Task 2: `NuevaOTModal` acepta un aviso

**Archivos:**
- Modificar: `app/(app)/mantenimiento/ordenes/NuevaOTModal.tsx`

**Interfaces:**
- Consume: `sembradoDesdeElAviso`, `extrasDelAviso`, `loQueElAvisoNoTrae`,
  `AvisoParaLaOT` (tarea 1).
- Produce: las props nuevas del modal:
  - `aviso?: AvisoParaLaOT | null` — opcional. Sin él se comporta igual que hoy.
  - `onCreated: (advertencia: string | null, numero?: string) => void` — se le
    suma el segundo argumento. `OrdenesClient` lo ignora y no cambia.

- [ ] **Paso 1: sembrar el estado inicial**

El `useState` del formulario pasa a extender el objeto de valores por defecto
con `...(aviso ? sembradoDesdeElAviso(aviso, hoyEnArgentina()) : {})`. El orden
importa: el sembrado va **después** de los valores por defecto, nunca antes.

- [ ] **Paso 2: decir de dónde viene**

Debajo del `<h2>`, cuando hay aviso, un `<p>` con el texto exacto:

> Del aviso {oa_number}. Viene con lo que el aviso dice; todo se puede corregir
> antes de crearla, y el aviso no se toca.

Y, cuando `loQueElAvisoNoTrae(aviso)` devuelve algo, la **misma barra ámbar**
que ya usa `vieneDe` (`rounded-xl border border-amber-300 bg-amber-50 px-3 py-2
text-sm text-amber-900`), con el texto:

> El aviso llegó sin {lista unida con " y "}: lo de abajo no viene de nadie, lo
> estás eligiendo vos.

- [ ] **Paso 3: mandar el enlace**

En `submit`, el cuerpo que va a `mandarOEncolar` suma
`...(aviso ? extrasDelAviso(aviso) : {})`. **No se agrega al estado del
formulario**: ahí lo pisaría «Traer» una OT vieja y el aviso quedaría
desenlazado sin que nada lo diga (Review Focus 5).

- [ ] **Paso 4: pasar el número al que llama**

La llamada final pasa a `onCreated(salida.advertencia, salida.numero)`.
`salida.advertencia` ya trae el error de marcar el aviso: `loQueQuedoPendiente`
de `public/cola/colaOffline.js` lee `cuerpo.aviso_error`, así que **no hay que
leerlo acá** — hacerlo sería la misma divergencia que ese archivo documenta
haber cerrado el 02/11/2026 con los repuestos.

- [ ] **Paso 5: comprobar que compila y que la otra pantalla no cambió**

Correr: `npx tsc --noEmit`
Esperado: sin errores. `OrdenesClient` sigue llamando sin `aviso` y recibiendo
un solo argumento.

- [ ] **Paso 6: commit**

```bash
git add "app/(app)/mantenimiento/ordenes/NuevaOTModal.tsx"
git commit -m "feat(mantenimiento): el formulario completo sabe venir de un aviso"
```

---

### Task 3: la pantalla de avisos usa el formulario completo

**Archivos:**
- Modificar: `app/(app)/mantenimiento/avisos/AvisosClient.tsx:10,472-484`
- Modificar: `app/(app)/mantenimiento/avisos/page.tsx:10`
- Borrar: `app/(app)/mantenimiento/avisos/GenerarOTModal.tsx`

- [ ] **Paso 1: cambiar los dos imports**

Los dos archivos importan `EquipoDelAviso` de `./GenerarOTModal`. Pasan a
importarlo de `@/lib/mantenimiento/otDesdeAviso` (tarea 1).

- [ ] **Paso 2: cambiar el modal que abre `AvisosClient`**

`GenerarOTModal` → `NuevaOTModal`, con `aviso={generarDe}` y
`onCreated={(advertencia, numero) => …}`. El mensaje que arma `AvisosClient`
es el que hoy arma el modal viejo:

> Se generó la OT #{numero} y el aviso {oa_number} quedó marcado.

seguido de `advertencia` cuando la hay. Después, `setGenerarDe(null)`,
`setResultado(mensaje)` y `router.refresh()`, igual que hoy.

- [ ] **Paso 3: borrar `GenerarOTModal.tsx`**

- [ ] **Paso 4: comprobar que no quedó nada colgando**

Correr: `npx tsc --noEmit` y `grep -rn "GenerarOTModal" app/ lib/ components/`
Esperado: sin errores y sin resultados.

- [ ] **Paso 5: commit**

```bash
git add "app/(app)/mantenimiento/avisos/AvisosClient.tsx" "app/(app)/mantenimiento/avisos/page.tsx"
git rm "app/(app)/mantenimiento/avisos/GenerarOTModal.tsx"
git commit -m "feat(mantenimiento): generar una OT desde un aviso abre el formulario completo"
```

---

### Task 4: podar `otDesdeAviso.ts`

**Archivos:**
- Modificar: `lib/mantenimiento/otDesdeAviso.ts`
- Modificar: `lib/mantenimiento/otDesdeAviso.test.ts`

- [ ] **Paso 1: comprobar que ya nadie los usa**

Correr: `grep -rn "cuerpoDeLaOT\|loQueFaltaDelAviso\|loQueHayQuePreguntar" app/ lib/ components/`
Esperado: sólo el propio archivo y su test.

- [ ] **Paso 2: borrar las tres funciones y sus tests**

Se van `cuerpoDeLaOT`, `loQueFaltaDelAviso` y `loQueHayQuePreguntar`, con los
`describe` que las prueban (`"lo que se escribe es lo que se guarda"` y
`"lo que hay que preguntar"`). Quedan `loQuePropone`, `loQueElAvisoNoTrae`,
`RESPUESTAS_VACIAS`, los tipos y lo nuevo de la tarea 1.

- [ ] **Paso 3: actualizar el encabezado y el comentario que quedó viejo**

Dos cosas, y las dos son el motivo de que esta tarea exista aparte:

1. El argumento de `cuerpoDeLaOT` —«una OT que nace de un aviso no nace
   cerrada: se está pidiendo trabajo, no cargando trabajo hecho»— **ya no
   describe lo que hace el sistema**: desde un aviso ahora se ven «estado
   inicial» y «fecha de cierre». Se reescribe diciendo qué cambió y por qué:
   registrar trabajo ya hecho contra un aviso es un caso real, y no queda sin
   control porque `loQueFaltaParaCrear` exige las horas y quién la hizo cuando
   hay fecha de cierre. **No se borra en silencio.**
2. El encabezado del archivo explica el bug del 19/10/2026 —la regla y el
   formulario en archivos distintos— y sigue siendo la razón de que
   `sembradoDesdeElAviso` salga de `loQuePropone`. Se conserva, agregando que
   el formulario recortado ya no existe.

- [ ] **Paso 4: correr la suite del módulo**

Correr: `npx vitest run lib/mantenimiento/`
Esperado: todo en verde.

- [ ] **Paso 5: commit**

```bash
git add lib/mantenimiento/otDesdeAviso.ts lib/mantenimiento/otDesdeAviso.test.ts
git commit -m "refactor(mantenimiento): otDesdeAviso queda con lo que todavia sirve"
```

---

### Task 5: el documento del módulo

**Archivos:**
- Modificar: `docs/MANTENIMIENTO-INTEGRACION.md`

> **Ojo:** este archivo **difiere entre `origin/main` y el árbol del disco**,
> porque hay otra sesión trabajando. El blob se arma desde
> `git show origin/main:docs/MANTENIMIENTO-INTEGRACION.md` más el parche,
> **nunca desde el archivo del disco**.

- [ ] **Paso 1: escribir la sección**

Un apartado corto en la parte de avisos que diga lo que no se deduce del
código: que **hay un solo formulario de OT en Mantenimiento** y por qué —el de
octubre, dos mitades que tienen que decir lo mismo—; que el aviso **propone y
no obliga**, y que el aviso no se toca; que `aviso_id` **vive en la prop y no
en el estado**, porque «Traer» una OT vieja pisa el estado y desenlazaría el
aviso en silencio; y que desde un aviso ahora se puede crear una orden **ya
cerrada**, con el argumento de por qué eso está bien. Nombrar que
`FormularioOTOffline` sigue siendo el tercero y queda afuera a propósito.

- [ ] **Paso 2: commit**

```bash
git commit -m "docs(mantenimiento): un solo formulario de OT, y lo que eso implica"
```

---

## Verificación final

```bash
npx tsc --noEmit
npm test
npm run build
node scripts/revisar-responsive.mjs
node scripts/revisar-exportaciones.mjs
node scripts/revisar-arbol-commiteado.mjs
```

Y la prueba que ningún script hace, que la tiene que correr una persona:
**generar una OT desde un aviso cargando un contratista**, y ver que la orden
queda con el contratista y el aviso queda marcado.

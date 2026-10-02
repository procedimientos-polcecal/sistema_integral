# Desplegables con buscador

**Fecha:** 2026-10-02
**Estado:** acordado

## El problema

Hay unos 160 `<select>` nativos repartidos en 75 pantallas. En las listas cortas
—estado, turno, prioridad, rol: tres a ocho opciones— el nativo está bien. En las
largas no hay forma de llegar al valor que se busca más que recorriéndolas: 273
proveedores, unos 70 empleados, los equipos, los artículos, los clientes. Quien
carga una fichada sabe el apellido y no el lugar que ocupa en la lista.

Lo que falta es poder escribir para filtrar.

## Lo que ya existe

[`components/MultiSelect.tsx`](../../../components/MultiSelect.tsx) es este mismo
problema ya resuelto, pero **para varios valores**: tiene la caja de búsqueda,
normaliza acentos con `norm()`, mide al abrir si el panel se sale de la pantalla
en el teléfono y se ancla del otro lado, y enciende el buscador a partir de diez
opciones. Hoy lo usan tres filtros: requerimientos, órdenes de trabajo y
presupuestos.

No hay que inventar la pieza. Falta **su hermano de un solo valor**, el que
reemplaza al `<select>`.

## Lo que se decidió

### Alcance: todos los desplegables, con el buscador automático

El componente nuevo reemplaza los `<select>` de todas las pantallas, y el campo
de búsqueda aparece solo a partir de diez opciones. Se descartó limitarlo a las
listas largas: deja dos formas distintas de escribir un desplegable conviviendo
en el repo, y la pregunta «cuál uso acá» no tiene respuesta estable cuando una
lista crece.

### En el teléfono, menos de diez opciones sigue siendo nativo

El componente tiene dos ramas por dentro:

- **Menos de diez opciones → un `<select>` nativo de verdad.** La rueda del
  sistema operativo en el teléfono es mejor que cualquier panel propio, y el
  teclado y el `aria` vienen puestos. Riesgo cero. Es la mayoría de los casos.
- **Diez o más → el panel propio**, con la caja de búsqueda arriba.

Se descartó el panel propio siempre, que uniformaría el código a costa de perder
la rueda del sistema y obligar a reescribir a mano el teclado y la accesibilidad
que el nativo trae gratis. Y se descartó partir por tamaño de pantalla —nativo en
el teléfono, propio en escritorio—, porque el teléfono es justamente donde más
duele recorrer 273 proveedores: dejaría sin arreglar el peor caso.

### La API es la del `<select>` nativo

El componente **lee sus propios `<option>`**, igual que el nativo:

```tsx
<Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} required className="input">
  <option value="">Seleccionar…</option>
  {empleados.map((e) => <option key={e.id} value={e.id}>{e.legajo} - {e.apellido}, {e.nombre}</option>)}
</Select>
```

Eso es el código que ya está en `FichadasClient.tsx` con una letra cambiada. La
migración de 75 archivos es `<select` → `<Select`, `</select>` → `</Select>`, más
el import. Dos razones para que alcance con eso:

- **Los `<option>` quedan donde están.** Veinticinco desplegables arman sus
  opciones con condicionales adentro del JSX (`{puedeX && <option…>}`). Pasarlos
  a una prop `opciones={[[valor, etiqueta], …]}` obligaría a reescribirlos como
  `filter`/`flatMap`, que es exactamente donde se cuelan los errores que acá no
  ataja nada: las pantallas no tienen tests.
- **`onChange` recibe algo con `e.target.value`.** El tipo de la prop es
  `(e: { target: { value: string } }) => void`, que el evento nativo satisface
  estructuralmente. Se midió: **165 de los 170 handlers ya escriben
  `e.target.value`** y compilan sin tocarlos. La rama nativa pasa su evento de
  verdad; la del panel propio pasa un objeto sintético.

Se descartó la prop `opciones` —más limpia por dentro y consistente con
MultiSelect— por el costo de reescribir 160 call sites a mano. Y se descartó
aceptar las dos formas: son dos caminos de código en una pieza que van a usar los
diez módulos, y «cómo se usa esto» dejaría de tener una sola respuesta.

## El panel propio

- **Teclado**: ↓ abre. Al abrir, el foco cae en la caja de búsqueda. ↑/↓ mueven
  el resaltado y lo arrastran a la vista. Enter elige el resaltado. Escape y Tab
  cierran.
- **Acentos**: `norm()`, así que `olavarria` encuentra `Bolsas Olavarría`.
- **Varias palabras en cualquier orden**: la consulta se parte en espacios y cada
  pedazo tiene que aparecer en la etiqueta, así que `olav bolsas` también
  encuentra `Bolsas Olavarría`. MultiSelect hoy usa un `includes` pelado y
  hereda la mejora al compartir el comparador.
- **Se busca sólo por la etiqueta visible**, nunca por el `value`: hacer que un
  uuid invisible decida qué aparece es un resultado que no se puede explicar.
- **Posición**: se mide al abrir y se ancla a la derecha si no entra, igual que
  MultiSelect.

### `required` tiene que seguir frenando el submit

Ocho formularios tienen el `<select>` con `required`, y al menos uno de ellos
—el empleado de una fichada— es además una lista larga, así que cae en la rama
del panel propio. Un panel propio no participa de la validación nativa: el
formulario pasaría a aceptar el vacío **y nada avisaría**.

Debajo del panel va entonces un `<select required>` real pero invisible, con el
mismo valor y las mismas opciones. Es el único motivo por el que ese elemento
existe, y va comentado como tal. No puede ir con `display:none` ni
`visibility:hidden`: el navegador excluye de la validación los campos ocultos
así. Va con `opacity:0` y tamaño de un pixel.

## Lo que se mueve de lugar

`norm()` vive hoy en `lib/compras/texto.ts` y va a usarlo una pieza de los diez
módulos. Se muda a **`lib/core/texto.ts`**, y `lib/compras/texto.ts` queda
reexportándola. Es el mismo puente que ya hay en `app/(app)/compras/MultiSelect.tsx`
desde que ese componente se mudó a `components/`, y el mismo criterio que movió
`fechaDeSheets` a `lib/core/` cuando la necesitó el tercer módulo. Ningún import
existente cambia.

El umbral de las diez opciones y el comparador de texto viven en
**`components/desplegables.ts`**, que importan `Select` y `MultiSelect`. Hoy el
umbral está escrito en MultiSelect y nada impediría que las dos piezas se fueran
separando sin que se note.

## Qué se testea

Vitest sobre las dos funciones puras, en `components/desplegables.test.ts`:

- **`coincide(etiqueta, consulta)`** — acentos, mayúsculas, varias palabras
  desordenadas, consulta vacía, consulta con espacios de más.
- **`opcionesDeLosHijos(children)`** — que cuente bien con un `.map()`, con
  condicionales que devuelven `false`/`null`/`undefined`, y con fragmentos
  anidados. De esta función depende el corte de las diez y el filtrado entero: si
  cuenta mal, una lista de 273 proveedores se dibuja como un `<select>` nativo
  sin buscador y el síntoma no se parece a la causa.

El componente no se testea: las pantallas no tienen tests y no hay
`@testing-library` en el repo.

## Cómo se suelta

Es un diff de 75 archivos y suele haber otra sesión en el mismo árbol, así que no
va en un commit:

1. **El componente, los tests y la mudanza de `norm`.** Nada lo usa todavía.
2. **RRHH**, que tiene los ~70 empleados en fichadas, liquidaciones y vacaciones.
   Se prueba en producción antes de seguir.
3. **El resto, un commit por módulo**, con rutas explícitas en cada `git add`.

### Lo que queda afuera de esta tanda

Otra sesión estaba trabajando en el mismo árbol, con Cantera y Trituración a
medio editar. Quedan sin migrar **las tres pantallas que esa sesión tenía
tocadas**, y sólo ésas:

- `app/(app)/cantera/destape/cargar/CargarDestapeClient.tsx` (5 desplegables)
- `app/(app)/cantera/voladuras/[codigo]/VoladuraClient.tsx` (1)
- `app/(app)/trituracion/partes/PartesClient.tsx` (3)

Las otras diez pantallas de Cantera sí se migraron: no las estaba tocando nadie.
Las tres de arriba se migran cuando esa sesión haya commiteado; hacerlo antes
es pisarle el trabajo.

### Lo que pasó mientras se implementaba, por si se repite

A mitad de la migración, la otra sesión **rebasó `main` y los dos commits de
esta tarea quedaron fuera de la rama** (seguían existiendo como objetos, se
recuperaron del reflog). Peor: uno de sus commits se llevó, desde el disco, el
`import Select from "@/components/Select"` que esta tarea le había puesto a
`BuzonClient.tsx` —sin el archivo, que vivía en los commits descartados—, y
`origin/main` quedó con un `Module not found` que ningún build local reproduce.
Lo encontró `scripts/revisar-arbol-commiteado.mjs`.

Dos cosas que conviene saber la próxima vez:

- **Commitear por nombre no alcanza** cuando el archivo que se nombra tiene
  además cambios de otra sesión adentro. Es la trampa de CLAUDE.md por el otro
  lado: no es que uno se lleve lo ajeno, es que lo ajeno se lleva lo propio.
- **Conviene pushear la pieza compartida apenas está verde**, antes de migrar a
  sus consumidores. Un componente nuevo que vive sólo en un commit local es lo
  que convierte un rebase ajeno en un build roto.

## Lo que no se puede verificar desde acá

Está todo detrás del login. La verificación llega hasta `npm test`, `npx tsc
--noEmit`, `npm run build` y `scripts/revisar-arbol-commiteado.mjs`. Que el
teclado y el panel se sientan bien lo ve una persona en el paso 2 — por eso el
paso 2 es un módulo y no los diez.

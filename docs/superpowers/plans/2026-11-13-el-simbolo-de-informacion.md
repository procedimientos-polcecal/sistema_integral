# El símbolo de información — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que el conocimiento medido que hoy vive en los documentos llegue a la pantalla donde importa, y que las pantallas sin ninguna explicación tengan una.

**Arquitectura:** no se construye nada. `components/InfoTip.tsx` existe y se usa 48 veces; esto es **escribir textos ciertos y colgarlos donde corresponde**. La unidad de trabajo es el módulo, con su documento abierto, porque la parte difícil no es poner el ícono sino que lo que diga sea verdad.

**Stack:** TypeScript, Next.js 16 App Router, el componente `InfoTip` tal cual está.

**Spec:** [docs/superpowers/specs/2026-11-13-el-simbolo-de-informacion-design.md](../specs/2026-11-13-el-simbolo-de-informacion-design.md)

## Restricciones globales

- **Castellano** en todo, incluidos los textos de pantalla y los mensajes de commit.
- **La vara, y no es negociable:** un `(i)` de número se escribe **sólo si su respuesta ya está escrita** en el documento del módulo, el encabezado de una migración o el docstring de la función que lo calcula. Si no se puede señalar dónde vive la respuesta, **no se escribe el tooltip**: se anota el hueco.
- **Cuando el documento y el código discrepan, manda el código**, y la discrepancia se anota como hueco. Los documentos se desactualizan: `CLAUDE.md` dice que Cantera lee el valor hora con `valorHoraDe()` y lo lee con su propio `select`.
- **No se tocan los 48 `(i)` que ya existen**, ni `components/InfoTip.tsx`.
- **No lleva `(i)` una pantalla cuyo subtítulo ya lo dice**, ni un rótulo que dice exactamente lo que es.
- **No se arregla lo que se encuentre de paso.** Un número mal calculado se anota; arreglarlo es otro trabajo.
- **Nunca `git add -A`.** Los archivos van por nombre: hay otra sesión trabajando en el mismo árbol.
- **El build con `npm run dev` levantado deja la app en 500**: parar el dev server antes.
- `InfoTip` recibe `text: string` sin marcado ni enlaces. El más largo de los 48 existentes mide ~400 caracteres; el conocimiento medido entra.

## Foco de revisión

Cinco formas de fallar que ningún test de este repo puede atrapar, porque las pantallas no tienen tests. Cada una tiene su control en la tarea que la toca.

1. **Un tooltip que afirma algo que el código ya no hace.** Es el fallo central: el texto se lee con la autoridad del sistema. El control es el registro de respaldo de cada tarea — cada frase con el archivo y la línea que la sostiene— y que ante discrepancia mande el código.
2. **Un `(i)` que repite el subtítulo de arriba.** Diluye todos los demás. El control es la lista medida de 24 pantallas sin subtítulo: fuera de esa lista, un `(i)` de pantalla necesita justificación escrita.
3. **Un `(i)` nuevo dentro de una tabla con scroll.** El globo va en `fixed` justamente por eso y el componente ya lo resuelve, pero `revisar-responsive.mjs` **no lo ve** y nadie lo va a notar hasta abrirlo. El control es no cambiar el componente y no envolver el `(i)` en nada con `overflow`.
4. **El `(i)` de una acción irreversible y su confirmación diciendo cosas distintas.** Quedan uno al lado del otro; si no coinciden, la persona cree la que la tranquiliza. El control es leer el texto del `useConfirm` de esa misma ruta antes de escribir el tooltip.
5. **Un hueco silenciado.** Un número que no se entiende y cuya explicación no existe: la tentación es inventar una frase razonable. El control es que cada tarea entrega su lista de huecos, y una lista vacía hay que justificarla.

---

## Antes de empezar: el orden y por qué

**Hay otra sesión migrando los 48 modales del sistema en este mismo árbol.** Acaba de terminar 45. Eso toca muchísimos archivos de pantalla y choca con este trabajo.

Dos consecuencias para el orden de las tareas:

- Se trabaja en un **worktree propio**.
- **Las acciones irreversibles van al final** (Tarea 13). Sus botones viven dentro de modales, que es exactamente lo que la otra sesión está moviendo. Todo lo demás —portadas, tablas, tarjetas— casi no la cruza.

## El registro de respaldo, que es la mitad del entregable

Cada tarea de módulo produce, además del código, una sección en
`docs/INFOTIPS.md` con **una fila por tooltip nuevo**: dónde quedó, qué dice, y
**el archivo y la línea que lo respaldan**. Más abajo, los **huecos**: qué número
no se pudo explicar y dónde se buscó.

Sin eso no hay forma de revisar este trabajo: el código sólo muestra que hay un
ícono, no que lo que dice sea cierto. Es el equivalente, para texto, de lo que
`revisar-exportaciones` hace con las escrituras a planilla — el valor no está en
el chequeo, está en que alguien tuvo que contestar la pregunta.

---

## Tarea 1: Las diez portadas de módulo

**Archivos** — modificar, agregando un `<InfoTip>` junto al `<h1>`:
`cantera/page.tsx`, `compras/tablero/page.tsx`, `despacho/page.tsx`, `facturacion/page.tsx`, `inventario/page.tsx`, `produccion/page.tsx`, `remises/page.tsx`, `taller-vial/page.tsx`, `trituracion/page.tsx`, `administracion/page.tsx` (todas bajo `app/(app)/`).
**Crear:** `docs/INFOTIPS.md` con su encabezado y la sección de esta tarea.

**Interfaces** — produce el formato del registro que usan las tareas 2 a 12.

- [ ] **Paso 1: escribir los diez textos**

Cada uno dice **qué es ese módulo y qué se hace ahí**, en el tono de los 48 que ya existen: segunda persona, dos o tres frases, concreto. El de Planificación sirve de molde: «Armás el plan de trabajo de un día: elegís qué órdenes de trabajo se hacen, a quién se asignan, y después generás la hoja para imprimir o guardar en PDF.»

La fuente es el documento del módulo cuando lo hay y la propia pantalla cuando no. **Producción y Calidad son dos cosas distintas y se confunden fácil** —lo dice `CLAUDE.md`— así que esos dos textos tienen que distinguirse el uno del otro explícitamente.

- [ ] **Paso 2: colgarlos**

`<InfoTip text="…" />` al lado del `<h1>`, sin envolverlo en nada que tenga `overflow`.

- [ ] **Paso 3: crear `docs/INFOTIPS.md`** con una fila por tooltip: pantalla · texto · de dónde salió.

- [ ] **Paso 4: verificar**

```
npx tsc --noEmit && npm run build && node scripts/revisar-responsive.mjs
```
Esperado: `tsc` 0, build 0, `ROMPE 0 · APRETADO 0`.

- [ ] **Paso 5: commitear** los once archivos por nombre.

---

## Tarea 2: Las catorce pantallas que quedan sin subtítulo

**Archivos** — las catorce restantes de la lista medida: `administracion/empresas`, `cantera/acarreo`, `cantera/bochones/[codigo]`, `cantera/destape`, `cantera/informes`, `cantera/voladuras/[codigo]`, `compras/requerimientos`, `mantenimiento/avisos`, `mantenimiento/equipos/[id]/checklist`, `mantenimiento/ordenes-servicio`, `mi-cuenta`, `rrhh/analitico`, `rrhh/empleados/[id]`, `taller-vial/informes`.

- [ ] **Paso 1: descartar las que no lo necesiten.** La lista sale de un escaneo —título sin `<p>` en las seis líneas siguientes— y puede traer falsos positivos: una pantalla cuyo título ya lo dice todo **no lleva `(i)`**, y eso se anota en el registro como descarte con su razón. El anti-goal manda sobre la cobertura.
- [ ] **Paso 2: escribir y colgar** los que sí.
- [ ] **Paso 3: registrar** en `docs/INFOTIPS.md`, incluidos los descartes.
- [ ] **Paso 4: verificar** igual que la Tarea 1.
- [ ] **Paso 5: commitear** por nombre.

---

## Tareas 3 a 12: los números, módulo por módulo

**Una tarea por módulo, en este orden:** 3 Compras · 4 Calidad · 5 Producción · 6 Cantera · 7 Mantenimiento · 8 Seguridad e Higiene · 9 Inventario · 10 Despacho y Facturación · 11 Taller Vial y Trituración · **12 las transversales**.

Compras y Calidad van primero porque son los que más conocimiento medido tienen escrito y sin mostrar. Mantenimiento y RRHH **entran aunque ya tengan `(i)`**: lo que no se toca son los 48 existentes, y eso no impide agregar uno nuevo.

**Cada una de estas tareas tiene la misma forma:**

- [ ] **Paso 1: abrir el documento del módulo** (la tabla de `CLAUDE.md` dice cuál) y leerlo entero antes de tocar nada.
- [ ] **Paso 2: listar los candidatos** en la pantalla: números que no son lo que su rótulo sugiere, que dependen de un supuesto, que pueden ser cero por un motivo que no es cero, o que vienen de otro lado y pueden estar viejos.
- [ ] **Paso 3: para cada candidato, encontrar dónde está escrita su respuesta.** Si no está en ninguna parte, **va a la lista de huecos y no se escribe el tooltip**.
- [ ] **Paso 4: comprobar contra el código** que lo que dice el documento sigue siendo cierto. Si discrepan, manda el código y la discrepancia es un hueco.
- [ ] **Paso 5: escribir y colgar** los que pasaron.
- [ ] **Paso 6: registrar** en `docs/INFOTIPS.md`: tooltips con su respaldo, y huecos con dónde se buscó.
- [ ] **Paso 7: verificar** (`tsc`, build, `revisar-responsive`) y **commitear** por nombre.

**Lo que cada módulo tiene que mirar sí o sí**, que es lo medido y ya sabido:

| Tarea | Lo que no puede faltar |
|---|---|
| 3 Compras | El semáforo y el reclamo: **`EN_ESPERA` queda afuera del conjunto reclamable** a propósito, y el orden por defecto cambia al filtrar por color |
| 4 Calidad | **El valor de un ensayo no está transformado** —`escala` es la lectura del sistema, no una propiedad del número—; en envases y carbonilla **manda la planilla**, y un movimiento que no llega allá no existe |
| 5 Producción | **«Turno» son los cuatro cortes del contador del robot**, no los dos del parte, y no se suman; **un día sin filas es planta cerrada, pero un turno en cero dentro de un día con filas es una parada a explicar**; la etiqueta `MATERIAL` está mal en el 11,3 % de las toneladas |
| 6 Cantera | **El costo de mano de obra propia del Destape sale de una tabla cerrada por `tiene_acceso_rrhh()`: a quien no tenga RRHH le llega 0, sin error.** Es el mejor `(i)` de todo el trabajo |
| 7 Mantenimiento | **`gut_orden` no es el puntaje** —lleva el 27 de «sin puntaje» y el +1000 de las abiertas, así que imprimirla muestra 1027— y **el GUT no se exporta a ninguna planilla** |
| 8 Seguridad e Higiene | **37 de 44 condiciones entraron sin sector** y hay cinco fechas dudosas; el texto de lugar original vive en `observaciones` |
| 11 Taller Vial | **No tiene documento ni spec.** Es esperable que salga con pocos o ningún `(i)` de número y una lista de huecos larga. Eso cuenta como terminado |
| 12 Transversales | Son `agenda`, `disponibilidad`, `mis-menciones`, `mis-pedidos`, `mis-avisos` y el Inicio. **No son un módulo y por eso casi se caen de este plan**, pero cargan las advertencias más caras del sistema: en Disponibilidad **«agregado» no es anónimo cuando el grupo es chico** —un sector tiene UNA persona, y cruzando los dos endpoints abiertos 42 de 78 celdas quedaban atribuidas— y **la `TARDANZA` cuenta distinto según quién pregunta**, a propósito; en la Agenda, **divergencia son sólo borrado y movido**, y los RSVP quedan afuera para que la gente no apague las notificaciones |

---

## Tarea 13: Las acciones que no se deshacen

**Va última a propósito:** sus botones viven en modales, que es lo que la otra sesión está moviendo.

**Archivos** — las pantallas que disparan las 18 rutas que llaman a `auditar()`: postear un asiento en Odoo, mover permisos, cerrar una liquidación, ajustar stock, aprobar o denegar una compra, corregir o borrar una ausencia, cargar una semana de referencia, cerrar una recepción de Despacho, sacar un renglón del cuaderno, postergar una OT, borrar del padrón del taller, corregir o reabrir una condición, y borrar un cliente o una oportunidad del CRM.

- [ ] **Paso 1: leer el texto del `useConfirm` de cada una** antes de escribir su tooltip. Los dos van a quedar uno al lado del otro: si dicen cosas distintas, la persona le cree a la que la tranquiliza.
- [ ] **Paso 2: escribir el `(i)` al lado del botón.** Dice **qué va a pasar y por qué no se deshace**. La confirmación no se toca — mejorarla es un non-goal.
- [ ] **Paso 3:** el de **borrar un cliente del CRM** dice además que se lleva en cascada sus contactos, sus oportunidades y todo su historial, y que **a diferencia del renglón del cuaderno, acá no hay archivo de origen en ningún bucket**: la fila de auditoría es lo único que queda.
- [ ] **Paso 4: registrar, verificar y commitear.**

---

## Tarea 14: Cerrar el registro

- [ ] **Paso 1: juntar todos los huecos** en una sección propia de `docs/INFOTIPS.md`, ordenados por módulo.
- [ ] **Paso 2: anotar en `CLAUDE.md`**, en la tabla de documentos, que `docs/INFOTIPS.md` existe y qué contesta: dónde hay un `(i)`, qué dice, qué lo respalda, y **qué números quedaron sin poder explicarse**.
- [ ] **Paso 3: dejar escrito el hallazgo suelto** que ya salió: **Cantera lee el valor hora con su propio `select`** (`lib/cantera/consultas.ts:622`) en vez de con `valorHoraDe()`, así que no tiene la protección de las dos formas del embed. No se arregla acá.
- [ ] **Paso 4: commitear.**

---

## Qué comprobar al final

```bash
npx tsc --noEmit
npm run build                      # con el dev server parado
node scripts/revisar-responsive.mjs
node scripts/revisar-arbol-commiteado.mjs HEAD
npm test
```

**Lo que ninguno de ésos puede decir:** si lo que dicen los tooltips es cierto.
Eso sólo lo contesta `docs/INFOTIPS.md` leído por alguien que conozca la planta,
y por decisión del usuario **esa lectura pasa después de que salga**, no antes.

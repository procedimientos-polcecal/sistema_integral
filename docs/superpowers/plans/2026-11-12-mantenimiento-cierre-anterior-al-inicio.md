# Cierre de OT anterior al inicio, con justificación — plan de implementación

> **Para quien ejecute con agentes:** SUB-SKILL REQUERIDA: usar
> `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans` para implementar tarea por tarea. Los pasos
> usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que una OT se pueda cerrar con fecha anterior a su fecha de
inicio, y que cuando eso pasa el sistema exija una justificación que explique.

**Arquitectura:** una función pura nueva en `lib/mantenimiento/` concentra las
cinco decisiones —si el cierre es anterior, qué falta, qué se guarda, qué texto
va a la planilla y cuándo se toca esa celda— y la llaman las tres pantallas y
las dos rutas, para que el formulario y el servidor vean lo mismo. El texto se
guarda en una columna nueva de `ordenes_trabajo` y se exporta a la columna W
(observaciones) del master, compuesto **desde la fila** y no desde el cuerpo
del pedido.

**Tecnologías:** Next.js 16, Supabase/PostgREST, vitest.

**Spec:** [docs/superpowers/specs/2026-11-12-mantenimiento-cierre-anterior-al-inicio-design.md](../specs/2026-11-12-mantenimiento-cierre-anterior-al-inicio-design.md)

## Restricciones globales

- **Todo en castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **La migración la corre una persona a mano** en el editor SQL de Supabase. Un
  agente la escribe y no la aplica. Nada de esto se despliega antes.
- Un desplegable se escribe `<Select>`, no `<select>`. (Acá no se agrega
  ninguno, pero vale si aparece uno.)
- Una grilla de tres o más columnas lleva breakpoint: `grid-cols-1 sm:grid-cols-3`.
  El ancho útil del teléfono es **343 px**.
- `className="input w-20"` no mide 20: el ancho va en un `div` que envuelva al
  campo.
- La columna nueva: `cierre_justificacion`.
- El prefijo de la celda, literal: `Cerrada antes del inicio: `.
- El faltante, literal: `por qué se cerró antes de la fecha de inicio`.
- Commits convencionales en castellano, y cada uno termina con
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Nunca `git add -A`**: puede haber otra sesión en el mismo árbol. Se agregan
  los archivos por nombre.

## Dónde hay que mirar

| Archivo | Qué pasa ahí |
|---|---|
| `lib/mantenimiento/cierreAnteriorAlInicio.ts` | **nuevo** — las cinco decisiones |
| `lib/mantenimiento/altaDeOT.ts` | `loQueFaltaParaCrear` suma el faltante nuevo |
| `lib/mantenimiento/cierreDeOT.ts` | `LoQueLaPlanillaNoSabe` y `loQueHayQueExportar` suman la columna |
| `lib/mantenimiento/ordenes.ts` | `RegistroDeOT`, `repartirRegistroDeOT` y `celdasParaRegistrar` |
| `lib/mantenimiento/sincronizar.ts` | el `select` de `exportarLoPendiente` |
| `app/api/mantenimiento/ordenes/route.ts` | POST y PATCH |
| `app/(app)/mantenimiento/ordenes/NuevaOTModal.tsx` | campo nuevo |
| `app/cargar/FormularioOTOffline.tsx` | campo nuevo |
| `app/(app)/mantenimiento/ordenes/RegistrarOTModal.tsx` | campo nuevo, precarga de la fecha, chequeo |
| `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx` | la ficha muestra la justificación |
| `supabase/migrations/<marca>_*.sql` | **nuevo** |

## Review Focus

Lo que el spec implica y ninguna tarea probaría sola. Cada línea tiene su test
en la tarea que es dueña del código.

1. **El mismo cierre reenviado no pregunta nada.** «Registrar el trabajo» manda
   la fecha de cierre en todos los guardados; quien sólo corrige las horas no
   puede quedar trabado. → Tarea 2, `elCierreCambio`.
2. **Una justificación que arranca con `=`, `+`, `-` o `@` va como texto.**
   `USER_ENTERED` la convertiría en fórmula y eso ya dejó once pestañas de
   Compras en blanco un día entero. → Tarea 5, `celdasParaRegistrar`.
3. **Un cuerpo encolado sin la clave recibe un 400 que la nombra**, no pasa de
   largo. Es el caso de un teléfono que encoló antes de que el campo existiera.
   → Tarea 3, `loQueFaltaParaCrear`.
4. **Cuando las fechas dejan de contradecirse, la columna se vacía** y la celda
   W deja de decir «Cerrada antes del inicio». → Tarea 2,
   `laJustificacionQueSeGuarda`.
5. **Un pedido que no toca ni las observaciones ni la justificación no toca la
   W.** Si la tocara, le borraría las observaciones a la OT sin que nadie se
   entere. → Tarea 2, `justificacionParaLaPlanilla`.

---

### Tarea 1: La migración

**Archivos:**
- Crear: `supabase/migrations/<marca>_ot_justificacion_del_cierre_adelantado.sql`

**Interfaces:**
- Produce: la columna `public.ordenes_trabajo.cierre_justificacion text`, que
  todas las tareas siguientes suponen existente.

- [ ] **Paso 1: Generar el archivo con marca de tiempo**

```bash
npm run migracion "ot justificacion del cierre adelantado"
```

Marca de tiempo y no contador: dos sesiones toman el mismo «próximo número
libre» y chocan.

- [ ] **Paso 2: Escribir la migración**

Una sola sentencia, `alter table public.ordenes_trabajo add column if not
exists cierre_justificacion text;`, más un `comment on column` que diga para
qué es. El encabezado explica **por qué existe**, con los números medidos: 66
de 2.176 OT ya tienen el cierre antes del inicio, 44 PROGRAMADO y 22
CORRECTIVO, mediana de 2 días de adelanto, y sólo 3 entraron por la app.

No lleva `not null` ni default: lo normal es que esté vacía, y las 66 que ya
existen quedan en null a propósito — nadie escribió esa justificación y
decirlo es mejor que inventarla.

No lleva índice: nada filtra por ella.

- [ ] **Paso 3: Commit**

```bash
git add supabase/migrations/<marca>_ot_justificacion_del_cierre_adelantado.sql
git commit -m "feat(mantenimiento): columna para la justificacion del cierre adelantado"
```

- [ ] **Paso 4: Pedirle al usuario que la corra y esperar**

No sigue nada hasta que esté aplicada: sin la columna, el `insert` del alta se
corta entero con el 400 de PostgREST —el mismo que dio `estado_raw` el
29/10/2026— y eso deja de poder crearse una OT.

---

### Tarea 2: Las cinco decisiones, puras

**Archivos:**
- Crear: `lib/mantenimiento/cierreAnteriorAlInicio.ts`
- Test: `lib/mantenimiento/cierreAnteriorAlInicio.test.ts`

**Interfaces:**
- Consume: `justificacionQueExplica` de `lib/core/justificacion.ts`.
- Produce:
  - `elCierreEsAnteriorAlInicio(cierre: string | null | undefined, inicio: string | null | undefined): boolean`
  - `elCierreCambio(nuevo: string | null | undefined, guardado: string | null | undefined): boolean`
  - `loQueFaltaPorElCierreAdelantado(datos: DatosDelCierreAdelantado): string[]`
  - `laJustificacionQueSeGuarda(cierre: string | null | undefined, inicio: string | null | undefined, texto: unknown): string | null`
  - `observacionDelCierreAdelantado(justificacion: string | null | undefined, observaciones: string | null | undefined): string`
  - `justificacionParaLaPlanilla(tocaLasObservaciones: boolean, tocaLaJustificacion: boolean, guardada: string | null): string | null | undefined`
  - `interface DatosDelCierreAdelantado { fecha_cierre: string | null | undefined; fecha_ejecucion: string | null | undefined; cierre_justificacion: string | null | undefined }`

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
describe("si el cierre es anterior al inicio", () => {
  it("lo es cuando la fecha de cierre es menor", () => {
    expect(elCierreEsAnteriorAlInicio("2026-11-04", "2026-11-06")).toBe(true);
  });
  it("el mismo dia no lo es", () => {
    expect(elCierreEsAnteriorAlInicio("2026-11-06", "2026-11-06")).toBe(false);
  });
  it("un dia despues no lo es", () => {
    expect(elCierreEsAnteriorAlInicio("2026-11-07", "2026-11-06")).toBe(false);
  });
  // Sin una de las dos no hay nada que comparar. 0 de 2.442 OT tienen cierre
  // sin inicio, pero la funcion no se apoya en eso.
  it("sin alguna de las dos no opina", () => {
    expect(elCierreEsAnteriorAlInicio("", "2026-11-06")).toBe(false);
    expect(elCierreEsAnteriorAlInicio("2026-11-04", null)).toBe(false);
    expect(elCierreEsAnteriorAlInicio(undefined, undefined)).toBe(false);
  });
  // Las dos son columnas `date` y llegan como "YYYY-MM-DD", asi que esto no
  // deberia pasar. Se compara el dia igual —diez caracteres— porque es gratis
  // y porque comparar textos de distinto largo da un resultado y no un error.
  it("compara el dia aunque venga con hora", () => {
    expect(elCierreEsAnteriorAlInicio("2026-11-04T00:00:00Z", "2026-11-06")).toBe(true);
  });
});

describe("si la fecha de cierre cambio", () => {
  // REVIEW FOCUS 1. RegistrarOTModal manda la fecha en todos los guardados,
  // asi que "vino la clave" seria siempre cierto y le pediria justificacion a
  // quien solo corrige las horas.
  it("la misma fecha no es un cambio", () => {
    expect(elCierreCambio("2026-11-04", "2026-11-04")).toBe(false);
  });
  it("cerrar una que estaba abierta es un cambio", () => {
    expect(elCierreCambio("2026-11-04", null)).toBe(true);
  });
  it("reabrir una cerrada es un cambio", () => {
    expect(elCierreCambio("", "2026-11-04")).toBe(true);
  });
  it("otra fecha es un cambio", () => {
    expect(elCierreCambio("2026-11-05", "2026-11-04")).toBe(true);
  });
});

describe("que falta cuando el cierre es anterior al inicio", () => {
  const adelantada = {
    fecha_cierre: "2026-11-04", fecha_ejecucion: "2026-11-06",
    cierre_justificacion: "Se rompio antes y se intervino",
  };
  it("con una justificacion que explica no falta nada", () => {
    expect(loQueFaltaPorElCierreAdelantado(adelantada)).toEqual([]);
  });
  it("sin justificacion la pide, con el nombre que se ve en pantalla", () => {
    expect(loQueFaltaPorElCierreAdelantado({ ...adelantada, cierre_justificacion: "" }))
      .toEqual(["por qué se cerró antes de la fecha de inicio"]);
  });
  // REVIEW FOCUS 3: la clave AUSENTE cuenta como faltante. Es una carga sin
  // senal encolada antes de que el campo existiera.
  it("la clave ausente tambien la pide", () => {
    const { cierre_justificacion: _, ...sinLaClave } = adelantada;
    expect(loQueFaltaPorElCierreAdelantado(sinLaClave as never))
      .toEqual(["por qué se cerró antes de la fecha de inicio"]);
  });
  // Lo unico que se opone a que esto sea un tramite. El validador es el del
  // nucleo, el mismo de Compras.
  it("una no-respuesta no alcanza", () => {
    for (const texto of ["x", "no", "...", "   ", "prueba"]) {
      expect(loQueFaltaPorElCierreAdelantado({ ...adelantada, cierre_justificacion: texto }))
        .toEqual(["por qué se cerró antes de la fecha de inicio"]);
    }
  });
  it("un motivo corto pero completo alcanza", () => {
    expect(loQueFaltaPorElCierreAdelantado({ ...adelantada, cierre_justificacion: "Rotura" }))
      .toEqual([]);
  });
  it("si el cierre no es anterior no pide nada, aunque no haya justificacion", () => {
    expect(loQueFaltaPorElCierreAdelantado({
      fecha_cierre: "2026-11-08", fecha_ejecucion: "2026-11-06", cierre_justificacion: "",
    })).toEqual([]);
  });
});

describe("que justificacion se guarda", () => {
  it("el texto recortado cuando el cierre es anterior", () => {
    expect(laJustificacionQueSeGuarda("2026-11-04", "2026-11-06", "  Se rompio antes  "))
      .toBe("Se rompio antes");
  });
  // REVIEW FOCUS 4. Dejarla llena seria que la ficha y la planilla sigan
  // diciendo "Cerrada antes del inicio" de una orden que ya no lo esta.
  it("null cuando las fechas dejaron de contradecirse", () => {
    expect(laJustificacionQueSeGuarda("2026-11-08", "2026-11-06", "Se rompio antes"))
      .toBeNull();
  });
  it("null cuando no hay texto", () => {
    expect(laJustificacionQueSeGuarda("2026-11-04", "2026-11-06", "   ")).toBeNull();
    expect(laJustificacionQueSeGuarda("2026-11-04", "2026-11-06", undefined)).toBeNull();
  });
});

describe("el texto de la celda de observaciones", () => {
  it("lleva el prefijo fijo, para reconocerla de un vistazo", () => {
    expect(observacionDelCierreAdelantado("Se rompio antes", null))
      .toBe("Cerrada antes del inicio: Se rompio antes");
  });
  it("la justificacion primero y las observaciones despues", () => {
    expect(observacionDelCierreAdelantado("Se rompio antes", "Se cambio el rodamiento"))
      .toBe("Cerrada antes del inicio: Se rompio antes\nSe cambio el rodamiento");
  });
  it("sin justificacion es la observacion sola", () => {
    expect(observacionDelCierreAdelantado(null, "Se cambio el rodamiento"))
      .toBe("Se cambio el rodamiento");
  });
  // Vacio vacia la celda, que es "sacá lo que habia" y no "no la toques".
  it("sin nada es vacio", () => {
    expect(observacionDelCierreAdelantado(null, null)).toBe("");
  });
});

describe("cuando la justificacion viaja a la planilla", () => {
  // REVIEW FOCUS 5. Si viajara siempre, un PATCH que solo cambia el estado
  // reescribiria la W con la justificacion sola y se llevaria las
  // observaciones, que no tienen columna para rearmarse.
  it("no viaja si el pedido no toca ninguna de las dos cosas", () => {
    expect(justificacionParaLaPlanilla(false, false, "Se rompio antes")).toBeUndefined();
  });
  it("viaja la guardada si el pedido toca las observaciones", () => {
    expect(justificacionParaLaPlanilla(true, false, "Se rompio antes")).toBe("Se rompio antes");
  });
  it("viaja la guardada si el pedido toca la justificacion", () => {
    expect(justificacionParaLaPlanilla(false, true, "Se rompio antes")).toBe("Se rompio antes");
  });
  it("viaja null si se borro, para que la celda deje de decirlo", () => {
    expect(justificacionParaLaPlanilla(false, true, null)).toBeNull();
  });
});
```

- [ ] **Paso 2: Correr los tests y verificar que fallan**

Ejecutar: `npx vitest run lib/mantenimiento/cierreAnteriorAlInicio.test.ts`
Esperado: FALLA, el módulo no existe.

- [ ] **Paso 3: Implementar las cinco funciones**

En `lib/mantenimiento/cierreAnteriorAlInicio.ts`, con las firmas del bloque
**Interfaces**. Las dos cosas que las firmas no determinan:

- `elCierreEsAnteriorAlInicio` compara los primeros 10 caracteres de cada
  fecha, que es como ya lo hace `cuaderno/generar/route.ts` al desempatar dos
  cierres. Son fechas ISO: comparadas como texto quedan en orden.
- `laJustificacionQueSeGuarda` **no** pregunta si el texto explica. Eso lo
  contesta `loQueFaltaPorElCierreAdelantado` antes de llegar acá; separarlo
  deja que el día que se levante la exigencia —un umbral, por ejemplo— lo que
  ya está guardado no cambie de sentido.

El encabezado del archivo explica por qué existe la regla, con los números
medidos del spec, y por qué se pide **siempre** y sin umbral, incluido el
riesgo asumido: con la mediana en 2 días, lo que se escriba cincuenta veces
puede terminar siendo «se hizo antes», y ahí lo que se revisa es el umbral y no
la regla.

- [ ] **Paso 4: Correr los tests y verificar que pasan**

Ejecutar: `npx vitest run lib/mantenimiento/cierreAnteriorAlInicio.test.ts`
Esperado: PASA.

- [ ] **Paso 5: Commit**

```bash
git add lib/mantenimiento/cierreAnteriorAlInicio.ts lib/mantenimiento/cierreAnteriorAlInicio.test.ts
git commit -m "feat(mantenimiento): la regla del cierre anterior al inicio"
```

---

### Tarea 3: El alta exige la justificación

**Archivos:**
- Modificar: `lib/mantenimiento/altaDeOT.ts` (`DatosDelAltaDeOT`, `loQueFaltaParaCrear`)
- Test: `lib/mantenimiento/altaDeOT.test.ts`

**Interfaces:**
- Consume: `loQueFaltaPorElCierreAdelantado` de la Tarea 2.
- Produce: `DatosDelAltaDeOT` con la clave `cierre_justificacion` **obligatoria
  en el tipo** aunque el valor pueda faltar. Eso es lo que hace que `tsc`
  nombre a quien arme el objeto sin ella: el día que la fecha de fin se volvió
  obligatoria, la ruta del alta la omitía y la regla habría rechazado todas las
  órdenes del sistema sin que el compilador dijera nada.

- [ ] **Paso 1: Escribir los tests que fallan**

Agregar al `describe("que le falta a una orden nueva")` existente, y sumar
`cierre_justificacion: ""` al objeto `completa` de ese archivo:

```ts
it("con el cierre anterior al inicio pide la justificacion", () => {
  expect(loQueFaltaParaCrear({
    ...completa, fecha_ejecucion: "2026-10-20", fecha_cierre: "2026-10-18",
    horas: "4", operario_1: "Aguirre",
  })).toEqual(["por qué se cerró antes de la fecha de inicio"]);
});

it("con la justificacion cargada no pide nada", () => {
  expect(loQueFaltaParaCrear({
    ...completa, fecha_ejecucion: "2026-10-20", fecha_cierre: "2026-10-18",
    horas: "4", operario_1: "Aguirre",
    cierre_justificacion: "El equipo fallo antes y se intervino",
  })).toEqual([]);
});

// Un solo mensaje y no tres pantallas: es la vara de `validar()` del nucleo.
it("sale junto con todo lo demas que falte, en el orden del formulario", () => {
  expect(loQueFaltaParaCrear({
    ...completa, sector_id: "", fecha_ejecucion: "2026-10-20",
    fecha_cierre: "2026-10-18", horas: "", operario_1: "Aguirre",
  })).toEqual([
    "el sector", "las horas que llevó", "por qué se cerró antes de la fecha de inicio",
  ]);
});
```

- [ ] **Paso 2: Correr los tests y verificar que fallan**

Ejecutar: `npx vitest run lib/mantenimiento/altaDeOT.test.ts`
Esperado: FALLA — el faltante no aparece.

- [ ] **Paso 3: Sumar el faltante a `loQueFaltaParaCrear`**

`DatosDelAltaDeOT` suma `cierre_justificacion: string | null | undefined`, con
el mismo docstring que ya tiene `fecha_fin` sobre por qué la clave es
obligatoria en el tipo. `loQueFaltaParaCrear` devuelve
`[...falta, ...loQueFaltaParaCerrar(datos), ...loQueFaltaPorElCierreAdelantado(datos)]`
— al final, porque el campo está al final del formulario y la lista se recorre
de arriba abajo una sola vez.

- [ ] **Paso 4: Correr los tests y verificar que pasan**

Ejecutar: `npx vitest run lib/mantenimiento/altaDeOT.test.ts && npx tsc --noEmit`
Esperado: los tests PASAN y `tsc` **falla** nombrando los cinco lugares que
arman `DatosDelAltaDeOT` sin la clave nueva. Eso es lo que tiene que pasar: son
los que se completan en las tareas 4 y 6.

- [ ] **Paso 5: Commit**

```bash
git add lib/mantenimiento/altaDeOT.ts lib/mantenimiento/altaDeOT.test.ts
git commit -m "feat(mantenimiento): el alta exige por que se cerro antes del inicio"
```

---

### Tarea 4: El campo en las dos altas

**Archivos:**
- Modificar: `app/(app)/mantenimiento/ordenes/NuevaOTModal.tsx`
- Modificar: `app/cargar/FormularioOTOffline.tsx`
- Modificar: `lib/mantenimiento/otDesdeAviso.ts` y `lib/mantenimiento/otDesdeMantenimiento.ts`
  (sólo para nombrar la clave nueva: esos dos formularios no tienen fecha de
  cierre, así que viaja siempre vacía y la regla queda inerte)

**Interfaces:**
- Consume: `elCierreEsAnteriorAlInicio` de la Tarea 2; `loQueFaltaParaCrear` de
  la Tarea 3.

- [ ] **Paso 1: Sumar el campo al estado de los dos formularios**

`cierre_justificacion: ""` en el `useState` de `NuevaOTModal` y en `vacio()` de
`FormularioOTOffline`, junto a `fecha_cierre`. Los dos mandan `...form`, así
que con eso ya viaja.

- [ ] **Paso 2: Mostrar el campo cuando las dos fechas lo piden**

Un `<textarea className="input min-h-20">` dentro del `<F>` de siempre, con el
rótulo **«Por qué se cierra antes de la fecha de inicio»** y `required`.

Va **debajo del bloque de las cuatro fechas y arriba de `FallaDeLaOT`**, por el
mismo motivo que ya está escrito ahí para la falla: en un teléfono una sección
que se abre más arriba empuja hacia abajo el campo que se está completando.

La condición es
`elCierreEsAnteriorAlInicio(form.fecha_cierre, form.fecha_ejecucion)`, calculada
al lado de `cierraAlCrearse`. Un `<textarea>` ocupa el ancho completo: no lleva
`w-*` al lado, que con `.input` no mediría lo que dice.

- [ ] **Paso 3: Completar los otros dos armadores**

`cuerpoDeLaOT` de `otDesdeAviso.ts` y de `otDesdeMantenimiento.ts` suman
`cierre_justificacion: ""` con un comentario de una línea: ninguno de esos dos
formularios pregunta la fecha de cierre, así que la regla no se dispara nunca
desde ahí; la clave va porque el tipo la exige y esa exigencia existe
justamente para que nadie se la olvide.

- [ ] **Paso 4: Verificar**

```bash
npx tsc --noEmit
npm test
node scripts/revisar-responsive.mjs
```

Esperado: `tsc` limpio salvo por la ruta —que es la Tarea 6—, los tests en
verde, y `revisar-responsive` en **ROMPE 0 · APRETADO 0 · MIRAR 0**.

- [ ] **Paso 5: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/NuevaOTModal.tsx" app/cargar/FormularioOTOffline.tsx lib/mantenimiento/otDesdeAviso.ts lib/mantenimiento/otDesdeMantenimiento.ts
git commit -m "feat(mantenimiento): las dos altas piden por que se cierra antes del inicio"
```

---

### Tarea 5: La planilla sabe componer la celda

**Archivos:**
- Modificar: `lib/mantenimiento/ordenes.ts` (`RegistroDeOT`, `repartirRegistroDeOT`, `celdasParaRegistrar`)
- Modificar: `lib/mantenimiento/cierreDeOT.ts` (`LoQueLaPlanillaNoSabe`, `loQueHayQueExportar`)
- Modificar: `lib/mantenimiento/sincronizar.ts` (el `select` de `exportarLoPendiente`)
- Test: `lib/mantenimiento/ordenes.test.ts`, `lib/mantenimiento/cierreDeOT.test.ts`

**Interfaces:**
- Consume: `observacionDelCierreAdelantado` de la Tarea 2.
- Produce: `RegistroDeOT` y `LoQueLaPlanillaNoSabe` con `cierre_justificacion`.

- [ ] **Paso 1: Escribir los tests que fallan**

En `ordenes.test.ts`:

```ts
describe("la celda de observaciones con la justificacion del cierre", () => {
  it("lleva las dos cosas cuando hay las dos", () => {
    const celdas = celdasParaRegistrar({
      cierre_justificacion: "Se rompio antes", observaciones: "Se cambio el rodamiento",
    });
    const w = celdas.find((c) => c.letra === "W");
    expect(w?.valor).toBe("Cerrada antes del inicio: Se rompio antes\nSe cambio el rodamiento");
  });

  it("la justificacion sola cuando el pedido no trae observaciones", () => {
    const celdas = celdasParaRegistrar({ cierre_justificacion: "Se rompio antes" });
    expect(celdas.find((c) => c.letra === "W")?.valor)
      .toBe("Cerrada antes del inicio: Se rompio antes");
  });

  // REVIEW FOCUS 5: un pedido que no toca ninguna de las dos no toca la celda.
  it("no toca la W si no viene ninguna de las dos", () => {
    const celdas = celdasParaRegistrar({ horas: 4 });
    expect(celdas.find((c) => c.letra === "W")).toBeUndefined();
  });

  // REVIEW FOCUS 2: `USER_ENTERED` convierte en formula lo que arranca con
  // =, +, - o @. Eso dejo once pestanas de Compras en blanco un dia entero.
  it("una justificacion que arranca con = va como texto", () => {
    const celdas = celdasParaRegistrar({ cierre_justificacion: "=IMPORTRANGE(x)" });
    expect(String(celdas.find((c) => c.letra === "W")?.valor)).toMatch(/^'/);
  });
});
```

En `cierreDeOT.test.ts`:

```ts
it("la justificacion del cierre se puede rearmar desde la fila", () => {
  expect(loQueHayQueExportar({
    estado: "REALIZADO", fecha_cierre: "2026-11-04", horas: 4,
    contratista: null, operario_1: "Aguirre", operario_2: null, operario_3: null,
    cierre_justificacion: "Se rompio antes",
  })).toMatchObject({ cierre_justificacion: "Se rompio antes" });
});

// Lo que esta vacio no viaja: vaciar una celda que nadie lleno es escribir de
// mas en una planilla que mira gente.
it("una orden sin justificacion no la manda", () => {
  expect(loQueHayQueExportar({
    estado: "REALIZADO", fecha_cierre: "2026-11-04", horas: 4,
    contratista: null, operario_1: "Aguirre", operario_2: null, operario_3: null,
    cierre_justificacion: null,
  })).not.toHaveProperty("cierre_justificacion");
});
```

- [ ] **Paso 2: Correr los tests y verificar que fallan**

Ejecutar: `npx vitest run lib/mantenimiento/ordenes.test.ts lib/mantenimiento/cierreDeOT.test.ts`
Esperado: FALLA.

- [ ] **Paso 3: Implementar**

Tres cambios, y el tercero es el que nada avisa si se olvida:

1. `RegistroDeOT` y `LoQueLaPlanillaNoSabe` suman
   `cierre_justificacion?: string | null`. En `celdasParaRegistrar`, la W se
   escribe cuando **alguna de las dos** claves vino, con
   `textoParaLaCelda(observacionDelCierreAdelantado(...))`.

   **Acá la clave va opcional y en `DatosDelAltaDeOT` va obligatoria, y la
   asimetría es a propósito.** Allá se exige para que `tsc` nombre a quien arme
   el objeto sin ella, porque olvidársela haría que la regla rechazara órdenes
   que están bien. Acá, los cinco generadores automáticos arman
   `LoQueLaPlanillaNoSabe` con literales y **ninguno tiene justificación que
   mandar**: exigirles la clave sería pedirles que escriban `undefined` para
   decir lo que ya dicen callándose.
2. `repartirRegistroDeOT` manda `cierre_justificacion` **sólo al `update`**, no
   al `registro`: la celda se compone desde la fila y no desde el cuerpo, y de
   eso se encarga la ruta en la Tarea 6.
3. El `select` de `exportarLoPendiente` en `sincronizar.ts` suma
   `cierre_justificacion`. Es una lista de columnas escrita a mano: si no se
   agrega, la cola rearma el registro sin la justificación, **la del alta no
   llega nunca a la planilla** y nada falla ni avisa — la fila del master llega
   por `IMPORTRANGE` y la primera escritura falla casi siempre.

El comentario de `celdasParaRegistrar` suma lo que se acepta a conciencia: el
drenaje arma la W con la justificación sola, porque las observaciones no tienen
columna para rearmarse. Si esa OT ya tenía las dos, el drenaje se lleva la parte
de las observaciones; no se pierde el dato —quedan en
`mantenimientos_ejecuciones.observations`, y las altas no tienen observaciones—
pero sí esa copia. La alternativa era que la justificación del alta no saliera
nunca.

- [ ] **Paso 4: Correr los tests y verificar que pasan**

```bash
npx vitest run lib/mantenimiento/ordenes.test.ts lib/mantenimiento/cierreDeOT.test.ts
node scripts/revisar-exportaciones.mjs
```

Esperado: tests PASAN y `revisar-exportaciones` en **ROMPE 0**.

- [ ] **Paso 5: Commit**

```bash
git add lib/mantenimiento/ordenes.ts lib/mantenimiento/ordenes.test.ts lib/mantenimiento/cierreDeOT.ts lib/mantenimiento/cierreDeOT.test.ts lib/mantenimiento/sincronizar.ts
git commit -m "feat(mantenimiento): la justificacion del cierre viaja a las observaciones"
```

---

### Tarea 6: Las dos rutas

**Archivos:**
- Modificar: `app/api/mantenimiento/ordenes/route.ts` (POST y PATCH)

**Interfaces:**
- Consume: todo lo de las tareas 2, 3 y 5.

Las rutas no tienen tests en este repo: la lógica que importa ya está en `lib/`
y probada. Acá se verifica con `tsc`, el build y la lectura.

- [ ] **Paso 1: El POST**

Tres cosas, en este orden:

1. Sacar `cierre_justificacion` del `body`, junto a `fecha_cierre`.
2. Pasárselo a `loQueFaltaParaCrear` y a `loQueSeContradice` — `tsc` ya está
   pidiendo las dos desde la Tarea 3.
3. En `record`, guardar
   `laJustificacionQueSeGuarda(fecha_cierre, fecha_ejecucion, cierre_justificacion)`.
   Así una justificación escrita y después desarmada por un cambio de fecha no
   queda guardada diciendo algo que ya no pasa.

- [ ] **Paso 2: El PATCH**

Cinco cosas, y el orden importa:

1. **Antes del `update`**, leer `fecha_ejecucion` y `fecha_cierre` de la orden:
   el cuerpo no trae la fecha de inicio porque no se está cambiando, y después
   del `update` ya es tarde para saber qué había.
2. Si `body.fecha_cierre !== undefined` **y**
   `elCierreCambio(body.fecha_cierre, guardada.fecha_cierre)` **y** el cierre
   nuevo es anterior al inicio, exigir la justificación con
   `loQueFaltaPorElCierreAdelantado` y devolver 400 con
   `Falta cargar ${falta.join(", ")}.` — el mismo texto que las altas.
   Comparar contra el valor guardado y no contra «vino la clave» es lo que
   evita trabar a quien sólo corrige las horas.
3. `update.cierre_justificacion` sale de `laJustificacionQueSeGuarda`, con la
   fecha de inicio leída en el paso 1 y la de cierre que corresponda —la nueva
   si vino, la guardada si no—.
4. Después del `update`, componer lo que va a la planilla:
   `registro.cierre_justificacion = justificacionParaLaPlanilla(registro.observaciones !== undefined, body.cierre_justificacion !== undefined, updated.cierre_justificacion)`,
   y no asignarlo si eso devuelve `undefined`.
5. El chequeo de «no se envió ningún cambio» tiene que seguir contando este
   campo como un cambio.

- [ ] **Paso 3: Verificar**

```bash
npx tsc --noEmit
npm test
npm run build
node scripts/revisar-exportaciones.mjs
```

Esperado: todo limpio. (Parar `npm run dev` antes del build: lo deja en 500.)

- [ ] **Paso 4: Commit**

```bash
git add app/api/mantenimiento/ordenes/route.ts
git commit -m "feat(mantenimiento): las rutas guardan y exigen la justificacion del cierre"
```

---

### Tarea 7: «Registrar el trabajo»

**Archivos:**
- Modificar: `app/(app)/mantenimiento/ordenes/RegistrarOTModal.tsx`

**Interfaces:**
- Consume: `elCierreEsAnteriorAlInicio`, `loQueFaltaPorElCierreAdelantado`.

Es la pantalla del caso que motivó el pedido: la OT programada que ya existe y
se cierra con fecha anterior.

- [ ] **Paso 1: Que el modal sepa las dos fechas**

Sumar `fecha_ejecucion: string | null` y `fecha_cierre: string | null` al tipo
de la prop `orden`, **obligatorias y no opcionales**, con el mismo comentario
que ya tienen ahí las tres claves de la falla: si el listado dejara de traerlas
el campo no aparecería nunca y nadie se enteraría. En tiempo de ejecución ya
llegan — la pantalla pasa la orden entera y el `GET` hace `select("*")`.

- [ ] **Paso 2: Precargar la fecha con la que la orden ya tiene**

`useState(orden.fecha_cierre ?? hoy())` en vez de `useState(hoy())`.

Esto arregla algo que ya pasa hoy sin esta regla: reabrir una OT cerrada para
corregirle las horas **le mueve la fecha de cierre al día de hoy**, en silencio.
Va con un comentario que lo diga, porque es un cambio de comportamiento en una
pantalla que nadie pidió cambiar, y sin él «no traba la corrección de una OT
vieja» es una frase que el código no sostiene.

- [ ] **Paso 3: El campo y el chequeo**

Un `<textarea className="input min-h-20">` con el rótulo **«Por qué se cierra
antes de la fecha de inicio»**, visible cuando
`elCierreEsAnteriorAlInicio(cuando, orden.fecha_ejecucion)`. Va debajo del campo
de fecha, por el mismo motivo de siempre.

El chequeo va **al principio de `guardar()`**, al lado del que ya está para un
trabajo parcial o cancelado sin explicación, y **antes de que se postee nada**:
el modal guarda primero la ejecución y después la OT, así que un rechazo del
servidor dejaría el trabajo registrado y la orden sin cerrar.

El cuerpo del PATCH suma `cierre_justificacion`.

- [ ] **Paso 4: Verificar**

```bash
npx tsc --noEmit
npm test
node scripts/revisar-responsive.mjs
```

- [ ] **Paso 5: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/RegistrarOTModal.tsx"
git commit -m "fix(mantenimiento): registrar el trabajo precarga el cierre y pide el porque"
```

---

### Tarea 8: Se ve en la ficha de la OT

**Archivos:**
- Modificar: `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx` (`OTDetail`)

Que se vea es la mitad del punto de tenerla en una columna: hoy las
observaciones de una OT no se muestran en ningún lado del sistema.

- [ ] **Paso 1: Mostrarla**

Un bloque con el mismo formato que el de «Descripción», con el rótulo **«Por
qué se cerró antes del inicio»**, sólo cuando `o.cierre_justificacion` tiene
algo. Va debajo de la descripción. La columna llega sola: el `GET` hace
`select("*")`.

No se hace editable desde acá: se corrige volviendo a registrar el trabajo, que
es donde se corrige todo lo demás.

- [ ] **Paso 2: Verificar todo junto**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-responsive.mjs
node scripts/revisar-exportaciones.mjs
node scripts/revisar-arbol-commiteado.mjs
```

- [ ] **Paso 3: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/OrdenesClient.tsx"
git commit -m "feat(mantenimiento): la ficha de la OT muestra por que se cerro antes"
```

---

### Tarea 9: Dejarlo escrito

**Archivos:**
- Modificar: `CLAUDE.md`
- Modificar: `docs/MANTENIMIENTO-INTEGRACION.md`

- [ ] **Paso 1: La sección en el documento del módulo**

Una sección `## El cierre anterior al inicio` en
`docs/MANTENIMIENTO-INTEGRACION.md` con lo que no se deduce del código: que la
regla compara **contra la fecha guardada** y no contra «vino el campo», y por
qué; que la celda W se compone **desde la fila** y no desde el cuerpo; que el
drenaje de la cola arma la W con la justificación sola y se lleva las
observaciones; y que la columna se vacía cuando las fechas dejan de
contradecirse.

- [ ] **Paso 2: El renglón en `CLAUDE.md`**

En la fila de Mantenimiento de la tabla «Antes de retomar un módulo», enlazando
el spec y este plan, con los tres números que evitan rehacer el análisis: 66 de
2.176 ya están así, 44 PROGRAMADO contra 22 CORRECTIVO, y **sólo 3 de las 66
entraron por la app** — o sea que lo que viene de la planilla va a seguir
cerrándose antes sin explicar nada.

- [ ] **Paso 3: Commit y push**

```bash
git add CLAUDE.md docs/MANTENIMIENTO-INTEGRACION.md
git commit -m "docs(mantenimiento): el cierre anterior al inicio y sus trampas"
```

---

## Lo que queda afuera, a propósito

- **Las 66 que ya existen no se tocan.** Quedan con la columna en null, que
  dice la verdad: nadie escribió esa justificación.
- **Lo que entra por el formulario de Google o por la planilla no pasa por
  ninguna de estas reglas**, y va a seguir pudiendo cerrarse antes sin
  explicar nada. Es la misma línea que ya tiene la fecha de fin.
- **Los cuatro generadores automáticos** —periódicos, cuaderno, partes de
  contratista y grupos del cuaderno— no pasan por `loQueFaltaParaCrear`, así
  que ninguno se cae.
- **No se audita.** `auditoria` es para lo que no se deshace; esto es un texto
  que se corrige.

# La falla del equipo al cerrar la OT — Plan de implementación

> **Para quien lo ejecute con agentes:** SUB-SKILL REQUERIDA: usar
> superpowers:subagent-driven-development (recomendada) o
> superpowers:executing-plans para implementar tarea por tarea. Los pasos usan
> casillas (`- [ ]`) para ir marcando.

**Objetivo:** que al dar una OT por realizada se pueda anotar qué falla tuvo el
equipo —dos listas cortas y un detalle, todo opcional— y que la ficha del equipo
muestre qué falla se repite más.

**Arquitectura:** tres columnas nuevas en `ordenes_trabajo` (no una tabla
aparte: una falla pertenece a exactamente una OT), un módulo puro con el
vocabulario y el ranking, un componente de formulario compartido por las tres
pantallas que cierran una OT, y una sección en la ficha del equipo. Nada de esto
viaja a la planilla.

**Stack:** Next.js 16 (App Router), Supabase/PostgREST, zod para validar cuerpos,
vitest sobre funciones puras. Todo en castellano.

**Spec:** [2026-10-26-mantenimiento-falla-del-equipo-design.md](../specs/2026-10-26-mantenimiento-falla-del-equipo-design.md)

## Restricciones globales

- **Castellano** en nombres, comentarios, mensajes de pantalla y de commit.
- **Las claves van sin ñ**: `MATERIAL_EXTRANO`. `norm()` descompone la ñ.
- **No hay "Otro"** en ninguna de las dos listas.
- Los tres campos son **opcionales** y **no se exportan a la planilla**: van por
  `update` y nunca por el `registro` de `repartirRegistroDeOT`.
- **Un `<select>` se escribe `<Select>`** (`components/Select.tsx`).
- **El ancho va en un `div` que envuelva al campo**, nunca como clase al lado de
  `.input` (ver CLAUDE.md).
- **Nunca `git add -A`**: suele haber otra sesión en el mismo árbol.
- La migración **la corre una persona**; un agente no puede aplicar DDL.

## Foco de revisión

Lo que la spec implica, ninguna tarea ejercita sola, y mordería a quien use
esto. Cada línea tiene su test en la tarea que le corresponde:

1. **Un modo o una causa que no están en la lista entran por la ruta** (no por
   el formulario). Tiene que ser un 400, no texto libre en la columna — Tarea 4.
2. **Reabrir una OT y volver a cerrarla sin tocar la falla no la borra**: el
   modal manda todos sus campos en cada guardado — Tareas 4 y 5.
3. **Vaciar el desplegable a propósito sí borra** (`null`), que es distinto de
   no mandarlo — Tarea 4.
4. **Una OT con sólo detalle** cuenta en el ranking como «Sin clasificar» y hace
   aparecer la sección — Tareas 1 y 6.
5. **Una OT con falla y `fecha_ejecucion` nula** no rompe la última fecha ni
   muestra "Invalid Date" — Tarea 1.

---

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/mantenimiento/fallas.ts` (nuevo) | El vocabulario, su validación y el ranking. Puro. |
| `lib/mantenimiento/fallas.test.ts` (nuevo) | Sus tests. |
| `supabase/migrations/<ts>_mantenimiento_la_falla_del_equipo.sql` (nuevo) | Las tres columnas. |
| `components/FallaDeLaOT.tsx` (nuevo) | Los tres campos, compartidos por las tres pantallas. |
| `app/api/mantenimiento/ordenes/route.ts` | POST y PATCH: validar y guardar. |
| `lib/mantenimiento/ordenes.ts` | Que los tres campos no se cuelen en el `registro` de la planilla. |
| `app/(app)/mantenimiento/ordenes/RegistrarOTModal.tsx` | Los campos al cerrar. |
| `app/(app)/mantenimiento/ordenes/NuevaOTModal.tsx` | Los campos cuando nace cerrada. |
| `app/cargar/FormularioOTOffline.tsx` | Lo mismo, sin señal. |
| `app/(app)/mantenimiento/equipos/[id]/FallasDelEquipo.tsx` (nuevo) | La sección del ranking. |
| `app/(app)/mantenimiento/equipos/[id]/page.tsx` | Trae las OT con falla. |
| `app/(app)/mantenimiento/equipos/[id]/EquipoDetalle.tsx` | La monta bajo Confiabilidad. |
| `docs/MANTENIMIENTO-INTEGRACION.md` | Qué es la falla y por qué no va a la planilla. |

---

### Tarea 1: El vocabulario y el ranking

**Archivos:**
- Crear: `lib/mantenimiento/fallas.ts`
- Test: `lib/mantenimiento/fallas.test.ts`

**Interfaces:**
- Consume: nada.
- Produce:
  - `MODOS_DE_FALLA: ReadonlyArray<{ clave: string; etiqueta: string }>` (8)
  - `CAUSAS_DE_FALLA: ReadonlyArray<{ clave: string; etiqueta: string }>` (8)
  - `esModoDeFalla(v: unknown): boolean`, `esCausaDeFalla(v: unknown): boolean`
  - `etiquetaDeModo(clave: string | null): string | null`, `etiquetaDeCausa(...)`
  - `esquemaFalla` (zod): `{ falla_modo, falla_causa, falla_detalle }`, cada uno
    `string | null` y opcional; modo y causa sólo aceptan claves de las listas;
    `falla_detalle` recorta y pasa a `null` si queda vacío.
  - `type OtConFalla = { ot_number: number; fecha_ejecucion: string | null; falla_modo: string | null; falla_causa: string | null; falla_detalle: string | null }`
  - `rankingDeFallas(ots: readonly OtConFalla[]): FallaContada[]` donde
    `FallaContada = { modo: string | null; causa: string | null; titulo: string; veces: number; ultimaFecha: string | null; ots: { numero: number; detalle: string | null; fecha: string | null }[] }`

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
describe("el vocabulario", () => {
  it("tiene ocho y ocho, y ninguna clave lleva ñ", () => {
    expect(MODOS_DE_FALLA).toHaveLength(8);
    expect(CAUSAS_DE_FALLA).toHaveLength(8);
    // norm() descompone la ñ: una clave con ñ no matchea contra su propia
    // forma normalizada.
    for (const { clave } of [...MODOS_DE_FALLA, ...CAUSAS_DE_FALLA]) {
      expect(clave).toMatch(/^[A-Z_]+$/);
    }
    expect(CAUSAS_DE_FALLA.map((c) => c.clave)).toContain("MATERIAL_EXTRANO");
  });

  it("no tiene 'Otro' en ninguna de las dos", () => {
    const claves = [...MODOS_DE_FALLA, ...CAUSAS_DE_FALLA].map((o) => o.clave);
    expect(claves).not.toContain("OTRO");
  });

  it("reconoce lo que está y rechaza lo que no", () => {
    expect(esModoDeFalla("ROTURA")).toBe(true);
    expect(esModoDeFalla("rotura")).toBe(false);   // la clave es la clave
    expect(esModoDeFalla("SE ROMPIO")).toBe(false);
    expect(esCausaDeFalla("FRICCION")).toBe(true);
    expect(esCausaDeFalla("ROTURA")).toBe(false);  // no se cruzan las listas
  });
});

describe("esquemaFalla", () => {
  // Es lo único que separa dos listas cortas de un campo de texto libre: si la
  // ruta acepta cualquier cosa, el conteo se muere en silencio.
  it("rechaza un modo que no está en la lista", () => {
    expect(esquemaFalla.safeParse({ falla_modo: "SE ROMPIO TODO" }).success).toBe(false);
  });

  it("acepta que no venga ninguno, y que vengan nulos", () => {
    expect(esquemaFalla.safeParse({}).success).toBe(true);
    expect(esquemaFalla.safeParse({ falla_modo: null, falla_causa: null, falla_detalle: null }).success).toBe(true);
  });

  it("el detalle se recorta, y vacío es null", () => {
    expect(esquemaFalla.parse({ falla_detalle: "  eje lado motor  " }).falla_detalle).toBe("eje lado motor");
    expect(esquemaFalla.parse({ falla_detalle: "   " }).falla_detalle).toBeNull();
  });
});

describe("rankingDeFallas", () => {
  it("agrupa por modo + causa y ordena por veces", () => { /* 3 OT: 2 ROTURA+FRICCION, 1 DESGASTE+LUBRICACION → [veces 2, veces 1] */ });

  it("la misma causa con distinto modo no es la misma falla", () => { /* ROTURA+GOLPE y FLOJEDAD+GOLPE → dos renglones de 1 */ });

  it("cuenta la falla a medias, con la mitad vacía", () => {
    // Exigir las dos tiraría lo que alguien se tomó el trabajo de anotar.
    const r = rankingDeFallas([ot({ falla_modo: "ROTURA", falla_causa: null })]);
    expect(r[0].titulo).toBe("Rotura / quebradura");
  });

  it("la que sólo tiene detalle entra como «Sin clasificar»", () => {
    const r = rankingDeFallas([ot({ falla_modo: null, falla_causa: null, falla_detalle: "se salió la tapa" })]);
    expect(r[0].titulo).toBe("Sin clasificar");
    expect(r[0].ots[0].detalle).toBe("se salió la tapa");
  });

  it("la OT sin nada no entra", () => {
    expect(rankingDeFallas([ot({ falla_modo: null, falla_causa: null, falla_detalle: null })])).toEqual([]);
  });

  it("la última fecha es la mayor, y una fecha nula no la rompe", () => {
    const r = rankingDeFallas([
      ot({ ot_number: 1, fecha_ejecucion: "2026-03-01" }),
      ot({ ot_number: 2, fecha_ejecucion: null }),
      ot({ ot_number: 3, fecha_ejecucion: "2026-09-12" }),
    ]);
    expect(r[0].veces).toBe(3);
    expect(r[0].ultimaFecha).toBe("2026-09-12");
  });

  it("empatadas en veces, primero la más reciente", () => { /* dos de 1 vez, gana la de fecha mayor */ });
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

Run: `npx vitest run lib/mantenimiento/fallas.test.ts`
Esperado: FAIL, no existe el módulo.

- [ ] **Paso 3: Escribir `lib/mantenimiento/fallas.ts`**

Las claves y etiquetas son **exactamente** las de la tabla de la spec. El
encabezado del archivo explica por qué son dos listas y no texto libre, con el
número medido (`SE ROTAN MARTILLOS` / `ROTACION DE MARTILLOS` / `CAMBIO DE
MARTILLOS`, 23 OT del mismo evento en el mismo equipo).

`rankingDeFallas`: clave `${modo ?? ""}|${causa ?? ""}`, descarta la OT sin modo
ni causa ni detalle, ordena por `veces` desc y, a igual cantidad, por
`ultimaFecha` desc. Las fechas son texto `YYYY-MM-DD` y se comparan como texto
—pasar por `Date` corre el día en un servidor en UTC—; una fecha nula nunca gana
la comparación.

- [ ] **Paso 4: Correr y verificar que pasan**

Run: `npx vitest run lib/mantenimiento/fallas.test.ts`
Esperado: PASS.

- [ ] **Paso 5: Commit**

```bash
git add lib/mantenimiento/fallas.ts lib/mantenimiento/fallas.test.ts
git commit -m "feat(mantenimiento): el vocabulario de fallas y su ranking"
```

---

### Tarea 2: La migración (y la espera)

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_mantenimiento_la_falla_del_equipo.sql`
  (el nombre lo genera `npm run migracion "mantenimiento la falla del equipo"`)

**Interfaces:**
- Produce: `ordenes_trabajo.falla_modo`, `.falla_causa`, `.falla_detalle`, las
  tres `text` y nulas, que las tareas 4, 5 y 6 usan.

- [ ] **Paso 1: Generar el archivo**

Run: `npm run migracion "mantenimiento la falla del equipo"`

- [ ] **Paso 2: Escribir el DDL y su encabezado**

```sql
alter table public.ordenes_trabajo
  add column if not exists falla_modo    text,
  add column if not exists falla_causa   text,
  add column if not exists falla_detalle text;
```

El encabezado tiene que decir, como el de la migración del GUT: que son nulas
porque la causa no está escrita en ningún lado —976 correctivas, ninguna con
causa—; que **no llevan `check` ni enum** a propósito, porque el vocabulario se
va a tocar y cada palabra nueva costaría una migración, y que por eso **la
validación vive en `lib/mantenimiento/fallas.ts` y la ruta rechaza lo que no
esté**; y que el día que alguien regenere `lib/asistente/catalogo.generado.json`
estas tres columnas entran solas, que es lo buscado.

- [ ] **Paso 3: Pedirle a una persona que la corra**

Un agente no puede correr DDL. Decirlo con todas las letras y **esperar**: las
tareas 4, 5 y 6 no se pueden probar contra la base hasta que esté aplicada.

- [ ] **Paso 4: Confirmar que existen**

Run: `node scripts/que-cuelga-de.mjs ordenes_trabajo` (sirve como ping) o una
consulta a `information_schema.columns` con el service role de `.env.local`.
Esperado: las tres columnas aparecen.

- [ ] **Paso 5: Commit**

```bash
git add supabase/migrations/<timestamp>_mantenimiento_la_falla_del_equipo.sql
git commit -m "feat(mantenimiento): las tres columnas de la falla del equipo"
```

---

### Tarea 3: El componente de los tres campos

**Archivos:**
- Crear: `components/FallaDeLaOT.tsx`

**Interfaces:**
- Consume: `MODOS_DE_FALLA`, `CAUSAS_DE_FALLA` (Tarea 1).
- Produce:
  ```ts
  export interface LaFalla { falla_modo: string; falla_causa: string; falla_detalle: string }
  export const FALLA_VACIA: LaFalla;
  export default function FallaDeLaOT(props: {
    falla: LaFalla;
    onCambiar: (falla: LaFalla) => void;
    deshabilitado?: boolean;
  }): JSX.Element;
  ```
  Las tres claves son **las de la base**, así que el cuerpo que arma cada
  formulario es `{ ...form, ...falla }` sin traducir nada.

- [ ] **Paso 1: Escribir el componente**

Dos `<Select>` —opción vacía primero, con la etiqueta «—»— y un `<input>` de
texto para el detalle, bajo el rótulo «La falla, si la hubo». Los dos
desplegables lado a lado de `sm` para arriba y apilados abajo, **con el ancho en
el `div` que envuelve** a cada uno. Un comentario de encabezado explica que vive
en `components/` y no copiado en tres pantallas, con el precedente de
`RepuestosDeLaOT` y lo que costó el 19/10/2026.

- [ ] **Paso 2: Verificar que compila**

Run: `npx tsc --noEmit`
Esperado: sin errores (los que haya en archivos que no tocó esta tarea, mirar
`git status` antes de arreglarlos: puede ser otra sesión).

- [ ] **Paso 3: Commit**

```bash
git add components/FallaDeLaOT.tsx
git commit -m "feat(mantenimiento): los campos de la falla, en un solo lugar"
```

---

### Tarea 4: La ruta

**Archivos:**
- Modificar: `app/api/mantenimiento/ordenes/route.ts` (POST y PATCH)
- Modificar: `lib/mantenimiento/ordenes.ts` (`repartirRegistroDeOT`)
- Test: `lib/mantenimiento/ordenes.test.ts` (ya existe)

**Interfaces:**
- Consume: `esquemaFalla` (Tarea 1); las columnas (Tarea 2).
- Produce: el POST y el PATCH aceptan `falla_modo`, `falla_causa` y
  `falla_detalle`.

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
describe("repartirRegistroDeOT y la falla", () => {
  it("manda los tres campos a la tabla y ninguno a la planilla", () => {
    const { update, registro } = repartirRegistroDeOT({
      falla_modo: "ROTURA", falla_causa: "FRICCION", falla_detalle: "eje lado motor",
    });
    expect(update).toMatchObject({ falla_modo: "ROTURA", falla_causa: "FRICCION", falla_detalle: "eje lado motor" });
    expect(registro).toEqual({});
  });

  it("no mandar un campo deja lo que había; mandarlo vacío lo borra", () => {
    expect(repartirRegistroDeOT({ horas: 2 }).update).not.toHaveProperty("falla_modo");
    expect(repartirRegistroDeOT({ falla_modo: "" }).update.falla_modo).toBeNull();
  });
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

Run: `npx vitest run lib/mantenimiento/ordenes.test.ts`
Esperado: FAIL.

- [ ] **Paso 3: Sumar los tres campos a `repartirRegistroDeOT`**

Van junto a los que ya tienen columna propia pero **no** a `registro`: el bloque
existente `EN_LOS_DOS_LADOS` no sirve acá, porque ésos sí viajan a la planilla.

- [ ] **Paso 4: Validar en las dos puntas de la ruta**

En el POST, con `validar(esquemaFalla, …)` y `errorDeValidacion()`, copiando el
bloque que ya hace eso con `esquemaGut` tres líneas más arriba, y sumando los
tres campos a `record`. En el PATCH, lo mismo antes de `repartirRegistroDeOT`.
Un modo que no está en la lista tiene que salir **400 con el mensaje de zod en
castellano**, no entrar a la columna.

- [ ] **Paso 5: Correr los tests y el tipado**

Run: `npx vitest run lib/mantenimiento/ordenes.test.ts && npx tsc --noEmit`
Esperado: PASS y sin errores.

- [ ] **Paso 6: Probar contra la base de verdad**

Con el service role de `.env.local`, un PATCH a una OT de prueba con
`falla_modo: "NO_EXISTE"` (espera 400) y otro con `"ROTURA"` (espera 200 y la
columna escrita). La pantalla está detrás del login; esto es lo que hay.

- [ ] **Paso 7: Commit**

```bash
git add app/api/mantenimiento/ordenes/route.ts lib/mantenimiento/ordenes.ts lib/mantenimiento/ordenes.test.ts
git commit -m "feat(mantenimiento): la ruta de OT acepta la falla, y sólo del vocabulario"
```

---

### Tarea 5: Los tres formularios

**Archivos:**
- Modificar: `app/(app)/mantenimiento/ordenes/RegistrarOTModal.tsx`
- Modificar: `app/(app)/mantenimiento/ordenes/NuevaOTModal.tsx`
- Modificar: `app/cargar/FormularioOTOffline.tsx`

**Interfaces:**
- Consume: `FallaDeLaOT`, `LaFalla`, `FALLA_VACIA` (Tarea 3).

- [ ] **Paso 1: `RegistrarOTModal`**

El componente entre las observaciones y los botones. **Se precarga desde la
orden** —`orden.falla_modo` y las otras dos, que hay que sumar al tipo de la
prop y a la consulta que arma el listado en `OrdenesClient`— y los tres campos
viajan en el PATCH que ya existe. Sin precarga, reabrir una OT para corregir las
horas le borra la falla sin avisar.

- [ ] **Paso 2: `NuevaOTModal` y `FormularioOTOffline`**

El componente aparece **sólo si `cierraAlCrearse`**, que es la constante que las
dos pantallas ya calculan, y los tres campos se suman al cuerpo que mandan.
Guardarlos como tres strings sueltos en el estado del formulario hace que una
carga sin señal que quedó parada los recupere sola: `borradorDesdeElCuerpo`
copia los campos de texto por nombre.

- [ ] **Paso 3: Verificar**

Run: `npx tsc --noEmit && npm test && node scripts/revisar-responsive.mjs`
Esperado: sin errores de tipos, los tests en verde (sigue fallando sólo el de
credenciales de `lib/asistente/consulta.test.ts`) y ROMPE 0.

- [ ] **Paso 4: Medir el ancho de los dos desplegables**

Réplica estática con el CSS real o medición equivalente: en los 295 px útiles de
un teléfono, los dos campos y el detalle tienen que entrar sin recortarse.

- [ ] **Paso 5: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/RegistrarOTModal.tsx" "app/(app)/mantenimiento/ordenes/NuevaOTModal.tsx" app/cargar/FormularioOTOffline.tsx "app/(app)/mantenimiento/ordenes/OrdenesClient.tsx"
git commit -m "feat(mantenimiento): anotar la falla en las tres puertas que cierran una OT"
```

---

### Tarea 6: La sección en la ficha del equipo

**Archivos:**
- Crear: `app/(app)/mantenimiento/equipos/[id]/FallasDelEquipo.tsx`
- Modificar: `app/(app)/mantenimiento/equipos/[id]/page.tsx`
- Modificar: `app/(app)/mantenimiento/equipos/[id]/EquipoDetalle.tsx`

**Interfaces:**
- Consume: `rankingDeFallas`, `FallaContada` (Tarea 1).
- Produce: `FallasDelEquipo({ fallas }: { fallas: FallaContada[] })`.

- [ ] **Paso 1: La consulta**

En `page.tsx`, dentro del `Promise.all` que ya está: las OT del equipo con
`falla_modo`, `falla_causa` o `falla_detalle` cargados —`.or(...)` con los tres
`not.is.null`—, trayendo `ot_number` y `fecha_ejecucion`. Sin `.limit()`
arbitrario: un equipo no va a tener mil fallas, pero si las tiene, **usar
`traerTodo()`** y no confiar en el tope de 1000 de PostgREST.

- [ ] **Paso 2: La sección**

Un renglón por falla: el título —«Rotura por fricción»—, cuántas veces y la
última fecha; debajo, un renglón por OT con su número y su detalle. El rótulo de
la sección dice de qué habla: «Fallas registradas · todas, desde siempre», para
que no se lea como el conteo de la tarjeta de Confiabilidad que está arriba, que
son las correctivas de los últimos 365 días.

- [ ] **Paso 3: Montarla**

En `EquipoDetalle`, entre `<ConfiabilidadDelEquipo />` y el historial de estado.
**No se renderiza si no hay ninguna falla**: van a ser casi todos los equipos
durante meses.

- [ ] **Paso 4: Verificar**

Run: `npx tsc --noEmit && npm run build && node scripts/revisar-responsive.mjs`
Esperado: build exit 0 y ROMPE 0. Y una comprobación con datos: cargar una falla
de prueba por la ruta sobre una OT de un equipo conocido y mirar que el ranking
la cuente (consulta a la base; la pantalla está detrás del login).

- [ ] **Paso 5: Commit**

```bash
git add "app/(app)/mantenimiento/equipos/[id]/FallasDelEquipo.tsx" "app/(app)/mantenimiento/equipos/[id]/page.tsx" "app/(app)/mantenimiento/equipos/[id]/EquipoDetalle.tsx"
git commit -m "feat(mantenimiento): la ficha del equipo muestra que falla se repite mas"
```

---

### Tarea 7: Que el asistente lo entienda, y la documentación

**Archivos:**
- Modificar: `lib/asistente/catalogo.generado.json` (regenerado)
- Modificar: `docs/MANTENIMIENTO-INTEGRACION.md`

- [ ] **Paso 1: Regenerar el catálogo del asistente**

Sólo después de que la migración esté aplicada: se genera leyendo la base. Con
las tres columnas adentro, el asistente contesta "qué falla se repite más" sin
que exista ninguna pantalla nueva. El GUT necesitó este mismo paso aparte.

- [ ] **Paso 2: Documentar**

En `docs/MANTENIMIENTO-INTEGRACION.md`, una sección corta: qué se anota, por qué
son dos listas y no texto libre —con el número medido—, que **no viaja a la
planilla** y por qué (riesgo asumido, igual que el GUT), y que una OT ya cerrada
no puede cargar su falla sin reabrirla.

- [ ] **Paso 3: Verificar el árbol commiteado**

Run: `node scripts/revisar-arbol-commiteado.mjs`
Esperado: EXIT=0.

- [ ] **Paso 4: Commit**

```bash
git add lib/asistente/catalogo.generado.json docs/MANTENIMIENTO-INTEGRACION.md
git commit -m "docs(mantenimiento): la falla del equipo, y que el asistente la vea"
```

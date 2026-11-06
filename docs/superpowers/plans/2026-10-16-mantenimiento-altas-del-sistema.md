# El alta del sistema en su propia pestaña — plan de implementación

> **Para quien ejecute esto:** las tareas van de a una, cada una con su test y su commit.

**Objetivo:** que una OT creada desde el sistema se escriba en una pestaña donde
Forms no inserta, y que el master la ubique por N° de OT y no por posición.

**Arquitectura:** el alta pasa de `Respuestas de formulario` a `Altas del
sistema`, en el mismo libro. La serie queda repartida entre las dos pestañas, así
que tanto el SdG como el Apps Script cuentan las dos. En el master, las cuatro
importaciones apilan las dos fuentes con `ORDER BY` por N° de OT, y la fila de
una OT **se busca** en vez de calcularse.

**Stack:** Next.js 16, TypeScript, vitest, Google Sheets API v4, Apps Script.

**Spec:** [2026-10-16-mantenimiento-altas-del-sistema-design.md](../specs/2026-10-16-mantenimiento-altas-del-sistema-design.md)

## Restricciones globales

- Todo en castellano: nombres, comentarios y mensajes de pantalla y de commit.
- `HOJA_DE_ALTAS = "Altas del sistema"`, en el libro
  `GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID`. Los datos arrancan en la fila 2.
- Un fallo de escritura se devuelve con **lo que dijo Google, sin traducir**, y
  nunca como `null` — que es el valor de "salió bien".
- Nada va como texto: `escribirCeldas` usa `USER_ENTERED`, las fechas van como
  serial.
- Vitest sólo sobre funciones puras. Lo que habla con Google no se testea; lo
  que decide, sí.
- Verificación antes de dar una tarea por buena: `npm test`, `npx tsc --noEmit`,
  `npm run build`, `node scripts/revisar-arbol-commiteado.mjs`.

## Review Focus

Lo que el spec implica y ningún test de tarea ejercita. Cada línea tiene su test
en la tarea que le corresponde.

1. **La pestaña `Altas del sistema` todavía no existe** — Google devuelve 400 y
   el mensaje tiene que nombrar la pestaña, no decir "no se pudo escribir".
   (Tarea 2)
2. **La pestaña existe pero sin encabezado** — `celdasDelAlta` no encuentra
   ninguna columna; hay que negarse diciendo cuáles faltan, no escribir una fila
   vacía. (Tarea 2)
3. **Dos altas al mismo tiempo** calculan la misma fila libre y la segunda pisa
   a la primera. (Tarea 2)
4. **La OT no está en el master todavía** — el `IMPORTRANGE` tarda, así que no
   encontrarla es lo normal en el alta y no un error del sistema. (Tarea 3)
5. **La columna A del formulario sigue sin congelar** — no se toma número, y el
   mensaje tiene que seguir nombrando esa pestaña y no la de altas. (Tarea 1)

---

### Tarea 1: El próximo número cuenta las dos pestañas

**Archivos:**
- Modificar: `lib/mantenimiento/formulario.ts` (`loQueSigueEnLaSerie`)
- Test: `lib/mantenimiento/formulario.test.ts`

**Interfaces:**
- Produce: `loQueSigueEnLaSerie(serieDelFormulario, serieDeLasAltas): LoQueSigue`,
  donde `LoQueSigue` es `{ ok: true; ot_number: number; fila: number } | { ok: false; error: string }`.
  **`fila` es ahora la primera libre de `Altas del sistema`**, no la del
  formulario.

- [ ] **Paso 1: escribir los tests que fallan**

En el `describe("lo que sigue en la serie")` que ya existe, reemplazar las
llamadas de un argumento y agregar:

```ts
it("el maximo sale de las dos pestanas, no de una", () => {
  const form = [["N° OT"], ["2795"]];
  const altas = [["N° OT"], ["2796"], ["2797"]];
  const r = loQueSigueEnLaSerie(form, altas);
  expect(r.ok && r.ot_number).toBe(2798);
});

it("si el maximo esta en el formulario, tambien", () => {
  const r = loQueSigueEnLaSerie([["N° OT"], ["2799"]], [["N° OT"], ["2796"]]);
  expect(r.ok && r.ot_number).toBe(2800);
});

it("la fila es la de las altas, no la del formulario", () => {
  // El formulario tiene 2.175 filas y las altas tres: se escribe en la cuarta.
  const form = Array.from({ length: 2175 }, (_, i) => [String(600 + i)]);
  const r = loQueSigueEnLaSerie(form, [["N° OT"], ["2796"], ["2797"]]);
  expect(r.ok && r.fila).toBe(4);
});

it("con las altas vacias se empieza en la fila 2", () => {
  const r = loQueSigueEnLaSerie([["N° OT"], ["2795"]], [["N° OT"]]);
  expect(r.ok && r.fila).toBe(2);
  expect(r.ok && r.ot_number).toBe(2796);
});

// Review Focus 5: la guarda mira el formulario, que es donde está la cadena.
it("una formula viva en el formulario sigue frenando, y nombra esa pestana", () => {
  const r = loQueSigueEnLaSerie([["N° OT"], ['=A2+1']], [["N° OT"]]);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toContain("Respuestas de formulario");
  expect(r.error).not.toContain("Altas del sistema");
});
```

- [ ] **Paso 2: correr y ver que fallan**

Correr: `npx vitest run lib/mantenimiento/formulario.test.ts`
Esperado: FAIL por los argumentos de más.

- [ ] **Paso 3: implementar**

`loQueSigueEnLaSerie(serieDelFormulario, serieDeLasAltas): LoQueSigue` en
`lib/mantenimiento/formulario.ts`. La guarda `laSerieEstaCongelada` se aplica
**sólo al formulario** —es donde vive la cadena de fórmulas; la pestaña de altas
la escribe el sistema con literales—, `ot_number` es el mayor de los dos máximos
más uno, y `fila` sale de `filaSiguienteSegunLaColumna(serieDeLasAltas)`.

Actualizar el comentario de la función: hoy explica el incidente del 16/10 con
una sola pestaña y ahora son dos.

- [ ] **Paso 4: correr y ver que pasan**

Correr: `npx vitest run lib/mantenimiento/formulario.test.ts`
Esperado: PASS

- [ ] **Paso 5: commitear**

```bash
git add lib/mantenimiento/formulario.ts lib/mantenimiento/formulario.test.ts
git commit -F <mensaje>
```

---

### Tarea 2: El alta escribe en `Altas del sistema`

**Archivos:**
- Modificar: `lib/mantenimiento/formulario.ts` (`altaEnLaPlanilla`, constantes)
- Test: `lib/mantenimiento/formulario.test.ts`

**Interfaces:**
- Consume: `loQueSigueEnLaSerie` de la Tarea 1.
- Produce: `HOJA_DE_ALTAS = "Altas del sistema"` exportada; `altaEnLaPlanilla`
  mantiene su firma `(datos: Omit<DatosDelAlta, "ot_number">) => Promise<ResultadoDelAlta>`.
- Produce: `laFilaEstaLibre(celda: readonly (readonly unknown[])[]): boolean`,
  pura, para la guarda de concurrencia.

- [ ] **Paso 1: escribir los tests que fallan**

```ts
describe("la fila donde va el alta tiene que estar libre", () => {
  // Review Focus 3: dos altas a la vez calculan la misma fila libre.
  it("una fila con algo no esta libre", () => {
    expect(laFilaEstaLibre([["2798"]])).toBe(false);
  });

  it("vacia, sin celdas o con espacios, si", () => {
    expect(laFilaEstaLibre([[""]])).toBe(true);
    expect(laFilaEstaLibre([])).toBe(true);
    expect(laFilaEstaLibre([["   "]])).toBe(true);
  });
});
```

Y en `describe("las celdas del alta")`, para el Review Focus 2:

```ts
it("sin encabezado se niega y dice que columnas faltan", () => {
  const r = celdasDelAlta([], datos);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.motivos.join(" ")).toContain("descripcion");
});
```

- [ ] **Paso 2: correr y ver que fallan**

Correr: `npx vitest run lib/mantenimiento/formulario.test.ts`
Esperado: FAIL — `laFilaEstaLibre` no existe.

- [ ] **Paso 3: implementar `laFilaEstaLibre` y reescribir `altaEnLaPlanilla`**

`laFilaEstaLibre` es una línea sobre la primera celda.

`altaEnLaPlanilla` queda con esta secuencia, y el orden importa:

1. Leer con `leerFormulas` la columna A de **las dos** pestañas.
2. `loQueSigueEnLaSerie(formulario, altas)`; si no, devolver su error.
3. Leer el encabezado de `Altas del sistema` (fila 1 de **esa** pestaña).
4. `celdasDelAlta(encabezado, { ...datos, ot_number })`; si no, devolver sus motivos.
5. **Releer `A{fila}` de las altas** y exigir `laFilaEstaLibre`; si no, devolver
   que alguien escribió ahí mientras tanto y que se reintente.
6. Escribir con `escribirCeldas` en `HOJA_DE_ALTAS`.
7. **Releer `A{fila}`** y exigir que diga `ot_number`; si no, decir con qué quedó.

El `catch` que ya envuelve todo se queda: es lo que convierte un 400 de Google
—la pestaña que no existe, Review Focus 1— en el mensaje que vuelve a pantalla.
Para que ese mensaje nombre la pestaña, el `error` del catch se prefija con
`` `No se pudo escribir en «${HOJA_DE_ALTAS}»: ` ``.

- [ ] **Paso 4: correr los tests**

Correr: `npx vitest run lib/mantenimiento/formulario.test.ts && npx tsc --noEmit`
Esperado: PASS y tsc limpio.

- [ ] **Paso 5: commitear**

---

### Tarea 3: La fila del master se busca, no se calcula

**Archivos:**
- Modificar: `lib/mantenimiento/planillaDeOT.ts`
- Modificar: `app/api/mantenimiento/ordenes/route.ts` (los dos llamadores)
- Test: `lib/mantenimiento/planillaDeOT.test.ts`

**Interfaces:**
- Produce: `filaDeLaOTenElMaster(columnaA: readonly (readonly unknown[])[], ot_number: number | null): number | null`,
  pura. Devuelve el número de fila de planilla (1-based) o `null`.
- Produce: `escribirEnLaFilaDeLaOT(orden: { ot_number: number | null }, celdas)`.
  **Deja de recibir `sheets_row`.**
- `porQueNoLlegaALaPlanilla(planilla: string): string | null` — pierde el
  parámetro `orden`, porque `sheets_row` deja de ser una razón. Queda sólo la
  variable de entorno.

- [ ] **Paso 1: escribir los tests que fallan**

```ts
describe("en que fila del master esta una OT", () => {
  const columna = [["N° OT"], ["2795"], ["2796"], ["2797"]];

  it("la encuentra por su numero, no por una cuenta", () => {
    expect(filaDeLaOTenElMaster(columna, 2796)).toBe(3);
  });

  // Review Focus 4: el IMPORTRANGE tarda, así que no estar es lo normal.
  it("si no esta devuelve null y no una fila plausible", () => {
    expect(filaDeLaOTenElMaster(columna, 2800)).toBeNull();
    expect(filaDeLaOTenElMaster(columna, null)).toBeNull();
  });

  it("no confunde 279 con 2796", () => {
    expect(filaDeLaOTenElMaster(columna, 279)).toBeNull();
  });

  it("el encabezado no cuenta como fila de datos", () => {
    expect(filaDeLaOTenElMaster([["2796"]], 2796)).toBe(1);
  });
});
```

Y cambiar los tests de `porQueNoLlegaALaPlanilla` que hoy esperan el motivo de
`sheets_row`: queda sólo el de la variable.

- [ ] **Paso 2: correr y ver que fallan**

Correr: `npx vitest run lib/mantenimiento/planillaDeOT.test.ts`
Esperado: FAIL — `filaDeLaOTenElMaster` no existe.

- [ ] **Paso 3: implementar**

`filaDeLaOTenElMaster` compara `Number()` de la primera celda contra
`ot_number`, devuelve `i + 1` y `null` si no está o si `ot_number` es `null`.

En `escribirEnLaFilaDeLaOT`: leer `${pestana}!A:A` una vez, buscar la fila, y si
no está devolver que la OT todavía no llegó al master —que el `IMPORTRANGE`
tarda— y que se reintente. Si está, escribir ahí. **Desaparece la relectura de
`A{fila}`**: buscar ya es la verificación.

En `app/api/mantenimiento/ordenes/route.ts`, los dos llamadores dejan de pasar
`sheets_row`. La columna sigue en la base y la sigue llenando la sincronización;
lo que cambia es que la escritura ya no la usa.

- [ ] **Paso 4: correr todo**

Correr: `npm test && npx tsc --noEmit`
Esperado: PASS

- [ ] **Paso 5: commitear**

---

### Tarea 4: El Apps Script cuenta las dos pestañas

**Archivos:**
- Modificar: `docs/mantenimiento-formulario-apps-script.gs`

**Interfaces:** ninguna con el código del SdG; lo instala una persona.

- [ ] **Paso 1: implementar**

Agregar `var HOJA_ALTAS = 'Altas del sistema';`. Sacar de `siguienteNumero_` la
cuenta del máximo a un `maximoDeLaHoja_(hoja, filaExcluida)` —que es el cuerpo
que ya tiene— y que `siguienteNumero_` devuelva el mayor de las dos hojas más
uno. Si la pestaña de altas no existe, `getSheetByName` devuelve `null` y cuenta
como cero: el formulario tiene que poder numerar igual.

Corregir el encabezado del archivo: hoy dice *"da igual en qué fila física
termine cada uno: el master ordena por número"*, y eso era falso — el master no
ordenaba. Decir que ordena **desde el 16/10/2026** y por qué.

- [ ] **Paso 2: verificar a ojo**

No hay test: es Apps Script y vive en la planilla. Lo que se comprueba es que
`maximoDeLaHoja_` recibe la hoja y la fila a excluir, y que `siguienteNumero_`
sigue excluyendo la fila que se está numerando **sólo en la hoja de respuestas**
—en la de altas no hay ninguna fila que excluir—.

- [ ] **Paso 3: commitear**

---

### Tarea 5: La documentación y los pasos a mano

**Archivos:**
- Modificar: `docs/MANTENIMIENTO-INTEGRACION.md`
- Modificar: `docs/VARIABLES-VERCEL.md`

- [ ] **Paso 1: escribir**

En `MANTENIMIENTO-INTEGRACION.md`, reemplazar la sección "Crear una OT desde el
sistema: la planilla primero" por la que corresponde: la pestaña aparte, el
`ORDER BY`, la serie repartida en dos hojas, y la fila del master que se busca.
Lo que ya está escrito sobre el incidente del 16/10 se conserva — es el porqué.

En `VARIABLES-VERCEL.md`, la fila de `GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID`
dice que se escribe en `Respuestas de formulario`; pasa a `Altas del sistema` y
explica que la serie se cuenta sobre las dos.

Agregar al final del documento de Mantenimiento la lista de lo que queda a mano,
con las fórmulas exactas del spec:

1. Crear `Altas del sistema` con el encabezado de 31 columnas.
2. Reemplazar `A2`, `D3`→**`D2`**, `E2` y `S2` del master.
3. Pegar el Apps Script nuevo.
4. Congelar `Respuestas de formulario!A2:A`.

- [ ] **Paso 2: commitear y pushear**

Correr antes: `npm test`, `npx tsc --noEmit`, `npm run build`,
`node scripts/revisar-arbol-commiteado.mjs`.

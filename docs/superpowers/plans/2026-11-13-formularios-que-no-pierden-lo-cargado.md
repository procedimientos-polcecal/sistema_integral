# Los formularios no pierden lo cargado — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que un toque distraído fuera de un formulario no destruya lo cargado, en las 48 pantallas con modal, y que lo escrito vuelva al reabrirlo.

**Arquitectura:** se construye el componente de modal que nunca existió y los 48 pasan por él. En la etapa 1 ese componente se encarga de cerrar, preguntar cuando hay algo escrito y tirar al cancelar — una línea por modal. En la etapa 2, módulo por módulo empezando por Mantenimiento, cada formulario junta sus campos en un objeto y pasa a recordarlos mientras la app esté abierta.

**Stack:** TypeScript, Next.js 16 App Router, React 19, vitest.

**Spec:** [docs/superpowers/specs/2026-11-11-formularios-que-no-pierden-lo-cargado-design.md](../specs/2026-11-11-formularios-que-no-pierden-lo-cargado-design.md)

## Restricciones globales

- Todo en **castellano**: nombres, comentarios, texto de pantalla, identificadores y mensajes de commit.
- **Nunca `git add -A`.** Sólo los archivos de la tarea, por nombre: suele haber otra sesión en el mismo árbol.
- Vitest sobre **funciones puras**. Las pantallas no llevan test, así que toda decisión sale del componente a una función pura.
- **`className="input w-20"` no mide 20** y `.card` con `border-*` no pinta el borde: lo de `globals.css` está fuera de capa y le gana a las utilidades. El ancho va en un `div` que envuelva.
- **Una grilla de 3+ columnas lleva breakpoint**; una `<table>` va con scroll. Lo mira `node scripts/revisar-responsive.mjs`, que hoy da `ROMPE 0 · APRETADO 0 · MIRAR 1` (`calidad/ensayos/reporte`, preexistente).
- **Parar el dev server antes de `npm run build`**, o la app queda en 500.
- **El borrador no sobrevive a cerrar la app.** Nada de `localStorage` para esto: haría que sobreviva, que es justo lo que se descartó.

## Foco de revisión

Cinco cosas que el spec implica y que ningún test obvio ejercita. Cada una tiene su test en la tarea que la posee.

1. **Un borrador no puede aparecer en el registro equivocado.** Es el anti-goal principal: perder lo cargado se nota, guardarlo sobre otra OT no. → Tarea 1.
2. **Un alta prellenada desde otra cosa no comparte borrador con un alta en blanco.** `GenerarOTModal` nace desde un aviso; con una clave genérica su borrador cae sobre un alta nueva. → Tarea 1.
3. **El cartel no sale con el formulario intacto.** Varios nacen con valores por omisión; comparar contra vacío en vez de contra el estado inicial haría salir el cartel cuando nadie tocó nada, y un cartel que sobra enseña a apretar sin leer. → Tarea 1.
4. **El cajón de navegación del celular tiene que seguir cerrándose al tocar afuera.** Es `fixed inset-0` pero no es un formulario; que deje de cerrarse sería una regresión diaria. → Tarea 5.
5. **Un guardado que falla a mitad no puede perder el borrador.** `RegistrarOTModal` hace `POST` y después `PATCH`; tirar al empezar pierde todo justo cuando el guardado falló, que es el bug original. → Tarea 6.

---

## Tarea 1: Las tres decisiones, como funciones puras

**Archivos:**
- Crear: `lib/core/borradorDeFormulario.ts`
- Crear: `lib/core/borradorDeFormulario.test.ts`

**Interfaces:**
- Consume: nada.
- Produce:
  ```ts
  /** De dónde salió el formulario, cuando nació prellenado desde otra cosa. */
  export interface Origen { tipo: string; id: string | number }
  export function claveDelBorrador(formulario: string, origen?: Origen | null): string;
  export function hayAlgoEscrito<T extends object>(inicial: T, actual: T): boolean;
  ```

- [ ] **Paso 1: escribir los tests que fallan**

```ts
it("dos registros distintos no comparten clave", () => {
  expect(claveDelBorrador("registrar-ot", { tipo: "ot", id: 2905 }))
    .not.toBe(claveDelBorrador("registrar-ot", { tipo: "ot", id: 2907 }));
});

it("un alta en blanco no comparte clave con una prellenada desde un aviso", () => {
  expect(claveDelBorrador("nueva-ot"))
    .not.toBe(claveDelBorrador("nueva-ot", { tipo: "aviso", id: 5 }));
});

it("dos altas desde el mismo aviso sí comparten clave: es el mismo trabajo", () => {
  expect(claveDelBorrador("nueva-ot", { tipo: "aviso", id: 5 }))
    .toBe(claveDelBorrador("nueva-ot", { tipo: "aviso", id: 5 }));
});

it("el número y el texto del mismo id son la misma clave", () => {
  expect(claveDelBorrador("ot", { tipo: "ot", id: 7 }))
    .toBe(claveDelBorrador("ot", { tipo: "ot", id: "7" }));
});

it("un formulario intacto no tiene nada escrito, aunque nazca con valores", () => {
  const inicial = { horas: "8", contratista: "", operario: null };
  expect(hayAlgoEscrito(inicial, { ...inicial })).toBe(false);
});

it("cambiar un valor por omisión cuenta como escrito", () => {
  expect(hayAlgoEscrito({ horas: "8" }, { horas: "9" })).toBe(true);
});

it("volver un campo a su valor inicial deja el formulario intacto", () => {
  expect(hayAlgoEscrito({ nota: "" }, { nota: "" })).toBe(false);
});

it("un campo anidado que cambió cuenta como escrito", () => {
  expect(hayAlgoEscrito({ repuestos: [{ id: 1 }] }, { repuestos: [{ id: 2 }] })).toBe(true);
});
```

- [ ] **Paso 2: correr y verificar que fallan**

Correr: `npx vitest run lib/core/borradorDeFormulario.test.ts`
Esperado: FALLA, «claveDelBorrador is not defined».

- [ ] **Paso 3: implementar las dos funciones**

`claveDelBorrador` arma una cadena estable con el nombre del formulario y, si hay origen, su tipo e id normalizado a texto — lo que hace que 7 y `"7"` den la misma clave. `hayAlgoEscrito` compara en profundidad el estado inicial contra el actual.

Los docstrings dicen **por qué**, que es la vara del repo: el de `claveDelBorrador` nombra la trampa —un borrador que reaparece sobre otro registro no se nota nunca, al revés que perderlo— y el de `hayAlgoEscrito` dice por qué compara contra el inicial y no contra vacío.

- [ ] **Paso 4: correr y verificar que pasan**

Correr: `npx vitest run lib/core/borradorDeFormulario.test.ts`
Esperado: PASA, 8 tests.

- [ ] **Paso 5: commitear**

```bash
git add lib/core/borradorDeFormulario.ts lib/core/borradorDeFormulario.test.ts
git commit -m "feat(core): la clave de un borrador y cuando un formulario esta tocado"
```

---

## Tarea 2: El almacén que vive lo que vive la app

**Archivos:**
- Modificar: `lib/core/borradorDeFormulario.ts`
- Modificar: `lib/core/borradorDeFormulario.test.ts`

**Interfaces:**
- Consume: `claveDelBorrador` de la Tarea 1.
- Produce:
  ```ts
  export function guardarBorrador(clave: string, valor: unknown): void;
  export function leerBorrador<T>(clave: string): T | undefined;
  export function tirarBorrador(clave: string): void;
  export function vaciarBorradores(): void;   // sólo para los tests
  ```

- [ ] **Paso 1: escribir los tests que fallan**

```ts
it("lo guardado vuelve con la misma clave", () => {
  guardarBorrador("k", { horas: "8" });
  expect(leerBorrador("k")).toEqual({ horas: "8" });
});

it("una clave que nadie guardó devuelve undefined y no un objeto vacío", () => {
  expect(leerBorrador("nunca")).toBeUndefined();
});

it("tirarlo lo saca de verdad", () => {
  guardarBorrador("k", { a: 1 });
  tirarBorrador("k");
  expect(leerBorrador("k")).toBeUndefined();
});

it("tirar una clave no toca a las demás", () => {
  guardarBorrador("a", { x: 1 });
  guardarBorrador("b", { y: 2 });
  tirarBorrador("a");
  expect(leerBorrador("b")).toEqual({ y: 2 });
});
```

- [ ] **Paso 2: correr y verificar que fallan**

Correr: `npx vitest run lib/core/borradorDeFormulario.test.ts`
Esperado: FALLA, «guardarBorrador is not defined».

- [ ] **Paso 3: implementar el almacén**

Un `Map` a nivel de módulo. **No `localStorage` ni `sessionStorage`**: el spec pide que el borrador no sobreviva a cerrar la app, y un `Map` de módulo muere con el bundle, que es exactamente esa vida.

El docstring dice por qué está en memoria y no en el teléfono, y deja anotado lo que se pierde a propósito: **recargar la página también lo pierde**, y se aceptó porque el caso que se pidió resolver es el formulario que se cierra, no el navegador que se va.

- [ ] **Paso 4: correr y verificar que pasan**

Correr: `npx vitest run lib/core/borradorDeFormulario.test.ts`
Esperado: PASA, 12 tests.

- [ ] **Paso 5: commitear**

```bash
git add lib/core/borradorDeFormulario.ts lib/core/borradorDeFormulario.test.ts
git commit -m "feat(core): los borradores viven en memoria, que es lo que dura la app"
```

---

## Tarea 3: El `ConfirmProvider` deja de faltar en tres módulos

**Archivos:**
- Modificar: `app/(app)/layout.tsx`
- Modificar: los nueve `app/(app)/<modulo>/layout.tsx` que hoy lo montan
- Modificar: `app/(app)/seguridad-higiene/condiciones/FichaDeCondicion.tsx`

**Interfaces:**
- Consume: `ConfirmProvider` de `components/ConfirmProvider.tsx`.
- Produce: `useConfirm()` disponible en todo `(app)` sin que cada módulo se acuerde.

- [ ] **Paso 1: montar el proveedor una sola vez**

En `app/(app)/layout.tsx`, envolviendo lo que hoy envuelve `NavMovilProvider` — que ya es el precedente de un proveedor de cliente montado en ese layout de servidor.

El porqué va en un comentario: el hueco **creció solo**. El 11/11/2026 eran dos módulos con modal y sin proveedor; el 13/11 son tres, porque apareció `mis-pedidos`. Montarlo por módulo es una lista que se queda corta sola; montarlo acá lo hereda el que venga.

- [ ] **Paso 2: sacar los nueve montajes de módulo y el de la ficha**

Quedan redundantes: administración, agenda, cantera, compras, inventario, mantenimiento, remises, rrhh y ventas, más el de `FichaDeCondicion.tsx`, que es el precedente por pantalla. **`app/cargar/CargarClient.tsx` no se toca**: vive fuera de `(app)` y el layout nuevo no lo cubre.

- [ ] **Paso 3: comprobar que no quedó ninguno sin cubrir**

Correr: `grep -rn "<ConfirmProvider" app --include=*.tsx`
Esperado: exactamente dos — `app/(app)/layout.tsx` y `app/cargar/CargarClient.tsx`.

- [ ] **Paso 4: verificar**

Correr, con el dev server parado: `npx tsc --noEmit && npm run build`
Esperado: exit 0 los dos.

- [ ] **Paso 5: commitear**

```bash
git add "app/(app)/layout.tsx" "app/(app)/seguridad-higiene/condiciones/FichaDeCondicion.tsx"
# y los nueve layout.tsx de módulo, por nombre
git commit -m "fix(core): el confirm se monta una vez y no se le escapa un modulo nuevo"
```

---

## Tarea 4: El componente de modal

**Archivos:**
- Crear: `components/Modal.tsx`

**Interfaces:**
- Consume: `useConfirm` (Tarea 3), `hayAlgoEscrito` (Tarea 1).
- Produce:
  ```ts
  export interface ModalProps {
    titulo: string;
    children: React.ReactNode;
    /** Sale conservando: la X, el fondo y Escape. */
    alSalir: () => void;
    /** Tira lo cargado. Es el botón negativo del formulario. */
    alCancelar?: () => void;
    /** Verdadero cuando hay algo a medio cargar: dispara la pregunta al salir. */
    tocado?: boolean;
    /** Un visor de sólo lectura: sale derecho y nunca pregunta. */
    soloLectura?: boolean;
    ancho?: "chico" | "medio" | "ancho";
  }
  export function Modal(props: ModalProps): React.ReactElement;
  ```

- [ ] **Paso 1: implementar el componente**

El fondo, la X y `Escape` llaman a `alSalir`. Si `tocado` es verdadero y no es `soloLectura`, antes preguntan con `useConfirm`.

**El texto del cartel no puede decir que se pierde lo cargado**, porque el borrador se guarda igual: dice que hay algo a medio cargar y ofrece seguir ahí. Mentirle a alguien en un cartel es lo que enseña a apretar sin leer.

Cuidado con dos trampas del repo al escribir el marcado: una clase de `globals.css` al lado de una utilidad de Tailwind gana ella, así que un ancho va en un `div` que envuelva; y el panel va con scroll propio para que entre en 343 px.

- [ ] **Paso 2: verificar**

Correr: `npx tsc --noEmit && npx eslint components/Modal.tsx`
Esperado: exit 0 los dos.

- [ ] **Paso 3: commitear**

```bash
git add components/Modal.tsx
git commit -m "feat(ui): el modal compartido que nunca existio"
```

---

## Tarea 5: Los 48 pasan por el componente (etapa 1)

**Archivos:**
- Modificar: los 48 archivos con `fixed inset-0` bajo `app/` y `components/`

**Interfaces:**
- Consume: `Modal` de la Tarea 4.

- [ ] **Paso 1: separar los que no son formularios**

De los 48, éstos usan el componente con `soloLectura` y **no** reciben nunca `tocado`: `components/Sidebar.tsx` (el cajón de navegación del celular, que es una capa oscura sin panel), `components/Asistente.tsx`, y los visores `DetalleOS.tsx`, `HojaDePersona.tsx`, `PlanDetalle.tsx` y la caja de compartir de `remises/hoy/RouteCard.tsx`, cuyo textarea es `readOnly`.

**El cajón de navegación tiene que seguir cerrándose al tocar afuera.** Si deja de hacerlo, esto convirtió un arreglo en un estorbo diario.

- [ ] **Paso 2: migrar los demás, módulo por módulo**

Cada uno pasa su marcado al componente y cablea `alSalir` y `alCancelar`. Hoy son el mismo callback en varios —en `RegistrarOTModal` el fondo (línea 206) y el botón Cancelar (línea 359) llaman los dos a `onCerrar`—, así que separarlos es el trabajo.

La regla es mecánica: **el que tira es el botón negativo del formulario**, el que hoy dice Cancelar; la X, el fondo y Escape salen conservando. Un visor cuyo botón dice «Cerrar» no tira nada porque no hay nada que tirar.

En esta etapa **ningún modal pasa `tocado`**: sin borrador todavía, el cartel no tendría qué proteger. Eso llega en la Tarea 6.

- [ ] **Paso 3: verificar**

Correr, con el dev server parado:
```
npx tsc --noEmit && npm test && npm run build && node scripts/revisar-responsive.mjs
```
Esperado: tsc 0; tests en verde; build 0; `ROMPE 0 · APRETADO 0` y ningún `MIRAR` nuevo (el de `calidad/ensayos/reporte` es anterior).

- [ ] **Paso 4: commitear por módulo**

Un commit por módulo, con los archivos por nombre. Son muchos archivos y otra sesión puede estar en el árbol.

---

## Tarea 6: Mantenimiento recuerda lo cargado (etapa 2)

**Archivos:**
- Crear: `lib/core/useBorrador.ts`
- Modificar: los modales de formulario de `app/(app)/mantenimiento/`

**Interfaces:**
- Consume: `guardarBorrador`, `leerBorrador`, `tirarBorrador`, `claveDelBorrador`, `hayAlgoEscrito`.
- Produce:
  ```ts
  export function useBorrador<T extends object>(
    clave: string,
    inicial: T
  ): { valores: T; cambiar: (parcial: Partial<T>) => void; tocado: boolean; tirar: () => void };
  ```

- [ ] **Paso 1: escribir el test que falla**

El hook no se testea —es de pantalla—, pero **lo que decide sí**. En `lib/core/borradorDeFormulario.test.ts`:

```ts
it("el borrador guarda sólo lo que se tocó, no el registro entero", () => {
  const inicial = { horas: "8", contratista: "PIPARO", operario: "Perez" };
  guardarBorrador("k", soloLoTocado(inicial, { ...inicial, horas: "9" }));
  expect(leerBorrador("k")).toEqual({ horas: "9" });
});

it("restaurar sobre un registro que cambió no pisa lo que no se tocó", () => {
  const delServidor = { horas: "8", contratista: "CANDIA", operario: "Perez" };
  expect(conElBorrador(delServidor, { horas: "9" }))
    .toEqual({ horas: "9", contratista: "CANDIA", operario: "Perez" });
});
```

Firmas: `soloLoTocado<T>(inicial: T, actual: T): Partial<T>` y `conElBorrador<T>(delServidor: T, borrador: Partial<T>): T`, las dos en `lib/core/borradorDeFormulario.ts`.

**Por qué importa:** `RegistrarOTModal` manda en un solo `PATCH` las horas, el contratista, los tres operarios y la falla. Guardar el registro entero y restaurarlo reescribiría también lo que otro corrigió mientras tanto, y la app vive instalada en los teléfonos desde el 16/10/2026.

- [ ] **Paso 2: correr y verificar que falla**

Correr: `npx vitest run lib/core/borradorDeFormulario.test.ts`
Esperado: FALLA, «soloLoTocado is not defined».

- [ ] **Paso 3: implementar las dos funciones y el hook**

El hook junta los campos del formulario en un objeto, guarda lo tocado con cada cambio y expone `tocado` para que el `Modal` sepa si preguntar.

- [ ] **Paso 4: migrar los modales de Mantenimiento**

Cada uno junta sus `useState` de campos en un solo objeto y pasa por `useBorrador`. **No entran** los estados que no son el formulario: `guardando`, el error, la foto, las listas que vinieron del servidor.

Y el momento de tirar, que es la trampa de esta tarea: **el borrador se tira cuando el guardado salió bien, no al apretar el botón.** `RegistrarOTModal` hace un `POST` y después un `PATCH`; si el segundo falla, el modal queda abierto con el error y lo cargado tiene que seguir ahí. (Que un reintento tras un fallo a medias pueda duplicar la ejecución es un problema anterior a esto y no lo arregla este trabajo.)

- [ ] **Paso 5: verificar**

Correr, con el dev server parado:
```
npx tsc --noEmit && npm test && npm run build
```
Esperado: exit 0 los tres.

- [ ] **Paso 6: commitear**

```bash
git commit -m "feat(mantenimiento): los formularios recuerdan lo cargado mientras la app este abierta"
```

---

## Tarea 7: El chequeo que impide volver a empezar

**Archivos:**
- Crear: `scripts/revisar-modales.mjs`

- [ ] **Paso 1: implementar el escaneo**

Recorre `app/` y `components/` buscando `fixed inset-0` y marca el que no venga de `components/Modal.tsx`. Una lista de excepciones declaradas, con su porqué al lado, como la de `revisar-responsive`.

**Por qué existe, medido:** entre el 11/11 y el 13/11/2026 aparecieron **tres modales nuevos escritos a mano** —de 45 a 48— y un módulo nuevo sin proveedor. Dos días. Sin esto, la inconsistencia vuelve sola.

Sale 1 si hay algún ROMPE. **No entra al CI** hasta que su lista de excepciones aguante unas semanas, que es la costumbre del repo con `revisar-responsive` y `revisar-exportaciones`.

- [ ] **Paso 2: verificar**

Correr: `node scripts/revisar-modales.mjs`
Esperado: `ROMPE 0`, y las excepciones listadas.

- [ ] **Paso 3: commitear**

```bash
git add scripts/revisar-modales.mjs
git commit -m "chore: un modal escrito a mano ya no pasa inadvertido"
```

---

## Tarea 8: Dejarlo anotado donde se lo va a buscar

**Archivos:**
- Modificar: `CLAUDE.md`

- [ ] **Paso 1: la nota**

Va al lado de las tres reglas de la misma familia —el `<Select>`, la grilla con breakpoint y el ancho que no mide—, porque es la cuarta y falla igual de callado: **escribir `fixed inset-0` a mano no rompe nada**, y esa pantalla simplemente vuelve a perder lo que alguien cargó.

Lo que no se deduce del código: que **Cancelar tira y todo lo demás sale conservando**; que el borrador **vive lo que vive la app** y por eso está en memoria y no en el teléfono; que **la clave incluye de dónde salió el formulario** y no sólo qué registro edita, con el caso del alta prellenada desde un aviso; que **el borrador guarda sólo lo que se tocó**, con el `PATCH` de la OT como motivo; y que el `ConfirmProvider` **se monta una sola vez en `app/(app)/layout.tsx`** porque la lista por módulo se quedaba corta sola.

**Antes de editar, `git status`:** `CLAUDE.md` lo tocan otras sesiones seguido.

- [ ] **Paso 2: commitear**

```bash
git add CLAUDE.md
git commit -m "docs(ui): como se escribe un modal que no pierde lo cargado"
```

---

## Qué comprobar al final

```bash
npm test
npx tsc --noEmit
npm run build                      # con el dev server parado
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
node scripts/revisar-modales.mjs
```

**Lo que ningún test de este repo puede decir**, y hay que mirar a mano antes de dar esto por bueno: que el cajón de navegación del celular siga cerrándose al tocar afuera, que el cartel no salga con un formulario recién abierto, y que un borrador recuperado aparezca en el registro que le toca. Las pantallas no tienen tests acá, así que lo que se pudo sacar a función pura está probado y lo demás se mira.

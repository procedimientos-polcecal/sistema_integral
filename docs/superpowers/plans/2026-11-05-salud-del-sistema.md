# La salud del sistema avisa sola — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`) para marcar avance.

**Objetivo:** que una sincronización rota llegue sola a los 3 `admin_sistema`, por la campana y el push que ya existen, sin que nadie se acuerde de mirar.

**Arquitectura:** generaliza `lib/agenda/avisosDeLaAgenda.ts` —que ya resuelve esto bien para dos pasos de la Agenda— a los 29 recursos de la vista `ultima_sincronizacion`. Un **registro declarado** dice cuánto silencio tolera cada recurso y cuáles están exceptuados; un productor de avisos dinámico, con la forma de `avisosDeRitmo`, emite **un aviso por recurso caído**; y una pantalla en `/administracion/salud` es donde el push aterriza.

**Stack:** TypeScript, Next.js 16 App Router, Supabase (`@supabase/supabase-js`), vitest.

**Spec:** [docs/superpowers/specs/2026-11-05-salud-del-sistema-design.md](../specs/2026-11-05-salud-del-sistema-design.md)

## Restricciones globales

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Nunca `git add -A`.** Agregar sólo los archivos de la tarea, por nombre: hay otras sesiones en el mismo árbol.
- Vitest sobre **funciones puras**. Las rutas y las pantallas no llevan test.
- **`traerTodo()`** de `lib/core/paginado.ts` en cualquier lectura que pueda crecer; PostgREST corta en 1000 sin avisar.
- **Un `select()` va en una cadena literal**, nunca armado en una variable: pierde la inferencia de tipos.
- **Ningún aviso nuevo reusa un id viejo.** `avisos_fotos` compara por id, y reusar uno le entrega a quien lo descartó un aviso ya silenciado que nunca vio.
- El `href` de un aviso va **al primer nivel** del payload del push, no adentro de un `data`.
- **Depende de la migración `20261105092248`** (columna `canonico`). Al escribirse este plan **no estaba aplicada**: la aplica el usuario a mano en el editor SQL de Supabase. Sin ella la vista sigue dando 5 alarmas falsas contra 1 fallo real.

## Foco de revisión

Cinco cosas que el spec implica y que ningún test obvio ejercita. Cada una tiene su test en la tarea que le corresponde.

1. **Un `created_at` ilegible no puede contar como «corrió recién».** `estadoDeRecurso` recibe texto de la base; un `NaN` que cae por el lado sano vuelve mudo justo al recurso roto. → Tarea 1.
2. **Un recurso exceptuado nunca produce aviso, aunque su última corrida haya fallado.** Es el caso de `calidad/envases_bajada`, apagado a propósito: si se cuela, el sistema nuevo reintroduce el rojo permanente que el comentario de su workflow ya había evitado. → Tarea 2.
3. **Un recurso que aparece en la vista y no está en el registro no se ignora en silencio.** Es la defensa entera del diseño; si se traga, un módulo nuevo queda sin vigilar y nada lo dice. → Tarea 2.
4. **`filtrarDescartadas` tiene que poder soltar un aviso de salud descartado.** Con `cantidad` fija en 1, un descarte lo silencia para siempre y el recurso puede romperse de nuevo sin sonar. → Tarea 2.
5. **El push de un aviso de salud no lleva número.** `comoLinea` imprime `${cantidad} · ${titulo}` salvo para ritmo y banderas; sin eso el teléfono dice «2 · Agenda: los canales de Google no se renuevan», donde el 2 son tolerancias y parece una cuenta de canales. → Tarea 4.

---

## Tarea 1: El estado de un recurso

**Archivos:**
- Crear: `lib/core/saludDeLasSincronizaciones.ts`
- Crear: `lib/core/saludDeLasSincronizaciones.test.ts`

**Interfaces:**
- Consume: nada.
- Produce:
  ```ts
  export interface CorridaLeida {
    modulo: string;
    recurso: string;
    ok: boolean;
    error: string | null;
    created_at: string;
  }
  export type EstadoDeRecurso = "nunca" | "fallo" | "vieja" | "sana";
  export function estadoDeRecurso(
    corrida: CorridaLeida | undefined,
    toleranciaHoras: number,
    ahora: Date
  ): EstadoDeRecurso;
  export function cuantasTolerancias(
    corrida: CorridaLeida | undefined,
    toleranciaHoras: number,
    ahora: Date
  ): number;
  ```

- [ ] **Paso 1: escribir los tests que fallan**

En `lib/core/saludDeLasSincronizaciones.test.ts`, sobre `estadoDeRecurso`:

```ts
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 3_600_000).toISOString();
const AHORA = new Date("2026-11-05T12:00:00Z");
const corrida = (p: Partial<CorridaLeida>): CorridaLeida =>
  ({ modulo: "cantera", recurso: "acarreo", ok: true, error: null, created_at: hace(1), ...p });

it("sin fila es 'nunca'", () => expect(estadoDeRecurso(undefined, 24, AHORA)).toBe("nunca"));
it("la última falló es 'fallo'", () =>
  expect(estadoDeRecurso(corrida({ ok: false, error: "x" }), 24, AHORA)).toBe("fallo"));
it("dentro de la tolerancia es 'sana'", () =>
  expect(estadoDeRecurso(corrida({ created_at: hace(23) }), 24, AHORA)).toBe("sana"));
it("pasada la tolerancia es 'vieja'", () =>
  expect(estadoDeRecurso(corrida({ created_at: hace(25) }), 24, AHORA)).toBe("vieja"));
it("una fecha ilegible NO cuenta como sana", () =>
  expect(estadoDeRecurso(corrida({ created_at: "no es una fecha" }), 24, AHORA)).toBe("vieja"));
it("un fallo viejo se nombra por el fallo y no por la edad", () =>
  expect(estadoDeRecurso(corrida({ ok: false, created_at: hace(99) }), 24, AHORA)).toBe("fallo"));
```

Y sobre `cuantasTolerancias`, que es lo que hace que un descarte expire:

```ts
it("recién caído es 1", () =>
  expect(cuantasTolerancias(corrida({ created_at: hace(25) }), 24, AHORA)).toBe(1));
it("crece con el silencio, para que el descarte se suelte", () =>
  expect(cuantasTolerancias(corrida({ created_at: hace(73) }), 24, AHORA)).toBe(3));
it("un fallo reciente también es al menos 1", () =>
  expect(cuantasTolerancias(corrida({ ok: false, created_at: hace(1) }), 24, AHORA)).toBe(1));
it("sin fila es 1", () => expect(cuantasTolerancias(undefined, 24, AHORA)).toBe(1));
```

- [ ] **Paso 2: correr y verificar que fallan**

Correr: `npx vitest run lib/core/saludDeLasSincronizaciones.test.ts`
Esperado: FALLA, «estadoDeRecurso is not defined».

- [ ] **Paso 3: implementar las dos funciones**

En `lib/core/saludDeLasSincronizaciones.ts`. `estadoDeRecurso` es `estadoDelPaso` de `lib/agenda/avisosDeLaAgenda.ts` con la tolerancia como parámetro en lugar de la constante `HORAS_SIN_CORRER`; copiar su guarda de `Number.isNaN`, que es el test 5. `cuantasTolerancias` sigue a `cantidadDelAviso` de `lib/home/ritmo.ts`: `Math.floor(horasDeSilencio / toleranciaHoras)`, con piso 1.

El docstring de cada una dice **por qué**, no qué. El de `cuantasTolerancias` tiene que explicar que su número **no cuenta cosas** —son tolerancias, no recursos ni canales— y que existe para que descartarlo no lo silencie para siempre; es la misma nota que lleva `cantidadDelAviso`.

- [ ] **Paso 4: correr y verificar que pasan**

Correr: `npx vitest run lib/core/saludDeLasSincronizaciones.test.ts`
Esperado: PASA, 10 tests.

- [ ] **Paso 5: commitear**

```bash
git add lib/core/saludDeLasSincronizaciones.ts lib/core/saludDeLasSincronizaciones.test.ts
git commit -m "feat(core): cuando un recurso esta caido, y cuanto hace"
```

---

## Tarea 2: El registro y las entradas caídas

**Archivos:**
- Modificar: `lib/core/saludDeLasSincronizaciones.ts`
- Modificar: `lib/core/saludDeLasSincronizaciones.test.ts`

**Interfaces:**
- Consume: `CorridaLeida`, `estadoDeRecurso`, `cuantasTolerancias` de la Tarea 1.
- Produce:
  ```ts
  export type FamiliaDeExcepcion =
    | "solo-escribe-si-hay-algo"
    | "se-ve-en-otro-lado"
    | "apagado-a-proposito";
  export interface EntradaDelRegistro {
    modulo: string;
    /** Uno, o varios cuando una sola corrida los escribe a todos. */
    recursos: string[];
    titulo: string;
    toleranciaHoras: number | null;   // null ⟺ exceptuada
    excepcion?: { familia: FamiliaDeExcepcion; porque: string; quienLoLevanta?: string };
  }
  export const REGISTRO: readonly EntradaDelRegistro[];
  export interface EntradaCaida {
    clave: string;      // `${modulo}/${recursos[0]}`
    titulo: string;
    estado: "nunca" | "fallo" | "vieja";
    tolerancias: number;
    detalle: string;    // el texto del error SIN TRADUCIR, o cuánto hace que no corre
  }
  export function entradasCaidas(corridas: CorridaLeida[], ahora?: Date): EntradaCaida[];
  export function recursosSinDeclarar(corridas: CorridaLeida[]): string[];
  ```

- [ ] **Paso 1: escribir los tests que fallan**

```ts
it("una entrada exceptuada no sale caída aunque su última corrida haya fallado", () => {
  const caidas = entradasCaidas(
    [{ modulo: "calidad", recurso: "envases_bajada", ok: false, error: "x", created_at: hace(999) }],
    AHORA
  );
  expect(caidas).toEqual([]);
});

it("un recurso de la vista que nadie declaró se nombra", () => {
  expect(
    recursosSinDeclarar([{ modulo: "nuevo", recurso: "cosa", ok: true, error: null, created_at: hace(1) }])
  ).toEqual(["nuevo/cosa"]);
});

it("ningún recurso del registro se declara dos veces", () => {
  const todos = REGISTRO.flatMap((e) => e.recursos.map((r) => `${e.modulo}/${r}`));
  expect(todos).toEqual([...new Set(todos)]);
});

it("toda entrada exceptuada dice por qué, y ninguna vigilada trae excepción", () => {
  for (const e of REGISTRO) {
    if (e.toleranciaHoras === null) expect(e.excepcion?.porque).toBeTruthy();
    else expect(e.excepcion).toBeUndefined();
  }
});

it("el detalle de un fallo es el texto del error sin traducir", () => {
  const [caida] = entradasCaidas(
    [{ modulo: "calidad", recurso: "carbonilla-odoo", ok: false,
       error: "No se pudo llegar a Odoo (…): fetch failed", created_at: hace(1) }],
    AHORA
  );
  expect(caida.detalle).toContain("fetch failed");
});

it("un grupo que una sola corrida escribe sale como una entrada y no como ocho", () => {
  const corridas = ["sheets", "RRHH - Padron", "RRHH - Asistencia"].map((recurso) => ({
    modulo: "respaldo", recurso, ok: true, error: null, created_at: hace(400),
  }));
  expect(entradasCaidas(corridas, AHORA)).toHaveLength(1);
});
```

- [ ] **Paso 2: correr y verificar que fallan**

Correr: `npx vitest run lib/core/saludDeLasSincronizaciones.test.ts`
Esperado: FALLA, «REGISTRO is not defined».

- [ ] **Paso 3: cargar el registro**

Una entrada por recurso o grupo, **cada una con su número medido al lado en el comentario** — ése es el formato, y es lo que permite revisarlo después. La evidencia está en la tabla «El umbral no puede salir del cron declarado» del spec. Valores iniciales:

| Entrada | Tolerancia | Por qué |
|---|---|---|
| `mantenimiento/ordenes`, `/avisos`, `/ordenes-servicio`, `/comparativas` | 24 h | en 60 días el hueco mayor fue 10,2 h |
| `inventario/movimientos`, `/articulos` | 24 h | hueco mayor 10,2 h |
| `cantera/acarreo` | 24 h | hueco mayor 7,9 h |
| `taller_vial/cargas` | 24 h | hueco mayor 9,4 h |
| `calidad/envases_movimientos`, `/envases_articulos` | 24 h | hueco mayor 10,1 h |
| `calidad/carbonilla-planilla`, `/carbonilla-odoo` | 36 h | cron diario; 24 h deja sonar una corrida apenas tarde |
| `rrhh/recalculo` | 24 h | cada 6 h declarado, hueco mayor 13,1 h |
| `rrhh/lenox-marcaciones` | 50 h | diario: una corrida salteada no suena, la segunda sí — el mismo cálculo que `HORAS_SIN_CORRER` |
| `produccion/molinos` | 50 h | diario |
| `seguridad_higiene/respaldo_fotos` | 50 h | diario |
| `agenda/canales`, `agenda/barrido` | 50 h | diario, 05:00 UTC — es el valor que ya tenían |
| `respaldo/*` (grupo de 8) | 14 días | cron semanal. Una sola entrada: la corrida escribe las ocho filas de una |
| `compras/planilla` | 24 h | lo dispara un webhook y no un cron; hueco mayor 0,8 h el 05/11 |
| `agenda/pendientes` | — | `se-ve-en-otro-lado`: «es reescribir lo que no se pudo escribir, y eso ya se ve en el evento» |
| `agenda/aviso_de_google` | — | `solo-escribe-si-hay-algo`: la fila se escribe sólo cuando hay algo que decir, así que un fallo queda clavado hasta el próximo |
| `calidad/envases_bajada` | — | `apagado-a-proposito`, levanta `admin_sistema` descomentando el `schedule:` de `.github/workflows/calidad-envases-bajada.yml` |

- [ ] **Paso 4: implementar `entradasCaidas` y `recursosSinDeclarar`**

`entradasCaidas` recorre `REGISTRO`, saltea las exceptuadas, y para cada entrada toma **la peor** de las corridas de sus recursos. `recursosSinDeclarar` es la diferencia entre lo que trae la vista y lo declarado, incluidas las excepciones.

El `detalle` de un `fallo` es `corrida.error` **sin traducir** —es la regla de las planillas y vale igual acá: un diagnóstico que no se distingue de otro no es un diagnóstico—. El de `vieja` dice cuánto hace que no corre; reusar `haceCuanto` de `lib/agenda/avisosDeLaAgenda.ts`.

- [ ] **Paso 5: correr y verificar que pasan**

Correr: `npx vitest run lib/core/saludDeLasSincronizaciones.test.ts`
Esperado: PASA.

- [ ] **Paso 6: commitear**

```bash
git add lib/core/saludDeLasSincronizaciones.ts lib/core/saludDeLasSincronizaciones.test.ts
git commit -m "feat(core): el registro declara cuanto silencio tolera cada recurso"
```

---

## Tarea 3: Leer la salud de la base

**Archivos:**
- Modificar: `lib/core/saludDeLasSincronizaciones.ts`

**Interfaces:**
- Consume: `entradasCaidas`, `recursosSinDeclarar` de la Tarea 2.
- Produce:
  ```ts
  export interface SaludDelSistema {
    caidas: EntradaCaida[];
    sinDeclarar: string[];
    /** La comprobación misma falló. NO es «todo bien». */
    sinComprobar: boolean;
    /** Lo leído, para dibujar la pantalla. Vacío si no se pudo leer. */
    corridas: CorridaLeida[];
  }
  export async function leerLaSalud(
    supabase: SupabaseClient,
    ahora?: Date
  ): Promise<SaludDelSistema>;
  ```

- [ ] **Paso 1: implementar `leerLaSalud`**

Copia la forma de `leerLaSaludDeLaAgenda`, que ya la tiene resuelta: lee `ultima_sincronizacion` con `select("modulo, recurso, ok, error, created_at")` —cadena literal—, y **si la lectura falla NO devuelve 0**: devuelve `sinComprobar: true`. Nunca tira, ni por un error de PostgREST ni por una excepción de red: la campana corre en cada página del sistema y no puede caerse por esto. El fallo va al log.

Sin filtro de módulo —a diferencia de la de la Agenda, que filtra por `modulo = 'agenda'`—, porque acá se quieren los 29.

- [ ] **Paso 2: verificar que compila y que la suite sigue verde**

Correr: `npx tsc --noEmit && npx vitest run lib/core/`
Esperado: sin errores; los tests de la Tarea 2 siguen pasando.

- [ ] **Paso 3: commitear**

```bash
git add lib/core/saludDeLasSincronizaciones.ts
git commit -m "feat(core): leer la salud, y decir no se cuando no se pudo mirar"
```

---

## Tarea 4: Los avisos, y retirar los dos de la Agenda

**Archivos:**
- Modificar: `lib/home/avisos.ts`
- Modificar: `lib/home/avisos.test.ts`
- Modificar: `lib/home/avisosDeUsuario.ts`
- Modificar: `lib/home/resumenDeAvisos.ts`
- Modificar: `lib/home/resumenDeAvisos.test.ts`
- Modificar: `lib/agenda/avisosDeLaAgenda.ts` (sacar `pasosCaidos`; **`lineasDeSalud` y `PASOS_CON_GOOGLE` se quedan**)

**Interfaces:**
- Consume: `SaludDelSistema` de la Tarea 3.
- Produce: `export function avisosDeSalud(salud: SaludDelSistema): Notificacion[];` en `lib/home/avisos.ts`.

- [ ] **Paso 1: escribir los tests que fallan**

En `lib/home/avisos.test.ts`, con este ayudante arriba:

```ts
const caida = (clave: string): EntradaCaida =>
  ({ clave, titulo: `Caído: ${clave}`, estado: "fallo", tolerancias: 1, detalle: "x" });
```

```ts
it("cada recurso caído es su propio aviso, con id estable", () => {
  const avisos = avisosDeSalud({
    caidas: [
      { clave: "agenda/canales", titulo: "Agenda: los canales de Google", estado: "fallo", tolerancias: 1, detalle: "x" },
      { clave: "calidad/carbonilla-odoo", titulo: "Calidad: la lectura de Odoo", estado: "fallo", tolerancias: 2, detalle: "y" },
    ],
    sinDeclarar: [], sinComprobar: false, corridas: [],
  });
  expect(avisos.map((a) => a.id)).toEqual(["salud-agenda/canales", "salud-calidad/carbonilla-odoo"]);
  expect(avisos.every((a) => a.href === "/administracion/salud")).toBe(true);
});

/*
 * El caso que tiró abajo la forma de un solo aviso con el conteo: se arregla
 * uno y se rompe otro el mismo día. Con un conteo agregado la cantidad queda
 * en 1, `loQueSeMovio` no ve movimiento y el fallo nuevo es invisible.
 */
it("un fallo que reemplaza a otro es un aviso nuevo y no un empate", () => {
  const ayer = avisosDeSalud({ caidas: [caida("calidad/carbonilla-odoo")], sinDeclarar: [], sinComprobar: false, corridas: [] });
  const hoy = avisosDeSalud({ caidas: [caida("agenda/canales")], sinDeclarar: [], sinComprobar: false, corridas: [] });
  expect(hoy[0].id).not.toBe(ayer[0].id);
});

it("la cantidad son las tolerancias, para que el descarte se suelte", () => {
  const [a] = avisosDeSalud({ caidas: [{ ...caida("agenda/canales"), tolerancias: 3 }], sinDeclarar: [], sinComprobar: false, corridas: [] });
  expect(a.cantidad).toBe(3);
  expect(filtrarDescartadas([a], [{ notificacion_id: a.id, cantidad_vista: 1 }])).toEqual([a]);
});

it("un recurso sin declarar también avisa", () => {
  const avisos = avisosDeSalud({ caidas: [], sinDeclarar: ["nuevo/cosa"], sinComprobar: false, corridas: [] });
  expect(avisos).toHaveLength(1);
});

it("no se pudo comprobar es su propio aviso y no un cero", () => {
  const avisos = avisosDeSalud({ caidas: [], sinDeclarar: [], sinComprobar: true, corridas: [] });
  expect(avisos.map((a) => a.id)).toEqual(["salud-sin-comprobar"]);
});
```

En `lib/home/resumenDeAvisos.test.ts`:

```ts
it("un aviso de salud sale sin número: su cantidad son tolerancias, no cosas", () => {
  const push = resumirParaPush([
    { id: "salud-agenda/canales", titulo: "Agenda: los canales de Google no se renuevan", cantidad: 2, href: "/administracion/salud" },
  ]);
  expect(push?.body ?? "").not.toContain("2");
});
```

- [ ] **Paso 2: correr y verificar que fallan**

Correr: `npx vitest run lib/home/`
Esperado: FALLA, «avisosDeSalud is not defined».

- [ ] **Paso 3: implementar y cablear**

1. `avisosDeSalud` en `lib/home/avisos.ts`, con la forma de `avisosDeRitmo` —que es el precedente de un productor **dinámico**, a diferencia de `avisosDeConteos`, que mapea un record fijo—. Ids: `salud-${clave}`, `salud-sin-declarar` y `salud-sin-comprobar`.
2. En `lib/home/resumenDeAvisos.ts`, `esDeRitmo` pasa a reconocer también el prefijo `salud-`. Renombrarlo a `sinNumero`, porque ya no habla sólo de ritmo, y actualizar su comentario.
3. En `lib/home/avisosDeUsuario.ts`: `DE_UNA_LISTA` está tecleado por id exacto y los de salud son dinámicos, así que `sinLoQueNoPuedeAtender` necesita además una **regla por prefijo**: todo `salud-` pide `administraElSistema`. El comentario dice por qué, que es el mismo de `syh-fotos-sin-respaldar`: lo arregla quien toca las variables de Vercel y las credenciales, no quien usa el módulo.
4. Cambiar `opciones.saludDeLaAgenda` por `opciones.saludDelSistema`, que llama a `leerLaSalud` en vez de `leerLaSaludDeLaAgenda`, y sumar `avisosDeSalud(...)` al `return`. `avisosDeTodoElSistema` lo pide en `true`, igual que hoy.
5. Sacar `agendaPasosCaidos` y `agendaSaludSinComprobar` de `ConteosParaAvisos`, de `AVISOS`, de `ES_BANDERA` y de `DE_UNA_LISTA`. Sacar `pasosCaidos` de `lib/agenda/avisosDeLaAgenda.ts` y sus tests. **`PASOS_CON_GOOGLE`, `estadoDelPaso`, `haceCuanto` y `lineasDeSalud` se quedan**: los usa la pantalla de `/agenda`.

- [ ] **Paso 4: correr y verificar que pasan**

Correr: `npx vitest run && npx tsc --noEmit`
Esperado: PASA todo. Si algún test de la Agenda falla por los dos avisos retirados, se actualiza: es el cambio pedido, no una regresión.

- [ ] **Paso 5: commitear**

```bash
git add lib/home/avisos.ts lib/home/avisos.test.ts lib/home/avisosDeUsuario.ts lib/home/resumenDeAvisos.ts lib/home/resumenDeAvisos.test.ts lib/agenda/avisosDeLaAgenda.ts lib/agenda/avisosDeLaAgenda.test.ts
git commit -m "feat(core): cada sincronizacion rota avisa sola, y con nombre"
```

---

## Tarea 5: La pantalla donde el push aterriza

**Archivos:**
- Crear: `app/(app)/administracion/salud/page.tsx`
- Crear: `app/(app)/administracion/salud/SaludClient.tsx`
- Modificar: `app/(app)/administracion/page.tsx` (el enlace)

**Interfaces:**
- Consume: `leerLaSalud`, `SaludDelSistema`, `REGISTRO` de las Tareas 2 y 3.
- Produce: la ruta `/administracion/salud`.

- [ ] **Paso 1: la página**

Server Component con el mismo portón que `app/(app)/administracion/usuarios/page.tsx`: `supabase.auth.getUser()`, `redirect("/login")` si no hay, leer el `rol` y `redirect("/")` si no pasa `esAdminDelNucleo`. Después `leerLaSalud(supabase)` y pasarle el resultado al cliente.

- [ ] **Paso 2: el cliente**

Una línea por recurso declarado: **cuándo corrió por última vez**, si está caído, y **el texto del error sin traducir**. Las exceptuadas se listan aparte con su familia y su porqué —son lo primero que hay que mirar cuando un dato no llega, igual que las `pantalla` de `revisar-exportaciones`—, y las que aparecen en la vista sin estar declaradas, también.

Sin esta pantalla el resto no sirve: un push que aterriza donde no hay rastro del problema es el bug del mes de notificaciones que abrían el inicio.

Grilla `grid-cols-1 sm:grid-cols-*` y `<table>` dentro de un contenedor con scroll: lo comprueba `revisar-responsive`. Un ancho al lado de `.input` o `.card` no se aplica — va en un `div` que envuelva.

- [ ] **Paso 3: verificar**

Correr, con el dev server **parado**:
```
npx tsc --noEmit && npm run build && node scripts/revisar-responsive.mjs && npx eslint app/\(app\)/administracion/salud
```
Esperado: build en 0, `ROMPE 0 · APRETADO 0 · MIRAR 0`, eslint limpio.

- [ ] **Paso 4: commitear**

```bash
git add "app/(app)/administracion/salud/page.tsx" "app/(app)/administracion/salud/SaludClient.tsx" "app/(app)/administracion/page.tsx"
git commit -m "feat(administracion): la pantalla donde aterriza el aviso de salud"
```

---

## Tarea 6: Dejarlo anotado donde se lo va a buscar

**Archivos:**
- Modificar: `CLAUDE.md`

- [ ] **Paso 1: la nota**

En la sección «Un aviso nuevo sale por dos lados», decir las tres cosas que no se deducen del código:

1. **La tolerancia de cada recurso se declara en `REGISTRO`**, y un recurso que aparece en la vista sin estar declarado sale como aviso. Agregar una sincronización nueva obliga a declararla.
2. **Las tres familias de excepción**, y sobre todo que `apagado-a-proposito` lleva quién lo levanta: sin esa familia, lo primero que hace el sistema es reintroducir el rojo permanente que el comentario de `calidad-envases-bajada.yml` ya había evitado.
3. **`agenda-pasos-caidos` y `agenda-salud-sin-comprobar` se retiraron** y sus ids quedan huérfanos en `notificaciones_descartes`, que es inofensivo. `lineasDeSalud` sigue viva en `/agenda`.

Y que **todo esto depende de la migración `20261105092248`**: sin `canonico`, la vista prefiere la fila del otro despliegue y el aviso suena por lo que anda bien.

**Antes de editar, `git status`:** `CLAUDE.md` lo venía tocando otra sesión el 05/11. Si tiene cambios ajenos, commitear sólo este archivo y sólo si el diff es el propio.

- [ ] **Paso 2: commitear**

```bash
git add CLAUDE.md
git commit -m "docs(core): como se declara la salud de una sincronizacion"
```

---

## Qué comprobar al final, y qué no se puede comprobar todavía

```bash
npm test
npx tsc --noEmit
npm run build                      # con el dev server parado
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
node scripts/revisar-exportaciones.mjs
```

**Lo que ningún test puede decir hasta que el usuario aplique la migración
`20261105092248`:** si el aviso suena por lo que corresponde. La columna
`canonico` **prefiere y no filtra**, y las filas viejas la tienen en null, así
que cada recurso se cura **en su primera corrida canónica** y no al aplicar la
migración. Medir la línea de base **después de un ciclo completo**, no antes —
y hasta entonces, los 5 falsos positivos medidos el 05/11 siguen ahí.

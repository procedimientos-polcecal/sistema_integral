# Indicadores del Inicio — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea.
> Los pasos usan casilla (`- [ ]`) para ir marcando.

**Objetivo:** que el Inicio muestre lo que hay que hacer en cada módulo y avise
cuándo un módulo dejó de cargarse, en vez de contar lo que pasó hoy.

**Arquitectura:** una vista `inicio_ritmo_modulos` calcula en Postgres, de una
consulta, cuánto hace que no se carga cada una de las trece fuentes y cuál es el
umbral tolerable para esa fuente. Toda la lógica de decisión —umbral, atraso,
cantidad del aviso, día hábil de RRHH— vive en `lib/` como funciones puras con
tests. Las rutas se parten en dos: una barata para la campana del layout y la
completa para el Inicio.

**Stack:** Next.js 16 (App Router), Supabase/PostgREST, vitest, TypeScript.

**Spec:** [docs/superpowers/specs/2026-10-06-inicio-indicadores-design.md](../specs/2026-10-06-inicio-indicadores-design.md)

**Antes de empezar, leer del spec:** las cinco trampas de la vista, la sección
«RRHH: los ausentes del último día hábil con fichadas» y «La trampa del
descarte». Ninguna de las tres se deduce del código.

**Cuidado con el árbol:** suele haber otra sesión trabajando acá. **Nunca
`git add -A`**: agregar sólo los archivos nombrados en cada paso, por nombre.

---

### Tarea 1: `lib/home/ritmo.ts` — el umbral y el atraso

Las funciones puras que deciden si un módulo está atrasado. No tocan la base.

**Archivos:**
- Crear: `lib/home/ritmo.ts`
- Crear: `lib/home/ritmo.test.ts`

- [ ] **Paso 1: escribir los tests que fallan**

Crear `lib/home/ritmo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cantidadDelAviso, estaAtrasado, ritmoDeFila, ritmoPorModulo, umbralDeRitmo } from "./ritmo";

describe("umbralDeRitmo", () => {
  it("es el hueco más largo más uno", () => {
    expect(umbralDeRitmo(3)).toBe(4);
    expect(umbralDeRitmo(10)).toBe(11);
    expect(umbralDeRitmo(22)).toBe(23);
  });

  // Sin piso, un módulo con dos días de historia tiene hueco 0, umbral 1, y
  // grita cada fin de semana.
  it("nunca baja de 3", () => {
    expect(umbralDeRitmo(0)).toBe(3);
    expect(umbralDeRitmo(1)).toBe(3);
    expect(umbralDeRitmo(2)).toBe(3);
  });

  // Sin tope, un parate largo le sube el umbral y lo deja mudo 180 días.
  it("nunca pasa de 30", () => {
    expect(umbralDeRitmo(45)).toBe(30);
    expect(umbralDeRitmo(180)).toBe(30);
  });

  /*
   * Los doce casos que se pueden escribir como fila, medidos contra producción
   * el 06/10/2026. El decimotercero de la tabla del spec es Producción, que
   * nunca se cargó y no tiene hueco ni días que poner en la tupla: se prueba
   * aparte, en `estaAtrasado` y en `ritmoPorModulo`. Si esta tabla deja de
   * pasar, cambió la regla, no el dato: los huecos son históricos.
   *
   * Ojo con `facturacion`: es una de las dos fuentes que no son `date`, y se
   * mide sobre `created_at` —cuándo entró la factura al buzón— y no sobre
   * `fecha`, que es la del comprobante y puede ser vieja. La vista la pasa a
   * día en el huso de Argentina. Medida así, da hueco 24 y 1 día sin cargar;
   * medida sobre `fecha` da 22 y 4, y quien rehaga la tabla de esa manera va a
   * creer que ésta está mal. No lo está: mide otra columna. La aserción se
   * sostiene con cualquiera de las dos ("no avisa"), pero la tabla es una
   * medición, no una verdad.
   */
  it("reproduce la tabla de validación del spec", () => {
    const casos: [string, number, number, number, boolean][] = [
      // módulo, huecoMax, diasSinCargar, umbral esperado, ¿avisa?
      ["mantenimiento", 5, 1, 6, false],
      ["compras", 5, 1, 6, false],
      ["inventario", 4, 1, 5, false],
      ["cantera", 6, 5, 7, false],
      ["facturacion", 24, 1, 25, false],
      ["rrhh", 1, 6, 3, true],
      ["despacho", 3, 5, 4, true],
      ["taller_vial", 3, 8, 4, true],
      ["calidad", 3, 20, 4, true],
      ["calidad_envases", 3, 23, 4, true],
      ["trituracion", 3, 36, 4, true],
      ["remises", 10, 70, 11, true],
    ];
    for (const [modulo, huecoMax, dias, umbral, avisa] of casos) {
      expect(umbralDeRitmo(huecoMax), modulo).toBe(umbral);
      expect(estaAtrasado(dias, umbral), modulo).toBe(avisa);
    }
  });
});

describe("estaAtrasado", () => {
  it("avisa cuando llega justo al umbral", () => {
    expect(estaAtrasado(4, 4)).toBe(true);
    expect(estaAtrasado(3, 4)).toBe(false);
  });

  // Producción tiene 0 filas desde que existe. Un módulo que nunca se cargó no
  // está al día: si se tratara como "sin datos", la tarjeta diría que todo bien.
  it("un módulo que nunca se cargó está atrasado", () => {
    expect(estaAtrasado(null, 3)).toBe(true);
  });
});

describe("cantidadDelAviso", () => {
  /*
   * `filtrarDescartadas` vuelve a mostrar un aviso cuando su cantidad superó a
   * la que tenía al descartarlo. Si la cantidad fueran los días sin cargar,
   * descartarlo hoy lo traería mañana: el número crece solo todas las noches.
   */
  it("no crece de un día para el otro", () => {
    expect(cantidadDelAviso(36, 4)).toBe(9);
    expect(cantidadDelAviso(37, 4)).toBe(9);
    expect(cantidadDelAviso(38, 4)).toBe(9);
    expect(cantidadDelAviso(39, 4)).toBe(9);
  });

  it("crece recién al pasar otro umbral entero", () => {
    expect(cantidadDelAviso(40, 4)).toBe(10);
  });

  // "Producción nunca se cargó" no es novedad todos los días: descartarlo lo
  // calla para siempre.
  it("un módulo que nunca se cargó manda siempre 1", () => {
    expect(cantidadDelAviso(null, 3)).toBe(1);
  });
});

describe("ritmoDeFila", () => {
  it("calcula el umbral con el hueco de la propia fila", () => {
    const r = ritmoDeFila({ modulo: "x", ultima_fecha: "2026-10-03", dias_sin_cargar: 3, hueco_max: 10 });
    expect(r).toEqual({ ultimaFecha: "2026-10-03", diasSinCargar: 3, umbral: 11, atrasado: false });
  });

  it("una fuente que nunca se cargó está atrasada", () => {
    const r = ritmoDeFila({ modulo: "produccion", ultima_fecha: null, dias_sin_cargar: null, hueco_max: 0 });
    expect(r).toEqual({ ultimaFecha: null, diasSinCargar: null, umbral: 3, atrasado: true });
  });
});

describe("ritmoPorModulo", () => {
  const fila = (modulo: string, dias: number | null, huecoMax: number) => ({
    modulo,
    ultima_fecha: dias === null ? null : "2026-09-30",
    dias_sin_cargar: dias,
    hueco_max: huecoMax,
  });

  it("arma el ritmo de cada módulo a partir de su fila", () => {
    const r = ritmoPorModulo([fila("despacho", 5, 3)]);
    expect(r.despacho).toEqual({
      ultimaFecha: "2026-09-30",
      diasSinCargar: 5,
      umbral: 4,
      atrasado: true,
    });
  });

  // Calidad se carga en dos mitades por separado —carbonilla y envases— y la
  // tarjeta es una sola: muestra la que está peor.
  it("Calidad se queda con la peor de sus dos mitades", () => {
    const r = ritmoPorModulo([fila("calidad", 20, 3), fila("calidad_envases", 23, 3)]);
    expect(r.calidad?.diasSinCargar).toBe(23);
  });

  it("Calidad prefiere la mitad que nunca se cargó", () => {
    const r = ritmoPorModulo([fila("calidad", 20, 3), fila("calidad_envases", null, 0)]);
    expect(r.calidad?.diasSinCargar).toBeNull();
    expect(r.calidad?.atrasado).toBe(true);
  });

  // Cada mitad tiene su propio umbral: la que más días lleva parada no es
  // necesariamente la que está peor. Carbonilla, 20 días con umbral 26, está al
  // día; envases, 5 días con umbral 4, no.
  it("Calidad compara cada mitad contra su propio umbral, no por días crudos", () => {
    const r = ritmoPorModulo([fila("calidad", 20, 25), fila("calidad_envases", 5, 3)]);
    expect(r.calidad?.diasSinCargar).toBe(5);
    expect(r.calidad?.atrasado).toBe(true);
  });

  it("un módulo sin fila en la vista queda sin ritmo, no en cero", () => {
    const r = ritmoPorModulo([fila("despacho", 1, 3)]);
    expect(r.compras).toBeUndefined();
  });
});
```

- [ ] **Paso 2: correr el test y ver que falla**

```bash
npx vitest run lib/home/ritmo.test.ts
```

Esperado: FAIL — `Failed to resolve import "./ritmo"`.

- [ ] **Paso 3: escribir `lib/home/ritmo.ts`**

```ts
import type { Modulo } from "@/lib/core/types";

/** Una fila de la vista `inicio_ritmo_modulos`, tal como la devuelve PostgREST. */
export interface FilaRitmo {
  modulo: string;
  ultima_fecha: string | null;
  dias_sin_cargar: number | null;
  hueco_max: number;
}

export interface Ritmo {
  /** Null cuando esa fuente nunca tuvo una fila. */
  ultimaFecha: string | null;
  /** Null cuando nunca se cargó: no es 0, es "no hay desde cuándo contar". */
  diasSinCargar: number | null;
  umbral: number;
  atrasado: boolean;
}

/**
 * Cuántos días sin cargar se toleran antes de avisar, calculado sobre la
 * historia del propio módulo: el hueco más largo que tuvo en 180 días, más uno.
 *
 * Se eligió el hueco máximo y no el p90, que es la forma obvia: con `p90 × 3`
 * se escapa Despacho, que lleva 5 días parado cuando su hueco más largo del año
 * fue de 3. Medido el 06/10/2026 — la tabla está en el test y en el spec.
 *
 * El piso de 3 es para que un módulo con dos días de historia no grite cada fin
 * de semana. El tope de 30 es para que un parate largo —enero— no le suba el
 * umbral y lo deje mudo los 180 días siguientes.
 */
export function umbralDeRitmo(huecoMax: number): number {
  return Math.max(3, Math.min(huecoMax + 1, 30));
}

/**
 * `diasSinCargar` en null es un módulo que **nunca** se cargó, y eso no es estar
 * al día: Producción tiene 0 partes desde que existe.
 */
export function estaAtrasado(diasSinCargar: number | null, umbral: number): boolean {
  if (diasSinCargar === null) return true;
  return diasSinCargar >= umbral;
}

/**
 * La cantidad con la que un aviso de ritmo entra al globo de notificaciones.
 *
 * No son los días sin cargar, y la diferencia importa: `filtrarDescartadas`
 * vuelve a mostrar un aviso cuando su cantidad superó a la que tenía al
 * descartarlo, así que un número que crece solo todas las noches haría que
 * descartarlo no sirviera de nada. Son los umbrales enteros que lleva parado:
 * descartar Trituración hoy (36 días, umbral 4 ⇒ 9) la calla hasta los 40.
 *
 * Un módulo que nunca se cargó manda 1 fijo: "Producción nunca se cargó" no es
 * novedad todos los días, y así descartarlo lo calla de verdad.
 */
export function cantidadDelAviso(diasSinCargar: number | null, umbral: number): number {
  if (diasSinCargar === null) return 1;
  return Math.floor(diasSinCargar / umbral);
}

/**
 * Las trece fuentes de la vista contra los doce módulos del sistema.
 *
 * Calidad es la única con dos: carbonilla y envases se cargan por separado y
 * tienen una sola tarjeta, que muestra **la peor de las dos**. Un módulo que no
 * tiene fila en la vista queda sin ritmo —`undefined`—, que no es lo mismo que
 * estar al día.
 */
const FUENTES_POR_MODULO: Record<Modulo, string[]> = {
  rrhh: ["rrhh"],
  mantenimiento: ["mantenimiento"],
  remises: ["remises"],
  compras: ["compras"],
  inventario: ["inventario"],
  produccion: ["produccion"],
  despacho: ["despacho"],
  facturacion: ["facturacion"],
  cantera: ["cantera"],
  calidad: ["calidad", "calidad_envases"],
  taller_vial: ["taller_vial"],
  trituracion: ["trituracion"],
};

/** El ritmo de una sola fuente, con el umbral calculado sobre su propio hueco. */
export function ritmoDeFila(fila: FilaRitmo): Ritmo {
  const umbral = umbralDeRitmo(fila.hueco_max);
  return {
    ultimaFecha: fila.ultima_fecha,
    diasSinCargar: fila.dias_sin_cargar,
    umbral,
    atrasado: estaAtrasado(fila.dias_sin_cargar, umbral),
  };
}

/**
 * Null —nunca se cargó— es lo peor; después, el que más umbrales lleva parado.
 *
 * Se compara por `días / umbral` y no por días crudos porque cada mitad tiene
 * su propio umbral: una con 20 días y umbral 26 está al día, y otra con 5 días
 * y umbral 4 no. Elegir por días crudos mostraría la primera y taparía a la
 * segunda, un dato equivocado que no se nota nunca. Con umbrales iguales la
 * razón ordena igual que los días.
 */
function peor(a: Ritmo, b: Ritmo): Ritmo {
  if (a.diasSinCargar === null) return a;
  if (b.diasSinCargar === null) return b;
  return b.diasSinCargar / b.umbral > a.diasSinCargar / a.umbral ? b : a;
}

export function ritmoPorModulo(filas: FilaRitmo[]): Partial<Record<Modulo, Ritmo>> {
  const porFuente = new Map(filas.map((f) => [f.modulo, f]));
  const resultado: Partial<Record<Modulo, Ritmo>> = {};

  for (const [modulo, fuentes] of Object.entries(FUENTES_POR_MODULO) as [Modulo, string[]][]) {
    const presentes = fuentes
      .map((f) => porFuente.get(f))
      .filter((f): f is FilaRitmo => f !== undefined)
      .map(ritmoDeFila);
    if (presentes.length === 0) continue;

    resultado[modulo] = presentes.reduce(peor);
  }
  return resultado;
}
```

- [ ] **Paso 4: correr el test y ver que pasa**

```bash
npx vitest run lib/home/ritmo.test.ts
```

Esperado: PASS, 16 tests.

- [ ] **Paso 5: `tsc` y commit**

```bash
npx tsc --noEmit
```

```bash
git add lib/home/ritmo.ts lib/home/ritmo.test.ts
git commit -m "feat(inicio): el umbral de ritmo, calculado sobre la historia de cada modulo"
```

---

### Tarea 2: la vista `inicio_ritmo_modulos`

**DDL — la aplica una persona a mano en el editor SQL de Supabase.** El agente
escribe el archivo y avisa; no puede correrlo. Las tareas 5, 6 y 7 se pueden
escribir igual: hasta que la vista exista, la lectura devuelve error y el ritmo
queda en `undefined`, que es el mismo trato que tiene un módulo sin acceso.

**Archivos:**
- Crear: `supabase/migrations/<marca>_inicio_ritmo_de_los_modulos.sql`

- [ ] **Paso 1: crear el archivo con marca de tiempo**

```bash
npm run migracion "inicio ritmo de los modulos"
```

Imprime la ruta exacta. **No escribir el nombre a mano**: dos sesiones toman el
mismo número y chocan.

- [ ] **Paso 2: escribir la migración**

Pegar esto en el archivo que creó el paso anterior:

```sql
-- ============================================================
-- SdG — Inicio: cuánto hace que no se carga cada módulo
--
-- El Inicio mostraba conteos del día, y este sistema no se carga parejo sino a
-- ráfagas: "Órdenes de carga hoy: 0" es el mismo 0 cuando Despacho está sano
-- que cuando nadie carga nada hace cinco semanas. Medido el 06/10/2026, ocho de
-- estas trece fuentes estaban paradas y nada lo decía.
--
-- El umbral no es fijo: se calcula contra la historia de cada fuente, el hueco
-- más largo que tuvo en 180 días más uno. Un umbral fijo de 7 haría sonar a
-- Facturación todos los días —recién arranca y tiene huecos de 24— y un p90
-- dejaría escapar a Despacho. El detalle, con la tabla de validación, está en
-- docs/superpowers/specs/2026-10-06-inicio-indicadores-design.md
--
-- Seis cosas que parecen de más y no lo son:
--
--   1. `fecha <= current_date`. `calculos_diarios` tiene filas hasta el 18/11 y
--      nada impide que otra tabla las tenga. Sin el tope, los días sin cargar
--      salen negativos y el módulo parece recién cargado.
--   2. La lista de módulos va en un `values` a la izquierda de un `left join`.
--      Producción tiene 0 filas: con un `inner join` desaparecería de la vista y
--      la tarjeta diría que está todo bien.
--   3. `security_invoker = true`. Una vista corre por defecto con los permisos
--      de quien la creó y saltearía el RLS de las trece tablas. Con esto, a
--      quien no tiene acceso a un módulo le llegan nulos en esa fila — que es
--      lo correcto, porque la tarjeta tampoco se le muestra.
--   4. La fuente de cada módulo es **lo que carga una persona**, no un
--      derivado. RRHH mira `fichadas` y no `calculos_diarios`: el cálculo sigue
--      escribiendo filas aunque nadie fiche, así que mirándolo a él RRHH
--      parecería al día mientras marca 66 de 68 empleados ausentes por un
--      archivo que dejó de importarse. Es exactamente el error que esta vista
--      tiene que atrapar.
--   5. La última fecha NO sale de la ventana de 180 días. Esa ventana existe
--      sólo para el hueco máximo, que es lo único que tiene sentido que sea
--      móvil. Si `ultima_fecha` también se calculara sobre ella, un módulo
--      parado hace más de medio año quedaría sin filas dentro de la ventana y
--      pasaría a informarse como "nunca se cargó" —Remises, con 70 días hoy,
--      lo haría al día 181—: falso, y encima pierde cuántos días lleva parado.
--      Con la historia entera, `ultima_fecha is null` quiere decir justo eso:
--      que esa fuente no tuvo nunca una fila.
--   6. Dos de las trece fuentes no son `date`, y el `union all` las trata
--      distinto a propósito. Sin ningún cast, el `union all` resuelve toda la
--      columna `fecha` a `timestamptz` —`date` y `timestamptz` se unifican
--      hacia el segundo—, `fecha - lag(fecha)` pasa a ser un `interval` y
--      `max(hueco)::int` falla al aplicar la migración con `42846`. Ése es el
--      motivo del cast, no la prolijidad. Pero los dos tipos no guardan lo
--      mismo, y por eso los husos son distintos:
--        · `compras_requerimientos.fecha` es un DÍA guardado en un
--          `timestamptz`: 2.080 de 2.080 filas están a medianoche UTC exacta
--          (medido el 06/10/2026), porque viene de la planilla. Se recupera
--          con `at time zone 'UTC'`. Con el huso de Argentina esa medianoche
--          caería a las 21:00 del día anterior y las 2.080 fechas se correrían
--          un día — la misma familia del error que ya dio vuelta 885 fechas
--          en Compras. Es lo que hace la `20260903081542` con Inventario.
--        · `facturas_proveedor.created_at` es un INSTANTE real (llegan a media
--          mañana, hora de Argentina). Lo que se quiere saber es en qué día
--          ARGENTINO entró la factura al buzón: una que entra a las 22:00 de
--          acá es la 01:00 UTC del día siguiente, y un `::date` pelado
--          contaría el día que no es. Va `at time zone
--          'America/Argentina/Buenos_Aires'`.
--
-- `atrasado` NO se calcula acá a propósito: la comparación vive en
-- lib/home/ritmo.ts, que es donde se puede testear. La vista entrega los hechos.
--
-- Cantera mira sólo `cantera_pesadas`: es lo único del módulo que se carga a
-- diario —voladuras, bochones y destape se mueven por evento y un hueco de dos
-- semanas ahí es normal—. Si alguna vez se dejaran de cargar las pesadas pero sí
-- el resto, esta señal miente. Queda anotado.
-- ============================================================

create or replace view inicio_ritmo_modulos
with (security_invoker = true) as
with fuentes as (
             select 'rrhh'::text          as modulo, fecha            from fichadas
  union all  select 'remises',                       fecha            from remises_asistencia
  union all  select 'mantenimiento',                 fecha            from ordenes_trabajo
  -- Un día guardado como `timestamptz` a medianoche UTC: va `'UTC'`. Ver la trampa 6.
  union all  select 'compras',                       (fecha at time zone 'UTC')::date from compras_requerimientos
  union all  select 'inventario',                    fecha            from inventario_movimientos
  union all  select 'produccion',                    fecha            from produccion_partes
  union all  select 'despacho',                      fecha            from despacho_ordenes_carga
  -- `fecha` es la del comprobante y puede ser vieja; `created_at` es cuándo
  -- entró al buzón, que es lo que mide si el módulo se usa. Es un instante real:
  -- va con el huso de Argentina. Ver la trampa 6.
  union all  select 'facturacion',                   (created_at at time zone 'America/Argentina/Buenos_Aires')::date from facturas_proveedor
  union all  select 'cantera',                       fecha            from cantera_pesadas
  union all  select 'calidad',                       fecha            from calidad_movimientos
  union all  select 'calidad_envases',               fecha            from calidad_envases_movimientos
  union all  select 'taller_vial',                   fecha            from taller_vial_cargas
  union all  select 'trituracion',                   fecha            from trituracion_partes
),
-- Sólo para el hueco máximo: los últimos 180 días. NO alimenta `ultima`.
dias as (
  select modulo, fecha
    from fuentes
   where fecha is not null
     and fecha <= current_date
     and fecha >= current_date - 180
   group by modulo, fecha
),
huecos as (
  select modulo, fecha - lag(fecha) over (partition by modulo order by fecha) as hueco
    from dias
),
hueco_maximo as (
  select modulo, max(hueco)::int as hueco_max
    from huecos where hueco is not null group by modulo
),
-- Toda la historia, acotada sólo a `<= current_date`: ver la trampa 5.
ultima as (
  select modulo, max(fecha) as ultima_fecha
    from fuentes
   where fecha is not null
     and fecha <= current_date
   group by modulo
)
select m.modulo,
       u.ultima_fecha,
       (current_date - u.ultima_fecha)::int as dias_sin_cargar,
       coalesce(h.hueco_max, 0)             as hueco_max
  from (values ('rrhh'),('remises'),('mantenimiento'),('compras'),('inventario'),
               ('produccion'),('despacho'),('facturacion'),('cantera'),('calidad'),
               ('calidad_envases'),('taller_vial'),('trituracion')) as m(modulo)
  left join ultima        u on u.modulo = m.modulo
  left join hueco_maximo  h on h.modulo = m.modulo;

comment on view inicio_ritmo_modulos is
  'Por fuente: la última fecha cargada, cuántos días hace y el hueco más largo '
  'de los últimos 180 días. El umbral y la decisión de "atrasado" se calculan '
  'en lib/home/ritmo.ts. Alimenta las tarjetas del Inicio y la campana.';

grant select on inicio_ritmo_modulos to authenticated;
```

- [ ] **Paso 3: commitear el archivo y avisar al usuario**

```bash
git add supabase/migrations/
git commit -m "feat(inicio): vista del ritmo de carga de los doce modulos"
```

Decirle al usuario: **«La migración `<nombre>` está lista pero es DDL: hay que
aplicarla a mano en el editor SQL de Supabase. Hasta entonces la señal de ritmo
queda sin datos y las tarjetas funcionan igual.»** Quedar a la espera antes del
paso 4.

- [ ] **Paso 4: verificar la vista contra la tabla del spec (después de que la apliquen)**

```bash
node -e "const{createClient}=require('@supabase/supabase-js');const fs=require('fs');const e=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trimStart().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY).from('inicio_ritmo_modulos').select('*').order('modulo').then(r=>console.log(r.error?r.error.message:JSON.stringify(r.data,null,1)))"
```

Esperado: trece filas. `produccion` con `ultima_fecha: null` y `dias_sin_cargar:
null`. Ninguna con `dias_sin_cargar` negativo. Los `hueco_max` tienen que dar
parecido a la tabla del spec (los días pasan, así que no van a ser idénticos):
`rrhh` 1, `despacho` 3, `remises` 10, `facturacion` ~24.

---

### Tarea 3: `lib/rrhh/diaHabil.ts` — el último día hábil con fichadas

La función que impide que la tarjeta de RRHH muestre un 66 falso.

**Archivos:**
- Crear: `lib/rrhh/diaHabil.ts`
- Crear: `lib/rrhh/diaHabil.test.ts`

- [ ] **Paso 1: escribir los tests que fallan**

Crear `lib/rrhh/diaHabil.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ultimoDiaHabilConFichadas } from "./diaHabil";

/*
 * El caso real del 06/10/2026, que es el que motivó la función.
 *
 * Las fichadas se cortaron el 30/09 y desde el 01/10 `calculos_diarios` marca
 * 64, 65, 50 y 66 de 68 empleados como ausentes. Sin retroceder hasta el último
 * día con fichadas, la tarjeta diría 66, que es ruido del feed y no un dato de
 * RRHH.
 */
describe("ultimoDiaHabilConFichadas", () => {
  const FERIADOS_2026 = ["2026-01-01", "2026-07-09", "2026-08-17", "2026-12-25"];

  it("retrocede hasta el último día con fichadas, salteando los que no tienen", () => {
    const conFichadas = ["2026-09-28", "2026-09-29", "2026-09-30"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-06")).toBe("2026-09-30");
  });

  it("toma ayer cuando ayer tiene fichadas", () => {
    const conFichadas = ["2026-09-29", "2026-09-30", "2026-10-05"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-06")).toBe("2026-10-05");
  });

  // Los 36 domingos que ya pasaron en 2026 tienen exactamente 0 ausentes de 68. Un lunes,
  // "ayer" diría 0 y no informaría nada. Pero los domingos sí tienen fichadas
  // —entre 4 y 20— así que no alcanza con pedir que el día tenga fichadas.
  it("saltea el domingo aunque tenga fichadas", () => {
    // 2026-10-04 es domingo, 2026-10-03 sábado.
    const conFichadas = ["2026-10-03", "2026-10-04"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-05")).toBe("2026-10-03");
  });

  // El sábado se trabaja: entre 3 y 9 ausentes todos los sábados. "Día hábil"
  // acá es *no domingo y no feriado*, no la semana de lunes a viernes.
  it("no saltea el sábado", () => {
    const conFichadas = ["2026-10-02", "2026-10-03"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-04")).toBe("2026-10-03");
  });

  // De los 11 feriados de 2026 con datos, 9 tienen 0 ausentes: igual que un
  // domingo.
  it("saltea un feriado aunque tenga fichadas", () => {
    // 2026-08-17 es feriado (lunes); 2026-08-15 sábado.
    const conFichadas = ["2026-08-15", "2026-08-17"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-08-18")).toBe("2026-08-15");
  });

  it("nunca devuelve hoy, aunque hoy tenga fichadas", () => {
    const conFichadas = ["2026-09-30", "2026-10-06"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-06")).toBe("2026-09-30");
  });

  // Un caller que se olvide del `.lt("fecha", hoy)` no tiene que poder colar un
  // día que todavía no empezó.
  it("nunca devuelve una fecha posterior a hoy", () => {
    const conFichadas = ["2026-09-30", "2026-10-07", "2026-10-08"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-06")).toBe("2026-09-30");
  });

  it("devuelve null cuando no hay ningún día que sirva", () => {
    expect(ultimoDiaHabilConFichadas([], FERIADOS_2026, "2026-10-06")).toBeNull();
    // 2026-10-04 es domingo y es lo único que hay.
    expect(ultimoDiaHabilConFichadas(["2026-10-04"], FERIADOS_2026, "2026-10-05")).toBeNull();
  });

  it("no se marea con fechas repetidas ni desordenadas", () => {
    const conFichadas = ["2026-09-28", "2026-09-30", "2026-09-28", "2026-09-29", "2026-09-30"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-06")).toBe("2026-09-30");
  });
});
```

- [ ] **Paso 2: correr el test y ver que falla**

```bash
npx vitest run lib/rrhh/diaHabil.test.ts
```

Esperado: FAIL — `Failed to resolve import "./diaHabil"`.

- [ ] **Paso 3: escribir `lib/rrhh/diaHabil.ts`**

```ts
import { diaDeLaSemana } from "@/lib/core/fechas";

/**
 * El último día anterior a `hoy` que sea hábil y tenga fichadas importadas.
 *
 * Es el día que mira la tarjeta de RRHH del Inicio, y las condiciones
 * salen de medir contra producción el 06/10/2026, no de suponer:
 *
 *   - **Hoy no sirve.** A media mañana `calculos_diarios` tenía 2 filas de 68:
 *     el día no está cerrado. Por eso la tarjeta decía "1 ausente" mientras el
 *     día anterior había 66.
 *   - **El domingo no cuenta.** De los 36 domingos que ya pasaron en 2026, los
 *     36 tienen exactamente 0 ausentes sobre 68 empleados. Un lunes, "ayer" diría 0 y no
 *     informaría nada. Y no alcanza con pedir que el día tenga fichadas: un
 *     domingo tiene entre 4 y 20, de gente que sí trabaja.
 *   - **El feriado tampoco.** De los 11 feriados de 2026 con datos, 9 tienen 0
 *     ausentes; los otros dos tienen 2 y 4. Promedio 0,5 contra 42,3 en días
 *     hábiles (medido el 06/10/2026).
 *   - **El sábado SÍ cuenta**: entre 3 y 9 ausentes todos los sábados. "Día
 *     hábil" acá es *no domingo y no feriado*, no la semana de lunes a viernes.
 *
 * Y la condición que más importa: **el día tiene que tener fichadas**. La
 * importación anda a ráfagas: en 2026 sólo entraron fichadas en julio, agosto
 * y septiembre —unas 1.550 por mes—. De febrero a junio no entró ninguna
 * (salvo 3 sueltas el 30/06, la primera prueba), y desde el 01/10 tampoco.
 * En los meses sin fichadas `calculos_diarios` llena igual las 68 filas y
 * marca a todos ausentes: el promedio de un día hábil pasa de 7 a 65. Sin
 * esta condición la tarjeta mostraría hoy 66 de 68, que es ruido del feed y
 * no un dato de RRHH.
 *
 * Riesgo asumido: un día con fichadas parciales califica igual. Si una
 * importación trae 8 de 68, ese día pasa y la tarjeta mostraría ~60 ausentes
 * falsos. No se pone umbral de completitud porque un domingo tiene entre 4 y 20
 * fichadas legítimas y no hay forma medida de distinguir las dos cosas.
 *
 * @param fechasConFichadas fechas "YYYY-MM-DD" que tienen al menos una fichada.
 *   Puede venir con repetidos y sin ordenar. **Quien llame tiene que garantizar
 *   que la lista incluya las fechas más recientes**: la función devuelve el
 *   máximo de lo que le pasan y no tiene cómo saber que le llegó una lista
 *   truncada (PostgREST corta en 1000 filas sin avisar; ver `diaDeReferenciaRrhh`
 *   en `lib/home/consultas.ts`, que las pide de la más nueva a la más vieja).
 * @param feriados fechas "YYYY-MM-DD" de la tabla `feriados` del núcleo.
 * @param hoy "YYYY-MM-DD" en Argentina (`hoyEnArgentina()`).
 */
export function ultimoDiaHabilConFichadas(
  fechasConFichadas: string[],
  feriados: string[],
  hoy: string
): string | null {
  const esFeriado = new Set(feriados);
  const candidatos = fechasConFichadas.filter(
    (f) => f < hoy && diaDeLaSemana(f) !== 0 && !esFeriado.has(f)
  );
  if (candidatos.length === 0) return null;
  // Las fechas ISO ordenan igual como texto que como fecha.
  return candidatos.reduce((a, b) => (b > a ? b : a));
}
```

- [ ] **Paso 4: correr el test y ver que pasa**

```bash
npx vitest run lib/rrhh/diaHabil.test.ts
```

Esperado: PASS, 9 tests.

- [ ] **Paso 5: `tsc` y commit**

```bash
npx tsc --noEmit
```

```bash
git add lib/rrhh/diaHabil.ts lib/rrhh/diaHabil.test.ts
git commit -m "feat(rrhh): el ultimo dia habil con fichadas, para que el Inicio no muestre un 66 falso"
```

---

### Tarea 4: `lib/home/avisos.ts` — las notificaciones, fuera de la ruta

Hoy el armado del globo vive dentro de `app/api/home/resumen/route.ts`. Las dos
rutas de la tarea 5 lo necesitan, así que se saca a `lib/` — y de paso queda
testeable, que es la regla del repo.

**Archivos:**
- Crear: `lib/home/avisos.ts`
- Crear: `lib/home/avisos.test.ts`

- [ ] **Paso 1: escribir los tests que fallan**

Crear `lib/home/avisos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { avisosDeConteos, avisosDeRitmo } from "./avisos";

describe("avisosDeConteos", () => {
  it("no genera avisos cuando está todo en cero", () => {
    expect(avisosDeConteos({ mantenimientoAtrasadas: 0, comprasEsperandoAprobacion: 0 })).toEqual([]);
  });

  it("ignora los conteos que no le pasaron", () => {
    expect(avisosDeConteos({})).toEqual([]);
  });

  it("genera un aviso por cada conteo mayor que cero", () => {
    const avisos = avisosDeConteos({ mantenimientoAtrasadas: 20, facturacionSinVincular: 1 });
    expect(avisos.map((a) => a.id)).toEqual(["mant-atrasadas", "facturacion-sin-vincular"]);
    expect(avisos[0]).toEqual({
      id: "mant-atrasadas",
      titulo: "Órdenes de trabajo atrasadas",
      cantidad: 20,
      href: "/mantenimiento/ordenes?estado=ATRASADO",
    });
  });

  it("incluye los dos módulos nuevos", () => {
    const avisos = avisosDeConteos({ calidadEnvasesSinPlanilla: 2, trituracionSinPlanilla: 2 });
    expect(avisos.map((a) => a.id)).toEqual(["calidad-envases-sin-planilla", "trituracion-sin-planilla"]);
  });
});

describe("avisosDeRitmo", () => {
  const ritmo = {
    despacho: { ultimaFecha: "2026-10-01", diasSinCargar: 5, umbral: 4, atrasado: true },
    trituracion: { ultimaFecha: "2026-08-31", diasSinCargar: 36, umbral: 4, atrasado: true },
    inventario: { ultimaFecha: "2026-10-05", diasSinCargar: 1, umbral: 5, atrasado: false },
    produccion: { ultimaFecha: null, diasSinCargar: null, umbral: 3, atrasado: true },
  };

  /*
   * En la tarjeta la señal aparece apenas pasa el umbral; en la campana recién
   * al doble, para que Despacho con 5 días no haga ruido y Trituración con 36 sí.
   */
  it("sólo avisa pasado el doble del umbral", () => {
    const avisos = avisosDeRitmo(ritmo, ["despacho", "trituracion", "inventario"]);
    expect(avisos.map((a) => a.id)).toEqual(["ritmo-trituracion"]);
  });

  it("un módulo que nunca se cargó avisa siempre, con cantidad 1", () => {
    const avisos = avisosDeRitmo(ritmo, ["produccion"]);
    expect(avisos).toEqual([
      {
        id: "ritmo-produccion",
        titulo: "Producción: nunca se cargó nada",
        cantidad: 1,
        href: "/produccion",
      },
    ]);
  });

  it("la cantidad no crece de un día para el otro", () => {
    const hoy = avisosDeRitmo({ trituracion: { ultimaFecha: "x", diasSinCargar: 36, umbral: 4, atrasado: true } }, ["trituracion"]);
    const manana = avisosDeRitmo({ trituracion: { ultimaFecha: "x", diasSinCargar: 37, umbral: 4, atrasado: true } }, ["trituracion"]);
    expect(manana[0].cantidad).toBe(hoy[0].cantidad);
  });

  it("no avisa de un módulo al que el usuario no tiene acceso", () => {
    expect(avisosDeRitmo(ritmo, ["inventario"])).toEqual([]);
  });
});
```

- [ ] **Paso 2: correr el test y ver que falla**

```bash
npx vitest run lib/home/avisos.test.ts
```

Esperado: FAIL — `Failed to resolve import "./avisos"`.

- [ ] **Paso 3: escribir `lib/home/avisos.ts`**

```ts
import type { Modulo } from "@/lib/core/types";
import type { Notificacion } from "./notificaciones";
import { cantidadDelAviso, type Ritmo } from "./ritmo";

/**
 * Los conteos que pueden generar un aviso. Todos opcionales: cada ruta pasa los
 * de los módulos que el usuario tiene, y los que faltan no generan nada.
 */
export interface ConteosParaAvisos {
  rrhhSinClasificar: number;
  mantenimientoAtrasadas: number;
  comprasEsperandoAprobacion: number;
  inventarioSinPlanilla: number;
  produccionSinPlanilla: number;
  despachoAbiertas: number;
  despachoSinPlanilla: number;
  facturacionSinVincular: number;
  canteraSinConciliar: number;
  calidadEnvasesSinPlanilla: number;
  tallerVialSinEquipo: number;
  tallerVialServiceVencidos: number;
  tallerVialServiceProximos: number;
  trituracionSinPlanilla: number;
}

/**
 * Qué título y qué link le corresponde a cada conteo. El orden de esta lista es
 * el orden en que salen los avisos.
 *
 * Lo que entra acá tiene que **pedir hacer algo**. Un movimiento que no llegó a
 * la planilla no es decorativo: el stock sale de las fórmulas de allá, así que
 * la próxima sincronización lo revierte.
 */
const AVISOS: { clave: keyof ConteosParaAvisos; id: string; titulo: string; href: string }[] = [
  { clave: "rrhhSinClasificar", id: "rrhh-sin-clasificar", titulo: "Ausencias sin clasificar", href: "/rrhh/asistencia?tab=dia" },
  { clave: "mantenimientoAtrasadas", id: "mant-atrasadas", titulo: "Órdenes de trabajo atrasadas", href: "/mantenimiento/ordenes?estado=ATRASADO" },
  { clave: "comprasEsperandoAprobacion", id: "compras-por-aprobar", titulo: "Requerimientos esperando aprobación", href: "/compras/aprobaciones" },
  { clave: "inventarioSinPlanilla", id: "inv-sin-planilla", titulo: "Movimientos que no llegaron a la planilla", href: "/inventario/movimientos" },
  { clave: "produccionSinPlanilla", id: "produccion-sin-planilla", titulo: "Partes de producción que no llegaron a la planilla", href: "/produccion" },
  { clave: "despachoAbiertas", id: "despacho-sin-cerrar", titulo: "Órdenes de carga sin cerrar de días anteriores", href: "/despacho" },
  { clave: "despachoSinPlanilla", id: "despacho-sin-planilla", titulo: "Órdenes de carga que no llegaron a la planilla", href: "/despacho/ordenes" },
  { clave: "facturacionSinVincular", id: "facturacion-sin-vincular", titulo: "Facturas en el buzón sin vincular a una compra", href: "/facturacion?estado=recibida" },
  { clave: "canteraSinConciliar", id: "cantera-sin-conciliar", titulo: "Registros de cantera con factura sin conciliar o a revisar", href: "/cantera/registros" },
  { clave: "calidadEnvasesSinPlanilla", id: "calidad-envases-sin-planilla", titulo: "Movimientos de envases que no llegaron a la planilla", href: "/calidad/envases/movimientos" },
  { clave: "tallerVialSinEquipo", id: "taller-vial-sin-equipo", titulo: "Cargas de combustible sin un equipo reconocido", href: "/taller-vial/cargas" },
  { clave: "tallerVialServiceVencidos", id: "taller-vial-service-vencido", titulo: "Equipos con el service de 250 hs vencido", href: "/taller-vial/services" },
  { clave: "tallerVialServiceProximos", id: "taller-vial-service-proximo", titulo: "Equipos por vencer el service de 250 hs", href: "/taller-vial/services" },
  { clave: "trituracionSinPlanilla", id: "trituracion-sin-planilla", titulo: "Partes de trituración sin exportar a la planilla", href: "/trituracion/partes" },
];

export function avisosDeConteos(conteos: Partial<ConteosParaAvisos>): Notificacion[] {
  return AVISOS.flatMap(({ clave, id, titulo, href }) => {
    const cantidad = conteos[clave] ?? 0;
    return cantidad > 0 ? [{ id, titulo, cantidad, href }] : [];
  });
}

const NOMBRE: Record<Modulo, string> = {
  rrhh: "RRHH", mantenimiento: "Mantenimiento", remises: "Remises", compras: "Compras",
  inventario: "Inventario", produccion: "Producción", despacho: "Despacho",
  facturacion: "Facturación", cantera: "Cantera", calidad: "Calidad",
  taller_vial: "Taller Vial", trituracion: "Trituración",
};

const HREF: Record<Modulo, string> = {
  rrhh: "/rrhh", mantenimiento: "/mantenimiento", remises: "/remises", compras: "/compras",
  inventario: "/inventario", produccion: "/produccion", despacho: "/despacho",
  facturacion: "/facturacion", cantera: "/cantera", calidad: "/calidad",
  taller_vial: "/taller-vial", trituracion: "/trituracion",
};

/**
 * Los avisos de ritmo que van al globo de la campana.
 *
 * En la tarjeta la señal aparece apenas se pasa el umbral; acá recién al
 * **doble**, para que Despacho con 5 días no haga ruido y Trituración con 36 sí.
 * Medido el 06/10/2026, entrarían siete: RRHH y Taller Vial justo en el borde,
 * Calidad por partida doble, Trituración, Remises y Producción.
 */
export function avisosDeRitmo(
  ritmo: Partial<Record<Modulo, Ritmo>>,
  modulos: Modulo[]
): Notificacion[] {
  return modulos.flatMap((m) => {
    const r = ritmo[m];
    if (!r || !r.atrasado) return [];
    if (r.diasSinCargar !== null && r.diasSinCargar < r.umbral * 2) return [];
    return [{
      id: `ritmo-${m}`,
      titulo: r.diasSinCargar === null
        ? `${NOMBRE[m]}: nunca se cargó nada`
        : `${NOMBRE[m]}: hace ${r.diasSinCargar} días que no se carga`,
      cantidad: cantidadDelAviso(r.diasSinCargar, r.umbral),
      href: HREF[m],
    }];
  });
}
```

- [ ] **Paso 4: correr el test y ver que pasa**

```bash
npx vitest run lib/home/avisos.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Paso 5: `tsc` y commit**

```bash
npx tsc --noEmit
```

```bash
git add lib/home/avisos.ts lib/home/avisos.test.ts
git commit -m "feat(inicio): el armado de avisos sale de la ruta a lib, con tests"
```

---

### Tarea 5: `/api/home/avisos` — la ruta barata para la campana

`NotificationsBell` vive en `components/Header.tsx`, que está en el layout: hoy
dispara `/api/home/resumen` —con los pulls completos de Cantera y Taller Vial—
**en toda página del sistema**, y dos veces en el Inicio.

**Archivos:**
- Crear: `lib/home/consultas.ts`
- Crear: `app/api/home/avisos/route.ts`
- Modificar: `components/NotificationsBell.tsx:19` (la URL del `fetch`)

> **Por qué las consultas van a `lib/` y no al archivo de la ruta:** un `route.ts`
> del App Router sólo puede exportar los handlers HTTP y un puñado de constantes
> de configuración. Exportar `traerRitmo` desde ahí para que `resumen/route.ts`
> lo importe rompe el build con *"is not a valid Route export field"*. Y además
> las dos rutas las necesitan.

- [ ] **Paso 1: crear `lib/home/consultas.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { sumarDias } from "@/lib/core/fechas";
import { ultimoDiaHabilConFichadas } from "@/lib/rrhh/diaHabil";
import type { FilaRitmo } from "./ritmo";

/**
 * Las filas de la vista de ritmo.
 *
 * La vista puede no existir todavía —es DDL y la aplica una persona— o estar
 * tapada por RLS. En los dos casos se devuelve vacío y el ritmo queda sin datos:
 * el mismo trato que tiene un módulo al que no se tiene acceso. Tirar acá
 * dejaría la campana muda en todas las páginas del sistema.
 */
export async function traerRitmo(supabase: SupabaseClient): Promise<FilaRitmo[]> {
  const { data, error } = await supabase
    .from("inicio_ritmo_modulos")
    .select("modulo, ultima_fecha, dias_sin_cargar, hueco_max");
  if (error) {
    console.error("inicio: no se pudo leer inicio_ritmo_modulos:", error.message);
    return [];
  }
  return (data ?? []) as FilaRitmo[];
}

/**
 * Qué día mira RRHH: el último hábil con fichadas importadas.
 *
 * El porqué de las condiciones está en `lib/rrhh/diaHabil.ts`. Se mira una
 * ventana de 60 días hacia atrás y no toda la historia: alcanza de sobra —el
 * corte más largo medido fue de cinco meses, y después de 60 días sin fichadas
 * el problema no es qué muestra la tarjeta— y evita traer 17.000 filas.
 *
 * **El `order` de las fichadas no es cosmético.** PostgREST corta en 1000 filas
 * y no avisa. Sin `order`, devuelve las primeras 1000 de la ventana, que son las
 * más viejas: medido contra producción, 1000 de 2.795 filas y una fecha máxima
 * de 2026-08-27 cuando la verdadera es 2026-09-30. La tarjeta diría «Ausentes el
 * jue 27/08» con un número de cinco semanas atrás: plausible y falso. De la más
 * nueva a la más vieja, las 1000 que llegan son las recientes (unos 15 días
 * distintos, de sobra para saltear uno o dos domingos y un feriado).
 */
export async function diaDeReferenciaRrhh(
  supabase: SupabaseClient,
  hoy: string
): Promise<string | null> {
  const desde = sumarDias(hoy, -60);
  const [{ data: fichadas }, { data: feriados }] = await Promise.all([
    supabase
      .from("fichadas")
      .select("fecha")
      .gte("fecha", desde)
      .lt("fecha", hoy)
      .order("fecha", { ascending: false }),
    supabase.from("feriados").select("fecha").gte("fecha", desde).lte("fecha", hoy),
  ]);
  return ultimoDiaHabilConFichadas(
    (fichadas ?? []).map((f) => f.fecha as string),
    (feriados ?? []).map((f) => f.fecha as string),
    hoy
  );
}

/**
 * Las ausencias sin clasificar del día de referencia, no las de hoy.
 *
 * Contar las de hoy daba 0 catorce días seguidos mientras el día anterior tenía
 * 64: a media mañana `calculos_diarios` está a medias.
 */
export async function sinClasificarDelUltimoDiaHabil(
  supabase: SupabaseClient,
  hoy: string
): Promise<number> {
  const dia = await diaDeReferenciaRrhh(supabase, hoy);
  if (!dia) return 0;

  const { data: empleados } = await supabase.from("empleados").select("id").eq("activo", true);
  const ids = (empleados ?? []).map((e) => e.id as string);
  if (ids.length === 0) return 0;

  const { count } = await supabase
    .from("calculos_diarios")
    .select("id", { count: "exact", head: true })
    .in("empleado_id", ids)
    .eq("fecha", dia)
    .eq("ausente", true)
    .is("justificada", null);
  return count ?? 0;
}
```

- [ ] **Paso 2: crear `app/api/home/avisos/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { modulosVisibles } from "@/lib/core/access";
import type { Modulo, Rol, UsuarioModulo } from "@/lib/core/types";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { filtrarDescartadas } from "@/lib/home/notificaciones";
import { avisosDeConteos, avisosDeRitmo, type ConteosParaAvisos } from "@/lib/home/avisos";
import { ritmoPorModulo } from "@/lib/home/ritmo";
import { traerRitmo, sinClasificarDelUltimoDiaHabil } from "@/lib/home/consultas";

/**
 * Sólo las notificaciones del globo. La consume la campana, que vive en
 * `components/Header.tsx` —o sea, en el layout— y por lo tanto corre en
 * **todas** las páginas del sistema.
 *
 * Existe aparte de `/api/home/resumen` justamente por eso: el resumen arma los
 * números de las tarjetas y es caro, y hasta ahora se pagaba ese costo en cada
 * navegación aunque la campana sólo usara `notificaciones`. Acá no hay ningún
 * `select` que traiga filas salvo el de RRHH: todo lo demás es `count … head` y
 * una lectura de la vista de ritmo.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!usuario) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });

  const { data: grants } = await supabase
    .from("usuario_modulos").select("id, usuario_id, modulo, nivel").eq("usuario_id", user.id);
  const modulos = modulosVisibles(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[]);
  const tiene = (m: Modulo) => modulos.includes(m);

  const hoy = hoyEnArgentina();

  /** Un conteo, o 0 si el usuario no tiene ese módulo. Sin `any`: eslint lo rechaza. */
  const contarSiTiene = async (
    modulo: Modulo,
    armar: () => PromiseLike<{ count: number | null }>
  ): Promise<number> => {
    if (!tiene(modulo)) return 0;
    const { count } = await armar();
    return count ?? 0;
  };
  const head = (tabla: string) =>
    supabase.from(tabla).select("id", { count: "exact", head: true });

  const [
    rrhhSinClasificar, mantenimientoAtrasadas, comprasEsperandoAprobacion,
    inventarioSinPlanilla, produccionSinPlanilla, despachoAbiertas, despachoSinPlanilla,
    facturacionSinVincular, calidadEnvasesSinPlanilla, trituracionSinPlanilla, filasRitmo,
  ] = await Promise.all([
    tiene("rrhh") ? sinClasificarDelUltimoDiaHabil(supabase, hoy) : Promise.resolve(0),
    contarSiTiene("mantenimiento", () => head("ordenes_trabajo").eq("estado", "ATRASADO")),
    contarSiTiene("compras", () => head("compras_requerimientos").in("estado_aprobacion", ["PENDIENTE", "EN_REVISION"])),
    contarSiTiene("inventario", () => head("inventario_movimientos").not("sheets_pendiente", "is", null)),
    contarSiTiene("produccion", () => head("produccion_partes").not("sheets_pendiente", "is", null)),
    contarSiTiene("despacho", () => head("despacho_ordenes_carga").lt("fecha", hoy).is("salida_predio", null).not("cargado_por", "is", null)),
    contarSiTiene("despacho", () => head("despacho_ordenes_carga").not("sheets_pendiente", "is", null)),
    contarSiTiene("facturacion", () => head("facturas_proveedor").is("requerimiento_id", null).eq("estado", "recibida")),
    contarSiTiene("calidad", () => head("calidad_envases_movimientos").not("sheets_pendiente", "is", null)),
    contarSiTiene("trituracion", () => head("trituracion_partes").not("sheets_pendiente", "is", null)),
    traerRitmo(supabase),
  ]);

  const conteos: Partial<ConteosParaAvisos> = {
    rrhhSinClasificar, mantenimientoAtrasadas, comprasEsperandoAprobacion,
    inventarioSinPlanilla, produccionSinPlanilla, despachoAbiertas, despachoSinPlanilla,
    facturacionSinVincular, calidadEnvasesSinPlanilla, trituracionSinPlanilla,
  };

  const { data: descartes } = await supabase
    .from("notificaciones_descartes")
    .select("notificacion_id, cantidad_vista")
    .eq("usuario_id", user.id);

  const notificaciones = [
    ...avisosDeConteos(conteos),
    ...avisosDeRitmo(ritmoPorModulo(filasRitmo), modulos),
  ];

  return NextResponse.json({ notificaciones: filtrarDescartadas(notificaciones, descartes ?? []) });
}
```

- [ ] **Paso 3: apuntar la campana a la ruta nueva**

En `components/NotificationsBell.tsx`, cambiar la línea 19:

```ts
    fetch("/api/home/resumen")
```

por:

```ts
    fetch("/api/home/avisos")
```

- [ ] **Paso 4: verificar que compila y que los tests siguen pasando**

```bash
npx tsc --noEmit
```

```bash
npm test
```

Esperado: los dos sin errores.

- [ ] **Paso 5: commit**

```bash
git add lib/home/consultas.ts app/api/home/avisos/route.ts components/NotificationsBell.tsx
git commit -m "perf(inicio): la campana deja de disparar el resumen pesado en cada pagina"
```

---

### Tarea 6: `/api/home/resumen` — los titulares nuevos

**Archivos:**
- Modificar: `app/api/home/resumen/route.ts` (reemplazo casi completo)

- [ ] **Paso 1: reescribir el `GET` y los resúmenes afectados**

Cambios, uno por uno:

**a) El `GET`.** Sacar todo el bloque de `const notificaciones: … = []` hasta el
`return` (líneas 54–174 del archivo actual) y dejar:

```ts
  const [rrhh, remises, mantenimiento, compras, inventario, produccion,
         despacho, facturacion, cantera, calidad, tallerVial, trituracion, filasRitmo] =
    await Promise.all([
      modulos.has("rrhh") ? resumenRrhh(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("remises") ? resumenRemises(supabase) : Promise.resolve(null),
      modulos.has("mantenimiento") ? resumenMantenimiento(supabase) : Promise.resolve(null),
      modulos.has("compras") ? resumenCompras(supabase) : Promise.resolve(null),
      modulos.has("inventario") ? resumenInventario(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("produccion") ? resumenProduccion(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("despacho") ? resumenDespacho(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("facturacion") ? resumenFacturacion(supabase) : Promise.resolve(null),
      modulos.has("cantera") ? resumenCantera(supabase) : Promise.resolve(null),
      modulos.has("calidad") ? resumenCalidad(supabase) : Promise.resolve(null),
      modulos.has("taller_vial") ? resumenTallerVial(supabase) : Promise.resolve(null),
      modulos.has("trituracion") ? resumenTrituracion(supabase, mesActual) : Promise.resolve(null),
      traerRitmo(supabase),
    ]);

  return NextResponse.json({
    rrhh, remises, mantenimiento, compras, inventario, produccion,
    despacho, facturacion, cantera, calidad, tallerVial, trituracion,
    ritmo: ritmoPorModulo(filasRitmo),
  });
```

Y los imports que hacen falta arriba:

```ts
import { ritmoPorModulo } from "@/lib/home/ritmo";
import { traerRitmo, diaDeReferenciaRrhh } from "@/lib/home/consultas";
import { comoSeLee } from "@/lib/core/fechas";
```

Borrar los imports que quedan sin uso: `filtrarDescartadas`, `traerTodo`,
`sumarDias` si ya no se usa, y todo el bloque de `@/lib/cantera/*` y
`@/lib/tallerVial/*` que dejen de usarse después de los puntos (f) y (g).

**b) `resumenRrhh`** — reemplazar la función entera:

```ts
/**
 * Los ausentes del último día hábil con fichadas, no los de hoy.
 *
 * El titular era "Ausentes hoy" y el 06/10 decía **1**: a media mañana
 * `calculos_diarios` tenía 2 filas de 68 porque el día no está cerrado. El día
 * anterior había 66 — de 68 — porque las fichadas se cortaron el 30/09 y el
 * cálculo marca ausente a todo el mundo cuando no hay con qué comparar.
 *
 * `ultimoDiaHabilConFichadas` esquiva las tres trampas: hoy, los domingos (los
 * 36 que ya pasaron en 2026 tienen 0 ausentes) y los días sin fichadas importadas
 * (la importación anda a ráfagas). El rótulo nombra el día que
 * terminó eligiendo, así que mostrar uno viejo no engaña a nadie.
 */
async function resumenRrhh(
  supabase: Awaited<ReturnType<typeof createClient>>,
  hoyStr: string
) {
  const dia = await diaDeReferenciaRrhh(supabase, hoyStr);
  const { data: empleados } = await supabase.from("empleados").select("id").eq("activo", true);
  const ids = (empleados ?? []).map((e) => e.id);
  const empleadosActivos = ids.length;

  if (!dia || empleadosActivos === 0) {
    return { empleadosActivos, dia: null, diaLegible: null, ausentes: 0, sinClasificar: 0 };
  }

  const { data: calculos } = await supabase
    .from("calculos_diarios")
    .select("ausente, justificada")
    .in("empleado_id", ids)
    .eq("fecha", dia);

  return {
    empleadosActivos,
    dia,
    diaLegible: comoSeLee(dia),
    ausentes: (calculos ?? []).filter((c) => c.ausente).length,
    sinClasificar: (calculos ?? []).filter((c) => c.ausente && c.justificada === null).length,
  };
}
```

**c) `resumenRemises`** — Remises no tiene cola de trabajo: la tarjeta queda con
los vehículos y el titular lo pone la señal de ritmo. Reemplazar por:

```ts
/**
 * Remises no tiene una cola de trabajo que mirar: lo único accionable del módulo
 * es que se esté cargando, y de eso se ocupa la señal de ritmo. La tarjeta
 * muestra el padrón de vehículos, que es contexto y no un indicador.
 */
async function resumenRemises(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { count } = await supabase
    .from("vehiculos").select("id", { count: "exact", head: true }).eq("activo", true);
  return { vehiculosActivos: count ?? 0 };
}
```

**d) `resumenDespacho`** — sacar `ordenesDeHoy`, que estaba en 0 la mayoría de
los días en el módulo más activo del sistema:

```ts
/**
 * Lo que Despacho tiene abierto.
 *
 * El titular era "órdenes de carga hoy" y marcaba 0 en el módulo más vivo del
 * sistema —1.998 órdenes, 331 el último mes—, porque la carga va a ráfagas. Lo
 * que queda son las dos alarmas, y las dos son sobre la planilla: una orden
 * abierta de un día anterior no llegó porque el espejo escribe al cerrar; una
 * con `sheets_pendiente` no llegó porque Google rechazó la escritura.
 *
 * `abiertasDeDiasAnteriores` cuenta **sólo las que nacieron en el sistema**
 * (`cargado_por` no nulo). Del histórico importado hay 358 de 1.998 sin salida
 * del predio, y ésas no son un olvido accionable: la planilla nunca tuvo esa
 * hora. Contarlas haría que el Inicio abriera con un 358 que nadie puede bajar.
 */
async function resumenDespacho(supabase: Awaited<ReturnType<typeof createClient>>, hoyStr: string) {
  const [{ count: abiertas }, { count: sinLlegar }] = await Promise.all([
    supabase.from("despacho_ordenes_carga")
      .select("id", { count: "exact", head: true })
      .lt("fecha", hoyStr).is("salida_predio", null).not("cargado_por", "is", null),
    supabase.from("despacho_ordenes_carga")
      .select("id", { count: "exact", head: true }).not("sheets_pendiente", "is", null),
  ]);
  return { abiertasDeDiasAnteriores: abiertas ?? 0, sinLlegarALaPlanilla: sinLlegar ?? 0 };
}
```

**e) `resumenFacturacion`** — sacar `entraronHoy` (hay 2 facturas en total):

```ts
/**
 * El buzón de facturas.
 *
 * El titular era "lo que entró hoy" y hay **2 facturas en todo el sistema**: iba
 * a decir 0 casi siempre. Lo que queda pide hacer algo: una factura que nadie
 * enganchó a una compra es la que después aparece en Odoo sin que nadie sepa de
 * qué era, y un CUIT fuera del padrón se arregla cargándoselo al proveedor para
 * que la próxima se enganche sola.
 */
async function resumenFacturacion(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ count: sinVincular }, { count: sinProveedor }] = await Promise.all([
    supabase.from("facturas_proveedor")
      .select("id", { count: "exact", head: true }).is("requerimiento_id", null).eq("estado", "recibida"),
    supabase.from("facturas_proveedor")
      .select("id", { count: "exact", head: true }).is("proveedor_id", null),
  ]);
  return { sinVincular: sinVincular ?? 0, sinProveedor: sinProveedor ?? 0 };
}
```

**f) `resumenCantera`** — queda sólo el aviso. Las toneladas y el acarreo del mes
se van, y con ellos seis consultas que traían tablas enteras:

```ts
/**
 * Lo que Cantera tiene sin resolver.
 *
 * Es el mismo aviso que ordena el tablero de Registros (`contarAvisos` de
 * `lib/cantera/tablero.ts`): facturas sin conciliar o a revisar.
 *
 * Las toneladas voladas y el acarreo a pagar del mes **se sacaron del Inicio**.
 * Eran las que obligaban a traer `cantera_acarreos`, `cantera_pesadas` y
 * `cantera_tarifas_acarreo` enteras para calcular en memoria dos números que ya
 * están en la página de inicio del módulo, a un clic.
 */
async function resumenCantera(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [yacimientos, vs, bs] = await Promise.all([
    traerYacimientos(supabase, true),
    traerVoladuras(supabase, {}),
    traerBochones(supabase, {}),
  ]);
  const porId = new Map(yacimientos.map((y) => [y.id, y]));

  const consumos = await traerConsumosDe(supabase, vs.map((v) => v.codigo));
  const consumosPorCodigo = new Map<string, Consumo[]>();
  for (const c of consumos) {
    const lista = consumosPorCodigo.get(c.voladura_codigo) ?? [];
    lista.push(c);
    consumosPorCodigo.set(c.voladura_codigo, lista);
  }

  const filasVoladura = vs.map((v) =>
    armarFilaVoladura(v, porId.get(v.yacimiento_id) ?? null, consumosPorCodigo.get(v.codigo) ?? [])
  );
  const filasBochon = bs.map((b) => armarFilaBochon(b, porId.get(b.yacimiento_id) ?? null));
  const { sinConciliar } = contarAvisos(filasVoladura, filasBochon);

  return { sinConciliar };
}
```

Y borrar de los imports: `traerAcarreos`, `traerFleteros`, `traerPesadas`,
`traerTarifasAcarreo`, `resumenPorFletero`, `AcarreoPlano`,
`agruparPesadasPorFleteroTipoMes`.

**g) `resumenTallerVial`** — se va el volumen del mes; queda lo accionable:

```ts
/**
 * Lo que Taller Vial tiene sin resolver.
 *
 * Una carga sin equipo reconocido —texto suelto como "empresa piparo" en vez de
 * un código EM— no entra en ningún resumen por equipo hasta que alguien la
 * corrija. Y un service de 250 hs vencido es justamente lo que no hay que dejar
 * pasar.
 *
 * Los litros del mes **se sacaron del Inicio**: eran lo que obligaba a traer las
 * 789 cargas enteras para sumar una columna, y están en la página del módulo.
 * Las cargas se siguen trayendo porque el cálculo de service necesita la última
 * lectura de horómetro de cada equipo, que es historia y no un conteo.
 */
async function resumenTallerVial(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [todasLasCargas, equipos, todosLosServices] = await Promise.all([
    traerCargas(supabase, {}),
    traerEquiposTallerVial(supabase),
    traerServices(supabase),
  ]);

  const horometroActualPorEquipo = ultimaLecturaPorEquipo(
    todasLasCargas
      .filter((c) => c.equipo_id !== null)
      .map((c) => ({ equipoId: c.equipo_id!, fecha: c.fecha, lectura: c.lectura }))
  );
  const servicePorEquipo = resumenServicePorEquipo(
    equipos.map((e) => e.id),
    todosLosServices.map((s) => ({ id: s.id, equipoId: s.equipo_id, tier: s.tier, fecha: s.fecha, horometro: s.horometro })),
    horometroActualPorEquipo
  );
  const de250 = servicePorEquipo.map((r) => r.escalones.find((e) => e.tier === 250)!);

  return {
    sinEquipoReconocido: todasLasCargas.filter((c) => c.equipo_id === null).length,
    serviceVencidos: de250.filter((e) => e.lectura === "VENCIDO").length,
    serviceProximos: de250.filter((e) => e.lectura === "PROXIMO").length,
  };
}
```

Y borrar de los imports: `calcularTrabajoEntreCargas`, `resumenMensualPorEquipo`.

**h) `resumenCalidad`** — función nueva:

```ts
/**
 * Calidad, que no tenía tarjeta: quien sólo tiene ese módulo entraba al Inicio y
 * veía una grilla vacía, ni siquiera el cartel de "no tenés acceso" —porque
 * `modulos.length` no es 0—.
 *
 * El titular sale de **envases** y no de carbonilla: la bandeja de Odoo de
 * carbonilla (`calidad_odoo_sin_reconocer`) está vacía, y el stock de envases
 * bajo el mínimo es una cola corta y accionable, 3 de 28 artículos. `faltante`
 * es una columna generada, así que se cuenta con un filtro.
 *
 * Y en envases **manda la planilla**: un movimiento con `sheets_pendiente` no
 * llegó allá, y como el stock es una fórmula sobre el kardex, la próxima
 * sincronización lo borra de hecho.
 */
async function resumenCalidad(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ count: envasesBajoMinimo }, { count: sinLlegar }] = await Promise.all([
    supabase.from("calidad_envases_articulos")
      .select("id", { count: "exact", head: true }).eq("activo", true).gt("faltante", 0),
    supabase.from("calidad_envases_movimientos")
      .select("id", { count: "exact", head: true }).not("sheets_pendiente", "is", null),
  ]);
  return { envasesBajoMinimo: envasesBajoMinimo ?? 0, sinLlegarALaPlanilla: sinLlegar ?? 0 };
}
```

**i) `resumenTrituracion`** — función nueva:

```ts
/**
 * Trituración, que tampoco tenía tarjeta. Mismo problema de grilla vacía que
 * Calidad.
 *
 * El titular es lo que no se exportó a la planilla: en Trituración la planilla
 * es donde miran los que no entran al sistema, así que un parte que se quedó acá
 * es un día que allá figura en blanco. Los partes del mes van de secundaria,
 * como volumen.
 */
async function resumenTrituracion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  mesActual: string
) {
  const [{ count: sinLlegar }, { count: partesDelMes }] = await Promise.all([
    supabase.from("trituracion_partes")
      .select("id", { count: "exact", head: true }).not("sheets_pendiente", "is", null),
    supabase.from("trituracion_partes")
      .select("id", { count: "exact", head: true }).gte("fecha", `${mesActual}-01`),
  ]);
  return { sinLlegarALaPlanilla: sinLlegar ?? 0, partesDelMes: partesDelMes ?? 0 };
}
```

- [ ] **Paso 2: verificar que compila y que no quedaron imports muertos**

```bash
npx tsc --noEmit
```

```bash
npx eslint app/api/home/resumen/route.ts
```

Esperado: `tsc` sin errores; eslint sin errores nuevos (puede avisar de los 3
conocidos de otros archivos, que no se tocan).

- [ ] **Paso 3: commit**

```bash
git add app/api/home/resumen/route.ts
git commit -m "feat(inicio): titulares que piden hacer algo, y dos modulos que faltaban"
```

---

### Tarea 7: `InicioClient.tsx` — las tarjetas

**Archivos:**
- Modificar: `app/(app)/InicioClient.tsx`

- [ ] **Paso 1: reemplazar la interfaz `Resumen` y `VACIO`**

```tsx
interface Ritmo {
  ultimaFecha: string | null;
  diasSinCargar: number | null;
  umbral: number;
  atrasado: boolean;
}

interface Resumen {
  rrhh: { empleadosActivos: number; dia: string | null; diaLegible: string | null; ausentes: number; sinClasificar: number } | null;
  remises: { vehiculosActivos: number } | null;
  mantenimiento: { atrasadas: number; otPendientes: number; avisosSinOrden: number } | null;
  compras: { enCurso: number; esperandoAprobacion: number; paraComprar: number } | null;
  inventario: { faltantes: number; movimientosHoy: number } | null;
  produccion: { partesFaltantes: number } | null;
  despacho: { abiertasDeDiasAnteriores: number; sinLlegarALaPlanilla: number } | null;
  facturacion: { sinVincular: number; sinProveedor: number } | null;
  cantera: { sinConciliar: number } | null;
  calidad: { envasesBajoMinimo: number; sinLlegarALaPlanilla: number } | null;
  tallerVial: { sinEquipoReconocido: number; serviceVencidos: number; serviceProximos: number } | null;
  trituracion: { sinLlegarALaPlanilla: number; partesDelMes: number } | null;
  ritmo: Partial<Record<Modulo, Ritmo>>;
}

const VACIO: Resumen = {
  rrhh: null, remises: null, mantenimiento: null, compras: null, inventario: null,
  produccion: null, despacho: null, facturacion: null, cantera: null, calidad: null,
  tallerVial: null, trituracion: null, ritmo: {},
};
```

- [ ] **Paso 2: agregar el componente de la línea de ritmo**

Pegarlo debajo de `ModuloCard`:

```tsx
/**
 * La línea que dice cuánto hace que no se carga el módulo.
 *
 * Aparece apenas se pasa el umbral del propio módulo; en la campana recién al
 * doble. Medido el 06/10/2026, ocho de trece fuentes estaban paradas y el Inicio
 * no lo decía en ningún lado — mostraba "Órdenes de carga hoy: 0" para Despacho,
 * que es el mismo 0 que si estuviera todo bien.
 */
function LineaDeRitmo({ ritmo }: { ritmo: Ritmo | undefined }) {
  if (!ritmo || !ritmo.atrasado) return null;
  const texto =
    ritmo.diasSinCargar === null
      ? "Nunca se cargó nada"
      : `Hace ${ritmo.diasSinCargar} ${ritmo.diasSinCargar === 1 ? "día" : "días"} que no se carga`;
  return (
    <div className="flex items-center gap-1.5 px-5 pb-3 text-xs font-medium text-amber-700">
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0">
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {texto}
    </div>
  );
}
```

- [ ] **Paso 3: que `ModuloCard` acepte el ritmo y lo pinte**

En la firma de `ModuloCard`, agregar `ritmo`:

```tsx
function ModuloCard({
  titulo, href, color, icon, hero, secundarias, ritmo,
}: {
  titulo: string;
  href: string;
  color: string;
  icon: React.ReactNode;
  hero: { label: string; valor: string | number } | null;
  secundarias: { label: string; valor: string | number }[] | null;
  ritmo?: Ritmo;
}) {
```

Y entre el bloque del hero (`</div>` que cierra `px-5 pb-3`) y el `<div
className="mt-auto …">` de las secundarias, insertar:

```tsx
      <LineaDeRitmo ritmo={ritmo} />
```

- [ ] **Paso 4: reemplazar las tarjetas**

RRHH:

```tsx
        {tiene("rrhh") && (
          <ModuloCard
            titulo="RRHH"
            href="/rrhh"
            color="#1E7D34"
            icon={<IconUsers />}
            ritmo={resumen?.ritmo.rrhh}
            // El rótulo nombra el día, porque no siempre es ayer: se retrocede
            // hasta el último día hábil con fichadas. Sin eso, el 06/10 la
            // tarjeta mostraba 1 mientras el día anterior había 66 de 68.
            hero={
              resumen?.rrhh
                ? {
                    label: resumen.rrhh.diaLegible
                      ? `Ausentes el ${resumen.rrhh.diaLegible}`
                      : "Sin fichadas importadas",
                    valor: resumen.rrhh.diaLegible ? resumen.rrhh.ausentes : "—",
                  }
                : null
            }
            secundarias={
              resumen?.rrhh
                ? [
                    { label: "Empleados activos", valor: resumen.rrhh.empleadosActivos },
                    { label: "Sin clasificar", valor: resumen.rrhh.sinClasificar },
                  ]
                : null
            }
          />
        )}
```

Remises:

```tsx
        {/* Remises no tiene cola de trabajo: lo único accionable es que se
            cargue, y de eso avisa la línea de ritmo. La última asistencia
            cargada es del 28/07. */}
        {tiene("remises") && (
          <ModuloCard
            titulo="Remises"
            href="/remises"
            color="#2563EB"
            icon={<IconCar />}
            ritmo={resumen?.ritmo.remises}
            hero={resumen?.remises ? { label: "Vehículos activos", valor: resumen.remises.vehiculosActivos } : null}
            secundarias={null}
          />
        )}
```

Despacho:

```tsx
        {/* El titular era "órdenes de carga hoy" y marcaba 0 en el módulo más
            vivo del sistema, porque la carga va a ráfagas. Lo que queda son las
            dos alarmas de planilla. */}
        {tiene("despacho") && (
          <ModuloCard
            titulo="Despacho"
            href="/despacho"
            color="#B45309"
            icon={<IconCamion />}
            ritmo={resumen?.ritmo.despacho}
            hero={resumen?.despacho ? { label: "Órdenes sin cerrar", valor: resumen.despacho.abiertasDeDiasAnteriores } : null}
            secundarias={resumen?.despacho ? [{ label: "Sin llegar a la planilla", valor: resumen.despacho.sinLlegarALaPlanilla }] : null}
          />
        )}
```

> **Desviación del spec, a propósito.** El spec dice que se van las tres
> secundarias «Sin llegar a la planilla» (Inventario, Producción y Despacho).
> En Despacho **se queda**: es la única que le quedaría a esa tarjeta, y una
> tarjeta con un 0 solo y nada más abajo es peor que la secundaria en 0. Si el
> usuario prefiere la regla pareja, se saca y Despacho queda sin secundarias,
> como Cantera y Remises.

Facturación:

```tsx
        {tiene("facturacion") && (
          <ModuloCard
            titulo="Facturación"
            href="/facturacion"
            color="#0F766E"
            icon={<IconComprobante />}
            ritmo={resumen?.ritmo.facturacion}
            hero={resumen?.facturacion ? { label: "Sin vincular a una compra", valor: resumen.facturacion.sinVincular } : null}
            secundarias={resumen?.facturacion ? [{ label: "Con un CUIT que no está en el padrón", valor: resumen.facturacion.sinProveedor }] : null}
          />
        )}
```

Cantera (sacar las dos secundarias de volumen):

```tsx
        {tiene("cantera") && (
          <ModuloCard
            titulo="Cantera"
            href="/cantera"
            color="#78716C"
            icon={<IconMountain />}
            ritmo={resumen?.ritmo.cantera}
            hero={resumen?.cantera ? { label: "Facturas a conciliar o revisar", valor: resumen.cantera.sinConciliar } : null}
            secundarias={null}
          />
        )}
```

Taller Vial (sacar los litros del mes):

```tsx
        {tiene("taller_vial") && (
          <ModuloCard
            titulo="Taller Vial"
            href="/taller-vial"
            color="#0891B2"
            icon={<IconGauge />}
            ritmo={resumen?.ritmo.taller_vial}
            hero={resumen?.tallerVial ? { label: "Cargas sin equipo reconocido", valor: resumen.tallerVial.sinEquipoReconocido } : null}
            secundarias={
              resumen?.tallerVial
                ? [
                    { label: "Service de 250 hs vencido", valor: resumen.tallerVial.serviceVencidos },
                    { label: "Service por vencer", valor: resumen.tallerVial.serviceProximos },
                  ]
                : null
            }
          />
        )}
```

Inventario, Producción (sacar las secundarias de planilla, que están en 0):

```tsx
        {tiene("inventario") && (
          <ModuloCard
            titulo="Inventario"
            href="/inventario"
            color="#7C3AED"
            icon={<IconCajas />}
            ritmo={resumen?.ritmo.inventario}
            hero={resumen?.inventario ? { label: "Artículos bajo el mínimo", valor: resumen.inventario.faltantes } : null}
            secundarias={resumen?.inventario ? [{ label: "Movimientos hoy", valor: resumen.inventario.movimientosHoy }] : null}
          />
        )}

        {tiene("produccion") && (
          <ModuloCard
            titulo="Producción"
            href="/produccion"
            color="#0E7490"
            icon={<IconFabrica />}
            ritmo={resumen?.ritmo.produccion}
            hero={resumen?.produccion ? { label: "Partes sin cargar (7 días)", valor: resumen.produccion.partesFaltantes } : null}
            secundarias={null}
          />
        )}
```

Y las dos nuevas, al final de la grilla:

```tsx
        {/* Calidad y Trituración no tenían tarjeta: quien sólo tenía esos
            módulos entraba y veía una grilla vacía, sin siquiera el cartel de
            "no tenés acceso" —`modulos.length` no es 0—. */}
        {tiene("calidad") && (
          <ModuloCard
            titulo="Calidad"
            href="/calidad"
            color="#BE185D"
            icon={<IconMatraz />}
            ritmo={resumen?.ritmo.calidad}
            hero={resumen?.calidad ? { label: "Envases bajo el mínimo", valor: resumen.calidad.envasesBajoMinimo } : null}
            secundarias={resumen?.calidad ? [{ label: "Sin llegar a la planilla", valor: resumen.calidad.sinLlegarALaPlanilla }] : null}
          />
        )}

        {tiene("trituracion") && (
          <ModuloCard
            titulo="Trituración"
            href="/trituracion"
            color="#7E22CE"
            icon={<IconTrituradora />}
            ritmo={resumen?.ritmo.trituracion}
            hero={resumen?.trituracion ? { label: "Partes sin exportar", valor: resumen.trituracion.sinLlegarALaPlanilla } : null}
            secundarias={resumen?.trituracion ? [{ label: "Partes este mes", valor: resumen.trituracion.partesDelMes }] : null}
          />
        )}
```

- [ ] **Paso 5: agregar los dos iconos nuevos**

Al final del archivo, junto a los otros:

```tsx
function IconMatraz() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M9 3v6.5L3.8 18A2 2 0 0 0 5.5 21h13a2 2 0 0 0 1.7-3L15 9.5V3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 3h8M6.8 15h10.4" strokeLinecap="round" />
    </svg>
  );
}

function IconTrituradora() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M4 4h16l-3 6H7L4 4Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 14h8M9.5 18h5" strokeLinecap="round" />
      <path d="M12 10v2" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Paso 6: importar `Modulo` si no está**

La primera línea de imports ya trae `import type { Modulo } from "@/lib/core/types";`.
Verificar que siga ahí.

- [ ] **Paso 7: verificar**

```bash
npx tsc --noEmit
```

```bash
npm test
```

Esperado: los dos limpios.

- [ ] **Paso 8: commit**

```bash
git add "app/(app)/InicioClient.tsx"
git commit -m "feat(inicio): tarjetas de Calidad y Trituracion, y la senal de ritmo en cada una"
```

---

### Tarea 8: verificación final

- [ ] **Paso 1: las cuatro de siempre**

Parar `npm run dev` antes del build — con el dev server levantado, `next build`
deja la app en 500.

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run build
```

```bash
node scripts/revisar-arbol-commiteado.mjs
```

El último es el que importa: los otros tres miran el disco y Vercel construye el
árbol commiteado. `lib/home/ritmo.ts`, `lib/home/avisos.ts`, `lib/rrhh/diaHabil.ts`
y `app/api/home/avisos/route.ts` son **archivos nuevos**: si alguno quedó
*staged* y sin commitear, el build local pasa y el deploy se cae con `Module not
found`. Eso tiró cuatro deploys seguidos el 14/09/2026.

- [ ] **Paso 2: comprobar los números contra la base**

Casi todo está detrás del login, así que la comprobación es contra la base con el
`SUPABASE_SERVICE_ROLE_KEY` de `.env.local`. Verificar que:

- `inicio_ritmo_modulos` devuelve trece filas, ninguna con `dias_sin_cargar` negativo.
- `ultimoDiaHabilConFichadas` sobre las fichadas reales devuelve **2026-09-30**
  (o el que corresponda al día en que se corra), y los ausentes de ese día son
  **7**, no 66.

- [ ] **Paso 3: pushear**

```bash
git push
```

- [ ] **Paso 4: avisarle al usuario qué va a ver**

**El Inicio va a abrir con ocho módulos en rojo.** No es un defecto del
indicador: es el estado real del sistema, que hasta ahora no se veía. Y la
campana va a mostrar siete avisos de ritmo de golpe la primera vez.

Aparte de esta tarea, queda sobre la mesa un problema real que apareció al
medir: **la importación de fichadas anduvo a ráfagas en 2026** (sólo entró en julio,
agosto y septiembre), y
`calculos_diarios` tiene cinco meses de ausencias falsas guardadas (65 de 68
empleados en promedio, de febrero a junio, y otra vez desde el 01/10). La tarjeta
ahora las esquiva, pero el dato guardado sigue mal.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cuantasTolerancias,
  entradasCaidas,
  estadoDeRecurso,
  haceCuantoCorto,
  rachaDeFallos,
  recursosSinDeclarar,
  REGISTRO,
  type CorridaLeida,
} from "./saludDeLasSincronizaciones";

const AHORA = new Date("2026-11-05T12:00:00Z");
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 3_600_000).toISOString();
const corrida = (p: Partial<CorridaLeida>): CorridaLeida => ({
  modulo: "cantera",
  recurso: "acarreo",
  ok: true,
  error: null,
  created_at: hace(1),
  ...p,
});

describe("estadoDeRecurso", () => {
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
});

/*
 * Vivía en `lib/agenda/avisosDeLaAgenda.ts` y se mudó acá con la generalización.
 * No es `haceCuanto` de `lib/core/haceCuanto.ts`: ésta dice «hace 5 h» y no
 * «hace 5 horas», y una fecha ilegible no le sale como «nunca».
 */
describe("haceCuantoCorto", () => {
  it("dice las horas, y pasa a días cuando son muchas", () => {
    expect(haceCuantoCorto(hace(5), AHORA)).toBe("hace 5 h");
    expect(haceCuantoCorto(hace(72), AHORA)).toBe("hace 3 días");
  });

  it("una fecha ilegible lo dice en vez de inventar un «nunca»", () => {
    expect(haceCuantoCorto("no es una fecha", AHORA)).toBe("en una fecha ilegible");
  });
});

describe("cuantasTolerancias", () => {
  it("recién caído es 1", () =>
    expect(cuantasTolerancias(corrida({ created_at: hace(25) }), 24, AHORA)).toBe(1));

  it("crece con el silencio, para que el descarte se suelte", () =>
    expect(cuantasTolerancias(corrida({ created_at: hace(73) }), 24, AHORA)).toBe(3));

  it("un fallo reciente también es al menos 1", () =>
    expect(cuantasTolerancias(corrida({ ok: false, created_at: hace(1) }), 24, AHORA)).toBe(1));

  it("sin fila es 1", () => expect(cuantasTolerancias(undefined, 24, AHORA)).toBe(1));

  it("una fecha ilegible es 1 y no NaN", () =>
    expect(cuantasTolerancias(corrida({ created_at: "no es una fecha" }), 24, AHORA)).toBe(1));

  /*
   * Una tolerancia en 0 da `Infinity` al dividir, y `JSON.stringify` lo manda
   * como `null`: por ahí pasan la campana y el cuerpo del descarte, y una
   * cantidad nula no se compara con nada. Hoy ninguna entrada declara 0, pero
   * el tipo lo acepta y nada avisaría.
   */
  it("una tolerancia en cero no da Infinity", () =>
    expect(cuantasTolerancias(corrida({ created_at: hace(73) }), 0, AHORA)).toBe(73));
});

/**
 * Una vista en la que **todo** lo declarado corrió hace una hora: el punto de
 * partida de cada prueba. Sin esto, cualquier prueba que pase un par de filas
 * deja a las otras veinte entradas en `nunca` y no puede preguntar por una sola.
 * `cambios` pisa la fila de un recurso (`modulo/recurso`); `null` la saca.
 */
function vistaSana(cambios: Record<string, Partial<CorridaLeida> | null> = {}): CorridaLeida[] {
  const filas: CorridaLeida[] = [];
  for (const e of REGISTRO) {
    for (const recurso of e.recursos) {
      const clave = `${e.modulo}/${recurso}`;
      const cambio = cambios[clave];
      if (cambio === null) continue;
      filas.push({ modulo: e.modulo, recurso, ok: true, error: null, created_at: hace(1), ...cambio });
    }
  }
  return filas;
}

describe("el registro y las entradas caídas", () => {
  it("una vista sana no tiene nada caído", () => {
    expect(entradasCaidas(vistaSana(), AHORA)).toEqual([]);
  });

  it("una entrada exceptuada no sale caída aunque su última corrida haya fallado", () => {
    const caidas = entradasCaidas(
      vistaSana({ "calidad/envases_bajada": { ok: false, error: "x", created_at: hace(999) } }),
      AHORA
    );
    expect(caidas).toEqual([]);
  });

  it("un recurso de la vista que nadie declaró se nombra", () => {
    expect(
      recursosSinDeclarar([{ modulo: "nuevo", recurso: "cosa", ok: true, error: null, created_at: hace(1) }])
    ).toEqual(["nuevo/cosa"]);
  });

  it("todo lo declarado, vigilado o exceptuado, cuenta como declarado", () => {
    expect(recursosSinDeclarar(vistaSana())).toEqual([]);
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
    const error = "No se pudo llegar a Odoo (…): fetch failed";
    const caidas = entradasCaidas(vistaSana({ "calidad/carbonilla-odoo": { ok: false, error } }), AHORA);
    expect(caidas).toHaveLength(1);
    expect(caidas[0]).toMatchObject({ clave: "calidad/carbonilla-odoo", estado: "fallo", detalle: error });
  });

  it("un grupo que una sola corrida escribe sale como una entrada y no como ocho", () => {
    const grupo = REGISTRO.find((e) => e.modulo === "respaldo")!;
    expect(grupo.recursos).toHaveLength(8);
    const viejas = Object.fromEntries(
      grupo.recursos.map((r) => [`respaldo/${r}`, { created_at: hace(400 * 24) }])
    );
    const caidas = entradasCaidas(vistaSana(viejas), AHORA);
    expect(caidas).toHaveLength(1);
    expect(caidas[0]).toMatchObject({ clave: "respaldo/sheets", estado: "vieja" });
  });

  /*
   * EL 1 DE UN `nunca` ES FIJO Y ES A PROPÓSITO. No crece como el de una
   * `vieja`: sin ninguna corrida no hay desde cuándo contar, así que un
   * descarte ahí calla al recurso hasta que su cantidad pase de 1. Darle el
   * número del día —el truco de `salud-sin-comprobar`— sería peor: el id es
   * `salud-${clave}` y no depende del estado, así que un `nunca` descartado en
   * ~20.771 dejaría mudo a ese recurso **justo cuando empiece a correr y a
   * fallar**, porque una racha nunca llega a 20.771.
   */
  it("un recurso vigilado que nunca corrió sale 'nunca' con 1", () => {
    const caidas = entradasCaidas(vistaSana({ "cantera/acarreo": null }), AHORA);
    expect(caidas).toEqual([
      { clave: "cantera/acarreo", titulo: "Acarreo de Cantera", estado: "nunca", cuantoLlevaMal: 1, detalle: "nunca corrió" },
    ]);
  });

  it("uno vencido dice cuánto hace y cuenta sus tolerancias", () => {
    const caidas = entradasCaidas(vistaSana({ "cantera/acarreo": { created_at: hace(73) } }), AHORA);
    expect(caidas).toHaveLength(1);
    expect(caidas[0]).toMatchObject({ estado: "vieja", cuantoLlevaMal: 3, detalle: "hace 3 días" });
  });

  /*
   * EN `fallo` NO SE CUENTAN TOLERANCIAS, Y ÉSTE ES EL CASO QUE LO OBLIGA.
   *
   * `calidad/carbonilla-odoo` falla todos los días a las 08:00. Cada corrida
   * reescribe su fila con `created_at` fresco, así que el silencio medido es de
   * horas y `cuantasTolerancias` da 1 para siempre: quien descarte el aviso una
   * vez deja ese recurso roto y **mudo para siempre**, porque
   * `filtrarDescartadas` pide `cantidad > cantidad_vista`.
   *
   * Acá queda en 1 porque contar la racha necesita leer `sincronizaciones`, que
   * es de `rachaDeFallos`; `leerLaSalud` la reemplaza por la de verdad.
   */
  it("un fallo no cuenta tolerancias: queda en 1 hasta que se lea su racha", () => {
    const caidas = entradasCaidas(
      vistaSana({ "cantera/acarreo": { ok: false, error: "x", created_at: hace(400) } }),
      AHORA
    );
    expect(caidas[0]).toMatchObject({ estado: "fallo", cuantoLlevaMal: 1 });
  });

  it("dice de qué recurso del grupo salió la corrida, que es de la que hay que contar la racha", () => {
    const caidas = entradasCaidas(
      vistaSana({ "respaldo/RRHH - Padron": { ok: false, error: "403 de Google" } }),
      AHORA
    );
    expect(caidas[0].recursoQueFallo).toEqual({ modulo: "respaldo", recurso: "RRHH - Padron" });
  });

  it("uno que corrió dentro de su tolerancia no sale", () => {
    const caidas = entradasCaidas(vistaSana({ "cantera/acarreo": { created_at: hace(23) } }), AHORA);
    expect(caidas).toEqual([]);
  });

  it("cada entrada se mide con su propia tolerancia", () => {
    // 30 h: pasa de las 24 de Cantera, no de las 36 de la carbonilla ni de las 50 de Lenox.
    const caidas = entradasCaidas(
      vistaSana({
        "cantera/acarreo": { created_at: hace(30) },
        "calidad/carbonilla-planilla": { created_at: hace(30) },
        "rrhh/lenox-marcaciones": { created_at: hace(30) },
      }),
      AHORA
    );
    expect(caidas.map((c) => c.clave)).toEqual(["cantera/acarreo"]);
  });

  it("de un grupo se toma la peor corrida: una pestaña caída hace caer la entrada y dice cuál", () => {
    const caidas = entradasCaidas(
      vistaSana({ "respaldo/RRHH - Padron": { ok: false, error: "403 de Google" } }),
      AHORA
    );
    expect(caidas).toHaveLength(1);
    expect(caidas[0]).toMatchObject({ clave: "respaldo/sheets", estado: "fallo", detalle: "403 de Google" });
  });

  it("de un grupo, un fallo gana sobre una pestaña vieja", () => {
    const caidas = entradasCaidas(
      vistaSana({
        "respaldo/RRHH - Padron": { created_at: hace(30 * 24) },
        "respaldo/Calidad - Ensayos": { ok: false, error: "se cayó" },
      }),
      AHORA
    );
    expect(caidas[0]).toMatchObject({ estado: "fallo", detalle: "se cayó" });
  });

  it("de un grupo, un recurso que falta en la vista deja la entrada en 'nunca'", () => {
    const caidas = entradasCaidas(vistaSana({ "respaldo/Remises - Plan": null }), AHORA);
    expect(caidas).toHaveLength(1);
    expect(caidas[0]).toMatchObject({ clave: "respaldo/sheets", estado: "nunca" });
  });
});

/*
 * ── LA RACHA DE FALLOS ──────────────────────────────────────────────────────
 *
 * Lo que cierra el agujero de `fallo`: para un recurso que falla una y otra
 * vez, la cantidad del aviso tiene que **crecer con cada corrida fallida**, de
 * modo que un descarte caduque solo en la corrida siguiente.
 */
describe("rachaDeFallos", () => {
  type FilaCruda = Record<string, unknown> & { created_at: string };

  /**
   * Las tablas de mentira: aplican los `eq`/`gt`/`is`/`not` que les encadenen,
   * y **ordenan por lo que diga el `order`**.
   *
   * Los filtros se aplican de verdad —no devuelve siempre lo mismo— justo para
   * que un test pueda comprobar que la racha de un recurso no se come las
   * corridas de otro, que es lo que haría una consulta mal filtrada. Y recibe
   * **varias tablas** porque `ultima_sincronizacion` es una unión: la racha de
   * Compras no se cuenta en la misma tabla que la de los demás.
   *
   * **El `order` se obedece y no se ignora**, que es lo que esta copia hacía
   * antes: `b.order = () => b` y un `sort` descendente fijo adentro de
   * `maybeSingle`. Con eso, dar vuelta el `ascending` en la consulta de verdad
   * —la última buena pasaría a ser la **primera** buena de la historia, y toda
   * racha sería «todo lo que falló alguna vez»— dejaba los tests en verde. Un
   * doble que decide por su cuenta lo que la consulta le pide confirma lo que
   * no pasó.
   */
  function clienteCon(porTabla: Record<string, FilaCruda[]>, rompe = false): SupabaseClient {
    const armar = (tabla: string) => {
      const filas = porTabla[tabla] ?? [];
      const filtros: ((f: FilaCruda) => boolean)[] = [];
      const pasa = (f: FilaCruda) => filtros.every((q) => q(f));
      /** Lo que pidió el `order`, para obedecerlo en `maybeSingle`. */
      let orden: { columna: string; ascendente: boolean } | undefined;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (col: string, val: unknown) => {
        filtros.push((f) => f[col] === val);
        return b;
      };
      b.gt = (col: string, val: string) => {
        filtros.push((f) => String(f[col]) > val);
        return b;
      };
      b.is = (col: string, val: unknown) => {
        filtros.push((f) => (f[col] ?? null) === val);
        return b;
      };
      b.not = (col: string, _op: string, val: unknown) => {
        filtros.push((f) => (f[col] ?? null) !== val);
        return b;
      };
      b.order = (columna: string, opciones?: { ascending?: boolean }) => {
        orden = { columna, ascendente: opciones?.ascending ?? true };
        return b;
      };
      b.limit = () => b;
      b.maybeSingle = async () => {
        if (rompe) return { data: null, error: { message: "no existe la tabla" } };
        const elegidas = filas.filter(pasa);
        if (orden) {
          const { columna, ascendente } = orden;
          elegidas.sort((a, z) =>
            String(a[columna]) < String(z[columna]) ? (ascendente ? -1 : 1) : ascendente ? 1 : -1
          );
        }
        return { data: elegidas[0] ?? null, error: null };
      };
      // El conteo se espera directo sobre el builder: `await supabase.from(…)…`.
      b.then = (resolver: (r: { count: number | null; error: { message: string } | null }) => void) =>
        resolver(
          rompe
            ? { count: null, error: { message: "no existe la tabla" } }
            : { count: filas.filter(pasa).length, error: null }
        );
      return b;
    };
    return { from: (tabla: string) => armar(tabla) } as unknown as SupabaseClient;
  }

  const fila = (p: Partial<FilaCruda>): FilaCruda => ({
    modulo: "calidad",
    recurso: "carbonilla-odoo",
    ok: false,
    created_at: hace(1),
    ...p,
  });
  const sincronizaciones = (...filas: FilaCruda[]) => clienteCon({ sincronizaciones: filas });

  it("cuenta las corridas fallidas desde la última que anduvo", async () => {
    const c = sincronizaciones(
      fila({ ok: true, created_at: hace(10) }),
      fila({ created_at: hace(8) }),
      fila({ created_at: hace(4) }),
      fila({ created_at: hace(1) })
    );
    expect(await rachaDeFallos(c, "calidad", "carbonilla-odoo")).toBe(3);
  });

  it("si nunca anduvo, son todas las fallidas", async () => {
    const c = sincronizaciones(fila({ created_at: hace(8) }), fila({ created_at: hace(1) }));
    expect(await rachaDeFallos(c, "calidad", "carbonilla-odoo")).toBe(2);
  });

  // Una corrida más tarde, uno más: es lo único que tiene que pasar para que el
  // descarte de ayer no silencie el fallo de hoy.
  it("crece con cada corrida fallida, que es para lo que existe", async () => {
    const filas = [fila({ ok: true, created_at: hace(10) }), fila({ created_at: hace(9) })];
    expect(await rachaDeFallos(clienteCon({ sincronizaciones: filas }), "calidad", "carbonilla-odoo")).toBe(1);
    filas.push(fila({ created_at: hace(8) }));
    expect(await rachaDeFallos(clienteCon({ sincronizaciones: filas }), "calidad", "carbonilla-odoo")).toBe(2);
  });

  /*
   * EL `order` SE OBEDECE, Y POR ESO ESTE TEST EXISTE.
   *
   * Con dos corridas buenas, «la última» y «la primera» no son la misma fila:
   * si la consulta pidiera `ascending: true`, la buena sería la de hace 20 h y
   * la racha contaría también el fallo de hace 15 — o sea, todo lo que falló
   * alguna vez. Mientras la tabla de mentira ordenaba descendente por su cuenta,
   * dar vuelta ese flag no rompía ni un test.
   */
  it("la última buena es la última y no la primera: cuenta desde la más reciente", async () => {
    const c = sincronizaciones(
      fila({ ok: true, created_at: hace(20) }),
      fila({ created_at: hace(15) }),
      fila({ ok: true, created_at: hace(10) }),
      fila({ created_at: hace(4) })
    );
    expect(await rachaDeFallos(c, "calidad", "carbonilla-odoo")).toBe(1);
  });

  /*
   * ── LAS CORRIDAS DEL OTRO DESPLIEGUE NO ENTRAN ──────────────────────────────
   *
   * En esta base escriben **dos despliegues** (ver el CLAUDE.md), y el ajeno no
   * siempre falla: medido el 11/11/2026, escribe `ok = true` en `agenda/canales`
   * todos los días a las 05:30, media hora después del canónico. Sin filtrar,
   * esa fila buena se lleva puesta la racha: el día que falle la corrida de
   * verdad no queda ninguna fallida posterior y el número se clava en 1 para
   * siempre — un descarte y ese recurso no vuelve a sonar nunca.
   */
  it("una corrida buena del otro despliegue no borra la racha del canónico", async () => {
    const c = sincronizaciones(
      fila({ ok: true, created_at: hace(10) }),
      fila({ created_at: hace(8) }),
      fila({ created_at: hace(4) }),
      // La ajena, más nueva que todas: sin el filtro sería «la última buena».
      fila({ ok: true, canonico: false, created_at: hace(3) })
    );
    expect(await rachaDeFallos(c, "calidad", "carbonilla-odoo")).toBe(2);
  });

  it("un fallo del otro despliegue tampoco engorda la racha", async () => {
    const c = sincronizaciones(
      fila({ ok: true, canonico: true, created_at: hace(10) }),
      fila({ canonico: true, created_at: hace(8) }),
      fila({ canonico: false, created_at: hace(6) })
    );
    expect(await rachaDeFallos(c, "calidad", "carbonilla-odoo")).toBe(1);
  });

  /*
   * Y EL FILTRO ES `not canonico is false`, NO `canonico = true`.
   *
   * La columna la agregó la migración `20261105092248`: las filas anteriores la
   * tienen en `null` y son la enorme mayoría —3.907 contra 357, medido el
   * 11/11/2026—. Exigir `true` tiraría la historia entera y toda racha
   * arrancaría de cero, que es la misma regla de «preferir y no filtrar» del
   * encabezado de esa migración.
   */
  it("las corridas anteriores a la migración, sin canónico, siguen contando", async () => {
    const c = sincronizaciones(
      fila({ ok: true, canonico: null, created_at: hace(10) }),
      fila({ canonico: null, created_at: hace(8) }),
      fila({ canonico: null, created_at: hace(4) })
    );
    expect(await rachaDeFallos(c, "calidad", "carbonilla-odoo")).toBe(2);
  });

  it("no se come las corridas de otro recurso ni de otro módulo", async () => {
    const c = sincronizaciones(
      fila({ created_at: hace(5) }),
      fila({ recurso: "carbonilla-planilla", created_at: hace(4) }),
      fila({ modulo: "cantera", recurso: "acarreo", created_at: hace(3) })
    );
    expect(await rachaDeFallos(c, "calidad", "carbonilla-odoo")).toBe(1);
  });

  /*
   * EL QUE SE ESCAPÓ LA PRIMERA VEZ, Y POR QUÉ NO SE VEÍA.
   *
   * `ultima_sincronizacion` es una UNIÓN: `compras/planilla` no sale de
   * `sincronizaciones` sino de `compras_sincronizaciones`. Contándola en la
   * tabla equivocada no hay ninguna fila, el conteo da 0, el piso de 1 lo
   * levanta y el resultado sale por el camino de éxito — **indistinguible de
   * una racha legítima de 1**, sin una línea en el log. Compras es el espejo de
   * más tráfico del sistema y ya tuvo un día entero caído.
   */
  it("la racha de Compras se cuenta en SU tabla, que es de donde la vista la saca", async () => {
    const importar = (p: Partial<FilaCruda>): FilaCruda => ({
      direccion: "importar",
      error: "se cayó",
      created_at: hace(1),
      ...p,
    });
    const c = clienteCon({
      sincronizaciones: [],
      compras_sincronizaciones: [
        importar({ error: null, created_at: hace(10) }),
        importar({ created_at: hace(6) }),
        importar({ created_at: hace(3) }),
        // La otra dirección no es la que mira la vista.
        importar({ direccion: "exportar", created_at: hace(2) }),
      ],
    });
    expect(await rachaDeFallos(c, "compras", "planilla")).toBe(2);
  });

  /*
   * La defensa de la familia entera, y no sólo de Compras: si mañana la vista
   * suma otra unión y nadie declara de dónde sacarle la racha, **no puede pasar
   * por buena**. Sin ninguna fila no hay racha que contar, y decir «1» ahí es
   * decir «falló una vez» de algo que no se miró.
   */
  it("un recurso sin NINGUNA fila no es una racha de 1: lo dice en el log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await rachaDeFallos(sincronizaciones(), "nuevo", "cosa")).toBe(1);
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toContain("nuevo/cosa");
  });

  /*
   * Si no se puede contar la racha NO se tumba la salud entera: la vista sí se
   * leyó y el aviso tiene que salir igual. Se pierde la caducidad del descarte,
   * que es mucho menos que perder el aviso, y queda dicho en el log.
   */
  it("si la lectura falla devuelve 1 y no tira", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await rachaDeFallos(clienteCon({ sincronizaciones: [] }, true), "calidad", "carbonilla-odoo")).toBe(1);
    expect(log).toHaveBeenCalled();
  });
});

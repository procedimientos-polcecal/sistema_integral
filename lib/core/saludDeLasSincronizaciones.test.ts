import { describe, expect, it } from "vitest";
import {
  cuantasTolerancias,
  entradasCaidas,
  estadoDeRecurso,
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

  it("un recurso vigilado que nunca corrió sale 'nunca' con 1 tolerancia", () => {
    const caidas = entradasCaidas(vistaSana({ "cantera/acarreo": null }), AHORA);
    expect(caidas).toEqual([
      { clave: "cantera/acarreo", titulo: "Acarreo de Cantera", estado: "nunca", tolerancias: 1, detalle: "nunca corrió" },
    ]);
  });

  it("uno vencido dice cuánto hace y cuenta sus tolerancias", () => {
    const caidas = entradasCaidas(vistaSana({ "cantera/acarreo": { created_at: hace(73) } }), AHORA);
    expect(caidas).toHaveLength(1);
    expect(caidas[0]).toMatchObject({ estado: "vieja", tolerancias: 3, detalle: "hace 3 días" });
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

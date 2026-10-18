import { describe, it, expect } from "vitest";
import {
  clasificarFallo,
  puedeMandarse,
  proximaAMandar,
  esperandoDesdeAyer,
  paradas,
  esperaAntesDeReintentar,
  MINUTOS_PARA_SOLTAR,
} from "@/public/cola/colaOffline.js";

const AHORA = new Date("2026-10-18T12:00:00.000Z");

/** Minutos antes de AHORA, como texto ISO. */
function haceMinutos(minutos: number): string {
  return new Date(AHORA.getTime() - minutos * 60_000).toISOString();
}

function carga(cambios: Record<string, unknown> = {}) {
  return {
    clave: "clave-1",
    tipo: "aviso" as const,
    cuerpo: {},
    usuarioId: "ana",
    creadaEn: haceMinutos(30),
    tomadaEn: null as string | null,
    intentos: 0,
    ultimoError: null as string | null,
    estado: "esperando" as "esperando" | "parada",
    ...cambios,
  };
}

describe("clasificarFallo", () => {
  it("un 400 y un 403 son definitivos: reintentar no cambia nada", () => {
    expect(clasificarFallo(400)).toBe("definitivo");
    expect(clasificarFallo(403)).toBe("definitivo");
  });

  it("un 409 es definitivo: la clave quedó reservada y reintentar sólo daría otro 409", () => {
    expect(clasificarFallo(409)).toBe("definitivo");
  });

  it("un 401 es PASAJERO: la sesión se vence sola mientras la carga espera", () => {
    expect(clasificarFallo(401)).toBe("pasajero");
  });

  it("un 502 es pasajero: así reporta la ruta que Google no contestó", () => {
    expect(clasificarFallo(502)).toBe("pasajero");
  });

  it("no haber llegado a hablar con el servidor es pasajero", () => {
    expect(clasificarFallo(null)).toBe("pasajero");
  });
});

describe("puedeMandarse", () => {
  it("una carga esperando, propia y sin tomar se manda", () => {
    expect(puedeMandarse(carga(), "ana", AHORA)).toBe(true);
  });

  it("no se manda una carga de otro: firmaría la planilla con quien no la hizo", () => {
    expect(puedeMandarse(carga({ usuarioId: "ana" }), "beto", AHORA)).toBe(false);
  });

  it("no se manda una carga parada", () => {
    expect(puedeMandarse(carga({ estado: "parada" }), "ana", AHORA)).toBe(false);
  });

  it("no se manda una carga que otro disparo tomó recién", () => {
    const tomada = carga({ tomadaEn: haceMinutos(1) });
    expect(puedeMandarse(tomada, "ana", AHORA)).toBe(false);
  });

  it("una carga tomada hace más de MINUTOS_PARA_SOLTAR se suelta: el disparo anterior murió", () => {
    const tomada = carga({ tomadaEn: haceMinutos(MINUTOS_PARA_SOLTAR + 1) });
    expect(puedeMandarse(tomada, "ana", AHORA)).toBe(true);
  });

  it("el límite es exacto: a los MINUTOS_PARA_SOLTAR justos todavía está tomada", () => {
    const justo = carga({ tomadaEn: haceMinutos(MINUTOS_PARA_SOLTAR) });
    expect(puedeMandarse(justo, "ana", AHORA)).toBe(false);
    const pasado = carga({ tomadaEn: new Date(AHORA.getTime() - MINUTOS_PARA_SOLTAR * 60_000 - 1).toISOString() });
    expect(puedeMandarse(pasado, "ana", AHORA)).toBe(true);
  });

  it("sin sesión conocida no se manda nada", () => {
    expect(puedeMandarse(carga(), null, AHORA)).toBe(false);
  });

  it("un usuario actual undefined o vacío tampoco manda nada, aunque la carga no tenga dueño", () => {
    // El service worker es JavaScript sin chequeo de tipos: ahí llega lo que llegue.
    const sinDuenio = carga({ usuarioId: undefined });
    expect(puedeMandarse(sinDuenio, undefined as unknown as null, AHORA)).toBe(false);
    expect(puedeMandarse(carga({ usuarioId: "" }), "", AHORA)).toBe(false);
  });

  it("una carga sin usuarioId no se manda nunca: no hay a quién firmar", () => {
    expect(puedeMandarse(carga({ usuarioId: undefined }), "ana", AHORA)).toBe(false);
    expect(puedeMandarse(carga({ usuarioId: "" }), "ana", AHORA)).toBe(false);
  });

  it("una marca de toma en el futuro no traba la carga para siempre", () => {
    const tomada = carga({ tomadaEn: haceMinutos(-600) });
    expect(puedeMandarse(tomada, "ana", AHORA)).toBe(true);
  });

  it("una marca de toma ilegible no traba la carga para siempre", () => {
    const tomada = carga({ tomadaEn: "no es una fecha" });
    expect(puedeMandarse(tomada, "ana", AHORA)).toBe(true);
  });
});

describe("proximaAMandar", () => {
  it("manda la más vieja primero", () => {
    const nueva = carga({ clave: "nueva", creadaEn: haceMinutos(10) });
    const vieja = carga({ clave: "vieja", creadaEn: haceMinutos(120) });
    const media = carga({ clave: "media", creadaEn: haceMinutos(60) });
    expect(proximaAMandar([nueva, vieja, media], "ana", AHORA)?.clave).toBe("vieja");
  });

  it("salta las que no puede mandar", () => {
    const deBeto = carga({ clave: "de-beto", usuarioId: "beto", creadaEn: haceMinutos(120) });
    const parada = carga({ clave: "parada", estado: "parada", creadaEn: haceMinutos(90) });
    const propia = carga({ clave: "propia", creadaEn: haceMinutos(10) });
    expect(proximaAMandar([deBeto, parada, propia], "ana", AHORA)?.clave).toBe("propia");
  });

  it("devuelve null si no hay ninguna para mandar", () => {
    expect(proximaAMandar([], "ana", AHORA)).toBeNull();
    expect(proximaAMandar([carga()], null, AHORA)).toBeNull();
  });

  it("no reordena el arreglo que recibe", () => {
    const nueva = carga({ clave: "nueva", creadaEn: haceMinutos(10) });
    const vieja = carga({ clave: "vieja", creadaEn: haceMinutos(120) });
    const cargas = [nueva, vieja];
    proximaAMandar(cargas, "ana", AHORA);
    expect(cargas.map((c) => c.clave)).toEqual(["nueva", "vieja"]);
  });

  it("una creadaEn ilegible va al final: nunca le pasa por delante a una con fecha", () => {
    const rota = carga({ clave: "rota", creadaEn: "no es una fecha" });
    const nueva = carga({ clave: "nueva", creadaEn: haceMinutos(10) });
    expect(proximaAMandar([rota, nueva], "ana", AHORA)?.clave).toBe("nueva");
    expect(proximaAMandar([nueva, rota], "ana", AHORA)?.clave).toBe("nueva");
  });

  it("si sólo queda una con creadaEn ilegible, se manda igual", () => {
    const rota = carga({ clave: "rota", creadaEn: "no es una fecha" });
    expect(proximaAMandar([rota], "ana", AHORA)?.clave).toBe("rota");
  });

  it("entre dos con creadaEn ilegible conserva el orden en que llegaron", () => {
    const a = carga({ clave: "a", creadaEn: "x" });
    const b = carga({ clave: "b", creadaEn: "y" });
    expect(proximaAMandar([a, b], "ana", AHORA)?.clave).toBe("a");
    expect(proximaAMandar([b, a], "ana", AHORA)?.clave).toBe("b");
  });
});

describe("esperandoDesdeAyer", () => {
  it("devuelve las que llevan más de 24 horas esperando", () => {
    const vieja = carga({ clave: "vieja", creadaEn: haceMinutos(24 * 60 + 1) });
    const reciente = carga({ clave: "reciente", creadaEn: haceMinutos(23 * 60) });
    const resultado = esperandoDesdeAyer([vieja, reciente], AHORA);
    expect(resultado.map((c) => c.clave)).toEqual(["vieja"]);
  });

  it("ignora una carga con fecha futura: el reloj del teléfono puede estar mal", () => {
    // 48 horas y no 24: con un valor absoluto de la diferencia, −24 h también daría "más de 24".
    const futura = carga({ creadaEn: haceMinutos(-48 * 60) });
    expect(esperandoDesdeAyer([futura], AHORA)).toEqual([]);
  });

  it("ignora una carga con fecha ilegible: no se puede afirmar que lleve esperando nada", () => {
    const rota = carga({ creadaEn: "no es una fecha" });
    expect(esperandoDesdeAyer([rota], AHORA)).toEqual([]);
  });

  it("no incluye las paradas: esas las devuelve paradas()", () => {
    const parada = carga({ estado: "parada", creadaEn: haceMinutos(48 * 60) });
    expect(esperandoDesdeAyer([parada], AHORA)).toEqual([]);
  });
});

describe("paradas", () => {
  it("devuelve las que están paradas, sin importar cuánto llevan", () => {
    const reciente = carga({ clave: "reciente", estado: "parada", creadaEn: haceMinutos(2) });
    const vieja = carga({ clave: "vieja", estado: "parada", creadaEn: haceMinutos(72 * 60) });
    const esperando = carga({ clave: "esperando" });
    expect(paradas([esperando, reciente, vieja]).map((c) => c.clave)).toEqual(["reciente", "vieja"]);
  });

  it("sin paradas devuelve una lista vacía", () => {
    expect(paradas([carga(), carga({ clave: "otra" })])).toEqual([]);
    expect(paradas([])).toEqual([]);
  });
});

describe("esperaAntesDeReintentar", () => {
  it("el primer reintento es casi inmediato: medio minuto", () => {
    expect(esperaAntesDeReintentar(0)).toBe(0.5);
    expect(esperaAntesDeReintentar(1)).toBe(0.5);
  });

  it("la espera se duplica con los intentos", () => {
    expect(esperaAntesDeReintentar(2)).toBe(1);
    expect(esperaAntesDeReintentar(3)).toBe(2);
    expect(esperaAntesDeReintentar(6)).toBe(16);
  });

  it("tiene techo: 50 intentos no dan días", () => {
    expect(esperaAntesDeReintentar(50)).toBe(60);
    expect(esperaAntesDeReintentar(500)).toBe(60);
  });

  it("un número de intentos infinito da el techo, no el primer reintento", () => {
    expect(esperaAntesDeReintentar(Infinity)).toBe(60);
  });

  it("un dato raro no da una espera rara", () => {
    expect(esperaAntesDeReintentar(-3)).toBe(0.5);
    expect(esperaAntesDeReintentar(-Infinity)).toBe(0.5);
    expect(esperaAntesDeReintentar(Number.NaN)).toBe(0.5);
  });
});

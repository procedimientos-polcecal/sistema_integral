import { describe, it, expect } from "vitest";
import {
  clasificarFallo,
  puedeMandarse,
  proximaAMandar,
  esperandoDesdeAyer,
  esperaAntesDeReintentar,
  MINUTOS_PARA_SOLTAR,
} from "./colaOffline.js";

const AHORA = new Date("2026-10-18T12:00:00.000Z");

/** Minutos antes de AHORA, como texto ISO. */
function haceMinutos(minutos) {
  return new Date(AHORA.getTime() - minutos * 60_000).toISOString();
}

/** @returns {import("./colaOffline.js").CargaEnCola} */
function carga(cambios = {}) {
  return {
    clave: "clave-1",
    tipo: "aviso",
    cuerpo: {},
    usuarioId: "ana",
    creadaEn: haceMinutos(30),
    tomadaEn: null,
    intentos: 0,
    ultimoError: null,
    estado: "esperando",
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

  it("sin sesión conocida no se manda nada", () => {
    expect(puedeMandarse(carga(), null, AHORA)).toBe(false);
  });

  it("una marca de toma en el futuro no traba la carga para siempre", () => {
    const tomada = carga({ tomadaEn: haceMinutos(-600) });
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
});

describe("esperandoDesdeAyer", () => {
  it("devuelve las que llevan más de 24 horas esperando", () => {
    const vieja = carga({ clave: "vieja", creadaEn: haceMinutos(24 * 60 + 1) });
    const reciente = carga({ clave: "reciente", creadaEn: haceMinutos(23 * 60) });
    const resultado = esperandoDesdeAyer([vieja, reciente], AHORA);
    expect(resultado.map((c) => c.clave)).toEqual(["vieja"]);
  });

  it("ignora una carga con fecha futura: el reloj del teléfono puede estar mal", () => {
    const futura = carga({ creadaEn: haceMinutos(-24 * 60) });
    expect(esperandoDesdeAyer([futura], AHORA)).toEqual([]);
  });

  it("ignora una carga parada: ya no está esperando, está frenada", () => {
    const parada = carga({ estado: "parada", creadaEn: haceMinutos(48 * 60) });
    expect(esperandoDesdeAyer([parada], AHORA)).toEqual([]);
  });
});

describe("esperaAntesDeReintentar", () => {
  it("el primer reintento es casi inmediato", () => {
    expect(esperaAntesDeReintentar(0)).toBeLessThanOrEqual(1);
    expect(esperaAntesDeReintentar(1)).toBeLessThanOrEqual(1);
  });

  it("la espera crece con los intentos y tiene techo", () => {
    expect(esperaAntesDeReintentar(3)).toBeGreaterThan(esperaAntesDeReintentar(1));
    expect(esperaAntesDeReintentar(6)).toBeGreaterThan(esperaAntesDeReintentar(3));
    // 50 intentos no pueden dar días de espera.
    expect(esperaAntesDeReintentar(50)).toBeLessThanOrEqual(60);
    expect(esperaAntesDeReintentar(50)).toBe(esperaAntesDeReintentar(500));
  });

  it("un dato raro no da una espera rara", () => {
    expect(esperaAntesDeReintentar(-3)).toBeLessThanOrEqual(1);
    expect(esperaAntesDeReintentar(Number.NaN)).toBeLessThanOrEqual(1);
  });
});

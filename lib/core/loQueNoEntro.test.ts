import { describe, it, expect } from "vitest";
import type { CargaEnCola } from "@/public/cola/colaOffline.js";
import { loQueNoEntro } from "./loQueNoEntro";

const AHORA = new Date("2026-10-19T12:00:00.000Z");

/** Horas antes de AHORA, como texto ISO. */
function haceHoras(horas: number): string {
  return new Date(AHORA.getTime() - horas * 3_600_000).toISOString();
}

function carga(cambios: Partial<CargaEnCola> = {}): CargaEnCola {
  return {
    clave: "clave-1",
    tipo: "aviso",
    cuerpo: {},
    usuarioId: "ana",
    creadaEn: haceHoras(30),
    tomadaEn: null,
    intentos: 0,
    ultimoError: null,
    estado: "esperando",
    ...cambios,
  };
}

describe("loQueNoEntro", () => {
  it("sin cargas no hay nada que decir", () => {
    expect(loQueNoEntro([], AHORA)).toBeNull();
  });

  /*
   * La que se cargó hace un rato no es noticia: todavía está dentro de lo que
   * el diseño considera normal, y una barra que aparece por eso deja de
   * significar algo.
   */
  it("una carga de hace dos horas no dibuja nada", () => {
    expect(loQueNoEntro([carga({ creadaEn: haceHoras(2) })], AHORA)).toBeNull();
  });

  it("una que lleva más de un día esperando se cuenta como demorada", () => {
    expect(loQueNoEntro([carga()], AHORA)).toEqual({
      demoradas: 1,
      detenidas: 0,
      laMasVieja: haceHoras(30),
    });
  });

  /*
   * Una `parada` entra **sin importar hace cuánto es**: no sale sola, así que
   * esperar un día para contarla sería un día de silencio sobre lo único que
   * necesita a una persona.
   */
  it("una parada de recién se cuenta igual", () => {
    expect(loQueNoEntro([carga({ estado: "parada", creadaEn: haceHoras(1) })], AHORA)).toEqual({
      demoradas: 0,
      detenidas: 1,
      laMasVieja: haceHoras(1),
    });
  });

  /*
   * El motivo entero de que sean dos campos: la frase de cada una dice cosas
   * distintas, y una suma no permitiría escribirlas.
   */
  it("las dos clases se cuentan por separado y ninguna carga entra en las dos", () => {
    const cargas = [
      carga({ clave: "a", creadaEn: haceHoras(50) }),
      carga({ clave: "b", creadaEn: haceHoras(30) }),
      carga({ clave: "c", estado: "parada", creadaEn: haceHoras(3) }),
    ];
    expect(loQueNoEntro(cargas, AHORA)).toEqual({
      demoradas: 2,
      detenidas: 1,
      laMasVieja: haceHoras(50),
    });
  });

  /*
   * La más vieja sale del conjunto de las dos listas y no de una sola: si la
   * más vieja fuera una parada, decir el «desde cuándo» de la demorada sería
   * quedarse corto justo con la que más urge.
   */
  it("la más vieja puede ser una parada", () => {
    const cargas = [
      carga({ clave: "a", creadaEn: haceHoras(26) }),
      carga({ clave: "b", estado: "parada", creadaEn: haceHoras(200) }),
    ];
    expect(loQueNoEntro(cargas, AHORA)?.laMasVieja).toBe(haceHoras(200));
  });

  /*
   * El reloj del teléfono se puede corregir hacia atrás, y entonces hay fechas
   * que no se entienden. Contar la carga sigue siendo cierto; afirmar desde
   * cuándo, no.
   */
  it("una parada con fecha ilegible se cuenta, pero no se dice desde cuándo", () => {
    expect(loQueNoEntro([carga({ estado: "parada", creadaEn: "cualquier cosa" })], AHORA)).toEqual({
      demoradas: 0,
      detenidas: 1,
      laMasVieja: null,
    });
  });

  it("una fecha ilegible no le gana a una que sí se entiende", () => {
    const cargas = [
      carga({ clave: "a", estado: "parada", creadaEn: "cualquier cosa" }),
      carga({ clave: "b", estado: "parada", creadaEn: haceHoras(5) }),
    ];
    expect(loQueNoEntro(cargas, AHORA)?.laMasVieja).toBe(haceHoras(5));
  });

  /*
   * `esperandoDesdeAyer` ya deja afuera las del futuro, y acá se comprueba que
   * la barra hereda eso: un reloj adelantado no puede inventar una demora.
   */
  it("una carga con fecha futura no es una demora", () => {
    expect(loQueNoEntro([carga({ creadaEn: haceHoras(-5) })], AHORA)).toBeNull();
  });
});

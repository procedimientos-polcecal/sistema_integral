import { describe, it, expect } from "vitest";
import {
  armarCodigo,
  parsearCodigo,
  proximoCorrelativo,
  anioParaCodigo,
} from "./codigos";

const YAC = ["D1", "D6", "C1", "C3", "A"];
const AHORA = new Date("2026-09-10T12:00:00Z");

describe("armarCodigo", () => {
  it("arma V01D625 y B03C126 con el relleno de dos dígitos", () => {
    expect(armarCodigo("V", "D6", 1, 2025)).toBe("V01D625");
    expect(armarCodigo("B", "C1", 3, 2026)).toBe("B03C126");
    expect(armarCodigo("V", "A", 1, 2026)).toBe("V01A26");
  });

  it("no recorta un correlativo de tres dígitos", () => {
    expect(armarCodigo("V", "D6", 115, 2026)).toBe("V115D626");
  });
});

describe("parsearCodigo", () => {
  it("desarma un código con yacimiento de dos caracteres", () => {
    expect(parsearCodigo("V01D625", YAC, AHORA)).toEqual({
      tipo: "V",
      correlativo: 1,
      yacimiento: "D6",
      anio: 2025,
    });
  });

  it("desarma Alcancía, que es un solo carácter", () => {
    expect(parsearCodigo("V01A26", YAC, AHORA)).toEqual({
      tipo: "V",
      correlativo: 1,
      yacimiento: "A",
      anio: 2026,
    });
  });

  it("desarma un bochón y un correlativo de dos dígitos", () => {
    expect(parsearCodigo("B15C326", YAC, AHORA)).toEqual({
      tipo: "B",
      correlativo: 15,
      yacimiento: "C3",
      anio: 2026,
    });
  });

  it("elige el código de yacimiento más largo que matchee", () => {
    // "C3" y no "3": sin ordenar por longitud, "13" podría partirse mal.
    expect(parsearCodigo("V13C326", YAC, AHORA)?.correlativo).toBe(13);
    expect(parsearCodigo("V13C326", YAC, AHORA)?.yacimiento).toBe("C3");
  });

  it("devuelve null si el yacimiento no está en la lista", () => {
    expect(parsearCodigo("V01X926", YAC, AHORA)).toBeNull();
  });

  it("devuelve null si el código está mal formado", () => {
    expect(parsearCodigo("D625", YAC, AHORA)).toBeNull();
    expect(parsearCodigo("", YAC, AHORA)).toBeNull();
  });
});

describe("proximoCorrelativo", () => {
  it("empieza en 1 cuando no hay ninguno", () => {
    expect(proximoCorrelativo([])).toBe(1);
  });

  it("es el máximo + 1, sin rellenar huecos", () => {
    expect(proximoCorrelativo([1, 2, 4, 5])).toBe(6);
  });
});

describe("anioParaCodigo", () => {
  it("toma el año de la fecha de voladura si está", () => {
    expect(anioParaCodigo("2027-01-04", AHORA)).toBe(2027);
  });

  it("usa el año en curso si la fecha de voladura falta", () => {
    expect(anioParaCodigo(null, AHORA)).toBe(2026);
    expect(anioParaCodigo("", AHORA)).toBe(2026);
  });
});

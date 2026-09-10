import { describe, it, expect } from "vitest";
import {
  parsearTramos,
  formatearTramos,
  totalPozos,
  totalMetros,
  metrosYPozos,
} from "./tramos";

describe("parsearTramos", () => {
  it("entiende el formato que usa cantera", () => {
    expect(parsearTramos("14*3 / 3*3,5 / 6*4")).toEqual([
      { pozos: 14, metros: 3 },
      { pozos: 3, metros: 3.5 },
      { pozos: 6, metros: 4 },
    ]);
  });

  it("acepta x y × como separador, y un solo tramo", () => {
    expect(parsearTramos("36 x 3")).toEqual([{ pozos: 36, metros: 3 }]);
    expect(parsearTramos("22×5,2")).toEqual([{ pozos: 22, metros: 5.2 }]);
  });

  it("es null si algo no cierra", () => {
    expect(parsearTramos("14*3 / 3")).toBeNull();
    expect(parsearTramos("pozos por acá")).toBeNull();
    expect(parsearTramos("0*3")).toBeNull();
    expect(parsearTramos("")).toBeNull();
  });
});

describe("totales", () => {
  const t = [
    { pozos: 14, metros: 3 },
    { pozos: 3, metros: 3.5 },
    { pozos: 6, metros: 4 },
  ];
  it("suma los pozos", () => expect(totalPozos(t)).toBe(23));
  it("metros perforados es Σ pozos·metros", () => expect(totalMetros(t)).toBe(42 + 10.5 + 24));
});

describe("formatearTramos", () => {
  it("es la vuelta de parsear", () => {
    expect(formatearTramos([{ pozos: 14, metros: 3 }, { pozos: 3, metros: 3.5 }])).toBe("14*3 / 3*3,5");
  });
});

describe("metrosYPozos", () => {
  it("usa los tramos cuando hay", () => {
    expect(metrosYPozos([{ pozos: 14, metros: 3 }, { pozos: 6, metros: 4 }], 99, 99)).toEqual({
      pozos: 20,
      metros: 66,
    });
  });
  it("cae en los escalares cuando no hay tramos", () => {
    expect(metrosYPozos(null, 36, 3)).toEqual({ pozos: 36, metros: 108 });
  });
  it("metros es null si falta un escalar", () => {
    expect(metrosYPozos(null, 36, null)).toEqual({ pozos: 36, metros: null });
  });
});

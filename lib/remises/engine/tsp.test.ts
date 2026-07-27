import { describe, it, expect } from "vitest";
import { vecinoMasCercano, vecinoMasCercanoMatriz } from "./tsp";

describe("vecinoMasCercano", () => {
  it("devuelve todos los puntos, sin repetir ni perder ninguno", () => {
    const inicio = { lat: 0, lng: 0 };
    const puntos = [
      { id: "a", lat: 3, lng: 0 },
      { id: "b", lat: 1, lng: 0 },
      { id: "c", lat: 2, lng: 0 },
    ];
    const ruta = vecinoMasCercano(inicio, puntos);
    expect(ruta.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("visita en orden de cercanía creciente cuando los puntos están alineados", () => {
    const inicio = { lat: 0, lng: 0 };
    const puntos = [
      { id: "lejos", lat: 3, lng: 0 },
      { id: "cerca", lat: 1, lng: 0 },
      { id: "medio", lat: 2, lng: 0 },
    ];
    const ruta = vecinoMasCercano(inicio, puntos);
    expect(ruta.map((p) => p.id)).toEqual(["cerca", "medio", "lejos"]);
  });

  it("array vacío devuelve array vacío", () => {
    expect(vecinoMasCercano({ lat: 0, lng: 0 }, [])).toEqual([]);
  });
});

describe("vecinoMasCercanoMatriz", () => {
  it("visita en orden de menor duración desde el punto de partida", () => {
    // índice 0 = fábrica, 1/2/3 = empleados
    const matriz = [
      [0, 300, 100, 200],
      [300, 0, 250, 150],
      [100, 250, 0, 120],
      [200, 150, 120, 0],
    ];
    const ordenados = vecinoMasCercanoMatriz(0, [1, 2, 3], matriz);
    // desde 0: el más cercano es 2 (100), desde 2: el más cercano de los restantes es 3 (120), queda 1
    expect(ordenados).toEqual([2, 3, 1]);
  });

  it("devuelve todos los índices pedidos exactamente una vez", () => {
    const matriz = [
      [0, 5, 5, 5, 5],
      [5, 0, 1, 2, 3],
      [5, 1, 0, 4, 2],
      [5, 2, 4, 0, 1],
      [5, 3, 2, 1, 0],
    ];
    const ordenados = vecinoMasCercanoMatriz(0, [1, 2, 3, 4], matriz);
    expect(ordenados.slice().sort()).toEqual([1, 2, 3, 4]);
  });
});

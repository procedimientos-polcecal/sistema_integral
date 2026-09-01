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

/**
 * OSRM devuelve `null` para un punto al que no puede llegar manejando —una
 * direccion mal geocodificada, del otro lado de un rio sin puente—. En JS
 * `null < Infinity` es true porque el null se convierte en 0, asi que ese punto
 * ganaba la comparacion siempre y quedaba de primera parada.
 */
describe("vecinoMasCercanoMatriz con huecos en la matriz", () => {
  it("un null no gana la comparacion por valer cero", () => {
    // Desde la fabrica (0): al 1 hay 500s, al 2 no se puede llegar (null).
    const m = [
      [0, 500, null],
      [500, 0, null],
      [null, null, 0],
    ] as unknown as number[][];

    const orden = vecinoMasCercanoMatriz(0, [1, 2], m);
    expect(orden[0]).toBe(1);          // el alcanzable primero
    expect(orden).toHaveLength(2);     // y el otro no se pierde
    expect(orden).toContain(2);
  });

  it("con todo null no revienta y devuelve todos una sola vez", () => {
    const m = [
      [0, null, null],
      [null, 0, null],
      [null, null, 0],
    ] as unknown as number[][];

    const orden = vecinoMasCercanoMatriz(0, [1, 2], m);
    expect(orden).toHaveLength(2);
    expect(new Set(orden).size).toBe(2);
  });

  it("una fila que no existe tampoco lo tira abajo", () => {
    const m = [[0, 100]] as number[][];
    const orden = vecinoMasCercanoMatriz(0, [1], m);
    expect(orden).toEqual([1]);
  });
});

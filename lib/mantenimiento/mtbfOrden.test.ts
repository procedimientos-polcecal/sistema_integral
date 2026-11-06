import { describe, it, expect } from "vitest";
import { ordenar, siguienteOrden, valorDe, type Orden } from "./mtbfOrden";
import type { FilaDeVista } from "./mtbfVista";

const fila = (p: Partial<FilaDeVista> & { id: string }): FilaDeVista => ({
  equipmentId: p.id,
  fallas: 3,
  mtbf: 100,
  confiabilidades: [0.9, 0.7],
  ultima: "2026-10-01",
  porEspecialidad: [],
  porMes: [],
  ritmo: null,
  equipo: {
    id: p.id,
    code: p.id.toUpperCase(),
    name: "Molino " + p.id,
    sectorId: "s1",
    sectorNombre: "Filler 1",
  },
  ...p,
});

const ids = (filas: FilaDeVista[]) => filas.map((f) => f.equipmentId);
const asc = (columna: Orden["columna"]): Orden => ({ columna, ascendente: true });
const desc = (columna: Orden["columna"]): Orden => ({ columna, ascendente: false });

describe("el valor de cada columna", () => {
  const f = fila({ id: "a", mtbf: 4.6, fallas: 70, ultima: "2026-10-01", confiabilidades: [0.22, 0.001] });

  it("saca el nombre y el sector del equipo resuelto", () => {
    expect(valorDe(f, "equipo")).toBe("Molino a");
    expect(valorDe(f, "sector")).toBe("Filler 1");
  });

  it("las columnas rN son las confiabilidades, en orden", () => {
    expect(valorDe(f, "r0")).toBe(0.22);
    expect(valorDe(f, "r1")).toBe(0.001);
  });

  it("sin MTBF no hay valor que ordenar", () => {
    const sinNumero = fila({ id: "b", mtbf: null, confiabilidades: [null, null] });
    expect(valorDe(sinNumero, "mtbf")).toBeNull();
    expect(valorDe(sinNumero, "r0")).toBeNull();
  });
});

describe("el orden del listado", () => {
  it("ordena por mtbf ascendente: el que menos aguanta primero", () => {
    const filas = [fila({ id: "a", mtbf: 20 }), fila({ id: "b", mtbf: 4.6 }), fila({ id: "c", mtbf: 12 })];
    expect(ids(ordenar(filas, asc("mtbf")))).toEqual(["b", "c", "a"]);
  });

  it("al invertir, da vuelta los que tienen numero", () => {
    const filas = [fila({ id: "a", mtbf: 20 }), fila({ id: "b", mtbf: 4.6 })];
    expect(ids(ordenar(filas, desc("mtbf")))).toEqual(["a", "b"]);
  });

  /**
   * La regla que no se ve y más engaña si se rompe: un equipo sin MTBF
   * publicable no es el mejor ni el peor, es uno del que no se sabe. Si viajara
   * con los números, al invertir la flecha quedaría primero y se leería como la
   * máquina que falla más seguido de la planta.
   */
  it("los nulos van al final en los dos sentidos", () => {
    const filas = [
      fila({ id: "sin", mtbf: null, confiabilidades: [null, null] }),
      fila({ id: "a", mtbf: 20, confiabilidades: [0.7, 0.22] }),
      fila({ id: "b", mtbf: 4.6, confiabilidades: [0.22, 0.001] }),
    ];
    expect(ids(ordenar(filas, asc("mtbf")))).toEqual(["b", "a", "sin"]);
    expect(ids(ordenar(filas, desc("mtbf")))).toEqual(["a", "b", "sin"]);
    expect(ids(ordenar(filas, asc("r0")))).toEqual(["b", "a", "sin"]);
    expect(ids(ordenar(filas, desc("r0")))).toEqual(["a", "b", "sin"]);
  });

  it("entre dos nulos manda el que mas fallo", () => {
    const filas = [
      fila({ id: "poco", mtbf: null, fallas: 2 }),
      fila({ id: "mucho", mtbf: null, fallas: 9 }),
    ];
    expect(ids(ordenar(filas, asc("mtbf")))).toEqual(["mucho", "poco"]);
  });

  /** Dos equipos con el mismo MTBF no están igual: el de 40 fallas importa más. */
  it("desempata por cantidad de fallas, y el desempate no se invierte", () => {
    const filas = [
      fila({ id: "pocas", mtbf: 10, fallas: 2 }),
      fila({ id: "muchas", mtbf: 10, fallas: 40 }),
    ];
    expect(ids(ordenar(filas, asc("mtbf")))).toEqual(["muchas", "pocas"]);
    expect(ids(ordenar(filas, desc("mtbf")))).toEqual(["muchas", "pocas"]);
  });

  it("los textos se comparan en castellano, no por codigo de caracter", () => {
    const filas = [
      fila({ id: "z", equipo: { id: "z", code: "Z", name: "Zaranda", sectorId: "s1", sectorNombre: "S" } }),
      fila({ id: "n", equipo: { id: "n", code: "N", name: "Ñandú", sectorId: "s1", sectorNombre: "S" } }),
      fila({ id: "a", equipo: { id: "a", code: "A", name: "Alimentador", sectorId: "s1", sectorNombre: "S" } }),
    ];
    expect(ids(ordenar(filas, asc("equipo")))).toEqual(["a", "n", "z"]);
  });

  it("no toca el arreglo que recibe", () => {
    const filas = [fila({ id: "a", mtbf: 20 }), fila({ id: "b", mtbf: 4.6 })];
    ordenar(filas, asc("mtbf"));
    expect(ids(filas)).toEqual(["a", "b"]);
  });
});

describe("la direccion al tocar un encabezado", () => {
  it("la misma columna da vuelta la flecha", () => {
    expect(siguienteOrden(asc("mtbf"), "mtbf")).toEqual(desc("mtbf"));
    expect(siguienteOrden(desc("mtbf"), "mtbf")).toEqual(asc("mtbf"));
  });

  /** Lo primero que se quiere ver de una columna es su peor valor. */
  it("una columna nueva arranca mostrando el peor valor", () => {
    expect(siguienteOrden(asc("equipo"), "mtbf").ascendente).toBe(true);
    expect(siguienteOrden(asc("equipo"), "r1").ascendente).toBe(true);
    expect(siguienteOrden(asc("equipo"), "fallas").ascendente).toBe(false);
    expect(siguienteOrden(asc("equipo"), "ultima").ascendente).toBe(false);
  });

  it("las columnas de texto arrancan alfabeticas", () => {
    expect(siguienteOrden(asc("mtbf"), "equipo").ascendente).toBe(true);
    expect(siguienteOrden(asc("mtbf"), "sector").ascendente).toBe(true);
  });
});

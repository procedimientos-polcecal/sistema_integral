import { describe, it, expect } from "vitest";
import { ordenarAvisos, type OrdenDeAvisos } from "./ordenDeAvisos";

type Fila = { oa_number: string | null; fecha: string | null };
const filas = (...oa: (string | null)[]): Fila[] => oa.map((n) => ({ oa_number: n, fecha: null }));
const numeros = (f: Fila[]) => f.map((x) => x.oa_number);

describe("ordenarAvisos", () => {
  it("por número NO ordena como texto: A99 va antes que A254", () => {
    // Es la trampa medida el 19/11/2026 contra los 254 avisos reales: como
    // texto, el orden es A1, A10, A100 … A95, A96, A97, A98, A99, o sea que
    // el aviso más nuevo queda en el medio de la lista.
    const dadas = filas("A1", "A10", "A100", "A254", "A99", "A2");
    expect(numeros(ordenarAvisos(dadas, "numero-asc"))).toEqual([
      "A1", "A2", "A10", "A99", "A100", "A254",
    ]);
  });

  it("y al revés, del más alto al más bajo", () => {
    const dadas = filas("A1", "A254", "A99", "A100");
    expect(numeros(ordenarAvisos(dadas, "numero-desc"))).toEqual([
      "A254", "A100", "A99", "A1",
    ]);
  });

  it("lo que no tiene número queda al final en las DOS direcciones", () => {
    // Si fueran "los más chicos", al dar vuelta el orden saltarían todos
    // arriba y taparían la lista. No tener número no es ser el primero.
    const dadas = filas("A2", null, "A1", "", "sin numero");
    expect(numeros(ordenarAvisos(dadas, "numero-asc")).slice(0, 2)).toEqual(["A1", "A2"]);
    expect(numeros(ordenarAvisos(dadas, "numero-desc")).slice(0, 2)).toEqual(["A2", "A1"]);
    for (const o of ["numero-asc", "numero-desc"] as OrdenDeAvisos[]) {
      expect(numeros(ordenarAvisos(dadas, o)).slice(2)).toEqual([null, "", "sin numero"]);
    }
  });

  it("agrupa por el prefijo antes que por el número", () => {
    const dadas = filas("B1", "A2", "A10", "B2");
    expect(numeros(ordenarAvisos(dadas, "numero-asc"))).toEqual(["A2", "A10", "B1", "B2"]);
  });

  it("dos avisos con el mismo N° conservan el orden en que venían", () => {
    // La planilla puede traer dos filas con el mismo número —el sync lo avisa—
    // y entonces el desempate es el orden que ya tenían, que es por fecha.
    const dadas: Fila[] = [
      { oa_number: "A7", fecha: "2026-11-02" },
      { oa_number: "A7", fecha: "2026-11-01" },
    ];
    expect(ordenarAvisos(dadas, "numero-asc").map((f) => f.fecha)).toEqual([
      "2026-11-02", "2026-11-01",
    ]);
  });

  it("por fecha, los más nuevos primero y los sin fecha al final", () => {
    const dadas: Fila[] = [
      { oa_number: "A1", fecha: "2026-11-01" },
      { oa_number: "A2", fecha: null },
      { oa_number: "A3", fecha: "2026-11-17" },
    ];
    expect(numeros(ordenarAvisos(dadas, "fecha"))).toEqual(["A3", "A1", "A2"]);
  });

  it("no toca el arreglo que recibe", () => {
    // Llega como prop desde el servidor: ordenarlo en el lugar es cambiarle
    // los datos a quien lo pasó.
    const dadas = filas("A10", "A1");
    const copia = [...dadas];
    ordenarAvisos(dadas, "numero-asc");
    expect(dadas).toEqual(copia);
  });

  it("un número larguísimo no se rompe ni pierde precisión", () => {
    const dadas = filas("A9007199254740993", "A9007199254740992");
    expect(numeros(ordenarAvisos(dadas, "numero-asc"))).toEqual([
      "A9007199254740992", "A9007199254740993",
    ]);
  });
});

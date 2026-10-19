/**
 * El orden del desplegable de sectores.
 *
 * Los 16 de acá son los que tiene la base al 19/10/2026, con sus códigos
 * reales. La lista esperada es la del formulario de OT, que es la que pidió
 * quien carga: de la cantera al taller, siguiendo el material.
 */
import { describe, it, expect } from "vitest";
import { enOrdenDePlanta, claveDeOrden } from "@/lib/mantenimiento/sectores";

/** Los de planta, tal como vienen de la base ordenados por código. */
const DE_LA_BASE = [
  { codigo: "AMB-C1", nombre: "Compresores" },
  { codigo: "AMB-EM", nombre: "Equipos móviles" },
  { codigo: "PO-A1", nombre: "Planta de trituración 1" },
  { codigo: "PO-A2", nombre: "Planta de trituración 2" },
  { codigo: "PO-A3", nombre: "Planta de trituración 3" },
  { codigo: "PO-B1", nombre: "Calcinación" },
  { codigo: "PO-C1", nombre: "Hidratación" },
  { codigo: "PO-D1", nombre: "Molienda de cal" },
  { codigo: "PO-D2", nombre: "Despacho cal" },
  { codigo: "PY-A1", nombre: "Planta filler 1" },
  { codigo: "PY-B1", nombre: "Planta filler 2" },
  { codigo: "PY-C1", nombre: "Planta 0-2 mm" },
  { codigo: "PY-D1", nombre: "Planta filler 3" },
  { codigo: null, nombre: "Taller" },
  { codigo: null, nombre: "Servicios auxiliares" },
  { codigo: null, nombre: "Cantera" },
];

describe("enOrdenDePlanta", () => {
  it("deja el desplegable como la lista del formulario", () => {
    expect(enOrdenDePlanta(DE_LA_BASE).map((s) => s.nombre)).toEqual([
      "Cantera",
      "Planta de trituración 1",
      "Planta de trituración 2",
      "Planta de trituración 3",
      "Calcinación",
      "Hidratación",
      "Molienda de cal",
      // No está en el formulario; va con su proceso, detrás de la molienda.
      "Despacho cal",
      "Planta filler 1",
      "Planta filler 2",
      "Planta filler 3",
      "Planta 0-2 mm",
      "Compresores",
      "Equipos móviles",
      "Servicios auxiliares",
      "Taller",
    ]);
  });

  it("Cantera primero y no última, que es lo que hacía el orden por código", () => {
    // Sin código, ordenando por código caía al final: es la primera del
    // proceso y aparecía después de los compresores.
    expect(enOrdenDePlanta(DE_LA_BASE)[0].nombre).toBe("Cantera");
  });

  it("el filler 3 va antes que la planta de 0-2 mm, aunque su código sea mayor", () => {
    // PY-D1 antes que PY-C1. Es la razón por la que esto no puede ser un
    // `order by codigo`.
    const nombres = enOrdenDePlanta(DE_LA_BASE).map((s) => s.nombre);
    expect(nombres.indexOf("Planta filler 3")).toBeLessThan(nombres.indexOf("Planta 0-2 mm"));
  });

  it("ordena por código y no por nombre, para que un renombre no lo desarme", () => {
    // Los ocho nombres se cambiaron enteros el 19/10/2026. Si el orden
    // colgara de ellos, se habría desarmado solo ese día.
    const conOtrosNombres = DE_LA_BASE.map((s) =>
      s.codigo ? { ...s, nombre: `${s.nombre} (renombrado)` } : s
    );
    expect(enOrdenDePlanta(conOtrosNombres).map((s) => s.codigo)).toEqual(
      enOrdenDePlanta(DE_LA_BASE).map((s) => s.codigo)
    );
  });

  it("un sector nuevo va al final, no en el medio", () => {
    // Al final se ve; colarse en el medio no. Quien lo agregue decide dónde va.
    const conUnoNuevo = [...DE_LA_BASE, { codigo: "PO-E1", nombre: "Planta nueva" }];
    expect(enOrdenDePlanta(conUnoNuevo).at(-1)?.nombre).toBe("Planta nueva");
  });

  it("dos desconocidos quedan siempre en el mismo orden entre sí", () => {
    const conDos = [
      ...DE_LA_BASE,
      { codigo: "ZZ-2", nombre: "Otra" },
      { codigo: "ZZ-1", nombre: "Una" },
    ];
    expect(enOrdenDePlanta(conDos).slice(-2).map((s) => s.codigo)).toEqual(["ZZ-1", "ZZ-2"]);
  });

  it("no toca el arreglo que recibe", () => {
    const original = [...DE_LA_BASE];
    enOrdenDePlanta(DE_LA_BASE);
    expect(DE_LA_BASE).toEqual(original);
  });

  it("aguanta una lista vacía y una de uno", () => {
    expect(enOrdenDePlanta([])).toEqual([]);
    expect(enOrdenDePlanta([{ codigo: null, nombre: "Taller" }])).toHaveLength(1);
  });
});

describe("claveDeOrden", () => {
  it("es el código cuando lo hay", () => {
    expect(claveDeOrden({ nombre: "Calcinación", codigo: "PO-B1" })).toBe("PO-B1");
  });

  it("y el nombre en mayúsculas cuando no", () => {
    // Los tres sin código —Cantera, Servicios auxiliares y Taller— dependen
    // del nombre, y eso es lo frágil que queda: renombrarlos los manda al
    // final sin avisar. Queda fijado acá para que se note en el test y no en
    // el desplegable.
    expect(claveDeOrden({ nombre: "Servicios auxiliares", codigo: null })).toBe("SERVICIOS AUXILIARES");
    expect(claveDeOrden({ nombre: "  Taller  " })).toBe("TALLER");
  });
});

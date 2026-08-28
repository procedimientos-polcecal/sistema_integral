import { describe, it, expect } from "vitest";
import {
  ubicacionesDelEquipo,
  ubicacionesDelSector,
  opcionesConUbicacion,
  type UbicacionEnlazada,
} from "./ubicaciones";

/** Un recorte del catálogo real, con sus casos incómodos. */
const catalogo: UbicacionEnlazada[] = [
  { id: "u-xcmg",     nombre: "Autoelevador XCMG",       equipo_id: "EM12", sector_id: null },
  { id: "u-hcmg",     nombre: "Autoelevador HCMG",       equipo_id: "EM12", sector_id: null },
  { id: "u-doosan1",  nombre: "Doosan 225 n°1",          equipo_id: "EM3",  sector_id: null },
  { id: "u-pfiller2", nombre: "Planta Filler 2",         equipo_id: null,   sector_id: "PY-B1" },
  { id: "u-mfiller2", nombre: "Molienda filler 2",       equipo_id: null,   sector_id: "PY-B1" },
  { id: "u-calcin",   nombre: "Calcinación",             equipo_id: null,   sector_id: "PO-B1" },
  { id: "u-panol",    nombre: "Pañol",                   equipo_id: null,   sector_id: null },
];

describe("filtrar por maquina", () => {
  /** El tipeo `HCMG` que arrastra la planilla apunta al mismo equipo. */
  it("junta las dos ubicaciones que nombran a la misma maquina", () => {
    expect(ubicacionesDelEquipo(catalogo, "EM12").sort()).toEqual(["u-hcmg", "u-xcmg"]);
  });

  it("una maquina sin ubicacion enlazada no devuelve ninguna", () => {
    expect(ubicacionesDelEquipo(catalogo, "EM99")).toEqual([]);
  });
});

describe("filtrar por sector de planta", () => {
  /**
   * Dos ubicaciones distintas caen en el mismo sector —la planta y su
   * molienda—: el gasto se agrega, no se elige una.
   */
  it("junta las ubicaciones que caen en el mismo sector", () => {
    expect(ubicacionesDelSector(catalogo, "PY-B1").sort()).toEqual([
      "u-mfiller2",
      "u-pfiller2",
    ]);
  });

  it("suma las maquinas que viven en ese sector", () => {
    const sectorDeCadaEquipo = new Map([["EM3", "AMB-EM"], ["EM12", "PY-B1"]]);
    expect(ubicacionesDelSector(catalogo, "PY-B1", sectorDeCadaEquipo).sort()).toEqual([
      "u-hcmg",
      "u-mfiller2",
      "u-pfiller2",
      "u-xcmg",
    ]);
  });

  it("las que no son una maquina ni un sector no entran en ningun filtro", () => {
    const todas = [
      ...ubicacionesDelSector(catalogo, "PY-B1"),
      ...ubicacionesDelSector(catalogo, "PO-B1"),
      ...ubicacionesDelEquipo(catalogo, "EM12"),
      ...ubicacionesDelEquipo(catalogo, "EM3"),
    ];
    expect(todas).not.toContain("u-panol");
  });
});

/**
 * Ofrecer las 239 maquinas cuando 15 pueden devolver algo es prometer un filtro
 * que da vacio, y quien lo usa concluye que no se le compro nada.
 */
describe("que ofrece el desplegable", () => {
  it("solo los equipos que tienen alguna ubicacion", () => {
    const equipos = [{ id: "EM3" }, { id: "EM12" }, { id: "EM99" }];
    expect(opcionesConUbicacion(equipos, catalogo, "equipo_id")).toEqual([
      { id: "EM3" },
      { id: "EM12" },
    ]);
  });

  it("solo los sectores que tienen alguna ubicacion", () => {
    const sectores = [{ id: "PY-B1" }, { id: "PO-B1" }, { id: "PY-D1" }];
    expect(opcionesConUbicacion(sectores, catalogo, "sector_id")).toEqual([
      { id: "PY-B1" },
      { id: "PO-B1" },
    ]);
  });
});

import { describe, it, expect } from "vitest";
import {
  SIN_ESPECIALIDAD, SIN_FILTROS, pasaElFiltro, type Filtros, type OrdenFiltrable,
} from "./filtrosDelCalendario";

function orden(p: Partial<OrdenFiltrable> = {}): OrdenFiltrable {
  return { especialidad: "MECANICO", tipo: "CORRECTIVO", quien: "TALLER", ...p };
}

function filtros(p: Partial<Filtros> = {}): Filtros {
  return { ...SIN_FILTROS, ...p };
}

describe("pasaElFiltro", () => {
  it("sin filtros deja pasar todo", () => {
    expect(pasaElFiltro(orden(), SIN_FILTROS)).toBe(true);
    expect(pasaElFiltro(orden({ especialidad: null, tipo: null, quien: null }), SIN_FILTROS)).toBe(true);
  });

  it("compara la especialidad sin tilde ni mayúsculas: 'Lubricacion' pasa el filtro 'LUBRICACIÓN'", () => {
    const o = orden({ especialidad: "Lubricacion" });
    expect(pasaElFiltro(o, filtros({ especialidad: "LUBRICACIÓN" }))).toBe(true);
  });

  it("con SIN_ESPECIALIDAD deja pasar sólo las de especialidad vacía o null", () => {
    const f = filtros({ especialidad: SIN_ESPECIALIDAD });
    expect(pasaElFiltro(orden({ especialidad: null }), f)).toBe(true);
    expect(pasaElFiltro(orden({ especialidad: "" }), f)).toBe(true);
    expect(pasaElFiltro(orden({ especialidad: "   " }), f)).toBe(true);
  });

  it("con SIN_ESPECIALIDAD NO deja pasar una que tiene especialidad", () => {
    const f = filtros({ especialidad: SIN_ESPECIALIDAD });
    expect(pasaElFiltro(orden({ especialidad: "MECANICO" }), f)).toBe(false);
  });

  it("filtra por tipo y por quien con la misma normalización", () => {
    expect(pasaElFiltro(orden({ tipo: "Programado" }), filtros({ tipo: "PROGRAMADO" }))).toBe(true);
    expect(pasaElFiltro(orden({ tipo: "Programado" }), filtros({ tipo: "CORRECTIVO" }))).toBe(false);
    expect(pasaElFiltro(orden({ quien: "Contratista" }), filtros({ quien: "CONTRATISTA" }))).toBe(true);
    expect(pasaElFiltro(orden({ quien: "Contratista" }), filtros({ quien: "TALLER" }))).toBe(false);
    // Sin el dato, un filtro puesto la deja afuera: no es "no sé" sino "no es ésa".
    expect(pasaElFiltro(orden({ quien: null }), filtros({ quien: "TALLER" }))).toBe(false);
  });

  it("exige que pasen todos los filtros puestos a la vez", () => {
    const o = orden({ especialidad: "MECANICO", tipo: "CORRECTIVO", quien: "TALLER" });
    expect(pasaElFiltro(o, filtros({ especialidad: "MECANICO", tipo: "CORRECTIVO", quien: "TALLER" }))).toBe(true);
    expect(pasaElFiltro(o, filtros({ especialidad: "MECANICO", tipo: "PROGRAMADO", quien: "TALLER" }))).toBe(false);
    expect(pasaElFiltro(o, filtros({ especialidad: "ELECTRICO", tipo: "CORRECTIVO", quien: "TALLER" }))).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  confiabilidadDeLaFicha,
  equiposSinFallas,
  filasVisibles,
  type EquipoDeLaVista,
} from "./mtbfVista";
import type { FilaMtbf, Mtbf } from "./mtbf";

const eq = (id: string, sectorId: string): EquipoDeLaVista =>
  ({ id, code: id.toUpperCase(), name: "Molino " + id, sectorId, sectorNombre: "S " + sectorId });

const fila = (equipmentId: string, p: Partial<FilaMtbf> = {}): FilaMtbf => ({
  equipmentId, fallas: 3, mtbf: 100, confiabilidades: [0.9, 0.7], ultima: "2026-10-01",
  porEspecialidad: [{ especialidad: "MECÁNICO", cantidad: 3 }], porMes: [], ritmo: null, ...p,
});

const EQUIPOS = [eq("a", "s1"), eq("b", "s1"), eq("c", "s2")];

describe("las filas visibles", () => {
  it("resuelve el equipo de cada fila", () => {
    const r = filasVisibles([fila("a")], EQUIPOS, { sectorId: null, especialidad: null });
    expect(r[0].equipo.code).toBe("A");
  });

  it("deja afuera las filas de equipos que ya no estan", () => {
    expect(filasVisibles([fila("zz")], EQUIPOS, { sectorId: null, especialidad: null })).toEqual([]);
  });

  it("filtra por sector", () => {
    const r = filasVisibles([fila("a"), fila("c")], EQUIPOS, { sectorId: "s2", especialidad: null });
    expect(r.map((f) => f.equipmentId)).toEqual(["c"]);
  });

  /** La trampa del spec: el filtro muestra equipos, no recalcula el numero. */
  it("al filtrar por especialidad el mtbf y la cantidad de fallas no cambian", () => {
    const f = fila("a", {
      fallas: 10, mtbf: 30,
      porEspecialidad: [{ especialidad: "MECÁNICO", cantidad: 9 }, { especialidad: "ELÉCTRICO", cantidad: 1 }],
    });
    const r = filasVisibles([f], EQUIPOS, { sectorId: null, especialidad: "ELÉCTRICO" });
    expect(r).toHaveLength(1);
    expect(r[0].fallas).toBe(10);
    expect(r[0].mtbf).toBe(30);
  });

  it("al filtrar por especialidad deja afuera al que no tuvo ninguna de esa clase", () => {
    const r = filasVisibles([fila("a")], EQUIPOS, { sectorId: null, especialidad: "ELÉCTRICO" });
    expect(r).toEqual([]);
  });
});

describe("los equipos sin fallas", () => {
  it("son los activos que no tienen fila", () => {
    const r = equiposSinFallas([fila("a")], EQUIPOS, { sectorId: null, especialidad: null });
    expect(r.map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("respetan el filtro de sector", () => {
    const r = equiposSinFallas([fila("a")], EQUIPOS, { sectorId: "s1", especialidad: null });
    expect(r.map((e) => e.id)).toEqual(["b"]);
  });

  /** Un equipo que nunca fallo no tuvo fallas de ninguna especialidad. */
  it("desaparecen cuando se filtra por especialidad", () => {
    expect(equiposSinFallas([fila("a")], EQUIPOS, { sectorId: null, especialidad: "MECÁNICO" })).toEqual([]);
  });
});

describe("la confiabilidad de la ficha", () => {
  const mtbf: Mtbf = {
    filas: [fila("a")], diasObservados: 319, sinAtribuir: [], mesEnCurso: "2026-10",
  };

  it("trae la fila del equipo y los datos de la planta", () => {
    expect(confiabilidadDeLaFicha(mtbf, "a")).toEqual({
      disponible: true, fila: mtbf.filas[0], diasObservados: 319, mesEnCurso: "2026-10",
    });
  });

  it("un equipo que no falló está disponible, con fila null", () => {
    const r = confiabilidadDeLaFicha(mtbf, "b");
    expect(r).toMatchObject({ disponible: true, fila: null });
  });

  /** Si la lectura falló no hay cuenta: nunca se puede confundir con "sin fallas". */
  it("si la lectura falló no está disponible, y no trae una fila null", () => {
    const r = confiabilidadDeLaFicha(null, "a");
    expect(r).toEqual({ disponible: false });
    expect("fila" in r).toBe(false);
  });
});

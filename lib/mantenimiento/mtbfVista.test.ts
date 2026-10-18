import { describe, it, expect } from "vitest";
import {
  confiabilidadDeLaFicha,
  diasCorridos,
  equiposSinFallas,
  fallasAntesDelGrafico,
  fechaCorta,
  filasVisibles,
  porcentajeDeConfiabilidad,
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

describe("las fallas que quedan antes del grafico", () => {
  const meses = (cantidades: number[]) =>
    cantidades.map((cantidad, i) => ({ etiqueta: `M${i}`, cantidad }));

  it("no hay ninguna cuando las barras suman el total", () => {
    const f = fila("a", { fallas: 6, porMes: meses([1, 2, 0, 3]) });
    expect(fallasAntesDelGrafico(f)).toBe(0);
  });

  /**
   * La ventana son 365 días y el gráfico 12 meses calendario, que arrancan el
   * primero del mes: las fallas de los días sueltos del principio cuentan en
   * `fallas` y no tienen barra. Si no se dice, las barras suman menos que el
   * total y nadie se entera.
   */
  it("son las que no tienen barra donde caer", () => {
    const f = fila("a", { fallas: 10, porMes: meses([1, 2, 0, 3]) });
    expect(fallasAntesDelGrafico(f)).toBe(4);
  });

  it("nunca es negativo", () => {
    const f = fila("a", { fallas: 2, porMes: meses([3]) });
    expect(fallasAntesDelGrafico(f)).toBe(0);
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

describe("el porcentaje de confiabilidad", () => {
  it("no inventa un numero cuando no hay MTBF", () => {
    expect(porcentajeDeConfiabilidad(null)).toBe("—");
  });

  it("redondea a entero desde el 1%", () => {
    expect(porcentajeDeConfiabilidad(0.7231)).toBe("72%");
    expect(porcentajeDeConfiabilidad(0.0149)).toBe("1%");
  });

  it("usa un decimal, con coma, por debajo del 1%", () => {
    expect(porcentajeDeConfiabilidad(0.0012)).toBe("0,1%");
    expect(porcentajeDeConfiabilidad(0.0075)).toBe("0,8%");
  });

  it("no muestra 0% cuando es chico pero no es cero", () => {
    expect(porcentajeDeConfiabilidad(0.00001)).toBe("<0,1%");
  });

  /**
   * El otro extremo del mismo acuerdo. "100%" afirma certeza sobre una
   * exponencial que supone una tasa de falla constante, y quien lo lee deja de
   * mirar esa máquina.
   */
  it("no muestra 100%: arriba del 99,5% dice >=99%", () => {
    expect(porcentajeDeConfiabilidad(1)).toBe("≥99%");
    expect(porcentajeDeConfiabilidad(0.9996)).toBe("≥99%");
    expect(porcentajeDeConfiabilidad(0.995)).toBe("≥99%");
  });

  it("debajo del 99,5% sigue siendo un entero exacto", () => {
    expect(porcentajeDeConfiabilidad(0.9949)).toBe("99%");
    expect(porcentajeDeConfiabilidad(0.986)).toBe("99%");
  });
});

describe("los dias corridos", () => {
  it("lleva un decimal con coma", () => {
    expect(diasCorridos(4.6)).toBe("4,6 d");
  });

  it("no inventa un numero cuando no hay MTBF", () => {
    expect(diasCorridos(null)).toBe("—");
  });
});

describe("la fecha corta", () => {
  it("da vuelta un YYYY-MM-DD sin pasar por Date", () => {
    expect(fechaCorta("2026-10-01")).toBe("01/10/2026");
  });
});

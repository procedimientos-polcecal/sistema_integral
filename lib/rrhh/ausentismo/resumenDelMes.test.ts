import { describe, expect, it } from "vitest";
import { filasPorSector, motivoQueManda, titularDelMes } from "./resumenDelMes";
import type { FilaMensual, FilaPorcentual } from "./resumenDelMes";

/**
 * Octubre de 2026, medido contra la base el 03/11/2026. 116 días en 8 sectores
 * con algo, de 15 que hay. Los números no son de ejemplo: son los que la
 * pantalla va a mostrar.
 */
const MENSUAL: FilaMensual[] = [
  { sector: "Cantera y Planta de Trituración", sectorId: "s1", total: 55, porMotivo: { LICENCIA_ART: 31, VACACIONES: 19, ENFERMEDAD_ACCIDENTE_INCULPABLE: 4, PERMISO_PERSONAL: 1 } },
  { sector: "Mantenimiento", sectorId: "s2", total: 35, porMotivo: { VACACIONES: 34, ENFERMEDAD_ACCIDENTE_INCULPABLE: 1 } },
  { sector: "Producción", sectorId: "s3", total: 7, porMotivo: { ENFERMEDAD_ACCIDENTE_INCULPABLE: 7 } },
  { sector: "Producción - Calcinación", sectorId: "s4", total: 7, porMotivo: { ENFERMEDAD_ACCIDENTE_INCULPABLE: 6, PERMISO_PERSONAL: 1 } },
  { sector: "Producción - Fábrica de Cal", sectorId: "s5", total: 7, porMotivo: { VACACIONES: 5, PERMISO_PERSONAL: 2 } },
  { sector: "Producción - Despacho", sectorId: "s6", total: 3, porMotivo: { PERMISO_PERSONAL: 2, INJUSTIFICADA: 1 } },
  { sector: "Calidad", sectorId: "s7", total: 1, porMotivo: { INJUSTIFICADA: 1 } },
  { sector: "Finanzas", sectorId: "s8", total: 0, porMotivo: {} },
];

const PORCENTUAL: FilaPorcentual[] = [
  { sector: "Cantera y Planta de Trituración", sectorId: "s1", personal: 13, horasARealizar: 2600, horasPerdidas: 440, porcentual: 16.9 },
  { sector: "Producción - Calcinación", sectorId: "s4", personal: 2, horasARealizar: 400, horasPerdidas: 56, porcentual: 14.0 },
  { sector: "Mantenimiento", sectorId: "s2", personal: 11, horasARealizar: 2200, horasPerdidas: 280, porcentual: 12.7 },
  { sector: "Producción", sectorId: "s3", personal: 3, horasARealizar: 600, horasPerdidas: 56, porcentual: 9.3 },
  { sector: "Producción - Fábrica de Cal", sectorId: "s5", personal: 11, horasARealizar: 2200, horasPerdidas: 56, porcentual: 2.5 },
  { sector: "Calidad", sectorId: "s7", personal: 2, horasARealizar: 400, horasPerdidas: 8, porcentual: 2.0 },
  { sector: "Producción - Despacho", sectorId: "s6", personal: 9, horasARealizar: 1800, horasPerdidas: 24, porcentual: 1.3 },
  { sector: "Finanzas", sectorId: "s8", personal: 2, horasARealizar: 400, horasPerdidas: 0, porcentual: 0 },
];

describe("titularDelMes", () => {
  it("dice los días, el porcentual y quién concentra", () => {
    const t = titularDelMes(MENSUAL, 116, 6.5);
    expect(t.dias).toBe(116);
    expect(t.porcentual).toBe(6.5);
    expect(t.lider?.sector).toBe("Cantera y Planta de Trituración");
    expect(t.lider?.dias).toBe(55);
    // 55 de 116: casi la mitad del mes en un solo sector.
    expect(t.lider?.porcentajeDelTotal).toBeCloseTo(47.4, 1);
  });

  it("los dos primeros juntan el 78 % del mes, y ése es el dato que hace al titular", () => {
    expect(titularDelMes(MENSUAL, 116, 6.5).dosPrimeros).toBeCloseTo(77.6, 1);
  });

  it("sin porcentual —quien no pasa el control— el titular sale igual, pero sin el %", () => {
    const t = titularDelMes(MENSUAL, 116, null);
    expect(t.porcentual).toBeNull();
    expect(t.dias).toBe(116);
    expect(t.lider?.sector).toBe("Cantera y Planta de Trituración");
  });

  it("un mes sin ausencias no tiene líder ni concentración: null y no un cero", () => {
    const t = titularDelMes([{ sector: "Calidad", sectorId: "s7", total: 0, porMotivo: {} }] as FilaMensual[], 0, 0);
    expect(t.dias).toBe(0);
    expect(t.lider).toBeNull();
    expect(t.dosPrimeros).toBeNull();
  });

  it("con un solo sector con días no hay «los dos primeros»", () => {
    const uno: FilaMensual[] = [{ sector: "Calidad", sectorId: "s7", total: 4, porMotivo: { OTRA: 4 } }];
    const t = titularDelMes(uno, 4, 1);
    expect(t.lider?.dias).toBe(4);
    expect(t.dosPrimeros).toBeNull();
  });
});

describe("filasPorSector", () => {
  it("ordena por porcentual y NO por días: es lo que hace visible que el orden cambia", () => {
    const filas = filasPorSector(MENSUAL, PORCENTUAL, {});
    expect(filas.slice(0, 3).map((f) => f.sector)).toEqual([
      "Cantera y Planta de Trituración", // 16,9 % · 55 días
      "Producción - Calcinación", //        14,0 % · 7 días
      "Mantenimiento", //                   12,7 % · 35 días
    ]);
    // El corazón del cambio, fijado: Calcinación tiene 7 días y Mantenimiento
    // 35, y aun así Calcinación va arriba — son 2 personas contra 11.
    const calcinacion = filas.find((f) => f.sector === "Producción - Calcinación")!;
    const mantenimiento = filas.find((f) => f.sector === "Mantenimiento")!;
    expect(calcinacion.dias).toBeLessThan(mantenimiento.dias);
    expect(filas.indexOf(calcinacion)).toBeLessThan(filas.indexOf(mantenimiento));
  });

  it("junta los días del mensual con el personal y el porcentual, por sectorId", () => {
    const fila = filasPorSector(MENSUAL, PORCENTUAL, {}).find((f) => f.sectorId === "s4")!;
    expect(fila).toMatchObject({ sector: "Producción - Calcinación", dias: 7, personal: 2, porcentual: 14.0 });
  });

  it("sin porcentual ordena por días, y el personal sale del padrón", () => {
    const filas = filasPorSector(MENSUAL, null, { "Cantera y Planta de Trituración": 13, Mantenimiento: 11 });
    expect(filas.slice(0, 2).map((f) => f.sector)).toEqual(["Cantera y Planta de Trituración", "Mantenimiento"]);
    expect(filas[0].personal).toBe(13);
    expect(filas[0].porcentual).toBeNull();
  });

  it("un sector que no está en el padrón trae personal en null y no un cero", () => {
    const filas = filasPorSector(MENSUAL, null, {});
    expect(filas[0].personal).toBeNull();
  });

  it("devuelve TODOS los sectores, también los que no tienen días: filtrarlos es de la pantalla", () => {
    const filas = filasPorSector(MENSUAL, PORCENTUAL, {});
    expect(filas).toHaveLength(8);
    expect(filas.some((f) => f.dias === 0)).toBe(true);
  });
});

describe("motivoQueManda", () => {
  it("devuelve los dos motivos más grandes, de mayor a menor", () => {
    expect(motivoQueManda({ LICENCIA_ART: 31, VACACIONES: 19, ENFERMEDAD_ACCIDENTE_INCULPABLE: 4, PERMISO_PERSONAL: 1 })).toEqual([
      { tipo: "LICENCIA_ART", dias: 31 },
      { tipo: "VACACIONES", dias: 19 },
    ]);
  });

  it("con uno solo devuelve uno, y sin nada devuelve vacío", () => {
    expect(motivoQueManda({ VACACIONES: 5 })).toEqual([{ tipo: "VACACIONES", dias: 5 }]);
    expect(motivoQueManda({})).toEqual([]);
  });

  it("empatados, desempata por el nombre del tipo, para que dos corridas den lo mismo", () => {
    expect(motivoQueManda({ VACACIONES: 3, ENFERMEDAD_ACCIDENTE_INCULPABLE: 3 })).toEqual([
      { tipo: "ENFERMEDAD_ACCIDENTE_INCULPABLE", dias: 3 },
      { tipo: "VACACIONES", dias: 3 },
    ]);
  });
});

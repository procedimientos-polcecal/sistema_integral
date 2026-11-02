import { describe, expect, it } from "vitest";
import { armarReportes, AVISO_TODOS_LOS_SECTORES, puedeVerLosReportes, reportesQueVe } from "./armarReportes";
import { ausentesPublicos } from "./disponibilidadPublica";
import type { EmpleadoDelReporte } from "./reportes";

const ana: EmpleadoDelReporte = { id: "e1", nombre: "Ana", apellido: "Pérez", sectorId: "s1", sector: "Taller" };
const sinSector: EmpleadoDelReporte = { id: "e2", nombre: "Beto", apellido: "Gómez", sectorId: null, sector: null };
const feriados2026 = ["2026-01-01", "2026-05-01", "2026-12-25"];

describe("armarReportes", () => {
  it("dice siempre que el total incluye a todos los sectores y que no va a dar igual que la planilla", () => {
    const r = armarReportes({ ausencias: [], empleados: [ana], feriados: feriados2026, horas: [], mes: "2026-03" });
    expect(r.avisos).toContain(AVISO_TODOS_LOS_SECTORES);
    expect(AVISO_TODOS_LOS_SECTORES).toMatch(/todos los sectores/);
    expect(AVISO_TODOS_LOS_SECTORES).toMatch(/17/);
    expect(AVISO_TODOS_LOS_SECTORES).toMatch(/no van a coincidir/);
  });

  it("avisa del año sin feriados, y sólo de eso: un mes suelto sin feriado es lo normal", () => {
    const sin = armarReportes({ ausencias: [], empleados: [ana], feriados: feriados2026, horas: [], mes: "2027-03" });
    expect(sin.avisos.some((a) => a.includes("2027") && a.includes("feriado"))).toBe(true);

    // septiembre de 2026 no tiene feriado cargado y no hay aviso: el año sí tiene.
    const con = armarReportes({ ausencias: [], empleados: [ana], feriados: feriados2026, horas: [], mes: "2026-09" });
    expect(con.avisos).toEqual([AVISO_TODOS_LOS_SECTORES]);
  });

  it("un empleado sin sector entra en el mensual, bajo «Sin sector»", () => {
    const r = armarReportes({
      ausencias: [{ empleado_id: "e2", fecha_desde: "2026-03-10", fecha_hasta: "2026-03-10", tipo: "OTRA" }],
      empleados: [ana, sinSector],
      feriados: feriados2026,
      horas: [],
      mes: "2026-03",
    });
    const fila = r.mensual.filas.find((f) => f.sectorId === null);
    expect(fila?.sector).toBe("Sin sector");
    expect(fila?.total).toBe(1);
    expect(r.mensual.total).toBe(1);
  });

  it("un empleado inactivo que faltó no se pierde: es quien llama el que lo pasa, y si no lo pasa se avisa", () => {
    const ausencias = [{ empleado_id: "fuera", fecha_desde: "2026-03-10", fecha_hasta: "2026-03-10", tipo: "OTRA" }];
    const sinElLegajo = armarReportes({ ausencias, empleados: [ana], feriados: feriados2026, horas: [], mes: "2026-03" });
    expect(sinElLegajo.mensual.total).toBe(0);
    expect(sinElLegajo.avisos.some((a) => a.includes("no están en el padrón"))).toBe(true);

    const conElLegajo = armarReportes({
      ausencias,
      empleados: [ana, { id: "fuera", nombre: "Carlos", apellido: "Ruiz", sectorId: "s1", sector: "Taller" }],
      feriados: feriados2026,
      horas: [],
      mes: "2026-03",
    });
    expect(conElLegajo.mensual.total).toBe(1);
    expect(conElLegajo.avisos).toEqual([AVISO_TODOS_LOS_SECTORES]);
  });

  it("LA TARDANZA: no es un hueco en la disponibilidad y sí suma un día en el mensual", () => {
    // La misma fila cuenta distinto según quién pregunta, a propósito. Este test
    // existe para que quien la «unifique» tenga que cambiarlo a sabiendas.
    const tardanza = { empleado_id: "e1", fecha_desde: "2026-03-10", fecha_hasta: "2026-03-10", tipo: "TARDANZA" };

    const disponibilidad = ausentesPublicos([tardanza], [{ id: "e1", nombre: "Ana", apellido: "Pérez", sector: "Taller" }], ["2026-03-10"]);
    expect(disponibilidad).toEqual([]);

    const r = armarReportes({ ausencias: [tardanza], empleados: [ana], feriados: feriados2026, horas: [], mes: "2026-03" });
    expect(r.mensual.total).toBe(1);
    expect(r.mensual.totalPorMotivo.TARDANZA).toBe(1);
  });
});

describe("puedeVerLosReportes", () => {
  it("encargado y admin_sistema pasan aunque no tengan RRHH", () => {
    expect(puedeVerLosReportes("encargado", null)).toBe(true);
    expect(puedeVerLosReportes("admin_sistema", null)).toBe(true);
  });

  it("un operario pasa sólo si tiene RRHH, en cualquier nivel", () => {
    expect(puedeVerLosReportes("operario", null)).toBe(false);
    expect(puedeVerLosReportes("operario", "lectura")).toBe(true);
  });

  it("sin rol y sin RRHH no pasa", () => {
    expect(puedeVerLosReportes(undefined, null)).toBe(false);
  });
});

describe("reportesQueVe", () => {
  const todo = armarReportes({
    ausencias: [{ empleado_id: "e1", fecha_desde: "2026-03-10", fecha_hasta: "2026-03-12", tipo: "VACACIONES" }],
    empleados: [ana],
    feriados: feriados2026,
    horas: [],
    mes: "2026-03",
  });

  it("quien no pasa el control ve CUÁNTO se faltó por sector", () => {
    const recortado = reportesQueVe(todo, false);
    expect(recortado.mensual.total).toBe(3);
    expect(recortado.mensual.filas[0].total).toBe(3);
    expect(recortado.mensual.filas[0].sector).toBe("Taller");
    expect(recortado.avisos).toContain(AVISO_TODOS_LOS_SECTORES);
  });

  it("pero NO de qué: en un sector de una persona el motivo la nombraría", () => {
    const recortado = reportesQueVe(todo, false);
    // Lo que se pregunta no es que falte la clave sino que el motivo no esté en
    // ninguna parte del JSON que se manda, que es lo único que llega del otro
    // lado. «Producción - Hidratación» tiene una sola persona: ahí «Enfermedad:
    // 5» dice quién estuvo enfermo.
    const json = JSON.stringify(recortado);
    expect(json).not.toContain("VACACIONES");
    expect(json).not.toContain("porMotivo");
    expect(json).not.toContain("totalPorMotivo");
  });

  it("el anual y el porcentual nombran personas, así que tampoco salen", () => {
    const recortado = reportesQueVe(todo, false);
    expect("anual" in recortado).toBe(false);
    expect("porcentual" in recortado).toBe(false);
    expect(JSON.stringify(recortado)).not.toContain("Pérez");
  });

  it("quien pasa el control recibe los tres, con los motivos", () => {
    const completo = reportesQueVe(todo, true);
    expect("anual" in completo && completo.anual.filas).toHaveLength(1);
    expect("porcentual" in completo && completo.porcentual.filas).toHaveLength(1);
    expect(completo.mensual.total).toBe(3);
    expect(JSON.stringify(completo)).toContain("VACACIONES");
  });
});

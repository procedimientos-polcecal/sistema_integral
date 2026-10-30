import { describe, expect, it } from "vitest";
import { reporteAnual, reporteMensual, reportePorcentual } from "./reportes";
import type { EmpleadoDelReporte, HorasDeSector } from "./reportes";
import type { Ausencia } from "./diasDeAusencia";

const emp = (
  id: string,
  sectorId: string | null,
  sector: string | null,
  apellido = id.toUpperCase(),
  nombre = "Nombre",
): EmpleadoDelReporte => ({ id, nombre, apellido, sectorId, sector });

const aus = (empleado_id: string, desde: string, hasta: string, tipo: string): Ausencia => ({
  empleado_id,
  fecha_desde: desde,
  fecha_hasta: hasta,
  tipo,
});

const cantera = emp("e1", "s-cantera", "Cantera");
const molienda = emp("e2", "s-molienda", "Molienda");
const sinSector = emp("e3", null, null);

describe("reporteMensual", () => {
  it("el mensual cruza sector por motivo y cierra los totales", () => {
    const ausencias = [
      aus("e1", "2026-10-05", "2026-10-07", "ENFERMEDAD"), // 3 días
      aus("e1", "2026-10-12", "2026-10-12", "TARDANZA"), // 1
      aus("e2", "2026-10-01", "2026-10-02", "ENFERMEDAD"), // 2
    ];
    const r = reporteMensual(ausencias, [cantera, molienda], "2026-10");

    const c = r.filas.find((f) => f.sector === "Cantera")!;
    const m = r.filas.find((f) => f.sector === "Molienda")!;
    expect(c.porMotivo).toEqual({ ENFERMEDAD: 3, TARDANZA: 1 });
    expect(c.total).toBe(4);
    expect(m.porMotivo).toEqual({ ENFERMEDAD: 2 });
    expect(m.total).toBe(2);

    expect(r.totalPorMotivo).toEqual({ ENFERMEDAD: 5, TARDANZA: 1 });
    expect(r.total).toBe(6);
    // Los totales por fila, por columna y el general tienen que coincidir.
    const sumaFilas = r.filas.reduce((s, f) => s + f.total, 0);
    const sumaColumnas = Object.values(r.totalPorMotivo).reduce((s, n) => s + n, 0);
    expect(sumaFilas).toBe(r.total);
    expect(sumaColumnas).toBe(r.total);
  });

  it("agrupa bajo 'Sin sector' a quien no tiene sector asignado", () => {
    const r = reporteMensual(
      [aus("e3", "2026-10-05", "2026-10-06", "ENFERMEDAD"), aus("e1", "2026-10-05", "2026-10-05", "ENFERMEDAD")],
      [cantera, sinSector],
      "2026-10",
    );
    const fila = r.filas.find((f) => f.sector === "Sin sector");
    expect(fila).toBeDefined();
    expect(fila!.total).toBe(2);
    expect(fila!.porMotivo).toEqual({ ENFERMEDAD: 2 });
    // Y su número entra al total general: no se pierde en ninguna parte.
    expect(r.total).toBe(3);
  });

  it("la tardanza cuenta como dia en los reportes", () => {
    const r = reporteMensual([aus("e1", "2026-10-14", "2026-10-14", "TARDANZA")], [cantera], "2026-10");
    expect(r.filas[0].porMotivo.TARDANZA).toBe(1);
    expect(r.total).toBe(1);
  });

  // Decidido a pedido: NO se suprime nada. Hay sectores de una sola persona
  // (RRHH, Produccion-Hidratacion), asi que la celda deja ver su motivo. El test
  // esta para que nadie "arregle" esto mas adelante sin volver a preguntar.
  it("un sector de una sola persona aparece igual, sin suprimir", () => {
    const solo = emp("e9", "s-rrhh", "RRHH");
    const r = reporteMensual([aus("e9", "2026-10-20", "2026-10-22", "ENFERMEDAD")], [solo, cantera], "2026-10");
    const fila = r.filas.find((f) => f.sector === "RRHH");
    expect(fila).toBeDefined();
    expect(fila!.porMotivo.ENFERMEDAD).toBe(3);
  });

  it("prorratea entre meses con la regla inclusive", () => {
    // 19/12 al 2/1: 13 días en diciembre y 2 en enero.
    const a = [aus("e1", "2026-12-19", "2027-01-02", "LICENCIA")];
    expect(reporteMensual(a, [cantera], "2026-12").total).toBe(13);
    expect(reporteMensual(a, [cantera], "2027-01").total).toBe(2);
  });

  it("un sector sin ausencias en el mes igual aparece, en cero", () => {
    const r = reporteMensual([aus("e1", "2026-10-05", "2026-10-05", "ENFERMEDAD")], [cantera, molienda], "2026-10");
    const m = r.filas.find((f) => f.sector === "Molienda")!;
    expect(m.total).toBe(0);
    expect(m.porMotivo).toEqual({});
  });

  it("'Sin sector' va al final", () => {
    const r = reporteMensual([], [sinSector, molienda, cantera], "2026-10");
    expect(r.filas.map((f) => f.sector)).toEqual(["Cantera", "Molienda", "Sin sector"]);
  });
});

describe("reporteAnual", () => {
  const sinFeriados: string[] = [];

  it("el anual imputa la ausencia entera al mes en que empieza", () => {
    // 19/12 al 2/1: exclusive son 14 días, y todos caen en diciembre.
    const a = [aus("e1", "2026-12-19", "2027-01-02", "LICENCIA")];
    const [fila] = reporteAnual(a, [cantera], 2026, "2026-12", sinFeriados);
    expect(fila.porMes[11]).toBe(14);
    expect(fila.porMes.slice(0, 11).every((n) => n === 0)).toBe(true);
    expect(fila.total).toBe(14);
    // Y en el anual de 2027 no aparece nada: no se parte.
    const [f27] = reporteAnual(a, [cantera], 2027, "2027-01", sinFeriados);
    expect(f27.porMes[0]).toBe(0);
    expect(f27.total).toBe(0);
  });

  it("usa la regla exclusive: una ausencia de un solo día vale cero", () => {
    const a = [aus("e1", "2026-03-10", "2026-03-10", "ENFERMEDAD"), aus("e1", "2026-03-05", "2026-03-12", "ENFERMEDAD")];
    const [fila] = reporteAnual(a, [cantera], 2026, "2026-03", sinFeriados);
    // 0 + 7 (y no 1 + 8 como daría el mensual)
    expect(fila.porMes[2]).toBe(7);
  });

  it("suma el total, los hábiles acumulados y el porcentual", () => {
    // Enero 2026 tiene 22 hábiles y febrero 20, sin feriados: 42 acumulados.
    const a = [aus("e1", "2026-01-05", "2026-01-15", "ENFERMEDAD"), aus("e1", "2026-02-02", "2026-02-12", "ENFERMEDAD")];
    const [fila] = reporteAnual(a, [cantera], 2026, "2026-02", sinFeriados);
    expect(fila.porMes[0]).toBe(10);
    expect(fila.porMes[1]).toBe(10);
    expect(fila.total).toBe(20);
    expect(fila.habiles).toBe(42);
    expect(fila.porcentual).toBeCloseTo((20 / 42) * 100, 10);
  });

  it("los meses posteriores a hastaMes no cuentan en el total", () => {
    const a = [aus("e1", "2026-01-05", "2026-01-10", "ENFERMEDAD"), aus("e1", "2026-06-01", "2026-06-11", "ENFERMEDAD")];
    const [fila] = reporteAnual(a, [cantera], 2026, "2026-03", sinFeriados);
    expect(fila.total).toBe(5);
    expect(fila.porMes[5]).toBe(0);
  });

  it("el porcentual puede pasar de 100 y no se topea", () => {
    // 141 días contra 120 hábiles acumulados a junio de 2026 = 117,5 %.
    // Se parte en ausencias de 47 días exclusive, cada una en un mes distinto.
    const feriados2026 = [
      "2026-01-01", "2026-02-16", "2026-02-17", "2026-03-23", "2026-03-24", "2026-04-02",
      "2026-04-03", "2026-05-01", "2026-05-25", "2026-06-15", "2026-06-20",
    ];
    const a = [
      aus("e1", "2026-01-01", "2026-02-17", "LICENCIA"), // 47, todo a enero
      aus("e1", "2026-03-01", "2026-04-17", "LICENCIA"), // 47, a marzo
      aus("e1", "2026-05-01", "2026-06-17", "LICENCIA"), // 47, a mayo
    ];
    const [fila] = reporteAnual(a, [cantera], 2026, "2026-06", feriados2026);
    expect(fila.total).toBe(141);
    expect(fila.habiles).toBeGreaterThan(0);
    expect(fila.porcentual).toBeCloseTo((141 / fila.habiles) * 100, 10);
    // 141 días de calendario sobre los hábiles a junio (menos de 141): pasa de 100.
    expect(fila.habiles).toBeLessThan(141);
    expect(fila.porcentual).toBeGreaterThan(100);
  });

  it("incluye a todos los empleados, también al que no tiene sector ni ausencias", () => {
    const r = reporteAnual([], [cantera, sinSector], 2026, "2026-03", sinFeriados);
    expect(r).toHaveLength(2);
    const s = r.find((f) => f.empleadoId === "e3")!;
    expect(s.sector).toBeNull();
    expect(s.total).toBe(0);
    expect(s.porMes).toHaveLength(12);
    expect(r.find((f) => f.empleadoId === "e1")!.sector).toBe("Cantera");
  });

  it("ordena por apellido y nombre", () => {
    const r = reporteAnual(
      [],
      [emp("a", "s", "X", "PEREZ", "Juan"), emp("b", "s", "X", "GOMEZ", "Ana")],
      2026,
      "2026-01",
      sinFeriados,
    );
    expect(r.map((f) => f.empleadoId)).toEqual(["b", "a"]);
    expect(r[0].nombre).toBe("GOMEZ, Ana");
  });

  it("se niega si hastaMes no es del año pedido", () => {
    expect(() => reporteAnual([], [cantera], 2026, "2027-02", sinFeriados)).toThrow();
  });
});

describe("reportePorcentual", () => {
  const horas: HorasDeSector[] = [
    { sectorId: "s-cantera", horasPorEmpleado: 208, desde: "2026-01-01", hasta: null },
    { sectorId: "s-molienda", horasPorEmpleado: 200, desde: "2026-01-01", hasta: null },
  ];

  it("el porcentual son horas perdidas sobre horas a realizar", () => {
    const e1b = emp("e1b", "s-cantera", "Cantera");
    const ausencias = [aus("e1", "2026-10-05", "2026-10-09", "ENFERMEDAD")]; // 5 días
    const r = reportePorcentual(ausencias, [cantera, e1b, molienda], "2026-10", horas, []);

    const c = r.filas.find((f) => f.sector === "Cantera")!;
    expect(c.personal).toBe(2);
    expect(c.horasARealizar).toBe(2 * 208);
    expect(c.horasPerdidas).toBe(5 * 8);
    expect(c.porcentual).toBeCloseTo((40 / 416) * 100, 10);

    const m = r.filas.find((f) => f.sector === "Molienda")!;
    expect(m.horasPerdidas).toBe(0);
    expect(m.porcentual).toBe(0);

    // El general es ponderado: total perdidas sobre total a realizar,
    // y no el promedio de los porcentuales de cada sector.
    expect(r.general).toBeCloseTo((40 / (416 + 200)) * 100, 10);
  });

  it("una vigencia de horas que no cubre el mes no se usa", () => {
    const vieja: HorasDeSector[] = [
      { sectorId: "s-cantera", horasPorEmpleado: 999, desde: "2025-01-01", hasta: "2025-12-31" },
      { sectorId: "s-cantera", horasPorEmpleado: 208, desde: "2026-01-01", hasta: null },
    ];
    const r = reportePorcentual([], [cantera], "2026-10", vieja, []);
    expect(r.filas[0].horasARealizar).toBe(208);
    // Una vigencia que todavía no empezó tampoco.
    const futura: HorasDeSector[] = [{ sectorId: "s-cantera", horasPorEmpleado: 120, desde: "2026-11-01", hasta: null }];
    const r2 = reportePorcentual([], [cantera], "2026-10", futura, []);
    expect(r2.filas[0].horasARealizar).toBe(0);
  });

  it("usa la regla inclusive y prorrateada del mensual, no la del anual", () => {
    // Un día solo: el anual lo cuenta cero, el porcentual lo cuenta uno.
    const r = reportePorcentual([aus("e1", "2026-10-05", "2026-10-05", "ENFERMEDAD")], [cantera], "2026-10", horas, []);
    expect(r.filas[0].horasPerdidas).toBe(8);
  });

  it("el porcentual puede pasar de 100 y no se topea", () => {
    const r = reportePorcentual([aus("e1", "2026-10-01", "2026-10-31", "LICENCIA")], [cantera], "2026-10", horas, []);
    // 31 días x 8 = 248 horas perdidas sobre 208 a realizar.
    expect(r.filas[0].porcentual).toBeCloseTo((248 / 208) * 100, 10);
    expect(r.filas[0].porcentual).toBeGreaterThan(100);
  });

  it("un sector sin horas cargadas aparece, con su personal y sus horas perdidas, sin dividir por cero", () => {
    const r = reportePorcentual([aus("e3", "2026-10-05", "2026-10-06", "ENFERMEDAD")], [sinSector], "2026-10", horas, []);
    const fila = r.filas.find((f) => f.sector === "Sin sector")!;
    expect(fila.personal).toBe(1);
    expect(fila.horasPerdidas).toBe(16);
    expect(fila.horasARealizar).toBe(0);
    expect(fila.porcentual).toBe(0);
    expect(Number.isFinite(r.general)).toBe(true);
  });

  it("la tardanza cuenta como dia", () => {
    const r = reportePorcentual([aus("e1", "2026-10-14", "2026-10-14", "TARDANZA")], [cantera], "2026-10", horas, []);
    expect(r.filas[0].horasPerdidas).toBe(8);
  });
});

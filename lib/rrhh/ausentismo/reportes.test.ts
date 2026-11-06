import { describe, expect, it } from "vitest";
import { reporteAnual, reporteMensual, reportePorcentual } from "./reportes";
import type { EmpleadoDelReporte, HorasDeSector } from "./reportes";
import type { Ausencia } from "./diasDeAusencia";
import { FERIADOS_2026 } from "./feriados2026.fixture";

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

  it("cada fila trae su sectorId, para distinguir dos sectores con el mismo nombre", () => {
    // El catálogo tiene tres "Mantenimiento": sin el id, dos filas serían idénticas.
    const m1 = emp("m1", "s-mant-a", "Mantenimiento");
    const m2 = emp("m2", "s-mant-b", "Mantenimiento");
    const r = reporteMensual([], [m1, m2, sinSector], "2026-10");
    expect(r.filas.map((f) => [f.sector, f.sectorId])).toEqual([
      ["Mantenimiento", "s-mant-a"],
      ["Mantenimiento", "s-mant-b"],
      ["Sin sector", null],
    ]);
  });

  it("cuenta las ausencias de alguien que no está en la lista de empleados", () => {
    const ausencias = [
      aus("e1", "2026-10-05", "2026-10-05", "ENFERMEDAD"),
      aus("fantasma", "2026-10-06", "2026-10-07", "ENFERMEDAD"), // huérfana, cae en octubre
      aus("fantasma", "2026-03-06", "2026-03-07", "ENFERMEDAD"), // huérfana pero de otro mes: no cambia este reporte
    ];
    const r = reporteMensual(ausencias, [cantera], "2026-10");
    expect(r.ausenciasHuerfanas).toBe(1);
    expect(r.total).toBe(1); // y no suma en ningún sector
    expect(reporteMensual(ausencias.slice(0, 1), [cantera], "2026-10").ausenciasHuerfanas).toBe(0);
  });

  it("rechaza un mes mal escrito en vez de devolver un número equivocado", () => {
    expect(() => reporteMensual([], [cantera], "2026-1")).toThrow();
    expect(() => reporteMensual([], [cantera], "2026-13")).toThrow();
  });

  it("un motivo sin días no tiene clave: la lista de columnas no sale de totalPorMotivo", () => {
    const r = reporteMensual([aus("e1", "2026-09-05", "2026-09-05", "ENFERMEDAD")], [cantera], "2026-10");
    expect(r.totalPorMotivo).toEqual({});
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
    const [fila] = reporteAnual(a, [cantera], 2026, "2026-12", sinFeriados).filas;
    expect(fila.porMes[11]).toBe(14);
    expect(fila.porMes.slice(0, 11).every((n) => n === 0)).toBe(true);
    expect(fila.total).toBe(14);
    // Y en el anual de 2027 no aparece nada: no se parte.
    const [f27] = reporteAnual(a, [cantera], 2027, "2027-01", sinFeriados).filas;
    expect(f27.porMes[0]).toBe(0);
    expect(f27.total).toBe(0);
  });

  it("usa la regla exclusive: una ausencia de un solo día vale cero", () => {
    const a = [aus("e1", "2026-03-10", "2026-03-10", "ENFERMEDAD"), aus("e1", "2026-03-05", "2026-03-12", "ENFERMEDAD")];
    const [fila] = reporteAnual(a, [cantera], 2026, "2026-03", sinFeriados).filas;
    // 0 + 7 (y no 1 + 8 como daría el mensual)
    expect(fila.porMes[2]).toBe(7);
  });

  it("suma el total, los hábiles acumulados y el porcentual", () => {
    // Enero 2026 tiene 22 hábiles y febrero 20, sin feriados: 42 acumulados.
    const a = [aus("e1", "2026-01-05", "2026-01-15", "ENFERMEDAD"), aus("e1", "2026-02-02", "2026-02-12", "ENFERMEDAD")];
    const [fila] = reporteAnual(a, [cantera], 2026, "2026-02", sinFeriados).filas;
    expect(fila.porMes[0]).toBe(10);
    expect(fila.porMes[1]).toBe(10);
    expect(fila.total).toBe(20);
    expect(fila.habiles).toBe(42);
    expect(fila.porcentual).toBeCloseTo((20 / 42) * 100, 10);
  });

  it("los meses posteriores a hastaMes no cuentan en el total", () => {
    const a = [aus("e1", "2026-01-05", "2026-01-10", "ENFERMEDAD"), aus("e1", "2026-06-01", "2026-06-11", "ENFERMEDAD")];
    const [fila] = reporteAnual(a, [cantera], 2026, "2026-03", sinFeriados).filas;
    expect(fila.total).toBe(5);
    expect(fila.porMes[5]).toBe(0);
  });

  it("el porcentual puede pasar de 100 y no se topea: 141 sobre 120 es 117,5", () => {
    // El ejemplo medido del diseño. Con los 17 feriados reales de 2026 los
    // hábiles de enero a junio son 120, y se fijan acá como constante: si el
    // denominador se moviera, este test tiene que avisar.
    // Tres ausencias de 47 días exclusive, cada una imputada a un mes distinto.
    const a = [
      aus("e1", "2026-01-01", "2026-02-17", "LICENCIA"), // 47, todo a enero
      aus("e1", "2026-03-01", "2026-04-17", "LICENCIA"), // 47, a marzo
      aus("e1", "2026-05-01", "2026-06-17", "LICENCIA"), // 47, a mayo
    ];
    const [fila] = reporteAnual(a, [cantera], 2026, "2026-06", FERIADOS_2026).filas;
    expect(fila.total).toBe(141);
    expect(fila.habiles).toBe(120);
    expect(fila.porcentual).toBe(117.5);
  });

  it("incluye a todos los empleados, también al que no tiene sector ni ausencias", () => {
    const r = reporteAnual([], [cantera, sinSector], 2026, "2026-03", sinFeriados).filas;
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
    ).filas;
    expect(r.map((f) => f.empleadoId)).toEqual(["b", "a"]);
    expect(r[0].nombre).toBe("GOMEZ, Ana");
  });

  it("cuenta las ausencias huérfanas que caen en el período del reporte", () => {
    const ausencias = [
      aus("fantasma", "2026-02-03", "2026-02-09", "ENFERMEDAD"), // dentro
      aus("fantasma", "2026-08-03", "2026-08-09", "ENFERMEDAD"), // después de hastaMes
      aus("fantasma", "2025-02-03", "2025-02-09", "ENFERMEDAD"), // de otro año
      aus("e1", "2026-02-03", "2026-02-09", "ENFERMEDAD"),
    ];
    const r = reporteAnual(ausencias, [cantera], 2026, "2026-03", sinFeriados);
    expect(r.ausenciasHuerfanas).toBe(1);
    expect(r.filas[0].total).toBe(6);
  });

  it("rechaza un mes mal escrito, no sólo uno de otro año", () => {
    expect(() => reporteAnual([], [cantera], 2026, "2026-1", sinFeriados)).toThrow();
    expect(() => reporteAnual([], [cantera], 2026, "2026-13", sinFeriados)).toThrow();
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
    expect(c.sectorId).toBe("s-cantera");
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

  it("un sector sin fila en el catálogo usa (hábiles + sábados) x 8, y varía con el mes", () => {
    // Febrero de 2026 con los feriados reales: 18 hábiles + 4 sábados = 22 x 8 = 176.
    const feb = reportePorcentual([], [cantera], "2026-02", [], FERIADOS_2026);
    expect(feb.filas[0].horasARealizar).toBe(176);
    // Octubre: 20 hábiles + 5 sábados = 25 x 8 = 200. No es el mismo número.
    const oct = reportePorcentual([], [cantera], "2026-10", [], FERIADOS_2026);
    expect(oct.filas[0].horasARealizar).toBe(200);
  });

  it("el calculado se multiplica por el personal", () => {
    const e1b = emp("e1b", "s-cantera", "Cantera");
    const r = reportePorcentual([], [cantera, e1b], "2026-02", [], FERIADOS_2026);
    expect(r.filas[0].horasARealizar).toBe(2 * 176);
  });

  it("una fila del catálogo gana sobre el cálculo (el 200 de oficina es una decisión)", () => {
    const oficina: HorasDeSector[] = [{ sectorId: "s-cantera", horasPorEmpleado: 200, desde: "2026-01-01", hasta: null }];
    const r = reportePorcentual([], [cantera], "2026-02", oficina, FERIADOS_2026);
    expect(r.filas[0].horasARealizar).toBe(200); // y no 176
  });

  it("una vigencia de horas que no cubre el mes no se usa y vuelve el cálculo", () => {
    const vieja: HorasDeSector[] = [
      { sectorId: "s-cantera", horasPorEmpleado: 999, desde: "2025-01-01", hasta: "2025-12-31" },
      { sectorId: "s-cantera", horasPorEmpleado: 208, desde: "2026-01-01", hasta: null },
    ];
    const r = reportePorcentual([], [cantera], "2026-10", vieja, []);
    expect(r.filas[0].horasARealizar).toBe(208);
    // Una vigencia que todavía no empezó tampoco: cae al cálculo, no a 0.
    const futura: HorasDeSector[] = [{ sectorId: "s-cantera", horasPorEmpleado: 120, desde: "2026-11-01", hasta: null }];
    const r2 = reportePorcentual([], [cantera], "2026-02", futura, FERIADOS_2026);
    expect(r2.filas[0].horasARealizar).toBe(176);
    // Y una que ya venció, sola, tampoco: no queda ninguna aplicable.
    const vencida: HorasDeSector[] = [{ sectorId: "s-cantera", horasPorEmpleado: 999, desde: "2025-01-01", hasta: "2025-12-31" }];
    expect(reportePorcentual([], [cantera], "2026-02", vencida, FERIADOS_2026).filas[0].horasARealizar).toBe(176);
  });

  it("la vigencia es cualquier solapamiento: una fila que empieza el 20 cuenta para todo el mes", () => {
    const desdeElVeinte: HorasDeSector[] = [{ sectorId: "s-cantera", horasPorEmpleado: 150, desde: "2026-10-20", hasta: null }];
    const r = reportePorcentual([], [cantera], "2026-10", desdeElVeinte, []);
    expect(r.filas[0].horasARealizar).toBe(150);
    const hastaElDos: HorasDeSector[] = [{ sectorId: "s-cantera", horasPorEmpleado: 150, desde: "2026-01-01", hasta: "2026-10-02" }];
    expect(reportePorcentual([], [cantera], "2026-10", hastaElDos, []).filas[0].horasARealizar).toBe(150);
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

  it("quien no tiene sector también usa el cálculo y entra al general", () => {
    // Febrero 2026: 176 horas a realizar; 2 días de ausencia = 16 horas perdidas.
    const r = reportePorcentual([aus("e3", "2026-02-05", "2026-02-06", "ENFERMEDAD")], [sinSector], "2026-02", [], FERIADOS_2026);
    const fila = r.filas.find((f) => f.sector === "Sin sector")!;
    expect(fila.sectorId).toBeNull();
    expect(fila.personal).toBe(1);
    expect(fila.horasPerdidas).toBe(16);
    expect(fila.horasARealizar).toBe(176);
    expect(r.general).toBeCloseTo((16 / 176) * 100, 10);
  });

  it("con el catálogo vacío el titular no queda en cero si hubo ausencias", () => {
    const r = reportePorcentual([aus("e1", "2026-02-05", "2026-02-06", "ENFERMEDAD")], [cantera, molienda], "2026-02", [], FERIADOS_2026);
    expect(r.general).toBeGreaterThan(0);
    expect(r.general).toBeCloseTo((16 / (2 * 176)) * 100, 10);
  });

  it("sin personal no hay con qué dividir y el general es 0", () => {
    const r = reportePorcentual([], [], "2026-02", [], FERIADOS_2026);
    expect(r.filas).toEqual([]);
    expect(r.general).toBe(0);
  });

  it("cuenta las ausencias de alguien que no está en la lista de empleados", () => {
    const ausencias = [
      aus("fantasma", "2026-10-06", "2026-10-07", "ENFERMEDAD"),
      aus("fantasma", "2026-03-06", "2026-03-07", "ENFERMEDAD"), // de otro mes
      aus("e1", "2026-10-05", "2026-10-05", "ENFERMEDAD"),
    ];
    const r = reportePorcentual(ausencias, [cantera], "2026-10", horas, []);
    expect(r.ausenciasHuerfanas).toBe(1);
    expect(r.filas[0].horasPerdidas).toBe(8);
  });

  it("rechaza un mes mal escrito", () => {
    expect(() => reportePorcentual([], [cantera], "2026-1", horas, [])).toThrow();
  });

  it("la tardanza cuenta como dia", () => {
    const r = reportePorcentual([aus("e1", "2026-10-14", "2026-10-14", "TARDANZA")], [cantera], "2026-10", horas, []);
    expect(r.filas[0].horasPerdidas).toBe(8);
  });
});

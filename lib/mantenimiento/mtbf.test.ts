import { describe, it, expect } from "vitest";
import { fechaDeFalla, fallasDeLaVentana, confiabilidad, calcularMtbf, type OtCruda } from "./mtbf";

const ot = (p: Partial<OtCruda>): OtCruda => ({
  ot_number: 1, tipo: "CORRECTIVO", fecha: null, fecha_ejecucion: null,
  equipment_id: "eq1", equipo_raw: null, especialidad: "MECÁNICO", ...p,
});

describe("la fecha de una falla", () => {
  it("es la de ejecucion, no la de carga", () => {
    expect(fechaDeFalla(ot({ fecha: "2026-01-19", fecha_ejecucion: "2025-12-25" }))).toBe("2025-12-25");
  });
  it("cae en la de carga solo si no hay ejecucion", () => {
    expect(fechaDeFalla(ot({ fecha: "2026-01-19", fecha_ejecucion: null }))).toBe("2026-01-19");
  });
  it("sin ninguna de las dos no hay falla", () => {
    expect(fechaDeFalla(ot({}))).toBeNull();
  });
});

describe("que entra en la ventana", () => {
  const HASTA = "2026-10-15";
  it("solo las correctivas", () => {
    const r = fallasDeLaVentana([
      ot({ ot_number: 1, tipo: "CORRECTIVO", fecha_ejecucion: "2026-05-01" }),
      ot({ ot_number: 2, tipo: "PROGRAMADO", fecha_ejecucion: "2026-05-01" }),
      ot({ ot_number: 3, tipo: null, fecha_ejecucion: "2026-05-01" }),
    ], HASTA);
    expect(r.map((f) => f.otNumber)).toEqual([1]);
  });
  it("deja afuera lo ejecutado despues de hoy", () => {
    expect(fallasDeLaVentana([ot({ fecha_ejecucion: "2027-03-15" })], HASTA)).toEqual([]);
  });
  it("deja afuera lo anterior a la ventana", () => {
    expect(fallasDeLaVentana([ot({ fecha_ejecucion: "2023-03-06" })], HASTA)).toEqual([]);
  });
  it("conserva las que no tienen equipo", () => {
    const r = fallasDeLaVentana([ot({ equipment_id: null, equipo_raw: "molino viejo", fecha_ejecucion: "2026-05-01" })], HASTA);
    expect(r).toHaveLength(1);
    expect(r[0].equipmentId).toBeNull();
  });
});

describe("la confiabilidad", () => {
  it("es e elevado a menos t sobre el mtbf", () => {
    expect(confiabilidad(4.6, 7)).toBeCloseTo(0.2184, 3);
    expect(confiabilidad(21.3, 7)).toBeCloseTo(0.7199, 3);
  });
  it("a plazo cero es certeza", () => {
    expect(confiabilidad(10, 0)).toBe(1);
  });
});

describe("el calculo completo", () => {
  const HASTA = "2026-10-15";
  // Dos equipos: eq1 falla 4 veces, eq2 una sola. Primera falla 2026-01-01.
  const ORDENES: OtCruda[] = [
    ot({ ot_number: 1, equipment_id: "eq1", fecha_ejecucion: "2026-01-01" }),
    ot({ ot_number: 2, equipment_id: "eq1", fecha_ejecucion: "2026-04-01" }),
    ot({ ot_number: 3, equipment_id: "eq1", fecha_ejecucion: "2026-07-01", especialidad: "ELÉCTRICO" }),
    ot({ ot_number: 4, equipment_id: "eq1", fecha_ejecucion: "2026-10-01" }),
    ot({ ot_number: 5, equipment_id: "eq2", fecha_ejecucion: "2026-06-01" }),
    ot({ ot_number: 6, equipment_id: null, equipo_raw: "sin cargar", fecha_ejecucion: "2026-06-02" }),
  ];

  it("cuenta los dias observados desde la primera falla, no desde los 365", () => {
    // 2026-01-01 a 2026-10-15 inclusive
    expect(calcularMtbf(ORDENES, HASTA).diasObservados).toBe(288);
  });

  it("divide los dias observados por la cantidad de fallas", () => {
    const { filas } = calcularMtbf(ORDENES, HASTA);
    expect(filas[0].equipmentId).toBe("eq1");
    expect(filas[0].fallas).toBe(4);
    expect(filas[0].mtbf).toBeCloseTo(72, 0);
  });

  it("ordena por mtbf ascendente: el que mas falla primero", () => {
    expect(calcularMtbf(ORDENES, HASTA).filas.map((f) => f.equipmentId)).toEqual(["eq1", "eq2"]);
  });

  it("una falla sin equipo no genera fila y queda sin atribuir", () => {
    const r = calcularMtbf(ORDENES, HASTA);
    expect(r.filas.map((f) => f.equipmentId)).not.toContain(null);
    expect(r.sinAtribuir.map((f) => f.otNumber)).toEqual([6]);
  });

  it("reparte por especialidad, de mayor a menor", () => {
    const [eq1] = calcularMtbf(ORDENES, HASTA).filas;
    expect(eq1.porEspecialidad).toEqual([
      { especialidad: "MECÁNICO", cantidad: 3 },
      { especialidad: "ELÉCTRICO", cantidad: 1 },
    ]);
  });

  it("la tendencia trae doce meses, con cero en los que no hubo", () => {
    const [eq1] = calcularMtbf(ORDENES, HASTA).filas;
    expect(eq1.porMes).toHaveLength(12);
    expect(eq1.porMes.every((m) => typeof m.cantidad === "number")).toBe(true);
    // Febrero no tuvo ninguna y tiene que estar igual.
    expect(eq1.porMes.filter((m) => m.cantidad === 0).length).toBeGreaterThan(0);
  });

  it("marca el mes en curso para poder dibujarlo incompleto", () => {
    expect(calcularMtbf(ORDENES, HASTA).mesEnCurso).toBe(calcularMtbf(ORDENES, HASTA).filas[0].porMes[11].etiqueta);
  });

  it("sin ninguna falla no hay filas ni division por cero", () => {
    const r = calcularMtbf([], HASTA);
    expect(r.filas).toEqual([]);
    expect(r.diasObservados).toBe(0);
    expect(r.sinAtribuir).toEqual([]);
  });

  it("con menos de catorce dias observados no publica mtbf", () => {
    const r = calcularMtbf([ot({ fecha_ejecucion: "2026-10-14" })], HASTA);
    expect(r.diasObservados).toBe(2);
    expect(r.filas[0].mtbf).toBeNull();
    expect(r.filas[0].confiabilidades).toEqual([null, null]);
  });

  it("calcula las dos confiabilidades, en el orden de PLAZOS", () => {
    const [eq1] = calcularMtbf(ORDENES, HASTA).filas;
    expect(eq1.confiabilidades).toHaveLength(2);
    expect(eq1.confiabilidades[0]!).toBeGreaterThan(eq1.confiabilidades[1]!);
  });

  it("guarda la fecha de la ultima falla", () => {
    expect(calcularMtbf(ORDENES, HASTA).filas[0].ultima).toBe("2026-10-01");
  });

  /**
   * Dos trabajos distintos de la misma jornada son dos fallas. Agruparlos por
   * dia borraria la diferencia entre una maquina que se para una vez y una que
   * se para tres.
   */
  it("dos fallas del mismo equipo el mismo dia cuentan dos", () => {
    const r = calcularMtbf([
      ot({ ot_number: 1, fecha_ejecucion: "2026-01-01" }),
      ot({ ot_number: 2, fecha_ejecucion: "2026-05-01" }),
      ot({ ot_number: 3, fecha_ejecucion: "2026-05-01" }),
    ], HASTA);
    expect(r.filas[0].fallas).toBe(3);
  });
});

describe("el aviso de ritmo cambiado", () => {
  const HASTA = "2026-10-15";
  const muchas = (fechas: string[]): OtCruda[] =>
    fechas.map((f, i) => ot({ ot_number: i + 1, fecha_ejecucion: f }));

  it("no avisa con menos de seis fallas", () => {
    const r = calcularMtbf(muchas(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01"]), HASTA);
    expect(r.filas[0].ritmo).toBeNull();
  });

  it("avisa que mejoro cuando el mtbf reciente al menos duplica al de la ventana", () => {
    // 10 fallas en el verano, ninguna en los ultimos 90 dias
    const r = calcularMtbf(muchas([
      "2026-01-05", "2026-01-15", "2026-01-25", "2026-02-05", "2026-02-15",
      "2026-02-25", "2026-03-05", "2026-03-15", "2026-03-25", "2026-04-05",
    ]), HASTA);
    expect(r.filas[0].ritmo?.direccion).toBe("mejoro");
    expect(r.filas[0].ritmo?.mtbfReciente).toBeNull();
    expect(r.filas[0].ritmo?.factor).toBeNull();
  });

  it("avisa que empeoro cuando el mtbf reciente es la mitad o menos", () => {
    // 2 fallas en ocho meses y 6 en los ultimos 90 dias
    const r = calcularMtbf(muchas([
      "2026-01-05", "2026-03-05",
      "2026-08-01", "2026-08-15", "2026-09-01", "2026-09-15", "2026-10-01", "2026-10-10",
    ]), HASTA);
    expect(r.filas[0].ritmo?.direccion).toBe("empeoro");
    expect(r.filas[0].ritmo!.factor!).toBeLessThanOrEqual(0.5);
  });

  it("no avisa cuando el ritmo se mantuvo", () => {
    const r = calcularMtbf(muchas([
      "2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15",
      "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15",
    ]), HASTA);
    expect(r.filas[0].ritmo).toBeNull();
  });

  /**
   * Con menos de noventa dias observados, dividir los recientes por 90 compara
   * contra una ventana que nadie miro: seis fallas en veinte dias daban
   * "mejoro" cuando el ritmo era exactamente el mismo.
   */
  it("con pocos dias observados el ritmo no cambio y no avisa", () => {
    const r = calcularMtbf(muchas([
      "2026-09-26", "2026-09-29", "2026-10-02", "2026-10-05", "2026-10-08", "2026-10-11",
    ]), HASTA);
    expect(r.diasObservados).toBe(20);
    expect(r.filas[0].ritmo).toBeNull();
  });
});

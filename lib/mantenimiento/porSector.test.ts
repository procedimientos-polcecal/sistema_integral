import { describe, it, expect } from "vitest";
import { indicadoresPorSector, type OtDeSector } from "./porSector";

const HASTA = "2026-11-19";

let siguiente = 1;
const corr = (p: Partial<OtDeSector> = {}): OtDeSector => ({
  ot_number: siguiente++,
  tipo: "CORRECTIVO",
  fecha: null,
  fecha_ejecucion: null,
  sector_id: "A",
  horas: null,
  contratista: null,
  ...p,
});

/** Las `cuantas` fallas repartidas una por día hacia atrás desde `desde`. */
function unaPorDia(cuantas: number, desde: string, resto: Partial<OtDeSector> = {}) {
  const [a, m, d] = desde.split("-").map(Number);
  return Array.from({ length: cuantas }, (_, i) => {
    const f = new Date(Date.UTC(a, m - 1, d + i));
    return corr({ fecha_ejecucion: f.toISOString().slice(0, 10), ...resto });
  });
}

const delSector = (r: ReturnType<typeof indicadoresPorSector>, id: string) =>
  r.filas.find((f) => f.sectorId === id)!;

describe("indicadoresPorSector", () => {
  it("los días observados se cuentan por sector, desde su primera falla", () => {
    // Dividir por los 365 de la ventana le inventaría a B tres meses de buen
    // funcionamiento que nadie miró.
    const r = indicadoresPorSector([
      corr({ sector_id: "A", fecha_ejecucion: "2025-11-20" }),
      corr({ sector_id: "A", fecha_ejecucion: "2026-11-19" }),
      corr({ sector_id: "B", fecha_ejecucion: "2026-08-12" }),
      corr({ sector_id: "B", fecha_ejecucion: "2026-11-19" }),
    ], HASTA);

    expect(delSector(r, "A").diasObservados).toBe(365);
    expect(delSector(r, "B").diasObservados).toBe(100);
  });

  it("bajo el piso de días observados no publica mtbf, confiabilidad ni mttf", () => {
    // Los tres a la vez: publicar uno de los tres sin los otros es lo que hay
    // que evitar, porque el que sale solo parece medido.
    const r = indicadoresPorSector([
      corr({ fecha_ejecucion: "2026-11-18", horas: 3 }),
      corr({ fecha_ejecucion: "2026-11-19", horas: 3 }),
      corr({ fecha_ejecucion: "2026-11-19", horas: 3 }),
    ], HASTA);

    const a = delSector(r, "A");
    expect(a.diasObservados).toBe(2);
    expect(a.mtbf).toBeNull();
    expect(a.confiabilidad).toBeNull();
    expect(a.mttf).toBeNull();
    // La cuenta de reparaciones no depende del piso del MTBF: son dos cosas.
    expect(a.reparaciones).toBe(3);
    expect(a.mttr).toBeCloseTo(3);
  });

  it("el mttr cuenta las correctivas sin equipo enlazado", () => {
    // Es lo que lo separa de `reparacionesDeLaVentana()` de mttr.ts: para un
    // sector el dato que hace falta es `sector_id`, no el equipo.
    const r = indicadoresPorSector(
      unaPorDia(3, "2026-01-10", { horas: 6 }),
      HASTA
    );

    expect(delSector(r, "A").reparaciones).toBe(3);
    expect(delSector(r, "A").mttr).toBeCloseTo(6);
  });

  it("no cuenta las de contratista", () => {
    const r = indicadoresPorSector([
      ...unaPorDia(3, "2026-01-10", { horas: 6 }),
      ...unaPorDia(3, "2026-02-10", { horas: 100, contratista: "PIPARO" }),
    ], HASTA);

    // Las seis son fallas; sólo tres son reparaciones contables.
    expect(delSector(r, "A").fallas).toBe(6);
    expect(delSector(r, "A").reparaciones).toBe(3);
    expect(delSector(r, "A").mttr).toBeCloseTo(6);
  });

  it("no cuenta las que no tienen horas: cero no es «duró cero»", () => {
    const r = indicadoresPorSector([
      ...unaPorDia(3, "2026-01-10", { horas: 6 }),
      corr({ fecha_ejecucion: "2026-03-01", horas: null }),
      corr({ fecha_ejecucion: "2026-03-02", horas: 0 }),
      corr({ fecha_ejecucion: "2026-03-03", horas: -4 }),
    ], HASTA);

    expect(delSector(r, "A").reparaciones).toBe(3);
    expect(delSector(r, "A").mttr).toBeCloseTo(6);
  });

  it("sin llegar al piso de reparaciones no publica mttr ni mttf", () => {
    const r = indicadoresPorSector([
      ...unaPorDia(2, "2026-01-10", { horas: 6 }),
      ...unaPorDia(10, "2026-02-10"),
    ], HASTA);

    const a = delSector(r, "A");
    expect(a.reparaciones).toBe(2);
    expect(a.mttr).toBeNull();
    expect(a.mtbf).not.toBeNull();
    expect(a.mttf).toBeNull();
  });

  it("mttf es mtbf menos el mttr pasado a días", () => {
    // Tres fallas en 30 días observados → mtbf 10; 24 h de reparación → 1 día.
    const r = indicadoresPorSector(
      unaPorDia(3, "2026-10-21", { horas: 24 }),
      HASTA
    );

    const a = delSector(r, "A");
    expect(a.mtbf).toBeCloseTo(10);
    expect(a.mttr).toBeCloseTo(24);
    expect(a.mttf).toBeCloseTo(9);
  });

  it("el mttf nunca es negativo: se recorta en cero", () => {
    // 28 fallas en 14 días → mtbf 0,5 d; 48 h de reparación son 2 días.
    const r = indicadoresPorSector(
      unaPorDia(14, "2026-11-06", { horas: 48 }).flatMap((o) => [o, { ...o, ot_number: o.ot_number + 500 }]),
      HASTA
    );

    const a = delSector(r, "A");
    expect(a.fallas).toBe(28);
    expect(a.mtbf).toBeCloseTo(0.5);
    expect(a.mttf).toBe(0);
  });

  it("una falla ejecutada después de `hasta` no cuenta", () => {
    // Hay órdenes con fechas del futuro por errores de carga.
    const r = indicadoresPorSector([
      ...unaPorDia(3, "2026-01-10"),
      corr({ fecha_ejecucion: "2027-03-01" }),
    ], HASTA);

    expect(delSector(r, "A").fallas).toBe(3);
  });

  it("una falla anterior a la ventana no cuenta", () => {
    const r = indicadoresPorSector([
      ...unaPorDia(3, "2026-01-10"),
      corr({ fecha_ejecucion: "2025-11-19" }),
    ], HASTA);

    expect(delSector(r, "A").fallas).toBe(3);
  });

  it("fecha la falla por la ejecución y, sólo si falta, por la carga", () => {
    const r = indicadoresPorSector([
      corr({ sector_id: "A", fecha: "2026-01-02", fecha_ejecucion: "2026-06-30" }),
      corr({ sector_id: "B", fecha: "2026-06-30", fecha_ejecucion: null }),
    ], HASTA);

    expect(delSector(r, "A").ultima).toBe("2026-06-30");
    expect(delSector(r, "B").ultima).toBe("2026-06-30");
  });

  it("una orden sin sector no arma una fila: suma en sinSector", () => {
    const r = indicadoresPorSector([
      ...unaPorDia(3, "2026-01-10"),
      corr({ sector_id: null, fecha_ejecucion: "2026-02-01" }),
    ], HASTA);

    expect(r.sinSector).toBe(1);
    expect(r.filas).toHaveLength(1);
    expect(r.filas.every((f) => f.sectorId !== null)).toBe(true);
  });

  it("sólo mira las correctivas", () => {
    const r = indicadoresPorSector([
      ...unaPorDia(3, "2026-01-10"),
      corr({ tipo: "PROGRAMADO", fecha_ejecucion: "2026-02-01", horas: 99 }),
    ], HASTA);

    expect(delSector(r, "A").fallas).toBe(3);
  });

  it("ordena por mtbf ascendente y manda las sin mtbf al final", () => {
    const r = indicadoresPorSector([
      // A: 20 fallas en un año → el que menos aguanta.
      ...unaPorDia(20, "2025-12-01", { sector_id: "A" }),
      // B: 2 fallas en un año.
      corr({ sector_id: "B", fecha_ejecucion: "2025-12-01" }),
      corr({ sector_id: "B", fecha_ejecucion: "2026-11-01" }),
      // C: ventana observada de 2 días → sin mtbf.
      corr({ sector_id: "C", fecha_ejecucion: "2026-11-18" }),
      corr({ sector_id: "C", fecha_ejecucion: "2026-11-19" }),
    ], HASTA);

    expect(r.filas.map((f) => f.sectorId)).toEqual(["A", "B", "C"]);
    expect(r.filas[2].mtbf).toBeNull();
  });

  it("la confiabilidad es la probabilidad de aguantar siete días", () => {
    // Tres fallas en 30 días observados → mtbf 10 → e^(-7/10).
    const r = indicadoresPorSector(unaPorDia(3, "2026-10-21"), HASTA);

    expect(delSector(r, "A").confiabilidad).toBeCloseTo(Math.exp(-0.7), 6);
  });

  it("sin ninguna correctiva devuelve la lista vacía y no explota", () => {
    const r = indicadoresPorSector([], HASTA);

    expect(r.filas).toEqual([]);
    expect(r.sinSector).toBe(0);
  });
});

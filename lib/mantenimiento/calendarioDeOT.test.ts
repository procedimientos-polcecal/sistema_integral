import { describe, expect, it } from "vitest";
import {
  armarElCalendario,
  diasQueOcupa,
  type OrdenDelCalendario,
} from "./calendarioDeOT";
import type { GenteDelDia } from "./genteDelDia";

const orden = (
  ot_number: number,
  extra: Partial<OrdenDelCalendario> = {},
): OrdenDelCalendario => ({
  ot_number,
  fecha_ejecucion: null,
  fecha_ejecucion_pendiente: null,
  fecha_fin: null,
  especialidad: "MECANICO",
  tipo: "CORRECTIVO",
  quien: "PIPARO",
  descripcion: "Cambiar rodamiento",
  sector_raw: "Molienda",
  equipo_raw: "Molino 1",
  ...extra,
});

const NO_SE: GenteDelDia = { sabemos: false };

describe("que dias ocupa una OT", () => {
  it("sin fecha de fin, un solo dia", () => {
    expect(diasQueOcupa("2026-11-06", null)).toEqual(["2026-11-06"]);
  });

  it("con ventana, todos los dias inclusive", () => {
    expect(diasQueOcupa("2026-11-02", "2026-11-04")).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ]);
  });

  it("una ventana que cruza el mes no se pierde el primero del siguiente", () => {
    expect(diasQueOcupa("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("una fecha de fin igual al inicio es un solo dia", () => {
    expect(diasQueOcupa("2026-11-06", "2026-11-06")).toEqual(["2026-11-06"]);
  });

  /** Dato sucio de la planilla: no inventar un rango al reves. */
  it("una fecha de fin anterior al inicio se trata como un solo dia", () => {
    expect(diasQueOcupa("2026-11-06", "2026-11-01")).toEqual(["2026-11-06"]);
  });
});

describe("armar el calendario", () => {
  it("la OT aparece en todos sus dias, y solo el primero no es arrastre", () => {
    const cal = armarElCalendario(
      [orden(1, { fecha_ejecucion: "2026-11-02", fecha_fin: "2026-11-04" })],
      "2026-11-01",
      "2026-11-07",
      new Map(),
    );
    const marcas = cal.map((d) => d.ordenes.map((o) => o.arrastre));
    expect(marcas).toEqual([[], [false], [true], [true], [], [], []]);
  });

  it("los dias sin ordenes estan igual, vacios, y son uno por dia del rango", () => {
    const cal = armarElCalendario([], "2026-11-01", "2026-11-03", new Map());
    expect(cal.map((d) => d.dia)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(cal.every((d) => d.ordenes.length === 0)).toBe(true);
  });

  it("una ventana que empieza antes del rango pedido se recorta sin perder el arrastre", () => {
    const cal = armarElCalendario(
      [orden(1, { fecha_ejecucion: "2026-10-30", fecha_fin: "2026-11-02" })],
      "2026-11-01",
      "2026-11-30",
      new Map(),
    );
    // El inicio (30/10) queda afuera, así que el 01 y el 02 son continuación.
    expect(cal[0].ordenes.map((o) => o.arrastre)).toEqual([true]);
    expect(cal[1].ordenes.map((o) => o.arrastre)).toEqual([true]);
    expect(cal[2].ordenes).toEqual([]);
  });

  it("una ventana que sigue despues del rango no pinta dias de mas", () => {
    const cal = armarElCalendario(
      [orden(1, { fecha_ejecucion: "2026-11-29", fecha_fin: "2026-12-05" })],
      "2026-11-01",
      "2026-11-30",
      new Map(),
    );
    expect(cal).toHaveLength(30);
    expect(cal[28].ordenes.map((o) => o.arrastre)).toEqual([false]);
    expect(cal[29].ordenes.map((o) => o.arrastre)).toEqual([true]);
  });

  it("una ventana que termino antes del rango no aparece en ningun dia", () => {
    const cal = armarElCalendario(
      [orden(1, { fecha_ejecucion: "2026-10-20", fecha_fin: "2026-10-25" })],
      "2026-11-01",
      "2026-11-07",
      new Map(),
    );
    expect(cal.every((d) => d.ordenes.length === 0)).toBe(true);
  });

  it("una fecha de fin anterior al inicio no inventa un rango al reves", () => {
    const cal = armarElCalendario(
      [orden(1, { fecha_ejecucion: "2026-11-06", fecha_fin: "2026-11-01" })],
      "2026-11-01",
      "2026-11-10",
      new Map(),
    );
    expect(cal.filter((d) => d.ordenes.length > 0).map((d) => d.dia)).toEqual(["2026-11-06"]);
  });

  it("una fecha pendiente gana sobre la que devolvio la planilla", () => {
    const cal = armarElCalendario(
      [
        orden(1, {
          fecha_ejecucion: "2026-11-02",
          fecha_ejecucion_pendiente: "2026-11-09",
        }),
      ],
      "2026-11-01",
      "2026-11-10",
      new Map(),
    );
    expect(cal.filter((d) => d.ordenes.length > 0).map((d) => d.dia)).toEqual(["2026-11-09"]);
  });

  it("una OT sin ninguna fecha no aparece en ningun dia", () => {
    const cal = armarElCalendario([orden(1)], "2026-11-01", "2026-11-03", new Map());
    expect(cal.every((d) => d.ordenes.length === 0)).toBe(true);
  });

  it("no filtra por estado: lo que llega es lo que se muestra", () => {
    const cal = armarElCalendario(
      [
        orden(1, { fecha_ejecucion: "2026-11-02" }),
        orden(2, { fecha_ejecucion: "2026-11-02" }),
      ],
      "2026-11-02",
      "2026-11-02",
      new Map(),
    );
    expect(cal[0].ordenes.map((o) => o.ot_number)).toEqual([1, 2]);
  });

  it("copia los campos que la grilla necesita", () => {
    const cal = armarElCalendario(
      [orden(7, { fecha_ejecucion: "2026-11-02" })],
      "2026-11-02",
      "2026-11-02",
      new Map(),
    );
    expect(cal[0].ordenes[0]).toEqual({
      ot_number: 7,
      especialidad: "MECANICO",
      tipo: "CORRECTIVO",
      quien: "PIPARO",
      descripcion: "Cambiar rodamiento",
      sector_raw: "Molienda",
      equipo_raw: "Molino 1",
      arrastre: false,
    });
  });

  it("la gente de cada dia sale del mapa, y un dia que falta es 'no se'", () => {
    const hay: GenteDelDia = {
      sabemos: true,
      porOficio: { mecanico: 3, electricista: 1, lubricador: 0 },
    };
    const cal = armarElCalendario(
      [],
      "2026-11-02",
      "2026-11-03",
      new Map([["2026-11-02", hay]]),
    );
    expect(cal[0].gente).toEqual(hay);
    expect(cal[1].gente).toEqual(NO_SE);
  });
});

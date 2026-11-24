import { describe, it, expect } from "vitest";
import type { DiaDelCalendario } from "./calendarioDeOT";
import { SIN_FILTROS, type Filtros } from "./filtrosDelCalendario";
import {
  resumenDelDia, indicadoresDelMes, indicadoresDeHoy, recorteDeLaHoja,
} from "./resumenImpreso";

type Orden = DiaDelCalendario["ordenes"][number];

function orden(p: Partial<Orden> & { ot_number: number }): Orden {
  return {
    id: `id-${p.ot_number}`,
    especialidad: "MECÁNICO",
    tipo: "CORRECTIVO",
    quien: "TALLER",
    descripcion: null,
    sector_raw: null,
    equipo_raw: null,
    arrastre: false,
    app_created: null,
    estado: "POR_HACER",
    fecha_ejecucion: null,
    atrasada: false,
    diasDeAtraso: null,
    operario_1: null,
    operario_2: null,
    operario_3: null,
    ...p,
  };
}

function dia(fecha: string, ordenes: Orden[]): DiaDelCalendario {
  return { dia: fecha, ordenes, gente: { sabemos: false } };
}

function filtros(p: Partial<Filtros> = {}): Filtros {
  return { ...SIN_FILTROS, ...p };
}

describe("resumenDelDia", () => {
  it("cuenta el total del día y lo desglosa por letra", () => {
    const d = dia("2026-11-10", [
      orden({ ot_number: 1, especialidad: "MECÁNICO" }),
      orden({ ot_number: 2, especialidad: "MECÁNICO" }),
      orden({ ot_number: 3, especialidad: "ELÉCTRICO" }),
    ]);
    const r = resumenDelDia(d, SIN_FILTROS);
    expect(r.total).toBe(3);
    expect(r.porLetra).toEqual([
      { letra: "M", cantidad: 2 },
      { letra: "E", cantidad: 1 },
    ]);
  });

  it("saltea las letras que están en cero", () => {
    const d = dia("2026-11-10", [orden({ ot_number: 1, especialidad: "CIVIL" })]);
    expect(resumenDelDia(d, SIN_FILTROS).porLetra).toEqual([{ letra: "C", cantidad: 1 }]);
  });

  it("cuenta las atrasadas aparte, y una atrasada también suma a su letra", () => {
    const d = dia("2026-11-10", [
      orden({ ot_number: 1, especialidad: "MECÁNICO", atrasada: true }),
      orden({ ot_number: 2, especialidad: "MECÁNICO" }),
    ]);
    const r = resumenDelDia(d, SIN_FILTROS);
    expect(r.atrasadas).toBe(1);
    expect(r.total).toBe(2);
    expect(r.porLetra).toEqual([{ letra: "M", cantidad: 2 }]);
  });

  it("respeta el filtro: con especialidad ELÉCTRICO no cuenta las mecánicas", () => {
    const d = dia("2026-11-10", [
      orden({ ot_number: 1, especialidad: "MECÁNICO", atrasada: true }),
      orden({ ot_number: 2, especialidad: "ELÉCTRICO" }),
    ]);
    const r = resumenDelDia(d, filtros({ especialidad: "ELÉCTRICO" }));
    expect(r.total).toBe(1);
    expect(r.atrasadas).toBe(0);
    expect(r.porLetra).toEqual([{ letra: "E", cantidad: 1 }]);
  });
});

describe("indicadoresDelMes", () => {
  it("cuenta cada OT una sola vez aunque ocupe varios días", () => {
    const dias = [
      dia("2026-11-10", [orden({ ot_number: 1 })]),
      dia("2026-11-11", [orden({ ot_number: 1, arrastre: true })]),
      dia("2026-11-12", [orden({ ot_number: 1, arrastre: true })]),
    ];
    const r = indicadoresDelMes(dias, "2026-11", SIN_FILTROS);
    expect(r.total).toBe(1);
    expect(r.porLetra).toEqual([{ letra: "M", cantidad: 1 }]);
  });

  it("no cuenta los días de relleno que son de otro mes", () => {
    const dias = [
      dia("2026-10-28", [orden({ ot_number: 90 })]),
      dia("2026-11-02", [orden({ ot_number: 91 })]),
      dia("2026-12-03", [orden({ ot_number: 92 })]),
    ];
    expect(indicadoresDelMes(dias, "2026-11", SIN_FILTROS).total).toBe(1);
  });

  it("diaMasCargado devuelve el día con más órdenes, contando arrastres", () => {
    const dias = [
      dia("2026-11-10", [orden({ ot_number: 1 }), orden({ ot_number: 2 })]),
      dia("2026-11-11", [
        orden({ ot_number: 1, arrastre: true }),
        orden({ ot_number: 2, arrastre: true }),
        orden({ ot_number: 3 }),
      ]),
    ];
    const r = indicadoresDelMes(dias, "2026-11", SIN_FILTROS);
    expect(r.diaMasCargado).toEqual({ dia: "2026-11-11", cantidad: 3 });
    // Y la cuenta del mes no es la suma de los días: son tres órdenes, no cinco.
    expect(r.total).toBe(3);
  });

  it("diaMasCargado es null si el mes no tiene ninguna orden", () => {
    const dias = [dia("2026-11-10", []), dia("2026-11-11", [])];
    const r = indicadoresDelMes(dias, "2026-11", SIN_FILTROS);
    expect(r.diaMasCargado).toBeNull();
    expect(r.total).toBe(0);
    expect(r.atrasadas).toBe(0);
    expect(r.porLetra).toEqual([]);
  });

  it("cuenta las atrasadas una sola vez, como el total", () => {
    const dias = [
      dia("2026-11-10", [orden({ ot_number: 1, atrasada: true })]),
      dia("2026-11-11", [orden({ ot_number: 1, arrastre: true, atrasada: true })]),
    ];
    expect(indicadoresDelMes(dias, "2026-11", SIN_FILTROS).atrasadas).toBe(1);
  });
});

describe("indicadoresDeHoy", () => {
  it("devuelve null si hoy no está entre los días que llegaron", () => {
    const dias = [dia("2026-11-10", []), dia("2026-11-11", [])];
    expect(indicadoresDeHoy(dias, "2026-12-01", SIN_FILTROS)).toBeNull();
  });

  it("cuenta las de hoy, las atrasadas de hoy y las que no tienen ningún operario", () => {
    const dias = [
      dia("2026-11-10", [orden({ ot_number: 99 })]),
      dia("2026-11-11", [
        orden({ ot_number: 1, atrasada: true }),
        orden({ ot_number: 2, operario_1: "PÉREZ" }),
        orden({ ot_number: 3 }),
      ]),
    ];
    expect(indicadoresDeHoy(dias, "2026-11-11", SIN_FILTROS)).toEqual({
      total: 3, atrasadas: 1, sinOperario: 2,
    });
  });

  it("una orden con operario_2 puesto y los otros dos en null NO cuenta como sin operario", () => {
    const dias = [dia("2026-11-11", [orden({ ot_number: 1, operario_2: "GÓMEZ" })])];
    expect(indicadoresDeHoy(dias, "2026-11-11", SIN_FILTROS)?.sinOperario).toBe(0);
  });

  it("un operario que es sólo espacios cuenta como sin operario", () => {
    const dias = [dia("2026-11-11", [orden({ ot_number: 1, operario_1: "   " })])];
    expect(indicadoresDeHoy(dias, "2026-11-11", SIN_FILTROS)?.sinOperario).toBe(1);
  });

  it("respeta el filtro", () => {
    const dias = [
      dia("2026-11-11", [
        orden({ ot_number: 1, especialidad: "MECÁNICO" }),
        orden({ ot_number: 2, especialidad: "ELÉCTRICO", atrasada: true }),
      ]),
    ];
    expect(indicadoresDeHoy(dias, "2026-11-11", filtros({ especialidad: "ELÉCTRICO" }))).toEqual({
      total: 1, atrasadas: 1, sinOperario: 1,
    });
  });
});

describe("recorteDeLaHoja", () => {
  it("con menos órdenes que el tope no deja ninguna afuera", () => {
    const r = recorteDeLaHoja([1, 2, 3], 60);
    expect(r.visibles).toEqual([1, 2, 3]);
    expect(r.afuera).toBe(0);
  });

  it("con 356 órdenes y tope 60 devuelve 60 visibles y 296 afuera", () => {
    const muchas = Array.from({ length: 356 }, (_, i) => i);
    const r = recorteDeLaHoja(muchas, 60);
    expect(r.visibles).toHaveLength(60);
    expect(r.afuera).toBe(296);
    expect(r.visibles[0]).toBe(0);
    expect(r.visibles[59]).toBe(59);
  });

  it("justo en el tope no deja nada afuera", () => {
    const r = recorteDeLaHoja([1, 2, 3], 3);
    expect(r.visibles).toHaveLength(3);
    expect(r.afuera).toBe(0);
  });
});

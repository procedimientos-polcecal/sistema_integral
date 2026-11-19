import { describe, expect, it } from "vitest";
import {
  diasParaLlegarA,
  porQueNoSePuedeMover,
  porQueNoSePuedeMoverA,
  type OrdenQueSeMueve,
} from "./moverLaOT";
import { MAXIMO_DE_DIAS } from "./postergar";

const orden = (extra: Partial<OrdenQueSeMueve> = {}): OrdenQueSeMueve => ({
  app_created: true,
  estado: "POR_HACER",
  fecha_ejecucion: "2026-11-10",
  ...extra,
});

describe("cuantos dias hay de una fecha a otra", () => {
  it("el mismo dia es cero", () => {
    expect(diasParaLlegarA("2026-11-10", "2026-11-10")).toBe(0);
  });

  it("cuenta hacia adelante", () => {
    expect(diasParaLlegarA("2026-11-10", "2026-11-17")).toBe(7);
  });

  it("hacia atras da negativo", () => {
    expect(diasParaLlegarA("2026-11-10", "2026-11-03")).toBe(-7);
  });

  it("cruza el mes y el anio", () => {
    expect(diasParaLlegarA("2026-12-28", "2027-01-04")).toBe(7);
  });

  /**
   * El 31/10 Argentina no cambia la hora desde 2009, pero el cálculo igual se
   * hace en UTC a propósito: una fecha sin hora no tiene huso, y el día que
   * alguien corra esto en una máquina con horario de verano, una resta hecha en
   * hora local daría 6,958 días y `Math.round` taparía la mitad de los casos.
   */
  it("un cambio de hora no corre el dia", () => {
    expect(diasParaLlegarA("2026-10-28", "2026-11-04")).toBe(7);
  });
});

describe("que orden se puede mover", () => {
  it("una del sistema, con fecha y abierta, se puede", () => {
    expect(porQueNoSePuedeMover(orden())).toBeNull();
  });

  it("la que entro por el formulario no, y lo dice", () => {
    const motivo = porQueNoSePuedeMover(orden({ app_created: false }));
    expect(motivo).toContain("formulario");
  });

  it("app_created en null se trata como del formulario", () => {
    expect(porQueNoSePuedeMover(orden({ app_created: null }))).toContain("formulario");
  });

  it("sin fecha de inicio no hay de donde correrla", () => {
    expect(porQueNoSePuedeMover(orden({ fecha_ejecucion: null }))).toContain("fecha de inicio");
  });

  it("una cerrada no, por los dos estados", () => {
    expect(porQueNoSePuedeMover(orden({ estado: "REALIZADO" }))).toContain("cerrada");
    expect(porQueNoSePuedeMover(orden({ estado: "SUSPENDIDA" }))).toContain("cerrada");
  });

  it("un estado desconocido no la traba", () => {
    expect(porQueNoSePuedeMover(orden({ estado: "LO_QUE_SEA" }))).toBeNull();
    expect(porQueNoSePuedeMover(orden({ estado: null }))).toBeNull();
  });
});

describe("a que dia se puede mover", () => {
  it("un dia posterior y dentro del tope se puede", () => {
    expect(porQueNoSePuedeMoverA(orden(), "2026-11-17")).toBeNull();
  });

  it("el dia en el que ya esta, no", () => {
    expect(porQueNoSePuedeMoverA(orden(), "2026-11-10")).toContain("hacia adelante");
  });

  it("un dia anterior, no", () => {
    expect(porQueNoSePuedeMoverA(orden(), "2026-11-03")).toContain("hacia adelante");
  });

  it("el dia 90 entra y el 91 no", () => {
    const o = orden({ fecha_ejecucion: "2026-01-01" });
    const justo = "2026-04-01"; // 31 + 28 + 31 = 90 dias
    expect(diasParaLlegarA("2026-01-01", justo)).toBe(MAXIMO_DE_DIAS);
    expect(porQueNoSePuedeMoverA(o, justo)).toBeNull();
    expect(porQueNoSePuedeMoverA(o, "2026-04-02")).toContain(String(MAXIMO_DE_DIAS));
  });

  /**
   * Lo que esto fija es el encabezado del módulo: una orden que la grilla pinta
   * en la pendiente se mueve contra `fecha_ejecucion`. Si algún día alguien le
   * pasa la fecha que ve en pantalla, este test no lo atrapa —recibe un solo
   * campo— pero el nombre del campo sí lo dice.
   */
  it("el tope se cuenta contra fecha_ejecucion y no contra la que se ve", () => {
    const o = orden({ fecha_ejecucion: "2026-11-10" });
    expect(porQueNoSePuedeMoverA(o, "2026-11-11")).toBeNull();
  });

  it("lo que traba a la orden entera gana sobre el dia", () => {
    const o = orden({ app_created: false });
    expect(porQueNoSePuedeMoverA(o, "2026-11-17")).toContain("formulario");
  });

  it("sin fecha de inicio no revienta al elegir un dia", () => {
    const o = orden({ fecha_ejecucion: null });
    expect(porQueNoSePuedeMoverA(o, "2026-11-17")).toContain("fecha de inicio");
  });
});

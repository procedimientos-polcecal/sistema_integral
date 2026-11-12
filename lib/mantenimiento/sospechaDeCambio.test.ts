import { describe, it, expect } from "vitest";
import {
  pareceUnCambio, sospechasDeCambio,
  type CerradaParaMirar,
} from "./sospechaDeCambio";

describe("pareceUnCambio", () => {
  it("reconoce las formas que usa la planta", () => {
    for (const t of [
      "Cambio de martillos",
      "Se cambian martillos",
      "Cambio de 20 grillas y cambio de martillos",
      "Se colocan martillos nuevos",
      "Cambio de martillos y brazos",
      "Cambio de martillos y grillas",
    ]) {
      expect(pareceUnCambio(t, "Martillos"), t).toBe(true);
    }
  });

  it("una rotacion no es un cambio, aunque cambie otra cosa", () => {
    for (const t of [
      "Rotación de martillos y cambio de grillas",
      "Se rotan martillos a 2da cara y se cambian 3 grillas de 2mm",
      "Se cambian grillas y se rotan martillos",
      "Rotación de martillos, cambio de grillas y se coloco fieltro",
      "Se rotan martillos a 3ra cara, y se cambian grillas",
    ]) {
      expect(pareceUnCambio(t, "Martillos"), t).toBe(false);
    }
  });

  // Los dos que la calibración contra las 250 OT reales encontró que faltaban.
  it("reconoce el componente en una enumeracion", () => {
    expect(pareceUnCambio("Cambio de brazos y martillos", "Martillos")).toBe(true);
    expect(pareceUnCambio("Cambio de grillas y martillos recuperados de filler 3 4ta cara", "Martillos"))
      .toBe(true);
  });

  // Y el falso positivo que la enumeración no puede traer: la `y` enumera
  // piezas, la `de` arma el nombre de la máquina.
  it("el nombre del equipo no es un cambio de la pieza", () => {
    expect(pareceUnCambio("Cambio de correas a rompedora de martillos", "Martillos")).toBe(false);
    expect(pareceUnCambio("Cambio de rotor, rompedora a martillos.", "Martillos")).toBe(false);
  });

  it("sin el componente nombrado no sospecha", () => {
    expect(pareceUnCambio("Cambio de correas a rompedora", "Martillos")).toBe(false);
    expect(pareceUnCambio("Cambio de grillas", "Martillos")).toBe(false);
    expect(pareceUnCambio(null, "Martillos")).toBe(false);
    expect(pareceUnCambio("", "Martillos")).toBe(false);
  });
});

describe("sospechasDeCambio", () => {
  const ciclo = {
    id: "c1", equipment_id: "e1", equipo: "PO-C1-04",
    desde: "2026-11-03", componente: "Martillos",
  };
  const cerrada = (p: Partial<CerradaParaMirar>): CerradaParaMirar => ({
    ot_number: 1, equipment_id: "e1", descripcion: "Cambio de martillos",
    fecha_cierre: "2026-11-09", ciclo_id: null, ...p,
  });

  it("avisa de un cambio ajeno posterior a desde", () => {
    expect(sospechasDeCambio([ciclo], [cerrada({ ot_number: 70 })]))
      .toEqual([{ ciclo_id: "c1", equipment_id: "e1", equipo: "PO-C1-04", ot: [70] }]);
  });

  it("junta las varias de un mismo ciclo", () => {
    const filas = [cerrada({ ot_number: 70 }), cerrada({ ot_number: 71 })];
    expect(sospechasDeCambio([ciclo], filas)[0].ot).toEqual([70, 71]);
  });

  // El corte es lo único que hace que este aviso se apague solo.
  it("no mira lo cerrado antes de desde", () => {
    expect(sospechasDeCambio([ciclo], [cerrada({ fecha_cierre: "2026-10-30" })]))
      .toEqual([]);
  });

  it("la OT del propio ciclo no es sospechosa", () => {
    expect(sospechasDeCambio([ciclo], [cerrada({ ciclo_id: "c1" })])).toEqual([]);
  });

  it("un ciclo sin arrancar no sospecha nada", () => {
    expect(sospechasDeCambio([{ ...ciclo, desde: null }], [cerrada({})])).toEqual([]);
  });

  it("no mezcla equipos", () => {
    expect(sospechasDeCambio([ciclo], [cerrada({ equipment_id: "e2" })])).toEqual([]);
  });

  it("una cerrada sin fecha no se puede ubicar y no sospecha", () => {
    expect(sospechasDeCambio([ciclo], [cerrada({ fecha_cierre: null })])).toEqual([]);
  });

  it("sin sospechas no devuelve el ciclo", () => {
    expect(sospechasDeCambio([ciclo], [cerrada({ descripcion: "Rotación de martillos" })]))
      .toEqual([]);
  });
});

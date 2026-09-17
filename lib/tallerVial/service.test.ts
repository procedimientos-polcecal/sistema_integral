import { describe, it, expect } from "vitest";
import {
  estadoDeServicePorEquipo, esTierDeServiceValido, ultimaLecturaPorEquipo, type ServicePlano,
} from "./service";

function service(p: Partial<ServicePlano>): ServicePlano {
  return { id: "x", equipoId: "EM1", tier: 250, fecha: "2026-01-01", horometro: 0, ...p };
}

describe("esTierDeServiceValido", () => {
  it("acepta los cuatro escalones", () => {
    expect(esTierDeServiceValido(250)).toBe(true);
    expect(esTierDeServiceValido(2000)).toBe(true);
  });

  it("rechaza cualquier otro número", () => {
    expect(esTierDeServiceValido(300)).toBe(false);
    expect(esTierDeServiceValido("250")).toBe(false);
  });
});

describe("estadoDeServicePorEquipo", () => {
  it("sin ningún service cargado, los cuatro escalones quedan sin lectura", () => {
    const estado = estadoDeServicePorEquipo([], 500);
    expect(estado.every((e) => e.lectura === null)).toBe(true);
    expect(estado.every((e) => e.ultimoHorometro === null)).toBe(true);
  });

  it("un service de 250 sólo cubre el escalón de 250", () => {
    const estado = estadoDeServicePorEquipo([service({ tier: 250, horometro: 1000 })], 1000);
    const de250 = estado.find((e) => e.tier === 250)!;
    const de500 = estado.find((e) => e.tier === 500)!;
    expect(de250.ultimoHorometro).toBe(1000);
    expect(de250.proximoVencimiento).toBe(1250);
    expect(de500.ultimoHorometro).toBeNull(); // el de 250 no cubre al de 500
  });

  // Cascada confirmada con el usuario: el de 1000 también cuenta como hecho
  // el de 500 y el de 250, en el mismo horómetro.
  it("un service de 1000 cubre también el de 500 y el de 250 (cascada)", () => {
    const estado = estadoDeServicePorEquipo([service({ tier: 1000, horometro: 7000 })], 7000);
    const por250 = Object.fromEntries(estado.map((e) => [e.tier, e]));
    expect(por250[250].ultimoHorometro).toBe(7000);
    expect(por250[250].proximoVencimiento).toBe(7250);
    expect(por250[500].ultimoHorometro).toBe(7000);
    expect(por250[500].proximoVencimiento).toBe(7500);
    expect(por250[1000].ultimoHorometro).toBe(7000);
    expect(por250[1000].proximoVencimiento).toBe(8000);
    expect(por250[2000].ultimoHorometro).toBeNull(); // el de 1000 no cubre al de 2000
  });

  it("toma el mayor horómetro cuando hay más de un service que cubre el mismo escalón", () => {
    const estado = estadoDeServicePorEquipo(
      [service({ tier: 250, horometro: 1000 }), service({ tier: 1000, horometro: 500 })],
      1000
    );
    const de250 = estado.find((e) => e.tier === 250)!;
    // El de 250 a horómetro 1000 es más nuevo que el de 1000 a horómetro 500.
    expect(de250.ultimoHorometro).toBe(1000);
  });

  it("VENCIDO cuando ya se pasó el horómetro actual", () => {
    const estado = estadoDeServicePorEquipo([service({ tier: 250, horometro: 1000 })], 1260);
    expect(estado.find((e) => e.tier === 250)!.lectura).toBe("VENCIDO");
  });

  it("PROXIMO dentro del margen, AL_DIA lejos del vencimiento", () => {
    const proximo = estadoDeServicePorEquipo([service({ tier: 250, horometro: 1000 })], 1210); // faltan 40
    expect(proximo.find((e) => e.tier === 250)!.lectura).toBe("PROXIMO");

    const alDia = estadoDeServicePorEquipo([service({ tier: 250, horometro: 1000 })], 1100); // faltan 150
    expect(alDia.find((e) => e.tier === 250)!.lectura).toBe("AL_DIA");
  });

  it("sin horómetro actual conocido, no hay horas faltantes ni lectura aunque haya service cargado", () => {
    const estado = estadoDeServicePorEquipo([service({ tier: 250, horometro: 1000 })], null);
    const de250 = estado.find((e) => e.tier === 250)!;
    expect(de250.proximoVencimiento).toBe(1250); // esto sí se puede calcular
    expect(de250.horasFaltantes).toBeNull();
    expect(de250.lectura).toBeNull();
  });
});

describe("ultimaLecturaPorEquipo", () => {
  it("la lectura de la fecha más reciente, ignorando las cargas sin lectura", () => {
    const mapa = ultimaLecturaPorEquipo([
      { equipoId: "EM1", fecha: "2026-09-01", lectura: 100 },
      { equipoId: "EM1", fecha: "2026-09-10", lectura: null },
      { equipoId: "EM1", fecha: "2026-09-05", lectura: 150 },
    ]);
    expect(mapa.get("EM1")).toBe(150);
  });

  it("un equipo sin ninguna lectura no aparece en el mapa", () => {
    const mapa = ultimaLecturaPorEquipo([{ equipoId: "EM1", fecha: "2026-09-01", lectura: null }]);
    expect(mapa.has("EM1")).toBe(false);
  });
});

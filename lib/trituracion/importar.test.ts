import { describe, expect, it } from "vitest";
import { serialDelDia } from "@/lib/core/fechaDeSheets";
import { parteDeFilaCruda, partesDe2026 } from "./importar";

const SERIAL_2_JUN_2026 = serialDelDia("2026-06-02")!;
const SERIAL_4_JUN_2026 = serialDelDia("2026-06-04")!;

// horaDeCelda se mudó a lib/core/horaDeCelda.ts (con sus tests) cuando Taller Vial la necesitó también.

describe("parteDeFilaCruda", () => {
  it("parsea una fila real operativa (PLANTA 1, 2/6/2026, serial de fecha)", () => {
    const fila = [
      SERIAL_2_JUN_2026, "", "Chocolata", "C3", 4 / 24 + 40 / 1440, 11 / 24 + 30 / 1440,
      6.833333333333333, "", 1.166666666666667, "", "", 1.166666666666667,
      5.666666666666666, 0.8292682926829268, 44, 542, 12.318181818181818,
      79.31707317073172, 95.64705882352942,
    ];
    const p = parteDeFilaCruda(fila);
    expect(p).not.toBeNull();
    expect(p!.fecha).toBe("2026-06-02");
    expect(p!.estado).toBe("opero"); // Estado en blanco en Planta 1 = operó
    expect(p!.material).toBe("Chocolata");
    expect(p!.origen).toBe("C3");
    expect(p!.hora_inicio).toBe("04:40");
    expect(p!.hora_fin).toBe("11:30");
    expect(p!.horas_falta_piedra).toBeCloseTo(1.1667, 3);
    expect(p!.camiones_llegados).toBe(44);
    expect(p!.toneladas_procesadas).toBe(542);
  });

  it("una fila 'No operó' guarda el motivo desde Observaciones y no material/horario", () => {
    const fila = [SERIAL_4_JUN_2026, "No operó", "", "", "", "", 0, "", 8, "", "", 8, 0, 0, "", "", 0, 0, 0, "Lluvia"];
    const p = parteDeFilaCruda(fila);
    expect(p).not.toBeNull();
    expect(p!.estado).toBe("no_opero");
    expect(p!.motivo_no_operativo).toBe("Lluvia");
    expect(p!.material).toBeNull();
    expect(p!.hora_inicio).toBeNull();
    expect(p!.observaciones).toBeNull();
  });

  it("una fila sin ningún dato real (sólo la fecha pre-rellenada) se descarta", () => {
    const fila = [SERIAL_2_JUN_2026 + 10, "", "", "", "", "", 0, "", "", "", "", 0, 0, 0, "", "", 0, 0, 0];
    expect(parteDeFilaCruda(fila)).toBeNull();
  });

  it("descarta filas fuera de 2026 aunque tengan datos (ruido de fórmula a futuro)", () => {
    // Serial de una fecha de 2029.
    const fila = ["17/4/2029", "", "", "", "", "", 0, "", "", "", "", 0, 0, 0, "", "", 0, 0, 0];
    expect(parteDeFilaCruda(fila)).toBeNull();
  });
});

describe("partesDe2026", () => {
  it("salta las 3 filas de encabezado y cuenta las descartadas", () => {
    const encabezados = [["t1"], ["t2"], ["t3"]];
    const filas = [
      ...encabezados,
      [SERIAL_2_JUN_2026, "", "Chocolata", "C3", 0.194444, 0.479167, 6.83, "", 1.17, "", "", 1.17, 5.67, 0.83, 44, 542, 12.3, 79.3, 95.6],
      [SERIAL_2_JUN_2026 + 1, "", "", "", "", "", 0, "", "", "", "", 0, 0, 0, "", "", 0, 0, 0],
    ];
    const { partes, saltadas } = partesDe2026(filas);
    expect(partes).toHaveLength(1);
    expect(saltadas).toBe(1);
  });

  it("combina dos filas del mismo día en un solo parte, sumando toneladas y camiones (caso real: Planta 1, 16/07/2026)", () => {
    const encabezados = [["t1"], ["t2"], ["t3"]];
    const filas = [
      ...encabezados,
      // 04:50–11:00, Caliza/PEZZUCCHI, 26 camiones, 520 t
      [SERIAL_2_JUN_2026, "Operó", "Caliza", "PEZZUCCHI", 0.2013888888888889, 0.4583333333333333, 6.17, "", 1.8, "", "", 1.8, 4.37, 0.71, 26, 520, 20, 84.3, 119.1],
      // 11:30–15:00, Chocolata/ACOPIO, 30 camiones, 600 t
      [SERIAL_2_JUN_2026, "Operó", "Chocolata", "ACOPIO", 0.4791666666666667, 0.625, 3.5, "", 4.5, "", "", 4.5, 0, 0, 30, 600, 20, 171.4, 0],
    ];
    const { partes, saltadas } = partesDe2026(filas);
    expect(saltadas).toBe(0);
    expect(partes).toHaveLength(1);
    const p = partes[0];
    expect(p.material).toBe("Caliza + Chocolata");
    expect(p.origen).toBe("PEZZUCCHI + ACOPIO");
    expect(p.hora_inicio).toBe("04:50");
    expect(p.hora_fin).toBe("15:00");
    expect(p.camiones_llegados).toBe(56);
    expect(p.toneladas_procesadas).toBe(1120);
    expect(p.horas_falta_piedra).toBeCloseTo(6.3, 2);
    expect(p.observaciones).toContain("2 registros");
  });
});

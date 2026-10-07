import { describe, it, expect } from "vitest";
import {
  avisoDeDescartadas, diasVacios, nombreDelLote, resolverEmpleados, sumarConAbiertasPrevias,
} from "./preparar";
import { toUtcDateOnly } from "../dates";
import type { DiaMarcacionesTokens } from "../excelImport";
import type { DiasDeEmpleado } from "../fichadas/decidir";

function dia(y: number, m: number, d: number) {
  return toUtcDateOnly(y, m - 1, d);
}

describe("nombreDelLote", () => {
  it("lleva las fechas en d/m, no en m/d", () => {
    expect(nombreDelLote(dia(2026, 9, 30), dia(2026, 10, 6))).toBe("Lenox API · 30/09 → 06/10");
  });

  it("rellena el día y el mes con cero", () => {
    expect(nombreDelLote(dia(2026, 1, 2), dia(2026, 2, 3))).toBe("Lenox API · 02/01 → 03/02");
  });
});

describe("avisoDeDescartadas", () => {
  const nada = { sinLegajo: 0, fechaIlegible: 0, horaIlegible: 0, fueraDeRango: 0 };

  it("si se usó todo, no avisa", () => {
    expect(avisoDeDescartadas(nada, 735)).toBeNull();
  });

  it("con cero marcaciones traídas tampoco avisa: no hay nada que se haya perdido", () => {
    expect(avisoDeDescartadas(nada, 0)).toBeNull();
  });

  it("si TODAS quedaron fuera de rango, lo dice con el total: es el desfase de huso", () => {
    expect(avisoDeDescartadas({ ...nada, fueraDeRango: 735 }, 735)).toBe(
      "Lenox devolvió 735 marcaciones que no se usaron, de 735 en total " +
        "(0 sin legajo, 0 con fecha ilegible, 0 con hora ilegible, 735 fuera del rango pedido)"
    );
  });

  it("suma los cuatro motivos y los desglosa", () => {
    const aviso = avisoDeDescartadas({ sinLegajo: 1, fechaIlegible: 2, horaIlegible: 3, fueraDeRango: 4 }, 100)!;
    expect(aviso).toContain("10 marcaciones");
    expect(aviso).toContain("(1 sin legajo, 2 con fecha ilegible, 3 con hora ilegible, 4 fuera del rango pedido)");
  });

  it("un solo motivo alcanza para avisar", () => {
    expect(avisoDeDescartadas({ ...nada, horaIlegible: 1 }, 50)).toContain("1 marcaciones");
  });
});

describe("resolverEmpleados", () => {
  const dias: DiaMarcacionesTokens[] = [{ fecha: dia(2026, 10, 1), tokens: [{ tipo: "E", hora: "07:00" }] }];

  it("enlaza cada legajo con su empleado", () => {
    const { empleados, avisos } = resolverEmpleados(
      new Map([["PC_204", dias]]),
      new Map([["PC_204", "id-204"]])
    );
    expect(avisos).toEqual([]);
    expect(empleados).toEqual([{ empleadoId: "id-204", legajo: "PC_204", dias }]);
  });

  it("un legajo que el SdG no tiene queda afuera y se informa, sin buscarle uno parecido", () => {
    // PC_241 y PC_24 se parecen y no se enlazan: un enlace equivocado no se nota nunca.
    const { empleados, avisos } = resolverEmpleados(
      new Map([["PC_241", dias], ["PC_204", dias]]),
      new Map([["PC_204", "id-204"], ["PC_24", "id-24"]])
    );
    expect(empleados.map((e) => e.legajo)).toEqual(["PC_204"]);
    expect(avisos).toEqual(["Legajo PC_241: Lenox tiene marcaciones pero el legajo no existe en el SdG"]);
  });

  it("sin marcaciones no hay nada que resolver", () => {
    expect(resolverEmpleados(new Map(), new Map([["PC_204", "id-204"]]))).toEqual({ empleados: [], avisos: [] });
  });
});

describe("diasVacios", () => {
  it("un día por cada fecha del rango, los dos extremos incluidos, sin marcas", () => {
    expect(diasVacios(dia(2026, 9, 30), dia(2026, 10, 2))).toEqual([
      { fecha: dia(2026, 9, 30), tokens: [] },
      { fecha: dia(2026, 10, 1), tokens: [] },
      { fecha: dia(2026, 10, 2), tokens: [] },
    ]);
  });

  it("un rango de un solo día da un día", () => {
    expect(diasVacios(dia(2026, 10, 1), dia(2026, 10, 1))).toHaveLength(1);
  });
});

describe("sumarConAbiertasPrevias", () => {
  const desde = dia(2026, 10, 1);
  const hasta = dia(2026, 10, 3);
  const legajos = new Map([["e1", "PC_1"], ["e2", "PC_2"], ["e3", "PC_3"]]);
  const conMarcas: DiasDeEmpleado = {
    empleadoId: "e1",
    legajo: "PC_1",
    dias: [{ fecha: desde, tokens: [{ tipo: "E", hora: "07:00" }] }],
  };

  it("suma al que no tiene marcas pero sí una fichada abierta, con los días del rango vacíos", () => {
    const r = sumarConAbiertasPrevias([conMarcas], ["e2"], legajos, desde, hasta);
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({ empleadoId: "e2", legajo: "PC_2", dias: diasVacios(desde, hasta) });
    expect(r[1].dias).toHaveLength(3);
  });

  it("no repite al que ya venía con marcas: se reconciliaría dos veces", () => {
    const r = sumarConAbiertasPrevias([conMarcas], ["e1"], legajos, desde, hasta);
    expect(r).toEqual([conMarcas]);
  });

  it("alguien con varias fichadas abiertas entra una sola vez", () => {
    const r = sumarConAbiertasPrevias([], ["e2", "e2", "e3", "e2"], legajos, desde, hasta);
    expect(r.map((e) => e.empleadoId)).toEqual(["e2", "e3"]);
  });

  it("sin fichadas abiertas devuelve lo mismo, y no muta la lista que recibió", () => {
    const entrada = [conMarcas];
    const r = sumarConAbiertasPrevias(entrada, [], legajos, desde, hasta);
    expect(r).toEqual(entrada);
    sumarConAbiertasPrevias(entrada, ["e2"], legajos, desde, hasta);
    expect(entrada).toHaveLength(1);
  });

  it("si no se conoce el legajo, queda el id para que el mensaje igual se pueda rastrear", () => {
    const r = sumarConAbiertasPrevias([], ["e9"], legajos, desde, hasta);
    expect(r[0].legajo).toBe("e9");
  });
});

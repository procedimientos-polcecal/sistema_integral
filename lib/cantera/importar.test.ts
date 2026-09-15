import { describe, it, expect } from "vitest";
import {
  aNumero,
  normalizarCantera,
  voladurasDe2026,
  bochonesDe2026,
  consumosDe,
} from "./importar";

const YAC = ["D1", "D6", "C1", "C3"]; // Alcancía no está cargado

describe("aNumero", () => {
  it("deja pasar un número", () => {
    expect(aNumero(1686.96)).toBe(1686.96);
  });
  it("entiende la coma decimal y los miles con punto", () => {
    expect(aNumero("74,2")).toBe(74.2);
    expect(aNumero("$1.450,00")).toBe(1450);
  });
  it("no toca un decimal con punto", () => {
    expect(aNumero("3.5")).toBe(3.5);
  });
  it("es null ante #VALUE!, ESPERAR o un texto", () => {
    expect(aNumero("#VALUE! (Function MULTIPLY…)")).toBeNull();
    expect(aNumero("ESPERAR")).toBeNull();
    expect(aNumero("NO SE PUDO VERIFICAR. CAUSA: …")).toBeNull();
    expect(aNumero("")).toBeNull();
  });
});

describe("normalizarCantera", () => {
  it("Alcancía en cualquier grafía va a 'A'", () => {
    expect(normalizarCantera("Alcancia")).toBe("A");
    expect(normalizarCantera("Alcancía")).toBe("A");
  });
  it("el resto queda en mayúsculas", () => {
    expect(normalizarCantera("d6")).toBe("D6");
  });
});

describe("voladurasDe2026", () => {
  const perfHeader = [
    "Codigo voladura", "Inicio", "Fin", "Cantera", "Perforacion [Mts]", "Cantidad de pozos",
    "Metros perforados", "TC USD", "Precio USD", "Total", "Facturación", "Coincide", "Observaciones",
  ];
  const volHeader = [
    "Código", "Fecha de carga", "Fecha voladura", "Cantera", "Pozos", "Metros", "Toneladas",
    "Explosivos", "TC USD", "Pesos", "N° factura", "Coincide", "Observaciones",
    "Pozos volados", "Metros volados", "Burden", "Espaciam.", "Densidad", "Factor",
  ];

  it("combina perforación y voladura por código, sólo 2026", () => {
    const perf = [
      perfHeader,
      ["V01D625", 45919, 45919, "D6", 3, 36, 108, 1515, 13.43, 2197416.6],
      ["V03D626", 46036, 46043, "D6", 4.6, 36, 165.6, 1455, 13.43, 3235931.64, "FC A 0001-00000375", "COINCIDE"],
    ];
    const vol = [
      volHeader,
      ["V03D626", 46036, 46043, "D6", 36, 165.6, 3079.3, "emulex: 100 - anfo premium: 400", 1455, 3258222.24, "", "", "", 36, 165.6, "", "", "", 18.55],
    ];
    const { filas, saltadas } = voladurasDe2026(perf, vol, YAC);

    expect(filas).toHaveLength(1);
    expect(saltadas).toHaveLength(0);
    const f = filas[0];
    expect(f.codigo).toBe("V03D626");
    expect(f.yacimiento_codigo).toBe("D6");
    expect(f.correlativo).toBe(3);
    expect(f.pozos).toBe(36);
    expect(f.metros_por_pozo).toBe(4.6);
    expect(f.perf_precio_usd_m).toBe(13.43);
    expect(f.toneladas_planilla).toBe(3079.3);
    expect(f.explosivos_raw).toBe("emulex: 100 - anfo premium: 400");
    expect(f.perf_odoo_ref).toBe("FC A 0001-00000375");
  });

  it("salta un yacimiento que no está cargado (Alcancía) y lo reporta", () => {
    const perf = [perfHeader, ["V01A26", 46031, 46031, "Alcancia", 7, 18, 126, 1490, 12.81, 2404949.4]];
    const { filas, saltadas } = voladurasDe2026(perf, [volHeader], YAC);
    expect(filas).toHaveLength(0);
    expect(saltadas[0]).toEqual({ codigo: "V01A26", motivo: "el yacimiento A no está cargado en el SdG" });
  });

  it("una fila con #VALUE! en metros entra con esos campos en null", () => {
    const perf = [
      perfHeader,
      ["V04C326", 46086, 46086, "C3", "NO SE PUDO VERIFICAR…", 25, "#VALUE! ()", "ESPERAR", 12.81, 0, "", false],
    ];
    const { filas } = voladurasDe2026(perf, [volHeader], YAC);
    expect(filas[0].metros_por_pozo).toBeNull();
    expect(filas[0].pozos).toBe(25);
    expect(filas[0].perf_tc_usd).toBeNull();
  });
});

describe("bochonesDe2026", () => {
  const header = [
    "Código", "Fecha inicio", "Fecha fin", "Precio", "Cantera", "Voladura asociada",
    "Metros perf.", "Perforaciones", "TC USD", "Pesos", "N° factura", "Coincide", "Observaciones",
  ];

  it("toma la col 6 como metros (≤1 m) y la col 7 como cantidad de bochones", () => {
    const rows = [header, ["B06D126", 46164, 46164, 5.07, "D1", "V03D126", 1, 172, 1425, 1242657, "FC A 0001-00000382", "COINCIDE"]];
    const { filas } = bochonesDe2026(rows, YAC);
    expect(filas[0].metros_perforados).toBe(1);
    expect(filas[0].cantidad).toBe(172);
    expect(filas[0].precio_usd_m).toBe(5.07);
    expect(filas[0].voladura_codigo).toBe("V03D126");
  });
});

describe("consumosDe", () => {
  const header = ["Código voladura", "Tipo", "Insumo", "Cantidad", "Precio USD", "Total USD", "Total ARS"];

  it("trae los renglones de las voladuras importadas y numera el orden", () => {
    const rows = [
      header,
      ["V03D626", "Detonador", "emulex", 100, 4.24, 424, 617000],
      ["V03D626", "Detonador", "anfo premium", 400, 2.83, 1132, 1647000],
      ["V99Z925", "Detonador", "emulex", 10, 4.24, 42, 60000],
    ];
    const salida = consumosDe(rows, new Set(["V03D626"]));
    expect(salida).toHaveLength(2);
    expect(salida[0]).toMatchObject({ voladura_codigo: "V03D626", tipo: "detonador", cantidad: 100, orden: 0 });
    expect(salida[1].orden).toBe(1);
  });

  it("descarta un renglón sin cantidad", () => {
    const rows = [header, ["V03D626", "Detonador", "emulex", "", 4.24, 0, 0]];
    expect(consumosDe(rows, new Set(["V03D626"]))).toHaveLength(0);
  });
});

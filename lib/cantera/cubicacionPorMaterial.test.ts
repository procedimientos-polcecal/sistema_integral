import { describe, it, expect } from "vitest";
import { armarCierresCubicacion } from "./cubicacion";
import {
  acarreoPorMaterial,
  cierresC1C3,
  CLAVE_C1C3,
  desglosarPorMaterial,
  juntarAcarreoC1C3,
  juntarVoladurasC1C3,
  materialDeTipoDePesada,
  type ExistenciaDeMaterial,
} from "./cubicacionPorMaterial";

describe("materialDeTipoDePesada", () => {
  it("el material sale del tipo, incluidos los finos", () => {
    expect(materialDeTipoDePesada("caliza")).toBe("Caliza");
    expect(materialDeTipoDePesada("finos_caliza")).toBe("Caliza");
    expect(materialDeTipoDePesada("chocolata_1")).toBe("Chocolata");
    expect(materialDeTipoDePesada("chocolata_3")).toBe("Chocolata");
    expect(materialDeTipoDePesada("finos_chocolata")).toBe("Chocolata");
  });
  it("lo que no es ni caliza ni chocolata no se adivina", () => {
    expect(materialDeTipoDePesada("dolomita_d1")).toBeNull();
    expect(materialDeTipoDePesada("estabilizado_a_cantera")).toBeNull();
    expect(materialDeTipoDePesada(null)).toBeNull();
  });
});

describe("juntar C1 y C3", () => {
  it("las voladuras de C1 y C3 viajan con una sola clave; D1 no pasa", () => {
    const r = juntarVoladurasC1C3([
      { yacimiento: "C1", perfFin: "2026-10-16", toneladas: 100, metros: 10 },
      { yacimiento: "C3", perfFin: "2026-10-09", toneladas: 200, metros: 20 },
      { yacimiento: "D1", perfFin: "2026-10-09", toneladas: 999, metros: 99 },
    ]);
    expect(r.map((v) => v.yacimiento)).toEqual([CLAVE_C1C3, CLAVE_C1C3]);
    expect(r.reduce((s, v) => s + (v.toneladas ?? 0), 0)).toBe(300);
  });
  it("el acarreo de C1 y C3 se suma por mes, sin tocar D1 ni D6", () => {
    const r = juntarAcarreoC1C3([
      { yacimientoCodigo: "C1", mes: "2026-10", toneladas: 1000 },
      { yacimientoCodigo: "C3", mes: "2026-10", toneladas: 500 },
      { yacimientoCodigo: "C3", mes: "2026-11", toneladas: 70 },
      { yacimientoCodigo: "D1", mes: "2026-10", toneladas: 9000 },
    ]);
    expect(r).toContainEqual({ yacimientoCodigo: CLAVE_C1C3, mes: "2026-10", toneladas: 1500 });
    expect(r).toContainEqual({ yacimientoCodigo: CLAVE_C1C3, mes: "2026-11", toneladas: 70 });
    expect(r).toHaveLength(2);
  });
});

describe("acarreoPorMaterial", () => {
  it("un chocolata_1 con origen C3 cuenta como chocolata: el tipo no dice el yacimiento", () => {
    const { porMaterial } = acarreoPorMaterial([
      { origen: "C1", tipo: "chocolata_1", mes: "2026-10", toneladas: 1000 },
      { origen: "C3", tipo: "chocolata_1", mes: "2026-10", toneladas: 478 },
      { origen: "C3", tipo: "chocolata_3", mes: "2026-10", toneladas: 600 },
      { origen: "C3", tipo: "caliza", mes: "2026-10", toneladas: 700 },
    ]);
    expect(porMaterial.find((a) => a.material === "Chocolata")?.toneladas).toBe(2078);
    expect(porMaterial.find((a) => a.material === "Caliza")?.toneladas).toBe(700);
  });
  it("D1 no entra, y lo de C1/C3 sin material se informa aparte", () => {
    const r = acarreoPorMaterial([
      { origen: "D1", tipo: "dolomita_d1", mes: "2026-10", toneladas: 5000 },
      { origen: "c3", tipo: "estabilizado_a_cantera", mes: "2026-10", toneladas: 30 },
    ]);
    expect(r.porMaterial).toEqual([]);
    expect(r.sinMaterial).toEqual([{ mes: "2026-10", toneladas: 30 }]);
  });
});

const ex = (mes: string, material: "Chocolata" | "Caliza", final: number, acopio: number | null): ExistenciaDeMaterial => ({
  mes,
  material,
  existenciaFinal: final,
  existenciaAcopio: acopio,
});

describe("cierresC1C3", () => {
  it("suma los dos materiales, canteras y acopio por separado", () => {
    const r = cierresC1C3([ex("2026-10", "Chocolata", 300, 3000), ex("2026-10", "Caliza", 100, 1000)]);
    expect(r).toEqual([
      { yacimientoCodigo: CLAVE_C1C3, mes: "2026-10", existenciaFinal: 400, existenciaAcopio: 4000, observaciones: null },
    ]);
  });
  it("con un solo material cargado el mes no cuenta: la suma parecería completa y daría un residuo falso", () => {
    expect(cierresC1C3([ex("2026-10", "Chocolata", 300, 3000)])).toEqual([]);
  });
  it("el acopio es null sólo si ninguno lo midió", () => {
    expect(cierresC1C3([ex("2026-10", "Chocolata", 1, null), ex("2026-10", "Caliza", 1, null)])[0].existenciaAcopio).toBeNull();
    expect(cierresC1C3([ex("2026-10", "Chocolata", 1, 50), ex("2026-10", "Caliza", 1, null)])[0].existenciaAcopio).toBe(50);
  });
});

describe("desglosarPorMaterial", () => {
  const existencias = [
    ex("2026-10", "Chocolata", 300, 3000), // 3300
    ex("2026-10", "Caliza", 100, 1000), // 1100
    ex("2026-11", "Chocolata", 200, 3000), // 3200
    ex("2026-11", "Caliza", 300, 1300), // 1600
  ];
  const acarreos = [
    { material: "Chocolata" as const, mes: "2026-11", toneladas: 1700 },
    { material: "Caliza" as const, mes: "2026-11", toneladas: 200 },
  ];

  it("mide cuánto salió de cada piedra: existencia final − inicial + acarreo", () => {
    const r = desglosarPorMaterial(["2026-11"], existencias, acarreos);
    const choc = r.find((f) => f.material === "Chocolata")!;
    const cal = r.find((f) => f.material === "Caliza")!;
    expect(choc.extraidoImplicito).toBe(3200 - 3300 + 1700); // 1600
    expect(cal.extraidoImplicito).toBe(1600 - 1100 + 200); // 700
  });
  it("y de ahí sale el reparto, que al volar nadie sabía", () => {
    const r = desglosarPorMaterial(["2026-11"], existencias, acarreos);
    expect(r.find((f) => f.material === "Caliza")!.parteDelTotal).toBeCloseTo(700 / 2300);
    expect(r.find((f) => f.material === "Chocolata")!.parteDelTotal).toBeCloseTo(1600 / 2300);
  });
  it("octubre no tiene mes anterior cargado: no se inventa", () => {
    const r = desglosarPorMaterial(["2026-10"], existencias, acarreos);
    expect(r.every((f) => f.extraidoImplicito === null && f.parteDelTotal === null)).toBe(true);
    expect(r.find((f) => f.material === "Chocolata")!.existenciaFinal).toBe(3300);
  });
});

describe("el balance de C1+C3 reusa el de siempre, con totales", () => {
  it("noviembre encadena de octubre con la suma de los dos materiales", () => {
    const existencias = [
      ex("2026-10", "Chocolata", 300, 3000),
      ex("2026-10", "Caliza", 100, 1000),
      ex("2026-11", "Chocolata", 200, 3000),
      ex("2026-11", "Caliza", 300, 1300),
    ];
    const filas = armarCierresCubicacion(
      [CLAVE_C1C3],
      juntarVoladurasC1C3([
        { yacimiento: "C1", perfFin: "2026-11-05", toneladas: 1500, metros: 100 },
        { yacimiento: "C3", perfFin: "2026-11-20", toneladas: 800, metros: 50 },
      ]),
      juntarAcarreoC1C3([
        { yacimientoCodigo: "C1", mes: "2026-11", toneladas: 1200 },
        { yacimientoCodigo: "C3", mes: "2026-11", toneladas: 700 },
      ]),
      cierresC1C3(existencias),
      ["2026-10", "2026-11"]
    );
    const oct = filas.find((f) => f.mes === "2026-10")!;
    const nov = filas.find((f) => f.mes === "2026-11")!;
    expect(oct.existenciaInicial).toBeNull(); // sin predecesor: no se inventa un cero
    expect(oct.existenciaFinal).toBe(4400);
    expect(nov.existenciaInicial).toBe(4400);
    expect(nov.stockTeorico).toBe(4400 + 2300 - 1900); // 4800
    expect(nov.existenciaFinal).toBe(4800);
    expect(nov.residuo).toBe(0);
  });
  it("mesAIncluir sigue aceptando un solo mes", () => {
    expect(armarCierresCubicacion(["D1"], [], [], [], "2026-11").map((f) => f.mes)).toEqual(["2026-11"]);
  });
});

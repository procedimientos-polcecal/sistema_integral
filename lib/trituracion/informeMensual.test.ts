import { describe, it, expect } from "vitest";
import { horasDelMes, informeMensualPorPlanta, toneladasPorOrigen, type ParteParaInformeMensual } from "./informeMensual";

function parte(p: Partial<ParteParaInformeMensual>): ParteParaInformeMensual {
  return {
    fecha: "2026-08-01",
    estado: "opero",
    material: "Dolomita",
    origen: "D1",
    horasMantenimiento: 0,
    horasFaltaPiedra: 0,
    horasProduccion: 0,
    horasOtro: 0,
    camionesLlegados: 0,
    toneladasProcesadas: 0,
    ...p,
  };
}

describe("horasDelMes", () => {
  it("un mes de 31 días da 744 hs (agosto 2026, el mismo número que ya usaba la planilla)", () => {
    expect(horasDelMes("2026-08")).toBe(744);
  });

  it("un mes de 30 días da 720", () => {
    expect(horasDelMes("2026-04")).toBe(720);
  });

  it("febrero de un año no bisiesto da 672", () => {
    expect(horasDelMes("2026-02")).toBe(672);
  });
});

describe("informeMensualPorPlanta", () => {
  /**
   * Reproduce, con números redondos, la forma real de Planta 1 en agosto
   * 2026 (verificado contra la base real el 22/09/2026): 26 días operativos,
   * horas teóricas = 26×8 = 208 (definición de la planilla, no la de
   * `lib/trituracion/horas.ts`), falta de piedra ≈32h, mantenimiento 8h,
   * sin "varios" ese mes.
   */
  const partesPlanta1 = [
    ...Array.from({ length: 25 }, (_, i) =>
      parte({ fecha: `2026-08-${String(i + 1).padStart(2, "0")}`, horasFaltaPiedra: 1, toneladasProcesadas: 600, camionesLlegados: 37 })
    ),
    parte({ fecha: "2026-08-26", horasFaltaPiedra: 7, horasMantenimiento: 8, toneladasProcesadas: 508.674, camionesLlegados: 41 }),
  ];

  it("horas teóricas es días operativos × 8, no la suma de hora_inicio→hora_fin", () => {
    const r = informeMensualPorPlanta(partesPlanta1, "2026-08");
    expect(r.diasOperativos).toBe(26);
    expect(r.horasTeoricas).toBe(208);
  });

  it("horas perdidas = falta de piedra + mantenimiento + (producción + otro, como 'varios')", () => {
    const r = informeMensualPorPlanta(partesPlanta1, "2026-08");
    expect(r.horasFaltaPiedra).toBeCloseTo(32, 6);
    expect(r.horasMantenimiento).toBe(8);
    expect(r.horasVarios).toBe(0);
    expect(r.horasPerdidasTotal).toBeCloseTo(40, 6);
  });

  it("disponibilidad excluye mantenimiento y varios, pero NO falta de piedra", () => {
    const r = informeMensualPorPlanta(partesPlanta1, "2026-08");
    // (208 - 8 - 0) / 208
    expect(r.disponibilidad).toBeCloseTo(200 / 208, 6);
  });

  it("utilización es horas reales sobre horas teóricas", () => {
    const r = informeMensualPorPlanta(partesPlanta1, "2026-08");
    expect(r.horasReales).toBeCloseTo(168, 6);
    expect(r.utilizacion).toBeCloseTo(168 / 208, 6);
  });

  it("dirección es horas teóricas sobre las horas del mes calendario", () => {
    const r = informeMensualPorPlanta(partesPlanta1, "2026-08");
    expect(r.direccion).toBeCloseTo(208 / 744, 6);
  });

  it("productividad t/h marcha y toneladas por viaje", () => {
    const r = informeMensualPorPlanta(partesPlanta1, "2026-08");
    expect(r.toneladas).toBeCloseTo(15508.674, 3);
    expect(r.viajes).toBe(966);
    expect(r.toneladasPorViaje).toBeCloseTo(15508.674 / 966, 6);
    expect(r.productividadTHMarcha).toBeCloseTo(15508.674 / 168, 6);
  });

  it("un mes sin ningún parte operativo da todo null o cero, no rompe", () => {
    const r = informeMensualPorPlanta([parte({ estado: "no_opero", horasFaltaPiedra: 5 })], "2026-08");
    expect(r.diasOperativos).toBe(0);
    expect(r.horasTeoricas).toBe(0);
    expect(r.disponibilidad).toBeNull();
    expect(r.utilizacion).toBeNull();
    expect(r.productividadTHMarcha).toBeNull();
    expect(r.toneladasPorViaje).toBeNull();
  });

  it("días con falta de piedra cuenta filas (partes), no días distintos — mismo criterio que la planilla", () => {
    const r = informeMensualPorPlanta(
      [
        parte({ fecha: "2026-08-01", horasFaltaPiedra: 1 }),
        parte({ fecha: "2026-08-02", horasFaltaPiedra: 0 }),
        parte({ fecha: "2026-08-02", horasFaltaPiedra: 2 }), // segundo turno del mismo día
      ],
      "2026-08"
    );
    expect(r.diasConFaltaPiedra).toBe(2);
  });

  it("toneladas por material: Dolomita/Chocolata/Caliza exactos, el resto (vacío o combinado) es 'sinClasificar'", () => {
    const r = informeMensualPorPlanta(
      [
        parte({ material: "Dolomita", toneladasProcesadas: 100 }),
        parte({ material: "Chocolata", toneladasProcesadas: 50 }),
        parte({ material: "Caliza", toneladasProcesadas: 20 }),
        parte({ material: "Caliza + Chocolata", toneladasProcesadas: 10 }),
        parte({ material: null, toneladasProcesadas: 5 }),
      ],
      "2026-08"
    );
    expect(r.porMaterial).toEqual({ dolomita: 100, chocolata: 50, caliza: 20, sinClasificar: 15, total: 185 });
  });
});

describe("toneladasPorOrigen", () => {
  it("suma por origen, sumando todas las plantas juntas", () => {
    const r = toneladasPorOrigen([
      parte({ origen: "D1", toneladasProcesadas: 100 }),
      parte({ origen: "D1", toneladasProcesadas: 50 }),
      parte({ origen: "C3", toneladasProcesadas: 30 }),
    ]);
    expect(r).toEqual(
      expect.arrayContaining([
        { origen: "D1", toneladas: 150 },
        { origen: "C3", toneladas: 30 },
      ])
    );
  });

  it("ordena de mayor a menor toneladas", () => {
    const r = toneladasPorOrigen([
      parte({ origen: "C1", toneladasProcesadas: 10 }),
      parte({ origen: "D1", toneladasProcesadas: 100 }),
    ]);
    expect(r.map((f) => f.origen)).toEqual(["D1", "C1"]);
  });

  it("sin origen, o un día que no operó, no entra", () => {
    const r = toneladasPorOrigen([
      parte({ origen: null, toneladasProcesadas: 100 }),
      parte({ origen: "D1", estado: "no_opero", toneladasProcesadas: 100 }),
    ]);
    expect(r).toEqual([]);
  });
});

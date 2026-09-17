import { describe, it, expect } from "vitest";
import { armarCierresCubicacion, cerrarCubicacionDelMes, type CierreCargado, type VoladuraParaCubicacion } from "./cubicacion";

describe("cerrarCubicacionDelMes", () => {
  it("sin cierre cargado todavía, no hay lectura ni residuo", () => {
    const fila = cerrarCubicacionDelMes("2026-09", "D1", [], 0, 2240, null);
    expect(fila.existenciaFinal).toBeNull();
    expect(fila.stockTeorico).toBe(2240); // sí se puede calcular, sólo falta contra qué compararlo
    expect(fila.residuo).toBeNull();
    expect(fila.lectura).toBeNull();
  });

  it("sin existencia inicial (mes sin predecesor), no calcula stock ni residuo ni lectura", () => {
    const voladuras: VoladuraParaCubicacion[] = [
      { yacimiento: "D1", perfFin: "2026-07-15", toneladas: 8116, metros: 438 },
    ];
    const cierre: CierreCargado = { yacimientoCodigo: "D1", mes: "2026-07", existenciaFinal: 2227, observaciones: null };
    const fila = cerrarCubicacionDelMes("2026-07", "D1", voladuras, 7528, null, cierre);
    expect(fila.stockTeorico).toBeNull();
    expect(fila.residuo).toBeNull();
    expect(fila.lectura).toBeNull();
    // La existencia final sí queda registrada: sirve de semilla para el mes siguiente.
    expect(fila.existenciaFinal).toBe(2227);
  });

  it("SIN ACTIVIDAD no depende de la cadena: alcanza con que no haya voladuras ese mes", () => {
    const cierre: CierreCargado = { yacimientoCodigo: "D1", mes: "2026-07", existenciaFinal: 2227, observaciones: null };
    const fila = cerrarCubicacionDelMes("2026-07", "D1", [], 0, null, cierre);
    expect(fila.lectura).toBe("SIN ACTIVIDAD");
  });

  it("sin voladuras en el mes, es SIN ACTIVIDAD aunque haya cierre cargado", () => {
    const cierre: CierreCargado = { yacimientoCodigo: "D6", mes: "2026-07", existenciaFinal: 700, observaciones: null };
    const fila = cerrarCubicacionDelMes("2026-07", "D6", [], 0, 700, cierre);
    expect(fila.lectura).toBe("SIN ACTIVIDAD");
  });

  // Basado en el cierre real de D1, julio/2026, de la hoja "CIERRE CANTERAS"
  // (planilla CUBICACIÓN CANTERA, leída en vivo el 17/09/2026): Exist.
  // inicial 0, Voladuras y Acarreo redondeados a enteros para mostrar (la
  // planilla los guarda con decimales) dan Exist. final 2227 y REVISAR — acá
  // se usan los mismos números enteros, así que el residuo puede diferir en
  // menos de una tonelada del que muestra la planilla por el redondeo.
  it("reproduce el orden de magnitud del cierre real de D1 en julio/2026 (REVISAR)", () => {
    const voladuras: VoladuraParaCubicacion[] = [
      { yacimiento: "D1", perfFin: "2026-07-15", toneladas: 8116, metros: 438 },
    ];
    const cierre: CierreCargado = { yacimientoCodigo: "D1", mes: "2026-07", existenciaFinal: 2227, observaciones: null };
    const fila = cerrarCubicacionDelMes("2026-07", "D1", voladuras, 7528, 0, cierre);
    expect(fila.voladuras).toBe(8116);
    expect(fila.stockTeorico).toBe(588); // 0 + 8116 - 7528
    expect(fila.residuo).toBe(-1639); // 588 - 2227
    expect(fila.porcentajeSobreVoladuras).toBeCloseTo(-0.202, 3);
    expect(fila.lectura).toBe("REVISAR");
  });

  // D1, agosto/2026: Exist. inicial 2227 (= final de julio), Voladuras 12316,
  // Acarreo 11244, Exist. final 2240 → Residuo 1059, 8.6%, ACEPTABLE.
  it("reproduce el cierre real de D1 en agosto/2026 (ACEPTABLE)", () => {
    const voladuras: VoladuraParaCubicacion[] = [
      { yacimiento: "D1", perfFin: "2026-08-10", toneladas: 12316, metros: 628 },
    ];
    const cierre: CierreCargado = { yacimientoCodigo: "D1", mes: "2026-08", existenciaFinal: 2240, observaciones: null };
    const fila = cerrarCubicacionDelMes("2026-08", "D1", voladuras, 11244, 2227, cierre);
    expect(fila.stockTeorico).toBe(3299);
    expect(fila.residuo).toBe(1059);
    expect(fila.porcentajeSobreVoladuras).toBeCloseTo(0.086, 3);
    expect(fila.lectura).toBe("ACEPTABLE");
  });

  it("un residuo chico contra lo volado cierra", () => {
    const cierre: CierreCargado = { yacimientoCodigo: "D1", mes: "2026-09", existenciaFinal: 2309, observaciones: null };
    const voladuras: VoladuraParaCubicacion[] = [{ yacimiento: "D1", perfFin: "2026-09-05", toneladas: 4127, metros: 223 }];
    // Stock teórico = 2240 + 4127 - 4058 = 2309, exacto: Residuo 0.
    const fila = cerrarCubicacionDelMes("2026-09", "D1", voladuras, 4058, 2240, cierre);
    expect(fila.residuo).toBe(0);
    expect(fila.lectura).toBe("CIERRA");
  });
});

describe("armarCierresCubicacion", () => {
  it("encadena la existencia inicial mes a mes, para un yacimiento", () => {
    const voladuras: VoladuraParaCubicacion[] = [
      { yacimiento: "D1", perfFin: "2026-07-15", toneladas: 8116, metros: 438 },
      { yacimiento: "D1", perfFin: "2026-08-10", toneladas: 12316, metros: 628 },
    ];
    const acarreos = [
      { yacimientoCodigo: "D1", mes: "2026-07", toneladas: 7528 },
      { yacimientoCodigo: "D1", mes: "2026-08", toneladas: 11244 },
    ];
    const cierres: CierreCargado[] = [
      { yacimientoCodigo: "D1", mes: "2026-07", existenciaFinal: 2227, observaciones: null },
      { yacimientoCodigo: "D1", mes: "2026-08", existenciaFinal: 2240, observaciones: null },
    ];

    const filas = armarCierresCubicacion(["D1"], voladuras, acarreos, cierres);

    expect(filas).toHaveLength(2);
    expect(filas[0].mes).toBe("2026-07");
    expect(filas[0].existenciaInicial).toBeNull(); // julio no tiene mes anterior cargado
    expect(filas[0].lectura).toBeNull();
    expect(filas[1].mes).toBe("2026-08");
    expect(filas[1].existenciaInicial).toBe(2227); // encadena de julio
    expect(filas[1].lectura).toBe("ACEPTABLE");
  });

  it("un mes salteado corta la cadena en vez de arrastrar un valor viejo", () => {
    const cierres: CierreCargado[] = [
      { yacimientoCodigo: "D1", mes: "2026-07", existenciaFinal: 2227, observaciones: null },
      // agosto no se cargó
      { yacimientoCodigo: "D1", mes: "2026-09", existenciaFinal: 2309, observaciones: null },
    ];
    const filas = armarCierresCubicacion(["D1"], [], [], cierres);
    const septiembre = filas.find((f) => f.mes === "2026-09")!;
    expect(septiembre.existenciaInicial).toBeNull();
  });

  it("arma una fila por yacimiento y mes cargado, aunque a ese yacimiento no le tocara ese mes", () => {
    const cierres: CierreCargado[] = [
      { yacimientoCodigo: "D1", mes: "2026-07", existenciaFinal: 2227, observaciones: null },
      { yacimientoCodigo: "D6", mes: "2026-07", existenciaFinal: 700, observaciones: null },
    ];
    const filas = armarCierresCubicacion(["D1", "D6", "C1", "C3"], [], [], cierres);
    // Un solo mes cargado (2026-07) × 4 yacimientos = 4 filas, aunque C1 y C3
    // no tengan cierre cargado ese mes (existenciaFinal null para ellos).
    expect(filas).toHaveLength(4);
    const c1 = filas.find((f) => f.yacimientoCodigo === "C1")!;
    expect(c1.existenciaFinal).toBeNull();
  });
});

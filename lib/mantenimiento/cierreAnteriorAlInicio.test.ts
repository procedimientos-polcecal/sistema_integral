import { describe, expect, it } from "vitest";
import {
  elCierreCambio,
  elCierreEsAnteriorAlInicio,
  justificacionParaLaPlanilla,
  laJustificacionQueSeGuarda,
  loQueFaltaPorElCierreAdelantado,
  observacionDelCierreAdelantado,
} from "./cierreAnteriorAlInicio";

describe("si el cierre es anterior al inicio", () => {
  it("lo es cuando la fecha de cierre es menor", () => {
    expect(elCierreEsAnteriorAlInicio("2026-11-04", "2026-11-06")).toBe(true);
  });
  it("el mismo dia no lo es", () => {
    expect(elCierreEsAnteriorAlInicio("2026-11-06", "2026-11-06")).toBe(false);
  });
  it("un dia despues no lo es", () => {
    expect(elCierreEsAnteriorAlInicio("2026-11-07", "2026-11-06")).toBe(false);
  });
  // Sin una de las dos no hay nada que comparar. 0 de 2.442 OT tienen cierre
  // sin inicio, pero la funcion no se apoya en eso.
  it("sin alguna de las dos no opina", () => {
    expect(elCierreEsAnteriorAlInicio("", "2026-11-06")).toBe(false);
    expect(elCierreEsAnteriorAlInicio("2026-11-04", null)).toBe(false);
    expect(elCierreEsAnteriorAlInicio(undefined, undefined)).toBe(false);
  });
  // Las dos son columnas `date` y llegan como "YYYY-MM-DD", asi que esto no
  // deberia pasar. Se compara el dia igual —diez caracteres— porque es gratis
  // y porque comparar textos de distinto largo da un resultado y no un error.
  it("compara el dia aunque venga con hora", () => {
    expect(elCierreEsAnteriorAlInicio("2026-11-04T00:00:00Z", "2026-11-06")).toBe(true);
  });
});

describe("si la fecha de cierre cambio", () => {
  // REVIEW FOCUS 1. RegistrarOTModal manda la fecha en todos los guardados,
  // asi que "vino la clave" seria siempre cierto y le pediria justificacion a
  // quien solo corrige las horas.
  it("la misma fecha no es un cambio", () => {
    expect(elCierreCambio("2026-11-04", "2026-11-04")).toBe(false);
  });
  it("cerrar una que estaba abierta es un cambio", () => {
    expect(elCierreCambio("2026-11-04", null)).toBe(true);
  });
  it("reabrir una cerrada es un cambio", () => {
    expect(elCierreCambio("", "2026-11-04")).toBe(true);
  });
  it("otra fecha es un cambio", () => {
    expect(elCierreCambio("2026-11-05", "2026-11-04")).toBe(true);
  });
});

describe("que falta cuando el cierre es anterior al inicio", () => {
  const adelantada = {
    fecha_cierre: "2026-11-04", fecha_ejecucion: "2026-11-06",
    cierre_justificacion: "Se rompio antes y se intervino",
  };
  it("con una justificacion que explica no falta nada", () => {
    expect(loQueFaltaPorElCierreAdelantado(adelantada)).toEqual([]);
  });
  it("sin justificacion la pide, con el nombre que se ve en pantalla", () => {
    expect(loQueFaltaPorElCierreAdelantado({ ...adelantada, cierre_justificacion: "" }))
      .toEqual(["por qué se cerró antes de la fecha de inicio"]);
  });
  // REVIEW FOCUS 3: la clave AUSENTE cuenta como faltante. Es una carga sin
  // senal encolada antes de que el campo existiera.
  it("la clave ausente tambien la pide", () => {
    const { cierre_justificacion: _, ...sinLaClave } = adelantada;
    expect(loQueFaltaPorElCierreAdelantado(sinLaClave as never))
      .toEqual(["por qué se cerró antes de la fecha de inicio"]);
  });
  // Lo unico que se opone a que esto sea un tramite. El validador es el del
  // nucleo, el mismo de Compras.
  it("una no-respuesta no alcanza", () => {
    for (const texto of ["x", "no", "...", "   ", "prueba"]) {
      expect(loQueFaltaPorElCierreAdelantado({ ...adelantada, cierre_justificacion: texto }))
        .toEqual(["por qué se cerró antes de la fecha de inicio"]);
    }
  });
  it("un motivo corto pero completo alcanza", () => {
    expect(loQueFaltaPorElCierreAdelantado({ ...adelantada, cierre_justificacion: "Rotura" }))
      .toEqual([]);
  });
  it("si el cierre no es anterior no pide nada, aunque no haya justificacion", () => {
    expect(loQueFaltaPorElCierreAdelantado({
      fecha_cierre: "2026-11-08", fecha_ejecucion: "2026-11-06", cierre_justificacion: "",
    })).toEqual([]);
  });
});

describe("que justificacion se guarda", () => {
  it("el texto recortado cuando el cierre es anterior", () => {
    expect(laJustificacionQueSeGuarda("2026-11-04", "2026-11-06", "  Se rompio antes  "))
      .toBe("Se rompio antes");
  });
  // REVIEW FOCUS 4. Dejarla llena seria que la ficha y la planilla sigan
  // diciendo "Cerrada antes del inicio" de una orden que ya no lo esta.
  it("null cuando las fechas dejaron de contradecirse", () => {
    expect(laJustificacionQueSeGuarda("2026-11-08", "2026-11-06", "Se rompio antes"))
      .toBeNull();
  });
  it("null cuando no hay texto", () => {
    expect(laJustificacionQueSeGuarda("2026-11-04", "2026-11-06", "   ")).toBeNull();
    expect(laJustificacionQueSeGuarda("2026-11-04", "2026-11-06", undefined)).toBeNull();
  });
});

describe("el texto de la celda de observaciones", () => {
  it("lleva el prefijo fijo, para reconocerla de un vistazo", () => {
    expect(observacionDelCierreAdelantado("Se rompio antes", null))
      .toBe("Cerrada antes del inicio: Se rompio antes");
  });
  it("la justificacion primero y las observaciones despues", () => {
    expect(observacionDelCierreAdelantado("Se rompio antes", "Se cambio el rodamiento"))
      .toBe("Cerrada antes del inicio: Se rompio antes\nSe cambio el rodamiento");
  });
  it("sin justificacion es la observacion sola", () => {
    expect(observacionDelCierreAdelantado(null, "Se cambio el rodamiento"))
      .toBe("Se cambio el rodamiento");
  });
  // Vacio vacia la celda, que es "sacá lo que habia" y no "no la toques".
  it("sin nada es vacio", () => {
    expect(observacionDelCierreAdelantado(null, null)).toBe("");
  });
});

describe("cuando la justificacion viaja a la planilla", () => {
  // REVIEW FOCUS 5. Si viajara siempre, un PATCH que solo cambia el estado
  // reescribiria la W con la justificacion sola y se llevaria las
  // observaciones, que no tienen columna para rearmarse.
  it("no viaja si el pedido no toca ninguna de las dos cosas", () => {
    expect(justificacionParaLaPlanilla(false, false, "Se rompio antes")).toBeUndefined();
  });
  it("viaja la guardada si el pedido toca las observaciones", () => {
    expect(justificacionParaLaPlanilla(true, false, "Se rompio antes")).toBe("Se rompio antes");
  });
  it("viaja la guardada si el pedido toca la justificacion", () => {
    expect(justificacionParaLaPlanilla(false, true, "Se rompio antes")).toBe("Se rompio antes");
  });
  it("viaja null si se borro, para que la celda deje de decirlo", () => {
    expect(justificacionParaLaPlanilla(false, true, null)).toBeNull();
  });
});

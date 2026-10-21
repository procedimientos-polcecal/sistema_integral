import { describe, it, expect } from "vitest";
import {
  loQueFaltaParaDesestimar, observacionDeLaDesestimacion,
  estaDesestimado, finalDelAviso,
} from "./desestimarAviso";

const BASE = { cuando: "2026-10-21", quien: "Rocco Fernandez" };

describe("el motivo no es opcional", () => {
  /**
   * Es el punto de toda la funcion. Un aviso desestimado sin motivo es lo
   * mismo que uno ignorado, solo que ademas parece resuelto: desaparece de la
   * lista sin que quede dicho por que, y en tres meses nadie puede saber si
   * fue una decision o un olvido.
   */
  it("sin motivo no se puede desestimar", () => {
    expect(loQueFaltaParaDesestimar({ ...BASE, motivo: "" }))
      .toEqual(["por qué no va a hacerse"]);
    expect(loQueFaltaParaDesestimar({ ...BASE, motivo: null }))
      .toEqual(["por qué no va a hacerse"]);
    expect(loQueFaltaParaDesestimar({ ...BASE, motivo: "   " }))
      .toEqual(["por qué no va a hacerse"]);
  });

  /** Un punto pasa cualquier comprobacion de "no vacio" y no dice nada. */
  it("un motivo que no se entiende tampoco alcanza", () => {
    const r = loQueFaltaParaDesestimar({ ...BASE, motivo: "." });
    expect(r).toHaveLength(1);
    expect(r[0]).toContain("se entienda");
    expect(loQueFaltaParaDesestimar({ ...BASE, motivo: "no va" })).toHaveLength(1);
  });

  it("«no corresponde» entra, que es el caso real mas corto", () => {
    expect(loQueFaltaParaDesestimar({ ...BASE, motivo: "no corresponde" })).toEqual([]);
  });

  it("un motivo de verdad no falta nada", () => {
    expect(loQueFaltaParaDesestimar({
      ...BASE, motivo: "El equipo se da de baja el mes que viene",
    })).toEqual([]);
  });
});

describe("lo que ve quien mira la planilla", () => {
  /**
   * Esa celda es TODO lo que va a ver: ahi no hay a quien preguntarle ni donde
   * hacer clic. Por eso lleva la fecha y quien decidio, no solo el motivo.
   */
  it("lleva la fecha, quien decidio y el motivo", () => {
    expect(observacionDeLaDesestimacion({
      ...BASE, motivo: "El equipo se da de baja el mes que viene",
    })).toBe("Desestimado 21/10 por Rocco Fernandez: El equipo se da de baja el mes que viene");
  });

  it("sin nombre no inventa uno", () => {
    expect(observacionDeLaDesestimacion({ ...BASE, quien: null, motivo: "no corresponde" }))
      .toBe("Desestimado 21/10: no corresponde");
  });

  it("la fecha va en dia/mes, como todo lo que se escribe en una planilla de acá", () => {
    expect(observacionDeLaDesestimacion({ ...BASE, cuando: "2026-01-05", motivo: "no corresponde" }))
      .toContain("Desestimado 5/1");
  });

  it("recorta los espacios del motivo", () => {
    expect(observacionDeLaDesestimacion({ ...BASE, quien: null, motivo: "  no corresponde  " }))
      .toBe("Desestimado 21/10: no corresponde");
  });
});

describe("en qué terminó un aviso", () => {
  it("pendiente es no tener nada de las dos cosas", () => {
    expect(finalDelAviso({})).toBe("pendiente");
    expect(finalDelAviso({ ot_asignada: "", desestimado_en: null })).toBe("pendiente");
  });

  it("con OT, venga de la app o de la planilla", () => {
    expect(finalDelAviso({ work_order_id: "ot-1" })).toBe("con-ot");
    expect(finalDelAviso({ ot_asignada: "2845" })).toBe("con-ot");
  });

  it("desestimado cuando alguien lo decidió", () => {
    expect(finalDelAviso({ desestimado_en: "2026-10-21T10:00:00Z" })).toBe("desestimado");
    expect(estaDesestimado({ desestimado_en: "2026-10-21T10:00:00Z" })).toBe(true);
    expect(estaDesestimado({ desestimado_en: null })).toBe(false);
  });

  /**
   * Tener OT gana a proposito: si alguien lo desestimo y despues se genero la
   * orden igual, lo que vale es que el trabajo existe. Al reves esconderia
   * trabajo en curso detras de una decision vieja.
   */
  it("si tiene OT, eso manda sobre la desestimación", () => {
    expect(finalDelAviso({
      work_order_id: "ot-1", desestimado_en: "2026-10-21T10:00:00Z",
    })).toBe("con-ot");
  });

  /** La columna de la planilla es texto libre: «Revision», «-», «RI 1888». */
  it("cualquier texto en OT ASIGNADA cuenta como que tiene OT", () => {
    expect(finalDelAviso({ ot_asignada: "Revision" })).toBe("con-ot");
    expect(finalDelAviso({ ot_asignada: "   " })).toBe("pendiente");
  });
});

import { describe, it, expect } from "vitest";
import { decidirPorClave, type FilaDeClave } from "./claveDeCarga";

function fila(cambios: Partial<FilaDeClave> = {}): FilaDeClave {
  return {
    clave: "c-1",
    usuario_id: "ana",
    tipo: "orden",
    resuelto_en: null,
    numero: null,
    entidad_id: null,
    ...cambios,
  };
}

describe("decidirPorClave", () => {
  it("sin fila, la carga es nueva y se sigue", () => {
    expect(decidirPorClave(null, "ana")).toBe("seguir");
  });

  it("con fila resuelta se devuelve lo de antes, no se carga de nuevo", () => {
    const resuelta = fila({
      resuelto_en: "2026-10-18T12:00:00Z",
      numero: "2796",
      entidad_id: "ot-1",
    });
    expect(decidirPorClave(resuelta, "ana")).toBe("ya-esta");
  });

  it("con fila sin resolver queda EN DUDA: pudo haberse escrito la fila en la planilla", () => {
    expect(decidirPorClave(fila({ resuelto_en: null }), "ana")).toBe("en-duda");
  });

  it("una clave de otro usuario no se toca", () => {
    expect(decidirPorClave(fila({ usuario_id: "beto" }), "ana")).toBe("ajena");
  });

  it("la ajena gana aunque esté resuelta: no se le devuelve a Ana el número de Beto", () => {
    const deBeto = fila({
      usuario_id: "beto",
      resuelto_en: "2026-10-18T12:00:00Z",
      numero: "2796",
    });
    expect(decidirPorClave(deBeto, "ana")).toBe("ajena");
  });
});

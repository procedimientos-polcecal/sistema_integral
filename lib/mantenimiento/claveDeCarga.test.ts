import { describe, it, expect } from "vitest";
import {
  decidirPorClave, esChoqueDeClave, cambiosDeResolucion, type FilaDeClave,
} from "./claveDeCarga";

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
    expect(decidirPorClave(null, "ana", "orden")).toBe("seguir");
  });

  it("con fila resuelta se devuelve lo de antes, no se carga de nuevo", () => {
    const resuelta = fila({
      resuelto_en: "2026-10-18T12:00:00Z",
      numero: "2796",
      entidad_id: "ot-1",
    });
    expect(decidirPorClave(resuelta, "ana", "orden")).toBe("ya-esta");
  });

  it("resuelta con el id todavía sin completar sigue siendo 'ya-esta'", () => {
    const sinId = fila({ resuelto_en: "2026-10-18T12:00:00Z", numero: "2796", entidad_id: null });
    expect(decidirPorClave(sinId, "ana", "orden")).toBe("ya-esta");
  });

  it("con fila sin resolver queda EN DUDA: pudo haberse escrito la fila en la planilla", () => {
    expect(decidirPorClave(fila({ resuelto_en: null }), "ana", "orden")).toBe("en-duda");
  });

  it("una clave de otro usuario no se toca", () => {
    expect(decidirPorClave(fila({ usuario_id: "beto" }), "ana", "orden")).toBe("ajena");
  });

  it("la ajena gana aunque esté resuelta: no se le devuelve a Ana el número de Beto", () => {
    const deBeto = fila({
      usuario_id: "beto",
      resuelto_en: "2026-10-18T12:00:00Z",
      numero: "2796",
    });
    expect(decidirPorClave(deBeto, "ana", "orden")).toBe("ajena");
  });

  it("la misma clave para otro tipo de carga no es la misma carga", () => {
    const unAviso = fila({ tipo: "aviso", resuelto_en: "2026-10-18T12:00:00Z", numero: "88" });
    expect(decidirPorClave(unAviso, "ana", "orden")).toBe("otro-tipo");
  });

  it("el tipo se compara aunque la fila esté sin resolver", () => {
    expect(decidirPorClave(fila({ tipo: "aviso" }), "ana", "orden")).toBe("otro-tipo");
  });

  it("si además es de otro usuario, sigue siendo ajena", () => {
    expect(decidirPorClave(fila({ usuario_id: "beto", tipo: "aviso" }), "ana", "orden")).toBe("ajena");
  });
});

describe("esChoqueDeClave", () => {
  it("la primaria repetida (23505) es un reintento", () => {
    expect(esChoqueDeClave({ code: "23505", message: "duplicate key value" })).toBe(true);
  });

  it("cualquier otro error es un fallo de verdad", () => {
    expect(esChoqueDeClave({ code: "23514", message: "check violation" })).toBe(false);
    expect(esChoqueDeClave({ code: "23503", message: "foreign key" })).toBe(false);
    expect(esChoqueDeClave({ code: "PGRST301", message: "jwt" })).toBe(false);
  });

  it("un error sin código no se confunde con un choque", () => {
    expect(esChoqueDeClave({ message: "fetch failed" })).toBe(false);
  });
});

describe("cambiosDeResolucion", () => {
  const AHORA = new Date("2026-10-18T15:30:00Z");

  it("con número e id escribe las tres columnas", () => {
    expect(cambiosDeResolucion({ numero: "2796", entidadId: "ot-1" }, AHORA)).toEqual({
      resuelto_en: "2026-10-18T15:30:00.000Z",
      numero: "2796",
      entidad_id: "ot-1",
    });
  });

  it("sin id no toca entidad_id: la segunda llamada no pisa a la primera", () => {
    const cambios = cambiosDeResolucion({ numero: "2796" }, AHORA);
    expect(cambios).toEqual({ resuelto_en: "2026-10-18T15:30:00.000Z", numero: "2796" });
    expect("entidad_id" in cambios).toBe(false);
  });

  it("un id null o vacío tampoco se escribe", () => {
    expect("entidad_id" in cambiosDeResolucion({ numero: "1", entidadId: null }, AHORA)).toBe(false);
    expect("entidad_id" in cambiosDeResolucion({ numero: "1", entidadId: "" }, AHORA)).toBe(false);
  });
});

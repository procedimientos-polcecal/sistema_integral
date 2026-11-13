import { describe, expect, it } from "vitest";
import { claveDelBorrador, hayAlgoEscrito } from "./borradorDeFormulario";

describe("claveDelBorrador", () => {
  it("dos registros distintos no comparten clave", () => {
    expect(claveDelBorrador("registrar-ot", { tipo: "ot", id: 2905 }))
      .not.toBe(claveDelBorrador("registrar-ot", { tipo: "ot", id: 2907 }));
  });

  it("un alta en blanco no comparte clave con una prellenada desde un aviso", () => {
    expect(claveDelBorrador("nueva-ot"))
      .not.toBe(claveDelBorrador("nueva-ot", { tipo: "aviso", id: 5 }));
  });

  it("dos altas desde el mismo aviso sí comparten clave: es el mismo trabajo", () => {
    expect(claveDelBorrador("nueva-ot", { tipo: "aviso", id: 5 }))
      .toBe(claveDelBorrador("nueva-ot", { tipo: "aviso", id: 5 }));
  });

  it("el número y el texto del mismo id son la misma clave", () => {
    expect(claveDelBorrador("ot", { tipo: "ot", id: 7 }))
      .toBe(claveDelBorrador("ot", { tipo: "ot", id: "7" }));
  });
});

describe("hayAlgoEscrito", () => {
  it("un formulario intacto no tiene nada escrito, aunque nazca con valores", () => {
    const inicial = { horas: "8", contratista: "", operario: null };
    expect(hayAlgoEscrito(inicial, { ...inicial })).toBe(false);
  });

  it("cambiar un valor por omisión cuenta como escrito", () => {
    expect(hayAlgoEscrito({ horas: "8" }, { horas: "9" })).toBe(true);
  });

  it("volver un campo a su valor inicial deja el formulario intacto", () => {
    expect(hayAlgoEscrito({ nota: "" }, { nota: "" })).toBe(false);
  });

  it("un campo anidado que cambió cuenta como escrito", () => {
    expect(hayAlgoEscrito({ repuestos: [{ id: 1 }] }, { repuestos: [{ id: 2 }] })).toBe(true);
  });
});

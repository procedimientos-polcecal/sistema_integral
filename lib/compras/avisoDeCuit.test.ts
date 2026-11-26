import { describe, expect, it } from "vitest";
import { avisoDeCuit, leFaltaElCuit } from "./avisoDeCuit";

describe("el aviso de CUIT", () => {
  it("no dice nada si el CUIT está y cierra", () => {
    expect(avisoDeCuit({ cuit: "30714412333" })).toBeNull();
    expect(leFaltaElCuit({ cuit: "30-71441233-3" })).toBe(false);
  });

  it("avisa cuando falta", () => {
    expect(avisoDeCuit({ cuit: null })).toContain("no tiene CUIT cargado");
    expect(avisoDeCuit({ cuit: "" })).toContain("no tiene CUIT cargado");
    expect(avisoDeCuit({ cuit: "   " })).toContain("no tiene CUIT cargado");
  });

  /*
   * Lo que el que lee tiene que hacer es lo mismo —ir a la ficha—, pero el
   * texto cambia: un dato que falta y uno mal tipeado no se buscan igual.
   */
  it("y avisa distinto cuando está pero el dígito verificador no cierra", () => {
    const aviso = avisoDeCuit({ cuit: "30714412334" });
    expect(aviso).toContain("no es válido");
    expect(aviso).toContain("30714412334");
  });

  /** Once dígitos no es lo mismo que un CUIT: menos de once no es ninguno. */
  it("un CUIT incompleto se trata como que falta", () => {
    expect(avisoDeCuit({ cuit: "3071441" })).toContain("no tiene CUIT cargado");
  });

  it("sin proveedor elegido todavía no hay nada que avisar", () => {
    expect(avisoDeCuit(null)).toBeNull();
    expect(avisoDeCuit(undefined)).toBeNull();
  });
});

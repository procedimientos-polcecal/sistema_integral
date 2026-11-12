import { describe, it, expect } from "vitest";
import { textoDelReclamo } from "./reclamo";

describe("textoDelReclamo", () => {
  it("nombra el RI, los días y el estado", () => {
    expect(
      textoDelReclamo({ nro_ri: 771, descripcion: "Perfil C", dias: 253, estado: "APROBADO" })
    ).toBe(
      "El RI 771 (Perfil C) lleva 253 días sin avanzar, en estado Compra aprobada. " +
        "¿Nos pueden decir por qué está demorado?"
    );
  });

  it("un pedido sin descripción no deja un paréntesis vacío", () => {
    expect(
      textoDelReclamo({ nro_ri: 12, descripcion: null, dias: 40, estado: "SIN_INICIAR" })
    ).toBe(
      "El RI 12 lleva 40 días sin avanzar, en estado Sin iniciar. " +
        "¿Nos pueden decir por qué está demorado?"
    );
  });

  /*
   * La etiqueta sale de `COMPRA_LABELS` y no de una copia: si alguien
   * renombra un estado, el reclamo tiene que decir lo mismo que el chip que
   * está dos centímetros más arriba en la misma pantalla.
   */
  it("usa la etiqueta del estado y no el valor crudo", () => {
    const t = textoDelReclamo({ nro_ri: 1, descripcion: "x", dias: 5, estado: "EN_COMPARATIVA" });
    expect(t).toContain("En comparativa");
    expect(t).not.toContain("EN_COMPARATIVA");
  });

  it("un día va en singular", () => {
    expect(textoDelReclamo({ nro_ri: 9, descripcion: null, dias: 1, estado: "APROBADO" }))
      .toContain("lleva 1 día sin avanzar");
  });

  // Una descripción de 300 caracteres convertiría el borrador en una pared de
  // texto que nadie lee antes de enviar.
  it("recorta una descripción larga", () => {
    const larga = "Rodamiento ".repeat(30);
    const t = textoDelReclamo({ nro_ri: 5, descripcion: larga, dias: 10, estado: "APROBADO" });
    expect(t.length).toBeLessThan(200);
    expect(t).toContain("…");
  });
});

import { describe, it, expect } from "vitest";
import { textoDelOrigen } from "./origenEnLaOT";

describe("textoDelOrigen", () => {
  it("nombra la orden, su maquina y la descripcion", () => {
    expect(textoDelOrigen({
      ot_number: 2983, descripcion: "Cambio de rodamiento",
      equipo_raw: "Molino 2", repuesto_nombre: "CAJA DE RODAMIENTO UPC 213",
    })).toBe("OT #2983 · Molino 2 · «Cambio de rodamiento»");
  });

  it("omite lo que la orden no trae, sin dejar separadores sueltos", () => {
    expect(textoDelOrigen({ ot_number: 2983, descripcion: null, equipo_raw: null, repuesto_nombre: null }))
      .toBe("OT #2983");
    expect(textoDelOrigen({ ot_number: 2983, descripcion: "Cambio", equipo_raw: null, repuesto_nombre: null }))
      .toBe("OT #2983 · «Cambio»");
  });

  it("una OT borrada no deja una linea vacia", () => {
    // `on delete set null`: el RI sobrevive a la orden. Sin esto la ficha
    // mostraria «OT #» y una descripcion vacia.
    expect(textoDelOrigen(null)).toBeNull();
    expect(textoDelOrigen({ ot_number: null, descripcion: null, equipo_raw: null, repuesto_nombre: null })).toBeNull();
  });
});

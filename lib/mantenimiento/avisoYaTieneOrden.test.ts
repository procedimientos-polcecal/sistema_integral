import { describe, it, expect } from "vitest";
import { porQueNoPuedeTenerOtraOrden } from "./avisoYaTieneOrden";

describe("porQueNoPuedeTenerOtraOrden", () => {
  it("deja pasar un aviso sin orden", () => {
    expect(
      porQueNoPuedeTenerOtraOrden({ oa_number: "A99", work_order_id: null }),
    ).toBeNull();
  });

  it("deja pasar lo que no es un aviso", () => {
    expect(porQueNoPuedeTenerOtraOrden(null)).toBeNull();
    expect(porQueNoPuedeTenerOtraOrden(undefined)).toBeNull();
  });

  it("nombra el aviso y la orden que ya existe", () => {
    const porque = porQueNoPuedeTenerOtraOrden({
      oa_number: "A98",
      work_order_id: "ot-1",
      ordenes_trabajo: { ot_number: 2117 },
    });
    // Los dos números tienen que estar: sin el de la orden, quien lo lee no
    // sabe si lo que iba a cargar ya está cargado.
    expect(porque).toContain("A98");
    expect(porque).toContain("#2117");
  });

  it("lee el embebido venga como objeto o como arreglo", () => {
    const comoArreglo = porQueNoPuedeTenerOtraOrden({
      oa_number: "A98",
      work_order_id: "ot-1",
      ordenes_trabajo: [{ ot_number: 2117 }],
    });
    expect(comoArreglo).toContain("#2117");
  });

  it("no le inventa un número a una orden que todavía no lo tiene", () => {
    for (const embebido of [null, undefined, {}, { ot_number: null }, [] as const]) {
      const porque = porQueNoPuedeTenerOtraOrden({
        oa_number: "A98",
        work_order_id: "ot-1",
        ordenes_trabajo: embebido as never,
      });
      expect(porque).toContain("A98");
      expect(porque).toContain("una orden de trabajo");
      expect(porque).not.toContain("#");
    }
  });

  it("se arregla sin el número del aviso", () => {
    const porque = porQueNoPuedeTenerOtraOrden({
      oa_number: null,
      work_order_id: "ot-1",
      ordenes_trabajo: { ot_number: 2117 },
    });
    expect(porque).toContain("Este aviso");
    expect(porque).not.toContain("null");
  });

  it("dice qué hacer, no sólo que no", () => {
    const porque = porQueNoPuedeTenerOtraOrden({
      oa_number: "A98",
      work_order_id: "ot-1",
      ordenes_trabajo: { ot_number: 2117 },
    });
    expect(porque).toContain("Órdenes de trabajo");
  });
});

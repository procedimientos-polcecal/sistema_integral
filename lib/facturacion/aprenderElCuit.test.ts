import { describe, expect, it } from "vitest";
import { sePuedeAprenderElCuit } from "./aprenderElCuit";

const base = {
  cuitDeLaFactura: "30-71441233-3",
  cuitDelProveedor: null,
  cuitsDeOtrosProveedores: [] as string[],
};

describe("cuándo se guarda", () => {
  it("el proveedor no tiene CUIT y nadie más usa ése", () => {
    const r = sePuedeAprenderElCuit(base);
    expect(r).toEqual({ se: true, cuit: "30714412333" });
  });

  it("y se guarda normalizado, venga como venga de la factura", () => {
    const r = sePuedeAprenderElCuit({ ...base, cuitDeLaFactura: "30714412333" });
    expect(r.se === true && r.cuit).toBe("30714412333");
  });
});

describe("cuándo no, que es donde está el cuidado", () => {
  it("sin CUIT en la factura no hay nada que aprender", () => {
    expect(sePuedeAprenderElCuit({ ...base, cuitDeLaFactura: null }).se).toBe(false);
    expect(sePuedeAprenderElCuit({ ...base, cuitDeLaFactura: "  " }).se).toBe(false);
  });

  /*
   * Un CUIT que ya está no se pisa: o es el proveedor equivocado o el padrón
   * estaba mal, y las dos las resuelve una persona mirando.
   */
  it("si el proveedor ya tiene OTRO CUIT, no se pisa", () => {
    const r = sePuedeAprenderElCuit({ ...base, cuitDelProveedor: "30-11111111-9" });
    expect(r.se).toBe(false);
    expect(r.se === false && r.porque).toContain("ya tiene el CUIT");
  });

  it("y si ya tiene ese mismo, no hay nada que hacer", () => {
    const r = sePuedeAprenderElCuit({ ...base, cuitDelProveedor: "30714412333" });
    expect(r.se).toBe(false);
    expect(r.se === false && r.porque).toContain("ya tiene ese CUIT");
  });

  /*
   * La trampa que apareció llenando CUIT por nombre: el padrón tiene la misma
   * empresa cargada más de una vez. Dos filas con el mismo CUIT son las que el
   * cruce con Odoo se niega a enlazar.
   */
  it("si el CUIT ya lo usa otro proveedor del padrón", () => {
    const r = sePuedeAprenderElCuit({
      ...base,
      cuitsDeOtrosProveedores: ["30-71441233-3"],
    });
    expect(r.se).toBe(false);
    expect(r.se === false && r.porque).toContain("otro proveedor");
  });

  it("y lo detecta aunque el otro lo tenga escrito distinto", () => {
    expect(
      sePuedeAprenderElCuit({ ...base, cuitsDeOtrosProveedores: ["30714412333"] }).se
    ).toBe(false);
  });
});

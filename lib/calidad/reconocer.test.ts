import { describe, it, expect } from "vitest";
import { movimientoDesdeLaLineaDeOdoo, type LineaDeOdoo, type Catalogos } from "./reconocer";

const CATALOGOS: Catalogos = {
  carbonilleros: new Map([
    [906, { id: "c-bruzzone", carbon: "vegetal" as const, proveedorId: null }],
    [2527, { id: "c-membranex", carbon: "residual" as const, proveedorId: "p-membranex" }],
    [1030, { id: "c-katherine", carbon: "vegetal" as const, proveedorId: "p-katherine" }],
    [1056, { id: "c-walkimia", carbon: "vegetal" as const, proveedorId: null }],
  ]),
  productos: new Map([
    [4419, true],   // `CARBONILLA ` — con el espacio al final
    [6909, true],   // `CARBONILLA`  — sin el espacio
    [5583, true],   // `Carbonilla de coque`
    [4914, false],  // `Flete carbonilla`
  ]),
};

const linea = (p: Partial<LineaDeOdoo> = {}): LineaDeOdoo => ({
  id: 3087,
  ordenNombre: "P02420",
  fecha: "2026-09-04",
  partnerId: 906,
  partnerNombre: "BRUZZONE JUAN ALBERTO",
  productoId: 4419,
  productoNombre: "CARBONILLA ",
  cantidad: 19.58,
  ...p,
});

describe("movimientoDesdeLaLineaDeOdoo", () => {
  it("una entrada normal entra, con el signo en más", () => {
    const r = movimientoDesdeLaLineaDeOdoo(linea(), CATALOGOS);
    expect(r.resultado).toBe("entra");
    if (r.resultado !== "entra") throw new Error("no entró");
    expect(r.movimiento).toEqual({
      fecha: "2026-09-04",
      tipo: "entrada",
      carbon: "vegetal",
      toneladas: 19.58,
      carbonillero_id: "c-bruzzone",
      proveedor_id: null,
      origen: "odoo",
      odoo_purchase_line_id: 3087,
      odoo_purchase_name: "P02420",
      motivo: null,
    });
  });

  it("EL TIPO SALE DEL PROVEEDOR Y NO DEL PRODUCTO", () => {
    // Membranex, el único residual, usa `CARBONILLA ` 6 veces al año: el mismo
    // producto que todos los vegetales. Deducir el tipo del producto daría
    // residual como vegetal, y el dato aparecería en el saldo que no es.
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ partnerId: 2527, partnerNombre: "MEMBRANEX S.A.", productoId: 4419 }),
      CATALOGOS
    );
    if (r.resultado !== "entra") throw new Error("no entró");
    expect(r.movimiento.carbon).toBe("residual");
    expect(r.movimiento.proveedor_id).toBe("p-membranex");
  });

  it("un flete se descarta y no molesta en la bandeja", () => {
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ productoId: 4914, productoNombre: "Flete carbonilla" }),
      CATALOGOS
    );
    expect(r.resultado).toBe("descartado");
  });

  it("un producto que nadie resolvió va a la bandeja", () => {
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ productoId: 4734, productoNombre: "Carbonillia" }),
      CATALOGOS
    );
    expect(r.resultado).toBe("a_la_bandeja");
    if (r.resultado !== "a_la_bandeja") throw new Error("no fue a la bandeja");
    expect(r.motivo).toContain("Carbonillia");
  });

  it("un proveedor sin declarar va a la bandeja, y eso gana sobre el producto", () => {
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ partnerId: 876, partnerNombre: "GARELLI JUAN CARLOS", productoId: 4734 }),
      CATALOGOS
    );
    expect(r.resultado).toBe("a_la_bandeja");
    if (r.resultado !== "a_la_bandeja") throw new Error("no fue a la bandeja");
    expect(r.motivo).toContain("GARELLI JUAN CARLOS");
  });

  it("los kilos cargados como toneladas van a la bandeja", () => {
    // La P02304: 38.660 en la línea. Son kilos.
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ id: 2900, ordenNombre: "P02304", partnerId: 1030, cantidad: 38660 }),
      CATALOGOS
    );
    expect(r.resultado).toBe("a_la_bandeja");
    if (r.resultado !== "a_la_bandeja") throw new Error("no fue a la bandeja");
    expect(r.motivo).toContain("38660");
  });

  it("una línea en cero va a la bandeja", () => {
    // La P02292.
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ id: 2870, ordenNombre: "P02292", partnerId: 1056, cantidad: 0 }),
      CATALOGOS
    );
    expect(r.resultado).toBe("a_la_bandeja");
  });

  it("redondea a tres decimales", () => {
    const r = movimientoDesdeLaLineaDeOdoo(linea({ cantidad: 19.5784 }), CATALOGOS);
    if (r.resultado !== "entra") throw new Error("no entró");
    expect(r.movimiento.toneladas).toBe(19.578);
  });
});

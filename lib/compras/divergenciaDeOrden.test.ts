import { describe, it, expect } from "vitest";
import { diferenciasDeLaOrden } from "./divergenciaDeOrden";

/*
 * Los números del RI 1933, que es el único que llegó a tener orden en Odoo: dos
 * órdenes del 50% de $19.511,25 contra un costo cargado de $39.022,48. Los dos
 * centavos son el redondeo de `price_unit` a dos decimales, no un error.
 */
const RI_1933 = { costoConIva: 39022.48, cantidad: 10 };
const ODOO_1933 = { total: 39022.5, cantidad: 10 };

describe("lo que no es una diferencia", () => {
  it("el redondeo de los dos decimales del unitario", () => {
    expect(diferenciasDeLaOrden(RI_1933, ODOO_1933)).toEqual([]);
  });

  /*
   * El peor descuadre por redondeo medido sobre los 1.678 RI con costo: $2,85
   * sobre $133.000. Si eso disparara, el cartel saldría en facturas correctas.
   */
  it("el peor redondeo que se midió sobre la carpeta entera", () => {
    const d = diferenciasDeLaOrden(
      { costoConIva: 133000, cantidad: null },
      { total: 133002.85, cantidad: 0 }
    );
    expect(d).toEqual([]);
  });

  it("un pedido AMBAS de cantidad impar, que se reparte 2,5 y 2,5", () => {
    const d = diferenciasDeLaOrden({ costoConIva: null, cantidad: 5 }, { total: 0, cantidad: 5 });
    expect(d).toEqual([]);
  });

  it("sin costo cargado no hay con qué comparar", () => {
    expect(diferenciasDeLaOrden({ costoConIva: null, cantidad: null }, ODOO_1933)).toEqual([]);
    expect(diferenciasDeLaOrden({ costoConIva: 0, cantidad: 0 }, ODOO_1933)).toEqual([]);
  });
});

describe("lo que sí hay que mostrar", () => {
  it("un precio cambiado en Odoo", () => {
    const d = diferenciasDeLaOrden(RI_1933, { total: 45000, cantidad: 10 });
    expect(d).toHaveLength(1);
    expect(d[0].campo).toBe("El total");
    expect(d[0].enOdoo).toContain("45.000");
  });

  it("una cantidad cambiada en Odoo", () => {
    const d = diferenciasDeLaOrden(RI_1933, { total: 39022.5, cantidad: 8 });
    expect(d).toHaveLength(1);
    expect(d[0].campo).toBe("La cantidad");
    expect(d[0].enElSdg).toBe("10");
    expect(d[0].enOdoo).toBe("8");
  });

  it("las dos a la vez", () => {
    expect(diferenciasDeLaOrden(RI_1933, { total: 1000, cantidad: 1 })).toHaveLength(2);
  });

  /*
   * El piso de $10 existe para los montos chicos, donde un milésimo no alcanza
   * ni para el redondeo: sobre $500 la tolerancia relativa sería medio peso.
   */
  it("en un monto chico manda el piso y no el milésimo", () => {
    expect(diferenciasDeLaOrden({ costoConIva: 500, cantidad: null }, { total: 505, cantidad: 0 })).toEqual([]);
    expect(diferenciasDeLaOrden({ costoConIva: 500, cantidad: null }, { total: 530, cantidad: 0 })).toHaveLength(1);
  });

  /*
   * La comparación es contra la SUMA de las órdenes. Una sola del 50% contra el
   * costo entero daría un cartel permanente en toda ficha compartida — por eso
   * quien llama suma antes, y este test fija ese contrato.
   */
  it("un RI compartido cuadra cuando se suman las dos órdenes", () => {
    const unaSola = diferenciasDeLaOrden(RI_1933, { total: 19511.25, cantidad: 5 });
    expect(unaSola).toHaveLength(2);

    const lasDos = diferenciasDeLaOrden(RI_1933, { total: 19511.25 * 2, cantidad: 10 });
    expect(lasDos).toEqual([]);
  });
});

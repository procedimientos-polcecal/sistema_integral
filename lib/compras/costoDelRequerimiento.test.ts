import { describe, it, expect } from "vitest";
import { precioDesdeElRequerimiento, IVA_POR_DEFECTO } from "./costoDelRequerimiento";

/**
 * Los números son de requerimientos reales, leídos el 09/09/2026. El RI 1912 es
 * el que prueba qué significa el campo: `costo_iva` 7.734,32 con un presupuesto
 * de 6.392 × 1 al 21% — o sea el total con IVA, no el unitario.
 */
describe("el precio que sale del Costo + IVA", () => {
  it("saca el neto del total con IVA", () => {
    const r = precioDesdeElRequerimiento({ costoIva: 7734.32, costoEnvio: null, cantidad: 1 });
    if (!r.ok) throw new Error(r.motivo);

    expect(r.precio.precioUnitario).toBe(6392);
    expect(r.precio.cantidad).toBe(1);
  });

  it("reparte entre la cantidad, porque la línea lleva precio unitario", () => {
    // 4 unidades: 53.459,49 con IVA → 44.181,40 neto → 11.045,35 cada una.
    const r = precioDesdeElRequerimiento({ costoIva: 53459.49, costoEnvio: null, cantidad: 4 });
    if (!r.ok) throw new Error(r.motivo);

    expect(r.precio.precioUnitario).toBe(11045.35);
    // Lo que importa: reconstruido con IVA vuelve a dar el costo aprobado.
    expect(r.precio.totalReconstruido).toBe(53459.49);
    expect(r.precio.diferencia).toBe(0);
  });

  it("el envío viaja aparte y sin IVA", () => {
    // La fórmula de la comparativa suma el envío DESPUÉS del impuesto.
    const r = precioDesdeElRequerimiento({ costoIva: 1210, costoEnvio: 5000, cantidad: 1 });
    if (!r.ok) throw new Error(r.motivo);

    expect(r.precio.precioUnitario).toBe(1000);
    expect(r.precio.costoEnvio).toBe(5000);
  });

  it("sin cantidad asume una unidad en vez de rechazar", () => {
    // Un servicio o un trabajo no tienen cantidad, y el importe igual es válido.
    const r = precioDesdeElRequerimiento({ costoIva: 1210, costoEnvio: null, cantidad: null });
    if (!r.ok) throw new Error(r.motivo);

    expect(r.precio).toMatchObject({ precioUnitario: 1000, cantidad: 1 });
  });

  it("una cantidad en cero también cuenta como una", () => {
    const r = precioDesdeElRequerimiento({ costoIva: 1210, costoEnvio: null, cantidad: 0 });
    expect(r.ok).toBe(true);
  });

  it("sin costo cargado no se inventa un precio", () => {
    // Una orden de compra con un precio inventado es peor que no tener orden.
    expect(precioDesdeElRequerimiento({ costoIva: null, costoEnvio: 100, cantidad: 2 }).ok).toBe(false);
    expect(precioDesdeElRequerimiento({ costoIva: 0, costoEnvio: null, cantidad: 2 }).ok).toBe(false);
  });

  it("el motivo dice qué falta, no que algo falló", () => {
    const r = precioDesdeElRequerimiento({ costoIva: null, costoEnvio: null, cantidad: 1 });
    if (r.ok) throw new Error("debería fallar");
    expect(r.motivo).toContain("costo + IVA");
  });

  it("acepta otro IVA si algún día se sabe cuál era", () => {
    const r = precioDesdeElRequerimiento({ costoIva: 1105, costoEnvio: null, cantidad: 1, iva: 0.105 });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.precio.precioUnitario).toBe(1000);
    expect(r.precio.iva).toBe(0.105);
  });

  it("el IVA por defecto es el 21%", () => {
    expect(IVA_POR_DEFECTO).toBe(0.21);
  });

  /*
   * Odoo guarda el precio unitario con dos decimales, así que hay totales que no
   * se pueden reconstruir exactos. Lo que no se acepta es que la diferencia sea
   * invisible: se informa.
   */
  it("con muchas unidades avisa cuánto se corre por el redondeo", () => {
    const r = precioDesdeElRequerimiento({ costoIva: 11190300, costoEnvio: null, cantidad: 30000 });
    if (!r.ok) throw new Error(r.motivo);

    expect(r.precio.precioUnitario).toBe(308.27);
    expect(r.precio.diferencia).not.toBe(0);
    // Unos pesos sobre once millones: chico, pero dicho.
    expect(Math.abs(r.precio.diferencia)).toBeLessThan(200);
  });

  it("el total reconstruido incluye el envío", () => {
    const r = precioDesdeElRequerimiento({ costoIva: 1210, costoEnvio: 500, cantidad: 1 });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.precio.totalReconstruido).toBe(1710);
    expect(r.precio.diferencia).toBe(0);
  });
});

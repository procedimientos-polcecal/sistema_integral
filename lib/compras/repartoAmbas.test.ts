import { describe, it, expect } from "vitest";
import {
  PORCENTAJE_AMBAS,
  cantidadQuedaFraccionada,
  repartirAmbas,
  repartirImporte,
} from "./repartoAmbas";

/**
 * Lo que se protege acá es que las dos órdenes de compra sumen exactamente lo
 * mismo que el requerimiento. Un centavo de diferencia en Odoo es una hora de
 * alguien buscándolo, y las AMBAS son más de un tercio de los RI.
 */

describe("repartir el importe", () => {
  it("una mitad justa se parte al medio", () => {
    expect(repartirImporte(1000)).toEqual([500, 500]);
  });

  it("un total impar no pierde ni inventa un centavo", () => {
    const [a, b] = repartirImporte(100.01);

    // Redondeando las dos mitades por separado, esto daría 100.02.
    expect([a, b]).toEqual([50.01, 50]);

    /*
     * La suma se compara en centavos y no en pesos: `50.01 + 50` da
     * 100.00999999999999 en punto flotante. Cada parte sí es exacta —es lo que
     * va a la orden de compra—, el artefacto aparece sólo al sumarlas en JS.
     */
    expect(Math.round(a * 100) + Math.round(b * 100)).toBe(10001);
  });

  it("aguanta importes con centavos cualesquiera", () => {
    for (const total of [0.01, 0.03, 7.77, 1234.56, 999999.99]) {
      const [a, b] = repartirImporte(total);
      expect(Math.round((a + b) * 100) / 100).toBe(total);
    }
  });

  it("un total en cero reparte cero, no NaN", () => {
    expect(repartirImporte(0)).toEqual([0, 0]);
  });

  it("respeta un porcentaje distinto del 50, si alguna vez se cambia la regla", () => {
    const [a, b] = repartirImporte(100, 70);
    expect([a, b]).toEqual([70, 30]);
    expect(a + b).toBe(100);
  });
});

describe("repartir un requerimiento entero", () => {
  it("parte importe y cantidad con el mismo porcentaje", () => {
    const [primera, segunda] = repartirAmbas(2000, 10);

    expect(primera).toEqual({ porcentaje: 50, importe: 1000, cantidad: 5 });
    expect(segunda).toEqual({ porcentaje: 50, importe: 1000, cantidad: 5 });
  });

  it("un RI sin cantidad cargada reparte sólo la plata", () => {
    const [primera, segunda] = repartirAmbas(500, null);

    expect(primera.cantidad).toBeNull();
    expect(segunda.cantidad).toBeNull();
    expect(primera.importe + segunda.importe).toBe(500);
  });

  /*
   * Este es el caso que no cierra solo. En Odoo el importe de una línea sale de
   * cantidad × precio unitario, así que partir 3 unidades como 2 y 1 daría 67/33.
   * Se privilegia el 50/50 del importe, que es lo acordado, y queda la cantidad
   * fraccionada.
   */
  it("una cantidad impar queda fraccionada: es la consecuencia, no un error", () => {
    const [primera, segunda] = repartirAmbas(3000, 3);

    expect(primera.cantidad).toBe(1.5);
    expect(segunda.cantidad).toBe(1.5);
    expect(primera.importe + segunda.importe).toBe(3000);
  });

  it("no arrastra basura de punto flotante a la orden de compra", () => {
    const [primera, segunda] = repartirAmbas(100, 0.3);

    // 0.3 / 2 en binario da 0.15000000000000002 si no se redondea.
    expect(primera.cantidad).toBe(0.15);
    expect(segunda.cantidad).toBe(0.15);
  });

  it("las cantidades suman la cantidad original", () => {
    for (const cantidad of [1, 2, 3, 7, 12.5, 100]) {
      const [a, b] = repartirAmbas(1000, cantidad);
      expect(Math.round(((a.cantidad ?? 0) + (b.cantidad ?? 0)) * 1000) / 1000).toBe(cantidad);
    }
  });
});

describe("avisar cuando la cantidad no se puede partir", () => {
  it("una sola unidad es el peor caso: media bomba no existe", () => {
    expect(cantidadQuedaFraccionada(1)).toBe(true);
  });

  it("las cantidades impares avisan", () => {
    expect(cantidadQuedaFraccionada(3)).toBe(true);
    expect(cantidadQuedaFraccionada(7)).toBe(true);
  });

  it("las pares no tienen problema", () => {
    expect(cantidadQuedaFraccionada(2)).toBe(false);
    expect(cantidadQuedaFraccionada(10)).toBe(false);
  });

  it("lo que ya venía fraccionado no avisa: son kilos, metros u horas", () => {
    // 12,5 metros de cable partidos en 6,25 es perfectamente comprable.
    expect(cantidadQuedaFraccionada(12.5)).toBe(false);
  });

  it("sin cantidad no hay nada que avisar", () => {
    expect(cantidadQuedaFraccionada(null)).toBe(false);
  });
});

describe("la regla acordada", () => {
  it("es 50/50", () => {
    expect(PORCENTAJE_AMBAS).toBe(50);
  });
});

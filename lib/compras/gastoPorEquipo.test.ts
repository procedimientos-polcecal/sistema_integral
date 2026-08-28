import { describe, it, expect } from "vitest";
import { gastoPorAnio, type RequerimientoConCosto } from "./gastoPorEquipo";

const ri = (p: Partial<RequerimientoConCosto>): RequerimientoConCosto => ({
  costo_iva: null,
  fecha_pedido: null,
  fecha: null,
  ...p,
});

describe("gasto por anio de una maquina", () => {
  it("sin requerimientos no inventa un cero", () => {
    expect(gastoPorAnio([])).toEqual({ anios: [], total: 0, conCosto: 0, sinCosto: 0 });
  });

  it("agrupa por anio y ordena del mas reciente al mas viejo", () => {
    const g = gastoPorAnio([
      ri({ costo_iva: 100, fecha_pedido: "2024-03-01" }),
      ri({ costo_iva: 200, fecha_pedido: "2026-01-15" }),
      ri({ costo_iva: 50, fecha_pedido: "2025-07-09" }),
    ]);

    expect(g.anios.map((a) => a.anio)).toEqual(["2026", "2025", "2024"]);
    expect(g.total).toBe(350);
  });

  /**
   * Cero es un dato —salio gratis— y vacio quiere decir que nadie lo cargo.
   * Sumarlos como cero haria parecer barata una maquina que no lo es: son 380
   * de los 1.900 RI del historico.
   */
  it("los que no tienen costo se cuentan aparte y no suman", () => {
    const g = gastoPorAnio([
      ri({ costo_iva: 1000, fecha_pedido: "2026-02-01" }),
      ri({ costo_iva: null, fecha_pedido: "2026-02-02" }),
      ri({ costo_iva: "", fecha_pedido: "2026-02-03" }),
    ]);

    expect(g.total).toBe(1000);
    expect(g.conCosto).toBe(1);
    expect(g.sinCosto).toBe(2);
    expect(g.anios[0]).toEqual({ anio: "2026", total: 1000, conCosto: 1, sinCosto: 2 });
  });

  it("un costo de cero si suma, porque es un dato", () => {
    const g = gastoPorAnio([ri({ costo_iva: 0, fecha_pedido: "2026-02-01" })]);
    expect(g.conCosto).toBe(1);
    expect(g.sinCosto).toBe(0);
  });

  /** PostgREST devuelve numeric como string cuando no entra en un double. */
  it("lee el costo venga como numero o como string", () => {
    const g = gastoPorAnio([
      ri({ costo_iva: "1848315.53", fecha_pedido: "2026-01-01" }),
      ri({ costo_iva: 1000, fecha_pedido: "2026-01-01" }),
    ]);
    expect(g.total).toBeCloseTo(1849315.53, 2);
  });

  it("un costo ilegible se trata como ausente, no como cero", () => {
    const g = gastoPorAnio([ri({ costo_iva: "s/d", fecha_pedido: "2026-01-01" })]);
    expect(g.sinCosto).toBe(1);
    expect(g.total).toBe(0);
  });

  /**
   * `fecha_pedido` es cuando se gasto. Los RI que nunca llegaron a PEDIDO no la
   * tienen y caen en su fecha de alta, que es lo mas cerca que hay.
   */
  it("imputa el anio a fecha_pedido y usa fecha como respaldo", () => {
    const g = gastoPorAnio([
      ri({ costo_iva: 10, fecha_pedido: "2026-01-01", fecha: "2025-12-20" }),
      ri({ costo_iva: 20, fecha_pedido: null, fecha: "2025-11-05" }),
    ]);

    expect(g.anios).toEqual([
      { anio: "2026", total: 10, conCosto: 1, sinCosto: 0 },
      { anio: "2025", total: 20, conCosto: 1, sinCosto: 0 },
    ]);
  });

  it("sin ninguna fecha suma al total pero no arma un anio", () => {
    const g = gastoPorAnio([ri({ costo_iva: 500 })]);
    expect(g.total).toBe(500);
    expect(g.anios).toEqual([]);
  });
});

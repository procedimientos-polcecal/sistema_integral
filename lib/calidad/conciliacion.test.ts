import { describe, it, expect } from "vitest";
import {
  desviosContraOdoo,
  type CamionDelLibro,
  type LineaDeOdooParaControl,
} from "./conciliacion";

const camion = (
  fecha: string,
  partner: number,
  toneladas: number,
  id = `${fecha}-${partner}-${toneladas}`
): CamionDelLibro => ({ id, fecha, odooPartnerId: partner, toneladas });

const linea = (
  fecha: string,
  partner: number,
  cantidad: number,
  orden = `P0${partner}`
): LineaDeOdooParaControl => ({
  ordenNombre: orden,
  fecha,
  partnerId: partner,
  partnerNombre: "PROVEEDOR",
  cantidad,
});

describe("desviosContraOdoo", () => {
  it("un camión con su orden del mismo día y cantidad no es desvío", () => {
    const r = desviosContraOdoo(
      [camion("2026-10-01", 906, 19.58)],
      [linea("2026-10-01", 906, 19.58)]
    );
    expect(r.sinOrden).toEqual([]);
    expect(r.sinCamion).toEqual([]);
    expect(r.cantidadDistinta).toEqual([]);
  });

  it("un camión sin orden es el desvío que importa: no se puede facturar", () => {
    const r = desviosContraOdoo([camion("2026-10-08", 906, 17.12)], []);
    expect(r.sinOrden).toHaveLength(1);
    expect(r.sinOrden[0].fecha).toBe("2026-10-08");
  });

  it("una orden sin camión también se informa", () => {
    const r = desviosContraOdoo([], [linea("2026-10-08", 906, 17.12, "P02500")]);
    expect(r.sinCamion).toHaveLength(1);
    expect(r.sinCamion[0].ordenNombre).toBe("P02500");
  });

  it("el mismo camión con cantidad distinta aparea y se informa", () => {
    // Lo medido: 60 de 575 en el año difieren por decenas de kilos.
    const r = desviosContraOdoo(
      [camion("2026-09-01", 906, 16.5)],
      [linea("2026-09-01", 906, 16.6)]
    );
    expect(r.sinOrden).toEqual([]);
    expect(r.sinCamion).toEqual([]);
    expect(r.cantidadDistinta).toHaveLength(1);
    expect(r.cantidadDistinta[0].enElLibro).toBe(16.5);
    expect(r.cantidadDistinta[0].enOdoo).toBe(16.6);
  });

  it("aparea con hasta dos días de diferencia, que es lo que tarda Odoo", () => {
    const r = desviosContraOdoo(
      [camion("2026-10-01", 906, 19.58)],
      [linea("2026-10-03", 906, 19.58)]
    );
    expect(r.sinOrden).toEqual([]);
    expect(r.sinCamion).toEqual([]);
  });

  // Review Focus 5.
  it("no aparea un camión de un proveedor con la orden de otro", () => {
    // Dos desvíos el mismo día no son un match: aparearlos por cercanía es
    // exactamente el cruce que este módulo existe para eliminar.
    const r = desviosContraOdoo(
      [camion("2026-10-08", 906, 17.12)],
      [linea("2026-10-08", 1056, 17.12)]
    );
    expect(r.sinOrden).toHaveLength(1);
    expect(r.sinCamion).toHaveLength(1);
    expect(r.cantidadDistinta).toEqual([]);
  });

  it("dos camiones iguales del mismo día consumen dos órdenes, no una", () => {
    const r = desviosContraOdoo(
      [camion("2026-10-08", 906, 17.12, "a"), camion("2026-10-08", 906, 17.12, "b")],
      [linea("2026-10-08", 906, 17.12)]
    );
    expect(r.sinOrden).toHaveLength(1);
  });

  it("sin camiones y sin órdenes no hay desvíos", () => {
    expect(desviosContraOdoo([], [])).toEqual({
      sinOrden: [],
      sinCamion: [],
      cantidadDistinta: [],
    });
  });
});

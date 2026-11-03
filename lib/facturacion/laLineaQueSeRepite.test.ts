import { describe, expect, it } from "vitest";
import {
  laLineaQueSeRepite,
  type FacturaAnterior,
  type LineaContabilizada,
} from "./laLineaQueSeRepite";

/** El flete de RUBIALES: siempre el mismo producto, cuenta y reparto. */
const FLETE: LineaContabilizada = {
  productoId: 6502,
  productoNombre: "FLETE",
  cuentaId: 311,
  cuentaNombre: "5.1.1.01.011 Fletes y Acarreos",
  analitica: { 44: 100 },
};

const OTRA: LineaContabilizada = {
  productoId: 6835,
  productoNombre: "CONDUCTOR",
  cuentaId: 220,
  cuentaNombre: "5.2.1.01.220 Repuestos",
  analitica: { 44: 100 },
};

const con = (...lineas: LineaContabilizada[]): FacturaAnterior => ({ lineas });

describe("un proveedor que siempre factura lo mismo", () => {
  it("tres iguales: se pone", () => {
    const r = laLineaQueSeRepite([con(FLETE), con(FLETE), con(FLETE)]);
    expect(r?.productoId).toBe(6502);
    expect(r?.cuentaId).toBe(311);
    expect(r?.analitica).toEqual({ 44: 100 });
    expect(r?.porque).toContain("últimas 3");
  });

  it("y la cuarta no cambia nada: sólo se miran las últimas tres", () => {
    expect(laLineaQueSeRepite([con(FLETE), con(FLETE), con(FLETE), con(OTRA)])).not.toBeNull();
  });

  /*
   * Una factura con varias líneas iguales sigue siendo una sola imputación.
   * Es el caso de un flete facturado en dos renglones.
   */
  it("varias líneas, pero todas con la misma imputación", () => {
    const r = laLineaQueSeRepite([con(FLETE, FLETE), con(FLETE), con(FLETE, FLETE, FLETE)]);
    expect(r?.productoId).toBe(6502);
  });
});

describe("cuándo NO se da nada por sabido", () => {
  it("con menos de tres facturas de historia", () => {
    expect(laLineaQueSeRepite([con(FLETE), con(FLETE)])).toBeNull();
  });

  it("si una de las tres fue a otro lado", () => {
    expect(laLineaQueSeRepite([con(FLETE), con(OTRA), con(FLETE)])).toBeNull();
  });

  /*
   * Lo que separa una regla de certeza de una estadística: una factura con dos
   * imputaciones distintas adentro no dice "siempre lo mismo", dice "varias
   * cosas". No se elige la mayoritaria.
   */
  it("si una factura tiene adentro dos imputaciones distintas", () => {
    expect(laLineaQueSeRepite([con(FLETE), con(FLETE, OTRA), con(FLETE)])).toBeNull();
  });

  it("si alguna factura no tiene líneas", () => {
    expect(laLineaQueSeRepite([con(FLETE), con(), con(FLETE)])).toBeNull();
  });

  /*
   * Tres facturas sin imputar son unánimes en no decir nada. Devolver eso
   * sería afirmar que se aprendió algo.
   */
  it("si las tres están vacías, que es unanimidad pero no es un antecedente", () => {
    const vacia: LineaContabilizada = {
      productoId: null, productoNombre: null,
      cuentaId: null, cuentaNombre: null, analitica: null,
    };
    expect(laLineaQueSeRepite([con(vacia), con(vacia), con(vacia)])).toBeNull();
  });

  it("pero con sólo la cuenta puesta sí alcanza", () => {
    const soloCuenta: LineaContabilizada = {
      productoId: null, productoNombre: null,
      cuentaId: 311, cuentaNombre: "Fletes", analitica: null,
    };
    expect(laLineaQueSeRepite([con(soloCuenta), con(soloCuenta), con(soloCuenta)])?.cuentaId).toBe(311);
  });
});

describe("el reparto analítico se compara por contenido", () => {
  it("el mismo reparto escrito en otro orden es el mismo", () => {
    const a: LineaContabilizada = { ...FLETE, analitica: { 44: 50, 55: 50 } };
    const b: LineaContabilizada = { ...FLETE, analitica: { 55: 50, 44: 50 } };
    expect(laLineaQueSeRepite([con(a), con(b), con(a)])).not.toBeNull();
  });

  it("y distinto porcentaje es otro reparto", () => {
    const a: LineaContabilizada = { ...FLETE, analitica: { 44: 50, 55: 50 } };
    const b: LineaContabilizada = { ...FLETE, analitica: { 44: 60, 55: 40 } };
    expect(laLineaQueSeRepite([con(a), con(b), con(a)])).toBeNull();
  });
});

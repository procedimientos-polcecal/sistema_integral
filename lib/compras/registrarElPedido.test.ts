import { describe, it, expect } from "vitest";
import { faltaLaFechaEstimada, creaLaOrdenEnOdoo, avisoDelPedido } from "./registrarElPedido";

describe("faltaLaFechaEstimada", () => {
  it("la exige al entrar a PEDIDO sin fecha", () => {
    expect(
      faltaLaFechaEstimada({ estadoActual: "APROBADO", nuevoEstado: "PEDIDO", fechaEstimada: null })
    ).toBe(true);
  });

  it("no la exige si viene cargada", () => {
    expect(
      faltaLaFechaEstimada({
        estadoActual: "APROBADO",
        nuevoEstado: "PEDIDO",
        fechaEstimada: "2026-11-12",
      })
    ).toBe(false);
  });

  it("trata la cadena vacía como que falta", () => {
    expect(
      faltaLaFechaEstimada({ estadoActual: "APROBADO", nuevoEstado: "PEDIDO", fechaEstimada: "" })
    ).toBe(true);
  });

  /*
   * El caso que importa: el formulario de recepción manda `estado_compra:
   * "PEDIDO"` en cada guardado sin fecha de recepción. Exigirla también ahí
   * dejaría sin poder cargarse los 349 RI que ya estaban en PEDIDO sin fecha.
   */
  it("no la exige cuando ya estaba en PEDIDO", () => {
    expect(
      faltaLaFechaEstimada({ estadoActual: "PEDIDO", nuevoEstado: "PEDIDO", fechaEstimada: null })
    ).toBe(false);
  });

  it("no la exige al pasar a otro estado", () => {
    expect(
      faltaLaFechaEstimada({
        estadoActual: "EN_COMPARATIVA",
        nuevoEstado: "PARA_COMPRAR",
        fechaEstimada: null,
      })
    ).toBe(false);
  });

  it("no la exige al volver de la espera, igual que el proveedor y el costo", () => {
    expect(
      faltaLaFechaEstimada({
        estadoActual: "EN_ESPERA",
        nuevoEstado: "PEDIDO",
        fechaEstimada: null,
        vuelveDeLaEspera: true,
      })
    ).toBe(false);
  });

  it("no la exige cuando el cuerpo no toca el estado", () => {
    expect(
      faltaLaFechaEstimada({ estadoActual: "APROBADO", nuevoEstado: undefined, fechaEstimada: null })
    ).toBe(false);
  });
});

describe("creaLaOrdenEnOdoo", () => {
  it("la crea al entrar a PEDIDO cuando nadie dijo nada", () => {
    expect(
      creaLaOrdenEnOdoo({ estadoActual: "APROBADO", nuevoEstado: "PEDIDO", quiere: undefined })
    ).toBe(true);
  });

  it("la crea si el casillero vino tildado", () => {
    expect(
      creaLaOrdenEnOdoo({ estadoActual: "APROBADO", nuevoEstado: "PEDIDO", quiere: true })
    ).toBe(true);
  });

  it("la saltea sólo ante un false explícito", () => {
    expect(
      creaLaOrdenEnOdoo({ estadoActual: "APROBADO", nuevoEstado: "PEDIDO", quiere: false })
    ).toBe(false);
  });

  it("no la crea si ya estaba en PEDIDO", () => {
    expect(
      creaLaOrdenEnOdoo({ estadoActual: "PEDIDO", nuevoEstado: "PEDIDO", quiere: true })
    ).toBe(false);
  });

  it("no la crea al pasar a otro estado aunque lo pidan", () => {
    expect(
      creaLaOrdenEnOdoo({ estadoActual: "PEDIDO", nuevoEstado: "RECIBIDO", quiere: true })
    ).toBe(false);
  });
});

describe("avisoDelPedido", () => {
  it("no dice nada cuando no pasó nada", () => {
    expect(avisoDelPedido({})).toBeNull();
  });

  it("nombra la orden creada", () => {
    expect(avisoDelPedido({ orden_odoo: ["P00123"] })).toBe(
      "Orden de compra creada en Odoo: P00123."
    );
  });

  it("junta las dos órdenes cuando el RI se repartió entre las dos empresas", () => {
    expect(avisoDelPedido({ orden_odoo: ["P00123", "P00124"] })).toBe(
      "Orden de compra creada en Odoo: P00123, P00124."
    );
  });

  it("dice los dos fallos juntos, sin que uno tape al otro", () => {
    expect(
      avisoDelPedido({ aviso_odoo: "Odoo falló.", aviso_sheets: "La planilla falló." })
    ).toBe("Odoo falló. La planilla falló.");
  });

  it("ignora las claves vacías que devuelve la ruta cuando salió todo bien", () => {
    expect(avisoDelPedido({ aviso_sheets: null, aviso_odoo: null, orden_odoo: [] })).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { leerEstado } from "./estadoDeOrden";

describe("qué se puede hacer con una orden de compra según su estado", () => {
  it("un borrador se puede confirmar", () => {
    const e = leerEstado("draft");
    expect(e.sePuedeConfirmar).toBe(true);
    expect(e.estaConfirmada).toBe(false);
  });

  it("una cotización enviada también", () => {
    expect(leerEstado("sent").sePuedeConfirmar).toBe(true);
  });

  it("una ya confirmada no se vuelve a confirmar", () => {
    const e = leerEstado("purchase");
    expect(e.sePuedeConfirmar).toBe(false);
    expect(e.estaConfirmada).toBe(true);
  });

  it("una bloqueada cuenta como confirmada", () => {
    // `done` es una orden confirmada y cerrada: el papel ya vale.
    expect(leerEstado("done").estaConfirmada).toBe(true);
    expect(leerEstado("done").sePuedeConfirmar).toBe(false);
  });

  it("una cancelada NO se ofrece confirmar", () => {
    // Alguien la dio de baja del otro lado. Revivirla desde acá es pisar una
    // decisión de Odoo, que es quien manda.
    const e = leerEstado("cancel");
    expect(e.sePuedeConfirmar).toBe(false);
    expect(e.estaConfirmada).toBe(false);
    expect(e.nombre).toBe("Cancelada");
  });

  it("una que espera aprobación NO se ofrece confirmar", () => {
    // Ahí Odoo pide `button_approve`, que es la aprobación de otra persona:
    // ofrecer `button_confirm` manda a apretar algo que va a fallar.
    const e = leerEstado("to approve");
    expect(e.sePuedeConfirmar).toBe(false);
    expect(e.estaConfirmada).toBe(false);
  });

  it("sin estado no se ofrece nada, y se dice", () => {
    for (const vacio of [null, undefined, ""]) {
      const e = leerEstado(vacio);
      expect(e.sePuedeConfirmar).toBe(false);
      expect(e.estaConfirmada).toBe(false);
      expect(e.nombre).toBe("No está en Odoo");
    }
  });

  it("un estado desconocido se muestra tal cual en vez de traducirse a una mentira", () => {
    const e = leerEstado("algo_nuevo_de_odoo");
    expect(e.nombre).toBe("algo_nuevo_de_odoo");
    expect(e.sePuedeConfirmar).toBe(false);
    expect(e.estaConfirmada).toBe(false);
  });
});

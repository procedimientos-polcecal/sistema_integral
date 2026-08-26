import { describe, it, expect } from "vitest";
import { puedeAprobarLaCompra } from "./aprobarCompra";

const YO = "u-nico";
const OTRO = "u-maxi";

/**
 * Aprobar la compra tiene dos caminos —elegir un presupuesto, y aprobar sin
 * comparativa— y los dos tienen que pedir lo mismo. Cuando la regla estaba
 * escrita en cada ruta por separado, la del PATCH se habia olvidado de la
 * lista de aprobadores.
 */
describe("quien puede aprobar una compra", () => {
  it("la persona asignada y en la lista, si", () => {
    const v = puedeAprobarLaCompra({
      asignadaA: YO, usuarioId: YO, estaEnLaLista: true, estadoCompra: "PARA_COMPRAR",
    });
    expect(v.ok).toBe(true);
  });

  it("otra persona no, aunque este en la lista", () => {
    // En la planilla el estado dice a quien le toca: que apruebe otro dejaria
    // los dos lados diciendo cosas distintas.
    const v = puedeAprobarLaCompra({
      asignadaA: OTRO, usuarioId: YO, estaEnLaLista: true, estadoCompra: "PARA_COMPRAR",
    });
    expect(v.ok).toBe(false);
    expect(v.estado).toBe(403);
    expect(v.error).toMatch(/asign/);
  });

  it("el asignado que salio de la lista, tampoco", () => {
    const v = puedeAprobarLaCompra({
      asignadaA: YO, usuarioId: YO, estaEnLaLista: false, estadoCompra: "PARA_COMPRAR",
    });
    expect(v.ok).toBe(false);
    expect(v.estado).toBe(403);
    expect(v.error).toMatch(/lista/);
  });

  it("sin nadie asignado no puede aprobar nadie", () => {
    const v = puedeAprobarLaCompra({
      asignadaA: null, usuarioId: YO, estaEnLaLista: true, estadoCompra: "PARA_COMPRAR",
    });
    expect(v.ok).toBe(false);
  });

  it("una compra que no esta para comprar no se aprueba", () => {
    const v = puedeAprobarLaCompra({
      asignadaA: YO, usuarioId: YO, estaEnLaLista: true, estadoCompra: "PEDIDO",
    });
    expect(v.ok).toBe(false);
    expect(v.estado).toBe(409);
  });

  it("sin pasar el estado no se lo valida: lo hace quien llama", () => {
    const v = puedeAprobarLaCompra({ asignadaA: YO, usuarioId: YO, estaEnLaLista: true });
    expect(v.ok).toBe(true);
  });
});

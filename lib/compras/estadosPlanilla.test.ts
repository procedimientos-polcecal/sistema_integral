import { describe, it, expect } from "vitest";
import { estadoCompraDe, estadoAprobacionDe } from "./sheets";

/**
 * Estos dos leen el estado de una celda de la planilla. La distinción que
 * importa es entre "la planilla dice X" y "no se pudo leer": lo segundo tiene
 * que devolver null para que la sincronización conserve lo que ya sabe.
 *
 * Antes devolvían SIN_INICIAR y PENDIENTE en los dos casos, así que una celda
 * vacía o con un valor inesperado pisaba el estado guardado. En una sola corrida
 * eso mandó 15 requerimientos de PEDIDO a SIN_INICIAR: compras ya hechas que
 * volvían a foja cero.
 */
describe("estado de compra de la planilla", () => {
  it("lee los valores del desplegable", () => {
    expect(estadoCompraDe("PEDIDO").estado).toBe("PEDIDO");
    expect(estadoCompraDe("EN PROCESO (COMPARATIVA)").estado).toBe("EN_COMPARATIVA");
    expect(estadoCompraDe("APROBADO").estado).toBe("APROBADO");
    expect(estadoCompraDe("DENEGADO").estado).toBe("DENEGADO");
    expect(estadoCompraDe("RECIBIDO").estado).toBe("RECIBIDO");
  });

  it("saca de los paréntesis a quién le toca comprar", () => {
    const r = estadoCompraDe("PARA COMPRAR (NICO)");
    expect(r.estado).toBe("PARA_COMPRAR");
    expect(r.aprobador).toBe("NICO");
  });

  it("(POR APROBAR) no nombra a nadie", () => {
    const r = estadoCompraDe("PARA COMPRAR (POR APROBAR)");
    expect(r.estado).toBe("PARA_COMPRAR");
    expect(r.aprobador).toBeNull();
  });

  it("una celda vacía es 'no sé', no 'sin iniciar'", () => {
    expect(estadoCompraDe("").estado).toBeNull();
    expect(estadoCompraDe(null).estado).toBeNull();
    expect(estadoCompraDe("   ").estado).toBeNull();
  });

  it("un valor que no reconoce tampoco se inventa", () => {
    expect(estadoCompraDe("EN CAMINO").estado).toBeNull();
    expect(estadoCompraDe("ver con Nico").estado).toBeNull();
  });
});

describe("estado de aprobación de la planilla", () => {
  it("lee los valores del desplegable y quién aprobó", () => {
    const r = estadoAprobacionDe("APROBADA (NICO)");
    expect(r.estado).toBe("APROBADA");
    expect(r.aprobador).toBe("NICO");
    expect(estadoAprobacionDe("DENEGADA").estado).toBe("DENEGADA");
  });

  it("una celda vacía es 'no sé', no 'pendiente'", () => {
    expect(estadoAprobacionDe("").estado).toBeNull();
    expect(estadoAprobacionDe(null).estado).toBeNull();
  });

  it("un valor que no reconoce tampoco se inventa", () => {
    expect(estadoAprobacionDe("hablar con gerencia").estado).toBeNull();
  });

  it("EN REVISIÓN sí se reconoce", () => {
    expect(estadoAprobacionDe("EN REVISIÓN").estado).toBe("EN_REVISION");
  });
});

/**
 * "EN ESPERA" es un pedido frenado a proposito. Comparte prefijo con
 * "EN PROCESO (COMPARATIVA)", asi que el orden de los chequeos importa: si el
 * de PROCESO corriera primero, toda espera se leeria como comparativa y los
 * pedidos frenados volverian solos a la cola en cada sincronizacion.
 */
describe("EN ESPERA, el pedido frenado", () => {
  it("se lee como EN_ESPERA y no como comparativa", () => {
    expect(estadoCompraDe("EN ESPERA").estado).toBe("EN_ESPERA");
  });

  it("no se confunde con EN PROCESO (COMPARATIVA)", () => {
    expect(estadoCompraDe("EN PROCESO (COMPARATIVA)").estado).toBe("EN_COMPARATIVA");
  });

  it("tolera mayusculas y espacios como el resto", () => {
    expect(estadoCompraDe("  en espera  ").estado).toBe("EN_ESPERA");
    expect(estadoCompraDe("En Espera").estado).toBe("EN_ESPERA");
  });

  it("no aprueba a nadie: la espera no nombra personas", () => {
    expect(estadoCompraDe("EN ESPERA").aprobador).toBeNull();
  });
});

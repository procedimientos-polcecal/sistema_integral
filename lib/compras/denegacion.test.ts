import { describe, it, expect } from "vitest";
import { esDenegacion, faltaLaJustificacion } from "./denegacion";

/**
 * Denegar un RI le cierra la puerta a quien lo pidio, asi que no puede ser
 * mudo. Aprobar no necesita explicacion: el pedido sigue su curso.
 *
 * Se mira lo que el cambio *pone*, no en que estado esta el RI: un PATCH que
 * toca el proveedor de un RI ya denegado no vuelve a pedir el motivo.
 */
describe("que cambios son una denegacion", () => {
  it("denegar la aprobacion lo es", () => {
    expect(esDenegacion({ estado_aprobacion: "DENEGADA" })).toBe(true);
  });

  it("poner la compra en DENEGADO tambien", () => {
    // No es el camino que ofrece la pantalla —la ficha filtra DENEGADO del
    // desplegable— pero la API lo acepta, y una regla que se esquiva cambiando
    // de campo no es una regla.
    expect(esDenegacion({ estado_compra: "DENEGADO" })).toBe(true);
  });

  it("aprobar no lo es", () => {
    expect(esDenegacion({ estado_aprobacion: "APROBADA" })).toBe(false);
    expect(esDenegacion({ estado_aprobacion: "EN_REVISION" })).toBe(false);
  });

  it("mover la compra a otra etapa no lo es", () => {
    expect(esDenegacion({ estado_compra: "PEDIDO" })).toBe(false);
    expect(esDenegacion({ estado_compra: "EN_ESPERA" })).toBe(false);
  });

  it("un cambio que no toca ningun estado no lo es", () => {
    expect(esDenegacion({ proveedor_id: "prov-1", costo_iva: 1000 })).toBe(false);
    expect(esDenegacion({})).toBe(false);
  });
});

describe("la justificacion de la denegacion", () => {
  it("sin motivo, la denegacion no pasa", () => {
    expect(faltaLaJustificacion({ estado_aprobacion: "DENEGADA" })).toBe(true);
    expect(faltaLaJustificacion({ estado_aprobacion: "DENEGADA", motivo_rechazo: "" })).toBe(true);
    expect(faltaLaJustificacion({ estado_aprobacion: "DENEGADA", motivo_rechazo: null })).toBe(true);
  });

  it("un motivo que no explica nada tampoco pasa", () => {
    expect(faltaLaJustificacion({ estado_aprobacion: "DENEGADA", motivo_rechazo: "." })).toBe(true);
    expect(faltaLaJustificacion({ estado_aprobacion: "DENEGADA", motivo_rechazo: "no" })).toBe(true);
  });

  it("con un motivo real, pasa", () => {
    expect(
      faltaLaJustificacion({ estado_aprobacion: "DENEGADA", motivo_rechazo: "Duplicado del RI 1820" })
    ).toBe(false);
  });

  it("la exige tambien cuando el denegado llega por la rama de compra", () => {
    expect(faltaLaJustificacion({ estado_compra: "DENEGADO" })).toBe(true);
    expect(
      faltaLaJustificacion({ estado_compra: "DENEGADO", motivo_rechazo: "Lo cubre el service" })
    ).toBe(false);
  });

  it("los demas cambios no piden motivo", () => {
    expect(faltaLaJustificacion({ estado_aprobacion: "APROBADA" })).toBe(false);
    expect(faltaLaJustificacion({ estado_compra: "PEDIDO" })).toBe(false);
    expect(faltaLaJustificacion({ prioridad: "URGENTE" })).toBe(false);
  });
});

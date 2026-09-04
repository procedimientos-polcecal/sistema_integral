import { describe, it, expect } from "vitest";
import {
  esDenegacionDeOS, faltaLaJustificacion, dondeSeEscribeElEstado, seguroParaElMaestro,
} from "./denegacion";

/**
 * Denegar una OS es nuevo: hasta ahora ninguno de los cinco estados de
 * ESTADOS_OS lo era, y en la planilla se escribia a mano. La palabra es
 * DENEGADO, la que usa quien la escribe.
 */
describe("que cambios deniegan una OS", () => {
  it("poner el estado en DENEGADO lo es", () => {
    expect(esDenegacionDeOS("DENEGADO")).toBe(true);
  });

  it("los demas estados del circuito no lo son", () => {
    expect(esDenegacionDeOS("APROBADO")).toBe(false);
    expect(esDenegacionDeOS("ACEPTADO")).toBe(false);
    expect(esDenegacionDeOS("EN PROCESO (COMPARATIVA)")).toBe(false);
    expect(esDenegacionDeOS("POR APROBAR")).toBe(false);
  });

  it("no tocar el estado no lo es", () => {
    expect(esDenegacionDeOS(undefined)).toBe(false);
    expect(esDenegacionDeOS(null)).toBe(false);
  });
});

describe("la justificacion de la denegacion", () => {
  it("sin motivo no pasa", () => {
    expect(faltaLaJustificacion("DENEGADO", undefined)).toBe(true);
    expect(faltaLaJustificacion("DENEGADO", "")).toBe(true);
    expect(faltaLaJustificacion("DENEGADO", "-")).toBe(true);
  });

  it("con un motivo real pasa", () => {
    expect(faltaLaJustificacion("DENEGADO", "Lo hace el taller propio")).toBe(false);
  });

  it("los demas estados no piden motivo", () => {
    expect(faltaLaJustificacion("ACEPTADO", undefined)).toBe(false);
    expect(faltaLaJustificacion("APROBADO", undefined)).toBe(false);
  });
});

/**
 * La planilla de OS tiene dos estados y no uno. SERVICIOS!L es el maestro
 * —escrito a mano— y es el que lee el FILTER de cada pestaña de area, asi que
 * decide si la OS llega a su pestaña. Cada pestaña tiene ademas su propio
 * estado de seguimiento, para una OS ya aprobada.
 *
 * De ahi la regla: el estado se escribe donde vive la fila. Una OS que todavia
 * esta en SERVICIOS se deniega ahi y no llega nunca a la pestaña; una que ya
 * esta en la pestaña se deniega ahi y se queda.
 */
describe("donde se escribe el estado", () => {
  it("una OS que todavia vive en SERVICIOS se escribe en el estado maestro", () => {
    expect(dondeSeEscribeElEstado("SERVICIOS")).toBe("maestro");
  });

  it("una que ya paso a la pestaña de su area se escribe en el seguimiento", () => {
    expect(dondeSeEscribeElEstado("MANTENIMIENTO")).toBe("seguimiento");
    expect(dondeSeEscribeElEstado("TALLER VIAL")).toBe("seguimiento");
  });

  it("sin pestaña no hay donde escribir", () => {
    expect(dondeSeEscribeElEstado(null)).toBe(null);
    expect(dondeSeEscribeElEstado("")).toBe(null);
  });
});

/**
 * Escribir el estado maestro no es gratis para cualquier valor. Las pestañas de
 * area son un FILTER por estado="APROBADO": poner ese valor mete la fila en la
 * pestaña y corre todas las de abajo, y el seguimiento escrito a mano NO se
 * corre con ellas —queda un proveedor o un costo colgado de otra OS—.
 *
 * Denegar es el caso seguro: la OS ya estaba fuera de la pestaña y sigue
 * afuera, asi que no mueve ninguna fila.
 */
describe("que estados se pueden escribir en el maestro", () => {
  it("denegar es seguro: no mete la fila en ninguna pestaña", () => {
    expect(seguroParaElMaestro("DENEGADO")).toBe(true);
  });

  it("los que dejan la OS afuera de las pestañas tambien", () => {
    expect(seguroParaElMaestro("POR APROBAR")).toBe(true);
    expect(seguroParaElMaestro("EN REVISIÓN")).toBe(true);
    expect(seguroParaElMaestro("")).toBe(true);
  });

  it("aprobar no: es el unico valor que el FILTER levanta", () => {
    expect(seguroParaElMaestro("APROBADO")).toBe(false);
    expect(seguroParaElMaestro("aprobado")).toBe(false);
    expect(seguroParaElMaestro("  APROBADO  ")).toBe(false);
  });
});

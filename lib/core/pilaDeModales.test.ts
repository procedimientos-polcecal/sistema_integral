import { describe, expect, it } from "vitest";
import { apilarModal, desapilarModal, esElModalDeArriba } from "./pilaDeModales";

describe("pilaDeModales", () => {
  it("con un solo modal, ese es el de arriba", () => {
    const a = apilarModal();
    expect(esElModalDeArriba(a)).toBe(true);
    desapilarModal(a);
  });

  it("con dos, sólo el último montado es el de arriba", () => {
    const ot = apilarModal();
    const calendario = apilarModal();
    expect(esElModalDeArriba(calendario)).toBe(true);
    expect(esElModalDeArriba(ot)).toBe(false);
    desapilarModal(calendario);
    desapilarModal(ot);
  });

  it("al cerrarse el de arriba, el de abajo vuelve a responder", () => {
    const ot = apilarModal();
    const calendario = apilarModal();
    desapilarModal(calendario);
    expect(esElModalDeArriba(ot)).toBe(true);
    desapilarModal(ot);
  });

  it("si se desmonta el de abajo con otro abierto, el de arriba sigue siéndolo", () => {
    const ot = apilarModal();
    const calendario = apilarModal();
    desapilarModal(ot);
    expect(esElModalDeArriba(calendario)).toBe(true);
    expect(esElModalDeArriba(ot)).toBe(false);
    desapilarModal(calendario);
  });

  it("si se desmonta uno de en medio, no mueve a los otros", () => {
    const a = apilarModal();
    const b = apilarModal();
    const c = apilarModal();
    desapilarModal(b);
    expect(esElModalDeArriba(c)).toBe(true);
    desapilarModal(c);
    expect(esElModalDeArriba(a)).toBe(true);
    desapilarModal(a);
  });

  it("sacar dos veces la misma ficha no toca a las demás", () => {
    const a = apilarModal();
    const b = apilarModal();
    desapilarModal(b);
    desapilarModal(b);
    expect(esElModalDeArriba(a)).toBe(true);
    desapilarModal(a);
  });

  it("una ficha que ya no está nunca es la de arriba, ni con la pila vacía", () => {
    const a = apilarModal();
    desapilarModal(a);
    expect(esElModalDeArriba(a)).toBe(false);
  });
});

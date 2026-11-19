import { describe, it, expect } from "vitest";
import { abrirCaja, cambiarCaja, cerrarCaja, type Cajas } from "./cajasDePregunta";
import { TEXTO_DEL_SEGUIMIENTO } from "./consultaDeRepuesto";

/** Una caja ya escrita a medias, que es lo que no se puede perder. */
const escrita = (texto: string) => ({ encabezado: "ENC ", error: "", texto });

describe("abrir la caja de un repuesto", () => {
  /**
   * EL TEST QUE JUSTIFICA QUE ESTE ARCHIVO EXISTA. Medido el 31/10/2026: volver a
   * `setCajas(() => ({ [r.id]: … }))` —la rotura que esto arregló— dejaba los 4.464
   * tests en verde. Perder lo que alguien tipeó no tira ningún error.
   */
  it("no toca lo que ya estaba escrito en otro repuesto", () => {
    const antes: Cajas = { r1: escrita("ENC falta hace una semana") };
    const despues = abrirCaja(antes, "r2", "ENC2 ", false);

    expect(despues.r1.texto).toBe("ENC falta hace una semana");
    expect(Object.keys(despues).sort()).toEqual(["r1", "r2"]);
  });

  it("la nueva arranca con el encabezado", () => {
    expect(abrirCaja({}, "r1", "ENC ", false).r1.texto).toBe("ENC ");
  });

  /** Si el repuesto ya tiene una pregunta esperando, lo que se escribe sigue el hilo. */
  it("sobre una pregunta que espera, arranca como seguimiento", () => {
    expect(abrirCaja({}, "r1", "ENC ", true).r1.texto).toBe(`ENC ${TEXTO_DEL_SEGUIMIENTO} `);
  });

  /** Volver a apretar «Preguntar» en el mismo repuesto empieza de nuevo: eso sí se quiere. */
  it("reabrir la misma la reinicia, y sólo a ella", () => {
    const antes: Cajas = { r1: escrita("a medio escribir"), r2: escrita("lo de r2") };
    const despues = abrirCaja(antes, "r1", "ENC ", false);

    expect(despues.r1.texto).toBe("ENC ");
    expect(despues.r2.texto).toBe("lo de r2");
  });

  it("no modifica el registro que recibe", () => {
    const antes: Cajas = { r1: escrita("intacto") };
    abrirCaja(antes, "r2", "ENC2 ", false);
    expect(Object.keys(antes)).toEqual(["r1"]);
  });

  /** El error de un envío anterior no se arrastra al volver a abrir. */
  it("la caja nueva arranca sin error", () => {
    const antes: Cajas = { r1: { encabezado: "ENC ", texto: "x", error: "no hay conexión" } };
    expect(abrirCaja(antes, "r1", "ENC ", false).r1.error).toBe("");
  });
});

describe("cambiar lo que tiene una caja", () => {
  it("cambia la suya y deja las otras", () => {
    const antes: Cajas = { r1: escrita("uno"), r2: escrita("dos") };
    const despues = cambiarCaja(antes, "r1", { texto: "uno corregido" });

    expect(despues.r1.texto).toBe("uno corregido");
    expect(despues.r2.texto).toBe("dos");
  });

  it("un error se escribe sin pisar lo que se venia escribiendo", () => {
    const antes: Cajas = { r1: escrita("lo que tipeo") };
    const despues = cambiarCaja(antes, "r1", { error: "no hay conexión" });

    expect(despues.r1).toEqual({ encabezado: "ENC ", texto: "lo que tipeo", error: "no hay conexión" });
  });

  /**
   * Una respuesta que llega tarde no resucita una caja cerrada. Devuelve EL MISMO
   * objeto, no una copia: si copiara, React volveria a dibujar de gusto.
   */
  it("sobre una caja que no esta abierta no hace nada, y devuelve el mismo registro", () => {
    const antes: Cajas = { r1: escrita("uno") };
    expect(cambiarCaja(antes, "r9", { error: "tarde" })).toBe(antes);
  });
});

describe("cerrar una caja", () => {
  it("saca la suya y deja las otras", () => {
    const antes: Cajas = { r1: escrita("uno"), r2: escrita("dos") };
    const despues = cerrarCaja(antes, "r1");

    expect(Object.keys(despues)).toEqual(["r2"]);
    expect(despues.r2.texto).toBe("dos");
  });

  it("cerrar una que no estaba devuelve el mismo registro", () => {
    const antes: Cajas = { r1: escrita("uno") };
    expect(cerrarCaja(antes, "r9")).toBe(antes);
  });

  it("no modifica el registro que recibe", () => {
    const antes: Cajas = { r1: escrita("uno"), r2: escrita("dos") };
    cerrarCaja(antes, "r1");
    expect(Object.keys(antes).sort()).toEqual(["r1", "r2"]);
  });
});

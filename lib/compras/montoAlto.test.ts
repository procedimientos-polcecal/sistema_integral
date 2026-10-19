import { describe, it, expect } from "vitest";
import { esMontoAlto, porQueEsAlto, filtroDeMontoAlto } from "./montoAlto";

const UMBRAL = 1_500_000;

describe("esMontoAlto", () => {
  it("el monto solo alcanza cuando nadie opinó", () => {
    expect(esMontoAlto(3_000_000, null, UMBRAL)).toBe(true);
    expect(esMontoAlto(200_000, null, UMBRAL)).toBe(false);
  });

  /** El umbral es "a partir de", no "por encima de". */
  it("el umbral exacto cuenta como alto", () => {
    expect(esMontoAlto(UMBRAL, null, UMBRAL)).toBe(true);
  });

  /**
   * Sin número no se adivina. Son 308 requerimientos hoy —los 69 sin iniciar y
   * los que esperan aprobación—, y para ésos la única señal posible es que
   * alguien la ponga a mano.
   */
  it("sin monto no es alto, pero tampoco se niega", () => {
    expect(esMontoAlto(null, null, UMBRAL)).toBe(false);
    expect(esMontoAlto(null, true, UMBRAL)).toBe(true);
  });

  /**
   * La persona manda EN LOS DOS SENTIDOS. El `false` existe para las compras
   * grandes pero rutinarias —30.000 bolsas de cal— que si no quedarían
   * marcadas para siempre y enseñarían a ignorar la marca.
   */
  it("lo que dijo una persona le gana al monto", () => {
    expect(esMontoAlto(29_000_000, false, UMBRAL)).toBe(false);
    expect(esMontoAlto(1_000, true, UMBRAL)).toBe(true);
  });

  it("el umbral se puede mover sin tocar los datos", () => {
    expect(esMontoAlto(2_000_000, null, 5_000_000)).toBe(false);
    expect(esMontoAlto(2_000_000, null, 1_000_000)).toBe(true);
  });
});

describe("porQueEsAlto", () => {
  it("dice cuál de los dos mandó", () => {
    expect(porQueEsAlto(3_000_000, null, UMBRAL)).toBe("por el monto");
    expect(porQueEsAlto(1_000, true, UMBRAL)).toBe("lo marcó una persona");
  });

  /** Que un monto alto esté desmarcado a mano es justo lo que hay que poder ver. */
  it("un monto alto desmarcado a mano se explica", () => {
    expect(porQueEsAlto(29_000_000, false, UMBRAL)).toBe("una persona lo desmarcó");
  });

  it("lo que no es alto no necesita explicación", () => {
    expect(porQueEsAlto(200_000, null, UMBRAL)).toBeNull();
    expect(porQueEsAlto(null, null, UMBRAL)).toBeNull();
  });
});

/**
 * El listado pagina en el SERVIDOR, así que el filtro no puede ser
 * `esMontoAlto` sobre una lista ya traída: tiene que viajar a PostgREST. Esta
 * es la misma regla escrita en el otro idioma, y por eso vive pegada a la
 * primera: separarlas es la forma de que se contradigan sin que nada avise.
 */
describe("filtroDeMontoAlto", () => {
  it("los altos son los marcados a mano, o los que superan el umbral sin que nadie opine", () => {
    expect(filtroDeMontoAlto(true, UMBRAL)).toBe(
      "monto_alto_manual.is.true,and(monto_alto_manual.is.null,monto_conocido.gte.1500000)"
    );
  });

  /**
   * El negado NO es "lo que no es alto" a secas: un RI desmarcado a mano tiene
   * que entrar acá aunque su monto supere el umbral, y uno sin monto también.
   */
  it("los que no son altos incluyen los desmarcados a mano y los que no tienen monto", () => {
    expect(filtroDeMontoAlto(false, UMBRAL)).toBe(
      "monto_alto_manual.is.false,and(monto_alto_manual.is.null,or(monto_conocido.is.null,monto_conocido.lt.1500000))"
    );
  });

  it("el umbral que viaja es el que se le pasa, no una constante", () => {
    expect(filtroDeMontoAlto(true, 9_000_000)).toContain("monto_conocido.gte.9000000");
  });
});

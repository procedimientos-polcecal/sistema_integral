import { describe, expect, it } from "vitest";
import { denominadorComun, mismaPalabra } from "./cuadernoDescripcion";

/**
 * Los cinco grupos de abajo **no son inventados**: son los cinco que una
 * persona juntó de verdad en la carga de octubre, leídos de la base el
 * 03/11/2026. Ninguno tiene las tareas idénticas, que es lo que obliga a que
 * esto exista.
 */
const GRUPOS_REALES = {
  trt2: [
    "Limpieza p/ TRT Nº2",
    "Limpieza y destorar pantalón en planta TRT Nº2",
    "Limpieza espaldas tolvas p/ TRT Nº2 a pastareras y parte inferior",
  ],
  trt1: ["Limpieza p/ TRT Nº1", "Limpieza túnel y pozo p/ TRT Nº1"],
  hidratacion: [
    "Limpieza techo Hidratación",
    "Limpieza techo hidratacion",
    "Limpieza techos hidratacion",
    "Limpieza techos hidratación",
  ],
  pasillo: ["Pasillo en cinta 1 superior", "Pasillo cinta 1"],
  filer2: [
    "Limpieza en cinta tolva",
    "Limpieza cola cinta 1 filer 2 parte superior",
    "Limpieza en cinta 2 filer p/ sup.",
    "Limpieza costado tolva filer 2",
  ],
} as const;

describe("mismaPalabra", () => {
  it("el plural cuenta como la misma", () => {
    expect(mismaPalabra("techo", "techos")).toBe(true);
    expect(mismaPalabra("tolvas", "tolva")).toBe(true);
  });

  it("dos palabras cortas sólo son la misma si son iguales", () => {
    // Sin el mínimo de cuatro letras, «sin» entraría en «sinfin».
    expect(mismaPalabra("sin", "sinfin")).toBe(false);
    expect(mismaPalabra("p", "pozo")).toBe(false);
    expect(mismaPalabra("1", "1")).toBe(true);
  });

  it("un número de planta no se parece a otro", () => {
    // Es lo que no puede fallar: una OT de la TRT Nº1 en la Nº2 no se nota.
    expect(mismaPalabra("nº1", "nº2")).toBe(false);
    expect(mismaPalabra("1", "2")).toBe(false);
  });

  it("un prefijo que se estira demasiado no cuenta", () => {
    expect(mismaPalabra("cinta", "cintaplast")).toBe(false);
    expect(mismaPalabra("cambio", "cambiar")).toBe(false);
  });
});

describe("denominadorComun", () => {
  it("una sola tarea sale tal cual, con sus acentos y su puntuación", () => {
    expect(denominadorComun(["Resoldar chapas impacto rompedores p/ TRT Nº2"]))
      .toBe("Resoldar chapas impacto rompedores p/ TRT Nº2");
  });

  it("las cuatro formas de la misma tarea dan una sola, la primera", () => {
    // El caso que obliga a tolerar el plural: sin eso daría «Limpieza Hidratación».
    expect(denominadorComun(GRUPOS_REALES.hidratacion)).toBe("Limpieza techo Hidratación");
  });

  it("deja las palabras que están en todas, en el orden de la primera", () => {
    expect(denominadorComun(GRUPOS_REALES.trt2)).toBe("Limpieza TRT Nº2");
    expect(denominadorComun(GRUPOS_REALES.trt1)).toBe("Limpieza p/ TRT Nº1");
    expect(denominadorComun(GRUPOS_REALES.pasillo)).toBe("Pasillo cinta 1");
  });

  it("sin dos palabras en común no inventa un resumen: lista las tareas", () => {
    // Lo único que comparten es «limpieza», y una OT que dijera sólo eso es
    // peor que no simplificar.
    expect(denominadorComun(GRUPOS_REALES.filer2)).toBe(
      "Limpieza en cinta tolva · Limpieza cola cinta 1 filer 2 parte superior · " +
      "Limpieza en cinta 2 filer p/ sup. · Limpieza costado tolva filer 2"
    );
  });

  it("dos plantas distintas no se funden aunque el resto coincida", () => {
    // «Nº1» y «Nº2» no son la misma palabra, así que el denominador las deja
    // afuera y queda lo que de verdad comparten.
    expect(denominadorComun(["Limpieza pozo p/ TRT Nº1", "Limpieza pozo p/ TRT Nº2"]))
      .toBe("Limpieza pozo p/ TRT");
  });

  it("tareas repetidas idénticas no se repiten en la lista", () => {
    expect(denominadorComun(["Soldar", "Soldar"])).toBe("Soldar");
  });

  it("sin nada en común lista las distintas, una sola vez cada una", () => {
    expect(denominadorComun(["Soldar brida", "Pintar baranda", "Soldar brida"]))
      .toBe("Soldar brida · Pintar baranda");
  });

  it("no devuelve vacío cuando las tareas son puntuación", () => {
    expect(denominadorComun(["—", "—"])).toBe("—");
    expect(denominadorComun(["—", "/"])).toBe("— · /");
  });

  it("una lista vacía o en blanco da vacío, sin romper", () => {
    expect(denominadorComun([])).toBe("");
    expect(denominadorComun(["   ", ""])).toBe("");
  });
});

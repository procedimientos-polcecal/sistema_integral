import { describe, it, expect } from "vitest";
import {
  validarNota, laUltimaNota, pideJustificacion, celdaDeObservacionPrevia,
  MAXIMO_DE_NOTA,
} from "./notas";

describe("validar el texto de una justificacion", () => {
  it("recorta los espacios de los bordes", () => {
    const r = validarNota("  falta el repuesto  ");
    expect(r.ok && r.texto).toBe("falta el repuesto");
  });

  /** Una nota vacia no justifica nada, y en la planilla borraria la celda. */
  it("una nota vacia se rechaza, y dice por que", () => {
    for (const v of ["", "   ", "\n", null, undefined, 42, {}]) {
      const r = validarNota(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("Falta");
    }
  });

  /**
   * El tope no es decorativo: lo que se escribe va a una celda de planilla, y
   * lo que se lee de un vistazo es una linea, no una pagina.
   */
  it("un texto mas largo que el tope se rechaza en vez de recortarse", () => {
    const r = validarNota("a".repeat(MAXIMO_DE_NOTA + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(String(MAXIMO_DE_NOTA));
  });

  it("justo en el tope entra", () => {
    expect(validarNota("a".repeat(MAXIMO_DE_NOTA)).ok).toBe(true);
  });
});

/**
 * Cual es la ultima importa por dos cosas: es la que se muestra arriba y es la
 * unica que entra en la celda de la planilla.
 */
describe("cual es la ultima justificacion", () => {
  const n = (id: string, creado_en: string) => ({ id, creado_en, texto: id });

  it("sin notas no hay ninguna", () => {
    expect(laUltimaNota([])).toBeNull();
  });

  it("es la mas nueva, venga en el orden que venga", () => {
    const notas = [
      n("vieja", "2026-09-01T10:00:00Z"),
      n("nueva", "2026-10-14T10:00:00Z"),
      n("media", "2026-10-01T10:00:00Z"),
    ];
    expect(laUltimaNota(notas)?.id).toBe("nueva");
    expect(laUltimaNota([...notas].reverse())?.id).toBe("nueva");
  });

  /**
   * Dos notas en el mismo instante pasa si alguien aprieta dos veces: gana la
   * ultima que llego, que es la que la base insertó despues.
   */
  it("con la misma fecha gana la ultima del lote", () => {
    const mismo = "2026-10-14T10:00:00Z";
    expect(laUltimaNota([n("primera", mismo), n("segunda", mismo)])?.id).toBe("segunda");
  });

  it("una fecha ilegible no puede ganarle a una buena", () => {
    const notas = [n("buena", "2026-10-14T10:00:00Z"), n("rota", "no es una fecha")];
    expect(laUltimaNota(notas)?.id).toBe("buena");
  });
});

/**
 * Que estados piden una justificacion. Es lo que decide si la pantalla muestra
 * el bloque y el cartel de "sin justificar", asi que un cambio acá se ve.
 */
describe("que ordenes piden justificacion", () => {
  it("una realizada ya no debe nada", () => {
    expect(pideJustificacion("REALIZADO")).toBe(false);
  });

  it("todas las abiertas si", () => {
    for (const e of ["POR_HACER", "ATRASADO", "EN_PROCESO", "SUSPENDIDA"]) {
      expect(pideJustificacion(e)).toBe(true);
    }
  });

  /**
   * Ante un estado que no conocemos, pedirla. Esconder el bloque dejaria una OT
   * sin justificar y sin forma de justificarla, que es el caso que no se ve.
   */
  it("un estado desconocido pide, no esconde", () => {
    expect(pideJustificacion("CUALQUIER_COSA")).toBe(true);
    expect(pideJustificacion(null)).toBe(true);
  });
});

describe("la celda de la planilla", () => {
  it("va a la X, que es la columna 23", () => {
    expect(celdaDeObservacionPrevia("falta el repuesto").columna).toBe(23);
  });

  /** Borrar la unica nota tiene que vaciar la celda, no dejar la vieja. */
  it("sin nota, la celda se vacia", () => {
    expect(celdaDeObservacionPrevia(null).valor).toBe("");
  });

  /**
   * La planilla escribe con USER_ENTERED: un texto que arranca con "=" entraria
   * como formula. Lo resuelve `textoParaLaCelda` del nucleo; acá se comprueba
   * que la celda pase por ahi.
   */
  it("un texto que la planilla interpretaria va escapado", () => {
    expect(celdaDeObservacionPrevia("=A1").valor).toBe("'=A1");
    expect(celdaDeObservacionPrevia("12/10").valor).toBe("'12/10");
  });

  it("una justificacion normal va tal cual", () => {
    expect(celdaDeObservacionPrevia("Se rompio el 12 de octubre").valor)
      .toBe("Se rompio el 12 de octubre");
  });
});

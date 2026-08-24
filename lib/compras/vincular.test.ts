import { describe, it, expect } from "vitest";
import { idDePlanilla, linkDeCelda } from "./vincular";

/**
 * La celda de comparativa de la planilla muestra "LINK" y esconde el
 * hipervinculo detras. La API de Sheets devuelve el texto visible, asi que la
 * URL hay que sacarla de la formula o del hipervinculo del texto.
 */
describe("de donde sale el link de la celda", () => {
  it("de una formula HYPERLINK", () => {
    expect(linkDeCelda('=HYPERLINK("https://docs.google.com/spreadsheets/d/ABC/edit","LINK")', null))
      .toBe("https://docs.google.com/spreadsheets/d/ABC/edit");
  });

  it("del hipervinculo, cuando el link se pego sobre el texto", () => {
    expect(linkDeCelda("LINK", "https://docs.google.com/spreadsheets/d/XYZ/edit"))
      .toBe("https://docs.google.com/spreadsheets/d/XYZ/edit");
  });

  it("de la celda misma, cuando pegaron la URL como texto", () => {
    expect(linkDeCelda("https://docs.google.com/spreadsheets/d/QQQ/edit", null))
      .toBe("https://docs.google.com/spreadsheets/d/QQQ/edit");
  });

  it("una celda sin link no inventa nada", () => {
    expect(linkDeCelda("LINK", null)).toBeNull();
    expect(linkDeCelda("", null)).toBeNull();
    expect(linkDeCelda(null, null)).toBeNull();
  });

  it("la formula gana sobre el hipervinculo: es mas especifica", () => {
    expect(linkDeCelda('=HYPERLINK("https://docs.google.com/spreadsheets/d/AAA/edit","x")', "https://otro"))
      .toBe("https://docs.google.com/spreadsheets/d/AAA/edit");
  });
});

describe("el id de la planilla dentro del link", () => {
  it("lo saca de una URL de Sheets", () => {
    expect(idDePlanilla("https://docs.google.com/spreadsheets/d/1tP7_LqEErE5wDL/edit#gid=0"))
      .toBe("1tP7_LqEErE5wDL");
  });

  it("tolera la query de compartir", () => {
    expect(idDePlanilla("https://docs.google.com/spreadsheets/d/ABC-123_x/edit?usp=sharing"))
      .toBe("ABC-123_x");
  });

  it("tambien de un link de Drive con id en la query", () => {
    expect(idDePlanilla("https://drive.google.com/open?id=ZZZ999")).toBe("ZZZ999");
  });

  it("lo que no es una planilla devuelve null", () => {
    expect(idDePlanilla("https://www.google.com")).toBeNull();
    expect(idDePlanilla("LINK")).toBeNull();
    expect(idDePlanilla(null)).toBeNull();
  });
});

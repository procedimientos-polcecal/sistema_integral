import { describe, it, expect } from "vitest";
import { documentosPara, rutaDelDocumento } from "./documentos";

describe("qué documentación puede leer cada uno", () => {
  it("le ofrece los de sus módulos", () => {
    const docs = documentosPara(["compras"]);
    expect(docs).toContain("COMPRAS.md");
    expect(docs).not.toContain("RRHH-ACTUALIZACION.md");
  });

  it("los generales los ve cualquiera", () => {
    expect(documentosPara([])).toContain("NUCLEO-COMPARTIDO.md");
  });

  it("resuelve la ruta de un documento permitido", () => {
    expect(rutaDelDocumento("COMPRAS.md", ["compras"])).toBe("docs/COMPRAS.md");
  });

  it("no resuelve uno de un módulo que no tiene", () => {
    expect(rutaDelDocumento("RRHH-ACTUALIZACION.md", ["compras"])).toBeNull();
  });

  /**
   * El modelo escribe el nombre del documento, así que es entrada no confiable:
   * sin esto, un "../.env.local" lee un archivo de secretos.
   */
  it("no deja salir de docs/", () => {
    expect(rutaDelDocumento("../.env.local", ["compras"])).toBeNull();
    expect(rutaDelDocumento("../../etc/passwd", ["compras"])).toBeNull();
    expect(rutaDelDocumento("docs/../.env.local", ["compras"])).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  MINIMO_DE_UNA_IMAGEN,
  rutaDelAdjunto,
  sirveComoFactura,
  type AdjuntoDelCorreo,
} from "./correoEntrante";

const a = (extra: Partial<AdjuntoDelCorreo> = {}): AdjuntoDelCorreo => ({
  nombre: "factura.pdf",
  tipo: "application/pdf",
  tamano: 300 * 1024,
  ...extra,
});

describe("qué adjunto es una factura", () => {
  it("un PDF entra siempre: nadie adjunta uno de adorno", () => {
    expect(sirveComoFactura(a())).toEqual({ sirve: true });
    // Incluso uno chiquito, que podría ser una factura de una línea.
    expect(sirveComoFactura(a({ tamano: 4 * 1024 }))).toEqual({ sirve: true });
  });

  it("una foto de verdad entra", () => {
    expect(sirveComoFactura(a({ nombre: "foto.jpg", tipo: "image/jpeg", tamano: 800 * 1024 })))
      .toEqual({ sirve: true });
  });

  /*
   * El caso que llena la bandeja de basura si no se filtra: todo mail
   * corporativo trae el logo de la firma como adjunto.
   */
  it("el logo de una firma no", () => {
    const r = sirveComoFactura(a({ nombre: "logo.png", tipo: "image/png", tamano: 3 * 1024 }));
    expect(r.sirve).toBe(false);
    expect(r.sirve === false && r.motivo).toContain("logo de una firma");
  });

  it("el umbral de la imagen es el que dice la constante", () => {
    expect(sirveComoFactura(a({ tipo: "image/png", tamano: MINIMO_DE_UNA_IMAGEN }))).toEqual({
      sirve: true,
    });
    expect(sirveComoFactura(a({ tipo: "image/png", tamano: MINIMO_DE_UNA_IMAGEN - 1 })).sirve).toBe(
      false
    );
  });

  it("un adjunto que no es PDF ni imagen queda afuera", () => {
    for (const tipo of ["application/zip", "text/calendar", "application/vnd.ms-excel", ""]) {
      expect(sirveComoFactura(a({ tipo })).sirve).toBe(false);
    }
  });

  it("el tipo puede venir con charset pegado, como lo manda un mail", () => {
    expect(sirveComoFactura(a({ tipo: "application/pdf; charset=binary" }))).toEqual({
      sirve: true,
    });
    expect(sirveComoFactura(a({ tipo: "APPLICATION/PDF" }))).toEqual({ sirve: true });
  });

  it("uno que no entra en el bucket se dice con su tamaño", () => {
    const r = sirveComoFactura(a({ tamano: 25 * 1024 * 1024 }));
    expect(r.sirve).toBe(false);
    expect(r.sirve === false && r.motivo).toContain("20 MB");
  });

  it("un archivo vacío no es un PDF", () => {
    expect(sirveComoFactura(a({ tamano: 0 })).sirve).toBe(false);
  });
});

/*
 * El nombre lo escribió el remitente, así que es texto hostil: con barras o
 * `..` arma una ruta que no es la que se cree.
 */
describe("dónde se guarda el adjunto", () => {
  it("el id del mensaje va de carpeta, así dos remitentes no se pisan", () => {
    expect(rutaDelAdjunto("abc123", "factura.pdf")).toBe("correo/abc123/factura.pdf");
  });

  it("no deja salir de su carpeta", () => {
    const r = rutaDelAdjunto("abc", "../../../etc/passwd");
    expect(r.startsWith("correo/abc/")).toBe(true);
    expect(r).not.toContain("..");
    expect(r.split("/")).toHaveLength(3);
  });

  it("los acentos y los espacios no rompen la ruta, y la extensión sobrevive", () => {
    expect(rutaDelAdjunto("m1", "Factura Nº 0001 señor.pdf")).toBe(
      "correo/m1/Factura-N-0001-senor.pdf"
    );
  });

  it("un nombre entero de caracteres raros no deja la ruta colgando", () => {
    expect(rutaDelAdjunto("m1", "///")).toBe("correo/m1/adjunto");
    expect(rutaDelAdjunto("", "x.pdf")).toBe("correo/sin-id/x.pdf");
  });

  it("un nombre larguísimo se recorta", () => {
    const r = rutaDelAdjunto("m1", "a".repeat(400) + ".pdf");
    expect(r.length).toBeLessThan(140);
  });
});

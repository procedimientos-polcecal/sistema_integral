import { describe, it, expect } from "vitest";
import {
  MAXIMO_DE_FOTO,
  TIPOS_DE_FOTO,
  extensionDeLaFoto,
  problemaDeLaFoto,
  rutaDeLaFoto,
} from "./fotoDeCondicion";

describe("problemaDeLaFoto", () => {
  it("deja pasar los cuatro tipos que acepta el bucket", () => {
    for (const tipo of TIPOS_DE_FOTO) {
      expect(problemaDeLaFoto({ type: tipo, size: 1000 }), tipo).toBeNull();
    }
  });

  it("rechaza lo que no es una foto, nombrando lo que llegó", () => {
    expect(problemaDeLaFoto({ type: "application/pdf", size: 1000 })).toBe(
      '"application/pdf" no es una foto.'
    );
  });

  // `image/heif` no está en `allowed_mime_types` del bucket. Cuando la ruta de
  // Mantenimiento lo aceptaba y el bucket no, la rechazaba Storage con un 502
  // que no explicaba nada: acá se rechaza antes y diciendo qué pasó.
  it("no acepta HEIF, que el bucket tampoco", () => {
    expect(problemaDeLaFoto({ type: "image/heif", size: 1000 })).not.toBeNull();
  });

  it("el mensaje del tamaño dice cuánto pesa y cuánto entra", () => {
    // Es lo único que va a leer quien mire la carga parada en el teléfono: para
    // la cola un 400 es definitivo, así que de este texto depende que sepa si
    // tiene que volver a sacar la foto.
    expect(problemaDeLaFoto({ type: "image/jpeg", size: 14 * 1024 * 1024 })).toBe(
      "La foto pesa 14 MB y el máximo son 10."
    );
  });

  it("el límite justo entra, y un byte más no", () => {
    expect(problemaDeLaFoto({ type: "image/jpeg", size: MAXIMO_DE_FOTO })).toBeNull();
    expect(problemaDeLaFoto({ type: "image/jpeg", size: MAXIMO_DE_FOTO + 1 })).not.toBeNull();
  });

  it("una foto vacía se rechaza acá y no queda ilegible en el bucket", () => {
    expect(problemaDeLaFoto({ type: "image/jpeg", size: 0 })).toBe(
      "La foto llegó vacía: volvé a sacarla."
    );
  });
});

describe("rutaDeLaFoto", () => {
  it("la extensión sale del tipo y no del nombre: la foto de la cola no tiene nombre", () => {
    expect(rutaDeLaFoto("abc", "image/png", 17)).toBe("condiciones/abc/17.png");
    expect(extensionDeLaFoto("image/jpeg")).toBe("jpg");
    expect(extensionDeLaFoto("image/heic")).toBe("heic");
  });

  it("lo que llega de afuera no puede salirse de su carpeta", () => {
    expect(rutaDeLaFoto("../../otro", "image/jpeg", 1)).toBe("condiciones/------otro/1.jpg");
  });

  it("todos los tipos aceptados tienen su extensión", () => {
    for (const tipo of TIPOS_DE_FOTO) {
      expect(extensionDeLaFoto(tipo), tipo).toMatch(/^[a-z]{3,4}$/);
    }
  });
});

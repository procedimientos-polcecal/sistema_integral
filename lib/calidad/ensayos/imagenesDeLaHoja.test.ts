import { describe, expect, it } from "vitest";
import {
  ALTO_DE_FILA,
  ANCHO_EN_LA_HOJA,
  LADO_MAXIMO_PX,
  colocarImagenes,
  medidasDelPng,
} from "./imagenesDeLaHoja";

/** Los primeros 24 bytes de un PNG: firma, largo del trozo, "IHDR", ancho y alto. */
function cabecera(ancho: number, alto: number, { firma = true, trozo = "IHDR" } = {}): Buffer {
  const b = Buffer.alloc(24);
  const f = firma ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] : [0, 0, 0, 0, 0, 0, 0, 0];
  f.forEach((v, i) => (b[i] = v));
  b.writeUInt32BE(13, 8);
  b.write(trozo, 12, "ascii");
  b.writeUInt32BE(ancho, 16);
  b.writeUInt32BE(alto, 20);
  return b;
}

describe("medidasDelPng", () => {
  it("lee el ancho y el alto de la cabecera", () => {
    expect(medidasDelPng(cabecera(1200, 840))).toEqual({ ancho: 1200, alto: 840 });
  });

  it("rechaza lo que no empieza con la firma PNG", () => {
    expect(medidasDelPng(cabecera(100, 100, { firma: false }))).toBeNull();
    // Un JPEG con otro nombre: empieza FF D8 FF.
    expect(medidasDelPng(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(30).fill(0)]))).toBeNull();
  });

  it("rechaza un archivo truncado antes de terminar la cabecera", () => {
    expect(medidasDelPng(cabecera(100, 100).subarray(0, 23))).toBeNull();
    expect(medidasDelPng(Buffer.alloc(0))).toBeNull();
  });

  it("rechaza si el primer trozo no es IHDR", () => {
    expect(medidasDelPng(cabecera(100, 100, { trozo: "IDAT" }))).toBeNull();
  });

  it("rechaza un ancho o un alto en cero", () => {
    expect(medidasDelPng(cabecera(0, 100))).toBeNull();
    expect(medidasDelPng(cabecera(100, 0))).toBeNull();
  });

  it("acepta el tope justo y rechaza lo que lo pasa, en cualquiera de los dos lados", () => {
    expect(medidasDelPng(cabecera(LADO_MAXIMO_PX, LADO_MAXIMO_PX))).toEqual({
      ancho: LADO_MAXIMO_PX,
      alto: LADO_MAXIMO_PX,
    });
    expect(medidasDelPng(cabecera(1, 4_000_000_000))).toBeNull();
    expect(medidasDelPng(cabecera(4_000_000_000, 1))).toBeNull();
    expect(medidasDelPng(cabecera(LADO_MAXIMO_PX + 1, 100))).toBeNull();
  });
});

describe("colocarImagenes", () => {
  const png = Buffer.alloc(0);

  it("escala todas al mismo ancho y deriva el alto del aspecto", () => {
    // 1200 x 900 es 4:3 -> 640 x 480; 800 x 800 -> 640 x 640.
    const [a, b] = colocarImagenes(
      [
        { png, ancho: 1200, alto: 900 },
        { png, ancho: 800, alto: 800 },
      ],
      6
    );
    expect(a).toMatchObject({ ancho: ANCHO_EN_LA_HOJA, alto: 480, columna: 6 });
    expect(b).toMatchObject({ ancho: ANCHO_EN_LA_HOJA, alto: 640, columna: 6 });
  });

  it("apila una debajo de la otra con una fila libre de por medio", () => {
    const [a, b, c] = colocarImagenes(
      [
        { png, ancho: 1200, alto: 900 }, // 480 px -> 24 filas + 1 de aire
        { png, ancho: 800, alto: 800 }, // 640 px -> 32 filas + 1
        { png, ancho: 640, alto: 100 },
      ],
      6
    );
    expect(a.fila).toBe(0);
    expect(b.fila).toBe(Math.ceil(480 / ALTO_DE_FILA) + 1);
    expect(c.fila).toBe(b.fila + Math.ceil(640 / ALTO_DE_FILA) + 1);
  });

  it("una imagen que no llena una fila entera igual ocupa la fila entera", () => {
    // 640 x 30 -> 30 px: dos filas de 20, y la siguiente arranca en la 3.
    const [a, b] = colocarImagenes(
      [
        { png, ancho: 640, alto: 30 },
        { png, ancho: 640, alto: 30 },
      ],
      0
    );
    expect(a.fila).toBe(0);
    expect(b.fila).toBe(3);
  });

  it("sin imágenes no devuelve nada", () => {
    expect(colocarImagenes([], 6)).toEqual([]);
  });

  it("no toca los bytes del PNG", () => {
    const bytes = Buffer.from([1, 2, 3]);
    expect(colocarImagenes([{ png: bytes, ancho: 10, alto: 10 }], 6)[0].png).toBe(bytes);
  });
});

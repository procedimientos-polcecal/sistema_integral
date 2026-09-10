import { describe, it, expect } from "vitest";
import { conMargenBlanco } from "./escaneoQr";

/*
 * La búsqueda del QR en sí se mide contra las facturas reales —no hay forma
 * honesta de probarla con un fixture inventado—, pero las dos conversiones que
 * la hacen posible son aritmética pura y ahí un error no se ve: una imagen mal
 * convertida no tira, simplemente no encuentra el QR.
 */

function gris(w: number, h: number, valor: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = valor;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe("el margen blanco que el emisor no dejó", () => {
  it("agranda la imagen dejando el original en el centro", () => {
    const negro = gris(100, 100, 0);
    const con = conMargenBlanco(negro, 0.1);

    // 10% del lado mayor a cada lado.
    expect([con.width, con.height]).toEqual([120, 120]);

    // La esquina es blanca…
    expect([con.data[0], con.data[1], con.data[2]]).toEqual([255, 255, 255]);
    // …y el centro sigue siendo el original.
    const centro = ((60 * con.width) + 60) * 4;
    expect(con.data[centro]).toBe(0);
  });

  it("el borde nunca baja de 8 píxeles, aunque el recorte sea chico", () => {
    // Un QR chico con un margen proporcional de 2 px no tendría zona de
    // silencio: el estándar pide cuatro módulos.
    const con = conMargenBlanco(gris(50, 50, 0), 0.02);
    expect(con.width).toBe(50 + 16);
  });

  it("respeta un rectángulo que no es cuadrado", () => {
    const con = conMargenBlanco(gris(200, 100, 0), 0.1);
    // El margen sale del lado mayor: 20 px a los cuatro lados.
    expect([con.width, con.height]).toEqual([240, 140]);
  });

  it("no toca el original: la fila de arriba del contenido queda intacta", () => {
    const original = gris(60, 60, 33);
    const con = conMargenBlanco(original, 0.1);
    const m = 8; // max(8, 6)
    for (let x = 0; x < 60; x++) {
      expect(con.data[((m * con.width) + m + x) * 4]).toBe(33);
    }
  });
});

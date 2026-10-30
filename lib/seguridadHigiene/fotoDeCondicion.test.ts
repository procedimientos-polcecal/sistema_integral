import { describe, it, expect } from "vitest";
import {
  MAXIMO_DE_FOTO,
  MAXIMO_EN_LA_COLA,
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

/*
 * ── EL LÍMITE DE LA COLA, QUE NO ES EL DEL BUCKET ──────────────────────────
 *
 * Por el alta de una condición la foto viaja adentro del multipart, y Vercel
 * corta el cuerpo de un pedido en 4,5 MB **antes de invocar la función**. Una
 * de 6 MB aceptada acá entra a la cola del teléfono y después rebota con un
 * 413 que esta ruta nunca contesta: ninguno de los mensajes de este archivo se
 * usaría. Por la ruta de fotos —con señal, en su propio pedido, con una
 * persona mirando— sigue valiendo el techo del bucket.
 */
describe("los dos máximos", () => {
  const seisMegas = { type: "image/jpeg", size: 6 * 1024 * 1024 };

  it("el de la cola es más chico que el del bucket, que es el del almacenamiento", () => {
    expect(MAXIMO_EN_LA_COLA).toBeLessThan(MAXIMO_DE_FOTO);
    // Y por debajo del corte de Vercel (4,5 MB), con margen para el resto del
    // multipart: el cuerpo no es sólo la foto.
    expect(MAXIMO_EN_LA_COLA).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("seis megas pasan por la ficha y NO pasan por la cola", () => {
    expect(problemaDeLaFoto(seisMegas)).toBeNull();
    expect(problemaDeLaFoto(seisMegas, MAXIMO_EN_LA_COLA)).not.toBeNull();
  });

  it("el mensaje dice cuánto entra **por ese camino**, no cuánto entra en el bucket", () => {
    // Decirle «el máximo son 10» a alguien cuya foto de 6 MB no va a salir del
    // teléfono es mandarlo a probar de nuevo con la misma foto.
    expect(problemaDeLaFoto(seisMegas, MAXIMO_EN_LA_COLA)).toBe(
      "La foto pesa 6 MB y el máximo son 4."
    );
  });

  it("un tamaño con decimales se dice con decimales, y los redondos sin «,0»", () => {
    // «pesa 4 MB y el máximo son 4» no se entiende; «pesa 4,2» sí.
    expect(problemaDeLaFoto({ type: "image/jpeg", size: 4.2 * 1024 * 1024 }, MAXIMO_EN_LA_COLA))
      .toBe("La foto pesa 4,2 MB y el máximo son 4.");
  });

  it("sin decir nada, el máximo es el del bucket: el portón que nunca se pasa", () => {
    expect(problemaDeLaFoto({ type: "image/jpeg", size: MAXIMO_DE_FOTO })).toBeNull();
    expect(problemaDeLaFoto({ type: "image/jpeg", size: MAXIMO_DE_FOTO + 1 })).not.toBeNull();
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

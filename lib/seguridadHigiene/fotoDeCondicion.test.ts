import { describe, it, expect } from "vitest";
import {
  MAXIMO_DE_FOTO,
  MAXIMO_POR_PEDIDO,
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
      "La foto pesa 14 MB y el máximo son 4."
    );
  });

  it("el límite justo entra, y un byte más no", () => {
    expect(problemaDeLaFoto({ type: "image/jpeg", size: MAXIMO_POR_PEDIDO })).toBeNull();
    expect(problemaDeLaFoto({ type: "image/jpeg", size: MAXIMO_POR_PEDIDO + 1 })).not.toBeNull();
  });

  it("una foto vacía se rechaza acá y no queda ilegible en el bucket", () => {
    expect(problemaDeLaFoto({ type: "image/jpeg", size: 0 })).toBe(
      "La foto llegó vacía: volvé a sacarla."
    );
  });
});

/*
 * ── UN SOLO MÁXIMO, Y POR QUÉ NO ES EL DEL BUCKET ────────────────────
 *
 * Vercel corta el cuerpo de un pedido en 4,5 MB **antes de invocar la
 * función**, y por ahí pasan los dos caminos: el alta encolada y la ruta de
 * fotos de la ficha. Una foto de 6 MB rebota con un 413 que ninguna de las dos
 * rutas llega a contestar, así que ninguno de los mensajes de este archivo se
 * usaría.
 *
 * Durante unas horas del 30/10/2026 esto fue un parámetro, con un máximo por
 * camino: la cola con 4 MB y la ficha con los 10 del bucket, con el argumento
 * de que allá el pedido lleva la foto y poco más y hay una persona mirando.
 * Era falso: 6 MB pasan los 4,5 vayan solos o acompañados, y lo que la persona
 * había mirado **antes** de elegir el archivo era un cartel prometiéndole 10
 * MB. El techo del bucket no lo alcanza ningún camino de la app, así que no
 * puede ser el número de ninguna validación.
 */
describe("el máximo", () => {
  const seisMegas = { type: "image/jpeg", size: 6 * 1024 * 1024 };

  it("está por debajo del corte de Vercel, con margen para el resto del multipart", () => {
    // El cuerpo del alta no es sólo la foto: lleva también el JSON de la
    // condición y el overhead de las partes.
    expect(MAXIMO_POR_PEDIDO).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("y por debajo del techo del bucket, que es lo único que ese número describe", () => {
    // `MAXIMO_DE_FOTO` ya no valida nada: es el `file_size_limit` del bucket,
    // escrito para que este test lo ate. Si alguien sube el de arriba por
    // encima de éste, el bucket rechazaría lo que la app aceptó.
    expect(MAXIMO_POR_PEDIDO).toBeLessThan(MAXIMO_DE_FOTO);
  });

  it("seis megas no pasan, y no pasan por NINGÚN camino", () => {
    // Es la corrección entera en una línea: hay una sola respuesta para esta
    // foto, y es la misma desde la cola que desde la ficha.
    expect(problemaDeLaFoto(seisMegas)).toBe("La foto pesa 6 MB y el máximo son 4.");
  });

  it("un tamaño con decimales se dice con decimales, y los redondos sin «,0»", () => {
    // «pesa 4 MB y el máximo son 4» no se entiende; «pesa 4,2» sí.
    expect(problemaDeLaFoto({ type: "image/jpeg", size: 4.2 * 1024 * 1024 })).toBe(
      "La foto pesa 4,2 MB y el máximo son 4."
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

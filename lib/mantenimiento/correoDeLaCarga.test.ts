import { describe, it, expect } from "vitest";
import { correoPorElRechazo, salioDelFondo, type RechazoDeCarga } from "./correoDeLaCarga";
import { DISPARO } from "@/public/cola/colaOffline.js";

/** Un rechazo claro de una carga que el teléfono mandó solo: el caso que sí avisa. */
function rechazo(extra: Partial<RechazoDeCarga> = {}): RechazoDeCarga {
  return {
    delFondo: true,
    status: 400,
    error: "Contá qué pasa.",
    enDuda: false,
    tipo: "aviso",
    descripcion: "Bomba 3 pierde aceite",
    sector: "Taller",
    fecha: "2026-10-16",
    ...extra,
  };
}

describe("correoPorElRechazo", () => {
  it("no manda nada si la carga salió desde la pantalla: la persona está mirando el cartel", () => {
    expect(correoPorElRechazo(rechazo({ delFondo: false }))).toBeNull();
  });

  it("no manda nada si el rechazo no es definitivo", () => {
    // Un 502 de Google y un 401 por la sesión vencida se reintentan solos.
    expect(correoPorElRechazo(rechazo({ status: 502 }))).toBeNull();
    expect(correoPorElRechazo(rechazo({ status: 401 }))).toBeNull();
  });

  it("un rechazo claro lleva qué carga era, el motivo sin traducir, y dónde quedó", () => {
    const correo = correoPorElRechazo(rechazo());
    expect(correo).not.toBeNull();
    expect(correo!.asunto).toContain("aviso");
    expect(correo!.cuerpo).toContain("Bomba 3 pierde aceite");
    expect(correo!.cuerpo).toContain("Taller");
    expect(correo!.cuerpo).toContain("Contá qué pasa.");
    expect(correo!.cuerpo).toContain("Cargar");
  });

  it("un 403 también avisa: no tener permiso es tan definitivo como un campo que falta", () => {
    const correo = correoPorElRechazo(
      rechazo({ status: 403, error: "Cargar un aviso requiere nivel de edición en Mantenimiento" }),
    );
    expect(correo!.cuerpo).toContain("requiere nivel de edición");
  });

  it("el caso en duda lleva OTRO asunto y manda a mirar la planilla", () => {
    const claro = correoPorElRechazo(rechazo())!;
    const dudoso = correoPorElRechazo(rechazo({ status: 409, enDuda: true }))!;
    expect(dudoso.asunto).not.toBe(claro.asunto);
    expect(dudoso.cuerpo).toContain("planilla");
  });

  it("el caso en duda NUNCA dice que no se pudo cargar, porque quizás se cargó", () => {
    const dudoso = correoPorElRechazo(rechazo({ status: 409, enDuda: true }))!;
    expect(`${dudoso.asunto} ${dudoso.cuerpo}`.toLowerCase()).not.toContain("no se pudo");
  });

  it("no promete ningún enlace a la carga: vive en el IndexedDB de ese teléfono", () => {
    // Un enlace abriría `/cargar` en el aparato donde se lea el correo, que
    // puede ser la computadora, y ahí esa carga no está.
    for (const caso of [rechazo(), rechazo({ status: 409, enDuda: true })]) {
      const correo = correoPorElRechazo(caso)!;
      expect(correo.cuerpo).not.toContain("http");
      expect(correo.cuerpo).not.toContain("/cargar");
    }
  });

  it("un motivo con HTML o comillas viaja como texto y no arma nada", () => {
    const error = '<b>roto</b> "x"';
    expect(correoPorElRechazo(rechazo({ error }))!.cuerpo).toContain(error);
  });

  it("una carga sin la marca de disparo no manda nada", () => {
    // Una carga guardada antes de que la cabecera existiera llega sin el dato,
    // y ante la duda no se avisa: el cartel de la pantalla sigue estando.
    const { delFondo: _, ...sinLaMarca } = rechazo();
    expect(correoPorElRechazo(sinLaMarca as RechazoDeCarga)).toBeNull();
  });

  it("sin descripción lo dice, en vez de dejar unas comillas vacías", () => {
    // Es justo el caso del 400 «Contá qué pasa»: no hay descripción que mostrar.
    const correo = correoPorElRechazo(rechazo({ descripcion: "" }))!;
    expect(correo.cuerpo).toContain("sin descripción");
    expect(correo.cuerpo).not.toContain("«»");
  });

  it("una orden se nombra como orden y no como aviso", () => {
    const correo = correoPorElRechazo(rechazo({ tipo: "orden" }))!;
    expect(correo.asunto).toContain("orden");
    expect(correo.asunto).not.toContain("aviso");
  });

  it("sin sector no inventa uno ni deja un hueco raro", () => {
    const correo = correoPorElRechazo(rechazo({ sector: null }))!;
    expect(correo.cuerpo).toContain("Bomba 3 pierde aceite");
    expect(correo.cuerpo).not.toContain("null");
    expect(correo.cuerpo).not.toContain("—\n");
  });
});

/*
 * La traducción de la cabecera a un booleano es **el único lugar** donde pasa,
 * y el escaneo previo del plan la marcó: si acá se compara mal, el correo sale
 * siempre o no sale nunca, y ningún otro test lo nota. El valor entra
 * importado y no escrito a mano, por el mismo motivo que la cabecera misma.
 */
describe("salioDelFondo", () => {
  it("la manda el teléfono solo cuando la cabecera dice fondo", () => {
    expect(salioDelFondo(DISPARO.fondo)).toBe(true);
  });

  it("desde la pantalla, no", () => {
    expect(salioDelFondo(DISPARO.pantalla)).toBe(false);
  });

  it("sin cabecera, no: una carga vieja o un cuerpo armado a mano no avisan", () => {
    expect(salioDelFondo(null)).toBe(false);
    expect(salioDelFondo("")).toBe(false);
  });

  it("cualquier otra cosa tampoco: ante la duda no se molesta a nadie", () => {
    expect(salioDelFondo("Fondo")).toBe(false);
    expect(salioDelFondo("cualquiera")).toBe(false);
  });
});

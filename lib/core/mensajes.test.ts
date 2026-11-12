import { describe, it, expect } from "vitest";
import {
  aQuienLeLlega,
  correoPorMencion,
  tituloDelHilo,
  type Destinatario,
} from "./mensajes";
import { paraUnAsunto, LARGO_DEL_ASUNTO } from "./asuntoDeCorreo";
import type { Mensaje } from "./correo";

function destinatario(extra: Partial<Destinatario> = {}): Destinatario {
  return { usuarioId: "beto", email: "beto@polcecal.com", puedeVerElRegistro: true, ...extra };
}

function datos(extra: Partial<Parameters<typeof correoPorMencion>[0]> = {}) {
  return {
    autor: "Ana Pérez",
    queEs: "OT 2983",
    texto: "¿Llegó el repuesto de la bomba?",
    dondeVerlo: "https://www.polcecalpolysan.app/mantenimiento/ordenes/2983",
    hiloId: "orden_trabajo:2983",
    ...extra,
  };
}

describe("aQuienLeLlega", () => {
  it("no le manda nada a quien escribió el mensaje", () => {
    const ana = destinatario({ usuarioId: "ana", email: "ana@polcecal.com" });
    const beto = destinatario();
    expect(aQuienLeLlega([ana, beto], "ana")).toEqual([beto]);
  });

  it("no le manda nada a quien no puede ver el registro", () => {
    // El correo lleva el texto del mensaje, así que mandárselo le filtraría un
    // módulo que no tiene, y el enlace lo rebotaría al inicio.
    const sinAcceso = destinatario({ usuarioId: "carla", puedeVerElRegistro: false });
    expect(aQuienLeLlega([sinAcceso], "ana")).toEqual([]);
  });

  it("no le manda nada a quien no tiene correo cargado", () => {
    expect(aQuienLeLlega([destinatario({ email: null })], "ana")).toEqual([]);
    // Una dirección en blanco es lo mismo que ninguna: el Apps Script la rechazaría.
    expect(aQuienLeLlega([destinatario({ email: "   " })], "ana")).toEqual([]);
  });

  it("sin menciones no le llega a nadie, y eso no es un error", () => {
    expect(aQuienLeLlega([], "ana")).toEqual([]);
  });

  it("a quien lo mencionaron dos veces le llega un solo correo", () => {
    const beto = destinatario();
    expect(aQuienLeLlega([beto, beto], "ana")).toEqual([beto]);
  });
});

describe("correoPorMencion", () => {
  it("dice quién, sobre qué, y qué se escribió", () => {
    const { cuerpo, asunto } = correoPorMencion(datos());
    expect(cuerpo).toContain("Ana Pérez");
    expect(cuerpo).toContain("OT 2983");
    expect(cuerpo).toContain("¿Llegó el repuesto de la bomba?");
    expect(cuerpo).toContain("https://www.polcecalpolysan.app/mantenimiento/ordenes/2983");
    expect(asunto).toContain("Ana Pérez");
    expect(asunto).toContain("OT 2983");
  });

  it("el asunto no lleva saltos de línea ni crece sin límite", () => {
    const { asunto } = correoPorMencion(datos({ texto: `linea uno\nlinea dos ${"x".repeat(500)}` }));
    expect(asunto).not.toMatch(/[\r\n]/);
    // El recorte (80) más el id del hilo, que va entero y fuera del recorte.
    expect(asunto.length).toBeLessThanOrEqual(LARGO_DEL_ASUNTO + 1 + "[orden_trabajo:2983]".length);
  });

  it("el asunto lleva el id del hilo, entero aunque el texto sea larguísimo", () => {
    // Para que una respuesta se pueda enganchar el día que se quiera leerla;
    // agregarlo después no sirve para los correos ya mandados. Y va fuera del
    // recorte: un texto largo no se lo puede comer.
    const corto = correoPorMencion(datos());
    expect(corto.asunto).toContain("[orden_trabajo:2983]");
    const largo = correoPorMencion(datos({ texto: "y".repeat(2000) }));
    expect(largo.asunto).toContain("[orden_trabajo:2983]");
  });

  it("un id de hilo con saltos de línea tampoco parte la cabecera", () => {
    const { asunto } = correoPorMencion(datos({ hiloId: "orden_trabajo:29\n83" }));
    expect(asunto).not.toMatch(/[\r\n]/);
  });

  it("el cuerpo dice que no se responde ahí, y no afirma que la respuesta no llegue", () => {
    // Va a pasar igual: la respuesta cae en la casilla desde la que manda el
    // Apps Script, donde nadie la mira. O sea que **sí llega**, y el cuerpo
    // decía «no llega a nadie»: falso, en el único texto que leen las catorce
    // personas. El test ata la frase nueva porque buscar «no respondas» pasaba
    // con las dos.
    const { cuerpo } = correoPorMencion(datos());
    const dice = cuerpo.toLowerCase();
    expect(dice).toContain("no respondas");
    expect(dice).toContain("no la lee nadie");
    expect(dice).not.toContain("no llega a nadie");
  });

  it("un texto con HTML o comillas viaja como texto", () => {
    const texto = '<b>x</b> "y"';
    expect(correoPorMencion(datos({ texto })).cuerpo).toContain(texto);
  });

  it("el texto del cuerpo llega completo, aunque el asunto lo recorte", () => {
    const texto = `${"z".repeat(500)}\nsegunda línea`;
    expect(correoPorMencion(datos({ texto })).cuerpo).toContain(texto);
  });

  it("encaja con lo que manda enviarCorreo sin traducir", () => {
    const correo: Mensaje = { para: "beto@polcecal.com", ...correoPorMencion(datos()) };
    expect(Object.keys(correo).sort()).toEqual(["asunto", "cuerpo", "para"]);
  });
});

describe("tituloDelHilo", () => {
  it("cuando el registro ya no está lo dice, en vez de mostrar un hilo mudo", () => {
    expect(tituloDelHilo("OT 2983", false)).toContain("ya no está");
  });

  it("cuando está, es sólo lo que es", () => {
    expect(tituloDelHilo("OT 2983", true)).toBe("OT 2983");
  });
});

describe("paraUnAsunto", () => {
  it("colapsa los saltos y los espacios repetidos", () => {
    expect(paraUnAsunto("  uno\n\ndos \t tres ")).toBe("uno dos tres");
  });

  it("recorta con puntos suspensivos y no pasa del tope", () => {
    const recortado = paraUnAsunto("x".repeat(500));
    expect(recortado.length).toBe(LARGO_DEL_ASUNTO);
    expect(recortado.endsWith("…")).toBe(true);
  });

  it("lo que entra justo no se toca", () => {
    const justo = "x".repeat(LARGO_DEL_ASUNTO);
    expect(paraUnAsunto(justo)).toBe(justo);
  });
});

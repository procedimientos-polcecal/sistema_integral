import { describe, it, expect } from "vitest";
import type { EventoVista } from "./vista";
import { entradasDeLaBanda } from "./banda";

function evento(id: string, resto: Partial<EventoVista> = {}): EventoVista {
  return {
    id,
    titulo: `Evento ${id}`,
    descripcion: null,
    lugar: null,
    inicio: "2026-11-03T08:00:00",
    fin: "2026-11-03T09:00:00",
    duenoId: "u1",
    casilla: "ana@polcecal.com",
    duenoNombre: "Ana Paz",
    divergencia: null,
    divergenciaVista: false,
    googlePendiente: null,
    aviso: null,
    otId: null,
    turno: null,
    invitados: [],
    ...resto,
  };
}

const sano = evento("sano");
const movido = evento("movido", { divergencia: "movido" });
const borrado = evento("borrado", { divergencia: "borrado" });
const pendiente = evento("pendiente", { googlePendiente: "Rate Limit Exceeded" });
const conAviso = evento("con-aviso", { aviso: "Google devolvió un error raro al invitar." });
const movidoYPendiente = evento("movido-y-pendiente", {
  divergencia: "movido",
  googlePendiente: "Rate Limit Exceeded",
});
const movidoYaVisto = evento("movido-ya-visto", { divergencia: "movido", divergenciaVista: true });
const movidoTemprano = evento("movido-temprano", { divergencia: "movido", inicio: "2026-11-03T08:00:00" });
const movidoTarde = evento("movido-tarde", { divergencia: "movido", inicio: "2026-11-05T08:00:00" });

describe("entradasDeLaBanda", () => {
  it("un evento sano no entra", () => {
    expect(entradasDeLaBanda([sano])).toEqual([]);
  });

  it("un evento movido entra como divergencia y lo dice en una línea", () => {
    const [e] = entradasDeLaBanda([movido]);
    expect(e).toMatchObject({ eventoId: movido.id, titulo: movido.titulo, tipo: "divergencia" });
    expect(e.texto).toContain("de horario");
    expect(e.texto).not.toContain("\n");
  });

  it("un borrado se distingue de un movido", () => {
    expect(entradasDeLaBanda([borrado])[0].texto).toContain("borró");
    expect(entradasDeLaBanda([borrado])[0].texto).not.toBe(entradasDeLaBanda([movido])[0].texto);
  });

  // Decisión 10 del diseño: el pendiente también va a la banda.
  it("un evento que no llegó a Google entra aunque no esté divergido", () => {
    const [e] = entradasDeLaBanda([pendiente]);
    expect(e.tipo).toBe("pendiente");
    expect(e.texto).toContain("no figura en el calendario");
  });

  it("un `aviso` entra con su propio texto", () => {
    expect(entradasDeLaBanda([conAviso])[0]).toMatchObject({ tipo: "aviso", texto: conAviso.aviso });
  });

  it("un evento con divergencia y pendiente a la vez da una sola entrada, la divergencia", () => {
    const es = entradasDeLaBanda([movidoYPendiente]);
    expect(es).toHaveLength(1);
    expect(es[0].tipo).toBe("divergencia");
  });

  it("un evento con divergencia, pendiente y aviso a la vez da una sola entrada, la divergencia", () => {
    const es = entradasDeLaBanda([{ ...movidoYPendiente, aviso: "algo" }]);
    expect(es).toHaveLength(1);
    expect(es[0].tipo).toBe("divergencia");
  });

  it("un evento con pendiente y aviso a la vez da una sola entrada, el pendiente", () => {
    const es = entradasDeLaBanda([{ ...pendiente, aviso: "algo" }]);
    expect(es).toHaveLength(1);
    expect(es[0].tipo).toBe("pendiente");
  });

  it("las divergencias van antes que los pendientes y los pendientes antes que los avisos", () => {
    expect(entradasDeLaBanda([conAviso, pendiente, movido]).map((e) => e.tipo))
      .toEqual(["divergencia", "pendiente", "aviso"]);
  });

  it("dentro del mismo tipo, el que empieza antes va primero", () => {
    expect(entradasDeLaBanda([movidoTarde, movidoTemprano]).map((e) => e.eventoId))
      .toEqual([movidoTemprano.id, movidoTarde.id]);
  });

  it("si empiezan a la vez, desempata por id y el orden no depende de cómo llegaron", () => {
    const a = evento("a", { divergencia: "movido" });
    const b = evento("b", { divergencia: "movido" });
    expect(entradasDeLaBanda([b, a]).map((e) => e.eventoId)).toEqual(["a", "b"]);
    expect(entradasDeLaBanda([a, b]).map((e) => e.eventoId)).toEqual(["a", "b"]);
  });

  it("una divergencia ya vista sigue en la banda", () => {
    // «Ya lo vi» apaga la campana, no la alerta: el evento sigue divergido.
    const es = entradasDeLaBanda([movidoYaVisto]);
    expect(es).toHaveLength(1);
    expect(es[0].tipo).toBe("divergencia");
  });

  it("todo evento con algo que decir da su entrada, y los sanos no", () => {
    const todos = [sano, movido, borrado, pendiente, conAviso, movidoYPendiente, movidoYaVisto];
    expect(entradasDeLaBanda(todos).map((e) => e.eventoId).sort()).toEqual(
      [movido, borrado, pendiente, conAviso, movidoYPendiente, movidoYaVisto].map((e) => e.id).sort()
    );
  });

  it("no modifica la lista que recibe", () => {
    const entrada = [conAviso, pendiente, movido];
    entradasDeLaBanda(entrada);
    expect(entrada.map((e) => e.id)).toEqual([conAviso.id, pendiente.id, movido.id]);
  });
});

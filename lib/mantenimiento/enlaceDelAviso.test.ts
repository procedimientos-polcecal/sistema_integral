import { describe, expect, it } from "vitest";
import { loQueHayQueReenlazar, numeroDeOtDelTexto } from "./enlaceDelAviso";

describe("numeroDeOtDelTexto", () => {
  it("devuelve el número cuando el texto son sólo dígitos", () => {
    expect(numeroDeOtDelTexto(" 2814 ")).toBe(2814);
  });
  it("devuelve null para lo que no es un número", () => {
    for (const t of ["Revision", "-", "si", "1889 - 1886", "RI 1888", "", null, undefined]) {
      expect(numeroDeOtDelTexto(t)).toBeNull();
    }
  });
});

describe("loQueHayQueReenlazar", () => {
  const mapa = new Map([[2814, "ot-a"], [2815, "ot-b"]]);

  it("completa el aviso que tiene el número y no tiene enlace", () => {
    const r = loQueHayQueReenlazar([{ id: "a1", ot_asignada: "2814", work_order_id: null }], mapa);
    expect(r.aEnlazar).toEqual([{ otId: "ot-a", avisoIds: ["a1"] }]);
    expect(r.aVaciar).toEqual([]);
  });

  it("junta en un solo grupo los avisos que apuntan a la misma OT", () => {
    const r = loQueHayQueReenlazar([
      { id: "a1", ot_asignada: "2814", work_order_id: null },
      { id: "a2", ot_asignada: "2814", work_order_id: null },
    ], mapa);
    expect(r.aEnlazar).toEqual([{ otId: "ot-a", avisoIds: ["a1", "a2"] }]);
  });

  it("NO toca un enlace que hizo una persona, aunque el número cambie", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "2815", work_order_id: "ot-a",
      ot_enlazada_en: "2026-10-26T10:00:00Z",
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: [] });
  });

  it("NO toca la OT que nació de este aviso: los dos sellos en null y ya enlazado", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "", work_order_id: "ot-a",
      ot_enlazada_en: null, ot_resuelta_en: null,
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: [] });
  });

  it("corrige el número que alguien arregló en la planilla", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "2814", work_order_id: "ot-b",
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r.aEnlazar).toEqual([{ otId: "ot-a", avisoIds: ["a1"] }]);
  });

  it("vacía el enlace automático cuando la celda quedó vacía", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "", work_order_id: "ot-a",
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: ["a1"] });
  });

  it("vacía también cuando el texto dejó de ser un número", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "Revision", work_order_id: "ot-a",
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r.aVaciar).toEqual(["a1"]);
  });

  it("no escribe nada cuando el enlace ya es el que corresponde", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "2814", work_order_id: "ot-a",
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: [] });
  });

  it("deja en paz al aviso cuyo número el sistema no conoce", () => {
    const r = loQueHayQueReenlazar([{ id: "a1", ot_asignada: "9999", work_order_id: null }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: [] });
  });

  it("deja en paz el enlace bueno cuyo número nuevo el sistema no conoce", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "9999", work_order_id: "ot-a",
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: [] });
  });

  // El estado que deja `on delete set null` al borrarse la orden: la columna
  // del enlace queda en null y el sello sobrevive. Mientras esté puesto, el
  // aviso no se puede desenlazar y la orden que nazca de él queda desprotegida.
  it("limpia el sello huérfano cuando la celda quedó vacía", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "", work_order_id: null,
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: ["a1"] });
  });

  // El camino por el que llega de verdad: se borra la OT #2814 y su número
  // sigue escrito en la celda, así que ya no resuelve contra nada.
  it("limpia el sello huérfano cuyo número el sistema ya no conoce", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "9999", work_order_id: null,
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: ["a1"] });
  });

  // Y si la celda pasó a nombrar una orden que sí existe, se reenlaza: el
  // sello se reescribe solo y no hay nada que limpiar.
  it("reenlaza el sello huérfano si el número vuelve a resolver", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "2814", work_order_id: null,
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r).toEqual({ aEnlazar: [{ otId: "ot-a", avisoIds: ["a1"] }], aVaciar: [] });
  });

  // La otra mitad de la regla, que es la que no hay que romper al barrer: sin
  // sello y sin enlace no hay nada que limpiar, y el aviso se queda quieto.
  it("no inventa un vaciado para el aviso que nunca estuvo enlazado", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "Revision", work_order_id: null, ot_resuelta_en: null,
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: [] });
  });
});

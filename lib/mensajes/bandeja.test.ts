import { describe, expect, it } from "vitest";
import { ENTIDADES } from "./entidades";
import { agruparPorRegistro, comoSeLlega, type MencionDeLaBandeja } from "./bandeja";

function mencion(p: Partial<MencionDeLaBandeja>): MencionDeLaBandeja {
  return {
    mensaje_id: "m1",
    tipo: "orden_trabajo",
    id: "ot-1",
    texto: "Mirá esto",
    creado_en: "2026-11-10T12:00:00Z",
    autor: "Ana Pérez",
    titulo: "la orden de trabajo N° 2983",
    existe_el_registro: true,
    ruta: "/mantenimiento/ordenes?q=2983",
    ...p,
  };
}

describe("agruparPorRegistro", () => {
  it("sin menciones no hay tarjetas", () => {
    expect(agruparPorRegistro([])).toEqual([]);
  });

  it("junta los mensajes del mismo registro en una tarjeta", () => {
    const grupos = agruparPorRegistro([
      mencion({ mensaje_id: "a", creado_en: "2026-11-10T10:00:00Z" }),
      mencion({ mensaje_id: "b", creado_en: "2026-11-10T11:00:00Z" }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].mensajes.map((m) => m.mensaje_id)).toEqual(["b", "a"]);
  });

  it("dos registros son dos tarjetas, la de la mención más nueva primero", () => {
    const grupos = agruparPorRegistro([
      mencion({ mensaje_id: "a", id: "ot-1", creado_en: "2026-11-10T10:00:00Z" }),
      mencion({ mensaje_id: "b", id: "ot-2", creado_en: "2026-11-10T11:00:00Z" }),
      // Un mensaje nuevo en el hilo viejo lo pone arriba.
      mencion({ mensaje_id: "c", id: "ot-1", creado_en: "2026-11-10T12:00:00Z" }),
    ]);
    expect(grupos.map((g) => g.id)).toEqual(["ot-1", "ot-2"]);
    expect(grupos[0].ultima).toBe("2026-11-10T12:00:00Z");
  });

  it("el mismo id en dos tipos distintos no se mezcla: el PATCH marca por tipo e id", () => {
    const grupos = agruparPorRegistro([
      mencion({ mensaje_id: "a", tipo: "orden_trabajo", id: "x" }),
      mencion({ mensaje_id: "b", tipo: "requerimiento", id: "x" }),
    ]);
    expect(grupos).toHaveLength(2);
  });

  it("conserva el enlace que armó la ruta, sin tocarlo", () => {
    const [g] = agruparPorRegistro([mencion({ ruta: "/mis-pedidos?pedido=abc", tipo: "requerimiento", id: "abc" })]);
    expect(g.ruta).toBe("/mis-pedidos?pedido=abc");
  });

  it("un registro que ya no está queda marcado así", () => {
    const [g] = agruparPorRegistro([mencion({ existe_el_registro: false })]);
    expect(g.existe).toBe(false);
  });
});

describe("comoSeLlega", () => {
  it("el requerimiento abre la conversación y no pide nada más", () => {
    expect(comoSeLlega("requerimiento", "el requerimiento de compra N° 5").nota).toBeNull();
  });

  it("la condición abre su ficha y no promete un buscador que esa pantalla no tiene", () => {
    // Decía «buscá y abrí la N° X» sobre una lista sin buscador. Desde que la
    // ruta lleva `?condicion=`, lo que falta es un clic adentro de la ficha, y
    // eso es lo que tiene que decir.
    const { boton, nota } = comoSeLlega("condicion_insegura", "la condición insegura N° 12");
    expect(boton).toMatch(/condición/i);
    expect(nota).toMatch(/ficha/);
    expect(nota).not.toMatch(/[Bb]uscá/);
    expect(nota).toMatch(/la condición insegura N° 12/);
  });

  it("la orden dice que hay que abrirla", () => {
    expect(comoSeLlega("orden_trabajo", "la orden de trabajo N° 2983").nota).toMatch(/Abrí la orden de trabajo N° 2983/);
  });

  it("lo que dice de cada enlace coincide con lo que hace `ruta` de la entidad", () => {
    // Lo que se afirma en pantalla se comprueba contra el registro, no contra una copia.
    expect(ENTIDADES.requerimiento.ruta("abc")).toMatch(/^\/mis-pedidos\?pedido=/);
    expect(ENTIDADES.orden_trabajo.ruta("x", 2983)).toBe("/mantenimiento/ordenes?q=2983");
    expect(ENTIDADES.condicion_insegura.ruta("x", 12)).toBe(
      "/seguridad-higiene/condiciones?condicion=x"
    );
  });
});

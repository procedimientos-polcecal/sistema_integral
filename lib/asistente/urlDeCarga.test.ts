import { describe, it, expect } from "vitest";
import { urlDeCarga } from "./urlDeCarga";
import { URGENCIAS } from "@/lib/mantenimiento/avisos";

describe("la URL del formulario prellenado", () => {
  it("arma el alta de un requerimiento", () => {
    const r = urlDeCarga("requerimiento", { descripcion: "Filtro de aceite", cantidad: "4" });
    expect(r).toEqual({
      ok: true,
      url: "/compras/requerimientos?nuevo=1&descripcion=Filtro+de+aceite&cantidad=4",
    });
  });

  /**
   * El comentario de `ValoresIniciales` en NuevoRequerimientoModal dice que el
   * área y quién paga no se precargan a propósito: son decisiones de quien
   * pide, y elegirlas por él es cómo un pedido de Mantenimiento entra como si
   * fuera de Producción. Acá se rechaza explícito, no por omisión.
   */
  it("rechaza el área del requerimiento, que es decisión de quien pide", () => {
    const r = urlDeCarga("requerimiento", { descripcion: "x", area: "MANTENIMIENTO" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("área");
  });

  it("rechaza quién paga por el mismo motivo", () => {
    expect(urlDeCarga("requerimiento", { descripcion: "x", paga: "POLCECAL" }).ok).toBe(false);
  });

  it("arma el movimiento de inventario", () => {
    expect(urlDeCarga("movimiento", { articulo: "abc-123", cantidad: "2" })).toEqual({
      ok: true,
      url: "/inventario/movimientos/nuevo?articulo=abc-123&cantidad=2",
    });
  });

  it("arma el aviso de mantenimiento", () => {
    expect(urlDeCarga("aviso", { equipo: "eq-7", descripcion: "Pierde aceite" })).toEqual({
      ok: true,
      url: "/mantenimiento/avisos?nuevo=1&equipo=eq-7&descripcion=Pierde+aceite",
    });
  });

  it("arma el parte de producción, que son dos segmentos y no query", () => {
    expect(urlDeCarga("parte", { fecha: "2026-09-16", turno: "4_12" })).toEqual({
      ok: true,
      url: "/produccion/parte/2026-09-16/4_12",
    });
  });

  it("rechaza un turno que no existe", () => {
    expect(urlDeCarga("parte", { fecha: "2026-09-16", turno: "noche" }).ok).toBe(false);
  });

  it("rechaza una fecha que no es una fecha", () => {
    expect(urlDeCarga("parte", { fecha: "16/09/2026", turno: "4_12" }).ok).toBe(false);
  });

  it("rechaza un tipo que no existe", () => {
    // @ts-expect-error — el modelo puede mandar cualquier cosa; la función no confía en el tipo
    expect(urlDeCarga("factura", { total: "100" }).ok).toBe(false);
  });

  it("rechaza un campo que el formulario no tiene", () => {
    expect(urlDeCarga("aviso", { color: "rojo" }).ok).toBe(false);
  });

  it("ignora los campos vacíos en vez de mandarlos en blanco", () => {
    expect(urlDeCarga("requerimiento", { descripcion: "x", cantidad: "" })).toEqual({
      ok: true,
      url: "/compras/requerimientos?nuevo=1&descripcion=x",
    });
  });

  // Mismo criterio que `volverAlListado` en lib/compras/filtrosUrl.ts: lo que
  // entra a una URL se escapa, siempre.
  it("escapa lo que podría salirse de la query", () => {
    const r = urlDeCarga("aviso", { descripcion: "a&b=c #1" });
    expect(r).toEqual({
      ok: true,
      url: "/mantenimiento/avisos?nuevo=1&descripcion=a%26b%3Dc+%231",
    });
  });

  /**
   * El regex solo deja pasar fechas que no existen, y la pantalla del parte usa
   * el mismo regex: sin este chequeo, `2026-13-45` viaja hasta un `.eq` contra
   * una columna `date` y el error sale de Postgres en vez de salir de acá.
   */
  it("rechaza una fecha con forma válida pero imposible", () => {
    expect(urlDeCarga("parte", { fecha: "2026-13-45", turno: "4_12" }).ok).toBe(false);
    expect(urlDeCarga("parte", { fecha: "2026-02-31", turno: "4_12" }).ok).toBe(false);
    expect(urlDeCarga("parte", { fecha: "2026-00-10", turno: "4_12" }).ok).toBe(false);
  });

  it("acepta un 29 de febrero en año bisiesto y lo rechaza si no lo es", () => {
    expect(urlDeCarga("parte", { fecha: "2028-02-29", turno: "4_12" }).ok).toBe(true);
    expect(urlDeCarga("parte", { fecha: "2027-02-29", turno: "4_12" }).ok).toBe(false);
  });

  it("no deja un signo de pregunta pelado cuando no hay ningún campo", () => {
    expect(urlDeCarga("movimiento", {})).toEqual({ ok: true, url: "/inventario/movimientos/nuevo" });
  });

  /**
   * Las urgencias llevan emoji y no son un enum de la base, así que el modelo
   * no las ve en el catálogo: sin validar, escribiría "Alta" y el `<select>`
   * del modal quedaría en un valor que no existe, sin avisarle a nadie.
   */
  it("rechaza una urgencia que no es una de las tres exactas", () => {
    expect(urlDeCarga("aviso", { descripcion: "x", urgencia: "Alta" }).ok).toBe(false);
    expect(urlDeCarga("aviso", { descripcion: "x", urgencia: "APURADISIMO" }).ok).toBe(false);
  });

  it("acepta la urgencia exacta, con su emoji", () => {
    const r = urlDeCarga("aviso", { descripcion: "x", urgencia: URGENCIAS[0] });
    expect(r.ok).toBe(true);
  });

  it("deja armar un aviso sin urgencia, que es lo normal", () => {
    expect(urlDeCarga("aviso", { descripcion: "x" }).ok).toBe(true);
  });
});

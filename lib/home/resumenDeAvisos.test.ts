import { describe, expect, it } from "vitest";
import { resumirParaPush } from "./resumenDeAvisos";
import type { Notificacion } from "./notificaciones";

const conteo = (id: string, titulo: string, cantidad: number, href: string): Notificacion => ({
  id, titulo, cantidad, href,
});

describe("resumirParaPush", () => {
  it("sin avisos no hay nada que mandar", () => {
    expect(resumirParaPush([])).toBeNull();
  });

  /*
   * Con un solo aviso la notificación lleva directo a ese lugar. Mandar a la
   * persona al inicio para que vuelva a buscar de qué se trataba es el peor
   * resultado posible de haberla interrumpido.
   */
  it("con un solo aviso, el título es ése y el link va directo ahí", () => {
    const r = resumirParaPush([
      conteo("mant-atrasadas", "Órdenes de trabajo atrasadas", 20, "/mantenimiento/ordenes?estado=ATRASADO"),
    ]);
    expect(r).toEqual({
      title: "Órdenes de trabajo atrasadas",
      body: "20",
      url: "/mantenimiento/ordenes?estado=ATRASADO",
    });
  });

  it("con varios, el título dice cuántos y el link va al inicio", () => {
    const r = resumirParaPush([
      conteo("mant-atrasadas", "Órdenes de trabajo atrasadas", 20, "/x"),
      conteo("compras-por-aprobar", "Requerimientos esperando aprobación", 3, "/y"),
    ]);
    expect(r?.title).toBe("2 cosas para mirar");
    expect(r?.url).toBe("/");
    expect(r?.body).toBe("20 · Órdenes de trabajo atrasadas\n3 · Requerimientos esperando aprobación");
  });

  /*
   * LA TRAMPA. La `cantidad` de un aviso de ritmo no cuenta cosas: es cuántos
   * umbrales enteros lleva el módulo sin cargarse, y existe sólo para que
   * descartarlo no lo traiga de vuelta al día siguiente (ver `cantidadDelAviso`
   * en lib/home/ritmo.ts). Imprimirla diría "9 · Trituración: hace 36 días que
   * no se carga", que no significa nada. El título de esos avisos ya trae la
   * información completa, así que va solo.
   */
  it("un aviso de ritmo va sin su cantidad, porque no cuenta cosas", () => {
    const r = resumirParaPush([
      conteo("mant-atrasadas", "Órdenes de trabajo atrasadas", 20, "/x"),
      conteo("ritmo-trituracion", "Trituración: hace 36 días que no se carga", 9, "/trituracion"),
    ]);
    expect(r?.body).toBe("20 · Órdenes de trabajo atrasadas\nTrituración: hace 36 días que no se carga");
    expect(r?.body).not.toContain("9 ·");
  });

  it("un aviso de ritmo solo tampoco muestra la cantidad", () => {
    const r = resumirParaPush([
      conteo("ritmo-remises", "Remises: hace 70 días que no se carga", 6, "/remises"),
    ]);
    expect(r).toEqual({
      title: "Remises: hace 70 días que no se carga",
      body: "",
      url: "/remises",
    });
  });

  /*
   * Una notificación que no entra en la pantalla se corta sola y el corte lo
   * elige el sistema operativo. Mejor elegirlo nosotros y decir cuántos
   * quedaron afuera, que es la diferencia entre "esto es todo" y "hay más".
   */
  it("con muchos, muestra los tres primeros y dice cuántos faltan", () => {
    const r = resumirParaPush([
      conteo("a", "Uno", 1, "/a"),
      conteo("b", "Dos", 2, "/b"),
      conteo("c", "Tres", 3, "/c"),
      conteo("d", "Cuatro", 4, "/d"),
      conteo("e", "Cinco", 5, "/e"),
    ]);
    expect(r?.title).toBe("5 cosas para mirar");
    expect(r?.body).toBe("1 · Uno\n2 · Dos\n3 · Tres\ny 2 más");
  });

  it("con exactamente tres no agrega la coletilla", () => {
    const r = resumirParaPush([
      conteo("a", "Uno", 1, "/a"),
      conteo("b", "Dos", 2, "/b"),
      conteo("c", "Tres", 3, "/c"),
    ]);
    expect(r?.body).toBe("1 · Uno\n2 · Dos\n3 · Tres");
  });

  it("respeta el orden en que vienen, que es el de los módulos", () => {
    const r = resumirParaPush([
      conteo("a", "Primero", 1, "/a"),
      conteo("b", "Segundo", 99, "/b"),
    ]);
    expect(r?.body.startsWith("1 · Primero")).toBe(true);
  });
});

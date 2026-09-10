import { describe, it, expect } from "vitest";
import {
  EQUIVALENCIAS_DEL_HISTORICO,
  clasificacionDelHistorico,
} from "./equivalenciasDelHistorico";
import { clasificacionDeLaOrden, textoParaLaPlanilla, MATERIALES, GRANULOMETRIAS, ENVASES } from "./clasificacion";
import type { ProductoDeDespacho } from "./types";

describe("la tabla de equivalencias del histórico", () => {
  /**
   * La razón de ser de la tabla: 23 formas de escribir lo mismo, 640 órdenes.
   * Si una de éstas se cayera, esas órdenes volverían a "sin clasificar" sin
   * que nada avise — se ven bien en la pantalla, sólo que no filtran.
   */
  it("las ortografías de Filler a granel dan todas lo mismo", () => {
    const esperado = { material: "Filler", granulometria: null, envase: "A granel" };
    for (const texto of [
      "Filler a granel",
      "filler a granel",
      "filller a granel",
      "filer a granel",
      "filler agranel",
      "filkler a granel",
      "FILLER A GRANEL",
      "filler a  granel",
    ]) {
      expect(clasificacionDelHistorico(texto), texto).toEqual(esperado);
    }
  });

  it("la busca por texto exacto, sin normalizar", () => {
    // Dos espacios entre "02" y "en": está en la tabla tal cual quedó en la base.
    expect(clasificacionDelHistorico("Calcio 02  en Bolsones")).toEqual({
      material: "Calcio",
      granulometria: "0-2",
      envase: "Bolsón",
    });
    // Y por lo tanto lo que no está tal cual, no está.
    expect(clasificacionDelHistorico("Calcio 02 en Bolsones   ")).toBeNull();
  });

  /** Lo que queda afuera queda afuera: un null es un "sin clasificar" visible. */
  it("devuelve null para lo que no se puede decidir", () => {
    for (const texto of [
      "Calcio 200 Bolsa + 01 en BOlsones", // dos granulometrías
      "Calcio + Dolomita 02 bolsa", // dos materiales
      "Arena", // no es de la lista
      "3 rollos de membrana",
      "-",
      "",
      "cal #200 en bolson", // se sacó a mano: la Cal nunca lleva granulometría
      "Cal 02 en Bolson",
    ]) {
      expect(clasificacionDelHistorico(texto), texto).toBeNull();
    }
    expect(clasificacionDelHistorico(null)).toBeNull();
    expect(clasificacionDelHistorico(undefined)).toBeNull();
  });

  /**
   * La tabla se generó de la base y se editó a mano después, así que esto es lo
   * que protege de una errata de tipeo en un valor: un envase "Bolson" sin
   * acento no rompería nada visible, pero no filtraría con los demás ni se
   * escribiría bien en la planilla.
   */
  it("los 159 valores usan las listas del módulo y nada más", () => {
    const claves = Object.keys(EQUIVALENCIAS_DEL_HISTORICO);
    expect(claves.length).toBe(159);
    for (const [texto, c] of Object.entries(EQUIVALENCIAS_DEL_HISTORICO)) {
      expect(MATERIALES, texto).toContain(c.material);
      expect(ENVASES, texto).toContain(c.envase);
      if (c.granulometria !== null) expect(GRANULOMETRIAS, texto).toContain(c.granulometria);
      // Y todo lo que entra tiene que poder volver a salir escrito.
      expect(textoParaLaPlanilla(c), texto).not.toBe("");
    }
  });
});

describe("clasificacionDeLaOrden: cuál de los dos caminos gana", () => {
  const mapeo: ProductoDeDespacho[] = [
    {
      id: "p1",
      odoo_product_id: 7,
      odoo_default_code: "FAG",
      odoo_nombre: "FILLER A GRANEL (NA)",
      material: "Filler",
      granulometria: null,
      envase: "A granel",
      activo: true,
    } as ProductoDeDespacho,
  ];

  /**
   * El orden no es un detalle: el remito es un dato y el texto una
   * interpretación. Una orden de la balanza que además tuviera un texto viejo
   * en `producto_raw` tiene que clasificarse por el remito.
   */
  it("con producto de Odoo mapeado, gana el mapeo", () => {
    const c = clasificacionDeLaOrden(
      { odoo_product_id: 7, producto_raw: "Cal en Bolsones" },
      mapeo
    );
    expect(c).toEqual({ material: "Filler", granulometria: null, envase: "A granel" });
  });

  it("sin producto de Odoo, cae al texto del libro", () => {
    const c = clasificacionDeLaOrden(
      { odoo_product_id: null, producto_raw: "Cal en Bolsones" },
      mapeo
    );
    expect(c).toEqual({ material: "Cal", granulometria: null, envase: "Bolsón" });
  });

  /** Un producto de Odoo que nadie mapeó todavía tampoco cae al texto: no hay texto. */
  it("con producto de Odoo sin mapear y sin texto, queda sin clasificar", () => {
    expect(clasificacionDeLaOrden({ odoo_product_id: 99, producto_raw: null }, mapeo)).toBeNull();
  });

  /**
   * Éste es el caso que importa del orden inverso: un producto de Odoo sin
   * mapear, en una orden que sí trae texto. Cae al texto, y está bien: es lo
   * único que hay.
   */
  it("con producto de Odoo sin mapear pero con texto conocido, usa el texto", () => {
    const c = clasificacionDeLaOrden(
      { odoo_product_id: 99, producto_raw: "Filler en Tolva" },
      mapeo
    );
    expect(c).toEqual({ material: "Filler", granulometria: null, envase: "Tolva" });
  });
});

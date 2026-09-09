import { describe, it, expect } from "vitest";
import {
  MATERIALES,
  GRANULOMETRIAS,
  ENVASES,
  clasificacionDe,
  textoDeClasificacion,
  textoParaLaPlanilla,
  separarCodigoYNombre,
} from "./clasificacion";
import type { ProductoDeDespacho } from "./types";

function prod(
  odoo_product_id: number,
  material: string,
  granulometria: string | null,
  envase: string,
  activo = true
): ProductoDeDespacho {
  return {
    id: `id-${odoo_product_id}`,
    odoo_product_id,
    odoo_default_code: null,
    odoo_nombre: `producto ${odoo_product_id}`,
    material,
    granulometria,
    envase,
    produccion_producto_id: null,
    activo,
  };
}

const MAPEO: ProductoDeDespacho[] = [
  prod(2394, "Filler", null, "A granel"),
  prod(3986, "Calcio", "0-1", "Bolsón"),
  prod(2399, "Cal", null, "Tolva", false),
];

describe("clasificacionDe", () => {
  it("devuelve los tres campos del producto mapeado", () => {
    expect(clasificacionDe(3986, MAPEO)).toEqual({
      material: "Calcio",
      granulometria: "0-1",
      envase: "Bolsón",
    });
  });

  /**
   * El núcleo de la decisión: no se adivina.
   *
   * Los tres campos están metidos dentro del nombre del producto de Odoo
   * ("CARBONATO DE CALCIO 0-1 BOLSÓN (NA)"), y parsearlo con una expresión
   * regular es la forma segura de que un día "CAL EN TOLVA" entre como envase
   * Bolsa y nadie lo note. Sin mapeo, null y "sin clasificar" en pantalla.
   */
  it("devuelve null cuando el producto no está mapeado", () => {
    expect(clasificacionDe(7052, MAPEO)).toBeNull();
    expect(clasificacionDe(null, MAPEO)).toBeNull();
    expect(clasificacionDe(2394, [])).toBeNull();
  });

  /**
   * `activo` saca al producto del desplegable, no le borra la clasificación a
   * las órdenes viejas: una orden de hace un año sigue siendo de Cal en tolva.
   */
  it("un producto dado de baja sigue clasificando las órdenes que ya lo usaron", () => {
    expect(clasificacionDe(2399, MAPEO)).toEqual({
      material: "Cal",
      granulometria: null,
      envase: "Tolva",
    });
  });
});

describe("textoDeClasificacion", () => {
  it("junta los tres campos, y saltea la granulometría que no existe", () => {
    expect(textoDeClasificacion({ material: "Calcio", granulometria: "0-1", envase: "Bolsón" }))
      .toBe("Calcio 0-1 Bolsón");
    expect(textoDeClasificacion({ material: "Filler", granulometria: null, envase: "A granel" }))
      .toBe("Filler A granel");
  });

  it("sin clasificación no inventa un texto", () => {
    expect(textoDeClasificacion(null)).toBe("");
  });
});

describe("separarCodigoYNombre", () => {
  /**
   * Un many2one de Odoo llega como `[id, "[FAG] FILLER A GRANEL "]`: el código
   * interno pegado adelante y el espacio de más al final, que está en la base.
   */
  it("separa el código interno y recorta el espacio que Odoo trae al final", () => {
    expect(separarCodigoYNombre("[FAG] FILLER A GRANEL ")).toEqual({
      codigo: "FAG",
      nombre: "FILLER A GRANEL",
    });
    expect(separarCodigoYNombre("[CC02B] CARBONATO DE CALCIO 0-2 BOLSÓN (NA) ")).toEqual({
      codigo: "CC02B",
      nombre: "CARBONATO DE CALCIO 0-2 BOLSÓN (NA)",
    });
  });

  it("un producto sin código interno no queda con el nombre mutilado", () => {
    expect(separarCodigoYNombre("ADITIVO CALCAREO")).toEqual({
      codigo: null,
      nombre: "ADITIVO CALCAREO",
    });
  });

  it("Odoo usa false para lo ausente", () => {
    expect(separarCodigoYNombre(false)).toEqual({ codigo: null, nombre: null });
    expect(separarCodigoYNombre("")).toEqual({ codigo: null, nombre: null });
  });
});

describe("las listas", () => {
  /**
   * El talonario tiene cuatro materiales y tres envases, y no alcanzan: en los
   * últimos 90 días se despachó Chocolata y Pedregullo 6/20, y hay productos
   * "EN TOLVA" que el papel no contempla. Por eso la lista vive acá y no en un
   * enum de Postgres, donde cada valor nuevo cuesta una migración sola (55P04).
   */
  it("cubren lo que el papel no", () => {
    expect(MATERIALES).toContain("Cal");
    expect(MATERIALES).toContain("Pedregullo");
    // 30 órdenes del histórico son de dolomita, que el talonario no tiene.
    expect(MATERIALES).toContain("Dolomita");
    expect(ENVASES).toContain("A granel");
    expect(ENVASES).toContain("Tolva");
    expect(GRANULOMETRIAS).toContain("#200");
    expect(GRANULOMETRIAS).toContain("6/20");
  });

  it("no tienen repetidos", () => {
    for (const lista of [MATERIALES, GRANULOMETRIAS, ENVASES]) {
      expect(new Set(lista).size).toBe(lista.length);
    }
  });
});

describe("textoParaLaPlanilla", () => {
  /**
   * La celda se escribe con la forma del libro, no con la del sistema: hay
   * 1.714 renglones de historia y quien los lee no tiene por qué ver otra
   * forma de golpe. Lo que cambia es que de acá en más se escribe siempre
   * igual — hoy hay 201 textos distintos para unas quince combinaciones.
   */
  it("usa la preposición de cada envase, como el libro", () => {
    expect(textoParaLaPlanilla({ material: "Filler", granulometria: null, envase: "A granel" }))
      .toBe("Filler a granel");
    expect(textoParaLaPlanilla({ material: "Cal", granulometria: null, envase: "Bolsón" }))
      .toBe("Cal en Bolsones");
    expect(textoParaLaPlanilla({ material: "Cal", granulometria: null, envase: "Bolsa" }))
      .toBe("Cal en Bolsa");
    expect(textoParaLaPlanilla({ material: "Filler", granulometria: null, envase: "Tolva" }))
      .toBe("Filler en Tolva");
  });

  it("el #200 va sin el numeral, que es como lo escribe el libro", () => {
    expect(textoParaLaPlanilla({ material: "Calcio", granulometria: "#200", envase: "Bolsa" }))
      .toBe("Calcio 200 en Bolsa");
    expect(textoParaLaPlanilla({ material: "Calcio", granulometria: "0-2", envase: "Bolsón" }))
      .toBe("Calcio 0-2 en Bolsones");
  });

  it("sin clasificación no inventa un texto", () => {
    expect(textoParaLaPlanilla(null)).toBe("");
  });

  /** Para pantalla se sigue usando el texto sin preposiciones. */
  it("no es lo mismo que el texto de pantalla", () => {
    const c = { material: "Cal", granulometria: null, envase: "Bolsón" };
    expect(textoDeClasificacion(c)).toBe("Cal Bolsón");
    expect(textoParaLaPlanilla(c)).toBe("Cal en Bolsones");
  });
});

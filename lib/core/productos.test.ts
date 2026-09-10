import { describe, it, expect } from "vitest";
import {
  MATERIALES,
  GRANULOMETRIAS,
  ENVASES,
  clasificacionDelProducto,
  clasificacionPorOdoo,
  productoPorOdoo,
  problemaDeClasificacion,
  textoDeClasificacion,
  separarCodigoYNombre,
} from "./productos";
import type { Producto } from "./types";

function prod(
  odoo_product_id: number | null,
  material: string | null,
  granulometria: string | null,
  envase: string | null,
  activo = true
): Producto {
  return {
    id: `id-${odoo_product_id ?? "sin-odoo"}`,
    odoo_product_id,
    odoo_default_code: null,
    nombre: `producto ${odoo_product_id ?? "de fábrica"}`,
    material,
    granulometria,
    envase,
    kg_por_unidad: null,
    activo,
  };
}

const CATALOGO: Producto[] = [
  prod(2394, "Filler", null, "A granel"),
  prod(3986, "Calcio", "0-1", "Bolsón"),
  prod(2399, "Cal", null, "Tolva", false),
  // El más despachado de todos, y no tiene terna posible: no es material x
  // granulometría x envase. Sembrado y sin clasificar para siempre.
  prod(4375, null, null, null),
];

describe("clasificacionDelProducto", () => {
  it("devuelve los tres campos de la fila del catálogo", () => {
    expect(clasificacionDelProducto(CATALOGO[1])).toEqual({
      material: "Calcio",
      granulometria: "0-1",
      envase: "Bolsón",
    });
  });

  /**
   * Los tres o ninguno. `MINERALES ECOLOGICOS` —379 líneas de remito, el
   * producto más despachado— no es una terna, y eso es un estado válido: se
   * muestra con su nombre de Odoo. Media clasificación no existe.
   */
  it("sin material o sin envase no hay clasificación", () => {
    expect(clasificacionDelProducto(CATALOGO[3])).toBeNull();
    expect(clasificacionDelProducto(prod(1, "Cal", null, null))).toBeNull();
    expect(clasificacionDelProducto(prod(1, null, null, "Bolsa"))).toBeNull();
  });
});

describe("clasificacionPorOdoo", () => {
  it("resuelve el producto de Odoo contra el catálogo", () => {
    expect(clasificacionPorOdoo(3986, CATALOGO)).toEqual({
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
   * Bolsa y nadie lo note. Sin clasificar, null y el nombre en pantalla.
   */
  it("devuelve null cuando el producto no está o no está clasificado", () => {
    expect(clasificacionPorOdoo(7052, CATALOGO)).toBeNull();
    expect(clasificacionPorOdoo(4375, CATALOGO)).toBeNull();
    expect(clasificacionPorOdoo(null, CATALOGO)).toBeNull();
    expect(clasificacionPorOdoo(2394, [])).toBeNull();
  });

  /**
   * `activo` saca al producto del alta, no le borra la clasificación a las
   * órdenes viejas: una orden de hace un año sigue siendo de Cal en tolva. Los
   * cinco productos que Odoo tiene archivados entran inactivos por esto.
   */
  it("un producto dado de baja sigue clasificando las órdenes que ya lo usaron", () => {
    expect(clasificacionPorOdoo(2399, CATALOGO)).toEqual({
      material: "Cal",
      granulometria: null,
      envase: "Tolva",
    });
  });
});

describe("productoPorOdoo", () => {
  it("encuentra la fila, clasificada o no", () => {
    expect(productoPorOdoo(4375, CATALOGO)?.id).toBe("id-4375");
    expect(productoPorOdoo(999, CATALOGO)).toBeNull();
    expect(productoPorOdoo(null, CATALOGO)).toBeNull();
  });
});

describe("problemaDeClasificacion", () => {
  it("acepta una clasificación entera y una vacía", () => {
    expect(problemaDeClasificacion({ material: "Cal", envase: "Bolsón" })).toBeNull();
    expect(
      problemaDeClasificacion({ material: "Calcio", granulometria: "0-2", envase: "Bolsa" })
    ).toBeNull();
    expect(problemaDeClasificacion({})).toBeNull();
  });

  /** La base guarda texto, así que un valor inventado sólo lo para esto. */
  it("rechaza lo que no está en las listas", () => {
    expect(problemaDeClasificacion({ material: "Caal", envase: "Bolsa" })).toContain("Material");
    expect(problemaDeClasificacion({ material: "Cal", envase: "Bolsonn" })).toContain("Envase");
    expect(
      problemaDeClasificacion({ material: "Cal", granulometria: "02", envase: "Bolsa" })
    ).toContain("Granulometría");
  });

  it("no deja media clasificación", () => {
    expect(problemaDeClasificacion({ material: "Cal" })).toContain("entera o vacía");
    expect(problemaDeClasificacion({ envase: "Bolsa" })).toContain("entera o vacía");
    expect(problemaDeClasificacion({ granulometria: "0-2" })).toContain("sin material");
  });

  /**
   * El caso que motiva el segundo parámetro: un PATCH manda sólo el envase de un
   * producto que ya tiene material, y eso está bien. Sin mirar lo que hay,
   * "envase solo" se leería como media clasificación y se rechazaría un cambio
   * legítimo.
   */
  it("mide sobre lo que va a quedar, no sobre lo que vino", () => {
    const actual = { material: "Cal", granulometria: null, envase: "Bolsa" };
    expect(problemaDeClasificacion({ envase: "Bolsón" }, actual)).toBeNull();
    expect(problemaDeClasificacion({ granulometria: "0-2" }, actual)).toBeNull();
    // Y borrar el material dejando el envase sigue siendo media clasificación.
    expect(problemaDeClasificacion({ material: "" }, actual)).toContain("entera o vacía");
    // Vaciar los dos es válido: el producto vuelve a "sin clasificar".
    expect(problemaDeClasificacion({ material: "", envase: "" }, actual)).toBeNull();
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
   * El talonario tiene cuatro materiales y tres envases, y no alcanzan: se
   * despacha Chocolata y Pedregullo 6/20, hay productos "EN TOLVA" que el papel
   * no contempla, y `Cal Bolsa Moreno (UNIDAD)` se mide en unidades. Por eso la
   * lista vive acá y no en un enum de Postgres, donde cada valor nuevo cuesta
   * una migración sola (55P04).
   */
  it("cubren lo que el papel no", () => {
    expect(MATERIALES).toContain("Cal");
    expect(MATERIALES).toContain("Pedregullo");
    // 30 órdenes del histórico son de dolomita, que el talonario no tiene.
    expect(MATERIALES).toContain("Dolomita");
    expect(ENVASES).toContain("A granel");
    expect(ENVASES).toContain("Tolva");
    expect(ENVASES).toContain("Unidad");
    expect(GRANULOMETRIAS).toContain("#200");
    expect(GRANULOMETRIAS).toContain("6/20");
  });

  it("no tienen repetidos", () => {
    for (const lista of [MATERIALES, GRANULOMETRIAS, ENVASES]) {
      expect(new Set(lista).size).toBe(lista.length);
    }
  });
});

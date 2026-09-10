import { describe, it, expect } from "vitest";
import { textoParaLaPlanilla } from "./clasificacion";
import { textoDeClasificacion } from "@/lib/core/productos";

/**
 * Lo que este archivo probaba del catálogo —las listas, resolver un producto de
 * Odoo, separar el código del nombre— se fue a `lib/core/productos.test.ts` con
 * su código: desde el catálogo único, eso lo comparten Producción y Despacho.
 * Acá queda lo que es de este módulo.
 *
 * `clasificacionDeLaOrden` se prueba en `equivalenciasDelHistorico.test.ts`,
 * que es donde vive el otro de sus dos caminos.
 */

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

  /** Para pantalla se sigue usando el texto sin preposiciones, que es del núcleo. */
  it("no es lo mismo que el texto de pantalla", () => {
    const c = { material: "Cal", granulometria: null, envase: "Bolsón" };
    expect(textoDeClasificacion(c)).toBe("Cal Bolsón");
    expect(textoParaLaPlanilla(c)).toBe("Cal en Bolsones");
  });
});

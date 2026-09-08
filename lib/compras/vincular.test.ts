import { describe, it, expect } from "vitest";
import {
  archivosPorHacer, idDePlanilla, linkDeCelda, linkDeLaComparativa, planillasPorRi,
} from "./vincular";

/**
 * La celda de comparativa de la planilla muestra "LINK" y esconde el
 * hipervinculo detras. La API de Sheets devuelve el texto visible, asi que la
 * URL hay que sacarla de la formula o del hipervinculo del texto.
 */
describe("de donde sale el link de la celda", () => {
  it("de una formula HYPERLINK", () => {
    expect(linkDeCelda('=HYPERLINK("https://docs.google.com/spreadsheets/d/ABC/edit","LINK")', null))
      .toBe("https://docs.google.com/spreadsheets/d/ABC/edit");
  });

  it("del hipervinculo, cuando el link se pego sobre el texto", () => {
    expect(linkDeCelda("LINK", "https://docs.google.com/spreadsheets/d/XYZ/edit"))
      .toBe("https://docs.google.com/spreadsheets/d/XYZ/edit");
  });

  it("de la celda misma, cuando pegaron la URL como texto", () => {
    expect(linkDeCelda("https://docs.google.com/spreadsheets/d/QQQ/edit", null))
      .toBe("https://docs.google.com/spreadsheets/d/QQQ/edit");
  });

  it("una celda sin link no inventa nada", () => {
    expect(linkDeCelda("LINK", null)).toBeNull();
    expect(linkDeCelda("", null)).toBeNull();
    expect(linkDeCelda(null, null)).toBeNull();
  });

  it("la formula gana sobre el hipervinculo: es mas especifica", () => {
    expect(linkDeCelda('=HYPERLINK("https://docs.google.com/spreadsheets/d/AAA/edit","x")', "https://otro"))
      .toBe("https://docs.google.com/spreadsheets/d/AAA/edit");
  });
});

describe("el id de la planilla dentro del link", () => {
  it("lo saca de una URL de Sheets", () => {
    expect(idDePlanilla("https://docs.google.com/spreadsheets/d/1tP7_LqEErE5wDL/edit#gid=0"))
      .toBe("1tP7_LqEErE5wDL");
  });

  it("tolera la query de compartir", () => {
    expect(idDePlanilla("https://docs.google.com/spreadsheets/d/ABC-123_x/edit?usp=sharing"))
      .toBe("ABC-123_x");
  });

  it("tambien de un link de Drive con id en la query", () => {
    expect(idDePlanilla("https://drive.google.com/open?id=ZZZ999")).toBe("ZZZ999");
  });

  it("lo que no es una planilla devuelve null", () => {
    expect(idDePlanilla("https://www.google.com")).toBeNull();
    expect(idDePlanilla("LINK")).toBeNull();
    expect(idDePlanilla(null)).toBeNull();
  });
});

describe("que planilla le toca a cada requerimiento", () => {
  it("resuelve el id de cada link", () => {
    const { ids, sinPlanilla } = planillasPorRi(new Map([
      [1901, "https://docs.google.com/spreadsheets/d/AAA/edit#gid=0"],
      [1902, "https://docs.google.com/spreadsheets/d/AAA/edit"],
      [1903, "https://docs.google.com/spreadsheets/d/BBB/edit"],
    ]));
    expect(ids.get(1901)).toBe("AAA");
    expect(ids.get(1902)).toBe("AAA");
    expect(ids.get(1903)).toBe("BBB");
    expect(sinPlanilla).toEqual([]);
  });

  it("un link que no es una planilla se cuenta, no se enlaza a lo que se le parece", () => {
    // Doce celdas de comparativa llevan a una publicacion de MercadoLibre o a
    // un PDF de Drive. De ahi no sale un archivo de comparativa, y meterlo en
    // comparativa_drive_id seria hacer que la ficha intente abrir una planilla
    // que no existe.
    const { ids, sinPlanilla } = planillasPorRi(new Map([
      [179, "https://www.mercadolibre.com.ar/caudalimetro/up/MLAU226608298"],
      [192, "https://drive.google.com/file/d/1XqTJEgssCp2Uv3XEsh2C9LvI-XwT3_6K/view"],
      [1901, "https://docs.google.com/spreadsheets/d/AAA/edit"],
    ]));
    expect([...ids.keys()]).toEqual([1901]);
    expect(sinPlanilla).toEqual([179, 192]);
  });
});

describe("que archivos le quedan a la vinculacion en tanda", () => {
  const archivo = (ris: { yaVinculado: boolean; yaLeido: boolean }[]) => ris;

  it("uno con todo hecho no vuelve a leerse", () => {
    // Este era el bug: con filas=1 pasaban TODOS los archivos, asi que cada
    // tanda releia los mismos veinte primeros y "quedan N planillas" nunca
    // bajaba. Los 219 archivos no se terminaban en ninguna cantidad de tandas.
    const pendientes = archivosPorHacer(new Map([
      ["AAA", archivo([{ yaVinculado: true, yaLeido: true }])],
    ]), true);
    expect(pendientes).toEqual([]);
  });

  it("uno que la sincronizacion enlazo pero nadie abrio queda pendiente", () => {
    // Asi llegan los que enlaza la sincronizacion: con el archivo pero sin
    // nombre, porque enlaza por el link de la celda sin abrir nada.
    const porArchivo = new Map([
      ["AAA", archivo([{ yaVinculado: true, yaLeido: false }])],
    ]);
    expect(archivosPorHacer(porArchivo, true).map(([id]) => id)).toEqual(["AAA"]);
    // Sin pedir filas, el vinculo ya esta: no hay nada que hacer.
    expect(archivosPorHacer(porArchivo, false)).toEqual([]);
  });

  it("una planilla sin filas de ese RI igual queda leida: no tapa la cola", () => {
    // El corte no puede ser "ya tiene presupuestos". Una planilla puede no
    // tener ninguna fila de ese pedido, y con esa condicion volveria a entrar
    // en cada tanda, ocupando los veinte lugares para siempre.
    const pendientes = archivosPorHacer(new Map([
      ["AAA", archivo([{ yaVinculado: true, yaLeido: true }])],
    ]), true);
    expect(pendientes).toEqual([]);
  });

  it("alcanza con que un solo requerimiento del archivo le falte algo", () => {
    // Un archivo sirve a varios RI —son por articulo—: si uno no esta traido,
    // hay que abrirlo, y de paso se resuelven los demas.
    const pendientes = archivosPorHacer(new Map([
      ["AAA", archivo([
        { yaVinculado: true, yaLeido: true },
        { yaVinculado: false, yaLeido: false },
      ])],
      ["BBB", archivo([{ yaVinculado: true, yaLeido: true }])],
    ]), true);
    expect(pendientes.map(([id]) => id)).toEqual(["AAA"]);
  });
});

describe("a donde abre la comparativa de un requerimiento", () => {
  it("al archivo enlazado, que es el vinculo bueno", () => {
    expect(linkDeLaComparativa({ comparativa_drive_id: "AAA", comparativa_url: "LINK" }))
      .toBe("https://docs.google.com/spreadsheets/d/AAA");
  });

  it("el texto LINK no es una direccion: no se pone en un href", () => {
    // Con esto la ficha de 1.905 requerimientos ofrecia "Ver comparativa" y
    // llevaba a /compras/requerimientos/LINK.
    expect(linkDeLaComparativa({ comparativa_drive_id: null, comparativa_url: "LINK" }))
      .toBeNull();
    expect(linkDeLaComparativa({})).toBeNull();
  });

  it("una URL cargada a mano sirve aunque no sea una planilla", () => {
    expect(linkDeLaComparativa({ comparativa_url: "https://www.mercadolibre.com.ar/x" }))
      .toBe("https://www.mercadolibre.com.ar/x");
  });
});

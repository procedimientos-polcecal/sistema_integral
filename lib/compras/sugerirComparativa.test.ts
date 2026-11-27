import { describe, it, expect } from "vitest";
import {
  raicesDelTexto,
  sugerirComparativa,
  type ArchivoDeLaCarpeta,
  type EnlacePasado,
} from "./sugerirComparativa";

const archivo = (id: string, nombre: string): ArchivoDeLaCarpeta => ({ id, nombre });

describe("raicesDelTexto", () => {
  it("saca acentos, puntuación y palabras vacías", () => {
    expect(raicesDelTexto("Cañería de polietileno para riego")).toEqual([
      "CAÑERIA", "POLIETILENO", "RIEGO",
    ]);
  });

  /*
   * La ñ es una letra y no una n con sombrero. Sacar los diacríticos sin
   * recomponer dejaba «CAÑO» en «CAN» —el acento se va y la n queda sola—, y
   * con eso un pedido de caños no encontraba nunca el archivo CAÑOS. Es la
   * misma trampa que este repo ya tiene anotada para `norm`.
   */
  it("la ñ sobrevive", () => {
    expect(raicesDelTexto("Caño negro")).toEqual(["CAÑO", "NEGRO"]);
    expect(raicesDelTexto("CAÑOS")).toEqual(raicesDelTexto("CAÑO"));
  });

  /*
   * El singular y el plural tienen que ser la misma palabra, porque todo este
   * mecanismo depende de que «CORREA D-162» encuentre el archivo «CORREAS».
   * Medido sobre los 1.717 enlaces: el nombre del archivo es casi siempre el
   * plural del artículo —CORREAS, MECHAS, CAÑOS, FICHAS, MANGUERAS—.
   */
  it("el plural y el singular son la misma raíz", () => {
    expect(raicesDelTexto("CORREAS")).toEqual(raicesDelTexto("CORREA"));
    expect(raicesDelTexto("FICHAS")).toEqual(raicesDelTexto("FICHA"));
  });

  it("tira los números y las medidas sueltas, que no distinguen nada", () => {
    expect(raicesDelTexto("CORREA B-58")).toEqual(["CORREA"]);
  });

  it("no repite una palabra que aparece dos veces", () => {
    expect(raicesDelTexto("CORREA correa CORREAS")).toEqual(["CORREA"]);
  });

  /*
   * Lo que la regla del plural **no** hace, y queda fijado para que nadie la
   * dé por perfecta: «CABLES» sale como CABL y «CABLE» como CABLE, porque sin
   * un diccionario no hay forma de saber si la «ES» final es el plural de una
   * palabra terminada en consonante —CAMIÓN/CAMIONES, TERMINAL/TERMINALES— o
   * la de una terminada en E.
   *
   * Se eligió igual la regla con «ES» porque está medida contra la otra sobre
   * los 1.717 enlaces reales: sacar «ES» y si no la «S» acierta **73,3%** y
   * contesta en 1.178 casos, contra **70,7%** y 1.119 de sacar sólo la «S».
   * Los TERMINALES —que es un nombre de archivo de verdad— pesan más que los
   * CABLES.
   */
  it("con la «ES» final puede errarle, y es el precio medido", () => {
    expect(raicesDelTexto("CABLES")).toEqual(["CABL"]);
    expect(raicesDelTexto("TERMINALES")).toEqual(raicesDelTexto("TERMINAL"));
  });
});

describe("sugerirComparativa", () => {
  const carpeta = [
    archivo("f1", "CORREAS"),
    archivo("f2", "RODAMIENTOS"),
    archivo("f3", "REPUESTOS MÁQUINAS"),
  ];

  /*
   * La señal fuerte: el mismo artículo ya se enlazó antes. Medido simulando
   * hacia adelante sobre los 1.717 enlaces reales, acierta el **95,1%** — pero
   * sólo puede contestar en 407 de 1.667 casos, porque la mayoría de los
   * pedidos son de un artículo que nunca se pidió. Por eso no alcanza sola.
   */
  it("el artículo que ya se enlazó antes manda", () => {
    const pasados: EnlacePasado[] = [
      { driveId: "f3", nombre: "REPUESTOS MÁQUINAS", claveArticulo: "CORREA B 58", descripcion: "CORREA B-58" },
      { driveId: "f3", nombre: "REPUESTOS MÁQUINAS", claveArticulo: "CORREA B 58", descripcion: "CORREA B-58" },
    ];

    const [primera] = sugerirComparativa(
      { descripcion: "CORREA B-58", claveArticulo: "CORREA B 58" },
      carpeta,
      pasados
    );

    // Gana al archivo que se llama CORREAS, que es lo que diría el nombre.
    expect(primera.driveId).toBe("f3");
    expect(primera.fuerte).toBe(true);
    expect(primera.porque).toBe("2 pedidos de lo mismo fueron a esta planilla");
  });

  it("con un solo pedido anterior lo dice en singular", () => {
    const [primera] = sugerirComparativa(
      { descripcion: "CORREA B-58", claveArticulo: "CORREA B 58" },
      carpeta,
      [{ driveId: "f3", nombre: "REPUESTOS MÁQUINAS", claveArticulo: "CORREA B 58", descripcion: "CORREA B-58" }]
    );
    expect(primera.porque).toBe("1 pedido de lo mismo fue a esta planilla");
  });

  /*
   * La señal que cubre lo que el historial no puede: un archivo usado por
   * primera vez. Son el **12,1%** de los enlaces —el techo de cualquier método
   * que sólo mire el pasado— y ahí el nombre del archivo acierta el 69,1%.
   */
  it("sin historial, el nombre del archivo alcanza", () => {
    const [primera] = sugerirComparativa(
      { descripcion: "CORREA D-162", claveArticulo: "CORREA D 162" },
      carpeta,
      []
    );
    expect(primera.driveId).toBe("f1");
    expect(primera.fuerte).toBe(false);
    expect(primera.porque).toBe("el nombre de la planilla dice «CORREAS»");
  });

  it("un archivo que nunca se usó compite igual", () => {
    const [primera] = sugerirComparativa(
      { descripcion: "Rodamiento 6204 2RS", claveArticulo: "RODAMIENTO 6204 2RS" },
      carpeta,
      [{ driveId: "f3", nombre: "REPUESTOS MÁQUINAS", claveArticulo: "OTRA COSA", descripcion: "Otra cosa" }]
    );
    expect(primera.driveId).toBe("f2");
  });

  /*
   * La tercera señal, la más floja: otro pedido parecido —no el mismo
   * artículo— fue a esa planilla. Sirve cuando el nombre no dice nada, que es
   * el caso de los archivos genéricos como «REPUESTOS MÁQUINAS», el más usado
   * de los 199 con 157 pedidos.
   */
  it("un pedido parecido pesa cuando el nombre no dice nada", () => {
    const [primera] = sugerirComparativa(
      { descripcion: "Filtro aceite hidráulico", claveArticulo: "FILTRO ACEITE HIDRAULICO" },
      [archivo("f3", "REPUESTOS MÁQUINAS"), archivo("f4", "PINTURAS")],
      [{ driveId: "f3", nombre: "REPUESTOS MÁQUINAS", claveArticulo: "FILTRO ACEITE MOTOR", descripcion: "Filtro aceite motor" }]
    );
    expect(primera.driveId).toBe("f3");
    expect(primera.porque).toBe("«Filtro aceite motor» fue a esta planilla");
  });

  it("devuelve a lo sumo tres", () => {
    const muchos = Array.from({ length: 9 }, (_, i) => archivo(`f${i}`, `CORREAS ${i}`));
    expect(sugerirComparativa({ descripcion: "CORREA", claveArticulo: "CORREA" }, muchos, [])).toHaveLength(3);
  });

  it("de la carpeta vacía no sugiere nada", () => {
    expect(sugerirComparativa({ descripcion: "CORREA", claveArticulo: "CORREA" }, [], [])).toEqual([]);
  });

  /*
   * Sin ninguna señal **no se sugiere nada**, y es deliberado: el primero de
   * una lista ordenada al azar se lee como una recomendación. Medido sobre los
   * enlaces reales, los casos sin ninguna coincidencia son 2 de 1.667.
   */
  it("sin ninguna coincidencia no inventa una sugerencia", () => {
    expect(
      sugerirComparativa({ descripcion: "Zapallo", claveArticulo: "ZAPALLO" }, carpeta, [])
    ).toEqual([]);
  });

  it("una descripción vacía no sugiere nada", () => {
    expect(sugerirComparativa({ descripcion: "", claveArticulo: "" }, carpeta, [])).toEqual([]);
  });

  /*
   * El mismo archivo no puede salir dos veces aunque gane por las tres
   * señales a la vez: la lista tiene tres lugares y gastarlos en repetir uno
   * deja afuera a los otros dos candidatos.
   */
  it("no repite un archivo que gana por varias señales", () => {
    const sugerencias = sugerirComparativa(
      { descripcion: "CORREA B-58", claveArticulo: "CORREA B 58" },
      carpeta,
      [{ driveId: "f1", nombre: "CORREAS", claveArticulo: "CORREA B 58", descripcion: "CORREA B-58" }]
    );
    expect(sugerencias.map((s) => s.driveId)).toEqual([...new Set(sugerencias.map((s) => s.driveId))]);
  });
});

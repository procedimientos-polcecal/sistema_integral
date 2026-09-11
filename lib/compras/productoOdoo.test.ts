import { describe, it, expect } from "vitest";
import {
  normalizarDescripcion, sugerirProducto, explicacionDeSugerencia, correspondeAprender,
  type ProductoDeOdoo, type Sugerencia,
} from "./productoOdoo";

/** Una muestra del catalogo real, con los casos que importan. */
const CATALOGO: ProductoDeOdoo[] = [
  { id: 1, nombre: "GUANTES" },
  { id: 2, nombre: "GRASAS" },
  { id: 3, nombre: "CABLES" },
  { id: 4, nombre: "FICHAS" },
  { id: 5, nombre: "LLAVE DE IMPACTO" },
  { id: 6, nombre: "LLAVES ALLEN" },
  { id: 7, nombre: "SELLADOR SILICONADO ACÉTICO" },
  { id: 8, nombre: "SELLADOR SILICONADO NEUTRO" },
  { id: 9, nombre: "TUBO DE ENCASTRE" },
  { id: 10, nombre: "BOLSAS CAL GÜEMES" },
  { id: 11, nombre: "ART. VARIOS" },
];

describe("normalizar una descripcion", () => {
  it("unifica mayusculas, acentos y plural", () => {
    // Las tres formas en que la misma cosa aparece escrita en los RI reales.
    const esperado = normalizarDescripcion("GUANTE");
    expect(normalizarDescripcion("Guantes")).toBe(esperado);
    expect(normalizarDescripcion("guantes")).toBe(esperado);
    expect(normalizarDescripcion(" Guánte ")).toBe(esperado);
  });

  it("saca la puntuacion y las palabras vacias", () => {
    expect(normalizarDescripcion('Cable tipo TPR 3 x 4 mm2 (x metro)')).toBe("CABLE TPR 3 4 MM2 METRO");
  });

  it("una descripcion vacia no rompe", () => {
    expect(normalizarDescripcion("")).toBe("");
    expect(normalizarDescripcion("   ")).toBe("");
  });

  it("no descarta un token corto: a veces es lo unico que distingue", () => {
    // Medido sobre RI reales: "CORREA A-68" y "Correa B 68" daban la misma
    // clave porque un filtro de largo sacaba la "A" y la "B" por tener un solo
    // caracter. Es la clave de lo aprendido: si empareja lo que no es lo mismo,
    // el enlace queda mal y no se nota.
    expect(normalizarDescripcion("Correa A-68")).toBe("CORREA A 68");
    expect(normalizarDescripcion("Correa B 68")).toBe("CORREA B 68");
    expect(normalizarDescripcion("Correa A-68")).not.toBe(normalizarDescripcion("Correa B 68"));
  });

  it("es idempotente: da la misma clave este escrito en singular o en plural", () => {
    // Antes, el filtro de vacias corria antes que la raiz: "TIPOS" pasaba el
    // filtro y la raiz lo dejaba en "TIPO", pero "TIPO" escrito asi de entrada
    // ya estaba en la lista de vacias y se filtraba. La misma palabra daba una
    // clave distinta segun como estaba escrita en el RI.
    expect(normalizarDescripcion("Cable tipos varios")).toBe(normalizarDescripcion("Cable tipo varios"));
  });
});

describe("sugerir el producto de Odoo", () => {
  const sugerir = (desc: string, aprendidos = new Map<string, number>()) =>
    sugerirProducto(desc, CATALOGO, aprendidos);

  it("la cabeza manda: 'Guantes de grasa' es GUANTES y no GRASAS", () => {
    // El prototipo que puntuaba por cobertura del nombre daba GRASAS, que es
    // exactamente el error que no se nota: la orden se lee bien y el gasto va a
    // otra cuenta contable.
    const r = sugerir("Guantes de grasa");
    expect(r.motivo).toBe("sugerido");
    expect(r.producto?.nombre).toBe("GUANTES");
  });

  it("acepta cuando el nombre del producto entra entero", () => {
    expect(sugerir("Ficha Macho 32A - 3P+N+T").producto?.nombre).toBe("FICHAS");
    expect(sugerir("Cable tipo TPR 3 x 4 mm2 (x metro)").producto?.nombre).toBe("CABLES");
    expect(sugerir("SELLADOR SILICONADO ACETICO TUBO").producto?.nombre).toBe("SELLADOR SILICONADO ACÉTICO");
  });

  it("NO acepta parciales, aunque compartan la cabeza", () => {
    // Medido sobre 300 RI: en esta franja el match esta mayormente mal. Es la
    // decision que sostiene todo el diseño.
    //
    // El catalogo de prueba tiene DOS productos con cabeza "LLAVE" (LLAVE DE
    // IMPACTO y LLAVES ALLEN), asi que si se saca el filtro de "entra entero"
    // los dos quedan como candidatos empatados en cantidad de tokens, y con el
    // desempate resuelto (arreglo de la regla de empate) el que gana se
    // sugiere igual: la mutacion sí cambia el resultado a "sugerido", que es
    // lo que hace sensible a este test.
    const r = sugerir("Llave combinada fija 13mm");
    expect(r.motivo).toBe("sin_sugerencia");
    expect(r.producto).toBeNull();
  });

  it("otro parcial de los medidos: un tubo estructural no es un TUBO DE ENCASTRE", () => {
    expect(sugerir('Tubo estructural 1"').motivo).toBe("sin_sugerencia");
  });

  it("sin cabeza que coincida no sugiere nada", () => {
    expect(sugerir("Modulo llave punto Kalop").motivo).toBe("sin_sugerencia");
    expect(sugerir("16x60").motivo).toBe("sin_sugerencia");
    expect(sugerir("").motivo).toBe("sin_sugerencia");
  });

  it("con empate gana el nombre mas corto y los otros van como alternativas", () => {
    // Dos productos que ENTRAN ENTEROS con la misma cantidad de tokens: es la
    // rama de empate de verdad. (El intento anterior con "SELLADOR SILICONADO"
    // no la ejercitaba: ninguno de los dos entra entero ahí, así que caía por
    // la rama de "cero candidatos, comparten cabeza" y no por el desempate.)
    const catalogoConEmpate: ProductoDeOdoo[] = [
      { id: 101, nombre: "CABLE UNIPOLAR" },
      { id: 102, nombre: "CABLE SUBTERRANEO" },
    ];
    const r = sugerirProducto("Cable unipolar subterraneo 4mm", catalogoConEmpate, new Map());
    expect(r.motivo).toBe("sugerido");
    expect(r.producto?.nombre).toBe("CABLE UNIPOLAR");
    expect(r.alternativas.map((p) => p.nombre)).toEqual(["CABLE SUBTERRANEO"]);
  });

  it("caso real: FILTRO y FILTROS son el mismo rubro duplicado en Odoo, y el empate no debe tapar la sugerencia", () => {
    // Medido sobre 1957 RI reales: 82 de los 83 empates son exactamente este
    // caso -FILTRO contra FILTROS, dos entradas del mismo rubro en el catalogo
    // de Odoo-, y es el item que mas se compra. Rechazar por empate perdia la
    // sugerencia justo ahi.
    const catalogoConDuplicado: ProductoDeOdoo[] = [
      { id: 201, nombre: "FILTRO" },
      { id: 202, nombre: "FILTROS" },
    ];
    const r = sugerirProducto("Filtro de aire", catalogoConDuplicado, new Map());
    expect(r.motivo).toBe("sugerido");
    expect(r.producto?.nombre).toBe("FILTRO");
    expect(r.alternativas.map((p) => p.nombre)).toEqual(["FILTROS"]);
  });

  it("lo aprendido gana sobre la regla", () => {
    const aprendidos = new Map([[normalizarDescripcion("Guantes de grasa"), 2]]);
    const r = sugerir("Guantes de grasa", aprendidos);
    expect(r.motivo).toBe("aprendido");
    expect(r.producto?.nombre).toBe("GRASAS");
  });

  it("lo aprendido que ya no esta en el catalogo se ignora en vez de romper", () => {
    // Alguien archivo el producto en Odoo. Se cae a la regla, no se propone un
    // id que la orden va a rechazar.
    const aprendidos = new Map([[normalizarDescripcion("Guantes de grasa"), 999]]);
    expect(sugerir("Guantes de grasa", aprendidos).motivo).toBe("sugerido");
  });
});

describe("la frase que explica la sugerencia", () => {
  const sug = (p: Partial<Sugerencia>): Sugerencia => ({
    producto: null, motivo: "sin_sugerencia", alternativas: [], ...p,
  });

  it("cuando empataron varios, lo dice y los nombra", () => {
    // Es el caso que la version anterior se callaba, y el unico en que hay
    // algo que mirar: el emparejador se quedo con el nombre mas corto de
    // varios validos.
    const frase = explicacionDeSugerencia(
      sug({ producto: { id: 1, nombre: "FILTRO" }, motivo: "sugerido", alternativas: [{ id: 2, nombre: "FILTROS" }] })
    );
    expect(frase).toContain("FILTROS");
    expect(frase.toLowerCase()).toContain("empat");
  });

  it("sin empates no inventa un empate", () => {
    const frase = explicacionDeSugerencia(
      sug({ producto: { id: 1, nombre: "GUANTES" }, motivo: "sugerido" })
    );
    expect(frase.toLowerCase()).not.toContain("empat");
  });

  it("lo aprendido se anuncia como aprendido y no como sugerido", () => {
    const frase = explicacionDeSugerencia(
      sug({ producto: { id: 1, nombre: "GUANTES" }, motivo: "aprendido" })
    );
    expect(frase.toLowerCase()).toContain("ya se us");
    expect(frase.toLowerCase()).not.toContain("sugerido");
  });

  it("sin sugerencia avisa que va el generico, con o sin parecidos", () => {
    expect(explicacionDeSugerencia(sug({}))).toContain("ART. VARIOS");
    const conParecidos = explicacionDeSugerencia(
      sug({ alternativas: [{ id: 5, nombre: "LLAVE DE IMPACTO" }] })
    );
    expect(conParecidos).toContain("ART. VARIOS");
    expect(conParecidos).toContain("LLAVE DE IMPACTO");
  });
});

describe("cuando corresponde aprender el producto", () => {
  const creada = [{ yaExistia: false }];
  const existente = [{ yaExistia: true }];

  it("aprende una eleccion humana que creo la orden", () => {
    expect(correspondeAprender({ hayProducto: true, eleccionHumana: true, ordenes: creada })).toBe(true);
  });

  it("NO aprende lo que salio de la propia tabla", () => {
    // Reescribir la fila con lo que ella misma dicto le pisa el created_by y
    // borra quien lo decidio de verdad.
    expect(correspondeAprender({ hayProducto: true, eleccionHumana: false, ordenes: creada })).toBe(false);
  });

  it("NO aprende cuando todas las ordenes ya existian", () => {
    // Ahi no se toco ninguna linea en Odoo: ese producto no decidio nada.
    expect(correspondeAprender({ hayProducto: true, eleccionHumana: true, ordenes: existente })).toBe(false);
  });

  it("aprende si al menos una de las dos se creo", () => {
    // Un RI compartido donde la primera ya estaba y la segunda se creo ahora.
    expect(
      correspondeAprender({ hayProducto: true, eleccionHumana: true, ordenes: [...existente, ...creada] })
    ).toBe(true);
  });

  it("sin producto no aprende ART. VARIOS", () => {
    expect(correspondeAprender({ hayProducto: false, eleccionHumana: true, ordenes: creada })).toBe(false);
  });

  it("sin ordenes no aprende nada", () => {
    expect(correspondeAprender({ hayProducto: true, eleccionHumana: true, ordenes: [] })).toBe(false);
  });
});

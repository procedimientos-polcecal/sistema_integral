import { describe, it, expect } from "vitest";
import {
  codigoDelTexto,
  columnasDelEquipo,
  equipoDeLaFila,
  equiposPorRi,
  resolverElEquipo,
  type EquipoDelNucleo,
} from "./equipoDelFormulario";

/*
 * El encabezado es el de verdad: la pregunta del equipo está repetida una vez
 * por rama del formulario, hoy dieciséis veces de la O a la AD.
 */
const ENCABEZADO = [
  "Nº RI", "Marca temporal", "Nombre", "Apellido", "ÁREA", "DESCRIPCIÓN DEL PEDIDO",
  "CODIGO", "CANTIDAD A PEDIR", "PARA DONDE SE NECESITA", "PARA CUANDO SE NECESITA",
  "DETALLES EXTRA", "ARCHIVO COMPLEMENTARIO", "DIRECCIÓN EMAIL ENVIADA",
  "Dirección de correo electrónico",
  "EQUIPO QUE SOLICITA", "EQUIPO QUE SOLICITA", "EQUIPO QUE SOLICITA",
];

const EQUIPOS: EquipoDelNucleo[] = [
  { id: "eq-1", code: "PO-A1-01", name: "Acarreador de placas" },
  { id: "eq-6", code: "EM6", name: "Cargadora frontal 2" },
  { id: "eq-10", code: "EM10", name: "Autoelevador 1" },
  { id: "eq-x", code: null, name: "Zaranda sin código" },
];

function fila(nro: number | string, equipos: Record<number, string> = {}) {
  const f = new Array(17).fill("");
  f[0] = String(nro);
  for (const [c, v] of Object.entries(equipos)) f[Number(c)] = v;
  return f;
}

describe("dónde está la pregunta del equipo", () => {
  it("la busca por el encabezado, no por la posición", () => {
    expect(columnasDelEquipo(ENCABEZADO)).toEqual([14, 15, 16]);
  });

  it("aguanta el acento y los espacios de más", () => {
    expect(columnasDelEquipo(["  equipo  que   solicita "])).toEqual([0]);
  });

  it("si el formulario todavía no la tiene, no hay columnas", () => {
    expect(columnasDelEquipo(["Nº RI", "ÁREA"])).toEqual([]);
  });
});

describe("qué contestó una fila", () => {
  it("la rama que llenó, entre todas las que dejó vacías", () => {
    expect(equipoDeLaFila(fila(10, { 15: "EM6 - CATERPILLAR 950 G" }), [14, 15, 16]))
      .toBe("EM6 - CATERPILLAR 950 G");
  });

  it("nada cuando no contestó ninguna", () => {
    expect(equipoDeLaFila(fila(10), [14, 15, 16])).toBeNull();
  });

  /*
   * La columna del master la arma un FILTER que devuelve #N/A mientras no haya
   * ni una respuesta. Guardar eso como el equipo sería guardar basura con cara
   * de dato.
   */
  it("un error de fórmula no es una respuesta", () => {
    expect(equipoDeLaFila(fila(10, { 14: "#N/A (No matches are found)" }), [14, 15, 16])).toBeNull();
    expect(equipoDeLaFila(fila(10, { 14: "#REF!" }), [14, 15, 16])).toBeNull();
  });

  it("la misma respuesta repetida en dos ramas sigue siendo una", () => {
    expect(equipoDeLaFila(fila(10, { 14: "EM6 - CAT 950 G", 16: "EM6 - CAT 950 G" }), [14, 15, 16]))
      .toBe("EM6 - CAT 950 G");
  });

  it("dos respuestas distintas no eligen ninguna", () => {
    expect(equipoDeLaFila(fila(10, { 14: "EM6 - CAT 950 G", 16: "EM1 - CAT 320 B" }), [14, 15, 16]))
      .toBeNull();
  });
});

describe("el código que trae adelante el valor", () => {
  it("corta en el guión con espacios, no en los del código", () => {
    expect(codigoDelTexto("PO-A1-01 - ACARREADOR DE PLACAS")).toBe("PO-A1-01");
  });

  /*
   * Sale normalizado —sin acentos ni eñes— porque del otro lado el código del
   * equipo pasa por la misma función: lo que importa es que las dos puntas se
   * comparen igual, no que el texto quede lindo.
   */
  it("un valor sin separador es todo código", () => {
    expect(codigoDelTexto("PAÑOL")).toBe("PANOL");
  });

  it("acepta el guión largo, que es lo que pone Google al autoformatear", () => {
    expect(codigoDelTexto("EM6 – CATERPILLAR 950 G")).toBe("EM6");
  });
});

describe("a qué equipo del núcleo corresponde", () => {
  it("por el código, que está de los dos lados", () => {
    expect(resolverElEquipo("PO-A1-01 - ACARREADOR DE PLACAS", EQUIPOS)).toBe("eq-1");
  });

  /*
   * El caso de los móviles: el desplegable los llama por la marca y el núcleo
   * por la función. Sólo el código los une.
   */
  it("aunque el nombre no se parezca en nada", () => {
    expect(resolverElEquipo("EM6 - CATERPILLAR 950 G", EQUIPOS)).toBe("eq-6");
  });

  it("EM1 no se lleva EM10", () => {
    expect(resolverElEquipo("EM1 - CATERPILLAR 320 B", EQUIPOS)).toBeNull();
    expect(resolverElEquipo("EM10 - AUTOELEVADOR TOYOTA 1", EQUIPOS)).toBe("eq-10");
  });

  it("si no hay código, por el nombre completo", () => {
    expect(resolverElEquipo("Zaranda sin código", EQUIPOS)).toBe("eq-x");
  });

  /*
   * Catorce de las opciones del desplegable no son equipos. Que no enganchen es
   * lo correcto: el texto sobrevive igual y con él se busca la analítica.
   */
  it("un lugar que no es un equipo no enlaza a ninguno", () => {
    expect(resolverElEquipo("PAÑOL", EQUIPOS)).toBeNull();
    expect(resolverElEquipo("GALPON 1", EQUIPOS)).toBeNull();
  });

  it("dos equipos con el mismo código no resuelven nada", () => {
    const repetidos = [...EQUIPOS, { id: "otro", code: "EM6", name: "Otra cosa" }];
    expect(resolverElEquipo("EM6 - CATERPILLAR 950 G", repetidos)).toBeNull();
  });

  it("sin texto no hay nada que resolver", () => {
    expect(resolverElEquipo(null, EQUIPOS)).toBeNull();
  });
});

describe("lo que dijo cada RI", () => {
  const grilla = [
    ENCABEZADO,
    fila("", { 14: "" }),                              // fila de cebado del formulario
    fila("-"),                                          // idem
    fila(1933, { 14: "EM6 - CATERPILLAR 950 G" }),
    fila(1934),                                         // no contestó
    fila(1935, { 16: "PAÑOL" }),
  ];

  it("une por número de RI y no por posición", () => {
    const porRi = equiposPorRi(grilla);
    expect(porRi.get(1933)).toBe("EM6 - CATERPILLAR 950 G");
    expect(porRi.get(1935)).toBe("PAÑOL");
  });

  /*
   * Lo que rompía leer la columna del master: ahí el 1935 caería en la fila del
   * 1934, porque el FILTER aprieta los valores hacia arriba.
   */
  it("el que no contestó no hereda el equipo del siguiente", () => {
    expect(equiposPorRi(grilla).has(1934)).toBe(false);
  });

  it("sin la pregunta en el formulario devuelve un mapa vacío", () => {
    expect(equiposPorRi([["Nº RI", "ÁREA"], ["1", "Mantenimiento"]]).size).toBe(0);
  });

  it("una grilla vacía no explota", () => {
    expect(equiposPorRi([]).size).toBe(0);
  });
});

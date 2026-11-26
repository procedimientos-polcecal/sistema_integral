import { describe, it, expect } from "vitest";
import {
  estaCalculando, filaSiguienteSegunLaColumna, laPlanillaEncogio, textoParaLaCelda,
  tramosDeLaFila, urlDeVariosRangos, repartirRangos,
} from "./sheets";

/**
 * LA CAUSA, sacada de la revision de Drive de las 12:09:38 del 13/10/2026. La
 * planilla NO estaba vacia: estaba recalculando. Las columnas que salen de una
 * formula volvieron vacias y la fila 2 volvio con el cartel de Google.
 */
describe("si lo que se leyo todavia se estaba calculando", () => {
  /** Las primeras filas de esa revision, tal como las exporto Drive. */
  const comoVino = [
    ["N° OT", "FECHA", "SECTOR", "EQUIPO", "ESPECIALIDAD"],
    ["Cargando...", "", "", "", "Cargando..."],
    [],
    ["", "", "", "", ""],
  ];

  it("reconoce el cartel de Google", () => {
    expect(estaCalculando(comoVino)).toBe(true);
  });

  it("en cualquier idioma y sin importar mayusculas ni espacios", () => {
    expect(estaCalculando([["Loading..."]])).toBe(true);
    expect(estaCalculando([["  cargando...  "]])).toBe(true);
    expect(estaCalculando([["LOADING..."]])).toBe(true);
  });

  it("una planilla con datos de verdad no dispara nada", () => {
    expect(estaCalculando([["N° OT", "FECHA"], ["623", "1/12/2025"], []])).toBe(false);
    expect(estaCalculando([])).toBe(false);
  });

  /**
   * El falso positivo que importa: "cargando" aparece de verdad en las
   * descripciones de trabajo. Se compara la celda entera, no por contenido.
   */
  it("una descripcion que habla de cargar no es una celda calculando", () => {
    expect(estaCalculando([["Se rompe mientras esta cargando camion"]])).toBe(false);
    expect(estaCalculando([["Cargando"]])).toBe(false);
  });

  /** Y esta es la cuenta que se hizo sobre esos datos: dio 3. */
  it("sobre esa lectura, la fila elegida era la 3", () => {
    expect(filaSiguienteSegunLaColumna([["N° OT"], ["Cargando..."], [], []])).toBe(3);
  });
});

/**
 * La otra red: por si el cartel no llega a aparecer pero la lectura igual
 * vuelve mas corta de lo que sabemos que hay.
 */
describe("si la planilla encogio", () => {
  it("menos filas de las que sabemos que hay: no se escribe", () => {
    // Lo que la lectura de aquel dia devolvio: 2 filas, contra 2156 anotadas.
    expect(laPlanillaEncogio(2, 2156)).toBe(true);
  });

  it("una sola fila de menos ya alcanza", () => {
    // Cada sheets_row guardado es la promesa de que esa fila existe. Si falta
    // una, todas las de abajo se corrieron y ninguna escritura es segura.
    expect(laPlanillaEncogio(2162, 2163)).toBe(true);
  });

  it("las que esperabamos, o mas, estan bien", () => {
    expect(laPlanillaEncogio(2163, 2163)).toBe(false);
    expect(laPlanillaEncogio(2170, 2163)).toBe(false);
  });

  /** Sin nada anotado no hay con que comparar: no se bloquea. */
  it("sin referencia no opina", () => {
    expect(laPlanillaEncogio(0, 0)).toBe(false);
    expect(laPlanillaEncogio(2, 0)).toBe(false);
  });

  /** Una planilla nueva de verdad arranca vacia y tiene que poder recibir. */
  it("una pestana recien creada no es una que encogio", () => {
    expect(laPlanillaEncogio(1, 0)).toBe(false);
  });
});

describe("los tramos de una fila", () => {
  it("sin agujeros es un solo tramo", () => {
    expect(tramosDeLaFila(["a", "b", "c"])).toEqual([
      { desde: 0, hasta: 2, valores: ["a", "b", "c"] },
    ]);
  });

  /**
   * El caso de la planilla de OT: la columna L —indice 11— es una formula que
   * calcula atrasado/al dia y no se puede escribir ni con "".
   */
  it("un null en el medio parte la fila en dos", () => {
    const fila = [1, "x", null, "y", "z"];
    expect(tramosDeLaFila(fila)).toEqual([
      { desde: 0, hasta: 1, valores: [1, "x"] },
      { desde: 3, hasta: 4, valores: ["y", "z"] },
    ]);
  });

  it("varios agujeros dan varios tramos", () => {
    expect(tramosDeLaFila(["a", null, "b", null, "c"])).toEqual([
      { desde: 0, hasta: 0, valores: ["a"] },
      { desde: 2, hasta: 2, valores: ["b"] },
      { desde: 4, hasta: 4, valores: ["c"] },
    ]);
  });

  /** El vacio se escribe —es "sacá lo que habia"— y el null no. Son distintos. */
  it("el string vacio si se escribe", () => {
    expect(tramosDeLaFila(["a", "", "b"])).toEqual([
      { desde: 0, hasta: 2, valores: ["a", "", "b"] },
    ]);
  });

  it("un cero se escribe, que no es lo mismo que no tocar", () => {
    expect(tramosDeLaFila([0, null, 0])).toEqual([
      { desde: 0, hasta: 0, valores: [0] },
      { desde: 2, hasta: 2, valores: [0] },
    ]);
  });

  it("un null al principio y al final no deja tramos vacios", () => {
    expect(tramosDeLaFila([null, "a", null])).toEqual([
      { desde: 1, hasta: 1, valores: ["a"] },
    ]);
  });

  it("todo null no escribe nada", () => {
    expect(tramosDeLaFila([null, null])).toEqual([]);
    expect(tramosDeLaFila([])).toEqual([]);
  });
});

/**
 * Estaba sin tests. Es la cuenta de la que sale la fila donde se escribe, asi
 * que vale fijarla.
 */
describe("en que fila escribir, segun la columna que manda", () => {
  it("la siguiente a la ultima con algo", () => {
    expect(filaSiguienteSegunLaColumna([["N° OT"], ["622"], ["623"]])).toBe(4);
  });

  it("una fila vacia en el medio no corta la cuenta", () => {
    expect(filaSiguienteSegunLaColumna([["N° OT"], [], ["623"]])).toBe(4);
  });

  it("las vacias del final no cuentan", () => {
    expect(filaSiguienteSegunLaColumna([["N° OT"], ["622"], [""], ["  "]])).toBe(3);
  });

  /** Sin encabezado siquiera: la 1 queda para los titulos. */
  it("una pestana vacia empieza en la 2", () => {
    expect(filaSiguienteSegunLaColumna([])).toBe(2);
    expect(filaSiguienteSegunLaColumna([[""], []])).toBe(2);
  });
});

/**
 * Las dos escrituras usan USER_ENTERED, que es lo que hace que un numero entre
 * como numero y una fecha como fecha. El precio es que un texto libre tambien
 * se interpreta: "12/10" se vuelve una fecha y "=A1" una formula que lee otra
 * celda. Para un campo de texto escrito por una persona eso no es lo que se
 * quiso decir nunca.
 */
describe("un texto que la planilla no tiene que interpretar", () => {
  it("una frase comun va tal cual", () => {
    expect(textoParaLaCelda("falta el repuesto")).toBe("falta el repuesto");
    expect(textoParaLaCelda("Se rompio el 12 de octubre")).toBe("Se rompio el 12 de octubre");
  });

  /** El peligroso: sin escapar, la celda pasa a leer otra celda. */
  it("lo que arranca como formula se escapa", () => {
    expect(textoParaLaCelda("=A1")).toBe("'=A1");
    expect(textoParaLaCelda("+54 11 5555")).toBe("'+54 11 5555");
    expect(textoParaLaCelda("-")).toBe("'-");
    expect(textoParaLaCelda("@todos")).toBe("'@todos");
  });

  /** Y el silencioso: numeros y fechas, que entran sin quejarse. */
  it("lo que es solo numeros y separadores se escapa", () => {
    expect(textoParaLaCelda("12/10")).toBe("'12/10");
    expect(textoParaLaCelda("1500")).toBe("'1500");
    expect(textoParaLaCelda("19,58")).toBe("'19,58");
    expect(textoParaLaCelda("3:30")).toBe("'3:30");
  });

  it("vacio sigue siendo vacio: es como se borra una celda", () => {
    expect(textoParaLaCelda("")).toBe("");
    expect(textoParaLaCelda(null)).toBe("");
  });
});

/**
 * Leer varios rangos de una vez existe por la cuota de 60 lecturas por minuto
 * que comparten todos los modulos, no por velocidad. Lo que se prueba aca es lo
 * unico que puede romperse en silencio: que cada resultado vuelva al rango que
 * lo pidio.
 */
describe("leer varios rangos en una sola llamada", () => {
  const ALTAS = "Altas del sistema!A:B";
  const RESPUESTAS = "Respuestas de formulario 1!A:B";

  it("repite ranges una vez por rango, escapando el nombre de la pestaña", () => {
    const url = urlDeVariosRangos("ID1", [ALTAS, RESPUESTAS], false);
    expect(url).toContain("/values:batchGet?");
    expect(url).toContain("ranges=Altas%20del%20sistema!A%3AB");
    expect(url).toContain("ranges=Respuestas%20de%20formulario%201!A%3AB");
  });

  /** La opcion es de la llamada: una sola vez, no una por rango. */
  it("sinFormato va una sola vez, al final", () => {
    const url = urlDeVariosRangos("ID1", [ALTAS, RESPUESTAS], true);
    expect(url.match(/valueRenderOption=UNFORMATTED_VALUE/g)).toHaveLength(1);
  });

  it("sin sinFormato no se manda la opcion, que es como leia antes", () => {
    expect(urlDeVariosRangos("ID1", [ALTAS], false)).not.toContain("valueRenderOption");
  });

  it("devuelve un resultado por rango, en el orden en que se pidieron", () => {
    const reparto = repartirRangos(
      [ALTAS, RESPUESTAS],
      [{ values: [["alta"]] }, { values: [["respuesta"]] }]
    );
    expect(reparto).toEqual([[["alta"]], [["respuesta"]]]);
  });

  /** Un rango vacio no es un error: es lo mismo que devuelve una lectura suelta. */
  it("un rango sin datos vuelve como arreglo vacio", () => {
    expect(repartirRangos([ALTAS], [{}])).toEqual([[]]);
  });

  /**
   * El fallo que importa. Si Google contesta de menos y se reparte por orden,
   * el contenido de una pestaña se lee como si fuera el de otra y nada avisa.
   */
  it("si vuelven menos rangos de los pedidos no se lee nada", () => {
    expect(() => repartirRangos([ALTAS, RESPUESTAS], [{ values: [["alta"]] }])).toThrow(
      /se pidieron 2/
    );
  });

  it("y la guarda de la planilla calculando sigue valiendo, nombrando el rango", () => {
    expect(() =>
      repartirRangos([ALTAS, RESPUESTAS], [{ values: [["x"]] }, { values: [["Cargando..."]] }])
    ).toThrow(/Respuestas de formulario 1/);
  });

  it("sin rangos no se arma ninguna URL", () => {
    expect(repartirRangos([], [])).toEqual([]);
  });
});

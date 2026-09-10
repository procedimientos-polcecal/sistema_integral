import { describe, it, expect } from "vitest";
import {
  celdasDelAlta,
  celdasDePrioridadYEmpresa,
  filaConEsteRi,
  filaDelMaster,
  type DatosDelAlta,
} from "./formulario";

/** El encabezado real de "Respuestas de formulario 1", leido el 09/09/2026. */
const ENCABEZADO = [
  "Nº RI", "Marca temporal", "Nombre", "Apellido", "ÁREA",
  "DESCRIPCIÓN DEL PEDIDO", "CODIGO", "CANTIDAD A PEDIR",
  "PARA DONDE SE NECESITA", "PARA CUANDO SE NECESITA", "DETALLES EXTRA",
  "ARCHIVO COMPLEMENTARIO", "DIRECCIÓN EMAIL ENVIADA",
  "Dirección de correo electrónico", "Area",
];

const DATOS: DatosDelAlta = {
  nro_ri: 1954,
  nombre: "Admin",
  apellido: "SdG",
  area: "Almacén",
  descripcion: "Modulo llave punto Kalop",
  codigo: null,
  cantidad: 10,
  ubicacion: "Taller eléctrico",
  fecha_necesidad: "2026-09-10",
  detalle_extra: "Repo Stock",
  imagen_url: null,
  creado: new Date("2026-09-09T12:36:57.702Z"),
};

const porColumna = (celdas: { columna: number; valor: string }[]) =>
  new Map(celdas.map((c) => [c.columna, c.valor]));

describe("las celdas de un alta en la hoja de respuestas", () => {
  it("pone en cada columna lo que dice su encabezado", () => {
    const r = celdasDelAlta(ENCABEZADO, DATOS, 1957);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = porColumna(r.celdas);
    expect(c.get(2)).toBe("Admin");          // C, Nombre
    expect(c.get(3)).toBe("SdG");            // D, Apellido
    expect(c.get(4)).toBe("Almacén");        // E, ÁREA
    expect(c.get(5)).toBe("Modulo llave punto Kalop");
    expect(c.get(7)).toBe("10");             // H, CANTIDAD A PEDIR
    expect(c.get(8)).toBe("Taller eléctrico");
    expect(c.get(10)).toBe("Repo Stock");    // K, DETALLES EXTRA
  });

  it("el N° de RI va como la formula que tienen las otras filas", () => {
    // El que numera sigue siendo uno solo: la planilla. Escribir el numero como
    // literal haria que la proxima fila que Google agregue copie un valor en vez
    // de una formula, y ahi la serie se corta.
    const r = celdasDelAlta(ENCABEZADO, DATOS, 1957);
    if (!r.ok) throw new Error("deberia mapear");
    expect(porColumna(r.celdas).get(0)).toBe('=IF(B1957:B<>"",A1956+1,"")');
  });

  it("las dos fechas van como serial", () => {
    const r = celdasDelAlta(ENCABEZADO, DATOS, 1957);
    if (!r.ok) throw new Error("deberia mapear");
    const c = porColumna(r.celdas);
    expect(Number(c.get(1))).toBeCloseTo(46274.40066, 4);  // B, marca temporal
    expect(c.get(9)).toBe("46275");                         // J, para cuando
  });

  it("lo que no se cargo va vacio, no como 'null'", () => {
    const r = celdasDelAlta(ENCABEZADO, DATOS, 1957);
    if (!r.ok) throw new Error("deberia mapear");
    const c = porColumna(r.celdas);
    expect(c.get(6)).toBe("");   // G, CODIGO
    expect(c.get(11)).toBe("");  // L, ARCHIVO COMPLEMENTARIO
  });

  it("no escribe las columnas que el QUERY del master ignora", () => {
    // M, N y O son de la planilla: la M la escribe el Apps Script de los
    // avisos. Meterle mano seria decir que se aviso cuando no se aviso.
    const r = celdasDelAlta(ENCABEZADO, DATOS, 1957);
    if (!r.ok) throw new Error("deberia mapear");
    const columnas = r.celdas.map((c) => c.columna);
    expect(Math.max(...columnas)).toBe(11);
  });

  it("si falta una columna no escribe nada y dice cual falta", () => {
    // Escribir a ciegas en un archivo con otra estructura es la forma mas facil
    // de arruinar la planilla de alguien.
    const sinArea = ENCABEZADO.filter((h) => h !== "ÁREA");
    const r = celdasDelAlta(sinArea, DATOS, 1957);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivos.join(" ")).toContain("ÁREA");
  });

  it("tolera como esta escrito el encabezado: acentos, mayusculas y el ordinal", () => {
    // "Nº RI" con ordinal en la hoja de respuestas y "N° RI" con grado en el
    // master son la misma columna para quien la lee.
    const otro = [...ENCABEZADO];
    otro[0] = "N° RI";
    otro[4] = "area";
    const r = celdasDelAlta(otro, DATOS, 1957);
    expect(r.ok).toBe(true);
  });

  it("devuelve la fila que uso, para que quien escribe no use otra por error", () => {
    // `fila` queda horneada en la formula del numero de RI (A{fila-1}+1). Si
    // quien escribe usara su propia fila en vez de esta, la formula apuntaria
    // a otro lugar sin que nada lo note.
    const r = celdasDelAlta(ENCABEZADO, DATOS, 1957);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fila).toBe(1957);
  });

  it("el motivo de que falte el area no repite un alias que norm() ya colapsa", () => {
    // "ÁREA" y "AREA" son el mismo texto para clave() una vez sin acento: tener
    // los dos en ALIAS no cambia que columna se encuentra, solo ensucia el
    // mensaje que ve quien tiene que corregir la planilla.
    const sinArea = ENCABEZADO.filter((h) => h !== "ÁREA");
    const r = celdasDelAlta(sinArea, DATOS, 1957);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivos.join(" ")).toBe("area (ÁREA)");
  });

  describe("una pregunta nueva en el formulario no pierde columnas en silencio", () => {
    // Reproduce lo que midio la revision: el formulario de Google no tiene un
    // ancho fijo, y una pregunta nueva corre todo lo que viene despues. El
    // borde de lo que un alta puede llenar tiene que correr con ella.

    it("una pregunta antes del archivo complementario no pierde la imagen", () => {
      const conPreguntaNueva = [
        ...ENCABEZADO.slice(0, 11), // hasta DETALLES EXTRA inclusive
        "OBSERVACIONES INTERNAS",
        ...ENCABEZADO.slice(11), // ARCHIVO COMPLEMENTARIO en adelante
      ];
      const r = celdasDelAlta(
        conPreguntaNueva,
        { ...DATOS, imagen_url: "https://ejemplo.com/foto.jpg" },
        1957
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const c = porColumna(r.celdas);
      // ARCHIVO COMPLEMENTARIO corrio de la 11 (L) a la 12 (M).
      expect(c.get(12)).toBe("https://ejemplo.com/foto.jpg");
      // El borde corrio con ella: nada se escribe mas alla.
      expect(Math.max(...r.celdas.map((x) => x.columna))).toBe(12);
    });

    it("cuatro preguntas antes de la descripcion no pierden fecha, ubicacion, detalle ni imagen", () => {
      const conPreguntas = [
        ...ENCABEZADO.slice(0, 5), // hasta ÁREA inclusive
        "P1", "P2", "P3", "P4",
        ...ENCABEZADO.slice(5), // DESCRIPCIÓN DEL PEDIDO en adelante
      ];
      const r = celdasDelAlta(
        conPreguntas,
        { ...DATOS, imagen_url: "https://ejemplo.com/foto.jpg" },
        1957
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const c = porColumna(r.celdas);
      expect(c.get(12)).toBe("Taller eléctrico");   // PARA DONDE SE NECESITA, corrida 4
      expect(c.get(13)).toBe("46275");               // PARA CUANDO SE NECESITA
      expect(c.get(14)).toBe("Repo Stock");           // DETALLES EXTRA
      expect(c.get(15)).toBe("https://ejemplo.com/foto.jpg"); // ARCHIVO COMPLEMENTARIO
    });
  });

  it("si no esta la columna que marca el limite del alta, no escribe y dice el motivo", () => {
    // Sin "DIRECCIÓN EMAIL ENVIADA" tal cual esta escrita, no hay de donde sacar
    // el borde: negarse es mejor que adivinar un ancho.
    const sinBorde = ENCABEZADO.map((h) =>
      h === "DIRECCIÓN EMAIL ENVIADA" ? "DIRECCION EMAIL ENVIADA" : h
    );
    const r = celdasDelAlta(sinBorde, DATOS, 1957);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivos.join(" ")).toContain("DIRECCIÓN EMAIL ENVIADA");
  });

  it("una fecha de creacion invalida no escribe 'NaN' en la marca temporal", () => {
    // El docstring de serialDelInstante le pasa la responsabilidad de validar a
    // quien llama. La formula del RI es =IF(B<>"",...), asi que un "NaN" no
    // vacio numeraria un pedido con una marca basura.
    const r = celdasDelAlta(ENCABEZADO, { ...DATOS, creado: new Date("basura") }, 1957);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivos.join(" ")).toMatch(/marca temporal/i);
  });
});

describe("la fila del master que le corresponde a una fila de respuestas", () => {
  it("son dos menos: el QUERY lee desde A4 y sale en A2", () => {
    // Verificado el 09/09/2026: la fila 1957 de respuestas es la 1955 del
    // master, y ahi aparecio el RI 1954.
    expect(filaDelMaster(1957)).toBe(1955);
    expect(filaDelMaster(4)).toBe(2);
  });

  it("una fila que el QUERY no alcanza no tiene fila en el master", () => {
    expect(filaDelMaster(3)).toBeNull();
    expect(filaDelMaster(1)).toBeNull();
  });
});

describe("prioridad y empresa, en las dos columnas a mano del master", () => {
  it("escribe las dos cuando estan las dos columnas y hay los dos valores", () => {
    const r = celdasDePrioridadYEmpresa(
      { prioridad: 10, empresa: 11 },
      { prioridad: "ALTA", empresa: "Polcecal" }
    );
    expect(r.celdas).toEqual([
      { columna: 10, valor: "ALTA" },
      { columna: 11, valor: "Polcecal" },
    ]);
    expect(r.bloqueadas).toEqual([]);
  });

  it("si falta UNA de las dos columnas, escribe la otra y avisa por la que falta", () => {
    // Lo que midio la revision: el chequeo anterior solo se quejaba si faltaban
    // las dos, asi que con una sola columna escribia la que podia y devolvia
    // exito. Eso va contra la regla del modulo: si una ruta toca un campo que se
    // exporta y no puede exportarlo, el pendiente queda anotado.
    const r = celdasDePrioridadYEmpresa(
      { prioridad: 10, empresa: -1 },
      { prioridad: "ALTA", empresa: "Polcecal" }
    );
    expect(r.celdas).toEqual([{ columna: 10, valor: "ALTA" }]);
    expect(r.bloqueadas.join(" ")).toMatch(/empresa/i);
    expect(r.bloqueadas).toHaveLength(1);
  });

  it("una celda que no tenemos con que llenar no se pisa con vacio ni se anota", () => {
    // Mismo criterio que la celda de comparativa, que borraba el link de la
    // planilla: sin valor no hay nada que exportar, asi que tampoco hay
    // pendiente que anotar aunque la columna no exista.
    const r = celdasDePrioridadYEmpresa(
      { prioridad: -1, empresa: 11 },
      { prioridad: "", empresa: "" }
    );
    expect(r.celdas).toEqual([]);
    expect(r.bloqueadas).toEqual([]);
  });

  it("sin ninguna de las dos columnas no escribe nada y anota las dos", () => {
    const r = celdasDePrioridadYEmpresa(
      { prioridad: -1, empresa: -1 },
      { prioridad: "ALTA", empresa: "Ambas" }
    );
    expect(r.celdas).toEqual([]);
    expect(r.bloqueadas).toHaveLength(2);
  });
});

describe("la fila que ya tiene este RI en la hoja de respuestas", () => {
  /**
   * Las dos primeras columnas como las devuelve Google con `sinFormato`: la A es
   * el N° de RI que calcula la formula y la B la marca temporal. Las filas 1 a 3
   * no son datos.
   */
  const MARCA_1955 = 46274.400657;

  const filas = (): string[][] => [
    ["Nº RI", "Marca temporal"],
    ["", ""],
    ["", ""],
    ["1954", "45900.5"],
    ["1955", String(MARCA_1955)],
    ["", ""],
  ];

  it("encuentra la fila del pedido y la reconoce como propia por la marca", () => {
    // La 5 en base 1: el arreglo arranca en 0 y la primera respuesta es la 4.
    expect(filaConEsteRi(filas(), 1955, MARCA_1955)).toEqual({ fila: 5, esNuestra: true });
    expect(filaConEsteRi(filas(), 1954, 45900.5)).toEqual({ fila: 4, esNuestra: true });
  });

  it("tolera el redondeo del ida y vuelta del serial", () => {
    // Se escribe como texto decimal y Google lo parsea a double: el ultimo bit
    // puede moverse. 1e-6 de un dia son ocho centesimas de segundo.
    const r = filaConEsteRi(filas(), 1955, MARCA_1955 + 1e-9);
    expect(r).toEqual({ fila: 5, esNuestra: true });
  });

  it("una fila con el mismo numero y otra marca NO es la nuestra", () => {
    // Es el caso que importa: el N° de RI lo asigna la base y el de la planilla
    // lo calcula una formula, asi que si alguien manda el formulario de Google
    // en el medio hay una fila con nuestro numero que es de otro pedido.
    // Adoptarla dejaria este pedido apuntando a la fila ajena y sin fila propia.
    const r = filaConEsteRi(filas(), 1955, 46280.123456);
    expect(r).toEqual({ fila: 5, esNuestra: false });
  });

  it("una marca vacia tampoco cuenta como propia", () => {
    // `Number("")` da 0 y es finito: sin comparar de verdad, una fila a medio
    // escribir se habria dado por nuestra.
    const conMarcaVacia: string[][] = [[], [], [], ["1954", ""]];
    expect(filaConEsteRi(conMarcaVacia, 1954, 45900.5)).toEqual({ fila: 4, esNuestra: false });
  });

  it("un RI que no esta devuelve null, que es lo que deja escribir la fila nueva", () => {
    expect(filaConEsteRi(filas(), 1956, 46275)).toBeNull();
  });

  it("las filas vacias no cuentan como el RI 0", () => {
    // `Number("")` da 0: sin la guarda, un nro_ri invalido "coincidia" con la
    // primera fila vacia y el alta se salteaba la escritura creyendo que ya
    // estaba hecha.
    expect(filaConEsteRi(filas(), 0, 46275)).toBeNull();
    expect(filaConEsteRi(filas(), NaN, 46275)).toBeNull();
  });

  it("no mira el encabezado ni las dos filas que no son datos", () => {
    // Si un numero aparece arriba de la fila 4 no es una respuesta: darlo por
    // escrito dejaria el pedido sin fila propia y sin numero.
    const conBasuraArriba: string[][] = [
      ["1954", "45900.5"],
      ["1954", "45900.5"],
      ["1954", "45900.5"],
      ["", ""],
    ];
    expect(filaConEsteRi(conBasuraArriba, 1954, 45900.5)).toBeNull();
  });

  it("compara el valor crudo y tolera espacios", () => {
    expect(filaConEsteRi([[], [], [], [" 1954 ", " 45900.5 "]], 1954, 45900.5)).toEqual({
      fila: 4,
      esNuestra: true,
    });
  });

  it("una lectura corta no encuentra nada en vez de romper", () => {
    expect(filaConEsteRi([], 1954, 45900.5)).toBeNull();
    expect(filaConEsteRi([["Nº RI"]], 1954, 45900.5)).toBeNull();
  });

  it("un serial invalido no puede reconocer ninguna fila como propia", () => {
    // Un `created_at` que no es fecha da NaN. Que no reconozca su propia fila
    // hace ruido; darla por propia enlazaria a ciegas.
    expect(filaConEsteRi(filas(), 1955, NaN)).toEqual({ fila: 5, esNuestra: false });
  });
});

import { describe, it, expect } from "vitest";
import { aFilas, clavesDeEncabezado, leerLibro, libroXlsx, leerPrimeraHoja } from "./excel";
import JSZip from "jszip";

/**
 * Los valores esperados de `clavesDeEncabezado` y `aFilas` **no se inventaron**:
 * salieron de correr `sheet_to_json` de SheetJS sobre las mismas entradas el
 * 03/10/2026, antes de sacar esa librería del repo, y anotar qué devolvía. Son
 * el contrato que permite que los cinco lectores migrados no cambien.
 */
describe("clavesDeEncabezado", () => {
  it("un encabezado normal da las claves tal cual", () => {
    expect(clavesDeEncabezado(["Legajo", "Nombre"])).toEqual(["Legajo", "Nombre"]);
  });

  /** Medido: SheetJS da `X`, `X_1`, `X_2`. */
  it("un encabezado repetido lleva sufijo, y el primero no", () => {
    expect(clavesDeEncabezado(["X", "X", "X"])).toEqual(["X", "X_1", "X_2"]);
  });

  /**
   * Medido sobre planillas REALES, y vale la pena contar por qué este test
   * dice lo contrario de lo que decía al escribirlo.
   *
   * Con un libro armado a mano —donde la celda del encabezado existe y está en
   * blanco— SheetJS devuelve la clave `""`. Pero en un archivo real la celda
   * directamente **no está**, y ahí usa `__EMPTY`. El primer test se escribió
   * contra el libro armado a mano y encodeó el caso raro; el A/B contra 183
   * planillas de verdad mostró que lo que pasa siempre es `__EMPTY`.
   */
  it("un encabezado vacio se llama __EMPTY", () => {
    expect(clavesDeEncabezado(["A", "", "C"])).toEqual(["A", "__EMPTY", "C"]);
  });

  /** El segundo vacío cae en la regla del repetido: `__EMPTY_1`. */
  it("dos encabezados vacios: el segundo es __EMPTY_1", () => {
    expect(clavesDeEncabezado(["A", "", "", "D"])).toEqual(["A", "__EMPTY", "__EMPTY_1", "D"]);
  });

  /** Medido: `2026` da `"2026"` y `true` da `"TRUE"`, en mayusculas. */
  it("un encabezado que no es texto se convierte", () => {
    expect(clavesDeEncabezado(["A", 2026, true])).toEqual(["A", "2026", "TRUE"]);
  });

  it("nulos y undefined cuentan como vacio", () => {
    expect(clavesDeEncabezado([null, undefined])).toEqual(["__EMPTY", "__EMPTY_1"]);
  });
});

describe("aFilas", () => {
  it("la primera fila es el encabezado y el resto son datos", () => {
    expect(aFilas([["A", "B"], [1, 2], [3, 4]])).toEqual([
      { A: 1, B: 2 },
      { A: 3, B: 4 },
    ]);
  });

  /**
   * El caso que sostiene a todos los lectores: hacen `String(fila[clave]).trim()`
   * sin preguntar, así que una columna que falta tiene que ser `""` y no
   * `undefined` — `String(undefined)` da `"undefined"`, que se guardaría como
   * dato.
   */
  it("a la fila corta le quedan las columnas que faltan en cadena vacia", () => {
    expect(aFilas([["A", "B", "C"], [1]])).toEqual([{ A: 1, B: "", C: "" }]);
  });

  /** Medido: una fila en blanco se conserva, no se saltea. */
  it("una fila en blanco en el medio se conserva", () => {
    expect(aFilas([["A", "B"], [1, 2], ["", ""], [3, 4]])).toEqual([
      { A: 1, B: 2 },
      { A: "", B: "" },
      { A: 3, B: 4 },
    ]);
  });

  it("una hoja con solo encabezado no tiene filas", () => {
    expect(aFilas([["A", "B"]])).toEqual([]);
  });

  it("una matriz vacia no revienta", () => {
    expect(aFilas([])).toEqual([]);
    expect(aFilas([], 3)).toEqual([]);
  });

  /**
   * `desdeFila` es el `range` de SheetJS. Lo usa el importador de marcaciones:
   * el reporte del reloj trae filas de filtros antes del encabezado de verdad.
   */
  it("desdeFila saltea lo que hay arriba del encabezado", () => {
    const matriz = [["titulo", ""], ["", ""], ["A", "B"], [1, 2]];
    expect(aFilas(matriz, 2)).toEqual([{ A: 1, B: 2 }]);
  });

  it("un valor nulo en una celda se lee como cadena vacia", () => {
    expect(aFilas([["A"], [null], [undefined]])).toEqual([{ A: "" }, { A: "" }]);
  });
});

describe("leer y escribir un archivo de verdad", () => {
  it("lo que se escribe es lo que se lee", async () => {
    const buffer = await libroXlsx([
      { nombre: "Datos", filas: [["Legajo", "Nombre"], [101, "Juan"], [102, "Ana"]] },
    ]);
    const { filas, encabezados } = await leerPrimeraHoja(buffer);
    expect(encabezados).toEqual(["Legajo", "Nombre"]);
    expect(filas).toEqual([
      { Legajo: 101, Nombre: "Juan" },
      { Legajo: 102, Nombre: "Ana" },
    ]);
  });

  /**
   * EL TEST QUE JUSTIFICA LA MIGRACIÓN.
   *
   * Con SheetJS esto fallaba en una máquina en Buenos Aires: su escritor
   * guardaba el serial corrido por el huso local y su lector lo compensaba,
   * así que leer un archivo **ajeno** —uno de Excel o del reloj, con el serial
   * correcto— devolvía tres horas de más. Acá la ida y vuelta es exacta, y el
   * resultado no depende de en qué huso corra el proceso: `excelToDate` de
   * exceljs es aritmética UTC pura.
   */
  it("una fecha va y vuelve exacta, sin correrse por el huso", async () => {
    const fecha = new Date(Date.UTC(2026, 5, 1));
    const buffer = await libroXlsx([{ nombre: "F", filas: [["Fecha"], [fecha]] }]);
    const [hoja] = await leerLibro(buffer);
    const leida = hoja.matriz[1][0];
    expect(leida).toBeInstanceOf(Date);
    expect((leida as Date).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("una hora sola tambien vuelve exacta", async () => {
    const hora = new Date(Date.UTC(1899, 11, 30, 8, 7));
    const buffer = await libroXlsx([{ nombre: "F", filas: [["Hora"], [hora]] }]);
    const [hoja] = await leerLibro(buffer);
    expect((hoja.matriz[1][0] as Date).toISOString()).toBe("1899-12-30T08:07:00.000Z");
  });

  it("varias hojas conservan su nombre y su orden", async () => {
    const buffer = await libroXlsx([
      { nombre: "Lunes", filas: [["a"], [1]] },
      { nombre: "Martes", filas: [["b"], [2]] },
    ]);
    const hojas = await leerLibro(buffer);
    expect(hojas.map((h) => h.nombre)).toEqual(["Lunes", "Martes"]);
    expect(hojas[1].matriz[1][0]).toBe(2);
  });

  /** Excel no abre un archivo con un nombre de hoja de más de 31 caracteres. */
  it("un nombre de hoja largo se recorta a 31", async () => {
    const largo = "Un nombre de hoja larguisimo que no entra";
    const buffer = await libroXlsx([{ nombre: largo, filas: [["a"]] }]);
    const [hoja] = await leerLibro(buffer);
    expect(hoja.nombre).toBe(largo.slice(0, 31));
    expect(hoja.nombre.length).toBe(31);
  });

  it("una celda vacia se lee como cadena vacia y no como null", async () => {
    const buffer = await libroXlsx([{ nombre: "F", filas: [["A", "B"], [1, null]] }]);
    const [hoja] = await leerLibro(buffer);
    expect(hoja.matriz[1][1]).toBe("");
  });
});

/**
 * EL ARCHIVO DEL RELOJ BIOMÉTRICO.
 *
 * El exportador de Lenox —y cualquier otro escrito con las librerías .NET de
 * OpenXML— no declara SpreadsheetML como namespace por defecto sino en un
 * **prefijo**: escribe `<x:workbook>` y `<x:sheet>` donde Excel escribe
 * `<workbook>` y `<sheet>`. Las dos formas son el mismo XML y las dos son
 * válidas; lo que cambia es que `exceljs` compara el nombre del tag **letra
 * por letra** y no resuelve prefijos, así que `xl/workbook.xml` le parsea a
 * `undefined` y revienta con un `Cannot read properties of undefined (reading
 * 'sheets')` — que la pantalla muestra como "No se pudo leer el archivo".
 *
 * SheetJS sí los resolvía, así que esto se rompió el 03/10/2026 al migrar y no
 * lo notó nadie hasta que alguien necesitó el respaldo: la última importación
 * de marcaciones por Excel es del 01/10/2026.
 *
 * El libro de acá se arma prefijando uno normal, que es exactamente la
 * diferencia medida contra los seis reportes reales del reloj el 14/10/2026.
 */
async function conPrefijo(buffer: Buffer, p = "x"): Promise<Buffer> {
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const zip = await JSZip.loadAsync(buffer);
  for (const [nombre, entrada] of Object.entries(zip.files)) {
    if (entrada.dir || !nombre.endsWith(".xml")) continue;
    const xml = await entrada.async("string");
    if (!xml.includes(`xmlns="${NS}"`)) continue;
    zip.file(
      nombre,
      xml
        .replace(new RegExp(` xmlns="${NS}"`, "g"), ` xmlns:${p}="${NS}"`)
        .replace(/<([A-Za-z_][\w.-]*)/g, `<${p}:$1`)
        .replace(/<\/([A-Za-z_][\w.-]*)/g, `</${p}:$1`)
    );
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("leerLibro con el namespace en un prefijo", () => {
  it("lee un libro que escribe <x:workbook> igual que uno que escribe <workbook>", async () => {
    const normal = await libroXlsx([
      { nombre: "Marcaciones y Horas", filas: [["Legajo", "Fecha", "Marcaciones"], ["PC_233", "Ma 02/06/2026", " E 08:01 - S 16:07"]] },
    ]);
    const esperado = await leerLibro(normal);

    const [hoja] = await leerLibro(await conPrefijo(normal));

    expect(hoja.nombre).toBe("Marcaciones y Horas");
    expect(hoja.matriz).toEqual(esperado[0].matriz);
  });

  /** Las fechas son lo que ya se dio vuelta una vez en este repo: el prefijo no las puede correr. */
  it("una fecha se lee igual con prefijo que sin prefijo", async () => {
    const normal = await libroXlsx([{ nombre: "F", filas: [["Fecha"], [new Date(Date.UTC(2026, 5, 1))]] }]);
    const [hoja] = await leerLibro(await conPrefijo(normal));
    expect((hoja.matriz[1][0] as Date).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  /** Un archivo roto de verdad tiene que seguir fallando, y con su error, no con el del reintento. */
  it("un archivo que no es un .xlsx sigue fallando", async () => {
    await expect(leerLibro(Buffer.from("esto no es un xlsx"))).rejects.toThrow();
  });
});

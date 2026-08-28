import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

/**
 * El script que reordena las columnas de las comparativas de Drive.
 *
 * Vive en `docs/compras-columnas-apps-script.gs` porque corre en Apps Script,
 * con los permisos del usuario: la app tiene `drive.readonly` y no puede ni
 * sacar una copia de respaldo.
 *
 * Se prueba desde acá igual, y no es un lujo: el script mueve columnas en
 * planillas con años de cotizaciones ajenas. Un error por uno en el
 * reordenamiento desalinea datos que nadie va a poder reconstruir.
 *
 * Se lee el archivo real en vez de copiar el modelo y los alias, así una
 * corrección al script queda cubierta sin tocar el test.
 */
const RUTA = join(process.cwd(), "docs", "compras-columnas-apps-script.gs");

let MODELO: string[];
let cual: (texto: string) => number;

beforeAll(() => {
  const contexto: Record<string, unknown> = {};
  vm.createContext(contexto);
  vm.runInContext(readFileSync(RUTA, "utf8"), contexto);

  MODELO = contexto.MODELO as string[];
  cual = contexto._cual as (t: string) => number;
});

/**
 * Simula lo que hace el script sobre la hoja: primero los nombres, después
 * cada columna a su lugar. Las operaciones son las mismas —renombrar, insertar
 * y mover— sobre un arreglo en vez de sobre Sheets.
 */
function simular(encabezado: string[]) {
  const hoja = [...encabezado];
  const actual = hoja.map((h) => cual(h));
  let haciaLaDerecha = 0;

  for (let i = 0; i < hoja.length; i++) {
    if (actual[i] >= 0) hoja[i] = MODELO[actual[i]];
  }

  for (let destino = 0; destino < MODELO.length; destino++) {
    const donde = actual.indexOf(destino);

    if (donde < 0) {
      hoja.splice(destino, 0, MODELO[destino]);
      actual.splice(destino, 0, destino);
      continue;
    }
    if (donde === destino) continue;

    // La premisa de seguridad: `moveColumns` interpreta el destino con las
    // coordenadas de antes de mover, así que ir hacia la derecha exige
    // compensar el corrimiento. El script recorre de izquierda a derecha para
    // que eso nunca pase, y esto lo verifica.
    if (donde < destino) haciaLaDerecha++;

    const [h] = hoja.splice(donde, 1);
    hoja.splice(destino, 0, h);
    const [k] = actual.splice(donde, 1);
    actual.splice(destino, 0, k);
  }

  return { hoja, haciaLaDerecha };
}

describe("el script que pone las comparativas al dia", () => {
  it("el modelo son las 19 columnas de COLUMNAS_COMPARATIVA", () => {
    expect(MODELO).toHaveLength(19);
    expect(MODELO[0]).toBe("NRO RI");
    expect(MODELO[9]).toBe("ENVÍO");
    expect(MODELO[18]).toBe("ELECCIÓN");
  });

  it("reconoce las variantes de nombre que hay en las planillas", () => {
    expect(cual("N° RI")).toBe(0);
    expect(cual("Nº RI")).toBe(0);
    expect(cual("N. RI")).toBe(0);
    expect(cual("FLETE")).toBe(9);
    expect(cual("AREA")).toBe(2);
    expect(cual("ÁREA")).toBe(2);
    expect(cual("TOTAL")).toBe(12);
    expect(cual("ENTREGA")).toBe(16);
  });

  it("lo que no es una columna del modelo no se reconoce", () => {
    expect(cual("NOTA INTERNA")).toBe(-1);
    expect(cual("")).toBe(-1);
    expect(cual("   ")).toBe(-1);
  });
});

describe("el reordenamiento llega al modelo", () => {
  const casos: Record<string, () => string[]> = {
    "una planilla ya al dia": () => [...MODELO],

    // El caso real que disparó todo esto: sin columna de ENVÍO, la fórmula del
    // total salía "...+@1001".
    "sin la columna ENVIO": () => MODELO.filter((c) => c !== "ENVÍO"),

    "con los nombres viejos": () => [
      "N° RI", "FECHA", "SECTOR", "DETALLE", "PROVEEDOR", "MARCA", "UM",
      "UNITARIO", "CANT", "FLETE", "DESC", "IVA", "TOTAL", "VALIDO HASTA",
      "PLAZO", "CONDICIONES", "ENTREGA", "OBSERVACIONES", "ELEGIDO",
    ],

    "con una columna propia en el medio": () => [
      ...MODELO.slice(0, 10), "NOTA INTERNA", ...MODELO.slice(10),
    ],

    "todo desordenado": () => [
      "ELECCIÓN", "PROVEEDOR", "NRO RI", "PRECIO UNITARIO", "IVA", "FECHA",
      "CANTIDAD", "MARCA", "ÁREA", "DESCRIPCION", "UNIDAD DE MEDIDA", "ENVÍO",
      "DESCUENTO", "PRECIO TOTAL", "PRECIO HASTA", "PLAZOS",
      "CONDICIONES DE PAGO", "DISPONIBILIDAD", "COMENTARIO",
    ],
  };

  for (const [nombre, armar] of Object.entries(casos)) {
    it(nombre, () => {
      const { hoja, haciaLaDerecha } = simular(armar());
      expect(hoja.slice(0, 19)).toEqual(MODELO);
      expect(haciaLaDerecha).toBe(0);
    });
  }

  it("una columna propia se conserva, corrida despues de la S", () => {
    const { hoja } = simular([...MODELO.slice(0, 10), "NOTA INTERNA", ...MODELO.slice(10)]);
    expect(hoja.slice(19)).toEqual(["NOTA INTERNA"]);
  });

  it("no pierde ni duplica columnas", () => {
    const entrada = ["ELECCIÓN", "PROVEEDOR", "NRO RI", "PRECIO UNITARIO", "OTRA COSA"];
    const { hoja } = simular(entrada);
    // Las 19 del modelo más la que no se reconoció.
    expect(hoja).toHaveLength(20);
    expect(new Set(hoja).size).toBe(20);
    expect(hoja).toContain("OTRA COSA");
  });
});

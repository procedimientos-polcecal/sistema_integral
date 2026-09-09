import { describe, it, expect } from "vitest";
import { celdasDelAlta, type DatosDelAlta } from "./formulario";

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
    expect(r.faltan.join(" ")).toContain("ÁREA");
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
});

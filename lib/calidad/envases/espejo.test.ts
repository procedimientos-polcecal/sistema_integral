import { describe, it, expect } from "vitest";
import {
  celdasDelMovimiento, fechaParaLaPlanilla, contextoDeProteccion, COL,
} from "./espejo";

const MOV = {
  codigo: "00001",
  entrada: 0,
  salida: 1200,
  rotura: 8,
  despacho: 1200,
  fecha: "2026-09-15",
  observacion: "Rto. Flexi Rigs: 00001 - 3290",
  proveedor: null,
};

describe("celdasDelMovimiento", () => {
  it("nunca escribe la B, la G ni la K: son fórmulas", () => {
    const columnas = celdasDelMovimiento(MOV, 1404, "Entradas  Salidas").map((c) => c.columna);

    // B = VLOOKUP de la descripción, G = el saldo corriente, K = la
    // ARRAYFORMULA del grupo. Escribir cualquiera la rompe, y con la G se rompe
    // el stock de todo lo que viene abajo.
    expect(columnas).not.toContain(1);
    expect(columnas).not.toContain(6);
    expect(columnas).not.toContain(10);
  });

  it("escribe las ocho que sí van, todas en la misma fila y pestaña", () => {
    const celdas = celdasDelMovimiento(MOV, 1404, "Entradas  Salidas");
    expect(celdas.map((c) => c.columna).sort((a, b) => a - b))
      .toEqual([0, 2, 3, 4, 5, 7, 8, 9]);
    expect(celdas.every((c) => c.fila === 1404)).toBe(true);
    expect(celdas.every((c) => c.pestana === "Entradas  Salidas")).toBe(true);
  });

  it("pone los números, y el cero va vacío", () => {
    const celdas = celdasDelMovimiento(MOV, 1404, "Entradas  Salidas");
    const valor = (col: number) => celdas.find((c) => c.columna === col)!.valor;

    expect(valor(COL.codigo)).toBe("00001");
    // Entrada en cero: la celda va vacía, como las escribe la gente. Un "0"
    // escrito se lee como "se contó y dio cero", que es otra cosa.
    expect(valor(COL.entrada)).toBe("");
    expect(valor(COL.salida)).toBe("1200");
    expect(valor(COL.rotura)).toBe("8");
    expect(valor(COL.despacho)).toBe("1200");
    expect(valor(COL.observacion)).toBe("Rto. Flexi Rigs: 00001 - 3290");
    expect(valor(COL.proveedor)).toBe("");
  });

  it("el código va como texto, con sus ceros a la izquierda", () => {
    // Si se perdieran los ceros, la fórmula del listado —un SUMIF contra la
    // columna A— dejaría de encontrar el artículo y su stock se congelaría.
    const celdas = celdasDelMovimiento({ ...MOV, codigo: "00009" }, 1404, "x");
    expect(celdas.find((c) => c.columna === COL.codigo)!.valor).toBe("00009");
  });
});

describe("fechaParaLaPlanilla", () => {
  it("escribe el ISO, que Google parsea igual en cualquier locale", () => {
    // Medido el 16/09/2026 escribiendo las tres formas de verdad: el serial
    // (46280) entra como número y BORRA el formato de la celda —USER_ENTERED
    // reemplaza el formato por el que infiere—, así que se ve "46280"; el texto
    // "15/9/2026" se ve bien pero lo parsea el locale de la planilla; el ISO se
    // ve "15/9/2026" y no depende de nada.
    expect(fechaParaLaPlanilla("2026-09-15")).toBe("2026-09-15");
    // El caso que importa: el 1 de septiembre no es el 9 de enero.
    expect(fechaParaLaPlanilla("2025-09-01")).toBe("2025-09-01");
  });

  it("sin fecha, celda vacía", () => {
    expect(fechaParaLaPlanilla(null)).toBe("");
  });

  it("una fecha que no existe se descarta, no se corrige sola", () => {
    // El 30 de febrero lo rueda `Date.parse` al 2 de marzo y devolvería un
    // serial perfectamente plausible. Preferimos la celda vacía.
    expect(fechaParaLaPlanilla("2026-02-30")).toBe("");
  });
});

describe("contextoDeProteccion", () => {
  // El mensaje real que devolvió Google el 16/09/2026 al intentar la primera
  // alta: la cuenta es editora del archivo, pero no del rango protegido.
  const DE_GOOGLE =
    "Google respondió 400: Invalid data[0]: You are trying to edit a protected " +
    "cell or object. Please contact the spreadsheet owner to remove protection " +
    "if you need to edit.";

  it("aclara que el permiso que falta es el del rango, no el del archivo", () => {
    const extra = contextoDeProteccion(DE_GOOGLE);
    expect(extra).toContain("rango protegido");
    expect(extra).toContain("Hojas y rangos protegidos");
  });

  it("no dice nada cuando el rechazo es por otra cosa", () => {
    // Un fallo que no habla de protección no tiene que arrastrar un consejo
    // sobre permisos: mandaría a arreglar algo que no está roto.
    expect(contextoDeProteccion("Google no contestó en 30 segundos")).toBe("");
    expect(contextoDeProteccion("Google respondió 403: insufficient scope")).toBe("");
  });
});

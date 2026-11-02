import { describe, it, expect } from "vitest";
import {
  gruposAJuntar, interpretarExcel,
  type CeldaDelExcel, type FilaDelExcel,
} from "./cuadernoExcel";
import { esRutaDeExcel } from "./cuadernoOrigen";
import { TOPE_DE_HORAS_POR_RENGLON } from "./cuadernoLectura";

/**
 * Las filas se arman con la forma del archivo real `Tareas_Octubre_2026.xlsx`
 * (medido el 02/11/2026): el detalle a la izquierda —A fecha, B tarea, C horas,
 * D precio— y el resumen a la derecha —K tarea, N horas como fórmula
 * `=C47+C50+C51`—. La hoja de verdad tiene 97 renglones y 63 grupos; los tests
 * usan cuatro o cinco para que cada caso se lea entero.
 */

type Celdas = Record<string, CeldaDelExcel>;
const fila = (n: number, celdas: Celdas): FilaDelExcel => ({ fila: n, celdas });

const ENCABEZADO = (n = 1) =>
  fila(n, {
    A: "Fecha", B: "Tarea / Descripción", C: "Horas", D: "Precio ($)",
    K: "Tarea", L: "Desde", M: "Hasta", N: "Hs", O: "Precio ($)",
  });

type Detalle = [CeldaDelExcel, CeldaDelExcel, CeldaDelExcel, CeldaDelExcel?];
/** Una fila del resumen: tarea, y la celda de horas (fórmula, número o nada). */
type Resumen = [string, CeldaDelExcel];

/** La fórmula con el valor que Excel le habría calculado, sumando las C que nombra. */
function conResultado(formula: string, detalle: Array<Detalle | null>, primera: number): CeldaDelExcel {
  const horas = (n: number) => Number(detalle[n - primera]?.[2]) || 0;
  const suma = [...formula.matchAll(/C(\d+)/g)].reduce((s, m) => s + horas(Number(m[1])), 0);
  return { formula, resultado: suma };
}

/**
 * Un libro entero: encabezado en la fila 1, el detalle desde la 2, el resumen
 * desde la 2, y una fila de TOTALES a cada lado —como el archivo real—.
 */
function libro(
  detalle: Array<Detalle | null>,
  resumen: Array<[string, string | CeldaDelExcel] | null>,
  opciones: { totales?: boolean } = {}
): FilaDelExcel[] {
  const hasta = Math.max(detalle.length, resumen.length) + 1;
  const filas: FilaDelExcel[] = [ENCABEZADO()];
  for (let n = 2; n <= hasta + 1; n++) {
    const celdas: Celdas = {};
    const d = detalle[n - 2];
    if (d) {
      celdas.A = d[0]; celdas.B = d[1]; celdas.C = d[2];
      if (d[3] !== undefined) celdas.D = d[3];
    }
    const r = resumen[n - 2];
    if (r) {
      celdas.K = r[0];
      celdas.N = typeof r[1] === "string" ? conResultado(r[1], detalle, 2) : r[1];
    }
    if (Object.keys(celdas).length) filas.push(fila(n, celdas));
  }
  if (opciones.totales !== false) {
    const ultima = hasta + 1;
    filas.push(fila(ultima + 1, {
      A: "TOTALES", B: "Total general", C: { formula: `SUM(C2:C${hasta})`, resultado: 0 },
      K: "TOTALES", N: { formula: `SUM(N2:N${hasta})`, resultado: 0 },
    }));
  }
  return filas;
}

function leer(filas: FilaDelExcel[]) {
  const lectura = interpretarExcel(filas);
  if (!lectura.ok) throw new Error(`No se esperaba un rechazo: ${lectura.error}`);
  return lectura;
}

// Cinco renglones, cuatro grupos. Horas: 4 + 12 + 24 + 20 + 16 = 76.
const DETALLE: Detalle[] = [
  ["01/10/2026", "Limpieza techo idrat.", 4],                                // fila 2
  ["01/10/2026", "Limpieza y destorar pantalón en planta TRT Nº2", 12],      // fila 3
  ["01/10/2026", "Trabajo en grilla p/ TRT Nº2", 24],                        // fila 4
  ["02/10/2026", "Limpieza planta TRT Nº2", 20],                             // fila 5
  ["05/10/2026", "Grilla p/ TRT Nº2", 16],                                   // fila 6
];
const RESUMEN: Array<[string, string]> = [
  ["Grilla p/ TRT Nº2", "C4+C6"],                                            // fila 2 del resumen
  ["Limpieza techo idrat.", "C2"],                                           // fila 3
  ["Limpieza y destorar pantalón", "C3"],                                    // fila 4
  ["Limpieza planta TRT Nº2", "C5"],                                         // fila 5
];

// ─── El detalle ──────────────────────────────────────────────────────────────

describe("los renglones del detalle", () => {
  it("cada renglón trae fecha, tarea, horas y la fila del Excel", () => {
    const { renglones } = leer(libro(DETALLE, RESUMEN));
    expect(renglones).toHaveLength(5);
    expect(renglones[0]).toMatchObject({
      fila: 2, fecha: "2026-10-01", tarea: "Limpieza techo idrat.",
      horas: 4, costo: null, dudoso: false, motivo_dudoso: null,
    });
    // La fila es la única forma de volver del renglón a la planilla.
    expect(renglones.map((r) => r.fila)).toEqual([2, 3, 4, 5, 6]);
  });

  it("la fila de TOTALES y las filas en blanco no son renglones ni problemas", () => {
    const lectura = leer(libro(
      [["01/10/2026", "Limpieza", 4], null, ["02/10/2026", "Reparar", 6]],
      [["Limpieza", "C2"], ["Reparar", "C4"]]
    ));
    expect(lectura.renglones.map((r) => r.tarea)).toEqual(["Limpieza", "Reparar"]);
    expect(lectura.renglones.map((r) => r.fila)).toEqual([2, 4]);
    expect(lectura.problemas).toEqual([]);
  });

  it("la tarea se recorta y nada más", () => {
    // «Colocar bomba gasolera en cantera » trae un espacio al final en el archivo real.
    const { renglones } = leer(libro([["06/10/2026", "Colocar bomba gasolera en cantera ", 8]], []));
    expect(renglones[0].tarea).toBe("Colocar bomba gasolera en cantera");
  });

  it("un precio sin horas es una orden por trabajo, no un dudoso", () => {
    const { renglones } = leer(libro([["22/09/2026", "1 Empalme cinta 5 P/Trit N°1", null, 920000]], []));
    expect(renglones[0]).toMatchObject({ horas: null, costo: 920000, dudoso: false });
  });

  it("un precio escrito como texto se lee con la regla del dinero: el punto es de miles", () => {
    // Mandado crudo a Number(), «920.000» daría 920 sin avisar.
    const { renglones } = leer(libro([["22/09/2026", "Empalme", null, "$ 920.000"]], []));
    expect(renglones[0].costo).toBe(920000);
  });

  it("las horas escritas como texto se leen con la regla de las horas: la coma es decimal", () => {
    const { renglones } = leer(libro([["22/09/2026", "Tensar", "2,5"]], []));
    expect(renglones[0].horas).toBe(2.5);
    expect(renglones[0].dudoso).toBe(false);
  });

  it("unas horas que no son un número no se adivinan: entra dudoso, con lo que decía", () => {
    const { renglones, problemas } = leer(libro([["22/09/2026", "Tensar", "8 Hs"]], []));
    expect(renglones).toHaveLength(1);
    expect(renglones[0].horas).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toContain("8 Hs");
    // Y no es un problema del archivo: el renglón ya lo lleva.
    expect(problemas.join(" ")).not.toContain("8 Hs");
  });

  it("más horas que el tope por renglón entra dudoso, con el número intacto", () => {
    const { renglones } = leer(libro([["22/09/2026", "Tensar", TOPE_DE_HORAS_POR_RENGLON + 1]], []));
    expect(renglones[0].horas).toBe(TOPE_DE_HORAS_POR_RENGLON + 1);
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toContain(String(TOPE_DE_HORAS_POR_RENGLON));
  });

  it("justo en el tope no es dudoso", () => {
    const { renglones } = leer(libro([["22/09/2026", "Tensar", TOPE_DE_HORAS_POR_RENGLON]], []));
    expect(renglones[0].dudoso).toBe(false);
  });

  it("un renglón sin horas ni precio entra dudoso", () => {
    const { renglones } = leer(libro([["22/09/2026", "Algo que se hizo", null]], []));
    expect(renglones).toHaveLength(1);
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toMatch(/horas ni precio/i);
  });

  it("un número negativo no se toma y el renglón entra dudoso", () => {
    const { renglones } = leer(libro([["22/09/2026", "Tensar", -4]], []));
    expect(renglones[0].horas).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toContain("-4");
  });

  it("una fila con horas pero sin tarea no se carga, y se dice con su número de fila", () => {
    const filas = libro([["01/10/2026", "Limpieza", 4], ["02/10/2026", null, 6]], []);
    const lectura = leer(filas);
    expect(lectura.renglones).toHaveLength(1);
    expect(lectura.problemas.join(" ")).toContain("fila 3");
  });

  it("una fórmula en las horas se lee por su valor calculado", () => {
    const { renglones } = leer(libro([["01/10/2026", "Limpieza", { formula: "2+2", resultado: 4 }]], []));
    expect(renglones[0].horas).toBe(4);
    expect(renglones[0].dudoso).toBe(false);
  });

  it("una fórmula sin valor calculado entra dudosa: el archivo no se guardó con Excel", () => {
    const { renglones } = leer(libro([["01/10/2026", "Limpieza", { formula: "2+2" }]], []));
    expect(renglones[0].horas).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toMatch(/f[oó]rmula/i);
  });

  it("un error de celda en las horas entra dudoso y dice cuál", () => {
    const { renglones } = leer(libro([["01/10/2026", "Limpieza", { error: "#REF!" }]], []));
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toContain("#REF!");
  });

  it("una fila que parece un total en medio del detalle se saltea y se dice, porque no es un renglón", () => {
    const filas = libro(
      [
        ["01/10/2026", "Limpieza", 4],
        ["Subtotal", "Total semana", { formula: "SUM(C2:C2)", resultado: 4 }],
        ["02/10/2026", "Reparar", 6],
      ],
      []
    );
    const lectura = leer(filas);
    expect(lectura.renglones.map((r) => r.tarea)).toEqual(["Limpieza", "Reparar"]);
    expect(lectura.problemas.join(" ")).toContain("fila 3");
  });
});

// ─── Las fechas ──────────────────────────────────────────────────────────────

describe("las fechas", () => {
  const fechaDe = (celda: CeldaDelExcel) => leer(libro([[celda, "Tarea", 1]], []));

  it("un Date de Excel se lee por su día UTC, sin correrse por el huso", () => {
    // exceljs devuelve las fechas como Date a medianoche UTC.
    expect(fechaDe(new Date(Date.UTC(2026, 9, 1))).renglones[0].fecha).toBe("2026-10-01");
  });

  it("el texto es día/mes/año, nunca mes/día", () => {
    // Leerlo al revés dio vuelta 885 fechas en Compras.
    expect(fechaDe("03/04/2026").renglones[0].fecha).toBe("2026-04-03");
    expect(fechaDe("01/10/2026").renglones[0].fecha).toBe("2026-10-01");
    expect(fechaDe("1/10/2026").renglones[0].fecha).toBe("2026-10-01");
  });

  it("entiende el año de dos dígitos y el ISO", () => {
    expect(fechaDe("21-09-26").renglones[0].fecha).toBe("2026-09-21");
    expect(fechaDe("2026-10-01").renglones[0].fecha).toBe("2026-10-01");
  });

  it("un número de serie de Excel es una fecha", () => {
    const serial = Date.UTC(2026, 9, 1) / 86400000 + 25569;
    expect(fechaDe(serial).renglones[0].fecha).toBe("2026-10-01");
  });

  it("un día que no existe entra con la fecha en null, dudoso, y con lo que decía", () => {
    const { renglones } = fechaDe("31/02/2026");
    expect(renglones).toHaveLength(1);
    expect(renglones[0].fecha).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toContain("31/02/2026");
  });

  it("un mes 25 tampoco: no se da vuelta para que entre", () => {
    expect(fechaDe("13/25/2026").renglones[0].fecha).toBeNull();
  });

  it("sin fecha entra con la fecha en null y dudoso", () => {
    const { renglones } = fechaDe(null);
    expect(renglones[0].fecha).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toMatch(/fecha/i);
  });

  it("una hora suelta (año 1899) no es una fecha", () => {
    expect(fechaDe(new Date(Date.UTC(1899, 11, 30, 8, 0))).renglones[0].fecha).toBeNull();
  });

  it("un texto que no es una fecha entra dudoso y no se pierde", () => {
    const { renglones } = fechaDe("la semana pasada");
    expect(renglones[0].fecha).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toContain("la semana pasada");
  });
});

// ─── El resumen ──────────────────────────────────────────────────────────────

describe("los grupos del resumen", () => {
  it("cada fila del resumen es un grupo con las filas del detalle que su fórmula nombra", () => {
    const { grupos } = leer(libro(DETALLE, RESUMEN));
    expect(grupos).toHaveLength(4);
    expect(grupos[0]).toEqual({ fila: 2, tarea: "Grilla p/ TRT Nº2", filas: [4, 6] });
    expect(grupos[1].filas).toEqual([2]);
  });

  it("un rango SUM(C4:C6) junta las filas de en medio", () => {
    const { grupos } = leer(libro(DETALLE, [
      ["Grilla y limpieza", { formula: "SUM(C4:C6)", resultado: 60 }],
      ["Limpieza techo", { formula: "C2+C3", resultado: 16 }],
    ]));
    expect(grupos[0].filas).toEqual([4, 5, 6]);
  });

  it("SUM con comas y referencias absolutas", () => {
    const { grupos } = leer(libro(DETALLE, [
      ["Uno", { formula: "SUM(C4,C6)", resultado: 40 }],
      ["Dos", { formula: "$C$2+$C$3", resultado: 16 }],
      ["Tres", "C5"],
    ]));
    expect(grupos[0].filas).toEqual([4, 6]);
    expect(grupos[1].filas).toEqual([2, 3]);
  });

  it("la fila de TOTALES no es un grupo", () => {
    const lectura = leer(libro(DETALLE, RESUMEN));
    expect(lectura.grupos.map((g) => g.tarea)).not.toContain("TOTALES");
    expect(lectura.control.grupos_leidos).toBe(4);
  });

  it("un total sin la palabra TOTALES se reconoce por su fórmula SUM sin referencias C", () => {
    const filas = libro(DETALLE, [...RESUMEN, ["", { formula: "SUM(N2:N5)", resultado: 76 }]], { totales: false });
    const lectura = leer(filas);
    expect(lectura.grupos).toHaveLength(4);
    expect(lectura.control.cierra).toBe(true);
  });

  it("una fila en blanco en medio del resumen se saltea", () => {
    // Como la fila 60 del archivo real: el resumen tiene un hueco.
    const lectura = leer(libro(DETALLE, [RESUMEN[0], RESUMEN[1], null, RESUMEN[2], RESUMEN[3]]));
    expect(lectura.grupos).toHaveLength(4);
    expect(lectura.control.cierra).toBe(true);
  });
});

// ─── El control ──────────────────────────────────────────────────────────────

describe("el control: las horas del resumen tienen que dar las del detalle", () => {
  it("cuando cierra, se arman los grupos y la cuenta lo dice", () => {
    const lectura = leer(libro(DETALLE, RESUMEN));
    expect(lectura.control).toMatchObject({
      hay_resumen: true, cierra: true, horas_detalle: 76, horas_resumen: 76, diferencia: 0, grupos_leidos: 4,
    });
    expect(lectura.grupos).toHaveLength(4);
    expect(lectura.problemas).toEqual([]);
  });

  it("un renglón en dos grupos: no cierra, no hay grupos y se dice cuál y en qué filas del resumen", () => {
    const lectura = leer(libro(DETALLE, [
      ["Grilla", "C4+C6"],
      ["Otra vez la grilla", "C4"],                // la fila 4 del detalle, contada dos veces
      ["Limpieza techo", "C2+C3"],
      ["Limpieza planta", "C5"],
    ]));
    expect(lectura.control.cierra).toBe(false);
    expect(lectura.grupos).toEqual([]);
    const dicho = lectura.problemas.join("\n");
    expect(dicho).toContain("fila 4 del detalle");
    expect(dicho).toContain("Trabajo en grilla p/ TRT Nº2");
    expect(dicho).toMatch(/dos grupos/);
    expect(dicho).toMatch(/filas 2 y 3 del resumen/);
    // Los renglones entran igual: el control sólo frena los grupos.
    expect(lectura.renglones).toHaveLength(5);
  });

  it("un renglón contado dos veces en la misma fórmula se dice distinto: es una sola fila del resumen", () => {
    const lectura = leer(libro(DETALLE, [
      ["Grilla", "C4+C4+C6"],
      ["Limpieza techo", "C2+C3"],
      ["Limpieza planta", "C5"],
    ]));
    expect(lectura.control.cierra).toBe(false);
    const dicho = lectura.problemas.join("\n");
    expect(dicho).toContain("N2");
    expect(dicho).toMatch(/dos veces/);
    expect(dicho).toContain("fila 4");
  });

  it("un renglón que ningún grupo toma: no cierra y se dice cuál quedó sin cubrir", () => {
    const lectura = leer(libro(DETALLE, [
      ["Grilla", "C4+C6"],
      ["Limpieza techo", "C2+C3"],
      // falta la fila 5
    ]));
    expect(lectura.control.cierra).toBe(false);
    expect(lectura.grupos).toEqual([]);
    expect(lectura.control.diferencia).toBe(-20);
    const dicho = lectura.problemas.join("\n");
    expect(dicho).toContain("fila 5 del detalle");
    expect(dicho).toContain("Limpieza planta TRT Nº2");
    expect(dicho).toContain("20 h");
    expect(dicho).toMatch(/no está en ningún grupo/);
    expect(dicho).toMatch(/faltan 20 h/);
  });

  it("una fórmula que apunta a una celda vacía: no cierra y se dice cuál fórmula y a qué celda", () => {
    const lectura = leer(libro(DETALLE, [
      ["Grilla", "C4+C6"],
      ["Limpieza techo", "C2+C3+C40"],
      ["Limpieza planta", "C5"],
    ]));
    expect(lectura.control.cierra).toBe(false);
    const dicho = lectura.problemas.join("\n");
    expect(dicho).toContain("N3");
    expect(dicho).toContain("C40");
    expect(dicho).toMatch(/vac[ií]a/);
  });

  it("apuntar al encabezado o al total tampoco vale, y lo dice", () => {
    const lectura = leer(libro(DETALLE, [
      ["Grilla", "C4+C6"],
      ["Limpieza techo", "C2+C3+C1"],
      ["Limpieza planta", "C5+C8"],                // la 8 es la fila de TOTALES
    ]));
    const dicho = lectura.problemas.join("\n");
    expect(dicho).toContain("C1");
    expect(dicho).toMatch(/encabezado/);
    expect(dicho).toContain("C8");
    expect(dicho).toMatch(/total/i);
  });

  it("un renglón sólo con precio, al que apunta una fórmula de horas, no es una celda vacía", () => {
    // Una plantilla que escribe `=C7` para el empalme aunque sus horas estén en
    // blanco no se está equivocando: el renglón existe y trae su precio.
    const detalle: Detalle[] = [...DETALLE, ["22/10/2026", "Empalme cinta 5", null, 920000]];
    const lectura = leer(libro(detalle, [...RESUMEN, ["Empalme cinta 5", "C7"]]));
    expect(lectura.control.cierra).toBe(true);
  });

  it("apuntar a un renglón que no trae ni horas ni precio es apuntar a una celda vacía", () => {
    const detalle: Detalle[] = [...DETALLE, ["22/10/2026", "Algo sin números", null]];
    const lectura = leer(libro(detalle, [...RESUMEN, ["Algo", "C7"]]));
    expect(lectura.control.cierra).toBe(false);
    expect(lectura.problemas.join("\n")).toContain("C7");
  });

  it("un renglón sólo con precio que ningún grupo toma no es un error: sale como su propia orden", () => {
    const detalle: Detalle[] = [...DETALLE, ["22/10/2026", "Empalme cinta 5", null, 920000]];
    const lectura = leer(libro(detalle, RESUMEN));
    expect(lectura.control.cierra).toBe(true);
    expect(lectura.grupos.flatMap((g) => g.filas)).not.toContain(7);
    expect(lectura.renglones).toHaveLength(6);
  });

  it("la celda de horas dice un número y sus referencias suman otro: no cierra", () => {
    // Una fórmula con un término de más (`=C4+C6+2`), o un valor viejo que Excel no recalculó.
    const lectura = leer(libro(DETALLE, [
      ["Grilla", { formula: "C4+C6", resultado: 42 }],
      ["Limpieza techo", "C2+C3"],
      ["Limpieza planta", "C5"],
    ]));
    expect(lectura.control.cierra).toBe(false);
    const dicho = lectura.problemas.join("\n");
    expect(dicho).toContain("N2");
    expect(dicho).toContain("42");
    expect(dicho).toContain("40");
  });

  it("una fórmula sin valor calculado no se compara: las referencias mandan", () => {
    const lectura = leer(libro(DETALLE, [
      ["Grilla", { formula: "C4+C6" }],
      ["Limpieza techo", "C2+C3"],
      ["Limpieza planta", "C5"],
    ]));
    expect(lectura.control.cierra).toBe(true);
  });

  it("una fila del resumen sin fórmula no dice qué renglones junta: no cierra", () => {
    const lectura = leer(libro(DETALLE, [
      ["Grilla", 40],                                // escrito a mano
      ["Limpieza techo", "C2+C3"],
      ["Limpieza planta", "C5"],
    ]));
    expect(lectura.control.cierra).toBe(false);
    const dicho = lectura.problemas.join("\n");
    expect(dicho).toContain("N2");
    expect(dicho).toMatch(/no se sabe qu[eé] renglones junta/);
  });

  it("una fila del resumen con la celda de horas en blanco tampoco", () => {
    const lectura = leer(libro(DETALLE, [
      ["Grilla", null as unknown as string],
      ["Limpieza techo", "C2+C3"],
      ["Limpieza planta", "C5+C4+C6"],
    ]));
    expect(lectura.control.cierra).toBe(false);
    expect(lectura.problemas.join("\n")).toContain("fila 2 del resumen");
  });

  it("una referencia a otra columna no es una celda de horas", () => {
    const lectura = leer(libro(DETALLE, [
      ["Grilla", "C4+D6"],
      ["Limpieza techo", "C2+C3"],
      ["Limpieza planta", "C5"],
    ]));
    expect(lectura.control.cierra).toBe(false);
    const dicho = lectura.problemas.join("\n");
    expect(dicho).toContain("D6");
    expect(dicho).toMatch(/columna de horas/);
  });

  it("una referencia a otra hoja no se puede leer, y no se supone que es de ésta", () => {
    const lectura = leer(libro(DETALLE, [
      ["Grilla", "C4+Hoja2!C6"],
      ["Limpieza techo", "C2+C3"],
      ["Limpieza planta", "C5"],
    ]));
    expect(lectura.control.cierra).toBe(false);
    expect(lectura.problemas.join("\n")).toMatch(/otra hoja/);
  });

  it("informa todos los problemas juntos y no de a uno", () => {
    const lectura = leer(libro(DETALLE, [
      ["Grilla", "C4+C6"],
      ["Otra vez", "C4"],                            // duplicado
      ["Limpieza techo", "C2+C3+C40"],               // celda vacía
      // la 5 sin cubrir
    ]));
    const dicho = lectura.problemas.join("\n");
    expect(dicho).toMatch(/dos grupos/);
    expect(dicho).toContain("C40");
    expect(dicho).toContain("fila 5 del detalle");
  });

  it("cuando no cierra, lo primero que se dice es que no se armaron los grupos", () => {
    const lectura = leer(libro(DETALLE, [["Grilla", "C4+C6"]]));
    expect(lectura.problemas[0]).toMatch(/no se armaron los grupos/i);
  });

  it("un archivo sin resumen se carga: cada renglón es su orden, y se avisa", () => {
    const filas = libro(DETALLE, []).map((f) => {
      const celdas = { ...f.celdas };
      for (const c of ["K", "L", "M", "N", "O"]) delete celdas[c];
      return { ...f, celdas };
    });
    filas[0] = fila(1, { A: "Fecha", B: "Tarea / Descripción", C: "Horas", D: "Precio ($)" });
    const lectura = leer(filas);
    expect(lectura.control.hay_resumen).toBe(false);
    expect(lectura.control.cierra).toBe(false);
    expect(lectura.grupos).toEqual([]);
    expect(lectura.renglones).toHaveLength(5);
    expect(lectura.problemas.join(" ")).toMatch(/resumen/i);
  });

  it("las horas fraccionarias no rompen la cuenta por redondeo", () => {
    const detalle: Detalle[] = [["01/10/2026", "A", 0.1], ["01/10/2026", "B", 0.2]];
    const lectura = leer(libro(detalle, [["Juntas", "C2+C3"]]));
    // 0,1 + 0,2 da 0,30000000000000004 en coma flotante.
    expect(lectura.control.cierra).toBe(true);
    expect(lectura.control.diferencia).toBe(0);
  });
});

// ─── El encabezado ───────────────────────────────────────────────────────────

describe("el encabezado", () => {
  it("sin un encabezado Fecha / Tarea no se reconoce el archivo, y se dice qué había", () => {
    const lectura = interpretarExcel([fila(1, { A: "Día", B: "Qué se hizo", C: "Cuánto" }), fila(2, { A: "01/10/2026", B: "x", C: 1 })]);
    expect(lectura.ok).toBe(false);
    if (lectura.ok) return;
    expect(lectura.error).toContain("Fecha");
    expect(lectura.error).toContain("Día");
  });

  it("un archivo vacío no se reconoce", () => {
    expect(interpretarExcel([]).ok).toBe(false);
  });

  it("con un título arriba, el encabezado se busca en las primeras filas y las filas siguen siendo las del Excel", () => {
    const filas = [
      fila(1, { A: "Tareas de octubre" }),
      fila(2, {}),
      ENCABEZADO(3),
      fila(4, { A: "01/10/2026", B: "Limpieza", C: 4 }),
    ];
    const lectura = leer(filas);
    expect(lectura.renglones).toHaveLength(1);
    expect(lectura.renglones[0].fila).toBe(4);
  });

  it("un encabezado más abajo que las primeras diez filas no cuenta", () => {
    const relleno = Array.from({ length: 10 }, (_, i) => fila(i + 1, { A: `texto ${i}` }));
    expect(interpretarExcel([...relleno, ENCABEZADO(11)]).ok).toBe(false);
  });

  it("si el resumen tiene otro encabezado en K, no se lee y se dice qué decía", () => {
    const filas = libro(DETALLE, RESUMEN);
    filas[0] = fila(1, { ...filas[0].celdas, K: "Notas" });
    const lectura = leer(filas);
    expect(lectura.control.hay_resumen).toBe(false);
    expect(lectura.problemas.join(" ")).toContain("Notas");
    expect(lectura.renglones).toHaveLength(5);
  });
});

// ─── Lo que se junta de verdad ───────────────────────────────────────────────

describe("gruposAJuntar", () => {
  it("un grupo de un solo renglón es la orden del renglón, no un grupo", () => {
    const { grupos } = leer(libro(DETALLE, RESUMEN));
    // De los cuatro grupos, sólo «Grilla» junta dos renglones.
    expect(gruposAJuntar(grupos).map((g) => g.filas)).toEqual([[4, 6]]);
  });

  it("sin grupos no hay nada que juntar", () => {
    expect(gruposAJuntar([])).toEqual([]);
  });
});

describe("esRutaDeExcel", () => {
  it("se distingue por la extensión de la ruta, en mayúsculas o minúsculas", () => {
    expect(esRutaDeExcel("5f3c/1.xlsx")).toBe(true);
    expect(esRutaDeExcel("5f3c/1.XLSX")).toBe(true);
    expect(esRutaDeExcel("5f3c/1.jpg")).toBe(false);
    expect(esRutaDeExcel("5f3c/1.xlsx.jpg")).toBe(false);
    expect(esRutaDeExcel("")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  diagnosticarPestana, filasConDatos, generaUnaRegion, esCeldaEnError, celda,
} from "./saludDePlanilla";

const COMPRAS = "1hnfYHaWBprT9UGOETSoQ9GQCl3B1ZezPr5FPbCrUO80";
const rompe = (s: ReturnType<typeof diagnosticarPestana>) => s.filter((x) => x.nivel === "ROMPE");
const mirar = (s: ReturnType<typeof diagnosticarPestana>) => s.filter((x) => x.nivel === "MIRAR");

// ── Las dos caídas reales, tal como las devolvió la API ──────────────

describe("la caida de Compras del 19/10/2026", () => {
  // `Requerimientos internos` ese dia: el QUERY que genera las 2.160 filas
  // devolvio #VALUE! y la pestana quedo con una sola fila, la del error.
  const valores = [
    ["N° RI", "FECHA", "ÁREA", "DESCRIPCIÓN", "CODIGO", "CAN", "DONDE SE NECESITA", "EQUIPO", "FECHA DE REQUERIMIENTO"],
    ["#VALUE!", "", "", "", "", "", "", "Cargando...", "#VALUE!"],
  ];
  const formulas = [
    ["N° RI", "FECHA", "ÁREA", "DESCRIPCIÓN", "CODIGO", "CAN", "DONDE SE NECESITA", "EQUIPO", "FECHA DE REQUERIMIENTO"],
    ['=QUERY({IMPORTRANGE("…1T551q…";"A4:L10000")};"SELECT Col1,Col2";0)', "", "", "", "", "", "",
     '=BYROW(IMPORTRANGE("1T551q…";"O4:AD3000");LAMBDA(f;TEXTJOIN("";TRUE;f)))',
     '=QUERY({IMPORTRANGE("…1T551q…";"A4:L10000")};"SELECT Col10";0)'],
  ];

  it("la detecta", () => {
    expect(rompe(diagnosticarPestana(valores, formulas, COMPRAS))).not.toHaveLength(0);
  });

  it("dice las dos cosas: que esta calculando y que se vacio", () => {
    const motivos = rompe(diagnosticarPestana(valores, formulas, COMPRAS)).map((s) => s.que);
    expect(motivos.some((m) => m.includes("Cargando"))).toBe(true);
    expect(motivos.some((m) => m.includes("se vació"))).toBe(true);
  });

  it("nombra la celda, porque sin eso no se puede ir a arreglarla", () => {
    const vacio = rompe(diagnosticarPestana(valores, formulas, COMPRAS)).find((s) => s.que.includes("se vació"));
    expect(vacio!.donde).toContain("A2");
  });
});

describe("la caida de OT del 13/10/2026", () => {
  // La planilla estaba recalculando: devolvio dos filas de 623. Esa vez la
  // cuenta de "la primera fila libre" dio 3 y una OT nueva piso a la 623.
  const valores = [
    ["N° OT", "FECHA", "SECTOR"],
    ["Cargando...", "", ""],
  ];
  it("la detecta aunque ninguna formula este en error", () => {
    const s = diagnosticarPestana(valores, [["N° OT"], ["=QUERY(A:A)"]], "otro-libro");
    expect(rompe(s).map((x) => x.que).join()).toContain("Cargando");
  });
});

// ── Y el ruido que NO tiene que sonar ────────────────────────────────

describe("lo que no es una caida", () => {
  it("un VLOOKUP sin su clave en una pestana llena es ruido, no una caida", () => {
    // Medido: 2.420 de estos en APROB COMPRAS y 1.659 en el seguimiento, de
    // hace meses. Si sonaran, el informe saldria rojo siempre y nadie lo abre.
    const valores = [["N° RI", "ÁREA", "DESCRIPCIÓN"]];
    const formulas = [["N° RI", "ÁREA", "DESCRIPCIÓN"]];
    for (let i = 1; i <= 50; i++) {
      valores.push([`${i}`, "Almacén", i === 30 ? "#N/A" : "Electrodo"]);
      formulas.push([`${i}`, "Almacén", "=VLOOKUP(A31;'Requerimientos internos'!A:D;4;FALSE)"]);
    }
    expect(rompe(diagnosticarPestana(valores, formulas, COMPRAS))).toHaveLength(0);
    expect(mirar(diagnosticarPestana(valores, formulas, COMPRAS))).toHaveLength(1);
  });

  it("un QUERY roto en una pestana que SIGUE llena tampoco lo es", () => {
    // AVISOS!G2 el 19/10/2026: un QUERY por fila que falla en la fila 2 porque
    // esa fila esta vacia. De la 3 para abajo hay 600 avisos. La pestana no se
    // cayo: se cayo una celda.
    const valores = [["N° OA", "FECHA", "QUIÉN"], ["A1", "", "#REF!"]];
    const formulas = [["N° OA", "FECHA", "QUIÉN"], ["A1", "", '=QUERY(IMPORTRANGE("otro";"A2:V"))']];
    for (let i = 2; i <= 40; i++) {
      valores.push([`A${i}`, "13/1/2026", "Francisco"]);
      formulas.push([`A${i}`, "13/1/2026", '=QUERY(IMPORTRANGE("otro";"A2:V"))']);
    }
    expect(rompe(diagnosticarPestana(valores, formulas, COMPRAS))).toHaveLength(0);
  });

  it("una pestana diminuta y sana no se confunde con una vaciada", () => {
    // RI INVERSIONES tiene DOS requerimientos en total. Por tamano es
    // indistinguible de una caida, y por eso el tamano nunca decide solo.
    const valores = [["N° RI", "FECHA"], ["1887", "26/8/2026"], ["1902", "1/9/2026"]];
    const formulas = [["N° RI", "FECHA"], ["=FILTER('Requerimientos internos'!A2:M;…)", ""], ["", ""]];
    expect(rompe(diagnosticarPestana(valores, formulas, COMPRAS))).toHaveLength(0);
  });

  it("una pestana diminuta con un VLOOKUP roto tampoco es una caida", () => {
    // Las dos condiciones tienen que ir juntas, y esta es la que lo prueba:
    // aca la pestana SI esta casi vacia, pero lo roto es un VLOOKUP, que
    // genera una celda. Que falte el proveedor de un requerimiento no vacia
    // nada. Sin esta prueba, "la formula tiene que generar una region" se
    // puede borrar del codigo y la suite sigue en verde.
    const valores = [["N° RI", "FECHA", "PROVEEDOR"], ["1887", "26/8/2026", "#N/A"]];
    const formulas = [["N° RI", "FECHA", "PROVEEDOR"],
      ["1887", "26/8/2026", "=VLOOKUP(A2;'Requerimientos internos'!A:D;4;FALSE)"]];
    expect(rompe(diagnosticarPestana(valores, formulas, COMPRAS))).toHaveLength(0);
    expect(mirar(diagnosticarPestana(valores, formulas, COMPRAS))[0].que).toContain("sueltas");
  });

  it("una pestana sana no dice nada de nada", () => {
    const valores = [["N° RI", "FECHA"], ["1", "19/8/2025"], ["2", "22/8/2025"], ["3", "1/9/2025"]];
    const formulas = [["N° RI", "FECHA"], ["=QUERY(IMPORTRANGE(\"otro\";\"A:L\"))", ""], ["", ""], ["", ""]];
    expect(diagnosticarPestana(valores, formulas, COMPRAS)).toEqual([]);
  });
});

// ── El libro que se importa a si mismo ───────────────────────────────

describe("el libro que se importa a si mismo", () => {
  const sano = [["N° OT", "FECHA"], ["622", "1/12/2025"], ["623", "4/12/2025"], ["624", "6/12/2025"]];

  it("se avisa aunque hoy resuelva, porque es el lazo que tiro Compras", () => {
    // La planilla de Mantenimiento lo tiene y HOY anda: importa la hoja de
    // respuestas, que la escribe Google Forms y no depende de otra formula.
    // Anda hasta que esa hoja pase a salir de una formula; ahi el lazo se
    // cierra y no resuelve nunca mas. Por eso es MIRAR y no ROMPE.
    const formulas = [["N° OT", "FECHA"],
      ['=QUERY(IMPORTRANGE("https://…/d/1BBudb…/edit";"Respuestas de formulario!A2:AA"))', ""],
      ["", ""], ["", ""]];
    const s = diagnosticarPestana(sano, formulas, "1BBudb");
    expect(rompe(s)).toHaveLength(0);
    expect(mirar(s)[0].que).toContain("PROPIO libro");
    expect(mirar(s)[0].donde).toBe("A2");
  });

  it("importar OTRO libro es normal y no se avisa", () => {
    const formulas = [["N° OT", "FECHA"], ['=QUERY(IMPORTRANGE("1T551q";"A:L"))', ""], ["", ""], ["", ""]];
    expect(diagnosticarPestana(sano, formulas, "1BBudb")).toEqual([]);
  });
});

// ── Las piezas ───────────────────────────────────────────────────────

describe("las piezas", () => {
  it("filasConDatos no cuenta el encabezado ni las filas de puro error", () => {
    expect(filasConDatos([["N° RI"], ["#VALUE!"], [""], ["1887"]])).toBe(1);
    expect(filasConDatos([["N° RI"]])).toBe(0);
    expect(filasConDatos([])).toBe(0);
  });

  it("generaUnaRegion separa lo que vacia una pestana de lo que no", () => {
    expect(generaUnaRegion('=QUERY(IMPORTRANGE("x";"y"))')).toBe(true);
    expect(generaUnaRegion("=FILTER(A2:M;B2:B=\"x\")")).toBe(true);
    expect(generaUnaRegion("=ArrayFormula(IF(J3:J=\"\";\"\";1))")).toBe(true);
    // Un VLOOKUP roto se lleva UNA celda. Si contara, sonarian los miles que
    // ya hay y el informe no se abriria nunca mas.
    expect(generaUnaRegion("=VLOOKUP(A3;'Requerimientos internos'!A:D;4;FALSE)")).toBe(false);
    expect(generaUnaRegion("=F15-E15")).toBe(false);
    expect(generaUnaRegion("1887")).toBe(false);
  });

  it("esCeldaEnError no se come un texto que habla de un error", () => {
    expect(esCeldaEnError("#N/A")).toBe(true);
    expect(esCeldaEnError("  #REF!  ")).toBe(true);
    expect(esCeldaEnError("Reparar #REF! del informe")).toBe(false);
    expect(esCeldaEnError("")).toBe(false);
  });

  it("celda traduce a la notacion de la planilla, tambien pasada la Z", () => {
    expect(celda(1, 0)).toBe("A2");
    expect(celda(0, 7)).toBe("H1");
    expect(celda(1, 25)).toBe("Z2");
    expect(celda(1, 26)).toBe("AA2");
    expect(celda(1, 29)).toBe("AD2");
  });
});

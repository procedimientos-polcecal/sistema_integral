import { describe, expect, it } from "vitest";
import { enOrdenes, type RenglonDelCuaderno } from "./cuadernoGrupos";
import {
  VALORES_DE_PIPARO, descripcionDeLaOrden, equipoParaLaPlanilla, valoresDeLaOrden,
  posiblesDuplicados, avisoDeDuplicados, rangoDelFreno,
} from "./cuadernoOrden";

const SECTOR = { nombre: "Planta de trituración 3", codigo: "PO-A3" };
const CINTA = { name: "Cinta transportadora 9", code: "PO-A1-15" };

function renglon(id: string, extra: Partial<RenglonDelCuaderno> = {}): RenglonDelCuaderno {
  return {
    id, cuaderno_id: "c1", linea: 1, fecha: "2026-09-17", tarea: "Reparar rodillos",
    lugar_raw: "P/Trit N°3", sector_id: "s1", sector_propuesto: false, equipo_id: null,
    horas: 8, costo: null, grupo_id: null, orden_trabajo_id: null,
    ...extra,
  };
}

const unGrupo = (rs: RenglonDelCuaderno[]) => enOrdenes(rs)[0];

describe("los valores de la OT de PIPARO", () => {
  it("son los medidos en sus 380 OT, y no los del otro contratista", () => {
    expect(VALORES_DE_PIPARO).toEqual({
      especialidad: "MECÁNICO", tipo: "PROGRAMADO", quien: "CONTRATADO", estado: "REALIZADO",
    });
    // Candia es CIVIL: copiar su default pondría 282 órdenes en la especialidad equivocada.
    expect(VALORES_DE_PIPARO.especialidad).not.toBe("CIVIL");
  });
});

describe("equipoParaLaPlanilla", () => {
  it("con equipo: código y nombre, como los del formulario", () => {
    expect(equipoParaLaPlanilla(CINTA, SECTOR)).toBe("PO-A1-15 - Cinta transportadora 9");
  });
  it("sin equipo: el código del sector y «Edificio», como las que ya están", () => {
    expect(equipoParaLaPlanilla(null, SECTOR)).toBe("PO-A3 - Edificio");
    expect(equipoParaLaPlanilla(null, { nombre: "Taller", codigo: null })).toBe("Edificio");
    expect(equipoParaLaPlanilla(null, null)).toBe("Edificio");
  });
});

describe("descripcionDeLaOrden", () => {
  it("un renglón: la tarea, el día, las horas y lo que escribió PIPARO", () => {
    const d = descripcionDeLaOrden(unGrupo([renglon("a")]), "PIPARO");
    expect(d).toContain("Reparar rodillos — PIPARO.");
    expect(d).toContain("El 17/9.");
    expect(d).toContain("8 h en total.");
    expect(d).toContain("P/Trit N°3");
  });

  it("un grupo: el rango de fechas y cada tarea con su día", () => {
    const g = unGrupo([
      renglon("a", { grupo_id: "g", fecha: "2026-09-17", horas: 6, tarea: "Tranqueras D6" }),
      renglon("b", { grupo_id: "g", fecha: "2026-09-23", horas: 2.5, tarea: "Tranqueras D6" }),
    ]);
    const d = descripcionDeLaOrden(g, "PIPARO");
    expect(d).toContain("Del 17/9 al 23/9.");
    expect(d).toContain("8,5 h en total.");
    expect(d).toContain("(17/9, 6 h)");
    expect(d).toContain("(23/9, 2,5 h)");
  });

  it("sin horas no escribe «0 h»: un renglón con precio se cobra por trabajo", () => {
    const g = unGrupo([renglon("a", { horas: null, costo: 240000 })]);
    expect(descripcionDeLaOrden(g, "PIPARO")).not.toMatch(/\b0 h\b|en total/);
  });
});

describe("valoresDeLaOrden — lo único que escribe la generación", () => {
  const ctx = { sector: SECTOR, equipo: null, contratista: "PIPARO" };

  it("fecha y cierre son el último día del grupo", () => {
    const g = unGrupo([
      renglon("a", { grupo_id: "g", fecha: "2026-09-17" }),
      renglon("b", { grupo_id: "g", fecha: "2026-09-23" }),
    ]);
    const v = valoresDeLaOrden(g, ctx);
    expect(v.fecha).toBe("2026-09-23");
    expect(v.fecha_cierre).toBe("2026-09-23");
  });

  it("horas y costo son los del grupo, y el costo va dentro del repuesto", () => {
    const g = unGrupo([
      renglon("a", { grupo_id: "g", horas: null, costo: 240000 }),
      renglon("b", { grupo_id: "g", horas: null, costo: 680000, fecha: "2026-09-18" }),
    ]);
    const v = valoresDeLaOrden(g, ctx);
    expect(v.costo).toBe(920000);
    expect(v.repuesto).toBe("$920.000");
  });

  it("sin precio no hay repuesto", () => {
    const v = valoresDeLaOrden(unGrupo([renglon("a")]), ctx);
    expect(v.costo).toBeNull();
    expect(v.repuesto).toBeNull();
  });

  it("un grupo sin equipo común no es un error: sale sin equipo", () => {
    const g = unGrupo([
      renglon("a", { grupo_id: "g", equipo_id: "e1" }),
      renglon("b", { grupo_id: "g", equipo_id: "e2", fecha: "2026-09-18" }),
    ]);
    const v = valoresDeLaOrden(g, ctx);
    expect(v.equipment_id).toBeNull();
    expect(v.equipo_raw).toBe("PO-A3 - Edificio");
    expect(v.equipo_code).toBeNull();
  });

  it("con un equipo común lo lleva, con su código", () => {
    const g = unGrupo([renglon("a", { equipo_id: "e1" })]);
    const v = valoresDeLaOrden(g, { ...ctx, equipo: CINTA });
    expect(v.equipment_id).toBe("e1");
    expect(v.equipo_raw).toBe("PO-A1-15 - Cinta transportadora 9");
    expect(v.equipo_code).toBe("PO-A1-15");
  });

  it("especialidad, tipo, quien y estado son los de PIPARO", () => {
    const v = valoresDeLaOrden(unGrupo([renglon("a")]), ctx);
    expect(v).toMatchObject(VALORES_DE_PIPARO);
  });

  it("si la orden ya tenía el costo anterior en el texto, el repuesto nuevo no lo repite", () => {
    const g = unGrupo([renglon("a", { horas: null, costo: 240000, orden_trabajo_id: "ot1" }),
                       renglon("b", { horas: null, costo: 500000, fecha: "2026-09-20", grupo_id: null })]);
    // Grupo armado a mano para simular el segundo camino (sumar): el costo
    // anterior y su repuesto vienen de la OT que ya existe.
    const v = valoresDeLaOrden(
      { ...g, costo: 740000 },
      ctx,
      { costo: 240000, repuesto: "Empalme ($240.000)" }
    );
    expect(v.repuesto).toBe("Empalme ($740.000)");
  });
});

/**
 * El freno de los duplicados. Septiembre de 2026 ya tiene 29 OT de PIPARO
 * cargadas a mano, todas del 01/09: generar ese cuaderno las duplica, y una OT
 * escrita en la planilla se borra a mano, fila por fila.
 */
describe("posiblesDuplicados", () => {
  const crear = (rs: RenglonDelCuaderno[]) => enOrdenes(rs).filter((g) => g.accion === "crear");
  const ot = (id: string, n: number, fecha: string) => ({ id, ot_number: n, fecha });

  it("una OT del proveedor en el período, sin enlazar a este cuaderno, es un posible duplicado", () => {
    const grupos = crear([renglon("a", { fecha: "2026-09-10" })]);
    const r = posiblesDuplicados(grupos, [ot("y", 2502, "2026-09-10")], new Set());
    expect(r.map((o) => o.ot_number)).toEqual([2502]);
  });

  /**
   * EL CASO REAL QUE MOTIVÓ EL FRENO. De las 29 OT manuales de septiembre de
   * 2026, 28 están fechadas el 01/09. Con el rango justo de los grupos, un
   * cuaderno cuyo primer renglón cae el 02/09 —o cuyos grupos más tempranos
   * quedaron para la segunda corrida por el tope— no la atrapaba, y duplicaba
   * exactamente lo que el freno existe para evitar.
   */
  it("una OT manual del 01/09 frena a un cuaderno que empieza el 02/09", () => {
    const grupos = crear([
      renglon("a", { fecha: "2026-09-02" }), renglon("b", { fecha: "2026-09-25", tarea: "Otra" }),
    ]);
    const r = posiblesDuplicados(grupos, [ot("x", 2501, "2026-09-01"), ot("y", 2502, "2026-09-24")], new Set());
    expect(r.map((o) => o.ot_number)).toEqual([2501, 2502]);
  });

  it("el período es el mes entero: llega al último día aunque los grupos terminen antes", () => {
    const grupos = crear([renglon("a", { fecha: "2026-09-10" })]);
    const r = posiblesDuplicados(grupos, [ot("x", 1, "2026-09-30"), ot("y", 2, "2026-10-01"), ot("z", 3, "2026-08-31")], new Set());
    expect(r.map((o) => o.ot_number)).toEqual([1]);
  });

  it("un cuaderno que cruza dos meses mira los dos enteros", () => {
    const grupos = crear([renglon("a", { fecha: "2026-08-28" }), renglon("b", { fecha: "2026-09-03", tarea: "Otra" })]);
    expect(rangoDelFreno(grupos)).toEqual({ desde: "2026-08-01", hasta: "2026-09-30" });
  });

  it("febrero de un año bisiesto termina el 29", () => {
    const grupos = crear([renglon("a", { fecha: "2028-02-10" })]);
    expect(rangoDelFreno(grupos)).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
  });

  it("sin grupos para crear no hay rango", () => {
    expect(rangoDelFreno([])).toBeNull();
  });

  it("los bordes del rango cuentan", () => {
    const grupos = crear([renglon("a", { fecha: "2026-09-01" }), renglon("b", { fecha: "2026-09-30", tarea: "Otra" })]);
    const r = posiblesDuplicados(grupos, [ot("x", 1, "2026-09-01"), ot("y", 2, "2026-09-30")], new Set());
    expect(r.map((o) => o.ot_number)).toEqual([1, 2]);
  });

  it("las que ya son de este cuaderno no cuentan: son lo que se generó antes", () => {
    const grupos = crear([renglon("a", { fecha: "2026-09-02" })]);
    const r = posiblesDuplicados(grupos, [ot("x", 2501, "2026-09-02"), ot("y", 2502, "2026-09-02")], new Set(["x"]));
    expect(r.map((o) => o.ot_number)).toEqual([2502]);
  });

  it("fuera del rango no hay nada que avisar", () => {
    const grupos = crear([renglon("a", { fecha: "2026-11-05" })]);
    expect(posiblesDuplicados(grupos, [ot("x", 1, "2026-09-01")], new Set())).toEqual([]);
  });

  it("sin grupos para crear no hay freno", () => {
    expect(posiblesDuplicados([], [ot("x", 1, "2026-09-01")], new Set())).toEqual([]);
  });

  it("las OT vienen ordenadas por número y sin repetirse", () => {
    const grupos = crear([renglon("a", { fecha: "2026-09-02" })]);
    const r = posiblesDuplicados(grupos, [ot("y", 9, "2026-09-02"), ot("x", 3, "2026-09-02"), ot("x", 3, "2026-09-02")], new Set());
    expect(r.map((o) => o.ot_number)).toEqual([3, 9]);
  });
});

describe("avisoDeDuplicados", () => {
  it("dice cuántas son, sus números y qué significa", () => {
    const m = avisoDeDuplicados("PIPARO", [
      { id: "x", ot_number: 2501, fecha: "2026-09-01" }, { id: "y", ot_number: 2502, fecha: "2026-09-01" },
    ]);
    expect(m).toContain("2 órdenes");
    expect(m).toContain("2501");
    expect(m).toContain("2502");
    expect(m).toContain("PIPARO");
    expect(m).toMatch(/ya se cargó|ya está cargado/);
    expect(m).toContain("duplica");
  });

  it("con una sola, en singular", () => {
    expect(avisoDeDuplicados("PIPARO", [{ id: "x", ot_number: 7, fecha: "2026-09-01" }])).toContain("1 orden ");
  });

  it("con muchas no imprime una lista interminable", () => {
    const ots = Array.from({ length: 29 }, (_, i) => ({ id: String(i), ot_number: 3000 + i, fecha: "2026-09-01" }));
    const m = avisoDeDuplicados("PIPARO", ots);
    expect(m).toContain("29 órdenes");
    expect(m).toContain("y 19 más");
  });
});

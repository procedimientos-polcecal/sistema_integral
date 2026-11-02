import { describe, expect, it } from "vitest";
import { enOrdenes, type RenglonDelCuaderno } from "./cuadernoGrupos";
import {
  VALORES_DE_PIPARO, descripcionDeLaOrden, equipoParaLaPlanilla, valoresDeLaOrden,
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

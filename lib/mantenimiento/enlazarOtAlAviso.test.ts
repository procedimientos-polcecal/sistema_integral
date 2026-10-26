import { describe, it, expect } from "vitest";
import {
  loQueImpideEnlazar, loQueHayQueMirarAntesDeEnlazar, comoSeLeeLaOT,
  avisoDeEnlazada, loQueImpideDesenlazar, sePuedeDesenlazar, avisoDeDesenlazada,
  type AvisoAEnlazar, type OTAEnlazar, type AvisoADesenlazar,
} from "./enlazarOtAlAviso";

const AVISO: AvisoAEnlazar = {
  oa_number: "1234",
  work_order_id: null,
  ot_asignada: null,
  equipment_id: "eq-1",
  equipo_raw: "HORNO 4",
};

const OT: OTAEnlazar = {
  id: "ot-id",
  ot_number: 2814,
  fecha: "2026-10-20",
  descripcion: "Cambio de cadena de transmisión",
  equipment_id: "eq-1",
  equipo_raw: "HORNO 4",
  sector_raw: "HIDRATACIÓN",
  especialidad: "MECÁNICA",
  estado: "PENDIENTE",
  avisos: [],
};

describe("loQueImpideEnlazar", () => {
  it("no impide nada cuando el aviso está pendiente", () => {
    expect(loQueImpideEnlazar(AVISO, OT)).toEqual([]);
  });

  it("impide si el aviso ya tiene una OT generada desde el sistema", () => {
    const impide = loQueImpideEnlazar({ ...AVISO, work_order_id: "otra", ot_asignada: "99" }, OT);
    expect(impide).toHaveLength(1);
    expect(impide[0]).toContain("99");
  });

  it("impide si el aviso ya tiene algo escrito en OT ASIGNADA, aunque no sea un número", () => {
    // La columna es texto libre: hay avisos con «Revision» y con «RI 1888».
    // Pisar eso es borrar lo que alguien escribió a mano en la planilla.
    const impide = loQueImpideEnlazar({ ...AVISO, ot_asignada: "RI 1888" }, OT);
    expect(impide).toHaveLength(1);
    expect(impide[0]).toContain("RI 1888");
  });

  it("deja enlazar un aviso desestimado: que el trabajo exista gana", () => {
    // Misma regla que `finalDelAviso`, que pone "con-ot" por encima de
    // "desestimado". No se puede llegar desde la pantalla, pero la ruta sí.
    expect(loQueImpideEnlazar({ ...AVISO, desestimado_en: "2026-10-21" }, OT)).toEqual([]);
  });
});

describe("loQueHayQueMirarAntesDeEnlazar", () => {
  it("no dice nada cuando la OT es del mismo equipo y no la tiene nadie", () => {
    expect(loQueHayQueMirarAntesDeEnlazar(AVISO, OT)).toEqual([]);
  });

  it("avisa cuando la OT es de otro equipo que el aviso", () => {
    const mirar = loQueHayQueMirarAntesDeEnlazar(AVISO, {
      ...OT, equipment_id: "eq-9", equipo_raw: "MOLINO 2",
    });
    expect(mirar).toHaveLength(1);
    expect(mirar[0]).toContain("MOLINO 2");
    expect(mirar[0]).toContain("HORNO 4");
  });

  it("no avisa por equipo distinto si alguno de los dos no está enlazado", () => {
    // Sin `equipment_id` de los dos lados no hay comparación que valga: el
    // texto libre de la planilla no dice si son la misma máquina.
    expect(loQueHayQueMirarAntesDeEnlazar(
      { ...AVISO, equipment_id: null }, OT
    )).toEqual([]);
    expect(loQueHayQueMirarAntesDeEnlazar(
      AVISO, { ...OT, equipment_id: null }
    )).toEqual([]);
  });

  it("avisa cuando esa OT ya es de otro aviso", () => {
    const mirar = loQueHayQueMirarAntesDeEnlazar(AVISO, {
      ...OT, avisos: [{ oa_number: "1200" }],
    });
    expect(mirar).toHaveLength(1);
    expect(mirar[0]).toContain("1200");
  });

  it("no se avisa a sí mismo cuando la OT ya es de este aviso", () => {
    expect(loQueHayQueMirarAntesDeEnlazar(AVISO, {
      ...OT, avisos: [{ oa_number: "1234" }],
    })).toEqual([]);
  });

  it("junta las dos advertencias cuando valen las dos", () => {
    expect(loQueHayQueMirarAntesDeEnlazar(AVISO, {
      ...OT, equipment_id: "eq-9", equipo_raw: "MOLINO 2", avisos: [{ oa_number: "1200" }],
    })).toHaveLength(2);
  });
});

describe("comoSeLeeLaOT", () => {
  it("devuelve lo que hace falta para reconocerla", () => {
    const renglones = comoSeLeeLaOT(OT);
    const etiquetas = renglones.map((r) => r.etiqueta);
    expect(etiquetas).toEqual(["Equipo", "Sector", "Qué dice", "Estado", "Especialidad", "Fecha"]);
    expect(renglones.find((r) => r.etiqueta === "Qué dice")?.valor)
      .toBe("Cambio de cadena de transmisión");
  });

  it("un campo vacío se lee como raya y no desaparece", () => {
    // Que el renglón falte haría parecer que la orden dice menos de lo que
    // dice; lo que se está mirando es si es la correcta.
    const renglones = comoSeLeeLaOT({ ...OT, descripcion: null, sector_raw: "  " });
    expect(renglones.find((r) => r.etiqueta === "Qué dice")?.valor).toBe("—");
    expect(renglones.find((r) => r.etiqueta === "Sector")?.valor).toBe("—");
  });
});

describe("avisoDeEnlazada", () => {
  it("dice qué aviso quedó con qué orden", () => {
    const texto = avisoDeEnlazada("1234", 2814, null);
    expect(texto).toContain("1234");
    expect(texto).toContain("2814");
  });

  it("agrega lo que dijo Google cuando la planilla no se pudo escribir", () => {
    const texto = avisoDeEnlazada("1234", 2814, "Quota exceeded");
    expect(texto).toContain("Quota exceeded");
  });
});

/**
 * Desenlazar: qué enlace se deshace y cuál no.
 *
 * Los tres casos de la lista son estados que existen de verdad en la base,
 * medidos el 26/10/2026 sobre 196 avisos: 182 con el número escrito a mano en
 * la planilla, 4 enlazados por el sistema, 0 con enlace y sin texto.
 */
const ENLAZADO: AvisoADesenlazar = {
  oa_number: "A189",
  work_order_id: "ot-id",
  ot_asignada: "2814",
  ot_enlazada_en: "2026-10-26T10:00:00.000Z",
};

describe("loQueImpideDesenlazar", () => {
  it("no impide nada cuando el enlace lo hizo el botón y la planilla coincide", () => {
    expect(loQueImpideDesenlazar(ENLAZADO, 2814)).toEqual([]);
  });

  it("impide cuando el aviso no tiene nada enlazado", () => {
    const impide = loQueImpideDesenlazar(
      { oa_number: "A1", work_order_id: null, ot_asignada: null }, null
    );
    expect(impide).toHaveLength(1);
    expect(impide[0]).toContain("no tiene ninguna orden");
  });

  it("impide cuando el número lo escribió alguien a mano en la planilla", () => {
    // Son 182 de 186: el caso normal, no el raro. Vaciar esa celda es borrar
    // lo que alguien puso donde lee quien no entra al sistema.
    const impide = loQueImpideDesenlazar(
      { oa_number: "A22", work_order_id: null, ot_asignada: "949" }, null
    );
    expect(impide).toHaveLength(1);
    expect(impide[0]).toContain("949");
    expect(impide[0]).toContain("planilla");
  });

  it("impide también cuando lo escrito a mano no es un número", () => {
    // «RI 1888», «Revision», «si», «-», «1889 - 1886»: la columna es texto
    // libre y todos esos existen hoy.
    for (const texto of ["RI 1888", "Revision", "si", "-", "1889 - 1886"]) {
      const impide = loQueImpideDesenlazar(
        { oa_number: "A138", work_order_id: null, ot_asignada: texto }, null
      );
      expect(impide).toHaveLength(1);
      expect(impide[0]).toContain(texto);
    }
  });

  it("impide cuando la OT la generó el sistema desde este aviso", () => {
    // Sin `ot_enlazada_en` el enlace no lo hizo este botón. Deshacerlo dejaría
    // una orden que nadie reclama; lo que corresponde es darla de baja a ella.
    const impide = loQueImpideDesenlazar({ ...ENLAZADO, ot_enlazada_en: null }, 2814);
    expect(impide).toHaveLength(1);
    expect(impide[0]).toContain("2814");
    expect(impide[0]).toContain("darla de baja");
  });

  it("impide cuando alguien cambió a mano la celda después de enlazar", () => {
    // Vaciarla sería pisar lo que esa persona escribió, y dejarla tampoco
    // sirve: la próxima sincronización la trae y el aviso sigue con OT.
    const impide = loQueImpideDesenlazar({ ...ENLAZADO, ot_asignada: "2815" }, 2814);
    expect(impide).toHaveLength(1);
    expect(impide[0]).toContain("2815");
    expect(impide[0]).toContain("2814");
  });

  it("no mira la celda cuando todavía no se leyó la orden", () => {
    // Es lo que corre la pantalla: decide si ofrecer el botón, no si hacerlo.
    expect(loQueImpideDesenlazar({ ...ENLAZADO, ot_asignada: "2815" }, null)).toEqual([]);
  });

  it("deja desenlazar aunque la planilla nunca se haya podido escribir", () => {
    // Enlazar guarda primero y escribe después: si Google no contestó, el
    // enlace existe igual y la celda quedó vacía. No hay nada que pisar.
    expect(loQueImpideDesenlazar({ ...ENLAZADO, ot_asignada: "" }, 2814)).toEqual([]);
  });
});

describe("sePuedeDesenlazar", () => {
  it("es sí para un enlace hecho con el botón", () => {
    expect(sePuedeDesenlazar(ENLAZADO)).toBe(true);
  });

  it("es no para los tres que no se tocan", () => {
    expect(sePuedeDesenlazar({ ...ENLAZADO, ot_enlazada_en: null })).toBe(false);
    expect(sePuedeDesenlazar(
      { oa_number: "A22", work_order_id: null, ot_asignada: "949" }
    )).toBe(false);
    expect(sePuedeDesenlazar(
      { oa_number: "A1", work_order_id: null, ot_asignada: null }
    )).toBe(false);
  });
});

describe("avisoDeDesenlazada", () => {
  it("dice qué aviso dejó de estar enlazado a qué orden", () => {
    const texto = avisoDeDesenlazada("A189", 2814, null);
    expect(texto).toContain("A189");
    expect(texto).toContain("2814");
    expect(texto).toContain("pendiente");
  });

  it("agrega lo que dijo Google cuando la celda no se pudo vaciar", () => {
    const texto = avisoDeDesenlazada("A189", 2814, "Quota exceeded");
    expect(texto).toContain("Quota exceeded");
  });

  it("pide borrar la celda a mano, porque si no la sincronización lo deshace", () => {
    // No alcanza con avisar que la planilla «no se enteró», como en
    // desestimar: acá la celda que quedó vuelve a entrar como `ot_asignada` y
    // el aviso queda contando como que ya tiene orden, para siempre.
    const texto = avisoDeDesenlazada("A189", 2814, "500 Internal Error");
    expect(texto).toContain("a mano");
    expect(texto).toContain("sincronización");
  });
});

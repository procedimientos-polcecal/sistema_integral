/**
 * Los valores son los que tiene la base, medidos el 19/10/2026 sobre las 2.206
 * órdenes: `estado` en POR_HACER/REALIZADO/ATRASADO/EN_PROCESO, `prioridad`
 * con emoji o null en 2.040 de ellas, y `especialidad` con un LUBRICACIÓN que
 * el formulario no ofrece.
 */
import { describe, it, expect } from "vitest";
import {
  copiarDeLaOT, lineasDeLaOT, numeroDeOT, avisoDeReutilizada,
  type OTVieja, type Vocabulario,
} from "@/lib/mantenimiento/reutilizarOT";

/** El del formulario de Nueva OT, tal cual. */
const VOCABULARIO: Vocabulario = {
  especialidades: ["MECÁNICO", "ELÉCTRICO", "INSTRUMENTACIÓN", "CIVIL", "OTRO"],
  tipos: ["PROGRAMADO", "CORRECTIVO", "PREDICTIVO", "MEJORA"],
  quien: ["INTERNO", "CONTRATADO", "MIXTO"],
  estados: ["POR_HACER", "EN_PROCESO", "REALIZADO", "ATRASADO"],
  prioridades: ["🟢 Baja", "🟡 Media", "🟠 Alta"],
};

function ot(extra: Partial<OTVieja> = {}): OTVieja {
  return {
    ot_number: 2814,
    equipment_id: "eq-1", sector_id: "sec-1",
    especialidad: "MECÁNICO", tipo: "CORRECTIVO", quien: "INTERNO",
    descripcion: "Cambio de grillas", estado: "REALIZADO",
    contratista: null, horas: 4,
    operario_1: "Piparo", operario_2: null, operario_3: null,
    prioridad: "🟡 Media", requiere_parada_sector: false,
    repuesto: null, repuestos: [],
    ...extra,
  };
}

describe("copiarDeLaOT", () => {
  it("copia lo que el formulario puede mostrar", () => {
    const { campos, noEntraron } = copiarDeLaOT(ot(), VOCABULARIO);
    expect(noEntraron).toEqual([]);
    expect(campos).toMatchObject({
      sector_id: "sec-1", equipment_id: "eq-1",
      especialidad: "MECÁNICO", tipo: "CORRECTIVO", quien: "INTERNO",
      descripcion: "Cambio de grillas", estado: "REALIZADO",
      operario_1: "Piparo", horas: "4", prioridad: "🟡 Media",
    });
  });

  it("NO copia ninguna de las tres fechas", () => {
    // Es el pedido entero: la OT nueva es de otro día.
    const { campos } = copiarDeLaOT(ot(), VOCABULARIO);
    expect(campos).not.toHaveProperty("fecha");
    expect(campos).not.toHaveProperty("fecha_ejecucion");
    expect(campos).not.toHaveProperty("fecha_cierre");
  });

  it("tampoco copia el número: lo da la planilla", () => {
    const { campos } = copiarDeLaOT(ot(), VOCABULARIO);
    expect(campos).not.toHaveProperty("ot_number");
  });

  it("copia el estado, aunque la nueva todavía no tenga fecha de cierre", () => {
    // Cargando trabajos ya hechos, arrancar en Realizado es lo que se quiere.
    expect(copiarDeLaOT(ot({ estado: "REALIZADO" }), VOCABULARIO).campos.estado).toBe("REALIZADO");
  });

  it("copia la marca de parar el sector", () => {
    expect(copiarDeLaOT(ot({ requiere_parada_sector: true }), VOCABULARIO).campos.requiere_parada_sector).toBe(true);
    expect(copiarDeLaOT(ot({ requiere_parada_sector: null }), VOCABULARIO).campos.requiere_parada_sector).toBe(false);
  });

  describe("un valor que el desplegable no tiene", () => {
    it("no entra, y se dice cuál era", () => {
      // 5 de las 2.206 OT tienen LUBRICACIÓN y el formulario no la ofrece.
      // Copiarla mostraría "—" y guardaría "LUBRICACIÓN".
      const { campos, noEntraron } = copiarDeLaOT(ot({ especialidad: "LUBRICACIÓN" }), VOCABULARIO);
      expect(campos).not.toHaveProperty("especialidad");
      expect(noEntraron).toEqual(['la especialidad ("LUBRICACIÓN")']);
    });

    it("vale para los cinco desplegables", () => {
      const { campos, noEntraron } = copiarDeLaOT(
        ot({ especialidad: "LUBRICACIÓN", tipo: "RARO", quien: "NADIE", estado: "VIEJO", prioridad: "🔴 Urgente" }),
        VOCABULARIO
      );
      for (const c of ["especialidad", "tipo", "quien", "estado", "prioridad"]) {
        expect(campos).not.toHaveProperty(c);
      }
      expect(noEntraron).toHaveLength(5);
    });

    it("un valor ausente no es un valor que no entra", () => {
      // 2.040 OT no tienen prioridad. Eso no es un problema que avisar: el
      // formulario se queda con la suya, que su desplegable sí puede mostrar.
      const { campos, noEntraron } = copiarDeLaOT(ot({ prioridad: null, contratista: null }), VOCABULARIO);
      expect(campos).not.toHaveProperty("prioridad");
      expect(noEntraron).toEqual([]);
      expect(campos.contratista).toBe("");
    });
  });

  it("las horas pasan de número a texto, que es lo que el campo escribe", () => {
    expect(copiarDeLaOT(ot({ horas: 2.5 }), VOCABULARIO).campos.horas).toBe("2.5");
    expect(copiarDeLaOT(ot({ horas: null }), VOCABULARIO).campos.horas).toBe("");
  });

  it("el null de la base es la cadena vacía del formulario", () => {
    const { campos } = copiarDeLaOT(ot({ descripcion: null, operario_1: null }), VOCABULARIO);
    expect(campos.descripcion).toBe("");
    expect(campos.operario_1).toBe("");
  });
});

describe("lineasDeLaOT", () => {
  it("se lleva los renglones cuando la OT los tiene", () => {
    const lineas = lineasDeLaOT(ot({
      repuestos: [{ nombre: "grillas 2 mm", cantidad: "2" }, { nombre: "martillos", cantidad: "4" }],
    }));
    expect(lineas).toEqual([
      { cantidad: "2", nombre: "grillas 2 mm" },
      { cantidad: "4", nombre: "martillos" },
    ]);
  });

  it("el texto suelto de una OT vieja entra tal cual, en un renglón", () => {
    // Las 2.200 anteriores a los renglones sólo tienen la celda de la planilla.
    // No se parte: partirlo reescribiría lo que puso una persona, y eso se
    // termina escribiendo de vuelta en la planilla.
    expect(lineasDeLaOT(ot({ repuesto: "2 grillas 2 mm" }))).toEqual([
      { cantidad: "", nombre: "2 grillas 2 mm" },
    ]);
  });

  it("los renglones le ganan al texto suelto", () => {
    const lineas = lineasDeLaOT(ot({
      repuesto: "2 grillas 2 mm",
      repuestos: [{ nombre: "grillas 2 mm", cantidad: "2" }],
    }));
    expect(lineas).toEqual([{ cantidad: "2", nombre: "grillas 2 mm" }]);
  });

  it("una OT sin repuestos no trae ningún renglón", () => {
    expect(lineasDeLaOT(ot())).toEqual([]);
    expect(lineasDeLaOT(ot({ repuesto: "   ", repuestos: null }))).toEqual([]);
  });

  it("un renglón sin nombre no es un renglón", () => {
    expect(lineasDeLaOT(ot({ repuestos: [{ nombre: "  ", cantidad: "2" }] }))).toEqual([]);
  });
});

describe("numeroDeOT", () => {
  it("acepta el número como lo tenga a mano quien copia", () => {
    expect(numeroDeOT("2814")).toBe(2814);
    expect(numeroDeOT("  2814 ")).toBe(2814);
    expect(numeroDeOT("OT 2814")).toBe(2814);
    expect(numeroDeOT("N° 2814")).toBe(2814);
  });

  it("devuelve null cuando no hay número", () => {
    expect(numeroDeOT("")).toBeNull();
    expect(numeroDeOT("   ")).toBeNull();
    expect(numeroDeOT("abc")).toBeNull();
    expect(numeroDeOT("0")).toBeNull();
  });
});

describe("avisoDeReutilizada", () => {
  it("dice de qué OT vino y que hay que revisar", () => {
    expect(avisoDeReutilizada(2814, [])).toBe(
      "Los campos vienen de la OT 2814 — revisalos antes de guardar."
    );
  });

  it("y suma lo que no se pudo traer", () => {
    const aviso = avisoDeReutilizada(644, ['la especialidad ("LUBRICACIÓN")']);
    expect(aviso).toContain("OT 644");
    expect(aviso).toContain('No se pudo traer la especialidad ("LUBRICACIÓN")');
    expect(aviso).toContain("elegilo a mano");
  });
});

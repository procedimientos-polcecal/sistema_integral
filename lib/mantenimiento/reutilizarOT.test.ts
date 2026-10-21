/**
 * Los valores son los que tiene la base, medidos el 21/10/2026 sobre las 2.224
 * órdenes: `estado` en POR_HACER/REALIZADO/ATRASADO/EN_PROCESO, `prioridad` con
 * emoji o null, y `especialidad` en las cuatro que la planilla usa.
 */
import { describe, it, expect } from "vitest";
import {
  copiarDeLaOT, lineasDeLaOT, numeroDeOT, avisoDeReutilizada,
  type OTVieja, type Vocabulario,
} from "@/lib/mantenimiento/reutilizarOT";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";
import {
  TIPOS_DE_OT, QUIENES_DE_OT, PRIORIDADES_DE_OT,
} from "@/lib/mantenimiento/filtrosOt";

/**
 * El del formulario de Nueva OT — **de `lib/`, igual que el formulario**.
 *
 * Era una copia a mano de la lista que el modal tenía escrita, y ahí estaba la
 * trampa: el 21/10/2026 se descubrió que esa lista del modal no era el
 * vocabulario del sistema —ofrecía INSTRUMENTACIÓN, OTRO, PREDICTIVO, MEJORA y
 * MIXTO, que ningún filtro conocía, y no ofrecía LUBRICACIÓN—. Copiarla acá
 * hacía que el test **confirmara la divergencia en vez de encontrarla**: pasaba
 * en verde justamente porque repetía el error.
 *
 * Un vocabulario no se vuelve a escribir en un test. Se importa del mismo lugar
 * del que lo importa el código, o el test deja de probar algo.
 */
const VOCABULARIO: Vocabulario = {
  especialidades: ESPECIALIDADES,
  tipos: TIPOS_DE_OT,
  quien: QUIENES_DE_OT,
  // Los estados del formulario son un subconjunto a propósito: una OT no nace
  // suspendida. Es la única lista que no sale del vocabulario, y por eso es la
  // única que se escribe acá.
  estados: ["POR_HACER", "EN_PROCESO", "REALIZADO", "ATRASADO"],
  prioridades: PRIORIDADES_DE_OT,
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

  /**
   * EL TEST QUE HABRÍA ATRAPADO LO DEL 21/10/2026. Las 7 OT con especialidad
   * LUBRICACIÓN no se copiaban, y la causa no era esta función: era que la
   * lista del formulario no tenía LUBRICACIÓN. Recorrer el vocabulario entero
   * es lo que hace que agregar un valor sin poder copiarlo se note acá, en vez
   * de notarse cuando alguien intenta reutilizar una orden y no puede.
   */
  it("cualquier valor del vocabulario se copia, sin excepciones", () => {
    for (const e of ESPECIALIDADES) {
      const { campos, noEntraron } = copiarDeLaOT(ot({ especialidad: e }), VOCABULARIO);
      expect(noEntraron).toEqual([]);
      expect(campos.especialidad).toBe(e);
    }
    for (const t of TIPOS_DE_OT) {
      expect(copiarDeLaOT(ot({ tipo: t }), VOCABULARIO).campos.tipo).toBe(t);
    }
    for (const q of QUIENES_DE_OT) {
      expect(copiarDeLaOT(ot({ quien: q }), VOCABULARIO).campos.quien).toBe(q);
    }
  });

  describe("un valor que el desplegable no tiene", () => {
    /**
     * El ejemplo era LUBRICACIÓN, y desde el 21/10/2026 ya no sirve: el
     * formulario la ofrece. Va uno que de verdad no existe — que es el caso
     * para el que esta regla está, el de una OT vieja con un valor que nadie
     * ofrece hoy.
     */
    it("no entra, y se dice cuál era", () => {
      const { campos, noEntraron } = copiarDeLaOT(ot({ especialidad: "SOLDADURA" }), VOCABULARIO);
      expect(ESPECIALIDADES).not.toContain("SOLDADURA");
      expect(campos).not.toHaveProperty("especialidad");
      expect(noEntraron).toEqual(['la especialidad ("SOLDADURA")']);
    });

    it("vale para los cinco desplegables", () => {
      const { campos, noEntraron } = copiarDeLaOT(
        ot({ especialidad: "SOLDADURA", tipo: "RARO", quien: "NADIE", estado: "VIEJO", prioridad: "🔴 Urgente" }),
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
    const aviso = avisoDeReutilizada(644, ['la especialidad ("SOLDADURA")']);
    expect(aviso).toContain("OT 644");
    expect(aviso).toContain('No se pudo traer la especialidad ("SOLDADURA")');
    expect(aviso).toContain("elegilo a mano");
  });
});

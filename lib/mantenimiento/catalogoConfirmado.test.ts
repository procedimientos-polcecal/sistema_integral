import { describe, it, expect } from "vitest";
import {
  cruzarConLasDecisiones, loQueFaltaParaDecidir, periodoSugerido,
  PERIODO_MAXIMO_DIAS, type DecisionGuardada,
} from "./catalogoConfirmado";
import type { CatalogoPropuesto } from "./tareasPreventivas";

const SIN_COBERTURA = {
  ordenes: 0, conAccionPreventiva: 0, conAccionCorrectiva: 0, sinAccion: 0, enElCatalogo: 0,
};

function propuesto(
  tareas: { accion: string; componente: string; equipos: { id: string; veces: number; cada: number | null }[] }[]
): CatalogoPropuesto {
  return {
    cobertura: SIN_COBERTURA,
    tareas: tareas.map((t) => ({
      accion: t.accion,
      componente: t.componente,
      veces: t.equipos.reduce((a, e) => a + e.veces, 0),
      equipos: t.equipos.map((e) => ({
        equipmentId: e.id, veces: e.veces, intervaloTipico: e.cada,
      })),
      // No lo mira este modulo, pero el tipo lo pide.
      masLarga: { otNumber: 1, equipmentId: t.equipos[0].id, fecha: "2026-01-01", horas: 1 },
      horasTotales: 1,
      reparaciones: 1,
    })) as CatalogoPropuesto["tareas"],
  };
}

function decision(p: Partial<DecisionGuardada> = {}): DecisionGuardada {
  return {
    equipment_id: "molino", accion: "ROTACION", componente: "Martillos",
    nombre: "rotación de Martillos", periodo_dias: null, estado: "CONFIRMADA",
    motivo: null, ...p,
  };
}

const UNA_TAREA = propuesto([
  { accion: "ROTACION", componente: "Martillos", equipos: [{ id: "molino", veces: 30, cada: 4 }] },
]);

describe("cruzar la propuesta con las decisiones", () => {
  it("sin decisiones, todo es propuesta", () => {
    const c = cruzarConLasDecisiones(UNA_TAREA, []);
    expect(c.renglones).toHaveLength(1);
    expect(c.renglones[0]).toMatchObject({
      equipmentId: "molino", accion: "ROTACION", componente: "Martillos",
      estado: "propuesta", veces: 30, intervaloMedido: 4, periodoDecidido: null,
      sinRespaldoEnElHistorial: false,
    });
  });

  it("el nombre propuesto sale del vocabulario", () => {
    expect(cruzarConLasDecisiones(UNA_TAREA, []).renglones[0].nombre)
      .toBe("rotación de Martillos");
  });

  it("una decision pisa el nombre y trae su periodo", () => {
    const c = cruzarConLasDecisiones(UNA_TAREA, [
      decision({ nombre: "Rotar martillos a 2da cara", periodo_dias: 5 }),
    ]);
    expect(c.renglones[0]).toMatchObject({
      nombre: "Rotar martillos a 2da cara", estado: "confirmada",
      periodoDecidido: 5, intervaloMedido: 4,
    });
  });

  /**
   * Las dos conviven y dicen cosas distintas: `intervaloMedido` es lo que pasa
   * hoy y `periodoDecidido` es lo que alguien fijó. Que se separen es lo que
   * deja ver que el ritmo se movio desde que se decidio.
   */
  it("el ritmo medido y el periodo decidido no se pisan", () => {
    const c = cruzarConLasDecisiones(UNA_TAREA, [decision({ periodo_dias: 30 })]);
    expect(c.renglones[0].intervaloMedido).toBe(4);
    expect(c.renglones[0].periodoDecidido).toBe(30);
  });

  it("una descartada queda descartada, con su motivo", () => {
    const c = cruzarConLasDecisiones(UNA_TAREA, [
      decision({ estado: "DESCARTADA", motivo: "La hace el contratista" }),
    ]);
    expect(c.renglones[0]).toMatchObject({
      estado: "descartada", motivo: "La hace el contratista",
    });
  });

  /**
   * La decision es por equipo: la misma tarea en otra maquina sigue siendo una
   * propuesta. Es el punto de que la clave sea (equipo, accion, componente).
   */
  it("decidir en un equipo no decide en el otro", () => {
    const dos = propuesto([
      {
        accion: "ROTACION", componente: "Martillos",
        equipos: [{ id: "molino", veces: 30, cada: 4 }, { id: "rompedora", veces: 16, cada: 5 }],
      },
    ]);
    const c = cruzarConLasDecisiones(dos, [decision({ equipment_id: "molino" })]);
    const porEquipo = Object.fromEntries(c.renglones.map((r) => [r.equipmentId, r.estado]));
    expect(porEquipo).toEqual({ molino: "confirmada", rompedora: "propuesta" });
  });

  /**
   * Una tarea confirmada es un plan: que la ventana de 365 dias ya no la vea
   * es justamente lo que alguien querria notar —se dejo de hacer, o el equipo
   * salio de servicio—, asi que se muestra y se marca, no se esconde.
   */
  it("una decision que el historial ya no respalda igual aparece", () => {
    const c = cruzarConLasDecisiones(UNA_TAREA, [
      decision(),
      decision({ equipment_id: "viejo", nombre: "limpieza de Cangilones", periodo_dias: 30 }),
    ]);
    const huerfana = c.renglones.find((r) => r.equipmentId === "viejo");
    expect(huerfana).toMatchObject({
      estado: "confirmada", veces: 0, intervaloMedido: null,
      periodoDecidido: 30, sinRespaldoEnElHistorial: true,
    });
  });

  it("y no se cuenta dos veces", () => {
    const c = cruzarConLasDecisiones(UNA_TAREA, [decision()]);
    expect(c.renglones).toHaveLength(1);
    expect(c.renglones[0].sinRespaldoEnElHistorial).toBe(false);
  });

  /** Lo que falta decidir va primero: una pantalla que arranca con lo resuelto hace buscar. */
  it("ordena lo pendiente primero, y dentro de eso por volumen", () => {
    const varias = propuesto([
      { accion: "ROTACION", componente: "Martillos", equipos: [{ id: "a", veces: 30, cada: 4 }] },
      { accion: "LIMPIEZA", componente: "Cangilones", equipos: [{ id: "b", veces: 50, cada: 7 }] },
      { accion: "CAMBIO", componente: "Correas", equipos: [{ id: "c", veces: 10, cada: null }] },
    ]);
    const c = cruzarConLasDecisiones(varias, [
      { ...decision({ equipment_id: "b", accion: "LIMPIEZA", componente: "Cangilones" }) },
    ]);
    expect(c.renglones.map((r) => `${r.equipmentId}:${r.estado}`)).toEqual([
      "a:propuesta", "c:propuesta", "b:confirmada",
    ]);
  });

  it("el resumen cuenta los tres estados", () => {
    const varias = propuesto([
      { accion: "ROTACION", componente: "Martillos", equipos: [
        { id: "a", veces: 3, cada: 4 }, { id: "b", veces: 2, cada: 5 }, { id: "c", veces: 1, cada: null },
      ] },
    ]);
    const c = cruzarConLasDecisiones(varias, [
      decision({ equipment_id: "b" }),
      decision({ equipment_id: "c", estado: "DESCARTADA" }),
    ]);
    expect(c.resumen).toEqual({ propuestas: 1, confirmadas: 1, descartadas: 1 });
  });

  it("sin propuesta ni decisiones no inventa nada", () => {
    const c = cruzarConLasDecisiones({ tareas: [], cobertura: SIN_COBERTURA }, []);
    expect(c.renglones).toEqual([]);
    expect(c.resumen).toEqual({ propuestas: 0, confirmadas: 0, descartadas: 0 });
  });
});

describe("que le falta a una decision para guardarse", () => {
  const completa = {
    accion: "ROTACION", componente: "Martillos", nombre: "rotación de Martillos",
    estado: "CONFIRMADA", periodo_dias: 5,
  };

  it("completa no falta nada", () => {
    expect(loQueFaltaParaDecidir(completa)).toEqual([]);
  });

  it("nombra cada campo que falta", () => {
    expect(loQueFaltaParaDecidir({ ...completa, accion: "" })).toEqual(["la acción"]);
    expect(loQueFaltaParaDecidir({ ...completa, componente: "" })).toEqual(["el componente"]);
    expect(loQueFaltaParaDecidir({ ...completa, nombre: "  " })).toEqual(["el nombre de la tarea"]);
  });

  /** Una accion inventada entraria a la tabla y no la reconoceria nadie despues. */
  it("una accion que no esta en el vocabulario no pasa", () => {
    expect(loQueFaltaParaDecidir({ ...completa, accion: "INVENTADA" }))
      .toEqual(["una acción del vocabulario"]);
  });

  it("el estado tiene que ser uno de los dos", () => {
    expect(loQueFaltaParaDecidir({ ...completa, estado: "QUIZAS" }))
      .toEqual(["si se confirma o se descarta"]);
    expect(loQueFaltaParaDecidir({ ...completa, estado: "DESCARTADA" })).toEqual([]);
  });

  /** Se puede confirmar que la tarea existe sin decidir todavia cada cuanto. */
  it("sin periodo esta bien", () => {
    expect(loQueFaltaParaDecidir({ ...completa, periodo_dias: null })).toEqual([]);
    expect(loQueFaltaParaDecidir({ ...completa, periodo_dias: "" })).toEqual([]);
    expect(loQueFaltaParaDecidir({ ...completa, periodo_dias: undefined })).toEqual([]);
  });

  it("un periodo que no es un numero de dias no pasa", () => {
    const mal = `un período en días de 1 a ${PERIODO_MAXIMO_DIAS}`;
    expect(loQueFaltaParaDecidir({ ...completa, periodo_dias: 0 })).toEqual([mal]);
    expect(loQueFaltaParaDecidir({ ...completa, periodo_dias: -3 })).toEqual([mal]);
    expect(loQueFaltaParaDecidir({ ...completa, periodo_dias: 1.5 })).toEqual([mal]);
    expect(loQueFaltaParaDecidir({ ...completa, periodo_dias: "quincenal" })).toEqual([mal]);
    expect(loQueFaltaParaDecidir({ ...completa, periodo_dias: 4000 })).toEqual([mal]);
  });

  it("dice todo lo que falta de una sola vez", () => {
    expect(loQueFaltaParaDecidir({
      accion: "", componente: "", nombre: "", estado: "", periodo_dias: 0,
    })).toEqual([
      "la acción", "el componente", "el nombre de la tarea",
      "si se confirma o se descarta", `un período en días de 1 a ${PERIODO_MAXIMO_DIAS}`,
    ]);
  });
});

/**
 * Nadie programa "cada 27 dias", programa "cada mes". Los cortes salen de los
 * ritmos de esta planta: martillos cada ~4 dias, pendulos cada ~6, cuerpos
 * moledores cada ~24.
 */
describe("el periodo que se sugiere", () => {
  it("hasta dos semanas, el dia importa y no se redondea", () => {
    expect(periodoSugerido(4)).toBe(4);
    expect(periodoSugerido(6)).toBe(6);
    expect(periodoSugerido(14)).toBe(14);
  });

  it("hasta el mes, a semanas", () => {
    expect(periodoSugerido(15)).toBe(14);
    expect(periodoSugerido(24)).toBe(21);
    expect(periodoSugerido(26)).toBe(28);
  });

  it("de ahi para arriba, a meses", () => {
    expect(periodoSugerido(55)).toBe(60);
    expect(periodoSugerido(89)).toBe(90);
    expect(periodoSugerido(100)).toBe(90);
  });

  /** Sin medicion no se sugiere nada, que es distinto de sugerir cero. */
  it("sin intervalo medido no sugiere", () => {
    expect(periodoSugerido(null)).toBeNull();
    expect(periodoSugerido(0)).toBeNull();
  });
});

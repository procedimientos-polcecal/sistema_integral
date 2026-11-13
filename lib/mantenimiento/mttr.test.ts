import { describe, it, expect } from "vitest";
import {
  calcularMttr, esDeUnTercero, horasDeReparacion, MINIMO_REPARACIONES,
  mttrDelEquipo, reparacionesDeLaVentana, type OtReparacion,
} from "./mttr";
import { VENTANA_DIAS } from "./mtbf";

const HASTA = "2026-11-11";

let siguiente = 1;
function ot(parcial: Partial<OtReparacion> = {}): OtReparacion {
  return {
    ot_number: siguiente++,
    tipo: "CORRECTIVO",
    fecha: null,
    fecha_ejecucion: "2026-11-01",
    horas: 3,
    equipment_id: "eq-1",
    contratista: null,
    ...parcial,
  };
}

/**
 * El criterio de "la hizo un tercero" es `contratista` con texto, el mismo que
 * usa `costoEquipo.ts`. Dos criterios distintos para la misma pregunta es como
 * se separan dos modulos que miran la misma tabla.
 */
describe("si la reparacion la hizo un tercero", () => {
  it("con contratista cargado, si", () => {
    expect(esDeUnTercero(ot({ contratista: "PIPARO" }))).toBe(true);
  });

  it("sin contratista, no", () => {
    expect(esDeUnTercero(ot({ contratista: null }))).toBe(false);
    expect(esDeUnTercero(ot({ contratista: "" }))).toBe(false);
    expect(esDeUnTercero(ot({ contratista: "   " }))).toBe(false);
  });
});

describe("que entra a la cuenta y que queda afuera", () => {
  it("una correctiva propia, con horas y con equipo, entra", () => {
    const { reparaciones } = reparacionesDeLaVentana([ot()], HASTA);
    expect(reparaciones).toHaveLength(1);
    expect(reparaciones[0].horas).toBe(3);
  });

  /** El MTTR acompana al MTBF: las dos cuentan correctivas y nada mas. */
  it("una preventiva no es una reparacion", () => {
    const { reparaciones } = reparacionesDeLaVentana([ot({ tipo: "PREVENTIVO" })], HASTA);
    expect(reparaciones).toEqual([]);
  });

  it("la de contratista no entra, y se cuenta aparte", () => {
    const r = reparacionesDeLaVentana([ot({ contratista: "PIPARO", horas: 415 })], HASTA);
    expect(r.reparaciones).toEqual([]);
    expect(r.afuera.deContratista).toBe(1);
  });

  /**
   * Cero horas no es "duro cero": es que no se cargo. Una reparacion que
   * existe duro algo, aunque sea diez minutos.
   */
  it("sin horas no entra", () => {
    const r = reparacionesDeLaVentana([ot({ horas: null }), ot({ horas: 0 })], HASTA);
    expect(r.reparaciones).toEqual([]);
    expect(r.afuera.sinHoras).toBe(2);
  });

  it("sin equipo no se le puede imputar a nadie", () => {
    const r = reparacionesDeLaVentana([ot({ equipment_id: null })], HASTA);
    expect(r.reparaciones).toEqual([]);
    expect(r.afuera.sinEquipo).toBe(1);
  });

  /**
   * Una sola vez. Si una orden de contratista sin horas se contara en los dos
   * lados, la suma de `afuera` diria mas descartes que ordenes descartadas.
   */
  it("una orden descartada se cuenta en un solo motivo", () => {
    const r = reparacionesDeLaVentana(
      [ot({ contratista: "PIPARO", horas: null, equipment_id: null })], HASTA
    );
    expect(r.afuera).toEqual({ deContratista: 1, sinHoras: 0, sinEquipo: 0 });
  });

  /**
   * El invariante que hace auditable al numero: toda correctiva de la ventana
   * esta contable o esta en exactamente uno de los tres motivos. Medido el
   * 11/11/2026 con la lectura real: 555 + 89 + 330 + 5 = 979, las correctivas
   * de la ventana.
   */
  it("las cuatro cuentas suman las correctivas de la ventana", () => {
    const ordenes = [
      ot(), ot({ horas: 8 }),
      ot({ contratista: "PIPARO" }), ot({ contratista: "CANDIA", horas: null }),
      ot({ horas: null }), ot({ horas: 0 }),
      ot({ equipment_id: null }),
      // Y dos que no son de la ventana: no suman a ningun lado.
      ot({ fecha_ejecucion: "2020-01-01" }), ot({ tipo: "PREVENTIVO" }),
    ];
    const r = reparacionesDeLaVentana(ordenes, HASTA);
    const { deContratista, sinHoras, sinEquipo } = r.afuera;
    expect(r.reparaciones.length + deContratista + sinHoras + sinEquipo).toBe(7);
    expect(r.reparaciones).toHaveLength(2);
    expect(r.afuera).toEqual({ deContratista: 2, sinHoras: 2, sinEquipo: 1 });
  });
});

/**
 * La ventana es la misma del MTBF y eso esta fijado acá: los dos numeros se
 * leen en la misma línea de la misma ficha, y si cubrieran periodos distintos
 * nada lo avisaria.
 */
describe("la ventana es la misma que la del MTBF", () => {
  it("el primer dia de la ventana entra", () => {
    const primero = "2025-11-12"; // HASTA - 364
    const { reparaciones } = reparacionesDeLaVentana([ot({ fecha_ejecucion: primero })], HASTA);
    expect(reparaciones).toHaveLength(1);
  });

  it("el dia anterior a la ventana no entra", () => {
    const { reparaciones } = reparacionesDeLaVentana(
      [ot({ fecha_ejecucion: "2025-11-11" })], HASTA
    );
    expect(reparaciones).toEqual([]);
  });

  it("son VENTANA_DIAS dias y no otra cosa", () => {
    expect(VENTANA_DIAS).toBe(365);
  });

  /** Hay ordenes fechadas en 2027 por errores de carga: no son reparaciones hechas. */
  it("lo ejecutado despues de hasta no entra", () => {
    const { reparaciones } = reparacionesDeLaVentana(
      [ot({ fecha_ejecucion: "2027-01-05" })], HASTA
    );
    expect(reparaciones).toEqual([]);
  });

  /** La misma regla que el MTBF: la ejecucion manda y la carga es el respaldo. */
  it("sin fecha de ejecucion se usa la de carga", () => {
    const { reparaciones } = reparacionesDeLaVentana(
      [ot({ fecha_ejecucion: null, fecha: "2026-10-02" })], HASTA
    );
    expect(reparaciones[0].fecha).toBe("2026-10-02");
  });
});

describe("el MTTR de un equipo", () => {
  it("es el promedio de las horas de sus reparaciones", () => {
    const r = calcularMttr([ot({ horas: 2 }), ot({ horas: 4 }), ot({ horas: 6 })], HASTA);
    expect(r.filas[0].mttr).toBe(4);
    expect(r.filas[0].reparaciones).toBe(3);
    expect(r.filas[0].horasTotales).toBe(12);
  });

  /**
   * Con una sola, "el promedio" es esa orden; con dos, cualquiera de las dos
   * la mueve a la mitad. El equipo aparece igual, con su cuenta y sin numero.
   */
  it("bajo el minimo hay cuenta pero no hay promedio", () => {
    expect(MINIMO_REPARACIONES).toBe(3);
    const r = calcularMttr([ot({ horas: 40 }), ot({ horas: 2 })], HASTA);
    expect(r.filas[0].mttr).toBeNull();
    expect(r.filas[0].reparaciones).toBe(2);
    // Pero la planta si cuenta esas horas: el piso es para publicar un
    // promedio por equipo, no para tirar el dato.
    expect(r.mttrDeLaPlanta).toBe(21);
    expect(r.reparaciones).toBe(2);
  });

  /** Un MTTR alto casi siempre es una orden larga y no un equipo lento. */
  it("senala la reparacion mas larga", () => {
    const r = calcularMttr(
      [ot({ horas: 2 }), ot({ horas: 59, ot_number: 1169 }), ot({ horas: 3 })], HASTA
    );
    expect(r.filas[0].masLarga.otNumber).toBe(1169);
    expect(r.filas[0].masLarga.horas).toBe(59);
  });

  it("con dos igual de largas gana la mas reciente", () => {
    const r = calcularMttr([
      ot({ horas: 8, ot_number: 100, fecha_ejecucion: "2026-03-01" }),
      ot({ horas: 8, ot_number: 200, fecha_ejecucion: "2026-09-01" }),
      ot({ horas: 1 }),
    ], HASTA);
    expect(r.filas[0].masLarga.otNumber).toBe(200);
  });
});

describe("el orden del listado", () => {
  /** Primero las que mas tardan: es lo que alguien va a mirar. */
  it("por MTTR descendente", () => {
    const r = calcularMttr([
      ...[1, 1, 1].map((h) => ot({ horas: h, equipment_id: "rapido" })),
      ...[10, 10, 10].map((h) => ot({ horas: h, equipment_id: "lento" })),
    ], HASTA);
    expect(r.filas.map((f) => f.equipmentId)).toEqual(["lento", "rapido"]);
  });

  /** Las que no tienen promedio van al final: no se ordenan contra un numero que no hay. */
  it("las de mttr null quedan ultimas, y entre ellas manda la cantidad", () => {
    const r = calcularMttr([
      ...[5, 5, 5].map((h) => ot({ horas: h, equipment_id: "con-numero" })),
      ot({ horas: 99, equipment_id: "una-sola" }),
      ot({ horas: 99, equipment_id: "dos" }),
      ot({ horas: 99, equipment_id: "dos" }),
    ], HASTA);
    expect(r.filas.map((f) => f.equipmentId)).toEqual(["con-numero", "dos", "una-sola"]);
  });
});

describe("la planta entera", () => {
  it("promedia todas las reparaciones contables, no los promedios por equipo", () => {
    // Un equipo con 3 de 1 h y otro con 1 de 9 h: el promedio de las cuatro
    // ordenes es 3, y el de los dos promedios por equipo seria 5.
    const r = calcularMttr([
      ...[1, 1, 1].map((h) => ot({ horas: h, equipment_id: "a" })),
      ot({ horas: 9, equipment_id: "b" }),
    ], HASTA);
    expect(r.mttrDeLaPlanta).toBe(3);
  });

  it("sin ninguna reparacion contable no inventa un cero", () => {
    const r = calcularMttr([ot({ contratista: "PIPARO" })], HASTA);
    expect(r.mttrDeLaPlanta).toBeNull();
    expect(r.filas).toEqual([]);
    expect(r.afuera.deContratista).toBe(1);
  });

  it("sin ordenes tampoco", () => {
    const r = calcularMttr([], HASTA);
    expect(r).toEqual({
      filas: [], mttrDeLaPlanta: null, reparaciones: 0,
      afuera: { deContratista: 0, sinHoras: 0, sinEquipo: 0 },
    });
  });
});

describe("buscar un equipo", () => {
  it("devuelve su fila", () => {
    const r = calcularMttr([ot({ equipment_id: "eq-7" })], HASTA);
    expect(mttrDelEquipo(r, "eq-7")?.reparaciones).toBe(1);
  });

  it("un equipo sin reparaciones es null, no es cero", () => {
    const r = calcularMttr([ot({ equipment_id: "eq-7" })], HASTA);
    expect(mttrDelEquipo(r, "eq-9")).toBeNull();
  });

  /** Si la lectura fallo no hay cuenta, y eso no es "no tuvo reparaciones". */
  it("sin cuenta tambien es null", () => {
    expect(mttrDelEquipo(null, "eq-7")).toBeNull();
  });
});

describe("como se escribe", () => {
  it("un decimal y coma", () => {
    // 3,25 es el MTTR medido de la planta el 11/11/2026. Redondea hacia
    // arriba, que es lo que hace `toFixed`, no hacia el par.
    expect(horasDeReparacion(3.25)).toBe("3,3 h");
    expect(horasDeReparacion(5.46)).toBe("5,5 h");
    expect(horasDeReparacion(12)).toBe("12,0 h");
  });

  /** Sin numero no se escribe ningun numero: un 0 h diria "no tarda nada". */
  it("sin numero, una raya", () => {
    expect(horasDeReparacion(null)).toBe("—");
  });
});

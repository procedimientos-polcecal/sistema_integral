import { describe, it, expect } from "vitest";
import { armarLosDias, type FilaParte, type FilaDeposito } from "./mes";
import type { Despacho } from "./types";

const P1 = "p1";

/** Un renglón de despacho mínimo, con lo que no se usa dejado en null/0. */
function despacho(parte_id: string, over: Partial<Despacho> = {}): Despacho {
  return {
    id: `d-${parte_id}-${over.orden ?? 1}`,
    parte_id,
    orden: 1,
    equipo_raw: null,
    cliente_raw: null,
    producto_id: P1,
    producto_raw: null,
    kilos: null,
    bultos: 0,
    envase_raw: null,
    pallets_cantidad: null,
    pallets_tipo: null,
    rotura_bolsa: 0,
    rotura_bolson: 0,
    ...over,
  };
}

function parte(id: string, fecha: string, turno: FilaParte["turno"]): FilaParte {
  return { id, fecha, turno };
}

function deposito(parte_id: string, cantidad: number): FilaDeposito {
  return { parte_id, producto_id: P1, cantidad };
}

describe("el borde del mes", () => {
  /**
   * El turno 4 a 12 del día 1 no tiene un turno anterior dentro del rango
   * traído: el suyo es el 12 a 20 del último día del mes previo, que
   * `armarElMes` trae aparte como `depositoAnteriorAlMes`. Si esta función
   * ignorara ese dato, el turno saldría "sin_parte_anterior" y con él todo
   * el día — acá se prueba que en cambio calcula.
   */
  it("el turno 4 a 12 del día 1 se despeja contra el depósito del mes anterior", () => {
    const dias = armarLosDias({
      primerDia: "2026-06-01",
      ultimoDia: "2026-06-01",
      partes: [parte("e1", "2026-06-01", "4_12"), parte("e2", "2026-06-01", "12_20")],
      filasDeposito: [deposito("e1", 20), deposito("e2", 25)],
      despachos: [despacho("e2", { bultos: 2 })],
      depositoAnteriorAlMes: { [P1]: 12 },
    });

    // turno 4_12: 20 - 12 + 0 + 0 = 8. turno 12_20: 25 - 20 + 2 + 0 = 7.
    // Si el borde no se hubiera resuelto, el turno 4_12 (y con él el día
    // entero) habría salido "sin_parte_anterior" en vez de sumar 15.
    expect(dias[0].produccion[P1]).toEqual({ estado: "calculada", cantidad: 15 });
    expect(dias[0].turnosCargados).toBe(2);
  });
});

describe("un día con los dos turnos cargados", () => {
  const dias = armarLosDias({
    primerDia: "2026-04-10",
    ultimoDia: "2026-04-11",
    partes: [
      parte("d10a", "2026-04-10", "4_12"),
      parte("d10b", "2026-04-10", "12_20"),
      parte("d11a", "2026-04-11", "4_12"),
      parte("d11b", "2026-04-11", "12_20"),
    ],
    filasDeposito: [
      deposito("d10a", 60),
      deposito("d10b", 70),
      deposito("d11a", 80),
      deposito("d11b", 95),
    ],
    despachos: [
      despacho("d10b", { orden: 1, bultos: 7, rotura_bolsa: 2 }),
      despacho("d11b", { orden: 1, bultos: 5, rotura_bolsa: 3 }),
    ],
    depositoAnteriorAlMes: { [P1]: 50 },
  });

  it("calcula el día completo cuando están los dos turnos", () => {
    // día 10: turno1 60-50+0+0=10, turno2 70-60+7+2=19 → día 29.
    // día 11: turno1 80-70+0+0=10, turno2 95-80+5+3=23 → día 33.
    expect(dias[0].produccion[P1]).toEqual({ estado: "calculada", cantidad: 29 });
    expect(dias[0].turnosCargados).toBe(2);
    expect(dias[1].produccion[P1]).toEqual({ estado: "calculada", cantidad: 33 });
    expect(dias[1].turnosCargados).toBe(2);
  });

  /**
   * El despacho y la rotura de un día no tienen que arrastrarse al
   * siguiente: cada iteración del día arranca sus propios acumuladores.
   */
  it("el despacho y la rotura de un día no se arrastran al siguiente", () => {
    expect(dias[0].despacho[P1]).toBe(7);
    expect(dias[0].rotura[P1]).toBe(2);
    expect(dias[1].despacho[P1]).toBe(5);
    expect(dias[1].rotura[P1]).toBe(3);
  });
});

describe("un día con un solo turno cargado", () => {
  // día 14: sólo el turno 12 a 20, con depósito 100 (sirve de anterior para
  // el turno 4 a 12 del día 15). día 15: sólo el turno 4 a 12, con un
  // despacho de 5 — el turno 12 a 20 de ese día no está.
  const dias = armarLosDias({
    primerDia: "2026-03-14",
    ultimoDia: "2026-03-15",
    partes: [parte("p14b", "2026-03-14", "12_20"), parte("p15a", "2026-03-15", "4_12")],
    filasDeposito: [deposito("p14b", 100), deposito("p15a", 130)],
    despachos: [despacho("p15a", { bultos: 5 })],
    depositoAnteriorAlMes: null,
  });

  it("el día queda dia_incompleto, no calculado con lo que hay", () => {
    expect(dias[1].produccion[P1]).toEqual({ estado: "dia_incompleto" });
    expect(dias[1].turnosCargados).toBe(1);
  });

  it("el despacho del turno que sí está cargado igual se suma", () => {
    // 130 - 100 (anterior, del turno 12_20 del día 14) + 5 + 0 = 35, aunque el
    // día completo no cierre: despacho y rotura no esperan a que el día cierre.
    expect(dias[1].despacho[P1]).toBe(5);
  });
});

describe("un día sin ningún parte, contra un día con parte y cero movimiento", () => {
  // día 1: los dos turnos cargados, con el depósito sin cambios y sin
  // despachos → producción calculada en 0. día 2: ningún parte.
  const dias = armarLosDias({
    primerDia: "2026-05-01",
    ultimoDia: "2026-05-02",
    partes: [parte("m1a", "2026-05-01", "4_12"), parte("m1b", "2026-05-01", "12_20")],
    filasDeposito: [deposito("m1a", 25), deposito("m1b", 25)],
    despachos: [],
    depositoAnteriorAlMes: { [P1]: 25 },
  });

  it("un día con parte y cero movimiento calcula cero, no queda vacío", () => {
    expect(dias[0].produccion[P1]).toEqual({ estado: "calculada", cantidad: 0 });
    expect(dias[0].turnosCargados).toBe(2);
  });

  /**
   * La razón de ser de `turnosCargados`: sin él, este día y el de arriba dan
   * el mismo `despacho = {}` y son indistinguibles para una pantalla que sólo
   * mira esa suma plana.
   */
  it("un día sin ningún parte no tiene el producto en produccion, y turnosCargados es 0", () => {
    expect(dias[1].produccion[P1]).toBeUndefined();
    expect(dias[1].turnosCargados).toBe(0);
    expect(dias[1].despacho).toEqual({});
  });
});

describe("un mes de 31 días", () => {
  /** La planilla de Google sólo tiene 30 filas; la pantalla no hereda ese límite. */
  it("arma los 31 días de un mes de 31, aunque no haya ningún parte", () => {
    const dias = armarLosDias({
      primerDia: "2026-01-01",
      ultimoDia: "2026-01-31",
      partes: [],
      filasDeposito: [],
      despachos: [],
      depositoAnteriorAlMes: null,
    });

    expect(dias).toHaveLength(31);
    expect(dias[0].fecha).toBe("2026-01-01");
    expect(dias[30].fecha).toBe("2026-01-31");
    expect(dias.every((d) => d.turnosCargados === 0)).toBe(true);
  });
});

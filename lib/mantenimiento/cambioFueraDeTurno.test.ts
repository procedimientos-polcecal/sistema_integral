import { describe, expect, test } from "vitest";
import { ESTADO_CANCELADA } from "@/lib/mantenimiento/cancelacion";
import {
  descripcionDelCambio,
  elMotivoDeLaRotacion,
  lasQueSalenDelCiclo,
  loQueImpideRegistrarElCambio,
  type CicloDelCambio,
  type RotacionAResolver,
} from "./cambioFueraDeTurno";

const HOY = "2026-11-26";

const ROTACION: RotacionAResolver = {
  id: "ot-rot",
  ot_number: 3150,
  ciclo_id: "c1",
  ciclo_vuelta: 3,
  estado: "ATRASADO",
};

const CICLO: CicloDelCambio = {
  repeticiones: 3,
  desde: "2026-11-14",
  tareaMadre: "Cambio de Martillos",
  tareaHija: "Rotación de Martillos",
  componente: "Martillos",
};

const BIEN = { fecha: "2026-11-24" };

/** Todos los problemas en una sola cadena, para preguntarle si nombra algo. */
const dice = (problemas: string[]) => problemas.join(" ");

describe("loQueImpideRegistrarElCambio", () => {
  test("no dice nada cuando está todo bien", () => {
    expect(loQueImpideRegistrarElCambio(ROTACION, CICLO, BIEN, HOY)).toEqual([]);
  });

  test("la fecha es obligatoria", () => {
    const p = loQueImpideRegistrarElCambio(ROTACION, CICLO, { fecha: "" }, HOY);
    expect(dice(p)).toContain("Falta decir cuándo");
  });

  test("la fecha tiene que tener forma de fecha", () => {
    const p = loQueImpideRegistrarElCambio(ROTACION, CICLO, { fecha: "24/11/2026" }, HOY);
    expect(p.length).toBeGreaterThan(0);
  });

  test("una fecha futura no se acepta", () => {
    const p = loQueImpideRegistrarElCambio(ROTACION, CICLO, { fecha: "2026-11-27" }, HOY);
    expect(dice(p)).toContain("futura");
  });

  test("una fecha anterior al último cambio nombra el piso", () => {
    const p = loQueImpideRegistrarElCambio(ROTACION, CICLO, { fecha: "2026-11-13" }, HOY);
    expect(dice(p)).toContain("14/11/2026");
  });

  test("la fecha del último cambio sí se acepta", () => {
    expect(loQueImpideRegistrarElCambio(ROTACION, CICLO, { fecha: "2026-11-14" }, HOY)).toEqual([]);
  });

  test("hoy se acepta", () => {
    expect(loQueImpideRegistrarElCambio(ROTACION, CICLO, { fecha: HOY }, HOY)).toEqual([]);
  });

  test("una orden que no es de un ciclo no entra", () => {
    const p = loQueImpideRegistrarElCambio({ ...ROTACION, ciclo_id: null }, CICLO, BIEN, HOY);
    expect(p.length).toBeGreaterThan(0);
  });

  test("la madre no es una rotación", () => {
    const p = loQueImpideRegistrarElCambio({ ...ROTACION, ciclo_vuelta: 0 }, CICLO, BIEN, HOY);
    expect(p.length).toBeGreaterThan(0);
  });

  test("una orden ya realizada no entra", () => {
    const p = loQueImpideRegistrarElCambio({ ...ROTACION, estado: "REALIZADO" }, CICLO, BIEN, HOY);
    expect(p.length).toBeGreaterThan(0);
  });

  test("una orden ya cancelada no entra", () => {
    const p = loQueImpideRegistrarElCambio({ ...ROTACION, estado: ESTADO_CANCELADA }, CICLO, BIEN, HOY);
    expect(p.length).toBeGreaterThan(0);
  });

  test("las horas tienen que ser un número", () => {
    const p = loQueImpideRegistrarElCambio(ROTACION, CICLO, { ...BIEN, horas: "cuatro" }, HOY);
    expect(dice(p)).toContain("horas");
  });

  test("las horas no pueden ser negativas", () => {
    const p = loQueImpideRegistrarElCambio(ROTACION, CICLO, { ...BIEN, horas: -1 }, HOY);
    expect(dice(p)).toContain("horas");
  });

  test("sin horas no hay problema", () => {
    expect(loQueImpideRegistrarElCambio(ROTACION, CICLO, BIEN, HOY)).toEqual([]);
    expect(loQueImpideRegistrarElCambio(ROTACION, CICLO, { ...BIEN, horas: "" }, HOY)).toEqual([]);
  });

  test("informa todos los problemas juntos", () => {
    const p = loQueImpideRegistrarElCambio(
      { ...ROTACION, ciclo_vuelta: 0 }, CICLO, { fecha: "" }, HOY
    );
    expect(p).toHaveLength(2);
  });

  test("un ciclo sin arrancar no pone piso", () => {
    const p = loQueImpideRegistrarElCambio(
      ROTACION, { ...CICLO, desde: null }, { fecha: "2020-01-01" }, HOY
    );
    expect(p).toEqual([]);
  });
});

describe("descripcionDelCambio", () => {
  test("nombra la cara, la vuelta y la OT que se cancela", () => {
    expect(descripcionDelCambio(CICLO, ROTACION)).toBe(
      "Cambio de Martillos — se hizo antes de la rotación a 4ª cara (3 de 3), " +
      "que quedó cancelada en la OT 3150."
    );
  });

  test("sin número de OT no inventa uno", () => {
    expect(descripcionDelCambio(CICLO, { ...ROTACION, ot_number: null })).toBe(
      "Cambio de Martillos — se hizo antes de la rotación a 4ª cara (3 de 3), " +
      "que quedó cancelada."
    );
  });
});

describe("elMotivoDeLaRotacion", () => {
  test("dice el día y nombra la orden del cambio", () => {
    expect(elMotivoDeLaRotacion(CICLO, "2026-11-24", 3211)).toBe(
      "Los martillos se cambiaron el 24/11/2026, antes de que tocara esta " +
      "rotación. Quedó registrado en la OT 3211 y esta orden ya no corresponde."
    );
  });
});

describe("lasQueSalenDelCiclo", () => {
  const OTS = [
    { id: "a", created_at_app: "2026-11-13T10:00:00Z" },
    { id: "b", created_at_app: "2026-11-24T09:00:00Z" },
    { id: "c", created_at_app: "2026-11-25T09:00:00Z" },
  ];

  test("saca las nacidas el día del cambio o después", () => {
    expect(lasQueSalenDelCiclo(OTS, "2026-11-24", [])).toEqual(["b", "c"]);
  });

  test("no saca las que ya se resolvieron", () => {
    expect(lasQueSalenDelCiclo(OTS, "2026-11-24", ["b"])).toEqual(["c"]);
  });

  test("una sin created_at_app se queda", () => {
    const con = [...OTS, { id: "d", created_at_app: null }];
    expect(lasQueSalenDelCiclo(con, "2026-11-24", [])).toEqual(["b", "c"]);
  });
});

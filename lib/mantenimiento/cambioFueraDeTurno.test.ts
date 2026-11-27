import { describe, expect, test } from "vitest";
import { ESTADO_CANCELADA } from "@/lib/mantenimiento/cancelacion";
import { MAXIMO_DE_NOTA } from "@/lib/mantenimiento/notas";
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
  fecha_cierre: null,
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

  /*
   * El estado no alcanza para saber si la orden sigue abierta, y el camino que
   * lo rompe está vivo: «Registrar el trabajo» con resultado **Parcial** deja
   * la orden `EN_PROCESO` **con** `fecha_cierre`. Sin esta regla, dos pestañas
   * —una registra el parcial, la otra aprieta «Fue un cambio»— dejan una
   * `CANCELADA` con fecha de cierre, que es justo la fila que
   * `loQueImpideCancelar` trata como error duro: `costoEquipo` la cobra como
   * gasto real y la columna K del master la muestra con día de cierre.
   */
  test("una orden con fecha de cierre se rechaza aunque su estado diga abierta", () => {
    const p = loQueImpideRegistrarElCambio(
      { ...ROTACION, estado: "EN_PROCESO", fecha_cierre: "2026-11-25" },
      CICLO, BIEN, HOY
    );
    expect(dice(p)).toMatch(/fecha de cierre/i);
  });

  test("la rotación abierta sin fecha de cierre sigue pasando", () => {
    expect(
      loQueImpideRegistrarElCambio({ ...ROTACION, fecha_cierre: null }, CICLO, BIEN, HOY)
    ).toEqual([]);
  });

  /*
   * La forma sola no alcanza: `2026-02-30` cumple cualquier regex de
   * `AAAA-MM-DD`. Si pasa, la ruta escribe la fila en la planilla —y consume el
   * número— antes de que el `insert` reviente contra una columna `date`, que
   * es el peor de los finales partidos: la orden existe sólo en la planilla y
   * la sincronización la trae sin `ciclo_id`. Por eso se pregunta con
   * `esFechaIso`, que reconstruye la fecha, y no con una regex propia.
   */
  test("un día que no existe no es una fecha", () => {
    const p = loQueImpideRegistrarElCambio(ROTACION, CICLO, { fecha: "2026-02-30" }, HOY);
    expect(dice(p)).toMatch(/día del calendario/i);
  });

  /*
   * El motivo que escribe una persona es optativo: la frase automática ya dice
   * lo que una cancelada necesita decir —cuándo se cambió y en qué OT quedó—,
   * así que exigirlo sería pedir que repitan lo que el sistema ya sabe.
   */
  test("el motivo escrito a mano no es obligatorio", () => {
    expect(loQueImpideRegistrarElCambio(ROTACION, CICLO, BIEN, HOY)).toEqual([]);
    expect(
      loQueImpideRegistrarElCambio(ROTACION, CICLO, { ...BIEN, motivo: "   " }, HOY)
    ).toEqual([]);
  });

  /*
   * El tope se mide contra lo que **queda** después de la frase automática, no
   * contra los 1.000 pelados: las dos cosas terminan en la misma celda de la
   * columna X, y validar sólo la parte tipeada dejaría pasar una nota de 1.120.
   */
  test("un motivo que no entra en la celda se rechaza, y dice cuánto entra", () => {
    const p = loQueImpideRegistrarElCambio(
      ROTACION, CICLO, { ...BIEN, motivo: "x".repeat(MAXIMO_DE_NOTA) }, HOY
    );
    expect(dice(p)).toMatch(/no puede pasar de \d+ caracteres/i);
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

describe("elMotivoDeLaRotacion con lo que escribió una persona", () => {
  /*
   * Se suma, nunca reemplaza: la frase automática es la que nombra la OT del
   * cambio, y es de lo único de lo que se puede agarrar quien después busque
   * el trabajo que sí se hizo.
   */
  test("suma lo escrito al final y conserva la frase automática", () => {
    const texto = elMotivoDeLaRotacion(CICLO, "2026-11-24", 3211, "Se partieron dos.");
    expect(texto).toContain("Quedó registrado en la OT 3211");
    expect(texto).toContain("Se partieron dos.");
  });

  test("sin nada escrito queda igual que antes", () => {
    expect(elMotivoDeLaRotacion(CICLO, "2026-11-24", 3211, "   ")).toBe(
      elMotivoDeLaRotacion(CICLO, "2026-11-24", 3211)
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

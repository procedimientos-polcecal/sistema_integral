import { describe, expect, it } from "vitest";
import { franjaDeLaSemana } from "./rotacionDeLaSemana";
import type { FilaDeReferencia } from "./referenciaDelTaller";
import type {
  AusenciaCruda,
  FrancoCrudo,
  PersonaDelTaller,
} from "./disponibilidad";

/*
 * El padrón de prueba imita al real: dos mecánicos repartidos en A y B, un
 * lubricador en A, y los tres electricistas sin grupo —que es como están en
 * producción, porque su ciclo es el de los tres turnos y no el de los grupos—.
 */
const persona = (
  empleadoId: string,
  oficio: PersonaDelTaller["oficio"],
  grupo: PersonaDelTaller["grupo"],
  extra: Partial<PersonaDelTaller> = {},
): PersonaDelTaller => ({
  empleadoId,
  oficio,
  grupo,
  desde: "2026-01-01",
  hasta: null,
  ...extra,
});

const PADRON: PersonaDelTaller[] = [
  persona("mecA", "mecanico", "A"),
  persona("mecB", "mecanico", "B"),
  persona("lubA", "lubricador", "A"),
  persona("ele1", "electricista", null),
  persona("ele2", "electricista", null),
  persona("ele3", "electricista", null),
];

const NOMBRES = new Map([
  ["mecA", "Mecánico A"],
  ["mecB", "Mecánico B"],
  ["lubA", "Lubricador A"],
  ["ele1", "Electricista 1"],
  ["ele2", "Electricista 2"],
  ["ele3", "Electricista 3"],
]);

const REF: FilaDeReferencia = {
  lunes: "2026-11-09",
  grupo_en_4a12: "A",
  electricista_4a12_id: "ele1",
  electricista_8a16_id: "ele2",
  electricista_12a20_id: "ele3",
};

const ausencia = (
  empleadoId: string,
  desde: string,
  hasta: string,
  tipo = "ENFERMEDAD",
): AusenciaCruda => ({
  empleado_id: empleadoId,
  fecha_desde: desde,
  fecha_hasta: hasta,
  tipo,
});

const franco = (empleadoId: string, dia: string | null): FrancoCrudo => ({
  empleado_id: empleadoId,
  estado: "TOMADO",
  fecha_descanso: dia,
});

/** Los nombres de un turno, ordenados, para comparar sin depender del orden. */
const enElTurno = (
  f: ReturnType<typeof franjaDeLaSemana>,
  turno: "4-12" | "8-16" | "12-20",
) => f.porTurno![turno].map((p) => p.nombre).sort();

describe("la franja de una semana", () => {
  it("reparte a cada uno en el turno que le da el ciclo esa semana", () => {
    const f = franjaDeLaSemana("2026-11-09", PADRON, NOMBRES, [REF], [], [], []);
    expect(enElTurno(f, "4-12")).toEqual([
      "Electricista 1",
      "Lubricador A",
      "Mecánico A",
    ]);
    expect(enElTurno(f, "8-16")).toEqual(["Electricista 2"]);
    expect(enElTurno(f, "12-20")).toEqual(["Electricista 3", "Mecánico B"]);
  });

  it("la semana siguiente los grupos estan dados vuelta", () => {
    const f = franjaDeLaSemana("2026-11-16", PADRON, NOMBRES, [REF], [], [], []);
    expect(enElTurno(f, "4-12")).toEqual(["Electricista 3", "Mecánico B"]);
    expect(enElTurno(f, "12-20")).toEqual([
      "Electricista 2",
      "Lubricador A",
      "Mecánico A",
    ]);
  });

  it("sin ninguna referencia, porTurno es null y sinTurno trae a todos", () => {
    const f = franjaDeLaSemana("2026-11-09", PADRON, NOMBRES, [], [], [], []);
    expect(f.porTurno).toBeNull();
    expect(f.sinTurno).toHaveLength(PADRON.length);
  });

  it("un mecanico sin grupo queda en sinTurno y no desaparece", () => {
    const padron = [...PADRON, persona("mecSinGrupo", "mecanico", null)];
    const f = franjaDeLaSemana("2026-11-09", padron, NOMBRES, [REF], [], [], []);
    expect(f.sinTurno.map((p) => p.empleadoId)).toEqual(["mecSinGrupo"]);
    const ubicados = Object.values(f.porTurno!).flat();
    expect(ubicados.some((p) => p.empleadoId === "mecSinGrupo")).toBe(false);
  });

  it("una ausencia marca solo los dias que toca, no la semana entera", () => {
    const f = franjaDeLaSemana(
      "2026-11-09",
      PADRON,
      NOMBRES,
      [REF],
      [ausencia("mecA", "2026-11-10", "2026-11-11")],
      [],
      [],
    );
    const mecA = f.porTurno!["4-12"].find((p) => p.empleadoId === "mecA")!;
    expect(mecA.diasQueFalta).toEqual(["2026-11-10", "2026-11-11"]);
  });

  it("quien no falta ningun dia tiene la lista vacia", () => {
    const f = franjaDeLaSemana("2026-11-09", PADRON, NOMBRES, [REF], [], [], []);
    const mecA = f.porTurno!["4-12"].find((p) => p.empleadoId === "mecA")!;
    expect(mecA.diasQueFalta).toEqual([]);
  });

  it("una TARDANZA no cuenta como falta", () => {
    const f = franjaDeLaSemana(
      "2026-11-09",
      PADRON,
      NOMBRES,
      [REF],
      [ausencia("mecA", "2026-11-10", "2026-11-10", "TARDANZA")],
      [],
      [],
    );
    const mecA = f.porTurno!["4-12"].find((p) => p.empleadoId === "mecA")!;
    expect(mecA.diasQueFalta).toEqual([]);
  });

  it("un franco con su dia abre hueco ese dia", () => {
    const f = franjaDeLaSemana(
      "2026-11-09",
      PADRON,
      NOMBRES,
      [REF],
      [],
      [franco("mecA", "2026-11-12")],
      [],
    );
    const mecA = f.porTurno!["4-12"].find((p) => p.empleadoId === "mecA")!;
    expect(mecA.diasQueFalta).toEqual(["2026-11-12"]);
  });

  it("un franco sin fecha_descanso no abre hueco", () => {
    const f = franjaDeLaSemana(
      "2026-11-09",
      PADRON,
      NOMBRES,
      [REF],
      [],
      [franco("mecA", null)],
      [],
    );
    const mecA = f.porTurno!["4-12"].find((p) => p.empleadoId === "mecA")!;
    expect(mecA.diasQueFalta).toEqual([]);
  });

  it("dos filas de padron vigentes el mismo dia dan una sola persona", () => {
    const padron: PersonaDelTaller[] = [
      persona("e1", "mecanico", "A", { desde: "2026-01-01", hasta: "2026-11-11" }),
      persona("e1", "mecanico", "B", { desde: "2026-11-12", hasta: null }),
    ];
    const f = franjaDeLaSemana("2026-11-09", padron, NOMBRES, [REF], [], [], []);
    const todos = Object.values(f.porTurno!).flat().concat(f.sinTurno);
    expect(todos.filter((p) => p.empleadoId === "e1")).toHaveLength(1);
  });

  it("alguien que no esta vigente ningun dia de la semana no aparece", () => {
    const padron = [
      persona("viejo", "mecanico", "A", { desde: "2026-01-01", hasta: "2026-10-31" }),
    ];
    const f = franjaDeLaSemana("2026-11-09", padron, NOMBRES, [REF], [], [], []);
    expect(Object.values(f.porTurno!).flat()).toHaveLength(0);
    expect(f.sinTurno).toHaveLength(0);
  });

  it("cuenta los dias con pisada, sin importar cuantas pisadas tenga cada dia", () => {
    const f = franjaDeLaSemana("2026-11-09", PADRON, NOMBRES, [REF], [], [], [
      { empleado_id: "mecA", dia: "2026-11-10" },
      { empleado_id: "mecB", dia: "2026-11-10" },
      { empleado_id: "mecA", dia: "2026-11-12" },
    ]);
    expect(f.diasConPisada).toBe(2);
  });

  it("las pisadas de otra semana no se cuentan", () => {
    const f = franjaDeLaSemana("2026-11-09", PADRON, NOMBRES, [REF], [], [], [
      { empleado_id: "mecA", dia: "2026-11-17" },
    ]);
    expect(f.diasConPisada).toBe(0);
  });

  it("la franja dice de que lunes es", () => {
    expect(franjaDeLaSemana("2026-11-09", PADRON, NOMBRES, [REF], [], [], []).lunes)
      .toBe("2026-11-09");
  });

  /*
   * La franja es el ciclo: una pisada cambia el turno de UN día y la franja
   * habla de la semana. Ubicar a alguien por su pisada dejaría la franja
   * diciendo de toda la semana algo que vale un día. El turno real del día lo
   * resuelve `turnoDelDia` de `asignarOperario.ts`.
   */
  it("una pisada no mueve a nadie de turno en la franja, solo se cuenta", () => {
    const f = franjaDeLaSemana("2026-11-09", PADRON, NOMBRES, [REF], [], [], [
      { empleado_id: "mecA", dia: "2026-11-10" },
    ]);
    expect(enElTurno(f, "4-12")).toContain("Mecánico A");
    expect(f.diasConPisada).toBe(1);
  });
});

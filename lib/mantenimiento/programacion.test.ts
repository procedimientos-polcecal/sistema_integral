import { it, expect } from "vitest";
import { semanaDe } from "@/lib/core/fechas";
import {
  type Referencia,
  semanasDesdeLaReferencia,
  turnoDelGrupo,
  turnoDelElectricista,
} from "./programacion";

const REF: Referencia = {
  lunes: "2026-10-19",
  grupoEn4a12: "A",
  electricistas: { "4-12": "e1", "8-16": "e2", "12-20": "e3" },
};

it("los grupos se dan vuelta cada semana", () => {
  expect(turnoDelGrupo(REF, "2026-10-19", "A")).toBe("4-12");
  expect(turnoDelGrupo(REF, "2026-10-19", "B")).toBe("12-20");
  expect(turnoDelGrupo(REF, "2026-10-26", "A")).toBe("12-20");
  expect(turnoDelGrupo(REF, "2026-11-02", "A")).toBe("4-12");
});

it("el grupo B nunca va a 8 a 16", () => {
  for (let i = 0; i < 6; i++) {
    const lunes = semanaDe(REF.lunes, i)[0];
    expect(turnoDelGrupo(REF, lunes, "B")).not.toBe("8-16");
  }
});

it("cada electricista avanza un turno por semana", () => {
  expect(turnoDelElectricista(REF, "2026-10-19", "e1")).toBe("4-12");
  expect(turnoDelElectricista(REF, "2026-10-26", "e1")).toBe("8-16");
  expect(turnoDelElectricista(REF, "2026-11-02", "e1")).toBe("12-20");
  expect(turnoDelElectricista(REF, "2026-11-09", "e1")).toBe("4-12");
});

it("el cuadro entero se repite recien a las 6 semanas", () => {
  const foto = (lunes: string) => [
    turnoDelGrupo(REF, lunes, "A"),
    turnoDelElectricista(REF, lunes, "e1"),
  ].join("|");
  const semana1 = foto("2026-10-19");
  for (let i = 1; i < 6; i++) {
    expect(foto(semanaDe(REF.lunes, i)[0])).not.toBe(semana1);
  }
  expect(foto(semanaDe(REF.lunes, 6)[0])).toBe(semana1);
});

// En JavaScript `-1 % 3` es `-1` y no `2`: sin normalizar, una semana anterior a
// la referencia daría un índice negativo y un turno `undefined`. Con -1 sólo se
// ve si falta la normalización; con -2 se ve también si está mal hecha (por
// ejemplo, tomando el valor absoluto, que da bien en -1 y mal en -2).
it("una semana anterior a la referencia no se va a negativo", () => {
  expect(turnoDelGrupo(REF, "2026-10-12", "A")).toBe("12-20");
  expect(turnoDelElectricista(REF, "2026-10-12", "e1")).toBe("12-20");
  expect(turnoDelElectricista(REF, "2026-10-05", "e1")).toBe("8-16");
  expect(turnoDelGrupo(REF, "2026-10-05", "A")).toBe("4-12");
  expect(semanasDesdeLaReferencia("2026-10-19", "2026-09-21")).toBe(-4);
});

it("alguien que no es electricista de la referencia no tiene turno", () => {
  expect(turnoDelElectricista(REF, "2026-10-19", "e9")).toBeNull();
});

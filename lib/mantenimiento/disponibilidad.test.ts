import { it, expect } from "vitest";
import {
  type Asignacion,
  type PersonaDelTaller,
  TIPOS_QUE_NO_SON_FALTA,
  candidatosParaElHueco,
  estaAusente,
  estaVigente,
} from "./disponibilidad";

const persona = (
  empleadoId: string,
  oficio: PersonaDelTaller["oficio"],
  grupo: PersonaDelTaller["grupo"] = null,
): PersonaDelTaller => ({ empleadoId, oficio, grupo, desde: "2026-01-01", hasta: null });

const NADIE_FALTA = () => false;

// El rango de la ausencia se compara por dia, no por semana
it("una ausencia que arranca el jueves no vacia el lunes", () => {
  const a = [{ empleado_id: "m1", fecha_desde: "2026-10-22", fecha_hasta: "2026-10-30", tipo: "PERMISO_PERSONAL" }];
  expect(estaAusente(a, "m1", "2026-10-19")).toBe(false);
  expect(estaAusente(a, "m1", "2026-10-22")).toBe(true);
  expect(estaAusente(a, "m1", "2026-10-30")).toBe(true);
  expect(estaAusente(a, "m1", "2026-10-31")).toBe(false);
});

it("una tardanza no es una falta", () => {
  const a = [{ empleado_id: "m1", fecha_desde: "2026-10-19", fecha_hasta: "2026-10-19", tipo: "TARDANZA" }];
  expect(estaAusente(a, "m1", "2026-10-19")).toBe(false);
});

it("una ausencia injustificada si lo es", () => {
  const a = [{ empleado_id: "m1", fecha_desde: "2026-10-19", fecha_hasta: "2026-10-19", tipo: "INJUSTIFICADA" }];
  expect(estaAusente(a, "m1", "2026-10-19")).toBe(true);
});

it("la ausencia de otro empleado no cuenta", () => {
  const a = [{ empleado_id: "m2", fecha_desde: "2026-10-19", fecha_hasta: "2026-10-19", tipo: "INJUSTIFICADA" }];
  expect(estaAusente(a, "m1", "2026-10-19")).toBe(false);
});

it("la tardanza es lo unico que no es falta", () => {
  expect(TIPOS_QUE_NO_SON_FALTA).toEqual(["TARDANZA"]);
});

// Una semana pasada no se reescribe cuando alguien se va o cambia de grupo
it("alguien que se fue no esta vigente despues de su ultimo dia", () => {
  const p = { empleadoId: "m1", oficio: "mecanico", grupo: "A", desde: "2026-01-01", hasta: "2026-10-20" } as const;
  expect(estaVigente(p, "2026-10-20")).toBe(true);
  expect(estaVigente(p, "2026-10-21")).toBe(false);
  expect(estaVigente(p, "2025-12-31")).toBe(false);
});

it("quien no tiene fecha de salida esta vigente desde que entra", () => {
  const p = persona("m1", "mecanico", "A");
  expect(estaVigente(p, "2026-01-01")).toBe(true);
  expect(estaVigente(p, "2030-01-01")).toBe(true);
});

it("sugiere del mismo oficio y que no este ya en ese turno", () => {
  const padron = [
    persona("m1", "mecanico", "A"),
    persona("m2", "mecanico", "A"),
    persona("m3", "mecanico", "B"),
    persona("e1", "electricista"),
  ];
  const asignaciones: Asignacion[] = [
    { empleadoId: "m2", dia: "2026-10-19", turno: "4-12", pisada: false },
  ];
  const r = candidatosParaElHueco(asignaciones, NADIE_FALTA, padron, {
    dia: "2026-10-19",
    turno: "4-12",
    oficio: "mecanico",
  });
  // m2 ya esta en 4-12 ese dia, e1 es de otro oficio
  expect(r.sort()).toEqual(["m1", "m3"]);
});

it("estar en ese turno otro dia no impide ser candidato", () => {
  const padron = [persona("m1", "mecanico", "A")];
  const asignaciones: Asignacion[] = [
    { empleadoId: "m1", dia: "2026-10-20", turno: "4-12", pisada: false },
  ];
  const r = candidatosParaElHueco(asignaciones, NADIE_FALTA, padron, {
    dia: "2026-10-19",
    turno: "4-12",
    oficio: "mecanico",
  });
  expect(r).toEqual(["m1"]);
});

it("no sugiere a quien esta ausente ese dia", () => {
  const padron = [persona("m1", "mecanico", "A"), persona("m2", "mecanico", "B")];
  const ausentes = (id: string, dia: string) => id === "m1" && dia === "2026-10-19";
  const r = candidatosParaElHueco([], ausentes, padron, {
    dia: "2026-10-19",
    turno: "12-20",
    oficio: "mecanico",
  });
  expect(r).toEqual(["m2"]);
  // y ese mismo dia siguiente si vuelve a ser candidato
  const otroDia = candidatosParaElHueco([], ausentes, padron, {
    dia: "2026-10-20",
    turno: "12-20",
    oficio: "mecanico",
  });
  expect(otroDia.sort()).toEqual(["m1", "m2"]);
});

it("no sugiere a quien ya no esta vigente ese dia", () => {
  const padron = [
    { ...persona("m1", "mecanico", "A"), hasta: "2026-10-18" },
    { ...persona("m2", "mecanico", "B"), desde: "2026-10-26" },
    persona("m3", "mecanico", "B"),
  ];
  const r = candidatosParaElHueco([], NADIE_FALTA, padron, {
    dia: "2026-10-19",
    turno: "4-12",
    oficio: "mecanico",
  });
  expect(r).toEqual(["m3"]);
});

// Sugerirlo dos veces lo pondria en dos lugares a la vez
it("no sugiere a quien ya fue movido a ese turno ese dia", () => {
  const padron = [persona("m1", "mecanico", "A"), persona("m2", "mecanico", "B")];
  const asignaciones: Asignacion[] = [
    { empleadoId: "m1", dia: "2026-10-19", turno: "4-12", pisada: true },
  ];
  const r = candidatosParaElHueco(asignaciones, NADIE_FALTA, padron, {
    dia: "2026-10-19",
    turno: "4-12",
    oficio: "mecanico",
  });
  expect(r).toEqual(["m2"]);
});

it("sugiere a alguien del otro turno aunque eso deje corto al suyo", () => {
  const padron = [persona("m1", "mecanico", "A")];
  // m1 es el unico en 12-20 ese dia: moverlo a 4-12 dejaria vacio el 12-20
  const asignaciones: Asignacion[] = [
    { empleadoId: "m1", dia: "2026-10-19", turno: "12-20", pisada: false },
  ];
  const r = candidatosParaElHueco(asignaciones, NADIE_FALTA, padron, {
    dia: "2026-10-19",
    turno: "4-12",
    oficio: "mecanico",
  });
  expect(r).toEqual(["m1"]);
});

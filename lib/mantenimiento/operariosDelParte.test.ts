import { describe, expect, it } from "vitest";
import {
  TURNOS_DEL_PARTE,
  elTurnoDelTaller,
  repartirPorTurno,
  type PersonaParaElParte,
} from "./operariosDelParte";

const gente: PersonaParaElParte[] = [
  { empleadoId: "m1", nombre: "AGUIRRE, GABRIEL", turno: "4-12" },
  { empleadoId: "m2", nombre: "PIPARO, LAUTARO", turno: "4-12" },
  { empleadoId: "m3", nombre: "MENDIZABAL, LUCAS", turno: "12-20" },
  { empleadoId: "e1", nombre: "PICART, ROBERTO", turno: "8-16" },
  { empleadoId: "e2", nombre: "GARCIA ARIAS, GERONIMO", turno: "12-20" },
  { empleadoId: "x1", nombre: "AGOSTA, HORACIO", turno: null },
];

describe("elTurnoDelTaller", () => {
  it("traduce los dos turnos del papel a los del taller", () => {
    // El parte usa el vocabulario de Producción (`4_12`) y el taller el suyo
    // (`4-12`). Son los mismos números de reloj escritos distinto, y tener dos
    // vocabularios sin una traducción explícita ya rompió un filtro.
    expect(elTurnoDelTaller("4_12")).toBe("4-12");
    expect(elTurnoDelTaller("12_20")).toBe("12-20");
  });

  it("«todo el día» no es un turno del taller", () => {
    expect(elTurnoDelTaller("todo_el_dia")).toBeNull();
  });
});

describe("repartirPorTurno", () => {
  it("pone primero a los del turno elegido y el resto aparte", () => {
    const r = repartirPorTurno(gente, "4_12");
    expect(r.delTurno.map((p) => p.nombre)).toEqual(["AGUIRRE, GABRIEL", "PIPARO, LAUTARO"]);
    expect(r.losDemas.map((p) => p.empleadoId)).toEqual(["x1", "e2", "m3", "e1"]);
  });

  it("el electricista de 8 a 16 NUNCA es «del turno», pero siempre está a mano", () => {
    // Su turno no existe en el papel, que tiene dos. Se confirmó que igual
    // puede figurar en cualquiera de las dos hojas, así que no se lo esconde:
    // queda en «los demás».
    for (const turno of ["4_12", "12_20"] as const) {
      const r = repartirPorTurno(gente, turno);
      expect(r.delTurno.some((p) => p.empleadoId === "e1")).toBe(false);
      expect(r.losDemas.some((p) => p.empleadoId === "e1")).toBe(true);
    }
  });

  it("con «todo el día» no hay dos listas: están todos juntos", () => {
    const r = repartirPorTurno(gente, "todo_el_dia");
    expect(r.delTurno).toEqual([]);
    expect(r.losDemas).toHaveLength(gente.length);
  });

  it("sin referencia cargada nadie tiene turno, y entran todos en «los demás»", () => {
    // Es el estado real al escribir esto: 0 semanas de referencia. Si la lista
    // del turno quedara vacía Y la otra también, la pantalla no serviría.
    const sinTurno = gente.map((p) => ({ ...p, turno: null }));
    const r = repartirPorTurno(sinTurno, "4_12");
    expect(r.delTurno).toEqual([]);
    expect(r.losDemas).toHaveLength(gente.length);
  });

  it("cada lista va alfabética, para que el mismo padrón dé siempre el mismo orden", () => {
    const r = repartirPorTurno(gente, "12_20");
    expect(r.delTurno.map((p) => p.nombre)).toEqual(["GARCIA ARIAS, GERONIMO", "MENDIZABAL, LUCAS"]);
  });

  it("nadie aparece en las dos listas, y no se pierde nadie", () => {
    for (const turno of TURNOS_DEL_PARTE) {
      const r = repartirPorTurno(gente, turno);
      const ids = [...r.delTurno, ...r.losDemas].map((p) => p.empleadoId);
      expect(new Set(ids).size).toBe(gente.length);
    }
  });
});

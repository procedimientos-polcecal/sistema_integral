import { describe, it, expect } from "vitest";
import { turnoDefaultDe, repartirPorTurno } from "./empleadosDelTurno";

const MANANA = "turno-manana";
const NOCHE = "turno-noche";

function emp(id: string, turno: string | null | undefined, comoArray = false) {
  const datos = turno === undefined ? null : { turno_default_id: turno };
  return { id, remises_empleados_datos: comoArray ? (datos ? [datos] : []) : datos };
}

describe("turnoDefaultDe", () => {
  it("lee el embed como objeto, que es como lo devuelve la API hoy", () => {
    expect(turnoDefaultDe(emp("a", MANANA))).toBe(MANANA);
  });

  it("lee el embed como array, la otra forma que usa PostgREST", () => {
    expect(turnoDefaultDe(emp("a", MANANA, true))).toBe(MANANA);
  });

  it("da null cuando el empleado no tiene datos de Remises", () => {
    expect(turnoDefaultDe(emp("a", undefined))).toBeNull();
    expect(turnoDefaultDe(emp("a", undefined, true))).toBeNull();
    expect(turnoDefaultDe(emp("a", null))).toBeNull();
  });
});

describe("repartirPorTurno", () => {
  it("muestra sólo a los del turno elegido", () => {
    const r = repartirPorTurno([emp("a", MANANA), emp("b", NOCHE)], MANANA, new Set());
    expect(r.visibles.map((e) => e.id)).toEqual(["a"]);
    expect(r.deOtroTurno).toBe(1);
  });

  /*
   * El caso que decide el diseño. Medido el 05/11/2026 sobre los datos reales:
   * 150 de 501 registros de asistencia —el 30 %, en 22 fechas distintas— son
   * gente marcada en un turno que NO es su default. Un filtro que mirara sólo
   * `turno_default_id` los haría desaparecer de la pantalla, y entonces no se
   * los podría ni ver ni desmarcar: el registro quedaría vivo en la base y
   * fuera del alcance de la persona que lo cargó. Sería peor que el bug que
   * esto arregla.
   */
  it("incluye a quien ya está marcado en este turno aunque su default sea otro", () => {
    const r = repartirPorTurno([emp("a", MANANA), emp("b", NOCHE)], MANANA, new Set(["b"]));
    expect(r.visibles.map((e) => e.id)).toEqual(["a", "b"]);
    expect(r.deOtroTurno).toBe(0);
  });

  it("deja afuera a los que no tienen datos de Remises, y los cuenta aparte", () => {
    // Son 44 de 69 empleados activos: sin dirección ni coordenadas, no pueden
    // entrar en ninguna ruta. Se cuentan para poder decirlo en pantalla en vez
    // de hacerlos desaparecer sin explicación.
    const r = repartirPorTurno([emp("a", MANANA), emp("x", undefined)], MANANA, new Set());
    expect(r.visibles.map((e) => e.id)).toEqual(["a"]);
    expect(r.sinDatos).toBe(1);
  });

  it("muestra igual a uno sin datos de Remises si está marcado", () => {
    const r = repartirPorTurno([emp("x", undefined)], MANANA, new Set(["x"]));
    expect(r.visibles.map((e) => e.id)).toEqual(["x"]);
    expect(r.sinDatos).toBe(0);
  });

  it("conserva el orden en que vienen, que ya es por apellido y nombre", () => {
    const r = repartirPorTurno(
      [emp("c", MANANA), emp("a", MANANA), emp("b", MANANA)],
      MANANA,
      new Set(),
    );
    expect(r.visibles.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  /*
   * Sin turno elegido no hay con qué filtrar, y esconder a todo el mundo sería
   * una pantalla vacía sin explicación. Pasa cuando no hay ningún turno activo
   * configurado: la botonera no se dibuja y `turnoId` queda en "".
   */
  it("sin turno elegido muestra a todos, como antes", () => {
    const r = repartirPorTurno([emp("a", MANANA), emp("b", NOCHE), emp("x", undefined)], "", new Set());
    expect(r.visibles.map((e) => e.id)).toEqual(["a", "b", "x"]);
    expect(r.sinDatos).toBe(0);
    expect(r.deOtroTurno).toBe(0);
  });

  it("no cuenta dos veces a un marcado que además es del turno", () => {
    const r = repartirPorTurno([emp("a", MANANA)], MANANA, new Set(["a"]));
    expect(r.visibles.map((e) => e.id)).toEqual(["a"]);
    expect(r.visibles).toHaveLength(1);
  });
});

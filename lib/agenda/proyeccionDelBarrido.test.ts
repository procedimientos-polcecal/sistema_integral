import { describe, expect, it } from "vitest";
import { proyectarElBarrido } from "./proyeccionDelBarrido";

const orden = (n: number, especialidad: string | null = "MECÁNICO") => ({
  id: `id-${n}`,
  ot_number: 3000 + n,
  especialidad,
});

const TURNO = "8-16";

describe("proyectarElBarrido: lo que el barrido mandaria, sin escribir nada", () => {
  it("las de un mismo dia y especialidad se apilan de a 1:30 desde las 08:00", () => {
    const faltan = [1, 2, 3, 4].map((n) => ({ orden: orden(n), fecha: "2026-11-04" }));
    const { van } = proyectarElBarrido(faltan, TURNO, () => 0, 25);
    expect(van.map((v) => v.inicio.slice(11, 16))).toEqual(["08:00", "09:30", "11:00", "12:30"]);
  });

  it("una especialidad distinta arranca a las 08:00 aunque haya mecanicas ese dia", () => {
    const faltan = [
      { orden: orden(1), fecha: "2026-11-06" },
      { orden: orden(2, "CIVIL"), fecha: "2026-11-06" },
      { orden: orden(3), fecha: "2026-11-06" },
    ];
    const { van } = proyectarElBarrido(faltan, TURNO, () => 0, 25);
    expect(van.map((v) => v.inicio.slice(11, 16))).toEqual(["08:00", "08:00", "09:30"]);
  });

  it("suma lo que la base ya tiene ese dia en ese grupo", () => {
    const faltan = [{ orden: orden(1), fecha: "2026-11-06" }];
    const { van } = proyectarElBarrido(faltan, TURNO, () => 2, 25);
    expect(van[0].inicio).toBe("2026-11-06T11:00:00");
  });

  it("la base se pregunta por el grupo completo: dia, especialidad y turno", () => {
    const preguntas: string[] = [];
    proyectarElBarrido(
      [{ orden: orden(1, "civil"), fecha: "2026-11-06" }, { orden: orden(2, "CIVIL "), fecha: "2026-11-06" }],
      TURNO,
      (clave) => { preguntas.push(clave); return 0; },
      25
    );
    // Una sola vez por grupo, y con la especialidad normalizada.
    expect(preguntas).toEqual(["2026-11-06|CIVIL|8-16"]);
  });

  it("dias distintos no se cuentan entre si", () => {
    const faltan = [
      { orden: orden(1), fecha: "2026-11-04" },
      { orden: orden(2), fecha: "2026-11-05" },
    ];
    const { van } = proyectarElBarrido(faltan, TURNO, () => 0, 25);
    expect(van.map((v) => v.inicio.slice(11, 16))).toEqual(["08:00", "08:00"]);
  });

  it("el tope corta por cantidad y dice cuantas quedan", () => {
    const faltan = [1, 2, 3, 4, 5].map((n) => ({ orden: orden(n), fecha: "2026-11-04" }));
    const { van, quedan } = proyectarElBarrido(faltan, TURNO, () => 0, 3);
    expect(van).toHaveLength(3);
    expect(quedan).toBe(2);
  });

  it("de la decima en adelante comparte las 20:00 y se marca topeada", () => {
    const faltan = Array.from({ length: 10 }, (_, i) => ({ orden: orden(i), fecha: "2026-11-04" }));
    const { van } = proyectarElBarrido(faltan, TURNO, () => 0, 25);
    expect(van[8].topeado).toBe(false);
    expect(van[9].topeado).toBe(true);
    expect(van[9].inicio.slice(11, 16)).toBe("20:00");
  });

  it("una fecha imposible no entra a la proyeccion y se nombra", () => {
    const { van, sinHorario } = proyectarElBarrido([{ orden: orden(1), fecha: "2026-13-45" }], TURNO, () => 0, 25);
    expect(van).toEqual([]);
    expect(sinHorario).toHaveLength(1);
  });
});

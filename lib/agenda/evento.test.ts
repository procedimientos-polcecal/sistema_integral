import { describe, expect, it } from "vitest";
import { DURACION_OT_MINUTOS, INVITADOS_DE_UNA_OT, horarioDeLaOT, instanteDe, problemasDelEvento } from "./evento";

const bueno = { titulo: "x", inicio: "2026-11-03T08:00:00", fin: "2026-11-03T09:30:00", invitados: ["ok@polcecal.com"] };

describe("horarioDeLaOT", () => {
  it("el turno 4-12 arranca a las 04:00 y termina 1:30 después", () => {
    expect(horarioDeLaOT("2026-11-03", "4-12")).toEqual({ inicio: "2026-11-03T04:00:00", fin: "2026-11-03T05:30:00" });
  });
  it("el turno 8-16 arranca a las 08:00", () => {
    expect(horarioDeLaOT("2026-11-03", "8-16")).toEqual({ inicio: "2026-11-03T08:00:00", fin: "2026-11-03T09:30:00" });
  });
  it("el turno 12-20 arranca a las 12:00", () => {
    expect(horarioDeLaOT("2026-11-03", "12-20")).toEqual({ inicio: "2026-11-03T12:00:00", fin: "2026-11-03T13:30:00" });
  });
  it("dura lo que dice la constante", () => {
    expect(DURACION_OT_MINUTOS).toBe(90);
  });
  it("no depende de la zona del servidor", () => {
    const antes = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/Argentina/Buenos_Aires", "Pacific/Auckland"]) {
        process.env.TZ = tz;
        expect(horarioDeLaOT("2026-11-03", "12-20").inicio).toBe("2026-11-03T12:00:00");
      }
    } finally {
      if (antes === undefined) delete process.env.TZ;
      else process.env.TZ = antes;
    }
  });
});

describe("INVITADOS_DE_UNA_OT", () => {
  it("los cinco invitados de una OT son los de la spec", () => {
    expect(INVITADOS_DE_UNA_OT).toEqual([
      "nicolaslenzetti@polcecal.com", "gerencia@polcecal.com", "produccion@polcecal.com",
      "mantenimiento@polcecal.com", "soporte.mantenimiento@polcecal.com",
    ]);
  });
  it("todos pasan la validación de correo", () => {
    expect(problemasDelEvento({ ...bueno, invitados: [...INVITADOS_DE_UNA_OT] })).toEqual([]);
  });
});

describe("problemasDelEvento", () => {
  it("un evento bien armado no tiene problemas", () => {
    expect(problemasDelEvento(bueno)).toEqual([]);
  });
  it("un fin igual al inicio no pasa", () => {
    const p = problemasDelEvento({ ...bueno, fin: bueno.inicio });
    expect(p).toContain("El evento tiene que terminar después de que empieza");
  });
  it("un fin anterior al inicio no pasa", () => {
    const p = problemasDelEvento({ ...bueno, fin: "2026-11-03T07:00:00" });
    expect(p).toContain("El evento tiene que terminar después de que empieza");
  });
  it("compara por instante cuando traen zona", () => {
    // 12:00-03:00 son las 15:00Z: el fin a las 14:00Z es anterior aunque «14» > «12» como texto.
    const p = problemasDelEvento({ ...bueno, inicio: "2026-11-03T12:00:00-03:00", fin: "2026-11-03T14:00:00Z" });
    expect(p).toContain("El evento tiene que terminar después de que empieza");
  });
  it("un mail mal escrito se nombra, y se nombra ése", () => {
    const p = problemasDelEvento({ ...bueno, invitados: ["ok@polcecal.com", "sin-arroba"] });
    expect(p.join(" ")).toContain("sin-arroba");
    expect(p.join(" ")).not.toContain("ok@polcecal.com");
    expect(p).toHaveLength(1);
  });
  it("una fecha que no existe no pasa", () => {
    const p = problemasDelEvento({ ...bueno, inicio: "2026-02-31T08:00:00" });
    expect(p.join(" ")).toContain("2026-02-31T08:00:00");
  });
  it("informa todos los problemas juntos, no de a uno", () => {
    const p = problemasDelEvento({ titulo: "  ", inicio: "2026-11-03T09:00:00", fin: "2026-11-03T08:00:00", invitados: [] });
    expect(p).toHaveLength(2);
  });
  it("suma el título, el fin y cada mail malo", () => {
    const p = problemasDelEvento({ titulo: "", inicio: "2026-11-03T09:00:00", fin: "2026-11-03T09:00:00", invitados: ["a", "b@c"] });
    expect(p).toHaveLength(4);
  });
  it("uno con zona y otro sin zona no se comparan", () => {
    const p = problemasDelEvento({ ...bueno, fin: "2026-11-03T12:30:00-03:00" });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/zona/);
  });
});

describe("instanteDe", () => {
  it("la misma hora con otra zona da el mismo instante", () => {
    expect(instanteDe("2026-11-03T12:00:00-03:00")!.ms).toBe(instanteDe("2026-11-03T15:00:00Z")!.ms);
  });
  it("rechaza lo que no es una fecha-hora", () => {
    expect(instanteDe("mañana")).toBeNull();
    expect(instanteDe("2026-11-03")).toBeNull();
  });
});

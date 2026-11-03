import { describe, expect, it } from "vitest";
import {
  DURACION_OT_MINUTOS, INVITADOS_DE_UNA_OT, TURNOS_DEL_TALLER, datosDeLaOT, fechaParaElCalendario,
  CASILLA_DE_MANTENIMIENTO, advertenciaDeReenviarDivergido, duenoDelEventoDeLaOT, faltaConfirmarElPisado,
  invitacionesDeLaOT, leyendaDelDuenoDeLaOT,
  horarioDeLaOT, invitadosExtraDeLaOT, laOTEstaCerrada, instanteDe, problemasDeMandarLaOT, problemasDelEvento,
} from "./evento";
import { invitadosLimpios } from "./pedido";

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

describe("fechaParaElCalendario", () => {
  it("la fecha que manda es la pendiente cuando la hay", () => {
    expect(fechaParaElCalendario({ fecha_ejecucion: "2026-11-03", fecha_ejecucion_pendiente: "2026-11-10" }))
      .toBe("2026-11-10");
  });
  it("sin pendiente, la de ejecución", () => {
    expect(fechaParaElCalendario({ fecha_ejecucion: "2026-11-03", fecha_ejecucion_pendiente: null })).toBe("2026-11-03");
    expect(fechaParaElCalendario({ fecha_ejecucion: "2026-11-03" })).toBe("2026-11-03");
  });
  it("una pendiente en blanco no tapa a la de ejecución", () => {
    expect(fechaParaElCalendario({ fecha_ejecucion: "2026-11-03", fecha_ejecucion_pendiente: "  " })).toBe("2026-11-03");
  });
  it("sin ninguna de las dos no hay fecha", () => {
    expect(fechaParaElCalendario({ fecha_ejecucion: null, fecha_ejecucion_pendiente: null })).toBeNull();
  });
});

describe("problemasDeMandarLaOT", () => {
  it("una OT sin fecha de ejecución no se puede mandar", () => {
    expect(problemasDeMandarLaOT({ fecha_ejecucion: null, turno: "8-16" }))
      .toContain("La OT no tiene fecha de ejecución: primero hay que ponerle una");
  });
  it("una OT con fecha y turno no tiene problemas", () => {
    expect(problemasDeMandarLaOT({ fecha_ejecucion: "2026-11-03", turno: "8-16", invitados: [...INVITADOS_DE_UNA_OT] }))
      .toEqual([]);
  });
  it("una fecha mal formada se rechaza nombrándola: horarioDeLaOT no la valida", () => {
    for (const mala of ["03/11/2026", "2026-11-3", "2026-02-31", "mañana"]) {
      const p = problemasDeMandarLaOT({ fecha_ejecucion: mala, turno: "8-16" });
      expect(p.join(" ")).toContain(mala);
    }
  });
  it("un turno que no es del taller se rechaza", () => {
    const p = problemasDeMandarLaOT({ fecha_ejecucion: "2026-11-03", turno: "9-17" });
    expect(p.join(" ")).toContain("9-17");
  });
  it("los TURNOS_DEL_TALLER son los tres, y todos arman horario", () => {
    expect(TURNOS_DEL_TALLER).toEqual(["4-12", "8-16", "12-20"]);
    for (const t of TURNOS_DEL_TALLER) expect(() => horarioDeLaOT("2026-11-03", t)).not.toThrow();
  });
  it("un invitado mal escrito se nombra", () => {
    const p = problemasDeMandarLaOT({ fecha_ejecucion: "2026-11-03", turno: "8-16", invitados: ["sin-arroba"] });
    expect(p.join(" ")).toContain("sin-arroba");
  });
  it("informa todo junto", () => {
    const p = problemasDeMandarLaOT({ fecha_ejecucion: null, turno: "9-17", invitados: ["x"] });
    expect(p).toHaveLength(3);
  });
});

describe("datosDeLaOT", () => {
  const ot = {
    ot_number: 2935, equipo_raw: "Molino 2", equipo_code: "ML-02", sector_raw: "Molienda",
    especialidad: "Mecánica", tipo: "Preventivo", descripcion: "Cambiar rodamientos",
  };
  it("el título lleva el número y el equipo", () => {
    expect(datosDeLaOT(ot).titulo).toBe("OT 2935 · Molino 2");
  });
  it("sin equipo, el título es sólo el número", () => {
    expect(datosDeLaOT({ ...ot, equipo_raw: null, equipo_code: null }).titulo).toBe("OT 2935");
  });
  it("sin texto de equipo usa el código", () => {
    expect(datosDeLaOT({ ...ot, equipo_raw: "  " }).titulo).toBe("OT 2935 · ML-02");
  });
  it("el lugar es el sector, y null si no hay", () => {
    expect(datosDeLaOT(ot).lugar).toBe("Molienda");
    expect(datosDeLaOT({ ...ot, sector_raw: null }).lugar).toBeNull();
  });
  it("la descripción trae lo que se sabe y la descripción de la OT", () => {
    const d = datosDeLaOT(ot).descripcion;
    expect(d).toContain("Orden de trabajo 2935");
    expect(d).toContain("Mecánica");
    expect(d).toContain("Cambiar rodamientos");
  });
  it("no revienta con todo en null", () => {
    const d = datosDeLaOT({
      ot_number: 1, equipo_raw: null, equipo_code: null, sector_raw: null,
      especialidad: null, tipo: null, descripcion: null,
    });
    expect(d.titulo).toBe("OT 1");
    expect(d.descripcion).toContain("Orden de trabajo 1");
  });
});

describe("duenoDelEventoDeLaOT", () => {
  it("es la casilla que generó la OT", () => {
    expect(duenoDelEventoDeLaOT({ id: "u-gen", email: "Soporte.Mantenimiento@polcecal.com " }))
      .toEqual({ id: "u-gen", casilla: "soporte.mantenimiento@polcecal.com", delArea: false });
  });
  it("una OT sin created_by es de mantenimiento@, y no de quien la manda", () => {
    expect(duenoDelEventoDeLaOT(null))
      .toEqual({ id: null, casilla: "mantenimiento@polcecal.com", delArea: true });
  });
  it("un generador sin correo no sirve de casilla: también cae en mantenimiento@", () => {
    expect(duenoDelEventoDeLaOT({ id: "u-gen", email: " " }).casilla).toBe(CASILLA_DE_MANTENIMIENTO);
    expect(duenoDelEventoDeLaOT({ id: "u-gen", email: null }).id).toBeNull();
  });
  it("la casilla del área es uno de los cinco invitados fijos: a nadie le cambia lo que recibe", () => {
    expect(INVITADOS_DE_UNA_OT).toContain(CASILLA_DE_MANTENIMIENTO);
  });
});

describe("una OT cerrada no se manda", () => {
  it("con fecha de cierre, no", () => {
    expect(problemasDeMandarLaOT({ fecha_ejecucion: "2026-11-03", turno: "8-16", fecha_cierre: "2026-11-04" }))
      .toContain("La OT ya está cerrada: no se manda al calendario una orden que ya se hizo");
  });
  it("sin fecha de cierre, sí", () => {
    expect(problemasDeMandarLaOT({ fecha_ejecucion: "2026-11-03", turno: "8-16", fecha_cierre: null })).toEqual([]);
  });
  it("REALIZADA sin fecha de cierre tampoco: 168 de 986 están así", () => {
    expect(problemasDeMandarLaOT({ fecha_ejecucion: "2026-11-03", turno: "8-16", fecha_cierre: null, estado: "REALIZADO" }))
      .toContain("La OT ya está cerrada: no se manda al calendario una orden que ya se hizo");
  });
  it("laOTEstaCerrada: fecha de cierre o REALIZADO, y SUSPENDIDA no", () => {
    expect(laOTEstaCerrada({ fecha_cierre: "2026-11-04", estado: "POR_HACER" })).toBe(true);
    expect(laOTEstaCerrada({ fecha_cierre: null, estado: "REALIZADO" })).toBe(true);
    expect(laOTEstaCerrada({ fecha_cierre: null, estado: "SUSPENDIDA" })).toBe(false);
    expect(laOTEstaCerrada({ fecha_cierre: null, estado: "EN_PROCESO" })).toBe(false);
    expect(laOTEstaCerrada({})).toBe(false);
  });
});

describe("leyendaDelDuenoDeLaOT: el modal dice el dueño real", () => {
  it("una OT sin created_by nombra a mantenimiento@, no a «la casilla que la generó»", () => {
    const t = leyendaDelDuenoDeLaOT(CASILLA_DE_MANTENIMIENTO, false, true);
    expect(t).toContain(CASILLA_DE_MANTENIMIENTO);
    expect(t).toContain("no la cargó nadie");
    expect(t).not.toContain("que es quien generó");
  });
  it("una con created_by nombra a quien la generó", () => {
    const t = leyendaDelDuenoDeLaOT("soporte.mantenimiento@polcecal.com", false, false);
    expect(t).toContain("soporte.mantenimiento@polcecal.com, que es quien generó la orden");
  });
  it("con evento ya creado dice que el dueño no cambia al reenviar, y de quién es", () => {
    const t = leyendaDelDuenoDeLaOT("ana@polcecal.com", true, false);
    expect(t).toContain("es de ana@polcecal.com");
    expect(t).toContain("no cambia de quién es");
    expect(t).toContain("otra casilla");
  });
});

describe("invitacionesDeLaOT: lo que la pantalla lista es lo que se manda", () => {
  it("con el dueño entre los fijos se mandan cuatro, no cinco", () => {
    const r = invitacionesDeLaOT(CASILLA_DE_MANTENIMIENTO, []);
    expect(r.reciben).toHaveLength(INVITADOS_DE_UNA_OT.length - 1);
    expect(r.reciben).not.toContain(CASILLA_DE_MANTENIMIENTO);
    expect(r.elDuenoEstaEntreLosFijos).toBe(true);
  });
  it("con un dueño que no es de los fijos se mandan los cinco", () => {
    const r = invitacionesDeLaOT("otra@polcecal.com", ["Extra@x.com"]);
    expect(r.reciben).toEqual([...INVITADOS_DE_UNA_OT, "extra@x.com"]);
    expect(r.elDuenoEstaEntreLosFijos).toBe(false);
  });
  it("coincide con invitadosLimpios, que es lo que escribe la ruta", () => {
    for (const casilla of [CASILLA_DE_MANTENIMIENTO, "soporte.mantenimiento@polcecal.com", "otra@polcecal.com"]) {
      const extras = ["a@x.com", "A@x.com", casilla.toUpperCase()];
      expect(invitacionesDeLaOT(casilla, extras).reciben)
        .toEqual(invitadosLimpios([...INVITADOS_DE_UNA_OT, ...extras], casilla));
    }
  });
});

describe("advertenciaDeReenviarDivergido", () => {
  it("no promete un reintento que nadie hace, y dice qué hacer", () => {
    const t = advertenciaDeReenviarDivergido("quota exceeded");
    expect(t).not.toContain("se reintenta y");
    expect(t).toContain("NO se reintenta solo");
    expect(t).toContain("volver a mandar la orden");
    expect(t).toContain("quota exceeded");
  });
});

describe("invitadosExtraDeLaOT", () => {
  it("devuelve a quienes no son de los cinco fijos", () => {
    expect(invitadosExtraDeLaOT([...INVITADOS_DE_UNA_OT, "Proveedor@Externo.com", "otro@polcecal.com"]))
      .toEqual(["proveedor@externo.com", "otro@polcecal.com"]);
  });
  it("sin extras, vacío; y sin repetidos", () => {
    expect(invitadosExtraDeLaOT([...INVITADOS_DE_UNA_OT])).toEqual([]);
    expect(invitadosExtraDeLaOT(["a@b.com", "A@B.com"])).toEqual(["a@b.com"]);
  });
});

describe("faltaConfirmarElPisado", () => {
  it("un evento sin divergencia se manda sin preguntar", () => {
    expect(faltaConfirmarElPisado(null, false)).toBeNull();
  });
  it("uno divergido sin confirmar se frena y dice qué le hicieron", () => {
    expect(faltaConfirmarElPisado("movido", false)).toContain("lo movieron");
    expect(faltaConfirmarElPisado("borrado", false)).toContain("lo borraron");
  });
  it("confirmado, pasa", () => {
    expect(faltaConfirmarElPisado("movido", true)).toBeNull();
    expect(faltaConfirmarElPisado("borrado", true)).toBeNull();
  });
});

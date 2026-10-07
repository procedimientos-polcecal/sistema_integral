import { describe, it, expect } from "vitest";
import {
  decidirQueAplicar, claveDia, motivoDeProteccion, elegirAbiertoPrevio, avisoDeAbiertasViejas,
  rangoDeRecalculo, diasLiquidadosDe,
  type TurnoNuevo, type ContextoDeDecision, type FichadaAbierta,
} from "./decidir";
import { toUtcDateOnly, localDateTime, fechaArgentinaDe } from "../dates";

function dia(y: number, m: number, d: number) {
  return toUtcDateOnly(y, m - 1, d);
}

function turno(empleadoId: string, f: Date, entrada: [number, number], salida: [number, number] | null): TurnoNuevo {
  return {
    empleadoId,
    legajo: "PC_204",
    fecha: f,
    horaEntrada: localDateTime(f, entrada[0], entrada[1]),
    horaSalida: salida ? localDateTime(f, salida[0], salida[1]) : null,
  };
}

const vacio: ContextoDeDecision = {
  diasCorregidos: new Set(),
  diasLiquidados: new Set(),
  guardadas: new Map(),
};

describe("decidirQueAplicar", () => {
  it("sin nada que proteger, inserta todo y marca los días para borrar", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const d = decidirQueAplicar([t], vacio, true);
    expect(d.aInsertar).toEqual([t]);
    expect(d.diasABorrar).toEqual([{ empleadoId: "emp-1", fecha: "2026-10-02" }]);
    expect(d.salteados).toEqual([]);
  });

  it("descarta turnos repetidos dentro del mismo lote", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const d = decidirQueAplicar([t, { ...t }], vacio, true);
    expect(d.aInsertar).toHaveLength(1);
  });

  it("saltea un día corregido a mano y no lo borra", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([claveDia("emp-1", "2026-10-02")]),
    };
    const d = decidirQueAplicar([t], ctx, true);
    expect(d.aInsertar).toEqual([]);
    expect(d.diasABorrar).toEqual([]);
    expect(d.salteados[0].motivo).toBe("corregido");
  });

  it("saltea un día dentro de una liquidación cerrada", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasLiquidados: new Set([claveDia("emp-1", "2026-10-02")]),
    };
    const d = decidirQueAplicar([t], ctx, true);
    expect(d.aInsertar).toEqual([]);
    expect(d.salteados[0].motivo).toBe("liquidado");
  });

  it("al saltear, avisa si lo que trae Lenox difiere de lo guardado", () => {
    const f = dia(2026, 10, 2);
    const t = turno("emp-1", f, [8, 12], [16, 3]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([claveDia("emp-1", "2026-10-02")]),
      guardadas: new Map([
        [claveDia("emp-1", "2026-10-02"), [{
          horaEntrada: localDateTime(f, 7, 58).toISOString(),
          horaSalida: localDateTime(f, 16, 3).toISOString(),
        }]],
      ]),
    };
    const d = decidirQueAplicar([t], ctx, true);
    expect(d.salteados[0].divergencia).toBe("guardado 07:58–16:03, Lenox trae 08:12–16:03");
  });

  it("al saltear, NO avisa si coincide con lo guardado", () => {
    const f = dia(2026, 10, 2);
    const t = turno("emp-1", f, [7, 58], [16, 3]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([claveDia("emp-1", "2026-10-02")]),
      guardadas: new Map([
        [claveDia("emp-1", "2026-10-02"), [{
          horaEntrada: localDateTime(f, 7, 58).toISOString(),
          horaSalida: localDateTime(f, 16, 3).toISOString(),
        }]],
      ]),
    };
    const d = decidirQueAplicar([t], ctx, true);
    expect(d.salteados[0].divergencia).toBeNull();
  });

  it("con protegerCorregidos en false, el día corregido se pisa (es el camino del Excel)", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([claveDia("emp-1", "2026-10-02")]),
    };
    const d = decidirQueAplicar([t], ctx, false);
    expect(d.aInsertar).toEqual([t]);
    expect(d.salteados).toEqual([]);
  });

  it("una liquidación cerrada se respeta aunque sea el camino del Excel", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasLiquidados: new Set([claveDia("emp-1", "2026-10-02")]),
    };
    const d = decidirQueAplicar([t], ctx, false);
    expect(d.aInsertar).toEqual([]);
    expect(d.salteados[0].motivo).toBe("liquidado");
  });

  // Lo que sigue no está en el plan original: sale de revisarlo.

  it("un día corregido Y liquidado se informa como liquidado", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const clave = claveDia("emp-1", "2026-10-02");
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([clave]),
      diasLiquidados: new Set([clave]),
    };
    const d = decidirQueAplicar([t], ctx, true);
    expect(d.salteados).toHaveLength(1);
    expect(d.salteados[0].motivo).toBe("liquidado");
  });

  it("si la persona borró todas las fichadas del día y Lenox trae algo, avisa (la marca fantasma que el cron recrearía)", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([claveDia("emp-1", "2026-10-02")]),
      // Sin entrada en `guardadas`: el día no tiene nada guardado.
    };
    const d = decidirQueAplicar([t], ctx, true);
    expect(d.aInsertar).toEqual([]);
    expect(d.salteados[0].divergencia).toBe("guardado sin fichadas, Lenox trae 08:00–16:00");
  });

  it("lo mismo vale para un día liquidado sin nada guardado", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], null);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasLiquidados: new Set([claveDia("emp-1", "2026-10-02")]),
    };
    const d = decidirQueAplicar([t], ctx, false);
    expect(d.salteados[0].divergencia).toBe("guardado sin fichadas, Lenox trae 08:00–?");
  });

  it("un día con dos turnos se informa una sola vez y compara los dos contra lo guardado", () => {
    const f = dia(2026, 10, 2);
    const t1 = turno("emp-1", f, [6, 0], [10, 0]);
    const t2 = turno("emp-1", f, [14, 0], [18, 0]);
    const clave = claveDia("emp-1", "2026-10-02");
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([clave]),
      guardadas: new Map([[clave, [
        { horaEntrada: localDateTime(f, 14, 0).toISOString(), horaSalida: localDateTime(f, 18, 0).toISOString() },
        { horaEntrada: localDateTime(f, 6, 0).toISOString(), horaSalida: localDateTime(f, 10, 0).toISOString() },
      ]]]),
    };
    const d = decidirQueAplicar([t1, t2], ctx, true);
    expect(d.salteados).toHaveLength(1);
    // Mismos tramos en otro orden: no es una divergencia.
    expect(d.salteados[0].divergencia).toBeNull();
  });

  it("una diferencia de segundos no se avisa: se compara lo que se ve, HH:MM", () => {
    const f = dia(2026, 10, 2);
    const t: TurnoNuevo = {
      empleadoId: "emp-1",
      legajo: "PC_204",
      fecha: f,
      horaEntrada: localDateTime(f, 8, 0, 40),
      horaSalida: localDateTime(f, 16, 0),
    };
    const clave = claveDia("emp-1", "2026-10-02");
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([clave]),
      guardadas: new Map([[clave, [{
        horaEntrada: localDateTime(f, 8, 0).toISOString(),
        horaSalida: localDateTime(f, 16, 0).toISOString(),
      }]]]),
    };
    expect(decidirQueAplicar([t], ctx, true).salteados[0].divergencia).toBeNull();
  });

  it("con varios días y empleados, saltea sólo los protegidos y borra una vez cada día que sí aplica", () => {
    const f1 = dia(2026, 10, 1);
    const f2 = dia(2026, 10, 2);
    const protegido = turno("emp-1", f1, [8, 0], [16, 0]);
    const libreA = turno("emp-1", f2, [6, 0], [10, 0]);
    const libreB = turno("emp-1", f2, [14, 0], [18, 0]);
    const otro = turno("emp-2", f1, [8, 0], [16, 0]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([claveDia("emp-1", "2026-10-01")]),
    };
    const d = decidirQueAplicar([protegido, libreA, libreB, otro], ctx, true);
    expect(d.aInsertar).toEqual([libreA, libreB, otro]);
    expect(d.diasABorrar).toEqual([
      { empleadoId: "emp-1", fecha: "2026-10-02" },
      { empleadoId: "emp-2", fecha: "2026-10-01" },
    ]);
    expect(d.salteados.map((s) => s.fecha)).toEqual(["2026-10-01"]);
    // Y la divergencia sólo habla de ese día y de ese empleado: no se cuelan
    // los turnos de emp-1 del 2 ni los de emp-2, que están en el mismo lote.
    expect(d.salteados[0].divergencia).toBe("guardado sin fichadas, Lenox trae 08:00–16:00");
  });

  it("la divergencia se calcula sólo con los turnos de ese día y ese empleado", () => {
    const f1 = dia(2026, 10, 1);
    const f2 = dia(2026, 10, 2);
    const clave1 = claveDia("emp-1", "2026-10-01");
    const clave2 = claveDia("emp-2", "2026-10-02");
    // Dos días salteados de dos empleados distintos, con contenidos distintos,
    // más un día libre de emp-1 en el medio. Si el mensaje de uno mezclara los
    // turnos de otro día u otro empleado, los dos textos dejarían de coincidir.
    const turnos = [
      turno("emp-1", f1, [8, 0], [16, 0]),
      turno("emp-1", f2, [6, 0], [14, 0]),
      turno("emp-2", f2, [10, 0], [18, 0]),
    ];
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([clave1, clave2]),
      guardadas: new Map([
        [clave1, [{ horaEntrada: localDateTime(f1, 7, 0).toISOString(), horaSalida: localDateTime(f1, 15, 0).toISOString() }]],
        [clave2, [{ horaEntrada: localDateTime(f2, 9, 0).toISOString(), horaSalida: localDateTime(f2, 17, 0).toISOString() }]],
      ]),
    };
    const d = decidirQueAplicar(turnos, ctx, true);
    expect(d.salteados.map((s) => [s.empleadoId, s.divergencia])).toEqual([
      ["emp-1", "guardado 07:00–15:00, Lenox trae 08:00–16:00"],
      ["emp-2", "guardado 09:00–17:00, Lenox trae 10:00–18:00"],
    ]);
  });

  it("dos turnos con la misma entrada y distinta salida son dos turnos, no un repetido", () => {
    // Una entrada con dos salidas distintas en el mismo día es lo que produce
    // una marcación mal leída: tiene que llegar a la base y verse, no
    // fusionarse en silencio con la primera.
    const f = dia(2026, 10, 2);
    const a = turno("emp-1", f, [8, 0], [16, 0]);
    const b = turno("emp-1", f, [8, 0], [17, 30]);
    const d = decidirQueAplicar([a, b], vacio, true);
    expect(d.aInsertar).toEqual([a, b]);
    expect(d.diasABorrar).toEqual([{ empleadoId: "emp-1", fecha: "2026-10-02" }]);
  });

  it("con varios turnos de un día, el mensaje los separa con · y respeta el orden por hora", () => {
    const f = dia(2026, 10, 2);
    const clave = claveDia("emp-1", "2026-10-02");
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([clave]),
      guardadas: new Map([[clave, [
        // Guardados en desorden a propósito: el mensaje sale ordenado.
        { horaEntrada: localDateTime(f, 14, 0).toISOString(), horaSalida: localDateTime(f, 18, 0).toISOString() },
        { horaEntrada: localDateTime(f, 6, 0).toISOString(), horaSalida: localDateTime(f, 10, 0).toISOString() },
      ]]]),
    };
    const turnos = [
      turno("emp-1", f, [6, 0], [10, 0]),
      turno("emp-1", f, [14, 0], [19, 0]),
    ];
    const d = decidirQueAplicar(turnos, ctx, true);
    expect(d.salteados[0].divergencia).toBe(
      "guardado 06:00–10:00 · 14:00–18:00, Lenox trae 06:00–10:00 · 14:00–19:00"
    );
  });
});

describe("motivoDeProteccion", () => {
  const clave = claveDia("emp-1", "2026-10-02");

  it("un día sin marcas no está protegido", () => {
    expect(motivoDeProteccion(clave, vacio, true)).toBeNull();
  });

  it("el día corregido se protege sólo si se pide (el Excel no lo pide)", () => {
    const ctx = { ...vacio, diasCorregidos: new Set([clave]) };
    expect(motivoDeProteccion(clave, ctx, true)).toBe("corregido");
    expect(motivoDeProteccion(clave, ctx, false)).toBeNull();
  });

  it("el día liquidado se protege siempre, y gana sobre el corregido", () => {
    const ctx = { ...vacio, diasLiquidados: new Set([clave]), diasCorregidos: new Set([clave]) };
    expect(motivoDeProteccion(clave, ctx, true)).toBe("liquidado");
    expect(motivoDeProteccion(clave, ctx, false)).toBe("liquidado");
  });

  it("no confunde a otro empleado ni a otro día", () => {
    const ctx = { ...vacio, diasLiquidados: new Set([clave]) };
    expect(motivoDeProteccion(claveDia("emp-2", "2026-10-02"), ctx, true)).toBeNull();
    expect(motivoDeProteccion(claveDia("emp-1", "2026-10-03"), ctx, true)).toBeNull();
  });
});


function abierta(id: string, empleadoId: string, fecha: string, horaUtc = "22:00"): FichadaAbierta {
  return { id, empleadoId, fecha, horaEntrada: `${fecha}T${horaUtc}:00+00:00` };
}

describe("elegirAbiertoPrevio", () => {
  it("elige, por empleado, la del día anterior a su primer día", () => {
    const abiertas = [
      abierta("a", "emp-1", "2026-09-10"),
      abierta("b", "emp-1", "2026-09-30"),
      abierta("c", "emp-2", "2026-09-30"),
    ];
    const r = elegirAbiertoPrevio(abiertas, new Map([["emp-1", "2026-10-01"], ["emp-2", "2026-10-01"]]));
    expect(r.get("emp-1")?.id).toBe("b");
    expect(r.get("emp-2")?.id).toBe("c");
  });

  it("una abierta de más de un día antes no se encadena: la guarda de 2 a 14 horas no la dejaría cerrar", () => {
    const r = elegirAbiertoPrevio([abierta("a", "emp-1", "2026-09-29")], new Map([["emp-1", "2026-10-01"]]));
    expect(r.has("emp-1")).toBe(false);
  });

  it("el día anterior se calcula bien cruzando el cambio de mes", () => {
    const r = elegirAbiertoPrevio([abierta("a", "emp-1", "2026-02-28")], new Map([["emp-1", "2026-03-01"]]));
    expect(r.get("emp-1")?.id).toBe("a");
  });

  it("ignora las del propio primer día o posteriores: esas las reemplaza el lote", () => {
    const abiertas = [abierta("a", "emp-1", "2026-10-01"), abierta("b", "emp-1", "2026-10-03")];
    const r = elegirAbiertoPrevio(abiertas, new Map([["emp-1", "2026-10-01"]]));
    expect(r.has("emp-1")).toBe(false);
  });

  it("cada empleado se mide contra su propio primer día", () => {
    const abiertas = [abierta("a", "emp-1", "2026-09-30"), abierta("b", "emp-2", "2026-09-30")];
    const r = elegirAbiertoPrevio(abiertas, new Map([["emp-1", "2026-10-01"], ["emp-2", "2026-09-25"]]));
    expect(r.get("emp-1")?.id).toBe("a");
    expect(r.has("emp-2")).toBe(false);
  });

  it("un empleado que no está en el lote no se elige", () => {
    const r = elegirAbiertoPrevio([abierta("a", "emp-9", "2026-09-30")], new Map([["emp-1", "2026-10-01"]]));
    expect(r.size).toBe(0);
  });

  it("con dos el mismo día, gana la de entrada más tarde, sin importar el orden de llegada", () => {
    const temprana = abierta("t", "emp-1", "2026-09-30", "10:00");
    const tardia = abierta("d", "emp-1", "2026-09-30", "22:00");
    const primerDia = new Map([["emp-1", "2026-10-01"]]);
    expect(elegirAbiertoPrevio([temprana, tardia], primerDia).get("emp-1")?.id).toBe("d");
    expect(elegirAbiertoPrevio([tardia, temprana], primerDia).get("emp-1")?.id).toBe("d");
  });

  it("sin abiertas, no hay nada que encadenar", () => {
    expect(elegirAbiertoPrevio([], new Map([["emp-1", "2026-10-01"]])).size).toBe(0);
  });
});

describe("avisoDeAbiertasViejas", () => {
  const primerDia = new Map([["emp-1", "2026-10-01"], ["emp-2", "2026-10-01"], ["emp-3", "2026-10-01"]]);
  const legajos = new Map([["emp-1", "PC_204"], ["emp-2", "PC_122"], ["emp-3", "PS_010"]]);

  it("sin abiertas viejas no hay aviso", () => {
    expect(avisoDeAbiertasViejas([], primerDia, legajos)).toBeNull();
  });

  it("la del día anterior no es vieja: ésa se encadena y se resuelve sola", () => {
    expect(avisoDeAbiertasViejas([abierta("a", "emp-1", "2026-09-30")], primerDia, legajos)).toBeNull();
  });

  it("las de dentro del lote no cuentan: las reemplaza el lote", () => {
    expect(avisoDeAbiertasViejas([abierta("a", "emp-1", "2026-10-02")], primerDia, legajos)).toBeNull();
  });

  it("una sola fichada, en singular", () => {
    expect(avisoDeAbiertasViejas([abierta("a", "emp-1", "2026-09-17")], primerDia, legajos)).toBe(
      "1 fichada quedó abierta de antes del 2026-10-01 (la más vieja, del 2026-09-17) y no se puede cerrar con estos datos (legajo PC_204). Hay que cerrarlas a mano."
    );
  });

  it("varias fichadas se resumen en una línea con cuántas, desde cuándo y qué hacer", () => {
    const aviso = avisoDeAbiertasViejas(
      [abierta("a", "emp-1", "2026-09-17"), abierta("b", "emp-1", "2026-08-04"), abierta("c", "emp-2", "2026-09-02")],
      primerDia, legajos
    );
    expect(aviso).toBe(
      "3 fichadas quedaron abiertas de antes del 2026-10-01 (la más vieja, del 2026-08-04) y no se pueden cerrar con estos datos (legajos PC_122, PC_204). Hay que cerrarlas a mano."
    );
  });

  it("un legajo con varias abiertas aparece una sola vez en la lista", () => {
    const aviso = avisoDeAbiertasViejas(
      [abierta("a", "emp-1", "2026-09-17"), abierta("b", "emp-1", "2026-09-02")], primerDia, legajos
    );
    expect(aviso).toContain("(legajo PC_204)");
    expect(aviso).toContain("2 fichadas");
  });

  it("si son muchos legajos corta la lista y dice cuántos más", () => {
    const muchos = Array.from({ length: 12 }, (_, i) => `emp-${i}`);
    const pd = new Map(muchos.map((e) => [e, "2026-10-01"]));
    const lg = new Map(muchos.map((e, i) => [e, `PC_${String(i).padStart(3, "0")}`]));
    const aviso = avisoDeAbiertasViejas(muchos.map((e) => abierta(`id-${e}`, e, "2026-09-02")), pd, lg, 3);
    expect(aviso).toContain("12 fichadas");
    expect(aviso).toContain("(legajos PC_000, PC_001, PC_002 y 9 más)");
  });

  it("'antes del' vale para todas: usa el primer día más tardío de los afectados", () => {
    const pd = new Map([["emp-1", "2026-10-01"], ["emp-2", "2026-10-05"]]);
    const aviso = avisoDeAbiertasViejas(
      [abierta("a", "emp-1", "2026-09-17"), abierta("b", "emp-2", "2026-09-30")], pd, legajos
    );
    expect(aviso).toContain("de antes del 2026-10-05");
  });

  it("un empleado fuera del lote no cuenta", () => {
    expect(avisoDeAbiertasViejas([abierta("a", "emp-9", "2026-08-01")], primerDia, legajos)).toBeNull();
  });
});

describe("avisoDeAbiertasViejas: bordes", () => {
  const abiertaDe = (empleadoId: string) => abierta(`id-${empleadoId}`, empleadoId, "2026-09-02");
  const lote = (n: number) => {
    const ids = Array.from({ length: n }, (_, i) => `emp-${i}`);
    return {
      abiertas: ids.map(abiertaDe),
      primerDia: new Map(ids.map((e) => [e, "2026-10-01"])),
      legajos: new Map(ids.map((e, i) => [e, `PC_${String(i).padStart(3, "0")}`])),
    };
  };

  it("con exactamente maxLegajos legajos los lista todos, sin '… y 0 más'", () => {
    const { abiertas, primerDia, legajos } = lote(3);
    const aviso = avisoDeAbiertasViejas(abiertas, primerDia, legajos, 3);
    expect(aviso).toContain("(legajos PC_000, PC_001, PC_002)");
    expect(aviso).not.toMatch(/ y \d+ más/);
  });

  it("con un legajo de más que maxLegajos dice 'y 1 más'", () => {
    const { abiertas, primerDia, legajos } = lote(4);
    expect(avisoDeAbiertasViejas(abiertas, primerDia, legajos, 3)).toContain("(legajos PC_000, PC_001, PC_002 y 1 más)");
  });

  it("si no conoce el legajo de un empleado, nombra su id: nunca deja un hueco ni 'undefined'", () => {
    const aviso = avisoDeAbiertasViejas([abierta("a", "emp-7", "2026-09-02")], new Map([["emp-7", "2026-10-01"]]), new Map());
    expect(aviso).toContain("(legajo emp-7)");
    expect(aviso).not.toContain("undefined");
  });
});

describe("rangoDeRecalculo", () => {
  const d = (m: number, dia: number) => toUtcDateOnly(2026, m - 1, dia);

  it("sin tramos no hay nada que recalcular", () => {
    expect(rangoDeRecalculo([]).size).toBe(0);
  });

  it("un turno que cruza medianoche suma su día de salida aunque ese día no tenga turnos propios", () => {
    // Viernes de noche a sábado: es el único turno del empleado. Si el rango
    // sólo mirara la entrada, el sábado quedaría sin recalcular.
    const r = rangoDeRecalculo([{ empleadoId: "emp-1", fecha: d(10, 2), fechaSalida: d(10, 3) }]);
    expect(r.get("emp-1")).toEqual({ min: d(10, 2), max: d(10, 3) });
  });

  it("un turno que no cruza cubre sólo su día", () => {
    const r = rangoDeRecalculo([{ empleadoId: "emp-1", fecha: d(10, 2), fechaSalida: d(10, 2) }]);
    expect(r.get("emp-1")).toEqual({ min: d(10, 2), max: d(10, 2) });
  });

  it("el rango va del primer al último día cubierto, sin importar el orden", () => {
    const r = rangoDeRecalculo([
      { empleadoId: "emp-1", fecha: d(10, 5), fechaSalida: d(10, 5) },
      { empleadoId: "emp-1", fecha: d(10, 1), fechaSalida: d(10, 1) },
      { empleadoId: "emp-1", fecha: d(10, 3), fechaSalida: d(10, 4) },
    ]);
    expect(r.get("emp-1")).toEqual({ min: d(10, 1), max: d(10, 5) });
  });

  it("el último turno de todos, si cruza, estira el máximo un día", () => {
    const r = rangoDeRecalculo([
      { empleadoId: "emp-1", fecha: d(10, 1), fechaSalida: d(10, 1) },
      { empleadoId: "emp-1", fecha: d(10, 7), fechaSalida: d(10, 8) },
    ]);
    expect(r.get("emp-1")?.max).toEqual(d(10, 8));
  });

  it("cada empleado tiene su propio rango", () => {
    const r = rangoDeRecalculo([
      { empleadoId: "emp-1", fecha: d(10, 1), fechaSalida: d(10, 1) },
      { empleadoId: "emp-2", fecha: d(10, 6), fechaSalida: d(10, 7) },
    ]);
    expect(r.get("emp-1")).toEqual({ min: d(10, 1), max: d(10, 1) });
    expect(r.get("emp-2")).toEqual({ min: d(10, 6), max: d(10, 7) });
  });
});

describe("diasLiquidadosDe", () => {
  const liq = { empleadoId: "emp-1", desde: "2026-09-01", hasta: "2026-09-30" };
  const fechas = (...f: string[]) => new Map([["emp-1", f]]);

  it("un día dentro del rango queda protegido", () => {
    expect(diasLiquidadosDe([liq], fechas("2026-09-15"))).toEqual(new Set([claveDia("emp-1", "2026-09-15")]));
  });

  it("fecha_desde es inclusiva", () => {
    expect(diasLiquidadosDe([liq], fechas("2026-09-01")).has(claveDia("emp-1", "2026-09-01"))).toBe(true);
  });

  it("fecha_hasta es inclusiva", () => {
    expect(diasLiquidadosDe([liq], fechas("2026-09-30")).has(claveDia("emp-1", "2026-09-30"))).toBe(true);
  });

  it("el día anterior al desde y el posterior al hasta quedan libres", () => {
    expect(diasLiquidadosDe([liq], fechas("2026-08-31", "2026-10-01")).size).toBe(0);
  });

  it("la liquidación de otro empleado no contamina", () => {
    const deOtro = { ...liq, empleadoId: "emp-2" };
    expect(diasLiquidadosDe([deOtro], fechas("2026-09-15")).size).toBe(0);
  });

  it("un empleado sin días en juego no genera nada", () => {
    expect(diasLiquidadosDe([liq], new Map()).size).toBe(0);
  });

  it("varias liquidaciones, cada una protege lo suyo", () => {
    const octubre = { empleadoId: "emp-1", desde: "2026-10-01", hasta: "2026-10-31" };
    const r = diasLiquidadosDe([liq, octubre], fechas("2026-09-30", "2026-10-01", "2026-11-01"));
    expect([...r].sort()).toEqual([claveDia("emp-1", "2026-09-30"), claveDia("emp-1", "2026-10-01")]);
  });
});

describe("fechaArgentinaDe", () => {
  it("una salida de madrugada cae en el mismo día UTC y en el mismo día local", () => {
    // 04:00 locales = 07:00 UTC
    expect(fechaArgentinaDe(new Date("2026-10-03T07:00:00Z"))).toEqual(toUtcDateOnly(2026, 9, 3));
  });

  it("una salida a las 22:00 locales ya es el día siguiente en UTC y tiene que seguir siendo el de acá", () => {
    // 22:00 locales del 2 = 01:00 UTC del 3
    expect(fechaArgentinaDe(new Date("2026-10-03T01:00:00Z"))).toEqual(toUtcDateOnly(2026, 9, 2));
  });

  it("el borde: 00:00 locales es 03:00 UTC y ya es el día nuevo; 23:59 locales todavía es el viejo", () => {
    expect(fechaArgentinaDe(new Date("2026-10-03T03:00:00Z"))).toEqual(toUtcDateOnly(2026, 9, 3));
    expect(fechaArgentinaDe(new Date("2026-10-03T02:59:00Z"))).toEqual(toUtcDateOnly(2026, 9, 2));
  });
});

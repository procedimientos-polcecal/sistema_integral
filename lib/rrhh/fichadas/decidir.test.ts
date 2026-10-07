import { describe, it, expect } from "vitest";
import {
  decidirQueAplicar, claveDia, motivoDeProteccion, elegirAbiertoPrevio,
  type TurnoNuevo, type ContextoDeDecision, type FichadaAbierta,
} from "./decidir";
import { toUtcDateOnly, localDateTime } from "../dates";

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

describe("elegirAbiertoPrevio", () => {
  function abierta(id: string, empleadoId: string, fecha: string, horaUtc = "22:00"): FichadaAbierta {
    return { id, empleadoId, fecha, horaEntrada: `${fecha}T${horaUtc}:00+00:00` };
  }

  it("elige, por empleado, la más reciente anterior a su primer día", () => {
    const abiertas = [
      abierta("a", "emp-1", "2026-09-10"),
      abierta("b", "emp-1", "2026-09-30"),
      abierta("c", "emp-2", "2026-09-29"),
    ];
    const r = elegirAbiertoPrevio(abiertas, new Map([["emp-1", "2026-10-01"], ["emp-2", "2026-10-01"]]));
    expect(r.get("emp-1")?.id).toBe("b");
    expect(r.get("emp-2")?.id).toBe("c");
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

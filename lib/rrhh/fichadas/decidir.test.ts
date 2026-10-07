import { describe, it, expect } from "vitest";
import { decidirQueAplicar, claveDia, type TurnoNuevo, type ContextoDeDecision } from "./decidir";
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
  });
});

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diasAMarcarAlEditar, marcarDiaCorregido, type FichadaGuardada } from "./marcarDia";

const A: FichadaGuardada = {
  empleadoId: "emp-a",
  fecha: "2026-10-05",
  horaEntrada: "2026-10-05T11:00:00+00:00",
  horaSalida: "2026-10-05T20:00:00+00:00",
  observaciones: null,
};
const dia = (f: FichadaGuardada) => ({ empleadoId: f.empleadoId, fecha: f.fecha });

describe("diasAMarcarAlEditar", () => {
  describe("si nada cambió, no marca nada", () => {
    it("fila idéntica (el modal manda un PUT por fila aunque no se haya tocado)", () => {
      expect(diasAMarcarAlEditar({ ...A }, { ...A })).toEqual([]);
    });

    it("el mismo instante escrito distinto no es un cambio", () => {
      expect(diasAMarcarAlEditar(A, { ...A, horaEntrada: "2026-10-05T11:00:00Z" })).toEqual([]);
    });

    it("observaciones null contra '' contra undefined es lo mismo", () => {
      expect(diasAMarcarAlEditar({ ...A, observaciones: null }, { ...A, observaciones: "" })).toEqual([]);
      expect(diasAMarcarAlEditar({ ...A, observaciones: "" }, { ...A, observaciones: null })).toEqual([]);
      expect(diasAMarcarAlEditar(
        { ...A, observaciones: undefined as unknown as null },
        { ...A, observaciones: null }
      )).toEqual([]);
    });

    it("hora_salida null contra undefined es lo mismo (fichada abierta)", () => {
      const abierta = { ...A, horaSalida: null };
      expect(diasAMarcarAlEditar(abierta, { ...abierta, horaSalida: undefined as unknown as null })).toEqual([]);
    });
  });

  describe("si cambió algo sin moverse, marca sólo ese día", () => {
    it("cambió sólo la hora de salida", () => {
      const nueva = { ...A, horaSalida: "2026-10-05T21:30:00+00:00" };
      expect(diasAMarcarAlEditar(A, nueva)).toEqual([dia(A)]);
    });

    it("la salida pasó de null a un valor (se cerró una fichada abierta)", () => {
      const abierta = { ...A, horaSalida: null };
      expect(diasAMarcarAlEditar(abierta, A)).toEqual([dia(A)]);
    });

    it("la salida pasó de un valor a null", () => {
      expect(diasAMarcarAlEditar(A, { ...A, horaSalida: null })).toEqual([dia(A)]);
    });

    it("cambió sólo la hora de entrada", () => {
      expect(diasAMarcarAlEditar(A, { ...A, horaEntrada: "2026-10-05T11:05:00+00:00" })).toEqual([dia(A)]);
    });

    it("cambió sólo observaciones", () => {
      expect(diasAMarcarAlEditar(A, { ...A, observaciones: "llegó tarde" })).toEqual([dia(A)]);
    });

    it("observaciones pasó de un texto a vacío", () => {
      expect(diasAMarcarAlEditar({ ...A, observaciones: "x" }, { ...A, observaciones: null })).toEqual([dia(A)]);
    });
  });

  describe("si se movió, marca el destino y el origen", () => {
    it("de día, sin cambiar las horas", () => {
      const nuevo = { ...A, fecha: "2026-10-06" };
      expect(diasAMarcarAlEditar(A, nuevo)).toEqual([dia(nuevo), dia(A)]);
    });

    it("de empleado, sin cambiar las horas", () => {
      const nuevo = { ...A, empleadoId: "emp-b" };
      expect(diasAMarcarAlEditar(A, nuevo)).toEqual([dia(nuevo), dia(A)]);
    });

    it("de los dos a la vez", () => {
      const nuevo = { ...A, empleadoId: "emp-b", fecha: "2026-10-06" };
      expect(diasAMarcarAlEditar(A, nuevo)).toEqual([dia(nuevo), dia(A)]);
    });

    it("de día y con horas distintas", () => {
      const nuevo = { ...A, fecha: "2026-10-06", horaSalida: null };
      expect(diasAMarcarAlEditar(A, nuevo)).toEqual([dia(nuevo), dia(A)]);
    });
  });

  it("sin lectura previa no hay con qué comparar: marca el día en que quedó", () => {
    expect(diasAMarcarAlEditar(null, A)).toEqual([dia(A)]);
  });
});

describe("marcarDiaCorregido", () => {
  function clienteQue(resultado: () => unknown) {
    const upsert = vi.fn(resultado);
    const from = vi.fn(() => ({ upsert }));
    return { cliente: { from } as unknown as SupabaseClient, upsert, from };
  }

  it("hace upsert sobre (empleado_id, fecha)", async () => {
    const { cliente, upsert, from } = clienteQue(() => ({ error: null }));
    const ok = await marcarDiaCorregido(cliente, "emp-a", "2026-10-05", "usr-1", "borrada");
    expect(ok).toBe(true);
    expect(from).toHaveBeenCalledWith("rrhh_dias_corregidos");
    expect(upsert).toHaveBeenCalledWith(
      { empleado_id: "emp-a", fecha: "2026-10-05", usuario_id: "usr-1", accion: "borrada" },
      { onConflict: "empleado_id,fecha" }
    );
  });

  it("no lanza si la base devuelve un error: lo deja en el log y devuelve false", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteQue(() => ({ error: { message: "boom" } }));
    await expect(marcarDiaCorregido(cliente, "emp-a", "2026-10-05", "usr-1", "editada")).resolves.toBe(false);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("no lanza si el cliente tira una excepción y devuelve false", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteQue(() => { throw new Error("red caída"); });
    await expect(marcarDiaCorregido(cliente, "emp-a", "2026-10-05", "usr-1", "creada")).resolves.toBe(false);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
